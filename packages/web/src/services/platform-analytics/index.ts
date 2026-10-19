/**
 * Platform analytics for superadmins: runs the shared queries in ./sql.ts
 * (the same ones the Claude "ArrivePing Analytics" dashboard runs) and
 * shapes them for the Analytics tab.
 *
 * These are cross-tenant reads, so they go through `sdb`, the system
 * connection. Every route that reaches this module is superadmin-only
 * (api/routes/platform-analytics.ts), and nothing here writes except
 * `setInternal`, which flips one company's test-tenant flag.
 *
 * Results are cached for 20 s per distinct filter set: the tab refreshes
 * itself every minute, and several superadmins looking at the same range
 * shouldn't each re-run the aggregates.
 */
import { kindForInternalFlag, setTenantKind } from "../tenant-kind";
import { eq, ne } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { INDUSTRY_LABELS, industryLabel } from "../industry-presets";
import {
  DIMENSION_LABELS,
  FIRST_DAY,
  FUNNEL,
  HEADLINE,
  KPI_METRICS,
  METRICS,
  RECORDS,
  SERIES,
  TENANTS,
  WEEKLY,
  exploreQuery,
  forApp,
  metricDimensions,
  type AnalyticsParams,
  type Dimension,
} from "./sql";

export type { AnalyticsParams, Dimension, Grain } from "./sql";

/* -------------------------------------------------------------- types -- */

export interface Headline {
  start_day: string;
  end_day: string;
  days: number;
  tenants: number;
  tenants_new: number;
  tenants_new_prev: number;
  tenants_active: number;
  tenants_active_prev: number;
  tenants_closed: number;
  users: number;
  users_new: number;
  users_active: number;
  users_active_prev: number;
  techs: number;
  customers: number;
  customers_new: number;
  customers_new_prev: number;
  jobs_created: number;
  jobs_created_prev: number;
  jobs_completed: number;
  jobs_completed_prev: number;
  jobs_completed_all: number;
  jobs_cancelled: number;
  on_time_rate: number | null;
  customer_updates: number;
  customer_updates_prev: number;
  sms_sent: number;
  emails_sent: number;
  delivery_rate: number | null;
  mrr: number;
  trial_mrr: number;
  paying: number;
  trialing: number;
  past_due: number;
  canceled: number;
  invoiced_manually: number;
  trials_ending_soon: number;
  avg_rating: number | null;
  reviews: number;
  top_tenant_id: string | null;
  top_tenant_name: string | null;
  top_tenant_jobs: number | null;
  top_tenant_share: number | null;
  /** Companies whose first trial began in the period (and the period before). */
  trial_starts: number;
  trial_starts_prev: number;
  /** Trials that turned into a paid plan in the period. */
  conversions: number;
  conversions_prev: number;
  /** Trials that ended in the period without paying. */
  trials_lost: number;
  trials_lost_prev: number;
  /** Paying companies that stopped paying in the period (cancelled, closed or deleted). */
  churned: number;
  churned_prev: number;
  /** Companies paying when the period began (the churn rate's base). */
  paying_start: number;
  paying_start_prev: number;
  /** conversions / (conversions + trials_lost), and churned / paying_start; null with nothing to divide. */
  conversion_rate: number | null;
  churn_rate: number | null;
  /** Approved technicians per open company, and per paying company, today. */
  techs_per_account: number | null;
  techs_per_paying: number | null;
}

/** One week (Monday to Sunday, America/Winnipeg) of the SaaS figures; see WEEKLY in ./sql.ts. */
export interface WeeklyRow {
  week: string;
  week_end: string;
  /** This week: figures so far. */
  in_progress: boolean;
  tenants: number;
  new_tenants: number;
  accounts_closed: number;
  trialing: number;
  trial_starts: number;
  conversions: number;
  trials_lost: number;
  conversion_rate: number | null;
  cohort_converted: number;
  cohort_rate: number | null;
  paying_start: number;
  paying: number;
  churned: number;
  churn_rate: number | null;
  mrr: number;
  techs: number;
  accounts_with_techs: number;
  techs_per_account: number | null;
  techs_per_paying: number | null;
  median_techs: number | null;
}

export interface Kpi {
  metric: string;
  label: string;
  value: number;
  previous: number;
  /** (value - previous) / previous; null when there was nothing before. */
  change: number | null;
  /** value / previous, for changes too big to read as a percentage; null when there was nothing before. */
  ratio: number | null;
}

export interface SeriesPoint {
  bucket: string;
  jobs_created: number;
  jobs_completed: number;
  new_tenants: number;
  customer_updates: number;
  sign_ins: number;
}

export type Health = "active" | "new" | "quiet" | "dormant" | "closed";

export interface TenantRow {
  id: string;
  name: string;
  industry: string;
  industry_label: string;
  status: string;
  billing_status: string;
  internal: boolean;
  created: string;
  trial_ends: string | null;
  /** First day on a trial, first day paying, and (when not paying now) the last day it stopped. */
  trial_started: string | null;
  paid_since: string | null;
  churned_on: string | null;
  onboarded: boolean;
  plan_seats: number;
  plan_value: number;
  team: number;
  techs: number;
  customers: number;
  active_users: number;
  jobs: number;
  completed: number;
  jobs_all: number;
  customer_updates: number;
  last_active: string | null;
  health: Health;
}

export interface RecordRow {
  record: string;
  label: string;
  value: number;
  day: string | null;
  tenant: string | null;
}

export interface Funnel {
  signed_up: number;
  onboarded: number;
  added_team: number;
  first_job: number;
  first_completed: number;
  paying: number;
  median_days_to_first_job: number | null;
}

export interface ExploreRow {
  key: string;
  label: string;
  value: number;
}

/* ------------------------------------------------------------- runner -- */

async function run<T>(text: string, params: AnalyticsParams): Promise<T[]> {
  const res = (await sdb.execute(forApp(text, params))) as unknown;
  const list = Array.isArray(res) ? res : ((res as { rows?: unknown[] })?.rows ?? []);
  // postgres.js hands back a RowList (an Array subclass); plain objects travel better.
  return list.map((r) => ({ ...(r as object) })) as T[];
}

const TTL_MS = 20_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = fn().catch((e) => {
    cache.delete(key); // never cache a failure
    throw e;
  });
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function _clearAnalyticsCache(): void {
  cache.clear();
}

const keyOf = (name: string, p: AnalyticsParams, extra = "") =>
  `${name}|${extra}|${p.start_day ?? ""}|${p.end_day ?? ""}|${p.include_test ? 1 : 0}|${p.tenant ?? ""}|${p.industry ?? ""}|${p.billing ?? ""}|${p.grain ?? ""}`;

/* ------------------------------------------------------------ reports -- */

/** Period-over-period figures, computed exactly as the dashboard's KPIS query does. */
export function kpisFrom(h: Headline): Kpi[] {
  return KPI_METRICS.map(([metric, label]) => {
    const value = Number((h as unknown as Record<string, number>)[metric] ?? 0);
    const previous = Number((h as unknown as Record<string, number>)[`${metric}_prev`] ?? 0);
    return {
      metric,
      label,
      value,
      previous,
      change: previous > 0 ? (value - previous) / previous : null,
      ratio: previous > 0 ? value / previous : null,
    };
  });
}

export async function headline(p: AnalyticsParams): Promise<Headline> {
  return cached(keyOf("headline", p), async () => (await run<Headline>(HEADLINE, p))[0]!);
}

export async function series(p: AnalyticsParams): Promise<SeriesPoint[]> {
  return cached(keyOf("series", p), () => run<SeriesPoint>(SERIES, p));
}

export async function records(p: AnalyticsParams): Promise<RecordRow[]> {
  // All-time: the date range doesn't apply, so it's left out of the cache key too.
  const q = { ...p, start_day: null, end_day: null, grain: null };
  return cached(keyOf("records", q), () => run<RecordRow>(RECORDS, q));
}

export async function funnel(p: AnalyticsParams): Promise<Funnel> {
  const q = { ...p, start_day: null, end_day: null, grain: null };
  return cached(keyOf("funnel", q), async () => (await run<Funnel>(FUNNEL, q))[0]!);
}

export async function tenants(p: AnalyticsParams): Promise<TenantRow[]> {
  // industry_label comes from the SQL (industryLabelSql), the same name the dashboard shows.
  return cached(keyOf("tenants", p), () => run<TenantRow>(TENANTS, p));
}

/** The SaaS figures week by week across the range (every week it touches). */
export async function weekly(p: AnalyticsParams): Promise<WeeklyRow[]> {
  const q = { ...p, grain: null }; // always weekly
  return cached(keyOf("weekly", q), () => run<WeeklyRow>(WEEKLY, q));
}

/** Everything the Overview shows, in one round trip. */
export async function overview(p: AnalyticsParams) {
  const [h, s, r, f] = await Promise.all([headline(p), series(p), records(p), funnel(p)]);
  return { headline: h, kpis: kpisFrom(h), series: s, records: r, funnel: f, generatedAt: new Date().toISOString() };
}

/** One company's figures and trend (test tenants included: you asked for it by name). */
export async function tenantDetail(id: string, p: AnalyticsParams) {
  const q = { ...p, tenant: id, include_test: true, industry: null, billing: null };
  const [h, s] = await Promise.all([headline(q), series(q)]);
  return { headline: h, kpis: kpisFrom(h), series: s, generatedAt: new Date().toISOString() };
}

export async function explore(metric: string, by: Dimension, p: AnalyticsParams) {
  const text = exploreQuery(metric, by); // throws on anything not in the registry
  const rows = await cached(keyOf("explore", p, `${metric}:${by}`), () => run<ExploreRow>(text, p));
  const def = METRICS.find((m) => m.id === metric)!;
  const labelled = by === "industry" ? rows.map((r) => ({ ...r, label: industryName(r.key) })) : rows;
  return { metric: def.id, label: def.label, format: def.format, by, byLabel: DIMENSION_LABELS[by], rows: labelled };
}

/** What the Explorer can ask for, plus the filter choices. */
export async function catalog() {
  return cached("catalog", async () => {
    const [first] = await run<{ first_day: string | null }>(FIRST_DAY, {});
    const used = await sdb
      .selectDistinct({ industry: schema.companies.industry })
      .from(schema.companies);
    const industries = used
      .map((r) => r.industry)
      .filter(Boolean)
      .map((id) => ({ id, label: industryName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // Every open company, for the dashboard's company filter (test ones flagged).
    const companies = (
      await sdb
        .select({ id: schema.companies.id, name: schema.companies.name, internal: schema.companies.isInternal })
        .from(schema.companies)
        .where(ne(schema.companies.status, "closed"))
    ).sort((a, b) => a.name.localeCompare(b.name));
    return {
      firstDay: first?.first_day ?? null,
      industries,
      companies,
      billingStatuses: ["trialing", "active", "past_due", "canceled", "none"],
      metrics: METRICS.map((m) => ({
        id: m.id,
        label: m.label,
        group: m.group,
        description: m.description,
        format: m.format,
        dimensions: metricDimensions(m).map((d) => ({ id: d, label: DIMENSION_LABELS[d] })),
      })),
    };
  });
}

/**
 * Mark a company as a test / internal tenant (left out of analytics by
 * default), or back. Its Control Hub kind follows: a customer becomes a test
 * tenant, and back to customer when unflagged (services/tenant-kind.ts).
 */
export async function setInternal(companyId: string, internal: boolean): Promise<{ id: string; name: string; internal: boolean } | null> {
  const [cur] = await sdb.select({ kind: schema.companies.kind }).from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!cur) return null;
  const row = await setTenantKind(companyId, kindForInternalFlag(cur.kind, internal));
  _clearAnalyticsCache();
  return row ? { id: row.id, name: row.name, internal: row.internal } : null;
}

function industryName(id: string | null | undefined): string {
  if (!id) return "Not set";
  if (id === "other") return "Other";
  return industryLabel(id) || INDUSTRY_LABELS.find((x) => x.id === id)?.label || id;
}
