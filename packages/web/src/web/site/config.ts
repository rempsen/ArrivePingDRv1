/**
 * Marketing-site configuration — the single place for brand, navigation and copy.
 *
 * Rules (from the design brief):
 *  - Every claim here must be verified. Unverified items live in
 *    `contentNeeds`, not in public copy.
 *  - App screens are real ArrivePing screens with sample data, and say so.
 */

export const brand = {
  product: "ArrivePing",
  lockup: "ArrivePing by NVC360",
  parent: "NVC360",
  tagline: "Appointment arrivals your customers can actually plan around.",
  logoDark: "/arriveping-logo-dark.png?v=3", // navy wordmark for light surfaces
  logoLight: "/arriveping-logo-light.png?v=3", // white wordmark for dark surfaces
  icon: "/apple-touch-icon.png?v=4", // square navy "AP" + ping rings mark, full-bleed — used as a badge
  watermark: "/arriveping-icon-dark.png?v=4", // white "AP" on navy — ghosted behind the closing section
  contactEmail: "contact@nvc360.com",
  launch: "Now available",
  urls: {
    signIn: "/sign-in",
    getStarted: "/get-started",
    signUp: "/get-started",
    trial: "/#free-trial",
    product: "/#product",
    how: "/#how-it-works",
    who: "/#who-its-for",
    pricing: "/#pricing",
    faqs: "/#faqs",
    privacy: "/privacy",
    terms: "/terms",
  },
} as const;

export const nav = [
  { label: "Product", href: brand.urls.product },
  { label: "How it works", href: brand.urls.how },
  { label: "Who it's for", href: brand.urls.who },
  { label: "Pricing", href: brand.urls.pricing },
  { label: "Blog", href: "/blog" },
  { label: "Support", href: "/support" },
] as const;

/* ------------------------------------------------------------------ */
/* Copy                                                                 */
/* ------------------------------------------------------------------ */

export const hero = {
  /** The three value propositions in the pill above the headline, with a blinking dot between each. */
  pillars: ["Plan with visibility.", "Assign and track.", "Communicate."],
  title: "The right tech, at the door, right when you said.",
  /** Both audiences, equal weight: the team and the homeowner. */
  promise: [
    { who: "Your team", rest: "always knows the next job." },
    { who: "Your customers", rest: "always know when you'll arrive, with a text and a live map instead of a phone call." },
  ],
  /** The four objections a buyer has before clicking, answered before the button. */
  assurances: [
    { icon: "phone", label: "No GPS hardware", sub: "Runs on the phones your team carries" },
    { icon: "clock", label: "Live in under an hour", sub: "Typical, with an AI agent doing the setup", href: "#getting-started" },
    { icon: "tap", label: "Minimal training", sub: "Accept, Start Driving, I've Arrived, Complete Job" },
    { icon: "tag", label: "From US$49 a month", sub: "1 dispatcher + 2 drivers" },
  ],
  risk: "Free for 30 days with as many users as you like. Nothing is charged until day 30, and you can cancel any time.",
  primary: { label: "Sign up free", href: brand.urls.signUp },
  secondary: { label: "See what your customer sees", href: "/#customer-view" },
  /**
   * A real photo (Pexels, free licence, no attribution required): a technician
   * stepping out of his van at a customer's home. Photo by Tima Miroshnichenko,
   * pexels.com/photo/6195893. Graded like the trade photos; number plate blurred.
   */
  photo: {
    jpg: { small: "/media/site-hero-960.jpg", large: "/media/site-hero-1920.jpg" },
    webp: { small: "/media/site-hero-960.webp", large: "/media/site-hero-1920.webp" },
    width: 1920,
    height: 1280,
  },
  /** Real ArrivePing screens (sample company, people and job). */
  device: {
    tech: {
      src: "/img/site/app/tech-enroute.webp",
      width: 680,
      height: 1478,
      alt: "The ArrivePing technician app on an iPhone: Jordan is on the way to Dana Reyes at 214 Waverley St, 3 minutes away, with Navigate, Text ETA and I've Arrived buttons.",
    },
    eta: {
      src: "/img/site/app/crop-eta.webp",
      width: 560,
      height: 128,
      alt: "Dana's tracking page: 3 min estimated arrival, 0.9 km away, live.",
    },
    techLabel: "Jordan, your technician",
    custLabel: "Dana, your customer",
    sms: {
      from: "+1 (204) 555-0142",
      /** ArrivePing's default on-the-way text to the customer (services/dispatch.ts defaultMessage, "enroute"). */
      body: "Prairie Comfort HVAC: Your technician Jordan Park is on the way! ETA ~3 min. Track live, see ETA & message them: https://arriveping.com/t/7k2q9x",
    },
    caption: "Real ArrivePing screens and default text · sample company and people",
  },
};

/** What the homeowner gets: a full-width module, deliberately unlike the dark sections around it. */
export const customerView = {
  eyebrow: "For your customers",
  title: "What your customer sees.",
  titleMuted: "No app, no account, no phone tag.",
  body:
    "The moment your technician taps Start Driving, your customer gets a text with a link to a live page: who's coming, an ETA that updates as they drive, and one-tap text or call.",
  privacy:
    "Location appears only after the technician starts driving to that job, and disappears the moment they arrive.",
  steps: [
    {
      kicker: "The text",
      title: "Sent the moment they set off",
      body: "Your company name, the technician's name and a live link, plus the ETA once it's known. Nothing to install.",
      screen: { kind: "sms" as const },
    },
    {
      kicker: "The live page",
      title: "An ETA, not a four-hour window",
      body: "Opens in any phone browser and updates as the technician drives.",
      screen: {
        kind: "img" as const,
        src: "/img/site/app/cust-track.webp",
        width: 680,
        height: 1478,
        alt: "The customer's live tracking page in a phone browser: 3 min estimated arrival, 0.9 km away, destination 214 Waverley St, and a job timeline showing the request received, the technician assigned and the technician on the way.",
      },
    },
    {
      kicker: "The technician",
      title: "Reach the technician directly",
      body: "One tap to call or text. Messages sent on the page stay with the job, so the office sees them too.",
      screen: {
        kind: "img" as const,
        src: "/img/site/app/cust-contact.webp",
        width: 680,
        height: 1478,
        alt: "The customer's page showing technician Jordan Park, rated 4.9, with Call and Text buttons, and a message thread: Jordan is about 3 minutes out and bringing a new igniter; the customer replies that the side door is open.",
      },
    },
  ],
  /** The ethos, said once: the want is old (the oldest survey below is from 2014); the fix is new. */
  whyLede:
    "Customers have wanted this for 12 years. ArrivePing makes it easy, quick and inexpensive.",
  /** Sourced figures only: every number links to the original survey. */
  stats: [
    {
      value: "89%",
      label: "of consumers want to see their technician coming, with a live arrival time",
      source: "CSG survey of 400 U.S. consumers, 2014",
      href: "https://ir.csgi.com/press-releases/press-release-details/2014/CSG-Releases-Survey-Results-on-In-Home-Customer-Service/default.aspx",
    },
    {
      value: "74%",
      label: "check a text within five minutes of getting it",
      source: "SimpleTexting survey of 1,000 U.S. consumers, 2026",
      href: "https://simpletexting.com/blog/texting-and-sms-marketing-statistics/",
    },
    {
      value: "70%",
      label: "would recommend a company just because the appointment was on time",
      source: "IBOPE Zogby for TOA Technologies, 1,026 U.S. adults, 2011",
      href: "https://www.fieldtechnologiesonline.com/doc/toa-technologies-cost-of-waiting-survey-0001",
    },
  ],
  caption: "The text is ArrivePing's default on-the-way wording; the setup agent can rewrite it in your voice. Both pages are real ArrivePing screens with a sample company, people and job.",
};

/** The technician side: minimal training, shown with the app's real buttons. */
export const techApp = {
  eyebrow: "For your technicians",
  title: "Accept. Drive. Arrive. Done.",
  titleMuted: "That's the training.",
  body:
    "The job lands on the phone your technician already carries, with the address, notes, time and price. There's nothing to install in the van.",
  taps: [
    {
      button: { src: "/img/site/app/btn-accept.webp", width: 363, height: 96 },
      screen: 0,
      spot: { x: 28.4, y: 53.7, w: 39.7, h: 4.7 },
      title: "Accept the job",
      body: "New work orders arrive as offers. One tap to take it, one to pass.",
    },
    {
      button: { src: "/img/site/app/btn-start-driving.webp", width: 345, height: 96 },
      screen: 1,
      spot: { x: 18.2, y: 17, w: 28.5, h: 3 },
      title: "Start Driving",
      body: "Your customer gets their text and live link, and the office sees the technician en route.",
    },
    {
      button: { src: "/img/site/app/btn-arrived.webp", width: 668, height: 96 },
      screen: 1,
      spot: { x: 49.9, y: 83, w: 91.6, h: 5.8 },
      title: "I've Arrived",
      body: "With the job open, the app checks the technician in automatically within 150 m of the address (the default). The button is the backup.",
    },
    {
      /** No screenshot of this state: drawn from the app's own "success" button (C.green, #03130d label). */
      button: { src: "/img/site/app/btn-complete.webp", width: 668, height: 96 },
      screen: 1,
      spot: null,
      title: "Complete Job",
      body: "One confirm and the job is done, and the office sees it finished. If you've made checklist items required, the app asks for those first.",
    },
  ],
  facts: [
    { title: "No GPS devices", body: "Location comes from the technician app, so there's no tracker to buy or wire in." },
    { title: "Off the clock means off", body: "Technicians share their location only while they're on the clock." },
  ],
  screens: [
    {
      src: "/img/site/app/tech-offer.webp",
      width: 680,
      height: 1478,
      alt: "The technician app's job list: a new offer for Dana Reyes at 214 Waverley St, tonight at 9:15 PM, $189, with Accept and Decline buttons.",
    },
    {
      src: "/img/site/app/tech-enroute.webp",
      width: 680,
      height: 1478,
      alt: "The technician app on the way to the job: Navigate, sharing live location with the customer, 3 minutes away, and the I've Arrived button.",
    },
  ],
  caption: "Real ArrivePing technician app · sample company and people",
};

/** Getting started (option 1): the setup agent builds a workspace from a website. Sample result. */
/**
 * The setup film in "Getting started": the real onboarding (services/brand-scout.ts,
 * company-provisioning.ts, terminology.ts) acted out on a made-up plumbing
 * company. Every beat is something the agent does today: it reads the home,
 * services, area, about, team and contact pages; lifts the logo and brand
 * colours; reads the address and service area; picks the trade with a reason;
 * learns their words for staff, customers and work; turns services into a
 * priced catalog; lists the people on the team page (and asks before inviting
 * anyone); writes templates, intake forms and customer texts in their words.
 * The provisioning aside is the real line for this trade (provisioning-jokes.ts).
 */
export const setupFilm = {
  site: "bluestemplumbing.ca",
  company: "Bluestem Plumbing & Drain",
  short: "Bluestem Plumbing",
  colors: { primary: "#1f4e8c", accent: "#f29a2e" },
  address: "88 Kettle Way, Winnipeg MB",
  serviceArea: "Winnipeg, East St. Paul and Headingley",
  hours: "Open 24/7",
  phone: "(204) 555-0187",
  pages: ["Home", "Services", "Service area", "About", "Our team", "Contact"],
  services: ["Emergency plumbing", "Drain cleaning", "Water heaters", "Leak repair", "Sump pumps", "Backflow testing", "Fixture installs", "Camera inspections"],
  team: [
    { name: "Jordan", role: "Journeyman plumber" },
    { name: "Kim", role: "Dispatch" },
    { name: "Sam", role: "Apprentice" },
  ],
  catalogItems: 34,
  templates: 4,
  forms: 2,
  text: "Bluestem Plumbing: Your plumber Jordan is on the way! ETA ~14 min. Track live, see ETA & message them: arriveping.com/t/7k2q9x",
  /** What the agent says, in order. `q` is the question it asks itself, `a` its answer. */
  lines: {
    read: { a: "Reading bluestemplumbing.ca: home, services, area, about, team and contact pages." },
    logo: { q: "Whose site is this?", a: "Bluestem Plumbing & Drain. That's their logo." },
    colors: { q: "Brand colours?", a: "Deep blue and amber." },
    address: { q: "Where are they?", a: "88 Kettle Way. They serve Winnipeg, East St. Paul and Headingley." },
    trade: { q: "What are they?", a: "A plumber: licensed plumbers, drains and water heaters." },
    words: { q: "What do they call things?", a: "Their people are plumbers. The work is jobs." },
    services: { q: "What do they sell?", a: "8 services. Loading a priced starter catalog for their trade." },
    team: { q: "Who works there?", a: "Jordan, Kim and Sam. I'll ask before inviting anyone." },
    joke: { a: "Bleeding the lines so nothing's stuck in the pipes…" },
    texts: { a: "Job templates, intake forms and customer texts, written in their words." },
    done: { a: "Workspace ready. Next: a short setup chat, then invite the team." },
  },
  caption: "Bluestem Plumbing & Drain and its website are made up for this demo. Times are typical; your workspace is built from your own website.",
};

/** "Your turn" under the setup film: website + work email → signup, with a HubSpot lead for marketing. */
export const setupTry = {
  eyebrow: "Your turn",
  title: "Try it with your website.",
  body: "We'll take you straight to signup with your website filled in, and the agent starts reading it.",
  site: { label: "Your website", placeholder: "yourcompany.com" },
  email: { label: "Work email", placeholder: "you@company.com" },
  button: "Build my workspace",
  price: "30 days free, then from US$49 a month. Cancel before day 30 and pay nothing.",
  fine: "We'll email you about getting set up. Unsubscribe any time.",
  noSite: { label: "No website? Sign up without one", href: brand.urls.signUp },
};

/** Getting started: the setup film leads, then the rest of the first hour and the price. Times are typical, not guaranteed. */
export const firstHour = {
  eyebrow: "Getting started",
  title: "Paste your website.",
  titleMuted: "Dispatch within the hour.",
  body: "Nobody has to learn setup, and nobody has to chase it. The ArrivePing agent reads your website the way a new hire would, then builds your workspace in about two minutes. You check it, invite your team and send your first job.",
  milestones: [
    { at: "0 min", title: "Paste your website", body: "The only form you fill in." },
    { at: "2 min", title: "Workspace built", body: "Brand, services, priced catalog, job templates, intake forms and customer texts." },
    { at: "15 min", title: "Short setup chat", body: "The agent asks 5–10 questions about your team, jobs and pricing, then tunes everything." },
    { at: "25 min", title: "Team invited", body: "Your people get a text to join and use the phone they already carry." },
    { at: "40 min", title: "Bring your data", body: "Import customers and technicians from a spreadsheet." },
    { at: "< 60 min", title: "First job dispatched", body: "Your customer gets a text and a live ETA." },
  ],
  stepsTitle: "Then the rest of the first hour.",
  note: "Typical first hour. Times vary with team size and how much data you bring.",
};

/** A · live dispatch story — "How it works". Timings are % of a 20 s loop. */
export const dispatchStory = {
  eyebrow: "How it works",
  title: "From work order to front door,",
  titleMuted: "live.",
  body: "Follow one urgent no-heat call from the moment it's booked to the moment the technician pulls up.",
  note: "Real ArrivePing map of River Heights, Winnipeg · sample company, people and times",
  steps: [
    { title: "See everyone, live", body: "Technicians, drivers and equipment on one map, updated in real time.", at: 0 },
    { title: "Create the work order", body: "Your own fields: job type, priority, time window, required skills and access notes.", at: 17.5 },
    { title: "Auto-assign the best technician", body: "ArrivePing picks the closest technician with the right skills who's free to take it.", at: 35 },
    { title: "Send it to their phone", body: "The job lands in the technician app with the address, notes and gate code. One tap to accept.", at: 55 },
    { title: "Keep the customer in the loop", body: "A text, then a live tracking page with the ETA and one-tap text or call. No phone tag.", at: 68 },
  ],
} as const;

/** For the office: the dispatcher's day, grouped by the three value propositions. Every line is in the product today. */
export const officeView = {
  eyebrow: "For your office",
  title: "Run the whole day from one board.",
  titleMuted: "Plan, assign, track and communicate.",
  body:
    "The office sees every job, every technician and every customer update in one place, and the board keeps itself current as technicians tap through their day.",
  pillars: [
    {
      title: "Plan with visibility.",
      items: [
        "Scheduler with day, week and month views",
        "A work queue of unassigned jobs to drag onto a technician",
        "Online booking forms that land as jobs",
        "Job templates with checklist items you can make required",
      ],
    },
    {
      title: "Assign and track.",
      items: [
        "Best-technician suggestions by distance, skills, availability and workload",
        "Auto-assign rules when you want them: nearest, least busy or by zone",
        "A live map of who's on the way and who's on site",
        "Arrival logged automatically at the address",
      ],
    },
    {
      title: "Communicate.",
      items: [
        "On-the-way texts with a live tracking link",
        "Running-late notices that go out if a job slips",
        "Customers reschedule online, within the cutoff you set",
        "One inbox for customer and technician messages, kept with each job",
      ],
    },
  ],
  fit: "Your words and your fields: call them jobs, visits or deliveries, add the fields you track, and give admins, dispatchers and field staff the access they need.",
  /** Real ArrivePing office screens, captured from a local instance with sample data. */
  shots: [
    {
      label: "Schedule",
      url: "arriveping.com/admin/scheduler",
      src: "/img/site/app/office-schedule.webp",
      width: 1920,
      height: 1200,
      alt: "The ArrivePing scheduler in day view: a work queue of 11 unassigned jobs on the left and the day's jobs for four technicians on the right, each marked completed, in progress, en route or assigned, with a red line at the current time.",
      caption: "The day at a glance, with unassigned jobs waiting in the queue.",
    },
    {
      label: "Assign",
      url: "arriveping.com/admin/scheduler",
      src: "/img/site/app/office-board.webp",
      width: 1920,
      height: 1200,
      alt: "The ArrivePing dispatch board: unassigned jobs with Assign and AI suggest buttons, four technicians with their job counts, and one technician's 17 jobs with their statuses.",
      caption: "Assign by hand, or let ArrivePing suggest the best technician.",
    },
    {
      label: "Work order",
      url: "arriveping.com/admin/scheduler",
      src: "/img/site/app/office-job.webp",
      width: 1920,
      height: 1200,
      alt: "An urgent ArrivePing work order for a no-heat call: customer, service and price, priority, address, required skill, the technician picker with each technician's live status, and notes for the customer and for the technician.",
      caption: "Priority, required skills, access notes and every technician's live status.",
    },
    {
      label: "Price catalog",
      url: "arriveping.com/admin/catalog",
      src: "/img/site/app/office-catalog.webp",
      width: 1920,
      height: 1200,
      alt: "The ArrivePing catalog: HVAC consumables, controls and equipment, each with its cost, price and margin.",
      caption: "Your services and parts, with cost, price and margin.",
    },
  ],
  shotsNote: "Real ArrivePing screens · sample company and data",
};

/**
 * Integrations: only what works today. The connect-only OAuth cards in the
 * admin (QuickBooks, Xero, Outlook…) move no data yet, so they are not listed
 * as integrations; accounting is described as on the roadmap, as the Help Center says.
 */
export const integrations = {
  eyebrow: "Integrations",
  title: "Keep the tools you use.",
  titleMuted: "We'll connect the rest.",
  body:
    "ArrivePing runs scheduling, dispatch, tracking and customer updates. Your accounting, payroll and CRM stay where they are, and your data moves in and out whenever you need it.",
  works: [
    { icon: "zap", title: "Zapier and Make", body: "Send job events (created, assigned, on the way, arrived, completed and more) on to thousands of apps." },
    { icon: "hook", title: "Webhooks", body: "Post the same events to your own systems, with a shared-secret header and a test ping." },
    { icon: "calendar", title: "Calendar feeds", body: "Subscribe in Google Calendar, Outlook or Apple Calendar. Technicians see only their own jobs." },
    { icon: "card", title: "Stripe payments", body: "Connect your own Stripe account and customers pay their invoices by card. ArrivePing takes no cut." },
    { icon: "sheet", title: "Spreadsheets in and out", body: "Import customers and technicians from CSV or Excel. Export jobs, customers and invoices to CSV, Excel or PDF." },
    { icon: "ai", title: "AI agents (MCP)", body: "Let an AI assistant look up, create and assign jobs through ArrivePing's MCP server. Keys from our team on request." },
  ],
  custom: {
    title: "Custom integrations are welcome.",
    body:
      "Running something we don't connect to yet, like an ERP, a CRM, telematics or your own software? Tell us, and we'll scope the integration with you.",
    points: ["Available on every plan", "Included with Fleet (30+ drivers)", "QuickBooks and Xero are on our roadmap"],
    cta: {
      label: "Tell us what you use",
      href: "mailto:contact@nvc360.com?subject=Custom%20integration%20for%20ArrivePing&body=We%20use%3A%20%0AWhat%20we%27d%20like%20to%20sync%3A%20%0ATeam%20size%3A%20",
    },
    secondary: { label: "Or ask to be contacted", href: "/#free-trial" },
  },
};

/**
 * Who it's for: one card per trade, each linking to that trade's page.
 * Images are generated stills of the trade (no real customers); `film` plays
 * on hover where the visitor allows motion.
 */
export const trades = [
  {
    key: "hvac",
    /** The text this trade's customer gets, shown over the photo (same sample technician as the trade page). */
    ping: "Devon is on the way to fix your heat. ETA 19 min.",
    label: "HVAC & mechanical",
    line: "No-heat calls to a licensed tech, with a live ETA.",
    href: "/hvac-dispatch-software",
  },
  {
    key: "plumbing",
    /** The text this trade's customer gets, shown over the photo (same sample technician as the trade page). */
    ping: "Jordan, your licensed plumber, is 14 minutes away.",
    label: "Plumbing",
    line: "Burst pipes to the nearest qualified plumber.",
    href: "/plumbing-dispatch-software",
  },
  {
    key: "electrical",
    /** The text this trade's customer gets, shown over the photo (same sample technician as the trade page). */
    ping: "Malik, a licensed electrician, is 14 minutes away.",
    label: "Electrical",
    line: "No-power calls to the right license level.",
    href: "/electrical-dispatch-software",
  },
  {
    key: "construction",
    /** The text this trade's customer gets, shown over the photo (same sample technician as the trade page). */
    ping: "Marcus finished your install. Photos and sign-off are on file.",
    label: "Installers & construction",
    line: "The right installer at every site, with proof at close-out.",
    href: "/construction-trades",
  },
  {
    key: "property",
    /** The text this trade's customer gets, shown over the photo (same sample technician as the trade page). */
    ping: "Omar from maintenance is on the way to Unit 4B. ETA 16 min.",
    label: "Property maintenance",
    line: "Residents know exactly when maintenance is coming.",
    href: "/property-maintenance-software",
  },
  {
    key: "delivery",
    /** The text this trade's customer gets, shown over the photo (same sample technician as the trade page). */
    ping: "Luis is on the way with your washer. ETA 17 min.",
    label: "Delivery & installation",
    line: "Every customer knows when your truck arrives.",
    href: "/delivery-dispatch-software",
  },
] as const;

/**
 * Real photographs for each trade (public/img/site/trades: 800×600 card,
 * 1600×900 hero, JPEG + WebP), from Pexels under the Pexels License (free for
 * commercial use, edits allowed, no attribution required; we credit anyway).
 * Each is cropped and given the same grade (calmer saturation, navy shadows,
 * warm highlights, light grain) so the set reads as one shoot; product logos
 * in frame are blurred so no brand appears to endorse us.
 *   hvac          Kathleen Austin Kuhn  https://www.pexels.com/photo/32497161/
 *   plumbing      Anıl Karakaya         https://www.pexels.com/photo/6419128/
 *   electrical    Kathleen Austin Kuhn  https://www.pexels.com/photo/32497160/
 *   construction  Mikael Blomkvist      https://www.pexels.com/photo/8961699/
 *   property      Ksenia Chernaya       https://www.pexels.com/photo/5691548/
 *   delivery      Carbell Sarfo         https://www.pexels.com/photo/33679977/
 */
export const tradeMedia = (key: string) => ({
  card: `/img/site/trades/${key}-card.webp`,
  cardJpg: `/img/site/trades/${key}-card.jpg`,
  poster: `/img/site/trades/${key}-hero.jpg`,
  posterWebp: `/img/site/trades/${key}-hero.webp`,
});

/* ------------------------------------------------------------------ */
/* Proof points & founder story                                        */
/* ------------------------------------------------------------------ */

export const stats = [
  {
    value: "1B+",
    label: "Hours lost each year to appointment waits, repeat trips, rework and phone tag",
    source: "ArrivePing research estimate",
  },
  {
    value: "20%",
    label: "Lower field labour costs at National Interiors with the system ArrivePing grew from",
    source: "National Interiors, early 2020s",
  },
  { value: "800+", label: "Field technicians run by our team before ArrivePing was built" },
] as const;

export const story = {
  eyebrow: "Why we built this",
  title: "We didn't build this in a lab.",
  titleMuted: "We built it in the field.",
  body:
    "ArrivePing began as software built for National Interiors, a specialty subcontracting operation that ran more than 800 field technicians. We lived the friction firsthand — dispatchers tied to the phone, customers demanding updates, routes that didn't add up, margin lost in every communication gap. We looked for a platform that fixed it. It didn't exist, so we built one. After National Interiors was sold in 2021, we founded NVC360 to rebuild that tool as a multi-tenant platform. ArrivePing is the result, and we're making it available to every field service team facing the same problem.",
  quote: "800+ technicians. One lesson learned: your customers' time is your reputation.",
  quoteAttribution: "ArrivePing / NVC360 founding team, Winnipeg, MB",
} as const;

/**
 * Graduated pricing (USD, billed monthly). Each rate applies only to the
 * drivers inside its band, like tax brackets, so the bill rises with every
 * driver added and never drops when a team crosses a tier.
 *   1 dispatcher + drivers 1–2 → Starter, $49
 *   drivers 3–29    → $30 each (Growing team)
 *   drivers 30+     → $25 each (Fleet: custom integrations + live onboarding)
 */
export const pricingBands = [
  { from: 3, to: 29, rate: 30 },
  { from: 30, to: Infinity, rate: 25 },
] as const;
export const STARTER_PRICE = 49;
/** Drivers included in Starter (alongside one dispatch user). */
export const STARTER_DRIVERS = 2;

export const pricing = {
  title: "Start free.",
  titleMuted: "Then from US$49 a month.",
  body: "Every plan includes the dispatch board, the technician app, live customer tracking and the AI setup. Add a driver and you pay for one more driver, nothing else.",
  /** Risk removers, all verified: billing-subscription.ts (monthly, no setup fee, card held until day 30). */
  assurances: ["$0 for 30 days, as many users as you like", "Cancel before day 30 and pay nothing", "No setup fee, no contract", "Billed monthly", "No GPS hardware to buy"],
  integrationsNote: { text: "Need a custom integration on Starter or Growing team? It's welcome.", link: { label: "See integrations", href: "/#integrations" } },
  note: "All prices in US dollars, billed monthly. Live tracking is in every plan, with no hardware and no upgrade.",
  tiers: [
    {
      name: "Starter",
      range: "1 dispatcher + 2 drivers · ready the same day",
      price: "$49",
      unit: "per month",
      features: ["Workflow set up for how your team works", "Catalog pre-loaded with your services and parts", "Operating the same day"],
      cta: { label: "Sign up free", href: brand.urls.signUp },
    },
    {
      name: "Growing team",
      range: "3–29 drivers",
      price: "$30",
      unit: "per added driver / month",
      features: ["Everything in Starter", "Dispatcher license included", "One simple rate for drivers 3–29", "Add or remove drivers month to month"],
      cta: { label: "Sign up free", href: brand.urls.signUp },
      featured: true,
    },
    {
      name: "Fleet",
      range: "30+ drivers",
      price: "$25",
      unit: "per driver / month from driver 30",
      features: ["Everything in Growing team", "Dispatcher license included", "Custom integrations included", "Live onboarding with our team"],
      cta: { label: "Sign up free", href: brand.urls.signUp },
    },
  ],
} as const;

const usd = (v: number) => `$${v.toLocaleString("en-US")}`;

/** Monthly price in USD for a team of `n` drivers, using the graduated bands above. */
export function monthlyPrice(n: number): { plan: string; total: number; breakdown: string } {
  const drivers = Math.max(1, Math.floor(n));
  let total = STARTER_PRICE;
  const parts = [`Starter ${usd(STARTER_PRICE)}`];
  for (const band of pricingBands) {
    const count = Math.max(0, Math.min(drivers, band.to) - band.from + 1);
    if (count > 0) {
      total += count * band.rate;
      parts.push(`${count} × ${usd(band.rate)}`);
    }
  }
  const plan = drivers <= STARTER_DRIVERS ? "Starter" : drivers <= 29 ? "Growing team" : "Fleet";
  return { plan, total, breakdown: drivers <= STARTER_DRIVERS ? "Starter: 1 dispatcher + 2 drivers" : parts.join(" + ") };
}

export const faqs = [
  {
    q: "Do customers need to install an app?",
    a: "No. When the technician starts driving, the customer gets a text with a link that opens a live page in their browser: who's coming, an ETA that updates as they drive, and buttons to call, text or message the technician. There's no account to create.",
  },
  {
    q: "What do technicians use?",
    a: "The ArrivePing app on the phone they already carry. A job comes in as an offer they accept, then they tap Start Driving, I've Arrived and Complete Job. With the job open, arrival is logged automatically within 150 m of the address by default, and the button is the backup.",
  },
  {
    q: "What can customers see about a technician's location?",
    a: "Only the technician's progress toward their own appointment, from the moment the technician starts driving to it. It disappears when they arrive. Technicians share their location only while they're on the clock.",
  },
  {
    q: "How long does setup take?",
    a: "The setup agent reads your website and builds your workspace in minutes: your brand, services, a priced catalog, job templates, booking forms and customer texts. After a short setup chat you invite your team and import customers from a spreadsheet. A typical first hour ends with your first job dispatched.",
  },
  {
    q: "Does it work with the software we already use?",
    a: "Yes. Job events go to Zapier, Make or your own webhook; calendars subscribe in Google, Outlook or Apple; customers and technicians import from CSV or Excel; jobs, customers and invoices export to CSV, Excel or PDF; and payments run through your own Stripe account. Custom integrations are welcome on every plan and included with Fleet. QuickBooks and Xero are on our roadmap.",
  },
  {
    q: "Does it replace our scheduling or invoicing tools?",
    a: "It can. ArrivePing includes scheduling, dispatch, work orders with your own fields, and an invoice for every job that customers can pay by card once you connect Stripe. Many teams keep their accounting and payroll software and use ArrivePing for the day's work and customer updates.",
  },
  {
    q: "How is it priced?",
    a: "In US dollars, billed monthly. Starter is $49 a month for one dispatcher and two drivers. Drivers 3–29 are $30 each, and every driver from 30 on is $25. Each rate applies only to the drivers in its band, so adding a driver never makes your bill jump. Live tracking, the technician app and the AI setup are in every plan.",
  },
  {
    q: "Is there a contract, setup fee or hardware cost?",
    a: "No. There's no setup fee, no contract and no GPS hardware; you're billed monthly and can cancel any time. The 30-day free trial needs a card on file, but nothing is charged until day 30, and if you cancel before then you pay nothing.",
  },
  {
    q: "Can we use our own wording in texts and in the app?",
    a: "Yes. Call your work jobs, visits or deliveries and your people technicians, crews or drivers, and ArrivePing uses your words everywhere, including customer texts. The setup agent drafts your messages in your voice, and you can edit any of them.",
  },
  {
    q: "Is ArrivePing available in Canada?",
    a: "Yes. ArrivePing is built in Winnipeg, Manitoba and is available in Canada and the United States. Prices are in US dollars.",
  },
] as const;

export const closing = {
  title: "Dispatch your first job today.",
  body: "Sign up, paste your website and the setup agent builds your workspace while you watch. Free for 30 days, then from US$49 a month.",
  steps: [
    { title: "Sign up", body: "No sales call and no demo to book." },
    { title: "Paste your website", body: "The agent builds your brand, services, catalog, job templates and customer texts." },
    { title: "Invite your team", body: "Technicians join from a text on the phone they already carry." },
  ],
  help: "Moving from another system or need a custom integration?",
  trial: {
    title: "Start your 30-day free trial",
    points: [
      "As many users as you like, for the whole trial",
      "Card on file, $0 until day 30",
      "Cancel before day 30 and you're never billed",
      "Then from US$49 a month: 1 dispatcher + 2 drivers",
    ],
    cta: "Sign up free",
    fine: "No setup fee, no contract, no GPS hardware.",
  },
  /** The "contact me" choice under the trial card (components/ContactAsk.tsx). */
  contact: {
    question: "Would you like to be contacted by an NVC360 associate?",
    yesLede: "Leave a name and the best way to reach you. We'll get in touch within one business day.",
    noNote: "No problem. Start your free trial above whenever you're ready.",
    cta: "Contact me",
  },
};

export const footer = {
  description:
    "ArrivePing by NVC360 — field service software for dispatch, live technician tracking and customer ETA updates. Made in Winnipeg, Canada.",
  columns: [
    {
      heading: "Product",
      links: [
        { label: "How it works", href: brand.urls.how },
        { label: "Pricing", href: "/pricing" },
        { label: "Field service software", href: "/field-service-software" },
        { label: "Dispatch software", href: "/dispatch-software" },
        { label: "Fleet tracking", href: "/fleet-tracking" },
        { label: "Customer ETA texts", href: "/customer-notifications" },
        { label: "On-my-way texts", href: "/on-my-way-text-software" },
      ],
    },
    {
      // Industry landing pages used to sit under Product, which made that
      // column 13 links tall. Same links, same SEO value, two tidy columns.
      heading: "Industries",
      links: [
        { label: "HVAC dispatch", href: "/hvac-dispatch-software" },
        { label: "Plumbing dispatch", href: "/plumbing-dispatch-software" },
        { label: "Electrical dispatch", href: "/electrical-dispatch-software" },
        { label: "Installers & construction", href: "/construction-trades" },
        { label: "Property maintenance", href: "/property-maintenance-software" },
        { label: "Delivery & installation", href: "/delivery-dispatch-software" },
        { label: "Canada", href: "/canada" },
      ],
    },
    {
      heading: "Compare",
      links: [
        { label: "All comparisons", href: "/compare" },
        { label: "vs Jobber", href: "/compare/jobber" },
        { label: "vs Housecall Pro", href: "/compare/housecall-pro" },
        { label: "vs ServiceTitan", href: "/compare/servicetitan" },
        { label: "vs Workiz", href: "/compare/workiz" },
        { label: "vs Onfleet", href: "/compare/onfleet" },
        { label: "vs Routific", href: "/compare/routific" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Blog", href: "/blog" },
        { label: "Sign up free", href: brand.urls.signUp },
        { label: "Sign in", href: brand.urls.signIn },
        { label: brand.contactEmail, href: `mailto:${brand.contactEmail}` },
      ],
    },
    {
      heading: "Support",
      links: [
        { label: "Help Center", href: "/support" },
        { label: "Get started", href: "/support#get-started" },
        { label: "Technician app", href: "/support#technician-app" },
        { label: "Billing & plans", href: "/support#billing" },
        { label: "Delete your account", href: "/support/delete-your-account" },
        { label: "Contact support", href: "mailto:support@nvc360.com" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Privacy Policy", href: brand.urls.privacy },
        { label: "Terms of Service", href: brand.urls.terms },
      ],
    },
  ],
  legal: `© ${new Date().getFullYear()} ArrivePing. All Rights Reserved.`,
  maker: { label: "An NVC360 product", href: "https://nvc360.com" },
};
