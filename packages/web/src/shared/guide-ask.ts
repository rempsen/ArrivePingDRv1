/**
 * "Ask ArrivePing" — the pieces both the server and the Guide panel need.
 *
 * Ask answers "how do I…?" questions from the Help Center and the Guide's
 * tours. It can only point the way: its three actions start a tour, open a
 * page from this list, or show a help article. It never creates, edits or
 * deletes anything, and it's never given the company's jobs, customers or
 * numbers.
 */

export type AskAction = { type: "tour"; id: string } | { type: "page"; route: string } | { type: "article"; slug: string };

export interface AskPage {
  route: string;
  /** Where it lives in the menu, using {jobs}/{workers} tokens. */
  label: string;
  /** The page's data is admin-only on the server, so only admins are sent there. */
  adminOnly?: boolean;
}

/** Pages Ask may open. Anything else is refused by the tool's schema. */
export const ASK_PAGES: AskPage[] = [
  { route: "/admin", label: "Operations → Dashboard" },
  { route: "/admin/scheduler", label: "Operations → Scheduler (Board and Calendar views, Work Queue)" },
  { route: "/admin/fleet", label: "Operations → Map (the live map of {workers})" },
  { route: "/admin/work-orders", label: "Operations → {jobs} (every {job}: search, filter, export, New {job})" },
  { route: "/admin/inbox", label: "Operations → Inbox" },
  { route: "/admin/automation", label: "Automation (custom rules; opened from the Milestones tour, not in the sidebar)" },
  { route: "/admin/techs", label: "People → {workers} & Managers (Add {worker}, Internal Team)", adminOnly: true },
  { route: "/admin/clients", label: "People → People (the directory of {customers} and staff, Import)", adminOnly: true },
  {
    route: "/admin/notifications",
    label: "Setup → Notifications (milestone messages, Channels: sender, reply-to, quiet hours; Delivery Log)",
    adminOnly: true,
  },
  { route: "/admin/reports", label: "Money → Reports (reports and exports)", adminOnly: true },
  { route: "/admin/settings", label: "Setup → Settings (company, running late, calendar feed, API & MCP)", adminOnly: true },
  { route: "/admin/getting-started", label: "Getting started (the launch checklist)", adminOnly: true },
];

export const ASK_LIMITS = {
  question: 500,
  /** Earlier turns sent back for follow-ups ("and for texts?"). */
  history: 6,
  historyText: 1200,
};

/** SSE events from POST /api/guide/ask (every data payload is JSON). */
export type AskEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "action"; data: AskAction }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: Record<string, never> };
