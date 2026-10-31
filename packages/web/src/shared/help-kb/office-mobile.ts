/**
 * Office side of the ArrivePing mobile app (iPhone, iPad, Android): what an
 * admin, manager or dispatcher sees after picking a company where they hold an
 * office role. Written from packages/mobile/app/(office), app/office,
 * app/pick-company.tsx and components/office. See types.ts for the format.
 *
 * Layout rule (lib/layout.ts): the "iPad layout" is a tablet whose window is at
 * least 768 pt wide. A phone turned sideways, or an iPad squeezed into a narrow
 * Split View column, gets the phone layout.
 */
import type { KbEntry } from "./types";

const OFFICE = ["admin", "manager", "dispatcher"] as const;
const P: KbEntry["platforms"] = ["ios", "android"];

export const entries: KbEntry[] = [
  // ------------------------------------------------------------ company picker --
  {
    id: "office-mobile.pick-company",
    title: "Company picker",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Open the app → sign in (and unlock with Face ID or fingerprint if the lock is on) → Who are you working for today?",
    route: "/pick-company",
    summary:
      "Chooses which company this device works for. Picking a company where you hold an office role (admin, manager, dispatcher, project manager) opens office mode; a technician membership opens the technician side. With one company and no pending invitations the screen is skipped.",
    controls: [
      { label: "Company card (\"Work for {company} today\")", does: "Makes that company active, clears data cached for the previous company and opens office mode or the technician side, depending on your role there." },
      { label: "Accept", does: "Accepts a pending invitation to join that company's roster, then reloads the list." },
      { label: "Decline", does: "Asks \"Decline {company}?\" and, on confirm, declines the invitation. They have to invite you again if you change your mind." },
      { label: "Refresh", does: "Shown when you have no active company: reloads your companies and invitations." },
      { label: "Try again", does: "Shown when the list failed to load: retries." },
      { label: "Unlock", does: "On the \"ArrivePing is locked\" screen: asks for Face ID or fingerprint again after a cancelled prompt." },
    ],
    tasks: [
      {
        q: "How do I pick which company I'm dispatching for?",
        steps: ["Open the app.", "On Who are you working for today?, tap the company."],
        note: "If you belong to only one company and have no pending invitations, the app goes straight to it.",
      },
      {
        q: "How do I switch to another company later?",
        steps: ["Tap the profile icon (top right of any office tab).", "Under Working for, tap the other company."],
        note: "The Working for card only shows when you belong to more than one company.",
      },
      {
        q: "How do I accept an invitation to a company?",
        steps: ["Open the app.", "Under Invitation, tap Accept on the company's card."],
      },
      {
        q: "The app is locked and I cancelled Face ID. How do I get in?",
        steps: ["On ArrivePing is locked, tap Unlock.", "Approve with Face ID, fingerprint or your device passcode."],
      },
    ],
    fixes: [
      {
        problem: "\"No active company\" after signing in",
        fix: "You aren't on any company's roster yet (customer logins don't count here). Ask the company to invite you, then tap Refresh.",
      },
      {
        problem: "\"Can't load your companies\"",
        fix: "The list couldn't be fetched, usually a connection problem. Check your signal and tap Try again.",
      },
      {
        problem: "I opened a company and got the technician screens instead of the office tabs",
        fix: "Office mode opens only where your role at that company is admin, manager, dispatcher or project manager (or super admin). If you are both office staff and a technician there, switch with Profile → Switch to field mode, and back with Switch to office mode on the technician profile.",
      },
    ],
    keywords: ["switch company", "choose company", "workspace", "tenant", "invitation", "join company", "locked"],
  },

  // ----------------------------------------------------------------------- Today --
  {
    id: "office-mobile.today",
    title: "Today",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Office mode → Today tab (first tab)",
    route: "/(office)",
    summary:
      "The live operations dashboard: today's numbers, where the crew is, a \"Needs you\" queue of problems with one-tap fixes, and the next assigned {jobs}. Once nothing is left to run today it switches to \"Day wrapped\" plus a Tomorrow preview.",
    controls: [
      { label: "Live / Polling / After hours", does: "Status dot in the header. Green Live means updates stream in; amber Polling means the board refreshes every 30 seconds; After hours shows once the day is wrapped. The word shows on iPad; a phone shows only the dot." },
      { label: "Broadcast", does: "Opens Messages with the Broadcast sheet open. Needs permission to edit {jobs}. Icon-only (megaphone) on a phone." },
      { label: "Map", does: "Opens the Team tab in Map view. Icon-only (pin) on a phone." },
      { label: "New job", does: "Opens New job. Needs permission to create {jobs}. Icon-only (+) on a phone." },
      { label: "Profile and settings", does: "The person icon at the top right: opens Profile." },
      { label: "Jobs today", does: "Tile: {jobs} today and how many {workers} are on shift. Opens Jobs → Scheduled." },
      { label: "Done", does: "Tile: finished {jobs} and % of the day. Opens Jobs → Done." },
      { label: "In progress", does: "Tile: {jobs} in the field now. Opens Jobs → In progress." },
      { label: "To start", does: "Tile: {jobs} not started yet and when the last one ends. Opens Jobs → Scheduled." },
      { label: "Late", does: "Tile (red outline when above zero): {jobs} flagged as running late. Opens Jobs → Scheduled." },
      { label: "Unassigned", does: "Tile (red outline when above zero): {jobs} with nobody on them, plus \"+N this week\" for later days. Opens Jobs → Unassigned." },
      { label: "Offer pending", does: "Tile: {jobs} offered but not accepted, plus how many are unconfirmed. Opens Jobs → Scheduled." },
      { label: "Booked today", does: "Tile shown only when today's {jobs} carry prices: money booked today and how much is from finished work. Opens Jobs → Done." },
      { label: "Day timeline", does: "Strip under the tiles: each {job} as a block across the day with a red now-line. Legend: Done, In progress, To start, Unassigned or late, and the busiest hour." },
      { label: "Crew now chips", does: "\"N available\", \"N on the way\", \"N on site\", \"N busy or on break\", \"N off shift\". Tapping one opens Team filtered to that group." },
      { label: "Needs you", does: "One queue, worst first: Late, Unassigned, Offered · not accepted, Location stale, Unconfirmed. Tapping a row opens the {job} (or Team for a stale location). Shows 5 items (6 on a wide iPad)." },
      { label: "Message {first name}", does: "On a Needs you row: opens your thread with that {worker} (beside the list on iPad)." },
      { label: "Assign / Reassign", does: "On a Needs you row: opens the {job} with the Assign sheet already open." },
      { label: "Open", does: "On a Needs you row: opens the {job}." },
      { label: "Call", does: "On a Location stale row: calls the {worker}'s phone from your device." },
      { label: "Text client", does: "On an Unconfirmed row with a phone number: opens your device's Messages app addressed to the {customer}. The text comes from your own phone, not ArrivePing." },
      { label: "See all ›", does: "Under Needs you when there are more rows than shown: opens Jobs → Unassigned." },
      { label: "Plan the week ›", does: "Shown when more {jobs} are unassigned later this week. On iPad opens Board in Week view; on a phone opens Jobs → Unassigned for tomorrow." },
      { label: "Up next", does: "Assigned {jobs} starting in the next 2 hours (or the next few if none), each with the {worker} and On time, ETA N min, On the way, Not on shift, Free ~time, Finishing a job or Unconfirmed. Tap to open." },
      { label: "Plan tomorrow ›", does: "On the Tomorrow card after the day is wrapped. On iPad opens Board in Day view on tomorrow; on a phone opens Jobs → Unassigned for tomorrow." },
      { label: "Tomorrow tiles", does: "Jobs, On roster, Unassigned, Unconfirmed for tomorrow, with the first start time and who is off. Each opens the matching list." },
      { label: "Dismiss", does: "Closes the one-time \"Dispatch from your phone\" intro card for good on this device." },
    ],
    tasks: [
      {
        q: "How do I see today's jobs from my phone?",
        steps: ["Open the Today tab.", "Tap the Jobs today tile to see the list, or read Up next for what starts soon."],
      },
      {
        q: "What needs my attention right now?",
        steps: ["Open the Today tab.", "Read the Needs you panel; each row says why (Late, Unassigned, Offered · not accepted, Location stale, Unconfirmed).", "Tap the button on the row (Assign, Reassign, Message, Call or Text client) to fix it."],
      },
      {
        q: "How do I assign an unassigned job from Today?",
        steps: ["Open the Today tab.", "On the Unassigned row in Needs you, tap Assign.", "Pick a {worker} in the Assign to sheet."],
        note: "Needs permission to edit {jobs}; without it the Assign button doesn't show.",
      },
      {
        q: "How do I nudge a customer who hasn't confirmed?",
        steps: ["Open the Today tab.", "On the Unconfirmed row, tap Text client.", "Write and send the text in your phone's Messages app."],
        note: "Only shows when the {job} has a phone number; the text is sent from your own phone.",
      },
      {
        q: "How do I see who is available, on the way or on site?",
        steps: ["Open the Today tab.", "Read the Crew now chips.", "Tap a chip to open Team filtered to that group."],
      },
      {
        q: "How do I see where my technicians are on a map?",
        steps: ["Open the Today tab.", "Tap Map (the pin icon on a phone)."],
      },
      {
        q: "How do I send one message to the whole team?",
        steps: ["Open the Today tab.", "Tap Broadcast (the megaphone on a phone).", "Choose who gets it, type the message and tap Send to team."],
      },
      {
        q: "How do I plan tomorrow after the day is done?",
        steps: ["Open the Today tab once the day shows Day wrapped.", "On the Tomorrow card, tap Plan tomorrow ›.", "On iPad, place {jobs} on the Board; on a phone, assign them from Jobs → Unassigned."],
      },
      {
        q: "How do I refresh the numbers?",
        steps: ["Open the Today tab.", "Pull down on the screen."],
      },
    ],
    fixes: [
      {
        problem: "\"Couldn't load the board\"",
        fix: "Today couldn't fetch the day's jobs. Pull down to retry; if it keeps failing, check your connection or sign in again.",
      },
      {
        problem: "The header dot says Polling instead of Live",
        fix: "The live update stream isn't connected, so the board refreshes every 30 seconds instead. It switches back to Live by itself when the stream reconnects.",
      },
      {
        problem: "\"Showing the first N jobs. Open the web console for the full day.\"",
        fix: "The day has more {jobs} than the app loads at once, so counts are partial. Use the office dashboard in a browser for the full day.",
      },
      {
        problem: "A technician shows \"Location stale\"",
        fix: "Their phone hasn't reported a position for over 10 minutes while they're on shift. Use Message or Call on the row to check on them; the app may be closed or location turned off on their phone.",
      },
      {
        problem: "There's no Broadcast or New job button",
        fix: "Broadcast needs permission to edit {jobs} and New job needs permission to create {jobs}. Ask an admin to change your role.",
      },
    ],
    keywords: ["dashboard", "home", "day pulse", "needs you", "up next", "crew now", "late jobs", "unassigned", "tomorrow", "revenue"],
  },

  // ------------------------------------------------------------------------ Jobs --
  {
    id: "office-mobile.jobs",
    title: "Jobs",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Office mode → Jobs tab",
    route: "/(office)/jobs",
    permission: "work_orders:view or scheduler:view",
    summary:
      "One day's {jobs} split into Unassigned, Scheduled, In progress and Done, with a day strip and search. On a phone a tap opens the {job} full screen; on iPad the {job} opens beside the list.",
    controls: [
      { label: "New job", does: "The + button in the header: opens New job. Needs permission to create {jobs}." },
      { label: "Day strip", does: "Nine days starting yesterday, each with its {job} count. Tap a day to show it." },
      { label: "Previous week / Next week", does: "Arrows either side of the day strip: page the strip a week at a time." },
      { label: "Today", does: "Shown when today is off the strip: jumps back to today." },
      { label: "Unassigned / Scheduled / In progress / Done", does: "Tabs with counts. Unassigned = nobody on it; Scheduled = has a {worker}, not started; In progress = in the field; Done = completed or cancelled." },
      { label: "Search client, address, service", does: "Filters the current tab by {customer} name, address, title or service." },
      { label: "Job row", does: "Time, length, {customer}, service, address, status and who has it (\"Unassigned\" in amber). A dot marks high or urgent priority; a red Late tag marks late {jobs}. Tap to open." },
    ],
    tasks: [
      {
        q: "How do I see unassigned jobs?",
        steps: ["Open the Jobs tab.", "Tap Unassigned."],
      },
      {
        q: "How do I look at another day's jobs?",
        steps: ["Open the Jobs tab.", "Tap the day on the day strip (use the arrows to page a week).", "Tap Today to come back."],
      },
      {
        q: "How do I find a job by customer or address?",
        steps: ["Open the Jobs tab.", "Pick the tab the {job} is in (Unassigned, Scheduled, In progress or Done).", "Type in Search client, address, service."],
        note: "Search covers the selected day and tab only.",
      },
      {
        q: "How do I assign or reassign a job from the list?",
        steps: ["Open the Jobs tab.", "Tap the {job}.", "Tap Assign a technician (or Reassign) and pick someone."],
      },
      {
        q: "How do I book a new job from the Jobs tab?",
        steps: ["Open the Jobs tab.", "Tap + at the top right.", "Fill in Client, Service, Address, When and Who takes it, then tap Create job."],
      },
      {
        q: "How does the Jobs tab work on iPad?",
        steps: ["Open the Jobs tab on an iPad in landscape or full screen.", "Tap a {job} in the list; it opens in the right-hand pane.", "Use the buttons in the pane the same way as on a phone."],
        note: "On iPad the first {job} in the list opens automatically. In a narrow Split View column the phone layout is used.",
      },
    ],
    fixes: [
      {
        problem: "\"Couldn't load jobs\"",
        fix: "The day couldn't be fetched. Pull down to retry, and check your connection.",
      },
      {
        problem: "\"No unassigned jobs\" (or scheduled, in progress, done) but I expected some",
        fix: "The list shows one day and one tab at a time. Check the day selected on the strip and try the other tabs; clear the search box if it has text.",
      },
      {
        problem: "The Jobs tab is missing",
        fix: "It shows only when your role can view {jobs} or the scheduler. Ask an admin on your account.",
      },
      {
        problem: "\"Showing the first N. Open the web console for the full day.\"",
        fix: "That day has more {jobs} than the app loads at once. Use the office dashboard in a browser to see all of them.",
      },
    ],
    keywords: ["job list", "work orders", "schedule", "search jobs", "day view", "split view"],
  },

  // -------------------------------------------------------------- Job details --
  {
    id: "office-mobile.jobs.job-details",
    title: "Job details",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Office mode → Jobs tab → tap a job (also from Today, Team, Board, the map and push notifications)",
    route: "/office/job/[id]",
    permission: "work_orders:view",
    summary:
      "One {job}, the office view: when, how long, the {customer} and their phone, the address, the {worker}, notes, line items and activity, with buttons to call or text the {customer}, assign or reassign, reschedule, message the {worker}, edit or cancel. On iPad it fills the right pane of Jobs (no back button) and shows two columns when wide enough.",
    controls: [
      { label: "Back", does: "Returns to the previous screen (full-screen view only)." },
      { label: "Call {customer}", does: "Phone icon in the title row: calls the {job}'s phone number from your device. Only shows when there is a number." },
      { label: "Email {customer}", does: "Envelope icon: opens your mail app to the {customer}'s email. Only shows when they have one." },
      { label: "Edit job", does: "Pencil icon: opens Edit job. Needs permission to edit {jobs}; hidden once the {job} is completed or cancelled." },
      { label: "More", does: "Three-dots menu with Open in web console, Cancel job (needs edit permission) and Close." },
      { label: "Phone", does: "In the facts card: tap the number to call." },
      { label: "Address", does: "Opens the address in Apple Maps (iPhone/iPad) or your maps app (Android)." },
      { label: "Message {worker}", does: "Chat icon on the Technician card: opens your ArrivePing thread with them (beside the list on iPad)." },
      { label: "Suggested", does: "On an unassigned {job}: up to three {workers} the server ranks best, marked Fits or Tight. Tap one to assign straight away." },
      { label: "Assign a technician / Reassign", does: "Bottom bar: opens the Assign to / Reassign to sheet. Needs permission to edit {jobs}." },
      { label: "Reschedule", does: "Bottom bar: opens the Move to sheet to pick a new day and time. Needs scheduler edit permission." },
      { label: "Text / Message client", does: "Bottom bar: opens your phone's Messages app to the {customer}'s number. Labelled Text on a phone, Message client in the wide two-column layout. Sent from your own phone." },
      { label: "Undo", does: "On the toast after an assign or move: reverses it. The toast stays about 10 seconds." },
    ],
    tasks: [
      {
        q: "How do I call the customer?",
        steps: ["Open the {job}.", "Tap the phone icon in the title row (or tap the number under Phone)."],
      },
      {
        q: "How do I text the customer?",
        steps: ["Open the {job}.", "Tap Text in the bottom bar (Message client on a wide iPad pane).", "Send the message from your phone's Messages app."],
        note: "This uses your device's own texting, not ArrivePing's automatic customer texts.",
      },
      {
        q: "How do I get directions to the job address?",
        steps: ["Open the {job}.", "Tap the Address in the facts card."],
      },
      {
        q: "How do I assign a technician to a job?",
        steps: ["Open the {job}.", "Tap Assign a technician.", "Tap a {worker} in the Assign to sheet.", "Tap Undo on the toast if you picked the wrong person."],
        note: "For an unassigned {job} you can also tap one of the Suggested {workers} on the Technician card.",
      },
      {
        q: "How do I move a job to another time or day?",
        steps: ["Open the {job}.", "Tap Reschedule.", "Pick the day, then the time.", "Tap the Set … at … button."],
      },
      {
        q: "How do I message the technician on a job?",
        steps: ["Open the {job}.", "On the Technician card, tap the chat icon.", "Type your message and send."],
      },
      {
        q: "How do I cancel a job?",
        steps: ["Open the {job}.", "Tap More (three dots).", "Tap Cancel job.", "Confirm with Cancel job."],
        note: "The {worker} (or the {customer}, if nobody is assigned) is notified. Needs permission to edit {jobs}.",
      },
      {
        q: "How do I change the job's details, notes or line items?",
        steps: ["Open the {job}.", "Tap the pencil (Edit job).", "Make the changes and tap Save."],
      },
      {
        q: "How do I see when the technician accepted, started or finished?",
        steps: ["Open the {job}.", "Scroll to the Activity card (Created, Assigned, Accepted, On the way, Started, Signed, Finished)."],
      },
    ],
    fixes: [
      {
        problem: "\"Couldn't load this job\"",
        fix: "The {job} couldn't be fetched, or it no longer exists. Pull down to retry; if it was deleted on the web it won't come back.",
      },
      {
        problem: "There's no Reassign, Reschedule or Edit button",
        fix: "Completed and cancelled {jobs} can't be assigned, moved or edited. Otherwise your role is missing permission: assigning and editing need {job} edit permission, rescheduling needs scheduler edit permission.",
      },
      {
        problem: "The Reschedule button is greyed out",
        fix: "It waits for the company's clock (time zone) to load with the board. Give it a moment or pull down to refresh.",
      },
      {
        problem: "\"Move it anyway?\" when rescheduling",
        fix: "The new time clashes with something (for example the {worker} is already booked or off). Read the reason and tap Move anyway to go ahead, or Cancel.",
      },
      {
        problem: "\"Your role can't do that. Ask an admin on your account.\"",
        fix: "The server refused the action for your role. An admin can grant the permission in the office dashboard.",
      },
      {
        problem: "\"That changed while you were looking. Pull to refresh.\"",
        fix: "Someone else changed the {job} at the same time. Pull down to reload and try again.",
      },
      {
        problem: "\"Too late to undo — open the job to change it.\"",
        fix: "The Undo window has passed. Change it back by hand with Reassign or Reschedule.",
      },
      {
        problem: "No Text or Call button",
        fix: "The {job} and its {customer} have no phone number. Add one with Edit job → Phone for this job.",
      },
    ],
    keywords: ["work order", "job screen", "call customer", "text customer", "directions", "cancel job", "activity", "line items"],
  },

  // ----------------------------------------------------------------- Assign sheet --
  {
    id: "office-mobile.jobs.assign-sheet",
    title: "Assign to / Reassign to",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Job details → Assign a technician (or Reassign); also Today → Needs you → Assign, and Team map → Assign",
    permission: "work_orders:edit",
    summary:
      "A sheet listing every {worker} ranked for this {job} by the server, with why and how well they fit. Tapping a {worker} assigns at once, with an Undo toast.",
    controls: [
      { label: "{worker} row", does: "Name, status dot, the server's reason and a fit label: Ready, Busy, Not qualified or Off shift. Tap to assign (or reassign) the {job} to them." },
      { label: "Best", does: "Star tag on the top-ranked {worker}." },
      { label: "Close", does: "The X (or tapping outside the sheet) closes it without changes." },
      { label: "Assign anyway", does: "In the \"Send {name} anyway?\" alert: assigns despite the clash the server reported." },
      { label: "Undo", does: "On the \"{job} → {name}\" toast: takes the assignment back." },
    ],
    tasks: [
      {
        q: "How do I reassign a job to someone else?",
        steps: ["Open the {job}.", "Tap Reassign.", "Tap the new {worker}."],
        note: "The current {worker} isn't listed.",
      },
      {
        q: "Who is the best technician for this job?",
        steps: ["Open the {job}.", "Tap Assign a technician.", "Look for the Best tag and the Ready label; the reason line says why."],
      },
      {
        q: "How do I assign someone who is already busy at that time?",
        steps: ["In the Assign to sheet, tap the {worker}.", "Read the reason in Send {name} anyway?.", "Tap Assign anyway."],
      },
      {
        q: "I assigned the wrong person. How do I undo it?",
        steps: ["Look for the \"{job} → {name}\" toast at the bottom of the screen.", "Tap Undo while it is showing (about 10 seconds)."],
        note: "If you undo within a few seconds the {worker} is never notified. Once the toast is gone, use Reassign.",
      },
    ],
    fixes: [
      {
        problem: "\"Nobody else to assign\"",
        fix: "There are no other {workers} on the roster. Add {workers} in the office dashboard (web).",
      },
      {
        problem: "\"Couldn't rank technicians\"",
        fix: "The ranking couldn't be loaded. Close the sheet and open it again, and check your connection.",
      },
      {
        problem: "\"Send {name} anyway?\"",
        fix: "The server found a problem: double-booking, time off, or the {job} is already in the field or accepted. Tap Assign anyway to override, or Cancel.",
      },
      {
        problem: "\"Couldn't assign\" with \"This technician has already accepted this job.\" or \"This job just changed\"",
        fix: "The {job} changed while you were choosing. Pull down on the {job} to reload and try again.",
      },
    ],
    keywords: ["assign", "reassign", "dispatch", "pick technician", "offer job", "best tech", "undo"],
  },

  // -------------------------------------------------------------- Move to sheet --
  {
    id: "office-mobile.jobs.reschedule-sheet",
    title: "Move to (reschedule)",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Job details → Reschedule",
    permission: "scheduler:edit",
    summary:
      "Picks a new day (the next two weeks) and a quarter-hour time on the company's clock, then moves the {job} with an Undo toast.",
    controls: [
      { label: "Day", does: "Chips for today and the next 13 days." },
      { label: "Time", does: "Quarter-hour slots. Times already past are greyed out." },
      { label: "Set {day} at {time}", does: "Moves the {job} to the chosen day and time. Disabled for a time in the past." },
      { label: "Move anyway", does: "In the \"Move it anyway?\" alert: moves despite the clash the server reported." },
      { label: "Undo", does: "On the \"Moved to …\" toast: puts the {job} back where it was." },
      { label: "Close", does: "Closes the sheet without moving." },
    ],
    tasks: [
      {
        q: "How do I reschedule a job?",
        steps: ["Open the {job}.", "Tap Reschedule.", "Tap a day, then a time.", "Tap Set … at …."],
      },
      {
        q: "How do I move a job more than two weeks out?",
        steps: ["Open the {job}.", "Tap More (three dots).", "Tap Open in web console and change the date there."],
        note: "The app's day picker (Reschedule and Edit job → When) only offers today and the next 13 days.",
      },
      {
        q: "How do I undo a reschedule?",
        steps: ["Look for the \"Moved to …\" toast at the bottom of the screen.", "Tap Undo while it is showing (about 10 seconds)."],
        note: "After the toast is gone, open the {job} and tap Reschedule to move it back.",
      },
    ],
    fixes: [
      {
        problem: "The Set button is greyed out",
        fix: "The chosen time is in the past on the company's clock. Pick a later slot.",
      },
      {
        problem: "\"Couldn't move\"",
        fix: "The server refused the move; the message says why (for example a permission or the {job} no longer exists). Pull down on the {job} and try again.",
      },
    ],
    keywords: ["reschedule", "change time", "move job", "change date"],
  },

  // -------------------------------------------------------------------- Edit job --
  {
    id: "office-mobile.jobs.edit-job",
    title: "Edit job",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Job details → pencil (Edit job)",
    route: "/office/edit-job/[id]",
    permission: "work_orders:edit",
    summary:
      "The full {job} editor: title, priority, status, service, {customer} and phone, address, time, notes, custom job fields and line items. Saves only what changed. Rate models, tech pay and form design stay on the web.",
    controls: [
      { label: "Close", does: "The X. Asks \"Discard changes?\" (Keep editing / Discard) if you changed anything." },
      { label: "Save", does: "Saves the changes and returns to the {job}. Shows a \"Saved\" toast." },
      { label: "Title", does: "The {job}'s title (up to 200 characters)." },
      { label: "Priority", does: "Low, Normal, High, Urgent." },
      { label: "Status", does: "Pending, Confirmed, Completed, Cancelled. An in-field status shows as its own chip with \"(in the field)\"." },
      { label: "Service", does: "Opens the Service sheet to pick a different service." },
      { label: "Client", does: "Opens the Client sheet to pick a different existing {customer}; their phone and last address come with them." },
      { label: "Phone for this job", does: "The number texts and calls for this {job} go to. Optional." },
      { label: "Address", does: "Opens the Address sheet with suggestions, or Use as typed." },
      { label: "When", does: "Opens the Move to sheet (next 14 days)." },
      { label: "Notes for the tech", does: "Notes the {worker} sees." },
      { label: "Office notes", does: "Internal notes, never shown to the {customer}." },
      { label: "Job fields", does: "The template's custom fields. Photos and signatures can't be edited here." },
      { label: "Line items", does: "Each line's quantity and unit price can be changed; the trash icon removes a line." },
      { label: "Add line", does: "Adds a custom line: Description, Qty, Price, then Add." },
      { label: "Subtotal (pre-tax)", does: "Total of the line items before tax." },
    ],
    tasks: [
      {
        q: "How do I change the job's address?",
        steps: ["Open the {job} and tap the pencil.", "Tap Address.", "Type the street and tap a suggestion.", "Tap Save."],
      },
      {
        q: "How do I mark a job completed or cancelled from my phone?",
        steps: ["Open the {job} and tap the pencil.", "Under Status, tap Completed or Cancelled.", "Tap Save."],
      },
      {
        q: "How do I add a line item to a job?",
        steps: ["Open the {job} and tap the pencil.", "Under Line items, tap Add line.", "Enter Description, Qty and Price, then tap Add.", "Tap Save."],
      },
      {
        q: "How do I change the customer's phone number for this job?",
        steps: ["Open the {job} and tap the pencil.", "Edit Phone for this job.", "Tap Save."],
      },
      {
        q: "How do I add office-only notes?",
        steps: ["Open the {job} and tap the pencil.", "Type in Office notes.", "Tap Save."],
      },
      {
        q: "How do I change the job's priority?",
        steps: ["Open the {job} and tap the pencil.", "Under Priority, tap Low, Normal, High or Urgent.", "Tap Save."],
      },
    ],
    fixes: [
      {
        problem: "\"Your role can view this job but not edit it\"",
        fix: "Your role doesn't have permission to edit {jobs}. Ask an admin on your account.",
      },
      {
        problem: "\"Couldn't place that address\"",
        fix: "A typed address couldn't be found on the map. Pick it from the suggestions so the {worker} gets the right pin.",
      },
      {
        problem: "\"Save anyway?\"",
        fix: "The new time double-books the {worker}. Tap Save anyway to keep it, or Cancel and pick another time.",
      },
      {
        problem: "\"Saved, but the status didn't change\"",
        fix: "Your other changes were saved but the server refused the status change; the message says why. Try the status again or change it on the web.",
      },
      {
        problem: "\"New clients are created from New job\"",
        fix: "Edit job can only switch to an existing {customer}. Create the {customer} first (New job or the web), then pick them here.",
      },
      {
        problem: "Field errors under the form",
        fix: "\"An address is needed.\", \"That doesn't look like a phone number.\", \"Every line needs a name, a quantity above zero and a price of zero or more.\", or a required job field is empty. Fix the field and tap Save again.",
      },
    ],
    keywords: ["edit work order", "change status", "line items", "custom fields", "notes", "priority"],
  },

  // --------------------------------------------------------------------- New job --
  {
    id: "office-mobile.jobs.new-job",
    title: "New job",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Today → New job, or Jobs → +",
    route: "/office/new-job",
    permission: "work_orders:create",
    summary:
      "Quick booking on one screen: who (Client), what (Service, priority, notes), where (Address), when, and who takes it. Pricing, line items, custom fields and forms can be added afterwards.",
    controls: [
      { label: "Close", does: "The X: leaves without creating." },
      { label: "Client", does: "Opens the Client sheet: search by name, phone, address or email, or Add a new client (Name, Email, Phone (optional)) then Use this client." },
      { label: "Service", does: "Opens the Service sheet, grouped by category with each service's length." },
      { label: "Low / Normal / High / Urgent", does: "Priority, on the Service card." },
      { label: "Notes for the tech", does: "Notes the {worker} sees, on the Service card." },
      { label: "Address", does: "Opens the Address sheet with suggestions; Use as typed keeps your text." },
      { label: "Use {address}", does: "Shown for an existing {customer}: fills in their last address." },
      { label: "When", does: "Opens a day/time picker (next two weeks, with ASAP — next available slot)." },
      { label: "ASAP", does: "On the When card: sets the time to now, rounded up." },
      { label: "Who takes it", does: "Opens Who takes it? to pick a {worker}, or Offer later — leave unassigned." },
      { label: "Create job / Create and send to {name}", does: "Creates the {job} and opens it. With a {worker} picked it is sent to them." },
    ],
    tasks: [
      {
        q: "How do I book a new job from my phone?",
        steps: ["On Today tap New job (or + on Jobs).", "Tap Client and pick or add the {customer}.", "Tap Service and pick one.", "Tap Address and pick the address.", "Tap When (or ASAP).", "Tap Who takes it, then tap Create job."],
      },
      {
        q: "How do I add a new customer while booking?",
        steps: ["In New job, tap Client.", "Tap Add a new client (or Add \"name\" as a new client).", "Enter Name and Email (Phone optional).", "Tap Use this client."],
        note: "A new {customer} needs a name and a valid email.",
      },
      {
        q: "How do I create a job without assigning anyone yet?",
        steps: ["In New job, tap Who takes it.", "Tap Offer later — leave unassigned.", "Tap Create job."],
      },
      {
        q: "How do I book an emergency job for right now?",
        steps: ["In New job, fill in Client, Service and Address.", "Tap ASAP on the When card.", "Pick Urgent priority.", "Tap Who takes it, choose someone and tap Create and send to {name}."],
      },
    ],
    fixes: [
      {
        problem: "Red messages on the cards when I tap Create job",
        fix: "Something required is missing: \"Pick a client or add a new one\", \"Pick a service\", \"Enter the address\" or \"Pick a time\". A new {customer} also needs a name and a valid email.",
      },
      {
        problem: "The When card says \"Loading the company's clock…\"",
        fix: "The picker waits for the company's time zone to load. Wait a moment; check your connection if it stays.",
      },
      {
        problem: "\"Send {name} anyway?\"",
        fix: "The {worker} is busy or off at that time. Tap Book anyway to create it regardless, or Cancel and pick someone else.",
      },
      {
        problem: "\"No services yet\"",
        fix: "The company has no services. Add services in the office dashboard (web) first.",
      },
      {
        problem: "\"Couldn't create the job\" or \"No connection\"",
        fix: "The server refused it (the message says why) or the phone is offline. Check your signal and try again.",
      },
    ],
    keywords: ["create job", "book job", "add work order", "new customer", "asap", "emergency"],
  },

  // ----------------------------------------------------------------------- Board --
  {
    id: "office-mobile.board",
    title: "Board (iPad)",
    surface: "office-mobile",
    platforms: ["ios", "android"],
    roles: [...OFFICE],
    path: "Office mode on an iPad (or wide tablet) → Board tab",
    route: "/(office)/board",
    permission: "work_orders:view or scheduler:view",
    summary:
      "On iPad only: the whole crew's day on a timeline, one row per {worker}, with an Unassigned column on the right. Move work by tapping a {job} then a time on a row, or by holding and dragging it onto a row; drag a block's right edge to change how long it takes. Every move ends at a confirm card and has Undo.",
    controls: [
      { label: "Day / Week", does: "Switches between the day timeline and the week grid." },
      { label: "Day strip", does: "Nine days with {job} counts, Previous week / Next week arrows and Today." },
      { label: "{worker} rows", does: "Left gutter shows each {worker}'s name, status (or Day off) and a bar of booked hours against an 8-hour day (green, amber, red)." },
      { label: "Job block", does: "Coloured by state: grey nobody/assigned, amber offered, blue accepted, green in the field, muted done. A ⚠ marks overlapping {jobs}. Tap to pick it up; hold and drag to move it; hold and release to open it." },
      { label: "Resize edge", does: "The grip on a block's right edge: drag sideways to make the {job} longer or shorter in 15-minute steps (at least 15 minutes). Needs permission to edit {jobs}." },
      { label: "Unassigned column", does: "Every {job} with nobody on it, soonest first; ones from other days show their date in amber. Tap to pick up, hold and drag onto a row, or hold to open." },
      { label: "Cancel placing", does: "The X on the \"Tap a time on a {worker}'s row…\" banner: puts the picked-up {job} down." },
      { label: "Place", does: "On the confirm card (\"Move/Send {job} to {name} at {time}?\"): makes the move." },
      { label: "Cancel", does: "On the confirm card: drops the move." },
      { label: "Place anyway", does: "In the \"Place it anyway?\" alert: overrides the clash the server reported." },
      { label: "Change anyway", does: "In the \"Make it longer anyway?\" alert: keeps the new length even though it runs into the next {job}." },
      { label: "Undo", does: "On the toast after a place or resize: reverses it." },
    ],
    tasks: [
      {
        q: "How do I reschedule a job by dragging on the iPad?",
        steps: ["Open the Board tab.", "Touch and hold the {job} block until it lifts.", "Drag it to the new time on the row and let go.", "Check the confirm card and tap Place."],
        note: "Holding without moving opens the {job} instead.",
      },
      {
        q: "How do I assign an unassigned job by dragging it?",
        steps: ["Open the Board tab.", "Touch and hold the {job} in the Unassigned column.", "Drag it onto the {worker}'s row at the time you want.", "Tap Place on the confirm card."],
      },
      {
        q: "How do I move a job without dragging?",
        steps: ["Open the Board tab.", "Tap the {job} (block or Unassigned card).", "Tap a time on a {worker}'s row.", "Tap Place."],
        note: "Tap another time to adjust before placing. Tap the same {job} again to put it down.",
      },
      {
        q: "How do I move a job to a different technician?",
        steps: ["Open the Board tab.", "Hold and drag the block onto the other {worker}'s row (or tap it, then tap their row).", "Tap Place on \"Send … to …?\"."],
        note: "Moving to another {worker} needs permission to edit {jobs} and the scheduler; moving within the same row needs scheduler permission only.",
      },
      {
        q: "How do I make a job longer or shorter?",
        steps: ["Open the Board tab.", "Drag the grip on the block's right edge left or right.", "Let go; tap Undo on the toast if needed."],
      },
      {
        q: "How do I look at tomorrow on the board?",
        steps: ["Open the Board tab.", "Tap tomorrow on the day strip."],
      },
      {
        q: "How do I open a job from the board?",
        steps: ["Open the Board tab.", "Touch and hold the {job} and release without moving."],
      },
      {
        q: "How do I undo a move on the board?",
        steps: ["Look for the toast at the bottom of the screen after tapping Place.", "Tap Undo while it is showing (about 10 seconds)."],
      },
    ],
    fixes: [
      {
        problem: "There's no Board tab",
        fix: "The Board is for iPad (tablet) screens at least 768 pt wide. On an iPhone, or an iPad in a narrow Split View column, use the Jobs tab. It also needs permission to view {jobs} or the scheduler.",
      },
      {
        problem: "\"{name} is off that day\"",
        fix: "That {worker} has time off on the shown day (their row says Off), so nothing can be placed on it. Choose another {worker} or day.",
      },
      {
        problem: "\"You can't move work onto {name}'s row\"",
        fix: "Your role can change times but not assign to another {worker}. Ask an admin for {job} edit permission.",
      },
      {
        problem: "A job won't pick up or drag",
        fix: "Completed and cancelled {jobs} don't move, and you need scheduler edit permission (plus {job} edit permission for unassigned {jobs}). Tapping it opens the {job} instead.",
      },
      {
        problem: "\"Place it anyway?\" or \"Make it longer anyway?\"",
        fix: "The new time or length clashes with the {worker}'s other work or time off, or the {job} is already in the field. Read the reason and tap Place anyway / Change anyway, or Cancel.",
      },
      {
        problem: "\"Too many jobs to show them all — these counts are partial.\"",
        fix: "The day has more {jobs} than the board loads. Use the office dashboard in a browser for the full picture.",
      },
      {
        problem: "\"Couldn't load the board\"",
        fix: "The day couldn't be fetched. Switch days or reopen the tab, and check your connection.",
      },
    ],
    keywords: ["dispatch board", "timeline", "drag and drop", "scheduler", "calendar", "gantt", "resize job", "job length", "ipad"],
  },
  {
    id: "office-mobile.board.week",
    title: "Board – Week view (iPad)",
    surface: "office-mobile",
    platforms: ["ios", "android"],
    roles: [...OFFICE],
    path: "Office mode on an iPad → Board tab → Week",
    route: "/(office)/board?view=week",
    permission: "work_orders:view or scheduler:view",
    summary:
      "Seven days (Monday first) by {worker}: each cell shows how many {jobs} and hours are booked, coloured against an 8-hour day, with Off for time off and the number of open (unassigned) {jobs} under each day.",
    controls: [
      { label: "Previous week / Next week", does: "Arrows either side of the date range." },
      { label: "This week", does: "Jumps back to the current week (shown when you've paged away)." },
      { label: "Day header", does: "Weekday, date and \"N open\" (unassigned). Tap to open that day on the timeline." },
      { label: "Cell", does: "A {worker}'s day: {job} count and booked hours, or Off. Tap to open that day on the timeline." },
      { label: "Under 6 h / 6–8 h / Over 8 h", does: "Colour key for how full a day is." },
    ],
    tasks: [
      {
        q: "How do I see the whole week's workload?",
        steps: ["Open the Board tab.", "Tap Week."],
      },
      {
        q: "How do I find who is overbooked this week?",
        steps: ["Open the Board tab and tap Week.", "Look for red cells (Over 8 h) and each {worker}'s hours this week."],
      },
      {
        q: "How do I open a day from the week view?",
        steps: ["In Week view, tap the day's header or any cell in that column.", "The Day timeline opens on that day."],
      },
      {
        q: "How do I plan next week?",
        steps: ["Open the Board tab and tap Week.", "Tap the right arrow (Next week).", "Tap a day to open it and place {jobs}."],
      },
    ],
    fixes: [
      {
        problem: "\"Couldn't load the week\"",
        fix: "The week couldn't be fetched. Switch weeks or reopen the tab, and check your connection.",
      },
      {
        problem: "I can't drag jobs in Week view",
        fix: "Week view is for reading the load only. Tap a day to open it on the Day timeline, then move {jobs} there.",
      },
    ],
    keywords: ["week view", "weekly schedule", "workload", "capacity", "hours booked"],
  },

  // ------------------------------------------------------------------------ Team --
  {
    id: "office-mobile.team",
    title: "Team",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Office mode → Team tab",
    route: "/(office)/team",
    permission: "techs:view",
    summary:
      "Every {worker} grouped by what they're doing now (On route, On site, Available, Busy, On break, Off shift), with quick ways to call, text, map or message them. On iPad, tapping a {worker} opens their day beside the list.",
    controls: [
      { label: "List / Map", does: "Toggle in the header between this list and the live map." },
      { label: "All / On route / On site / Available / Busy / Off shift", does: "Filter chips with counts. Busy includes On break." },
      { label: "{worker} row", does: "Name, status, the {job} they're on (and when they'll be free), open {jobs} and how old their location is (\"(stale)\" when over 10 minutes). On iPad, tap to open their detail." },
      { label: "Call {name}", does: "Calls their phone from your device." },
      { label: "Text {name}", does: "Opens your phone's Messages app to their number." },
      { label: "See {name} on the map", does: "Opens their last position in Apple Maps (iPhone/iPad) or your maps app (Android). Hidden when off shift or no position." },
      { label: "Message {name} in ArrivePing", does: "Opens your ArrivePing thread with them." },
    ],
    tasks: [
      {
        q: "How do I call a technician?",
        steps: ["Open the Team tab.", "On their row, tap the phone icon."],
      },
      {
        q: "How do I text a technician from my phone?",
        steps: ["Open the Team tab.", "On their row, tap the text-bubble icon (Text {name}).", "Send from your phone's Messages app."],
        note: "To message inside ArrivePing instead, tap the blue chat icon.",
      },
      {
        q: "How do I see who is available right now?",
        steps: ["Open the Team tab.", "Tap the Available chip."],
      },
      {
        q: "Where is a technician right now?",
        steps: ["Open the Team tab.", "Read the location age on their row.", "Tap the pin icon to open their position in Maps, or switch to Map to see everyone."],
      },
      {
        q: "How do I see one technician's jobs for today?",
        steps: ["On iPad: open the Team tab and tap the {worker}.", "Read the Today panel in the right pane."],
        note: "On a phone, open Jobs → Scheduled to see who has each {job}.",
      },
      {
        q: "How do I message a technician in the app?",
        steps: ["Open the Team tab.", "Tap the blue chat icon on their row.", "Type and send."],
      },
    ],
    fixes: [
      {
        problem: "\"No technicians yet\"",
        fix: "Nobody is on the roster. Add your team in the office dashboard (web) under Technicians & Managers.",
      },
      {
        problem: "\"Nobody is …\" under a filter",
        fix: "No {worker} has that status right now. Tap All to see everyone.",
      },
      {
        problem: "No call, text or map buttons on a technician",
        fix: "Call and Text need a phone number on their record. The map pin hides when they're off shift or have never shared a location.",
      },
      {
        problem: "The Team tab is missing",
        fix: "It needs permission to view {workers}. Ask an admin on your account.",
      },
      {
        problem: "\"Couldn't load the team\"",
        fix: "The roster couldn't be fetched. Pull down to retry and check your connection.",
      },
    ],
    keywords: ["technicians", "crew", "roster", "staff", "call technician", "text technician", "who is available"],
  },
  {
    id: "office-mobile.team.technician-detail",
    title: "Technician detail (iPad)",
    surface: "office-mobile",
    platforms: ["ios", "android"],
    roles: [...OFFICE],
    path: "Office mode on an iPad → Team tab → tap a technician (or tap a technician on the map)",
    permission: "techs:view",
    summary:
      "The right pane for one {worker}: status, what they're on and when they'll be free, today's numbers with a load bar against 8 hours, and today's {jobs}.",
    controls: [
      { label: "Call {name}", does: "Calls their phone." },
      { label: "Text {name}", does: "Opens your phone's Messages app to their number." },
      { label: "{name} on the map", does: "Opens their position in Maps (hidden when off shift or no position)." },
      { label: "Jobs today / Done / Hours booked / Still to do", does: "Today's numbers for this {worker}; Hours booked is shown \"of 8\"." },
      { label: "Today", does: "Their {jobs} for today; tap one to open it." },
      { label: "Message {first name}", does: "Bottom button: opens your ArrivePing thread with them in Messages." },
    ],
    tasks: [
      {
        q: "How busy is a technician today?",
        steps: ["On iPad, open the Team tab.", "Tap the {worker}.", "Read Hours booked (of 8) and the load bar."],
      },
      {
        q: "How do I open one of a technician's jobs?",
        steps: ["On iPad, open the Team tab and tap the {worker}.", "Tap the {job} in the Today panel."],
      },
      {
        q: "How do I message a technician from their detail?",
        steps: ["On iPad, open the Team tab and tap the {worker}.", "Tap Message {first name} at the bottom."],
      },
    ],
    fixes: [
      {
        problem: "\"That technician is no longer on the roster\"",
        fix: "They were removed from the company. Pick someone else from the list.",
      },
    ],
    keywords: ["technician profile", "tech day", "workload", "hours booked"],
  },
  {
    id: "office-mobile.team.map",
    title: "Live map",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Office mode → Team tab → Map toggle (or Today → Map)",
    route: "/(office)/team?mode=map",
    permission: "techs:view",
    summary:
      "Everyone and everything with a position on a map: {workers} as status-coloured discs and today's open {jobs} as pins coloured by who has them. Tap a marker to see it; on a phone it opens in a sheet, on iPad in a card down the right side.",
    controls: [
      { label: "List / Map", does: "Toggle back to the Team list." },
      { label: "Fit everyone on screen", does: "Zooms the map to show every visible {worker} and {job}." },
      { label: "Show off-shift technicians / Hide off-shift technicians", does: "Eye button. Off-shift {workers} are hidden until you turn this on." },
      { label: "Unassigned / Offered / In the field / Scheduled", does: "Legend for {job} pin colours: red, amber, green, blue." },
      { label: "{worker} marker", does: "Disc in their status colour; faded when the location is stale. Tap to select." },
      { label: "{job} pin", does: "Tap to select. Tapping empty map clears the selection." },
      { label: "Open", does: "Phone sheet for a selected {job}: opens the {job}." },
      { label: "Assign / Reassign", does: "Phone sheet for a selected {job}: opens it with the Assign sheet. Needs {job} edit permission; hidden for completed or cancelled {jobs}." },
      { label: "Close", does: "Closes the phone sheet." },
    ],
    tasks: [
      {
        q: "How do I see where all my technicians are?",
        steps: ["Open the Team tab.", "Tap the Map toggle (or Map on Today).", "Tap Fit everyone on screen if someone is out of view."],
      },
      {
        q: "How do I see off-shift technicians on the map?",
        steps: ["Open the map.", "Tap the eye button (Show off-shift technicians)."],
      },
      {
        q: "How do I assign a job from the map?",
        steps: ["Open the map.", "Tap the red (Unassigned) pin.", "On a phone tap Assign in the sheet; on iPad use Assign a technician in the card.", "Pick a {worker}."],
      },
      {
        q: "How do I message a technician from the map?",
        steps: ["Open the map.", "Tap the {worker}'s disc.", "Tap the chat icon (phone) or Message {first name} (iPad)."],
      },
    ],
    fixes: [
      {
        problem: "A technician isn't showing on the map",
        fix: "Off-shift {workers} are hidden by default (tap the eye button), and anyone who hasn't shared a location has no marker. A faded disc means their location is over 10 minutes old.",
      },
      {
        problem: "A job isn't on the map",
        fix: "The map shows today's open {jobs} that have a map position. {jobs} on other days, finished {jobs} and addresses without coordinates aren't pinned.",
      },
    ],
    keywords: ["map", "gps", "location", "where is my tech", "live tracking", "pins"],
  },

  // -------------------------------------------------------------------- Messages --
  {
    id: "office-mobile.messages",
    title: "Messages",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Office mode → Messages tab",
    route: "/(office)/messages",
    permission: "work_orders:view",
    summary:
      "The dispatcher inbox: one thread per {worker}, unread first, with a red badge on the tab for unread messages. On a phone a thread opens full screen; on iPad it opens beside the list.",
    controls: [
      { label: "Broadcast to the team", does: "Megaphone button in the header: opens the Broadcast sheet. Needs {job} edit permission." },
      { label: "All / Unread", does: "Show every thread, or only ones with unread messages. Each shows a count." },
      { label: "Search people and messages", does: "Filters threads by {worker} name or last message." },
      { label: "Thread row", does: "{worker}, status dot, time since the last message, a preview (\"You: …\" for your own) and an unread count. Tap to open." },
    ],
    tasks: [
      {
        q: "How do I read messages from technicians?",
        steps: ["Open the Messages tab.", "Tap Unread to see only new ones.", "Tap a thread."],
      },
      {
        q: "How do I find an old conversation?",
        steps: ["Open the Messages tab.", "Type a name or words from the message in Search people and messages."],
      },
      {
        q: "How do I start a conversation with a technician who isn't in the list?",
        steps: ["Open the Team tab.", "Tap the blue chat icon on their row (Message {name} in ArrivePing).", "Type and send."],
      },
      {
        q: "How do I send a message to everyone?",
        steps: ["Open the Messages tab.", "Tap the megaphone.", "Pick On shift & available or Everyone on the roster.", "Type the message and tap Send to team."],
      },
    ],
    fixes: [
      {
        problem: "The Messages tab is missing",
        fix: "Messages needs permission to view {jobs}. Ask an admin on your account.",
      },
      {
        problem: "\"No conversations yet\"",
        fix: "Threads appear once you or a {worker} sends a message. Start one from Team or a {job}'s Technician card.",
      },
      {
        problem: "\"Couldn't load messages\"",
        fix: "The inbox couldn't be fetched. Pull down to retry and check your connection.",
      },
      {
        problem: "There's no megaphone button",
        fix: "Broadcasting needs permission to edit {jobs}.",
      },
    ],
    keywords: ["inbox", "chat", "messages", "unread", "conversation"],
  },
  {
    id: "office-mobile.messages.thread",
    title: "Message thread",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Messages tab → tap a thread (or the chat icon on Team, a job's Technician card or Today's Message button)",
    route: "/office/thread/[techId]",
    permission: "work_orders:view",
    summary:
      "Your direct conversation with one {worker} inside ArrivePing. They see it in their app and get a push. Opening the thread marks their messages read.",
    controls: [
      { label: "Back", does: "Returns to the list (phone only; on iPad the thread is the right pane)." },
      { label: "Call {name}", does: "Phone icon at the top: calls the {worker} from your device. Shows when they have a number." },
      { label: "Message {first name}…", does: "The message box." },
      { label: "Send message", does: "Sends what you typed." },
    ],
    tasks: [
      {
        q: "How do I message a technician?",
        steps: ["Open the Messages tab and tap their thread.", "Type in Message {first name}….", "Tap send."],
      },
      {
        q: "How do I call the technician from the conversation?",
        steps: ["Open the thread.", "Tap the phone icon at the top."],
      },
      {
        q: "How do I mark a message as read?",
        steps: ["Open the Messages tab.", "Tap the thread; its messages are marked read when it opens and the unread badge clears."],
      },
    ],
    fixes: [
      {
        problem: "\"Your role can read this thread but not send. Ask an admin on your account.\"",
        fix: "Sending messages needs permission to edit {jobs}; your role can only read.",
      },
      {
        problem: "\"That technician is no longer on the roster.\"",
        fix: "The {worker} was removed from the company, so the thread can't be opened.",
      },
      {
        problem: "\"Not sent\"",
        fix: "The message didn't go through; the reason is shown. Check your connection and send again.",
      },
    ],
    keywords: ["chat with technician", "direct message", "reply", "dm"],
  },
  {
    id: "office-mobile.messages.broadcast",
    title: "Broadcast",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Messages tab → megaphone (Broadcast to the team), or Today → Broadcast",
    permission: "work_orders:edit",
    summary:
      "Sends one message to many {workers} at once. Each person gets it as a normal direct message in their thread, with a push.",
    controls: [
      { label: "On shift & available", does: "Sends only to {workers} whose status is Available right now." },
      { label: "Everyone on the roster", does: "Sends to every {worker}." },
      { label: "Broadcast message", does: "The text box." },
      { label: "Send to team", does: "Sends it and shows \"Sent to N technicians\"." },
      { label: "Close", does: "Closes without sending." },
    ],
    tasks: [
      {
        q: "How do I send a message to every technician?",
        steps: ["Open Messages and tap the megaphone.", "Tap Everyone on the roster.", "Type the message.", "Tap Send to team."],
      },
      {
        q: "How do I message only the technicians who are free?",
        steps: ["Open Messages and tap the megaphone.", "Leave On shift & available selected.", "Type and tap Send to team."],
        note: "{workers} who are On route, On site, Busy or on break don't get it with this choice.",
      },
      {
        q: "Where do technicians see a broadcast?",
        steps: ["Send the broadcast.", "Each {worker} gets it as a direct message in their own thread with you, plus a push notification."],
      },
    ],
    fixes: [
      {
        problem: "Send to team is greyed out",
        fix: "Type a message first.",
      },
      {
        problem: "\"Not sent\"",
        fix: "The broadcast failed; the reason is shown. Check your connection and try again.",
      },
      {
        problem: "Today's Broadcast button opened Messages but no sheet",
        fix: "Your role can't send messages (it needs permission to edit {jobs}).",
      },
    ],
    keywords: ["broadcast", "announcement", "message everyone", "team message", "megaphone"],
  },

  // --------------------------------------------------------------------- Profile --
  {
    id: "office-mobile.profile",
    title: "Profile (office)",
    surface: "office-mobile",
    platforms: P,
    roles: [...OFFICE],
    path: "Any office tab → person icon at the top right (Profile and settings)",
    route: "/office/profile",
    summary:
      "Who you are and which company this device is working for: switch company, switch to field mode if you also run calls, the Face ID lock, links to the web console and policies, and Sign out.",
    controls: [
      { label: "Switch to field mode", does: "Shown when you are both office staff and a technician at this company: opens the technician side (your own jobs, shift and location sharing)." },
      { label: "Working for", does: "Shown when you belong to more than one company. Tap a company to switch; the board reloads for it and the app opens office or technician mode depending on your role there." },
      { label: "Lock with Face ID", does: "Switch. On: the app asks for Face ID (or fingerprint) once a day when it opens. Shown only when the device supports it." },
      { label: "Details", does: "Your Role, Company and Permissions (\"Everything\" or how many are granted)." },
      { label: "Open the web console", does: "Opens the office dashboard in your browser." },
      { label: "Privacy Policy / Terms of Service / Help & Support", does: "Open those pages in your browser." },
      { label: "Sign out", does: "Asks \"End your session?\"; on confirm signs you out, stops push notifications to this device and clears the chosen company." },
    ],
    tasks: [
      {
        q: "How do I switch company?",
        steps: ["Tap the person icon at the top right.", "Under Working for, tap the company."],
      },
      {
        q: "How do I switch to technician (field) mode?",
        steps: ["Tap the person icon at the top right.", "Tap Switch to field mode."],
        note: "Only shows if you are also set up as a technician at this company.",
      },
      {
        q: "How do I turn the Face ID lock on or off?",
        steps: ["Tap the person icon at the top right.", "Tap the Lock with Face ID switch."],
      },
      {
        q: "How do I open the full office dashboard?",
        steps: ["Tap the person icon at the top right.", "Tap Open the web console."],
      },
      {
        q: "How do I sign out of the app?",
        steps: ["Tap the person icon at the top right.", "Tap Sign out.", "Confirm with Sign out."],
      },
      {
        q: "What role and permissions do I have?",
        steps: ["Tap the person icon at the top right.", "Read Details (Role, Company, Permissions)."],
      },
    ],
    fixes: [
      {
        problem: "\"Couldn't switch\"",
        fix: "The company couldn't be changed, usually a connection problem. Check your signal and try again.",
      },
      {
        problem: "No Working for card",
        fix: "You belong to only one company that this app serves.",
      },
      {
        problem: "No Lock with Face ID option",
        fix: "The device has no Face ID or fingerprint set up.",
      },
    ],
    keywords: ["settings", "account", "sign out", "log out", "face id", "biometric", "field mode", "switch company"],
  },
];
