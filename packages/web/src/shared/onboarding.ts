/**
 * ArrivePing Guide — per-person onboarding state (memberships.onboarding).
 *
 * Plain types + merge, shared by the API and the web app. Kept free of zod so
 * the web bundle doesn't pull it in; the API validates PATCH bodies with the
 * schema in ./onboarding-schema.ts. Stored as JSON text, one record per
 * person per company; every field is optional so old or empty records parse.
 */
export type ChapterStatus = "completed" | "skipped";

export interface ChapterProgress {
  status: ChapterStatus;
  /** ISO timestamp. */
  at: string;
  /** Bumped when a chapter's steps change, so "what's new" can re-offer it. */
  version?: number;
}

export interface OnboardingState {
  v: 1;
  persona?: "owner" | "dispatcher" | "manager" | "other";
  teamSize?: "1-2" | "3-9" | "10-29" | "30+";
  goal?: "track" | "eta" | "schedule" | "explore";
  welcomeDoneAt?: string;
  tours: Record<string, ChapterProgress>;
  checklistHidden?: boolean;
}

export type OnboardingPatch = Partial<Omit<OnboardingState, "v">>;

export const EMPTY_ONBOARDING: OnboardingState = { v: 1, tours: {} };

/** Parses stored JSON text; anything unreadable becomes an empty record. */
export function parseOnboarding(text: string | null | undefined): OnboardingState {
  if (!text) return { v: 1, tours: {} };
  try {
    const raw = JSON.parse(text) as Partial<OnboardingState>;
    if (!raw || typeof raw !== "object") return { v: 1, tours: {} };
    const tours = raw.tours && typeof raw.tours === "object" ? raw.tours : {};
    return { ...raw, v: 1, tours };
  } catch {
    return { v: 1, tours: {} };
  }
}

/**
 * Merge a patch into the current state. Tour entries merge per chapter, and a
 * chapter once "completed" never goes back to "skipped" (replaying a finished
 * chapter and closing it early shouldn't un-tick it).
 */
export function mergeOnboarding(cur: OnboardingState, patch: OnboardingPatch): OnboardingState {
  const tours = { ...cur.tours };
  for (const [id, p] of Object.entries(patch.tours ?? {})) {
    tours[id] = tours[id]?.status === "completed" && p.status === "skipped" ? tours[id] : p;
  }
  const { tours: _ignored, ...rest } = patch;
  return { ...cur, ...rest, v: 1, tours };
}

/** Hard cap on stored size — the record is small by design. */
export const ONBOARDING_MAX_BYTES = 8 * 1024;
