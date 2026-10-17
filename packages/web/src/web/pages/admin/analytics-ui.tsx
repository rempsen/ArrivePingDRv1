/**
 * Building blocks for Admin → Analytics: a segmented control, a switch,
 * cards, KPI tiles, charts and pills. Quiet by design: one accent per chart,
 * large tabular numbers, hairline borders and nothing that moves unless the
 * data does.
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/* ----------------------------------------------------------- formats -- */

const intF = new Intl.NumberFormat("en-US");
const compactF = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const moneyF = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmt = {
  int: (n: number | null | undefined) => (n == null ? "—" : n >= 100_000 ? compactF.format(n) : intF.format(Math.round(n))),
  num: (n: number | null | undefined, digits = 1) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n),
  money: (n: number | null | undefined) => (n == null ? "—" : moneyF.format(n)),
  currency: (n: number, code: string) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${intF.format(Math.round(n))} ${code}`;
    }
  },
  pct: (r: number | null | undefined) =>
    r == null ? "—" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(r) < 0.1 ? 1 : 0 }).format(r * 100)}%`,
  /** "Sep 5" */
  day: (d: string | null | undefined) => (d ? shortDay.format(parseDay(d)) : "—"),
  /** "Sat, Sep 5, 2026" */
  dayLong: (d: string | null | undefined) => (d ? longDay.format(parseDay(d)) : "—"),
  month: (d: string) => monthF.format(parseDay(d)),
  /** A length of time given in hours: "6 min", "3.4 hours", "2.5 days". */
  duration: (hours: number | null | undefined) => {
    if (hours == null || Number.isNaN(hours)) return "—";
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(hours)} hours`;
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(hours / 24)} days`;
  },
  /** "3 min ago", "2 days ago", "Sep 12" */
  ago: (iso: string | null | undefined) => {
    if (!iso) return "Never";
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return "—";
    const m = Math.round(ms / 60_000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hr ago`;
    const d = Math.round(h / 24);
    if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
    return shortDay.format(new Date(iso));
  },
};

const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthF = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

/** A "YYYY-MM-DD" day as a UTC date (so formatting never shifts it a day). */
export function parseDay(d: string): Date {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`);
}

/** About `max` evenly spaced x ticks that always include the last bucket without crowding it. */
export function pickTicks(keys: string[], max = 7): string[] {
  const n = keys.length;
  if (n <= max) return keys;
  const every = Math.ceil(n / max);
  const idx: number[] = [];
  for (let i = 0; i < n; i += every) idx.push(i);
  const last = n - 1;
  if (idx[idx.length - 1] !== last) {
    if (last - idx[idx.length - 1]! < every / 2 + 0.5) idx[idx.length - 1] = last;
    else idx.push(last);
  }
  return idx.map((i) => keys[i]!);
}

export function bucketLabel(d: string, grain: "day" | "week" | "month"): string {
  if (grain === "month") return fmt.month(d);
  return fmt.day(d);
}

/* ------------------------------------------------------------ layout -- */

export function Card({
  title,
  caption,
  action,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  caption?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-[20px] border border-white/[0.06] bg-white/[0.025] ${pad ? "p-5" : ""} ${className}`}>
      {(title || action) && (
        <header className={`flex flex-wrap items-start justify-between gap-3 ${pad ? "mb-4" : "px-5 pb-3 pt-5"}`}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-slate-100">{title}</h2>}
            {caption && <p className="mt-0.5 text-[12px] text-slate-500">{caption}</p>}
          </div>
          {action && <div className="min-w-0 max-w-full">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.05] ${className}`} />;
}

/* ---------------------------------------------------------- controls -- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel: string;
}) {
  const layoutId = useId();
  return (
    <fieldset className="m-0 inline-flex min-w-0 max-w-full overflow-x-auto rounded-[10px] border-0 bg-white/[0.06] p-[3px]">
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative shrink-0 whitespace-nowrap rounded-[8px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]"
            } ${on ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="absolute inset-0 rounded-[8px] bg-white/[0.12] shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer select-none items-center gap-2.5 text-[13px] font-medium text-slate-300">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
          checked ? "bg-emerald-live" : "bg-white/[0.14]"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-[left] duration-200 ${
            checked ? "left-[18px]" : "left-[2px]"
          }`}
        />
      </button>
      {label}
    </label>
  );
}

export const selectCls =
  "h-[34px] rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-slate-200 outline-none transition hover:border-white/[0.14] focus:border-brand/60";

/* ------------------------------------------------------------- tiles -- */

/** Signed change from the period before; colored by whether up is good. */
export function DeltaPill({ change, value, previous, upIsGood = true }: { change: number | null; value?: number; previous?: number; upIsGood?: boolean }) {
  if (change == null) {
    if (value && !previous) return <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-300">New</span>;
    return null;
  }
  const up = change > 0;
  const flat = Math.abs(change) < 0.005;
  const good = flat ? null : up === upIsGood;
  const tone = good == null ? "bg-white/[0.06] text-slate-300" : good ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const times = change + 1;
  const text = flat
    ? "0%"
    : times >= 10
      ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: times < 100 ? 1 : 0 }).format(times)}×`
      : `${up ? "+" : "−"}${fmt.pct(Math.abs(change))}`;
  return (
    <span
      title={previous != null && value != null ? `${fmt.int(value)} vs ${fmt.int(previous)} in the period before` : undefined}
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}
    >
      {!flat && <Icon className="h-3 w-3" aria-hidden="true" />}
      {text}
    </span>
  );
}

export function Sparkline({ values, color = "#22d3ee", height = 34 }: { values: number[]; color?: string; height?: number }) {
  const gid = useId().replace(/:/g, "");
  if (values.length < 2) return <div style={{ height }} />;
  const w = 120;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 2 - (v / max) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.25" fill={color} />
    </svg>
  );
}

export function Tile({
  label,
  value,
  sub,
  delta,
  spark,
  sparkColor,
  loading,
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-5" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-slate-400">{label}</p>
        {!loading && delta}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.025em] text-white tabular-nums">{value}</p>
      )}
      <div className="mt-2 min-h-[18px] text-[12px] text-slate-500">{loading ? <Skeleton className="h-3 w-32" /> : sub}</div>
      {spark && !loading && (
        <div className="-mx-1 mt-3">
          <Sparkline values={spark} color={sparkColor} />
        </div>
      )}
    </div>
  );
}

/** A smaller figure for the period strip. */
export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5" title={hint}>
      <p className="truncate text-[12px] font-medium text-slate-500">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[22px] font-semibold tracking-tight text-slate-100 tabular-nums">{value}</span>
        {delta}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- pills -- */

const HEALTH: Record<string, { label: string; cls: string; dot: string; hint: string }> = {
  active: { label: "Active", cls: "text-emerald-300 bg-emerald-400/10", dot: "bg-emerald-400", hint: "Used in the last 7 days" },
  new: { label: "New", cls: "text-cyan-200 bg-cyan-400/10", dot: "bg-cyan-glow", hint: "Signed up in the last 14 days, not active yet" },
  quiet: { label: "Quiet", cls: "text-amber-200 bg-amber-400/10", dot: "bg-amber-400", hint: "Last used 8–30 days ago" },
  dormant: { label: "Dormant", cls: "text-slate-300 bg-white/[0.06]", dot: "bg-slate-500", hint: "Not used for over 30 days" },
  closed: { label: "Closed", cls: "text-rose-200 bg-rose-400/10", dot: "bg-rose-400", hint: "Account closed" },
};
export const HEALTH_ORDER = ["active", "new", "quiet", "dormant", "closed"] as const;
export const healthMeta = (h: string) => HEALTH[h] ?? HEALTH.dormant!;

/** Companies by health as one stacked bar with a legend underneath. */
export function HealthBar({ counts }: { counts: { health: string; n: number }[] }) {
  const total = counts.reduce((s, c) => s + c.n, 0);
  if (!total) return null;
  return (
    <div>
      <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
        {counts.map((c) => (
          <div key={c.health} className={`h-full first:rounded-l-full last:rounded-r-full ${healthMeta(c.health).dot}`} style={{ width: `${(c.n / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {counts.map((c) => (
          <li key={c.health} className="flex items-center gap-2 text-[12px] text-slate-400" title={healthMeta(c.health).hint}>
            <span className={`h-2 w-2 rounded-full ${healthMeta(c.health).dot}`} />
            {healthMeta(c.health).label}
            <span className="ml-auto font-semibold tabular-nums text-slate-200">{c.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HealthPill({ health }: { health: string }) {
  const m = healthMeta(health);
  return (
    <span title={m.hint} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

const BILLING: Record<string, { label: string; cls: string }> = {
  active: { label: "Paying", cls: "text-emerald-300" },
  trialing: { label: "Trial", cls: "text-cyan-200" },
  past_due: { label: "Past due", cls: "text-amber-300" },
  canceled: { label: "Canceled", cls: "text-rose-300" },
  unpaid: { label: "Unpaid", cls: "text-rose-300" },
  none: { label: "Invoiced", cls: "text-slate-400" },
};
export const billingLabel = (s: string) => BILLING[s]?.label ?? s;

export function BillingText({ status }: { status: string }) {
  const b = BILLING[status] ?? { label: status, cls: "text-slate-400" };
  return <span className={`text-[12px] font-semibold ${b.cls}`}>{b.label}</span>;
}

export function TestBadge() {
  return (
    <span title="Test or internal company: left out of the numbers unless test companies are included" className="rounded-full border border-white/[0.1] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      Test
    </span>
  );
}

/* ------------------------------------------------------------ charts -- */

export type TrendMetric = "jobs" | "new_tenants" | "customer_updates" | "sign_ins";

const AXIS = { fontSize: 11, fill: "#64748b" };

function ChartTip({
  active,
  payload,
  label,
  grain,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: string;
  grain: "day" | "week" | "month";
}) {
  if (!active || !payload?.length || !label) return null;
  const title = grain === "week" ? `Week of ${fmt.day(label)}` : grain === "month" ? fmt.month(label) : fmt.dayLong(label);
  return (
    <div className="rounded-xl border border-white/[0.1] bg-[#111a2b]/95 px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur">
      <p className="mb-1 text-[11px] font-medium text-slate-400">{title}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-[12px] text-slate-200">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{fmt.int(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function TrendChart({
  data,
  metric,
  grain,
  height = 260,
}: {
  data: { bucket: string; jobs_created: number; jobs_completed: number; new_tenants: number; customer_updates: number; sign_ins: number }[];
  metric: TrendMetric;
  grain: "day" | "week" | "month";
  height?: number;
}) {
  const ticks = useMemo(() => pickTicks(data.map((d) => d.bucket)), [data]);
  const one = metric !== "jobs";
  const seriesKey = metric === "new_tenants" ? "new_tenants" : metric === "customer_updates" ? "customer_updates" : "sign_ins";
  const seriesName = metric === "new_tenants" ? "New companies" : metric === "customer_updates" ? "Customer updates" : "Sign-ins";
  return (
    <div style={{ height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 18, bottom: 0, left: -12 }} barCategoryGap={data.length > 40 ? 1 : "22%"}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="bucket"
            ticks={ticks}
            tickFormatter={(d: string) => bucketLabel(d, grain)}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            interval={0}
            minTickGap={8}
          />
          <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ChartTip grain={grain} />} />
          {one ? (
            <Bar dataKey={seriesKey} name={seriesName} fill="#22d3ee" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          ) : (
            <>
              <Bar dataKey="jobs_completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Line
                dataKey="jobs_created"
                name="Created"
                type="linear"
                stroke="#22d3ee"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars from one left edge, one shared scale. */
export function BarList({
  rows,
  format = fmt.int,
  color = "#22d3ee",
  onSelect,
  empty = "Nothing in this period.",
}: {
  rows: { key: string; label: ReactNode; value: number; sub?: ReactNode }[];
  format?: (n: number) => string;
  color?: string;
  onSelect?: (key: string) => void;
  empty?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] text-slate-200">{r.label}</span>
              <span className="shrink-0 text-[13px] font-semibold text-slate-100 tabular-nums">{format(r.value)}</span>
            </div>
            <div className="mt-1.5 h-[6px] rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full" style={{ width: `${max ? Math.max(2, (r.value / max) * 100) : 0}%`, background: color }} />
            </div>
            {r.sub && <p className="mt-1 text-[11px] text-slate-500">{r.sub}</p>}
          </>
        );
        return (
          <li key={r.key}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(r.key)} className="block w-full rounded-[12px] px-2.5 py-2 text-left transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60">
                {inner}
              </button>
            ) : (
              <div className="px-2.5 py-2">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Milestones as bars from one left edge, each a share of the first. */
export function Milestones({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const base = steps[0]?.value ?? 0;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const share = base ? s.value / base : 0;
        return (
          <li key={s.label} title={s.hint}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-slate-300">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-slate-100">{fmt.int(s.value)}</span>
                {i > 0 && <span className="ml-2 text-slate-500">{fmt.pct(share)}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full"
                style={{ width: `${base ? Math.max(s.value ? 2 : 0, share * 100) : 0}%`, background: i === 0 ? "rgba(34,211,238,0.45)" : "#22d3ee" }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- csv -- */

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Sort state for a table: click a header to sort, again to flip. */
export function useSort<K extends string>(initial: K, initialDir: "asc" | "desc" = "desc") {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);
  const toggle = (k: K, firstDir: "asc" | "desc" = "desc") => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir(firstDir);
    }
  };
  return { key, dir, toggle };
}
