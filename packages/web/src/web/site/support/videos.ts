/**
 * Help Center videos — real ArrivePing screens, AI narration, hosted on the
 * ArrivePing YouTube channel (@arriveping).
 *
 * Shown on /support (the "Watch and learn" band), /support/videos, at the top
 * of every guide listed in `guides`, and in Help Center search.
 *
 * Rules:
 *  - Only list videos that are PUBLIC on YouTube. A private video embeds as
 *    "Video unavailable", so keep `live: false` until it is published.
 *  - Posters are our own thumbnails in public/media/support-videos/, so the
 *    page makes no request to YouTube until someone presses play.
 *  - `guides` are article slugs (see articles.ts). The first video listing a
 *    slug is the one shown on that article.
 */

export type VideoGroupId = "set-up" | "run-your-day" | "configure";

export interface Chapter {
  /** Seconds from the start. */
  at: number;
  title: string;
}

export interface HelpVideo {
  /** Stable key used in URLs: /support/videos?v=<key> */
  key: string;
  youtubeId: string;
  title: string;
  /** One line under the title. */
  summary: string;
  /** Length in seconds. */
  seconds: number;
  group: VideoGroupId;
  poster: string;
  /** Help articles this video belongs on, most relevant first. */
  guides: string[];
  chapters?: Chapter[];
  /** ISO date the video went public (for search engines). */
  uploaded: string;
  /** False until the video is public on YouTube. */
  live: boolean;
}

export const videoGroups: { id: VideoGroupId; title: string; blurb: string }[] = [
  { id: "set-up", title: "Get set up", blurb: "From signing up to your first look around." },
  { id: "run-your-day", title: "Run your day", blurb: "Create jobs, put them on the schedule and keep customers in the loop." },
  { id: "configure", title: "Set up how you work", blurb: "Your catalog, pricing options, job templates, forms, settings and team." },
];

const P = (k: string) => `/media/support-videos/${k}.webp`;
const UP = "2026-10-31";

export const videos: HelpVideo[] = [
  {
    key: "walkthrough",
    youtubeId: "QlrH0HIwS60",
    title: "ArrivePing, start to finish",
    summary: "The full walkthrough: sign up, the AI setup chat, then every screen through to your first dispatched job.",
    seconds: 471,
    group: "set-up",
    poster: P("walk"),
    guides: [],
    uploaded: UP,
    live: true,
    chapters: [
      { at: 0, title: "Introduction" },
      { at: 13, title: "Sign up from your website" },
      { at: 89, title: "The AI setup chat" },
      { at: 141, title: "Dashboard, sample day and map" },
      { at: 187, title: "Create a job" },
      { at: 221, title: "Schedule and dispatch" },
      { at: 267, title: "Services, catalog and assemblies" },
      { at: 300, title: "Good, better, best options" },
      { at: 322, title: "Job templates" },
      { at: 352, title: "Booking and quote forms" },
      { at: 377, title: "Company settings" },
      { at: 405, title: "Notifications and automation" },
      { at: 443, title: "Team, roles and permissions" },
    ],
  },
  {
    key: "sign-up",
    youtubeId: "OWtKoV08Kjc",
    title: "Sign up: AI builds your workspace from your website",
    summary: "Paste your web address and ArrivePing sets up your services, forms, templates and pricing in about a minute.",
    seconds: 82,
    group: "set-up",
    poster: P("h01"),
    guides: ["set-up-your-company", "free-trial"],
    uploaded: UP,
    live: true,
  },
  {
    key: "setup-chat",
    youtubeId: "DPagFWJS9pU",
    title: "Finish setup with a short AI chat",
    summary: "A few questions about your team, memberships and rates, and your answers become real setup.",
    seconds: 58,
    group: "set-up",
    poster: P("h02"),
    guides: ["set-up-your-company"],
    uploaded: UP,
    live: true,
  },
  {
    key: "first-look",
    youtubeId: "R2Xoyk1C6u4",
    title: "First look: dashboard, sample day and live map",
    summary: "Try everything safely on a pretend day, then see every technician and job on the live map.",
    seconds: 52,
    group: "set-up",
    poster: P("h03"),
    guides: ["sample-day", "live-map"],
    uploaded: UP,
    live: true,
  },
  {
    key: "create-a-job",
    youtubeId: "RR1tO_z3FqU",
    title: "Create a job in under a minute",
    summary: "Homeowner, service, template, address and parts from your catalog, then Create Job.",
    seconds: 40,
    group: "run-your-day",
    poster: P("h04"),
    guides: ["your-first-job", "edit-archive-restore-job"],
    uploaded: UP,
    live: true,
  },
  {
    key: "schedule-and-dispatch",
    youtubeId: "47mFBgJ6PQA",
    title: "Schedule and dispatch with drag and drop",
    summary: "Drag a job onto a technician's row and the customer and tech hear about it in seconds.",
    seconds: 53,
    group: "run-your-day",
    poster: P("h05"),
    guides: ["assigning-jobs", "scheduler-views"],
    uploaded: UP,
    live: true,
  },
  {
    key: "on-my-way-text",
    youtubeId: "_K-4fQI29zU",
    title: "How the on-my-way text and live ETA work",
    summary: "What happens when your tech taps Start Driving, and exactly what your customer sees.",
    seconds: 95,
    group: "run-your-day",
    poster: P("onmyway"),
    guides: ["on-the-way-and-arrival", "what-customers-receive"],
    uploaded: UP,
    live: true,
  },
  {
    key: "catalog",
    youtubeId: "fCdFVW4hyxE",
    title: "Services, catalog items and assemblies",
    summary: "Services for booking, a priced catalog, and assemblies that roll parts and labour into one line.",
    seconds: 38,
    group: "configure",
    poster: P("h06"),
    guides: [],
    uploaded: UP,
    live: true,
  },
  {
    key: "options-and-tiers",
    youtubeId: "A8dYhJdA7HY",
    title: "Good, better, best: options and tiers",
    summary: "Let customers pick their upgrade, each with its own price, from their selections link.",
    seconds: 29,
    group: "configure",
    poster: P("h07"),
    guides: [],
    uploaded: UP,
    live: true,
  },
  {
    key: "job-templates",
    youtubeId: "ooCoNC7oDJg",
    title: "Build job templates with the form builder",
    summary: "Checklist fields, photos and signatures, plus pricing, mileage, tech pay and payment on site.",
    seconds: 36,
    group: "configure",
    poster: P("h08"),
    guides: [],
    uploaded: UP,
    live: true,
  },
  {
    key: "booking-forms",
    youtubeId: "2CcBWpSzuUw",
    title: "Online booking and quote request forms",
    summary: "Share a link or embed it on your website. Here's what your customers see.",
    seconds: 31,
    group: "configure",
    poster: P("h09"),
    guides: ["online-booking-forms"],
    uploaded: UP,
    live: true,
  },
  {
    key: "company-settings",
    youtubeId: "LXcZCq_bJTw",
    title: "Reviews, customer self-service and running-late notices",
    summary: "Company settings: review requests, letting customers reschedule, and warnings when a job runs late.",
    seconds: 34,
    group: "configure",
    poster: P("h10"),
    guides: ["customer-self-service", "running-late"],
    uploaded: UP,
    live: true,
  },
  {
    key: "notifications",
    youtubeId: "4SxC2lMvKxQ",
    title: "Notifications and automation: who hears what, and when",
    summary: "Automation templates, notification rules for every step, and your email and text senders.",
    seconds: 44,
    group: "configure",
    poster: P("h11"),
    guides: ["customize-messages", "assignment-rules", "set-your-reply-to-email"],
    uploaded: UP,
    live: true,
  },
  {
    key: "team",
    youtubeId: "qpzjLccXkoI",
    title: "Your team: directory, field staff, roles and permissions",
    summary: "Everyone in one place, technicians with their vehicles and status, and who can see and change what.",
    seconds: 28,
    group: "configure",
    poster: P("h12"),
    guides: ["invite-your-technicians", "add-office-staff", "roles-and-permissions"],
    uploaded: UP,
    live: true,
  },
];

/** Only videos that are public on YouTube. */
export const liveVideos = videos.filter((v) => v.live);

export const videoByKey: Record<string, HelpVideo> = Object.fromEntries(liveVideos.map((v) => [v.key, v]));

/** The video shown at the top of a guide, if any. */
export function videoForGuide(slug: string): HelpVideo | undefined {
  return liveVideos.find((v) => v.guides.includes(slug));
}

export const videosIn = (g: VideoGroupId) => liveVideos.filter((v) => v.group === g);

/** The next video in watching order, for "Up next". */
export function nextVideo(key: string): HelpVideo | undefined {
  const i = liveVideos.findIndex((v) => v.key === key);
  return i >= 0 ? liveVideos[i + 1] : undefined;
}

/** 471 → "7:51" */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/** 471 → "PT7M51S" (schema.org duration) */
export function isoDuration(seconds: number): string {
  return `PT${Math.floor(seconds / 60)}M${Math.round(seconds % 60)}S`;
}

/** Privacy-enhanced embed URL. Nothing is requested from YouTube until this is loaded. */
export function embedUrl(v: HelpVideo, start = 0): string {
  const q = new URLSearchParams({ autoplay: "1", rel: "0", modestbranding: "1", playsinline: "1", cc_load_policy: "1" });
  if (start > 0) q.set("start", String(start));
  return `https://www.youtube-nocookie.com/embed/${v.youtubeId}?${q.toString()}`;
}

export const watchUrl = (v: HelpVideo) => `https://www.youtube.com/watch?v=${v.youtubeId}`;
