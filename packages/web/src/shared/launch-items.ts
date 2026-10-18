/**
 * Launch checklist: ids and copy, shared by the Getting started page, the
 * sidebar card and the server's day 1 / 3 / 7 tip emails
 * (services/launch-progress.ts), so all three say the same thing.
 *
 * The ticks come from GET /api/onboarding/checklist, which recomputes them
 * from real data (services/launch-checklist.ts); nothing is ticked in the
 * browser. Copy uses the Guide's terminology tokens ({job}, {worker},
 * {customer}…).
 */
export type LaunchItemId = "first-job" | "invite-tech" | "live-eta" | "reply-to" | "milestone-copy";
export type SetupItemId = "industry" | "service-area" | "catalog" | "forms" | "templates" | "team";
export interface LaunchChecklist {
  items: { id: LaunchItemId; done: boolean; waiting?: boolean }[];
  setup: { id: SetupItemId; done: boolean }[];
  complete: boolean;
}

/** Copy uses the Guide's terminology tokens ({job}, {worker}, {customer}…). */
export const LAUNCH_ITEMS: Record<
  LaunchItemId,
  { title: string; body: string; waiting?: string; chapter: string; route: string; action: string }
> = {
  "first-job": {
    title: "Book your first real {job}",
    body: "Create a {job} for a real {customer}. The sample {jobs} don't count.",
    chapter: "create-job",
    route: "/admin/work-orders",
    action: "Go to {jobs}",
  },
  "invite-tech": {
    title: "Invite a {worker}",
    body: "Add {worker} emails them an invite to the ArrivePing app. This ticks once they've signed in.",
    waiting: "Invited. Waiting for them to sign in on their phone.",
    chapter: "people",
    route: "/admin/techs",
    action: "Add a {worker}",
  },
  "live-eta": {
    title: "Send your first live ETA",
    body: "When a {worker} taps On my way on a real {job}, the {customer} gets a live tracking link. This ticks when the first one is delivered.",
    chapter: "notifications",
    route: "/admin/scheduler",
    action: "Open the Scheduler",
  },
  "reply-to": {
    title: "Set your reply-to email",
    body: "Choose the inbox where {customer} replies land.",
    chapter: "reply-to",
    route: "/admin/notifications",
    action: "Open Notifications",
  },
  "milestone-copy": {
    title: "Make a message yours",
    body: "Edit the on-the-way message so it sounds like you.",
    chapter: "milestones",
    route: "/admin/notifications",
    action: "Open Notifications",
  },
};

export const SETUP_LABELS: Record<SetupItemId, string> = {
  industry: "Industry",
  "service-area": "Service area",
  catalog: "Catalog",
  forms: "Intake forms",
  templates: "Work-order templates",
  team: "Team invited",
};
