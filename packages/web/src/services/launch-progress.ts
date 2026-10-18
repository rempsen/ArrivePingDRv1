/**
 * Launch progress: measure and nudge (blueprint 2026-10-17, Phase 6).
 *
 * A sweep every 30 minutes looks at each company in its first ten days and:
 *   1. records when each launch-checklist step was first done, and emits
 *      `guide.checklist_item_completed` / `guide.activated` to PostHog;
 *   2. works out the activation stage that HubSpot shows on the company
 *      (`arriveping_activation_stage`): signed_up → set_up → first_job →
 *      activated (steps 1–3) → live (all five);
 *   3. sends the admins a short tip email on day 1, 3 and 7 listing what's
 *      left, only while something is left, at most once each, with a
 *      one-click unsubscribe (LAUNCH_NUDGES=on to enable);
 *   4. tells #onboarding in Slack once if a company has no real job after
 *      48 hours (needs SLACK_ONBOARDING_WEBHOOK_URL).
 *
 * The checklist itself is still recomputed from real data every time
 * (services/launch-checklist.ts); this only remembers *when* things happened
 * and what was already sent, in `companies.launch_progress`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { capture } from "../api/lib/analytics";
import { log } from "../api/lib/logger";
import { parseOnboarding } from "../shared/onboarding";
import { LAUNCH_ITEMS, type LaunchChecklist, type LaunchItemId } from "../shared/launch-items";
import { interpolate, type Terms } from "../web/guide/registry";
import { computeLaunchChecklist } from "./launch-checklist";
import { emailTemplates, sendEmail } from "./email";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How long after signup a company is watched. */
export const WATCH_DAYS = 10;
/** Steps 1–3 done = activated (blueprint: within 7 days). */
const ACTIVATION_ITEMS: LaunchItemId[] = ["first-job", "invite-tech", "live-eta"];
const APP_URL = (process.env.APP_URL ?? process.env.WEBSITE_URL ?? "https://arriveping.com").replace(/\/$/, "");

export type ActivationStage = "signed_up" | "set_up" | "first_job" | "activated" | "live";
export type NudgeKey = "d1" | "d3" | "d7";

export interface LaunchProgress {
  v: 1;
  /** When each step was first seen done (ISO). */
  done: Partial<Record<LaunchItemId, string>>;
  stage?: ActivationStage;
  stageAt?: string;
  activatedAt?: string;
  nudges?: Partial<Record<NudgeKey, string>>;
  stallAlertAt?: string;
}

export function parseProgress(text: string | null | undefined): LaunchProgress {
  try {
    const raw = text ? (JSON.parse(text) as Partial<LaunchProgress>) : null;
    if (raw && typeof raw === "object") return { ...raw, v: 1, done: raw.done && typeof raw.done === "object" ? raw.done : {} };
  } catch {
    /* unreadable: start over */
  }
  return { v: 1, done: {} };
}

export function activationStage(c: LaunchChecklist, setupFinished: boolean): ActivationStage {
  const done = new Set(c.items.filter((i) => i.done).map((i) => i.id));
  if (c.complete) return "live";
  if (ACTIVATION_ITEMS.every((id) => done.has(id))) return "activated";
  if (done.has("first-job")) return "first_job";
  return setupFinished ? "set_up" : "signed_up";
}

/**
 * Which tip email is due now, if any. Each has a window; only the current
 * window's email can go out, so a sweep that was down for two days never
 * sends day 1 and day 3 back to back.
 */
export const NUDGE_WINDOWS: { key: NudgeKey; from: number; to: number }[] = [
  { key: "d1", from: 1 * DAY, to: 3 * DAY },
  { key: "d3", from: 3 * DAY, to: 7 * DAY },
  { key: "d7", from: 7 * DAY, to: WATCH_DAYS * DAY },
];
export function dueNudge(p: LaunchProgress, createdAt: Date, now: Date, c: LaunchChecklist): NudgeKey | null {
  if (c.complete) return null;
  const age = now.getTime() - createdAt.getTime();
  const w = NUDGE_WINDOWS.find((x) => age >= x.from && age < x.to);
  if (!w || p.nudges?.[w.key]) return null;
  // After day 1, only nudge companies that haven't activated yet.
  if (w.key !== "d1" && (p.activatedAt || activationStage(c, false) === "activated")) return null;
  return w.key;
}

export function stallDue(p: LaunchProgress, createdAt: Date, now: Date, c: LaunchChecklist): boolean {
  const age = now.getTime() - createdAt.getTime();
  const firstJob = c.items.find((i) => i.id === "first-job")?.done;
  return !p.stallAlertAt && !firstJob && age >= 2 * DAY && age < WATCH_DAYS * DAY;
}

// ── Unsubscribe tokens ─────────────────────────────────────────────────────

function secret(): string {
  return process.env.LAUNCH_TIPS_SECRET || process.env.BETTER_AUTH_SECRET || "dev-launch-tips";
}
export function unsubscribeToken(membershipId: string): string {
  const sig = createHmac("sha256", secret()).update(`launch-tips:${membershipId}`).digest("base64url").slice(0, 32);
  return `${Buffer.from(membershipId).toString("base64url")}.${sig}`;
}
export function readUnsubscribeToken(token: string): string | null {
  const [idPart, sig] = String(token || "").split(".");
  if (!idPart || !sig) return null;
  let id: string;
  try {
    id = Buffer.from(idPart, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const want = unsubscribeToken(id).split(".")[1]!;
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Stop tip emails for one person at one company. Returns false for an unknown membership. */
export async function unsubscribeLaunchTips(membershipId: string): Promise<boolean> {
  // A signed link from an email: there's no session or tenant, so this is a
  // system write, limited to the one membership the signature names. Read,
  // merge and write under a row lock, like PATCH /api/me/onboarding, so a
  // Guide progress save at the same moment can't undo the opt-out (or the
  // opt-out drop that progress).
  return sdb.transaction(async (tx) => {
    const [m] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)).limit(1).for("update");
    if (!m) return false;
    const state = parseOnboarding(m.onboarding);
    if (state.nudgesOff) return true;
    await tx
      .update(schema.memberships)
      .set({ onboarding: JSON.stringify({ ...state, nudgesOff: true }), updatedAt: new Date() })
      .where(eq(schema.memberships.id, membershipId));
    return true;
  });
}

// ── Emails and Slack ───────────────────────────────────────────────────────

async function termsFor(companyId: string): Promise<Terms> {
  const s = await tdb(companyId).selectOne(schema.companySettings).catch(() => undefined);
  const low = (w: string | undefined, d: string) => (w || d).toLowerCase();
  return {
    job: low(s?.jobNoun, "job"),
    jobs: low(s?.jobNounPlural, "jobs"),
    worker: low(s?.workerNoun, "technician"),
    workers: low(s?.workerNounPlural, "technicians"),
    customer: low(s?.customerNoun, "customer"),
    customers: low(s?.customerNounPlural, "customers"),
  };
}

/** The admins who get tips: active, real, and not unsubscribed. */
async function recipients(companyId: string) {
  const rows = await sdb
    .select({ membership: schema.memberships, user: schema.user })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.role, "admin"), eq(schema.memberships.status, "active")));
  return rows.filter(({ membership, user }) => !user.isSample && user.email && user.role !== "superadmin" && !parseOnboarding(membership.onboarding).nudgesOff);
}

export function nudgeEmail(key: NudgeKey, c: LaunchChecklist, terms: Terms, firstName: string, unsubscribeUrl: string) {
  // Steps they can act on first; an invited technician they're waiting for last.
  const left = [...c.items.filter((i) => !i.done && !i.waiting), ...c.items.filter((i) => !i.done && i.waiting)];
  const done = c.items.length - left.length;
  const t = (s: string) => interpolate(s, terms);
  // The next step they can act on (an invited technician they're waiting for isn't one).
  const nextItem = left.find((i) => !i.waiting) ?? left[0];
  const next = nextItem ? LAUNCH_ITEMS[nextItem.id] : null;
  const subject =
    key === "d1"
      ? `${done} of ${c.items.length} done: here's what's next on ArrivePing`
      : key === "d3"
        ? next
          ? `Next up on ArrivePing: ${t(next.title).replace(/^./, (ch) => ch.toLowerCase())}`
          : "You're nearly live on ArrivePing"
        : "What's left before you go live on ArrivePing";
  const intro =
    key === "d1"
      ? `You've done ${done} of the ${c.items.length} steps to run your first real day on ArrivePing. Here's what's left:`
      : key === "d3"
        ? `You're ${done} of ${c.items.length} steps in. The next one takes a couple of minutes:`
        : `This is our last tip. Here's what's left before your ${terms.customers} get live ETAs:`;
  return emailTemplates.launchTip({
    subject,
    title: key === "d7" ? "Almost there" : "Pick up where you left off",
    firstName,
    intro,
    items: left.slice(0, 3).map((i) => {
      const m = LAUNCH_ITEMS[i.id];
      return { title: t(m.title), body: i.waiting && m.waiting ? m.waiting : t(m.body) };
    }),
    ctaUrl: `${APP_URL}/admin/getting-started`,
    unsubscribeUrl,
  });
}

export async function postStallAlert(
  co: { id: string; name: string },
  c: LaunchChecklist,
  admin: { name: string; email: string } | null,
  hours: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = process.env.SLACK_ONBOARDING_WEBHOOK_URL?.trim();
  if (!url) return false;
  const done = c.items.filter((i) => i.done).length;
  const text = `${co.name} has no real job ${Math.round(hours)} hours after signing up (${done} of ${c.items.length} launch steps done).`;
  const body = {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:hourglass: *${co.name}* has no real job yet, ${Math.round(hours / 24)} days after signing up.` } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Launch steps*\n${done} of ${c.items.length} done` },
          { type: "mrkdwn", text: `*Admin*\n${admin ? `${admin.name || "—"} · ${admin.email}` : "—"}` },
        ],
      },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open in superadmin" }, url: `${APP_URL}/admin/companies` }],
      },
    ],
  };
  try {
    const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    if (!r.ok) log.error("launch: Slack stall alert rejected", { status: r.status });
    return r.ok;
  } catch (e) {
    log.error("launch: Slack stall alert failed", { err: (e as Error).message });
    return false;
  }
}

// ── The sweep ──────────────────────────────────────────────────────────────

export interface SweepDeps {
  send?: typeof sendEmail;
  slack?: typeof postStallAlert;
  onStageChange?: (companyId: string) => void;
}

export async function sweepLaunch(now = new Date(), deps: SweepDeps = {}) {
  const send = deps.send ?? sendEmail;
  const slack = deps.slack ?? postStallAlert;
  const nudgesOn = process.env.LAUNCH_NUDGES === "on";
  const since = new Date(now.getTime() - WATCH_DAYS * DAY);
  const companies = await sdb
    .select()
    .from(schema.companies)
    .where(and(gte(schema.companies.createdAt, since), eq(schema.companies.status, "active"), eq(schema.companies.isInternal, false)));
  const out = { companies: companies.length, items: 0, emails: 0, alerts: 0 };

  for (const co of companies) {
    try {
      const c = await computeLaunchChecklist(co.id);
      const prev = parseProgress(co.launchProgress);
      const p: LaunchProgress = { ...prev, done: { ...prev.done }, nudges: { ...prev.nudges } };
      const at = now.toISOString();

      for (const i of c.items) {
        if (i.done && !p.done[i.id]) {
          p.done[i.id] = at;
          out.items++;
          capture("guide.checklist_item_completed", co.id, { companyId: co.id, item: i.id, hoursSinceSignup: Math.round((now.getTime() - co.createdAt.getTime()) / HOUR) });
        }
      }
      const stage = activationStage(c, Boolean(co.onboardingCompletedAt));
      if (stage !== p.stage) {
        p.stage = stage;
        p.stageAt = at;
        deps.onStageChange?.(co.id);
      }
      if (!p.activatedAt && (stage === "activated" || stage === "live")) {
        p.activatedAt = at;
        const hours = Math.round((now.getTime() - co.createdAt.getTime()) / HOUR);
        capture("guide.activated", co.id, { companyId: co.id, hoursSinceSignup: hours, withinWeek: hours <= 7 * 24 });
      }

      const key = nudgesOn ? dueNudge(p, co.createdAt, now, c) : null;
      if (key) {
        const terms = await termsFor(co.id);
        for (const { membership, user } of await recipients(co.id)) {
          const first = (user.firstName || user.name || "").split(" ")[0] || "there";
          const unsub = `${APP_URL}/api/launch-tips/unsubscribe?t=${unsubscribeToken(membership.id)}`;
          const mail = nudgeEmail(key, c, terms, first, unsub);
          const r = await send({
            to: user.email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            replyTo: "support@nvc360.com",
            headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          });
          if ((r as { ok?: boolean })?.ok !== false) out.emails++;
        }
        // Recorded even with no one to send to, so it's never retried.
        p.nudges![key] = at;
        capture("guide.nudge_sent", co.id, { companyId: co.id, nudge: key });
      }

      if (stallDue(p, co.createdAt, now, c) && process.env.SLACK_ONBOARDING_WEBHOOK_URL) {
        const [admin] = await recipients(co.id);
        const ok = await slack({ id: co.id, name: co.name }, c, admin ? { name: admin.user.name, email: admin.user.email } : null, (now.getTime() - co.createdAt.getTime()) / HOUR);
        if (ok) {
          p.stallAlertAt = at;
          out.alerts++;
        }
      }

      const text = JSON.stringify(p);
      if (text !== (co.launchProgress ?? "")) await sdb.update(schema.companies).set({ launchProgress: text }).where(eq(schema.companies.id, co.id));
    } catch (e) {
      log.error("launch: sweep failed for company", { companyId: co.id, err: (e as Error).message });
    }
  }
  return out;
}
