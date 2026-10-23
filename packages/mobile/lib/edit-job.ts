/**
 * The work-order editor's model: what the screen holds, what's wrong with
 * it, and the PATCH it turns into. Pure, so bun tests cover the rules; the
 * screen is just inputs bound to a draft.
 *
 * The patch carries only what changed, except `fieldData`, which the API
 * overwrites whole (it keeps its own internal `__` keys), so any field edit
 * sends the whole object back the way the web modal does.
 */
import { parseLineItems, withTotals, type LineItem } from "./line-items";

export type Priority = "low" | "normal" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
/** The statuses the office sets by hand; the field ones belong to the technician's clock. */
export const OFFICE_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
export type OfficeStatus = (typeof OFFICE_STATUSES)[number];

export type FieldType = "text" | "number" | "checkbox" | "select" | "date" | "file" | "instructions" | string;
export interface CustomFieldDef {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
  body?: string;
}

export interface EditDraft {
  title: string;
  priority: Priority;
  status: string;
  serviceId: string;
  serviceName: string;
  customerId: string;
  customerName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  customerPhone: string;
  scheduledAt: string;
  notes: string;
  staffNotes: string;
  /** The whole fieldData object, public keys only; values live at `[def.id]`. */
  fieldData: Record<string, unknown>;
  fields: CustomFieldDef[];
  lineItems: LineItem[];
}

export type EditErrors = Partial<Record<"title" | "address" | "customerPhone" | "lineItems" | "fields", string>>;

interface BookingLike {
  title: string;
  priority: string;
  status: string;
  address: string;
  lat: number | null;
  lng: number | null;
  customerPhone?: string | null;
  scheduledAt: string;
  notes: string;
  staffNotes: string;
  customerId: string;
  service: { id: string; name: string } | null;
  customer: { id: string; name?: string | null; phone?: string | null } | null;
  fieldData?: unknown;
  lineItems?: unknown;
}

export function parseFieldData(raw: unknown): Record<string, unknown> {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      v = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith("__")) out[k] = val;
  return out;
}

export function fieldDefs(fieldData: Record<string, unknown>): CustomFieldDef[] {
  const defs = fieldData._customFields;
  if (!Array.isArray(defs)) return [];
  return defs.filter((d) => d && typeof d === "object" && typeof (d as CustomFieldDef).id === "string" && typeof (d as CustomFieldDef).type === "string") as CustomFieldDef[];
}

export function draftFromBooking(b: BookingLike): EditDraft {
  const fieldData = parseFieldData(b.fieldData);
  return {
    title: b.title ?? "",
    priority: (PRIORITIES as string[]).includes(b.priority) ? (b.priority as Priority) : "normal",
    status: b.status,
    serviceId: b.service?.id ?? "",
    serviceName: b.service?.name ?? "",
    customerId: b.customerId ?? b.customer?.id ?? "",
    customerName: b.customer?.name ?? "",
    address: b.address ?? "",
    lat: b.lat ?? null,
    lng: b.lng ?? null,
    customerPhone: b.customerPhone ?? b.customer?.phone ?? "",
    scheduledAt: b.scheduledAt,
    notes: b.notes ?? "",
    staffNotes: b.staffNotes ?? "",
    fieldData,
    fields: fieldDefs(fieldData),
    lineItems: parseLineItems(b.lineItems),
  };
}

const EDITABLE_FIELD_TYPES = new Set(["text", "number", "checkbox", "select", "date"]);

/** A field the screen can take a value for (photos, signatures and instructions are read-only here). */
export function isEditableField(def: CustomFieldDef): boolean {
  return EDITABLE_FIELD_TYPES.has(def.type);
}

function fieldEmpty(v: unknown): boolean {
  return v == null || v === "" || v === false;
}

/** The server's rule (api/lib/validate.ts `phone`): "(204) 632-9434" is the common form. */
const PHONE = /^[+(\d][\d\s()\-.]{5,}$/;

export function validateEdit(d: EditDraft, original?: EditDraft): EditErrors {
  const e: EditErrors = {};
  if (d.title.length > 200) e.title = "Keep the title under 200 characters.";
  // The API won't take an empty title; a job that had one keeps needing one.
  if (!d.title.trim() && original && original.title.trim()) e.title = "A title is needed — or put the service name back.";
  if (!d.address.trim()) e.address = "An address is needed.";
  // Only a phone this edit changed is checked: an older record the server
  // accepted stays saveable when only the notes change.
  const phoneChanged = !original || d.customerPhone !== original.customerPhone;
  if (phoneChanged && d.customerPhone.trim() && !PHONE.test(d.customerPhone.trim())) e.customerPhone = "That doesn't look like a phone number.";
  if (d.lineItems.some((li) => !(li.qty > 0) || li.unitPrice < 0 || !li.name.trim())) e.lineItems = "Every line needs a name, a quantity above zero and a price of zero or more.";
  const missing = d.fields.filter((f) => f.required && isEditableField(f) && fieldEmpty(d.fieldData[f.id]));
  if (missing.length) e.fields = `${missing.map((f) => f.label || "A field").join(", ")} ${missing.length === 1 ? "is" : "are"} required.`;
  return e;
}

export interface BookingPatch {
  title?: string;
  priority?: Priority;
  serviceId?: string;
  customerId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  customerPhone?: string;
  scheduledAt?: string;
  notes?: string;
  staffNotes?: string;
  fieldData?: Record<string, unknown>;
  lineItems?: LineItem[];
  force?: boolean;
}

function sameFields(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Only the keys that differ from the original draft. `lineItems` goes whole
 * with totals recomputed; `fieldData` goes whole. Status is not part of the
 * patch — it has its own endpoint (`POST /bookings/:id/status`).
 */
export function buildPatch(d: EditDraft, original: EditDraft, opts: { force?: boolean } = {}): BookingPatch {
  const p: BookingPatch = {};
  if (d.title !== original.title) p.title = d.title.trim();
  if (d.priority !== original.priority) p.priority = d.priority;
  if (d.serviceId !== original.serviceId && d.serviceId) p.serviceId = d.serviceId;
  if (d.customerId !== original.customerId && d.customerId) p.customerId = d.customerId;
  if (d.address !== original.address || d.lat !== original.lat || d.lng !== original.lng) {
    p.address = d.address.trim();
    if (d.lat != null && d.lng != null) {
      p.lat = d.lat;
      p.lng = d.lng;
    }
  }
  if (d.customerPhone !== original.customerPhone) p.customerPhone = d.customerPhone.trim();
  if (d.scheduledAt !== original.scheduledAt) p.scheduledAt = d.scheduledAt;
  if (d.notes !== original.notes) p.notes = d.notes;
  if (d.staffNotes !== original.staffNotes) p.staffNotes = d.staffNotes;
  if (!sameFields(d.fieldData, original.fieldData)) p.fieldData = d.fieldData;
  const items = d.lineItems.map(withTotals);
  if (JSON.stringify(items) !== JSON.stringify(original.lineItems.map(withTotals))) p.lineItems = items;
  if (opts.force) p.force = true;
  return p;
}

export function isEmptyPatch(p: BookingPatch): boolean {
  return Object.keys(p).filter((k) => k !== "force").length === 0;
}

/** The draft with one custom field's value set (an empty value removes the key). */
export function setFieldValue(d: EditDraft, id: string, value: unknown): EditDraft {
  const fieldData = { ...d.fieldData };
  if (value == null || value === "") delete fieldData[id];
  else fieldData[id] = value;
  return { ...d, fieldData };
}
