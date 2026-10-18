/**
 * Practice job — one pretend job for a new technician's first run of the app
 * (blueprint 2026-10-17, Phase 5).
 *
 * The app's four coach marks end on "Start Driving", and that button means
 * nothing on an empty job list. So the first time a technician opens the app
 * at a company, they get one practice job of their own: assigned and accepted,
 * half an hour from now, at the company's office address. They can tap
 * through Start Driving → I've Arrived → Complete exactly as on a real job.
 *
 * It's a sample row (services/sample-day.ts), so nobody is ever messaged:
 *   - the job and its customer carry `is_sample = true`; fireEvent, the delay
 *     watch and automations skip it;
 *   - the customer ("Pat Practice (sample)") has a `.invalid` email and a
 *     555-01xx number, which the senders refuse anyway;
 *   - payouts, the Earnings screen, today's stats, reports and exports leave
 *     it out, and it's priced at $0.
 *
 * One per technician per company, ever: `practiceJobAt` on their membership's
 * onboarding record stops a second one after it's removed or on a new phone.
 * A technician who has already completed a real job here gets none.
 * The technician can remove it from the job screen; "Clear sample data"
 * removes it too.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { attachMembership } from "../api/lib/memberships";
import { parseOnboarding } from "../shared/onboarding";
import { sampleEmail, samplePhone } from "../shared/sample-contact";
import { offset, PRACTICE_SLOT, practiceCustomerId, sampleId, parseSampleState } from "./sample-day";

const MIN = 60_000;
const FALLBACK_CENTER = { lat: 49.8951, lng: -97.1384 }; // Winnipeg

export const practiceJobId = (companyId: string, riderId: string) =>
  sampleId(companyId, `practice-${createHash("sha256").update(riderId).digest("hex").slice(0, 10)}`);

export type PracticeResult =
  | { jobId: string; created: boolean }
  | { jobId: null; reason: "not a technician" | "already had one" | "experienced" | "no services" };

async function membershipOf(companyId: string, userId: string) {
  return tdb(companyId).selectOne(schema.memberships, eq(schema.memberships.userId, userId));
}

/** Where the practice job is: the office, so "Navigate" goes somewhere the technician knows. */
async function practicePlace(companyId: string) {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (co?.officeAddress?.trim() && co.officeLat != null && co.officeLng != null)
    return { address: co.officeAddress.trim(), lat: co.officeLat, lng: co.officeLng };
  const s = await tdb(companyId).selectOne(schema.companySettings).catch(() => undefined);
  if (s && (s.address || "").trim() && Number.isFinite(s.lat) && Number.isFinite(s.lng)) return { address: s.address.trim(), lat: s.lat, lng: s.lng };
  const center = co?.officeLat != null && co?.officeLng != null ? { lat: co.officeLat, lng: co.officeLng } : FALLBACK_CENTER;
  const p = offset(center, 0.8, 60);
  return { address: "1 Practice Street", lat: p.lat, lng: p.lng };
}

async function ensurePracticeCustomer(companyId: string) {
  const t = tdb(companyId);
  const id = practiceCustomerId(companyId);
  const existing = await t.selectOne(schema.user, eq(schema.user.id, id));
  if (existing) return existing;
  const [u] = await t.insert(schema.user, {
    id,
    name: "Pat Practice (sample)",
    firstName: "Pat",
    lastName: "Practice (sample)",
    email: sampleEmail(companyId, "practice"),
    role: "customer",
    phone: samplePhone(40),
    isSample: true,
  });
  await attachMembership({ userId: id, companyId, role: "customer", status: "active" });
  return u!;
}

/**
 * Give this technician their practice job if they've never had one here.
 * Idempotent: returns the existing one while it's still there.
 */
export async function ensurePracticeJob(companyId: string, userId: string, now = new Date()): Promise<PracticeResult> {
  const t = tdb(companyId);
  const [rider, member] = await Promise.all([t.selectOne(schema.riders, eq(schema.riders.userId, userId)), membershipOf(companyId, userId)]);
  if (!rider || rider.isSample || !member || member.role !== "rider") return { jobId: null, reason: "not a technician" };

  const id = practiceJobId(companyId, rider.id);
  const existing = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
  if (existing && !existing.deletedAt) return { jobId: id, created: false };
  const state = parseOnboarding(member.onboarding);
  if (state.practiceJobAt) return { jobId: null, reason: "already had one" };
  // Someone who has already finished real work here doesn't need practice
  // (technicians who were on the team before this shipped, mostly).
  const done = await t.selectOne(
    schema.bookings,
    and(eq(schema.bookings.riderId, rider.id), eq(schema.bookings.status, "completed"), eq(schema.bookings.isSample, false)),
  );
  if (done) return { jobId: null, reason: "experienced" };

  // The sample day's service if there is one, otherwise the company's first.
  const [co] = await db.select({ sampleData: schema.companies.sampleData }).from(schema.companies).where(eq(schema.companies.id, companyId));
  const sampleService = parseSampleState(co?.sampleData)?.serviceId;
  const services = await t.select(schema.services, eq(schema.services.active, true));
  services.sort((a, z) => Number(a.createdAt) - Number(z.createdAt));
  const serviceId = services.find((s) => s.id === sampleService)?.id ?? services[0]?.id;
  if (!serviceId) return { jobId: null, reason: "no services" };

  const cust = await ensurePracticeCustomer(companyId);
  const place = await practicePlace(companyId);
  const at = new Date(Math.ceil((now.getTime() + 30 * MIN) / (5 * MIN)) * 5 * MIN);
  await t.insert(schema.bookings, {
    id,
    customerId: cust.id,
    serviceId,
    riderId: rider.id,
    title: "Practice job",
    status: "assigned",
    assignStatus: "accepted",
    assignedAt: now,
    acceptedAt: now,
    scheduledAt: at,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    notes: "Practice job. Try Start Driving, I've Arrived and Complete. Nobody is texted and it isn't paid. Remove it from this screen any time.",
    price: 0,
    subtotal: 0,
    total: 0,
    customerPhone: cust.phone ?? "",
    fieldData: JSON.stringify({ __sample: PRACTICE_SLOT }),
    isSample: true,
  });
  // Remember it on the membership, so it's never handed out twice.
  await t.update(
    schema.memberships,
    { onboarding: JSON.stringify({ ...state, practiceJobAt: now.toISOString() }), updatedAt: now },
    eq(schema.memberships.id, member.id),
  );
  return { jobId: id, created: true };
}

/** Remove this technician's practice job (and its history). Their own jobs are never touched. */
export async function removePracticeJob(companyId: string, userId: string): Promise<{ removed: number }> {
  const t = tdb(companyId);
  const rider = await t.selectOne(schema.riders, eq(schema.riders.userId, userId));
  if (!rider) return { removed: 0 };
  const id = practiceJobId(companyId, rider.id);
  const job = await t.selectOne(schema.bookings, and(eq(schema.bookings.id, id), eq(schema.bookings.isSample, true)));
  if (!job) return { removed: 0 };
  const ids = [id];
  await t.delete(schema.jobEvents, inArray(schema.jobEvents.bookingId, ids));
  await t.delete(schema.trackingPings, inArray(schema.trackingPings.bookingId, ids));
  await t.delete(schema.notifications, inArray(schema.notifications.bookingId, ids));
  await t.delete(schema.invoices, inArray(schema.invoices.bookingId, ids));
  await t.delete(schema.bookings, and(eq(schema.bookings.id, id), eq(schema.bookings.isSample, true)));
  // A rider whose status is still "enroute"/"onsite" from the practice job goes back to available.
  if (rider.status === "enroute" || rider.status === "onsite" || rider.status === "busy") {
    const other = await t.selectOne(
      schema.bookings,
      and(eq(schema.bookings.riderId, rider.id), inArray(schema.bookings.status, ["enroute", "arrived", "in_progress"])),
    );
    if (!other) await t.update(schema.riders, { status: "available" }, eq(schema.riders.id, rider.id));
  }
  return { removed: 1 };
}
