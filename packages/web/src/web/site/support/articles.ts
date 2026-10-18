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
  { id: "billing", title: "Billing & plans", blurb: "The free trial, how seats are priced, and changing your plan or card.", audience: "Office" },
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

export const articles: Article[] = [
  /* ---------------------------------------------------------------- */
  /* Get started                                                        */
  /* ---------------------------------------------------------------- */
  {
    slug: "set-up-your-company",
    title: "Set up your company in ArrivePing",
    summary: "From sign-up to your first dispatched job, most teams are running the same day.",
    category: "get-started",
    updated: U,
    keywords: ["onboarding", "signup", "create account", "new company", "checklist"],
    blocks: [
      { type: "p", text: "ArrivePing is set up by the office first, then technicians join from an invitation. There is no public sign-up for technicians. Here is the order that works best." },
      {
        type: "ol",
        items: [
          "**Sign up free** at [arriveping.com/get-started](/get-started). You create the company and the first admin account in one step. The 30-day free trial starts now and you can add as many users as you like during it.",
          "**Follow the guided onboarding.** It asks what kind of work you do, sets your industry terms (so Jobs might be called Work orders or Deliveries in your dashboard), loads a starter catalog of services and drafts your customer messages in your voice.",
          "**Add your service zones** under Setup → Service Zones if you want jobs grouped by area.",
          "**Invite your technicians** from People → Technicians & Managers. See [Invite your technicians](/support/invite-your-technicians).",
          "**Create a job** from Operations → Jobs → New job, assign it, and have the technician tap **On the way** so you can see the customer's tracking page for yourself.",
        ],
      },
      { type: "note", title: "Stuck during setup?", text: `Email [${support.email}](mailto:${support.email}) with your company name. Our team is available during setup and ${support.response.charAt(0).toLowerCase()}${support.response.slice(1)}` },
    ],
  },
  {
    slug: "invite-your-technicians",
    title: "Invite your technicians",
    summary: "Add field staff from the dashboard; each one gets an email to set a password and install the app.",
    category: "get-started",
    updated: U,
    keywords: ["add technician", "add driver", "invitation", "seat", "roster"],
    blocks: [
      {
        type: "ol",
        items: [
          "Open **People → Technicians & Managers** in the dispatch dashboard.",
          "Choose **Invite**, enter the technician's name, mobile number and email, and pick a role (Field Staff for technicians and drivers).",
          "The technician receives an invitation email. They set a password, install the ArrivePing app from the App Store and sign in with that email.",
        ],
      },
      { type: "p", text: "Each active technician is a driver seat on your plan. During the free trial seats are unlimited; after it, you are billed by driver count as described in [How ArrivePing is priced](/support/pricing-and-seats)." },
      { type: "p", text: "A technician who didn't get the email should check spam, then ask you to resend the invitation from the same page. If they already work for another ArrivePing company, the invitation adds your company to their existing account; see [Working for more than one company](/support/working-for-more-than-one-company)." },
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
          "**Assign it.** Leave assignment to ArrivePing and it picks the closest qualified technician, factoring in who is finishing nearby. Or drag it onto a technician in Operations → Scheduler. Dispatchers can reassign any job at any time.",
          "**On the way.** The technician taps **On the way** in the app. The customer gets a text or email with a link to a live tracking page showing the technician's progress and ETA.",
          "**Arrival.** A geofence around the address marks the technician as arrived and starts the on-site clock; the technician can also tap to arrive manually. Location sharing to the customer stops at arrival.",
          "**Finish.** Photos, the customer's signature and any voice notes are saved with the job and visible in the dashboard.",
        ],
      },
      { type: "p", text: "Try it with your own phone as the customer: you'll see exactly what they see. The tracking page needs no app or account." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Technician app                                                     */
  /* ---------------------------------------------------------------- */
  {
    slug: "install-and-sign-in",
    title: "Install the app and sign in",
    summary: "Technicians join from an invitation; there is no public sign-up in the app.",
    category: "technician-app",
    updated: U,
    keywords: ["login", "iphone", "ipad", "app store", "password", "invitation"],
    blocks: [
      { type: "p", text: "Your company adds you to its roster and ArrivePing emails you an invitation. Set your password from that email, install **ArrivePing** from the App Store, and sign in with the same email address. The app works on iPhone and iPad." },
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
    category: "technician-app",
    updated: U,
    keywords: ["eta", "geofence", "arrived", "late", "status"],
    blocks: [
      {
        type: "ul",
        items: [
          "**On the way.** Tap it when you leave for the job. The customer gets a text or email with a live tracking link and the office sees your status change.",
          "**Running late.** If your ETA slips, the customer's arrival window updates automatically and they get a running-late message; you don't have to call anyone.",
          "**Arrived.** A geofence around the job address marks you as arrived and starts the on-site time clock. If the address is off or you parked around the corner, tap **Arrived** yourself.",
        ],
      },
      { type: "p", text: "Customers can text or call you from their tracking page to share gate codes or parking details. The buttons use the phone number on your roster profile, so if you'd rather not take customer calls on a personal phone, ask your office to put a work number on your profile." },
    ],
  },
  {
    slug: "photos-signatures-voice-notes",
    title: "Photos, signatures and voice notes",
    summary: "Everything you capture on site is saved with the job for the office.",
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

  /* ---------------------------------------------------------------- */
  /* Dispatch & scheduling                                              */
  /* ---------------------------------------------------------------- */
  {
    slug: "assigning-jobs",
    title: "How jobs get assigned (and how to override it)",
    summary: "ArrivePing picks the closest qualified technician; dispatchers can reassign anything, and automation rules decide what waits for a person.",
    category: "dispatch",
    updated: U,
    keywords: ["auto assign", "dispatch", "reassign", "automation rules", "licensed", "qualified"],
    blocks: [
      { type: "p", text: "When a job is created, ArrivePing scores your technicians on distance, the skills and licences the job requires, their open jobs and when they are projected to be free. A technician finishing up nearby can outrank one who is free but far away, and urgent jobs lean harder on who can go now." },
      { type: "h3", text: "Overriding" },
      { type: "p", text: "Dispatchers can reassign any job: open it from Operations → Jobs or drag it onto another technician in Operations → Scheduler. The technician is notified and the customer's booking details update." },
      { type: "h3", text: "Deciding what is automatic" },
      { type: "p", text: "Setup → Settings → **Automation & AI** holds your automation rules — which jobs are assigned automatically and which wait for a person to confirm. Many teams start with everything manual and switch on auto-assignment once they trust the suggestions." },
      { type: "p", text: "Skill and licence restrictions (gas-ticketed, licensed electrician, and so on) are set on the technician in People → Technicians & Managers and on the service in Catalog & Forms → Services." },
    ],
  },
  {
    slug: "live-map",
    title: "See your whole team on the live map",
    summary: "Operations → Map shows every technician on the clock, their current job and where they are heading.",
    category: "dispatch",
    updated: U,
    keywords: ["fleet", "gps", "where is", "map"],
    blocks: [
      { type: "p", text: "Open **Operations → Map**. Each technician who is On the clock appears with their status (assigned, on the way, arriving, arrived) and current job. Technicians who are off the clock do not appear, and location is not stored once a shift ends except as part of the job record." },
      { type: "p", text: "Use the map to answer the \"where is my tech?\" call in seconds, or to pick the right person for a same-day emergency. The route a technician drove to a job is kept with that job's record." },
    ],
  },
  {
    slug: "running-late",
    title: "Handling a day that runs late",
    summary: "The Running Late board shows which customers will be affected before they call.",
    category: "dispatch",
    updated: U,
    keywords: ["delay", "behind schedule", "eta slipped", "reschedule"],
    blocks: [
      { type: "p", text: "When a technician's projected arrival moves past the customer's window, the job surfaces on the dashboard's **Running Late** board. The customer automatically receives the running-late message with their new arrival window, so most of these resolve without a phone call." },
      { type: "p", text: "If the delay is too long, reassign the job to a technician who is finishing nearby, or move it in the Scheduler. Either action sends the customer an updated confirmation." },
      { type: "p", text: "Customer requests to move or cancel a job collect in **Operations → Change Requests**. Nothing changes on the board until someone in the office accepts the request, so a truck never rolls to a job the customer thinks is cancelled." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Customer notifications                                             */
  /* ---------------------------------------------------------------- */
  {
    slug: "what-customers-receive",
    title: "What your customers receive and see",
    summary: "A text or email per milestone, and a live tracking page that needs no app or account.",
    category: "customer-notifications",
    updated: U,
    keywords: ["tracking link", "sms", "email", "customer page", "eta"],
    blocks: [
      { type: "p", text: "Customers get a message when a job is booked, when the technician is on the way, if the technician is running late, and when the technician arrives. Messages go by SMS, email, or both, depending on what you turned on in Setup → Notifications." },
      { type: "p", text: "The on-the-way message carries a link that opens a live tracking page in the customer's browser. It shows the technician on the way, the ETA, and buttons to text or call them. There is nothing to install and no account to create." },
      { type: "p", text: "The page only ever shows the technician's progress toward that customer's own appointment, and only while the technician is travelling to it. Once the technician arrives, the page confirms the arrival and stops showing location. Opening the link later shows the appointment summary, not a map." },
    ],
  },
  {
    slug: "customize-messages",
    title: "Customize the on-my-way and other messages",
    summary: "The setup agent drafts them in your voice; edit the wording any time under Setup → Notifications.",
    category: "customer-notifications",
    updated: U,
    keywords: ["template", "wording", "business name", "sms text", "edit message"],
    blocks: [
      { type: "p", text: "During onboarding, ArrivePing drafts your booking, on-the-way, running-late and arrived messages in your voice, including your business name and how the technician is introduced." },
      { type: "p", text: "To change them, open **Setup → Notifications**. Each milestone has its own SMS and email text, and you can turn individual messages off. Changes apply to the next message sent; messages already delivered are not altered." },
      { type: "p", text: "Keep the tracking link in the on-the-way message; without it the customer has no way to see the ETA or contact the technician." },
    ],
  },
  {
    slug: "set-your-reply-to-email",
    title: "Set your reply-to email",
    summary: "Choose the name customers see on emails and the inbox their replies land in.",
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
      { type: "note", title: "Calmer-dispatch guarantee.", text: "If ArrivePing doesn't make your dispatch day calmer within the first paid month, email us and we'll refund it." },
    ],
  },
  {
    slug: "pricing-and-seats",
    title: "How ArrivePing is priced",
    summary: "US dollars, billed monthly, graduated by driver count. The dispatcher licence is included on every plan.",
    category: "billing",
    updated: U,
    keywords: ["cost", "price", "per driver", "seat", "plan", "usd", "cad"],
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
      { type: "p", text: "A driver is a field team member who uses the technician app to receive jobs and share their status — a technician, installer or delivery driver. Dispatchers and office users are not drivers; the dispatcher licence is included at no extra fee. There are no setup fees or contracts, and you can add or remove drivers month to month. Current prices are always on the [pricing page](/pricing)." },
    ],
  },
  {
    slug: "add-or-remove-drivers",
    title: "Add or remove drivers from your plan",
    summary: "Inviting a technician adds a seat; deactivating one keeps their history and frees the seat.",
    category: "billing",
    updated: U,
    keywords: ["deactivate", "remove technician", "seat count", "downsize", "offboard"],
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
    category: "billing",
    updated: U,
    keywords: ["invoice", "receipt", "credit card", "payment failed", "billing email"],
    blocks: [
      { type: "p", text: "Open **Setup → Settings → Billing**. You can change the card on file and see your plan, current driver count and the date and amount of the next invoice. Need a copy of a past invoice? Email [support@nvc360.com](mailto:support@nvc360.com) with your company name." },
      { type: "p", text: "If a payment fails, the Billing tab shows **Payment failed** until the card is updated or retried. For a question about a specific charge, email the same address." },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Account & security                                                 */
  /* ---------------------------------------------------------------- */
  {
    slug: "reset-your-password",
    title: "Reset your password",
    summary: "Use Forgot password on the sign-in screen; the link lasts one hour.",
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
    summary: "Admin, Manager, Dispatcher, Project Manager and Field Staff — set per person from People → Technicians & Managers.",
    category: "account",
    updated: U,
    keywords: ["permissions", "admin", "dispatcher", "manager", "access"],
    blocks: [
      {
        type: "ul",
        items: [
          "**Admin:** full control of every system and feature, including billing.",
          "**Manager:** oversees technicians and drivers; broad access, limited deletes.",
          "**Dispatcher:** jobs, scheduling, forms, catalog and parts.",
          "**Project Manager:** oversight on jobs, scheduling and clients.",
          "**Field Staff:** technicians and drivers using the mobile app; they see only their own jobs.",
        ],
      },
      { type: "p", text: "Change a person's role from **People → Technicians & Managers**. Every company needs at least one Admin; see [Delete your account](/support/delete-your-account) if you are the only one." },
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

  /* ---------------------------------------------------------------- */
  /* Exports & integrations                                             */
  /* ---------------------------------------------------------------- */
  {
    slug: "exports-and-integrations",
    title: "Exports and integrations",
    summary: "Your data is yours: CSV, Excel, PDF and JSON exports, calendar feeds, webhooks, Zapier, Make and an MCP server.",
    category: "integrations",
    updated: U,
    keywords: ["csv", "excel", "quickbooks", "zapier", "make", "webhook", "api", "mcp", "calendar", "ical"],
    blocks: [
      { type: "p", text: "ArrivePing runs scheduling, assignment, tracking and customer updates and does not try to replace your accounting or CRM. Everything it holds can leave:" },
      {
        type: "ul",
        items: [
          "**Exports:** jobs, customers, technicians and time on site as CSV, Excel, PDF or JSON from Money → Reports.",
          "**Calendar feeds:** subscribe to a technician's or the company's schedule from Google Calendar, Outlook or Apple Calendar.",
          "**Webhooks, Zapier and Make:** fire on job created, assigned, on the way, arrived and completed. Add and test webhooks on the **Webhooks** tab under Setup → **Notifications**; Zapier and Make connect through them.",
          "**API & MCP:** Setup → Settings → **API & MCP** issues keys for your own scripts and an MCP server so AI agents can read and act on your dispatch data.",
        ],
      },
      { type: "p", text: "Accounting connections such as QuickBooks are on the roadmap; until then, the Excel and CSV exports map cleanly to invoice imports. Tell us which integration you need at [contact@nvc360.com](mailto:contact@nvc360.com)." },
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
