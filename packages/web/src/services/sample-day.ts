/**
 * Sample day — the pretend day of work every new ArrivePing company starts with.
 *
 * A brand-new account is an empty board, and empty boards teach nothing. So
 * provisioning seeds a small, believable day: three sample technicians, six
 * sample customers and eight jobs spread across the day (two done, one being
 * worked, one van on the road right now, three still to come, one waiting in
 * the queue). The Guide's chapters point at real rows instead of blank space,
 * and the on-the-way van moves on the map and on its tracking page, so the
 * core idea of the product is visible in the first minute.
 *
 * Safety is the whole design:
 *   - Every row carries `is_sample = true` (bookings, riders, user).
 *   - fireEvent, the delay watch and automations skip sample jobs, so nothing
 *     about them is ever texted, emailed, pushed or posted to a webhook.
 *   - Sample people have `.invalid` emails and 555-01xx phone numbers, and
 *     sendSms/sendEmail refuse both, so a path that forgets the flag still
 *     cannot reach anyone.
 *   - People are inserted straight into the tables: no auth account, no
 *     invite, no password. They can never sign in.
 *   - Reports, exports, billed seats and the HubSpot mirror leave them out.
 *
 * "Clear sample data" (admin) deletes all of it. Once cleared, the company is
 * never re-seeded on its own; an admin can add it back from the banner.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { attachMembership } from "../api/lib/memberships";
import { logJobEvent, type JobEventKind } from "./job-events";
import { publishTrack } from "./realtime";
import { sampleEmail, samplePhone } from "../shared/sample-contact";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Re-plan the day around "now" when an office user opens the app this long after the last plan. */
export const REANCHOR_AFTER_MS = 12 * HOUR;
/** How long one lap of the on-the-way van takes, start to doorstep. */
export const VAN_LAP_MS = 12 * MIN;
const FALLBACK_CENTER = { lat: 49.8951, lng: -97.1384 }; // Winnipeg

export interface SampleDayState {
  v: 1;
  seededAt?: string;
  /** The "now" the current plan was laid out around. */
  anchorAt?: string;
  clearedAt?: string;
  /** Service the sample jobs use. */
  serviceId?: string;
  /** Set when the company had no services and one was created for the sample day. */
  createdServiceId?: string;
}

export function parseSampleState(text: string | null | undefined): SampleDayState | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? ({ ...v, v: 1 } as SampleDayState) : null;
  } catch {
    return null;
  }
}

// ── The plan ─────────────────────────────────────────────────────────────────

interface SampleTech {
  key: string;
  first: string;
  last: string;
  color: string;
  vehicle: string;
  vehicleColor: string;
}
export const SAMPLE_TECHS: SampleTech[] = [
  { key: "t1", first: "Alex", last: "Rivera", color: "#0ea5e9", vehicle: "Ford Transit", vehicleColor: "White" },
  { key: "t2", first: "Jamie", last: "Fraser", color: "#f59e0b", vehicle: "Ram ProMaster", vehicleColor: "Silver" },
  { key: "t3", first: "Chris", last: "Dubois", color: "#a855f7", vehicle: "Chevrolet Express", vehicleColor: "Blue" },
];

interface SampleCustomer {
  key: string;
  first: string;
  last: string;
  street: string;
  /** Distance from the office (km) and compass bearing (degrees). */
  km: number;
  bearing: number;
}
export const SAMPLE_CUSTOMERS: SampleCustomer[] = [
  { key: "c1", first: "Jordan", last: "Patel", street: "142 Maple Avenue", km: 3.2, bearing: 20 },
  { key: "c2", first: "Avery", last: "Chen", street: "88 Birchwood Crescent", km: 5.1, bearing: 75 },
  { key: "c3", first: "Sam", last: "Okafor", street: "17 Lakeview Drive", km: 4.4, bearing: 140 },
  { key: "c4", first: "Riley", last: "Martin", street: "560 Prairie Road", km: 6.3, bearing: 200 },
  { key: "c5", first: "Casey", last: "Nguyen", street: "23 Elm Street", km: 2.6, bearing: 260 },
  { key: "c6", first: "Morgan", last: "Brooks", street: "301 Riverside Way", km: 7.0, bearing: 320 },
];

type SampleStatus = "completed" | "in_progress" | "enroute" | "assigned" | "pending";
interface SampleSlot {
  key: string;
  title: string;
  tech: number | null;
  cust: number;
  /** Minutes from the anchor to the scheduled start. */
  at: number;
  dur: number;
  status: SampleStatus;
  priority?: "normal" | "high" | "urgent";
  price: number;
  notes: string;
}
export const SAMPLE_SLOTS: SampleSlot[] = [
  { key: "j1", title: "Seasonal maintenance", tech: 0, cust: 0, at: -240, dur: 60, status: "completed", price: 149, notes: "Annual check. Side gate code 4411." },
  { key: "j2", title: "Repair visit", tech: 1, cust: 1, at: -150, dur: 75, status: "completed", price: 289, notes: "Customer reported a noise at start-up." },
  { key: "j3", title: "Inspection", tech: 1, cust: 2, at: -40, dur: 90, status: "in_progress", price: 199, notes: "Pre-sale inspection. Realtor will be on site." },
  { key: "j4", title: "Emergency call", tech: 0, cust: 3, at: 15, dur: 60, status: "enroute", priority: "urgent", price: 245, notes: "No service since this morning. Elderly resident, please call on arrival." },
  { key: "j5", title: "Installation", tech: 2, cust: 4, at: 120, dur: 180, status: "assigned", priority: "high", price: 1850, notes: "Equipment is in the garage. Bring the long ladder." },
  { key: "j6", title: "Follow-up visit", tech: 0, cust: 5, at: 210, dur: 45, status: "assigned", price: 0, notes: "Warranty follow-up, no charge." },
  { key: "j7", title: "Estimate", tech: null, cust: 0, at: 270, dur: 45, status: "pending", price: 0, notes: "Wants a quote for a replacement. Not assigned yet." },
  { key: "j8", title: "Warranty check", tech: 2, cust: 2, at: 22 * 60, dur: 60, status: "assigned", price: 0, notes: "Tomorrow morning." },
];

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);
/** Deterministic ids, so a retry or a second server instance can never double-seed. */
export const sampleId = (companyId: string, key: string) => `smp-${shortHash(companyId)}-${key}`;

/** A point `km` away from `c` on compass `bearing`. Flat-earth is plenty at city scale. */
export function offset(c: { lat: number; lng: number }, km: number, bearing: number) {
  const rad = (bearing * Math.PI) / 180;
  const dLat = (km * Math.cos(rad)) / 111.32;
  const dLng = (km * Math.sin(rad)) / (111.32 * Math.cos((c.lat * Math.PI) / 180));
  return { lat: +(c.lat + dLat).toFixed(6), lng: +(c.lng + dLng).toFixed(6) };
}

/** Where the van starts its lap toward the on-the-way job. */
const vanStart = (job: { lat: number; lng: number }) => offset(job, 5, 215);

/** Where the van is `elapsedMs` into its trip; it loops so the demo never ends. */
export function vanPosition(job: { lat: number; lng: number }, elapsedMs: number) {
  const lap = ((elapsedMs % VAN_LAP_MS) + VAN_LAP_MS) % VAN_LAP_MS;
  // Stop just short of the door: arriving would need the real arrive flow.
  const f = Math.min(0.97, lap / VAN_LAP_MS);
  const s = vanStart(job);
  return {
    lat: +(s.lat + (job.lat - s.lat) * f).toFixed(6),
    lng: +(s.lng + (job.lng - s.lng) * f).toFixed(6),
    etaMins: Math.max(1, Math.ceil(((1 - f) * VAN_LAP_MS) / MIN)),
  };
}

/** The timestamps a slot carries for a given anchor. */
export function slotTimes(slot: SampleSlot, anchor: number) {
  const start = anchor + slot.at * MIN;
  const at = (ms: number) => new Date(ms);
  switch (slot.status) {
    case "completed":
      return { scheduledAt: at(start), enrouteAt: at(start - 20 * MIN), startedAt: at(start), finishedAt: at(start + slot.dur * MIN), etaMins: null };
    case "in_progress":
      return { scheduledAt: at(start), enrouteAt: at(start - 25 * MIN), startedAt: at(start + 5 * MIN), finishedAt: null, etaMins: null };
    case "enroute":
      return { scheduledAt: at(start), enrouteAt: at(anchor - 2 * MIN), startedAt: null, finishedAt: null, etaMins: Math.round(slot.at) };
    default:
      return { scheduledAt: at(start), enrouteAt: null, startedAt: null, finishedAt: null, etaMins: null };
  }
}

const EVENTS_FOR: Record<SampleStatus, JobEventKind[]> = {
  pending: ["created"],
  assigned: ["created", "assigned"],
  enroute: ["created", "assigned", "enroute"],
  in_progress: ["created", "assigned", "enroute", "arrived", "started"],
  completed: ["created", "assigned", "enroute", "arrived", "started", "completed"],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadCompany(companyId: string) {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  return co ?? null;
}

async function saveState(companyId: string, state: SampleDayState) {
  await db.update(schema.companies).set({ sampleData: JSON.stringify(state) }).where(eq(schema.companies.id, companyId));
}

async function centerFor(companyId: string, co: typeof schema.companies.$inferSelect) {
  if (co.officeLat != null && co.officeLng != null) return { lat: co.officeLat, lng: co.officeLng };
  const s = await tdb(companyId).selectOne(schema.companySettings).catch(() => undefined);
  if (s && (s.address || "").trim() && Number.isFinite(s.lat) && Number.isFinite(s.lng)) return { lat: s.lat, lng: s.lng };
  return FALLBACK_CENTER;
}

/** Sample rows that exist for the company right now. */
export async function sampleRows(companyId: string) {
  const t = tdb(companyId);
  const [users, riders, bookings] = await Promise.all([
    t.select(schema.user, and(eq(schema.user.isSample, true), eq(schema.user.companyId, companyId))),
    t.select(schema.riders, eq(schema.riders.isSample, true)),
    t.select(schema.bookings, eq(schema.bookings.isSample, true)),
  ]);
  return { users, riders, bookings };
}

export function slotOf(b: { fieldData: string }): string | null {
  try {
    const v = JSON.parse(b.fieldData || "{}").__sample;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function logHistory(companyId: string, bookingId: string, slot: SampleSlot, techName: string) {
  for (const kind of EVENTS_FOR[slot.status]) {
    await logJobEvent({
      companyId,
      bookingId,
      kind,
      actorRole: kind === "created" || kind === "assigned" ? "dispatch" : "tech",
      actorName: kind === "created" || kind === "assigned" ? "Sample day" : techName,
      meta: { sample: true },
    });
  }
}

// ── Seed ─────────────────────────────────────────────────────────────────────

export interface SeedResult {
  seeded: boolean;
  reason?: string;
  techs: number;
  customers: number;
  jobs: number;
}

/**
 * Lay out the sample day for a company. Safe to call more than once: it does
 * nothing if sample rows already exist, or (unless `force`) if the company has
 * had a sample day before, including one that was cleared.
 */
export async function seedSampleDay(
  companyId: string,
  opts: { force?: boolean; now?: Date } = {},
): Promise<SeedResult> {
  const none = (reason: string): SeedResult => ({ seeded: false, reason, techs: 0, customers: 0, jobs: 0 });
  const co = await loadCompany(companyId);
  if (!co) return none("no such company");
  const prior = parseSampleState(co.sampleData);
  if (prior && !opts.force) return none(prior.clearedAt ? "cleared" : "already seeded");
  const existing = await sampleRows(companyId);
  if (existing.bookings.length || existing.users.length) return none("already present");

  const t = tdb(companyId);
  const now = opts.now ?? new Date();
  const anchor = Math.floor(now.getTime() / (5 * MIN)) * 5 * MIN;
  const center = await centerFor(companyId, co);

  // Service: reuse the company's first active one; only create one if they have none.
  const services = await t.select(schema.services, eq(schema.services.active, true));
  services.sort((a, z) => Number(a.createdAt) - Number(z.createdAt));
  let serviceId = services[0]?.id;
  let createdServiceId: string | undefined;
  if (!serviceId) {
    const [svc] = await t.insert(schema.services, {
      name: "Service call",
      category: "general",
      description: "Added with the sample day. Rename it or add your own services.",
      durationMins: 60,
      active: true,
    });
    serviceId = svc!.id;
    createdServiceId = svc!.id;
  }

  // People. Straight inserts: no auth account, no invite, no message of any kind.
  const techUsers: { userId: string; riderId: string; name: string }[] = [];
  for (const [i, tech] of SAMPLE_TECHS.entries()) {
    const userId = sampleId(companyId, `u-${tech.key}`);
    const name = `${tech.first} ${tech.last} (sample)`;
    const phone = samplePhone(10 + i);
    await t.insert(schema.user, {
      id: userId,
      name,
      firstName: tech.first,
      lastName: `${tech.last} (sample)`,
      email: sampleEmail(companyId, tech.key),
      role: "rider",
      phone,
      isSample: true,
    });
    await attachMembership({ userId, companyId, role: "rider", staffType: "technician", status: "active" });
    const riderId = sampleId(companyId, `r-${tech.key}`);
    const home = offset(center, 1.5 + i, 90 * i + 30);
    await t.insert(schema.riders, {
      id: riderId,
      userId,
      vehicle: tech.vehicle,
      vehicleColor: tech.vehicleColor,
      color: tech.color,
      phone,
      skillClass: "General",
      status: "available",
      approval: "active",
      lat: home.lat,
      lng: home.lng,
      locationUpdatedAt: now,
      notes: "Sample technician. Remove with “Clear sample data”.",
      isSample: true,
    });
    techUsers.push({ userId, riderId, name });
  }

  const custUsers: { userId: string; name: string; phone: string; address: string; lat: number; lng: number }[] = [];
  for (const [i, c] of SAMPLE_CUSTOMERS.entries()) {
    const userId = sampleId(companyId, `u-${c.key}`);
    const name = `${c.first} ${c.last} (sample)`;
    const phone = samplePhone(20 + i);
    const pos = offset(center, c.km, c.bearing);
    await t.insert(schema.user, {
      id: userId,
      name,
      firstName: c.first,
      lastName: `${c.last} (sample)`,
      email: sampleEmail(companyId, c.key),
      role: "customer",
      phone,
      address: c.street,
      customerType: "repeat",
      isSample: true,
    });
    await attachMembership({ userId, companyId, role: "customer", status: "active" });
    custUsers.push({ userId, name, phone, address: c.street, ...pos });
  }

  // Jobs.
  for (const slot of SAMPLE_SLOTS) {
    const cust = custUsers[slot.cust]!;
    const tech = slot.tech == null ? null : techUsers[slot.tech]!;
    const times = slotTimes(slot, anchor);
    const id = sampleId(companyId, slot.key);
    await t.insert(schema.bookings, {
      id,
      customerId: cust.userId,
      serviceId,
      riderId: tech?.riderId ?? null,
      title: slot.title,
      priority: slot.priority ?? "normal",
      status: slot.status,
      address: cust.address,
      lat: cust.lat,
      lng: cust.lng,
      notes: slot.notes,
      price: slot.price,
      subtotal: slot.price,
      total: slot.price,
      customerPhone: cust.phone,
      fieldData: JSON.stringify({ __sample: slot.key }),
      isSample: true,
      ...times,
      onSiteMinutes: slot.status === "completed" ? slot.dur : 0,
    });
    await logHistory(companyId, id, slot, tech?.name ?? "");
  }

  await saveState(companyId, {
    v: 1,
    seededAt: now.toISOString(),
    anchorAt: new Date(anchor).toISOString(),
    serviceId,
    ...(createdServiceId ? { createdServiceId } : {}),
  });
  await sampleTick(now, companyId).catch(() => {});
  return { seeded: true, techs: techUsers.length, customers: custUsers.length, jobs: SAMPLE_SLOTS.length };
}

// ── Keep it current ──────────────────────────────────────────────────────────

/**
 * Re-lay the sample jobs around `now` when the plan is more than 12 hours old,
 * so a company that signs up on Monday and comes back on Thursday still sees a
 * day in progress, not a wall of overdue work. Called when an office user
 * loads the app (GET /api/sample-day), never from a timer, so the day is always
 * laid out around a time someone is actually looking.
 */
export async function refreshSampleDay(companyId: string, now = new Date()): Promise<boolean> {
  const co = await loadCompany(companyId);
  const state = parseSampleState(co?.sampleData);
  if (!co || !state?.anchorAt || state.clearedAt) return false;
  if (now.getTime() - Date.parse(state.anchorAt) < REANCHOR_AFTER_MS) return false;

  const t = tdb(companyId);
  const anchor = Math.floor(now.getTime() / (5 * MIN)) * 5 * MIN;
  const { bookings, riders, users } = await sampleRows(companyId);
  const riderName = new Map(riders.map((r) => [r.id, users.find((u) => u.id === r.userId)?.name ?? ""]));
  const ids = bookings.map((b) => b.id);
  if (ids.length) await t.delete(schema.jobEvents, inArray(schema.jobEvents.bookingId, ids));
  for (const b of bookings) {
    const slot = SAMPLE_SLOTS.find((s) => s.key === slotOf(b));
    if (!slot) continue;
    await t.update(
      schema.bookings,
      {
        status: slot.status,
        ...slotTimes(slot, anchor),
        deletedAt: null,
        delayFlaggedAt: null,
        delayFlaggedMins: null,
        onSiteMinutes: slot.status === "completed" ? slot.dur : 0,
      },
      eq(schema.bookings.id, b.id),
    );
    await logHistory(companyId, b.id, slot, b.riderId ? riderName.get(b.riderId) ?? "" : "");
  }
  await saveState(companyId, { ...state, anchorAt: new Date(anchor).toISOString() });
  return true;
}

/**
 * Once a minute: give sample technicians a heartbeat and a position, and drive
 * the on-the-way van. Pushes the van's position to its tracking page's live
 * stream, exactly like a real phone ping would, but writes no ping row and
 * runs no geofence, so it can never auto-arrive (which would notify people).
 */
export async function sampleTick(now = new Date(), onlyCompany?: string): Promise<{ companies: number; moved: number }> {
  const riders = await sdb
    .select()
    .from(schema.riders)
    .where(onlyCompany ? and(eq(schema.riders.isSample, true), eq(schema.riders.companyId, onlyCompany)) : eq(schema.riders.isSample, true));
  if (!riders.length) return { companies: 0, moved: 0 };
  const companies = [...new Set(riders.map((r) => r.companyId))];
  let moved = 0;
  for (const companyId of companies) {
    const t = tdb(companyId);
    const live = await t.select(
      schema.bookings,
      and(eq(schema.bookings.isSample, true), inArray(schema.bookings.status, ["enroute", "arrived", "in_progress"])),
    );
    for (const r of riders.filter((x) => x.companyId === companyId)) {
      const mine = live.filter((b) => b.riderId === r.id && !b.deletedAt);
      const driving = mine.find((b) => b.status === "enroute");
      const working = mine.find((b) => b.status === "in_progress" || b.status === "arrived");
      let pos = { lat: r.lat ?? FALLBACK_CENTER.lat, lng: r.lng ?? FALLBACK_CENTER.lng };
      let status = "available";
      if (driving) {
        const since = driving.enrouteAt ? now.getTime() - Number(driving.enrouteAt) : 0;
        const v = vanPosition({ lat: driving.lat, lng: driving.lng }, since);
        pos = { lat: v.lat, lng: v.lng };
        status = "enroute";
        await t.update(schema.bookings, { etaMins: v.etaMins }, eq(schema.bookings.id, driving.id));
        void publishTrack({ type: "location", token: driving.publicToken, data: { lat: v.lat, lng: v.lng } });
        void publishTrack({ type: "eta", token: driving.publicToken, data: { etaMins: v.etaMins } });
      } else if (working) {
        pos = { lat: working.lat, lng: working.lng };
        status = "onsite";
      }
      await t.update(
        schema.riders,
        { lat: pos.lat, lng: pos.lng, status, locationUpdatedAt: now, manualOffline: false },
        eq(schema.riders.id, r.id),
      );
      moved++;
    }
  }
  return { companies: companies.length, moved };
}

// ── Clear ────────────────────────────────────────────────────────────────────

export interface ClearResult {
  jobs: number;
  people: number;
  /** Your own jobs that were booked for a sample customer, removed with them. */
  linkedJobs: number;
  /** Your own jobs that had a sample technician, now unassigned. */
  unassigned: number;
}

/**
 * Remove every sample row. Your own work is kept: a real job that was given to
 * a sample technician goes back to unassigned. A job booked for a sample
 * customer is removed with them, because that customer is fictional.
 */
export async function clearSampleDay(companyId: string, now = new Date()): Promise<ClearResult> {
  const t = tdb(companyId);
  const co = await loadCompany(companyId);
  const state = parseSampleState(co?.sampleData) ?? { v: 1 as const };
  const { users, riders, bookings } = await sampleRows(companyId);
  const userIds = users.map((u) => u.id);
  const riderIds = riders.map((r) => r.id);

  const linked = userIds.length
    ? await t.select(schema.bookings, and(eq(schema.bookings.isSample, false), inArray(schema.bookings.customerId, userIds)))
    : [];
  const ownWithSampleTech = riderIds.length
    ? await t.select(schema.bookings, and(eq(schema.bookings.isSample, false), inArray(schema.bookings.riderId, riderIds)))
    : [];
  const removeIds = [...bookings.map((b) => b.id), ...linked.map((b) => b.id)];
  const toUnassign = ownWithSampleTech.filter((b) => !removeIds.includes(b.id));

  for (const b of toUnassign) {
    // Any job that isn't finished goes back to the queue: an "arrived" or
    // "in progress" job with nobody on it would sit in an active state that
    // the queue never shows.
    const backToQueue = ["assigned", "accepted", "enroute", "arrived", "in_progress"].includes(b.status);
    await t.update(
      schema.bookings,
      { riderId: null, ...(backToQueue ? { status: "pending", assignStatus: "none" } : {}) },
      eq(schema.bookings.id, b.id),
    );
  }

  if (removeIds.length) {
    // Children first. Most cascade in Postgres; being explicit keeps this
    // correct even where a foreign key doesn't.
    await t.delete(schema.jobEvents, inArray(schema.jobEvents.bookingId, removeIds));
    await t.delete(schema.trackingPings, inArray(schema.trackingPings.bookingId, removeIds));
    await t.delete(schema.notifications, inArray(schema.notifications.bookingId, removeIds));
    await t.delete(schema.invoices, inArray(schema.invoices.bookingId, removeIds));
    await t.delete(schema.bookings, inArray(schema.bookings.id, removeIds));
  }
  if (riderIds.length) {
    await t.update(schema.reviews, { riderId: null } as never, inArray(schema.reviews.riderId, riderIds)).catch(() => {});
    await t.update(schema.deficiencies, { riderId: null } as never, inArray(schema.deficiencies.riderId, riderIds)).catch(() => {});
    await t.delete(schema.riders, inArray(schema.riders.id, riderIds));
  }
  if (userIds.length) {
    await t.delete(schema.memberships, inArray(schema.memberships.userId, userIds));
    await t.delete(schema.user, and(eq(schema.user.isSample, true), inArray(schema.user.id, userIds)));
  }

  // The service created for the sample day goes too, unless real work uses it now.
  if (state.createdServiceId) {
    const inUse = await t.selectOne(schema.bookings, eq(schema.bookings.serviceId, state.createdServiceId));
    if (!inUse) await t.delete(schema.services, eq(schema.services.id, state.createdServiceId)).catch(() => {});
  }

  await saveState(companyId, { v: 1, seededAt: state.seededAt, clearedAt: now.toISOString() });
  return { jobs: bookings.length, people: userIds.length, linkedJobs: linked.length, unassigned: toUnassign.length };
}

// ── Status ───────────────────────────────────────────────────────────────────

export interface SampleStatusResult {
  active: boolean;
  jobs: number;
  techs: number;
  customers: number;
  seededAt: string | null;
  clearedAt: string | null;
  /** The live van's tracking token, so the banner can link to its customer page. */
  trackToken: string | null;
}

export async function sampleStatus(companyId: string): Promise<SampleStatusResult> {
  const co = await loadCompany(companyId);
  const state = parseSampleState(co?.sampleData);
  const { users, riders, bookings } = await sampleRows(companyId);
  const live = bookings.find((b) => b.status === "enroute" && !b.deletedAt);
  return {
    active: bookings.length > 0 || users.length > 0,
    jobs: bookings.filter((b) => !b.deletedAt).length,
    techs: riders.length,
    customers: users.filter((u) => u.role === "customer").length,
    seededAt: state?.seededAt ?? null,
    clearedAt: state?.clearedAt ?? null,
    trackToken: live?.publicToken ?? null,
  };
}
