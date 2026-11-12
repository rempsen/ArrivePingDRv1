/**
 * One completed job on the Earnings screen: its type, and the pay lines shown
 * on both the list row and the detail sheet. Kept in one place so the row and
 * the sheet can never disagree about how a job was paid.
 */
import { money, fmtDate } from "./theme";

export type EarnJob = {
  id: string;
  companyId: string;
  company: string;
  title: string;
  service: string;
  customerName: string;
  scheduledAt: number | null;
  finishedAt: number | null;
  /** Pre-tax value of the job to the company — NOT what the tech takes home. */
  price: number;
  /** Real pay: on-site hours x hourly rate + mileage + flat + per-unit pay. */
  pay: number;
  onSiteMinutes: number;
  payRatePerHour: number;
  hourlyPay: number;
  unitPay: number;
  mileagePay?: number;
  flatPay?: number;
  paidKm?: number;
  /** $0 because the office has not set an hourly rate and there was no unit pay. */
  unrated: boolean;
  /** QuickBooks Sync (companies that use it): none | po_open | billed | paid | error. */
  vendorBillStatus?: string;
  /** When the company paid this job's bill in QuickBooks, if it has. */
  subtradePaidAt?: number | null;
};

/** Minutes -> "1h 45m" / "45m", for pay lines. */
export function fmtHours(mins: number): string {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  if (n === 0) return "0m";
  const h = Math.floor(n / 60);
  return h > 0 ? `${h}h ${n % 60}m` : `${n}m`;
}

export type PayLine = { label: string; hint?: string; amount: number };

/** The parts of a job's pay, in the order they're shown. Zero parts are left out, except on-site time. */
export function payLines(j: EarnJob): PayLine[] {
  const lines: PayLine[] = [
    {
      label: "On-site time",
      hint: `${fmtHours(j.onSiteMinutes)}${j.payRatePerHour ? ` @ ${money(j.payRatePerHour)}/h` : ""}`,
      amount: j.hourlyPay,
    },
  ];
  if ((j.mileagePay ?? 0) > 0) lines.push({ label: "Mileage", hint: j.paidKm ? `${Math.round(j.paidKm * 10) / 10} km` : undefined, amount: j.mileagePay ?? 0 });
  if ((j.flatPay ?? 0) > 0) lines.push({ label: "Flat per job", amount: j.flatPay ?? 0 });
  if (j.unitPay > 0) lines.push({ label: "Per-unit work", amount: j.unitPay });
  return lines;
}

/** The one-line pay summary under a job in the list. */
export function paySummary(j: EarnJob): string {
  const base =
    j.hourlyPay > 0
      ? `${fmtHours(j.onSiteMinutes)} on site${j.payRatePerHour ? ` @ ${money(j.payRatePerHour)}/h` : ""} = ${money(j.hourlyPay)}`
      : j.unrated
        ? "No pay rate set — ask the office"
        : `${fmtHours(j.onSiteMinutes)} on site`;
  return (
    base +
    ((j.mileagePay ?? 0) > 0 ? ` · mileage ${money(j.mileagePay ?? 0)}` : "") +
    ((j.flatPay ?? 0) > 0 ? ` · flat ${money(j.flatPay ?? 0)}` : "") +
    (j.unitPay > 0 ? ` · per-unit ${money(j.unitPay)}` : "")
  );
}

/** QuickBooks line for companies that pay through it, or null when there's nothing to say. */
export function quickbooksNote(j: EarnJob): { text: string; paid: boolean } | null {
  if (j.vendorBillStatus === "paid") return { text: `Paid in QuickBooks${j.subtradePaidAt ? ` · ${fmtDate(j.subtradePaidAt)}` : ""}`, paid: true };
  if (j.vendorBillStatus === "billed") return { text: "Billed in QuickBooks · awaiting payment", paid: false };
  return null;
}
