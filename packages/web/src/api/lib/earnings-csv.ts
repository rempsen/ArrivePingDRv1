/**
 * The technician's earnings export: one row per completed job, across every
 * company they work for. Money columns are plain numbers (no "$") so a
 * spreadsheet can sum them.
 */
import { roundHalfUp, toCsv } from "../routes/export";

export type EarningsCsvJob = {
  company: string;
  title: string;
  service: string;
  customerName: string;
  finishedAt: number | null;
  scheduledAt: number | null;
  onSiteMinutes: number;
  payRatePerHour: number;
  hourlyPay: number;
  mileagePay: number;
  flatPay: number;
  unitPay: number;
  pay: number;
  price: number;
  vendorBillStatus: string;
  subtradePaidAt: number | null;
};

/**
 * Text that opens with = + - @ (or a tab / CR) is read as a formula by Excel
 * and Sheets. Customer names and job titles are typed by other people, so a
 * name like `=HYPERLINK(...)` would run when the tech opens their export.
 * A leading apostrophe makes the spreadsheet treat the cell as text.
 */
export function safeText(v: string | null | undefined): string {
  const s = v ?? "";
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** YYYY-MM-DD in the tech's own time zone (falls back to UTC for a bad zone). */
function ymd(ms: number | null, tz?: string): string {
  if (!ms) return "";
  const d = new Date(ms);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const money = (n: number) => roundHalfUp(Number(n) || 0, 2);

const COLUMNS = [
  "date", "company", "job", "service", "customer", "hours", "rate", "hourly", "mileage", "flat", "units", "total", "value", "qb", "paid",
];
const HEADERS = [
  "Date", "Company", "Job", "Service", "Customer", "On-site hours", "Hourly rate", "Hourly pay", "Mileage pay", "Flat pay",
  "Per-unit pay", "Total pay", "Job value (pre-tax)", "QuickBooks status", "QuickBooks paid date",
];

export function earningsCsv(jobs: EarningsCsvJob[], tz?: string): string {
  const rows = jobs.map((j) => ({
    date: ymd(j.finishedAt ?? j.scheduledAt, tz),
    company: safeText(j.company),
    job: safeText(j.title),
    service: safeText(j.service),
    customer: safeText(j.customerName),
    hours: roundHalfUp((Number(j.onSiteMinutes) || 0) / 60, 2),
    rate: money(j.payRatePerHour),
    hourly: money(j.hourlyPay),
    mileage: money(j.mileagePay),
    flat: money(j.flatPay),
    units: money(j.unitPay),
    total: money(j.pay),
    value: money(j.price),
    qb: j.vendorBillStatus === "none" ? "" : j.vendorBillStatus,
    paid: ymd(j.subtradePaidAt, tz),
  }));
  return toCsv(rows, COLUMNS, HEADERS);
}
