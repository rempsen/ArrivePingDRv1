import app from "./api";
import { reconcileAllRiders } from "./services/presence";
import { rowsNeedingPoll, triggerVerify } from "./services/email-domains";
import { seedRolePermissions } from "./api/routes/team";
import { startRetentionSweeps } from "./services/retention";
import { startScheduler } from "./services/scheduler";
// Importing these registers their scheduler task handlers (review_request,
// maintenance_reminder) at boot. Without the import the queue would claim the
// tasks and find no handler.
import "./services/reviews";
import "./services/maintenance";
import { sweepTimeTriggers } from "./services/automation";
import { sweepDelays } from "./services/delay-watch";
import { log, captureException } from "./api/lib/logger";
import { initRealtimeBus } from "./services/realtime";
import { initRateLimitStore } from "./api/lib/rate-limit";
import { alertsEnabled } from "./api/lib/alerts";
import { closeRedis } from "./api/lib/redis";
import { flushAnalytics } from "./api/lib/analytics";
import { serveSite } from "./site-server";

// Select realtime + rate-limit backends. Redis (multi-node) when REDIS_URL is
// set, in-memory (single-node) otherwise. Wrapped so that even an unexpected
// synchronous throw (e.g. Redis unreachable from a deploy runner) can NEVER
// stop the server from binding its port — otherwise the platform's post-start
// health-check fetch fails and the whole deploy is marked failed ("start-website
// failed: fetch failed"). Degrade to in-memory rather than crash.
try {
  initRealtimeBus();
} catch (e) {
  console.error("initRealtimeBus failed (continuing single-node)", e);
}
try {
  initRateLimitStore();
} catch (e) {
  console.error("initRateLimitStore failed (continuing single-node)", e);
}
log.info(
  alertsEnabled()
    ? "alerts: per-tenant error alerting ENABLED"
    : "alerts: disabled (set ALERT_EMAIL or ALERT_WEBHOOK_URL to enable)",
);

// crash safety — log + report, never silently die
process.on("unhandledRejection", (reason) =>
  captureException(reason, { kind: "unhandledRejection" }),
);
process.on("uncaughtException", (err) => captureException(err, { kind: "uncaughtException" }));

startRetentionSweeps();

// Seed industry-default role permissions on boot (no-op if already present).
seedRolePermissions().catch((e) =>
  console.error("seedRolePermissions (boot) failed", e),
);

const port = Number(process.env.PORT ?? 3000);

// Warm up the Turso connection before serving traffic so the first real user
// request after a cold start / host resume never races the socket coming up.
import { oncePerTick } from "./services/tick";
import { warmUpDb, pingDb } from "./api/database";
warmUpDb().catch((e) => console.error("db warm-up (boot) failed", e));
// Keep the DB socket warm: a cheap `select 1` every 60s stops Turso's
// keep-alive socket from idling out between low-traffic periods.
setInterval(() => {
  pingDb().catch(() => {});
}, 60 * 1000);

// Every sweep below is wrapped in oncePerTick: setInterval does not wait for
// the previous run, so one slow Turso minute would otherwise put two passes
// inside the same rows at once — two "running late" texts about one job, or the
// same automation rule firing twice. A skipped tick is harmless; the next one
// is 60s away and every sweep is safe to repeat.
// Periodic self-heal: clear any stuck "busy"/"available" mismatches so a tech
// never stays locked by a future-dated or cancelled job. Runs on boot + every 2 min.
reconcileAllRiders().catch((e) => console.error("presence sweep (boot) failed", e));
setInterval(() => {
  void oncePerTick("presence-sweep", reconcileAllRiders);
}, 2 * 60 * 1000);

// Deferred task queue: review requests, maintenance reminders, warranty
// nudges, time-based automation. Ticks every 60s; claims are race-safe so a
// rolling deploy running two instances can't double-fire a task.
startScheduler();

// Time-based automation triggers (tech_idle, sla_risk). Nothing fires these —
// they are conditions of time passing — so we sweep once a minute. Cheap: the
// sweep exits immediately when no tenant has an enabled time-based rule.
setInterval(() => {
  void oncePerTick("automation-sweep", sweepTimeTriggers);
}, 60 * 1000);

// Running-late watch. Nothing in the app can fire this either — a job going
// late is the absence of an event, not an event — so it is swept once a minute.
// It flags the slip for dispatch first and only sends the customer notice if
// nobody acts within the tenant's grace period.
setInterval(() => {
  void oncePerTick("delay-sweep", sweepDelays);
}, 60 * 1000);

// Auto-poll pending/verifying email sending domains and flip to verified.
async function pollEmailDomains() {
  const rows = await rowsNeedingPoll();
  for (const r of rows) {
    if (!r.resendDomainId) continue; // not approved yet — nothing to check
    await triggerVerify(r.id).catch((e) =>
      console.error(`email-domain poll failed for ${r.domain}`, e),
    );
  }
}
pollEmailDomains().catch((e) => console.error("email-domain poll (boot) failed", e));
setInterval(() => {
  void oncePerTick("email-domain-poll", pollEmailDomains);
}, 2 * 60 * 1000);

const server = Bun.serve({
  port,
  // SSE streams (e.g. /api/track/:token/stream) hold the socket open with a
  // 20s heartbeat. Bun's default idleTimeout is 10s and would kill them, so
  // disable the idle timeout. Per-connection lifecycle is managed in-app.
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    // serve uploaded files from local disk
    if (url.pathname.startsWith("/uploads/")) {
      const safe = decodeURIComponent(url.pathname)
        .replace(/^\/+/, "")
        .replaceAll("..", "");
      const uploaded = Bun.file(`${process.cwd()}/${safe}`);
      if (await uploaded.exists()) return new Response(uploaded);
      return new Response("Not found", { status: 404 });
    }

    return serveSite(request, url);
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

// ---------------------------------------------------------------------------
// Self-ping keep-alive: prevents the Runable (and similar platforms') idle
// shutdown from hibernating the container after extended inactivity.
//
// Every 4 minutes we fetch our own /api/ready endpoint. This keeps the process
// marked "active" by the host runtime and also warms the DB connection. The
// ping uses the public APP_URL (env var set by Runable) so it goes through the
// full CDN + routing path, the same as a real user request, rather than a
// loopback that could be optimised away by the platform.
//
// If APP_URL is not set (local dev), we fall back to localhost so dev mode is
// unaffected.
// ---------------------------------------------------------------------------
const SELF_PING_URL =
  (process.env.APP_URL ?? `http://localhost:${port}`).replace(/\/$/, "") +
  "/api/ready";

setInterval(async () => {
  try {
    const r = await fetch(SELF_PING_URL, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) console.warn(`[keep-alive] /api/ready returned ${r.status}`);
  } catch {
    // Network errors during a self-ping are non-fatal — just swallow.
  }
}, 4 * 60 * 1000);

// Graceful shutdown: stop accepting traffic, then close Redis connections so a
// rolling deploy doesn't leave dangling sockets / half-published messages.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  try {
    server.stop();
    await flushAnalytics();
    await closeRedis();
  } catch (e) {
    captureException(e, { kind: "shutdown" });
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
