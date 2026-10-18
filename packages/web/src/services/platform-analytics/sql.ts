/**
 * Platform analytics: the one place every platform KPI is defined.
 *
 * Each query below is written once, in Postgres, with named parameters
 * (`@@start_day@@`). Two renderers turn it into something runnable:
 *
 *   - `forApp()` builds a drizzle SQL object with bound parameters. The
 *     superadmin Analytics tab runs it through the system connection.
 *   - `forDashboard()` writes the same text with `{{start_day}}`
 *     placeholders. The Claude "ArrivePing Analytics" dashboard runs it live
 *     through the Supabase connector, with the viewer's own access.
 *
 * Because both surfaces run the same statement, the tab and the dashboard
 * can't disagree about what "jobs completed" means.
 *
 * Rules every query here follows (the dashboard refuses anything else, and
 * the tests check all of them):
 *   - one SELECT / WITH statement, under 16,000 characters;
 *   - none of the words INSERT UPDATE DELETE MERGE DROP ALTER CREATE
 *     TRUNCATE GRANT REVOKE CALL EXEC EXECUTE COPY EXPORT LOAD INTO
 *     RETURNING DECLARE SET BEGIN COMMIT, even as part of a name;
 *   - parameters appear only as @@name@@; the renderer wraps each in
 *     CAST(... AS type), and an unset parameter is NULL, which every query
 *     treats as "no filter" or "the default".
 *
 * Days are counted in America/Winnipeg, NVC360's home time zone.
 */
import { sql, type SQL } from "drizzle-orm";
import { pricingBands, STARTER_PRICE, STARTER_DRIVERS } from "../../web/site/config";
import { INDUSTRY_LABELS, industryLabel } from "../industry-presets";

export const TZ = "America/Winnipeg";

export const PARAM_TYPES = {
  start_day: "DATE",
  end_day: "DATE",
  include_test: "BOOLEAN",
  tenant: "TEXT",
  industry: "TEXT",
  billing: "TEXT",
  grain: "TEXT",
} as const;
export type ParamName = keyof typeof PARAM_TYPES;
export type Grain = "day" | "week" | "month";

export interface AnalyticsParams {
  start_day?: string | null;
  end_day?: string | null;
  include_test?: boolean | null;
  tenant?: string | null;
  industry?: string | null;
  billing?: string | null;
  grain?: Grain | null;
}

const P = (n: ParamName) => `@@${n}@@`;
const TOKEN = /@@([a-z_]+)@@/g;

/* ----------------------------------------------------------- renderers -- */

/** The query as a drizzle SQL object with bound parameters (app side). */
export function forApp(text: string, params: AnalyticsParams): SQL {
  const parts: SQL[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1] as ParamName;
    const type = PARAM_TYPES[name];
    if (!type) throw new Error(`Unknown analytics parameter @@${name}@@`);
    parts.push(sql.raw(text.slice(last, m.index)));
    const value = params[name] ?? null;
    parts.push(sql`CAST(${value} AS ${sql.raw(type)})`);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(sql.raw(text.slice(last)));
  return sql.join(parts, sql.raw(""));
}

/** The query as the Claude dashboard stores it: `{{name}}` placeholders. */
export function forDashboard(text: string): string {
  return text
    .replace(TOKEN, (_, name: string) => {
      const type = PARAM_TYPES[name as ParamName];
      if (!type) throw new Error(`Unknown analytics parameter @@${name}@@`);
      return `CAST({{${name}}} AS ${type})`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Words the Claude dashboard refuses in a query, as whole tokens. */
export const DASHBOARD_FORBIDDEN = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE",
  "CALL", "EXEC", "EXECUTE", "COPY", "EXPORT", "LOAD", "INTO", "RETURNING", "DECLARE", "SET",
  "BEGIN", "COMMIT",
];

/**
 * Words from DASHBOARD_FORBIDDEN that appear in a query outside quotes,
 * reading every run of letters as a word (so `created_at` is "created" and
 * "at", never "create"). Empty means the dashboard will accept it.
 */
export function dashboardViolations(query: string): string[] {
  const bare = query
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " ");
  const words = new Set((bare.match(/[A-Za-z]+/g) ?? []).map((w) => w.toUpperCase()));
  return DASHBOARD_FORBIDDEN.filter((w) => words.has(w));
}

/* ------------------------------------------------------------- pricing -- */

/**
 * The monthly price of a plan with `seats` drivers, as SQL. Built from the
 * public price list (web/site/config.ts) so the two can't drift; a test
 * checks it against monthlyPrice() for every fleet size we quote.
 */
export function planPriceSql(seats: string): string {
  const q = `GREATEST(${seats}, 1)`;
  const bands = pricingBands
    .map((b) => {
      const top = b.to === Infinity ? q : `LEAST(${q}, ${b.to})`;
      return ` + GREATEST(0, ${top} - ${b.from - 1}) * ${b.rate}`;
    })
    .join("");
  void STARTER_DRIVERS; // Starter's included drivers are the gap before the first band.
  return `(${STARTER_PRICE}${bands})`;
}

/* ---------------------------------------------------------- industries -- */

/**
 * An industry id's display name, as SQL, built from the presets the app
 * labels industries with (services/industry-presets.ts), so the dashboard
 * and the Analytics tab name them the same way. Unknown ids show as is.
 */
export function industryLabelSql(col: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const ids = [...new Set(INDUSTRY_LABELS.map((x) => x.id))].filter((id) => id && id !== "other");
  const cases = ids.map((id) => `WHEN ${q(id)} THEN ${q(industryLabel(id) || id)}`).join(" ");
  return `(CASE COALESCE(${col}, '') WHEN '' THEN 'Not set' WHEN 'other' THEN 'Other' ${cases} ELSE ${col} END)`;
}

/* -------------------------------------------------------------- shared -- */

const local = (col: string) => `(${col} AT TIME ZONE '${TZ}')`;

/** The parameters, the date range, and the companies in scope. */
const PRELUDE = `prm AS (
  SELECT
    COALESCE(${P("start_day")}, (now() AT TIME ZONE '${TZ}')::date - 29) AS d0,
    COALESCE(${P("end_day")}, (now() AT TIME ZONE '${TZ}')::date) AS d1,
    COALESCE(${P("include_test")}, FALSE) AS inc,
    ${P("tenant")} AS tid,
    ${P("industry")} AS ind,
    ${P("billing")} AS bil,
    COALESCE(${P("grain")}, 'day') AS g
),
rng AS (
  SELECT d0, d1, inc, tid, ind, bil, g,
    (d0::timestamp AT TIME ZONE '${TZ}') AS t0,
    ((d1 + 1)::timestamp AT TIME ZONE '${TZ}') AS t1,
    ((d0 - (d1 - d0 + 1))::timestamp AT TIME ZONE '${TZ}') AS p0
  FROM prm
),
co AS (
  SELECT c.* FROM companies c, rng
  WHERE (rng.inc OR NOT c.is_internal OR c.id = rng.tid)
    AND (rng.tid IS NULL OR c.id = rng.tid)
    AND (rng.ind IS NULL OR c.industry = rng.ind)
    AND (rng.bil IS NULL OR c.billing_status = rng.bil)
)`;

/**
 * Jobs of the companies in scope. A completed job's time is when it finished.
 * Sample-day jobs (services/sample-day.ts) are pretend work and never count.
 */
const BK = `bk AS (
  SELECT b.id, b.company_id, b.status, b.priority, b.created_at, b.delay_flagged_at,
    CASE WHEN b.status = 'completed' THEN COALESCE(b.finished_at, b.scheduled_at, b.created_at) END AS done_at
  FROM bookings b JOIN co ON co.id = b.company_id
  WHERE b.deleted_at IS NULL AND NOT b.is_sample
)`;

/** People at those companies. Platform staff (superadmin) and deactivated people are left out. */
const MEM = `mem AS (
  SELECT m.user_id, m.company_id, m.role, m.status, m.created_at
  FROM memberships m JOIN co ON co.id = m.company_id
  WHERE m.role <> 'superadmin' AND m.deactivated_at IS NULL
)`;

/** Who used a signed-in session during the period (and the one before). */
const SEEN = `seen AS (
  SELECT s.user_id, MAX(s.updated_at) AS last_seen,
    BOOL_OR(s.created_at < rng.t1 AND s.updated_at >= rng.t0) AS now_active,
    BOOL_OR(s.created_at < rng.t0 AND s.updated_at >= rng.p0) AS prev_active
  FROM session s, rng
  WHERE s.updated_at >= LEAST(rng.p0, now() - interval '30 days')
  GROUP BY s.user_id
)`;

/** Approved technicians / drivers per company (sample-day technicians left out). */
const TECHS = `rd AS (
  SELECT r.company_id, COUNT(*)::int AS techs
  FROM riders r JOIN co ON co.id = r.company_id
  WHERE r.approval = 'active' AND NOT r.is_sample
  GROUP BY r.company_id
)`;

/** A text or email to a customer that went out. */
const CUSTOMER_UPDATE = `n.recipient = 'client' AND n.channel IN ('sms', 'email') AND n.status = 'sent'`;

/**
 * Company lifecycle, from company_history (one row per state a company has
 * been in, written by a trigger; see the schema). Deleted companies stay in
 * it, so churn by deletion still counts. The filters apply to each company's
 * latest state, as they do to `co`.
 *
 *   ch / hs   every state, with whether it is open (not closed or deleted) and
 *             paying (open and billing active or past due), and the same for
 *             the state before it
 *   sc        the companies in scope
 *   lc        per company: signed up, first trial, first time paid
 *   lost      trials that ended (cancelled, closed, deleted) before paying
 *   churn_ev  every move from paying to not paying
 */
const HIST = `ch AS (
  SELECT h.*,
    ROW_NUMBER() OVER (PARTITION BY h.company_id ORDER BY h.at DESC, h.seq DESC) AS rn_desc,
    (NOT h.removed AND h.status <> 'closed') AS open_now,
    (NOT h.removed AND h.status <> 'closed' AND h.billing_status IN ('active', 'past_due')) AS paying_now
  FROM company_history h
),
sc AS (
  SELECT ch.company_id FROM ch, rng
  WHERE ch.rn_desc = 1
    AND (rng.inc OR NOT ch.is_internal OR ch.company_id = rng.tid)
    AND (rng.tid IS NULL OR ch.company_id = rng.tid)
    AND (rng.ind IS NULL OR ch.industry = rng.ind)
    AND (rng.bil IS NULL OR ch.billing_status = rng.bil)
),
hs AS (
  SELECT ch.*,
    LAG(ch.open_now) OVER (PARTITION BY ch.company_id ORDER BY ch.at, ch.seq) AS open_before,
    LAG(ch.paying_now) OVER (PARTITION BY ch.company_id ORDER BY ch.at, ch.seq) AS paying_before
  FROM ch JOIN sc ON sc.company_id = ch.company_id
),
lc AS (
  SELECT hs.company_id,
    MIN(hs.at) AS signed_up_at,
    MIN(hs.at) FILTER (WHERE hs.open_now AND hs.billing_status = 'trialing') AS trial_at,
    MIN(hs.at) FILTER (WHERE hs.open_now AND hs.billing_status = 'active') AS paid_at
  FROM hs GROUP BY hs.company_id
),
lost AS (
  SELECT lc.company_id, MIN(hs.at) AS lost_at
  FROM lc JOIN hs ON hs.company_id = lc.company_id
  WHERE lc.trial_at IS NOT NULL AND hs.at > lc.trial_at AND (lc.paid_at IS NULL OR hs.at < lc.paid_at)
    AND (NOT hs.open_now OR hs.billing_status IN ('canceled', 'unpaid', 'none'))
  GROUP BY lc.company_id
),
churn_ev AS (
  SELECT hs.company_id, hs.at FROM hs WHERE hs.paying_before AND NOT hs.paying_now
)`;

/** The companies in scope that were paying just before `t` (a timestamptz expression), as a subquery of ids. */
const payingIds = (t: string) =>
  `(SELECT z.company_id FROM (SELECT DISTINCT ON (hs.company_id) hs.company_id, hs.paying_now FROM hs WHERE hs.at < ${t} ORDER BY hs.company_id, hs.at DESC, hs.seq DESC) z WHERE z.paying_now)`;

/** `col` falls in [from, to), plus an optional extra condition. */
const inRange = (from: string, to: string, col: string, extra = "") =>
  `${col} >= ${from} AND ${col} < ${to}${extra ? ` AND ${extra}` : ""}`;

/* ----------------------------------------------------------- headline -- */

// No SQL comments inside query text: some callers collapse whitespace, which
// would turn a `--` comment into the rest of the statement. The most active
// company (`top`) is ordered like the companies list: jobs, completed, name.

const HEADLINE_CTES = `${PRELUDE},
${BK},
${MEM},
${SEEN},
${TECHS},
pl AS (
  SELECT co.id, co.billing_status, GREATEST(co.billing_seats, COALESCE(rd.techs, 0), 1) AS q
  FROM co LEFT JOIN rd ON rd.company_id = co.id
  WHERE co.status <> 'closed'
),
jt AS (
  SELECT bk.company_id,
    COUNT(*) FILTER (WHERE bk.created_at >= rng.t0 AND bk.created_at < rng.t1)::int AS n,
    COUNT(*) FILTER (WHERE bk.done_at >= rng.t0 AND bk.done_at < rng.t1)::int AS d
  FROM bk, rng
  GROUP BY bk.company_id
  HAVING COUNT(*) FILTER (WHERE bk.created_at >= rng.t0 AND bk.created_at < rng.t1) > 0
),
top AS (
  SELECT co.id, co.name, jt.n FROM jt JOIN co ON co.id = jt.company_id
  ORDER BY jt.n DESC, jt.d DESC, co.name LIMIT 1
),
nd AS (
  SELECT n.channel, n.status, n.recipient, n.created_at
  FROM notification_deliveries n JOIN co ON co.id = n.company_id, rng
  WHERE n.created_at >= rng.p0 AND n.created_at < rng.t1
),
rv AS (
  SELECT r.rating FROM reviews r JOIN co ON co.id = r.company_id, rng
  WHERE r.created_at >= rng.t0 AND r.created_at < rng.t1
),
${HIST}`;

const lifecycleSql = (from: string, to: string) => ({
  trial_starts: `(SELECT COUNT(*)::int FROM lc WHERE ${inRange(from, to, "lc.trial_at")})`,
  conversions: `(SELECT COUNT(*)::int FROM lc WHERE ${inRange(from, to, "lc.paid_at", "lc.trial_at < lc.paid_at")})`,
  trials_lost: `(SELECT COUNT(*)::int FROM lost WHERE ${inRange(from, to, "lost.lost_at")})`,
  churned: `(SELECT COUNT(DISTINCT churn_ev.company_id)::int FROM churn_ev WHERE ${inRange(from, to, "churn_ev.at", `churn_ev.company_id IN ${payingIds(from)}`)})`,
  paying_start: `(SELECT COUNT(*)::int FROM ${payingIds(from)} pz)`,
});
const lifecycle = (from: string, to: string, suffix: string) =>
  Object.entries(lifecycleSql(from, to)).map(([k, v]) => `${v} AS ${k}${suffix}`).join(",\n  ");
/** The period's conversion and churn as shares (null when there is nothing to divide by). */
const lifecycleRates = () => {
  const x = lifecycleSql("rng.t0", "rng.t1");
  return `(${x.conversions}::float8 / NULLIF(${x.conversions} + ${x.trials_lost}, 0))::float8 AS conversion_rate,
  (${x.churned}::float8 / NULLIF(${x.paying_start}, 0))::float8 AS churn_rate`;
};

const HEADLINE_COLUMNS = `rng.d0::text AS start_day,
  rng.d1::text AS end_day,
  (rng.d1 - rng.d0 + 1)::int AS days,
  (SELECT COUNT(*)::int FROM co WHERE co.status <> 'closed') AS tenants,
  (SELECT COUNT(*)::int FROM co WHERE co.created_at >= rng.t0 AND co.created_at < rng.t1) AS tenants_new,
  (SELECT COUNT(*)::int FROM co WHERE co.created_at >= rng.p0 AND co.created_at < rng.t0) AS tenants_new_prev,
  (SELECT COUNT(*)::int FROM jt) AS tenants_active,
  (SELECT COUNT(DISTINCT bk.company_id)::int FROM bk WHERE bk.created_at >= rng.p0 AND bk.created_at < rng.t0) AS tenants_active_prev,
  (SELECT COUNT(*)::int FROM co WHERE co.status = 'closed' AND co.updated_at >= rng.t0 AND co.updated_at < rng.t1) AS tenants_closed,
  (SELECT COUNT(DISTINCT mem.user_id)::int FROM mem WHERE mem.role <> 'customer' AND mem.status = 'active') AS users,
  (SELECT COUNT(DISTINCT mem.user_id)::int FROM mem WHERE mem.role <> 'customer' AND mem.created_at >= rng.t0 AND mem.created_at < rng.t1) AS users_new,
  (SELECT COUNT(DISTINCT mem.user_id)::int FROM mem JOIN seen ON seen.user_id = mem.user_id WHERE mem.role <> 'customer' AND seen.now_active) AS users_active,
  (SELECT COUNT(DISTINCT mem.user_id)::int FROM mem JOIN seen ON seen.user_id = mem.user_id WHERE mem.role <> 'customer' AND seen.prev_active) AS users_active_prev,
  (SELECT COALESCE(SUM(rd.techs), 0)::int FROM rd) AS techs,
  (SELECT COUNT(DISTINCT mem.user_id)::int FROM mem WHERE mem.role = 'customer') AS customers,
  (SELECT COUNT(*)::int FROM mem WHERE mem.role = 'customer' AND mem.created_at >= rng.t0 AND mem.created_at < rng.t1) AS customers_new,
  (SELECT COUNT(*)::int FROM mem WHERE mem.role = 'customer' AND mem.created_at >= rng.p0 AND mem.created_at < rng.t0) AS customers_new_prev,
  (SELECT COUNT(*)::int FROM bk WHERE bk.created_at >= rng.t0 AND bk.created_at < rng.t1) AS jobs_created,
  (SELECT COUNT(*)::int FROM bk WHERE bk.created_at >= rng.p0 AND bk.created_at < rng.t0) AS jobs_created_prev,
  (SELECT COUNT(*)::int FROM bk WHERE bk.done_at >= rng.t0 AND bk.done_at < rng.t1) AS jobs_completed,
  (SELECT COUNT(*)::int FROM bk WHERE bk.done_at >= rng.p0 AND bk.done_at < rng.t0) AS jobs_completed_prev,
  (SELECT COUNT(*)::int FROM bk WHERE bk.done_at IS NOT NULL) AS jobs_completed_all,
  (SELECT COUNT(*)::int FROM bk WHERE bk.status = 'cancelled' AND bk.created_at >= rng.t0 AND bk.created_at < rng.t1) AS jobs_cancelled,
  (SELECT (1 - COUNT(*) FILTER (WHERE bk.delay_flagged_at IS NOT NULL)::float8 / NULLIF(COUNT(*), 0))::float8
     FROM bk WHERE bk.done_at >= rng.t0 AND bk.done_at < rng.t1) AS on_time_rate,
  (SELECT COUNT(*)::int FROM nd n WHERE n.created_at >= rng.t0 AND ${CUSTOMER_UPDATE}) AS customer_updates,
  (SELECT COUNT(*)::int FROM nd n WHERE n.created_at < rng.t0 AND ${CUSTOMER_UPDATE}) AS customer_updates_prev,
  (SELECT COUNT(*)::int FROM nd n WHERE n.created_at >= rng.t0 AND n.channel = 'sms' AND n.status = 'sent') AS sms_sent,
  (SELECT COUNT(*)::int FROM nd n WHERE n.created_at >= rng.t0 AND n.channel = 'email' AND n.status = 'sent') AS emails_sent,
  (SELECT (COUNT(*) FILTER (WHERE n.status = 'sent')::float8 / NULLIF(COUNT(*), 0))::float8
     FROM nd n WHERE n.created_at >= rng.t0 AND n.channel IN ('sms', 'email')) AS delivery_rate,
  (SELECT COALESCE(SUM(${planPriceSql("pl.q")}) FILTER (WHERE pl.billing_status IN ('active', 'past_due')), 0)::float8 FROM pl) AS mrr,
  (SELECT COALESCE(SUM(${planPriceSql("pl.q")}) FILTER (WHERE pl.billing_status = 'trialing'), 0)::float8 FROM pl) AS trial_mrr,
  (SELECT COUNT(*)::int FROM pl WHERE pl.billing_status IN ('active', 'past_due')) AS paying,
  (SELECT COUNT(*)::int FROM pl WHERE pl.billing_status = 'trialing') AS trialing,
  (SELECT COUNT(*)::int FROM pl WHERE pl.billing_status = 'past_due') AS past_due,
  (SELECT COUNT(*)::int FROM pl WHERE pl.billing_status IN ('canceled', 'unpaid')) AS canceled,
  (SELECT COUNT(*)::int FROM pl WHERE pl.billing_status NOT IN ('active', 'past_due', 'trialing', 'canceled', 'unpaid')) AS invoiced_manually,
  (SELECT COUNT(*)::int FROM co WHERE co.billing_status = 'trialing' AND co.billing_trial_ends_at >= now() AND co.billing_trial_ends_at < now() + interval '7 days') AS trials_ending_soon,
  (SELECT AVG(rv.rating)::float8 FROM rv) AS avg_rating,
  (SELECT COUNT(*)::int FROM rv) AS reviews,
  (SELECT top.id FROM top) AS top_tenant_id,
  (SELECT top.name FROM top) AS top_tenant_name,
  (SELECT top.n FROM top) AS top_tenant_jobs,
  (SELECT top.n::float8 / NULLIF((SELECT COUNT(*) FROM bk WHERE bk.created_at >= rng.t0 AND bk.created_at < rng.t1), 0) FROM top) AS top_tenant_share,
  ${lifecycle("rng.t0", "rng.t1", "")},
  ${lifecycle("rng.p0", "rng.t0", "_prev")},
  ${lifecycleRates()},
  (SELECT COALESCE(SUM(rd.techs), 0)::float8 FROM rd JOIN co ON co.id = rd.company_id WHERE co.status <> 'closed')
    / NULLIF((SELECT COUNT(*) FROM co WHERE co.status <> 'closed'), 0) AS techs_per_account,
  (SELECT COALESCE(SUM(rd.techs), 0)::float8 FROM rd JOIN pl ON pl.id = rd.company_id WHERE pl.billing_status IN ('active', 'past_due'))
    / NULLIF((SELECT COUNT(*) FROM pl WHERE pl.billing_status IN ('active', 'past_due')), 0) AS techs_per_paying`;

/** One row: every headline figure for the period, its previous period, and totals. */
export const HEADLINE = `WITH ${HEADLINE_CTES}
SELECT
  ${HEADLINE_COLUMNS}
FROM rng`;

/** The period-over-period figures, one row each, with their change. */
export const KPI_METRICS = [
  ["jobs_completed", "Jobs completed"],
  ["jobs_created", "Jobs created"],
  ["tenants_active", "Active companies"],
  ["users_active", "Active users"],
  ["customer_updates", "Customer updates sent"],
  ["tenants_new", "New companies"],
  ["customers_new", "New customers"],
  ["trial_starts", "Trial starts"],
  ["conversions", "Trials converted to paid"],
  ["churned", "Paying companies lost"],
] as const;

export const KPIS = `WITH ${HEADLINE_CTES},
h AS (
  SELECT
  ${HEADLINE_COLUMNS}
  FROM rng
)
SELECT k.metric, k.label, k.value, k.previous,
  CASE WHEN k.previous > 0 THEN ((k.value - k.previous) / k.previous)::float8 END AS change,
  CASE WHEN k.previous > 0 THEN (k.value / k.previous)::float8 END AS ratio
FROM h, LATERAL (VALUES
${KPI_METRICS.map(([m, label]) => `  ('${m}', '${label}', h.${m}::float8, h.${m}_prev::float8)`).join(",\n")}
) AS k(metric, label, value, previous)`;

/* ------------------------------------------------------------- series -- */

/** Activity per day, week or month across the period, with empty buckets as 0. */
export const SERIES = `WITH ${PRELUDE},
${BK},
${MEM},
buckets AS (
  SELECT generate_series(date_trunc(rng.g, rng.d0::timestamp), date_trunc(rng.g, rng.d1::timestamp), ('1 ' || rng.g)::interval) AS bucket
  FROM rng
),
created AS (
  SELECT date_trunc(rng.g, ${local("bk.created_at")}) AS bucket, COUNT(*)::int AS n
  FROM bk, rng WHERE bk.created_at >= rng.t0 AND bk.created_at < rng.t1 GROUP BY 1
),
done AS (
  SELECT date_trunc(rng.g, ${local("bk.done_at")}) AS bucket, COUNT(*)::int AS n
  FROM bk, rng WHERE bk.done_at >= rng.t0 AND bk.done_at < rng.t1 GROUP BY 1
),
signups AS (
  SELECT date_trunc(rng.g, ${local("co.created_at")}) AS bucket, COUNT(*)::int AS n
  FROM co, rng WHERE co.created_at >= rng.t0 AND co.created_at < rng.t1 GROUP BY 1
),
updates AS (
  SELECT date_trunc(rng.g, ${local("n.created_at")}) AS bucket, COUNT(*)::int AS n
  FROM notification_deliveries n JOIN co ON co.id = n.company_id, rng
  WHERE n.created_at >= rng.t0 AND n.created_at < rng.t1 AND ${CUSTOMER_UPDATE} GROUP BY 1
),
logins AS (
  SELECT date_trunc(rng.g, ${local("s.created_at")}) AS bucket, COUNT(*)::int AS n
  FROM session s, rng
  WHERE s.created_at >= rng.t0 AND s.created_at < rng.t1
    AND EXISTS (SELECT 1 FROM mem WHERE mem.user_id = s.user_id AND mem.role <> 'customer')
  GROUP BY 1
)
SELECT to_char(buckets.bucket, 'YYYY-MM-DD') AS bucket,
  COALESCE(created.n, 0) AS jobs_created,
  COALESCE(done.n, 0) AS jobs_completed,
  COALESCE(signups.n, 0) AS new_tenants,
  COALESCE(updates.n, 0) AS customer_updates,
  COALESCE(logins.n, 0) AS sign_ins
FROM buckets
LEFT JOIN created ON created.bucket = buckets.bucket
LEFT JOIN done ON done.bucket = buckets.bucket
LEFT JOIN signups ON signups.bucket = buckets.bucket
LEFT JOIN updates ON updates.bucket = buckets.bucket
LEFT JOIN logins ON logins.bucket = buckets.bucket
ORDER BY buckets.bucket`;

/* ------------------------------------------------------------ tenants -- */

/** One row per company: plan, people, activity in the period, and health. */
export const TENANTS = `WITH ${PRELUDE},
${BK},
${MEM},
${SEEN},
${TECHS},
jb AS (
  SELECT bk.company_id,
    COUNT(*) FILTER (WHERE bk.created_at >= rng.t0 AND bk.created_at < rng.t1)::int AS jobs,
    COUNT(*) FILTER (WHERE bk.done_at >= rng.t0 AND bk.done_at < rng.t1)::int AS completed,
    COUNT(*)::int AS jobs_all,
    MAX(bk.created_at) AS last_job
  FROM bk, rng GROUP BY bk.company_id
),
tm AS (
  SELECT mem.company_id,
    COUNT(*) FILTER (WHERE mem.role <> 'customer' AND mem.status = 'active')::int AS team,
    COUNT(*) FILTER (WHERE mem.role = 'customer')::int AS customers,
    COUNT(DISTINCT mem.user_id) FILTER (WHERE mem.role <> 'customer' AND seen.now_active)::int AS active_users,
    MAX(seen.last_seen) FILTER (WHERE mem.role <> 'customer') AS last_seen
  FROM mem LEFT JOIN seen ON seen.user_id = mem.user_id
  GROUP BY mem.company_id
),
up AS (
  SELECT n.company_id, COUNT(*)::int AS updates
  FROM notification_deliveries n JOIN co ON co.id = n.company_id, rng
  WHERE n.created_at >= rng.t0 AND n.created_at < rng.t1 AND ${CUSTOMER_UPDATE}
  GROUP BY n.company_id
),
lcy AS (
  SELECT z.company_id,
    MIN(z.at) FILTER (WHERE z.billing_status = 'trialing') AS trial_at,
    MIN(z.at) FILTER (WHERE z.billing_status = 'active') AS paid_at,
    MAX(z.at) FILTER (WHERE z.pb AND NOT z.p) AS churned_at
  FROM (
    SELECT h.company_id, h.at, h.billing_status,
      (h.status <> 'closed' AND NOT h.removed AND h.billing_status IN ('active', 'past_due')) AS p,
      LAG(h.status <> 'closed' AND NOT h.removed AND h.billing_status IN ('active', 'past_due'))
        OVER (PARTITION BY h.company_id ORDER BY h.at, h.seq) AS pb
    FROM company_history h JOIN co ON co.id = h.company_id
  ) z
  GROUP BY z.company_id
),
t AS (
  SELECT co.*, COALESCE(rd.techs, 0) AS techs_n,
    lcy.trial_at, lcy.paid_at, lcy.churned_at,
    GREATEST(co.billing_seats, COALESCE(rd.techs, 0), 1) AS q,
    GREATEST(jb.last_job, tm.last_seen) AS last_active_at,
    jb.jobs, jb.completed, jb.jobs_all, tm.team, tm.customers, tm.active_users, up.updates
  FROM co
  LEFT JOIN rd ON rd.company_id = co.id
  LEFT JOIN jb ON jb.company_id = co.id
  LEFT JOIN tm ON tm.company_id = co.id
  LEFT JOIN up ON up.company_id = co.id
  LEFT JOIN lcy ON lcy.company_id = co.id
)
SELECT t.id, t.name, t.industry, ${industryLabelSql("t.industry")} AS industry_label,
  t.status, t.billing_status, t.is_internal AS internal,
  to_char(${local("t.created_at")}, 'YYYY-MM-DD') AS created,
  to_char(${local("t.billing_trial_ends_at")}, 'YYYY-MM-DD') AS trial_ends,
  to_char(${local("t.trial_at")}, 'YYYY-MM-DD') AS trial_started,
  to_char(${local("t.paid_at")}, 'YYYY-MM-DD') AS paid_since,
  CASE WHEN t.status = 'closed' OR t.billing_status NOT IN ('active', 'past_due') THEN to_char(${local("t.churned_at")}, 'YYYY-MM-DD') END AS churned_on,
  (t.onboarding_completed_at IS NOT NULL) AS onboarded,
  t.q::int AS plan_seats,
  CASE WHEN t.billing_status IN ('active', 'past_due', 'trialing') THEN ${planPriceSql("t.q")} ELSE 0 END::float8 AS plan_value,
  COALESCE(t.team, 0) AS team,
  t.techs_n::int AS techs,
  COALESCE(t.customers, 0) AS customers,
  COALESCE(t.active_users, 0) AS active_users,
  COALESCE(t.jobs, 0) AS jobs,
  COALESCE(t.completed, 0) AS completed,
  COALESCE(t.jobs_all, 0) AS jobs_all,
  COALESCE(t.updates, 0) AS customer_updates,
  to_char(t.last_active_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_active,
  CASE
    WHEN t.status = 'closed' THEN 'closed'
    WHEN t.last_active_at >= now() - interval '7 days' THEN 'active'
    WHEN t.created_at >= now() - interval '14 days' THEN 'new'
    WHEN t.last_active_at >= now() - interval '30 days' THEN 'quiet'
    ELSE 'dormant'
  END AS health
FROM t
ORDER BY COALESCE(t.jobs, 0) DESC, COALESCE(t.completed, 0) DESC, t.name`;

/* ------------------------------------------------------------ records -- */

/** All-time bests, one row per record (filters apply, the date range doesn't). */
export const RECORDS = `WITH ${PRELUDE},
${BK},
day_all AS (
  SELECT ${local("bk.created_at")}::date AS day, COUNT(*)::int AS n
  FROM bk GROUP BY 1 ORDER BY n DESC, day LIMIT 1
),
day_co AS (
  SELECT bk.company_id, ${local("bk.created_at")}::date AS day, COUNT(*)::int AS n
  FROM bk GROUP BY 1, 2 ORDER BY n DESC, day LIMIT 1
),
day_done AS (
  SELECT ${local("bk.done_at")}::date AS day, COUNT(*)::int AS n
  FROM bk WHERE bk.done_at IS NOT NULL GROUP BY 1 ORDER BY n DESC, day LIMIT 1
),
wk AS (
  SELECT date_trunc('week', ${local("bk.created_at")})::date AS day, COUNT(*)::int AS n
  FROM bk GROUP BY 1 ORDER BY n DESC, day LIMIT 1
),
upd AS (
  SELECT ${local("n.created_at")}::date AS day, COUNT(*)::int AS n
  FROM notification_deliveries n JOIN co ON co.id = n.company_id
  WHERE ${CUSTOMER_UPDATE}
  GROUP BY 1 ORDER BY n DESC, day LIMIT 1
),
team AS (
  SELECT r.company_id, COUNT(*)::int AS n
  FROM riders r JOIN co ON co.id = r.company_id
  WHERE r.approval = 'active' AND NOT r.is_sample
  GROUP BY r.company_id ORDER BY n DESC, r.company_id LIMIT 1
),
fast AS (
  SELECT co.id AS company_id, EXTRACT(EPOCH FROM (MIN(bk.created_at) - co.created_at)) / 3600.0 AS n
  FROM co JOIN bk ON bk.company_id = co.id
  GROUP BY co.id, co.created_at
  HAVING MIN(bk.created_at) >= co.created_at
  ORDER BY n, co.id LIMIT 1
)
SELECT 'jobs_in_a_day' AS record, 'Most jobs created in a day' AS label, day_all.n::float8 AS value, day_all.day::text AS day, NULL::text AS tenant FROM day_all
UNION ALL
SELECT 'company_jobs_in_a_day', 'Most jobs one company created in a day', day_co.n::float8, day_co.day::text, co.name FROM day_co JOIN co ON co.id = day_co.company_id
UNION ALL
SELECT 'completed_in_a_day', 'Most jobs completed in a day', day_done.n::float8, day_done.day::text, NULL FROM day_done
UNION ALL
SELECT 'busiest_week', 'Busiest week', wk.n::float8, wk.day::text, NULL FROM wk
UNION ALL
SELECT 'updates_in_a_day', 'Most customer updates in a day', upd.n::float8, upd.day::text, NULL FROM upd
UNION ALL
SELECT 'largest_field_team', 'Largest field team', team.n::float8, NULL, co.name FROM team JOIN co ON co.id = team.company_id
UNION ALL
SELECT 'fastest_first_job', 'Fastest signup to first job (hours)', ROUND(fast.n::numeric, 1)::float8, NULL, co.name FROM fast JOIN co ON co.id = fast.company_id`;

/* ------------------------------------------------------------- funnel -- */

const FUNNEL_CTES = `${PRELUDE},
${BK},
${TECHS},
f AS (
  SELECT co.id, co.created_at, co.onboarding_completed_at, co.billing_status,
    COALESCE(rd.techs, 0) AS techs,
    (SELECT MIN(bk.created_at) FROM bk WHERE bk.company_id = co.id) AS first_job,
    (SELECT MIN(bk.done_at) FROM bk WHERE bk.company_id = co.id) AS first_done
  FROM co LEFT JOIN rd ON rd.company_id = co.id
  WHERE co.status <> 'closed'
),
fs AS (
  SELECT
    COUNT(*)::int AS signed_up,
    COUNT(*) FILTER (WHERE f.onboarding_completed_at IS NOT NULL)::int AS onboarded,
    COUNT(*) FILTER (WHERE f.techs > 0)::int AS added_team,
    COUNT(*) FILTER (WHERE f.first_job IS NOT NULL)::int AS first_job,
    COUNT(*) FILTER (WHERE f.first_done IS NOT NULL)::int AS first_completed,
    COUNT(*) FILTER (WHERE f.billing_status IN ('active', 'past_due'))::int AS paying,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f.first_job - f.created_at)) / 86400.0)
       FILTER (WHERE f.first_job >= f.created_at))::float8 AS median_days_to_first_job
  FROM f
)`;

/** How far every company in scope has got (all time), as one row. */
export const FUNNEL = `WITH ${FUNNEL_CTES}
SELECT fs.* FROM fs`;

/**
 * The same milestones one row each, for the dashboard: how many companies
 * reached it and their share of every company that signed up. The steps
 * aren't strictly in order (a company can create a job before adding a
 * technician), so each share is of signups, not of the step before.
 */
export const FUNNEL_STEPS = `WITH ${FUNNEL_CTES}
SELECT k.step, k.label, k.companies,
  (k.companies::float8 / NULLIF(fs.signed_up, 0))::float8 AS share,
  CASE WHEN k.step = 'first_job' THEN fs.median_days_to_first_job END AS median_days
FROM fs, LATERAL (VALUES
  (1, 'signed_up', 'Signed up', fs.signed_up),
  (2, 'onboarded', 'Finished setup', fs.onboarded),
  (3, 'added_team', 'Added a technician', fs.added_team),
  (4, 'first_job', 'Created a job', fs.first_job),
  (5, 'first_completed', 'Completed a job', fs.first_completed),
  (6, 'paying', 'Paying', fs.paying)
) AS k(pos, step, label, companies)
ORDER BY k.pos`;

/* ------------------------------------------------------------- weekly -- */

/**
 * The SaaS figures week by week (Monday to Sunday, America/Winnipeg), for
 * every week the range touches, whatever the chart grain. Figures "at week
 * end" are the state just before the next Monday (now, for this week).
 *
 *   tenants            open companies at week end; new_tenants signed up in the
 *                      week; accounts_closed closed or deleted in it
 *   trial_starts       companies whose first trial began in the week
 *   conversions        trials that turned into a paid plan in the week
 *   trials_lost        trials that ended in the week without paying
 *   conversion_rate    conversions / (conversions + trials_lost)
 *   cohort_rate        of the week's trial starts, the share paying since
 *   churned            of the companies paying when the week began, those
 *                      that stopped paying (cancelled, closed or deleted) in
 *                      it; churn_rate divides it by them, so it never passes
 *                      100%. A company that starts and stops within one week
 *                      isn't counted.
 *   techs              technicians on open companies at week end, with the
 *                      average per company, per paying company, and the median
 *   mrr                monthly plan value of the paying companies at week end
 */
export const WEEKLY = `WITH ${PRELUDE},
${HIST},
wk AS (
  SELECT w::date AS week,
    (w AT TIME ZONE '${TZ}') AS ws,
    ((w + interval '7 days') AT TIME ZONE '${TZ}') AS we
  FROM rng, generate_series(date_trunc('week', rng.d0::timestamp), date_trunc('week', rng.d1::timestamp), interval '1 week') AS w
),
edge AS (
  SELECT wk.week, e.k, e.t FROM wk, LATERAL (VALUES ('start', wk.ws), ('end', wk.we)) AS e(k, t)
),
st AS (
  SELECT DISTINCT ON (edge.week, edge.k, hs.company_id)
    edge.week, edge.k, hs.company_id, hs.open_now, hs.paying_now, hs.billing_status, hs.billing_seats
  FROM edge JOIN hs ON hs.at < edge.t
  ORDER BY edge.week, edge.k, hs.company_id, hs.at DESC, hs.seq DESC
),
ts AS (
  SELECT DISTINCT ON (wk.week, th.rider_id, th.company_id) wk.week, th.company_id, th.active
  FROM wk JOIN technician_history th ON th.at < wk.we JOIN sc ON sc.company_id = th.company_id
  ORDER BY wk.week, th.rider_id, th.company_id, th.at DESC, th.seq DESC
),
tc AS (
  SELECT ts.week, ts.company_id, COUNT(*) FILTER (WHERE ts.active)::int AS techs
  FROM ts GROUP BY ts.week, ts.company_id
),
pe AS (
  SELECT st.week, st.open_now, st.paying_now, st.billing_status,
    COALESCE(tc.techs, 0) AS techs, GREATEST(st.billing_seats, COALESCE(tc.techs, 0), 1) AS q
  FROM st LEFT JOIN tc ON tc.week = st.week AND tc.company_id = st.company_id
  WHERE st.k = 'end'
),
ea AS (
  SELECT pe.week,
    COUNT(*) FILTER (WHERE pe.open_now)::int AS tenants,
    COUNT(*) FILTER (WHERE pe.open_now AND pe.billing_status = 'trialing')::int AS trialing,
    COUNT(*) FILTER (WHERE pe.paying_now)::int AS paying,
    COALESCE(SUM(${planPriceSql("pe.q")}) FILTER (WHERE pe.paying_now), 0)::float8 AS mrr,
    COALESCE(SUM(pe.techs) FILTER (WHERE pe.open_now), 0)::int AS techs,
    COUNT(*) FILTER (WHERE pe.open_now AND pe.techs > 0)::int AS accounts_with_techs,
    COALESCE(SUM(pe.techs) FILTER (WHERE pe.paying_now), 0)::int AS paying_techs,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY pe.techs) FILTER (WHERE pe.open_now))::float8 AS median_techs
  FROM pe GROUP BY pe.week
),
sa AS (
  SELECT st.week, COUNT(*) FILTER (WHERE st.paying_now)::int AS paying_start
  FROM st WHERE st.k = 'start' GROUP BY st.week
),
ev AS (
  SELECT wk.week,
    (SELECT COUNT(*) FROM lc WHERE ${inRange("wk.ws", "wk.we", "lc.signed_up_at")})::int AS new_tenants,
    (SELECT COUNT(DISTINCT hs.company_id) FROM hs WHERE ${inRange("wk.ws", "wk.we", "hs.at", "hs.open_before AND NOT hs.open_now")})::int AS accounts_closed,
    (SELECT COUNT(*) FROM lc WHERE ${inRange("wk.ws", "wk.we", "lc.trial_at")})::int AS trial_starts,
    (SELECT COUNT(*) FROM lc WHERE ${inRange("wk.ws", "wk.we", "lc.paid_at", "lc.trial_at < lc.paid_at")})::int AS conversions,
    (SELECT COUNT(*) FROM lost WHERE ${inRange("wk.ws", "wk.we", "lost.lost_at")})::int AS trials_lost,
    (SELECT COUNT(*) FROM lc WHERE ${inRange("wk.ws", "wk.we", "lc.trial_at", "lc.paid_at > lc.trial_at")})::int AS cohort_converted,
    (SELECT COUNT(DISTINCT churn_ev.company_id) FROM churn_ev JOIN st ON st.company_id = churn_ev.company_id AND st.week = wk.week AND st.k = 'start' AND st.paying_now
      WHERE ${inRange("wk.ws", "wk.we", "churn_ev.at")})::int AS churned
  FROM wk
)
SELECT to_char(wk.week, 'YYYY-MM-DD') AS week,
  to_char(wk.week + 6, 'YYYY-MM-DD') AS week_end,
  (now() < wk.we) AS in_progress,
  COALESCE(ea.tenants, 0) AS tenants,
  ev.new_tenants,
  ev.accounts_closed,
  COALESCE(ea.trialing, 0) AS trialing,
  ev.trial_starts,
  ev.conversions,
  ev.trials_lost,
  (ev.conversions::float8 / NULLIF(ev.conversions + ev.trials_lost, 0))::float8 AS conversion_rate,
  ev.cohort_converted,
  (ev.cohort_converted::float8 / NULLIF(ev.trial_starts, 0))::float8 AS cohort_rate,
  COALESCE(sa.paying_start, 0) AS paying_start,
  COALESCE(ea.paying, 0) AS paying,
  ev.churned,
  (ev.churned::float8 / NULLIF(sa.paying_start, 0))::float8 AS churn_rate,
  COALESCE(ea.mrr, 0)::float8 AS mrr,
  COALESCE(ea.techs, 0) AS techs,
  COALESCE(ea.accounts_with_techs, 0) AS accounts_with_techs,
  (ea.techs::float8 / NULLIF(ea.tenants, 0))::float8 AS techs_per_account,
  (ea.paying_techs::float8 / NULLIF(ea.paying, 0))::float8 AS techs_per_paying,
  ea.median_techs
FROM wk
JOIN ev ON ev.week = wk.week
LEFT JOIN ea ON ea.week = wk.week
LEFT JOIN sa ON sa.week = wk.week
ORDER BY wk.week`;

/** The industries companies have chosen, for the dashboard's industry filter. */
export const INDUSTRIES = `SELECT COALESCE(c.industry, '') AS industry, ${industryLabelSql("c.industry")} AS label, COUNT(*)::int AS companies
FROM companies c
WHERE (COALESCE(${P("include_test")}, FALSE) OR NOT c.is_internal) AND c.status <> 'closed'
GROUP BY 1, 2
ORDER BY 2`;

/* ----------------------------------------------------------- explorer -- */

export type Dimension =
  | "time" | "tenant" | "industry" | "billing"
  | "status" | "priority" | "channel" | "recipient" | "role" | "rating" | "kind" | "currency";

export const DIMENSION_LABELS: Record<Dimension, string> = {
  time: "Over time",
  tenant: "Company",
  industry: "Industry",
  billing: "Billing status",
  status: "Job status",
  priority: "Priority",
  channel: "Channel",
  recipient: "Recipient",
  role: "Role",
  rating: "Stars",
  kind: "Activity",
  currency: "Currency",
};

export interface MetricDef {
  id: string;
  label: string;
  group: "Jobs" | "Customers" | "Team" | "Companies" | "Activity" | "Payments";
  description: string;
  /** Rows the metric counts: FROM ... JOIN co ON co.id = <alias>.company_id */
  from: string;
  /** When each row happened (timestamptz). */
  at: string;
  where?: string;
  value: string;
  format: "count" | "decimal" | "money";
  /** Breakdowns besides time, tenant, industry and billing. */
  extra?: Partial<Record<Dimension, string>>;
  /** Only these breakdowns (money is summed per currency, so never across). */
  only?: Dimension[];
}

const JOBS_FROM = `bookings x JOIN co ON co.id = x.company_id`;

/**
 * The companies in scope as they last were in company_history, in the shape
 * of `co` (id, name, industry, billing_status), deleted ones included: the
 * lifecycle metrics join this so a company deleted after it churned still
 * counts, as it does in WEEKLY.
 */
const HCO = `(SELECT l.company_id AS id, l.name, l.industry, l.billing_status
  FROM (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.company_id ORDER BY h.at DESC, h.seq DESC) AS rn FROM company_history h) l, rng
  WHERE l.rn = 1
    AND (rng.inc OR NOT l.is_internal OR l.company_id = rng.tid)
    AND (rng.tid IS NULL OR l.company_id = rng.tid)
    AND (rng.ind IS NULL OR l.industry = rng.ind)
    AND (rng.bil IS NULL OR l.billing_status = rng.bil)) co`;
/** A job that counts: not deleted, not sample-day pretend work. */
const REAL_JOB = "x.deleted_at IS NULL AND NOT x.is_sample";

export const METRICS: MetricDef[] = [
  {
    id: "jobs_created", label: "Jobs created", group: "Jobs",
    description: "Jobs added, by when they were created.",
    from: JOBS_FROM, at: "x.created_at", where: REAL_JOB, value: "COUNT(*)", format: "count",
    extra: { status: "x.status", priority: "x.priority" },
  },
  {
    id: "jobs_completed", label: "Jobs completed", group: "Jobs",
    description: "Jobs finished, by when they finished.",
    from: JOBS_FROM, at: "COALESCE(x.finished_at, x.scheduled_at, x.created_at)",
    where: `${REAL_JOB} AND x.status = 'completed'`, value: "COUNT(*)", format: "count",
    extra: { priority: "x.priority" },
  },
  {
    id: "jobs_cancelled", label: "Jobs cancelled", group: "Jobs",
    description: "Cancelled jobs, by when they were created.",
    from: JOBS_FROM, at: "x.created_at", where: `${REAL_JOB} AND x.status = 'cancelled'`, value: "COUNT(*)", format: "count",
  },
  {
    id: "late_arrivals", label: "Running-late alerts", group: "Jobs",
    description: "Jobs flagged as running late, by when the flag went up.",
    from: JOBS_FROM, at: "x.delay_flagged_at", where: `${REAL_JOB} AND x.delay_flagged_at IS NOT NULL`, value: "COUNT(*)", format: "count",
  },
  {
    id: "customer_updates", label: "Customer updates sent", group: "Customers",
    description: "Texts and emails that reached a customer.",
    from: "notification_deliveries x JOIN co ON co.id = x.company_id", at: "x.created_at",
    where: "x.recipient = 'client' AND x.channel IN ('sms', 'email') AND x.status = 'sent'", value: "COUNT(*)", format: "count",
    extra: { channel: "x.channel" },
  },
  {
    id: "notifications", label: "All notifications", group: "Customers",
    description: "Every text, email and in-app notice, to anyone, sent or failed.",
    from: "notification_deliveries x JOIN co ON co.id = x.company_id", at: "x.created_at", value: "COUNT(*)", format: "count",
    extra: { channel: "x.channel", recipient: "x.recipient", status: "x.status" },
  },
  {
    id: "new_customers", label: "New customers", group: "Customers",
    description: "Customers added to a company.",
    from: "memberships x JOIN co ON co.id = x.company_id", at: "x.created_at",
    where: "x.role = 'customer'", value: "COUNT(*)", format: "count",
  },
  {
    id: "messages", label: "Messages", group: "Customers",
    description: "Messages between the office, technicians and customers.",
    from: "messages x JOIN co ON co.id = x.company_id", at: "x.created_at", value: "COUNT(*)", format: "count",
    extra: { channel: "x.channel" },
  },
  {
    id: "reviews", label: "Reviews", group: "Customers",
    description: "Ratings customers left after a job.",
    from: "reviews x JOIN co ON co.id = x.company_id", at: "x.created_at", value: "COUNT(*)", format: "count",
    extra: { rating: "x.rating::text" },
  },
  {
    id: "avg_rating", label: "Average rating", group: "Customers",
    description: "Average stars across reviews.",
    from: "reviews x JOIN co ON co.id = x.company_id", at: "x.created_at", value: "AVG(x.rating)", format: "decimal",
  },
  {
    id: "new_team_members", label: "New team members", group: "Team",
    description: "Office staff and technicians added (platform staff not counted).",
    from: "memberships x JOIN co ON co.id = x.company_id", at: "x.created_at",
    where: "x.role NOT IN ('customer', 'superadmin')", value: "COUNT(*)", format: "count",
    extra: { role: "x.role" },
  },
  {
    id: "sign_ins", label: "Sign-ins", group: "Team",
    description: "Sign-ins by office staff and technicians, by their home company.",
    from: `session s JOIN "user" u ON u.id = s.user_id JOIN co ON co.id = u.company_id`, at: "s.created_at",
    where: "COALESCE(u.role, '') NOT IN ('customer', 'superadmin')", value: "COUNT(*)", format: "count",
  },
  {
    id: "new_tenants", label: "New companies", group: "Companies",
    description: "Companies that signed up or were set up.",
    from: "companies x JOIN co ON co.id = x.id", at: "x.created_at", value: "COUNT(*)", format: "count",
    only: ["time", "industry", "billing"],
  },
  {
    id: "trial_starts", label: "Trial starts", group: "Companies",
    description: "Companies that began a free trial, by when it began.",
    from: `(SELECT h.company_id, MIN(h.at) AS at FROM company_history h WHERE h.billing_status = 'trialing' AND NOT h.removed AND h.status <> 'closed' GROUP BY h.company_id) x JOIN ${HCO} ON co.id = x.company_id`,
    at: "x.at", value: "COUNT(*)", format: "count",
  },
  {
    id: "trial_conversions", label: "Trials converted to paid", group: "Companies",
    description: "Companies that went from a trial to a paid plan, by when they first paid.",
    from: `(SELECT h.company_id, MIN(h.at) FILTER (WHERE h.billing_status = 'active') AS at, MIN(h.at) FILTER (WHERE h.billing_status = 'trialing') AS trial_at FROM company_history h WHERE NOT h.removed AND h.status <> 'closed' GROUP BY h.company_id) x JOIN ${HCO} ON co.id = x.company_id`,
    at: "x.at", where: "x.trial_at < x.at", value: "COUNT(*)", format: "count",
  },
  {
    id: "paying_churn", label: "Paying companies lost", group: "Companies",
    description: "Each time a paying company stopped paying (cancelled, closed or deleted), by when it happened.",
    from: `(SELECT z.company_id, z.at FROM (SELECT h.company_id, h.at, (h.status <> 'closed' AND NOT h.removed AND h.billing_status IN ('active', 'past_due')) AS p, LAG(h.status <> 'closed' AND NOT h.removed AND h.billing_status IN ('active', 'past_due')) OVER (PARTITION BY h.company_id ORDER BY h.at, h.seq) AS pb FROM company_history h) z WHERE z.pb AND NOT z.p) x JOIN ${HCO} ON co.id = x.company_id`,
    at: "x.at", value: "COUNT(*)", format: "count",
  },
  {
    id: "techs_added", label: "Technicians added", group: "Team",
    description: "Technicians who joined a company's field team (approved, not sample-day).",
    from: "technician_history x JOIN co ON co.id = x.company_id", at: "x.at",
    where: "x.active", value: "COUNT(*)", format: "count",
  },
  {
    id: "job_activity", label: "Job activity", group: "Activity",
    description: "Everything logged on jobs: assigned, on the way, photos, signatures and more.",
    from: "job_events x JOIN co ON co.id = x.company_id", at: "x.created_at", value: "COUNT(*)", format: "count",
    extra: { kind: "x.kind" },
  },
  {
    id: "tracking_pings", label: "Live location updates", group: "Activity",
    description: "Technician positions recorded while a customer can watch them arrive.",
    from: "tracking_pings x JOIN co ON co.id = x.company_id", at: "x.created_at", value: "COUNT(*)", format: "count",
  },
  {
    id: "invoices_paid", label: "Invoices paid", group: "Payments",
    description: "Invoices paid through ArrivePing, by when they were paid.",
    from: "invoices x JOIN co ON co.id = x.company_id", at: "COALESCE(x.paid_at, x.created_at)",
    where: "x.status = 'paid'", value: "COUNT(*)", format: "count",
    extra: { currency: "UPPER(x.currency)" },
  },
  {
    id: "payments_collected", label: "Payments collected", group: "Payments",
    description: "Money collected through ArrivePing, totalled in each currency.",
    from: "invoices x JOIN co ON co.id = x.company_id", at: "COALESCE(x.paid_at, x.created_at)",
    where: "x.status = 'paid'", value: "SUM(x.total - COALESCE(x.amount_refunded, 0))", format: "money",
    extra: { currency: "UPPER(x.currency)" },
    only: ["currency"],
  },
];

const BASE_DIMS: Partial<Record<Dimension, { key: string; label: string }>> = {
  tenant: { key: "co.id", label: "co.name" },
  industry: { key: "co.industry", label: "co.industry" },
  billing: { key: "co.billing_status", label: "co.billing_status" },
};

/** The breakdowns a metric supports, in display order. */
export function metricDimensions(m: MetricDef): Dimension[] {
  const all: Dimension[] = ["time", "tenant", "industry", "billing", ...(Object.keys(m.extra ?? {}) as Dimension[])];
  return m.only ? all.filter((d) => m.only!.includes(d)) : all;
}

/**
 * One metric broken down by one dimension. Rows are `{key, label, value}`;
 * over time, every bucket in the range is present (0 when empty).
 * Throws on an unknown metric or a breakdown the metric doesn't support,
 * so nothing a caller sends reaches the SQL text.
 */
export function exploreQuery(metricId: string, by: Dimension): string {
  const m = METRICS.find((x) => x.id === metricId);
  if (!m) throw new Error(`Unknown metric "${metricId}"`);
  if (!metricDimensions(m).includes(by)) throw new Error(`"${m.label}" can't be broken down by ${by}`);
  const where = [`${m.at} >= rng.t0`, `${m.at} < rng.t1`, m.where].filter(Boolean).join(" AND ");
  if (by === "time") {
    return `WITH ${PRELUDE},
buckets AS (
  SELECT generate_series(date_trunc(rng.g, rng.d0::timestamp), date_trunc(rng.g, rng.d1::timestamp), ('1 ' || rng.g)::interval) AS bucket
  FROM rng
),
v AS (
  SELECT date_trunc(rng.g, (${m.at}) AT TIME ZONE '${TZ}') AS bucket, ${m.value} AS value
  FROM ${m.from}, rng
  WHERE ${where}
  GROUP BY 1
)
SELECT to_char(buckets.bucket, 'YYYY-MM-DD') AS key, to_char(buckets.bucket, 'YYYY-MM-DD') AS label,
  COALESCE(v.value, 0)::float8 AS value
FROM buckets LEFT JOIN v ON v.bucket = buckets.bucket
ORDER BY buckets.bucket`;
  }
  const dim = BASE_DIMS[by] ?? (m.extra?.[by] ? { key: m.extra[by]!, label: m.extra[by]! } : null);
  if (!dim) throw new Error(`"${m.label}" can't be broken down by ${by}`);
  return `WITH ${PRELUDE}
SELECT COALESCE((${dim.key})::text, 'none') AS key, COALESCE((${dim.label})::text, 'none') AS label, (${m.value})::float8 AS value
FROM ${m.from}, rng
WHERE ${where}
GROUP BY 1, 2
ORDER BY 3 DESC, 2
LIMIT 500`;
}

/** Earliest day with any data, for the "All time" range. */
export const FIRST_DAY = `SELECT to_char(LEAST(
    (SELECT MIN(c.created_at) FROM companies c),
    (SELECT MIN(b.created_at) FROM bookings b)
  ) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS first_day`;

/** Every query the Claude dashboard runs, by dataset id (see ./dashboard.ts). */
export const DASHBOARD_QUERIES = {
  headline: HEADLINE,
  kpis: KPIS,
  series: SERIES,
  tenants: TENANTS,
  records: RECORDS,
  funnel_steps: FUNNEL_STEPS,
  industries: INDUSTRIES,
  first_day: FIRST_DAY,
  weekly: WEEKLY,
} as const;
