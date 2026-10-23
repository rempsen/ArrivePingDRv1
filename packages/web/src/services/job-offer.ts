/**
 * Everything a tech needs to decide on a job offer, in one call: how far it is
 * and how long the drive takes from where they are now, what they would earn,
 * and what the job involves. The job itself (customer, address, notes, line
 * items) still comes from GET /api/bookings/:id; this adds what that endpoint
 * can't know.
 */
import { eq } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { log } from "../api/lib/logger";
import { parseLineItems } from "../shared/catalog";
import { haversineKm } from "../shared/geo-distance";
import {
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
  estimateOfferPay,
  offerChecklist,
  offerLines,
  skillList,
  type OfferLine,
  type OfferPayEstimate,
} from "../shared/offer";
import { typicalDurationMins } from "./ai-dispatch";
import { isFeatureOn } from "./features";
import { jobForm } from "./job-forms";
import { computeRoute } from "./routing";

type Booking = typeof schema.bookings.$inferSelect;
type Rider = typeof schema.riders.$inferSelect;

/** A last-known position older than this is shown as "last known", not "from you now". */
const FRESH_LOCATION_MS = 15 * 60_000;

/**
 * bookings.lat/lng default to downtown Toronto when an address never geocoded.
 * A job sitting exactly there while the tech is far away has no real location,
 * and a "1,500 km away" drive would scare a tech off a job next door.
 */
const DEFAULT_JOB_POINT = { lat: 43.6532, lng: -79.3832 };
function unplacedJob(job: { lat: number; lng: number }, from: { lat: number; lng: number }): boolean {
  const atDefault = Math.abs(job.lat - DEFAULT_JOB_POINT.lat) < 1e-4 && Math.abs(job.lng - DEFAULT_JOB_POINT.lng) < 1e-4;
  return atDefault && haversineKm(from.lat, from.lng, job.lat, job.lng) > 150;
}

export interface OfferDrive {
  km: number;
  mins: number;
  /** google = traffic-aware road route; osrm = road route; estimate = straight line at city speed. */
  provider: "google" | "osrm" | "estimate";
  /** How old the tech's position was, in minutes. */
  locationAgeMins: number;
  fresh: boolean;
}

export interface OfferPreview {
  bookingId: string;
  assignStatus: string;
  status: string;
  /** Expected on-site time, minutes, and where the number came from. */
  duration: { mins: number; source: "history" | "service" } | null;
  drive: OfferDrive | null;
  /** Why there is no drive time, when there isn't. */
  driveUnavailable: "" | "no_location" | "no_job_location" | "no_route";
  /** null when the company doesn't use technician pay. */
  pay: OfferPayEstimate | null;
  scope: {
    serviceName: string;
    description: string;
    category: string;
    priority: string;
    skillClass: string;
    skills: string[];
    lines: OfferLine[];
    checklist: { label: string; required: boolean }[];
    form: { name: string; questions: number; sections: string[] } | null;
  };
  declineReasons: { key: string; label: string }[];
}

export async function buildOfferPreview(
  companyId: string,
  b: Booking,
  rider: Rider | null,
  opts: { route?: typeof computeRoute; now?: number; showPay?: boolean } = {},
): Promise<OfferPreview> {
  const t = tdb(companyId);
  const now = opts.now ?? Date.now();
  const svc = b.serviceId ? await t.selectOne(schema.services, eq(schema.services.id, b.serviceId)) : null;

  // On-site time: the company's own history for this service beats the
  // catalogue default, which is often the 60-minute placeholder.
  const history = await typicalDurationMins(companyId, b.serviceId ?? null);
  const duration =
    history != null
      ? { mins: history, source: "history" as const }
      : svc?.durationMins
        ? { mins: svc.durationMins, source: "service" as const }
        : null;

  let drive: OfferDrive | null = null;
  let driveUnavailable: OfferPreview["driveUnavailable"] = "";
  if (rider && rider.lat != null && rider.lng != null && unplacedJob(b, { lat: rider.lat, lng: rider.lng })) {
    driveUnavailable = "no_job_location";
  } else if (rider && rider.lat != null && rider.lng != null) {
    try {
      const r = await (opts.route ?? computeRoute)({ lat: rider.lat, lng: rider.lng }, { lat: b.lat, lng: b.lng });
      if (r) {
        const ageMs = rider.locationUpdatedAt ? Math.max(0, now - new Date(rider.locationUpdatedAt).getTime()) : Infinity;
        drive = {
          km: Math.round((r.distanceM / 1000) * 10) / 10,
          mins: Math.max(1, Math.round(r.durationSec / 60)),
          provider: r.provider,
          locationAgeMins: Number.isFinite(ageMs) ? Math.round(ageMs / 60_000) : -1,
          fresh: ageMs <= FRESH_LOCATION_MS,
        };
      } else driveUnavailable = "no_route";
    } catch (e) {
      log.warn("job-offer: route failed", { error: e instanceof Error ? e.message : String(e) });
      driveUnavailable = "no_route";
    }
  } else driveUnavailable = "no_location";

  // The estimate reveals the tech's own rates, so only when the caller may see it.
  const pay =
    rider && opts.showPay !== false && (await isFeatureOn(companyId, "payouts.tech_pay"))
      ? estimateOfferPay(b, rider, { onSiteMinutes: duration?.mins ?? 0, driveKm: drive?.km ?? null })
      : null;

  let form: OfferPreview["scope"]["form"] = null;
  try {
    const f = await jobForm(companyId, b);
    if (f) {
      const items = f.form.items ?? [];
      form = {
        name: f.templateName,
        questions: f.progress.total,
        sections: items.filter((i) => i.type === "section").map((i) => i.label).filter(Boolean).slice(0, 20),
      };
    }
  } catch (e) {
    log.warn("job-offer: form lookup failed", { error: e instanceof Error ? e.message : String(e) });
  }

  return {
    bookingId: b.id,
    assignStatus: b.assignStatus,
    status: b.status,
    duration,
    drive,
    driveUnavailable,
    pay,
    scope: {
      serviceName: svc?.name || b.title || "",
      description: svc?.description || "",
      category: svc?.category || "",
      priority: b.priority || "",
      skillClass: b.requiredSkillClass || "",
      skills: skillList(b.requiredSkills),
      lines: offerLines(parseLineItems(b.lineItems)),
      checklist: offerChecklist(b.checklistState),
      form,
    },
    declineReasons: DECLINE_REASONS.map((key) => ({ key, label: DECLINE_REASON_LABELS[key] })),
  };
}
