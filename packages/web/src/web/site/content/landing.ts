/**
 * Content for the public solution, pricing, about and comparison pages.
 *
 * Every page is data rendered by `pages/marketing/landing.tsx`, so the same
 * text feeds the prerendered HTML, the page metadata, the FAQPage structured
 * data, the sitemap and llms.txt.
 *
 * Accuracy rules (same as config.ts):
 *  - ArrivePing claims must match what the product does today.
 *  - Competitor facts come from the competitor's own public pages, carry a
 *    "verified" date and a source link, and are re-checked before each update.
 */

export const COMPETITORS_VERIFIED = "October 7, 2026";

/**
 * ISO date of the last substantive content change to the solution, pricing,
 * about and comparison pages. Used as the sitemap <lastmod> for pages that
 * carry no date of their own, instead of the build date (a build that runs
 * after midnight UTC used to publish a date that was still "tomorrow" in
 * Central time, which Google treats as an unreliable lastmod).
 * Bump it when page copy changes, not when the site is merely rebuilt.
 */
export const CONTENT_UPDATED = "2026-10-08";

export type Cell = string | { text: string; href?: string };

export type Section =
  | { kind: "features"; id?: string; eyebrow?: string; title: string; body?: string; items: { title: string; body: string }[] }
  | { kind: "steps"; id?: string; eyebrow?: string; title: string; body?: string; items: { title: string; body: string }[] }
  | { kind: "prose"; id?: string; eyebrow?: string; title: string; paragraphs: string[]; bullets?: string[] }
  | {
      kind: "table";
      id?: string;
      eyebrow?: string;
      title: string;
      body?: string;
      columns: string[];
      rows: { label: string; cells: Cell[] }[];
      note?: string;
    }
  | { kind: "choose"; id?: string; title: string; ours: { title: string; items: string[] }; theirs: { title: string; items: string[] } }
  | { kind: "pricing" }
  | { kind: "story" }
  | { kind: "trades"; title: string; body?: string };

export type LandingPage = {
  path: string;
  /** Short label used in breadcrumbs, the footer and llms.txt. */
  label: string;
  /** Breadcrumb parent, when the page sits under a hub. */
  parent?: { label: string; path: string };
  meta: { title: string; description: string };
  eyebrow: string;
  h1: string;
  lede: string;
  /** The short, quotable answer near the top of the page (answer engines lift this). */
  answer: { q: string; a: string };
  sections: Section[];
  faqs: { q: string; a: string }[];
  related: string[];
  sources?: { label: string; href: string }[];
  /** Shown under the comparison table, e.g. when competitor facts were checked. */
  verified?: string;
};

/* ------------------------------------------------------------------ */
/* Shared ArrivePing facts                                              */
/* ------------------------------------------------------------------ */

const PRICE_LINE =
  "ArrivePing starts at $49 USD a month, which includes one dispatch user and two drivers. Drivers 3–29 are $30 each and every driver from 30 on is $25, billed monthly. The dispatcher license is included in every plan.";

const TRACKING_FAQ = {
  q: "Do customers need an app to track the technician?",
  a: "No. Customers get a text or email with a link that opens a live tracking page in their browser. It shows the technician on the way, the ETA, and buttons to text or call them. There is no account to create.",
};

const PRIVACY_FAQ = {
  q: "When can customers see the technician's location?",
  a: "Only while the technician is travelling to that customer's appointment. Location sharing with the customer stops when the technician arrives.",
};

const HARDWARE_FAQ = {
  q: "Do I need GPS hardware in my vehicles?",
  a: "No. ArrivePing uses the location from the technician mobile app on the phone your technicians and drivers already carry, so there are no plug-in trackers to buy or install.",
};

const SETUP_FAQ = {
  q: "How long does setup take?",
  a: "Most teams dispatch their first job within an hour. You give the ArrivePing setup agent your website; it builds your workspace with your brand, services, a priced catalog, job templates, intake forms and customer texts, then asks a few questions about how you work.",
};

const PRICE_FAQ = {
  q: "How much does ArrivePing cost?",
  a: `${PRICE_LINE} Each rate applies only to the drivers in its band, so adding a driver never makes your bill jump.`,
};

const TOOLS_FAQ = {
  q: "Do I have to replace my accounting or CRM?",
  a: "No. ArrivePing runs scheduling, work order assignment, tracking and customer updates, and exports your data as CSV, Excel, PDF or JSON, through calendar feeds, webhooks, Zapier or Make, or an MCP server for AI agents.",
};

/* ------------------------------------------------------------------ */
/* Solution pages                                                       */
/* ------------------------------------------------------------------ */

const fieldService: LandingPage = {
  path: "/field-service-software",
  label: "Field service software",
  meta: {
    title: "Field Service Management Software for Trades | ArrivePing",
    description:
      "Field service management software for HVAC, plumbing, electrical and construction teams: live map, custom work orders, auto-dispatch and customer ETA texts. From $49/mo.",
  },
  eyebrow: "Field service management software",
  h1: "Field service management software that gets the right tech to the door on time.",
  lede:
    "ArrivePing runs the part of your day that costs the most when it goes wrong: who goes where, when they get there, and what the customer is told. Schedule the work, auto-assign the closest qualified technician, and give every customer a live ETA.",
  answer: {
    q: "What is field service management software?",
    a: "Field service management (FSM) software is how a service business schedules jobs, dispatches technicians, tracks them in the field and keeps customers informed. ArrivePing is FSM software built around dispatch and arrival: a live map of your team, custom work orders, automatic assignment by proximity and skill, a technician app, and Uber-style tracking links for customers.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "What's included",
      title: "Everything between the booking and the front door.",
      items: [
        { title: "Live map of your team", body: "See every technician and driver in real time, with their status: available, en route, on site or on a job." },
        { title: "Custom work orders", body: "Your own fields for job type, priority, time window, required skills, access notes and photos." },
        { title: "Automatic dispatch", body: "ArrivePing ranks your technicians by distance, matching skills, availability and current workload, then assigns the best fit. Dispatchers can override any time." },
        { title: "Technician mobile app", body: "The job lands on the technician's phone with the address, notes and gate code. One tap to accept, one tap to head out." },
        { title: "Customer tracking links", body: "Customers get an on-my-way text and a live tracking page with the ETA and buttons to text or call the technician." },
        { title: "Time clock and invoicing", body: "A geofence marks arrival and runs the on-site clock. Scheduling, dispatch, work orders and invoicing live in one place." },
      ],
    },
    {
      kind: "steps",
      eyebrow: "How it works",
      title: "From work order to front door in five steps.",
      items: [
        { title: "See everyone live", body: "Technicians and drivers on one map, updated in real time from the technician app." },
        { title: "Create the work order", body: "Booked by your office, an online intake form or an integration, with the details your crew needs." },
        { title: "Auto-assign the best technician", body: "The closest technician with the right skills who is free to take it." },
        { title: "Send it to their phone", body: "Address, notes and access details in the technician app, ready to accept." },
        { title: "Keep the customer in the loop", body: "An on-my-way text, a live ETA, and a running-late notice if the day slips." },
      ],
    },
    { kind: "trades", title: "Built for trades that run on arrival times." },
    {
      kind: "prose",
      title: "Keep the tools you already use.",
      paragraphs: [
        "ArrivePing doesn't ask you to rip out your accounting, payroll or CRM. It handles scheduling, assignment, tracking and customer updates, then hands your data to the rest of your stack.",
      ],
      bullets: [
        "Exports: CSV, Excel, PDF and JSON",
        "Calendar feeds for the office and crews",
        "Webhooks, Zapier and Make",
        "An MCP server so AI agents can read and act on your jobs",
        "Google Drive backup",
      ],
    },
  ],
  faqs: [SETUP_FAQ, PRICE_FAQ, TRACKING_FAQ, HARDWARE_FAQ, TOOLS_FAQ, {
    q: "Is ArrivePing good for small teams?",
    a: "Yes. Starter is $49 a month for one dispatch user and two drivers, and you can add drivers month to month. Because the rates are graduated, each added driver costs the same or less than the one before.",
  }],
  related: ["/dispatch-software", "/fleet-tracking", "/customer-notifications", "/pricing", "/compare"],
};

const fleet: LandingPage = {
  path: "/fleet-tracking",
  label: "Fleet & technician tracking",
  meta: {
    title: "Fleet & Technician GPS Tracking, No Hardware | ArrivePing",
    description:
      "Track service vans, technicians and drivers on a live map using the phones they already carry. No plug-in GPS devices. Live ETAs for customers. From $49/mo.",
  },
  eyebrow: "Fleet and technician tracking",
  h1: "Fleet tracking for service businesses, without the hardware.",
  lede:
    "See every technician and driver on one live map, know who's closest to the next call, and share a live ETA with the customer, all from the technician app on the phone your team already carries.",
  answer: {
    q: "How do I track my service vans and technicians?",
    a: "With ArrivePing, each technician or driver runs the ArrivePing mobile app. Their location and job status appear on a live map for dispatchers, ArrivePing uses that position to auto-assign the closest qualified technician, and customers see the technician's progress on a tracking page while they're on the way. No vehicle GPS devices are needed.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "What you get",
      title: "A live picture of the field, built into dispatch.",
      items: [
        { title: "Live map", body: "Technicians and drivers on one map with their status, current job and ETA to the next stop." },
        { title: "Phone-based GPS", body: "Location comes from the technician app. No OBD-II plug-ins, no installs, no per-vehicle hardware fees." },
        { title: "Closest-tech dispatch", body: "Distance to the job is one of the signals ArrivePing uses to rank and auto-assign technicians." },
        { title: "Geofenced arrival", body: "A geofence marks the technician as arrived and starts the on-site clock, with a manual tap as backup." },
        { title: "Customer ETAs", body: "The same location powers the customer's live tracking page while the technician is on the way." },
        { title: "Privacy by design", body: "Customers only see a technician's progress toward their own appointment, and only while they're travelling to it." },
      ],
    },
    {
      kind: "prose",
      title: "Why phone-based tracking suits service fleets.",
      paragraphs: [
        "Telematics boxes report where a vehicle is. Service businesses usually need to know where a technician is, what job they're on and when they'll reach the next customer. Tying location to the job, not just the van, lets ArrivePing dispatch by distance, confirm arrival at the right address and keep the customer updated with no extra hardware.",
        "If you need engine diagnostics, fuel data or driver-behaviour scoring, a dedicated telematics product does that well, and ArrivePing can sit alongside it.",
      ],
    },
    { kind: "trades", title: "Fleets we're built for." },
  ],
  faqs: [HARDWARE_FAQ, PRIVACY_FAQ, {
    q: "Can I see my whole team on one map?",
    a: "Yes. The dispatch view shows every technician and driver on a live map with their status: available, en route, on site or on a job.",
  }, {
    q: "How does arrival get confirmed?",
    a: "A geofence around the job address marks the technician as arrived and starts the on-site time clock. Technicians can also tap to mark arrival manually.",
  }, PRICE_FAQ],
  related: ["/dispatch-software", "/customer-notifications", "/delivery-dispatch-software", "/hvac-dispatch-software"],
};

const dispatch: LandingPage = {
  path: "/dispatch-software",
  label: "Auto-dispatch software",
  meta: {
    title: "Auto-Dispatch Software: Assign by Location & Skill | ArrivePing",
    description:
      "Dispatch software that auto-assigns each work order to the closest qualified technician by distance, skills, availability and workload. Live board, tech app, ETAs.",
  },
  eyebrow: "Dispatch software",
  h1: "Dispatch software that assigns the closest qualified technician for you.",
  lede:
    "Stop working the phones to find out who can take the next call. ArrivePing ranks your technicians by distance, skills, availability and workload, assigns the best fit, and sends the job straight to their phone.",
  answer: {
    q: "How do I automatically dispatch the closest technician?",
    a: "Use dispatch software that knows where each technician is and what they're qualified for. ArrivePing scores every technician on distance to the job, whether their skills match the service, whether they're available, and how many open jobs they already have. It then assigns the best fit, sends the work order to the technician app, and lets a dispatcher override at any time.",
  },
  sections: [
    {
      kind: "steps",
      eyebrow: "How auto-assignment works",
      title: "Four signals, one decision.",
      items: [
        { title: "Distance", body: "Each technician's live position is compared with the job address." },
        { title: "Skills", body: "Technicians whose skills match the service rank ahead of those who'd need a second visit." },
        { title: "Availability", body: "Who is free now, who is finishing up, and who is off shift or on time off." },
        { title: "Workload", body: "Open jobs and when each technician's current work is projected to clear." },
      ],
    },
    {
      kind: "features",
      eyebrow: "Around the decision",
      title: "A dispatch board that stays honest.",
      items: [
        { title: "One board, live status", body: "Assigned, en route, on site and done, updated as technicians work. Unassigned jobs stand out." },
        { title: "Rules you control", body: "Automation rules decide which jobs auto-assign and which wait for a dispatcher." },
        { title: "Guard rails", body: "Double-booking and time-off checks run whether a person or a rule does the assigning." },
        { title: "Running-late watch", body: "When a job is slipping, dispatch is flagged first and the customer is told if nobody acts." },
      ],
    },
    { kind: "trades", title: "Who uses automatic dispatch." },
  ],
  faqs: [{
    q: "Can a dispatcher override the automatic assignment?",
    a: "Yes. Dispatchers can reassign any job, and automation rules decide which jobs are assigned automatically and which wait for a person.",
  }, {
    q: "What happens if the best technician is busy?",
    a: "ArrivePing factors in each technician's open jobs and when they're projected to be free, so a technician finishing up nearby can outrank one who is free but far away. Urgent jobs lean harder on who can go now.",
  }, TRACKING_FAQ, SETUP_FAQ, PRICE_FAQ],
  related: ["/fleet-tracking", "/construction-trades", "/field-service-software", "/compare/servicetitan"],
};

const construction: LandingPage = {
  path: "/construction-trades",
  label: "Construction & trade crews",
  meta: {
    title: "Crew Scheduling & Dispatch for Construction Trades | ArrivePing",
    description:
      "Schedule and dispatch construction and trade crews across job sites: custom work orders, skill-based assignment, geofenced time clock and live status. From $49/mo.",
  },
  eyebrow: "Construction and trade efficiency",
  h1: "Run crews across every job site from one live board.",
  lede:
    "Installers, renovators, electricians and specialty subcontractors lose hours to check-in calls and crews at the wrong site. ArrivePing puts every crew, work order and job site on one board, so the day can be adjusted before it slips.",
  answer: {
    q: "How do I schedule crews across multiple job sites?",
    a: "Put every job and crew on one live board. In ArrivePing each work order carries its site, time window and required skills; crews see their jobs in the technician app; a geofence confirms arrival and runs the on-site clock; and the office sees status change in real time instead of calling around.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "On site and in the office",
      title: "Less phone tag, more billable hours.",
      items: [
        { title: "Custom work orders", body: "Site address, access notes, photos, checklists and the skills the job needs." },
        { title: "Skill-based assignment", body: "Match each job to a crew member with the right trade and certification, close to the site." },
        { title: "Geofenced time clock", body: "Arrival is confirmed at the site and on-site time is tracked across pauses, so hours match where people actually were." },
        { title: "Live status", body: "En route, on site, paused and complete, visible to the office without a single check-in call." },
        { title: "Job photos and notes", body: "Crews attach photos and notes to the work order, so the record lives with the job." },
        { title: "Customer and GC updates", body: "Send the homeowner or site contact an on-my-way text and a live arrival page." },
      ],
    },
    {
      kind: "prose",
      title: "Built by people who ran crews.",
      paragraphs: [
        "ArrivePing began as software our founding team built for National Interiors, a Winnipeg specialty subcontracting operation that ran more than 800 field technicians. Dispatchers tied to the phone, crews at the wrong site and hours that didn't add up were daily problems. ArrivePing is the tool we wanted, rebuilt by NVC360 for every trade.",
      ],
    },
    { kind: "trades", title: "Trades we work with." },
  ],
  faqs: [{
    q: "Can ArrivePing track crew hours on site?",
    a: "Yes. A geofence marks the crew member as arrived at the job address and starts the on-site clock. Time pauses when they leave the site and resumes when they return.",
  }, HARDWARE_FAQ, SETUP_FAQ, TOOLS_FAQ, PRICE_FAQ],
  related: ["/dispatch-software", "/fleet-tracking", "/field-service-software", "/about"],
};

const notifications: LandingPage = {
  path: "/customer-notifications",
  label: "Customer ETA texts & tracking",
  meta: {
    title: "On-My-Way Texts & Live Technician Tracking | ArrivePing",
    description:
      "Send customers an on-my-way text with a live technician tracking link and ETA, Uber-style. Text or call the tech in one tap. No customer app. Included from $49/mo.",
  },
  eyebrow: "Client communication",
  h1: "Give every customer an Uber-style arrival, not a four-hour window.",
  lede:
    "When your technician heads out, the customer gets a text with a live tracking link. They watch the technician approach, see the ETA, and can text or call in one tap. No app, no account, no \"where's my tech?\" calls.",
  answer: {
    q: "How do I send customers a live tracking link when my technician is on the way?",
    a: "Use field service software that sends an on-my-way text automatically. In ArrivePing, when a technician taps \"on the way\" the customer gets a text or email with a link to a live tracking page showing the technician's progress, the ETA, and buttons to text or call them. If the job runs late, the customer gets a running-late notice with the new time.",
  },
  sections: [
    {
      kind: "steps",
      eyebrow: "What the customer sees",
      title: "Four messages that replace a dozen phone calls.",
      items: [
        { title: "Booking confirmed", body: "The appointment and arrival window, in your brand and your voice." },
        { title: "On the way", body: "A text with the technician's name and a link to the live tracking page." },
        { title: "Live ETA", body: "The technician moving on the map, the ETA, and one-tap text or call." },
        { title: "Running late, or arrived", body: "A short notice with a new time if the day slips, and confirmation on arrival." },
      ],
    },
    {
      kind: "features",
      eyebrow: "Why it works",
      title: "Fewer calls to the office, fewer missed appointments.",
      items: [
        { title: "No customer app", body: "The tracking page opens in any phone browser from a text or email link." },
        { title: "Your brand, your voice", body: "Your logo and colours on every text, email and tracking page. The setup agent drafts the messages from your website." },
        { title: "Two-way contact", body: "Customers can text or call the technician from the tracking page to share a gate code or a delay." },
        { title: "Location only while travelling", body: "Customers see progress toward their own appointment only, and sharing stops on arrival." },
        { title: "Delay notices", body: "When a job is slipping, the office is flagged first and the customer is told if nobody acts." },
        { title: "Included in every plan", body: "Live customer arrival pages are part of every plan, not an add-on." },
      ],
    },
  ],
  faqs: [TRACKING_FAQ, PRIVACY_FAQ, {
    q: "What should an on-my-way text say?",
    a: "Keep it short: who is coming, roughly when, and a link to follow along. For example: \"Hi Dana, Marcus from Prairie Comfort is on the way for your furnace call. Track him live: [link]\". ArrivePing drafts these in your voice during setup and you can edit them any time.",
  }, {
    q: "Can customers contact the technician?",
    a: "Yes. The tracking page has buttons to text or call the technician, so customers can share access details or coordinate a delay without calling the office.",
  }, PRICE_FAQ],
  related: ["/on-my-way-text-software", "/fleet-tracking", "/dispatch-software", "/compare/jobber"],
};

/* ------------------------------------------------------------------ */
/* Pricing and about                                                    */
/* ------------------------------------------------------------------ */

const pricingPage: LandingPage = {
  path: "/pricing",
  label: "Pricing",
  meta: {
    title: "ArrivePing Pricing: $49/mo, Graduated Per-Driver Rates",
    description:
      "ArrivePing pricing in USD: Starter $49/mo with 1 dispatcher + 2 drivers; drivers 3–29 $30, 30+ $25 each. Live tracking, auto-dispatch and tech app in every plan.",
  },
  eyebrow: "Pricing",
  h1: "Simple, public pricing that gets cheaper per driver as you grow.",
  lede:
    "No demo needed to see a price. Every plan includes the dispatch board, the technician app and live customer arrival pages.",
  answer: {
    q: "How much does ArrivePing cost?",
    a: `${PRICE_LINE} The rates work like tax brackets: each applies only to the drivers in its band. For example, 10 drivers cost $289 a month and 30 drivers cost $827 a month.`,
  },
  sections: [{ kind: "pricing" }],
  faqs: [PRICE_FAQ, {
    q: "What counts as a driver?",
    a: "A driver is a field team member who uses the technician app to receive jobs and share their status, such as a technician, installer or delivery driver.",
  }, {
    q: "Are there setup fees or contracts?",
    a: "No large upfront cost. Plans are billed monthly and you can add or remove drivers month to month. Teams of 30 or more drivers also get custom integrations and live onboarding.",
  }, {
    q: "Is there a guarantee?",
    a: "Yes. If ArrivePing doesn't make your dispatch day calmer within the first month, we'll refund it.",
  }, {
    q: "What currency are prices in?",
    a: "All prices are in US dollars, billed monthly.",
  }],
  related: ["/compare", "/field-service-software", "/dispatch-software", "/customer-notifications"],
};

const about: LandingPage = {
  path: "/about",
  label: "About",
  meta: {
    title: "About ArrivePing by NVC360 | Winnipeg, Canada",
    description:
      "ArrivePing is field service software made by NVC360 in Winnipeg, Manitoba. It began as a tool built for a contractor running 800+ field technicians. Launching November 2026.",
  },
  eyebrow: "About ArrivePing",
  h1: "ArrivePing is field service software built in the field, in Winnipeg.",
  lede:
    "ArrivePing is made by NVC360, a Winnipeg, Manitoba software company. It started as a tool built for National Interiors, a specialty subcontracting operation with more than 800 field technicians.",
  answer: {
    q: "Who makes ArrivePing?",
    a: "ArrivePing is made by NVC360, a software company headquartered in Winnipeg, Manitoba, Canada, that builds AI software tooling and automations, custom AI solutions and software, and provides consulting. ArrivePing is NVC360's first commercial product. It is not affiliated with Arrive, Arrive Logistics, Arrive AI or the arrive.gg gaming product.",
  },
  sections: [
    { kind: "story" },
    {
      kind: "prose",
      title: "Quick facts",
      paragraphs: [],
      bullets: [
        "Product: ArrivePing, field service management software for dispatch, technician tracking and customer communication",
        "Company: NVC360, Winnipeg, Manitoba, Canada: AI software tooling and automations, custom AI solutions, consulting and software development",
        "History: first built for National Interiors, a specialty subcontractor running 800+ field technicians (sold in 2021); NVC360 was founded in late 2023 to rebuild it as a multi-tenant platform",
        "Launch: November 2026",
        "Pricing: from $49 USD a month, published at arriveping.com/pricing",
        "Platforms: web dispatch console, technician app for iOS and Android, browser-based customer tracking pages",
        "Contact: contact@nvc360.com",
      ],
    },
  ],
  faqs: [],
  related: ["/field-service-software", "/pricing", "/construction-trades"],
};

/* ------------------------------------------------------------------ */
/* Comparison pages                                                     */
/* ------------------------------------------------------------------ */

const compareParent = { label: "Compare", path: "/compare" };

const jobberSources = [
  { label: "Jobber pricing", href: "https://www.getjobber.com/pricing/" },
  { label: "Jobber GPS tracking", href: "https://www.getjobber.com/features/gps-tracking-app/" },
  { label: "Jobber customer communication", href: "https://www.getjobber.com/features/customer-communication-management/" },
  { label: "Jobber scheduling", href: "https://www.getjobber.com/features/scheduling/" },
];

const hcpSources = [
  { label: "Housecall Pro pricing", href: "https://www.housecallpro.com/pricing/" },
  { label: "Housecall Pro vehicle GPS tracking", href: "https://www.housecallpro.com/features/vehicle-gps-tracking/" },
  { label: "Housecall Pro dispatching", href: "https://www.housecallpro.com/features/dispatching-software/" },
];

const stSources = [
  { label: "ServiceTitan pricing", href: "https://www.servicetitan.com/pricing" },
  { label: "ServiceTitan Dispatch Pro", href: "https://www.servicetitan.com/features/pro/dispatch" },
  { label: "ServiceTitan Fleet Pro", href: "https://www.servicetitan.com/features/pro/fleet" },
  { label: "ServiceTitan dispatch notifications (help centre)", href: "https://help.servicetitan.com/docs/enable-text-and-email-dispatch-notifications" },
];

const AP_PRICE_CELL = { text: "$49/mo incl. 1 dispatcher + 2 drivers; then $30 per driver, $25 from driver 30 (graduated)", href: "/pricing" };

const jobber: LandingPage = {
  path: "/compare/jobber",
  label: "ArrivePing vs Jobber",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs Jobber: Live Tracking, Auto-Dispatch, Price",
    description:
      "ArrivePing vs Jobber compared: pricing, on-my-way texts with live tracking links, GPS tracking without hardware, and automatic dispatch by location and skill.",
  },
  eyebrow: "Jobber alternative",
  h1: "ArrivePing vs Jobber",
  lede:
    "Jobber is a well-established all-in-one tool for quoting, scheduling, invoicing and payments. ArrivePing focuses on dispatch and the customer's arrival experience: automatic assignment, live tracking and ETA texts in every plan.",
  answer: {
    q: "Is ArrivePing a good Jobber alternative?",
    a: "ArrivePing is a fit if your priority is dispatch and arrival times: it auto-assigns jobs by distance, skills and availability, tracks technicians through their phones without vehicle hardware, and sends customers a live tracking link with an ETA in every plan. Jobber is the stronger choice if you mainly need quotes, invoicing and a client hub from a long-established vendor.",
  },
  sections: [
    {
      kind: "table",
      title: "Side by side",
      columns: ["", "ArrivePing", "Jobber"],
      rows: [
        { label: "Starting price", cells: [AP_PRICE_CELL, { text: "Core $49/mo (1 user) without commitment; less with an annual plan", href: "https://www.getjobber.com/pricing/" }] },
        { label: "Pricing model", cells: ["Per driver, graduated: each added driver costs the same or less", { text: "Plans by tier; extra users $29/mo", href: "https://www.getjobber.com/pricing/" }] },
        { label: "Live map of the team", cells: ["Yes, from the technician app on their phone", { text: "Live GPS map uses FleetSharp devices installed in vehicles", href: "https://www.getjobber.com/features/gps-tracking-app/" }] },
        { label: "Customer tracking link with ETA", cells: ["Included in every plan", { text: "Customizable on-my-way text; we found no live tracking link or ETA described on the feature page", href: "https://www.getjobber.com/features/customer-communication-management/" }] },
        { label: "Automatic assignment", cells: ["Auto-assigns by distance, skills, availability and workload", { text: "\"Find a time\" suggests openings by availability and drive time; we found no automatic skill-based assignment described", href: "https://www.getjobber.com/features/scheduling/" }] },
        { label: "Setup", cells: ["AI setup agent builds your workspace from your website; most teams dispatch within an hour", "Self-serve with a 14-day free trial"] },
        { label: "Company", cells: ["NVC360, Winnipeg, MB; launching November 2026", "Jobber, Edmonton, AB; established vendor"] },
      ],
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: { title: "Choose ArrivePing if", items: ["Customers keep calling to ask where the technician is", "You want jobs assigned to the closest qualified tech automatically", "You'd rather not buy and install GPS trackers", "You want public, per-driver pricing that gets cheaper as you grow"] },
      theirs: { title: "Choose Jobber if", items: ["Quoting, invoicing and online payments are your main need", "You want a long track record and a large user community", "You don't need live customer tracking links"] },
    },
  ],
  faqs: [{
    q: "Does Jobber have live GPS tracking?",
    a: "Jobber's GPS tracking page says its live map uses FleetSharp tracking devices installed in your vehicles, and that GPS waypoints are recorded when team members clock in and out (checked October 7, 2026). ArrivePing uses the technician app on the phone instead, with no vehicle devices.",
  }, {
    q: "Does Jobber send on-my-way texts?",
    a: "Yes. Jobber lets you customize an on-my-way text message. ArrivePing's on-my-way text includes a link to a live tracking page with the ETA and one-tap text or call.",
  }, PRICE_FAQ, SETUP_FAQ],
  related: ["/compare/housecall-pro", "/compare/servicetitan", "/customer-notifications", "/pricing"],
  sources: jobberSources,
  verified: COMPETITORS_VERIFIED,
};

const housecallPro: LandingPage = {
  path: "/compare/housecall-pro",
  label: "ArrivePing vs Housecall Pro",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs Housecall Pro: GPS, ETA Texts & Pricing",
    description:
      "ArrivePing vs Housecall Pro compared: vehicle GPS add-on vs phone-based tracking, on-my-way tracking links, automatic dispatch and published pricing.",
  },
  eyebrow: "Housecall Pro alternative",
  h1: "ArrivePing vs Housecall Pro",
  lede:
    "Housecall Pro is a popular home-services platform with marketing, booking and payments built in. ArrivePing is built around dispatch and arrival: automatic assignment, and live tracking links that don't need vehicle hardware.",
  answer: {
    q: "Is ArrivePing a good Housecall Pro alternative?",
    a: "ArrivePing is a fit if live arrival tracking and automatic dispatch matter most: customer tracking links come from the technician's phone and are included in every plan, while Housecall Pro's live map link is tied to a $20 per vehicle per month GPS add-on. Housecall Pro is the stronger choice if you want marketing tools, online booking and payments from one established vendor.",
  },
  sections: [
    {
      kind: "table",
      title: "Side by side",
      columns: ["", "ArrivePing", "Housecall Pro"],
      rows: [
        { label: "Starting price", cells: [AP_PRICE_CELL, { text: "Basic $59/mo billed annually or $79/mo monthly (1 user)", href: "https://www.housecallpro.com/pricing/" }] },
        { label: "Pricing model", cells: ["Per driver, graduated", { text: "Plans by tier (1, 5 or 8 users); Max adds users at $35/mo each", href: "https://www.housecallpro.com/pricing/" }] },
        { label: "Vehicle / tech tracking", cells: ["Phone-based, from the technician app; no devices", { text: "Vehicle GPS is a paid add-on at $20 per vehicle per month with an OBD-II plug-in device", href: "https://www.housecallpro.com/features/vehicle-gps-tracking/" }] },
        { label: "Customer tracking link", cells: ["Live tracking page with ETA and text/call, in every plan", { text: "On-my-way text with a live map link, as part of vehicle GPS tracking", href: "https://www.housecallpro.com/features/vehicle-gps-tracking/" }] },
        { label: "Automatic assignment", cells: ["Auto-assigns by distance, skills, availability and workload", { text: "Drag-and-drop dispatching; we found no automatic assignment described", href: "https://www.housecallpro.com/features/dispatching-software/" }] },
        { label: "Setup", cells: ["AI setup agent; most teams dispatch within an hour", "14-day free trial"] },
      ],
      note: "Housecall Pro was running introductory promotions when checked; list prices are shown.",
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: { title: "Choose ArrivePing if", items: ["You want live customer tracking without buying trackers for every van", "You want the closest qualified tech assigned automatically", "Your team is growing and you want per-driver costs to fall as you add people"] },
      theirs: { title: "Choose Housecall Pro if", items: ["You want marketing, online booking and payments from one vendor", "You already use vehicle GPS hardware", "You value a large, established user base"] },
    },
  ],
  faqs: [{
    q: "How much is Housecall Pro's GPS tracking?",
    a: "Housecall Pro's vehicle GPS tracking page describes it as a paid add-on at $20 per vehicle per month, using a device that plugs into the vehicle's OBD-II port (checked October 7, 2026). ArrivePing's tracking comes from the technician app and is included in every plan.",
  }, HARDWARE_FAQ, PRICE_FAQ, SETUP_FAQ],
  related: ["/compare/jobber", "/compare/servicetitan", "/fleet-tracking", "/pricing"],
  sources: hcpSources,
  verified: COMPETITORS_VERIFIED,
};

const serviceTitan: LandingPage = {
  path: "/compare/servicetitan",
  label: "ArrivePing vs ServiceTitan",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs ServiceTitan: Pricing & Dispatch Compared",
    description:
      "ArrivePing vs ServiceTitan for small and mid-size trades: published $49/mo pricing vs request-a-quote, automatic dispatch, live tracking links and setup time.",
  },
  eyebrow: "ServiceTitan alternative",
  h1: "ArrivePing vs ServiceTitan",
  lede:
    "ServiceTitan is a deep, enterprise-grade platform for large residential and commercial contractors. ArrivePing gives small and mid-size teams automatic dispatch and live customer tracking at a published price, live in under an hour.",
  answer: {
    q: "Is ArrivePing a ServiceTitan alternative for small businesses?",
    a: "Yes, for teams whose main need is dispatch and arrival tracking. ArrivePing publishes its pricing (from $49 a month), auto-assigns jobs by distance, skills and availability in every plan, and sets up in about an hour. ServiceTitan requires a demo for pricing and offers skill- and location-based assignment through its Dispatch Pro add-on; it's the stronger choice for large contractors that need accounting, marketing and commercial-construction tools in one system.",
  },
  sections: [
    {
      kind: "table",
      title: "Side by side",
      columns: ["", "ArrivePing", "ServiceTitan"],
      rows: [
        { label: "Pricing", cells: [AP_PRICE_CELL, { text: "Not published; plans show \"Request Pricing\"; priced per technician", href: "https://www.servicetitan.com/pricing" }] },
        { label: "Automatic assignment", cells: ["Included: distance, skills, availability and workload", { text: "Dispatch Pro (a Pro product) assigns on skills, location and drive time, and predicted job value", href: "https://www.servicetitan.com/features/pro/dispatch" }] },
        { label: "Fleet tracking", cells: ["Phone-based, from the technician app", { text: "Fleet Pro (a Pro product) tracks vehicles and assets in real time with geofencing and driver scorecards", href: "https://www.servicetitan.com/features/pro/fleet" }] },
        { label: "Customer on-my-way text", cells: ["Live tracking page with ETA and text/call, in every plan", { text: "Text with tech photo, ETA and map; requires GPS on each technician device and a tracking link token", href: "https://help.servicetitan.com/docs/enable-text-and-email-dispatch-notifications" }] },
        { label: "Setup", cells: ["AI setup agent; most teams dispatch within an hour", "Pricing and onboarding through a sales demo"] },
        { label: "Best for", cells: ["Small and mid-size service and trade teams", "Large residential and commercial contractors"] },
      ],
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: { title: "Choose ArrivePing if", items: ["You want to see the price before you talk to sales", "You need dispatch and customer tracking working this week, not next quarter", "You have 1 to 100 drivers and don't need an enterprise suite"] },
      theirs: { title: "Choose ServiceTitan if", items: ["You run a large contractor with accounting, marketing and pricebook needs", "You do commercial construction and need project tools", "You have the budget and time for an enterprise rollout"] },
    },
  ],
  faqs: [{
    q: "How much does ServiceTitan cost?",
    a: "ServiceTitan doesn't publish prices. Its pricing page lists Starter, Essentials and The Works with \"Request Pricing\" and says pricing is per technician (checked October 7, 2026). ArrivePing publishes its pricing: from $49 a month.",
  }, {
    q: "Does ServiceTitan auto-assign technicians?",
    a: "ServiceTitan's Dispatch Pro, part of its Pro product line, describes assignment based on technician skills and performance, location and drive time, with full automation or dispatcher assist. In ArrivePing, automatic assignment by distance, skills, availability and workload is part of every plan.",
  }, PRICE_FAQ, SETUP_FAQ],
  related: ["/compare/jobber", "/compare/housecall-pro", "/dispatch-software", "/pricing"],
  sources: stSources,
  verified: COMPETITORS_VERIFIED,
};

/* ------------------------------------------------------------------ */
/* Customer communication pillar: on-my-way texts                       */
/* ------------------------------------------------------------------ */

const onMyWay: LandingPage = {
  path: "/on-my-way-text-software",
  label: "On-my-way text software",
  meta: {
    title: "On-My-Way Text Software with Live Tracking Link | ArrivePing",
    description:
      "Send customers an on-my-way text with a live tracking link and ETA, no customer app. Templates, timing and how it works for HVAC, plumbing, electrical and delivery teams. From $49/mo.",
  },
  eyebrow: "Customer arrival notifications",
  h1: "On-my-way texts that show the customer exactly where the tech is.",
  lede:
    "The on-my-way text is the one message every service customer wants. ArrivePing sends it automatically when the technician taps \"heading out\", with a live map, a live ETA, and buttons to text or call the technician.",
  answer: {
    q: "What is on-my-way text software?",
    a: "On-my-way text software automatically messages a customer when their technician or driver leaves for the appointment. A basic version sends a fixed message; ArrivePing's version includes a link to a live tracking page that shows the technician on a map with a live ETA and one-tap text or call, so the customer never has to phone the office to ask where the tech is. It runs from the technician's phone, with no vehicle GPS hardware and no customer app.",
  },
  sections: [
    {
      kind: "steps",
      eyebrow: "How it works",
      title: "Three taps, zero phone tag.",
      items: [
        { title: "Technician taps \"on the way\"", body: "In the ArrivePing app, one tap marks the job en route and sends the message." },
        { title: "Customer gets the text", body: "An SMS (or email) with your business name, the technician's first name and a link to the live tracking page. The template is yours to edit." },
        { title: "They watch the ETA, not the clock", body: "The tracking page shows the technician moving on a map with a live ETA. Text or call buttons connect to the technician without exposing a personal number." },
        { title: "Sharing stops at arrival", body: "A geofence marks arrival, the on-site clock starts, and the customer's view of the technician's location ends." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "Templates",
      title: "On-my-way text templates you can use today.",
      paragraphs: [
        "Keep it short: who is coming, roughly when, and a link to follow along. Use these with any tool. In ArrivePing, the on-the-way, running-late and arrived messages are drafted in your voice during setup and you can edit them any time.",
      ],
      bullets: [
        "On the way: \"Hi {first name}, this is {company}. {Tech} is on the way to your {service} appointment and should arrive about {ETA}. Track live: {link}\"",
        "Running late: \"Hi {first name}, {Tech} is running about {delay} behind. New ETA {ETA}. Live map: {link}. Reply if that no longer works for you.\"",
        "Arrived: \"{Tech} from {company} has arrived for your {service} appointment.\"",
        "Day-before reminder (any scheduling tool): \"Reminder: your {service} appointment with {company} is tomorrow, {window}. We'll text you a live tracking link when the tech is on the way.\"",
      ],
    },
    {
      kind: "features",
      eyebrow: "Why it matters",
      title: "What a live ETA changes for a service business.",
      items: [
        { title: "Fewer \"where's my tech?\" calls", body: "The answer is on the customer's phone, so your office stops relaying ETAs between the truck and the house." },
        { title: "Shorter windows you can keep", body: "When the customer can see progress, a precise ETA replaces the four-hour window and the no-shows it causes." },
        { title: "Trust before the doorbell", body: "The customer knows the technician's name and sees them coming. The visit starts on a better footing." },
        { title: "Privacy by default", body: "The customer sees the technician's progress toward their own appointment, only while en route. Nothing else, ever." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "Consent and compliance",
      title: "Texting customers in Canada and the US.",
      paragraphs: [
        "ArrivePing's arrival texts are notifications about a service the customer has already booked, sent to the number they gave you for that job. Capture the mobile number and a clear note that you will text appointment updates at booking, and give customers an easy way to opt out. Canada's anti-spam law (CASL) and the US TCPA treat marketing texts differently from service notifications, so keep promotional messages in a separate, opted-in campaign and get advice for your own situation.",
      ],
    },
    { kind: "trades", title: "Teams that send on-my-way texts with ArrivePing." },
  ],
  faqs: [
    TRACKING_FAQ,
    PRIVACY_FAQ,
    {
      q: "Can I customize the on-my-way message?",
      a: "Yes. The on-the-way, running-late and arrived messages are drafted in your voice by the setup agent and you can edit them any time, including your business name and how the technician is introduced.",
    },
    {
      q: "Does the on-my-way text work without GPS hardware?",
      a: "Yes. The live tracking page uses the location from the ArrivePing app on the technician's phone, so there is nothing to install in the vehicle.",
    },
    {
      q: "What does the customer see if they open the link after the technician arrives?",
      a: "The page shows that the technician has arrived and the job is in progress. Live location sharing ends at arrival.",
    },
    PRICE_FAQ,
  ],
  related: ["/customer-notifications", "/fleet-tracking", "/dispatch-software", "/compare/workiz"],
};

/* ------------------------------------------------------------------ */
/* Last-mile delivery and driver dispatch                               */
/* ------------------------------------------------------------------ */

const delivery: LandingPage = {
  path: "/delivery-dispatch-software",
  label: "Delivery dispatch software",
  meta: {
    title: "Last-Mile Delivery Dispatch Software for Small Fleets | ArrivePing",
    description:
      "Dispatch drivers for appointment-based deliveries and installs: live driver map, auto-assign the closest driver, customer tracking link with ETA, geofenced arrival. No GPS hardware. From $49/mo.",
  },
  eyebrow: "Last-mile delivery dispatch",
  h1: "Last-mile delivery dispatch for teams that promise an arrival time.",
  lede:
    "Furniture and appliance delivery, installers, equipment drop-offs, courier runs with a booked window: when the customer has to be home, the arrival experience is the product. ArrivePing puts your drivers on a live map, assigns the closest one, and gives every customer an Uber-style tracking link.",
  answer: {
    q: "What is last-mile delivery dispatch software?",
    a: "Last-mile delivery dispatch software assigns deliveries to drivers, tracks them on the road and keeps the customer informed until the item is at the door. ArrivePing is built for appointment-based last-mile work: it shows every driver on a live map, auto-assigns each delivery to the closest available driver with the right vehicle or skills, sends the stop to the driver's phone, and texts the customer a live tracking link with an ETA. Arrival is confirmed by geofence. If you need to optimize hundreds of parcel stops per driver per day, a dedicated route optimizer is the better tool.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "What you get",
      title: "The last mile, from assignment to the doorstep.",
      items: [
        { title: "Live driver map", body: "Every driver and vehicle on one map with status: available, en route, arrived, delivering." },
        { title: "Closest-driver assignment", body: "ArrivePing ranks drivers by distance, availability, workload and any required skills or vehicle type, then assigns the delivery. Dispatchers can override." },
        { title: "Driver app", body: "Stop details, access notes and contact info on the driver's phone. One tap to accept, one tap to head out, one tap to text or call the customer." },
        { title: "Customer tracking link", body: "An on-my-way text with a live map, ETA and the driver's first name. No customer app." },
        { title: "Geofenced arrival", body: "Arrival at the address is recorded automatically and starts the on-site clock for unloads and installs." },
        { title: "Phone-based GPS", body: "Location comes from the driver app. No telematics boxes, no per-vehicle hardware fees." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "Fit",
      title: "Appointment deliveries, not parcel routing.",
      paragraphs: [
        "ArrivePing is at its best when each delivery or install is an appointment the customer is waiting for: a sofa, a water heater, a piece of equipment, a courier run with a promised window. It optimizes who goes and keeps the customer informed about when they will arrive.",
        "If your drivers run 100-plus parcel stops a day and the main problem is stop sequencing, use a route optimizer such as Onfleet, Routific or OptimoRoute. Those tools are built for that; ArrivePing is built for the arrival experience.",
      ],
    },
    {
      kind: "steps",
      eyebrow: "How it works",
      title: "A delivery in five steps.",
      items: [
        { title: "Book the delivery", body: "From your office, an intake form or an integration, with the time window, items and access notes." },
        { title: "Auto-assign the driver", body: "The closest available driver with the right vehicle or skills gets the stop." },
        { title: "Send it to their phone", body: "Address, items, gate codes and contact details in the driver app." },
        { title: "Text the customer", body: "On-my-way message with a live tracking link and ETA when the driver heads out." },
        { title: "Confirm arrival", body: "Geofence marks the arrival; the on-site clock covers the unload or install." },
      ],
    },
    { kind: "trades", title: "Delivery and install teams we're built for." },
  ],
  faqs: [
    {
      q: "Does ArrivePing optimize multi-stop routes?",
      a: "ArrivePing assigns each delivery to the best driver by distance, availability, workload and skills, and shows the drive to each stop. It is not a parcel route optimizer that sequences hundreds of stops per driver; for that, pair it with or choose a dedicated routing tool.",
    },
    HARDWARE_FAQ,
    TRACKING_FAQ,
    {
      q: "Can the customer contact the driver?",
      a: "Yes. The tracking page has text and call buttons that reach the driver without exposing a personal phone number.",
    },
    PRICE_FAQ,
    SETUP_FAQ,
  ],
  related: ["/fleet-tracking", "/on-my-way-text-software", "/compare/onfleet", "/compare/routific"],
};

/* ------------------------------------------------------------------ */
/* Additional comparisons                                                */
/* ------------------------------------------------------------------ */

const workizSources = [
  { label: "Workiz pricing plans", href: "https://www.workiz.com/pricing-plans/" },
  { label: "Workiz On My Way feature", href: "https://www.workiz.com/features/on-my-way/" },
  { label: "Workiz help centre: On My Way Pro", href: "https://help.workiz.com/hc/en-us/articles/32686565665937" },
];

const onfleetSources = [
  { label: "Onfleet pricing", href: "https://onfleet.com/pricing" },
  { label: "Onfleet llms.txt (company facts)", href: "https://onfleet.com/llms.txt" },
];

const routificSources = [
  { label: "Routific pricing", href: "https://www.routific.com/pricing" },
  { label: "Routific home", href: "https://www.routific.com/" },
];

const workiz: LandingPage = {
  path: "/compare/workiz",
  label: "ArrivePing vs Workiz",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs Workiz: On-My-Way Texts, Tracking, Price",
    description:
      "ArrivePing vs Workiz compared for home service teams: published pricing, on-my-way texts with live tracking, GPS tracking without hardware, and automatic dispatch. Sources linked.",
  },
  eyebrow: "Workiz alternative",
  h1: "ArrivePing vs Workiz",
  lede:
    "Workiz is a broad home-service platform with scheduling, invoicing, phone and an On My Way feature. ArrivePing is narrower and cheaper to start: dispatch, live tracking and customer ETAs, with pricing published on the site.",
  answer: {
    q: "Is ArrivePing a good Workiz alternative?",
    a: "ArrivePing fits if you want the arrival experience without a full platform: automatic dispatch by distance and skill, live tracking from the technician's phone and an on-my-way text with a live map and ETA, from a published $49 a month. Workiz is the broader choice if you want scheduling, invoicing, a business phone system and marketing in one product and are comfortable requesting a quote.",
  },
  sections: [
    {
      kind: "table",
      title: "Side by side",
      columns: ["", "ArrivePing", "Workiz"],
      rows: [
        { label: "Published pricing", cells: [AP_PRICE_CELL, { text: "Standard, Pro and Ultimate plans; prices on request", href: "https://www.workiz.com/pricing-plans/" }] },
        { label: "Free trial", cells: ["Book a demo; launching November 2026", { text: "7-day free trial", href: "https://www.workiz.com/pricing-plans/" }] },
        { label: "On-my-way text", cells: ["Included in every plan, with a live tracking page and ETA", { text: "On My Way feature; an \"On My Way Pro\" tier is documented in the help centre", href: "https://www.workiz.com/features/on-my-way/" }] },
        { label: "Live map of the team", cells: ["Yes, from the technician app on their phone; no hardware", "Not verified on Workiz's public pages at the time of writing"] },
        { label: "Automatic assignment by location and skill", cells: ["Yes, in every plan", "Not verified on Workiz's public pages at the time of writing"] },
        { label: "Scope", cells: ["Dispatch, tracking, customer updates, work orders, invoicing, exports", { text: "Scheduling, invoicing, payments, phone system, marketing and more", href: "https://www.workiz.com/" }] },
        { label: "Company", cells: ["NVC360, Winnipeg, MB", "Workiz, San Diego, CA"] },
      ],
      note: "Rows marked \"not verified\" mean we could not confirm the capability from Workiz's public pages; it may exist. Tell us and we will correct the table.",
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: { title: "Choose ArrivePing if", items: ["You want the price before the sales call", "Live tracking links and ETAs in every plan matter more than breadth", "You want jobs assigned to the closest qualified tech automatically", "You already have accounting and want exports, not a replacement"] },
      theirs: { title: "Choose Workiz if", items: ["You want phone, marketing, invoicing and scheduling in one platform", "You are happy to request a quote and run a 7-day trial", "You want a large library of trade calculators and templates"] },
    },
  ],
  faqs: [
    {
      q: "Does Workiz publish its prices?",
      a: "Not at the time we checked (October 7, 2026): the pricing page lists Standard, Pro and Ultimate plans with \"request pricing\". ArrivePing publishes its full graduated per-driver pricing.",
    },
    {
      q: "Does Workiz send on-my-way texts?",
      a: "Yes. Workiz has an On My Way feature, and its help centre documents an On My Way Pro tier. ArrivePing's on-my-way text is included in every plan and opens a live tracking page with the ETA and text or call buttons.",
    },
    PRICE_FAQ,
    SETUP_FAQ,
  ],
  related: ["/on-my-way-text-software", "/compare/jobber", "/compare/housecall-pro", "/pricing"],
  sources: workizSources,
  verified: COMPETITORS_VERIFIED,
};

const onfleet: LandingPage = {
  path: "/compare/onfleet",
  label: "ArrivePing vs Onfleet",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs Onfleet: Last-Mile Dispatch for Small Fleets",
    description:
      "ArrivePing vs Onfleet for last-mile delivery: published pricing from $49 vs $619 per month, appointment-based dispatch vs high-volume route optimization, customer tracking and hardware. Sources linked.",
  },
  eyebrow: "Onfleet alternative",
  h1: "ArrivePing vs Onfleet",
  lede:
    "Onfleet is an established last-mile platform for high-volume delivery operations. ArrivePing is for smaller fleets doing appointment-based deliveries and installs, at a fraction of the entry price.",
  answer: {
    q: "Is ArrivePing a good Onfleet alternative for a small delivery fleet?",
    a: "If you run a handful of drivers doing booked deliveries or installs, ArrivePing gives you a live driver map, closest-driver assignment, a driver app and customer tracking links with ETA from $49 a month, with no hardware. Onfleet starts at $619 a month and is built for higher-volume operations that need multi-stop route optimization and a courier toolset; choose Onfleet if stop sequencing at scale is your main problem.",
  },
  sections: [
    {
      kind: "table",
      title: "Side by side",
      columns: ["", "ArrivePing", "Onfleet"],
      rows: [
        { label: "Published starting price", cells: [AP_PRICE_CELL, { text: "Launch $619/mo; Scale $1,349/mo; Enterprise $3,099/mo; Courier Suite add-on $299/mo", href: "https://onfleet.com/pricing" }] },
        { label: "Built for", cells: ["Appointment-based deliveries, installs and service calls for small and mid-size teams", { text: "\"One Platform. All Your Last Mile Delivery.\" High-volume delivery operations", href: "https://onfleet.com/" }] },
        { label: "Multi-stop route optimization", cells: ["No. Closest-driver assignment per delivery", { text: "Core capability (per Onfleet's site)", href: "https://onfleet.com/llms.txt" }] },
        { label: "Customer tracking link with ETA", cells: ["Every plan; no customer app", "Customer notifications and tracking are part of the platform (per Onfleet's site)"] },
        { label: "Vehicle hardware", cells: ["Not needed; location from the driver app", "Not needed; driver app"] },
        { label: "Company", cells: ["NVC360, Winnipeg, MB", "Onfleet, San Francisco, CA"] },
      ],
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: { title: "Choose ArrivePing if", items: ["You have 1–29 drivers doing booked deliveries or installs", "The customer's arrival experience is what you are fixing", "$619 a month is more than the problem costs you", "You also dispatch technicians or installers from the same team"] },
      theirs: { title: "Choose Onfleet if", items: ["Drivers run dozens of stops a day and sequencing matters most", "You need courier-grade tooling, analytics and integrations at scale", "You are an enterprise or marketplace operation"] },
    },
  ],
  faqs: [
    {
      q: "How much does Onfleet cost?",
      a: "Onfleet's pricing page listed Launch at $619 per month, Scale at $1,349 per month and Enterprise at $3,099 per month, plus a Courier Suite add-on at $299 per month, when we checked on October 7, 2026. ArrivePing starts at $49 per month.",
    },
    {
      q: "Does ArrivePing do route optimization like Onfleet?",
      a: "No. ArrivePing assigns each delivery to the closest available driver with the right skills or vehicle and shows the drive to that stop. It does not sequence hundreds of parcel stops per driver; Onfleet and similar tools are built for that.",
    },
    PRICE_FAQ,
    HARDWARE_FAQ,
  ],
  related: ["/delivery-dispatch-software", "/compare/routific", "/fleet-tracking", "/pricing"],
  sources: onfleetSources,
  verified: COMPETITORS_VERIFIED,
};

const routific: LandingPage = {
  path: "/compare/routific",
  label: "ArrivePing vs Routific",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs Routific: Appointment Dispatch vs Route Planning",
    description:
      "ArrivePing vs Routific compared: published pricing, route planning vs appointment-based dispatch, customer tracking links and ETAs, driver app and hardware. Sources linked.",
  },
  eyebrow: "Routific alternative",
  h1: "ArrivePing vs Routific",
  lede:
    "Routific is a route planning and delivery management tool with a free tier for small volumes. ArrivePing is dispatch for teams whose deliveries and service calls are appointments, with the customer's live ETA built in.",
  answer: {
    q: "Should I use ArrivePing or Routific?",
    a: "Use Routific if your day is a list of stops to sequence efficiently: it is a route optimizer with a free plan for up to 100 orders a month and a $150 a month plan for up to 1,000. Use ArrivePing if your deliveries and jobs are appointments where the customer is waiting: it auto-assigns the closest driver or technician, tracks them from their phone and texts the customer a live tracking link with an ETA, from $49 a month including one dispatcher and two drivers.",
  },
  sections: [
    {
      kind: "table",
      title: "Side by side",
      columns: ["", "ArrivePing", "Routific"],
      rows: [
        { label: "Published pricing", cells: [AP_PRICE_CELL, { text: "Free for up to 100 orders/mo; $150/mo for up to 1,000 orders; per-order fees above that", href: "https://www.routific.com/pricing" }] },
        { label: "Pricing basis", cells: ["Per driver, graduated", { text: "Per order volume", href: "https://www.routific.com/pricing" }] },
        { label: "Multi-stop route optimization", cells: ["No. Closest-driver assignment per delivery or job", { text: "Core product (\"Delivery management for growing businesses\")", href: "https://www.routific.com/" }] },
        { label: "Customer SMS notifications", cells: ["Included in every plan, with live tracking page and ETA", { text: "SMS add-on priced on request", href: "https://www.routific.com/pricing" }] },
        { label: "Dispatching technicians as well as drivers", cells: ["Yes: skills, availability and workload are part of assignment", "Delivery-focused"] },
        { label: "Vehicle hardware", cells: ["Not needed", "Not needed"] },
        { label: "Company", cells: ["NVC360, Winnipeg, MB", "Routific, Vancouver, BC"] },
      ],
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: { title: "Choose ArrivePing if", items: ["Each delivery or job is an appointment the customer is waiting for", "You want the customer tracking link included, not as an add-on", "You dispatch technicians or installers too", "You want per-driver pricing that gets cheaper as you grow"] },
      theirs: { title: "Choose Routific if", items: ["Stop sequencing across a full day of deliveries is the main problem", "You are under 100 orders a month and want a free plan", "Deliveries are the whole business"] },
    },
  ],
  faqs: [
    {
      q: "Is Routific free?",
      a: "Routific's pricing page offered a free plan for up to 100 orders a month and a $150 per month plan for up to 1,000 orders, with per-order fees beyond that, when we checked on October 7, 2026. ArrivePing has no free plan; it starts at $49 per month including one dispatcher and two drivers.",
    },
    {
      q: "Can I use ArrivePing and Routific together?",
      a: "Yes. Some teams plan high-volume routes in a route optimizer and run appointment deliveries, installs and service calls through ArrivePing. ArrivePing exports to CSV, JSON, webhooks, Zapier and Make.",
    },
    PRICE_FAQ,
    TRACKING_FAQ,
  ],
  related: ["/delivery-dispatch-software", "/compare/onfleet", "/on-my-way-text-software", "/pricing"],
  sources: routificSources,
  verified: COMPETITORS_VERIFIED,
};

/* ------------------------------------------------------------------ */
/* Trade pages                                                          */
/* ------------------------------------------------------------------ */

const hvac: LandingPage = {
  path: "/hvac-dispatch-software",
  label: "HVAC dispatch software",
  meta: {
    title: "HVAC Dispatch Software with Live Tech Tracking | ArrivePing",
    description:
      "HVAC dispatch software for no-heat and no-cool calls: auto-assign the closest tech with the right certification, send customers a live ETA text, and run maintenance season from one map. From $49/mo.",
  },
  eyebrow: "HVAC & mechanical",
  h1: "HVAC dispatch software for the days when every call is urgent.",
  lede:
    "A furnace out at -30 or an AC down in a heat wave is not a ticket, it's a household waiting by the window. ArrivePing gets the closest qualified technician moving, tells the homeowner exactly when they'll arrive, and keeps the maintenance-season board from collapsing when emergencies land on top of it.",
  answer: {
    q: "What should HVAC dispatch software do?",
    a: "HVAC dispatch software should assign each call to the closest technician who holds the right certification (gas, refrigeration, electrical), re-sequence the day when a no-heat emergency lands, and keep the homeowner informed with an on-my-way text and live ETA. ArrivePing does this from the technician's phone with no vehicle hardware, confirms arrival by geofence, and starts the on-site clock automatically, from $49 a month.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "Built for HVAC",
      title: "Emergency calls, maintenance season and everything between.",
      items: [
        { title: "Certification-aware assignment", body: "Tag technicians with gas, refrigeration, electrical or sheet-metal skills. Auto-assignment only considers techs who hold what the job needs." },
        { title: "Emergency reshuffle", body: "When a no-heat call arrives, dispatch sees who is closest and who can be freed, assigns in one tap, and every affected customer gets an updated ETA." },
        { title: "Maintenance tune-up routes", body: "Book seasonal tune-ups by neighbourhood so technicians drive less between visits; the live map shows the day unfolding." },
        { title: "On-my-way texts with live ETA", body: "The homeowner sees the van moving and the arrival time updating as the drive progresses. Fewer \"where is he?\" calls to the office." },
        { title: "Geofenced arrival and on-site time", body: "Arrival is recorded automatically when the tech reaches the address; the on-site clock covers diagnosis, repair and commissioning." },
        { title: "Parts and access notes on the phone", body: "Model numbers, filter sizes, furnace-room access and gate codes travel with the work order." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "A winter morning",
      title: "What a no-heat call looks like in ArrivePing.",
      paragraphs: [
        "08:12. A homeowner calls: furnace won't fire, house at 14 °C. Your office creates the work order with the symptom, equipment make and access notes. ArrivePing ranks your gas-ticketed technicians by distance, availability and current load and proposes Marcus, 11 minutes away and finishing a tune-up.",
        "08:14. Marcus accepts on his phone, taps \"on the way\", and the homeowner receives a text with his name, a live map and a 08:27 ETA. The office sees him moving. Nobody phones anyone.",
        "08:26. Marcus crosses the geofence; arrival is logged and the on-site clock starts. The tune-up he left is still scheduled for his afternoon, and that customer already received a running-late notice with the new time.",
      ],
    },
    { kind: "trades", title: "Trades that dispatch with ArrivePing." },
  ],
  faqs: [
    {
      q: "Can ArrivePing only assign gas work to gas-ticketed technicians?",
      a: "Yes. Skills are part of every technician profile and every work order; auto-assignment only considers technicians who hold the skills the job requires. Dispatchers can override.",
    },
    {
      q: "How does ArrivePing handle emergency no-heat calls on a full day?",
      a: "Create the work order as high priority and ArrivePing shows the closest qualified technicians and their current jobs. Reassign in one tap; customers whose appointments move get a running-late text with the new time.",
    },
    HARDWARE_FAQ,
    TRACKING_FAQ,
    PRICE_FAQ,
    SETUP_FAQ,
  ],
  related: ["/dispatch-software", "/on-my-way-text-software", "/fleet-tracking", "/compare/housecall-pro"],
};

const plumbing: LandingPage = {
  path: "/plumbing-dispatch-software",
  label: "Plumbing dispatch software",
  meta: {
    title: "Plumbing Dispatch Software: Closest Tech, Live ETA | ArrivePing",
    description:
      "Plumbing dispatch software for burst pipes, backups and water heaters: auto-assign the closest available plumber, text the customer a live ETA, confirm arrival by geofence. No GPS hardware. From $49/mo.",
  },
  eyebrow: "Plumbing",
  h1: "Plumbing dispatch software for calls that can't wait for a four-hour window.",
  lede:
    "A burst pipe doesn't care about your schedule. ArrivePing finds the closest available plumber, gets the job onto their phone with the shut-off and access notes, and tells the customer exactly when help arrives, while the rest of the day's installs and inspections stay on track.",
  answer: {
    q: "What is the best way to dispatch plumbers?",
    a: "Dispatch plumbers by proximity and availability, not by who is next on a list: for a burst pipe or a sewer backup, the closest free plumber saves the most damage. ArrivePing ranks your plumbers by distance, skills and current workload, assigns in one tap, texts the customer an on-my-way message with a live tracking link, and records arrival by geofence. Location comes from the plumber's phone, so there is no vehicle hardware to install.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "Built for plumbing",
      title: "From the emergency call to the arrival at the door.",
      items: [
        { title: "Closest-plumber emergencies", body: "Burst pipe, backup, no hot water: ArrivePing shows who is closest and free, and assigns with one tap." },
        { title: "Skills on every job", body: "Tag plumbers for gas fitting, backflow testing, drain cameras or hydro-jetting; auto-assignment matches the work to the ticket." },
        { title: "Job notes that matter", body: "Shut-off valve location, access instructions, previous visit notes and photos travel with the work order to the plumber's phone." },
        { title: "Live ETA for the customer", body: "The customer sees the plumber approaching on a map with a live ETA and can text or call them directly, without getting a personal number." },
        { title: "Arrival and on-site time", body: "A geofence records the arrival time and runs the on-site clock, so emergency and after-hours billing rests on real timestamps." },
        { title: "Installs and inspections stay scheduled", body: "When an emergency pulls a plumber away, the affected customer gets a running-late notice automatically." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "Why proximity matters",
      title: "Minutes are litres.",
      paragraphs: [
        "A burst supply line can release several litres a minute. The difference between the plumber who is 9 minutes away and the one who is next in the rotation but 35 minutes away is the difference between a mop and a restoration claim. ArrivePing makes distance a first-class signal in every assignment, alongside skills and workload, and shows dispatch the trade-off before they confirm.",
        "The same location feed powers the customer's live tracking page, so the household that is holding a bucket under the ceiling can see help getting closer instead of calling your office for an estimate.",
      ],
    },
    { kind: "trades", title: "Trades that dispatch with ArrivePing." },
  ],
  faqs: [
    {
      q: "Does ArrivePing help with after-hours and emergency plumbing calls?",
      a: "Yes. Create the work order with high priority, see which plumbers are closest and available, and assign in one tap. The customer gets an on-my-way text with a live ETA, and arrival is recorded by geofence for accurate after-hours billing.",
    },
    {
      q: "Can I keep gas-fitting work to licensed plumbers?",
      a: "Yes. Skills live on each plumber's profile and each work order type; auto-assignment only proposes plumbers who hold the required skill.",
    },
    HARDWARE_FAQ,
    PRIVACY_FAQ,
    PRICE_FAQ,
    SETUP_FAQ,
  ],
  related: ["/dispatch-software", "/on-my-way-text-software", "/hvac-dispatch-software", "/compare/jobber"],
};

const electrical: LandingPage = {
  path: "/electrical-dispatch-software",
  label: "Electrical dispatch software",
  meta: {
    title: "Electrical Contractor Dispatch Software | ArrivePing",
    description:
      "Dispatch software for electrical contractors: service calls, panel upgrades, EV charger installs and multi-day projects on one live map, with skill-based assignment and live customer ETAs. From $49/mo.",
  },
  eyebrow: "Electrical",
  h1: "Electrical dispatch software for service calls and multi-day installs on one board.",
  lede:
    "Electrical shops juggle two different days at once: short service calls that need the closest licensed electrician, and installs that run for days with crews, permits and inspections. ArrivePing runs both from the same live map and keeps every customer informed about when someone will actually show up.",
  answer: {
    q: "How do electrical contractors dispatch service calls and installs together?",
    a: "Treat them as two kinds of work order on one map. Service calls (tripped breakers, dead circuits, no power to a suite) go to the closest available licensed electrician by distance, skills and workload. Installs (panel upgrades, EV chargers, lighting retrofits) are scheduled with the crew and time window, and the geofence records each day's arrival and on-site hours. In ArrivePing both kinds send the customer an on-my-way text with a live ETA, and all of it runs from the electrician's phone with no vehicle hardware.",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "Built for electrical contractors",
      title: "Service calls, installs and inspections without three spreadsheets.",
      items: [
        { title: "Licensed-only assignment", body: "Tag journeypersons, masters and apprentices; auto-assignment only proposes people licensed for the work on the order." },
        { title: "EV charger and panel-upgrade installs", body: "Schedule the crew and window; the geofence logs each arrival and on-site hours for the job cost." },
        { title: "Inspection-day coordination", body: "Put the inspection window on the work order so the right electrician is on site and the customer knows who is coming." },
        { title: "Service-call speed", body: "A commercial tenant without power gets the closest available electrician, not the next name on a list." },
        { title: "Live ETA texts", body: "Homeowners and property managers watch the electrician approach on a map and can text or call without a personal number being exposed." },
        { title: "Photos and notes on the phone", body: "Panel photos, circuit notes and access instructions travel with the job and come back with the completion record." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "Property managers",
      title: "Why property managers prefer contractors who send a tracking link.",
      paragraphs: [
        "A property manager coordinating access for a tenant does not want to stand in a hallway for a four-hour window. A text with a live ETA lets them show up five minutes before you do, which gets your electrician into the suite faster and gets you called back for the next job.",
        "ArrivePing sends that text automatically when the electrician taps \"on the way\", updates the ETA as the drive progresses, and stops sharing location the moment they arrive.",
      ],
    },
    { kind: "trades", title: "Trades that dispatch with ArrivePing." },
  ],
  faqs: [
    {
      q: "Can ArrivePing schedule multi-day electrical installs?",
      a: "Yes. Create the work order with the crew and time window for each day; arrival and on-site hours are recorded by geofence each day, and the customer gets an on-my-way text each morning.",
    },
    {
      q: "Does ArrivePing restrict work to licensed electricians?",
      a: "Yes. Licences and skills live on each profile and each work order type; auto-assignment only proposes people who hold what the job requires.",
    },
    HARDWARE_FAQ,
    TOOLS_FAQ,
    PRICE_FAQ,
    SETUP_FAQ,
  ],
  related: ["/dispatch-software", "/construction-trades", "/on-my-way-text-software", "/compare/servicetitan"],
};

/* ------------------------------------------------------------------ */
/* Canada                                                               */
/* ------------------------------------------------------------------ */

const canada: LandingPage = {
  path: "/canada",
  label: "Field service software in Canada",
  meta: {
    title: "Field Service Software Built in Canada | ArrivePing",
    description:
      "ArrivePing is field service dispatch software built in Winnipeg, Manitoba for Canadian and US trades: live technician tracking, auto-dispatch and customer ETA texts. Canadian addresses and postal codes supported.",
  },
  eyebrow: "Canada",
  h1: "Field service software built in Canada, for Canadian trades.",
  lede:
    "ArrivePing is made by NVC360 in Winnipeg, Manitoba. The software was first built for a specialty subcontractor running 800+ field technicians, so it understands -30 °C mornings, long rural drives and customers who want to know when the truck will actually arrive.",
  answer: {
    q: "Is there Canadian field service software?",
    a: "Yes. ArrivePing is field service dispatch software built and run by NVC360 in Winnipeg, Manitoba. It auto-assigns the closest qualified technician, tracks technicians from their phones with no vehicle hardware, and texts customers a live tracking link with an ETA. It works with Canadian addresses and postal codes, serves both Canada and the United States, and publishes its pricing (in US dollars, from $49 a month).",
  },
  sections: [
    {
      kind: "features",
      eyebrow: "For Canadian operators",
      title: "What matters north of the border.",
      items: [
        { title: "Built in Winnipeg", body: "NVC360 is a Canadian company. The founding team ran field operations before building the software." },
        { title: "Canadian addresses and postal codes", body: "Addresses, postal codes and drive-time ETAs use Google's maps data, which covers Canadian roads and postal codes." },
        { title: "Winter-ready dispatch", body: "Distance and drive time drive assignment, so a no-heat call at -30 goes to the technician who can actually get there first." },
        { title: "Customer texts and consent", body: "Arrival texts are notifications about a booked appointment. Collect the mobile number and consent to appointment updates at booking, keep marketing texts separate, and ArrivePing sends only the service updates." },
        { title: "Serves Canada and the US", body: "One workspace can dispatch on both sides of the border. Pricing is published in US dollars." },
        { title: "Privacy by design", body: "Technician location is shared with a customer only for their own appointment and only while the technician is en route. NVC360 is a Canadian company and handles personal information under Canadian privacy law (PIPEDA)." },
      ],
    },
    {
      kind: "prose",
      eyebrow: "Who it's for",
      title: "HVAC, plumbing, electrical, installers and delivery teams across Canada.",
      paragraphs: [
        "From single-truck shops to regional contractors, ArrivePing replaces the four-hour window with a live ETA and replaces the dispatch whiteboard with a map that assigns the closest qualified technician. Pricing is per driver and gets cheaper as you grow, so a two-van shop and a thirty-van operation pay a fair rate.",
      ],
    },
    { kind: "trades", title: "Canadian trades we're built for." },
  ],
  faqs: [
    {
      q: "Is ArrivePing a Canadian company?",
      a: "Yes. ArrivePing is built and operated by NVC360, a software company headquartered in Winnipeg, Manitoba, Canada.",
    },
    {
      q: "Is pricing in Canadian dollars?",
      a: `Pricing is published in US dollars. ${PRICE_LINE}`,
    },
    {
      q: "Does ArrivePing work with Canadian addresses and postal codes?",
      a: "Yes. Address entry, geocoding and drive-time ETAs use Google's maps data, which covers Canadian addresses, postal codes and road networks.",
    },
    {
      q: "Does ArrivePing handle SMS consent rules for Canada?",
      a: "ArrivePing sends appointment notifications (on the way, running late, arrived) about a service the customer booked. You collect the customer's mobile number and consent to appointment updates at booking and keep promotional messages in a separate, opted-in channel. For your own obligations under CASL, get advice specific to your business.",
    },
    PRIVACY_FAQ,
    HARDWARE_FAQ,
  ],
  related: ["/field-service-software", "/about", "/pricing", "/on-my-way-text-software"],
};

const compareHub: LandingPage = {
  path: "/compare",
  label: "Compare",
  meta: {
    title: "Jobber, Housecall Pro & ServiceTitan Alternative | ArrivePing",
    description:
      "How ArrivePing compares with Jobber, Housecall Pro, ServiceTitan, Workiz, Onfleet and Routific on pricing, live customer tracking links, GPS tracking and automatic dispatch. Sources linked.",
  },
  eyebrow: "Compare",
  h1: "ArrivePing compared with Jobber, Housecall Pro and ServiceTitan.",
  lede:
    "An honest look at where ArrivePing fits. Every competitor fact links to that company's own public page and shows when we checked it.",
  answer: {
    q: "What's the best alternative to Jobber, Housecall Pro or ServiceTitan for live technician tracking?",
    a: "If your priority is getting technicians to customers on time, ArrivePing includes automatic dispatch by distance and skill and Uber-style customer tracking links in every plan, with tracking from the technician's phone rather than vehicle hardware, from $49 a month. Jobber and Housecall Pro are broader all-in-one tools for quoting, invoicing and payments; ServiceTitan suits large contractors.",
  },
  sections: [
    {
      kind: "table",
      title: "At a glance",
      columns: ["", "ArrivePing", "Jobber", "Housecall Pro", "ServiceTitan"],
      rows: [
        { label: "Published starting price", cells: ["$49/mo", { text: "$49/mo (Core, no commitment)", href: "https://www.getjobber.com/pricing/" }, { text: "$59/mo annual, $79 monthly", href: "https://www.housecallpro.com/pricing/" }, { text: "Not published", href: "https://www.servicetitan.com/pricing" }] },
        { label: "Customer tracking link with ETA", cells: ["Every plan", { text: "Not described on feature page", href: "https://www.getjobber.com/features/customer-communication-management/" }, { text: "With $20/vehicle/mo GPS add-on", href: "https://www.housecallpro.com/features/vehicle-gps-tracking/" }, { text: "Yes; needs device GPS and a tracking token", href: "https://help.servicetitan.com/docs/enable-text-and-email-dispatch-notifications" }] },
        { label: "Automatic assignment by location and skill", cells: ["Every plan", { text: "Not described", href: "https://www.getjobber.com/features/scheduling/" }, { text: "Not described", href: "https://www.housecallpro.com/features/dispatching-software/" }, { text: "Dispatch Pro (Pro product)", href: "https://www.servicetitan.com/features/pro/dispatch" }] },
        { label: "Vehicle hardware for live map", cells: ["Not needed", { text: "FleetSharp devices", href: "https://www.getjobber.com/features/gps-tracking-app/" }, { text: "OBD-II device", href: "https://www.housecallpro.com/features/vehicle-gps-tracking/" }, { text: "Device GPS; Fleet Pro for vehicles", href: "https://www.servicetitan.com/features/pro/fleet" }] },
      ],
    },
    {
      kind: "table",
      title: "Delivery and customer-communication tools",
      body: "For teams comparing ArrivePing with last-mile routing or on-my-way messaging products.",
      columns: ["", "ArrivePing", "Workiz", "Onfleet", "Routific"],
      rows: [
        { label: "Published starting price", cells: ["$49/mo", { text: "On request", href: "https://www.workiz.com/pricing-plans/" }, { text: "$619/mo (Launch)", href: "https://onfleet.com/pricing" }, { text: "Free to 100 orders/mo; $150/mo to 1,000", href: "https://www.routific.com/pricing" }] },
        { label: "Customer tracking link with ETA", cells: ["Every plan", { text: "On My Way feature; Pro tier in help centre", href: "https://www.workiz.com/features/on-my-way/" }, "Part of the platform", { text: "SMS add-on priced on request", href: "https://www.routific.com/pricing" }] },
        { label: "Multi-stop route optimization", cells: ["No (closest-driver assignment)", "Not verified", "Core capability", "Core product"] },
        { label: "Dispatches technicians by skill", cells: ["Yes", "Not verified", "Delivery-focused", "Delivery-focused"] },
      ],
      note: "\"Not verified\" means we could not confirm the capability from the vendor's public pages on the date shown; it may exist.",
    },
  ],
  faqs: [],
  related: ["/compare/jobber", "/compare/housecall-pro", "/compare/servicetitan", "/compare/workiz", "/compare/onfleet", "/compare/routific"],
  sources: [...jobberSources, ...hcpSources, ...stSources, ...workizSources, ...onfleetSources, ...routificSources],
  verified: COMPETITORS_VERIFIED,
};

export const landingPages: LandingPage[] = [
  fieldService,
  fleet,
  dispatch,
  construction,
  notifications,
  onMyWay,
  delivery,
  hvac,
  plumbing,
  electrical,
  canada,
  pricingPage,
  compareHub,
  jobber,
  housecallPro,
  serviceTitan,
  workiz,
  onfleet,
  routific,
  about,
];

export const landingByPath: Record<string, LandingPage> = Object.fromEntries(landingPages.map((p) => [p.path, p]));

/** Footer navigation for the new pages. */
export const solutionLinks = [fieldService, fleet, dispatch, construction, notifications, onMyWay, delivery, hvac, plumbing, electrical, canada].map((p) => ({ label: p.label, href: p.path }));
export const compareLinks = [jobber, housecallPro, serviceTitan, workiz, onfleet, routific].map((p) => ({ label: p.label.replace("ArrivePing vs ", "vs "), href: p.path }));
