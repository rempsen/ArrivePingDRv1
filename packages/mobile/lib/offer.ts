/**
 * Job offers in the field app: the reasons a tech can give for declining, and
 * what each button on an offer push does. Pure (no react-native) so bun can
 * test it.
 */

/**
 * Must match DECLINE_REASONS / DECLINE_REASON_LABELS in
 * packages/web/src/shared/offer.ts (a web test checks). The offer endpoint
 * also sends the list, which wins when it's there, so a new server reason
 * shows up without an app update.
 */
export const DECLINE_REASONS: { key: string; label: string }[] = [
  { key: "too_far", label: "Too far away" },
  { key: "schedule_conflict", label: "Schedule conflict" },
  { key: "not_qualified", label: "Not qualified for this job" },
  { key: "vehicle_equipment", label: "Vehicle or equipment issue" },
  { key: "personal", label: "Personal reason" },
  { key: "other", label: "Other" },
];

/** Must match JOB_OFFER_CATEGORY / JOB_OFFER_ACTIONS in packages/web/src/shared/offer.ts. */
export const JOB_OFFER_CATEGORY = "job_offer";
export const OFFER_ACTION = { accept: "accept", details: "details", decline: "decline" } as const;

/** The offer details screen; `decline` opens the reason sheet straight away. */
export function offerPath(bookingId: string, opts: { decline?: boolean } = {}): string {
  return `/offer/${encodeURIComponent(bookingId)}${opts.decline ? "?decline=1" : ""}`;
}

export type OfferPushStep =
  | { kind: "accept"; bookingId: string }
  | { kind: "open"; path: string }
  | { kind: "none" };

/**
 * What to do with a tap on an offer push. Accept is done for the tech, then
 * the job opens. Decline opens the details with the reason sheet up, because
 * a reason is needed. Details, or a tap on the push itself, opens the details.
 * Anything that isn't an offer push is left to the normal routing.
 */
export function offerPushStep(
  data: { event?: unknown; bookingId?: unknown } | undefined,
  actionId: string | undefined,
): OfferPushStep {
  const id = typeof data?.bookingId === "string" ? data.bookingId : "";
  if (!id || data?.event !== "assigned") return { kind: "none" };
  if (actionId === OFFER_ACTION.accept) return { kind: "accept", bookingId: id };
  if (actionId === OFFER_ACTION.decline) return { kind: "open", path: offerPath(id, { decline: true }) };
  return { kind: "open", path: offerPath(id) };
}

/** "1 h 25 min", "45 min". */
export function fmtMins(mins: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Compact, for a narrow tile: "1h 35m", "45 min". */
export function fmtMinsShort(mins: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
