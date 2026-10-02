/**
 * Media manifest — every replaceable motion slot on the marketing site.
 *
 * Replacement contract: to swap a DOM/SVG scene for supplied video, set
 * `kind: "video"` and add `desktopSrc` (+ optional `mobileSrc`, `posterSrc`).
 * Layout, aspect ratio, pause behaviour and alignment are owned by
 * <MediaSlot> and do not change. If a source is missing or fails to load,
 * the `fallbackScene` renders instead — never a broken <video>.
 */

export type SceneName =
  | "HeroDispatchArrival"
  | "DispatchAssign"
  | "RouteAndCustomerETA"
  | "UpdateToCustomer"
  | "ListStatusSettle"
  | "CustomerCardUpdate"
  | "ClosingStatus";

export type MediaSlot = {
  id: string;
  kind: "dom" | "video";
  desktopSrc?: string;
  mobileSrc?: string;
  posterSrc?: string;
  /** CSS aspect-ratio value, e.g. "16 / 10" */
  aspectRatio: string;
  /** Aspect ratio below 640px viewports; stacked scenes need a taller frame. */
  mobileAspectRatio?: string;
  fit: "contain" | "cover";
  muted: boolean;
  repeat: boolean;
  decorative: boolean;
  fallbackScene: SceneName;
  accessibleSummary: string;
};

export const mediaSlots: MediaSlot[] = [
  {
    id: "hero-overview",
    kind: "dom",
    aspectRatio: "16 / 7",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "HeroDispatchArrival",
    accessibleSummary:
      "Illustrative appointment status shared between the business and the customer: the technician is marked on the way and the customer's arrival page updates.",
  },
  {
    id: "chapter-dispatch",
    kind: "dom",
    aspectRatio: "16 / 10",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "DispatchAssign",
    accessibleSummary:
      "Illustrative dispatch board: an unassigned appointment is selected, its detail opens and a technician is assigned.",
  },
  {
    id: "chapter-arrival",
    kind: "dom",
    aspectRatio: "16 / 10",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "RouteAndCustomerETA",
    accessibleSummary:
      "Illustrative arrival update: a marker advances along an abstract route while the customer's arrival window updates in sync.",
  },
  {
    id: "chapter-communication",
    kind: "dom",
    aspectRatio: "16 / 10",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "UpdateToCustomer",
    accessibleSummary:
      "Illustrative update: the office writes a short delay notice and the customer's notification and arrival page change together.",
  },
  {
    id: "detail-visibility",
    kind: "dom",
    aspectRatio: "4 / 3",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "ListStatusSettle",
    accessibleSummary: "Illustrative appointment list in which one status changes and settles.",
  },
  {
    id: "detail-customer",
    kind: "dom",
    aspectRatio: "4 / 3",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "CustomerCardUpdate",
    accessibleSummary: "Illustrative customer arrival card and message preview showing one coordinated update.",
  },
  {
    id: "closing-motif",
    kind: "dom",
    aspectRatio: "16 / 10",
    fit: "contain",
    muted: true,
    repeat: false,
    decorative: true,
    fallbackScene: "ClosingStatus",
    accessibleSummary: "Illustrative arrival status moving from scheduled to arrived.",
  },
];

export function slot(id: string): MediaSlot {
  const s = mediaSlots.find((m) => m.id === id);
  if (!s) throw new Error(`Unknown media slot: ${id}`);
  return s;
}
