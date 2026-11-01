import type { LegalBlock } from "../legal/types";

/**
 * Help Center content — https://arriveping.com/support
 *
 * Modelled on the task-based help centers of Jobber ("What do you want to get
 * done?") and ServiceTitan (onboarding checklists, a release hub and a clear
 * path to a person). Every article is plain data so the hub, the article pages
 * and the on-site search all read from one place.
 *
 * Rules:
 *  - Only describe behaviour the product actually has. Menu names below are
 *    the real dashboard labels (Operations → Scheduler, Setup → Notifications…).
 *  - "Jobs" may be labelled per industry (Work orders, Deliveries); articles say
 *    "Jobs" and note the alias once in the getting-started guide.
 *  - Keep articles short. One task per article; link sideways for the rest.
 */

export type ArticleBlock = LegalBlock | { type: "ol"; items: string[] };

export interface Article {
  slug: string;
  title: string;
  /** One line shown on cards and in search results. */
  summary: string;
  /** Optional meta description (100-160 characters) when `summary` is too short or long for search results. */
  description?: string;
  /** Optional <title> (60 characters or less) when "<title> | ArrivePing" runs long; the page H1 stays `title`. */
  seoTitle?: string;
  category: CategoryId;
  updated: string;
  /** Extra words that should match in search but aren't in the title. */
  keywords?: string[];
  blocks: ArticleBlock[];
}

export type CategoryId =
  | "get-started"
  | "technician-app"
  | "dispatch"
  | "customer-notifications"
  | "billing"
  | "money"
  | "account"
  | "troubleshooting"
  | "integrations";

export interface Category {
  id: CategoryId;
  title: string;
  blurb: string;
  /** Who this is mostly for — shown as a chip. */
  audience: "Office" | "Technicians" | "Everyone";
}

export const categories: Category[] = [
  { id: "get-started", title: "Get started", blurb: "Create your company, invite your team and run your first job.", audience: "Office" },
  { id: "technician-app", title: "Technician app", blurb: "Sign in, share your location on shift, and work a job from the phone.", audience: "Technicians" },
  { id: "dispatch", title: "Dispatch & scheduling", blurb: "Assign jobs, watch the live map and handle a day that runs late.", audience: "Office" },
  { id: "customer-notifications", title: "Customer notifications", blurb: "What customers receive, what they can see, and how to edit the messages.", audience: "Office" },
  { id: "billing", title: "Billing & plans", blurb: "The free trial, how seats are priced, what you're billed for, and changing your plan or card.", audience: "Office" },
  { id: "money", title: "Money & payments", blurb: "Technician pay and payouts, taking card payments through your own Stripe account, and invoices.", audience: "Office" },
  { id: "account", title: "Account & security", blurb: "Passwords, roles, deleting an account and how your data is handled.", audience: "Everyone" },
  { id: "troubleshooting", title: "Troubleshooting", blurb: "ETAs not updating, missing notifications, texts that didn't arrive.", audience: "Everyone" },
  { id: "integrations", title: "Exports & integrations", blurb: "Get your data out: CSV, calendar feeds, webhooks, Zapier, Make and MCP.", audience: "Office" },
];

export const support = {
  email: "support@nvc360.com",
  privacyEmail: "privacy@nvc360.com",
  salesEmail: "contact@nvc360.com",
  /** Customer-support channel in the NVC360 Slack workspace. */
  slackUrl: "https://nvc360workspace.slack.com/archives/C094EBATVAS",
  hours: "Monday to Friday, 8:00 am – 6:00 pm Central Time",
  response: "We reply within one business day, and sooner for anything that stops a crew from working.",
  maker: "ArrivePing is made by NVC360 in Winnipeg, Manitoba.",
};

const U = "October 16, 2026";
const U2 = "October 17, 2026";
const U3 = "October 18, 2026";

export const articles: Article[] = [
  /* ---------------------------------------------------------------- */
  /* Get started                                                        */
  /* ---------------------------------------------------------------- */
  {
    slug: "set-up-your-company",
    title: "Set up your company in ArrivePing",
    summary: "From sign-up to your first dispatched job, most teams are running the same day.",
    description: "Sign up free, follow the guided onboarding, invite your technicians and dispatch your first job. Most teams are running the same day.",
    category: "get-started",
    updated: U,
    keywords: ["onboarding", "signup", "create account", "new company", "checklist"],
    blocks: [
      { type: "p", text: "ArrivePing is set up by the office first, then technicians join from an invitation. There is no public sign-up for technicians. Here is the order that works best." },
      {
        type: "ol",
        items: [
          "**Sign up free** at [arriveping.com/get-started](/get-started). You create the company and the first admin account in one step. The 30-day free trial starts now and you can add as many users as you like during it.",
          "**Follow the guided onboarding.** It asks what kind of work you do, sets your industry terms (so Jobs might be called Work orders or Visits in your dashboard; see [Why your dashboard says Work orders instead of Jobs](/support/industry-terms)), loads a starter catalog of services and drafts your customer messages in your voice.",
          "**Look around the sample day.** Every new company starts with a few sample technicians, customers and jobs so the Scheduler and Map aren't empty. Nobody is contacted about them. Clear them when you're ready; see [The sample day](/support/sample-day).",
          "**Add your service zones** under Setup → Service Zones if you want jobs grouped by area. See [Service zones](/support/service-zones).",
          "**Invite your technicians** from People → Technicians & Managers. See [Invite your technicians](/support/invite-your-technicians). Office staff are added on the same page under **Internal Team**; see [Add a dispatcher or manager](/support/add-office-staff).",
          "**Create a job** from Operations → Jobs → New job, assign it, and have the technician tap **Start Driving** so you can see the customer's tracking page for yourself.",
        ],
      },
      { type: "note", title: "Stuck during setup?", text: `Email [${support.email}](mailto:${support.email}) with your company name. Our team is available during setup and ${support.response.charAt(0).toLowerCase()}${support.response.slice(1)}` },
    ],
  },
  {
    slug: "invite-your-technicians",
    title: "Invite your technicians",
    summary: "Add field staff from the dashboard; each one gets an email right away to set a password and get the app.",
    category: "get-started",
    updated: U2,
    keywords: ["add technician", "add driver", "invitation", "seat", "roster", "welcome email", "sign-in link", "password"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **People → Technicians & Managers** in the dispatch dashboard.",
          "Choose **Add technician** and enter their name, email and mobile number. Leave the password blank.",
          "They get an email right away, in your company's name, with a link to set their own password (it works for 7 days) and where to get the ArrivePing app. They sign in on the app with that email.",
        ],
      },
      { type: "p", text: "Adding a whole roster from a spreadsheet works the same way: each new technician gets the email, sent one after another over a few minutes. See [Import your existing customers and team](/support/import-customers-and-team)." },
      { type: "p", text: "Each active technician is a driver seat on your plan. During the free trial seats are unlimited; after it, you are billed by driver count as described in [How ArrivePing is priced](/support/pricing-and-seats)." },
      { type: "p", text: "Email didn't arrive, or the link expired? Ask them to check spam, then open their profile and choose **Email a sign-in link** to send a fresh one. If they already work for another ArrivePing company, they get an invitation to add your company to their existing account instead; see [Working for more than one company](/support/working-for-more-than-one-company)." },
    ],
  },
  {
    slug: "import-customers-and-team",
    title: "Import your existing customers and team",
    summary: "Bring everyone over at once: upload the CSV or Excel file you already have, fill in our template, or send us the file and we'll import it.",
    category: "get-started",
    updated: U3,
    keywords: [
      "import", "bulk import", "upload", "csv", "excel", "xlsx", "spreadsheet", "template", "customer list", "client list",
      "migrate", "switch", "move from", "jobber", "housecall pro", "servicetitan", "quickbooks", "contacts", "employees", "staff", "roster",
    ],
    blocks: [
      { type: "p", text: "You don't have to type your customers or your team in one at a time. Bring the whole list over in one go, in whichever of these three ways suits you." },
      { type: "h3", text: "1. Upload the file you already have" },
      { type: "p", text: "A customer list exported from your old software, your accounting system or a spreadsheet you keep yourself will work as it is, in CSV or Excel." },
      {
        type: "ol",
        items: [
          "For customers, open **People → People** and choose the **Customers** tab. For technicians, open **People → Technicians & Managers**.",
          "Choose **Import**, then **Import CSV** or **Import Excel**, and pick your file.",
          "ArrivePing adds everyone and shows how many were imported, and which rows weren't and why.",
        ],
      },
      { type: "p", text: "The first row of the file must hold the column names. ArrivePing recognises the usual ones, such as Name or First Name and Last Name, Email, Phone or Mobile, Company, Address, City, Province or State, and Postal Code or ZIP. Columns it doesn't use, such as notes or balances, are left out." },
      { type: "h3", text: "2. Fill in our template" },
      {
        type: "ol",
        items: [
          "On the same page, choose **Import → Download template**. It opens in Excel, Numbers or Google Sheets.",
          "Replace the example row with your own, one person per row. Leave a cell blank if you don't have the detail.",
          "Save it as CSV or Excel and upload it with **Import CSV** or **Import Excel**.",
        ],
      },
      { type: "p", text: "The customer template has name, email, phone, company, website, address, city, province or state, postal or ZIP code, country, and whether they are a one-time or repeat customer. The technician template has name, email, phone, skill class, skills, vehicle, license plate, license number, address and hourly pay rate." },
      { type: "h3", text: "3. Send it to us" },
      { type: "p", text: `Rather not do it yourself, or have a list in another format? Email the file to [${support.email}](mailto:${support.email}) with your company name, and we'll import everyone for you and reply when it's done.` },
      { type: "h3", text: "What happens when you import" },
      {
        type: "ul",
        items: [
          "**New customers aren't contacted.** Importing doesn't send them a text or an email; they hear from you when you book them a job. The one exception: someone who already has an ArrivePing account with another company gets an email asking them to join yours.",
          "**Technicians get a welcome email** with a link to set their password and get the app, the same as when you add one by hand. See [Invite your technicians](/support/invite-your-technicians).",
          "**No duplicates.** Someone whose email is already in your account is skipped, so you can upload the same file again after fixing a few rows.",
          "**Missing details are fine.** A row without an email still imports. Add the email later on the person's profile. A technician needs one before they can sign in.",
          "**Up to 500 rows per file**, and 5 MB. Split a longer list into several files, or send it to us.",
        ],
      },
      { type: "p", text: "Office staff, such as dispatchers and managers, are added one at a time with **Add** on the People page. For a large office team, send us the list." },
    ],
  },
  {
    slug: "your-first-job",
    title: "Run your first job end to end",
    summary: "Book a job, assign it, watch the technician travel and confirm arrival — the whole loop in ten minutes.",
    category: "get-started",
    updated: U,
    keywords: ["new job", "work order", "appointment", "test", "demo"],
    blocks: [
      {
        type: "ol",
        items: [
          "**Book it.** Operations → Jobs → **New job**. Pick the customer (or add one with a mobile number), the service, the address and the time window. The customer's booking confirmation goes out when you save.",
          "**Assign it.** Pick a technician on the job (the list is ranked, with the best match first) or drag the job onto a technician in Operations → Scheduler. The technician gets the job as an offer to accept. Once you trust the suggestions you can let an assignment rule do this for you; see [Assignment rules](/support/assignment-rules). Dispatchers can reassign any job at any time.",
          "**On the way.** The technician taps **Start Driving** in the app. The customer gets a text or email with a link to a live tracking page showing the technician's progress and ETA.",
          "**Arrival.** A geofence around the address marks the technician as arrived and starts the on-site clock; the technician can also tap **I've Arrived**. Location sharing to the customer stops at arrival.",
          "**Finish.** The technician taps **Complete Job**. Photos, the customer's signature and any voice notes are saved with the job and visible in the dashboard.",
        ],
      },
      { type: "p", text: "Try it with your own phone as the customer: you'll see exactly what they see. The tracking page needs no app or account." },
    ],
  },
  {
    slug: "sample-day",
    title: "The sample day: what it is and how to clear it",
    summary: "Every new company starts with a few sample technicians, customers and jobs so you can try the dashboard. Nobody is contacted about them.",
    category: "get-started",
    updated: U3,
    keywords: ["sample data", "demo data", "test jobs", "fake jobs", "clear sample", "remove sample", "example jobs"],
    blocks: [
      { type: "p", text: "When you first sign in, a banner says \"You're looking at a sample day.\" It's three sample technicians, six customers and eight jobs, all marked **(sample)**, so the Scheduler, Map and reports have something in them while you look around. **See what your customer sees** on the banner opens a sample tracking page." },
      {
        type: "ul",
        items: [
          "No sample customer or technician is ever texted or emailed.",
          "Sample jobs never fire webhooks or assignment rules. They show milestones on their timeline but send nothing.",
          "They don't count toward anything on your bill.",
        ],
      },
      { type: "p", text: "When you're ready to use your own data, an admin chooses **Clear sample data** on the banner and confirms. It can't be undone, but you can add a fresh sample day later from **Guide & help → Add a sample day**." },
    ],
  },
  {
    slug: "add-office-staff",
    title: "Add a dispatcher, manager or project manager",
    summary: "Office users are added under People → Technicians & Managers → Internal Team. Each one beyond the included dispatcher is a licence priced like a driver.",
    category: "get-started",
    updated: U3,
    keywords: ["add manager", "add dispatcher", "office user", "internal team", "new employee", "admin", "second dispatcher", "staff"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **People → Technicians & Managers** and choose the **Internal Team** tab.",
          "Choose **New Employee**. Enter their name, email and phone, and pick a role: Dispatcher, Manager or Project Manager. An admin can also make another Admin. What each role can do is in [User roles and what each can do](/support/roles-and-permissions).",
          "They get a welcome email, in your company's name, with a link to set their password and sign in on the web. If it didn't arrive, open their profile and choose **Email a sign-in link**.",
        ],
      },
      { type: "p", text: "Your plan includes one dispatcher licence. Each further office user is a licence priced exactly like a driver, whatever their role; see [How ArrivePing is priced](/support/pricing-and-seats). Deactivating someone frees the licence and keeps their history." },
      { type: "p", text: "Office staff who also do field work can be given jobs too: open **Setup → Settings → Company** and look for **Who can be assigned jobs**. They keep their office account and also appear in the technician list." },
    ],
  },
  {
    slug: "industry-terms",
    title: "Why your dashboard says Work orders (or Visits) instead of Jobs",
    summary: "ArrivePing uses your trade's words for jobs, technicians and customers, chosen at sign-up. Email us to change them.",
    seoTitle: "Why ArrivePing Says Work Orders or Visits Instead of Jobs",
    category: "get-started",
    updated: U3,
    keywords: ["terminology", "rename jobs", "work orders", "visits", "business type", "industry", "wording", "labels", "crew", "installer"],
    blocks: [
      { type: "p", text: "During sign-up ArrivePing picks the words your trade uses and applies them across the dashboard, the technician app and your customer messages. A unit of work might be a Job, Work order, Project, Visit, Booking, Session or Reservation; your field staff might be Technicians, Electricians, Installers, Crew leads, Superintendents or Vendors. These articles say \"Jobs\" and \"technicians\" throughout." },
      { type: "p", text: "There isn't a setting to change the terms yourself yet. Email [support@nvc360.com](mailto:support@nvc360.com) with your company name and the words you'd like (singular and plural), and we'll switch them for you." },
    ],
  },
  {
    slug: "company-time-zone",
    title: "Set your company's time zone (and a note on languages)",
    summary: "Setup → Settings → Company → Tax & Locale. Every time in the dashboard, in customer messages and in booking slots follows it.",
    category: "get-started",
    updated: U3,
    keywords: ["timezone", "time zone", "clock", "locale", "language", "french", "spanish", "translation", "central time"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **Setup → Settings → Company** and find **Tax & Locale**.",
          "Choose your **Timezone**. Canadian and US zones are listed, from Winnipeg, Toronto, Vancouver, Edmonton, Halifax and St. John's to New York, Chicago, Denver and Los Angeles.",
          "Save. Times in the dashboard, the customer's booking and on-the-way messages, quiet hours, timed milestones and the slots customers can book in their portal all follow it.",
        ],
      },
      { type: "p", text: "ArrivePing's dashboard and app are in English for now. The texts and emails your customers receive are yours to write, in any language, under **Setup → Notifications**; see [Customize the on-my-way and other messages](/support/customize-messages)." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Technician app                                                     */
  /* ---------------------------------------------------------------- */
  {
    slug: "install-and-sign-in",
    title: "Install the app and sign in",
    summary: "Technicians join from an invitation; there is no public sign-up in the app.",
    description: "Technicians join from an invitation: set a password, install ArrivePing from the App Store on iPhone or iPad, or sign in in an Android phone's browser.",
    category: "technician-app",
    updated: U,
    keywords: ["login", "iphone", "ipad", "app store", "password", "invitation"],
    blocks: [
      { type: "p", text: "Your company adds you to its roster and ArrivePing emails you an invitation. Set your password from that email, install **ArrivePing** from the App Store, and sign in with the same email address. The app works on iPhone and iPad. On an Android phone, sign in at arriveping.com in the phone's browser instead: see [No iPhone? Use ArrivePing in a browser](/support/use-arriveping-in-a-browser)." },
      { type: "p", text: "If you have not received an invitation, ask your dispatcher or office admin to add you from People → Technicians & Managers. Support cannot create technician accounts on a company's behalf." },
      { type: "p", text: "Forgotten your password? Tap **Forgot password?** on the sign-in screen or go to [arriveping.com/forgot-password](/forgot-password). The reset link is valid for one hour." },
    ],
  },
  {
    slug: "location-sharing",
    title: "Location sharing and the \"Always\" permission",
    summary: "Your location is shared with dispatch only while you are On the clock, and with customers only while you travel to their job.",
    category: "technician-app",
    updated: U,
    keywords: ["gps", "tracking", "privacy", "on the clock", "precise location", "background"],
    blocks: [
      { type: "p", text: "ArrivePing shares your live location with dispatch only while you are **On the clock** — the switch at the top of the Profile tab. When you go off the clock the app stops sharing and tells iOS to stop tracking." },
      { type: "p", text: "Customers see even less: only your progress toward their own appointment, and only while you are travelling to it. Sharing to the customer stops the moment you arrive." },
      { type: "h3", text: "Why the app asks for \"Always\"" },
      { type: "p", text: "Your ETA has to keep updating while the phone is in your pocket or mounted in the van. With \"While Using\", tracking pauses whenever the app is in the background and customers see a stale ETA." },
      { type: "p", text: "To check or change the permission: iPhone **Settings → ArrivePing → Location**. Choose **Always** and turn on **Precise Location**." },
      { type: "note", title: "No hardware needed.", text: "ArrivePing uses the phone you already carry. There are no plug-in vehicle trackers to buy or install." },
    ],
  },
  {
    slug: "notifications-and-live-activities",
    title: "Notifications and Live Activities",
    summary: "Job offers, dispatch messages and schedule changes arrive as push notifications; the current job shows on the Lock Screen.",
    category: "technician-app",
    updated: U,
    keywords: ["push", "dynamic island", "lock screen", "alerts", "background app refresh"],
    blocks: [
      { type: "p", text: "New job offers, messages from dispatch and schedule changes arrive as push notifications. On iPhone the current job also appears as a Live Activity on the Lock Screen and in the Dynamic Island, so you can glance at the address and window without unlocking the phone." },
      { type: "p", text: "If notifications stop, check **Settings → ArrivePing → Notifications** and make sure Background App Refresh is allowed for the app. See [I'm not receiving notifications](/support/not-receiving-notifications) for the full checklist." },
    ],
  },
  {
    slug: "on-the-way-and-arrival",
    title: "On the way, running late and arrival",
    summary: "One tap tells the customer you're coming; a geofence confirms you arrived.",
    description: "Tap Start Driving and the customer gets a live tracking link. Running-late messages go out automatically, and a geofence confirms you arrived.",
    category: "technician-app",
    updated: U,
    keywords: ["eta", "geofence", "arrived", "late", "status"],
    blocks: [
      {
        type: "ul",
        items: [
          "**Start Driving.** Tap it when you leave for the job. The customer gets a text or email with a live tracking link and the office sees your status change to En route.",
          "**Running late.** If your ETA slips, the customer's arrival window updates automatically and they get a running-late message; you don't have to call anyone.",
          "**I've Arrived.** A geofence around the job address marks you as arrived within about 150 m and starts the on-site time clock. If the address is off or you parked around the corner, tap **I've Arrived** yourself. You can't go straight from driving to completing a job; the app asks you to check in first.",
          "**Complete Job.** Tap it when the work is done. If the job has required checklist items, the app asks for them before it lets you complete.",
        ],
      },
      { type: "p", text: "Customers can text or call you from their tracking page to share gate codes or parking details. The buttons use the phone number on your roster profile, so if you'd rather not take customer calls on a personal phone, ask your office to put a work number on your profile." },
    ],
  },
  {
    slug: "photos-signatures-voice-notes",
    title: "Photos, signatures and voice notes",
    summary: "Everything you capture on site is saved with the job for the office.",
    description: "Job photos, customer signatures and transcribed voice notes captured on site are saved with the job, where your office can see them.",
    category: "technician-app",
    updated: U,
    keywords: ["camera", "microphone", "signature", "dictate", "transcribe", "attachments"],
    blocks: [
      { type: "p", text: "Job photos and customer signatures are stored with the job and visible to your company's office. Voice notes are short recordings you dictate on site; they are transcribed for the office and kept with the job." },
      { type: "p", text: "The camera and microphone are only used when you tap those buttons. If iOS has blocked them, go to **Settings → ArrivePing** and allow Camera and Microphone." },
    ],
  },
  {
    slug: "working-for-more-than-one-company",
    title: "Working for more than one company",
    summary: "Subcontractors can belong to several companies with one login; jobs, messages and location stay separate.",
    category: "technician-app",
    updated: U,
    keywords: ["subcontractor", "switch company", "multiple employers"],
    blocks: [
      { type: "p", text: "If two companies have added you, the Profile tab shows both and lets you switch. Your jobs, messages and earnings are kept separate per company, and only the company you are on the clock for can see your location." },
    ],
  },
  {
    slug: "job-offers-accept-decline",
    title: "Job offers: accept, decline or send a job back",
    summary: "Jobs reach you as offers under New offers. Declining returns the job to dispatch; after accepting, Send back to dispatch does the same with a reason.",
    category: "technician-app",
    updated: U3,
    keywords: ["offer", "accept", "decline", "reject", "send back", "can't make it", "reassign", "new offers", "up next", "in progress"],
    blocks: [
      { type: "p", text: "When dispatch gives you a job it appears under **New offers** on the Jobs tab, with the address, notes, time and price. Tap **Accept** to take it; it moves to **Up next** (or **In progress** once you start). Tap **Decline** to pass." },
      { type: "p", text: "A declined job goes straight back to the dispatch queue and the office is told (\"It's back in the dispatch queue.\"). It isn't offered to anyone else automatically; your dispatcher picks the next person." },
      { type: "p", text: "Already accepted and can't do it? Open the job and tap **Send back to dispatch**, then pick a reason: Personal emergency, Vehicle breakdown, Running too late to make it, Missing parts or equipment, Unsafe site conditions, Wrong skill set for this job, or Other. The office sees the reason and reassigns." },
      { type: "p", text: "Once you're on a job the buttons run in order: **Start Driving**, **I've Arrived** (the geofence usually does this for you), **Complete Job**. See [On the way, running late and arrival](/support/on-the-way-and-arrival)." },
    ],
  },
  {
    slug: "use-arriveping-in-a-browser",
    title: "No iPhone? Use ArrivePing in a browser",
    summary: "The app is for iPhone and iPad. On an Android phone or any other device, sign in at arriveping.com and work your jobs from the web version.",
    category: "technician-app",
    updated: U3,
    keywords: ["android", "web app", "browser", "no app", "samsung", "pixel", "laptop", "which phones", "devices supported"],
    blocks: [
      { type: "p", text: "The ArrivePing app is built for iPhone and iPad, and there is no Android app in Google Play yet. If you carry an Android phone or want to work from a laptop, open [arriveping.com/sign-in](/sign-in) in your browser and sign in with the email your company invited. You land in the web version of the technician app." },
      {
        type: "ul",
        items: [
          "**My Jobs** lists your offers and the day's work; **Earnings** and **Profile** are the same as in the app.",
          "Choose **Go online** when your shift starts so dispatch can see you, and keep the page open while you're driving so your position and the customer's ETA keep updating.",
          "Work the job the same way: **Start job**, then **Start driving**, **I've arrived**, **Begin service** and **Complete job**. Location sharing to the customer begins when you start driving. If the job collects payment on site, the payment step appears once you've arrived.",
        ],
      },
      { type: "p", text: "Office staff always use the browser; the dispatch dashboard isn't in the app." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Dispatch & scheduling                                              */
  /* ---------------------------------------------------------------- */
  {
    slug: "assigning-jobs",
    title: "How jobs get assigned (and how to override it)",
    summary: "ArrivePing ranks your technicians for every job and a dispatcher confirms. Add an assignment rule when you want some jobs assigned on their own.",
    category: "dispatch",
    updated: U3,
    keywords: ["auto assign", "dispatch", "reassign", "automation rules", "licensed", "qualified", "best match", "suggestion", "offer"],
    blocks: [
      { type: "p", text: "Out of the box, nothing is assigned without a person. For every unassigned job ArrivePing ranks your technicians on distance, the skill class and skills the job requires, their open jobs and when they are projected to be free. A technician finishing up nearby can outrank one who is free but far away, and High or Urgent jobs lean harder on who can go now. The ranking shows as **Best match** on the job and as **Find a slot** in the Scheduler." },
      { type: "p", text: "When you pick someone, the job reaches them as an offer in the app. They tap **Accept**, or **Decline** to send it straight back to the queue; see [When a technician declines or sends a job back](/support/job-offers-accept-decline)." },
      { type: "h3", text: "Overriding" },
      { type: "p", text: "Dispatchers can reassign any job: open it from Operations → Jobs or drag it onto another technician in Operations → Scheduler. The technician is notified and the customer's booking details update. Dropping a job on someone without the required skill class asks you first." },
      { type: "h3", text: "Letting a rule assign for you" },
      { type: "p", text: "Setup → Settings → **Automation & AI** holds your assignment rules: nearest available tech, round-robin, zone owner or load balance. Each rule starts by suggesting; a separate switch turns on auto-assign. Many teams run with suggestions for a week and switch on auto-assign once they trust them. See [Assignment rules](/support/assignment-rules)." },
      { type: "p", text: "Skill classes and skills (gas fitter, licensed electrician, and so on) are set on the technician in People → Technicians & Managers and required on each job. See [Send only qualified technicians](/support/skills-and-skill-classes)." },
    ],
  },
  {
    slug: "assignment-rules",
    title: "Assignment rules: nearest, round-robin, zone owner and load balance",
    summary: "Four ways to hand out unassigned jobs on their own. Each rule suggests first; auto-assign is a separate switch.",
    seoTitle: "Job Assignment Rules: Nearest, Round-Robin, Zone and Load",
    category: "dispatch",
    updated: U3,
    keywords: ["auto allocation", "auto dispatch", "automatic assignment", "round robin", "nearest", "zone", "load balance", "rota", "rotation", "automation"],
    blocks: [
      { type: "p", text: "Open **Setup → Settings → Automation & AI** and look under Templates for **Assignment** (\"Who gets the job. Suggests by default — auto-assign is a separate switch.\"). Pick the rule that matches how you'd hand out work yourself:" },
      {
        type: "ul",
        items: [
          "**Nearest available tech.** The closest technician who is free, with fewest open jobs as the tiebreak. Options: **Ignore techs farther than (km)** (60 km to start) and **Technician must match the job's skill class**.",
          "**Round-robin.** Takes turns. **Rotate among** the whole team, techs with the job's skill class, a roster per service zone, or a hand-picked list, with **Skip techs who are offline or busy** if you want.",
          "**Zone owner.** One technician owns each service zone and gets its jobs. For a **Job outside every mapped zone**, choose **Leave it for the office** or **Use the nearest available tech**. See [Service zones](/support/service-zones).",
          "**Load balance.** Whoever has the fewest open stops, then whoever is free soonest, then distance.",
        ],
      },
      { type: "p", text: "Any rule can be narrowed with **Only for jobs with priority** (for example, only Urgent) or **Only for jobs needing this skill class**, so you can automate the emergencies and keep routine work by hand, or the other way round." },
      { type: "h3", text: "Suggest first, then auto-assign" },
      { type: "p", text: "A new rule only suggests: the office gets a notification naming the technician, and you assign from the Scheduler to confirm. When you're ready, switch the rule to auto-assign (you'll be asked to confirm **Turn on auto-assign**). Jobs a rule assigned carry a purple **A** badge so you can always tell them apart." },
      { type: "p", text: "Rules only touch unassigned jobs that are Pending or Confirmed. They never double-book a technician and never assign over recorded time off. A declined job goes back to the queue rather than to the next technician, so keep an eye on **To schedule** in the Scheduler." },
    ],
  },
  {
    slug: "skills-and-skill-classes",
    title: "Send only qualified technicians: skill classes and skills",
    summary: "Give each technician a skill class and skill tags, require them on the job, and the wrong person is never suggested first.",
    category: "dispatch",
    updated: U3,
    keywords: ["tags", "skills", "licence", "license", "certification", "gas", "electrician", "plumber", "qualified", "skill class", "specialist"],
    blocks: [
      { type: "p", text: "Two layers describe what a technician can do. **Skill class** is one per technician: General, HVAC, Electrical, Plumbing, Appliance, Carpentry or Landscaping. **Skills** are tags you write yourself, such as gas fitter, EPA 608 or backflow tester. Use skills for trade licences and tickets; the **License #** field on a profile is the driver's licence." },
      { type: "h3", text: "On the technician" },
      { type: "p", text: "Open **People → Technicians & Managers**, open the technician and set **Skill class** and **Skills** (\"Pick from the library or type a new skill and press Enter\"). Both can be filled from your spreadsheet when you import; see [Import your existing customers and team](/support/import-customers-and-team)." },
      { type: "h3", text: "On the job" },
      { type: "p", text: "In the job form, set **Required skill class** (Any, or one class) and **Required skills**. If you leave both empty, the service's category stands in." },
      { type: "h3", text: "What it changes" },
      {
        type: "ul",
        items: [
          "The technician list on the job is filtered to the required skill class, and the ranking puts qualified people first.",
          "Assignment rules set to **Technician must match the job's skill class** skip everyone else. See [Assignment rules](/support/assignment-rules).",
          "Dropping a job on an unqualified technician in the Scheduler or Map asks you to confirm, so the override is yours, not an accident.",
        ],
      },
    ],
  },
  {
    slug: "priorities",
    title: "Mark a job urgent",
    summary: "Low, Normal, High or Urgent. Priority steers suggestions toward who can go now and can switch on a rule for emergencies only.",
    category: "dispatch",
    updated: U3,
    keywords: ["emergency", "no heat", "burst pipe", "priority", "urgent", "high priority", "same day"],
    blocks: [
      { type: "p", text: "Every job has a **Priority**: Low, Normal, High or Urgent. Set it when you book the job or change it later with **Edit Job**." },
      {
        type: "ul",
        items: [
          "For High and Urgent jobs, the ranking favours the technician who can go now over the one who is merely closest.",
          "An assignment rule can be limited with **Only for jobs with priority**, so emergencies assign themselves while routine work waits for a dispatcher. See [Assignment rules](/support/assignment-rules).",
          "The **Urgent job → alert the office** automation template under Setup → Settings → Automation & AI notifies the office the moment an Urgent job is created, including from an intake form.",
        ],
      },
      { type: "p", text: "If an urgent job bumps someone else's appointment, move that job in the Scheduler; the customer gets an updated confirmation. See [Handling a day that runs late](/support/running-late)." },
    ],
  },
  {
    slug: "live-map",
    title: "See your whole team on the live map",
    summary: "Operations → Map shows every technician on the clock, their status and current job, and where they are heading.",
    category: "dispatch",
    updated: U3,
    keywords: ["fleet", "gps", "where is", "map", "offline", "available", "en route", "on site"],
    blocks: [
      { type: "p", text: "Open **Operations → Map**. Each technician who is On the clock appears with a live position and one of six statuses: **Available**, **En Route**, **On Site**, **Busy**, **Break** or **Offline**. Technicians who have gone off the clock show dimmed at their last known position so you can see who finished where; their location is not tracked while they are off the clock and is kept only as part of the job record." },
      { type: "p", text: "Use the map to answer the \"where is my tech?\" call in seconds, or to pick the right person for a same-day emergency: drag the job onto a technician's marker. The route a technician drove to a job is kept with that job's record." },
    ],
  },
  {
    slug: "job-statuses",
    title: "What each job status means",
    summary: "Pending, Confirmed, Assigned, En route, On site, In progress, Paused, Completed, Cancelled, and who moves a job between them.",
    category: "dispatch",
    updated: U3,
    keywords: ["status", "pending", "confirmed", "assigned", "en route", "on site", "in progress", "completed", "cancelled", "change status", "stuck"],
    blocks: [
      {
        type: "ul",
        items: [
          "**Pending.** Booked but not yet confirmed; intake form submissions arrive here. See [Let customers book online](/support/online-booking-forms).",
          "**Confirmed.** On the books, no technician yet. Shows under **To schedule** in the Scheduler.",
          "**Assigned.** Offered to or accepted by a technician.",
          "**En route.** The technician tapped **Start Driving**. The customer's on-the-way message and tracking link go out now.",
          "**On site.** The geofence or **I've Arrived** recorded arrival. The on-site clock is running and the customer's page stops showing location.",
          "**In progress** and **Paused.** Work under way, or set down for a while.",
          "**Completed.** The technician tapped **Complete Job**, after any required checklist items. Photos, signature and time on site are on the record.",
          "**Cancelled.** The job won't happen. The customer's tracking page says so.",
        ],
      },
      { type: "p", text: "Filter **Operations → Jobs** by All, Pending, Confirmed, Assigned, In progress, Completed or Cancelled. Statuses change as the technician works the job; the office doesn't set them by hand. If a job seems frozen in one status, see [A job or technician looks stuck](/support/job-or-technician-looks-stuck)." },
    ],
  },
  {
    slug: "edit-archive-restore-job",
    title: "Edit, reschedule, archive or restore a job",
    summary: "Change anything on a job until it's done, move it in the Scheduler, and archive rather than delete; archived jobs can come back.",
    category: "dispatch",
    updated: U3,
    keywords: ["edit job", "delete job", "cancel job", "duplicate", "copy job", "archive", "restore", "bulk import jobs", "csv jobs", "change time"],
    blocks: [
      {
        type: "ul",
        items: [
          "**Edit.** Open the job and choose **Edit Job**; change the customer, address, time window, priority, required skills, pay or anything else, then **Save and Close**. Editing works after assignment too. If a technician is already working the job, moving it to someone else asks you first.",
          "**Reschedule.** Drag the job along its row in Operations → Scheduler, or edit the time. The customer gets an updated confirmation once the change sticks; see [Plan the day in the Scheduler](/support/scheduler-views).",
          "**Archive.** Choose **Archive** on the job's row, or **Delete Job** inside the job form. Both move the job to the archive rather than erasing it (\"It moves to the archive and can be restored later\"). Let the customer know before you archive a booked job.",
          "**Restore.** Open the archive and choose **Restore**; the job comes back with its history.",
        ],
      },
      { type: "p", text: "Two things the dashboard doesn't do yet: duplicate a job, and import jobs from a spreadsheet (customers and technicians import; jobs don't). For work you book over and over, build it as a template under **Catalog & Forms → Job Templates** so a new job is two clicks, and give customers an [intake form](/support/online-booking-forms) so they book it themselves." },
    ],
  },
  {
    slug: "service-zones",
    title: "Service zones: coverage areas and zone-based assignment",
    summary: "Draw the areas you serve. Jobs outside active zones are refused, zone-owner and round-robin rules use them, and the Zone Breakdown report counts by zone.",
    category: "dispatch",
    updated: U3,
    keywords: ["geofence", "coverage area", "territory", "zone", "service area", "out of area", "outside zone"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **Setup → Service Zones**.",
          "Draw a **Polygon**, **Rectangle** or **Circle** on the map, give it a **Zone name** and a **Color**, and leave **Zone active** on.",
          "Save, and repeat for each area you serve.",
        ],
      },
      { type: "p", text: "Once any zone is active, a job whose address falls outside every active zone is refused with \"Address is outside all active service zones\", in the dashboard and on intake forms alike. If you'd rather take any address, don't activate zones." },
      {
        type: "ul",
        items: [
          "The **Zone owner** assignment rule gives each zone's jobs to the technician who owns it, and **Round-robin** can rotate through a roster per zone. See [Assignment rules](/support/assignment-rules).",
          "**Money → Reports → Zone Breakdown** shows jobs and revenue per zone.",
        ],
      },
    ],
  },
  {
    slug: "maintenance-plans",
    title: "Maintenance plan reminders",
    summary: "Set a recurring interval for an address and ArrivePing reminds the office when the next visit is due. It doesn't book the job for you.",
    category: "dispatch",
    updated: U3,
    keywords: ["recurring", "repeat job", "maintenance agreement", "tune-up", "service plan", "contract", "reminder", "every month"],
    blocks: [
      { type: "p", text: "ArrivePing has no repeating job. What it has is a reminder: **People → Maintenance Plans → New plan**." },
      {
        type: "ol",
        items: [
          "Give the plan a **Plan name** and the service **Address**.",
          "Set **How often**: Monthly, Quarterly, Twice a year, Yearly, or an interval in days.",
          "Set **Remind days before** (7 to start), the **First due date** and any **Notes**, then **Create plan**.",
        ],
      },
      { type: "p", text: "When a visit comes due, admins get an alert in the dashboard and the plan's due date rolls forward to the next interval. Book the visit as a job in the usual way, and choose **Mark serviced** on the plan when it's done. Plans can be paused or deleted from their row." },
      { type: "p", text: "A plan reminds your office; it doesn't create the job or text the customer by itself. If you'd like it to, tell us at [contact@nvc360.com](mailto:contact@nvc360.com)." },
    ],
  },
  {
    slug: "route-planning",
    title: "Does ArrivePing plan multi-stop routes?",
    summary: "No. It's built for appointment work: the best technician for each job, drive time in the Scheduler, and a live ETA for each customer.",
    category: "dispatch",
    updated: U3,
    keywords: ["route optimization", "route optimisation", "routing", "multi-stop", "sequence", "stops", "parcel", "courier"],
    blocks: [
      { type: "p", text: "ArrivePing dispatches one appointment at a time: a technician, a customer, an address and a window. It does not re-sequence a day's stops into an optimal loop, so a parcel or courier fleet is better served by a routing tool." },
      {
        type: "ul",
        items: [
          "The **Nearest available tech** rule and the job's ranked technician list weigh distance for you. See [Assignment rules](/support/assignment-rules).",
          "The Scheduler's **Day** view shows the drive between each technician's jobs and flags overlaps; **Find a slot** ranks openings by drive time. See [Plan the day in the Scheduler](/support/scheduler-views).",
          "The customer's ETA comes from the technician's live position and the roads between them, and updates as they drive.",
        ],
      },
    ],
  },
  {
    slug: "message-technicians",
    title: "Message one technician or your whole crew",
    summary: "Direct messages from any dashboard screen, a broadcast to everyone or a group, and a per-job thread the customer is part of.",
    category: "dispatch",
    updated: U3,
    keywords: ["announcement", "broadcast", "chat", "inbox", "message all", "group message", "notify technicians", "memo"],
    blocks: [
      { type: "p", text: "The **Messages** panel is on every dashboard screen. Pick a technician and type; it reaches them as a push notification and in the app's **Messages** tab (\"Direct line to your dispatcher\")." },
      { type: "p", text: "To reach several people at once, use the **Broadcast** button in the same panel and choose who: **All**, **Available only**, a **Tag**, a **Skill class** or a **Skill**. Use it for a weather call, a parts recall or \"everyone back to the shop by four\". Broadcasts are delivered in the app with a push notification and listed under **Broadcasts** in **Operations → Inbox**, alongside All, Unread, Customers and Technicians." },
      { type: "p", text: "Each job also has its own thread, shared by the customer, the technician and the office. Whatever the customer writes on their tracking page (\"Anything you send here goes straight to your technician\") lands on the job, and replies from the technician or the office are texted back to the customer with the link. Gate codes and \"use the side door\" stay with the job instead of in someone's phone." },
    ],
  },
  {
    slug: "technician-shifts-and-time-off",
    title: "Record technician shifts and time off",
    summary: "Add shifts and days off on each technician's profile. Time off blocks assignment (with an override); shift hours are a planning note.",
    category: "dispatch",
    updated: U3,
    keywords: ["schedule", "working hours", "availability", "vacation", "day off", "holiday", "roster", "shift", "time off", "unavailable"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **People → Technicians & Managers**, open the technician and choose the **Shifts** tab.",
          "Set **Type** to **Shift** or **Time off**, pick the **Date**, add **Start** and **End** for a shift and an optional **Note**, then **Add**.",
        ],
      },
      { type: "p", text: "**Time off** covers the whole day. Assigning a job to someone on time off shows a warning, which a dispatcher can override; assignment rules never assign over it. Double-booking a technician warns the same way." },
      { type: "p", text: "**Shifts** are there so the office can see who is meant to be working; a job outside shift hours isn't blocked. Technicians can't edit shifts in the app. The app's **On the clock** switch is live presence (sharing location, ready for offers), not a schedule." },
    ],
  },
  {
    slug: "running-late",
    title: "Handling a day that runs late",
    summary: "The Running Late board shows which customers will be affected before they call.",
    description: "The Running Late board shows which customers a slipping day will affect before they call, and running-late messages carry the new arrival window.",
    category: "dispatch",
    updated: U,
    keywords: ["delay", "behind schedule", "eta slipped", "reschedule"],
    blocks: [
      { type: "p", text: "When a technician's projected arrival moves past the customer's window, the job surfaces on the dashboard's **Running Late** board. The customer automatically receives the running-late message with their new arrival window, so most of these resolve without a phone call." },
      { type: "p", text: "If the delay is too long, reassign the job to a technician who is finishing nearby, or move it in the Scheduler. Either action sends the customer an updated confirmation." },
      { type: "p", text: "Customer requests to cancel a job, or to move one close to its time, collect in **Operations → Change Requests**. A cancellation never takes effect until someone in the office approves it, so a truck never rolls to a job the customer thinks is cancelled. See [Let customers move or cancel their own appointment](/support/customer-self-service)." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Customer notifications                                             */
  /* ---------------------------------------------------------------- */
  {
    slug: "scheduler-views",
    title: "Plan the day in the Scheduler",
    summary: "Calendar puts every technician on a row with the day's hours across; Week and Month show how full the days are. To schedule holds jobs nobody has yet.",
    category: "dispatch",
    updated: U2,
    keywords: ["calendar", "day view", "week view", "month view", "board", "work queue", "to schedule", "unassigned", "drag", "undo", "find a slot"],
    blocks: [
      { type: "p", text: "Open **Operations → Scheduler**. Two switches at the top change how you see the same jobs:" },
      {
        type: "ul",
        items: [
          "**Board or Calendar.** Board gives each technician a lane of their open jobs. Calendar puts every technician on a row with the day's hours across.",
          "**Day, Week or Month.** Day shows each technician's jobs, the drive between them, and any overlaps. Week shows how full each technician's days are. Month shows how busy the whole team is each day; click a day to open its week.",
        ],
      },
      { type: "p", text: "**To schedule** lists every job still waiting for a technician. Drag one onto a technician's row at the time you want, or press **Find a slot**: the best three fits light up in green, ranked by skill, drive time and how full each day is. Click one to book it." },
      { type: "p", text: "Drag a booked job along its row to change the time, or onto another row to give it to someone else. After a change you have a few seconds to press **Undo**; the customer and technician are only told once the change sticks. Moving a job to a different technician asks first and tells them straight away." },
      { type: "p", text: "**New Job** opens the booking form with the date already filled in." },
    ],
  },
  {
    slug: "what-customers-receive",
    title: "What your customers receive and see",
    summary: "A text or email per milestone, and a live tracking page that needs no app or account.",
    description: "Customers get a text or email when a job is booked, on the way, running late and arrived, plus a live tracking page that needs no app or account.",
    category: "customer-notifications",
    updated: U,
    keywords: ["tracking link", "sms", "email", "customer page", "eta"],
    blocks: [
      { type: "p", text: "Customers get a message when a job is booked, when the technician is on the way, if the technician is running late, and when the technician arrives. Messages go by SMS, email, or both, depending on what you turned on in Setup → Notifications." },
      { type: "p", text: "The on-the-way message carries a link that opens a live tracking page in the customer's browser. It shows the technician on the way, the ETA, and buttons to text or call them. There is nothing to install and no account to create." },
      { type: "p", text: "The page only ever shows the technician's progress toward that customer's own appointment, and only while the technician is travelling to it. Once the technician arrives, the page confirms the arrival and stops showing location." },
      { type: "p", text: "Every job has its own link, so a customer never sees another customer's address, even when one technician is doing several jobs on the same street. After the job is complete the same link shows \"Job complete\", a chance to rate the visit, the service record (service, scheduled and completed times, time on site, address), photos, the sign-off and the job's timeline; there's no map. If a job is cancelled, the page says so." },
    ],
  },
  {
    slug: "online-booking-forms",
    title: "Let customers book online with an intake form",
    summary: "Publish a branded form on a link or inside your website. Submissions arrive as Pending jobs, ready to dispatch.",
    category: "customer-notifications",
    updated: U3,
    keywords: ["booking form", "online booking", "request form", "lead form", "website form", "embed", "iframe", "customer app", "book online", "work order form", "pin"],
    blocks: [
      { type: "p", text: "Customers don't need an app or an account to book you. Open **Catalog & Forms → Intake Forms** and choose **New lead form**." },
      {
        type: "ol",
        items: [
          "Give it a **Form title**, a **URL slug** and some **Intro text**. Add your **Logo** and **Brand color** so it looks like yours, and write the **Success message** the customer sees after sending.",
          "Choose the fields. The form starts with Full name, Email, Phone, Service address, Service type, Preferred date, Notes / describe the problem and Photo upload; mark each one **Show** and **Req** as you like.",
          "Set the **Recipient name/email** that is told about each submission, switch the form to **Active**, and open **Share & embed** for the direct link or the code to drop into your website.",
        ],
      },
      { type: "p", text: "Each submission creates a job in **Pending**, with the customer, address and notes already filled in, and emails the recipient. Nothing is dispatched until the office confirms and assigns it. An address outside your active service zones is refused on the form; see [Service zones](/support/service-zones). An Urgent request can alert the office straight away; see [Mark a job urgent](/support/priorities)." },
      { type: "h3", text: "A form for your own staff" },
      { type: "p", text: "**New work order form** makes a PIN-protected form for your employees (\"Employee access\"). Someone at the counter or on site enters the PIN, can pick the technician and the time, and the job is created Confirmed or Assigned, skipping the Pending step." },
      { type: "p", text: "Customers who sign in to their ArrivePing customer portal can also book from there: choose a time from the open slots on your calendar, confirm the address, and the job is created Confirmed." },
    ],
  },
  {
    slug: "customer-self-service",
    title: "Let customers move or cancel their own appointment",
    summary: "Two switches and a cutoff under Setup → Settings → Company. Moves outside the cutoff just happen; cancellations always wait for the office.",
    category: "customer-notifications",
    updated: U3,
    keywords: ["reschedule", "cancel", "change request", "customer portal", "cutoff", "self-serve", "approve", "decline"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **Setup → Settings → Company** and find **Customer self-service**.",
          "Turn on **Let customers move their own appointment** and, if you want, **Let customers send a cancellation request**.",
          "Set the **Approval cutoff (hours before the appointment)**. It starts at 12; set 0 to let customers move any appointment themselves.",
        ],
      },
      { type: "p", text: "Customers see the options when they sign in to their customer portal (\"Need to change this?\" and \"Need to cancel?\"); they aren't on the public tracking link. Once the technician has tapped Start Driving, both are closed and the page asks the customer to call the office." },
      {
        type: "ul",
        items: [
          "**A move outside the cutoff** is applied on the spot. The job changes time, the technician is told, and the request is listed as **Done by customer**.",
          "**A move inside the cutoff** becomes a request for the office.",
          "**A cancellation** is always a request. The customer is told their appointment stays booked until you confirm.",
        ],
      },
      { type: "p", text: "Requests collect in **Operations → Change Requests** (the menu shows how many need a decision). Filter by Needs a decision, All, Approved, Declined or Self-serve, then choose **Approve new time**, **Approve cancellation** or **Decline**, with a note to the customer (\"What should we tell them?\")." },
    ],
  },
  {
    slug: "customize-messages",
    title: "Customize the on-my-way and other messages",
    summary: "The setup agent drafts them in your voice; edit the wording any time under Setup → Notifications.",
    description: "The setup agent drafts your booking, on-the-way, running-late and arrived messages in your voice. Edit any of them under Setup → Notifications.",
    category: "customer-notifications",
    updated: U,
    keywords: ["template", "wording", "business name", "sms text", "edit message", "change the text", "on the way text", "customer text", "technician on the way message", "rewrite"],
    blocks: [
      { type: "p", text: "During onboarding, ArrivePing drafts your booking, on-the-way, running-late and arrived messages in your voice, including your business name and how the technician is introduced." },
      { type: "p", text: "To change them, open **Setup → Notifications**. Each milestone has its own SMS and email text, and you can turn individual messages off. Changes apply to the next message sent; messages already delivered are not altered." },
      { type: "p", text: "Keep the tracking link in the on-the-way message; without it the customer has no way to see the ETA or contact the technician." },
    ],
  },
  {
    slug: "custom-milestones",
    title: "Add your own milestone",
    summary: "Name a moment like \"Water restored\" or a day-before reminder, choose what sets it off, and who gets a message.",
    category: "customer-notifications",
    updated: U3,
    keywords: ["custom milestone", "own milestone", "new milestone", "reminder", "day before", "follow up", "checklist", "stage", "custom step"],
    blocks: [
      { type: "p", text: "Besides the built-in milestones (booked, on the way, arrived, completed and the rest), you can add moments that matter to your business. Open **Setup → Notifications** and click **New milestone**." },
      {
        type: "ol",
        items: [
          "**Name it** the way your customers would say it, for example \"Water restored\" or \"Day-before reminder\".",
          "**Choose what sets it off.** A stage (when the tech arrives, when the job is completed and so on), a checklist item the tech ticks, a set time before the appointment, or a set time after the job is completed.",
          "**Write the messages.** Tick the customer, the technician or the office and write what each receives. Insert live details like the customer's first name or the tracking link.",
          "**Choose whether it shows on the customer's tracking page** as a line on the job's timeline.",
        ],
      },
      { type: "p", text: "Your milestone then appears in the notifications table with the built-in ones, where you can switch text, email and app alerts on or off for each recipient, edit the wording, design a branded email or send a test." },
      {
        type: "ul",
        items: [
          "Each milestone goes out **once per job**. Unticking and re-ticking a checklist item doesn't send it again.",
          "A reminder before the appointment goes out again if the appointment is rescheduled, so the customer hears about the new time.",
          "Timed milestones go out within a minute of their moment, and are skipped if that moment passed more than an hour ago, so an old job never gets a sudden message.",
          "A checklist milestone matches the item's wording, ignoring capitals and extra spaces. Use the same wording as in your job templates.",
          "Sample jobs show the milestone on their timeline but never send anything.",
        ],
      },
      { type: "p", text: "To pause a milestone, open it and switch it off. Deleting it removes its messages; lines already on job timelines stay." },
    ],
  },
  {
    slug: "check-what-was-sent",
    title: "Check whether a message was sent",
    summary: "The Delivery Log under Setup → Notifications lists every text, email, app alert and webhook, with its status.",
    category: "customer-notifications",
    updated: U2,
    keywords: ["delivery log", "sent", "delivered", "history", "message log", "failed", "proof"],
    blocks: [
      { type: "p", text: "Open **Setup → Notifications** and choose the **Delivery Log** tab. Each row shows when it went, the milestone, who it was for, the channel (in-app, email, SMS or webhook), the address or number, and the status:" },
      {
        type: "ul",
        items: [
          "**sent:** handed to the email or text provider.",
          "**failed:** the provider refused it, often a wrong number or a bad email address.",
          "**skipped:** text messaging isn't set up for your account yet.",
        ],
      },
      { type: "p", text: "Messages held back by **quiet hours** or a master switch don't appear here, because nothing was sent. If a message shows as sent but the customer says it never arrived, see [A customer didn't get their text or email](/support/customer-did-not-get-the-text)." },
    ],
  },
  {
    slug: "quiet-hours",
    title: "Stop texts and emails going out overnight",
    summary: "Quiet hours skip the channels you choose between two times. Messages due then are not sent later.",
    description: "Quiet hours skip the channels you choose, such as SMS and email, between two times in your time zone. Messages due then are not sent later.",
    category: "customer-notifications",
    updated: U2,
    keywords: ["night", "overnight", "do not disturb", "weekend", "after hours", "master switch", "turn off texts"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **Setup → Notifications** and choose the **Channels** tab.",
          "Turn on **Quiet hours** and set the start and end times. They follow your company's time zone.",
          "Choose the channels that go quiet, for example SMS and Email, then **Save settings**.",
        ],
      },
      { type: "p", text: "During quiet hours those channels are skipped. Nothing is queued for the morning, so a booking confirmation due at 11 pm is simply not sent. To stop a channel completely, use its master switch on the same tab." },
    ],
  },
  {
    slug: "set-your-reply-to-email",
    title: "Set your reply-to email",
    summary: "Choose the name customers see on emails and the inbox their replies land in.",
    description: "Choose the from name customers see on ArrivePing emails and the inbox their replies land in, and verify your own domain if you want to.",
    category: "customer-notifications",
    updated: U,
    keywords: ["reply-to", "reply to", "sender", "from name", "from address", "email address", "domain", "dns", "verify"],
    blocks: [
      { type: "p", text: "Open **Setup → Notifications → Channels**. The **Email sender** card controls every email ArrivePing sends for your company." },
      {
        type: "ol",
        items: [
          "**From name**: the name customers see, usually your business name.",
          "**Reply-to**: the inbox a customer's reply goes to. Use one someone reads every day.",
          "**From address**: optional. Only used once its domain is verified (below).",
          "Type your own email under **Send a test** and send one. It saves your changes first, then shows you exactly what customers receive.",
        ],
      },
      { type: "p", text: "Until you verify a domain, emails are sent as \"Your business via ArrivePing\" from our address, and replies still go to your reply-to. That works with any inbox, including Gmail, Outlook and iCloud." },
      { type: "h3", text: "Send from your own address" },
      { type: "p", text: "To send from an address like office@yourbusiness.com, add **yourbusiness.com** under the sending domains on the same card. Once it's approved, the DNS records to add appear there. Add them where your domain is hosted (GoDaddy, Namecheap, Cloudflare and so on); it verifies itself within minutes. Public mailbox domains such as gmail.com can't be verified, because their owners control the DNS." },
    ],
  },
  {
    slug: "design-your-emails",
    title: "Design your notification emails",
    summary: "Lay out any notification email with arrival times, the technician card and buttons, and set one look for every email you send.",
    category: "customer-notifications",
    updated: U,
    keywords: ["email design", "email designer", "branded email", "html email", "logo", "theme", "template", "eta", "technician card", "columns", "social links", "font", "colour", "color"],
    blocks: [
      { type: "p", text: "Every email goes out in your branded frame: your logo, colours and footer. A **simple message** puts the message text inside that frame. A **designed email** lets you lay it out yourself." },
      { type: "h3", text: "Design one email" },
      {
        type: "ol",
        items: [
          "Open **Setup → Notifications**, find the event (for example **En route**) and choose **Edit**.",
          "Under **Email format**, choose **Designed email**. The email designer opens with a ready-made layout for that message.",
          "Click any part of the email to change it in the panel on the right. Drag blocks from the left onto the email, or drag the handle on a block to move it. **Undo** works for everything.",
          "On the **Email** tab, set the subject and the **preview text** (the grey line after the subject in the inbox). Pick a different starting point under **Templates**, or write a sentence under **Describe it** and let AI draft it.",
          "Use **Phone** to see it on a small screen and **Preview** for the exact email. **Send a test** to your own inbox, then choose **Save & apply**.",
        ],
      },
      { type: "p", text: "Blocks include headings, text with bold, links and lists, buttons, pictures, a details table, a highlighted note, a big **ETA banner**, a **technician card** with their photo and name, two columns that stack on phones, and your social links. Fill-ins like the customer's first name and the arrival time are added with **Insert**." },
      { type: "h3", text: "One look for every email" },
      { type: "p", text: "The **Theme** tab (also on **Channels → Email look**) sets your logo, brand colour, header style, font, corners, button shape, background and social links. It applies to every email your company sends, designed or simple. Pale brand colours automatically get dark buttons so they stay readable." },
      { type: "p", text: "Logos should be PNG or JPG: Gmail and Outlook don't show SVG images." },
    ],
  },
  {
    slug: "sms-consent",
    title: "SMS consent and Canadian CASL rules",
    summary: "Appointment updates are transactional messages about a service the customer booked; keep promotions in a separate, opted-in channel.",
    category: "customer-notifications",
    updated: U,
    keywords: ["casl", "tcpa", "opt in", "unsubscribe", "consent", "compliance"],
    blocks: [
      { type: "p", text: "ArrivePing sends appointment notifications (booked, on the way, running late, arrived) about a service the customer asked for. You collect the customer's mobile number and their consent to appointment updates when you book the job, and you keep any promotional messaging in a separate, opted-in channel." },
      { type: "p", text: "Customers can reply STOP to any SMS to opt out of texts; the job itself is unaffected and you can switch them to email. For your own obligations under CASL in Canada or the TCPA in the United States, get advice specific to your business." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Billing & plans                                                    */
  /* ---------------------------------------------------------------- */
  {
    slug: "free-trial",
    title: "How the 30-day free trial works",
    summary: "Every signup gets 30 days with unlimited users. A card is required but not charged until day 30, and you can cancel before then at no cost.",
    category: "billing",
    updated: U,
    keywords: ["trial", "credit card", "cancel", "charge", "day 30"],
    blocks: [
      {
        type: "ul",
        items: [
          "**Length:** 30 days from the day you sign up, with as many dispatch users and drivers as you want.",
          "**Card:** A payment card is taken at signup so service continues without interruption, but nothing is charged during the trial.",
          "**Cancelling:** Cancel any time before day 30 from Setup → Settings → **Billing** and you are never charged.",
          "**After the trial:** You are billed monthly at current pricing based on your driver count. See [How ArrivePing is priced](/support/pricing-and-seats).",
        ],
      },
      { type: "note", title: "Fees after the trial.", text: "Cancel before day 30 and you pay nothing. After the trial, plans are billed monthly and you can cancel any time; fees already charged are generally non-refundable, as the [Terms of Service](/terms) explain." },
    ],
  },
  {
    slug: "pricing-and-seats",
    title: "How ArrivePing is priced",
    summary: "US dollars, billed monthly, graduated by licence count. One dispatcher licence is included on every plan; extra office users are priced like a driver.",
    category: "billing",
    updated: U,
    keywords: ["cost", "price", "per driver", "per technician", "cost per technician", "how much", "monthly", "seat", "plan", "usd", "cad"],
    blocks: [
      { type: "p", text: "Plans are priced in US dollars and billed monthly, graduated like tax brackets so adding a driver never jumps your bill:" },
      {
        type: "ul",
        items: [
          "**Starter — $49/month:** one dispatch user and two drivers, with your workflow set up and catalog pre-loaded.",
          "**Growing team:** drivers 3–29 are $30 each per month.",
          "**Fleet:** every driver from 30 on is $25 per month. Teams of 30 or more also get custom integrations and live onboarding.",
        ],
      },
      { type: "p", text: "A driver is a field team member who uses the technician app to receive jobs and share their status — a technician, installer or delivery driver. Every company gets the same Starter package: one dispatcher licence and two driver licences. Need a second dispatcher or a manager? Each extra office user is a licence priced exactly like a driver, and you choose whether it has dispatch or manager permissions. There are no setup fees or contracts, and you can add or remove licences month to month. Current prices are always on the [pricing page](/pricing)." },
    ],
  },
  {
    slug: "add-or-remove-drivers",
    title: "Add or remove drivers from your plan",
    summary: "Inviting a technician adds a seat; deactivating one keeps their history and frees the seat.",
    description: "Inviting a technician adds a seat to your ArrivePing plan. Deactivating one frees the seat, ends their access and keeps their job history.",
    category: "billing",
    updated: U,
    keywords: ["deactivate", "remove technician", "add technician cost", "cost per technician", "seat count", "downsize", "offboard"],
    blocks: [
      { type: "p", text: "**To add:** invite the technician from People → Technicians & Managers. The seat is added to your plan from that point on." },
      { type: "p", text: "**To remove:** open the technician and choose **Deactivate**. Their jobs, photos and time on site stay in your records, their access ends immediately, and the seat comes off your plan. You can reactivate them later." },
      { type: "p", text: "If you lower the number of drivers from Setup → Settings → **Billing**, ArrivePing walks you through choosing who comes off the plan so nobody loses access by surprise." },
    ],
  },
  {
    slug: "update-payment-method",
    title: "Update your card or view invoices",
    summary: "Setup → Settings → Billing shows your plan, seat count, next invoice and the card on file.",
    description: "Setup → Settings → Billing shows your plan, driver count, next invoice and the card on file. Change the card there, or email support for an invoice.",
    category: "billing",
    updated: U,
    keywords: ["invoice", "receipt", "credit card", "payment failed", "billing email"],
    blocks: [
      { type: "p", text: "Open **Setup → Settings → Billing**. You can change the card on file and see your plan, current driver count and the date and amount of the next invoice. Need a copy of a past invoice? Email [support@nvc360.com](mailto:support@nvc360.com) with your company name." },
      { type: "p", text: "If a payment fails, the Billing tab shows **Payment failed** until the card is updated or retried. For a question about a specific charge, email the same address." },
    ],
  },
  {
    slug: "what-you-are-billed-for",
    title: "What you're billed for (and what you aren't)",
    summary: "Licences only. There is no per-job fee and no cap on jobs, customers or form submissions, and archiving a job changes nothing.",
    category: "billing",
    updated: U3,
    keywords: ["per job", "per task", "job limit", "usage", "overage", "deleted jobs billed", "cancelled jobs billed", "fees", "what costs extra"],
    blocks: [
      { type: "p", text: "Your ArrivePing bill is the number of licences on your plan, once a month: the dispatcher licence that comes with Starter, two driver licences, and one more for each extra technician or office user. See [How ArrivePing is priced](/support/pricing-and-seats)." },
      {
        type: "ul",
        items: [
          "**No per-job charge.** Book ten jobs a day or two hundred; the bill is the same. Cancelled, archived and restored jobs don't count for or against anything.",
          "**No caps** on customers, jobs, intake form submissions, photos or reports.",
          "**No platform cut on card payments.** When a customer pays through your own Stripe account, Stripe's processing fee goes to Stripe and ArrivePing takes nothing. See [Take card payments through your own Stripe account](/support/take-payments-with-stripe).",
          "**A licence you free up stops billing.** Deactivate a technician and their licence comes off your plan; their history stays. See [Add or remove drivers from your plan](/support/add-or-remove-drivers).",
        ],
      },
      { type: "p", text: "Your current licence count and next invoice are under **Setup → Settings → Billing**." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Money & payments                                                   */
  /* ---------------------------------------------------------------- */
  {
    slug: "technician-pay",
    title: "How technician pay is calculated",
    summary: "On-site hours times the hourly rate, plus mileage, plus a flat amount per job, plus any per-unit line pay. Set rates once per technician and override per job or template.",
    description: "Technician pay is on-site hours times the hourly rate, plus mileage, a flat amount per job and any per-unit pay. Set rates once and override per job.",
    category: "money",
    updated: U3,
    keywords: ["pay rate", "hourly", "mileage", "flat rate", "piece rate", "earnings", "wages", "commission", "tech pay", "driver pay"],
    blocks: [
      { type: "p", text: "For every completed job ArrivePing works out what the technician earned: **time on site × their hourly rate**, plus **paid distance × their mileage rate**, plus a **flat amount per job**, plus any **per-unit pay** on the job's line items. Time on site runs from arrival (the geofence or **I've Arrived**) to **Complete Job**, to the minute." },
      { type: "h3", text: "Each technician's own rates" },
      { type: "p", text: "Open **People → Technicians & Managers**, open the technician and set **Pay rate per hour** (\"Used to compute tech pay from on-site time\") and **Mileage pay rate** (leave 0 to not pay mileage). The hourly rate can also come in from your spreadsheet when you import." },
      { type: "h3", text: "Per job or per template" },
      { type: "p", text: "The job form and each template under **Catalog & Forms → Job Templates** (its **Pricing & pay** tab) have a **Technician pay** block, marked internal and never shown to the customer. Set **Hourly (time on site)**, **Mileage** and **Flat per job**; a blank field means the technician's own rate. **Unpaid distance per job** lets you leave the first few kilometres unpaid. **Reset to each technician's own rates** clears the overrides." },
      { type: "p", text: "Technicians see their running total in the app's **Earnings** tab, with \"How your pay is calculated\" and a breakdown by company if they work for more than one. The office turns the numbers into a pay run with [Generate technician payouts](/support/payouts)." },
    ],
  },
  {
    slug: "payouts",
    title: "Generate technician payouts",
    summary: "Money → Payouts builds a pay period from completed jobs and marks it paid. It's your record for payroll; no money moves.",
    category: "money",
    updated: U3,
    keywords: ["payroll", "pay run", "pay period", "mark paid", "payouts", "earnings report"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **Money → Payouts** and choose **Generate payouts**.",
          "Pick the **Period start** and **Period end**. Every job completed in the period is included, whether or not the customer has paid its invoice.",
          "Review each technician's row: **Jobs**, **On site**, **Hourly**, **Mileage**, **Flat**, **Per-unit** and **Total pay**. A job that paid $0 because no rate was set is flagged so you can fix the rate first.",
          "When you've paid them through your payroll or bank, choose **Mark paid**.",
        ],
      },
      { type: "p", text: "A job is never paid twice across periods, and ArrivePing adds no fee of its own. Payouts are a record, not a transfer: the money goes out the way you pay people today. For a longer view, run **Money → Reports → Payroll & Payouts** and export it as CSV, Excel, JSON or PDF; see [Run and export a report](/support/run-a-report)." },
    ],
  },
  {
    slug: "take-payments-with-stripe",
    title: "Take card payments through your own Stripe account",
    summary: "Connect Stripe once under Setup → Settings → Payments. Customers pay from their tracking page, the technician's phone or the customer portal, and ArrivePing takes no cut.",
    description: "Connect your own Stripe account once. Customers pay from their tracking page, the technician's phone or the customer portal. ArrivePing takes no cut.",
    category: "money",
    updated: U3,
    keywords: ["stripe", "payment gateway", "card payment", "collect payment", "pay on site", "invoice", "receipt", "pay link", "qr code", "tap to pay"],
    blocks: [
      {
        type: "ol",
        items: [
          "As an admin, open **Setup → Settings → Payments** and answer **Where is your business registered?**",
          "Choose **Connect with Stripe** and finish Stripe's own onboarding (business details, bank account). Come back any time with **Continue setup on Stripe**; once live, **Open Stripe dashboard** takes you to your payouts and disputes on Stripe.",
        ],
      },
      { type: "p", text: "The money goes to your Stripe account, not ours. There's no monthly fee and ArrivePing takes no cut; Stripe's processing fee is shown on the Payments tab." },
      { type: "h3", text: "Getting paid on a job" },
      {
        type: "ul",
        items: [
          "Every job gets an invoice automatically (numbered INV-…), unpaid until the customer pays. Invoices are listed under **Money → Reports → Invoices / AR**.",
          "Turn on **Collect payment on site** on the job, or on the template so it's on for every job of that kind. The customer's tracking page then shows **Pay $…**, and the technician's app shows **Take payment** with a QR code, **Pay on this phone** and **Text the link to the customer**.",
          "Customers who sign in to their customer portal can pay any open invoice by card.",
          "A receipt email goes out the moment a payment lands, and the **Payment / receipt** milestone can notify the office or fire a webhook. See [Set up a webhook](/support/set-up-a-webhook).",
        ],
      },
      { type: "p", text: "There's no separate \"send invoice\" button: the pay link lives on the customer's tracking page and in their portal. If you'd like invoices emailed on their own, tell us at [contact@nvc360.com](mailto:contact@nvc360.com)." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Account & security                                                 */
  /* ---------------------------------------------------------------- */
  {
    slug: "reset-your-password",
    title: "Reset your password",
    summary: "Use Forgot password on the sign-in screen; the link lasts one hour.",
    description: "Reset your ArrivePing password with Forgot password on the web or in the app. The emailed link works once and is valid for one hour.",
    category: "account",
    updated: U,
    keywords: ["locked out", "forgot", "login", "can't sign in"],
    blocks: [
      { type: "p", text: "On the web, go to [arriveping.com/forgot-password](/forgot-password). In the app, tap **Forgot password?** on the sign-in screen. Enter the email on your account and follow the link we send; it is valid for one hour and can be used once." },
      { type: "p", text: "No email? Check spam, and make sure you are using the address your company invited (a technician's work email is common). An admin can confirm it from People → Technicians & Managers." },
    ],
  },
  {
    slug: "roles-and-permissions",
    title: "User roles and what each can do",
    summary: "Admins, managers, dispatchers and project managers work in the dispatch dashboard; each sees what their role includes. Field staff use the app.",
    category: "account",
    updated: U2,
    keywords: ["permissions", "admin", "dispatcher", "manager", "access", "role", "can't see", "not part of your role"],
    blocks: [
      { type: "p", text: "Everyone in the office signs in at the same place and lands in the dispatch dashboard. The menu shows only what their role includes." },
      {
        type: "ul",
        items: [
          "**Admin:** everything, including billing, payment setup, API keys, settings, and adding office staff or changing roles.",
          "**Manager:** jobs, the scheduler, the live map, customers and the technician roster (can add technicians), catalog, forms, reports and payouts to view. No billing or company settings.",
          "**Dispatcher:** day-to-day dispatch: jobs (create, assign, archive), the scheduler, the live map, the inbox and messages to technicians, customers, catalog and forms. Sees the technician roster and reports; no settings or billing.",
          "**Project Manager:** jobs, scheduling and customers, with everything else to view.",
          "**Field Staff:** technicians and drivers on the ArrivePing app; they see only their own jobs.",
        ],
      },
      { type: "p", text: "The roles are the same for every company; **Roles & Permissions** shows exactly what each one includes. An admin can widen or narrow what one person can do: open **People → Technicians & Managers → Internal Team** and use **Permissions** on their row. Buttons for things someone isn't allowed to do (archiving a job, exporting a list) don't appear for them. Billing, payment setup and API keys always stay with admins." },
      { type: "p", text: "Only an admin adds office staff, changes someone's role or changes a team member's sign-in email. A page that isn't part of your role says so; ask an admin on your account if you need it." },
      { type: "p", text: "Every company needs at least one Admin; see [Delete your account](/support/delete-your-account) if you are the only one." },
    ],
  },
  {
    slug: "delete-your-account",
    title: "Delete your account",
    summary: "Technicians can delete their own account from Profile → Delete my account. Company admins must hand off first.",
    category: "account",
    updated: U,
    keywords: ["remove account", "erase data", "close company", "gdpr", "pipeda"],
    blocks: [
      { type: "p", text: "You can delete your ArrivePing account yourself at any time from inside the app: **Profile → Delete my account**. You will be asked to type DELETE to confirm." },
      { type: "p", text: "What happens: you are signed out everywhere and can no longer sign in; your name, email, phone number, photo and licence details are erased; any jobs still assigned to you go back to the dispatch board; and the companies you worked for keep their job records (invoices, photos, time on site) with your name removed, as described in our [Privacy Policy](/privacy#retention-of-personal-information). Pay you are owed is settled by your employer outside the app." },
      { type: "p", text: "If you are the only administrator of a company you must make someone else an administrator first (People → Technicians & Managers), or ask us to close the company. If you cannot get into the app, email [privacy@nvc360.com](mailto:privacy@nvc360.com) from the address on your account and we will delete it for you within 30 days." },
    ],
  },
  {
    slug: "privacy-and-your-data",
    title: "Privacy and how your data is handled",
    summary: "Where location data goes, how long it is kept, and how to request a copy or deletion.",
    description: "Where ArrivePing location data goes, who sees it and when, how long job records are kept, and how to request a copy or deletion of your data.",
    category: "account",
    updated: U,
    keywords: ["privacy", "data retention", "export my data", "location history"],
    blocks: [
      { type: "p", text: "Technician location is shared with the company only while the technician is On the clock, and with the customer only while travelling to that customer's job. Job records (photos, signatures, time on site, route history) belong to the company and are kept as part of its business records." },
      { type: "p", text: "Companies can export everything they own at any time — see [Exports and integrations](/support/exports-and-integrations). Individuals can request access to, correction of, or deletion of their personal information by emailing [privacy@nvc360.com](mailto:privacy@nvc360.com). The full details are in the [Privacy Policy](/privacy)." },
    ],
  },
  {
    slug: "report-a-security-issue",
    title: "Report a security concern",
    summary: "Write to privacy@nvc360.com and give us a chance to respond before posting publicly.",
    description: "Report a vulnerability or suspected breach to privacy@nvc360.com. We acknowledge security reports within one business day.",
    category: "account",
    updated: U,
    keywords: ["vulnerability", "breach", "security", "disclosure"],
    blocks: [
      { type: "p", text: "To report a vulnerability or a suspected breach, email [privacy@nvc360.com](mailto:privacy@nvc360.com) with as much detail as you can safely share. We acknowledge security reports within one business day. Please do not post details publicly until we have responded." },
      { type: "p", text: "If you think your own account has been accessed by someone else, reset your password first, then tell us so we can review the audit log for your company." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Troubleshooting                                                    */
  /* ---------------------------------------------------------------- */
  {
    slug: "eta-not-updating",
    title: "The ETA isn't updating or the technician looks stuck",
    summary: "Almost always a location permission or an off-the-clock technician. Here is the checklist.",
    description: "If a customer's ETA isn't updating, it is almost always a location permission or an off-the-clock technician. Work through this checklist.",
    category: "troubleshooting",
    updated: U,
    keywords: ["stale eta", "location frozen", "not moving", "gps"],
    blocks: [
      {
        type: "ol",
        items: [
          "**Is the technician On the clock?** The switch is at the top of the Profile tab. Off the clock, nothing is shared.",
          "**Location permission.** iPhone Settings → ArrivePing → Location must be **Always** with **Precise Location** on. \"While Using\" pauses tracking when the app is in the background.",
          "**Low Power Mode and background refresh.** Low Power Mode throttles background location. Make sure Background App Refresh is on for ArrivePing.",
          "**Signal.** In a parkade or a rural dead zone the last known position is shown until the phone reconnects; the ETA catches up automatically.",
          "**Force-quit the app** and reopen it. If the position is still stale after a minute, email support with the technician's name and the job number.",
        ],
      },
    ],
  },
  {
    slug: "not-receiving-notifications",
    title: "I'm not receiving notifications",
    summary: "Check iOS notification settings, Focus modes and Background App Refresh.",
    description: "Not getting ArrivePing notifications? Check the iPhone notification settings, Focus modes and Background App Refresh for the app.",
    category: "troubleshooting",
    updated: U,
    keywords: ["push", "no alerts", "silent", "focus", "do not disturb"],
    blocks: [
      {
        type: "ol",
        items: [
          "iPhone **Settings → ArrivePing → Notifications**: Allow Notifications on, with Lock Screen, Banners and Sounds enabled.",
          "Check **Focus** (Do Not Disturb, Driving). Add ArrivePing to the allowed apps for any Focus you use on shift.",
          "**Settings → General → Background App Refresh** must be on for ArrivePing.",
          "Sign out and back in once; this re-registers the phone for push.",
        ],
      },
      { type: "p", text: "Dispatch messages are also visible in the app's Messages tab, so nothing is lost while you sort this out." },
    ],
  },
  {
    slug: "customer-did-not-get-the-text",
    title: "A customer didn't get their text or email",
    summary: "Check the number, the notification toggles and whether the customer replied STOP.",
    description: "A customer didn't get their text or email? Check the mobile number, the notification toggles for that milestone and whether they replied STOP.",
    category: "troubleshooting",
    updated: U,
    keywords: ["sms failed", "no text", "undelivered", "wrong number", "landline"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open the job and confirm the mobile number. Landlines cannot receive SMS; add an email as a fallback.",
          "Check **Setup → Notifications** — the milestone (booked, on the way, running late, arrived) must be turned on for SMS or email.",
          "If the customer has ever replied STOP to a text from your number, carriers block further SMS to them; switch that customer to email notifications.",
          "If the message shows as sent but the customer insists it never arrived, ask them to check blocked senders and spam, then email us the job number so we can check delivery with the carrier.",
        ],
      },
    ],
  },
  {
    slug: "app-wont-open",
    title: "The app crashes or won't open",
    summary: "Update iOS and the app, restart the phone, then reinstall — your data lives on the server, not the phone.",
    category: "troubleshooting",
    updated: U,
    keywords: ["crash", "freeze", "white screen", "reinstall", "update"],
    blocks: [
      {
        type: "ol",
        items: [
          "Update ArrivePing from the App Store and make sure iOS is current.",
          "Restart the phone.",
          "Delete and reinstall the app, then sign in again. Nothing is lost: jobs, photos and notes are stored on the server as soon as they upload.",
          "Still crashing? Email [support@nvc360.com](mailto:support@nvc360.com) with your phone model, iOS version and what you tapped just before the crash. A screen recording helps enormously.",
        ],
      },
    ],
  },
  {
    slug: "no-active-jobs",
    title: "The app says \"No active jobs\"",
    summary: "Nothing has been offered or assigned to you yet. Being off the clock doesn't hide jobs.",
    description: "\"No active jobs\" means nothing has been offered or assigned to you yet. Check which company you're in, then ask your dispatcher.",
    category: "troubleshooting",
    updated: U3,
    keywords: ["empty", "no jobs", "can't see jobs", "missing jobs", "filters", "no offers", "jobs disappeared"],
    blocks: [
      { type: "p", text: "The Jobs tab shows **New offers**, **In progress** and **Up next**. \"No active jobs\" with \"New offers will appear here automatically\" means dispatch hasn't given you anything yet; there are no filters to clear, and going off the clock doesn't hide jobs you've been given." },
      {
        type: "ol",
        items: [
          "**Check which company you're in.** If you work for more than one, the Profile tab shows them; switch to the right one. See [Working for more than one company](/support/working-for-more-than-one-company).",
          "**Ask your dispatcher** whether the job was assigned to you or is still in their To schedule list. If they just assigned it, it arrives as an offer within moments.",
          "**Check notifications** if offers seem to arrive late; see [I'm not receiving notifications](/support/not-receiving-notifications). The offer is in the app either way.",
          "**Sign out and back in** once if the list still looks wrong, then email [support@nvc360.com](mailto:support@nvc360.com) with your name and company.",
        ],
      },
    ],
  },
  {
    slug: "job-or-technician-looks-stuck",
    title: "A job or technician looks stuck",
    summary: "A technician shows On Site or Busy with nothing happening, or a job sits En route for hours. Here's what moves it.",
    category: "troubleshooting",
    updated: U3,
    keywords: ["busy", "stuck", "frozen status", "won't complete", "still en route", "can't close job", "complete on behalf", "change status"],
    blocks: [
      { type: "p", text: "Job statuses move when the technician taps, and the office can't set them by hand, so a stuck job is almost always a tap that hasn't happened. Open the job and check which status it's in; see [What each job status means](/support/job-statuses)." },
      {
        type: "ul",
        items: [
          "**En route for a long time.** The technician hasn't been marked arrived. The geofence checks them in within about 150 m, so if they parked around the corner or the address pin is off, ask them to tap **I've Arrived**. The app won't let them jump from driving to Complete Job (\"Check in on site before completing this job\").",
          "**On site after the work is done.** They haven't tapped **Complete Job**. If the job has required checklist items, the app shows \"Required steps not done\" until each is ticked; remind them, or edit the job to drop an item that doesn't apply.",
          "**The technician can't finish it.** Reassign the job to someone else from Operations → Jobs or the Scheduler (it asks you to confirm because work is under way), or have the technician tap **Send back to dispatch**. See [Job offers: accept, decline or send a job back](/support/job-offers-accept-decline).",
          "**The job won't happen at all.** Choose **Archive**; it can be restored later. See [Edit, reschedule, archive or restore a job](/support/edit-archive-restore-job).",
        ],
      },
      { type: "p", text: "A technician whose marker says **Busy** or **On Site** on the map with no job in progress is usually finishing one of the above; once the job moves, their status follows. If it doesn't, email us the technician's name and the job number." },
    ],
  },
  {
    slug: "address-not-found",
    title: "The address won't autocomplete, or the job's pin is in the wrong place",
    summary: "Pick the address from the suggestions as you type. A typed address is located afterwards, and if that fails the pin can land in the wrong spot.",
    seoTitle: "Address Won't Autocomplete or the Job Pin Is Wrong",
    category: "troubleshooting",
    updated: U3,
    keywords: ["address", "autocomplete", "geocode", "wrong location", "pin", "map marker", "outside service zone", "rural address", "can't create job"],
    blocks: [
      { type: "p", text: "The address field on the job form suggests matches as you type (\"Start typing an address…\"). Pick the right one from the list; that's what places the pin and feeds distance into suggestions and the customer's ETA." },
      {
        type: "ul",
        items: [
          "**You typed the whole address and didn't pick a suggestion.** ArrivePing locates it after you save. That usually works, but if the address can't be found the job still saves and its pin can be far from the real place, so nearest-tech suggestions and ETAs will be off. Open the job, choose **Edit Job**, retype the address and pick it from the list.",
          "**\"Address is outside all active service zones\".** The address is real but outside the zones you've drawn. Widen the zone under Setup → Service Zones, or take the job by hand. See [Service zones](/support/service-zones).",
          "**A rural or new address that no map knows.** Use the nearest address the suggestions do find, and put the exact directions in the job's **Staff Notes to Driver** field, which the technician sees and the customer doesn't.",
        ],
      },
      { type: "p", text: "There's no pin-drop or manual coordinates on the job form yet. If a particular address keeps failing, email it to [support@nvc360.com](mailto:support@nvc360.com) and we'll look at why." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Exports & integrations                                             */
  /* ---------------------------------------------------------------- */
  {
    slug: "run-a-report",
    title: "Run and export a report",
    summary: "Money → Reports: pick a report, choose the period, sort it, then export it as CSV, Excel, JSON or PDF.",
    category: "integrations",
    updated: U2,
    keywords: ["revenue", "sales", "payroll", "performance", "accountant", "analytics", "numbers"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **Money → Reports**.",
          "Pick a report: Revenue & Sales, Tech Performance, Job Status, Payroll & Payouts, Catalog Margin, Client Activity, Invoices / AR or Zone Breakdown.",
          "Choose the period: 7 days, 30 days, 90 days, year to date or 12 months, or set exact dates. You can also filter by technician or status.",
          "Click a column heading in the detail table to sort by it; click again to reverse.",
          "Use **Export** to download the report on screen, with your filters and sort, as CSV, Excel (.xlsx), JSON or PDF.",
        ],
      },
      { type: "p", text: "Need everything, not a summary? The same page downloads every job, technician, client or invoice as CSV, Excel, JSON or PDF. See [Exports and integrations](/support/exports-and-integrations)." },
    ],
  },
  {
    slug: "exports-and-integrations",
    title: "Exports and integrations",
    summary: "Your data is yours: CSV, Excel, PDF and JSON exports, calendar feeds, webhooks, Zapier, Make and an MCP server.",
    category: "integrations",
    updated: U2,
    keywords: ["csv", "excel", "quickbooks", "zapier", "make", "webhook", "api", "mcp", "calendar", "ical", "google calendar", "outlook"],
    blocks: [
      { type: "p", text: "ArrivePing runs scheduling, assignment, tracking and customer updates and does not try to replace your accounting or CRM. Everything it holds can leave:" },
      {
        type: "ul",
        items: [
          "**Exports:** jobs, customers, technicians and time on site as CSV, Excel, PDF or JSON from Money → Reports.",
          "**Calendar feeds:** subscribe to a technician's or the company's schedule from Google Calendar, Outlook or Apple Calendar. Copy the subscription link from the **Calendar Sync** card on Setup → Settings → **Company**.",
          "**Webhooks, Zapier and Make:** a JSON POST to your URL for fifteen job events, from created and assigned through on the way, arrived, completed, cancelled and payment received. Add and test webhooks on the **Webhooks** tab under Setup → **Notifications**; Zapier and Make connect through them. See [Set up a webhook](/support/set-up-a-webhook).",
          "**API & MCP:** Setup → Settings → **API & MCP** issues keys for your own scripts and an MCP server so AI agents can read and act on your dispatch data.",
        ],
      },
      { type: "p", text: "Accounting connections such as QuickBooks are on the roadmap; until then, the Excel and CSV exports map cleanly to invoice imports. Tell us which integration you need at [contact@nvc360.com](mailto:contact@nvc360.com)." },
    ],
  },
  {
    slug: "set-up-a-webhook",
    title: "Set up a webhook and the events it sends",
    summary: "Add a URL, tick Webhook on the milestones you want, and test it. Fifteen job events arrive as JSON with a shared-secret header, and each delivery shows in the Delivery Log.",
    description: "Add a URL, tick Webhook on the milestones you want and test it. Fifteen job events arrive as JSON with a shared-secret header and show in the Delivery Log.",
    category: "integrations",
    updated: U3,
    keywords: ["webhook", "post", "callback", "zapier", "make", "integromat", "n8n", "events", "payload", "secret", "test", "logs", "retry"],
    blocks: [
      { type: "h3", text: "1. Add the webhook" },
      {
        type: "ol",
        items: [
          "Open **Setup → Notifications** and choose the **Webhooks** tab, then **Add webhook**.",
          "Give it a **Label** and paste the **POST URL**. For Zapier or Make, this is the URL their webhook trigger gives you (\"Webhooks by Zapier\" or a Make custom webhook).",
          "Optionally set a **Secret**. It's sent with every request as the `X-Webhook-Secret` header, so your side can refuse anything without it.",
          "Leave **Events** as `*` for everything, or list the events you want, separated by commas (see the list below). Choose **Add webhook**.",
          "Choose **Test** on its row. You should see \"Test OK\" with the HTTP status your server returned. Pause or resume a webhook from the same row.",
        ],
      },
      { type: "h3", text: "2. Turn on the milestones" },
      { type: "p", text: "A webhook only fires for milestones that are allowed to use it. On the **Notification Rules** tab, tick the **Webhook** column for each milestone and recipient row you want sent, and make sure the **Webhooks** master switch on the **Channels** tab is on. A milestone ticked for both the customer and the office row posts once per row, so you may receive the same event twice with different `recipient` values." },
      { type: "h3", text: "Events" },
      { type: "p", text: "`created`, `assigned`, `accepted`, `declined`, `released` (a technician sent the job back), `enroute`, `arrived`, `started`, `completed`, `cancelled`, `change_requested`, `change_declined`, `rescheduled`, `delayed` (running late) and `receipt` (payment received). A milestone you add yourself fires as `custom:<id>`; see [Add your own milestone](/support/custom-milestones)." },
      { type: "h3", text: "Payload" },
      { type: "p", text: "A JSON POST with `event`, `recipient`, `bookingId`, `shortId`, `status`, `service`, `tech`, `address`, `scheduledAt`, `trackUrl`, `label`, `message` and `at`. Use `trackUrl` to link the customer's tracking page from your own system." },
      { type: "h3", text: "Good to know" },
      {
        type: "ul",
        items: [
          "Every delivery, with the HTTP status your server returned, is on the **Delivery Log** tab with the channel **webhook**. Test pings aren't logged. See [Check whether a message was sent](/support/check-what-was-sent).",
          "Failed deliveries aren't retried. If your endpoint was down, pull the jobs you missed from a report or the API; see [Exports and integrations](/support/exports-and-integrations).",
          "Sample jobs never fire webhooks, so test with a real job (your own phone as the customer works well).",
        ],
      },
    ],
  },
];

/** Hand-picked for the hub's "Popular" list — the questions people arrive with. */
export const popularSlugs = [
  "set-up-your-company",
  "location-sharing",
  "what-customers-receive",
  "free-trial",
  "eta-not-updating",
  "delete-your-account",
];

export const articleBySlug: Record<string, Article> = Object.fromEntries(articles.map((a) => [a.slug, a]));
export const categoryById: Record<CategoryId, Category> = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;
export const articlesIn = (id: CategoryId) => articles.filter((a) => a.category === id);
