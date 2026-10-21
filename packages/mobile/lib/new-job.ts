import { asap } from "./when";

/**
 * The quick-create draft and the `POST /api/bookings/admin` body it becomes.
 * Pure so the rules (what's required, how ASAP resolves, existing vs new
 * client) are testable without React Native.
 */
export type Priority = "low" | "normal" | "high" | "urgent";

export type DraftClient = { kind: "existing"; id: string; name: string; phone?: string; lastAddress?: string } | { kind: "new"; name: string; email: string; phone?: string };

export interface NewJobDraft {
  client: DraftClient | null;
  serviceId: string | null;
  title: string;
  priority: Priority;
  notes: string;
  staffNotes: string;
  address: string;
  lat: number | null;
  lng: number | null;
  when: { kind: "asap" } | { kind: "at"; iso: string } | null;
  riderId: string | null;
}

export const EMPTY_DRAFT: NewJobDraft = {
  client: null,
  serviceId: null,
  title: "",
  priority: "normal",
  notes: "",
  staffNotes: "",
  address: "",
  lat: null,
  lng: null,
  when: null,
  riderId: null,
};

export interface AdminBookingBody {
  serviceId: string;
  scheduledAt: string;
  address: string;
  lat?: number;
  lng?: number;
  title?: string;
  priority?: Priority;
  notes?: string;
  staffNotes?: string;
  phone?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  riderId?: string;
  force?: boolean;
}

export type DraftErrors = Partial<Record<"client" | "serviceId" | "address" | "when", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateDraft(d: NewJobDraft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.client) e.client = "Pick a client or add a new one";
  else if (d.client.kind === "new") {
    if (!d.client.name.trim()) e.client = "The new client needs a name";
    else if (!EMAIL.test(d.client.email.trim())) e.client = "The new client needs a valid email";
  }
  if (!d.serviceId) e.serviceId = "Pick a service";
  if (!d.address.trim()) e.address = "Enter the address";
  if (!d.when) e.when = "Pick a time";
  return e;
}

export function buildAdminBooking(d: NewJobDraft, now: Date, opts: { force?: boolean } = {}): { ok: true; body: AdminBookingBody } | { ok: false; errors: DraftErrors } {
  const errors = validateDraft(d);
  if (Object.keys(errors).length) return { ok: false, errors };
  const client = d.client!;
  const scheduledAt = d.when!.kind === "asap" ? asap(now).toISOString() : d.when!.iso;
  const body: AdminBookingBody = {
    serviceId: d.serviceId!,
    scheduledAt,
    address: d.address.trim(),
    priority: d.priority,
  };
  if (d.lat != null && d.lng != null) {
    body.lat = d.lat;
    body.lng = d.lng;
  }
  if (d.title.trim()) body.title = d.title.trim();
  if (d.notes.trim()) body.notes = d.notes.trim();
  if (d.staffNotes.trim()) body.staffNotes = d.staffNotes.trim();
  if (client.kind === "existing") {
    body.customerId = client.id;
    if (client.phone?.trim()) body.phone = client.phone.trim();
  } else {
    body.customerName = client.name.trim();
    body.customerEmail = client.email.trim().toLowerCase();
    if (client.phone?.trim()) body.phone = client.phone.trim();
  }
  if (d.riderId) body.riderId = d.riderId;
  if (opts.force) body.force = true;
  return { ok: true, body };
}
