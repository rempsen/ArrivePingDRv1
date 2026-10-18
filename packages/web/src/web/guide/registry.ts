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
  /** Clicked before the step if `anchor` isn't on screen yet (e.g. opens a form). */
  open?: AnchorId;
  route?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto" | "center";
  /**
   * The guide scrolls the target to the middle of the screen itself instead of
   * leaving it to Joyride. Needed for targets inside a sideways-scrolling
   * container (a wide table): Joyride measures against that container and
   * scrolls the page to the wrong place.
   */
  centerScroll?: boolean;
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
/** The pages behind chapters 4–9 (Directory, Notifications, Reports, Settings) are admin-only on the server. */
const ADMINS: Role[] = ["admin"];

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
    id: "create-job",
    number: 2,
    title: "Create a {job}",
    summary: "Book work for a {customer} in under a minute.",
    roles: EVERYONE,
    steps: [
      {
        id: "nav",
        anchor: "nav.jobs",
        inNav: true,
        placement: "right",
        title: "Every {job} in one list",
        body: "{jobs} lists all your work: search it, filter it, export it. Let's book one.",
      },
      {
        id: "new",
        route: "/admin/work-orders",
        anchor: "jobs.new",
        placement: "bottom",
        title: "Start a new {job}",
        body: "New {job} opens the booking form. We'll open it for you on the next step.",
      },
      {
        id: "customer",
        route: "/admin/work-orders",
        open: "jobs.new",
        anchor: "wo.customer",
        placement: "bottom",
        title: "Who it's for",
        body: "Pick a {customer}, or type a new name to add one. Their address and phone fill in for you.",
      },
      {
        id: "schedule",
        route: "/admin/work-orders",
        open: "jobs.new",
        anchor: "wo.schedule",
        placement: "bottom",
        title: "When it happens",
        body: "Set the date and time. The {customer} gets a booking confirmation when you save.",
      },
      {
        id: "create",
        route: "/admin/work-orders",
        open: "jobs.new",
        anchor: "wo.create",
        placement: "top",
        title: "Save it",
        body: "Create {job} puts it on the Scheduler. Leave {worker} empty and ArrivePing picks the closest qualified one.",
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
        open: "sched.calendar",
        anchor: "sched.views",
        placement: "bottom",
        title: "Zoom in or out",
        body: "Switch between Day, Week, Work Week and Month. Try Week now.",
      },
      {
        id: "queue",
        route: "/admin/scheduler",
        open: "sched.calendar",
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
  {
    id: "people",
    number: 4,
    title: "{customers}, {workers} & coworkers",
    summary: "Add the people you work with.",
    roles: ADMINS,
    steps: [
      {
        id: "nav",
        anchor: "nav.people",
        inNav: true,
        placement: "right",
        title: "Everyone in one place",
        body: "People is your directory: {customers}, {workers} and office staff, each with their own history.",
      },
      {
        id: "filters",
        route: "/admin/clients",
        anchor: "people.filters",
        placement: "bottom",
        title: "Filter by who they are",
        body: "Switch between {customers}, {workers} and dispatchers. Search finds anyone by name or email.",
      },
      {
        id: "add",
        route: "/admin/clients",
        anchor: "people.add",
        placement: "bottom",
        title: "Add one, or bring a list",
        body: "Add a {customer} by hand, or use Import to bring in a spreadsheet you already have.",
      },
      {
        id: "techs",
        route: "/admin/techs",
        anchor: "techs.add",
        placement: "bottom",
        title: "Invite a {worker}",
        body: "Add {worker} emails them an invite to the ArrivePing app. Once they sign in, you can send them {jobs}.",
      },
      {
        id: "office",
        route: "/admin/techs",
        anchor: "techs.tab.internal",
        placement: "bottom",
        title: "Your office team",
        body: "Internal Team holds dispatchers and managers. Roles & Permissions sets what each role can see and change.",
      },
    ],
  },
  {
    id: "notifications",
    number: 5,
    title: "Notifications",
    summary: "Who hears about each {job}, and how.",
    roles: ADMINS,
    steps: [
      {
        id: "nav",
        anchor: "nav.notifications",
        inNav: true,
        placement: "right",
        title: "Every message, one page",
        body: "Notifications decides who hears about each {job}, and whether by app, email or text.",
      },
      {
        id: "matrix",
        route: "/admin/notifications",
        open: "notif.tab.rules",
        anchor: "notif.matrix",
        placement: "top",
        title: "One row per milestone",
        body: "Columns are the {customer}, the {worker} and your office. Tap a square to turn app, email or text on or off.",
      },
      {
        id: "switches",
        route: "/admin/notifications",
        open: "notif.tab.channels",
        anchor: "notif.masters",
        placement: "top",
        title: "Master switches",
        body: "Turn email or text off for the whole company in one tap. Quiet hours, below, skip texts or emails overnight; they aren't sent later.",
      },
      {
        id: "log",
        route: "/admin/notifications",
        open: "notif.tab.log",
        anchor: "notif.log",
        placement: "top",
        title: "Check what was sent",
        body: "The Delivery Log lists every message: who it went to, how, and whether it was delivered.",
      },
    ],
  },
  {
    id: "milestones",
    number: 6,
    title: "Milestones & messages",
    summary: "Edit what {customers} are told at each step.",
    roles: ADMINS,
    steps: [
      {
        id: "flow",
        route: "/admin/notifications",
        open: "notif.tab.rules",
        anchor: "notif.matrix",
        placement: "top",
        title: "How a {job} moves",
        body: "Booked, assigned, on the way, arrived, completed. Each milestone can message the {customer}, {worker} or office.",
      },
      {
        id: "edit",
        route: "/admin/notifications",
        open: "notif.tab.rules",
        anchor: "notif.edit.enroute",
        placement: "left",
        centerScroll: true,
        title: "Say it your way",
        body: "Edit opens this milestone's message. Write it in your words and insert live details like the ETA link.",
      },
      {
        id: "late",
        route: "/admin/settings",
        open: "settings.section.company",
        anchor: "settings.running-late",
        placement: "top",
        title: "Running late, handled",
        body: "When a {job} slips past this many minutes, ArrivePing flags it and can tell the {customer} for you.",
      },
      {
        id: "custom",
        route: "/admin/automation",
        anchor: "auto.custom",
        placement: "bottom",
        title: "Need something more?",
        body: "A custom rule adds your own step, like texting the office whenever an urgent {job} is booked.",
      },
    ],
  },
  {
    id: "reply-to",
    number: 7,
    title: "Reply-to email",
    summary: "Where {customer} replies land.",
    roles: ADMINS,
    steps: [
      {
        id: "sender",
        route: "/admin/notifications",
        open: "notif.tab.channels",
        anchor: "email.sender",
        placement: "top",
        title: "Your name on every email",
        body: "Set the name and address {customers} see when ArrivePing emails them for you.",
      },
      {
        id: "reply",
        route: "/admin/notifications",
        open: "notif.tab.channels",
        anchor: "email.replyto",
        placement: "bottom",
        title: "Replies come to you",
        body: "When a {customer} hits Reply, it goes to this address. Use an inbox someone reads every day.",
      },
      {
        id: "test",
        route: "/admin/notifications",
        open: "notif.tab.channels",
        anchor: "email.test",
        placement: "top",
        title: "See it first",
        body: "Send a test to yourself to see exactly what {customers} receive. It saves your changes first.",
      },
    ],
  },
  {
    id: "reports",
    number: 8,
    title: "Reports",
    summary: "Revenue, {worker} performance and trends.",
    roles: ADMINS,
    steps: [
      {
        id: "nav",
        anchor: "nav.reports",
        inNav: true,
        placement: "right",
        title: "Your numbers",
        body: "Reports turns your {jobs} into revenue, {worker} performance, payroll and more.",
      },
      {
        id: "list",
        route: "/admin/reports",
        anchor: "reports.list",
        placement: "right",
        title: "Pick a report",
        body: "Revenue, {worker} performance, {job} status and more. The one you pick opens beside the list.",
      },
      {
        id: "range",
        route: "/admin/reports",
        anchor: "reports.range",
        placement: "bottom",
        title: "Choose the period",
        body: "Use a preset from 7 days to 12 months, or pick exact dates. Filter by {worker} or status too.",
      },
    ],
  },
  {
    id: "export",
    number: 9,
    title: "Export your data",
    summary: "Take any report or list with you.",
    roles: ADMINS,
    steps: [
      {
        id: "report",
        route: "/admin/reports",
        anchor: "reports.export",
        placement: "bottom",
        title: "Take any report with you",
        body: "Export the report on screen as CSV, Excel or PDF, ready for your accountant.",
      },
      {
        id: "raw",
        route: "/admin/reports",
        anchor: "reports.raw",
        placement: "top",
        title: "All your raw data",
        body: "Download every {job}, {worker}, {customer} or invoice as a spreadsheet, any time. Your data is yours.",
      },
      {
        id: "jobs",
        route: "/admin/work-orders",
        anchor: "jobs.export",
        placement: "bottom",
        title: "Export a filtered list",
        body: "Filter your {jobs} first, then export just those as CSV, PDF or JSON.",
      },
      {
        id: "calendar",
        route: "/admin/settings",
        open: "settings.section.company",
        anchor: "settings.calendar",
        placement: "top",
        title: "{jobs} in your calendar",
        body: "Subscribe to this link in Google, Apple or Outlook Calendar to see every {job} there.",
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
