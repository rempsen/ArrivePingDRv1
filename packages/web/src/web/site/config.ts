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

/* ------------------------------------------------------------------ */
/* Copy                                                                 */
/* ------------------------------------------------------------------ */

export const hero = {
  eyebrow: brand.launch,
  title: ["A clearer arrival.", "A better customer experience."],
  body:
    "ArrivePing keeps the office, the technician and the customer looking at the same arrival status — so nobody has to call to ask where the technician is.",
  primary: { label: "Book a demo", href: brand.urls.demo },
  secondary: { label: "See how it works", href: brand.urls.product },
  summary:
    "Illustrative appointment status shared between the business, the technician and the customer.",
};

export const benefits = [
  {
    title: "Customers know what's happening",
    body: "A text or email link opens a live arrival page — no app, no account. The arrival window and technician status stay current.",
    icon: "customer",
  },
  {
    title: "Dispatchers see every arrival",
    body: "One board shows who is assigned, who is travelling and who has arrived, so the day can be adjusted before it slips.",
    icon: "board",
  },
  {
    title: "Technicians stay coordinated",
    body: "The mobile app shares status as the technician heads out and arrives, without extra phone calls back to the office.",
    icon: "technician",
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

export const workflow = [
  {
    step: "01",
    title: "Set up the appointment",
    body: "Add the customer, the job and the time — from your office dispatch, by hand, or straight from an intake form.",
  },
  {
    step: "02",
    title: "Keep the arrival status current",
    body: "The technician taps 'On my way' in the app. ArrivePing calculates the arrival window and tracks the trip.",
  },
  {
    step: "03",
    title: "Give the customer a clear update",
    body: "The customer gets a link to a live arrival page. Delays and arrival are communicated in plain language.",
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
  { label: "HVAC & mechanical", image: "/img/site/industry-hvac.jpg" },
  { label: "Plumbing & electrical", image: "/img/site/industry-plumbing.jpg" },
  { label: "Installers & construction", image: "/img/site/industry-construction.jpg" },
  { label: "Property maintenance", image: "/img/site/industry-property-management.jpg" },
  { label: "Delivery & logistics", image: "/img/site/industry-delivery-logistics.jpg" },
] as const;

export const pricing = {
  title: "Simple per-vehicle pricing",
  body: "One licence per vehicle, billed monthly. Larger fleets pay a lower rate per vehicle.",
  note: "Prices in CAD/USD confirmed at demo. Every tier includes the dispatch board, the technician app and customer arrival pages.",
  tiers: [
    { name: "Starter", range: "1–14 vehicles", price: "$30", unit: "per vehicle / month" },
    { name: "Growth", range: "15–49 vehicles", price: "$27.50", unit: "per vehicle / month", featured: true },
    { name: "Fleet", range: "50+ vehicles", price: "$25", unit: "per vehicle / month" },
  ],
} as const;

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
    a: "Per vehicle, per month: $30 for 1–14 vehicles, $27.50 for 15–49 and $25 for 50 or more.",
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
      teamSize: "Field team size (optional)",
    },
    teamSizes: ["1–4", "5–14", "15–49", "50+"],
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
