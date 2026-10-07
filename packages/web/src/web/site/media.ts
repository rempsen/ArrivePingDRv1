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
    kind: "video",
    desktopSrc: "/media/site-hero-16x7.mp4",
    mobileSrc: "/media/site-hero-3x4.mp4",
    posterSrc: "/media/site-hero-16x7-poster.jpg",
    aspectRatio: "16 / 7",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "HeroDispatchArrival",
    accessibleSummary:
      "The ArrivePing app on a dispatcher's board and a technician's iPhone: a job alert arrives, the customer's live map shows the technician on the way, then confirms the technician has arrived.",
  },
  {
    id: "chapter-dispatch",
    kind: "video",
    desktopSrc: "/media/site-dispatch-16x10.mp4",
    mobileSrc: "/media/site-dispatch-3x4.mp4",
    posterSrc: "/media/site-dispatch-16x10-poster.jpg",
    aspectRatio: "16 / 10",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "DispatchAssign",
    accessibleSummary:
      "The ArrivePing dispatch board with the day's jobs, and the assigned technician's iPhone receiving the new job alert on the lock screen.",
  },
  {
    id: "chapter-arrival",
    kind: "video",
    desktopSrc: "/media/site-arrival-16x10.mp4",
    mobileSrc: "/media/site-arrival-3x4.mp4",
    posterSrc: "/media/site-arrival-16x10-poster.jpg",
    aspectRatio: "16 / 10",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "RouteAndCustomerETA",
    accessibleSummary:
      "The office's live map of technicians beside the customer's arrival page, which shows the technician's route, a minutes-away estimate and live status.",
  },
  {
    id: "chapter-communication",
    kind: "video",
    desktopSrc: "/media/site-comms-16x10.mp4",
    mobileSrc: "/media/site-comms-3x4.mp4",
    posterSrc: "/media/site-comms-16x10-poster.jpg",
    aspectRatio: "16 / 10",
    mobileAspectRatio: "3 / 4",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "UpdateToCustomer",
    accessibleSummary:
      "Two iPhones: the technician's job screen with the customer conversation, and the customer's live arrival page for the same appointment.",
  },
  {
    id: "detail-visibility",
    kind: "video",
    desktopSrc: "/media/feature-dispatch-4x3.mp4",
    posterSrc: "/media/feature-dispatch-4x3-poster.jpg",
    aspectRatio: "4 / 3",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "ListStatusSettle",
    accessibleSummary:
      "The ArrivePing dispatch board listing the day's appointments with their technicians and status.",
  },
  {
    id: "detail-customer",
    kind: "video",
    desktopSrc: "/media/feature-tracking-4x3.mp4",
    posterSrc: "/media/feature-tracking-4x3-poster.jpg",
    aspectRatio: "4 / 3",
    fit: "contain",
    muted: true,
    repeat: true,
    decorative: true,
    fallbackScene: "CustomerCardUpdate",
    accessibleSummary:
      "The customer's live arrival page on an iPhone: the technician's route on a map, minutes away and live status.",
  },
  {
    id: "closing-motif",
    kind: "video",
    desktopSrc: "/media/site-closing-16x10.mp4",
    posterSrc: "/media/site-closing-16x10-poster.jpg",
    aspectRatio: "16 / 10",
    fit: "contain",
    muted: true,
    repeat: false,
    decorative: true,
    fallbackScene: "ClosingStatus",
    accessibleSummary:
      "The customer's arrival page changing from on the way to 'Your technician has arrived!'.",
  },
];

export function slot(id: string): MediaSlot {
  const s = mediaSlots.find((m) => m.id === id);
  if (!s) throw new Error(`Unknown media slot: ${id}`);
  return s;
}
