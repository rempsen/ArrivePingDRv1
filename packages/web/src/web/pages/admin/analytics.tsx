/**
 * Admin → Analytics (superadmins only): live platform KPIs across every
 * tenant. Numbers come from /api/superadmin/analytics, which runs the same
 * SQL as the Claude "ArrivePing Analytics" dashboard
 * (services/platform-analytics/sql.ts), so the two always agree.
 *
 * Three views share one set of filters (range, industry, billing, test
 * companies): Overview, Companies (with a drill-down sheet) and Explorer
 * (any metric, broken down any supported way, exportable as CSV).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  Building2,
  CalendarRange,
  CircleCheck,
  Crown,
  Download,
  LogIn,
  MessageSquareText,
  RefreshCw,
  Search,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { apiHeaders } from "../../lib/api";
import { useAuth } from "../../hooks/use-auth";
import { switchCompany } from "../../lib/tenant";
import { PageHead } from "./shell";
import {
  BarList,
  BillingText,
  Card,
  DeltaPill,
  HEALTH_ORDER,
  HealthBar,
  HealthPill,
  Milestones,
  Segmented,
  Skeleton,
  Stat,
  Switch,
  TestBadge,
  Tile,
  TrendChart,
  billingLabel,
  bucketLabel,
  downloadCsv,
  fmt,
  healthMeta,
  parseDay,
  pickTicks,
  selectCls,
  useSort,
  type TrendMetric,
} from "./analytics-ui";

/* -------------------------------------------------------------- types -- */

type Grain = "day" | "week" | "month";

interface Headline {
  start_day: string;
  end_day: string;
  days: number;
  tenants: number;
  tenants_new: number;
  tenants_active: number;
  tenants_closed: number;
  users: number;
  users_active: number;
  techs: number;
  customers: number;
  jobs_created: number;
  jobs_completed: number;
  jobs_completed_all: number;
  jobs_cancelled: number;
  on_time_rate: number | null;
  customer_updates: number;
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
}
interface Kpi {
  metric: string;
  label: string;
  value: number;
  previous: number;
  change: number | null;
}
interface SeriesPoint {
  bucket: string;
  jobs_created: number;
  jobs_completed: number;
  new_tenants: number;
  customer_updates: number;
  sign_ins: number;
}
interface RecordRow {
  record: string;
  label: string;
  value: number;
  day: string | null;
  tenant: string | null;
}
interface Funnel {
  signed_up: number;
  onboarded: number;
  added_team: number;
  first_job: number;
  first_completed: number;
  paying: number;
  median_days_to_first_job: number | null;
}
interface Overview {
  headline: Headline;
  kpis: Kpi[];
  series: SeriesPoint[];
  records: RecordRow[];
  funnel: Funnel;
  generatedAt: string;
}
interface TenantRow {
  id: string;
  name: string;
  industry: string;
  industry_label: string;
  status: string;
  billing_status: string;
  internal: boolean;
  created: string;
  trial_ends: string | null;
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
  health: string;
}
interface Catalog {
  firstDay: string | null;
  industries: { id: string; label: string }[];
  billingStatuses: string[];
  metrics: {
    id: string;
    label: string;
    group: string;
    description: string;
    format: "count" | "decimal" | "money";
    dimensions: { id: string; label: string }[];
  }[];
}
interface ExploreResult {
  metric: string;
  label: string;
  format: "count" | "decimal" | "money";
  by: string;
  byLabel: string;
  rows: { key: string; label: string; value: number }[];
}

/* ------------------------------------------------------------ filters -- */

type Preset = "7d" | "30d" | "90d" | "12m" | "ytd" | "all" | "custom";

interface Filters {
  preset: Preset;
  customStart: string;
  customEnd: string;
  industry: string;
  billing: string;
  test: boolean;
}

const TZ = "America/Winnipeg";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d: string, n: number) => new Date(parseDay(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const spanDays = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000) + 1;
const autoGrain = (days: number): Grain => (days <= 45 ? "day" : days <= 210 ? "week" : "month");

function rangeOf(f: Filters, firstDay: string | null): { start: string; end: string } {
  const end = today();
  switch (f.preset) {
    case "7d":
      return { start: addDays(end, -6), end };
    case "90d":
      return { start: addDays(end, -89), end };
    case "12m":
      return { start: addDays(end, -364), end };
    case "ytd":
      return { start: `${end.slice(0, 4)}-01-01`, end };
    case "all":
      return { start: firstDay && firstDay < end ? firstDay : addDays(end, -364), end };
    case "custom":
      if (f.customStart && f.customEnd && f.customStart <= f.customEnd) return { start: f.customStart, end: f.customEnd };
      return { start: addDays(end, -29), end };
    default:
      return { start: addDays(end, -29), end };
  }
}

const PRESETS: { value: Preset; label: string; title: string }[] = [
  { value: "7d", label: "7D", title: "Last 7 days" },
  { value: "30d", label: "30D", title: "Last 30 days" },
  { value: "90d", label: "90D", title: "Last 90 days" },
  { value: "12m", label: "12M", title: "Last 12 months" },
  { value: "ytd", label: "YTD", title: "This year so far" },
  { value: "all", label: "All", title: "Since the first company" },
  { value: "custom", label: "Custom", title: "Pick dates" },
];

const STORE_KEY = "ap.analytics.filters.v1";
function loadFilters(): Filters {
  const base: Filters = { preset: "30d", customStart: "", customEnd: "", industry: "", billing: "", test: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Filters>) };
  } catch {
    /* storage blocked: defaults */
  }
  return base;
}

/* -------------------------------------------------------------- fetch -- */

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api/superadmin/analytics/${path}`, { headers: apiHeaders() });
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(body?.message || `Couldn't load analytics (error ${res.status})`);
  return body as T;
}

function useAnalytics<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["platform-analytics", path],
    queryFn: () => getJson<T>(path),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/* --------------------------------------------------------------- page -- */

type View = "overview" | "companies" | "explore";

export default function AnalyticsPage() {
  const { role } = useAuth();
  if (role !== "superadmin") {
    return (
      <div className="p-5 md:p-8">
        <PageHead title="Analytics" />
        <p className="text-sm text-slate-400">Analytics is for ArrivePing super admins.</p>
      </div>
    );
  }
  return <Analytics />;
}

function Analytics() {
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [view, setView] = useState<View>("overview");
  const [grainOverride, setGrainOverride] = useState<Grain | null>(null);
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(filters));
    } catch {
      /* storage blocked: filters just won't be remembered */
    }
  }, [filters]);

  const catalog = useAnalytics<Catalog>("catalog");
  const { start, end } = rangeOf(filters, catalog.data?.firstDay ?? null);
  const days = spanDays(start, end);
  const grain = grainOverride ?? autoGrain(days);
  useEffect(() => setGrainOverride(null), [start, end]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ start, end, grain });
    if (filters.test) p.set("test", "1");
    if (filters.industry) p.set("industry", filters.industry);
    if (filters.billing) p.set("billing", filters.billing);
    return p.toString();
  }, [start, end, grain, filters.test, filters.industry, filters.billing]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="p-5 md:p-8">
      <PageHead
        title="Analytics"
        subtitle="Live platform metrics across every company on ArrivePing."
        actions={
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={[
              { value: "overview", label: "Overview" },
              { value: "companies", label: "Companies" },
              { value: "explore", label: "Explorer" },
            ]}
          />
        }
      />

      <FilterBar
        filters={filters}
        set={set}
        start={start}
        end={end}
        catalog={catalog.data}
      />

      {view === "overview" && (
        <OverviewView qs={qs} grain={grain} setGrain={setGrainOverride} filters={filters} set={set} onOpenCompany={setOpenCompany} rangeLabel={rangeLabel(filters.preset, start, end)} />
      )}
      {view === "companies" && <CompaniesView qs={qs} onOpenCompany={setOpenCompany} rangeLabel={rangeLabel(filters.preset, start, end)} />}
      {view === "explore" && <ExploreView qs={qs} grain={grain} setGrain={setGrainOverride} catalog={catalog.data} rangeLabel={rangeLabel(filters.preset, start, end)} />}

      {openCompany && <CompanySheet id={openCompany} qs={qs} grain={grain} onClose={() => setOpenCompany(null)} />}
    </div>
  );
}

function rangeLabel(preset: Preset, start: string, end: string): string {
  const p = PRESETS.find((x) => x.value === preset);
  if (preset !== "custom" && preset !== "all" && p) return p.title;
  return `${fmt.day(start)}${start.slice(0, 4) !== end.slice(0, 4) ? `, ${start.slice(0, 4)}` : ""} – ${fmt.day(end)}, ${end.slice(0, 4)}`;
}

/* ---------------------------------------------------------- filter bar -- */

function FilterBar({
  filters,
  set,
  start,
  end,
  catalog,
}: {
  filters: Filters;
  set: (p: Partial<Filters>) => void;
  start: string;
  end: string;
  catalog?: Catalog;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      <Segmented
        ariaLabel="Date range"
        value={filters.preset}
        onChange={(preset) =>
          set(preset === "custom" && !filters.customStart ? { preset, customStart: start, customEnd: end } : { preset })
        }
        options={PRESETS}
      />
      {filters.preset === "custom" && (
        <div className="flex items-center gap-2 text-[13px] text-slate-400">
          <input
            id="an-start"
            aria-label="From"
            type="date"
            min="2020-01-01"
            max={filters.customEnd || today()}
            value={filters.customStart}
            onChange={(e) => e.target.validity.valid && e.target.value && set({ customStart: e.target.value })}
            className={selectCls}
          />
          <span>to</span>
          <input
            id="an-end"
            aria-label="To"
            type="date"
            min={filters.customStart || "2020-01-01"}
            max={today()}
            value={filters.customEnd}
            onChange={(e) => e.target.validity.valid && e.target.value && set({ customEnd: e.target.value })}
            className={selectCls}
          />
        </div>
      )}
      <select
        id="an-industry"
        aria-label="Industry"
        value={filters.industry}
        onChange={(e) => set({ industry: e.target.value })}
        className={selectCls}
      >
        <option value="">All industries</option>
        {catalog?.industries.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </select>
      <select id="an-billing" aria-label="Billing" value={filters.billing} onChange={(e) => set({ billing: e.target.value })} className={selectCls}>
        <option value="">All plans</option>
        {(catalog?.billingStatuses ?? []).map((b) => (
          <option key={b} value={b}>
            {billingLabel(b)}
          </option>
        ))}
      </select>
      <Switch id="an-test" checked={filters.test} onChange={(test) => set({ test })} label="Include test companies" />
    </div>
  );
}

/** "Live · updated 12 sec ago", ticking, with a refresh button. */
function LiveStamp({ at, fetching, onRefresh }: { at?: string; fetching: boolean; onRefresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-[12px] text-slate-500">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      <span>Live{at ? ` · updated ${fmt.ago(at).toLowerCase()}` : ""}</span>
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh now"
        aria-label="Refresh now"
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-slate-300">{(error as Error)?.message || "Couldn't load analytics."}</p>
        <button type="button" onClick={onRetry} className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/[0.05]">
          Try again
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ overview -- */

const TREND_OPTIONS: { value: TrendMetric; label: string }[] = [
  { value: "jobs", label: "Jobs" },
  { value: "customer_updates", label: "Customer updates" },
  { value: "new_tenants", label: "New companies" },
  { value: "sign_ins", label: "Sign-ins" },
];

const GRAIN_OPTIONS: { value: Grain; label: string; title: string }[] = [
  { value: "day", label: "D", title: "By day" },
  { value: "week", label: "W", title: "By week" },
  { value: "month", label: "M", title: "By month" },
];

function OverviewView({
  qs,
  grain,
  setGrain,
  filters,
  set,
  onOpenCompany,
  rangeLabel,
}: {
  qs: string;
  grain: Grain;
  setGrain: (g: Grain) => void;
  filters: Filters;
  set: (p: Partial<Filters>) => void;
  onOpenCompany: (id: string) => void;
  rangeLabel: string;
}) {
  const ov = useAnalytics<Overview>(`overview?${qs}`);
  const tn = useAnalytics<{ tenants: TenantRow[] }>(`tenants?${qs}`);
  const [trend, setTrend] = useState<TrendMetric>("jobs");

  if (ov.error && !ov.data) return <ErrorCard error={ov.error} onRetry={() => ov.refetch()} />;
  const d = ov.data;
  const h = d?.headline;
  const k = (m: string) => d?.kpis.find((x) => x.metric === m);
  const loading = !d;
  const delta = (m: string) => {
    const x = k(m);
    return x ? <DeltaPill change={x.change} value={x.value} previous={x.previous} /> : null;
  };

  const tenants = tn.data?.tenants ?? [];
  const healthCounts = HEALTH_ORDER.map((hh) => ({ health: hh, n: tenants.filter((t) => t.health === hh).length })).filter((x) => x.n > 0);

  return (
    <div className={`space-y-5 transition-opacity ${ov.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-slate-400">
          {rangeLabel}
          {h ? <span className="text-slate-600"> · compared with the {h.days} days before</span> : null}
        </p>
        <LiveStamp at={d?.generatedAt} fetching={ov.isFetching} onRefresh={() => { ov.refetch(); tn.refetch(); }} />
      </div>

      {h && !filters.test && h.jobs_created === 0 && h.tenants_active === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="text-[13px] text-slate-300">No real activity in this period yet. Demo and test companies are hidden.</p>
          <button type="button" onClick={() => set({ test: true })} className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-[12px] font-semibold text-slate-100 hover:bg-white/[0.12]">
            Include test companies
          </button>
        </div>
      )}

      {/* The four numbers that matter most */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Companies"
          loading={loading}
          value={fmt.int(h?.tenants)}
          sub={h && `${fmt.int(h.tenants_new)} new · ${fmt.int(h.tenants_active)} created jobs`}
          hint="Companies on ArrivePing (closed accounts not counted). New: signed up in the period. Created jobs: added at least one job in the period."
        />
        <Tile
          label="Users"
          loading={loading}
          value={fmt.int(h?.users)}
          sub={h && `${fmt.int(h.users_active)} active · ${fmt.int(h.techs)} technicians`}
          hint="Office staff and technicians with an active account, counted once each. Active: used ArrivePing in the period. Customers are counted separately."
        />
        <Tile
          label="Jobs completed"
          loading={loading}
          value={fmt.int(h?.jobs_completed)}
          delta={delta("jobs_completed")}
          sub={h && `${fmt.int(h.jobs_completed_all)} all time`}
          spark={d?.series.map((p) => p.jobs_completed)}
          sparkColor="#10b981"
          hint="Jobs finished in the period, by when they finished."
        />
        <Tile
          label="Monthly recurring revenue"
          loading={loading}
          value={fmt.money(h?.mrr)}
          sub={h && `${fmt.int(h.paying)} paying · ${fmt.money(h.trial_mrr)} on trial`}
          hint="Plan value of paying companies: their seats priced on the public price list (USD). Trials are shown separately."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Activity"
          caption={trend === "jobs" ? "Jobs created (line) and completed (bars)" : TREND_OPTIONS.find((o) => o.value === trend)?.label}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented ariaLabel="Chart" size="sm" value={trend} onChange={setTrend} options={TREND_OPTIONS} />
              <Segmented ariaLabel="Group by" size="sm" value={grain} onChange={setGrain} options={GRAIN_OPTIONS} />
            </div>
          }
        >
          {d ? <TrendChart data={d.series} metric={trend} grain={grain} /> : <Skeleton className="h-[260px]" />}
        </Card>

        <Card title="Most active company" caption={`${rangeLabel}, by jobs created`}>
          {loading ? (
            <Skeleton className="h-40" />
          ) : h?.top_tenant_id ? (
            <div>
              <button type="button" onClick={() => onOpenCompany(h.top_tenant_id!)} className="group flex w-full items-center gap-3 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-amber-400/10 text-amber-300">
                  <Crown className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[17px] font-semibold text-white group-hover:underline">{h.top_tenant_name}</span>
                  <span className="text-[12px] text-slate-500">
                    {fmt.int(h.top_tenant_jobs)} jobs · {fmt.pct(h.top_tenant_share)} of all jobs
                  </span>
                </span>
              </button>
              <div className="mt-4 h-2 rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full bg-amber-300/80" style={{ width: `${Math.max(2, (h.top_tenant_share ?? 0) * 100)}%` }} />
              </div>
              <div className="mt-6 border-t border-white/[0.06] pt-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <p className="text-[13px] font-medium text-slate-300">Company health</p>
                  <p className="text-[12px] text-slate-500">{tenants.length ? `${tenants.length} companies` : ""}</p>
                </div>
                {healthCounts.length ? <HealthBar counts={healthCounts} /> : <Skeleton className="h-16" />}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-[13px] text-slate-500">No company created a job in this period.</p>
          )}
        </Card>
      </div>

      {/* The period at a glance */}
      <Card pad={false} className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 [&>*]:border-white/[0.06] max-sm:[&>*:nth-child(odd)]:border-r sm:[&>*:not(:nth-child(4n))]:border-r [&>*:nth-child(-n+4)]:border-b max-sm:[&>*:nth-child(-n+6)]:border-b">
          <Stat label="Jobs created" value={fmt.int(h?.jobs_created)} delta={delta("jobs_created")} />
          <Stat label="Active companies" value={fmt.int(h?.tenants_active)} delta={delta("tenants_active")} hint="Companies that created at least one job" />
          <Stat label="Active users" value={fmt.int(h?.users_active)} delta={delta("users_active")} hint="Office staff and technicians who used ArrivePing" />
          <Stat label="Customer updates" value={fmt.int(h?.customer_updates)} delta={delta("customer_updates")} hint="Texts and emails that reached a customer" />
          <Stat label="New customers" value={fmt.int(k("customers_new")?.value)} delta={delta("customers_new")} />
          <Stat label="On-time arrivals" value={fmt.pct(h?.on_time_rate)} hint="Completed jobs never flagged as running late" />
          <Stat
            label="Average rating"
            value={h?.avg_rating != null ? `★ ${fmt.num(h.avg_rating, 1)}` : "—"}
            delta={h?.reviews ? <span className="text-[11px] text-slate-500">{fmt.int(h.reviews)} reviews</span> : null}
          />
          <Stat label="Message delivery" value={fmt.pct(h?.delivery_rate)} hint="Texts and emails delivered out of those sent" />
        </div>
      </Card>

      <RecordsCard records={d?.records} loading={loading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Activation" caption="All time · how far companies have got">
          {d ? (
            <>
              <Milestones
                steps={[
                  { label: "Signed up", value: d.funnel.signed_up },
                  { label: "Finished setup", value: d.funnel.onboarded },
                  { label: "Added a technician", value: d.funnel.added_team },
                  { label: "Created a job", value: d.funnel.first_job },
                  { label: "Completed a job", value: d.funnel.first_completed },
                  { label: "Paying", value: d.funnel.paying },
                ]}
              />
              <p className="mt-4 text-[12px] text-slate-500">
                {d.funnel.median_days_to_first_job != null
                  ? `Typical time from signup to first job: ${fmt.duration(d.funnel.median_days_to_first_job * 24)} (median).`
                  : "No company has created a job yet."}
              </p>
            </>
          ) : (
            <Skeleton className="h-56" />
          )}
        </Card>

        <Card title="Revenue" caption="Today · estimated from plans">
          {h ? (
            <div>
              <p className="text-[30px] font-semibold leading-none tracking-tight text-white tabular-nums">{fmt.money(h.mrr)}</p>
              <p className="mt-1 text-[12px] text-slate-500">a month · {fmt.money(h.mrr * 12)} a year</p>
              <dl className="mt-5 divide-y divide-white/[0.06] text-[13px]">
                {[
                  ["Paying", fmt.int(h.paying)],
                  ["On trial", `${fmt.int(h.trialing)} · ${fmt.money(h.trial_mrr)}/mo`],
                  ["Trials ending in 7 days", fmt.int(h.trials_ending_soon)],
                  ["Past due", fmt.int(h.past_due)],
                  ["Invoiced outside ArrivePing", fmt.int(h.invoiced_manually)],
                  ["Closed in this period", fmt.int(h.tenants_closed)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-2">
                    <dt className="text-slate-400">{label}</dt>
                    <dd className="font-semibold text-slate-100 tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <Skeleton className="h-56" />
          )}
        </Card>

        <Card title="Top companies" caption={`${rangeLabel}, by jobs created`}>
          {tn.data ? (
            <BarList
              rows={tenants
                .filter((t) => t.jobs > 0)
                .slice(0, 6)
                .map((t) => ({ key: t.id, label: t.name, value: t.jobs, sub: `${fmt.int(t.completed)} completed · ${t.industry_label}` }))}
              onSelect={onOpenCompany}
              empty="No company created a job in this period."
            />
          ) : (
            <Skeleton className="h-56" />
          )}
        </Card>
      </div>
    </div>
  );
}

const RECORD_ICONS: Record<string, ReactNode> = {
  jobs_in_a_day: <Trophy className="h-4 w-4" />,
  company_jobs_in_a_day: <Building2 className="h-4 w-4" />,
  completed_in_a_day: <CircleCheck className="h-4 w-4" />,
  busiest_week: <CalendarRange className="h-4 w-4" />,
  updates_in_a_day: <MessageSquareText className="h-4 w-4" />,
  largest_field_team: <Users className="h-4 w-4" />,
  fastest_first_job: <Zap className="h-4 w-4" />,
};

function RecordsCard({ records, loading }: { records?: RecordRow[]; loading: boolean }) {
  return (
    <Card title="Records" caption="All time · across the companies in view">
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : records?.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {records.map((r) => {
            const sub =
              r.record === "busiest_week" && r.day
                ? `Week of ${fmt.day(r.day)}, ${r.day.slice(0, 4)}`
                : [r.tenant, r.day ? fmt.dayLong(r.day) : null].filter(Boolean).join(" · ");
            const value = r.record === "fastest_first_job" ? fmt.duration(r.value) : fmt.int(r.value);
            return (
              <div key={r.record} className="rounded-2xl bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] text-cyan-glow">{RECORD_ICONS[r.record] ?? <Trophy className="h-4 w-4" />}</span>
                  <span className="text-[12px] font-medium leading-tight">{r.record === "fastest_first_job" ? "Fastest signup to first job" : r.label}</span>
                </div>
                <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight text-white tabular-nums">{value}</p>
                <p className="mt-1.5 truncate text-[12px] text-slate-500">{sub || " "}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-slate-500">No records yet: they appear with the first jobs.</p>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------- companies -- */

type SortKey = "name" | "health" | "plan_value" | "team" | "techs" | "customers" | "jobs" | "completed" | "customer_updates" | "last_active" | "created";

function CompaniesView({ qs, onOpenCompany, rangeLabel }: { qs: string; onOpenCompany: (id: string) => void; rangeLabel: string }) {
  const tn = useAnalytics<{ tenants: TenantRow[]; generatedAt: string }>(`tenants?${qs}`);
  const [q, setQ] = useState("");
  const [health, setHealth] = useState<string>("all");
  const sort = useSort<SortKey>("jobs");

  const all = useMemo(() => tn.data?.tenants ?? [], [tn.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter(
      (t) =>
        (health === "all" || t.health === health) &&
        (!needle || t.name.toLowerCase().includes(needle) || t.id.includes(needle) || t.industry_label.toLowerCase().includes(needle)),
    );
    const rank = (t: TenantRow) => HEALTH_ORDER.indexOf(t.health as (typeof HEALTH_ORDER)[number]);
    const val = (t: TenantRow): number | string =>
      sort.key === "name" ? t.name.toLowerCase() : sort.key === "health" ? rank(t) : sort.key === "last_active" ? t.last_active ?? "" : sort.key === "created" ? t.created : t[sort.key];
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === "asc" ? c : -c;
    });
  }, [all, q, health, sort.key, sort.dir]);

  if (tn.error && !tn.data) return <ErrorCard error={tn.error} onRetry={() => tn.refetch()} />;
  const maxJobs = Math.max(...rows.map((r) => r.jobs), 0);
  const counts = Object.fromEntries(HEALTH_ORDER.map((hh) => [hh, all.filter((t) => t.health === hh).length]));

  const th = (key: SortKey, label: string, align: "left" | "right" = "right", firstDir: "asc" | "desc" = "desc") => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`sticky top-0 z-10 bg-[#0d1422] px-3 py-2.5 font-medium ${align === "left" ? "text-left" : "text-right"}`}>
      <button type="button" onClick={() => sort.toggle(key, firstDir)} className={`inline-flex items-center gap-1 hover:text-slate-200 ${sort.key === key ? "text-slate-200" : ""}`}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div className={`space-y-4 transition-opacity ${tn.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              id="an-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search companies"
              aria-label="Search companies"
              className={`${selectCls} w-56 pl-8`}
            />
          </div>
          <Segmented
            ariaLabel="Health"
            size="sm"
            value={health}
            onChange={setHealth}
            options={[
              { value: "all", label: `All ${all.length}` },
              ...HEALTH_ORDER.filter((hh) => counts[hh]).map((hh) => ({ value: hh, label: `${healthMeta(hh).label} ${counts[hh]}`, title: healthMeta(hh).hint })),
            ]}
          />
        </div>
        <div className="flex items-center gap-3">
          <LiveStamp at={tn.data?.generatedAt} fetching={tn.isFetching} onRefresh={() => tn.refetch()} />
          <button
            type="button"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `arriveping-companies-${new Date().toISOString().slice(0, 10)}.csv`,
                rows.map((t) => ({
                  company: t.name, id: t.id, industry: t.industry_label, health: healthMeta(t.health).label, test: t.internal ? "yes" : "no",
                  plan: billingLabel(t.billing_status), seats: t.plan_seats, plan_value_usd: t.plan_value, team: t.team, technicians: t.techs,
                  customers: t.customers, active_users: t.active_users, jobs_created: t.jobs, jobs_completed: t.completed, jobs_all_time: t.jobs_all,
                  customer_updates: t.customer_updates, last_active: t.last_active ?? "", signed_up: t.created, trial_ends: t.trial_ends ?? "",
                })),
              )
            }
            className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-slate-200 transition hover:border-white/[0.14] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      <Card pad={false} className="overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1000px] text-[13px]">
            <caption className="sr-only">Companies, {rangeLabel}</caption>
            <thead className="text-[12px] text-slate-500">
              <tr className="border-b border-white/[0.06]">
                {th("name", "Company", "left", "asc")}
                {th("health", "Health", "left", "asc")}
                {th("plan_value", "Plan")}
                {th("team", "Team")}
                {th("techs", "Technicians")}
                {th("customers", "Customers")}
                {th("jobs", "Jobs")}
                {th("completed", "Completed")}
                {th("customer_updates", "Updates")}
                {th("last_active", "Last active")}
                {th("created", "Signed up")}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {!tn.data &&
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td colSpan={11} className="px-3 py-3">
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))}
              {rows.map((t) => (
                <tr key={t.id} data-key={t.id} onClick={() => onOpenCompany(t.id)} className="cursor-pointer transition-colors hover:bg-white/[0.03]">
                  <td className="max-w-[260px] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onOpenCompany(t.id); }} className="truncate font-medium text-slate-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60">
                        {t.name}
                      </button>
                      {t.internal && <TestBadge />}
                    </div>
                    <p className="truncate text-[11px] text-slate-500">{t.industry_label}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <HealthPill health={t.health} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <BillingText status={t.billing_status} />
                    {t.plan_value > 0 && <p className="text-[11px] text-slate-500 tabular-nums">{fmt.money(t.plan_value)}/mo · {t.plan_seats} seats</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{fmt.int(t.team)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{fmt.int(t.techs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{fmt.int(t.customers)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-100">
                    <span aria-hidden="true" className="mr-2 hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.05] align-middle lg:inline-block">
                      <span className="ml-auto block h-full rounded-full bg-cyan-glow/80" style={{ width: `${maxJobs ? (t.jobs / maxJobs) * 100 : 0}%` }} />
                    </span>
                    {fmt.int(t.jobs)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{fmt.int(t.completed)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{fmt.int(t.customer_updates)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-400">{fmt.ago(t.last_active)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-400">{fmt.day(t.created)}, {t.created.slice(0, 4)}</td>
                </tr>
              ))}
              {tn.data && !rows.length && (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-[13px] text-slate-500">
                    No companies match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[12px] text-slate-500">
        Jobs, completed and updates are for {rangeLabel.toLowerCase()}. Plan value is the monthly price of the company's seats on the public price list.
      </p>
    </div>
  );
}

/* ------------------------------------------------------- company sheet -- */

function CompanySheet({ id, qs, grain, onClose }: { id: string; qs: string; grain: Grain; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useAnalytics<{ headline: Headline; kpis: Kpi[]; series: SeriesPoint[]; generatedAt: string }>(`tenants/${encodeURIComponent(id)}?${qs}`);
  const list = useAnalytics<{ tenants: TenantRow[] }>(`tenants?${qs.replace(/(^|&)test=1/, "")}&test=1`);
  const t = list.data?.tenants.find((x) => x.id === id);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // A real modal: the page behind is inert, Escape closes it, focus starts inside.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    // A click on the dimmed backdrop lands on the dialog itself, outside its box.
    const onBackdrop = (e: MouseEvent) => {
      if (e.target !== el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) el.close();
    };
    el.addEventListener("click", onBackdrop);
    return () => el.removeEventListener("click", onBackdrop);
  }, []);

  const flip = useMutation({
    mutationFn: async (internal: boolean) => {
      const res = await fetch(`/api/superadmin/analytics/tenants/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ internal }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message || "Couldn't save the change");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-analytics"] }),
  });

  const h = detail.data?.headline;
  const k = (m: string) => detail.data?.kpis.find((x) => x.metric === m);
  const d = (m: string) => {
    const x = k(m);
    return x ? <DeltaPill change={x.change} value={x.value} previous={x.previous} /> : null;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="an-sheet-title"
      onClose={onClose}
      className="m-0 ml-auto h-full max-h-none w-full max-w-[560px] overflow-hidden border-0 border-l border-white/[0.08] bg-[#0b1220] p-0 text-slate-200 shadow-[-20px_0_60px_rgba(0,0,0,0.5)] backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/[0.06] bg-[#0b1220]/95 px-6 pb-4 pt-5 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="an-sheet-title" className="truncate text-[20px] font-semibold tracking-tight text-white">
                {t?.name ?? h?.top_tenant_name ?? id}
              </h2>
              {t?.internal && <TestBadge />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
              {t && <HealthPill health={t.health} />}
              {t && <span>{t.industry_label}</span>}
              {t && <span>· Signed up {fmt.dayLong(t.created)}</span>}
            </div>
          </div>
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => switchCompany(id)}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-white/[0.08] px-3 py-1.5 text-[13px] font-semibold text-slate-100 transition hover:bg-white/[0.12]"
            >
              <LogIn className="h-3.5 w-3.5" /> Open this company
            </button>
            {t && (
              <Switch
                id="an-sheet-test"
                checked={t.internal}
                onChange={(v) => flip.mutate(v)}
                label={flip.isPending ? "Saving…" : "Test company"}
              />
            )}
          </div>
          {flip.error && <p className="text-[12px] text-rose-300">{(flip.error as Error).message}</p>}
          {t?.internal && (
            <p className="text-[12px] text-slate-500">Left out of platform numbers unless test companies are included.</p>
          )}

          <div className="grid grid-cols-2 overflow-hidden rounded-[16px] border border-white/[0.06] [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b [&>*]:border-white/[0.06]">
            <Stat label="Jobs created" value={fmt.int(h?.jobs_created)} delta={d("jobs_created")} />
            <Stat label="Jobs completed" value={fmt.int(h?.jobs_completed)} delta={d("jobs_completed")} />
            <Stat label="Customer updates" value={fmt.int(h?.customer_updates)} delta={d("customer_updates")} />
            <Stat label="Active users" value={fmt.int(h?.users_active)} delta={d("users_active")} />
          </div>

          <div>
            <p className="mb-2 text-[13px] font-semibold text-slate-200">Jobs</p>
            {detail.data ? <TrendChart data={detail.data.series} metric="jobs" grain={grain} height={200} /> : <Skeleton className="h-[200px]" />}
          </div>

          {t && (
            <dl className="divide-y divide-white/[0.06] rounded-[16px] border border-white/[0.06] px-4 text-[13px]">
              {[
                ["Plan", <BillingText key="b" status={t.billing_status} />],
                ["Seats", fmt.int(t.plan_seats)],
                ["Plan value", t.plan_value ? `${fmt.money(t.plan_value)} a month` : "—"],
                ["Trial ends", t.trial_ends ? fmt.dayLong(t.trial_ends) : "—"],
                ["Team", `${fmt.int(t.team)} people · ${fmt.int(t.techs)} technicians`],
                ["Customers", fmt.int(t.customers)],
                ["Jobs, all time", fmt.int(t.jobs_all)],
                ["Last active", fmt.ago(t.last_active)],
                ["Finished setup", t.onboarded ? "Yes" : "Not yet"],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="text-right font-medium text-slate-100 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {detail.error && <ErrorCard error={detail.error} onRetry={() => detail.refetch()} />}
        </div>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------ explorer -- */

const GROUP_ORDER = ["Jobs", "Customers", "Team", "Companies", "Activity", "Payments"];

function ExploreView({
  qs,
  grain,
  setGrain,
  catalog,
  rangeLabel,
}: {
  qs: string;
  grain: Grain;
  setGrain: (g: Grain) => void;
  catalog?: Catalog;
  rangeLabel: string;
}) {
  const [metric, setMetric] = useState("jobs_created");
  const [by, setBy] = useState("time");
  const def = catalog?.metrics.find((m) => m.id === metric);
  const dims = def?.dimensions ?? [];
  const byOk = dims.some((d) => d.id === by) ? by : dims[0]?.id ?? "time";
  const res = useAnalytics<ExploreResult>(`explore?${qs}&metric=${metric}&by=${byOk}`, !!def);

  const format = (n: number) =>
    def?.format === "decimal" ? fmt.num(n, 2) : def?.format === "money" ? fmt.int(n) : fmt.int(n);
  const rows = res.data?.rows ?? [];
  const total = def?.format === "count" ? rows.reduce((s, r) => s + r.value, 0) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Metrics" className="rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-2 lg:self-start">
        {!catalog && <Skeleton className="m-2 h-72" />}
        {GROUP_ORDER.map((g) => {
          const items = catalog?.metrics.filter((m) => m.group === g) ?? [];
          if (!items.length) return null;
          return (
            <div key={g} className="py-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{g}</p>
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetric(m.id)}
                  aria-current={m.id === metric ? "true" : undefined}
                  className={`block w-full rounded-[10px] px-3 py-1.5 text-left text-[13px] transition ${
                    m.id === metric ? "bg-white/[0.1] font-medium text-white" : "text-slate-300 hover:bg-white/[0.04]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <Card
        title={def?.label ?? "Explorer"}
        caption={def ? `${def.description} ${rangeLabel}.` : undefined}
        action={
          <button
            type="button"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `arriveping-${metric}-by-${byOk}-${new Date().toISOString().slice(0, 10)}.csv`,
                rows.map((r) => ({ [res.data?.byLabel ?? byOk]: byOk === "time" ? r.key : r.label, [def?.label ?? metric]: r.value })),
              )
            }
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.04] px-2.5 text-[12px] font-medium text-slate-200 transition hover:border-white/[0.14] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-slate-500">Break down by</span>
          {dims.length > 0 && (
            <Segmented ariaLabel="Break down by" size="sm" value={byOk} onChange={setBy} options={dims.map((d) => ({ value: d.id, label: d.label }))} />
          )}
          {byOk === "time" && <Segmented ariaLabel="Group by" size="sm" value={grain} onChange={setGrain} options={GRAIN_OPTIONS} />}
        </div>

        {res.error && !res.data ? (
          <ErrorCard error={res.error} onRetry={() => res.refetch()} />
        ) : !res.data ? (
          <Skeleton className="h-[300px]" />
        ) : (
          <div className={`transition-opacity ${res.isPlaceholderData ? "opacity-60" : ""}`}>
            {total != null && (
              <p className="mb-3 text-[13px] text-slate-400">
                Total <span className="ml-1 text-[20px] font-semibold text-white tabular-nums">{fmt.int(total)}</span>
              </p>
            )}
            {byOk === "time" ? (
              <TimeBars rows={rows} grain={grain} name={def?.label ?? ""} format={format} />
            ) : (
              <BarList rows={rows.slice(0, 25).map((r) => ({ key: r.key, label: r.label, value: r.value }))} format={format} />
            )}
            {byOk !== "time" && rows.length > 25 && <p className="mt-2 text-[12px] text-slate-500">Showing the top 25 of {rows.length}. The CSV has all of them.</p>}
            {def?.format === "money" && <p className="mt-3 text-[12px] text-slate-500">Each currency is totalled on its own; amounts are never converted.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

function TimeBars({ rows, grain, name, format }: { rows: { key: string; value: number }[]; grain: Grain; name: string; format: (n: number) => string }) {
  const n = rows.length;
  const ticks = pickTicks(rows.map((r) => r.key), 8);
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 18, bottom: 0, left: -12 }} barCategoryGap={n > 40 ? 1 : "22%"}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="key" ticks={ticks} interval={0} tickFormatter={(d: string) => bucketLabel(d, grain)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => format(v)} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-xl border border-white/[0.1] bg-[#111a2b]/95 px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
                  <p className="text-[11px] text-slate-400">{grain === "week" ? `Week of ${fmt.day(String(label))}` : grain === "month" ? fmt.month(String(label)) : fmt.dayLong(String(label))}</p>
                  <p className="text-[12px] text-slate-200">
                    {name} <span className="ml-2 font-semibold tabular-nums">{format(Number(payload[0]!.value))}</span>
                  </p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="value" fill="#22d3ee" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
