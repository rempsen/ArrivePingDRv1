/**
 * More comparison pages (Arrivy, Glympse) and the alternatives pages
 * (/alternatives, /alternatives/jobber, /alternatives/housecall-pro).
 *
 * Same rules as landing.ts:
 *  - ArrivePing claims match what the product does today.
 *  - Every competitor fact (price, plan, feature, add-on) comes from that
 *    company's own public page, is linked in the page's sources, and was
 *    re-checked live on COMPARE_MORE_VERIFIED. If a claim couldn't be checked,
 *    it isn't here.
 *  - Fair: every page says when the other product is the better choice.
 */
import type { Cell, LandingPage } from "./landing";
import type { Pick } from "./geo-sections";
import { monthlyPrice, pricingBands, STARTER_PRICE } from "../config";

export const COMPARE_MORE_VERIFIED = "November 1, 2026";

const compareParent = { label: "Compare", path: "/compare" };
const altParent = { label: "Alternatives", path: "/alternatives" };

/* ------------------------------------------------------------------ */
/* Sources (each checked November 1, 2026)                              */
/* ------------------------------------------------------------------ */

const SRC = {
  arrivyPricing: { label: "Arrivy pricing", href: "https://www.arrivy.com/pricing/" },
  arrivyCx: { label: "Arrivy customer experience", href: "https://www.arrivy.com/features/customer-experience/" },
  glympseApp: { label: "Glympse app", href: "https://app.glympse.com/blog/topic/glympse-app/" },
  glympseField: { label: "Glympse for field services", href: "https://corp.glympse.com/?p=17957" },
  glympseEta: { label: "Glympse real-time ETA notifications and live map", href: "https://corp.glympse.com/realtime-eta-notifications-live-map/" },
  glympseProHow: { label: "How does Glympse PRO work? (help centre)", href: "https://support.glympse.com/faq/how-does-glympse-pro-work/" },
  glympseProCost: { label: "What is the cost to use Glympse PRO? (help centre)", href: "https://support.glympse.com/faq/what-is-the-cost-to-use-glympse-pro/" },
  jobberPricing: { label: "Jobber pricing", href: "https://www.getjobber.com/pricing/" },
  jobberGps: { label: "Jobber GPS tracking", href: "https://www.getjobber.com/features/gps-tracking-app/" },
  jobberForce: {
    label: "Jobber product update: Force Fleet Tracking live tracking links in On My Way texts (Aug 21, 2025)",
    href: "https://productupdates.getjobber.com/102703-force-fleet-tracking-integration-enhances-on-my-way-texts-with-live-tracking-links",
  },
  jobberForceHelp: { label: "Jobber help centre: Jobber and Force Fleet Tracking", href: "https://help.getjobber.com/en/articles/jobber-and-force-fleet-tracking/" },
  hcpPricing: { label: "Housecall Pro pricing", href: "https://www.housecallpro.com/pricing/" },
  hcpGps: { label: "Housecall Pro vehicle GPS tracking", href: "https://www.housecallpro.com/features/vehicle-gps-tracking/" },
  kickservPricing: { label: "Kickserv pricing", href: "https://www.kickserv.com/pricing" },
  workizPricing: { label: "Workiz pricing plans", href: "https://www.workiz.com/pricing-plans/" },
  workizOmw: { label: "Workiz On My Way", href: "https://www.workiz.com/features/on-my-way/" },
  stPricing: { label: "ServiceTitan pricing", href: "https://www.servicetitan.com/pricing" },
  stFleet: { label: "ServiceTitan Fleet Pro", href: "https://www.servicetitan.com/features/pro/fleet" },
} as const;

const src = (s: { label: string; href: string }, text: string): Cell => ({ text, href: s.href });

/* ------------------------------------------------------------------ */
/* Shared ArrivePing facts                                               */
/* ------------------------------------------------------------------ */

/** Prices in copy come from the pricing config, never typed by hand. */
const P = STARTER_PRICE;
const [GROW, FLEET] = pricingBands;
const AP_PRICE: Cell = { text: `$${P}/mo incl. 1 dispatcher + 2 drivers; then $${GROW.rate} per driver, $${FLEET.rate} from driver ${FLEET.from} (graduated)`, href: "/pricing" };
const AP_PRICE_SHORT: Cell = { text: `$${P}/mo incl. 1 dispatcher + 2 drivers`, href: "/pricing" };
const AP_TRIAL = "30 days, as many users as you want; card on file, nothing charged until day 30";
const AP_TRACKING = "In every plan: an on-my-way text with a live tracking page, ETA and text or call buttons";
const AP_LOCATION = "The technician app on the phone; no devices to buy or install";
const FIVE = monthlyPrice(5).total;
const TEN = monthlyPrice(10).total;

const PRICE_FAQ = {
  q: "How much does ArrivePing cost?",
  a: `US$${P} a month includes one dispatcher and two drivers. Drivers ${GROW.from} to ${GROW.to} are $${GROW.rate} each and every driver from ${FLEET.from} on is $${FLEET.rate}, so a dispatcher and five drivers is $${FIVE} a month and ten drivers is $${TEN.toLocaleString("en-US")}. The 30-day free trial includes as many users as you want; your card is kept on file and nothing is charged until day 30. Cancel any time.`,
};

const HARDWARE_FAQ = {
  q: "Does ArrivePing need GPS hardware in the vans?",
  a: "No. Location comes from the ArrivePing app on the phone each technician already carries: the iPhone and iPad app from the App Store, or the browser for Android technicians. There are no plug-in trackers to buy, install or pay for per vehicle.",
};

const SHOT_TRACK = {
  src: "/img/site/app/cust-track.webp",
  w: 680,
  h: 1478,
  phone: true,
  alt: "The customer's live tracking page in a phone browser: 3 min estimated arrival, 0.9 km away, destination 214 Waverley St, and a job timeline showing the request received, the technician assigned and the technician on the way.",
  caption: "The customer's live page: ETA, distance, address and job timeline. Real ArrivePing screen, sample job.",
};
const SHOT_CONTACT = {
  src: "/img/site/app/cust-contact.webp",
  w: 680,
  h: 1478,
  phone: true,
  alt: "The customer's page showing technician Jordan Park with Call and Text buttons, and a message thread: Jordan is about 3 minutes out and bringing a new igniter; the customer replies that the side door is open.",
  caption: "One tap to call or text the technician; messages stay with the job. Real ArrivePing screen, sample job.",
};
const SHOT_ENROUTE = {
  src: "/img/site/app/tech-enroute.webp",
  w: 680,
  h: 1478,
  phone: true,
  alt: "The technician app on the way to the job: Navigate, sharing live location with the customer, 3 minutes away, and the I've Arrived button.",
  caption: "The technician app on the way: location is shared with this customer until arrival. Real ArrivePing screen.",
};
const SHOT_BOARD = {
  src: "/img/site/app/office-board.webp",
  w: 1920,
  h: 1200,
  alt: "The ArrivePing scheduler for a sample HVAC company: unassigned jobs with Assign and AI suggest buttons, four technicians with their job counts, and one technician's day with a job en route and four assigned.",
  caption: "The dispatch board: unassigned jobs, each technician's day, and AI suggestions for who should go. Real ArrivePing screen, sample company.",
};
const SHOT_GEOFENCE = {
  src: "/img/site/features/app-track-geofence.webp",
  w: 1130,
  h: 802,
  alt: "ArrivePing Geofencing and distance units settings: a Meters & km or Feet & miles toggle and the auto-arrive radius set to 150 meters.",
  caption: "Settings: the auto-arrive radius that marks the technician as arrived and ends location sharing. Real ArrivePing screen.",
};

/* ------------------------------------------------------------------ */
/* ArrivePing vs Arrivy                                                  */
/* ------------------------------------------------------------------ */

const arrivy: LandingPage = {
  path: "/compare/arrivy",
  label: "ArrivePing vs Arrivy",
  parent: compareParent,
  meta: {
    title: "ArrivePing vs Arrivy: Pricing, Live ETAs and Setup Compared",
    description:
      `ArrivePing vs Arrivy: $${P}/mo for 1 dispatcher + 2 drivers vs $50/user with a 3-user minimum. Live customer ETAs, route planning and trials, with sources.`,
  },
  eyebrow: "Arrivy alternative",
  h1: "ArrivePing vs Arrivy",
  lede:
    "ArrivePing and Arrivy are different, unrelated companies: ArrivePing is made by NVC360 in Winnipeg, Manitoba, and Arrivy is made by Arrivy Inc. Both give customers live arrival updates. They differ on price, minimum team size and how much routing and logistics tooling comes with it.",
  answer: {
    q: "Is ArrivePing a good Arrivy alternative?",
    a: `ArrivePing suits small service teams that want live customer ETAs and automatic dispatch at a published price: $${P} a month covers one dispatcher and two drivers, with a 30-day free trial. Arrivy's Premium plan is $50 per user per month with a three-user minimum, and its SMS notifications are listed on Custom plans priced on request. Arrivy is the stronger choice if you need route planning or delivery and warehouse workflows.`,
  },
  next: [
    { label: "All field service software comparisons", href: "/compare" },
    { label: "ArrivePing pricing", href: "/pricing" },
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "Every ArrivePing feature", href: "/features" },
  ],
  faqTitle: "ArrivePing vs Arrivy: FAQs",
  sections: [
    {
      kind: "table",
      title: "How do ArrivePing and Arrivy compare?",
      columns: ["", "ArrivePing", "Arrivy"],
      rows: [
        { label: "Company", cells: ["NVC360, Winnipeg, Manitoba, Canada", "Arrivy Inc., a separate company"] },
        { label: "Published starting price", cells: [AP_PRICE, src(SRC.arrivyPricing, "Premium: $50/user; \"starts with a minimum of 3 users\"; Enterprise and Custom plans: \"Contact Us\"")] },
        { label: "Smallest monthly bill", cells: [`$${P} (1 dispatcher + 2 drivers)`, src(SRC.arrivyPricing, "$150 on Premium (3 users × $50)")] },
        { label: "Free trial", cells: [AP_TRIAL, src(SRC.arrivyPricing, "14 days, no credit card required")] },
        { label: "Customer live map and ETA", cells: ["Yes, from the moment the technician marks the job on the way until arrival", src(SRC.arrivyCx, "Yes: customers \"see your crew's approach on a live map\", with live ETAs")] },
        { label: "SMS notifications", cells: ["In every plan", src(SRC.arrivyPricing, "\"SMS & Email Notifications\" is listed on the Custom plan cards (Contact Us), not on the Premium card")] },
        { label: "Route planning", cells: ["No multi-stop route optimization; each job goes to the closest qualified technician", src(SRC.arrivyPricing, "\"Route Planning\" on Premium; a \"Route Planning Pro\" add-on for high-density routes")] },
        { label: "Automatic assignment", cells: ["By distance, skills, availability and workload, in every plan", "Not described on the pages we checked"] },
        { label: "Field app", cells: ["iPhone and iPad app; Android technicians use the browser", src(SRC.arrivyCx, "iOS and Android apps")] },
      ],
    },
    {
      kind: "rich",
      title: "Are ArrivePing and Arrivy the same company?",
      paragraphs: [
        "No. ArrivePing (one word) is field service software made by NVC360, a software company in Winnipeg, Manitoba, Canada. Arrivy is a separate product from Arrivy Inc. The names are similar because both products are about arrivals; the companies, apps, accounts and support teams are unrelated.",
        `If you're comparing them, the practical differences are in the table above: ArrivePing is priced per driver from $${P} a month and assigns jobs automatically; Arrivy is priced per user with a three-user minimum and adds route planning and logistics workflows.`,
      ],
    },
    {
      kind: "shots",
      title: "What does your customer see with ArrivePing?",
      paragraphs: [
        "When the technician taps Start Driving, the customer gets a text with a link to a live page: who's coming, an ETA that updates as they drive, and one-tap text or call. The location appears only after the technician marks the job on the way and disappears when they arrive.",
        "See [on-my-way text software](/on-my-way-text-software) for the messages and their timing, and [all features](/features) for the rest of the job.",
      ],
      shots: [SHOT_TRACK, SHOT_ENROUTE],
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: {
        title: "Choose ArrivePing if",
        items: [
          `You want to start at $${P} a month, not a three-user minimum`,
          "Customers keep calling to ask when the technician will arrive",
          "You want each job assigned to the closest qualified technician automatically",
          "You want a self-serve 30-day trial with as many users as you like",
        ],
      },
      theirs: {
        title: "Choose Arrivy if",
        items: [
          "You plan multi-stop routes and want route planning built in",
          "You need warehouse or carrier workflows alongside field crews",
          "Your crew needs a native Android app today",
          "You prefer a 14-day trial with no card on file",
        ],
      },
    },
  ],
  faqs: [
    {
      q: "Are ArrivePing and Arrivy the same company?",
      a: "No. ArrivePing is made by NVC360 in Winnipeg, Manitoba, Canada. Arrivy is a separate product from Arrivy Inc. The two companies are not affiliated.",
    },
    {
      q: "How much does Arrivy cost?",
      a: `Arrivy's pricing page listed the Premium plan at $50 per user, starting with a minimum of 3 users, and Enterprise and Custom plans at "Contact Us", with a 14-day free trial and no credit card required (checked November 1, 2026). ArrivePing starts at $${P} a month for one dispatcher and two drivers.`,
    },
    {
      q: "Does Arrivy send live ETA texts?",
      a: "Arrivy's customer experience page describes live ETAs, a live map of the crew's approach, and confirmations, reminders and status updates by email and SMS. On its pricing page, \"SMS & Email Notifications\" appears on the Custom plan cards rather than the Premium card. In ArrivePing, the on-my-way text with a live tracking link is in every plan.",
    },
    {
      q: "Does ArrivePing do route planning like Arrivy?",
      a: "No. ArrivePing assigns each job to the closest qualified technician by distance, skills, availability and workload, and shows the drive to that stop. It doesn't sequence a day of multi-stop deliveries; Arrivy's Premium plan lists route planning.",
    },
    PRICE_FAQ,
  ],
  related: ["/compare/glympse", "/alternatives", "/on-my-way-text-software", "/pricing", "/features"],
  sources: [SRC.arrivyPricing, SRC.arrivyCx],
  verified: COMPARE_MORE_VERIFIED,
};

/* ------------------------------------------------------------------ */
/* ArrivePing vs Glympse                                                 */
/* ------------------------------------------------------------------ */

const glympse: LandingPage = {
  path: "/compare/glympse",
  label: "ArrivePing vs Glympse",
  parent: compareParent,
  meta: {
    title: "Glympse Alternative for Service Businesses | ArrivePing",
    description:
      `ArrivePing vs Glympse: an ETA link that comes from the job, starts at on the way and ends on arrival, with dispatch included from $${P}/mo. Sources linked.`,
  },
  eyebrow: "Glympse alternative",
  h1: "ArrivePing vs Glympse: an ETA link tied to the job",
  lede:
    "Glympse is a location-sharing platform, from a free personal app to business and enterprise visibility products. ArrivePing is dispatch software for service teams, where the customer's live ETA link comes from the job itself.",
  answer: {
    q: "What's the difference between ArrivePing and Glympse?",
    a: `Glympse shares a moving location: its free app sends a link that expires on a timer, and Glympse PRO and its enterprise products send customers branded live-map links, priced by volume or users on request. ArrivePing is field service dispatch software: the link is part of the job, opens when the technician taps on the way, stops at arrival, and comes with scheduling and auto-assignment from $${P} a month.`,
  },
  next: [
    { label: "All field service software comparisons", href: "/compare" },
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "ArrivePing pricing", href: "/pricing" },
    { label: "Every ArrivePing feature", href: "/features" },
  ],
  faqTitle: "ArrivePing vs Glympse: FAQs",
  sections: [
    {
      kind: "table",
      title: "How do ArrivePing and Glympse compare?",
      columns: ["", "ArrivePing", "Glympse"],
      rows: [
        { label: "What it is", cells: ["Field service dispatch software with customer tracking built in", src(SRC.glympseApp, "Real-time location sharing: a free app used \"since 2008\", plus Glympse PRO and enterprise products for business")] },
        { label: "Pricing", cells: [AP_PRICE, src(SRC.glympseProCost, "Glympse PRO: \"based on volume and/or number of users\", no set-up fees or long-term commitments; contact for a quote")] },
        { label: "Customer link", cells: ["On-my-way text with a live tracking page, ETA, and buttons to text or call the technician", src(SRC.glympseProHow, "Glympse PRO \"sends that customer a live tracking link via text or email\" when a worker is on the way")] },
        { label: "When sharing starts and stops", cells: ["Starts when the technician marks the job on the way; stops when they arrive", src(SRC.glympseApp, "Free app: \"a timer that auto-expires\"; the business pages we checked don't say when sharing ends")] },
        { label: "Jobs and dispatch", cells: ["Work orders, a dispatch board and automatic assignment by distance, skills, availability and workload", src(SRC.glympseField, "Field services features listed: Real-Time Live Map & ETA, Automated Communications, Operational Dashboards, Live Chat/Click-to-Call")] },
        { label: "Integrations", cells: ["Two-way integrations, webhooks, Zapier and Make, and an MCP server for AI agents", src(SRC.glympseField, "\"Integrates seamlessly with backend platforms, ERPs, TMSs, YMSs, WMSs, IVR, chatbots, and more\"")] },
        { label: "Getting started", cells: ["Self-serve signup and a 30-day free trial; typically live in under an hour", src(SRC.glympseEta, "Demo on request (\"contact us for a demo\")")] },
      ],
    },
    {
      kind: "rich",
      title: "Why tie the ETA link to the job?",
      paragraphs: [
        "A location link answers one question: where is this person now? A customer waiting for a service call has a few more: who is coming, for which appointment, when will they get here, and how do I reach them? When the link is created from the work order, one page answers all of those, and it starts and stops at the right moments without anyone remembering to share or unshare.",
        "In ArrivePing the customer sees the technician's location only after the technician marks the job on the way, and never after arrival. Technicians share location only while they're on the clock. The same tap that sends the customer's text also updates the [dispatch board](/dispatch-software), so the office sees who is en route without calling.",
      ],
    },
    {
      kind: "shots",
      title: "What does the ArrivePing tracking page show?",
      paragraphs: [
        "The ETA, the distance, the job's timeline and the technician, with one-tap call or text. It opens from a text or email in any phone browser; there's nothing for the customer to install. Read how the [on-my-way text](/on-my-way-text-software) is worded and timed.",
      ],
      shots: [SHOT_TRACK, SHOT_CONTACT],
    },
    {
      kind: "choose",
      title: "Which one should you choose?",
      ours: {
        title: "Choose ArrivePing if",
        items: [
          "You run service calls, installs or deliveries booked as appointments",
          "You want the tracking link sent automatically from the job, not shared by hand",
          "You want scheduling, dispatch and customer updates in one tool at a published price",
          "You want sharing to start at on the way and end at arrival, every time",
        ],
      },
      theirs: {
        title: "Choose Glympse if",
        items: [
          "You need location sharing for people or assets outside a job workflow",
          "You want live-map links inside systems you already run, such as an ERP or contact centre",
          "You're an enterprise that wants a visibility platform priced to its volume",
          "You only need a free personal app to share your own location",
        ],
      },
    },
  ],
  faqs: [
    {
      q: "Is Glympse free?",
      a: "Glympse says its app for sharing your own location is free to download. Its business product, Glympse PRO, is priced by volume and/or number of users, with no set-up fees or long-term commitments, on request (checked November 1, 2026).",
    },
    {
      q: "Can Glympse send customers a technician's ETA?",
      a: "Yes. Glympse PRO's help centre says it sends the customer a live tracking link by text or email when a technician, driver or mobile worker is on the way. ArrivePing does this from the work order, with the ETA, the technician's name and text or call buttons on one page.",
    },
    {
      q: "When does ArrivePing stop sharing the technician's location?",
      a: "At arrival. The customer sees the technician's location only after the technician marks the job on the way, and the live location disappears when they arrive. A geofence around the address marks arrival automatically, with a manual tap as backup.",
    },
    {
      q: "Do customers need an app to follow the technician?",
      a: "No, with either product. ArrivePing's tracking page opens in any phone browser from a text or email link, and Glympse says its links can be viewed with no app.",
    },
    PRICE_FAQ,
  ],
  related: ["/compare/arrivy", "/on-my-way-text-software", "/customer-notifications", "/pricing", "/features"],
  sources: [SRC.glympseApp, SRC.glympseField, SRC.glympseEta, SRC.glympseProHow, SRC.glympseProCost],
  verified: COMPARE_MORE_VERIFIED,
};

/* ------------------------------------------------------------------ */
/* Alternatives: the products, described once                           */
/* ------------------------------------------------------------------ */

const PICK = {
  arriveping: (stand: string): Pick => ({
    name: "ArrivePing by NVC360",
    ours: true,
    facts: [
      { label: "Starting price", value: AP_PRICE },
      { label: "Free trial", value: AP_TRIAL },
      { label: "Stands out for", value: stand },
    ],
    chooseIf: ["Arrival times are the problem you're fixing", "You want the closest qualified tech assigned automatically", "You'd rather not buy trackers for every van"],
    more: { label: "See pricing", href: "/pricing" },
  }),
  jobber: {
    name: "Jobber",
    facts: [
      { label: "Starting price", value: src(SRC.jobberPricing, "Core $49/mo for 1 user without commitment; extra users $29/mo each") },
      { label: "Free trial", value: src(SRC.jobberPricing, "14 days on the Grow plan, no credit card") },
      { label: "Team location", value: src(SRC.jobberGps, "GPS waypoints when team members clock in and out; a live map with FleetSharp devices installed in vehicles") },
      {
        label: "Customer tracking link",
        value: src(SRC.jobberForce, "On My Way texts can include a live vehicle link through the Force Fleet Tracking integration: US accounts on Connect or higher, with a GPS tracker in the vehicle and a Force subscription"),
      },
    ],
    chooseIf: ["Quotes, invoices and online payments are the main need", "You want a long track record and a large user community", "You already run FleetSharp or Force Fleet Tracking devices in your vehicles"],
    more: { label: "ArrivePing vs Jobber", href: "/compare/jobber" },
  } satisfies Pick,
  housecallPro: {
    name: "Housecall Pro",
    facts: [
      { label: "Starting price", value: src(SRC.hcpPricing, "Basic $59/mo billed annually or $79/mo monthly, 1 user") },
      { label: "Free trial", value: src(SRC.hcpPricing, "14 days, no credit card") },
      { label: "Team location", value: src(SRC.hcpGps, "Employee GPS from the tech's phone (Essentials); Vehicle GPS Tracking add-on at $20 per vehicle per month with an OBD-II device") },
    ],
    chooseIf: ["You want marketing, online booking and payments from one vendor", "You already use, or want, vehicle GPS hardware", "You value a large, established user base"],
    more: { label: "ArrivePing vs Housecall Pro", href: "/compare/housecall-pro" },
  } satisfies Pick,
  kickserv: {
    name: "Kickserv",
    facts: [
      { label: "Starting price", value: src(SRC.kickservPricing, "Start $60/mo for 5 users; Run $119/mo for 10; Scale $199/mo for 20") },
      { label: "Free trial", value: src(SRC.kickservPricing, "30 days") },
      { label: "Team location", value: src(SRC.kickservPricing, "GPS check-ins on Run and Scale; the pricing page doesn't mention live customer tracking") },
    ],
    chooseIf: ["You want a low published price for a team of five or more", "Text reminders are enough and a live map link isn't needed", "You want a 30-day trial"],
  } satisfies Pick,
  workiz: {
    name: "Workiz",
    facts: [
      { label: "Starting price", value: src(SRC.workizPricing, "Quote only: Standard, Pro and Ultimate show \"Request pricing\"") },
      { label: "Free trial", value: src(SRC.workizPricing, "7 days, no credit card") },
      { label: "Customer updates", value: src(SRC.workizOmw, "On My Way sends \"a branded text message with an estimated arrival time and live tracking link\"") },
    ],
    chooseIf: ["You want phone, marketing, invoicing and scheduling in one platform", "You're happy to request a quote", "You want the technician's photo and bio in the arrival text"],
    more: { label: "ArrivePing vs Workiz", href: "/compare/workiz" },
  } satisfies Pick,
  serviceTitan: {
    name: "ServiceTitan",
    facts: [
      { label: "Starting price", value: src(SRC.stPricing, "Quote only: plans show \"Request Pricing\"; priced per technician") },
      { label: "Fleet tracking", value: src(SRC.stFleet, "Fleet Pro, a Pro product: real-time vehicle GPS, geofencing and driver scorecards; priced by demo") },
      { label: "Best for", value: "Large residential and commercial contractors" },
    ],
    chooseIf: ["You run a large contractor with accounting, marketing and pricebook needs", "You want vehicle cameras and driver scoring", "You have the budget and time for an enterprise rollout"],
    more: { label: "ArrivePing vs ServiceTitan", href: "/compare/servicetitan" },
  } satisfies Pick,
  arrivy: {
    name: "Arrivy",
    facts: [
      { label: "Starting price", value: src(SRC.arrivyPricing, "Premium $50/user, minimum 3 users; SMS notifications listed on Custom plans (Contact Us)") },
      { label: "Free trial", value: src(SRC.arrivyPricing, "14 days, no credit card") },
      { label: "Customer updates", value: src(SRC.arrivyCx, "Live ETAs and a live map of the crew's approach") },
    ],
    chooseIf: ["You plan multi-stop routes and want route planning built in", "You run delivery or warehouse workflows as well as field crews", "Your crew needs a native Android app today"],
    more: { label: "ArrivePing vs Arrivy", href: "/compare/arrivy" },
  } satisfies Pick,
};

/** One row per product for the "rows are products" tables. */
const ROW = {
  arriveping: (third: Cell) => ({ label: "ArrivePing", ours: true, cells: [AP_PRICE_SHORT, AP_TRIAL, third] }),
  jobber: (third: Cell) => ({ label: "Jobber", cells: [src(SRC.jobberPricing, "Core $49/mo, 1 user (no commitment)"), src(SRC.jobberPricing, "14 days on Grow, no card"), third] }),
  housecallPro: (third: Cell) => ({ label: "Housecall Pro", cells: [src(SRC.hcpPricing, "Basic $59/mo annual or $79/mo monthly, 1 user"), src(SRC.hcpPricing, "14 days, no card"), third] }),
  kickserv: (third: Cell) => ({ label: "Kickserv", cells: [src(SRC.kickservPricing, "Start $60/mo, 5 users"), src(SRC.kickservPricing, "30 days"), third] }),
  workiz: (third: Cell) => ({ label: "Workiz", cells: [src(SRC.workizPricing, "Quote only"), src(SRC.workizPricing, "7 days, no card"), third] }),
  serviceTitan: (third: Cell) => ({ label: "ServiceTitan", cells: [src(SRC.stPricing, "Quote only; per technician"), "Not stated on the pricing page", third] }),
  arrivy: (third: Cell) => ({ label: "Arrivy", cells: [src(SRC.arrivyPricing, "Premium $50/user, 3-user minimum"), src(SRC.arrivyPricing, "14 days, no card"), third] }),
};

const TRACK = {
  arriveping: AP_TRACKING,
  jobber: src(SRC.jobberForce, "On My Way texts can include a live vehicle link with the Force Fleet Tracking integration (US, Connect plan or higher, GPS tracker in the vehicle)"),
  housecallPro: src(SRC.hcpGps, "On-my-way text with a live map link, as part of the $20/vehicle/month Vehicle GPS Tracking add-on"),
  kickserv: src(SRC.kickservPricing, "Automated email and text reminders; no live tracking link mentioned"),
  workiz: src(SRC.workizOmw, "On My Way text with an ETA and a live tracking link"),
  serviceTitan: { text: "Not verified for this page; see our side-by-side", href: "/compare/servicetitan" } as Cell,
  arrivy: src(SRC.arrivyCx, "Live ETAs and a live map; SMS listed on Custom plans"),
  glympse: src(SRC.glympseProHow, "Glympse PRO: live tracking link by text or email when the worker is on the way"),
};

/* ------------------------------------------------------------------ */
/* /alternatives/jobber                                                  */
/* ------------------------------------------------------------------ */

const jobberAlternatives: LandingPage = {
  path: "/alternatives/jobber",
  label: "Jobber alternatives",
  parent: altParent,
  meta: {
    title: "Jobber Alternatives in 2026: Prices and Live Tracking",
    description:
      "Jobber alternatives compared with sources: ArrivePing, Housecall Pro, Kickserv, Workiz, ServiceTitan and Arrivy on price, free trial and live customer tracking.",
  },
  eyebrow: "Jobber alternatives",
  h1: "Jobber alternatives, compared on price and live tracking",
  lede:
    "Jobber is a strong all-in-one tool for quotes, invoices and payments. Teams usually look elsewhere for one of three reasons: the price as the team grows, live customer tracking without vehicle hardware, or automatic dispatch. Here are six options, ArrivePing first, with every price linked to its source.",
  answer: {
    q: "What is a good alternative to Jobber?",
    a: `If your priority is getting technicians to customers on time, ArrivePing by NVC360 auto-assigns the closest qualified technician and texts customers a live tracking link from the tech's phone, from $${P} a month for one dispatcher and two drivers. For a broad all-in-one, look at Housecall Pro or Workiz; for low published team pricing, Kickserv; for large contractors, ServiceTitan; for route planning, Arrivy.`,
  },
  next: [
    { label: "ArrivePing vs Jobber, side by side", href: "/compare/jobber" },
    { label: "All alternatives and comparisons", href: "/alternatives" },
    { label: "ArrivePing pricing", href: "/pricing" },
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "Every ArrivePing feature", href: "/features" },
  ],
  faqTitle: "Jobber alternatives: FAQs",
  sections: [
    {
      kind: "matrix",
      title: "How do Jobber alternatives compare on price?",
      body: "Published starting prices, trials and what the customer gets when the technician is on the way. Jobber is included for reference.",
      columns: ["Tool", "Published starting price", "Free trial", "Customer arrival updates"],
      rows: [
        ROW.arriveping(TRACK.arriveping),
        ROW.jobber(TRACK.jobber),
        ROW.housecallPro(TRACK.housecallPro),
        ROW.kickserv(TRACK.kickserv),
        ROW.workiz(TRACK.workiz),
        ROW.serviceTitan(TRACK.serviceTitan),
        ROW.arrivy(TRACK.arrivy),
      ],
      note: "Starting prices are the lowest published plan; plans include different numbers of users and features.",
    },
    {
      kind: "picks",
      title: "Which Jobber alternative fits your team?",
      body: "Six options, ArrivePing first. Each says who it suits; none is the right answer for everyone.",
      items: [
        PICK.arriveping("Automatic dispatch by distance, skills, availability and workload, and a live customer tracking link from the tech's phone, in every plan"),
        PICK.housecallPro,
        PICK.kickserv,
        PICK.workiz,
        PICK.serviceTitan,
        PICK.arrivy,
      ],
    },
    {
      kind: "rich",
      title: "Is there a cheaper alternative to Jobber?",
      paragraphs: [
        `It depends on headcount. Jobber Core is $49 a month for one user, with extra users at $29 a month each, and Jobber's 5-user Connect plan is $199 a month without commitment or $149 billed annually. ArrivePing is $${P} a month for one dispatcher and two drivers, then $${GROW.rate} for each driver from ${GROW.from} to ${GROW.to}, so a dispatcher and five drivers is $${FIVE} a month. Kickserv's Start plan is $60 a month for five users.`,
        "Compare the price for the team you'll have in a year, and check what's included at that price. In ArrivePing the live tracking link, automatic dispatch and the technician app are in every plan. See [ArrivePing pricing](/pricing) and [every feature](/features).",
      ],
    },
    {
      kind: "shots",
      title: "What does live tracking without hardware look like?",
      paragraphs: [
        "The office sees every job and technician on one board and can let ArrivePing suggest who should go. When the technician taps Start Driving, the customer gets an [on-my-way text](/on-my-way-text-software) with a live page that shows the ETA.",
      ],
      shots: [SHOT_BOARD, SHOT_TRACK],
    },
    {
      kind: "rich",
      title: "When should you stay with Jobber?",
      paragraphs: ["Switching costs time. Jobber remains a good fit if:"],
      bullets: [
        "Quoting, invoicing and online payments are most of what you use it for",
        "Your customers rarely ask where the technician is",
        "You already run FleetSharp or Force Fleet Tracking devices and like the vehicle data",
        "Your team is one person and Core covers what you need",
      ],
    },
  ],
  faqs: [
    {
      q: "What is the cheapest alternative to Jobber?",
      a: `Of the tools on this page with published prices (checked November 1, 2026), Jobber Core starts at $49 a month for one user and ArrivePing at $${P} a month for one dispatcher and two drivers. Kickserv's Start plan is $60 a month for five users. The cheapest option depends on your team size and which features you need included.`,
    },
    {
      q: "Is there a Jobber alternative with live GPS tracking and no hardware?",
      a: "Yes. ArrivePing tracks technicians through the app on their phones and sends customers a live tracking link with the ETA, in every plan. Jobber's live map uses FleetSharp devices installed in vehicles, and its On My Way texts can include a live link through the Force Fleet Tracking integration, which needs a GPS tracker plugged into the vehicle, a Force subscription and a US account on Connect or higher (checked November 1, 2026).",
    },
    {
      q: "How much does Jobber cost?",
      a: "Jobber's pricing page listed Core at $49 a month for one user without commitment, Connect from $139, Grow from $199 and Plus from $499 for five users, with extra users at $29 a month each and a 14-day free trial on Grow (checked November 1, 2026).",
    },
    {
      q: "Can I move my customers from Jobber to ArrivePing?",
      a: "Yes. Export your customers and team as a CSV or Excel file and upload it, or send us the file and we'll import it for you. Customers aren't contacted when they're imported, and technicians get an email to set their password.",
    },
    PRICE_FAQ,
  ],
  related: ["/compare/jobber", "/alternatives/housecall-pro", "/alternatives", "/pricing", "/on-my-way-text-software"],
  sources: [SRC.jobberPricing, SRC.jobberGps, SRC.jobberForce, SRC.jobberForceHelp, SRC.hcpPricing, SRC.hcpGps, SRC.kickservPricing, SRC.workizPricing, SRC.workizOmw, SRC.stPricing, SRC.stFleet, SRC.arrivyPricing, SRC.arrivyCx],
  verified: COMPARE_MORE_VERIFIED,
};

/* ------------------------------------------------------------------ */
/* /alternatives/housecall-pro                                          */
/* ------------------------------------------------------------------ */

const hcpAlternatives: LandingPage = {
  path: "/alternatives/housecall-pro",
  label: "Housecall Pro alternatives",
  parent: altParent,
  meta: {
    title: "Housecall Pro Alternatives Without a $20/Vehicle GPS Add-On",
    description:
      "Housecall Pro alternatives compared: who includes live customer tracking without a $20 per vehicle a month GPS add-on. Prices, trials and sources for six tools.",
  },
  eyebrow: "Housecall Pro alternatives",
  h1: "Housecall Pro alternatives without a per-vehicle GPS add-on",
  lede:
    "Housecall Pro is a popular home-services platform with booking, marketing and payments. Its on-my-way text with a live map link is described as part of Vehicle GPS Tracking, a $20 per vehicle per month add-on that plugs into each van. These alternatives handle team location differently.",
  answer: {
    q: "What's a good Housecall Pro alternative for live tracking?",
    a: `If you want customers to watch the technician arrive without buying a tracker for every van, ArrivePing by NVC360 uses the technician's phone and includes the live tracking link in every plan, from $${P} a month. Housecall Pro charges $20 per vehicle per month for Vehicle GPS Tracking, which powers its live-map text. Jobber, Kickserv, Workiz, ServiceTitan and Arrivy are compared below, with sources.`,
  },
  next: [
    { label: "ArrivePing vs Housecall Pro, side by side", href: "/compare/housecall-pro" },
    { label: "All alternatives and comparisons", href: "/alternatives" },
    { label: "Fleet tracking without hardware", href: "/fleet-tracking" },
    { label: "ArrivePing pricing", href: "/pricing" },
    { label: "Every ArrivePing feature", href: "/features" },
  ],
  faqTitle: "Housecall Pro alternatives: FAQs",
  sections: [
    {
      kind: "rich",
      title: "What does Housecall Pro's GPS add-on cost?",
      paragraphs: [
        "Housecall Pro's vehicle GPS page describes Vehicle GPS Tracking as \"a paid add-on at $20 per vehicle per month, with no contract required\", using a small device that plugs into the vehicle's OBD-II port. When a tech starts driving, the customer gets an \"On my way\" text with a link to a live map of the vehicle's location.",
        "On top of the plan, that's $100 a month for 5 vans, $200 for 10 and $400 for 20. To be fair to Housecall Pro, its Essentials plan also lists employee GPS tracking that \"locates techs on the map using their mobile phone's GPS, no hardware required\", for the office's map. The add-on is about the vehicle and the customer's live-map link.",
      ],
    },
    {
      kind: "matrix",
      title: "How do Housecall Pro alternatives track the team?",
      body: "Starting price, how the team's location is found, and what the customer gets. Housecall Pro is included for reference.",
      columns: ["Tool", "Published starting price", "Free trial", "How team location works"],
      rows: [
        ROW.arriveping(AP_LOCATION),
        ROW.housecallPro(src(SRC.hcpGps, "Employee GPS from the tech's phone (Essentials); vehicle GPS add-on at $20/vehicle/month with an OBD-II device")),
        ROW.jobber(src(SRC.jobberGps, "GPS waypoints at clock in and out; a live map and live On My Way links need a tracker in each vehicle (FleetSharp, or Force Fleet Tracking in the US)")),
        ROW.kickserv(src(SRC.kickservPricing, "GPS check-ins on Run ($119/mo, 10 users) and Scale")),
        ROW.workiz(src(SRC.workizPricing, "\"Fleet tracking\" and \"Team location tracking\" in every plan; method not stated")),
        ROW.serviceTitan(src(SRC.stFleet, "Fleet Pro, a Pro product: real-time vehicle GPS and geofencing")),
        ROW.arrivy(src(SRC.arrivyPricing, "\"Real-time GPS tracking\" of team locations; method not stated")),
      ],
      note: "\"Method not stated\" means the vendor's page didn't say whether location comes from a phone or a vehicle device.",
    },
    {
      kind: "picks",
      title: "Which Housecall Pro alternative fits your team?",
      body: "Six options, ArrivePing first, each with the case for choosing it.",
      items: [
        PICK.arriveping("Live customer tracking from the technician's phone in every plan, with no per-vehicle fee, plus automatic dispatch"),
        PICK.jobber,
        PICK.kickserv,
        PICK.workiz,
        PICK.serviceTitan,
        PICK.arrivy,
      ],
    },
    {
      kind: "shots",
      title: "How does phone-based tracking work in ArrivePing?",
      paragraphs: [
        "Each technician runs the ArrivePing app on their phone: the iPhone and iPad app from the App Store, or the browser on Android. Location is shared only while they're on the clock, and the customer sees it only from on the way to arrival. A geofence around the address marks arrival automatically, 150 m by default.",
        "Read more about [fleet tracking without hardware](/fleet-tracking) and the [on-my-way text](/on-my-way-text-software).",
      ],
      shots: [SHOT_ENROUTE, SHOT_GEOFENCE],
    },
    {
      kind: "rich",
      title: "When should you stay with Housecall Pro?",
      paragraphs: ["Housecall Pro remains a good fit if:"],
      bullets: [
        "Marketing tools, online booking and payments matter more than dispatch",
        "You want vehicle data such as location history from a device in each van",
        "The office map from Essentials' phone GPS is enough and customers don't need a live link",
        "Your team already knows it well",
      ],
    },
  ],
  faqs: [
    {
      q: "How much is Housecall Pro's GPS tracking?",
      a: "Housecall Pro's vehicle GPS page describes Vehicle GPS Tracking as a paid add-on at $20 per vehicle per month, with no contract, using a device that plugs into the vehicle's OBD-II port (checked November 1, 2026). ArrivePing's tracking comes from the technician app and is included in every plan.",
    },
    {
      q: "Does Housecall Pro track technicians without hardware?",
      a: "For the office map, yes: Housecall Pro's Essentials plan lists employee GPS tracking from the technician's mobile phone, with no hardware. The customer's live-map link in the on-my-way text is described on the Vehicle GPS Tracking page, which uses a plug-in device at $20 per vehicle per month.",
    },
    {
      q: "How much does Housecall Pro cost?",
      a: "Housecall Pro's pricing page listed Basic at $59 a month billed annually or $79 monthly for one user, Essentials at $149 or $189 for five users, and Max at $299 or $329 for eight users plus $35 per additional user, with a 14-day free trial (checked November 1, 2026).",
    },
    HARDWARE_FAQ,
    PRICE_FAQ,
  ],
  related: ["/compare/housecall-pro", "/alternatives/jobber", "/fleet-tracking", "/pricing", "/on-my-way-text-software"],
  sources: [SRC.hcpPricing, SRC.hcpGps, SRC.jobberPricing, SRC.jobberGps, SRC.jobberForce, SRC.jobberForceHelp, SRC.kickservPricing, SRC.workizPricing, SRC.workizOmw, SRC.stPricing, SRC.stFleet, SRC.arrivyPricing, SRC.arrivyCx],
  verified: COMPARE_MORE_VERIFIED,
};

/* ------------------------------------------------------------------ */
/* /alternatives hub                                                     */
/* ------------------------------------------------------------------ */

const alternativesHub: LandingPage = {
  path: "/alternatives",
  label: "Alternatives",
  meta: {
    title: "Field Service Software Alternatives, Compared | ArrivePing",
    description:
      "Sourced alternatives to Jobber, Housecall Pro, ServiceTitan, Workiz, Arrivy and Glympse: published prices, free trials and live customer tracking compared.",
  },
  eyebrow: "Alternatives",
  h1: "Field service software alternatives, compared with sources",
  lede:
    "Shortlists for teams replacing Jobber or Housecall Pro, and side-by-side pages for ServiceTitan, Workiz, Arrivy, Glympse, Onfleet and Routific. Every competitor fact links to that company's own page and shows the date we checked it.",
  answer: {
    q: "What are the best alternatives to Jobber and Housecall Pro?",
    a: `It depends on what you're fixing. For dispatch and live arrival times, ArrivePing by NVC360 auto-assigns the closest qualified technician and texts customers a live tracking link in every plan, from $${P} a month. Kickserv publishes low team prices, Workiz bundles phones and marketing, ServiceTitan suits large contractors, and Arrivy adds route planning. Prices, trials and sources are below.`,
  },
  next: [
    { label: "All side-by-side comparisons", href: "/compare" },
    { label: "ArrivePing pricing", href: "/pricing" },
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "Every ArrivePing feature", href: "/features" },
  ],
  faqTitle: "Alternatives: FAQs",
  sections: [
    {
      kind: "cards",
      title: "Which shortlist fits your switch?",
      items: [
        { title: "Jobber alternatives", body: "Six options compared on price, trial and live customer tracking, including what a growing team pays.", href: "/alternatives/jobber", cta: "Compare Jobber alternatives" },
        { title: "Housecall Pro alternatives", body: "Options that show customers a live map without a $20 per vehicle per month GPS add-on.", href: "/alternatives/housecall-pro", cta: "Compare Housecall Pro alternatives" },
      ],
    },
    {
      kind: "matrix",
      title: "What do the main options cost?",
      body: "The lowest published plan, the free trial and what the customer gets when the technician is on the way.",
      columns: ["Tool", "Published starting price", "Free trial", "Customer arrival updates"],
      rows: [
        ROW.arriveping(TRACK.arriveping),
        ROW.jobber(TRACK.jobber),
        ROW.housecallPro(TRACK.housecallPro),
        ROW.kickserv(TRACK.kickserv),
        ROW.workiz(TRACK.workiz),
        ROW.serviceTitan(TRACK.serviceTitan),
        ROW.arrivy(TRACK.arrivy),
        { label: "Glympse PRO", cells: [src(SRC.glympseProCost, "Quote only, by volume and/or users"), "Not stated", TRACK.glympse] },
      ],
      note: "Plans include different numbers of users and features; follow each link for the detail.",
    },
    {
      kind: "cards",
      title: "Which head-to-head comparison do you need?",
      items: [
        { title: "ArrivePing vs Jobber", body: "Live tracking without FleetSharp devices, and automatic dispatch.", href: "/compare/jobber", cta: "Read the comparison" },
        { title: "ArrivePing vs Housecall Pro", body: "Customer tracking links without the vehicle GPS add-on.", href: "/compare/housecall-pro", cta: "Read the comparison" },
        { title: "ArrivePing vs ServiceTitan", body: "Published pricing and same-day setup vs an enterprise suite.", href: "/compare/servicetitan", cta: "Read the comparison" },
        { title: "ArrivePing vs Workiz", body: "On-my-way texts, tracking and published prices.", href: "/compare/workiz", cta: "Read the comparison" },
        { title: "ArrivePing vs Arrivy", body: "Two different companies with similar names, compared on price and features.", href: "/compare/arrivy", cta: "Read the comparison" },
        { title: "ArrivePing vs Glympse", body: "An ETA link tied to the job vs a location-sharing link.", href: "/compare/glympse", cta: "Read the comparison" },
        { title: "ArrivePing vs Onfleet", body: "Appointment deliveries for small fleets vs high-volume last mile.", href: "/compare/onfleet", cta: "Read the comparison" },
        { title: "ArrivePing vs Routific", body: "Appointment dispatch vs route planning.", href: "/compare/routific", cta: "Read the comparison" },
      ],
    },
    {
      kind: "rich",
      title: "How should you compare field service software?",
      paragraphs: ["Six questions settle most shortlists:"],
      bullets: [
        "What will it cost for the team you'll have next year, not the one-user plan? See [ArrivePing pricing](/pricing).",
        "Is the customer's live tracking link included, or part of an add-on? See [on-my-way text software](/on-my-way-text-software).",
        "Does team location come from the phone, or from a device in each vehicle?",
        "Can jobs be assigned automatically by location and skill, or only by hand?",
        "How long is the trial, is a card needed, and how many users can try it?",
        "Can you get your data out: exports, webhooks, integrations? See [all features](/features).",
      ],
      ordered: true,
    },
  ],
  faqs: [
    {
      q: "Who makes ArrivePing?",
      a: "ArrivePing is made by NVC360, a software company in Winnipeg, Manitoba, Canada. It is not affiliated with Arrivy, Arrive, Arrive Logistics or arrive.gg.",
    },
    {
      q: "Which field service software includes live customer tracking without hardware?",
      a: "ArrivePing's tracking link comes from the technician app on the phone, in every plan. Housecall Pro's live map link in the on-my-way text is described as part of its Vehicle GPS Tracking add-on ($20 per vehicle per month, with an OBD-II device), and Jobber's live link in On My Way texts comes through the Force Fleet Tracking integration, with a GPS tracker plugged into each vehicle (checked November 1, 2026).",
    },
    {
      q: "Which alternatives publish their prices?",
      a: "Of the tools on this page, ArrivePing, Jobber, Housecall Pro, Kickserv and Arrivy publish starting prices. Workiz, ServiceTitan and Glympse PRO price on request (checked November 1, 2026).",
    },
    {
      q: "How are these comparisons checked?",
      a: "Every competitor fact comes from that company's own public page, linked in the sources, with the date we checked it. Prices and features change, so check the source before you decide, and email contact@nvc360.com if anything here is out of date.",
    },
  ],
  related: ["/alternatives/jobber", "/alternatives/housecall-pro", "/compare", "/pricing", "/on-my-way-text-software"],
  sources: [
    SRC.jobberPricing,
    SRC.jobberGps,
    SRC.jobberForce,
    SRC.jobberForceHelp,
    SRC.hcpPricing,
    SRC.hcpGps,
    SRC.kickservPricing,
    SRC.workizPricing,
    SRC.workizOmw,
    SRC.stPricing,
    SRC.stFleet,
    SRC.arrivyPricing,
    SRC.arrivyCx,
    SRC.glympseProHow,
    SRC.glympseProCost,
  ],
  verified: COMPARE_MORE_VERIFIED,
};

export const compareMorePages: LandingPage[] = [arrivy, glympse, alternativesHub, jobberAlternatives, hcpAlternatives];
