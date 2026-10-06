/**
 * Lightweight, dependency-free application metrics.
 *
 * Design goals:
 *  - Zero external deps and near-zero overhead per request (a couple of array
 *    increments). Safe to call on the hot path.
 *  - LOW CARDINALITY. HTTP labels are the *route template* (e.g.
 *    `/api/bookings/:id`), method, and a status *class* (2xx/4xx/5xx) — never
 *    raw paths or ids, which would explode a time-series database.
 *  - Two surfaces from one source of truth:
 *      • GET /api/metrics       → Prometheus text exposition (scrapeable by
 *        Grafana Agent, Datadog, the OTEL collector, Fly metrics, etc.)
 *      • GET /api/metrics.json  → a human-readable snapshot to eyeball in a
 *        browser, with computed p50/p95/p99 per route.
 *
 * Latency is bucketed into fixed Prometheus-style histogram buckets so the
 * exposition is a real `histogram` (works with histogram_quantile() in PromQL)
 * AND we can compute quantiles locally for the JSON view.
 *
 * This is process-local. With multiple nodes, your metrics backend scrapes each
 * instance and aggregates — which is exactly how Prometheus-style monitoring is
 * meant to work (no shared store needed, unlike the realtime bus / rate limiter).
 */

// Histogram buckets in SECONDS (Prometheus convention). Tuned for an API:
// sub-millisecond health checks up to multi-second slow calls.
const BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type HttpKey = string; // `${method} ${route} ${statusClass}`

interface HttpSeries {
  method: string;
  route: string;
  statusClass: string; // "2xx" | "3xx" | "4xx" | "5xx"
  count: number;
  sumMs: number; // sum of latencies in ms (for avg + Prometheus _sum)
  buckets: number[]; // cumulative counts indexed alongside BUCKETS_S
}

const http = new Map<HttpKey, HttpSeries>();
const counters = new Map<string, number>();
const startedAt = Date.now();

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/**
 * Collapse a concrete request path into a low-cardinality route template.
 * Replaces obvious id-ish segments (uuids, numbers, long opaque tokens, emails)
 * with `:id`. Keeps known stable segments intact.
 */
export function templatePath(path: string): string {
  const segs = path.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg)) return ":id"; // numeric id
    if (/^[0-9a-fA-F-]{16,}$/.test(seg)) return ":id"; // uuid / hex token
    if (/^[A-Za-z0-9_-]{20,}$/.test(seg)) return ":id"; // long opaque key
    if (seg.includes("@")) return ":id"; // email in path
    if (/^[0-9a-fA-F]{8,}$/.test(seg)) return ":id"; // hex blob
    return seg;
  });
  return segs.join("/") || "/";
}

/** Record one finished HTTP request. `ms` = wall latency in milliseconds. */
export function recordHttp(method: string, path: string, status: number, ms: number): void {
  const route = templatePath(path);
  const sc = statusClass(status);
  const key = `${method} ${route} ${sc}`;
  let s = http.get(key);
  if (!s) {
    s = { method, route, statusClass: sc, count: 0, sumMs: 0, buckets: Array.from({ length: BUCKETS_S.length }, () => 0) };
    http.set(key, s);
  }
  s.count++;
  s.sumMs += ms;
  const secs = ms / 1000;
  for (let i = 0; i < BUCKETS_S.length; i++) {
    if (secs <= BUCKETS_S[i]!) s.buckets[i]!++;
  }
  // Cap series count defensively — never let a pathological route blow memory.
  if (http.size > 2000) {
    const firstKey = http.keys().next().value;
    if (firstKey) http.delete(firstKey);
  }
}

/** Increment a named business/event counter (e.g. "bookings_created_total"). */
export function incr(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

// ---- Quantiles (for the JSON view) ----------------------------------------
// Interpolated from the cumulative histogram buckets — approximate but standard
// (same method histogram_quantile uses). Returns ms.
function quantileFromBuckets(buckets: number[], total: number, q: number): number {
  if (total === 0) return 0;
  const rank = q * total;
  let prevCum = 0;
  let prevBound = 0;
  for (let i = 0; i < BUCKETS_S.length; i++) {
    const cum = buckets[i] ?? 0;
    const bound = BUCKETS_S[i]!;
    if (cum >= rank) {
      // linear interpolation within [prevBound, bound]
      const span = cum - prevCum || 1;
      const frac = (rank - prevCum) / span;
      const secs = prevBound + (bound - prevBound) * frac;
      return Math.round(secs * 1000);
    }
    prevCum = cum;
    prevBound = bound;
  }
  return Math.round(BUCKETS_S[BUCKETS_S.length - 1]! * 1000); // +Inf bucket
}

// ---- Exposition ------------------------------------------------------------

/** Prometheus text exposition (text/plain; version=0.0.4). */
export function renderProm(): string {
  const lines: string[] = [];
  const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  lines.push("# HELP app_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE app_uptime_seconds gauge");
  lines.push(`app_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(0)}`);

  // Request counter + latency histogram share the same label set.
  lines.push("# HELP http_requests_total Total HTTP requests.");
  lines.push("# TYPE http_requests_total counter");
  for (const s of http.values()) {
    lines.push(
      `http_requests_total{method="${esc(s.method)}",route="${esc(s.route)}",status="${s.statusClass}"} ${s.count}`,
    );
  }

  lines.push("# HELP http_request_duration_seconds HTTP request latency.");
  lines.push("# TYPE http_request_duration_seconds histogram");
  for (const s of http.values()) {
    const labels = `method="${esc(s.method)}",route="${esc(s.route)}",status="${s.statusClass}"`;
    for (let i = 0; i < BUCKETS_S.length; i++) {
      lines.push(`http_request_duration_seconds_bucket{${labels},le="${BUCKETS_S[i]}"} ${s.buckets[i]}`);
    }
    lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${s.count}`);
    lines.push(`http_request_duration_seconds_sum{${labels}} ${(s.sumMs / 1000).toFixed(6)}`);
    lines.push(`http_request_duration_seconds_count{${labels}} ${s.count}`);
  }

  // Business counters.
  for (const [name, val] of counters) {
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${val}`);
  }

  return lines.join("\n") + "\n";
}

/** Human-readable JSON snapshot with computed quantiles. */
export function renderJson() {
  let reqTotal = 0;
  let errTotal = 0; // 5xx
  const routes = [...http.values()]
    .map((s) => {
      reqTotal += s.count;
      if (s.statusClass === "5xx") errTotal += s.count;
      return {
        route: s.route,
        method: s.method,
        status: s.statusClass,
        count: s.count,
        avg_ms: Math.round(s.sumMs / s.count),
        p50_ms: quantileFromBuckets(s.buckets, s.count, 0.5),
        p95_ms: quantileFromBuckets(s.buckets, s.count, 0.95),
        p99_ms: quantileFromBuckets(s.buckets, s.count, 0.99),
      };
    })
    .sort((a, b) => b.count - a.count);

  // Aggregate latency across all routes for a single top-line SLI.
  const allBuckets = Array.from({ length: BUCKETS_S.length }, () => 0);
  let allSum = 0;
  for (const s of http.values()) {
    for (let i = 0; i < BUCKETS_S.length; i++) allBuckets[i]! += s.buckets[i]!;
    allSum += s.sumMs;
  }

  return {
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    requests_total: reqTotal,
    errors_5xx_total: errTotal,
    error_rate: reqTotal ? Number((errTotal / reqTotal).toFixed(4)) : 0,
    latency_ms: {
      avg: reqTotal ? Math.round(allSum / reqTotal) : 0,
      p50: quantileFromBuckets(allBuckets, reqTotal, 0.5),
      p95: quantileFromBuckets(allBuckets, reqTotal, 0.95),
      p99: quantileFromBuckets(allBuckets, reqTotal, 0.99),
    },
    counters: Object.fromEntries(counters),
    routes,
  };
}

/** Test/util: wipe all collected metrics. */
export function resetMetrics(): void {
  http.clear();
  counters.clear();
}
