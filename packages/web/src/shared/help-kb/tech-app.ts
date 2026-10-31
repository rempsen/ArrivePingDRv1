/**
 * Technician side of the ArrivePing app (iPhone / Android), its account
 * screens, and the technician pages of the web app.
 *
 * Sources: packages/mobile/app/(rider)/*, app/job/[id].tsx, app/offer/[id].tsx,
 * app/sign-in.tsx, app/index.tsx, app/pick-company.tsx, app/onboarding.tsx,
 * app/calendar-sync.tsx, components/*, lib/* (location, push, photo queue,
 * network), and packages/web/src/web/pages/rider/*.
 */
import type { KbEntry } from "./types";

const MOBILE: KbEntry["platforms"] = ["ios", "android"];
const TECH: KbEntry["roles"] = ["technician"];

export const entries: KbEntry[] = [
  // ───────────────────────────── Account ─────────────────────────────
  {
    id: "account.tech.sign-in",
    title: "Sign in (technician app)",
    surface: "account",
    platforms: MOBILE,
    roles: TECH,
    path: "Open the ArrivePing app when signed out",
    route: "/sign-in",
    summary:
      "Email and password sign-in for the app. After signing in you go to the company picker (skipped if you work for only one company), then to your {jobs}.",
    controls: [
      { label: "Email", does: "Your login email." },
      { label: "Password", does: "Your password. Pressing return on the keyboard also signs in." },
      { label: "Sign in", does: "Signs you in and opens the company picker." },
      { label: "Forgot password?", does: "Opens the ArrivePing forgot-password page in your browser so you can reset it by email." },
    ],
    tasks: [
      {
        q: "How do I sign in to the app?",
        steps: ["Open ArrivePing", "Enter your Email and Password", "Tap Sign in", "If asked, pick the company you're working for today"],
        note: "Use the email your company invited you with.",
      },
      {
        q: "I forgot my password. How do I reset it?",
        steps: ["On the sign-in screen tap Forgot password?", "Enter your email on the page that opens in your browser", "Follow the link in the email", "Come back to the app and sign in with the new password"],
      },
      {
        q: "Where do I get an account?",
        steps: ["Ask your dispatcher or office to invite you as a {worker}", "Accept the invite (email, or in the app's company picker)", "Sign in"],
      },
      {
        q: "How do I sign out?",
        steps: ["Go to the Profile tab", "Tap Sign out", "Tap Sign out again to confirm"],
      },
    ],
    fixes: [
      { problem: "\"Enter your email and password\"", fix: "One of the fields is empty. Fill in both and tap Sign in." },
      { problem: "Sign-in fails with an error message", fix: "The message comes from the server (usually a wrong email or password). Check for typos, or tap Forgot password? to reset it." },
      { problem: "\"Something went wrong\" when signing in", fix: "The app couldn't reach ArrivePing. Check your signal or Wi-Fi and try again." },
      { problem: "\"You've been signed out — sign in again.\"", fix: "Your session expired or was ended. Sign in again from the sign-in screen." },
    ],
    keywords: ["log in", "login", "password reset", "can't sign in"],
  },
  {
    id: "account.tech.app-lock",
    title: "Face ID / fingerprint unlock",
    surface: "account",
    platforms: MOBILE,
    roles: TECH,
    path: "Shown when opening the app, once a day, if Face ID / Fingerprint Lock is on",
    route: "/",
    summary:
      "If your phone has Face ID or a fingerprint set up, the app asks you to unlock it once per calendar day. Cancelling doesn't sign you out; it shows a locked screen with a retry button.",
    controls: [
      { label: "Unlock", does: "Shows the Face ID / fingerprint prompt again (\"Unlock ArrivePing\"). You can fall back to the phone's passcode." },
    ],
    tasks: [
      {
        q: "How do I turn off the Face ID / fingerprint lock?",
        steps: ["Go to the Profile tab", "Turn off Face ID / Fingerprint Lock"],
        note: "The switch only appears on phones that have Face ID or a fingerprint enrolled.",
      },
      {
        q: "I cancelled Face ID and now it says ArrivePing is locked",
        steps: ["Tap Unlock", "Look at the phone or touch the sensor, or use your passcode"],
      },
    ],
    fixes: [
      { problem: "\"ArrivePing is locked\" screen", fix: "The unlock prompt was cancelled or failed. Tap Unlock to try again; you're still signed in." },
      { problem: "The app asks for Face ID again after signing out and back in", fix: "Signing out clears today's unlock, so the next sign-in on that phone always asks once." },
    ],
    keywords: ["biometric", "touch id", "fingerprint", "face id", "locked"],
  },
  {
    id: "account.tech.pick-company",
    title: "Who are you working for today? (company picker)",
    surface: "account",
    platforms: MOBILE,
    roles: TECH,
    path: "Shown after sign-in / unlock when you belong to more than one company or have a pending invitation",
    route: "/pick-company",
    summary:
      "Pick the company whose {jobs} you'll see this shift. Pending invitations from companies can be accepted or declined here. If you're on one company's roster and have no invitations, this screen is skipped.",
    controls: [
      { label: "Company card", does: "Starts your session for that company: you only see its {jobs}. A red border and count mean that company has offers or messages waiting. \"last used\" marks the one you picked last time." },
      { label: "Accept", does: "Accepts the invitation and adds you to that company's roster (\"You're on the roster\")." },
      { label: "Decline", does: "Asks to confirm, then declines the invitation. The company has to invite you again if you change your mind." },
      { label: "Refresh", does: "Reloads your companies and invitations (shown when you're not on any roster yet)." },
      { label: "Try again", does: "Retries loading your companies after an error." },
    ],
    tasks: [
      {
        q: "How do I pick which company I'm working for?",
        steps: ["Sign in", "On Who are you working for today?, tap the company's card"],
        note: "You can switch later from Profile → Working for.",
      },
      {
        q: "How do I accept an invite from a new company?",
        steps: ["Sign in", "Under Invitation, tap Accept on the company's card", "Tap the company to start working for it"],
        note: "No email link is needed; invitations show here.",
      },
      {
        q: "How do I decline a company's invitation?",
        steps: ["Under Invitation, tap Decline", "Tap Decline again to confirm"],
      },
      {
        q: "How do I switch to a different company?",
        steps: ["Go to the Profile tab", "Under Working for, tap the other company", "Tap Switch"],
        note: "Switching takes you off the clock at the old company first.",
      },
    ],
    fixes: [
      { problem: "\"No active company\" — \"You're not on any company's roster yet\"", fix: "You haven't been added to a company, or haven't accepted the invite. Ask your dispatcher to invite you, then tap Refresh." },
      { problem: "\"Can't load your companies\"", fix: "The list couldn't load (usually no signal). Tap Try again." },
      { problem: "\"Couldn't join\" when accepting an invite", fix: "The server refused or the connection dropped. Check your connection and tap Accept again; if it keeps failing, ask the office to resend the invite." },
      { problem: "I'm seeing the wrong company's {jobs}", fix: "You picked a different company for this session. Go to Profile → Working for and tap the right company, then Switch." },
    ],
    keywords: ["wrong company", "switch company", "invitation", "invite", "roster", "multiple employers"],
  },
  {
    id: "account.tech.onboarding",
    title: "Before you get started (permissions primer)",
    surface: "account",
    platforms: MOBILE,
    roles: TECH,
    path: "Shown once per phone, after the first sign-in",
    route: "/onboarding",
    summary:
      "Explains why the app will ask for Location, Notifications and Camera & Photos. It doesn't ask for anything itself; the phone's own prompts come later (going on the clock, first launch of the {jobs} screen, taking a photo).",
    controls: [{ label: "Got it, let's go", does: "Closes the primer and opens your {jobs}. It won't show again on this phone." }],
    tasks: [
      {
        q: "Why does the app need my location?",
        steps: ["Sign in for your shift on the Jobs tab", "Allow location when the phone asks"],
        note: "While you're on the clock your live location goes to dispatch so the {customer} gets an accurate ETA. It stops when you go off the clock.",
      },
      {
        q: "Why does the app need notifications?",
        steps: ["Open your {jobs} after signing in", "Tap Allow when the phone asks about notifications"],
        note: "Notifications tell you the moment a new {job} offer comes in or dispatch or a {customer} messages you.",
      },
    ],
    keywords: ["permissions", "first launch", "setup"],
  },

  // ───────────────────────────── Jobs tab ─────────────────────────────
  {
    id: "tech-app.jobs",
    title: "Jobs",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Bottom tabs → Jobs",
    route: "/(rider)",
    summary:
      "Your day: new offers to accept or decline, {jobs} in progress, and {jobs} up next (soonest first), with today's totals and the big Sign in / Sign out button for your shift.",
    controls: [
      { label: "Sign in / Signed in (shift button)", does: "Red \"Sign in · Off the clock · tap to start\" puts you on the clock (available for offers, location shared). Green \"Signed in · On the clock\" — tap to sign out and go off the clock. Shows \"On the clock · on a job\" while you're busy." },
      { label: "Accept", does: "Accepts the offer on that card; the {job} moves to Up next." },
      { label: "Details", does: "Opens the offer details: drive time, on-site time, your estimated pay and the work." },
      { label: "Decline", does: "Opens the decline sheet, which asks for a reason." },
      { label: "In progress card", does: "Opens a {job} you're driving to or working on." },
      { label: "Up next card", does: "Opens an accepted {job} that hasn't started." },
      { label: "\"… is waiting on you\" banner", does: "Another company you work for has offers or messages. Tap to go to Profile and switch." },
      { label: "Pull down", does: "Refreshes the list, today's totals and badges." },
      { label: "done today / earned today / jobs today", does: "Today's completed count, pay and progress (shown once you have work today)." },
    ],
    tasks: [
      {
        q: "How do I start my shift so I get jobs?",
        steps: ["Open the Jobs tab", "Tap the red Sign in button at the bottom", "Allow location if the phone asks"],
        note: "It turns green. You only get offers, and the office only sees where you are, while it's green.",
      },
      {
        q: "How do I end my shift?",
        steps: ["Open the Jobs tab", "Tap the green Signed in button"],
        note: "Location sharing stops and you stop getting offers.",
      },
      {
        q: "How do I accept a job offer?",
        steps: ["Open the Jobs tab", "Find the card under New offers", "Tap Accept"],
        note: "Tap Details first to see the drive, your pay and the work.",
      },
      {
        q: "How do I decline a job offer?",
        steps: ["Under New offers tap Decline", "Pick a reason", "Tap Decline {job}"],
      },
      {
        q: "How do I see my next job?",
        steps: ["Open the Jobs tab", "Look under Up next (soonest first)", "Tap the card to open it"],
      },
      {
        q: "Where's tomorrow's schedule?",
        steps: ["Open the Jobs tab and look under Up next — accepted {jobs} are listed by scheduled time with their date", "Or turn on Profile → Calendar sync to see them in your phone's calendar"],
        note: "The app has no separate day-by-day schedule view for technicians.",
      },
      {
        q: "How do I see what's waiting at my other company?",
        steps: ["Tap the red \"… is waiting on you\" banner", "Under Working for, tap that company", "Tap Switch"],
      },
    ],
    fixes: [
      { problem: "\"No active jobs\" and I'm expecting work", fix: "Check the shift button is green (Signed in) — you only get offers while on the clock. Pull down to refresh, and check you picked the right company (Profile → Working for)." },
      { problem: "\"Offer no longer open\"", fix: "Dispatch changed the {job} or gave it to someone else before you answered. Nothing to do; it drops off your list." },
      { problem: "\"Couldn't sign in\" / \"Couldn't sign out\" on the shift button", fix: "The change didn't reach the server. Check your connection and tap the button again." },
      { problem: "A card says \"PRACTICE · NOBODY IS TEXTED\"", fix: "It's a practice or sample {job} for trying the app. Nobody is texted and it isn't paid. You can remove the practice {job} from inside it (Remove it)." },
    ],
    keywords: ["home", "today", "job list", "offers", "clock in", "clock out", "go online", "on shift", "availability"],
  },
  {
    id: "tech-app.practice-job",
    title: "Practice job and app tour",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Bottom tabs → Jobs → Practice job (first run); Profile → Show me around again",
    summary:
      "New technicians get a four-tip tour and one practice {job} to try Start Driving, I've Arrived and Complete. A practice {job} never texts anyone and isn't paid.",
    controls: [
      { label: "Next / Done", does: "Moves to the next tip; Done on the last one." },
      { label: "Back", does: "Goes to the previous tip." },
      { label: "Skip tour", does: "Closes the tour." },
      { label: "Remove it", does: "On the practice {job}: asks to confirm (\"Remove the practice job?\"), then deletes it. Your real {jobs} aren't touched." },
      { label: "Show me around again", does: "In Profile: replays the four tips." },
    ],
    tasks: [
      {
        q: "How do I practise before a real job?",
        steps: ["Open the Jobs tab", "Tap Practice job under Up next", "Tap Start Driving, then I've Arrived, then Complete Job"],
        note: "Nobody is texted and it isn't paid.",
      },
      {
        q: "How do I get rid of the practice job?",
        steps: ["Open the practice {job}", "Tap Remove it", "Tap Remove"],
      },
      {
        q: "How do I see the app tips again?",
        steps: ["Go to the Profile tab", "Tap Show me around again"],
      },
    ],
    keywords: ["tutorial", "tour", "coach", "sample job", "training"],
  },

  // ───────────────────────────── Offers ─────────────────────────────
  {
    id: "tech-app.offer",
    title: "New offer (offer details)",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Jobs → New offers → Details (or tap the card, or tap a new-offer notification)",
    route: "/offer/[id]",
    summary:
      "Everything to decide on an offer: when and where, drive time and distance from you, expected time on site, your estimated pay, and the work (description, notes, parts, form or checklist). Accept or decline from the bottom.",
    controls: [
      { label: "Go back", does: "Back arrow; returns to the previous screen." },
      { label: "Drive", does: "Drive time and distance from where you are now (or your last known location)." },
      { label: "On site", does: "Expected time on site — booked by the office, your team's average, or an estimate." },
      { label: "Your pay", does: "Estimated pay for this {job}. \"Not set — ask the office\" means no pay rate is set for you." },
      { label: "Preview route in Maps", does: "Opens the route in Apple Maps (iPhone) or Google Maps (Android)." },
      { label: "Estimated pay", does: "Breakdown: time on site, mileage, per-unit work, flat pay, and the total. Final pay is worked out from your actual time and distance." },
      { label: "The work", does: "Description, notes From dispatch and From the {customer}, Parts and work, the form to fill in or the checklist." },
      { label: "Accept", does: "Accepts the offer and opens the {job}." },
      { label: "Decline", does: "Opens the decline sheet to give a reason." },
      { label: "Open {job}", does: "Shown when you've already accepted; opens the {job}." },
    ],
    tasks: [
      {
        q: "How do I check the pay before I accept?",
        steps: ["Open the offer (Jobs → Details)", "Read Your pay and the Estimated pay card"],
        note: "\"Estimated, at least\" means time or mileage couldn't be estimated, so pay will be more.",
      },
      {
        q: "How far is the job from me?",
        steps: ["Open the offer", "Read the Drive tile and Getting there", "Tap Preview route in Maps for the route"],
      },
      {
        q: "How do I accept from the offer details?",
        steps: ["Open the offer", "Tap Accept"],
        note: "The {job} opens straight after.",
      },
      {
        q: "Can I accept an offer from the notification?",
        steps: ["Long-press or expand the new-offer notification", "Tap Accept"],
        note: "Accept on a notification older than 30 minutes opens the offer instead. Decline on the notification opens the offer with the reason sheet.",
      },
    ],
    fixes: [
      { problem: "Drive says \"Turn on location sharing to see the drive.\"", fix: "The app has no location for you. Sign in for your shift (shift button on Jobs) and allow location." },
      { problem: "\"This address hasn't been placed on the map yet.\"", fix: "The office's address couldn't be located, so no drive is shown. Ask dispatch to check the address." },
      { problem: "\"This offer isn't open to you any more.\" / \"This offer is no longer open.\"", fix: "Dispatch withdrew it or gave it to someone else. Go back to Jobs." },
      { problem: "Your pay shows \"Not set\"", fix: "The company hasn't set a pay rate for you. Ask the office." },
    ],
    keywords: ["job offer", "accept", "pay estimate", "drive time", "assignment"],
  },
  {
    id: "tech-app.offer.decline",
    title: "Decline this {job}? (decline sheet)",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Jobs → New offers → Decline (or offer details → Decline)",
    summary: "Declining always asks why. The {job} goes back to dispatch to offer someone else.",
    controls: [
      { label: "Too far away / Schedule conflict / Not qualified for this job / Vehicle or equipment issue / Personal reason / Other", does: "The reason the office sees. One is required." },
      { label: "Note", does: "Optional note for dispatch (\"What's the reason?\" when Other is picked)." },
      { label: "Decline {job}", does: "Sends the decline. Disabled until a reason is picked." },
      { label: "Go back", does: "Closes the sheet without declining." },
    ],
    tasks: [
      {
        q: "How do I decline a job and tell the office why?",
        steps: ["Tap Decline on the offer", "Pick a reason", "Add a note if useful", "Tap Decline {job}"],
      },
    ],
    keywords: ["reject", "turn down", "decline reason"],
  },

  // ───────────────────────────── Job details ─────────────────────────────
  {
    id: "tech-app.job",
    title: "{job} details",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Jobs → tap a card under In progress or Up next (or tap a {job} notification)",
    route: "/job/[id]",
    summary:
      "Run an accepted {job}: progress (Assigned → En Route → On Site → Done), {customer} contact, navigation, live ETA, on-site clock, notes, form or checklist, photos, sign-off, voice notes, messages, payment, and the main action button at the bottom.",
    controls: [
      { label: "Start Driving", does: "Marks you en route. Starts sharing your live location and ETA with the {customer}; depending on the company's notification settings the {customer} is texted a live tracking link." },
      { label: "I've Arrived", does: "Checks you in on site and starts the on-site clock. Usually happens automatically when you reach the address; tap it if it doesn't." },
      { label: "Complete Job", does: "Shows a summary and asks you to confirm, then completes the {job}. Only appears after you've arrived." },
      { label: "I can't do this {job}", does: "Opens the sheet to send the {job} back to dispatch with a reason." },
      { label: "Call {customer}", does: "Phone icon; calls the {customer}'s number." },
      { label: "Text {customer}", does: "Message icon; opens your phone's Messages app to text the {customer}." },
      { label: "Navigate", does: "Opens directions in Apple Maps (iPhone) or Google Maps (Android)." },
      { label: "Text ETA", does: "While en route: opens Messages with a pre-written \"I'm on the way, about … out\" text to the {customer}." },
      { label: "Resume Clock", does: "When the on-site clock paused because you stepped away from the site, restarts it if you're still on site." },
      { label: "Checklist items", does: "Tap to tick a step done. Items marked Required must be done before you can complete." },
      { label: "Photos", does: "Add before / during / after photos (see Job photos)." },
      { label: "Customer sign-off", does: "Expands the signature pad (see Customer signature)." },
      { label: "Voice note (Record / Stop & send)", does: "Records a voice note for the office (office only); it's transcribed into your field notes. Play or delete past notes below it." },
      { label: "Field Notes to Office", does: "Expands a notes box. Save Note to Office saves it to the {job} record for dispatch and management." },
      { label: "Dispatch", does: "Expands your message thread with dispatch; type in Message dispatch… and tap send." },
      { label: "{customer} Messages", does: "Expands the {customer} thread; type in Message customer… and tap send. The {customer} gets it as a text message." },
      { label: "Take payment", does: "Shown on {jobs} set to collect payment on site, once you've arrived (see Take payment)." },
      { label: "Punch List", does: "Only on {jobs} with synced deficiencies: mark each Open / In progress / Done, add notes and an After photo, and Sign off." },
    ],
    tasks: [
      {
        q: "How do I tell the customer I'm on my way?",
        steps: ["Open the {job} from Jobs", "Tap Start Driving", "Optional: tap Text ETA to text your arrival time"],
      },
      {
        q: "How do I get directions to the job?",
        steps: ["Open the {job}", "Tap Navigate"],
      },
      {
        q: "How do I mark that I've arrived?",
        steps: ["Drive to the address — you're checked in automatically inside the check-in distance", "If not, tap I've Arrived"],
        note: "While en route the screen shows how far you are and the auto check-in distance.",
      },
      {
        q: "How do I call or text the customer?",
        steps: ["Open the {job}", "Tap the phone icon to call or the message icon to text"],
      },
      {
        q: "How do I message the office about this job?",
        steps: ["Open the {job}", "Tap Dispatch to expand it", "Type in Message dispatch…", "Tap the send arrow"],
      },
      {
        q: "How do I leave a note for the office?",
        steps: ["Open the {job}", "Tap Field Notes to Office", "Type the note", "Tap Save Note to Office"],
        note: "Or tap Record under Voice note to dictate; it's transcribed into your field notes.",
      },
      {
        q: "My on-site clock paused but I'm still here",
        steps: ["Open the {job}", "Tap Resume Clock"],
        note: "The clock pauses when your location leaves the site.",
      },
      {
        q: "How do I finish a job?",
        steps: ["Make sure you've arrived (On Site)", "Fill in the form or required checklist steps", "Tap Complete Job", "Check the summary and tap Confirm complete"],
      },
      {
        q: "How do I hand a job back to dispatch?",
        steps: ["Open the {job}", "Tap I can't do this {job}", "Pick a reason", "Tap Send back to dispatch"],
      },
    ],
    fixes: [
      { problem: "\"Dispatch isn't receiving your location.\"", fix: "Three location updates in a row failed. Check your signal and that Location is on for ArrivePing; until then the office and the {customer} see an old position." },
      { problem: "I wasn't checked in automatically", fix: "Check the distance shown under the ETA (\"… from the address · auto check-in inside …\"). If you're there but outside that distance or GPS is off, tap I've Arrived." },
      { problem: "\"Check in on site before completing this job — tap \"I've Arrived\" first.\"", fix: "You can't jump from En Route to Done. Tap I've Arrived, then Complete Job." },
      { problem: "\"Couldn't update this job\" / \"This job has already moved on\"", fix: "The {job} changed on the server (office edit, another device). Tap Refresh job and check its current stage." },
      { problem: "\"This job is already completed. The office can reopen it if something changed.\"", fix: "Only the office can reopen a completed {job}." },
      { problem: "\"No signal — will send the moment you're back online\"", fix: "Your tap was saved and sends automatically when you have signal. Don't tap again." },
      { problem: "\"No phone number\" — \"This customer has no phone number on file.\"", fix: "Ask the office to add the {customer}'s phone number." },
      { problem: "\"Message not sent\"", fix: "Your text is kept in the box. Tap send again when you have signal." },
      { problem: "\"Microphone is turned off\" / \"Microphone access needed\"", fix: "On iPhone tap Open Settings and turn on Microphone for ArrivePing. On Android tap the mic button again and choose Allow." },
      { problem: "\"Update needed\" when recording a voice note", fix: "Voice notes need the latest version of the app. Update from TestFlight or the App Store." },
    ],
    keywords: ["work order", "on my way", "en route", "arrived", "check in", "geofence", "navigate", "ETA", "live activity", "dynamic island", "field notes"],
  },
  {
    id: "tech-app.job.complete",
    title: "Complete a {job}",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "{job} details → Complete Job (after I've Arrived)",
    summary:
      "Complete Job checks the form's required questions and the required checklist steps, shows a summary (time in transit, time on site, mileage, photos, form progress, flagged answers, your pay), and completes the {job} when you tap Confirm complete.",
    controls: [
      { label: "Complete Job", does: "Starts the checks and shows the \"Complete job?\" summary." },
      { label: "Confirm complete", does: "Completes the {job}. You become available again and the {job} shows \"{job} completed · $… earned\"." },
      { label: "Go back", does: "Closes the summary without completing." },
      { label: "Show me", does: "On \"Finish the form first\": scrolls to the first unanswered required question." },
    ],
    tasks: [
      {
        q: "How do I complete a job?",
        steps: ["Tap I've Arrived if you haven't", "Answer required form questions / tick required checklist steps", "Tap Complete Job", "Tap Confirm complete"],
      },
      {
        q: "Why can't I complete the job?",
        steps: ["Read the message that appears", "Tap Show me to jump to the missing form question, or tick the listed Required checklist steps", "Tap Complete Job again"],
      },
    ],
    fixes: [
      { problem: "\"Finish the form first\"", fix: "Required questions are unanswered. Tap Show me, answer them, then tap Complete Job again." },
      { problem: "\"Required steps not done\"", fix: "The listed checklist steps are required. Tick them in Checklist, then tap Complete Job." },
      { problem: "Complete Job isn't showing", fix: "It only appears once you're on site. Tap I've Arrived first." },
      { problem: "Completed with no signal", fix: "The app shows \"No signal — will send the moment you're back online\" and sends it automatically; with a form, your answers send first." },
    ],
    keywords: ["finish job", "close job", "done", "debrief"],
  },
  {
    id: "tech-app.job.photos",
    title: "{job} photos",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "{job} details → Photos",
    summary:
      "Add photos tagged Before, During or After. Every photo is saved on the phone first and stays there until the office has it, so photos taken with no signal upload by themselves later.",
    controls: [
      { label: "Before / During / After", does: "Chooses the tag for the next photo." },
      { label: "Add before photo / Add during photo / Add after photo", does: "Asks Take photo or Choose from library, then uploads it with the chosen tag." },
      { label: "Waiting photo (Uploading… / Waiting to upload / Not uploaded)", does: "Tap for Retry now, Discard or Close." },
    ],
    tasks: [
      {
        q: "How do I add photos to a job?",
        steps: ["Open the {job}", "Under Photos tap Before, During or After", "Tap Add … photo", "Choose Take photo or Choose from library"],
      },
      {
        q: "A photo hasn't uploaded. What do I do?",
        steps: ["Keep working — it uploads by itself when it can", "To push it now, tap the photo and choose Retry now"],
      },
      {
        q: "How do I delete a photo that never uploaded?",
        steps: ["Tap the waiting photo", "Tap Discard", "Tap Discard again to confirm"],
        note: "It hasn't reached the office and will be lost.",
      },
    ],
    fixes: [
      { problem: "\"Photo saved on this phone\"", fix: "It couldn't upload just now. It's kept on the phone and uploads by itself (retrying after 15 s, 30 s, 1 min, 2 min, then every 5 min)." },
      { problem: "\"Photo not uploaded\" — \"there wasn't room to keep it on this phone\"", fix: "The upload failed and the phone had no space to keep a copy. Free up storage and take it again." },
      { problem: "Photo marked \"Not uploaded\" / \"This photo wasn't accepted\"", fix: "The server refused it (for example the {job} was removed or the file was too big). Tap it for the last error; Retry now or Discard." },
      { problem: "\"Camera needed\"", fix: "Camera access is off for ArrivePing. Tap Open Settings and allow Camera. Choosing from the library doesn't need permission." },
      { problem: "\"The photo didn't arrive complete. Try again.\"", fix: "The upload was cut off and the photo is marked Not uploaded. Tap it and choose Retry now." },
    ],
    keywords: ["pictures", "camera", "upload", "before and after", "photo queue"],
  },
  {
    id: "tech-app.job.signature",
    title: "Customer sign-off (signature)",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "{job} details → Customer sign-off",
    summary: "The {customer} signs with a finger on your phone. The signature and printed name are saved to the {job} record.",
    controls: [
      { label: "Customer sign-off", does: "Expands the signature pad. Shows \"signed\" once captured." },
      { label: "Sign here (pad)", does: "Draw the signature with a finger. The page stops scrolling while drawing." },
      { label: "Printed name of person signing", does: "The signer's name." },
      { label: "Clear", does: "Wipes the pad to start again." },
      { label: "Save signature", does: "Saves the sign-off (\"Signed\")." },
      { label: "Delete signature", does: "Asks to confirm, then removes the sign-off so you can capture a new one." },
    ],
    tasks: [
      {
        q: "How do I get the customer's signature?",
        steps: ["Open the {job}", "Tap Customer sign-off", "Hand the phone to the {customer} to sign", "Enter the printed name", "Tap Save signature"],
      },
      {
        q: "How do I redo a signature?",
        steps: ["Under Customer sign-off tap Delete signature", "Tap Delete to confirm", "Tap Customer sign-off and capture it again"],
      },
    ],
    fixes: [
      { problem: "\"Couldn't save signature\"", fix: "It didn't reach the server. Check your signal and tap Save signature again." },
      { problem: "\"Signature too detailed\" (form signature question)", fix: "Tap Clear and sign once more." },
    ],
    keywords: ["sign off", "signature", "customer approval"],
  },
  {
    id: "tech-app.job.form",
    title: "{job} form",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "{job} details → form section (on {jobs} booked with a form)",
    summary:
      "Fill in the {job}'s form: sections of questions (text, numbers, dates, choices, checklists, photos, signatures). Answers save as you go and sync when you're back online. Questions marked * are required to complete.",
    controls: [
      { label: "Answer fields", does: "Type or pick an answer; it saves automatically (Saving… / Offline — will sync)." },
      { label: "Today / Now", does: "Fills a date or time question with today's date or the current time." },
      { label: "Choose…", does: "Opens the option list for a pick-one question; Clear or Cancel in the sheet." },
      { label: "Add photo", does: "Adds a photo to a photo question; the photo also goes into the {job}'s photos." },
      { label: "Remove photo", does: "Removes a photo from the question (it stays in the {job}'s photos)." },
      { label: "Tap to sign / Re-sign", does: "Captures a signature for a signature question (Technician signs or Customer signs)." },
      { label: "Not saved · retry", does: "An answer failed to save; tap to send it again." },
    ],
    tasks: [
      {
        q: "How do I fill in the job form?",
        steps: ["Open the {job}", "Scroll to the form", "Answer each question; required ones are marked *", "Tap Complete Job when done"],
      },
      {
        q: "Do my answers save if I lose signal?",
        steps: ["Keep answering — the form shows Offline — will sync", "Answers send when you're back online, before the {job} is completed"],
      },
    ],
    fixes: [
      { problem: "\"Required — answer this to finish the job\"", fix: "That question must be answered before Complete Job works." },
      { problem: "\"Outside the expected range … — double-check\"", fix: "The number is outside what the office expects. Check it; it can still be saved." },
      { problem: "\"This form is closed — answers are shown for reference.\"", fix: "The {job} is completed; answers can't be changed in the app." },
      { problem: "Answer flagged", fix: "Some answers are flagged for the office automatically; the completion summary shows how many." },
    ],
    keywords: ["checklist", "inspection form", "questions", "custom fields"],
  },
  {
    id: "tech-app.job.release",
    title: "Send this {job} back to dispatch",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "{job} details → I can't do this {job}",
    summary:
      "Hand an accepted {job} back. The office is notified right away and will reassign it. The {customer} isn't told anything by the app.",
    controls: [
      { label: "Personal emergency / Vehicle breakdown / Running too late to make it / Missing parts or equipment / Unsafe site conditions / Wrong skill set for this job / Other", does: "The reason (required)." },
      { label: "Anything dispatch should know (optional)", does: "A note for the office." },
      { label: "Send back to dispatch", does: "Releases the {job}: \"Sent back to dispatch — You're free for other work.\"" },
      { label: "Keep this {job}", does: "Closes the sheet." },
    ],
    tasks: [
      {
        q: "I can't make it to a job. How do I give it back?",
        steps: ["Open the {job}", "Tap I can't do this {job}", "Pick a reason", "Tap Send back to dispatch"],
      },
    ],
    fixes: [{ problem: "\"Couldn't release this job\"", fix: "The server refused (the {job} may have just changed) or the connection dropped. Pull the {job} up again and retry, or message dispatch." }],
    keywords: ["release job", "give back", "unassign", "can't make it", "cancel my job"],
  },
  {
    id: "tech-app.job.take-payment",
    title: "Take payment",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "{job} details → Take payment (on {jobs} set to collect payment on site, after you arrive)",
    summary: "Collect the {customer}'s card, Apple Pay or Google Pay payment through Stripe: show a QR code, open the pay page on your phone, or text the link.",
    controls: [
      { label: "Take payment · $…", does: "Opens the payment sheet with the total." },
      { label: "QR code", does: "The {customer} scans it with their phone camera to pay." },
      { label: "Pay on this phone", does: "Opens the secure pay page on your phone for the {customer} to use." },
      { label: "Text the link to the customer", does: "Texts the pay link to the {customer}'s phone (\"Link sent\")." },
      { label: "Done", does: "Closes the sheet after \"Paid\"." },
      { label: "Close", does: "Closes the sheet." },
    ],
    tasks: [
      {
        q: "How do I take payment on site?",
        steps: ["Tap I've Arrived", "Tap Take payment", "Have the {customer} scan the QR code, or tap Pay on this phone, or Text the link to the customer", "Wait for Paid, then tap Done"],
      },
    ],
    fixes: [
      { problem: "\"Card payments aren't switched on for this company yet.\"", fix: "The office needs to connect Stripe in Settings → Payments." },
      { problem: "\"The text couldn't be sent. Use the QR code instead.\"", fix: "The link text failed; let the {customer} scan the QR code." },
      { problem: "\"No phone number on this job to text.\"", fix: "Use the QR code or Pay on this phone." },
    ],
    keywords: ["collect payment", "card", "stripe", "apple pay", "google pay", "invoice"],
  },

  // ───────────────────────────── Messages ─────────────────────────────
  {
    id: "tech-app.messages",
    title: "Messages (dispatch)",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Bottom tabs → Messages",
    route: "/(rider)/messages",
    summary:
      "Your direct line to the dispatcher of the company you're working for (titled \"<Company> dispatch\"). New offers and a shortcut to your current {job}'s thread are shown at the top.",
    controls: [
      { label: "Message … dispatch…", does: "Type a message to dispatch." },
      { label: "Send message", does: "Send arrow; sends the message." },
      { label: "New job offer row", does: "Opens the Jobs tab where you can accept or decline." },
      { label: "Job thread · …", does: "Opens your current {job}." },
      { label: "Pull down", does: "Refreshes the thread." },
    ],
    tasks: [
      {
        q: "How do I message the office?",
        steps: ["Tap the Messages tab", "Type in the box at the bottom", "Tap the send arrow"],
      },
      {
        q: "How do I message about a specific job?",
        steps: ["Open the {job}", "Tap Dispatch", "Type in Message dispatch… and send"],
      },
      {
        q: "How do I see unread messages?",
        steps: ["Look for the red count on the Messages tab", "Tap Messages — opening it marks them read"],
      },
    ],
    fixes: [
      { problem: "Messages say they're from the wrong company", fix: "The thread is for the company you're working for now. Switch in Profile → Working for." },
      { problem: "No reply showing", fix: "Replies arrive live; pull down to refresh if the screen has been open a long time." },
    ],
    keywords: ["chat", "dispatcher", "office", "inbox", "text dispatch"],
  },

  // ───────────────────────────── Earnings ─────────────────────────────
  {
    id: "tech-app.earnings",
    title: "Earnings",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Bottom tabs → Earnings",
    route: "/(rider)/earnings",
    summary:
      "Your pay across every company you work for: this week, totals, how your pay is calculated, per-company totals, payouts, and every completed {job} with its pay breakdown.",
    controls: [
      { label: "This week", does: "Pay and {jobs} completed this week (across all companies if you work for more than one)." },
      { label: "Total earned / {jobs} done / Paid out / Companies", does: "Your all-time totals." },
      { label: "How your pay is calculated", does: "Split into on-site time, mileage, flat per job and per-unit work." },
      { label: "By company", does: "Jobs, pay and rating at each company (when you work for more than one)." },
      { label: "Payouts", does: "Each pay period with net amount and status (paid or pending)." },
      { label: "Completed {jobs}", does: "Each completed {job} with company, {customer}, date and pay breakdown. Shows QuickBooks bill status where the company pays that way." },
      { label: "Pull down", does: "Refreshes." },
    ],
    tasks: [
      {
        q: "How much have I earned this week?",
        steps: ["Tap the Earnings tab", "Read This week at the top"],
      },
      {
        q: "How is my pay worked out?",
        steps: ["Tap Earnings", "Read How your pay is calculated", "Scroll to Completed {jobs} for each {job}'s breakdown"],
      },
      {
        q: "When do I get paid?",
        steps: ["Tap Earnings", "Check Payouts for each period's status"],
        note: "Pay is settled by your employer; the app shows payouts the company records.",
      },
    ],
    fixes: [
      { problem: "A {job} shows \"No pay rate set — ask the office\"", fix: "The company hasn't set your pay rate, so the {job} earned nothing in the app. Ask the office to set it." },
      { problem: "\"Couldn't load earnings\"", fix: "Pull down to try again." },
      { problem: "Only my latest jobs are listed", fix: "The list shows your most recent 500 completed {jobs}." },
    ],
    keywords: ["pay", "wages", "payout", "money", "income"],
  },

  // ───────────────────────────── Profile ─────────────────────────────
  {
    id: "tech-app.profile",
    title: "Profile",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Bottom tabs → Profile",
    route: "/(rider)/profile",
    summary:
      "Your photo and status, the On the clock switch, Face ID lock, company switcher, your details, calendar sync, the app tour, legal links, sign out and account deletion.",
    controls: [
      { label: "Change profile photo", does: "Tap your photo to choose a new one from your photo library." },
      { label: "On the clock", does: "Same as the shift button on Jobs: on = available for offers and sharing location; off = offline. Shows Available, Busy (on a {job}) or Offline." },
      { label: "Switch to office mode", does: "Only for people who also have an office role at this company: opens the office side. You go off shift when you switch." },
      { label: "Face ID / Fingerprint Lock", does: "On: unlock the app with Face ID or fingerprint once a day. Only shown on phones with biometrics set up." },
      { label: "Working for", does: "Shown if you work for more than one company. Tap another company, then Switch, to reload your {jobs} for it. A count shows work waiting there." },
      { label: "Details", does: "Skill class, Vehicle, Phone, Completed jobs, License plate (set by the office)." },
      { label: "Calendar sync", does: "Opens Calendar sync; shows On or Off." },
      { label: "Show me around again", does: "Replays the four app tips." },
      { label: "Privacy Policy / Terms of Service / Help & Support", does: "Open in your browser." },
      { label: "Sign out", does: "Asks \"End your session?\", then signs out, stops location sharing, removes this phone from notifications and takes synced {jobs} off the phone's calendar." },
      { label: "Delete my account", does: "Opens the account deletion sheet." },
    ],
    tasks: [
      {
        q: "How do I set myself available / unavailable?",
        steps: ["Go to the Profile tab", "Turn On the clock on (available) or off (offline)"],
        note: "While you have active {jobs} you stay Busy until they're done or reassigned.",
      },
      {
        q: "How do I change my profile photo?",
        steps: ["Go to Profile", "Tap your photo", "Choose a photo from your library"],
      },
      {
        q: "How do I switch companies?",
        steps: ["Go to Profile", "Under Working for, tap the company", "Tap Switch"],
        note: "Anything in progress stays with the company you started it under.",
      },
      {
        q: "How do I change my vehicle, phone or skill class?",
        steps: ["Check the current values in Profile → Details", "Ask the office to change them — Details is read-only in the app"],
      },
      {
        q: "How do I get help?",
        steps: ["Go to Profile", "Tap Help & Support"],
      },
      {
        q: "How do I sign out?",
        steps: ["Go to Profile", "Tap Sign out", "Tap Sign out to confirm"],
      },
    ],
    fixes: [
      { problem: "\"Couldn't switch\"", fix: "Check your connection and try again." },
      { problem: "\"Upload failed\" for the profile photo", fix: "Check your signal and try again." },
      { problem: "\"Couldn't open link\"", fix: "No browser could open the page; the alert shows the address to open manually." },
    ],
    keywords: ["account", "settings", "availability", "status", "switch company", "office mode", "log out"],
  },
  {
    id: "account.delete-account",
    title: "Delete my account",
    surface: "account",
    platforms: MOBILE,
    roles: TECH,
    path: "Profile → Delete my account",
    summary:
      "Permanently deletes your ArrivePing login. Companies keep their {job} records with your name removed; {jobs} still assigned to you go back to dispatch.",
    controls: [
      { label: "Type DELETE to confirm", does: "Type DELETE to enable deletion." },
      { label: "Delete account", does: "Deletes the account and signs you out (\"Account deleted\")." },
      { label: "Cancel / Close", does: "Closes the sheet." },
    ],
    tasks: [
      {
        q: "How do I delete my account?",
        steps: ["Go to Profile", "Tap Delete my account", "Read what happens", "Type DELETE", "Tap Delete account"],
        note: "Pay you're owed is still settled by your employer outside the app.",
      },
    ],
    fixes: [
      { problem: "\"You're the only admin at …\"", fix: "Make someone else an admin there first (Settings → Team on the web), then come back." },
      { problem: "\"Platform administrator accounts can't be deleted from the app.\"", fix: "Email support@nvc360.com." },
    ],
    keywords: ["remove account", "close account", "erase data", "privacy"],
  },
  {
    id: "tech-app.calendar-sync",
    title: "Calendar sync",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Profile → Calendar sync",
    route: "/calendar-sync",
    summary:
      "Put your assigned {jobs} in the calendar you already use. Sync to this phone (past 2 weeks and next 90 days, with a reminder an hour before), or subscribe with a private link. Moved or cancelled {jobs} follow.",
    controls: [
      { label: "Add my jobs to this phone", does: "Asks for calendar access, then lets you choose where the {jobs} go." },
      { label: "A separate “ArrivePing Jobs” calendar", does: "Recommended: a calendar of its own that's easy to show or hide." },
      { label: "Or add them to one of your calendars", does: "Pick an existing calendar on the phone (Apple, Google, Outlook accounts on the phone)." },
      { label: "Sync now", does: "Syncs straight away. Otherwise it updates when you open ArrivePing and every 15 minutes while it's open." },
      { label: "Change calendar", does: "Choose a different calendar." },
      { label: "Turn off", does: "Stops syncing; choose Keep the jobs or Remove the calendar / Remove the jobs." },
      { label: "Apple Calendar — Subscribe", does: "iPhone only: subscribes this iPhone to your private link." },
      { label: "Google Calendar — Send", does: "Shares the link so you can open it on a computer signed in to Google." },
      { label: "Outlook.com — Send / Outlook for work or school — Send", does: "Shares the link to open in Outlook on the web." },
      { label: "Any other calendar — Share", does: "Shares the feed address to paste into “Subscribe from URL”." },
      { label: "Reset link", does: "Makes a new private link; calendars using the old one stop updating." },
      { label: "Open Settings", does: "Shown when calendar access is off; opens the phone's settings for ArrivePing." },
    ],
    tasks: [
      {
        q: "How do I see my jobs in my phone calendar?",
        steps: ["Go to Profile", "Tap Calendar sync", "Tap Add my jobs to this phone", "Allow calendar access", "Tap A separate “ArrivePing Jobs” calendar"],
      },
      {
        q: "How do I add my jobs to Google Calendar?",
        steps: ["Profile → Calendar sync", "Either tap Add my jobs to this phone and pick your Google calendar", "Or under Subscribe with a link, tap Send next to Google Calendar and open the link on a computer"],
      },
      {
        q: "How do I stop calendar sync?",
        steps: ["Profile → Calendar sync", "Tap Turn off", "Choose Keep the jobs or remove them"],
      },
      {
        q: "I shared my calendar link by mistake",
        steps: ["Profile → Calendar sync", "Tap Reset link", "Tap Reset link to confirm", "Subscribe again with the new link"],
        note: "Anyone with the link can see your {job} times and addresses.",
      },
    ],
    fixes: [
      { problem: "\"Calendar access is turned off for ArrivePing.\"", fix: "Tap Open Settings and turn on Calendars → Full Access (iPhone) or Calendar (Android), then come back." },
      { problem: "Subscribed calendar is slow to update", fix: "Each calendar service decides how often it checks a subscribed link; changes can take hours. Sync to this phone updates faster." },
      { problem: "\"Update ArrivePing to the latest version to sync jobs to this phone's calendar.\"", fix: "Update the app from the App Store / Play Store." },
      { problem: "Jobs disappeared from my calendar after signing out", fix: "Signing out removes synced {jobs} from the phone so the next user can't see them. Turn sync on again after signing in." },
    ],
    keywords: ["schedule", "google calendar", "outlook", "apple calendar", "ical", "subscribe", "tomorrow"],
  },

  // ───────────────────────────── Topics ─────────────────────────────
  {
    id: "tech-app.location",
    title: "Location sharing",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Starts when you Sign in for your shift (Jobs → Sign in, or Profile → On the clock)",
    summary:
      "While you're on the clock the app sends your live location to dispatch, even when the app is closed or the phone is locked. That needs Location set to Always (iPhone) / Allow all the time (Android). While en route it also feeds the {customer}'s live ETA and the automatic check-in when you reach the address. Going off the clock or signing out stops it.",
    controls: [
      { label: "Share your location while on the clock (Android)", does: "Explains background location before Android asks. Continue shows the Android prompts; Not now skips them for 3 days." },
      { label: "\"ArrivePing is sharing your location\" (Android notification)", does: "Shown while sharing in the background; it keeps Android from stopping location updates." },
      { label: "Location indicator (iPhone)", does: "iOS shows the location indicator while the app uses location in the background." },
    ],
    tasks: [
      {
        q: "How do I turn on location for ArrivePing?",
        steps: ["Tap Sign in on the Jobs tab", "When the phone asks, allow location", "On iPhone choose Always; on Android tap Continue, then choose Allow all the time"],
        note: "With only While Using, location is shared only while the app is open.",
      },
      {
        q: "Why does the app want \"Always\" location?",
        steps: ["Tap Sign in on the Jobs tab", "Allow location and choose Always (iPhone) or Allow all the time (Android)"],
        note: "So dispatch sees where you are and the {customer} gets a live arrival time while the app is closed. It runs only while you're on the clock.",
      },
      {
        q: "How do I stop sharing my location?",
        steps: ["Open the Jobs tab", "Tap the green Signed in button (or turn off On the clock in Profile)"],
        note: "Signing out also stops it.",
      },
      {
        q: "How does auto check-in work?",
        steps: ["Tap Start Driving", "Drive to the address", "Inside the check-in distance you're marked On Site automatically"],
        note: "If you leave the site the on-site clock pauses; tap Resume Clock if you're still there.",
      },
    ],
    fixes: [
      { problem: "The office says my dot isn't moving", fix: "Make sure the shift button is green, Location is on for ArrivePing, and it's set to Always / Allow all the time. Opening the app sends a fresh location right away." },
      { problem: "I tapped Not now on the Android location message", fix: "The app won't ask again for 3 days. To turn it on now, open the phone's settings for ArrivePing → Location → Allow all the time." },
      { problem: "Offer says \"Turn on location sharing to see the drive.\"", fix: "Go on the clock and allow location." },
      { problem: "\"Dispatch isn't receiving your location.\"", fix: "Updates are failing — check signal and that Location is on for ArrivePing." },
    ],
    keywords: ["GPS", "always allow", "background location", "allow all the time", "tracking", "geofence", "auto arrive", "battery"],
  },
  {
    id: "tech-app.notifications",
    title: "Notifications",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Asked for when you first open your {jobs} after signing in",
    summary:
      "Push notifications for new {job} offers, {job} updates and messages from dispatch. New-offer notifications have Accept, Details and Decline buttons. Badges on the Jobs, Messages and Profile tabs and the app icon count offers and unread messages across all your companies.",
    controls: [
      { label: "Accept (notification button)", does: "Accepts the offer and opens the {job} (if the notification is less than 30 minutes old; otherwise opens the offer)." },
      { label: "Details (notification button)", does: "Opens the offer details." },
      { label: "Decline (notification button)", does: "Opens the offer with the decline reason sheet." },
      { label: "Tap the notification", does: "Opens the offer, the {job}, or Messages. If it's from your other company, the app switches to that company first." },
      { label: "Job alerts (Android channel)", does: "The Android notification category ArrivePing uses; high importance with vibration." },
    ],
    tasks: [
      {
        q: "How do I turn on job notifications?",
        steps: ["Sign in and open your {jobs}", "Tap Allow when the phone asks", "If you said no before, turn on Notifications for ArrivePing in the phone's Settings"],
      },
      {
        q: "Why is there a red number on the Profile tab?",
        steps: ["Go to Profile → Working for", "The company with the count has offers or messages waiting", "Tap it and Switch"],
      },
    ],
    fixes: [
      { problem: "Not getting job notifications", fix: "Check Notifications are allowed for ArrivePing in the phone's settings (on Android, also the Job alerts category), that you're signed in, and that you're on the clock — offers only go to technicians on shift. Notifications don't work on a simulator." },
      { problem: "Notifications stopped after signing out", fix: "Signing out removes the phone from notifications. Sign in again to re-register." },
      { problem: "Accept on the notification opened the offer instead", fix: "The notification was over 30 minutes old, or accepting failed (for example the offer was taken). Check the offer screen." },
    ],
    keywords: ["push", "alerts", "badge", "not getting offers"],
  },
  {
    id: "tech-app.offline",
    title: "Working with no signal",
    surface: "tech-app",
    platforms: MOBILE,
    roles: TECH,
    path: "Anywhere in the app",
    summary:
      "With no connection a banner says \"No connection — actions will send once you're back online\". Taps like Start Driving or Complete Job, notes and form answers wait and send automatically when signal returns. Photos are kept on the phone until they upload.",
    controls: [
      { label: "No connection banner", does: "Shown at the top while offline." },
      { label: "\"No signal — will send the moment you're back online\"", does: "Under the main {job} button when your last tap is waiting to send." },
    ],
    tasks: [
      {
        q: "Can I use the app with no signal?",
        steps: ["Keep working — tap buttons as normal", "Wait for the banner to disappear; queued actions send automatically"],
        note: "Don't tap the same button repeatedly; it's already queued.",
      },
    ],
    fixes: [
      { problem: "\"Message not sent\"", fix: "Your text stays in the box — tap send again when you have signal." },
      { problem: "\"Step not saved\" on a checklist item", fix: "Check your signal and tap it again." },
      { problem: "Photos waiting to upload", fix: "They upload by themselves; tap a photo and Retry now to force it." },
    ],
    keywords: ["offline", "no service", "dead zone", "sync"],
  },

  // ───────────────────────────── Web (technician) ─────────────────────────────
  {
    id: "tech-app.web.jobs",
    title: "Your jobs (web)",
    surface: "tech-app",
    platforms: ["web"],
    roles: TECH,
    path: "Sign in on the web as a technician → My Jobs",
    route: "/rider",
    summary: "Technician job list in a browser: go online or offline, new offers, active, assigned and completed {jobs}.",
    controls: [
      { label: "Go online / Online", does: "Toggles your status between available and offline." },
      { label: "Respond", does: "On a new offer: opens it to accept or decline." },
      { label: "Continue job", does: "Opens an active {job}." },
      { label: "Start job", does: "Opens an assigned {job}." },
      { label: "My Jobs / Earnings / Profile", does: "Navigation." },
    ],
    tasks: [
      { q: "How do I go online on the web?", steps: ["Open My Jobs", "Tap Go online"] },
      { q: "How do I respond to an offer on the web?", steps: ["Under New offers tap Respond", "Tap Accept job or Decline"] },
    ],
    fixes: [
      { problem: "\"Permission denied — contact your dispatcher.\"", fix: "Your account can't change status. Ask your dispatcher." },
      { problem: "\"Failed to update status. Try again.\"", fix: "Check your connection and try again." },
    ],
    keywords: ["browser", "desktop"],
  },
  {
    id: "tech-app.web.job",
    title: "Job (web)",
    surface: "tech-app",
    platforms: ["web"],
    roles: TECH,
    path: "My Jobs → a {job}",
    route: "/rider/job/:id",
    summary: "Run a {job} in the browser: share live location, move it through its stages, fill in the form, take payment, or send it back to dispatch.",
    controls: [
      { label: "Accept job / Decline", does: "On an offer: accept, or decline with an optional reason (Confirm decline)." },
      { label: "Start driving / I've arrived / Begin service / Complete job", does: "Moves the {job} to the next stage." },
      { label: "Share / Stop (Live location)", does: "Starts or stops sending the browser's location so the {customer} can track you." },
      { label: "I can't do this job", does: "Pick a reason (required) and tap Send back; Keep job cancels." },
      { label: "Take payment", does: "Shown on {jobs} set to collect payment on site, after arriving." },
    ],
    tasks: [
      { q: "How do I share my location from the web?", steps: ["Open the {job}", "Under Live location tap Share", "Allow location in the browser"] },
      { q: "How do I complete a job on the web?", steps: ["Tap Start driving", "Tap I've arrived", "Tap Begin service", "Answer required form questions", "Tap Complete job"] },
      { q: "How do I send a job back on the web?", steps: ["Tap I can't do this job", "Pick a reason", "Tap Send back"] },
    ],
    fixes: [
      { problem: "\"Answer the required questions first: …\"", fix: "Answer the listed form questions, then Complete job." },
      { problem: "\"Some answers haven't saved yet. Check your connection and try again.\"", fix: "Wait for answers to save, then try again." },
    ],
    keywords: ["browser job", "web tracking"],
  },
  {
    id: "tech-app.web.earnings",
    title: "Earnings (web)",
    surface: "tech-app",
    platforms: ["web"],
    roles: TECH,
    path: "Earnings in the web navigation",
    route: "/rider/earnings",
    summary: "This week's pay, jobs done, how your pay is calculated, and payout history.",
    controls: [
      { label: "This week / Jobs done", does: "Week pay and completed count." },
      { label: "How your pay is calculated", does: "On-site time and per-unit work totals." },
      { label: "Payout history", does: "Past payouts." },
    ],
    tasks: [{ q: "Where can I see my pay on the web?", steps: ["Sign in on the web", "Click Earnings"] }],
    fixes: [{ problem: "\"Could not load earnings.\"", fix: "Refresh the page." }],
    keywords: ["pay", "web earnings"],
  },
];
