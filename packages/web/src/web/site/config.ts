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
  logoDark: "/arriveping-logo-dark.png?v=2", // navy wordmark for light surfaces
  logoLight: "/arriveping-logo-light.png?v=2", // white wordmark for dark surfaces
  icon: "/apple-touch-icon.png?v=3", // square navy "AP" + ping rings mark, full-bleed — used as a badge
  watermark: "/arriveping-icon-dark.png?v=3", // white "AP" on navy — ghosted behind the closing section
  contactEmail: "contact@nvc360.com",
  launch: "Launching November 2026",
  urls: {
    signIn: "/sign-in",
    getStarted: "/get-started",
    demo: "#book-a-demo",
    product: "#product",
    how: "#how-it-works",
    who: "#who-its-for",
    pricing: "#pricing",
    faqs: "#faqs",
    privacy: "/privacy",
    terms: "/terms",
  },
} as const;

export const nav = [
  { label: "Product", href: brand.urls.product },
  { label: "How it works", href: brand.urls.how },
  { label: "Who it's for", href: brand.urls.who },
  { label: "Pricing", href: brand.urls.pricing },
  { label: "FAQs", href: brand.urls.faqs },
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
  eyebrow: brand.launch,
  title: "The right tech, at the door, right when you said.",
  body:
    "ArrivePing shows your whole team live, sends each job to the closest qualified technician, and keeps your customer updated with a live ETA. No more calls asking where the technician is.",
  primary: { label: "Book a demo", href: brand.urls.demo },
  secondary: { label: "See how it works", href: brand.urls.how },
  fine: "No app for customers · Technicians use the ArrivePing mobile app · Up and running in hours",
  feedLabel: "One job, start to finish",
  film: {
    large: "/media/site-hero-film-1600.mp4",
    small: "/media/site-hero-film-960.mp4",
    poster: "/media/site-hero-film-poster.jpg",
    posterWebp: "/media/site-hero-film-poster.webp",
  },
  summary:
    "Illustrative appointment status shared between the business, the technician and the customer.",
};

/** C · hero activity feed — one illustrative job (sample company and people). */
export const heroFeed = [
  { icon: "live", title: "Everyone on the map", body: "Technicians, drivers and equipment, live", when: "9:08" },
  { icon: "order", title: "Work order created", body: "No heat · furnace · needs a gas fitter", when: "9:10" },
  { icon: "assign", title: "Auto-assigned to Marcus", body: "Closest qualified tech who's free · 0.9 km", when: "9:10" },
  { icon: "phone", title: "Marcus accepted", body: "Address, gate code and notes on his phone", when: "9:11" },
  { icon: "customer", title: "Dana is tracking Marcus", body: "Live ETA, with text or call in one tap", eta: "3 min", done: true },
] as const satisfies readonly {
  icon: "live" | "order" | "assign" | "phone" | "customer";
  title: string;
  body: string;
  when?: string;
  eta?: string;
  done?: boolean;
}[];

/** B · live ops bento — the five capabilities at a glance. */
export const bento = {
  eyebrow: "One app, every step",
  title: "Everything your team needs.",
  titleMuted: "Live, in one place.",
  body: "The office, the technician and the customer all work from the same job, so everyone sees the same thing at the same time.",
};

/** Getting started (option 1): the setup agent builds a workspace from a website. Sample result. */
export const setupAgent = {
  eyebrow: "Getting started",
  title: "Live in under an hour.",
  titleMuted: "Our setup agent does the heavy lifting.",
  body: "Give it your website. The agent reads it, then builds your workspace: your brand, services, priced catalog, job templates, intake forms and customer texts. Most teams dispatch their first job within the hour.",
  defaultSite: "prairiecomforthvac.com",
  run: "Run setup agent",
  cta: { label: "Start your setup", href: brand.urls.getStarted },
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

/** Getting started (option 2): the first-hour clock and "keep your tools". Times are typical, not guaranteed. */
export const firstHour = {
  title: "Your first hour with ArrivePing.",
  titleMuted: "An AI agent does most of it.",
  body: "No consultants, no weeks of setup. Our setup agent builds your workspace from your website, asks a few questions about how you work, and has you dispatching jobs before the hour is up.",
  milestones: [
    { at: "0 min", title: "Paste your website", body: "That's the only form you fill in." },
    { at: "2 min", title: "Workspace built for you", body: "Brand, services, priced catalog, job templates, intake forms and customer texts." },
    { at: "15 min", title: "Short setup chat", body: "The agent asks 5–10 questions about your crews, jobs and pricing, then tunes everything." },
    { at: "25 min", title: "Team invited", body: "Technicians and dispatchers get a text and email to join." },
    { at: "40 min", title: "Bring your data", body: "Import customers and technicians straight from a spreadsheet." },
    { at: "Under 60", title: "First job dispatched", body: "Your customer gets a text and a live ETA." },
  ],
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
  note: "Illustrative example · sample company, people and times",
  steps: [
    { title: "See everyone, live", body: "Technicians, drivers and equipment on one map, updated in real time.", at: 0 },
    { title: "Create the work order", body: "Your own fields: job type, priority, time window, required skills and access notes.", at: 17.5 },
    { title: "Auto-assign the best technician", body: "ArrivePing picks the closest technician with the right skills who's free to take it.", at: 35 },
    { title: "Send it to their phone", body: "The job lands in the technician app with the address, notes and gate code. One tap to accept.", at: 55 },
    { title: "Keep the customer in the loop", body: "A text, then a live tracking page with the ETA and one-tap text or call. No phone tag.", at: 68 },
  ],
} as const;

export const benefits = [
  {
    title: "Customers know what's happening",
    body: "A text or email link opens a live arrival page — no app, no account. The arrival window and technician status stay current.",
    icon: "customer",
    stat: "1 in 3 customers comment on live tracking & ETA",
  },
  {
    title: "Dispatchers see every arrival",
    body: "One board shows who is assigned, who is travelling and who has arrived, so the day can be adjusted before it slips.",
    icon: "board",
    stat: "20% average reduction in field labour costs",
  },
  {
    title: "Technicians stay coordinated",
    body: "The mobile app shares status as the technician heads out and arrives, without extra phone calls back to the office.",
    icon: "technician",
    stat: "48% of rework is caused by miscommunication",
  },
] as const;

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
    "ArrivePing comes out of NVC360, a specialty subcontracting operation that ran more than 800 field technicians. We lived the friction firsthand — dispatchers tied to the phone, customers demanding updates, routes that didn't add up, margin lost in every communication gap. We looked for a platform that fixed it. It didn't exist, so we built one — and we're making it available to every field service team facing the same problem.",
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
 *   driver 1        → Starter, $49
 *   drivers 2–10    → $30 each
 *   drivers 11–30   → $27 each
 *   drivers 31+     → $25 each (Fleet: custom integrations + live onboarding)
 */
export const pricingBands = [
  { from: 2, to: 10, rate: 30 },
  { from: 11, to: 30, rate: 27 },
  { from: 31, to: Infinity, rate: 25 },
] as const;
export const STARTER_PRICE = 49;

export const pricing = {
  title: "Start for $49.",
  titleMuted: "Each driver costs less as you grow.",
  body: "Every plan includes the dispatch board, the technician app and live customer arrival pages. Each rate applies only to the drivers in its band, so your bill never jumps when you grow into the next tier.",
  note: "All prices in US dollars, billed monthly.",
  ladder: [
    { label: "Driver 1", price: "Included in Starter" },
    { label: "Drivers 2–10", price: "$30 each" },
    { label: "Drivers 11–30", price: "$27 each" },
    { label: "Drivers 31+", price: "$25 each" },
  ],
  tiers: [
    {
      name: "Starter",
      range: "1 driver · ready the same day",
      price: "$49",
      unit: "per month",
      features: ["Workflow set up for how your team works", "Catalog pre-loaded with your services and parts", "Operating the same day"],
      cta: { label: "Get started", href: brand.urls.getStarted },
    },
    {
      name: "Growing team",
      range: "2–30 drivers",
      price: "$30",
      unit: "per added driver / month, dropping to $27 from driver 11",
      features: ["Everything in Starter", "Drivers 2–10 at $30, drivers 11–30 at $27", "Add or remove drivers month to month"],
      cta: { label: "Book a demo", href: brand.urls.demo },
      featured: true,
    },
    {
      name: "Fleet",
      range: "31+ drivers",
      price: "$25",
      unit: "per driver / month from driver 31",
      features: ["Everything in Growing team", "Custom integrations with your systems", "Live onboarding with our team"],
      cta: { label: "Talk to sales", href: brand.urls.demo },
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
  const plan = drivers === 1 ? "Starter" : drivers <= 30 ? "Growing team" : "Fleet";
  return { plan, total, breakdown: drivers === 1 ? "Starter, 1 driver" : parts.join(" + ") };
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
    a: "ArrivePing includes scheduling, dispatch, work orders and invoicing, but you can start with arrivals and customer updates alone. We will walk through your current tools at the demo.",
  },
  {
    q: "How is it priced?",
    a: "In US dollars, billed monthly, and graduated like tax brackets: Starter is $49 a month for your first driver, with your workflow set up and catalog pre-loaded so you can operate the same day. Drivers 2–10 are $30 each, drivers 11–30 are $27 each, and every driver from 31 on is $25. Each rate applies only to the drivers in its band, so adding a driver never lowers or jumps your bill. Teams of 31 or more also get custom integrations and live onboarding.",
  },
] as const;

export const closing = {
  title: "Give your team clarity — and your customers a better arrival experience.",
  body: "Tell us a little about your team and we will set up a 30-minute walkthrough.",
  form: {
    title: "Book a demo",
    fields: {
      name: "Your name",
      email: "Work email",
      company: "Company",
      industry: "Industry",
      industryOther: "Your industry",
      teamSize: "Field team size (optional)",
    },
    teamSizes: ["1–4", "5–14", "15–49", "50+"],
    // Our 18 ICPs — same names as the signup dropdown (services/industry-presets.ts, core + outlier tiers).
    industries: [
      "Childcare & Babysitting",
      "Commercial Building Maintenance Contractor",
      "Concrete & Foundation Repair",
      "Design-Build Renovations & Additions",
      "Electrical",
      "Equipment & Tool Rental",
      "Fire & Flood Restoration",
      "Flooring",
      "Garage Doors",
      "Home Building & Development",
      "Home Renovation & General Contracting",
      "HVAC & Plumbing",
      "Landscaping & Snow Removal",
      "Painting & Decorating",
      "Property Manager — Maintenance Operations",
      "Roofing, Siding & Exteriors",
      "Sports Clubs & Academies",
      "Tree Care & Arborist Services",
    ],
    otherIndustry: "Other",
    submit: "Request a demo",
  },
};

export const footer = {
  description:
    "ArrivePing by NVC360 — appointment scheduling, technician arrival tracking and customer updates for field service teams.",
  columns: [
    {
      heading: "Product",
      links: [
        { label: "Product", href: brand.urls.product },
        { label: "How it works", href: brand.urls.how },
        { label: "Pricing", href: brand.urls.pricing },
        { label: "FAQs", href: brand.urls.faqs },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "Book a demo", href: brand.urls.demo },
        { label: "Sign in", href: brand.urls.signIn },
        { label: brand.contactEmail, href: `mailto:${brand.contactEmail}` },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Privacy Policy", href: brand.urls.privacy },
        { label: "Terms & Conditions", href: brand.urls.terms },
      ],
    },
  ],
  legal: `© ${new Date().getFullYear()} NVC360. All rights reserved.`,
};
