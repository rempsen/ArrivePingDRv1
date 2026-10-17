import type { AnchorId } from "./anchors";

/**
 * ArrivePing Guide — tour chapters.
 *
 * Rules every step follows (blueprint 2026-10-17, section 4):
 *  - ≤ 5 steps per chapter; body ≤ 140 characters, two short lines.
 *  - Say what the user gets, not what the button is.
 *  - Use terminology tokens so each industry reads its own words:
 *    {job} {jobs} {worker} {workers} {customer} {customers}.
 *  - `route` sends the user to that page before the step (cross-page tours).
 *  - `inNav` marks a sidebar target: below the md breakpoint the guide opens
 *    the "Open menu" drawer first so the same item can be spotlighted.
 *  - No anchor = a centred card (intro / outro).
 */
export type Role = "admin" | "manager" | "dispatcher" | "project_manager";

export interface GuideStep {
  id: string;
  title: string;
  body: string;
  anchor?: AnchorId;
  inNav?: boolean;
  route?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto" | "center";
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  /** One line shown in the chapter list and checklist. */
  summary: string;
  roles: Role[];
  steps: GuideStep[];
}

const EVERYONE: Role[] = ["admin", "manager", "dispatcher", "project_manager"];

export const CHAPTERS: Chapter[] = [
  {
    id: "find-your-way",
    number: 1,
    title: "Find your way",
    summary: "Where everything lives in the menu.",
    roles: EVERYONE,
    steps: [
      {
        id: "operations",
        anchor: "nav.group.operations",
        inNav: true,
        placement: "right",
        title: "Your day lives here",
        body: "Operations has the dashboard, the Scheduler, the live Map and every {job}. Most of your time is spent in this group.",
      },
      {
        id: "people",
        anchor: "nav.group.people",
        inNav: true,
        placement: "right",
        title: "Your team and {customers}",
        body: "People is where you add {workers}, office staff and {customers}.",
      },
      {
        id: "setup",
        anchor: "nav.group.setup",
        inNav: true,
        placement: "right",
        title: "Make it yours",
        body: "Setup holds the messages {customers} receive, your reply-to email, service zones and company settings.",
      },
      {
        id: "guide",
        anchor: "guide.button",
        placement: "right",
        title: "Help is always here",
        body: "Open the Guide any time to replay a chapter, search help articles or ask a question.",
      },
    ],
  },
  {
    id: "scheduler",
    number: 3,
    title: "Scheduler & calendar",
    summary: "Board and calendar views, and the work queue.",
    roles: EVERYONE,
    steps: [
      {
        id: "nav",
        anchor: "nav.scheduler",
        inNav: true,
        placement: "right",
        title: "Open the Scheduler",
        body: "This is where {jobs} get a time and a {worker}. Let's go there now.",
      },
      {
        id: "mode",
        route: "/admin/scheduler",
        anchor: "sched.mode",
        placement: "bottom",
        title: "Two ways to plan",
        body: "Board shows a lane per {worker}. Calendar shows the day, week or month at a glance.",
      },
      {
        id: "views",
        route: "/admin/scheduler",
        anchor: "sched.views",
        placement: "bottom",
        title: "Zoom in or out",
        body: "Switch between Day, Week, Work Week and Month. Try Week now.",
      },
      {
        id: "queue",
        route: "/admin/scheduler",
        anchor: "sched.queue",
        placement: "right",
        title: "Nothing slips through",
        body: "The Work Queue lists every {job} still waiting for a {worker}. Open one to give it a time and a {worker}.",
      },
      {
        id: "new",
        route: "/admin/scheduler",
        anchor: "sched.new-job",
        placement: "bottom",
        title: "Book a {job} from here",
        body: "New {job} opens the booking form with the date already filled in.",
      },
    ],
  },
];

export const chapterById: Record<string, Chapter> = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));

export interface Terms {
  job: string;
  jobs: string;
  worker: string;
  workers: string;
  customer: string;
  customers: string;
}

/** Replaces {job}/{jobs}/… with the tenant's own words; capitalises at sentence start. */
export function interpolate(text: string, t: Terms): string {
  return text.replace(/\{(jobs|job|workers|worker|customers|customer)\}/g, (_m, key: keyof Terms, offset: number) => {
    const word = t[key];
    const atStart = offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset));
    return atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase();
  });
}
