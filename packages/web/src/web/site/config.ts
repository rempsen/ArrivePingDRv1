/**
 * Marketing-site configuration — the single place for brand, navigation, copy
 * and the illustrative demo fixture used by every animated scene.
 *
 * Rules (from the design brief):
 *  - Every claim here must be verified. Unverified items live in
 *    `contentNeeds`, not in public copy.
 *  - Demo data is fictional and is always labelled "Illustrative demo".
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
/* Illustrative demo fixture (fictional; shared by every scene)        */
/* ------------------------------------------------------------------ */

export type ApptStatus = "scheduled" | "assigned" | "on_the_way" | "arriving" | "arrived";

export const statusLabel: Record<ApptStatus, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  on_the_way: "On the way",
  arriving: "Arriving soon",
  arrived: "Arrived",
};

export const fixture = {
  company: "Northside Shade Co.",
  technician: { name: "Alex Rivera", short: "Alex R.", initials: "AR" },
  technician2: { name: "Sam Kaur", short: "Sam K.", initials: "SK" },
  customer: { name: "Morgan Lee", short: "Morgan", initials: "ML" },
  appointment: {
    id: "ap-1041",
    title: "Window shade installation",
    address: "42 Birch Lane",
    window: "10:40–10:55",
    windowLate: "10:50–11:05",
    scheduledFor: "10:30",
  },
  list: [
    { id: "ap-1041", who: "Morgan Lee", what: "Window shade installation", time: "10:30", tech: "Alex R.", status: "assigned" as ApptStatus },
    { id: "ap-1042", who: "Priya Natarajan", what: "Blind repair", time: "12:15", tech: "Sam K.", status: "assigned" as ApptStatus },
    { id: "ap-1043", who: "The Harbour Café", what: "Motorized shade service", time: "2:00", tech: "", status: "scheduled" as ApptStatus },
    { id: "ap-1044", who: "Devon Adeyemi", what: "Site measure", time: "3:30", tech: "Alex R.", status: "assigned" as ApptStatus },
  ],
  messages: {
    onTheWay: "Alex is on the way. Expected arrival 10:40–10:55.",
    delay: "Running about 10 minutes behind — new arrival window 10:50–11:05.",
    arrived: "Alex has arrived.",
  },
} as const;

export const illustrativeLabel = "Illustrative demo";
/** Label on slots that play real app footage (the demo company is fictional). */
export const footageLabel = "ArrivePing app"; // screen-reader text; the visible chip is the ArrivePing logo

/* ------------------------------------------------------------------ */
/* Copy                                                                 */
/* ------------------------------------------------------------------ */

export const hero = {
  eyebrow: "AI-powered field service software and client communications",
  title: "The right tech, at the door, right when you said.",
  /** Both audiences, equal weight: the team and the homeowner. */
  promise: [
    { who: "Your team", rest: "always knows the next job." },
    { who: "Your customers", rest: "always know when you'll arrive, with a text and a live map instead of a phone call." },
  ],
  /** The four objections a buyer has before clicking, answered before the button. */
  assurances: [
    { icon: "phone", label: "No GPS hardware", sub: "Runs on the phones your team carries" },
    { icon: "clock", label: "Live in under an hour", sub: "An AI agent does the setup" },
    { icon: "tap", label: "Three taps for technicians", sub: "Accept, Start Driving, I've Arrived" },
    { icon: "tag", label: "From US$49 a month", sub: "1 dispatcher + 2 drivers" },
  ],
  risk: "Free for 30 days with as many users as you like. Nothing is charged until day 30, and you can cancel any time.",
  primary: { label: "Sign up free", href: brand.urls.signUp },
  secondary: { label: "See what your customer sees", href: "/#customer-view" },
  film: {
    large: "/media/site-hero-film-1600.mp4",
    small: "/media/site-hero-film-960.mp4",
    poster: "/media/site-hero-film-poster.jpg",
    posterWebp: "/media/site-hero-film-poster.webp",
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
      body: "Your company name, the technician's name, the ETA and a live link. Nothing to install.",
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
      title: "Call or text, without the office",
      body: "Messages stay on the job, so the office can see what was said.",
      screen: {
        kind: "img" as const,
        src: "/img/site/app/cust-contact.webp",
        width: 680,
        height: 1478,
        alt: "The customer's page showing technician Jordan Park, rated 4.9, with Call and Text buttons, and a message thread: Jordan is about 3 minutes out and bringing a new igniter; the customer replies that the side door is open.",
      },
    },
  ],
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
  title: "Three taps.",
  titleMuted: "That's the training.",
  body:
    "The job lands on the phone your technician already carries, with the address, notes, time and price. There's nothing to install in the van.",
  taps: [
    {
      button: { src: "/img/site/app/btn-accept.webp", width: 363, height: 96, alt: "Accept" },
      screen: 0,
      spot: { x: 28.4, y: 53.7, w: 39.7, h: 4.7 },
      title: "Accept the job",
      body: "New work orders arrive as offers. One tap to take it, one to pass.",
    },
    {
      button: { src: "/img/site/app/btn-start-driving.webp", width: 345, height: 96, alt: "Start Driving" },
      screen: 1,
      spot: { x: 18.2, y: 17, w: 28.5, h: 3 },
      title: "Start Driving",
      body: "Your customer gets their text and live link, and the office sees the technician en route.",
    },
    {
      button: { src: "/img/site/app/btn-arrived.webp", width: 668, height: 96, alt: "I've Arrived" },
      screen: 1,
      spot: { x: 49.9, y: 83, w: 91.6, h: 5.8 },
      title: "I've Arrived",
      body: "Usually automatic: a geofence checks the technician in at the address and starts the on-site clock. The button is the backup.",
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
/** The setup agent demo, embedded in "Getting started" (firstHour). */
export const setupAgent = {
  defaultSite: "prairiecomforthvac.com",
  run: "Run setup agent",
  note: "Sample result for an HVAC company. Your workspace is built from your own website.",
  steps: [
    { text: (site: string) => `Reading ${site} · home, services and about pages`, t: "0:06" },
    { text: () => "Logo and brand colors found", t: "0:14" },
    { text: () => "Trade detected: HVAC & Plumbing", t: "0:19" },
    { text: () => "8 services and 4 team members found", t: "0:31" },
    { text: () => "Priced catalog loaded for your trade", t: "0:48" },
    { text: () => "Job templates and intake forms written", t: "1:20" },
    { text: () => "Customer texts and emails drafted in your voice", t: "1:44" },
  ],
  done: { text: "Workspace ready. Next: a short setup chat and team invites.", t: "1:52" },
};

/** Getting started: one section. The first-hour dial leads; the setup agent run is the proof. Times are typical, not guaranteed. */
export const firstHour = {
  eyebrow: "Getting started",
  title: "Live in under an hour.",
  titleMuted: "An AI agent does the setup.",
  body: "No consultants, no hardware to install, no weeks of setup. Give the agent your website, answer a few questions about how you work, and dispatch your first job before the hour is up.",
  milestones: [
    { at: "0 min", title: "Paste your website", body: "That's the only form you fill in." },
    { at: "2 min", title: "Workspace built for you", body: "Brand, services, priced catalog, job templates, intake forms and customer texts." },
    { at: "15 min", title: "Short setup chat", body: "The agent asks 5–10 questions about your crews, jobs and pricing, then tunes everything." },
    { at: "25 min", title: "Team invited", body: "Technicians get a text and email to join, then use the ArrivePing app on the phone they already carry. No devices to buy." },
    { at: "40 min", title: "Bring your data", body: "Import customers and technicians straight from a spreadsheet." },
    { at: "Under 60", title: "First job dispatched", body: "Your customer gets a text and a live ETA." },
  ],
  demo: {
    title: "Watch the agent build a workspace",
    body: "Type any website and run it. This is a labelled sample; your workspace is built from your own site.",
  },
  cta: {
    label: "Start your 30-day free trial",
    href: brand.urls.signUp,
    price: "30 days free, then from US$49 a month",
    detail: "1 dispatcher + 2 drivers · each added driver is US$30 a month, less from driver 30",
  },
  tools: {
    title: "Keep the tools you already use",
    body: "ArrivePing runs scheduling, work order assignment, tracking and customer updates. It doesn't ask you to replace your accounting, payroll or CRM.",
  },
  formats: {
    title: "Your data, in the format you need",
    items: ["CSV", "Excel", "PDF", "JSON", "Calendar feeds", "Webhooks · Zapier, Make", "MCP for AI agents", "Google Drive backup"],
  },
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

export const chapters = [
  {
    id: "coordinate",
    rail: "Coordinate appointments",
    title: "Assign the work.",
    titleMuted: "Keep the board honest.",
    body:
      "Every appointment, its technician and its status sit in one list. Select a row to see the detail, assign a technician and the status updates everywhere at once.",
    scene: "chapter-dispatch",
    support: [
      { title: "One status, every screen", body: "Business view, technician app and customer page read from the same appointment record." },
      { title: "Fewer check-in calls", body: "Dispatchers see assignment and travel status without calling the technician." },
    ],
  },
  {
    id: "arrivals",
    rail: "Follow arrivals",
    title: "Watch the arrival window",
    titleMuted: "move with the technician.",
    body:
      "When the technician heads out, the arrival window is recalculated and the customer's page updates with it. No four-hour window, no guessing.",
    scene: "chapter-arrival",
    support: [
      { title: "Location only while travelling", body: "Technician location is shared with the customer during travel to that appointment, not all day." },
      { title: "Arrival confirmed on site", body: "A geofence marks the technician as arrived, with a manual tap as the fallback." },
    ],
  },
  {
    id: "inform",
    rail: "Keep customers informed",
    title: "Send the update",
    titleMuted: "before the customer has to ask.",
    body:
      "Running late? Send a short update from the appointment and the customer's arrival page and notification change together.",
    scene: "chapter-communication",
    support: [
      { title: "Plain-language updates", body: "Short messages written by your team, delivered by text or email with the live link." },
      { title: "A record of what was said", body: "Every update stays attached to the appointment for the office to see later." },
    ],
  },
] as const;

export const stories = [
  {
    question: "Who is heading to the next appointment?",
    answer:
      "The dispatch board lists the day's appointments with their technician and live status. Unassigned work stands out, and a change of technician is one selection — not a round of phone calls.",
    image: { src: "/img/site/dispatch-desk.jpg", alt: "A dispatcher at a desk reviewing the day's appointments on a large screen." },
    scene: "detail-visibility",
  },
  {
    question: "What does the customer see when the arrival time changes?",
    answer:
      "Their arrival page shows the new window and the technician's status, and a short notification tells them why. They do not need an app or an account.",
    image: { src: "/img/site/customer-eta.jpg", alt: "A customer at her front door checking an arrival update on her phone as a technician approaches." },
    scene: "detail-customer",
  },
] as const;

export const audiences = [
  {
    label: "HVAC & mechanical",
    body: "Send live ETAs and close more calls per day — no more holding the whole afternoon open for one visit.",
    image: "/img/site/industry-hvac.jpg",
  },
  {
    label: "Plumbing & electrical",
    body: "Dispatch the nearest qualified tech to urgent calls and keep the customer posted without a round of phone tag.",
    image: "/img/site/industry-plumbing.jpg",
  },
  {
    label: "Installers & construction",
    body: "Coordinate crews across multiple sites from one board, with live status instead of check-in calls.",
    image: "/img/site/industry-construction.jpg",
  },
  {
    label: "Property maintenance",
    body: "Track every contractor and maintenance visit across your portfolio from a single dashboard.",
    image: "/img/site/industry-property-management.jpg",
  },
  {
    label: "Delivery & logistics",
    body: "Give customers a live arrival window for their delivery instead of a daylong \"sometime today\" wait.",
    image: "/img/site/industry-delivery-logistics.jpg",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Proof points & founder story                                        */
/* ------------------------------------------------------------------ */

export const stats = [
  {
    value: "1B+",
    label: "Hours lost each year to inefficient service appointment windows",
    source: "U.S. Bureau of Labor Statistics",
  },
  { value: "20%", label: "Average reduction in field labour costs for ArrivePing teams" },
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
  guarantee: {
    title: "A guarantee, not just a pitch.",
    body:
      "No large upfront cost, no ripping out the tools you already use, onboarding built around how your team actually works. If ArrivePing doesn't make your dispatch day calmer within the first month, we'll refund it — no questions asked.",
  },
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
  title: "Start for $49.",
  titleMuted: "Each driver costs less as you grow.",
  body: "Every plan includes the dispatch board, the technician app and live customer arrival pages. Each rate applies only to the drivers in its band, so your bill never jumps when you grow into the next tier.",
  note: "All prices in US dollars, billed monthly.",
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
      features: ["Everything in Growing team", "Dispatcher license included", "Custom integrations with your systems", "Live onboarding with our team"],
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
    a: "No. Customers receive a link by text message or email that opens a live arrival page in their browser. There is no account to create.",
  },
  {
    q: "What do technicians use?",
    a: "The ArrivePing mobile app. Technicians see their appointments, tap to mark themselves on the way, and the app shares status while they travel. Arrival is confirmed automatically on site, with a manual tap as fallback.",
  },
  {
    q: "What can customers see about a technician's location?",
    a: "Only the technician's progress toward their own appointment, and only while the technician is travelling to it. Location sharing stops on arrival.",
  },
  {
    q: "How long does setup take?",
    a: "Most teams are up and running within hours. You create your company, invite technicians and add appointments. A guided onboarding walks you through each step, and our team is available during setup.",
  },
  {
    q: "Does it replace our scheduling or invoicing tools?",
    a: "ArrivePing includes scheduling, dispatch, work orders and invoicing, but you can start with arrivals and customer updates alone. Your 30-day trial is the walkthrough: sign up, and the setup agent builds your workspace from your website in about an hour.",
  },
  {
    q: "How is it priced?",
    a: "In US dollars, billed monthly, and graduated like tax brackets: Starter is $49 a month for one dispatch user and two drivers, with your workflow set up and catalog pre-loaded so you can operate the same day. Drivers 3–29 are $30 each, and every driver from 30 on is $25. Each rate applies only to the drivers in its band, so adding a driver never lowers or jumps your bill. The dispatcher license is included in every plan at no extra fee. Teams of 30 or more also get custom integrations and live onboarding.",
  },
] as const;

export const closing = {
  title: "Give your team clarity — and your customers a better arrival experience.",
  body: "Sign up, give us your website, and the setup agent builds your workspace while you watch. Thirty days free, as many users as you like, and nothing charged until day 30.",
  trial: {
    title: "Start your 30-day free trial",
    points: [
      "As many users as you like, for the whole trial",
      "Card on file, nothing charged for 30 days",
      "Cancel any time before day 30 and you're never billed",
      "After that, from $49 a month; drivers at the published rates",
    ],
    cta: "Sign up free",
    fine: "Set up in about an hour. No sales call needed.",
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
        { label: "Construction & trades", href: "/construction-trades" },
        { label: "HVAC dispatch", href: "/hvac-dispatch-software" },
        { label: "Plumbing dispatch", href: "/plumbing-dispatch-software" },
        { label: "Electrical dispatch", href: "/electrical-dispatch-software" },
        { label: "Delivery dispatch", href: "/delivery-dispatch-software" },
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
