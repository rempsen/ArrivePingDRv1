/**
 * Structured JSON logging + Sentry-ready hooks.
 *
 * - Emits one JSON line per event (ingestable by Datadog/Loki/CloudWatch).
 * - Carries a request id for correlation across a request's lifecycle.
 * - `captureException` is the single choke point for error reporting; wire
 *   Sentry by setting SENTRY_DSN — the dynamic import keeps it optional.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
const SERVICE = process.env.SERVICE_NAME ?? "nvc360-api";
const ENV = process.env.NODE_ENV ?? "development";

// ---- PII / secret scrubbing -----------------------------------------------
const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|client[-_]?secret|signature|ssn|card|cvv|set-cookie|refresh|access[-_]?token|private)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function maskEmail(s: string): string {
  return s.replace(EMAIL_RE, (m) => {
    const [u = "", d] = m.split("@");
    const head = u.length <= 2 ? u[0] ?? "" : u.slice(0, 2);
    return `${head}***@${d}`;
  });
}

/**
 * Recursively redact secrets/PII. Drops values under sensitive keys, masks
 * emails in strings, caps recursion depth, and guards against cycles.
 */
export function scrub(value: unknown, depth = 6, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === "string") return maskEmail(value);
  if (typeof value !== "object") return value;
  if (depth <= 0) return "[truncated]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => scrub(v, depth - 1, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) { out[k] = "[redacted]"; continue; }
    out[k] = scrub(v, depth - 1, seen);
  }
  return out;
}

// ---- Sentry (optional, lazy) ----------------------------------------------
let sentry: any = null;
let sentryReady = false;
async function ensureSentry() {
  if (sentryReady) return sentry;
  sentryReady = true;
  if (!process.env.SENTRY_DSN) return null;
  try {
    // optional dep — only loaded when DSN present
    const Sentry = await import("@sentry/node").catch(() => null as any);
    if (Sentry?.init) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: ENV,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        // Never let the SDK auto-attach IPs, headers, or request bodies.
        sendDefaultPii: false,
        beforeSend(eventData: any) {
          try {
            if (eventData.request?.headers) eventData.request.headers = scrub(eventData.request.headers);
            if (eventData.request?.data) eventData.request.data = scrub(eventData.request.data);
            if (eventData.request?.cookies) delete eventData.request.cookies;
            if (eventData.extra) eventData.extra = scrub(eventData.extra) as any;
            if (eventData.contexts) eventData.contexts = scrub(eventData.contexts) as any;
            // collapse user down to an opaque id only
            if (eventData.user) eventData.user = eventData.user.id ? { id: eventData.user.id } : undefined;
          } catch {
            /* never block delivery on scrub failure */
          }
          return eventData;
        },
      });
      sentry = Sentry;
    }
  } catch {
    /* Sentry not installed — structured logs still capture everything */
  }
  return sentry;
}

/**
 * Best-effort flush of buffered telemetry before the process exits. Safe to
 * call when Sentry is not configured (resolves immediately).
 */
export async function flushTelemetry(timeoutMs = 2000): Promise<void> {
  try {
    if (sentry?.flush) await sentry.flush(timeoutMs);
  } catch {
    /* swallow — we are already shutting down */
  }
}
// warm it up at boot (no-op without DSN)
void ensureSentry();

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const safeFields = fields ? (scrub(fields) as Record<string, unknown>) : undefined;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    env: ENV,
    msg,
    ...safeFields,
  };
  // single JSON line; stderr for warn+ so log shippers can split streams
  const out = JSON.stringify(line);
  if (level === "error" || level === "warn") console.error(out);
  else console.log(out);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};

/**
 * Report an exception to logs + Sentry (when configured). Returns the eventId
 * so it can be surfaced to the client for support correlation.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): string | undefined {
  const e = err instanceof Error ? err : new Error(String(err));
  emit("error", e.message, {
    ...context,
    error: { name: e.name, message: e.message, stack: e.stack },
  });
  try {
    if (sentry?.captureException) {
      return sentry.captureException(e, { extra: context });
    }
  } catch {
    /* never let reporting throw */
  }
  return undefined;
}

/** Create a child logger bound to a request id (+ optional fields). */
export function requestLogger(requestId: string, base?: Record<string, unknown>) {
  const bind = { requestId, ...base };
  return {
    debug: (m: string, f?: Record<string, unknown>) => log.debug(m, { ...bind, ...f }),
    info: (m: string, f?: Record<string, unknown>) => log.info(m, { ...bind, ...f }),
    warn: (m: string, f?: Record<string, unknown>) => log.warn(m, { ...bind, ...f }),
    error: (m: string, f?: Record<string, unknown>) => log.error(m, { ...bind, ...f }),
  };
}
