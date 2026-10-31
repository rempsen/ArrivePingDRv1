/**
 * Office web dashboard: the day-to-day dispatch screens (shell, Dashboard,
 * Getting started, Scheduler, {jobs} list and dialogs, job report, Inbox,
 * Change Requests, Maintenance Plans, Map, Service Zones, custom milestones).
 * Written from web/pages/admin/* and the components they open. See types.ts.
 */
import type { KbEntry } from "./types";

const WEB = { surface: "office-web" as const, platforms: ["web" as const] };
const OFFICE: KbEntry["roles"] = ["admin", "manager", "dispatcher"];

export const entries: KbEntry[] = [
  // ───────────────────────────── shell ─────────────────────────────
  {
    id: "office-web.dispatch.shell",
    title: "Dashboard layout (sidebar, company switcher, sign out)",
    ...WEB,
    roles: OFFICE,
    path: "Any office dashboard page (the sidebar is on the left; on a phone tap the menu button at top left)",
    route: "/admin",
    summary:
      "The frame around every office page: the sidebar menu grouped into sections, your company's logo and name, the company switcher, the launch checklist card, Guide & help, your name and role, and Sign out. Pages you can't open are hidden from the sidebar.",
    controls: [
      { label: "Operations section", does: "Dashboard, Scheduler, Map, {jobs}, Inbox and Change Requests." },
      { label: "Catalog & Forms section", does: "Services, Catalog, Options & Tiers, Job Templates and Intake Forms." },
      { label: "People section", does: "{workers} & Managers, People (customers and staff together), Reviews and Maintenance Plans." },
      { label: "Money section", does: "Payouts and Reports." },
      { label: "Setup section", does: "Service Zones, Notifications, Tags & Fields and Settings." },
      { label: "Change Requests badge", does: "The amber number next to Change Requests is how many customer requests are waiting on a decision. It refreshes every minute." },
      { label: "Company logo and name", does: "Goes back to the Dashboard." },
      { label: "Company (switcher)", does: "Shown only if you belong to more than one company. Opens a list of your companies with your role at each; pick one to switch. With 6 or more companies there is a search box (Up/Down arrows to move, Enter to switch)." },
      { label: "Get ready to launch card", does: "Admins only. Shows the launch checklist progress (n of 5 done) and opens Getting started. Hidden if you chose Hide from the sidebar." },
      { label: "Guide & help", does: "Opens the Guide & help panel: guided tours, Help Center search and Ask ArrivePing. The number beside it is tours completed." },
      { label: "Sign out", does: "The door icon next to your name signs you out and returns to the sign-in page." },
      { label: "Open menu / Close menu", does: "On a phone or narrow window, opens and closes the sidebar as a slide-in drawer." },
      { label: "Messages bubble", does: "The round chat button at the bottom right of every page opens dispatch Messages with your {workers}. A red number shows unread messages." },
      { label: "Sample data banner", does: "Shown while a sample day is loaded: See what your {customer} sees opens a sample tracking page; admins get Clear sample data." },
      { label: "Back to your work", does: "Shown on a page your role can't open; returns to the first page you can open." },
    ],
    tasks: [
      {
        q: "How do I switch to another company?",
        steps: ["In the sidebar, click the box under Company.", "Type to search if the list is long.", "Click the company you want."],
        note: "The switcher only appears if you belong to more than one company.",
      },
      {
        q: "How do I sign out?",
        steps: ["At the bottom of the sidebar, find your name.", "Click the Sign out icon to the right of it."],
      },
      {
        q: "How do I open the menu on my phone?",
        steps: ["Tap the menu button at the top left.", "Tap the page you want. The menu closes by itself."],
      },
      {
        q: "How do I clear the sample data?",
        steps: ["In the amber banner at the top, click Clear sample data.", "Read what will be removed.", "Click Clear sample data again to confirm, or Keep it for now."],
        note: "Admins only. It can't be undone, but you can add a fresh sample day later from Guide & help. Your own {jobs}, {customers} and team are kept; your own {jobs} given to a sample {worker} go back to unassigned.",
      },
      {
        q: "Why is a page missing from my sidebar?",
        steps: ["Ask your company admin which pages your role can open.", "They can change what each role or person can see."],
      },
    ],
    fixes: [
      {
        problem: "\"This page isn't part of your role\"",
        fix: "Your role doesn't include that page. Your company's admin decides what each role can open; click Back to your work, or ask them for access.",
      },
      {
        problem: "I don't see the Company switcher",
        fix: "It only shows for people who belong to two or more companies. With one company there is nothing to switch.",
      },
      {
        problem: "Setup pages like Service Zones or Notifications are missing",
        fix: "Setup pages need permission to change that area (for example zones:edit, notifications:edit). By default only admins have these; ask an admin.",
      },
    ],
    keywords: ["sidebar", "menu", "navigation", "switch company", "tenant", "logout", "log out", "sign out", "hamburger"],
  },
  {
    id: "office-web.dispatch.guide-panel",
    title: "Guide & help panel",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Guide & help (on a phone, the question-mark button at top right)",
    summary:
      "A side panel with Ask ArrivePing, Help Center search, the launch checklist link, guided tours that walk you through the real screens, a sample day to practise on, and support contact details.",
    controls: [
      { label: "Ask a question or search help", does: "Type to search Help Center articles. Where Ask ArrivePing is available, press Enter (or click Ask ArrivePing) to get an answer; follow-ups go in the same box." },
      { label: "Ask ArrivePing", does: "Sends your typed question to the help assistant." },
      { label: "Launch checklist", does: "Admins only. Opens Getting started." },
      { label: "Guided tours", does: "Each tour shows the screens step by step. A tick marks tours you've completed." },
      { label: "Add a sample day", does: "Admins only, when no sample data is loaded. Adds pretend {workers}, {customers} and {jobs} to practise on. Nobody is messaged." },
      { label: "Popular in the Help Center", does: "Common articles; click one to read it in the panel." },
      { label: "Show me in ArrivePing", does: "On an article that has a tour, starts that tour." },
      { label: "Open in the Help Center", does: "Opens the article on the public Help Center in a new tab." },
      { label: "Back", does: "Returns from an article to the panel's main view." },
      { label: "Close guide", does: "Closes the panel." },
    ],
    tasks: [
      {
        q: "How do I take a guided tour?",
        steps: ["Click Guide & help in the sidebar.", "Under Guided tours, click the tour you want.", "Follow the highlighted steps."],
      },
      {
        q: "How do I add practice data?",
        steps: ["Click Guide & help.", "Under Practice, click Add a sample day."],
        note: "Admins only. Sample items are marked (sample) and nobody is texted or emailed about them.",
      },
      {
        q: "How do I search the help articles?",
        steps: ["Click Guide & help.", "Type in the search box at the top.", "Click an article to read it, or Open in the Help Center."],
      },
      {
        q: "How do I contact support?",
        steps: ["Click Guide & help.", "At the bottom, use the support email shown, or click Help Center."],
      },
    ],
    keywords: ["help", "tour", "tutorial", "support", "ask", "walkthrough", "practice", "sample day"],
  },
  {
    id: "office-web.dispatch.messenger",
    title: "Messages (dispatch chat with {workers})",
    ...WEB,
    roles: OFFICE,
    path: "Any office page → Messages bubble (bottom right)",
    summary:
      "A docked chat panel on every office page for direct messages with each {worker}, plus Broadcast to send one message to a group of {workers}.",
    controls: [
      { label: "Open messages", does: "The chat bubble at bottom right. The red number is total unread messages." },
      { label: "Search {workers}…", does: "Filters the conversation list by name." },
      { label: "All / Available / En Route / On Site / Busy / Offline", does: "Filters the list by the {worker}'s current status." },
      { label: "{worker} row", does: "Opens the direct conversation with that {worker}." },
      { label: "Message {name}…", does: "Type a message to the open {worker} and send it." },
      { label: "Broadcast", does: "The megaphone button (list view only) opens the broadcast composer." },
      { label: "Send to", does: "In Broadcast, choose recipients: All drivers, Available only, By skill class, By skill tag or By tag. Each shows how many people match." },
      { label: "Send to N drivers", does: "Sends the broadcast. Disabled until there's a message and at least one recipient." },
      { label: "Back to conversations", does: "Returns to the list." },
      { label: "Close messages", does: "Closes the panel." },
    ],
    tasks: [
      {
        q: "How do I message one {worker}?",
        steps: ["Click the Messages bubble at the bottom right.", "Search or click the {worker}.", "Type in the message box and send."],
      },
      {
        q: "How do I send a message to all my {workers} at once?",
        steps: ["Open Messages.", "Click the Broadcast (megaphone) button.", "Under Send to, pick All drivers or a group.", "Type the message.", "Click Send to N drivers.", "Click Done."],
      },
      {
        q: "How do I see messages only from {workers} who are on the road?",
        steps: ["Open Messages.", "Click the En Route (or On Site) chip."],
      },
      {
        q: "How do I message only the {workers} with a certain skill?",
        steps: ["Open Messages and click Broadcast.", "Open Send to and pick a skill class, skill tag or tag.", "Type the message and click Send to N drivers."],
      },
    ],
    fixes: [
      {
        problem: "\"No drivers match this target right now.\"",
        fix: "Nobody fits the recipient group you picked (for example Available only when everyone is busy). Pick a wider group under Send to.",
      },
      {
        problem: "The send button for a broadcast is greyed out",
        fix: "It needs a message and at least one matching recipient.",
      },
    ],
    keywords: ["chat", "message technician", "broadcast", "announcement", "text all", "team message"],
  },

  // ───────────────────────────── dashboard ─────────────────────────────
  {
    id: "office-web.dispatch.dashboard",
    title: "Operations Dashboard",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Dashboard",
    route: "/admin",
    permission: "dashboard:view",
    summary:
      "The home page: a Running late board when any {job} is late, six headline counts with a date-range filter, the most recent {jobs}, and live {worker} status.",
    controls: [
      { label: "Running late", does: "Appears only when a {job} is flagged late. Each row shows minutes late, the reason, and whether the {customer} has been told or when the automatic notice will send itself." },
      { label: "Send now / Send update", does: "Sends the running-late notice to the {customer} now (by text and on their tracking page), or an updated one if they were already told." },
      { label: "Mute / Un-mute", does: "Mute stops the automatic running-late notice for that {job} (you're handling it). Un-mute turns it back on." },
      { label: "Settings link (Running late)", does: "Opens Settings, where the running-late timing is changed." },
      { label: "Date range: All time / Today / Last 7 days / This month / Custom", does: "Sets the period for the six count cards. Custom shows From and To date boxes." },
      { label: "scheduled date / created date", does: "With a range set, chooses whether {jobs} are counted by their scheduled date or the date they were created." },
      { label: "Clear filter", does: "The X resets the range to All time." },
      { label: "Count cards: {jobs} / Active jobs / Completed / Revenue / {customers} / {workers}", does: "Each card opens the matching page ({jobs} list, Payouts, People, {workers} & Managers)." },
      { label: "Recent {jobs} · View all", does: "Shows the six newest {jobs}; View all opens the {jobs} list." },
      { label: "Fleet status chips: All / En Route / Available / On Site / Busy / Break / Offline", does: "Filters the {worker} list by status, with a count on each chip." },
      { label: "Map", does: "Opens the live Map." },
      { label: "Retry", does: "Shown if the stats fail to load; tries again." },
    ],
    tasks: [
      {
        q: "How do I tell a {customer} their {worker} is running late?",
        steps: ["Open the Dashboard.", "In Running late, find the {job}.", "Click Send now."],
        note: "If you do nothing, the row says when the notice sends itself. Timing is changed in Settings.",
      },
      {
        q: "How do I stop the automatic late text for one {job}?",
        steps: ["In Running late, find the {job}.", "Click Mute."],
        note: "Click Un-mute to turn it back on.",
      },
      {
        q: "How do I see this month's numbers?",
        steps: ["Under Date range, click This month.", "Optionally switch between scheduled date and created date."],
      },
      {
        q: "How do I see numbers for specific dates?",
        steps: ["Under Date range, click Custom.", "Set the From and To dates.", "Pick scheduled date or created date."],
      },
      {
        q: "How do I see which {workers} are available right now?",
        steps: ["On the Dashboard, go to Fleet status.", "Click the Available chip."],
      },
    ],
    fixes: [
      {
        problem: "\"Failed to load dashboard stats\"",
        fix: "The stats request failed. Click Retry; if it keeps failing, reload the page.",
      },
      {
        problem: "The Running late board isn't there",
        fix: "It only appears while at least one {job} is flagged late, and disappears when nothing is.",
      },
      {
        problem: "Running late shows an error after Send now",
        fix: "The server re-checks the {job} before sending, so a {job} the {worker} has since reached may be refused. The error text says why (default: \"Could not send the notice\").",
      },
    ],
    keywords: ["home", "overview", "KPIs", "stats", "running late", "delay", "revenue", "fleet status", "console"],
  },
  {
    id: "office-web.dispatch.getting-started",
    title: "Getting started (launch checklist)",
    ...WEB,
    roles: ["admin"],
    path: "Sidebar → Get ready to launch card (or Guide & help → Launch checklist)",
    route: "/admin/getting-started",
    permission: "admin",
    summary:
      "Five steps to run your first real day. Each step ticks itself from real data; each has a short tour and a link to the page where you do it. A collapsed group lists the setup done for you at signup.",
    controls: [
      { label: "Book your first real {job}", does: "Ticks once you create a {job} for a real {customer} (sample {jobs} don't count). Go to {jobs} opens the {jobs} list." },
      { label: "Invite a {worker}", does: "Ticks once an invited {worker} signs in to the app. Shows \"Invited. Waiting for them to sign in on their phone.\" in between. Add a {worker} opens {workers} & Managers." },
      { label: "Send your first live ETA", does: "Ticks when the first live tracking link reaches a {customer} after a {worker} taps On my way. Open the Scheduler goes there." },
      { label: "Set your reply-to email", does: "Choose the inbox where {customer} replies land. Open Notifications goes there." },
      { label: "Make a message yours", does: "Edit the on-the-way message. Open Notifications goes there." },
      { label: "Show me", does: "Starts the guided tour for that step." },
      { label: "Hide from the sidebar / Show in the sidebar", does: "Hides or shows the launch card in the sidebar." },
      { label: "Set up for you at signup", does: "Expands to show Industry, Service area, Catalog, Intake forms, Work-order templates and Team invited, with ticks for what's done." },
    ],
    tasks: [
      {
        q: "How do I finish setting up my account?",
        steps: ["Open Getting started from the sidebar card.", "For each unticked step, click Show me for a tour or the step's button to go do it.", "Come back; ticks update on their own within about 15 seconds."],
      },
      {
        q: "How do I get a walkthrough for one launch step?",
        steps: ["Open Getting started.", "On the step, click Show me."],
      },
      {
        q: "What did ArrivePing already set up for me?",
        steps: ["Open Getting started.", "Click Set up for you at signup to expand it."],
        note: "Change any of these under Settings, Catalog, Forms and People.",
      },
      {
        q: "How do I hide the launch checklist?",
        steps: ["Open Getting started.", "Click Hide from the sidebar."],
        note: "It stays available under Guide & help.",
      },
    ],
    fixes: [
      {
        problem: "I booked a {job} but \"Book your first real {job}\" isn't ticked",
        fix: "Sample {jobs} don't count. It needs a {job} for a real {customer}.",
      },
      {
        problem: "\"Invite a {worker}\" says waiting",
        fix: "The invite was sent; it ticks once that {worker} signs in to the ArrivePing app on their phone.",
      },
    ],
    keywords: ["onboarding", "launch", "checklist", "setup", "go live", "first steps"],
  },

  // ───────────────────────────── scheduler ─────────────────────────────
  {
    id: "office-web.dispatch.scheduler",
    title: "Scheduler (Calendar)",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Scheduler → Calendar",
    route: "/admin/scheduler",
    permission: "scheduler:view",
    summary:
      "The dispatch calendar, open by default. Day view shows each {worker} as a row on a timeline; Week shows {workers} by day; Month shows how full each day is. The To schedule list on the side holds every active {job} without a {worker}; drag one onto a row or use Find a slot.",
    controls: [
      { label: "Board / Calendar", does: "Switches the Scheduler between the Board view and this calendar." },
      { label: "New {job}", does: "Opens the New {job} form, starting now." },
      { label: "Previous / Today / Next", does: "Moves back or forward a day, week or month (matching the view), or jumps to today." },
      { label: "Day / Week / Month", does: "Changes the calendar view." },
      { label: "All skills / skill class chips", does: "Day and Week only: shows only {workers} with that skill class." },
      { label: "Find a job, customer or tech", does: "Highlights matching {jobs} and dims the rest. The X clears it." },
      { label: "Compact rows / Comfortable rows", does: "Switches row height. Remembered on this browser." },
      { label: "Day totals", does: "Day view shows the number of {jobs}, hours booked and any overlaps." },
      { label: "N jobs projected to run late", does: "A warning above the calendar listing up to four {jobs} likely to run late; click one to open it." },
      { label: "{job} block", does: "Click to open the {job} (a completed one opens its report). Drag it along the row to change the time, or onto another row to reassign. Red outline = overlaps another {job}." },
      { label: "Double-click a row", does: "Opens the New {job} form for that {worker} at the time you clicked." },
      { label: "+ on a {worker} row (New job for this technician)", does: "Opens the New {job} form for that {worker} on the shown day." },
      { label: "Load bar (n/8h)", does: "How many hours that {worker} has booked out of 8." },
      { label: "To schedule", does: "Every active {job} with no {worker}, urgent first. Drag a card onto a row, or click it to open the {job}." },
      { label: "Find a slot", does: "On a To schedule card: switches to Day view on the {job}'s due day and suggests the best slots as ghost blocks and a list." },
      { label: "Best slots for … (Best fit / Option 2…)", does: "Ranked by skill, drive time and how full each day is. Click a slot to book the {job} there. Cancel stops placing." },
      { label: "N jobs to schedule · open today to place them", does: "Week and Month: jumps to today's Day view so you can place waiting {jobs}." },
      { label: "Week cell / + New job on this day", does: "Week view: click a {worker}'s day to open that day; click a {job} chip to open it; + starts a new {job} on that day." },
      { label: "Month day", does: "Month view: shows jobs and % booked for the whole team; click a day to open that week." },
      { label: "Undo (toast)", does: "After placing or moving a {job}, the confirmation toast has Undo for a few seconds. Dismiss closes it." },
    ],
    tasks: [
      {
        q: "How do I assign an unscheduled {job} to a {worker}?",
        steps: ["Open Scheduler → Calendar → Day.", "In To schedule, drag the {job} card onto the {worker}'s row at the time you want.", "Answer any \"anyway?\" question if they're busy or off."],
        note: "Or click Find a slot on the card and pick one of the suggested slots.",
      },
      {
        q: "How do I find the best time and {worker} for a {job}?",
        steps: ["In To schedule, click Find a slot on the {job}.", "Look at Best slots for … (or the ghost blocks on the timeline).", "Click the slot you want."],
        note: "If none appear: \"No qualified technician has a free gap that day.\" Try another day, or drag it onto a row to book over.",
      },
      {
        q: "How do I move a {job} to a different time?",
        steps: ["Open the Day view for that day.", "Drag the {job} block left or right along its row.", "Drop it. Confirm Move it if it would overlap another {job}."],
        note: "The {customer} is told the new time; Undo in the toast puts it back.",
      },
      {
        q: "How do I reassign a {job} to another {worker}?",
        steps: ["In Day view, drag the {job} block onto the other {worker}'s row.", "Click Reassign in the confirmation."],
        note: "This can't be undone from the toast; the new {worker} is notified right away.",
      },
      {
        q: "How do I move a {job} to another day?",
        steps: ["Click the {job} block to open it.", "In the form, change Schedule and click Update Schedule.", "Click Save and Close."],
      },
      {
        q: "How do I undo a move I just made?",
        steps: ["Right after the move, find the toast at the bottom of the screen.", "Click Undo."],
        note: "The toast lasts about 6 seconds. If the notice already went out, the toast says so.",
      },
      {
        q: "How do I create a {job} for a specific {worker} and time?",
        steps: ["In Day view, double-click the {worker}'s row at the time you want (or click + on their row).", "Fill in the New {job} form.", "Click Create {job}."],
      },
      {
        q: "How do I see how busy the team is this week or month?",
        steps: ["Click Week to see each {worker}'s hours per day.", "Click Month to see % booked per day.", "Click a day to drill in."],
      },
      {
        q: "How do I find a {job} or {customer} on the calendar?",
        steps: ["Type in Find a job, customer or tech.", "Matching {jobs} stay bright; others dim."],
      },
    ],
    fixes: [
      {
        problem: "I can't drag {jobs} on the calendar",
        fix: "Moving {jobs} needs scheduler:edit; giving a {job} to someone also needs work_orders:edit. Without dispatching rights a {job} only moves along its own row, and Find a slot isn't shown. Completed {jobs} can't be dragged.",
      },
      {
        problem: "\"Move it there anyway?\" / \"Assign to … anyway?\" / \"Send them anyway?\"",
        fix: "The {worker} is already booked at that time or has the day off. Confirm to book anyway, or cancel and pick another slot.",
      },
      {
        problem: "\"Reassign this job to …?\"",
        fix: "Someone is actively working the {job} (on the way, on site or clocked in) or already accepted it. Reassigning clears their drive time and on-site clock, and the new {worker} has to accept.",
      },
      {
        problem: "\"Couldn't load the schedule: …\"",
        fix: "The board didn't load. Reload the page; the message after the colon says what failed.",
      },
      {
        problem: "\"That didn't save. Try again.\"",
        fix: "The move or assignment failed on the server. The calendar refreshes to what's actually saved; try again.",
      },
      {
        problem: "A {worker} row is greyed out with \"Not qualified for this job\"",
        fix: "While placing a {job}, {workers} without its required skill class or skills are dimmed. Change the {job}'s required skills or pick a qualified {worker}.",
      },
      {
        problem: "The calendar is a list on my phone",
        fix: "Below laptop width the Day view shows an agenda list instead of the timeline. Tap a {job} to open it.",
      },
    ],
    keywords: ["calendar", "dispatch board", "schedule", "timeline", "drag and drop", "reschedule", "book", "capacity", "find a slot", "unassigned"],
  },
  {
    id: "office-web.dispatch.scheduler-board",
    title: "Scheduler (Board)",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Scheduler → Board",
    route: "/admin/scheduler",
    permission: "scheduler:view",
    summary:
      "A simpler dispatch view: the Unassigned list on the left and a tile for each {worker} on the right. Drag a {job} onto a tile, use Assign, or ask AI suggest for the best match.",
    controls: [
      { label: "Unassigned", does: "Every {job} without a {worker} that isn't completed or cancelled, with a count. \"All dispatched\" when empty." },
      { label: "Assign", does: "On a {job} card: lists {workers} to pick, qualified ones first, then \"other {workers}\"." },
      { label: "AI suggest", does: "Finds the best {worker} and explains why. Assign {name} books them. \"Low-confidence match\" warns when the fit is weak." },
      { label: "Edit", does: "Opens the {job} form." },
      { label: "Delete", does: "Archives the {job} after confirmation. Shown only with work_orders:delete." },
      { label: "Filter by skill: All / skill class", does: "Shows only {worker} tiles with that skill class." },
      { label: "{worker} tile", does: "Drop target for dragging a {job}. The number is their open {jobs}. Click to list their {jobs} below, grouped by when." },
      { label: "Close (X)", does: "Closes the selected {worker}'s {job} list." },
    ],
    tasks: [
      {
        q: "How do I assign a {job} from the Board?",
        steps: ["Click Scheduler → Board.", "On the {job} card, click Assign.", "Click the {worker}."],
        note: "On a computer you can also drag the card onto the {worker}'s tile.",
      },
      {
        q: "How do I get a suggestion for who should take a {job}?",
        steps: ["On the {job} card in Unassigned, click AI suggest.", "Read the reasoning.", "Click Assign {name} to book them."],
      },
      {
        q: "How do I see one {worker}'s {jobs}?",
        steps: ["Click the {worker}'s tile.", "Their {jobs} appear below, grouped by day.", "Click a {job} to open it."],
      },
      {
        q: "How do I delete (archive) a {job} from the Scheduler?",
        steps: ["Click Delete on the {job} card (or the trash icon in a {worker}'s list).", "Click Archive to confirm."],
        note: "It can be restored later from {jobs} → Filters → Show archived.",
      },
    ],
    fixes: [
      {
        problem: "\"No {workers} available to suggest right now.\"",
        fix: "AI suggest found nobody to recommend. Use Assign to pick someone yourself.",
      },
      {
        problem: "Some {worker} tiles fade out while I drag",
        fix: "They aren't qualified for that {job}'s required skill class or skills, so they can't take the drop.",
      },
      {
        problem: "Drag and drop doesn't work on my phone",
        fix: "Dragging isn't available on phones. Tap Assign on the {job} card instead.",
      },
      {
        problem: "There's no Delete button",
        fix: "Archiving needs work_orders:delete. By default managers don't have it; ask an admin.",
      },
    ],
    keywords: ["board", "dispatch", "unassigned queue", "AI suggest", "technician tiles", "assign job"],
  },

  // ───────────────────────────── jobs ─────────────────────────────
  {
    id: "office-web.dispatch.jobs",
    title: "{jobs} list",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → {jobs}",
    route: "/admin/work-orders",
    permission: "work_orders:view",
    summary:
      "Every {job} in one searchable, filterable list, 25 per page. Click a row to open its report; assign, edit, export, print, archive and restore from here.",
    controls: [
      { label: "New {job}", does: "Opens the New {job} form." },
      { label: "Export", does: "Needs reports:export. Exports the current search and filters as CSV (spreadsheet), PDF (printable) or JSON (data). Choose columns picks which columns go in." },
      { label: "All / Pending / Confirmed / Assigned / In progress / Completed / Cancelled", does: "Quick status filter." },
      { label: "Filters", does: "Opens the filter panel. The number on it is how many filters are on." },
      { label: "Search name, phone, email, address…", does: "Free-text search across {jobs}." },
      { label: "Status / Priority / Payment chips", does: "In Filters: pick one or more of each." },
      { label: "Service / {worker} / Region / {customer} tag", does: "In Filters: drop-downs. {worker} includes Unassigned." },
      { label: "{job} #", does: "In Filters: find by {job} number (e.g. A1B2C3)." },
      { label: "Notes contain", does: "In Filters: text in the {job}'s notes." },
      { label: "Min total ($) / Max total ($)", does: "In Filters: price range." },
      { label: "Scheduled from / to, Completed from / to", does: "In Filters: date ranges." },
      { label: "Show archived", does: "In Filters: includes archived {jobs} (marked ARCHIVED)." },
      { label: "Clear all filters", does: "Resets every filter, the quick status and the search." },
      { label: "Sort: Scheduled / Created / Completed / Total / Status / Priority", does: "Sort field; the arrow next to it reverses the order." },
      { label: "Row", does: "Opens the {job}'s report page." },
      { label: "Assign", does: "On Pending or Confirmed {jobs}: opens the Assign {worker} dialog." },
      { label: "Edit / Report", does: "Edit opens the {job} form; on a completed {job} it's Report and opens the report." },
      { label: "More actions (⋯)", does: "PDF detail, JSON, Print, and Archive or Restore (Archive/Restore need work_orders:delete)." },
      { label: "Previous / Next page", does: "Arrows at the bottom when there's more than one page." },
    ],
    tasks: [
      {
        q: "How do I create a new {job}?",
        steps: ["Go to {jobs}.", "Click New {job}.", "Fill in {customer}, Service and Schedule.", "Click Create {job}."],
      },
      {
        q: "How do I find a {job}?",
        steps: ["Go to {jobs}.", "Type a name, phone, email or address in the search box.", "Or click Filters and enter the {job} # ."],
      },
      {
        q: "How do I see only unassigned {jobs}?",
        steps: ["Click Filters.", "Set {worker} to Unassigned."],
      },
      {
        q: "How do I assign a {worker} from the list?",
        steps: ["Find a Pending or Confirmed {job}.", "Click Assign.", "Click the {worker} in the dialog."],
      },
      {
        q: "How do I export {jobs} to a spreadsheet?",
        steps: ["Set the search and filters you want.", "Click Export.", "Optionally click Choose columns and tick columns, then ‹ Back.", "Click CSV (spreadsheet)."],
        note: "Export needs reports:export.",
      },
      {
        q: "How do I print or download one {job}?",
        steps: ["On the {job}'s row, click More actions (⋯).", "Click PDF detail to download, or Print to open it in a new tab."],
      },
      {
        q: "How do I archive (delete) a {job}?",
        steps: ["On the row, click More actions (⋯).", "Click Archive.", "Click Archive to confirm."],
        note: "Nothing is deleted for good; it can be restored.",
      },
      {
        q: "How do I restore an archived {job}?",
        steps: ["Click Filters.", "Tick Show archived.", "On the ARCHIVED row, click More actions (⋯) → Restore."],
      },
      {
        q: "How do I see completed {jobs} from last week?",
        steps: ["Click Filters.", "Set Completed from and Completed to.", "Optionally sort by Completed."],
      },
    ],
    fixes: [
      {
        problem: "\"No matches\"",
        fix: "Nothing fits the current search and filters. Widen the dates or click Clear filters.",
      },
      {
        problem: "There's no Export button",
        fix: "Exporting needs the reports:export permission. Ask your admin.",
      },
      {
        problem: "Archive and Restore are missing from the ⋯ menu",
        fix: "They need work_orders:delete. By default managers don't have it.",
      },
      {
        problem: "\"Export failed. Please try again.\"",
        fix: "The download request failed. Try again; if it repeats, narrow the filters.",
      },
      {
        problem: "\"Couldn't load this {job} for editing.\"",
        fix: "Edit loads the full {job} first and that request failed. Try again or reload.",
      },
      {
        problem: "There's no Assign button on a {job}",
        fix: "Assign shows only on Pending or Confirmed {jobs} that aren't archived. To change the {worker} on others, use Edit → Assign {worker}, or the Scheduler.",
      },
      {
        problem: "An archived {job} can't be opened",
        fix: "Archived rows are greyed out. Restore it first.",
      },
    ],
    keywords: ["work orders", "bookings", "jobs list", "search jobs", "filter", "export csv", "archive", "restore", "print"],
  },
  {
    id: "office-web.dispatch.job-form",
    title: "New {job} / Edit {job} form",
    ...WEB,
    roles: OFFICE,
    path: "{jobs} → New {job} (or Edit on a row); also Scheduler → New {job}, or click a {job} on the Scheduler or Map",
    permission: "work_orders:create",
    summary:
      "The form to book a {job} for a {customer} or change any detail of one: {customer}, service, template, schedule, address, contact, skills, {worker}, tax, pricing, {worker} pay, notes and custom fields. When editing it also shows punch list, form, photos and the field record.",
    controls: [
      { label: "{customer}", does: "Search {customers} by name or email. Typing a new name offers Add \"name\" as a new {customer} (new {jobs} only); then enter their email." },
      { label: "Service", does: "Required. Picks the service (with base price). Manage services opens the Services page." },
      { label: "Template", does: "Loads a job template's checklist and custom fields. If you already have custom fields it asks before replacing them (Replace fields)." },
      { label: "Priority", does: "Low, Normal, High or Urgent." },
      { label: "Title", does: "The {job}'s title." },
      { label: "Schedule", does: "Required. Pick date and time, then Save Schedule (Update Schedule when editing)." },
      { label: "Address", does: "Start typing to pick an address." },
      { label: "Cell Phone", does: "Used for SMS and push notifications to the {customer}." },
      { label: "Email Address", does: "The {customer}'s email; required when adding a new {customer}." },
      { label: "Required skill class / Required skills", does: "Limits which {workers} count as qualified." },
      { label: "Assign {worker}", does: "Optional. Search and pick a {worker}, or Leave unassigned." },
      { label: "Tax region", does: "Auto-detect from address, or pick a province." },
      { label: "Est. minutes on site / Est. mileage", does: "Estimated billable time and round-trip travel." },
      { label: "Notes (customer-facing)", does: "Notes the {customer} can see." },
      { label: "Staff Notes to Driver", does: "Access codes and instructions; not shown to the {customer}." },
      { label: "Products & materials", does: "Add catalog items with quantities." },
      { label: "Per-unit lines", does: "Charge and {worker} pay per measured unit." },
      { label: "Charges: Flat fee / Per hour / Per unit", does: "Adds charges to the {job}." },
      { label: "Mileage charge", does: "Charge the {customer} for distance if you want; mileage is always tracked." },
      { label: "{worker} pay", does: "Internal pay for this {job}; never shown to the {customer}." },
      { label: "Collect payment on site", does: "Gives the {worker} a Take payment button with the {job} total (card, Apple Pay or Google Pay via your connected Stripe account)." },
      { label: "Price preview", does: "Subtotal, tax and total as you build the {job}." },
      { label: "Custom fields · Add field", does: "Add extra questions, instructions or pricing rules for this {job}." },
      { label: "Copy customer selections link", does: "Editing only: copies the link where the {customer} picks options/tiers and signs." },
      { label: "Add photo", does: "Editing only: upload a photo to the {job}." },
      { label: "Create {job} / Save and Close", does: "Saves. Asks \"Book it anyway?\" / \"Save it anyway?\" if the {worker} is busy or off then." },
      { label: "Delete {job}", does: "Editing only, with work_orders:delete: archives the {job} after confirmation." },
      { label: "Cancel", does: "Closes without saving." },
    ],
    tasks: [
      {
        q: "How do I book a {job} for a new {customer}?",
        steps: ["Click New {job}.", "In {customer}, type their name and click Add \"name\" as a new {customer}.", "Enter their Email Address.", "Pick a Service and set Schedule (Save Schedule).", "Click Create {job}."],
      },
      {
        q: "How do I assign a {worker} while creating a {job}?",
        steps: ["In the form, go to Assign {worker}.", "Search and click the {worker}.", "Click Create {job}."],
      },
      {
        q: "How do I change a {job}'s date or time?",
        steps: ["Open the {job} and click Edit.", "Click Schedule, pick the new date and time, and click Update Schedule.", "Click Save and Close."],
      },
      {
        q: "How do I add materials or charges to a {job}?",
        steps: ["Open the {job} form.", "Under Products & materials, add items and quantities.", "Under Charges, add a Flat fee, Per hour or Per unit charge.", "Check the Price preview and save."],
      },
      {
        q: "How do I let the {worker} take payment on site?",
        steps: ["In the {job} form, tick Collect payment on site.", "Save."],
        note: "Payment goes through your connected Stripe account.",
      },
      {
        q: "How do I leave instructions only my {worker} can see?",
        steps: ["In the {job} form, type in Staff Notes to Driver.", "Save."],
      },
      {
        q: "How do I unassign a {worker} from a {job}?",
        steps: ["Edit the {job}.", "Under Assign {worker}, choose Leave unassigned (or the ✕).", "Click Save and Close."],
      },
    ],
    fixes: [
      { problem: "\"Select a {customer}\"", fix: "Pick an existing {customer} or add a new one before saving." },
      { problem: "\"Enter the new customer's name\" / \"Enter the new customer's email\"", fix: "A new {customer} needs both a name and an email." },
      { problem: "\"Select a service\"", fix: "Pick a Service. If it isn't listed, add it under Manage services (Catalog & Forms → Services)." },
      { problem: "\"Pick a schedule date\"", fix: "Set Schedule and click Save Schedule before saving the {job}." },
      {
        problem: "\"Address is outside all active service zones…\"",
        fix: "Your company has active service zones and this address is outside all of them. Correct the address, or adjust zones under Setup → Service Zones.",
      },
      {
        problem: "\"Couldn't create that customer — check the email address\"",
        fix: "The new {customer} couldn't be created from that email. Check it, or pick the existing {customer}.",
      },
      { problem: "\"Book it anyway?\" when creating", fix: "The chosen {worker} is already out on a {job} at that hour or has the day off. Click Book it to proceed, or change the time or {worker}." },
      { problem: "\"Forbidden\" when saving", fix: "Your role can't create or edit {jobs} (work_orders:create / work_orders:edit). Ask your admin." },
      { problem: "There's no Delete {job} button", fix: "It shows only when editing, and only with work_orders:delete." },
      { problem: "Can't add a new {customer} while editing", fix: "Add \"name\" as a new {customer} is only offered on new {jobs}; when editing, pick an existing {customer}." },
    ],
    keywords: ["create job", "new work order", "book job", "edit job", "job form", "work order modal", "add customer", "pricing", "line items"],
  },
  {
    id: "office-web.dispatch.assign-dialog",
    title: "Assign {worker} dialog",
    ...WEB,
    roles: OFFICE,
    path: "{jobs} → Assign on a Pending or Confirmed {job}",
    permission: "work_orders:edit",
    summary:
      "Pick who takes a {job}. {workers} who aren't offline are listed in the order the recommendation ranked them, with the top one marked AI PICK and the reasoning shown above.",
    controls: [
      { label: "AI dispatch / Best match", does: "The recommendation's reasoning, and usually how long this kind of {job} takes on site." },
      { label: "{worker} row", does: "Click to assign. Shows rating, skill class or vehicle, status and why they ranked where they did." },
      { label: "AI PICK", does: "Marks the recommended {worker}." },
      { label: "Close (X)", does: "Closes without assigning." },
    ],
    tasks: [
      {
        q: "How do I assign the recommended {worker}?",
        steps: ["Click Assign on the {job}.", "Click the row marked AI PICK."],
      },
      {
        q: "How do I reassign a {job} someone is already on?",
        steps: ["Open Assign (or drag on the Scheduler).", "Click the new {worker}.", "Click Reassign in the confirmation."],
        note: "Their drive time and on-site clock are cleared and the new {worker} has to accept.",
      },
    ],
    fixes: [
      { problem: "\"No available {workers} online\"", fix: "Every {worker} is offline. Offline {workers} aren't listed here; use the {job} form's Assign {worker} or the Scheduler instead." },
      { problem: "\"Send them anyway?\"", fix: "That {worker} is already booked at that time or has the day off. Click Dispatch anyway if they can make it." },
    ],
    keywords: ["assign technician", "dispatch", "pick tech", "AI pick", "reassign"],
  },
  {
    id: "office-web.dispatch.job-report",
    title: "Job report",
    ...WEB,
    roles: OFFICE,
    path: "{jobs} → click a row (or open a completed {job} anywhere)",
    route: "/admin/jobs/:id/report",
    permission: "work_orders:view",
    summary:
      "The full record of one {job}: timeline, drive time, time on site, mileage, the route driven, photos, the form, punch list, notes, {customer} details, pricing and internal {worker} pay. Edit, download or archive from the top.",
    controls: [
      { label: "Back to Jobs", does: "Returns to the {jobs} list." },
      { label: "Download PDF", does: "Downloads the {job} as a PDF." },
      { label: "Edit job", does: "Not-yet-completed {jobs}: opens the {job} form. Shown to anyone with edit permission on {jobs}." },
      { label: "Edit anyway", does: "Completed {jobs}, admins only: opens the form to correct a genuine mistake." },
      { label: "Archive", does: "Moves the {job} to the archive after confirmation and returns to the list." },
      { label: "Timeline", does: "Scheduled, Assigned, Started driving, Arrived on site and Completed times, plus Drive time, Time on site and Mileage (there and back)." },
      { label: "Route driven", does: "Map of the GPS route: En route, On site and Return. Road-matched or Raw GPS label." },
      { label: "Photos", does: "Click a photo to view it full size." },
      { label: "Form / Punch List / Notes", does: "The completed form answers, punch-list items (Open, In progress, Done) and notes." },
      { label: "Customer / Pricing", does: "{customer} contact, address, assigned {worker}, line items, subtotal, tax, total and payment status." },
      { label: "Technician pay", does: "Internal; not shown to the {customer}. Breakdown and any QuickBooks bill status." },
    ],
    tasks: [
      {
        q: "How do I download a {job} report as a PDF?",
        steps: ["Open the {job}'s report.", "Click Download PDF."],
      },
      {
        q: "How do I fix a mistake on a completed {job}?",
        steps: ["Open the report.", "Click Edit anyway.", "Make the change and click Save and Close."],
        note: "Admins only.",
      },
      {
        q: "How do I see how long the {worker} drove and spent on site?",
        steps: ["Open the report.", "Read Drive time, Time on site and Mileage under Timeline."],
      },
      {
        q: "How do I archive a test {job}?",
        steps: ["Open the report.", "Click Archive.", "Click Archive to confirm."],
        note: "Restore it later from {jobs} → Filters → Show archived.",
      },
    ],
    fixes: [
      { problem: "\"Couldn't load this job report.\"", fix: "The report didn't load (wrong link, or the {job} isn't in this company). Go back to {jobs} and open it again." },
      { problem: "\"No GPS route recorded for this job…\"", fix: "Either the {job} predates route tracking, or its location history has since been purged." },
      { problem: "There's no Edit job button", fix: "Edit job needs edit permission on {jobs}; ask an admin to add it to your role. Edit anyway (on completed {jobs}) is admin-only." },
      { problem: "\"Couldn't archive this job. Please try again.\"", fix: "The archive request failed. Try again." },
    ],
    keywords: ["job details", "job report", "work order details", "timeline", "photos", "mileage", "route", "pdf"],
  },

  // ───────────────────────────── inbox ─────────────────────────────
  {
    id: "office-web.dispatch.inbox",
    title: "Inbox",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Inbox",
    route: "/admin/inbox",
    permission: "work_orders:view",
    summary:
      "Every conversation in one place: {customer} {job} threads (including replies from the tracking page), direct threads with {workers}, and broadcasts sent to groups. Updates live.",
    controls: [
      { label: "Search people, jobs, messages…", does: "Filters conversations by name, {job} or message text." },
      { label: "All / Unread / {customers} / {workers} / Broadcasts", does: "Filters the list; the number is how many threads." },
      { label: "Conversation row", does: "Opens the thread and marks it read." },
      { label: "Open {job}", does: "On a {customer} thread, opens that {job}." },
      { label: "Reply to …", does: "Type and press Enter (or Send reply). A reply on a {customer} thread is also texted to the {customer} with their tracking link, if they have a phone number." },
    ],
    tasks: [
      {
        q: "How do I reply to a {customer}?",
        steps: ["Open Inbox.", "Click {customers} or search for them.", "Click the conversation.", "Type your reply and press Enter."],
      },
      {
        q: "How do I see only unread messages?",
        steps: ["Open Inbox.", "Click Unread."],
      },
      {
        q: "How do I find a conversation about a specific {job}?",
        steps: ["Open Inbox.", "Type the {job} title, {customer} name or a word from the message in the search box.", "Click the conversation."],
      },
      {
        q: "How do I message a {worker} from the Inbox?",
        steps: ["Click the {workers} filter.", "Open their thread.", "Type and send."],
      },
    ],
    fixes: [
      { problem: "I can't reply to a broadcast", fix: "Broadcasts are one-way. Replies arrive as individual {worker} threads." },
      { problem: "\"No conversations match\"", fix: "Try a different search term, or switch the filter back to All." },
      { problem: "A thread is still marked unread after I looked at it in the list", fix: "Threads are marked read only when you open them, not when the list refreshes." },
    ],
    keywords: ["messages", "conversations", "customer replies", "sms replies", "chat", "unread"],
  },

  // ───────────────────────────── change requests ─────────────────────────────
  {
    id: "office-web.dispatch.change-requests",
    title: "Change Requests",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Change Requests",
    route: "/admin/change-requests",
    permission: "work_orders:view",
    summary:
      "Where {customer} requests to cancel or reschedule from their tracking page land. Nothing changes on the {job} until someone here approves it.",
    controls: [
      { label: "Needs a decision / All / Approved / Declined / Self-serve", does: "Filters requests. Self-serve shows changes the {customer} made themselves (\"Done by customer\")." },
      { label: "#{job number}", does: "Opens that {job}." },
      { label: "Approve cancellation", does: "Opens a confirmation; approving cancels the {job} and notifies the {customer}." },
      { label: "Approve new time", does: "Opens a confirmation; approving moves the appointment to the requested time and notifies everyone." },
      { label: "Decline", does: "Opens a confirmation; the appointment stays as booked and your note is what the {customer} is told." },
      { label: "Note (optional) / What should we tell them?", does: "Your note, kept on the {job}'s history." },
      { label: "Approve / Decline (in dialog) / Back", does: "Saves the decision, or goes back without deciding." },
    ],
    tasks: [
      {
        q: "How do I approve a {customer}'s cancellation?",
        steps: ["Open Change Requests (Needs a decision).", "On the request, click Approve cancellation.", "Optionally add a note.", "Click Approve."],
        note: "The {job} is cancelled and the {worker} is freed up.",
      },
      {
        q: "How do I approve a reschedule request?",
        steps: ["On the request, click Approve new time.", "Check the old → new time.", "Click Approve."],
      },
      {
        q: "How do I decline a request?",
        steps: ["Click Decline on the request.", "Under What should we tell them?, write the reason.", "Click Decline."],
      },
      {
        q: "How do I see past decisions?",
        steps: ["Open Change Requests.", "Click All, Approved or Declined."],
      },
    ],
    fixes: [
      { problem: "\"This request was already decided.\"", fix: "Someone else decided it first. The list refreshes; check All to see the decision." },
      { problem: "\"This request has no proposed time.\"", fix: "A reschedule request is missing its new time, so it can't be approved. Decline it or contact the {customer}." },
      { problem: "\"Couldn't save that decision\"", fix: "The decision didn't save. Try again." },
    ],
    keywords: ["cancellation request", "reschedule request", "customer cancel", "approve", "decline", "appointment change"],
  },

  // ───────────────────────────── maintenance ─────────────────────────────
  {
    id: "office-web.dispatch.maintenance",
    title: "Maintenance Plans",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → People → Maintenance Plans",
    route: "/admin/maintenance",
    permission: "work_orders:view",
    summary:
      "Recurring service agreements (\"furnace tune-up every 180 days\"). Before each due date a reminder goes out; reminders don't book anything on the calendar by themselves.",
    controls: [
      { label: "New plan", does: "Opens New maintenance plan." },
      { label: "Active plans / Due within 30 days / Reminders sent", does: "Summary counts." },
      { label: "Plan row", does: "Shows address, interval, next due date (with days left or overdue) and reminder lead time." },
      { label: "Mark serviced", does: "Rolls the next due date forward one interval from today." },
      { label: "Pause plan / Activate plan", does: "The switch on each plan. Pausing cancels its pending reminder." },
      { label: "Delete plan", does: "The trash icon deletes the plan straight away (no confirmation)." },
      { label: "Plan name / Service address / Notes", does: "In the new-plan form." },
      { label: "How often: Monthly / Quarterly / Twice a year / Yearly", does: "Sets the interval (30, 90, 180, 365 days), or type a number of days." },
      { label: "Remind days before / First due date", does: "Reminder lead time, and the first due date (blank = one interval from today)." },
      { label: "Create plan", does: "Saves the plan. Disabled until it has a name." },
    ],
    tasks: [
      {
        q: "How do I set up a recurring maintenance plan?",
        steps: ["Go to Maintenance Plans.", "Click New plan.", "Enter the plan name and address.", "Pick How often (or type days).", "Set Remind days before and First due date.", "Click Create plan."],
      },
      {
        q: "How do I record that a plan's visit is done?",
        steps: ["Find the plan.", "Click Mark serviced."],
        note: "The next due date moves one interval from today.",
      },
      {
        q: "How do I pause a plan?",
        steps: ["Go to Maintenance Plans and find the plan.", "Click its switch so it turns grey (Pause plan)."],
      },
      {
        q: "How do I delete a plan?",
        steps: ["Go to Maintenance Plans and find the plan.", "Click its trash icon (Delete plan)."],
        note: "There's no confirmation and no undo.",
      },
    ],
    fixes: [
      {
        problem: "Create plan is greyed out",
        fix: "Give the plan a name first.",
      },
      {
        problem: "Plans made here don't text the {customer}",
        fix: "This form doesn't link a {customer}, so the reminder only goes to the office. A text goes out only when the plan is linked to a {customer} with a phone number.",
      },
      {
        problem: "I set Remind days before to 0 and it saved as 7",
        fix: "A blank or 0 value is saved as the default of 7 days.",
      },
    ],
    keywords: ["recurring", "service agreement", "maintenance", "tune-up", "reminder", "membership", "repeat visit"],
  },

  // ───────────────────────────── map ─────────────────────────────
  {
    id: "office-web.dispatch.map-classic",
    title: "Map (classic)",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Map",
    route: "/admin/fleet?map=classic",
    permission: "fleet_map:view",
    summary:
      "A live map of {workers} and {jobs}, with the Unassigned list on the left and a detail panel for the {worker} you click: current {job}, call, text, message and route optimisation.",
    controls: [
      { label: "Try the new map", does: "Switches to the new dispatch map and remembers your choice on this browser." },
      { label: "Drivers / Jobs / Both", does: "Shows {workers}, {jobs}, or both on the map." },
      { label: "Date from → to / Today", does: "Shown when {jobs} are visible: which days' {jobs} to map. The number is how many are shown." },
      { label: "Status legend", does: "Count of {workers} per status (Available, En Route, On Site, Busy, Break, Offline)." },
      { label: "Unassigned", does: "{jobs} waiting for a {worker}; click one to open it. \"No date\" marks unscheduled ones." },
      { label: "{worker} pin", does: "Opens their panel: Status, Rating, Jobs, Vehicle and Current Job with ETA." },
      { label: "{job} pin", does: "Opens the {job} form (completed {jobs} open the report)." },
      { label: "Call", does: "Calls the {worker}'s phone." },
      { label: "Text", does: "Opens Text {name} to send an SMS (Send SMS)." },
      { label: "Message", does: "Opens the in-app direct message thread; a number shows unread messages." },
      { label: "Optimize Route", does: "Suggests a stop order for the {worker}'s queued {jobs} with leg and total distance/time and km saved." },
    ],
    tasks: [
      {
        q: "How do I see where my {workers} are?",
        steps: ["Open Map.", "Click Drivers.", "Click a pin for details."],
      },
      {
        q: "How do I see today's {jobs} on the map?",
        steps: ["Click Jobs or Both.", "Click Today (or set the dates)."],
      },
      {
        q: "How do I text a {worker} from the map?",
        steps: ["Click their pin.", "Click Text.", "Type the message and click Send SMS."],
      },
      {
        q: "How do I get a better route for a {worker}?",
        steps: ["Click their pin.", "Click Optimize Route.", "Read the suggested stop order."],
      },
      {
        q: "How do I switch to the new map?",
        steps: ["Open Map.", "Click Try the new map at the top."],
      },
    ],
    fixes: [
      { problem: "\"No technicians active right now\"", fix: "Everyone on the team is offline, or there are no {workers} yet." },
      { problem: "\"Logged (SMS not configured)\"", fix: "The text was recorded but not sent because SMS isn't set up for your company." },
      { problem: "Text says \"No number on file\"", fix: "The {worker} has no phone number. Add one on their profile under {workers} & Managers." },
    ],
    keywords: ["live map", "fleet", "gps", "tracking", "where are my techs", "route optimization", "drivers"],
  },
  {
    id: "office-web.dispatch.map-v2",
    title: "Map (new dispatch map)",
    ...WEB,
    roles: OFFICE,
    path: "Sidebar → Operations → Map (new map, or Try the new map from the classic one)",
    route: "/admin/fleet?map=v2",
    permission: "fleet_map:view",
    summary:
      "The newer live dispatch map: {workers} and {jobs} on the map, the Unassigned list, a team strip, and panels for the selected {worker} or {job}. Drag a {job} onto a {worker} to assign it. Needs a browser with WebGL2; otherwise the classic map opens.",
    controls: [
      { label: "Find", does: "Search for a {worker} or {job} and jump to it. Shortcut: / or Ctrl/Cmd+K." },
      { label: "Fit all", does: "Zooms to show everything. Shortcut: F." },
      { label: "Satellite", does: "Toggles satellite imagery. Shortcut: S." },
      { label: "Install app", does: "Installs the dispatch map as an app where the browser allows (on iPhone/iPad it explains Share → Add to Home Screen)." },
      { label: "Classic map", does: "Switches back to the classic map and remembers it." },
      { label: "Unassigned", does: "{jobs} without a {worker}, with the best match shown; click to select." },
      { label: "Team strip", does: "Every {worker}; click to select and centre on them." },
      { label: "{worker} panel: Call / Message / Text / Center", does: "Contact or centre on the selected {worker}; lists their {jobs} today." },
      { label: "{job} panel: Open / Directions / Copy address", does: "Open the {job} form, get directions, or copy the address." },
      { label: "Assign (candidate list)", does: "Assigns the {job} to that {worker}; Best match marks the top candidate. Shortcut: A focuses it." },
      { label: "Unassign", does: "Shown when the {job} is only offered (not yet accepted): takes it back." },
      { label: "Assign anyway / Cancel", does: "Shown when the {worker} is busy or off at that time." },
      { label: "Undo (toast)", does: "Undo an assignment right after making it." },
    ],
    tasks: [
      {
        q: "How do I assign a {job} on the map?",
        steps: ["Drag the {job} from Unassigned onto a {worker} on the map, team strip or their panel.", "Or click the {job} and click Assign next to a {worker}."],
      },
      {
        q: "How do I undo an assignment on the map?",
        steps: ["Right after assigning, find the toast.", "Click Undo."],
        note: "If the {worker} already has it: \"Too late to undo. The technician already has it.\"",
      },
      {
        q: "How do I find a {worker} or {job} quickly?",
        steps: ["Click Find (or press /).", "Type a name, {customer} or address.", "Pick the result."],
      },
      {
        q: "How do I go back to the old map?",
        steps: ["Open Map.", "Click Classic map in the toolbar at the top."],
      },
    ],
    fixes: [
      { problem: "\"Couldn't load the board. Retrying…\"", fix: "The map data didn't load; it retries on its own. Reload if it doesn't recover." },
      { problem: "\"Couldn't assign. Try again.\"", fix: "The assignment failed. Try again, or open the {job} and assign from the form." },
      { problem: "The new map never opens for me", fix: "It needs WebGL2 in the browser. Without it, Map always opens the classic map." },
    ],
    keywords: ["dispatch map", "map v2", "new map", "drag to assign", "satellite", "live dispatch"],
  },

  // ───────────────────────────── zones ─────────────────────────────
  {
    id: "office-web.dispatch.zones",
    title: "Service Zones",
    ...WEB,
    roles: ["admin"],
    path: "Sidebar → Setup → Service Zones",
    route: "/admin/zones",
    permission: "zones:edit",
    summary:
      "Draw the areas you serve and set surge pricing per area. Once any zone is active, {jobs} and intake submissions with addresses outside every active zone are rejected.",
    controls: [
      { label: "Polygon", does: "Click points on the map to outline an area, then Done (n pts). Needs at least 3 points." },
      { label: "Rectangle", does: "Click two opposite corners." },
      { label: "Circle", does: "Click the centre, then any point to set the radius." },
      { label: "Cancel", does: "Stops drawing." },
      { label: "Zone list row", does: "Selects the zone and zooms to it. Hover shows Edit and Delete icons." },
      { label: "Edit zone", does: "Opens the zone's settings (name, colour, surge, active). The shape itself can't be reshaped here." },
      { label: "Zone name / Color / Surge multiplier / Zone active", does: "In the zone dialog. Surge 1 = normal pricing, 1.5 = +50%." },
      { label: "Create zone / Save changes", does: "Saves the zone. Disabled until it has a name." },
      { label: "Delete", does: "Permanently removes the zone after confirmation." },
      { label: "Zone enforcement", does: "Says whether any zone is active and what that means for new {jobs}." },
    ],
    tasks: [
      {
        q: "How do I add a service area?",
        steps: ["Go to Setup → Service Zones.", "Click Polygon, Rectangle or Circle.", "Draw on the map (Polygon: click Done).", "Enter a Zone name and pick a colour.", "Click Create zone."],
      },
      {
        q: "How do I charge more in one area?",
        steps: ["Click the zone in the list and click Edit zone.", "Set Surge multiplier (e.g. 1.5 for +50%).", "Click Save changes."],
      },
      {
        q: "How do I stop rejecting {jobs} outside my zones?",
        steps: ["Edit each zone.", "Untick Zone active.", "Save changes."],
        note: "With no active zones, {jobs} are accepted from any address.",
      },
      {
        q: "How do I change a zone's shape?",
        steps: ["Delete the zone.", "Draw it again with Polygon, Rectangle or Circle."],
        note: "Edit zone changes only its name, colour, surge and active setting.",
      },
    ],
    fixes: [
      { problem: "A {job} or booking is rejected as outside the service area", fix: "The address is outside every active zone. Widen or add a zone, untick Zone active, or correct the address." },
      { problem: "Done is greyed out while drawing a polygon", fix: "A polygon needs at least 3 points." },
      { problem: "I can't open Service Zones", fix: "It needs zones:edit, which by default only admins have." },
    ],
    keywords: ["service area", "coverage", "zones", "geofence", "surge pricing", "territory"],
  },

  // ───────────────────────────── custom milestone ─────────────────────────────
  {
    id: "office-web.dispatch.custom-milestone",
    title: "New milestone / Edit milestone (custom milestone)",
    ...WEB,
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Notification Rules → New milestone (or click a milestone under Your milestones)",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "Add a notification moment of your own next to the built-in ones, such as \"Water restored\" or a day-before reminder. It goes out once per {job}, to the {customer}, the {worker} and/or the office.",
    controls: [
      { label: "Name", does: "What the milestone is called (up to 60 characters)." },
      { label: "A stage", does: "Fires when the {job} reaches a step: assigned, accepted, on the way, arrives, work starts, completed, cancelled, rescheduled or running late (pick under When)." },
      { label: "A checklist item", does: "Fires when the {worker} ticks a checklist item worded as on your job templates. Capitals and extra spaces don't matter." },
      { label: "Before the appointment / After the job is done", does: "Fires a set number of minutes, hours or days before the start or after completion." },
      { label: "Who hears about it", does: "Tick {customer} (by text and in the app), {worker} (in the app) and/or Office (office admins, in the app), and write each message." },
      { label: "Insert: {{variable}}", does: "Inserts a variable such as the first name or address into the message you last typed in." },
      { label: "Show it on the {customer}'s tracking page", does: "Adds a line to the {job}'s timeline on the tracking page." },
      { label: "On", does: "Editing only: untick to pause the milestone without losing its messages." },
      { label: "Add milestone / Save changes", does: "Saves." },
      { label: "Delete", does: "Editing only: deletes the milestone after confirmation. Lines it already added to {job} timelines stay." },
    ],
    tasks: [
      {
        q: "How do I send a reminder the day before an appointment?",
        steps: ["Go to Setup → Notifications.", "Click New milestone.", "Name it (e.g. Day-before reminder).", "Click Before the appointment and set 1 days.", "Tick the {customer} and write the message.", "Click Add milestone."],
      },
      {
        q: "How do I notify the {customer} when the {worker} ticks a checklist item?",
        steps: ["Click New milestone.", "Click A checklist item and type the item exactly as on the template.", "Tick the {customer} and write the message.", "Click Add milestone."],
      },
      {
        q: "How do I pause a custom milestone?",
        steps: ["On Notifications, click the milestone under Your milestones.", "Untick On.", "Click Save changes."],
      },
      {
        q: "How do I change which channels a milestone uses?",
        steps: ["Save the milestone.", "In the Notifications table, switch text, email or app per recipient on its row."],
      },
    ],
    fixes: [
      { problem: "\"Give the milestone a name.\"", fix: "Enter a name before saving." },
      { problem: "\"Pick the moment it goes off.\"", fix: "With A stage, choose an option under When." },
      { problem: "\"Type the checklist item it waits for.\"", fix: "With A checklist item, enter the item's wording." },
      { problem: "\"Make it at least 5 minutes.\" / \"Keep it within 30 days.\"", fix: "Before/after timings must be between 5 minutes and 30 days." },
      { problem: "\"Write the message for the …, or untick them.\"", fix: "Every ticked recipient needs a message (unless a branded email is already designed for them)." },
      { problem: "\"You can have up to 50 custom milestones.\"", fix: "Delete or reuse an existing custom milestone." },
    ],
    keywords: ["custom notification", "milestone", "reminder", "trigger", "checklist notification", "custom event"],
  },
];
