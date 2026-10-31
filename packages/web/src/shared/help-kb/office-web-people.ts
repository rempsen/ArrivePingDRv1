/**
 * Office web dashboard: people screens. {workers} & Managers (Field Staff,
 * Internal Team, Roles & Permissions), the Directory (People), places,
 * Payouts, Reviews, Tags & Fields, Skill Classes and {worker} Invites.
 *
 * Sources: web/pages/admin/{riders,team-tabs,users,directory-properties,
 * payouts,reviews,tags,skill-classes,notifications}.tsx, components
 * deactivate-dialog, import-menu, tech-shifts, and api/routes/{riders,team,
 * admin,directory,invites,import,payouts,reviews,tags,skill-classes}.ts.
 */
import type { KbEntry } from "./types";

const WEB = { surface: "office-web" as const, platforms: ["web" as const] };

export const entries: KbEntry[] = [
  // ---------------------------------------------------------------------------
  // {workers} & Managers → Field Staff
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.technicians",
    title: "Field Staff ({workers} & Managers)",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → {workers} & Managers → Field Staff tab",
    route: "/admin/techs",
    permission: "techs:view",
    summary:
      "The roster of {workers} and field staff: live status, rating, completed {jobs}, contact and vehicle. Add, import, invite, deactivate or remove field people and open each person's profile.",
    controls: [
      { label: "Field Staff / Internal Team / Roles & Permissions", does: "Tabs across the top of the page. Field Staff is the {worker} roster; Internal Team is office staff; Roles & Permissions shows what each role can do." },
      { label: "Import", does: "Opens the import menu for {workers}: Import CSV, Import Excel, Download CSV template, Download Excel template." },
      { label: "Add {worker}", does: "Opens the Add {worker} form, which creates a login and field profile and emails them a link to set a password." },
      { label: "All / Available / En Route / On Site / Busy / Offline", does: "Status filter chips. Show only people currently in that status." },
      { label: "Sort: Name / Sort: Rating / Sort: Jobs done", does: "Sort the cards by name (A–Z), rating (highest first) or completed {jobs} (most first)." },
      { label: "Person card", does: "Click a card to open that person's profile drawer (Profile, Jobs, Shifts, Files)." },
      { label: "Invite pending · resend", does: "Shown on someone who hasn't accepted their invitation yet. Click it to send the invitation email again." },
      { label: "Deactivate (person icon with minus, on hover)", does: "Opens Deactivate: they can no longer sign in and stop counting towards your bill; history is kept and you can reactivate them." },
      { label: "Remove technician (trash icon, on hover)", does: "Asks to confirm, then deletes their field profile and returns their active {jobs} to the unassigned queue. Their login is deleted unless they also work for another company." },
      { label: "Shared", does: "Badge: this person also works for another company. Their login and contact details are managed there." },
      { label: "Role badge (e.g. Admin, Manager)", does: "Office staff who can also be assigned work (Settings → Company → Who can be assigned). They have no deactivate/remove buttons here; manage them under Internal Team." },
      { label: "Deactivated (n)", does: "Collapsed group at the bottom listing deactivated people. Expand it to see them and use Reactivate." },
      { label: "Reactivate", does: "On a deactivated person: opens Reactivate so they can sign in and take {jobs} again." },
    ],
    tasks: [
      {
        q: "How do I add a new {worker}?",
        steps: ["Open Sidebar → People → {workers} & Managers.", "Stay on the Field Staff tab and click Add {worker}.", "Enter Full name and Email (both required), plus any other details.", "Leave Password (optional) blank so they get an email to set their own.", "Click Create."],
        note: "A green message confirms whether the welcome email went out.",
      },
      {
        q: "A {worker} never got their invite. How do I resend it?",
        steps: ["Open {workers} & Managers → Field Staff.", "Find the person showing Invite pending.", "Click Invite pending · resend.", "Check for the message “Invite re-sent to …”."],
        note: "Invite pending appears for people who already had an ArrivePing login. For a brand-new login, open their card and use Email a sign-in link instead.",
      },
      {
        q: "How do I see only the {workers} who are available right now?",
        steps: ["Open {workers} & Managers → Field Staff.", "Click the Available chip.", "Click All to go back to everyone."],
      },
      {
        q: "How do I import a list of {workers} from a spreadsheet?",
        steps: ["Open {workers} & Managers → Field Staff.", "Click Import → Download CSV template (or Excel template) and fill it in.", "Click Import → Import CSV (or Import Excel) and choose the file.", "Review the Import complete summary for Created, Invited and Failed rows."],
        note: "Up to 500 rows and 5MB per file. New people with an email are sent a set-password link.",
      },
      {
        q: "How do I deactivate a {worker} who left?",
        steps: ["Open {workers} & Managers → Field Staff.", "Hover their card and click the Deactivate icon (person with a minus).", "If they have open {jobs}, choose under What happens to them?: Unassign (back to the board) or a teammate under Reassign all to….", "Click Deactivate."],
        note: "Deactivating keeps their {jobs}, photos and history. Removing (trash icon) deletes the profile.",
      },
      {
        q: "How do I bring back a deactivated {worker}?",
        steps: ["Open {workers} & Managers → Field Staff.", "Expand Deactivated (n) at the bottom.", "Click Reactivate on their card.", "Click Reactivate in the dialog (or Add a {worker} and reactivate if your plan needs another seat)."],
      },
      {
        q: "How do I permanently remove a {worker}?",
        steps: ["Open {workers} & Managers → Field Staff.", "Hover their card and click the trash icon (Remove technician).", "Read the message and confirm."],
        note: "Their active {jobs} go back to the unassigned queue. If they work for another company too, only their place on your team is removed.",
      },
      {
        q: "Why is an admin or manager showing in my {worker} list?",
        steps: ["Look for the role badge (Admin, Manager…) on the card.", "To take them off this list, turn off Settings → Company → Who can be assigned.", "Manage their account under the Internal Team tab."],
      },
    ],
    fixes: [
      { problem: "Message: “Added, but the welcome email didn't go out.”", fix: "The person was created but the email failed. Open their card and click Email a sign-in link to try again." },
      { problem: "Message: “That person is already on your team”", fix: "That email already belongs to someone on your roster (maybe deactivated). Check the Deactivated group and use Reactivate instead of adding them again." },
      { problem: "Message: “That email already has an ArrivePing login…”", fix: "They work for another company too, so they were invited to join yours and keep their existing password. They show Invite pending until they accept; use Invite pending · resend if the email didn't arrive." },
      { problem: "No trash or deactivate button on someone's card", fix: "They are office staff listed because Who can be assigned is on. Manage them under Internal Team instead." },
      { problem: "Remove technician shows “Your role doesn't include this. Ask an admin on your account.”", fix: "Your role lacks the permission for that action. Removing a {worker} needs delete permission on Technicians & Team, which managers don't have by default; deactivating needs edit. Ask an admin, or use Deactivate instead." },
      { problem: "“No technicians match this filter.”", fix: "The status chip you picked has nobody in it. Click All." },
    ],
    keywords: ["technicians", "techs", "field staff", "crew", "roster", "installers", "drivers", "team"],
  },

  {
    id: "office-web.people.add-technician",
    title: "Add {worker}",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → People → {workers} & Managers → Field Staff → Add {worker}",
    route: "/admin/techs",
    permission: "techs:create",
    summary:
      "Creates a {worker} login and field profile. If no password is typed, they're emailed a link to set their own password and get the app.",
    controls: [
      { label: "Full name", does: "Required." },
      { label: "Email", does: "Required. Their sign-in email and where the welcome email goes." },
      { label: "Password (optional)", does: "Leave blank and we email them a link to set their own. If typed, that becomes their password." },
      { label: "Phone", does: "Their phone number." },
      { label: "Skill class", does: "The trade they're filed under (list managed in Settings → Skill Classes)." },
      { label: "Pay rate per hour", does: "Used to compute their pay from on-site time on Payouts." },
      { label: "Mileage pay rate", does: "Paid per distance driven when a {job}'s workflow pays mileage. 0 means no mileage pay." },
      { label: "Skills", does: "Pick from the library or type a new skill and press Enter." },
      { label: "Vehicle / Vehicle colour / License plate / License #", does: "Vehicle and licence details shown on their card." },
      { label: "Home address", does: "Address autocomplete for where they start from." },
      { label: "Notes", does: "Internal notes." },
      { label: "Cancel", does: "Closes without saving." },
      { label: "Create", does: "Creates the person. Disabled until Full name and Email are filled." },
    ],
    tasks: [
      {
        q: "How do I add a {worker} without setting a password for them?",
        steps: ["Click Add {worker}.", "Fill in Full name and Email.", "Leave Password (optional) blank.", "Click Create."],
        note: "They get a welcome email with a set-password link (valid 7 days) and where to get the app.",
      },
      {
        q: "How do I set a {worker}'s hourly pay when adding them?",
        steps: ["Click Add {worker}.", "Enter the amount in Pay rate per hour.", "Optionally enter a Mileage pay rate.", "Click Create."],
      },
      {
        q: "How do I give a new {worker} a skill class and skills?",
        steps: ["Click Add {worker}.", "Choose a Skill class.", "Under Skills, pick from the list or type a skill and press Enter.", "Click Create."],
      },
    ],
    fixes: [
      { problem: "Create button is greyed out", fix: "Full name and Email are both required." },
      { problem: "“That person is already on your team”", fix: "Someone with that email is already on your roster, possibly in the Deactivated group. Reactivate them instead." },
      { problem: "The skill class I want isn't in the list", fix: "Skill classes are managed in Settings → Skill Classes. Add it there and save, then come back." },
    ],
    keywords: ["new technician", "invite technician", "create tech", "add installer", "onboard"],
  },

  {
    id: "office-web.people.technician-profile",
    title: "{worker} profile",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → {workers} & Managers → Field Staff → click a person's card",
    route: "/admin/techs",
    permission: "techs:view",
    summary:
      "Side drawer for one field person: edit their profile and pay, help them sign in, set tags and custom fields, and see their {jobs}, shifts and files.",
    controls: [
      { label: "Photo (click the avatar)", does: "Upload a PNG, JPEG or WebP photo (max 8MB). The small x removes the photo." },
      { label: "Profile / Jobs / Shifts / Files", does: "Tabs in the drawer." },
      { label: "Phone, Vehicle, Vehicle colour, License plate, License #", does: "Editable contact and vehicle details." },
      { label: "Skill class", does: "Their trade." },
      { label: "Pay rate / hr", does: "Hourly rate used on Payouts." },
      { label: "Mileage pay rate", does: "Paid per distance driven when a {job}'s workflow pays mileage." },
      { label: "Skills", does: "Pick from the library or type a new skill and press Enter." },
      { label: "Home address / Notes", does: "Starting address and internal notes." },
      { label: "Save profile", does: "Saves the Profile tab fields." },
      { label: "Email a sign-in link", does: "Sends a fresh welcome email with a link to set their own password and the app links." },
      { label: "New temporary password + Reset", does: "Sets a temporary password (min 8 characters) you share with them; they can change it after signing in." },
      { label: "Tags", does: "Add or remove {worker} tags." },
      { label: "Custom fields", does: "Fill in custom fields defined for {workers} in Tags & Fields." },
      { label: "Jobs tab", does: "Their assigned {jobs}, newest first. Click an open one to edit it; a completed one opens its read-only report." },
      { label: "Shifts tab", does: "Add a Shift (date, Start, End) or Time off with an optional Note, then click Add. Hover a row and click the trash icon to delete it." },
      { label: "Files tab", does: "Upload and manage files attached to this person." },
    ],
    tasks: [
      {
        q: "How do I change a {worker}'s hourly rate?",
        steps: ["Open {workers} & Managers → Field Staff and click their card.", "On the Profile tab, change Pay rate / hr.", "Click Save profile."],
        note: "Payouts already generated aren't recalculated.",
      },
      {
        q: "A {worker} forgot their password. How do I help?",
        steps: ["Click their card to open the profile.", "Under Sign-in help, click Email a sign-in link.", "Or type a New temporary password (8+ characters) and click Reset, then share it with them."],
      },
      {
        q: "How do I add time off for a {worker}?",
        steps: ["Click their card and open the Shifts tab.", "Set Type to Time off.", "Pick the Date and add an optional Note.", "Click Add."],
      },
      {
        q: "How do I set a {worker}'s working hours for a day?",
        steps: ["Click their card and open the Shifts tab.", "Leave Type as Shift and pick the Date.", "Set Start and End.", "Click Add."],
      },
      {
        q: "How do I see every {job} a {worker} has done?",
        steps: ["Click their card.", "Open the Jobs tab.", "Click a {job} to open it (completed ones open the report)."],
      },
      {
        q: "How do I add a photo of a {worker}?",
        steps: ["Click their card.", "Click their avatar at the top of the drawer.", "Choose a PNG, JPEG or WebP image under 8MB."],
      },
      {
        q: "How do I tag a {worker}?",
        steps: ["Click their card.", "On the Profile tab, scroll to Tags.", "Pick the tag to apply."],
        note: "Tags are created in Setup → Tags & Fields.",
      },
    ],
    fixes: [
      { problem: "“Password must be at least 8 characters.”", fix: "Temporary passwords need 8 or more characters." },
      { problem: "“This person also works for another company, so their password can't be reset from here.”", fix: "They share one login across companies. Ask them to use “Forgot password” on the sign-in page." },
      { problem: "“They already have an ArrivePing login from another company. They can use “Forgot password” on the sign-in page.”", fix: "Email a sign-in link isn't sent to shared logins. Have them reset their own password from the sign-in page." },
      { problem: "“Their invitation is still pending — resend the invite instead”", fix: "They haven't accepted the invite to your company yet. Close the drawer and click Invite pending · resend on their card." },
      { problem: "Reset password fails for my manager", fix: "Setting a temporary password is admin-only. Use Email a sign-in link, or ask an admin." },
      { problem: "“Image too large (max 8MB)” or “Unsupported type …”", fix: "Use a PNG, JPEG or WebP photo under 8MB." },
    ],
    keywords: ["technician details", "edit technician", "pay rate", "reset password", "sign-in link", "shifts", "time off", "availability"],
  },

  {
    id: "office-web.people.deactivate",
    title: "Deactivate or reactivate a person",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → People → {workers} & Managers → Field Staff or Internal Team → Deactivate icon (or Deactivated (n) → Reactivate)",
    route: "/admin/techs",
    permission: "techs:edit",
    summary:
      "Deactivate stops someone signing in to your company and stops them counting towards your bill while keeping their {jobs}, photos and history. Reactivate lets them sign in and take {jobs} again.",
    controls: [
      { label: "What happens to them?", does: "Shown when they have open {jobs}: choose Unassign (back to the board) or a teammate under Reassign all to…. Deactivate stays disabled until you choose." },
      { label: "Deactivate", does: "Deactivates the person and moves their open {jobs} as chosen." },
      { label: "Reactivate", does: "Reactivates the person." },
      { label: "Add a {worker} and reactivate / Add a user and reactivate", does: "Shown when reactivating needs another paid seat; it shows the monthly cost and adds the seat when clicked." },
      { label: "Cancel", does: "Closes without changes." },
    ],
    tasks: [
      {
        q: "How do I deactivate someone who still has {jobs} booked?",
        steps: ["Click the Deactivate icon on their card.", "Wait for their open {jobs} to load.", "Under What happens to them?, choose Unassign (back to the board) or a teammate.", "Click Deactivate."],
      },
      {
        q: "How do I reactivate someone when my plan is full?",
        steps: ["Expand Deactivated (n) and click Reactivate.", "Click Reactivate in the dialog.", "If asked, review the monthly cost and click Add a {worker} and reactivate (or Add a user and reactivate)."],
        note: "Only an admin can add a seat to the plan.",
      },
      {
        q: "What's the difference between deactivate and remove?",
        steps: ["Deactivate keeps the person's account, {jobs} and history and can be undone with Reactivate.", "Remove (trash icon) deletes their profile (and login, if your company is their only one) and cannot be undone."],
      },
    ],
    fixes: [
      { problem: "Deactivate button is disabled", fix: "They have open {jobs}. Choose an option under What happens to them? first." },
      { problem: "“Couldn't check their open jobs. Close and try again.”", fix: "Loading their open {jobs} failed. Close the dialog and reopen it." },
      { problem: "“You cannot deactivate the last admin.”", fix: "Every company needs at least one active admin. Make someone else an admin first." },
      { problem: "“You cannot deactivate your own account.”", fix: "Ask another admin to do it." },
      { problem: "“Only a superadmin can deactivate admin-level accounts.”", fix: "Admin accounts can only be deactivated by ArrivePing support." },
      { problem: "“… was just assigned another job. Refresh and try again.”", fix: "A {job} was assigned while the dialog was open. Close it, reopen and choose again." },
      { problem: "“Only an admin can add a user to the plan.”", fix: "Reactivating needs an extra seat, which only an admin can add. Ask an admin to reactivate them." },
      { problem: "“This person deleted their ArrivePing account. Invite them again with a new email to bring them back.”", fix: "Their account no longer exists. Add them again with a different email." },
    ],
    keywords: ["deactivate", "disable", "suspend", "reactivate", "former employee", "seat", "license"],
  },

  // ---------------------------------------------------------------------------
  // Internal Team
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.internal-team",
    title: "Internal Team",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → People → {workers} & Managers → Internal Team tab",
    route: "/admin/techs",
    permission: "techs:view",
    summary:
      "Office staff: admins, managers, dispatchers and project managers. Add employees, change roles, help them sign in, set per-person permissions, deactivate or remove them.",
    controls: [
      { label: "New Employee", does: "Opens New Internal Employee to add an office (or field) staff member." },
      { label: "Edit (pencil, on hover)", does: "Opens Edit Employee: role, name, phone and sign-in help." },
      { label: "Deactivate (person with minus, on hover)", does: "Opens the Deactivate dialog." },
      { label: "Remove (trash, on hover)", does: "Asks “Remove employee?” then permanently deletes their account and access (or only removes them from your company if they work for another one)." },
      { label: "Role badge", does: "Their role: Admin, Manager, Dispatcher, Project Manager." },
      { label: "Invite pending · resend", does: "They haven't accepted yet; click to resend the invitation." },
      { label: "Shared", does: "Also works for another company; only their role can be changed here." },
      { label: "Permissions →", does: "Opens per-person permissions. The line beside it shows “Custom permissions” or “n permissions (role default)”." },
      { label: "Deactivated (n) / Reactivate", does: "Collapsed list of deactivated staff, each with Reactivate." },
    ],
    tasks: [
      {
        q: "How do I add a dispatcher or office manager?",
        steps: ["Open {workers} & Managers → Internal Team.", "Click New Employee.", "Pick the Role (Manager, Dispatcher or Project Manager).", "Enter Full name, Email and Phone; leave Password (optional) blank.", "Click Create employee."],
        note: "Only an admin can add office staff.",
      },
      {
        q: "How do I change someone's role?",
        steps: ["Open Internal Team and hover the person's card.", "Click the pencil (Edit).", "Pick the new Role.", "Click Save changes."],
        note: "Only an admin can change roles.",
      },
      {
        q: "How do I resend an office user's invitation?",
        steps: ["Open Internal Team.", "Click Invite pending · resend on their card."],
      },
      {
        q: "How do I send an office user a password link?",
        steps: ["Open Internal Team and click the pencil on their card.", "Under Sign-in help, click Email a sign-in link."],
      },
      {
        q: "How do I give one person extra or fewer permissions?",
        steps: ["Open Internal Team.", "Click Permissions → on their card.", "Tick Use custom permissions for this person.", "Toggle the actions per module.", "Click Save custom permissions."],
      },
      {
        q: "How do I remove an office employee?",
        steps: ["Open Internal Team and hover their card.", "Click the trash icon.", "Click Delete to confirm."],
        note: "Consider Deactivate instead if you want to keep their history.",
      },
    ],
    fixes: [
      { problem: "Remove shows an error", fix: "Removing an employee needs delete permission on Technicians & Team (admins only by default). Errors like “Cannot delete the last admin” (a company must keep one active admin) also stop it." },
      { problem: "“You cannot delete your own account”", fix: "Another admin has to remove you." },
      { problem: "“Only a superadmin can delete admin-level accounts” / “Only a superadmin can modify admin-level accounts”", fix: "Admin accounts are managed by ArrivePing support." },
      { problem: "“This person also works for another company, so their name and email can only be changed by their home company.”", fix: "Shared people keep one identity. You can still change their role here." },
      { problem: "“Added, but the welcome email didn't go out.”", fix: "Open their Edit dialog and click Email a sign-in link." },
      { problem: "“They've already accepted — nothing to resend”", fix: "They're active; use Email a sign-in link if they need a password link." },
      { problem: "“Couldn't send the email. Try again shortly.”", fix: "The email couldn't be sent right now. Wait a minute and try again." },
    ],
    keywords: ["office staff", "employees", "dispatchers", "managers", "admins", "users", "team members"],
  },

  {
    id: "office-web.people.new-employee",
    title: "New Internal Employee / Edit Employee",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → People → {workers} & Managers → Internal Team → New Employee (or pencil on a card)",
    route: "/admin/techs",
    permission: "techs:create",
    summary:
      "Dialog to add a staff member with a role, or edit an existing one's role, name, phone and sign-in.",
    controls: [
      { label: "Role", does: "Admins can choose Manager, Dispatcher, Project Manager or Field Staff. A manager can only choose Field Staff. Each option shows what the role covers." },
      { label: "Field staff type: {worker} / Driver", does: "Shown when Role is Field Staff." },
      { label: "Full name / Email / Phone", does: "Their details. Email can't be changed in Edit Employee." },
      { label: "Password (optional)", does: "Leave blank and we email them a link to set their own." },
      { label: "Create employee", does: "Creates the account and sends the welcome email." },
      { label: "Email a sign-in link", does: "Edit only: sends a fresh set-password email." },
      { label: "New temporary password + Reset", does: "Edit only: sets a temporary password (min 8 characters)." },
      { label: "Save changes", does: "Edit only: saves role, name, phone and field staff type." },
      { label: "Cancel", does: "Closes without saving." },
    ],
    tasks: [
      {
        q: "How do I add a new office user with their own password?",
        steps: ["Click New Employee.", "Pick a Role and fill in Full name and Email.", "Type a password in Password (optional).", "Click Create employee."],
      },
      {
        q: "How do I add a driver?",
        steps: ["Click New Employee.", "Pick Field Staff as the Role.", "Under Field staff type, pick Driver.", "Fill in the details and click Create employee."],
      },
      {
        q: "How do I promote a dispatcher to manager?",
        steps: ["Click the pencil on their card in Internal Team.", "Pick Manager under Role.", "Click Save changes."],
      },
    ],
    fixes: [
      { problem: "“Only an admin can add office staff”", fix: "Managers can add field staff only. Ask an admin to add office users." },
      { problem: "“Only an admin can change someone's role or sign-in email.”", fix: "Shown in Edit Employee for non-admins. Ask an admin." },
      { problem: "Admin isn't offered as a role", fix: "Admin-level accounts can only be created by a superadmin (ArrivePing support)." },
      { problem: "“That person is already on your team”", fix: "Someone with that email is already on your roster; check the Deactivated group." },
      { problem: "“Email already in use”", fix: "Another account uses that email." },
    ],
    keywords: ["add employee", "add dispatcher", "change role", "promote", "office user"],
  },

  {
    id: "office-web.people.person-permissions",
    title: "Permissions for one person",
    ...WEB,
    roles: ["admin"],
    path: "Sidebar → People → {workers} & Managers → Internal Team → Permissions → on a card",
    route: "/admin/techs",
    permission: "permissions:manage",
    summary:
      "Give one staff member more or less than their role's defaults, module by module.",
    controls: [
      { label: "Use custom permissions for this person", does: "When off, they inherit their role's defaults. When on, the module grid appears." },
      { label: "View / Create / Edit / Delete / Export / Manage", does: "Toggle each action per module. Turning on any action also turns on View." },
      { label: "Save custom permissions", does: "Saves the custom set for this person at your company." },
      { label: "Revert to role default", does: "Shown when the checkbox is off: clears custom permissions." },
      { label: "Cancel", does: "Closes without saving." },
    ],
    tasks: [
      {
        q: "How do I let a dispatcher edit {workers}?",
        steps: ["Open Internal Team and click Permissions → on their card.", "Tick Use custom permissions for this person.", "In the Technicians & Team row, turn on Edit.", "Click Save custom permissions."],
      },
      {
        q: "How do I undo custom permissions for someone?",
        steps: ["Click Permissions → on their card.", "Untick Use custom permissions for this person.", "Click Revert to role default."],
      },
    ],
    fixes: [
      { problem: "“Admins always have full access to every feature. This cannot be restricted.”", fix: "Admins can't be limited. Change their role to Manager or Dispatcher first if they need less access." },
    ],
    keywords: ["custom permissions", "access", "override", "restrict user"],
  },

  {
    id: "office-web.people.roles-permissions",
    title: "Roles & Permissions",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → People → {workers} & Managers → Roles & Permissions tab",
    route: "/admin/techs",
    permission: "techs:view",
    summary:
      "Shows what each standard role (Manager, Dispatcher, Project Manager, Field Staff, Admin) can do in each module. These defaults are the same for every company and are read-only here.",
    controls: [
      { label: "Role list (Admin, Manager, Dispatcher, Project Manager, Field Staff…)", does: "Pick a role to see its permissions. Each shows its permission count, or Full access for admins." },
      { label: "Module / Allowed actions / All", does: "Grid of modules and the actions the role allows. Read-only for companies." },
    ],
    tasks: [
      {
        q: "What can a dispatcher do?",
        steps: ["Open {workers} & Managers → Roles & Permissions.", "Click Dispatcher.", "Read the highlighted actions in each module row."],
      },
      {
        q: "How do I change what a role can do?",
        steps: ["Role defaults can't be changed by a company.", "To change one person, open Internal Team and click Permissions → on their card."],
      },
    ],
    fixes: [
      { problem: "I can't click the permission buttons", fix: "Role defaults are ArrivePing's standard roles and read-only for companies. Use per-person Permissions on the Internal Team tab." },
    ],
    keywords: ["roles", "permissions", "access levels", "what can a manager do", "dispatcher access"],
  },

  {
    id: "office-web.people.import",
    title: "Import people (CSV or Excel)",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → People (Directory) → Import, or {workers} & Managers → Field Staff → Import",
    route: "/admin/clients",
    permission: "clients:view",
    summary:
      "Bulk-add {customers}, {workers}, dispatchers or places from a CSV or Excel file, using a downloadable template.",
    controls: [
      { label: "Import", does: "Opens the menu for the current tab's type. On the Directory's All tab it first asks “What are you importing?”." },
      { label: "Import CSV / Import Excel", does: "Choose a .csv or .xlsx/.xls file to import." },
      { label: "Download CSV template / Download Excel template", does: "Downloads a blank template with the right columns (listed under Template columns)." },
      { label: "Import complete", does: "Summary: Created, Updated, Invited and Failed counts, a table of failed rows with the Reason, and rows Imported, but check." },
      { label: "Done", does: "Closes the summary." },
    ],
    tasks: [
      {
        q: "How do I import my {customers}?",
        steps: ["Open Sidebar → People → People and click the {customers} tab.", "Click Import → Download CSV template and fill it in.", "Click Import → Import CSV and choose the file.", "Check Import complete for failed rows."],
        note: "New {customers} aren't emailed; they first hear from you when work is booked.",
      },
      {
        q: "How do I import {workers}?",
        steps: ["Open {workers} & Managers → Field Staff.", "Click Import → Download Excel template and fill it in.", "Click Import → Import Excel and choose the file.", "Review Created, Invited and Failed."],
        note: "New people with an email are sent a set-password link over the next few minutes.",
      },
      {
        q: "Why did some rows fail to import?",
        steps: ["Read the Reason column in Import complete.", "Fix those rows in your file (e.g. invalid email).", "Import just the fixed rows again."],
      },
    ],
    fixes: [
      { problem: "“File is too large (max 5MB)” or “Import is limited to 500 rows at a time”", fix: "Split the file into smaller files and import each one." },
      { problem: "“No rows found in that file…”", fix: "The file needs a header row of column names (such as Name, Email and Phone) with people listed below. Start from the downloaded template." },
      { problem: "“Could not read that file — check it's a valid CSV or Excel export”", fix: "Re-save the file as CSV or .xlsx and try again." },
      { problem: "Row reason “Already in your account” / “Already on your team”", fix: "That email is already in your company, so the row was skipped." },
      { problem: "“Only a superadmin can bulk-import dispatchers”", fix: "Add dispatchers one at a time from Internal Team → New Employee." },
      { problem: "“Turn on … in Settings → Directory to import them.”", fix: "Places (Properties, Communities, etc.) are off. Turn them on in Settings → Company under “… in the Directory”." },
      { problem: "Imported {workers} weren't emailed", fix: "Rows without an email address can't sign in. Add an email on each profile, then use Email a sign-in link." },
    ],
    keywords: ["import", "csv", "excel", "bulk upload", "spreadsheet", "template", "migrate"],
  },

  // ---------------------------------------------------------------------------
  // Directory (Sidebar: People)
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.directory",
    title: "Directory (People)",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → People",
    route: "/admin/clients",
    permission: "clients:view",
    summary:
      "Everyone your company deals with in one table: {customers}, {workers} and office staff (and places, when your company groups {customers} by place). Search, ask questions in plain words, sort, group, and open anyone's record.",
    controls: [
      { label: "All / {customers} / {workers} / Office staff", does: "Tabs with counts. The add button and import follow the tab you're on." },
      { label: "Properties (or your place word: Communities, Buildings, Teams…)", does: "Extra tab when places are on: the named places and who manages each." },
      { label: "Search, or ask a question…", does: "Type to search as you go. Press Enter or Ask to read it as a question (e.g. “{customers} with open {jobs}”)." },
      { label: "Ask", does: "Turns your question into a filter. Shows a summary, filter chips and match count; Keyword reading means AI search was off and keywords were used." },
      { label: "Clear", does: "Clears the search, question and filters." },
      { label: "All properties / All managers (filters)", does: "Shown when places are on: filter {customers} by place or by the person who manages it." },
      { label: "Group by: No grouping / Group by property / Group by manager / Group by type", does: "Group rows under headers." },
      { label: "Sort by (small screens) / column headers", does: "Click a column header (Name, Type, Contact, Open, Last {job}, Joined…) to sort; click again to reverse." },
      { label: "Import", does: "Import {customers}, {workers}, dispatchers or places from CSV or Excel." },
      { label: "Add {customer} / Add {worker} / Add Dispatcher / Add property", does: "Follows the tab: All and {customers} open Add {customer}; {workers} goes to the {workers} page; Office staff opens Add Dispatcher; the places tab adds a place." },
      { label: "Row", does: "Click to open the person's record drawer." },
      { label: "Invited / Deactivated badges", does: "Invited: hasn't accepted yet. Deactivated: can't sign in." },
      { label: "Delete account (trash icon)", does: "Asks to confirm, then permanently deletes the account (or removes them from your company only, if they also work for another one)." },
      { label: "Row checkboxes / Select everyone on this page", does: "When places are on: select {customers} to move them with Assign to property." },
      { label: "Select all n matching", does: "On the {customers} tab, after selecting a full page: selects every match, not just this page." },
      { label: "Assign to property", does: "Opens Assign to move the selected {customers} to a place." },
      { label: "Show 25 / 50 / 100 per page, page numbers, Previous/Next", does: "Paging at the bottom of the table." },
    ],
    tasks: [
      {
        q: "How do I find a {customer}?",
        steps: ["Open Sidebar → People → People.", "Click the {customers} tab.", "Type a name, email or phone in the search box."],
      },
      {
        q: "How do I find {customers} with open {jobs}?",
        steps: ["Open People → People.", "Type a question like “{customers} with open {jobs}” in the search box.", "Press Enter or click Ask.", "Click Clear to go back."],
      },
      {
        q: "How do I sort {customers} by most open {jobs}?",
        steps: ["Click the {customers} tab.", "Click the Open column header (or pick Most open {jobs} in Sort by on small screens)."],
      },
      {
        q: "How do I add a {customer}?",
        steps: ["Open People → People.", "On All or {customers}, click Add {customer}.", "Fill in First name, Last name, Email and Temp password.", "Click Create."],
      },
      {
        q: "How do I delete a {customer}?",
        steps: ["Find them in People → People.", "Click the trash icon at the end of their row.", "Confirm in Delete account."],
        note: "This cannot be undone.",
      },
      {
        q: "How do I group residents by property?",
        steps: ["Open People → People (places must be on).", "Choose Group by property in the group menu."],
      },
      {
        q: "How do I see more rows per page?",
        steps: ["Scroll to the bottom of the table.", "Change Show to 50 or 100."],
      },
    ],
    fixes: [
      { problem: "“Nobody matches. Try fewer words, or clear the filters.”", fix: "Your search or filters exclude everyone. Click Clear." },
      { problem: "Delete account seems to do nothing", fix: "The delete was refused and the dialog just closes. Common reasons: deleting needs delete permission on Clients (only admins by default), you can't delete yourself, only an admin can remove a team member here, and admin accounts need a superadmin. Remove staff from {workers} & Managers instead." },
      { problem: "Keyword reading shows on my question", fix: "AI search is off or busy, so the question was read by its keywords and names. Results may be broader." },
      { problem: "No Properties tab or property filters", fix: "Places are off for your company. Turn them on in Settings → Company (the “… in the Directory” card)." },
    ],
    keywords: ["directory", "people", "clients", "customers", "contacts", "CRM", "search customers", "residents"],
  },

  {
    id: "office-web.people.directory-add-person",
    title: "Add {customer} / Add Dispatcher",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → People → Add {customer} (All or {customers} tab), or Add Dispatcher (Office staff tab)",
    route: "/admin/clients",
    permission: "clients:create",
    summary:
      "Creates a {customer} login and record from the Directory. Customers aren't emailed when added.",
    controls: [
      { label: "First name / Last name", does: "Required." },
      { label: "Email", does: "Required." },
      { label: "Temp password", does: "Required, at least 8 characters." },
      { label: "Phone", does: "Their phone." },
      { label: "Account type: One-time client / Repeat customer", does: "{customer} only: the buying pattern." },
      { label: "Company name / Company website / Company address", does: "{customer} only: business details." },
      { label: "Role (Dispatcher, read-only)", does: "Add Dispatcher only." },
      { label: "Create", does: "Creates the account. Disabled until first name, last name, email and password are filled." },
      { label: "Cancel", does: "Closes without saving." },
    ],
    tasks: [
      {
        q: "How do I add a business {customer}?",
        steps: ["Open People → People and click Add {customer}.", "Fill in First name, Last name, Email and Temp password.", "Set Account type.", "Fill in Company name, Company website and Company address.", "Click Create."],
      },
      {
        q: "How do I add a dispatcher?",
        steps: ["Open People → People and pick the Office staff tab.", "Click Add Dispatcher.", "Fill in the details, then click Create."],
        note: "Admins only. You can also add one from {workers} & Managers → Internal Team → New Employee.",
      },
    ],
    fixes: [
      { problem: "Create is greyed out", fix: "First name, Last name, Email and Temp password are all required." },
      { problem: "“Password must be at least 8 characters”", fix: "Use a temp password of 8 or more characters." },
      { problem: "“Only an admin can add office staff”", fix: "Adding a dispatcher needs an admin. Ask an admin on your account to add them." },
      { problem: "A message says the person was invited instead", fix: "That email already has an ArrivePing login (for example with another company), so they were invited to join yours with it. They show as invited until they accept." },
      { problem: "“That person is already in your account”", fix: "Someone with that email is already in your Directory. Search for them." },
      { problem: "The {customer} shows Invited", fix: "That email already had an ArrivePing login (e.g. with another company), so they were added as invited instead of getting a new account." },
    ],
    keywords: ["new customer", "add client", "create customer"],
  },

  {
    id: "office-web.people.customer-record",
    title: "{customer} record",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → People → click a row",
    route: "/admin/clients",
    permission: "clients:view",
    summary:
      "Side drawer for one person: contact details, place and unit, addresses, extra contacts, notes, custom fields, tags, {job} history and files.",
    controls: [
      { label: "Profile / Job history / Files", does: "Tabs in the drawer." },
      { label: "First name, Last name, Company, Company website, Email, Primary phone, Secondary phone", does: "Contact fields." },
      { label: "Account type", does: "{customer}s only: One-time client or Repeat customer." },
      { label: "Place and Unit (e.g. Property, Unit)", does: "Shown when places are on: which place they belong to and their unit, with its manager shown below." },
      { label: "Street address, City, Province / State, Postal / ZIP, Country", does: "Primary address. Picking an autocomplete result fills city, region and postal code where it can." },
      { label: "Add address", does: "Adds an extra site or billing address (label, street, city, province, postal). The x removes it." },
      { label: "Add contact", does: "Adds an extra contact (name, role, phone, email). The x removes it." },
      { label: "Notes", does: "Account notes, gate codes, preferences, history." },
      { label: "Save client record", does: "Saves the profile, including a changed place or unit." },
      { label: "Custom fields", does: "Fields defined for {customers} in Tags & Fields." },
      { label: "Tags", does: "{customer}s only: apply tags." },
      { label: "Job history", does: "Their {jobs}. Click an open one to open it; a completed one opens its report." },
      { label: "Files", does: "Files attached to this person." },
    ],
    tasks: [
      {
        q: "How do I update a {customer}'s phone or email?",
        steps: ["Open People → People and click their row.", "Edit Email or Primary phone.", "Click Save client record."],
      },
      {
        q: "How do I add a second service address for a {customer}?",
        steps: ["Open their record.", "Under Additional sites / addresses, click Add address.", "Enter a Label and the address.", "Click Save client record."],
      },
      {
        q: "How do I add a billing contact or tenant to a {customer}?",
        steps: ["Open their record.", "Under Additional contacts, click Add contact.", "Fill in name, role, phone and email.", "Click Save client record."],
      },
      {
        q: "Where do I put a gate code?",
        steps: ["Open their record.", "Type it in Notes.", "Click Save client record."],
      },
      {
        q: "How do I see a {customer}'s past {jobs}?",
        steps: ["Open their record.", "Click Job history.", "Click a {job} to open it."],
      },
      {
        q: "How do I move a resident to another property and unit?",
        steps: ["Open their record.", "Pick the new place in the place field and enter the Unit.", "Click Save client record."],
      },
    ],
    fixes: [
      { problem: "“Couldn't load this record. Please try again.”", fix: "Close the drawer and open the row again." },
      { problem: "“Email already in use”", fix: "Another account uses that email." },
      { problem: "“Only an admin can edit a team member's account”", fix: "Non-admins can only edit {customer} records here." },
      { problem: "“Saved, but their … didn't change”", fix: "The profile saved but moving them to the place failed; try the place change again." },
      { problem: "Unit field is disabled", fix: "Pick a place first; units belong to a place." },
    ],
    keywords: ["customer details", "client record", "edit customer", "addresses", "contacts", "job history", "notes"],
  },

  {
    id: "office-web.people.directory-properties",
    title: "Properties (places) tab",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → People → Properties tab (named for your places: Communities, Buildings, Teams…)",
    route: "/admin/clients",
    permission: "clients:view",
    summary:
      "The named places your company serves, each with an address, a manager from your team, notes, its {customers} and open {jobs}. Only shown when places are on.",
    controls: [
      { label: "Search properties…", does: "Filters places by name, address, manager or notes." },
      { label: "Column headers (Property, Address, Manager, {customers}, Open {jobs})", does: "Click to sort; click again to reverse." },
      { label: "{customers} count button", does: "Shows the {customers} at that place on the {customers} tab." },
      { label: "Row", does: "Opens the place editor." },
      { label: "Add property", does: "Opens the editor to add a place (top-right button or the empty-state button)." },
      { label: "Property name / Address / Manager / Notes", does: "Editor fields. Manager lists your Field team and Office team." },
      { label: "Add property / Save property", does: "Saves. Disabled until a name is entered." },
      { label: "View the n {customers} here", does: "Jumps to the {customers} at this place." },
      { label: "Remove", does: "Asks to confirm, then removes the place. Its {customers} stay in the Directory with no place and its {job} history is kept." },
    ],
    tasks: [
      {
        q: "How do I add a property and assign its manager?",
        steps: ["Open People → People → Properties tab.", "Click Add property.", "Enter the name and address.", "Pick the Manager.", "Click Add property."],
      },
      {
        q: "How do I change who manages a property?",
        steps: ["Open the Properties tab and click the property.", "Pick a different Manager.", "Click Save property."],
      },
      {
        q: "How do I see everyone at a property?",
        steps: ["Open the Properties tab.", "Click the number in the {customers} column."],
      },
      {
        q: "How do I delete a property?",
        steps: ["Click the property.", "Click Remove.", "Confirm Remove."],
      },
    ],
    fixes: [
      { problem: "“There's already a … called …”", fix: "Place names must be unique. Pick a different name or edit the existing one." },
      { problem: "“… is already at that address.”", fix: "Another place uses that address. Edit that one instead." },
      { problem: "“The … has to be a member of your team.”", fix: "The manager must be a current team member. Pick someone from the list." },
      { problem: "Manager shows “Former team member”", fix: "The saved manager has left your team. Pick a current team member and save." },
    ],
    keywords: ["properties", "buildings", "communities", "sites", "property manager", "places", "units"],
  },

  {
    id: "office-web.people.assign-to-place",
    title: "Assign to property",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → People → tick {customers} → Assign to property",
    route: "/admin/clients",
    permission: "clients:edit",
    summary:
      "Moves selected {customers} to a place (creating it if new), or takes them off their place.",
    controls: [
      { label: "Property picker", does: "Pick an existing place, + New property…, or No property (take them off theirs)." },
      { label: "New property name", does: "Shown for + New property…: the new place's name." },
      { label: "Unit (optional)", does: "Shown when moving one person: their unit. When moving several, each keeps their own unit." },
      { label: "Assign / Remove from property", does: "Saves the move." },
      { label: "Cancel", does: "Closes without changes." },
    ],
    tasks: [
      {
        q: "How do I move several residents to a property at once?",
        steps: ["Open People → People → {customers} tab.", "Tick the people (or Select everyone on this page, then Select all n matching).", "Click Assign to property.", "Pick the place and click Assign."],
      },
      {
        q: "How do I take a {customer} off their property?",
        steps: ["Tick them in the Directory.", "Click Assign to property.", "Pick No property (take them off theirs).", "Click Remove from property."],
      },
    ],
    fixes: [
      { problem: "No checkboxes on rows", fix: "Selecting is only for {customers} and only when places are on." },
      { problem: "“Only … can belong to a …. Make a team member the …'s … instead.”", fix: "Staff can't be residents. Set them as the place's manager on the Properties tab." },
      { problem: "“Some of those people aren't in your directory.”", fix: "Someone in the selection was removed meanwhile. Refresh and select again." },
    ],
    keywords: ["assign property", "move residents", "bulk assign", "unit"],
  },

  // ---------------------------------------------------------------------------
  // Payouts
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.payouts",
    title: "{worker} Payouts",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → Money → Payouts",
    route: "/admin/payouts",
    permission: "payouts:view",
    summary:
      "Works out what each {worker} earned for completed {jobs} in a pay period (on-site hours × hourly rate, plus mileage, flat and per-unit pay) and tracks which payouts are paid.",
    controls: [
      { label: "Generate payouts", does: "Opens Generate payouts to pick a period." },
      { label: "Period start / Period end", does: "Dates of the pay period (defaults to the last 7 days)." },
      { label: "Generate", does: "Creates a pending payout per {worker} for completed {jobs} in the period that haven't been paid out before." },
      { label: "Pending / Paid out / Total records", does: "Totals of pending payouts, lifetime paid, and the number of payout records." },
      { label: "{worker} name (arrow)", does: "Expands the row to show per-{job} pay: on-site time, rate, hourly, distance paid, mileage, flat, per-unit, pay." },
      { label: "n no pay rate", does: "Warning: those {jobs} paid $0 because the person has no hourly rate and there was no per-unit pay." },
      { label: "Mark paid", does: "Marks a pending payout as paid. It then shows Paid." },
    ],
    tasks: [
      {
        q: "How do I run payroll for last week?",
        steps: ["Open Sidebar → Money → Payouts.", "Click Generate payouts.", "Set Period start and Period end.", "Click Generate.", "Review each row and click Mark paid once you've paid them."],
      },
      {
        q: "How is a {worker}'s pay calculated?",
        steps: ["Each completed {job} pays on-site time × that person's hourly rate.", "Plus any mileage, flat and per-unit pay on the {job}.", "Expand a row on Payouts to see the per-{job} breakdown."],
        note: "{jobs} count once completed; you don't wait for the customer's invoice to be paid.",
      },
      {
        q: "How do I see which {jobs} are in a payout?",
        steps: ["Open Payouts.", "Click the {worker}'s name in the row to expand it."],
      },
      {
        q: "Will generating the same period twice pay people twice?",
        steps: ["Generate the period again if you need to; it won't pay twice.", "A {job} already covered by an earlier payout is skipped, so only new completed {jobs} are added."],
      },
    ],
    fixes: [
      { problem: "A {worker} shows $0 or “no pay rate”", fix: "They have no hourly rate set. Set Pay rate / hr on their profile ({workers} & Managers → their card → Save profile), then generate a new period. Existing payouts aren't recalculated." },
      { problem: "A completed {job} is missing from the payout", fix: "Only completed {jobs} scheduled within the period, assigned to someone, and not already in an earlier payout are included. Sample {jobs} and sample {workers} are never paid." },
      { problem: "“No new payouts: no completed {jobs} in that period that haven't already been paid out.”", fix: "Nothing in that period is waiting to be paid. Check the dates, and that the {jobs} are marked completed." },
      { problem: "Generate or Mark paid shows “Your role doesn't include this…”", fix: "Generating and marking paid need edit permission on Payouts; managers get view-only by default. Ask an admin." },
      { problem: "“This payout has already been paid.”", fix: "Someone already marked it paid. Refresh the page." },
      { problem: "A row shows — for Hourly, Mileage, Flat and Per-unit", fix: "That payout was generated under the old percentage model, so there is no per-job pay detail." },
    ],
    keywords: ["payroll", "technician pay", "payouts", "wages", "commission", "pay period", "mark paid"],
  },

  // ---------------------------------------------------------------------------
  // Reviews
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.reviews",
    title: "Reviews",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → People → Reviews",
    route: "/admin/reviews",
    permission: "reviews:view",
    summary:
      "Star ratings and comments from {customers}, with the {worker} who did the {job}. Hide, feature, reply to or delete reviews.",
    controls: [
      { label: "all / visible / hidden / featured / 5★ / 4★ / 3★ / 2★ / 1★", does: "Filter chips." },
      { label: "Hide / Unhide", does: "Hides a review from the public list (or shows it again). Hidden reviews appear dimmed with a Hidden badge." },
      { label: "Feature / Unfeature", does: "Marks a review as Featured." },
      { label: "Reply", does: "Opens Reply to review with a Public reply box; Save reply shows it under the review." },
      { label: "Delete", does: "Asks “Delete review?” and permanently removes it." },
    ],
    tasks: [
      {
        q: "How do I reply to a review?",
        steps: ["Open Sidebar → People → Reviews.", "Click Reply on the review.", "Type your Public reply.", "Click Save reply."],
      },
      {
        q: "How do I hide a bad review?",
        steps: ["Open Reviews.", "Click Hide on the review."],
        note: "Hidden reviews are kept and can be shown again with Unhide.",
      },
      {
        q: "How do I see only 1-star reviews?",
        steps: ["Open Reviews.", "Click the 1★ chip."],
      },
      {
        q: "How do I feature a great review?",
        steps: ["Open Reviews.", "Click Feature on the review."],
      },
      {
        q: "How do I delete a review?",
        steps: ["Click Delete on the review.", "Click Delete to confirm."],
        note: "This can't be undone; Hide is reversible.",
      },
    ],
    fixes: [
      { problem: "“No reviews match this filter.”", fix: "Click all to see every review." },
      { problem: "Hide, Feature, Reply or Delete shows “Your role doesn't include this…”", fix: "Your role may only view reviews: dispatchers and project managers are view-only by default, and managers can hide, feature and reply but not delete. Ask an admin." },
    ],
    keywords: ["reviews", "ratings", "feedback", "stars", "testimonials", "reply to review"],
  },

  // ---------------------------------------------------------------------------
  // Tags & Fields
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.tags-fields",
    title: "Tags & Custom Fields",
    ...WEB,
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → Setup → Tags & Fields",
    route: "/admin/tags",
    permission: "tags:edit",
    summary:
      "Create coloured tags for {customers} and {workers}, and custom fields for {customers}, {workers} and {jobs}.",
    controls: [
      { label: "New tag", does: "Opens New tag: Label, Color and Applies to (Both, {customers}, {workers}); Create saves it." },
      { label: "Tag trash icon", does: "Asks to confirm, then deletes the tag and removes it from all records." },
      { label: "{customers} / {workers} / {jobs}", does: "Chooses which record type's custom fields are listed and added." },
      { label: "New field", does: "Opens New custom field for the chosen record type." },
      { label: "Field label / Type / Section / Placeholder / Required field", does: "Field settings. Types: text, textarea, number, date, select, checkbox, file, signature, payment, note." },
      { label: "Options (comma separated)", does: "Shown for select fields: the choices." },
      { label: "Add field", does: "Saves the field. Disabled until a label is entered." },
      { label: "Field trash icon", does: "Asks to confirm, then deletes the field and its stored values." },
    ],
    tasks: [
      {
        q: "How do I create a VIP tag for {customers}?",
        steps: ["Open Sidebar → Setup → Tags & Fields.", "Click New tag.", "Enter VIP as the Label and pick a Color.", "Set Applies to {customers}.", "Click Create."],
      },
      {
        q: "How do I add a gate-code field to every {customer}?",
        steps: ["Open Tags & Fields.", "Under Custom Fields, click {customers}.", "Click New field.", "Enter Gate code as the Field label and pick a Type.", "Click Add field."],
      },
      {
        q: "How do I add a dropdown field?",
        steps: ["Click New field.", "Set Type to select.", "Type the choices in Options (comma separated).", "Click Add field."],
      },
      {
        q: "How do I delete a tag?",
        steps: ["Click the trash icon next to the tag.", "Confirm."],
        note: "It's removed from every record it was on.",
      },
      {
        q: "Where do I apply a tag to someone?",
        steps: ["Open the person's record (People → People, or their {worker} card).", "Use the Tags section on the Profile tab."],
      },
    ],
    fixes: [
      { problem: "Deleted field and its data are gone", fix: "Deleting a custom field removes its stored values too; it can't be undone." },
      { problem: "A tag doesn't appear on a {worker} or {customer}", fix: "Check its Applies to setting. Tags for {customers} only won't show on {workers}." },
    ],
    keywords: ["tags", "labels", "custom fields", "extra fields", "properties", "gate code"],
  },

  // ---------------------------------------------------------------------------
  // Settings → Skill Classes
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.skill-classes",
    title: "Skill Classes",
    ...WEB,
    roles: ["admin", "manager"],
    path: "Sidebar → Setup → Settings → Skill Classes",
    route: "/admin/settings?section=skill-classes",
    permission: "techs:edit",
    summary:
      "The trades your {workers} are filed under and the class a {job} can require. Dispatch, the scheduler and automation rules use this list. Skills (finer tags) stay on each {worker}'s profile.",
    controls: [
      { label: "Up / down arrows", does: "Reorder classes." },
      { label: "Rename (pencil)", does: "Renames a class and moves its {workers} and open {jobs} to the new name. Saves straight away." },
      { label: "Remove (trash)", does: "Removes a class from the list. People and {jobs} using it keep it until changed." },
      { label: "Add a skill class + Add", does: "Adds a new class to the list." },
      { label: "Save changes", does: "Saves adds, removals and order." },
      { label: "Discard", does: "Throws away unsaved changes." },
      { label: "Still in use, not in the list → Rename / move", does: "Classes still on {workers} or open {jobs} but no longer offered. Rename one to an existing class to move everyone across." },
    ],
    tasks: [
      {
        q: "How do I add a new trade?",
        steps: ["Open Setup → Settings → Skill Classes.", "Type the name in Add a skill class.", "Click Add.", "Click Save changes."],
      },
      {
        q: "How do I rename a skill class?",
        steps: ["Click the pencil next to it.", "Type the new name.", "Click the check mark."],
        note: "Everyone and every open {job} on the old name moves to the new one.",
      },
      {
        q: "How do I merge two skill classes?",
        steps: ["Rename the one you're dropping to the exact name of the one you keep.", "Click the check mark."],
      },
      {
        q: "How do I remove a skill class?",
        steps: ["Click the trash icon next to it.", "Confirm Remove if people or {jobs} use it.", "Click Save changes."],
      },
    ],
    fixes: [
      { problem: "“Keep at least one skill class.”", fix: "The list can't be empty. Add another before removing the last one." },
      { problem: "“Save or discard your other changes first, then rename.”", fix: "Click Save changes or Discard, then rename." },
      { problem: "“\"…\" is already in the list.”", fix: "That class exists already (names aren't case-sensitive)." },
      { problem: "Skill Classes tab isn't in Settings", fix: "It needs edit permission on Technicians & Team." },
    ],
    keywords: ["skill classes", "trades", "specialties", "technician types", "required skill"],
  },

  // ---------------------------------------------------------------------------
  // Notifications → {worker} Invites
  // ---------------------------------------------------------------------------
  {
    id: "office-web.people.technician-invites",
    title: "{worker} Invites",
    ...WEB,
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → {worker} Invites tab",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "Invite-only onboarding: send a {worker} an email (and SMS if a phone is given) with a link to set their password and go active. Lists invites with their status.",
    controls: [
      { label: "Invite {worker}", does: "Opens the invite form." },
      { label: "Name / Email * / Phone (for SMS invite) / Skill class", does: "Invite details. Email is required; a phone also sends the link by SMS." },
      { label: "Send invite", does: "Sends the invite. Disabled until Email is filled." },
      { label: "pending / accepted / revoked", does: "Status of each invite." },
      { label: "Copy link", does: "Pending only: copies the join link to send yourself." },
      { label: "Resend", does: "Pending only: sends a reminder email (and SMS if a phone is on the invite)." },
      { label: "x (revoke)", does: "Pending only: revokes the invite so the link stops working." },
    ],
    tasks: [
      {
        q: "How do I invite a {worker} by text message?",
        steps: ["Open Setup → Notifications → {worker} Invites.", "Click Invite {worker}.", "Fill in Email and Phone (for SMS invite).", "Click Send invite."],
      },
      {
        q: "How do I resend an invite?",
        steps: ["Open {worker} Invites.", "Click Resend on the pending invite."],
      },
      {
        q: "How do I send the invite link myself?",
        steps: ["Click Copy link on the pending invite.", "Paste it into your own message."],
      },
      {
        q: "How do I cancel an invite?",
        steps: ["Open Setup → Notifications → {worker} Invites.", "Click the x on the pending invite."],
      },
    ],
    fixes: [
      { problem: "A notice says they won't appear in this list", fix: "That email already has an ArrivePing login, so they were invited to join your company with it instead. Find them as Invite pending on the {workers} page; they sign in with their existing login to accept." },
      { problem: "“Invite not found or already used” when they open the link", fix: "The invite was accepted or revoked. Send a new invite." },
      { problem: "“Account already exists — please sign in”", fix: "That email already has a login; they should sign in instead." },
    ],
    keywords: ["invite", "technician invite", "join link", "onboarding", "sms invite"],
  },
];
