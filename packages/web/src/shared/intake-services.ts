/**
 * Which services a public intake form offers, and how a submission is turned
 * into a job: which service it is for, how urgent it is, and when the customer
 * wants it.
 *
 * Before this, every lead form listed every active service the company had. A
 * leasing inquiry for a property manager offered "Owner Approval — NTE Review"
 * and "Financial Reporting & Accounting Review"; a lead that skipped the
 * dropdown landed on whichever service the database returned first. The form
 * now carries its own list (on its Service type field), and the server decides
 * within that list.
 *
 * Shared by the public form endpoint, the form editor and onboarding, so the
 * three can't disagree about what "offered on this form" means.
 */
import { zonedTimeToInstant } from "./tz";

/** Most services one form may offer. Far above any real form; a cap on stored JSON. */
export const MAX_FORM_SERVICES = 100;

type FieldLike = { key?: string; serviceIds?: unknown };
type ServiceLike = { id: string; name: string; category?: string | null; active?: boolean | null };

/**
 * The service ids chosen for a form's Service type field. Empty means the form
 * was never narrowed down, which keeps the old behaviour: every active service.
 */
export function formServiceIds(fields: readonly FieldLike[] | null | undefined): string[] {
  const f = (fields ?? []).find((x) => x?.key === "serviceType");
  return cleanServiceIds(f?.serviceIds);
}

/** Strings only, trimmed, de-duplicated, capped. Anything else is dropped. */
export function cleanServiceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim().slice(0, 128);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= MAX_FORM_SERVICES) break;
  }
  return out;
}

/**
 * The active services a form's dropdown shows, in the company's own order.
 * When the form has a list, only those; when it has none, all of them.
 */
export function servicesOfferedOnForm<S extends ServiceLike>(services: readonly S[], fields: readonly FieldLike[] | null | undefined): S[] {
  const active = services.filter((s) => s.active !== false);
  const ids = formServiceIds(fields);
  if (!ids.length) return active;
  const allowed = new Set(ids);
  return active.filter((s) => allowed.has(s.id));
}

/**
 * The service a submission is booked under:
 *   1. what the visitor picked, if this form offers it and it is still active;
 *   2. the form's default service, if still active;
 *   3. the first still-active service on the form's list;
 *   4. any active service (a form whose whole list was retired still lands).
 * A pick from outside the form's list is ignored rather than trusted: the
 * browser sends an id, and nothing stops a crafted request sending any id.
 */
export function resolveIntakeService<S extends ServiceLike>(opts: {
  picked?: string | null;
  defaultId?: string | null;
  allowedIds: readonly string[];
  services: readonly S[];
}): S | undefined {
  const active = opts.services.filter((s) => s.active !== false);
  const byId = new Map(active.map((s) => [s.id, s]));
  const allowed = opts.allowedIds.length ? new Set(opts.allowedIds) : null;
  const picked = opts.picked ? byId.get(opts.picked) : undefined;
  if (picked && (!allowed || allowed.has(picked.id))) return picked;
  const dflt = opts.defaultId ? byId.get(opts.defaultId) : undefined;
  if (dflt) return dflt;
  for (const id of opts.allowedIds) {
    const s = byId.get(id);
    if (s) return s;
  }
  return active[0];
}

const EMERGENCY_RE = /\b(emergenc(?:y|ies)|urgent)\b/i;

/**
 * An emergency request is urgent from the moment it lands: the service the
 * visitor chose says so ("Work Order — Emergency Dispatch") or the form exists
 * for nothing else ("Emergency Leak / Storm Damage"). Everything else starts at
 * normal and the office decides.
 */
export function intakePriority(opts: {
  serviceName?: string | null;
  serviceCategory?: string | null;
  formTitle?: string | null;
}): "urgent" | "normal" {
  const said = [opts.serviceName, opts.serviceCategory, opts.formTitle].filter(Boolean).join(" ");
  return EMERGENCY_RE.test(said) ? "urgent" : "normal";
}

/** Local hour a date-only preferred day is booked at: the start of a working morning. */
export const PREFERRED_DAY_HOUR = 9;

/**
 * The instant a visitor's "Preferred date" stands for. The form's date picker
 * sends a bare YYYY-MM-DD, which `new Date()` reads as UTC midnight: for a
 * Winnipeg company that is 7 PM the evening before, so the lead sat on the
 * wrong day of the schedule and the office email said so. A bare date is that
 * day on the company's clock (at PREFERRED_DAY_HOUR); a full timestamp is taken
 * as given. Unparseable or missing input is null.
 */
export function preferredStart(raw: unknown, tz: string): { at: Date; dateOnly: boolean } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
    return { at: zonedTimeToInstant(tz, y, mo, d, PREFERRED_DAY_HOUR, 0), dateOnly: true };
  }
  const at = new Date(s);
  return Number.isNaN(at.getTime()) ? null : { at, dateOnly: false };
}
