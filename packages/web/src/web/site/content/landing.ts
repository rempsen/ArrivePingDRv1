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
  "ArrivePing starts at $49 USD a month, which includes your first driver. Drivers 2–10 are $30 each, drivers 11–30 are $27 each and every driver from 31 on is $25, billed monthly.";

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
    a: "Yes. Starter is $49 a month for one driver and you can add drivers month to month. Because the rates are graduated, each added driver costs the same or less than the one before.",
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
  related: ["/dispatch-software", "/customer-notifications", "/field-service-software", "/compare/housecall-pro"],
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
        "ArrivePing comes out of NVC360, a specialty subcontracting operation in Winnipeg that ran more than 800 field technicians. Dispatchers tied to the phone, crews at the wrong site and hours that didn't add up were daily problems. ArrivePing is the tool we wanted.",
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
  related: ["/fleet-tracking", "/dispatch-software", "/compare/jobber", "/field-service-software"],
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
      "ArrivePing pricing in USD: Starter $49/mo with your first driver; drivers 2–10 $30, 11–30 $27, 31+ $25 each. Live tracking, auto-dispatch and tech app in every plan.",
  },
  eyebrow: "Pricing",
  h1: "Simple, public pricing that gets cheaper per driver as you grow.",
  lede:
    "No demo needed to see a price. Every plan includes the dispatch board, the technician app and live customer arrival pages.",
  answer: {
    q: "How much does ArrivePing cost?",
    a: `${PRICE_LINE} The rates work like tax brackets: each applies only to the drivers in its band. For example, 10 drivers cost $319 a month and 30 drivers cost $859 a month.`,
  },
  sections: [{ kind: "pricing" }],
  faqs: [PRICE_FAQ, {
    q: "What counts as a driver?",
    a: "A driver is a field team member who uses the technician app to receive jobs and share their status, such as a technician, installer or delivery driver.",
  }, {
    q: "Are there setup fees or contracts?",
    a: "No large upfront cost. Plans are billed monthly and you can add or remove drivers month to month. Teams of 31 or more drivers also get custom integrations and live onboarding.",
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
      "ArrivePing is field service software made by NVC360 in Winnipeg, Manitoba, built from running 800+ field technicians. Launching November 2026.",
  },
  eyebrow: "About ArrivePing",
  h1: "ArrivePing is field service software built in the field, in Winnipeg.",
  lede:
    "ArrivePing is made by NVC360, a Winnipeg, Manitoba company that ran a specialty subcontracting operation with more than 800 field technicians before building the software it couldn't find.",
  answer: {
    q: "Who makes ArrivePing?",
    a: "ArrivePing is made by NVC360, a field service software company headquartered in Winnipeg, Manitoba, Canada. ArrivePing is not affiliated with Arrive, Arrive Logistics, Arrive AI or the arrive.gg gaming product.",
  },
  sections: [
    { kind: "story" },
    {
      kind: "prose",
      title: "Quick facts",
      paragraphs: [],
      bullets: [
        "Product: ArrivePing, field service management software for dispatch, technician tracking and customer communication",
        "Company: NVC360, Winnipeg, Manitoba, Canada",
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

const AP_PRICE_CELL = { text: "$49/mo incl. first driver; then $30, $27, $25 per driver (graduated)", href: "/pricing" };

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

const compareHub: LandingPage = {
  path: "/compare",
  label: "Compare",
  meta: {
    title: "Jobber, Housecall Pro & ServiceTitan Alternative | ArrivePing",
    description:
      "How ArrivePing compares with Jobber, Housecall Pro and ServiceTitan on pricing, live customer tracking links, GPS tracking and automatic dispatch. Sources linked.",
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
  ],
  faqs: [],
  related: ["/compare/jobber", "/compare/housecall-pro", "/compare/servicetitan", "/pricing"],
  sources: [...jobberSources, ...hcpSources, ...stSources],
  verified: COMPETITORS_VERIFIED,
};

export const landingPages: LandingPage[] = [
  fieldService,
  fleet,
  dispatch,
  construction,
  notifications,
  pricingPage,
  compareHub,
  jobber,
  housecallPro,
  serviceTitan,
  about,
];

export const landingByPath: Record<string, LandingPage> = Object.fromEntries(landingPages.map((p) => [p.path, p]));

/** Footer navigation for the new pages. */
export const solutionLinks = [fieldService, fleet, dispatch, construction, notifications].map((p) => ({ label: p.label, href: p.path }));
export const compareLinks = [jobber, housecallPro, serviceTitan].map((p) => ({ label: p.label.replace("ArrivePing vs ", "vs "), href: p.path }));
