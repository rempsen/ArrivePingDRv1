/**
 * Office web dashboard: setup and settings screens (Settings tabs,
 * Notifications, Automation, Integrations, QuickBooks, Payments, Billing,
 * API & MCP, Reports, Audit Log). Written from the source; see types.ts.
 */
import type { KbEntry } from "./types";

export const entries: KbEntry[] = [
  /* ------------------------------------------------------------------ */
  /* Settings → Company                                                  */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.settings-company",
    title: "Settings: Company (profile, branding, tax & locale)",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Company tab",
    route: "/admin/settings?section=company",
    permission: "settings:manage",
    summary:
      "The company's business profile, office location, logo and brand color, timezone, currency and tax, the shared category list, and the calendar feed. Most fields save only when you press Save changes.",
    controls: [
      { label: "Save changes", does: "Saves every field on the Company tab (profile, branding, tax & locale and the job/customer rules cards). Shows Saving… then Saved." },
      { label: "Company name", does: "Your business name, shown in the sidebar, texts and emails." },
      { label: "Legal name", does: "Legal business name; used in the email footer when set." },
      { label: "Email", does: "Company contact email." },
      { label: "Phone", does: "Company contact phone." },
      { label: "Website", does: "Your website address. Also used by Re-scan website and the Company data check." },
      { label: "Re-scan website", does: "Re-reads your website and fills only brand fields that are still blank; never overwrites what you typed. Disabled until a Website is entered. Reports how many pages it read and what it filled." },
      { label: "Business address", does: "Address autocomplete; also geocodes the business location for dispatch and geofencing." },
      { label: "Office location", does: "Where the fleet map centers when no {worker} has a live location yet." },
      { label: "Categories → Add", does: "Adds a category to the one list shared by Job Templates and the Product Catalog." },
      { label: "Rename (pencil) / Delete (bin) on a category", does: "Renames a category everywhere it is used, or deletes it. Delete is blocked while any catalog item or template still uses it." },
      { label: "Calendar Sync → Subscription URL", does: "A webcal link that shows all {jobs} in a calendar app. The copy button copies it." },
      { label: "Add to calendar (calendar icon menu)", does: "Opens the feed in Google Calendar, Outlook Calendar or Apple Calendar." },
      { label: "Regenerate (refresh icon on Calendar Sync)", does: "Makes a new calendar link after a confirm. Existing subscriptions stop updating until re-added." },
      { label: "Brand color", does: "Color picker and hex field for your brand color." },
      { label: "Upload logo / Replace logo", does: "Uploads a PNG, SVG, JPG, WebP or GIF up to 4MB. Shown at the top of the sidebar for your whole team." },
      { label: "Remove (logo)", does: "Clears the logo; the sidebar falls back to a monogram of your company name." },
      { label: "Logo URL", does: "Paste a direct image URL instead of uploading." },
      { label: "Timezone", does: "Company timezone (a fixed list of North American zones)." },
      { label: "Currency", does: "CAD, USD, EUR, GBP or AUD." },
      { label: "Tax label", does: "Name of the tax shown on prices (e.g. GST)." },
      { label: "Tax rate (%)", does: "Default tax rate." },
    ],
    tasks: [
      {
        q: "How do I change our company logo?",
        steps: ["Open Settings → Company tab", "In Branding, click Upload logo (or Replace logo)", "Pick a PNG, SVG, JPG or WebP file up to 4MB"],
        note: "An uploaded logo saves right away. A pasted Logo URL needs Save changes.",
      },
      {
        q: "How do I change our brand color?",
        steps: ["Open Settings → Company tab", "In Branding, pick a Brand color or type a hex value", "Click Save changes"],
      },
      {
        q: "How do I update our company phone, email or address?",
        steps: ["Open Settings → Company tab", "Edit Phone, Email or Business address in Business Profile", "Click Save changes"],
      },
      {
        q: "Where does the map center when nobody is out yet?",
        steps: ["Open Settings → Company tab", "Type an address in Office location and pick it from the list", "Click Save changes"],
      },
      {
        q: "How do I change the timezone, currency or tax rate?",
        steps: ["Open Settings → Company tab", "In Tax & Locale, set Timezone, Currency, Tax label and Tax rate (%)", "Click Save changes"],
      },
      {
        q: "How do I add or rename a category for templates and the catalog?",
        steps: ["Open Settings → Company tab", "In Categories, type a name and click Add", "To rename, click the pencil, edit and press Enter or the check mark"],
      },
      {
        q: "How do I see all our jobs in Google, Outlook or Apple Calendar?",
        steps: ["Open Settings → Company tab", "In Calendar Sync, click the calendar icon menu", "Choose Google Calendar, Outlook Calendar or Apple Calendar"],
        note: "You can also copy the Subscription URL and add it to any calendar app that takes a webcal link.",
      },
      {
        q: "Someone has our calendar link and shouldn't. How do I stop it?",
        steps: ["Open Settings → Company tab", "In Calendar Sync, click the refresh icon", "Confirm Regenerate", "Re-add the new link in your own calendar apps"],
      },
      {
        q: "How do I fill in my profile from our website?",
        steps: ["Open Settings → Company tab", "Enter your Website", "Click Re-scan website under the field", "Review the filled fields and click Save changes"],
        note: "Re-scan only fills blank fields. Use Company data check to see where your site differs.",
      },
    ],
    fixes: [
      {
        problem: "Logo shows a monogram instead of the image",
        fix: "A share link (Google Drive, Dropbox, OneDrive, iCloud, WeTransfer) opens a web page, not the image, and the page warns \"That's a share link…\". Click Upload logo and upload the file instead.",
      },
      {
        problem: "\"This URL didn't load as an image\" under the logo",
        fix: "The pasted Logo URL isn't a direct image link. Check the link or upload the file with Upload logo.",
      },
      {
        problem: "Logo upload fails with \"Logo too large (max 4MB)\" or \"Unsupported type\"",
        fix: "Use a PNG, SVG, JPG, WebP or GIF under 4MB.",
      },
      {
        problem: "Can't delete a category",
        fix: "Deleting is blocked while any catalog item or job template still uses that category. Move those items to another category first.",
      },
      {
        problem: "Re-scan website button is greyed out",
        fix: "It needs a Website address in the field above. Type it in, then click Re-scan website.",
      },
      {
        problem: "Old calendar subscription stopped updating",
        fix: "The calendar link was regenerated. Copy the new Subscription URL from Calendar Sync and add it again in your calendar app.",
      },
    ],
    keywords: ["company profile", "logo", "branding", "brand colour", "timezone", "currency", "tax", "GST", "calendar feed", "ical", "webcal", "categories", "office address"],
  },
  {
    id: "office-web.setup.settings-company-rules",
    title: "Settings: Company (geofencing, reviews, assignment, self-service, running late)",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Company tab",
    route: "/admin/settings?section=company",
    permission: "settings:manage",
    summary:
      "Cards on the Company tab that set how {jobs} and {customers} behave: auto-arrive radius and distance units, review requests, whether office staff can be assigned, Directory places, what {customers} may change online, and running-late notices. All save with Save changes at the top of the tab.",
    controls: [
      { label: "Units: Meters & km / Feet & miles", does: "Sets the company's distance unit for the geofence, mileage and mileage rates." },
      { label: "Auto-arrive radius", does: "How close a {worker} must get to the {job} address to be auto-arrived and start their on-site clock. The clock auto-pauses only past double this radius and resumes when they're back inside. Range 10–2000 m (30–6560 ft)." },
      { label: "Ask for a review after every job (toggle)", does: "After a {job} completes, texts the {customer} their job record and asks for a rating. 4–5 star ratings are offered your public review link; 3 or below raise a private alert instead." },
      { label: "Send how long after completion?", does: "Minutes after completion to send the review request. Default 120." },
      { label: "Public review link", does: "Your Google review URL, shown only to 4–5 star reviewers." },
      { label: "Office staff can be assigned {jobs} (toggle)", does: "On: admins, managers, dispatchers and project managers appear in Assign lists, on the board and the map. Off: only {workers} can be assigned. Nothing is deleted." },
      { label: "Places in the Directory: Automatic / On / Off", does: "Whether the Directory groups {customers} by place (properties, communities, teams…), adding a places tab, columns and import-template columns. Automatic follows your industry and data." },
      { label: "Let customers move their own appointment (toggle)", does: "Lets a {customer} reschedule from their appointment page." },
      { label: "Let customers send a cancellation request (toggle)", does: "Lets a {customer} ask to cancel. Cancellations are never automatic; they come to you to approve or decline." },
      { label: "Approval cutoff (hours before the appointment)", does: "Inside this window a reschedule becomes a request instead of going through. Default 12; 0 means always self-serve; max 336." },
      { label: "Watch jobs for delays (toggle)", does: "Watches live {jobs} against their promised time. A slipping {job} lands on the dispatch board, and the {customer} gets a text and a tracking-page notice if nobody acts." },
      { label: "Count as late after (minutes past the promised time)", does: "Default 15, range 5–240. Also catches a {worker} whose live ETA lands past the slot." },
      { label: "Send it automatically after (minutes on the board)", does: "Default 10. 0 means never send automatically; nothing goes out unless a dispatcher presses send." },
    ],
    tasks: [
      {
        q: "How do I change the auto-arrive (geofence) distance?",
        steps: ["Open Settings → Company tab", "In Geofencing & distance units, type a new Auto-arrive radius", "Click outside the field", "Click Save changes"],
        note: "Tighter suits homes; wider suits large commercial sites where the map pin is far from the door.",
      },
      {
        q: "How do I switch distances to miles and feet?",
        steps: ["Open Settings → Company tab", "In Geofencing & distance units, click Feet & miles", "Click Save changes"],
      },
      {
        q: "How do I turn off review requests?",
        steps: ["Open Settings → Company tab", "In Review requests, switch off Ask for a review after every job", "Click Save changes"],
      },
      {
        q: "How do I add our Google review link?",
        steps: ["Open Settings → Company tab", "Paste your link into Public review link", "Click Save changes"],
      },
      {
        q: "How do I let myself (the owner) be assigned jobs?",
        steps: ["Open Settings → Company tab", "In Who can be assigned {jobs}, switch on Office staff can be assigned {jobs}", "Click Save changes"],
      },
      {
        q: "How do I stop customers rescheduling online?",
        steps: ["Open Settings → Company tab", "In Customer self-service, switch off Let customers move their own appointment", "Click Save changes"],
      },
      {
        q: "How do I make late reschedules need my approval?",
        steps: ["Open Settings → Company tab", "In Customer self-service, set Approval cutoff (hours before the appointment)", "Click Save changes"],
      },
      {
        q: "How do I stop running-late texts going out on their own?",
        steps: ["Open Settings → Company tab", "In Running-late notices, set Send it automatically after to 0", "Click Save changes"],
        note: "Delays still appear on your board; nothing is sent until a dispatcher presses send.",
      },
      {
        q: "How do I turn off running-late notices completely?",
        steps: ["Open Settings → Company tab", "In Running-late notices, switch off Watch jobs for delays", "Click Save changes"],
      },
    ],
    fixes: [
      {
        problem: "{worker} gets checked in before they reach the door, or never auto-arrives",
        fix: "Adjust Auto-arrive radius: smaller for homes and driveways, larger (150 m / 500 ft or more) for big sites. Phone GPS drift means a {worker} may sometimes tap \"I've Arrived\" themselves.",
      },
      {
        problem: "{worker}'s clock paused while they were still on site",
        fix: "The clock auto-pauses only beyond twice the Auto-arrive radius. Widen the radius if your sites are large; the {worker} can tap \"Resume Clock\".",
      },
      {
        problem: "Office staff show up in the Assign list and on the board",
        fix: "Office staff can be assigned {jobs} is on. Switch it off on the Company tab and Save changes.",
      },
      {
        problem: "A customer cancelled online but the job is still on the board",
        fix: "Online cancellations are always requests. Approve or decline it in Change Requests.",
      },
      {
        problem: "Customer wasn't told we were running late",
        fix: "Check Watch jobs for delays is on and Send it automatically after isn't 0. A {customer} is never texted twice for the same slip, or once the {worker} has arrived; notices go by text and the tracking page only, not email.",
      },
    ],
    keywords: ["geofence", "auto arrive", "radius", "miles", "kilometres", "review request", "google reviews", "reputation", "assign owner", "solo operator", "reschedule", "cancellation", "cutoff", "running late", "delay notice", "properties", "directory places"],
  },
  {
    id: "office-web.setup.company-data-check",
    title: "Company data check",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Company tab → Company data check card",
    route: "/admin/settings?section=company",
    permission: "settings:manage",
    summary:
      "Re-reads your website and lists, line by line, where it is missing from, differs from, or adds to your profile (business profile, social links, bookable services, team). You tick what to apply; nothing changes on its own.",
    controls: [
      { label: "Run check / Run again", does: "Runs the check (takes 30–60 seconds)." },
      { label: "Row checkbox", does: "Ticks a found value to apply. Missing and New rows start ticked (New services only when you have none yet); Differs rows start unticked." },
      { label: "Apply N", does: "Applies only the ticked rows and reports what was applied and what was skipped and why." },
    ],
    tasks: [
      {
        q: "How do I check our profile against our website?",
        steps: ["Open Settings → Company tab", "In Company data check, click Run check", "Review each row (ArrivePing has vs Found)", "Tick the rows you want", "Click Apply"],
      },
      {
        q: "The check found services. What price do they get?",
        steps: ["Apply the new services", "Open Services from the sidebar", "Set each service's price and duration"],
        note: "New services land at $0 / 60 min.",
      },
    ],
    fixes: [
      {
        problem: "\"Company check failed: …\"",
        fix: "The check couldn't read your site. Make sure the Website field is correct and the site is online, then click Run again.",
      },
      {
        problem: "Some rows were skipped after Apply",
        fix: "The message lists each skipped row with its reason. Fix that value by hand in Business Profile if needed.",
      },
    ],
    keywords: ["website check", "scan website", "compare profile", "import services from website"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → Security                                                  */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.settings-security",
    title: "Settings: Security",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Security tab",
    route: "/admin/settings?section=security",
    permission: "settings:manage",
    summary: "Change your own password, and (admins) decide whether ArrivePing support may sign in as your team members to help.",
    controls: [
      { label: "Current password", does: "Your existing password." },
      { label: "New password", does: "At least 8 characters." },
      { label: "Confirm new password", does: "Must match New password." },
      { label: "Show passwords / Hide passwords", does: "Shows or hides what you typed." },
      { label: "Update password", does: "Changes your password." },
      { label: "Allow ArrivePing support to sign in as team members (switch)", does: "Admins only. When on, support can sign in as one of your team for up to an hour, must give a reason, can't touch billing, payouts, API keys or passwords, and every visit shows in the Audit Log." },
    ],
    tasks: [
      {
        q: "How do I change my password?",
        steps: ["Open Settings → Security tab", "Enter Current password", "Enter New password and Confirm new password", "Click Update password"],
      },
      {
        q: "How do I stop ArrivePing support from signing in to our account?",
        steps: ["Open Settings → Security tab", "In ArrivePing support access, switch it to Switched off"],
        note: "Only the company's own admins can change this.",
      },
      {
        q: "How do I see when support signed in as someone?",
        steps: ["Open Settings → Audit Log tab", "Look for entries marked \"by ArrivePing support\""],
      },
    ],
    fixes: [
      { problem: "\"Current password is incorrect\"", fix: "The current password you typed doesn't match. Try again, or sign out and use Forgot password." },
      { problem: "\"New password must be at least 8 characters.\"", fix: "Choose a longer password." },
      { problem: "\"New passwords do not match.\"", fix: "Type the same password in New password and Confirm new password." },
      { problem: "Support access switch is missing", fix: "Only admins see it." },
    ],
    keywords: ["password", "change password", "support access", "act as", "impersonation"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → Billing                                                   */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.settings-billing",
    title: "Settings: Billing (your ArrivePing plan)",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Billing tab",
    route: "/admin/settings?section=billing",
    permission: "admin",
    summary:
      "Your company's own ArrivePing subscription: plan status, users paid for, monthly cost, trial or next bill date, the card on file, and cancelling or closing the account.",
    controls: [
      { label: "Status pill", does: "Free trial, Active, Payment failed, Unpaid, Ended or No plan." },
      { label: "Users on your plan / Monthly cost (or First month) / Next bill (or Trial ends, Access ends)", does: "Summary of the plan. During the trial the first month shows Free, with days left." },
      { label: "Fewer users (−) / More users (+) / Users on your plan field", does: "Choose how many users you pay for. The price preview updates as you change it." },
      { label: "Save", does: "Saves the new user count. Takes effect on your next bill; nothing is charged in between." },
      { label: "Choose N users to deactivate", does: "Appears when the new count is lower than the users who count towards your plan; opens the picker to choose who comes off." },
      { label: "Add card / Change card", does: "Opens secure Stripe card entry. The new card replaces the old one for all future bills." },
      { label: "Cancel plan", does: "Stops future charges. You keep full access until the trial end or next bill date. Shows Cancellation scheduled once done." },
      { label: "Keep my plan", does: "Shown after cancelling; undoes the cancellation before the end date." },
      { label: "Close account", does: "Ends the plan today, signs everyone out and locks the account. Data is kept and ArrivePing can reopen it." },
      { label: "Dismiss", does: "Hides an error message." },
    ],
    tasks: [
      {
        q: "How do I update the card we pay with?",
        steps: ["Open Settings → Billing tab", "In Payment method, click Change card (or Add card)", "Enter the card in the secure form", "Click Use this card"],
      },
      {
        q: "How do I add a user to our plan?",
        steps: ["Open Settings → Billing tab", "Click More users (+) or type the new number", "Check the monthly price shown", "Click Save"],
        note: "Changes take effect on the next bill.",
      },
      {
        q: "How do I pay for fewer users?",
        steps: ["Open Settings → Billing tab", "Lower the number with Fewer users (−)", "If asked, click Choose N users to deactivate and pick who comes off", "Otherwise click Save"],
      },
      {
        q: "How is the number of users counted?",
        steps: ["Open Settings → Billing tab", "Read the line under Change how many users you pay for"],
        note: "One user per active {worker}. One office (dispatcher) license is included; each extra active admin, manager, dispatcher or project manager is one more user. Your bill never covers fewer users than are active.",
      },
      {
        q: "How do I cancel our subscription?",
        steps: ["Open Settings → Billing tab", "In Cancel or close, click Cancel plan", "Click Yes, cancel my plan"],
        note: "You keep access until the end date and can click Keep my plan any time before then.",
      },
      {
        q: "I cancelled by mistake. How do I undo it?",
        steps: ["Open Settings → Billing tab", "In the yellow notice, click Keep my plan"],
      },
      {
        q: "How do I close our account completely?",
        steps: ["Open Settings → Billing tab", "Click Close account", "Type your company name exactly as shown at the top left", "Click Close my account"],
      },
      {
        q: "When does our free trial end?",
        steps: ["Open Settings → Billing tab", "Read Trial ends in Your plan"],
      },
    ],
    fixes: [
      {
        problem: "\"This account isn't billed through ArrivePing's self-serve plan\"",
        fix: "Your account was set up by the ArrivePing team and is invoiced separately. Email contact@nvc360.com about your invoice.",
      },
      {
        problem: "\"We couldn't reach Stripe just now…\"",
        fix: "Plan and card details may be out of date. Reload the page in a moment.",
      },
      {
        problem: "Status shows Payment failed or Unpaid",
        fix: "The last charge didn't go through. Click Change card and add a working card.",
      },
      {
        problem: "\"No card on file. Add one so your plan continues after the trial.\"",
        fix: "Click Add card before the trial ends.",
      },
      {
        problem: "Save button doesn't appear when lowering users",
        fix: "More users are active than the number you chose. Click Choose N users to deactivate, or raise the number.",
      },
      {
        problem: "\"Type your company name exactly as shown to close the account.\"",
        fix: "The name typed doesn't match your company name. Type it exactly as it appears at the top of the sidebar.",
      },
      {
        problem: "Billing tab is missing",
        fix: "Billing is admin-only.",
      },
      {
        problem: "\"This plan has ended.\"",
        fix: "The subscription is over. Email contact@nvc360.com to start again.",
      },
    ],
    keywords: ["subscription", "invoice", "seats", "licenses", "users", "trial", "credit card", "update card", "cancel", "close account", "price", "plan"],
  },
  {
    id: "office-web.setup.billing-downsize",
    title: "Choose users to deactivate (lower your plan)",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Billing tab → lower the user count → Choose N users to deactivate",
    route: "/admin/settings?section=billing",
    permission: "admin",
    summary:
      "Pick which team members come off the plan when you want to pay for fewer users than are active. Deactivated people keep their history, can't sign in, don't count towards the bill, and can be reactivated later.",
    controls: [
      { label: "Person checkbox", does: "Selects someone to deactivate. The counter shows N of N selected." },
      { label: "What happens to <name>'s open jobs", does: "For someone with open {jobs}: Unassign (back to the board) or Reassign all to… another person." },
      { label: "Cancel", does: "Closes without changes." },
      { label: "Deactivate N and update plan", does: "Deactivates the selected people and saves the new user count." },
    ],
    tasks: [
      {
        q: "How do I remove a technician from our bill?",
        steps: ["Open Settings → Billing tab", "Lower Users on your plan", "Click Choose N users to deactivate", "Tick the person", "Choose what happens to their open {jobs}", "Click Deactivate N and update plan"],
      },
    ],
    fixes: [
      {
        problem: "\"Choose what happens to the open jobs above before confirming.\"",
        fix: "Someone selected still has open {jobs}. Pick Unassign or a person to reassign them to.",
      },
      {
        problem: "\"Your team changed since this opened…\"",
        fix: "Someone was added or changed while the picker was open. The list refreshed; choose again.",
      },
    ],
    keywords: ["deactivate user", "remove seat", "downsize", "reduce users"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → Payments (Stripe Connect)                                 */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.settings-payments",
    title: "Settings: Payments (take card payments with Stripe)",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Payments tab",
    route: "/admin/settings?section=payments",
    permission: "admin",
    summary:
      "Connect your own Stripe account so {customers} can pay by card. Money goes straight to your bank through Stripe; ArrivePing takes no cut. Once connected, {customers} see a Pay button on their tracking page.",
    controls: [
      { label: "Status pill", does: "Not connected, Setup incomplete, Connected, or Active · ArrivePing account." },
      { label: "Where is your business registered?", does: "Country for the Stripe account (Canada or United States)." },
      { label: "Connect with Stripe", does: "Takes you to Stripe to create a free account (about 5–10 minutes). You return to this tab when done." },
      { label: "Continue setup on Stripe", does: "Resumes Stripe onboarding when Stripe still needs details." },
      { label: "Check again", does: "Refreshes the connection status." },
      { label: "Stripe still needs", does: "List of details Stripe is still asking for." },
      { label: "Card payments / Bank payouts / Country", does: "Status of the connected account." },
      { label: "Open Stripe dashboard", does: "Opens your Stripe dashboard in a new tab for payments, payouts, refunds and disputes." },
    ],
    tasks: [
      {
        q: "How do I start taking card payments?",
        steps: ["Open Settings → Payments tab", "Choose your country under Where is your business registered?", "Click Connect with Stripe", "Complete Stripe's form (business, owner, bank account)", "Return to the Payments tab and wait for Connected"],
        note: "Have your bank details handy. No monthly fee; Stripe charges 2.9% + 30¢ per card payment.",
      },
      {
        q: "How do I finish a Stripe setup I started?",
        steps: ["Open Settings → Payments tab", "Click Continue setup on Stripe", "Provide what Stripe still needs"],
      },
      {
        q: "How do I issue a refund or see payouts?",
        steps: ["Open Settings → Payments tab", "Click Open Stripe dashboard", "Manage refunds, payouts and disputes in Stripe"],
      },
      {
        q: "When does money reach our bank?",
        steps: ["Open Settings → Payments tab", "Read Fees & payouts"],
        note: "By default Stripe pays out on a 2-business-day rolling schedule; change it in Stripe.",
      },
    ],
    fixes: [
      {
        problem: "\"Your Stripe setup link expired.\"",
        fix: "Click Continue setup to pick up where you left off.",
      },
      {
        problem: "Shows Setup incomplete / \"Stripe is reviewing your details\"",
        fix: "Stripe is still approving the account; the page checks every few seconds. If Stripe still needs details, they're listed; click Continue setup on Stripe.",
      },
      {
        problem: "\"Card payments are not configured on this server yet (Stripe keys missing).\"",
        fix: "Payments aren't switched on for ArrivePing's server. Contact ArrivePing support.",
      },
      {
        problem: "\"Stripe setup isn't available right now — ArrivePing's payment account needs attention.\"",
        fix: "This is a problem on ArrivePing's side, not yours. Contact support.",
      },
      {
        problem: "Bank payouts shows Pending",
        fix: "Card payments work, but Stripe hasn't enabled payouts yet. Open Stripe dashboard to see what's outstanding.",
      },
    ],
    keywords: ["stripe", "stripe connect", "card payments", "accept payments", "pay button", "refund", "payouts", "credit card", "fees"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → Automation & AI                                           */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.automation",
    title: "Automation",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Automation & AI tab",
    route: "/admin/settings?section=automation",
    permission: "automation:edit",
    summary:
      "Rules that react to {job} events: who gets a new {job} (assignment), alerts to the office, and automatic texts to {customers}. Templates are created off and in Suggest mode; nothing is dispatched without your say-so unless you switch a rule to auto-assign.",
    controls: [
      { label: "Custom rule", does: "Opens New custom rule: pick a trigger and an action yourself." },
      { label: "Your rules", does: "List of your rules showing trigger → action and how many times each ran." },
      { label: "Suggests only / Auto-assigns (on an assignment rule)", does: "Switches between suggesting a {worker} and assigning automatically. Turning on auto-assign asks first." },
      { label: "Edit settings (pencil)", does: "Reopens a template rule's settings." },
      { label: "Enable automation / Disable automation (switch)", does: "Turns a rule on or off." },
      { label: "Delete automation (bin)", does: "Deletes a rule after a confirm; it stops running immediately." },
      { label: "Templates → Use this template / Add another", does: "Starts a rule from a ready-made template." },
      { label: "Assignment templates", does: "Nearest available tech, Round-robin, Zone owner, Load balance." },
      { label: "Office alert templates", does: "Urgent job → alert the office, Unassigned-job alarm, Idle tech → pull from backlog, After-hours routing." },
      { label: "Customer message templates", does: "Running late → warn the customer, Job done → thank-you text." },
    ],
    tasks: [
      {
        q: "How do I auto-assign new jobs to the nearest technician?",
        steps: ["Open Settings → Automation & AI tab", "Under Templates → Assignment, click Nearest available tech", "Set the knobs (e.g. Ignore techs farther than (km))", "Choose Auto-assign under What should this rule do?", "Click Yes, auto-assign to confirm", "Tick Turn this rule on right away and click Create rule"],
        note: "Auto-assigned {jobs} get an A badge. The {worker} still has to accept, and you can reassign by hand.",
      },
      {
        q: "How do I share new jobs evenly between technicians?",
        steps: ["Open Settings → Automation & AI tab", "Click the Round-robin template", "Pick Rotate among and other options", "Choose Suggest or Auto-assign", "Click Create rule"],
      },
      {
        q: "How do I get alerted when an urgent job comes in?",
        steps: ["Open Settings → Automation & AI tab", "Click Urgent job → alert the office", "Pick the priorities and Alert text", "Tick Turn this rule on right away", "Click Create rule"],
      },
      {
        q: "How do I stop a rule from assigning jobs on its own?",
        steps: ["Open Settings → Automation & AI tab", "On the rule in Your rules, click Auto-assigns", "It switches back to Suggests only"],
      },
      {
        q: "How do I turn an automation off?",
        steps: ["Open Settings → Automation & AI tab", "In Your rules, click the rule's switch"],
      },
      {
        q: "How do I build my own rule?",
        steps: ["Open Settings → Automation & AI tab", "Click Custom rule", "Enter a Rule name", "Choose When (trigger) and Then (action)", "Optionally set Only when priority is and the Message", "Click Create rule"],
        note: "Custom rules are created on and in Suggest mode.",
      },
      {
        q: "How do I delete an automation?",
        steps: ["Open Settings → Automation & AI tab", "Click the bin on the rule", "Click Delete"],
      },
    ],
    fixes: [
      {
        problem: "A rule isn't assigning anyone",
        fix: "Rules start in Suggest mode: they tell the office who they'd pick. Switch the rule to Auto-assigns, and check its switch is on.",
      },
      {
        problem: "Template rule did nothing after I created it",
        fix: "Template rules are created off unless you tick Turn this rule on right away. Turn on its switch in Your rules.",
      },
      {
        problem: "\"No service zones yet\" in Zone owner",
        fix: "Draw service zones first (Sidebar → Setup → Service Zones), then set an owner per zone.",
      },
      {
        problem: "\"Add technicians under Team first.\"",
        fix: "The rule needs {workers} to pick from. Add them, then reopen the rule.",
      },
    ],
    keywords: ["automation", "auto assign", "auto-dispatch", "round robin", "nearest tech", "rules", "workflow", "alerts", "after hours", "thank you text"],
  },
  {
    id: "office-web.setup.automation-template-dialog",
    title: "Automation template setup dialog",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Automation & AI tab → click a template (or the pencil on a rule)",
    route: "/admin/settings?section=automation",
    permission: "automation:edit",
    summary: "Sets up or edits a rule made from a template: its name, the template's knobs, Suggest vs Auto-assign for assignment rules, and whether it's on.",
    controls: [
      { label: "Rule name", does: "Name shown in Your rules." },
      { label: "Template knobs", does: "Options for that template, e.g. Only for jobs with priority, Only for jobs needing this skill class, Technician must match the job's skill class, Ignore techs farther than (km), Rotate among, Who owns each zone, Warn when the appointment is within (minutes), After how many idle minutes, Business day starts/ends at, Text when running late by more than (minutes), Text message." },
      { label: "Suggest", does: "Tell the office who it would pick; a person assigns." },
      { label: "Auto-assign", does: "Dispatch the {job} itself and mark it with an A. Asks for confirmation (Turn on auto-assign?)." },
      { label: "Keep suggesting / Yes, auto-assign", does: "Buttons in the auto-assign confirmation." },
      { label: "Turn this rule on right away", does: "Creates the rule switched on." },
      { label: "Create rule / Save changes", does: "Saves the rule." },
    ],
    tasks: [
      {
        q: "How do I change the text a running-late automation sends?",
        steps: ["Open Settings → Automation & AI tab", "Click the pencil on the Running late rule", "Edit Text message (you can use {{customerName}}, {{techName}}, {{minutesLate}}, {{jobName}}, {{trackUrl}})", "Click Save changes"],
      },
      {
        q: "How do I set our business hours for after-hours routing?",
        steps: ["Open the After-hours routing template", "Set Business day starts at and Business day ends at (hours 0–23)", "Click Create rule or Save changes"],
      },
    ],
    keywords: ["automation template", "auto-assign warning"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → Integrations                                              */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.integrations",
    title: "Integrations",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Integrations tab",
    route: "/admin/settings?section=integrations",
    permission: "integrations:edit",
    summary:
      "Connect outside tools with one-click sign-in (no API keys): QuickBooks and Xero (accounting), Gmail and Outlook (email), Google Calendar, Google Drive, OneDrive, Dropbox and CompanyCam. Each card shows Live, Error or Soon.",
    controls: [
      { label: "Connect", does: "Opens the provider's sign-in window to authorize the connection." },
      { label: "Coming soon", does: "The provider isn't enabled yet; explains it's being set up." },
      { label: "Reconnect", does: "Shown on an Error card; re-authorizes the connection." },
      { label: "Sync", does: "On a connected card, refreshes the connection to prove it's live and updates the Synced time." },
      { label: "Settings (QuickBooks card)", does: "Opens QuickBooks sync settings. A number shows open issues." },
      { label: "Export data (Google Drive card)", does: "Opens Back up to Google Drive." },
      { label: "Disconnect <name> (unlink icon)", does: "Disconnects the tool and clears its saved access." },
    ],
    tasks: [
      {
        q: "How do I connect QuickBooks?",
        steps: ["Open Settings → Integrations tab", "On the QuickBooks card, click Connect", "Sign in to Intuit in the window and choose your company", "Wait for the card to show Live"],
        note: "If the card says to ask ArrivePing to switch on QuickBooks sync, it's connected but sync isn't enabled for your account yet.",
      },
      {
        q: "How do I connect Google Drive for backups?",
        steps: ["Open Settings → Integrations tab", "On Google Drive, click Connect", "Authorize in the Google window", "Click Export data on the card"],
      },
      {
        q: "How do I disconnect an integration?",
        steps: ["Open Settings → Integrations tab", "On the connected card, click the unlink icon"],
      },
      {
        q: "An integration shows Error. How do I fix it?",
        steps: ["Open Settings → Integrations tab", "Click Reconnect on that card", "Authorize again in the window"],
      },
      {
        q: "How do I check a connection is still working?",
        steps: ["Open Settings → Integrations tab", "Click Sync on the card", "Check the Synced time updates"],
      },
    ],
    fixes: [
      {
        problem: "Card shows Error",
        fix: "The saved access stopped working (for example a refresh failed). Click Reconnect and authorize again.",
      },
      {
        problem: "\"QuickBooks needs to be reconnected.\"",
        fix: "QuickBooks revoked or expired the connection. Click Reconnect and sign in to Intuit again; retrying Sync won't clear it.",
      },
      {
        problem: "\"Connected. Ask ArrivePing to switch on QuickBooks sync for your account.\"",
        fix: "QuickBooks sync is switched off for your company. Contact ArrivePing to turn it on.",
      },
      {
        problem: "\"Available soon — your admin is finishing setup for this tool.\"",
        fix: "That provider isn't enabled on ArrivePing yet. Contact your account admin or ArrivePing.",
      },
      {
        problem: "Nothing happens when I click Connect",
        fix: "The sign-in opens in a pop-up window. Allow pop-ups for ArrivePing and try again.",
      },
    ],
    keywords: ["integrations", "connect", "quickbooks", "xero", "gmail", "outlook", "google calendar", "google drive", "onedrive", "dropbox", "companycam", "oauth"],
  },
  {
    id: "office-web.setup.quickbooks-settings",
    title: "QuickBooks sync settings",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Integrations tab → QuickBooks card → Settings",
    route: "/admin/settings?section=integrations",
    permission: "integrations:edit",
    summary:
      "How ArrivePing writes {worker} paperwork to QuickBooks: a purchase order to the {worker}'s vendor when a {job} is assigned or accepted, a bill linked to it when the {job} completes (or the subcontractor's own bill), and removal of the PO if the {job} is cancelled or reassigned with nothing billed. Changes save as you make them.",
    controls: [
      { label: "Settings / Mappings / Issues tabs", does: "Switch sections. Issues shows a count of open issues." },
      { label: "ArrivePing creates the bill when the job completes", does: "A bill for the {worker}'s pay is linked to the purchase order; your bookkeeper reviews and pays it in QuickBooks." },
      { label: "Subcontractors send their own invoices; we only track them", does: "ArrivePing sends only the purchase order; the {job} follows the bill your bookkeeper enters against it." },
      { label: "Shadow mode", does: "Logs what would be sent without writing anything to QuickBooks. Turn off to go live." },
      { label: "Purchase tax code", does: "Applied to every line (e.g. GST)." },
      { label: "Default item", does: "QuickBooks item used for templates with no mapping." },
      { label: "Parent customer", does: "New customers are filed under it; None (top level) to skip." },
      { label: "Sync jobs scheduled from", does: "Only {jobs} scheduled on or after this date are sent. Earlier ones stay with the bookkeeper." },
      { label: "Technicians → QuickBooks vendors", does: "Map each {worker} to a QuickBooks vendor. Unmapped ones are matched by exact name, then created as vendors." },
      { label: "Job templates → QuickBooks items", does: "Map each job template to the item (cost code) it's billed under. Unmapped templates use the Default item." },
      { label: "Search", does: "Filters a mapping list by name." },
      { label: "Resolve", does: "Marks an issue as dealt with." },
      { label: "job (link on an issue)", does: "Opens the {job} the issue is about." },
    ],
    tasks: [
      {
        q: "How do I test QuickBooks sync without writing anything?",
        steps: ["Open the QuickBooks card → Settings", "Tick Shadow mode", "Check the Issues tab for what would have been sent"],
      },
      {
        q: "How do I make QuickBooks sync go live?",
        steps: ["Open the QuickBooks card → Settings", "Set Purchase tax code and Default item", "Set Sync jobs scheduled from", "Untick Shadow mode"],
      },
      {
        q: "How do I match a technician to their QuickBooks vendor?",
        steps: ["Open the QuickBooks card → Settings", "Click the Mappings tab", "Find the {worker} under Technicians → QuickBooks vendors", "Pick the vendor in the dropdown"],
      },
      {
        q: "How do I choose which QuickBooks item a job type bills to?",
        steps: ["Open the QuickBooks card → Settings → Mappings", "Under Job templates → QuickBooks items, pick an item for the template"],
      },
      {
        q: "Who creates the subcontractor's bill?",
        steps: ["Open the QuickBooks card → Settings", "Choose ArrivePing creates the bill… or Subcontractors send their own invoices…"],
      },
      {
        q: "How do I see what the QuickBooks sync couldn't do?",
        steps: ["Open the QuickBooks card → Settings", "Click the Issues tab", "Read each issue, open the job if needed, fix it", "Click Resolve"],
      },
    ],
    fixes: [
      { problem: "Issue \"Which vendor?\" or \"Which customer?\"", fix: "More than one QuickBooks record matched. Map the {worker} on the Mappings tab (or fix the customer in QuickBooks), then Resolve." },
      { problem: "Issue \"No item mapped\"", fix: "The job template has no QuickBooks item and there's no Default item. Map the template on Mappings or set a Default item." },
      { problem: "Issue \"QuickBooks refused\"", fix: "QuickBooks rejected the document; the message says why. Fix it in ArrivePing or QuickBooks, then Resolve." },
      { problem: "Issue \"Nothing to price yet\"", fix: "The {job} had no pay to put on the purchase order at assignment; it's created when the {job} completes." },
      { problem: "Issue \"Cancelled job has a bill\" or \"Reassigned job has a bill\"", fix: "The PO already had a bill, so ArrivePing didn't delete it. Your bookkeeper decides in QuickBooks." },
      { problem: "Issue \"Different QuickBooks company\"", fix: "The connection now points at a different QuickBooks company than before. Reconnect to the right company." },
      { problem: "Nothing is appearing in QuickBooks", fix: "Check Shadow mode is off and the {job} was scheduled on or after Sync jobs scheduled from. Look at the Issues tab." },
      { problem: "Old jobs aren't being sent", fix: "Jobs scheduled before Sync jobs scheduled from are never sent; that's on purpose." },
    ],
    keywords: ["quickbooks", "qbo", "purchase order", "PO", "bill", "vendor", "subcontractor", "tax code", "shadow mode", "accounting sync"],
  },
  {
    id: "office-web.setup.drive-export",
    title: "Back up to Google Drive",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Integrations tab → Google Drive card → Export data",
    route: "/admin/settings?section=integrations",
    permission: "integrations:edit",
    summary: "Exports a dataset ({jobs}, {customers}, {workers} or invoices) as Excel or CSV into your connected Google Drive, organized in folders.",
    controls: [
      { label: "What to back up", does: "Choose {jobs}, {customers}, {workers} or Invoices." },
      { label: "Excel (.xlsx) / CSV (.csv)", does: "File format." },
      { label: "Saves to / Change", does: "Shows the destination folder path; Change opens folder settings." },
      { label: "Main folder name", does: "Top folder in Drive. Default ArrivePing Backups." },
      { label: "Sort into a subfolder per data type", does: "Adds a subfolder per dataset." },
      { label: "Add a month subfolder", does: "Adds a YYYY-MM subfolder." },
      { label: "Save folder settings", does: "Saves the folder choices." },
      { label: "Back up now", does: "Runs the export." },
      { label: "Open folder in Google Drive / Open file / Done", does: "Shown after a successful backup." },
      { label: "Reconnect Google Drive", does: "Shown when Drive access expired." },
    ],
    tasks: [
      {
        q: "How do I back up our jobs to Google Drive?",
        steps: ["Open Settings → Integrations tab", "On Google Drive, click Export data", "Choose What to back up and a file format", "Click Back up now", "Click Open file or Open folder in Google Drive"],
      },
      {
        q: "How do I change the Drive folder backups go to?",
        steps: ["Open Back up to Google Drive", "Click Change next to Saves to", "Edit Main folder name and subfolder options", "Click Save folder settings"],
      },
    ],
    fixes: [
      { problem: "\"Google Drive access expired — click Reconnect and re-authorize…\"", fix: "Click Reconnect Google Drive and authorize again." },
      { problem: "\"Google Drive is not connected.\"", fix: "Connect Google Drive on the Integrations tab first." },
      { problem: "\"Something went wrong reaching the server.\"", fix: "A temporary network problem. Try again in a moment." },
    ],
    keywords: ["google drive", "backup", "export to drive"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → API & MCP                                                 */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.api-access",
    title: "API & MCP",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → API & MCP tab",
    route: "/admin/settings?section=api",
    permission: "admin",
    summary:
      "Issue API keys and connect external agents (Claude Code and other MCP clients). Secret keys (nvc_…) give scoped REST/MCP access; publishable keys (nvcpub_…) are browser-safe for hosted intake forms only.",
    controls: [
      { label: "New API key", does: "Opens Create API key." },
      { label: "MCP server URL (Copy)", does: "The URL to point an MCP client at." },
      { label: "Copy command", does: "Copies the Claude Code CLI command to add ArrivePing as an MCP server." },
      { label: "Copy JSON", does: "Copies a Claude Desktop config snippet." },
      { label: "Key type: Secret key / Publishable key", does: "Chooses the key kind in Create API key." },
      { label: "Label", does: "A name for the key." },
      { label: "Expiry (optional)", does: "Days until the key auto-expires; blank for no expiry." },
      { label: "Allowed website origins (optional)", does: "Publishable keys only: sites allowed to embed the form; blank allows any." },
      { label: "Scopes (Select all / Clear)", does: "Secret keys only: what the key may do." },
      { label: "Generate key", does: "Creates the key and shows it once." },
      { label: "Copy key / Done", does: "In API key created: copy the key now; it is never shown again." },
      { label: "Revoke", does: "Stops a key working immediately (can't be undone)." },
      { label: "Delete", does: "Permanently removes a key." },
      { label: "Customer intake forms → Open", does: "Goes to Intake Forms." },
    ],
    tasks: [
      {
        q: "How do I create a key for our website intake form?",
        steps: ["Open Settings → API & MCP tab", "Click New API key", "Choose Publishable key", "Enter a Label and optional Allowed website origins", "Click Generate key", "Click Copy key"],
      },
      {
        q: "How do I connect Claude Code to ArrivePing?",
        steps: ["Open Settings → API & MCP tab", "Click Copy command under Claude Code (CLI)", "Replace nvc_YOUR_KEY_HERE with a secret API key", "Run the command"],
        note: "Secret keys can only be created by ArrivePing superadmins.",
      },
      {
        q: "How do I turn off an API key?",
        steps: ["Open Settings → API & MCP tab", "Click Revoke on the key", "Confirm Revoke"],
      },
      {
        q: "I lost an API key. Can I see it again?",
        steps: ["Create a new key with New API key", "Revoke the old one"],
        note: "Keys are shown only once, when created.",
      },
    ],
    fixes: [
      {
        problem: "\"Only a superadmin can create secret API keys.\"",
        fix: "Company admins can create publishable keys only. Ask ArrivePing for a secret key.",
      },
      {
        problem: "\"Only a superadmin can revoke secret keys.\" / \"…delete secret keys.\"",
        fix: "Secret keys are managed by ArrivePing. Contact support.",
      },
      {
        problem: "Generate key is greyed out",
        fix: "Enter a Label, and for a secret key tick at least one scope.",
      },
      {
        problem: "Key shows Expired or Revoked",
        fix: "It no longer works. Create a new key.",
      },
    ],
    keywords: ["api key", "mcp", "claude code", "developer", "publishable key", "secret key", "integration api", "webhook token"],
  },

  /* ------------------------------------------------------------------ */
  /* Settings → Audit Log                                                 */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.audit-log",
    title: "Audit Log",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Settings → Audit Log tab",
    route: "/admin/settings?section=audit",
    permission: "audit:view",
    summary:
      "Every administrative action, timestamped: who did it, what they did and to what. Shows the latest 300 entries and refreshes every 15 seconds. Entries done by ArrivePing support signed in as someone are marked.",
    controls: [
      { label: "Filter chips (all, and each record type)", does: "Shows only entries for one kind of record." },
      { label: "Entry", does: "Who (or System), what they did, the record type and the time." },
      { label: "by ArrivePing support (name)", does: "Marks an action taken by ArrivePing support while signed in as one of your team." },
    ],
    tasks: [
      {
        q: "How do I find who changed something?",
        steps: ["Open Settings → Audit Log tab", "Click the chip for the kind of record", "Read the name at the start of each entry and its time"],
      },
      {
        q: "How do I see who changed someone's permissions?",
        steps: ["Open Settings → Audit Log tab", "Look for the red shield entries (role changes)"],
      },
      {
        q: "How do I see when ArrivePing support accessed our account?",
        steps: ["Open Settings → Audit Log tab", "Look for the orange life-buoy entries and \"by ArrivePing support\" tags"],
      },
    ],
    fixes: [
      { problem: "\"No activity recorded yet.\"", fix: "Nothing has been logged for your company yet." },
      { problem: "Can't find an older change", fix: "The log shows the most recent 300 entries." },
    ],
    keywords: ["audit", "history", "who changed", "activity log", "change log"],
  },

  /* ------------------------------------------------------------------ */
  /* Notifications                                                        */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.notifications",
    title: "Notifications: Notification Rules",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Notification Rules tab",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "The table of who is told what, and how, at each step of a {job}: for each event and each recipient ({customer}, {worker}, Office) switch In-app, Email, SMS and Webhook on or off. Changes save instantly. Also edit message copy, send yourself a test, and add your own milestones.",
    controls: [
      { label: "Notification Rules / Channels / Webhooks / Delivery Log tabs", does: "Switch sections of the Notifications page." },
      { label: "Channel icons (phone, envelope, speech bubble, globe) per recipient", does: "Turn In-app, Email, SMS or Webhook on or off for that recipient on that event. Saves instantly." },
      { label: "Edit (Copy column)", does: "Opens the event's settings: channels and message text per recipient." },
      { label: "Test", does: "Sends this event's texts and emails to you, not to anyone on a {job}." },
      { label: "New milestone", does: "Adds a custom moment of your own (e.g. Water restored, a day-before reminder)." },
      { label: "Your milestones (row name)", does: "Click a custom milestone's name to edit it. Paused ones are marked." },
      { label: "Add your mobile number to get office texts → Save", does: "Shown to admins without a mobile number when Office texts are on; saves your number to your profile." },
    ],
    tasks: [
      {
        q: "How do I turn off a text to customers?",
        steps: ["Open Notifications → Notification Rules", "Find the event row (e.g. Arrived)", "In the {customer} column, click the SMS (speech bubble) icon so it goes dark"],
        note: "Saves instantly.",
      },
      {
        q: "How do I edit the \"on my way\" message?",
        steps: ["Open Notifications → Notification Rules", "On En route (on the way), click Edit", "On the {customer} card, click Edit next to Message text", "Change the text and insert tokens like {{trackUrl}}", "Click Save message"],
      },
      {
        q: "How do I send myself a test of a notification?",
        steps: ["Open Notifications → Notification Rules", "Click Test on the event's row", "Check Your mobile number and Your email", "Click Send test"],
      },
      {
        q: "How do I get emailed when a job is completed?",
        steps: ["Open Notifications → Notification Rules", "On Job completed, click the Email (envelope) icon in the Office column"],
        note: "Office messages go to the company's active admins, managers, dispatchers and project managers.",
      },
      {
        q: "How do I add a day-before reminder?",
        steps: ["Click New milestone", "Name it", "Choose Before the appointment and set 1 days", "Tick who hears about it and write the message", "Click Add milestone"],
      },
      {
        q: "How do I go back to the default message?",
        steps: ["Open the event with Edit", "Click Edit next to Message text", "Click Use default", "Click Save message"],
      },
      {
        q: "Which events can send notifications?",
        steps: ["Open Notifications → Notification Rules", "Read the Event column"],
        note: "Work order created, Tech assigned, Tech accepts, Tech declines, Tech releases an accepted job, En route (on the way), Arrived, Job started, Job completed, Cancelled, Customer requests a change, Change request declined, Appointment rescheduled, Running late, Payment / receipt, plus Your milestones.",
      },
    ],
    fixes: [
      {
        problem: "Office texts never arrive",
        fix: "Office texts go to each office user's own mobile number. Add yours in the yellow \"Add your mobile number\" box, or in your profile.",
      },
      {
        problem: "\"Enter your mobile number with its area code, like (204) 555-0123.\"",
        fix: "The number needs 10–15 digits including area code.",
      },
      {
        problem: "Toggled a channel but nothing goes out",
        fix: "Check the Channels tab: that channel's master switch must be on, and quiet hours may be holding texts or emails overnight. Then check the Delivery Log.",
      },
      {
        problem: "Customer isn't getting texts",
        fix: "The {customer} needs a phone number on the {job}, SMS must be on for that event and recipient, and SMS must be on in Channels. A number that replied STOP is blocked until it texts START.",
      },
    ],
    keywords: ["notifications", "texts", "sms", "emails", "on my way", "en route message", "customer messages", "alerts", "notification rules", "turn off text"],
  },
  {
    id: "office-web.setup.notification-event",
    title: "Notification event settings and message editor",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Notification Rules tab → Edit on an event",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "Side panel for one event with a card per recipient: switch channels, choose a simple or designed email, and edit the message text used for SMS, in-app and simple email. Blank text uses the built-in default (custom milestones send nothing when blank).",
    controls: [
      { label: "In-app / Email / SMS / Webhook (on a recipient card)", does: "Turns that channel on or off for this recipient." },
      { label: "Simple message", does: "Email sends the message text inside your branded email (logo, colours, footer)." },
      { label: "Designed email", does: "Opens the email designer to lay the email out with blocks." },
      { label: "Edit design / Discard design", does: "Edit the designed email, or switch back to the simple message." },
      { label: "Edit (Message text)", does: "Opens Edit message." },
      { label: "Write / Preview tabs", does: "Edit the text, or preview it as SMS, in-app and plain email." },
      { label: "Bold / Italic / Link", does: "Wraps the selected text in formatting." },
      { label: "Insert: token chips", does: "Inserts a live value such as {{firstName}}, {{techName}}, {{trackUrl}}." },
      { label: "Character count / SMS segments", does: "Shown when SMS is on; over 160 characters sends as multiple segments." },
      { label: "Use default (or Clear message)", does: "Resets to the built-in copy (custom milestones: clears the text)." },
      { label: "Save message / Cancel", does: "Saves or discards the text." },
    ],
    tasks: [
      {
        q: "How do I change the text the customer gets when the tech arrives?",
        steps: ["Open Notifications → Notification Rules", "Click Edit on Arrived", "On the {customer} card, click Edit", "Change the text", "Click Save message"],
      },
      {
        q: "How do I preview a message before saving?",
        steps: ["Open the message with Edit", "Click the Preview tab"],
      },
      {
        q: "How do I send a nicer designed email instead of plain text?",
        steps: ["Click Edit on the event", "On the recipient card with Email on, click Designed email", "Build the email and click Save & apply"],
      },
    ],
    fixes: [
      { problem: "\"That didn't save. Try again.\"", fix: "The change didn't reach the server. Try again." },
      { problem: "Text shows as 2 or more SMS segments", fix: "Messages over 160 characters are split. Shorten the text to keep it to one." },
      { problem: "Message text says \"Using default copy\"", fix: "No custom text is saved, so the built-in message is sent. Click Edit to write your own." },
    ],
    keywords: ["edit message", "message template", "sms template", "tokens", "merge fields"],
  },
  {
    id: "office-web.setup.notification-test",
    title: "Test a notification",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Notification Rules tab → Test",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "Sends an event's texts and emails to you only, filled in from your latest {job} (or example details if you have none). The {job} isn't changed and nobody on it is messaged. Quiet hours don't apply to tests; channel master switches do. Every test is logged in the Delivery Log.",
    controls: [
      { label: "You'll get:", does: "Lists the texts and emails this event would send per recipient." },
      { label: "Your mobile number", does: "Where the test texts go. Prefilled from your profile." },
      { label: "Save this number to my profile", does: "Saves the number you typed (only when your profile has none)." },
      { label: "Your email", does: "Where the test emails go." },
      { label: "Send test / Send again", does: "Sends the test and shows each result: sent, failed or not sent, with the reason." },
      { label: "Cancel / Done", does: "Closes the dialog." },
    ],
    tasks: [
      {
        q: "How do I see what customers receive when the tech is on the way?",
        steps: ["Open Notifications → Notification Rules", "Click Test on En route (on the way)", "Confirm your number and email", "Click Send test"],
        note: "Test texts start with [Test for {customer}].",
      },
    ],
    fixes: [
      { problem: "\"Nothing to test yet: this event has no text or email switched on.\"", fix: "Turn on the SMS or Email icon for a recipient on that event, then test again." },
      { problem: "\"Texts are switched off for your company on the Channels tab.\"", fix: "Turn on the SMS master switch in Notifications → Channels and Save settings." },
      { problem: "\"Emails are switched off for your company on the Channels tab.\"", fix: "Turn on the Email master switch in Notifications → Channels and Save settings." },
      { problem: "\"No text is written for the … yet. Choose Edit to write one.\"", fix: "A custom milestone has no message for that recipient. Click Edit and write one." },
      { problem: "\"That's a sample number (555-01xx), so nothing was sent.\"", fix: "Use a real mobile number." },
      { problem: "\"That number can't receive texts.\"", fix: "Use a mobile number with its area code, not a landline." },
      { problem: "\"This number replied STOP earlier, so texts to it are blocked.\"", fix: "Text START to the sending number to allow texts again." },
      { problem: "\"Texting isn't set up on this server yet.\" or \"Texts to that country aren't allowed yet.\"", fix: "Contact ArrivePing support." },
    ],
    keywords: ["test text", "test email", "send test", "preview notification"],
  },
  {
    id: "office-web.setup.custom-milestone",
    title: "New milestone / Edit milestone",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Notification Rules tab → New milestone",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "A notification moment of your own next to the built-in events. It goes out once per {job}. Up to 50 per company. After saving, set its channels, a designed email or a test in the rules table.",
    controls: [
      { label: "Name", does: "What the milestone is called (up to 60 characters)." },
      { label: "What sets it off: A stage / A checklist item / Before the appointment / After the job is done", does: "The trigger. A stage picks a step like arrived or completed; a checklist item waits for the {worker} to tick that item; before/after take a time." },
      { label: "When", does: "The stage, for A stage." },
      { label: "Checklist item", does: "The item's wording as on your job templates (capitals and extra spaces don't matter)." },
      { label: "How long / Unit (minutes, hours, days)", does: "The offset for before/after triggers (at least 5 minutes, at most 30 days)." },
      { label: "Who hears about it (checkbox per recipient)", does: "{customer} by text and in the app; {worker} in the app; Office (office admins) in the app. Each needs a message." },
      { label: "Insert: token chips", does: "Insert live values into the message." },
      { label: "Show it on the {customer}'s tracking page", does: "Adds a line to the {job}'s timeline under the milestone's name." },
      { label: "On", does: "Edit only: untick to pause the milestone without losing its messages." },
      { label: "Add milestone / Save changes / Cancel / Delete", does: "Save, close or delete. Deleting keeps lines already added to job timelines." },
    ],
    tasks: [
      {
        q: "How do I tell the customer when a checklist item is done (e.g. water restored)?",
        steps: ["Click New milestone", "Name it Water restored", "Choose A checklist item and type the item", "Tick the {customer} and write the message", "Click Add milestone"],
      },
      {
        q: "How do I send a follow-up a few days after a job?",
        steps: ["Click New milestone", "Choose After the job is done", "Set How long and Unit (e.g. 3 days)", "Tick the {customer} and write the message", "Click Add milestone"],
      },
      {
        q: "How do I pause a custom milestone?",
        steps: ["Click the milestone's name in Your milestones", "Untick On", "Click Save changes"],
      },
    ],
    fixes: [
      { problem: "\"Give the milestone a name.\"", fix: "Enter a Name." },
      { problem: "\"Type the checklist item it waits for.\"", fix: "For A checklist item, type the item wording." },
      { problem: "\"Make it at least 5 minutes.\" / \"Keep it within 30 days.\"", fix: "Set the time between 5 minutes and 30 days." },
      { problem: "\"Write the message for the …, or untick them.\"", fix: "Every ticked recipient needs a message (or a designed email)." },
      { problem: "\"You can have up to 50 custom milestones.\"", fix: "Delete one you no longer need first." },
    ],
    keywords: ["custom notification", "milestone", "reminder", "day before reminder", "follow up text", "checklist notification"],
  },
  {
    id: "office-web.setup.notification-channels",
    title: "Notifications: Channels",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Channels tab",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "Company-wide delivery settings that apply on top of every rule: master switches for In-app, Email, SMS and Webhooks, the email sender and sending domains, the email look, default email and SMS bodies, the SMS sender, and quiet hours.",
    controls: [
      { label: "Channel master switches: In-app / Email / SMS / Webhooks", does: "Turns a channel off for the whole company, whatever the rules say." },
      { label: "From name / From address / Reply-to / Footer line", does: "The email sender identity. Recipients will see shows the actual From line." },
      { label: "Add domain", does: "Submits a domain you own so emails can come from your own address. Once approved, DNS records appear to add at your registrar." },
      { label: "Check verification", does: "Re-checks a domain's DNS records." },
      { label: "Remove (domain)", does: "Removes a sending domain." },
      { label: "Copy Name / Copy Value", does: "Copies a DNS record field." },
      { label: "Send test email", does: "Saves current settings, then sends a test from this sender identity to the address you type." },
      { label: "Edit the email theme", does: "Opens the email theme editor (logo, colours, font, buttons, header, footer) used by every email." },
      { label: "Email body template", does: "Default body for emails; per-event copy in Rules overrides it. Insert token chips." },
      { label: "From number / Sender ID", does: "The SMS sender number and, where supported, an alphanumeric sender name." },
      { label: "SMS body template", does: "Default SMS body." },
      { label: "Quiet hours (toggle), Start, End, Channels affected", does: "Suppresses the chosen channels between Start and End in the company timezone." },
      { label: "Save settings", does: "Saves the Channels tab." },
    ],
    tasks: [
      {
        q: "How do I stop all texts for a while?",
        steps: ["Open Notifications → Channels", "Turn off the SMS master switch", "Click Save settings"],
      },
      {
        q: "How do I stop texts going out overnight?",
        steps: ["Open Notifications → Channels", "Turn on Quiet hours", "Set Start and End", "Under Channels affected, select SMS (and Email if wanted)", "Click Save settings"],
        note: "Messages in quiet hours are not sent later; that channel is skipped for events in the window.",
      },
      {
        q: "How do I make emails come from our own address?",
        steps: ["Open Notifications → Channels", "Set From name and From address", "Under Sending domains, type your domain and click Add domain", "After approval, add the DNS records shown at your registrar", "Click Check verification", "Click Save settings"],
      },
      {
        q: "Where do customer replies to our emails go?",
        steps: ["Open Notifications → Channels", "Set Reply-to", "Click Save settings"],
      },
      {
        q: "How do I send a test email from our sender?",
        steps: ["Open Notifications → Channels", "Under Send a test, type an address", "Click Send test email"],
      },
      {
        q: "How do I change the logo and colours on our emails?",
        steps: ["Open Notifications → Channels", "In Email look, click Edit the email theme", "Change logo, colours and fonts", "Click Save theme"],
      },
    ],
    fixes: [
      {
        problem: "Emails show \"<Name> via ArrivePing\" instead of our address",
        fix: "Your From address's domain isn't verified. Add it under Sending domains and complete DNS. Until then replies still go to your From address.",
      },
      {
        problem: "\"… is a public mailbox provider, so it can't be verified\"",
        fix: "Gmail, iCloud, Outlook and similar can't be verified. Leave it as the From or Reply-to address; emails go out \"via ArrivePing\" with replies to you. Use a domain you own to send as yourself.",
      },
      {
        problem: "Domain stuck on Pending approval",
        fix: "It is waiting for an administrator to approve and generate DNS records. They will appear on the domain when ready.",
      },
      {
        problem: "Domain shows Failed or Verifying DNS…",
        fix: "Check the DNS records exactly match, then click Check verification. DNS usually takes 5–30 minutes, up to 24 hours.",
      },
      {
        problem: "\"Email is disabled or no API key — enable email + configure Resend first.\"",
        fix: "Turn on the Email master switch and Save settings. If it persists, email isn't set up on the server; contact ArrivePing.",
      },
      {
        problem: "\"Send failed — usually means the From domain isn't verified in Resend.\"",
        fix: "Verify the From domain under Sending domains, or clear the From address to use the ArrivePing sender.",
      },
      {
        problem: "\"Email service not configured\"",
        fix: "Email sending isn't set up on ArrivePing's server. Contact ArrivePing support.",
      },
      {
        problem: "Texts aren't sending at night",
        fix: "Quiet hours are on and SMS is under Channels affected.",
      },
    ],
    keywords: ["sms sender", "email sender", "from address", "reply-to", "domain verification", "dns", "quiet hours", "master switch", "email theme", "turn off all texts"],
  },
  {
    id: "office-web.setup.email-designer",
    title: "Email designer and email theme",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Notification Rules → Edit on an event → Designed email (or Channels → Edit the email theme)",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary:
      "Full-screen editor for a branded notification email built from blocks, with a theme (logo, colours, font, buttons, header, footer) shared by every email the company sends.",
    controls: [
      { label: "Block palette", does: "Click to add below the selected block, or drag onto the email: heading, text, button, image, details, ETA, technician card, callout, columns, social, divider, spacer." },
      { label: "Block / Email / Theme tabs", does: "Edit the selected block, the email (subject, preview text, templates, AI draft, test), or the theme." },
      { label: "Undo / Redo", does: "Ctrl+Z / Ctrl+Shift+Z." },
      { label: "Edit / Preview", does: "Edit mode, or the exact email inboxes receive with sample job details." },
      { label: "Desktop / Phone", does: "Screen size of the preview." },
      { label: "Subject line / Preview text", does: "Email subject (keep under about 60 characters) and the grey inbox preview line." },
      { label: "Templates / Save as template", does: "Start from a saved layout, or save this one for other notifications." },
      { label: "Describe it → Draft the email", does: "AI drafts the email from your description; replaces current blocks (Undo brings them back)." },
      { label: "Send a test → Send", does: "Sends this email with sample details and your unsaved changes; subject starts with [TEST]." },
      { label: "Theme: Logo, Logo position, Header, Brand colour, Layout, Background colour, Font, Headings, Corners, Buttons, Text colour, Company footer", does: "The shared look of all company emails." },
      { label: "Save & apply / Save theme", does: "Saves the email and the theme." },
      { label: "Restore them / Discard", does: "Recover or drop unsaved changes from an earlier session." },
    ],
    tasks: [
      {
        q: "How do I design the email customers get when the tech is on the way?",
        steps: ["Open Notifications → Notification Rules", "Click Edit on En route (on the way)", "On the {customer} card, click Designed email", "Add blocks such as ETA, technician card and a button", "Set the Subject line on the Email tab", "Click Save & apply"],
      },
      {
        q: "How do I have AI write an email for me?",
        steps: ["Open the email designer", "Click the Email tab", "Under Describe it, describe the email", "Click Draft the email", "Edit and click Save & apply"],
      },
    ],
    fixes: [
      { problem: "\"The theme didn't save. Check the colours and links, then try again.\"", fix: "A colour or link value is invalid. Fix it and click Save again." },
      { problem: "\"Gmail and Outlook can't show SVG images. Upload a PNG or JPG instead.\"", fix: "Upload the email logo as PNG or JPG (max 4MB)." },
      { problem: "\"Email sending isn't set up on this server.\"", fix: "Contact ArrivePing support." },
    ],
    keywords: ["email template", "email builder", "html email", "branded email", "email theme"],
  },
  {
    id: "office-web.setup.notification-webhooks",
    title: "Notifications: Webhooks",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Webhooks tab",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary: "POST endpoints (Zapier, Make, your CRM, Slack relays) that receive event payloads when the Webhook channel is on for an event.",
    controls: [
      { label: "Add webhook", does: "Opens the Add webhook form." },
      { label: "Label / POST URL / Secret (sent as X-Webhook-Secret) / Events", does: "Webhook details. Events is comma-separated event keys, or * for all." },
      { label: "Test", does: "Sends a test POST and shows Test OK (HTTP status) or Test failed." },
      { label: "Active / Paused", does: "Pauses or resumes the webhook." },
      { label: "Delete (bin)", does: "Deletes the webhook after a confirm." },
    ],
    tasks: [
      {
        q: "How do I send job events to Zapier?",
        steps: ["Open Notifications → Webhooks", "Click Add webhook", "Paste the Zapier URL into POST URL", "Leave Events as * or list events", "Click Add webhook", "Click Test"],
        note: "The Webhook channel must also be on for those events in Notification Rules and in Channels.",
      },
      {
        q: "How do I pause a webhook without deleting it?",
        steps: ["Open Notifications → Webhooks", "Click Active on the webhook so it shows Paused"],
      },
      {
        q: "How do I check a webhook endpoint works?",
        steps: ["Open Notifications → Webhooks", "Click Test on the webhook", "Read the Test OK or Test failed line"],
      },
      {
        q: "How do I remove a webhook?",
        steps: ["Open Notifications → Webhooks", "Click the bin on the webhook", "Confirm the delete"],
      },
    ],
    fixes: [
      { problem: "Test failed", fix: "The endpoint didn't accept the request. Check the POST URL and that the receiving service is on." },
      { problem: "Webhook gets nothing", fix: "Check it's Active, the Webhooks master switch is on in Channels, and the Webhook icon is on for the event in Notification Rules." },
    ],
    keywords: ["webhook", "zapier", "make", "integromat", "crm", "slack"],
  },
  {
    id: "office-web.setup.notification-delivery-log",
    title: "Notifications: Delivery Log",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin"],
    path: "Sidebar → Setup → Notifications → Delivery Log tab",
    route: "/admin/notifications",
    permission: "notifications:edit",
    summary: "The latest 200 notifications sent, skipped or failed: when, event, recipient, channel, target and status. Refreshes every 5 seconds. Tests are included.",
    controls: [
      { label: "When / Event / To / Channel / Target / Status", does: "Columns of each delivery. Status is sent, skipped or failed." },
    ],
    tasks: [
      {
        q: "How do I check if a customer's text was sent?",
        steps: ["Open Notifications → Delivery Log", "Find the event and time", "Check Target (the number) and Status"],
      },
      {
        q: "Did my test go out?",
        steps: ["Send a test from Notification Rules → Test", "Open Notifications → Delivery Log", "Find the event at the top of the list"],
      },
      {
        q: "A customer says they got no text. What do I check?",
        steps: ["Open Notifications → Delivery Log", "Look for the event and the {customer}'s number", "If there's no row, check the event's SMS icon in Notification Rules and the SMS master switch in Channels"],
        note: "Texts skipped by a master switch, quiet hours or a missing phone number leave no row in the log.",
      },
    ],
    fixes: [
      { problem: "Status says skipped", fix: "Not sent, for example because texting isn't configured. Check Channels and the event's rules." },
      { problem: "Status says failed", fix: "The provider rejected it, often a wrong or landline number. Check the {customer}'s phone number." },
      { problem: "\"No deliveries yet. Fire a test from the Rules tab.\"", fix: "Nothing has been sent yet. Use Test on an event." },
    ],
    keywords: ["delivery log", "message log", "was text sent", "sms history"],
  },

  /* ------------------------------------------------------------------ */
  /* Reports                                                              */
  /* ------------------------------------------------------------------ */
  {
    id: "office-web.setup.reports",
    title: "Reports & Analytics",
    surface: "office-web",
    platforms: ["web"],
    roles: ["admin", "manager", "dispatcher"],
    path: "Sidebar → Money → Reports",
    route: "/admin/reports",
    permission: "reports:view",
    summary:
      "Eight reports with KPIs, charts and a sortable detail table for a date range, plus raw data exports. Export downloads exactly what's on screen (current filters and sort).",
    controls: [
      { label: "Report list", does: "Revenue & Sales, {worker} Performance, Job Status, Payroll & Payouts, Catalog Margin, Client Activity, Invoices / AR, Zone Breakdown." },
      { label: "7 days / 30 days / 90 days / YTD / 12 mo", does: "Date range presets. Default 90 days." },
      { label: "From / To", does: "Custom date range." },
      { label: "All {workers} (filter)", does: "Limits the report to one {worker}." },
      { label: "Any status (filter)", does: "Limits the report to one {job} status." },
      { label: "Column headers", does: "Click to sort the detail table; click again to reverse." },
      { label: "Export → CSV / Excel (.xlsx) / JSON / PDF", does: "Downloads the current report. Needs the Export permission on Reports." },
      { label: "Raw data exports: {jobs}, {workers}, {customers}, Invoices → csv / xlsx / json / pdf", does: "Full unaggregated tables." },
      { label: "Form answers → Choose a form…, From, To, Export answers (CSV)", does: "Every {job}'s answers for one form template as CSV." },
    ],
    tasks: [
      {
        q: "How do I export a report to Excel?",
        steps: ["Open Reports", "Pick the report and date range", "Click Export", "Choose Excel (.xlsx)"],
      },
      {
        q: "How do I see revenue for last month?",
        steps: ["Open Reports", "Click Revenue & Sales", "Set From and To to last month's dates"],
      },
      {
        q: "How do I see one technician's performance?",
        steps: ["Open Reports", "Click {worker} Performance", "Choose the person in All {workers}"],
      },
      {
        q: "How do I get payroll numbers for my bookkeeper?",
        steps: ["Open Reports", "Click Payroll & Payouts", "Set the pay period with From and To", "Click Export and choose CSV or Excel (.xlsx)"],
      },
      {
        q: "How do I download all our customer records?",
        steps: ["Open Reports", "Scroll to Raw data exports", "On {customers}, click csv or xlsx"],
      },
      {
        q: "How do I export the answers to a job form?",
        steps: ["Open Reports", "Scroll to Raw data exports", "Under Form answers, choose a form and optional dates", "Click Export answers (CSV)"],
      },
      {
        q: "Who is owed money / what's outstanding?",
        steps: ["Open Reports", "Click Invoices / AR"],
      },
    ],
    fixes: [
      {
        problem: "Export button is greyed out",
        fix: "Either the report has no rows in this range, or you don't have the Export permission on Reports (\"Exporting needs the Export permission on Reports. Ask an admin.\").",
      },
      { problem: "\"Export failed. Please try again.\"", fix: "The download didn't complete; try again. The detail under the message gives the server's reason." },
      { problem: "\"No data in this range.\"", fix: "Widen the date range or clear the {worker} and status filters." },
      {
        problem: "Payroll shows No PO yet / PO open / Billed / Paid / Needs attention",
        fix: "Your {workers} are paid through QuickBooks, so payroll follows the QuickBooks paperwork. Needs attention means the sync stopped; see the QuickBooks card's Issues.",
      },
    ],
    keywords: ["reports", "analytics", "export", "csv", "excel", "pdf", "revenue", "payroll", "accounts receivable", "aging", "tech performance", "download data"],
  },
];
