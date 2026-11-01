/**
 * Free tools: /tools, /tools/on-my-way-text-generator, /tools/no-show-cost-calculator.
 *
 * Each page carries substantial prerendered content around its interactive
 * tool (components/OmwTextGenerator.tsx, components/NoShowCalculator.tsx), so
 * crawlers and AI agents that don't run JavaScript still get the explanation,
 * worked examples, FAQs and the tool's default output.
 *
 * Product claims describe what ArrivePing does today:
 *  - the on-the-way text wording is services/dispatch.ts defaultMessage("enroute");
 *  - running-late: shared/delay-policy.ts + schema defaults (flag at 15 min past
 *    the promised time, auto-send after 10 min if nobody acts, SMS not email,
 *    never once the technician has arrived);
 *  - the arrived text is on by default (dispatch.ts BASE_RULES).
 * Regulatory and technical statements link to their primary source.
 */
import type { LandingPage } from "./landing";
import { generateTexts, tradeFor, type OmwInput } from "../tools/omw-text";
import { money, NO_SHOW_DEFAULTS, noShowCost } from "../tools/no-show";
import { STARTER_PRICE } from "../config";

/** Prices in copy come from the pricing config, never typed by hand. */
const P = STARTER_PRICE;

const toolsParent = { label: "Free tools", path: "/tools" };

const REF = {
  twilioLength: { label: "Twilio: How long can a message be? (SMS character limits)", href: "https://www.twilio.com/docs/glossary/what-sms-character-limit" },
  casl6: { label: "Canada's Anti-Spam Legislation (CASL), section 6, Justice Laws Website", href: "https://laws-lois.justice.gc.ca/eng/acts/e-1.6/section-6.html" },
  fcc2024: { label: "FCC, Strengthening the Ability of Consumers To Stop Robocalls, Federal Register, March 5, 2024", href: "https://www.govinfo.gov/content/pkg/FR-2024-03-05/html/2024-04587.htm" },
  irs2026: { label: "Journal of Accountancy: IRS raises standard mileage rates for remainder of 2026", href: "https://www.journalofaccountancy.com/news/2026/jul/irs-raises-standard-mileage-rates-for-remainder-of-2026.html" },
} as const;

const SHOT_RULES = {
  src: "/img/site/features/app-inform-rules.webp",
  w: 1800,
  h: 927,
  alt: "ArrivePing notification rules: for each job event, toggles for in-app, email, text and webhook to the customer, technician and office, with Edit and Test buttons.",
  caption: "Notification rules: which milestones text, email or notify the customer, technician and office. Real ArrivePing screen.",
};
const SHOT_TRACK = {
  src: "/img/site/app/cust-track.webp",
  w: 680,
  h: 1478,
  phone: true,
  alt: "The customer's live tracking page in a phone browser: 3 min estimated arrival, 0.9 km away, destination 214 Waverley St, and a job timeline showing the request received, the technician assigned and the technician on the way.",
  caption: "The page the link opens: live ETA, distance and job timeline. Real ArrivePing screen, sample job.",
};
const SHOT_CONTACT = {
  src: "/img/site/app/cust-contact.webp",
  w: 680,
  h: 1478,
  phone: true,
  alt: "The customer's page showing technician Jordan Park with Call and Text buttons, and a message thread: Jordan is about 3 minutes out and bringing a new igniter; the customer replies that the side door is open.",
  caption: "The customer can reply or call in one tap, before the truck arrives. Real ArrivePing screen, sample job.",
};

/** ArrivePing's default on-the-way text (services/dispatch.ts), as shown on the homepage. */
const AP_DEFAULT_ENROUTE =
  "Prairie Comfort HVAC: Your technician Jordan Park is on the way! ETA ~3 min. Track live, see ETA & message them: [link]";

/* ------------------------------------------------------------------ */
/* On-my-way text generator                                              */
/* ------------------------------------------------------------------ */

/** Worked examples, made with the same generator the page runs (sample companies and people). */
const EXAMPLES: { title: string; input: OmwInput }[] = [
  { title: "HVAC · friendly", input: { trade: "hvac", tone: "friendly", company: "Prairie Comfort HVAC", tech: "Jordan", eta: 20, link: true, optOut: false } },
  { title: "Plumbing · professional", input: { trade: "plumbing", tone: "professional", company: "Bluestem Plumbing", tech: "Sam", eta: 15, link: true, optOut: false } },
  { title: "Electrical · brief", input: { trade: "electrical", tone: "brief", company: "Northline Electric", tech: "Priya", eta: 25, link: true, optOut: false } },
  { title: "Cleaning · friendly", input: { trade: "cleaning", tone: "friendly", company: "Tidy Nest Cleaning", tech: "Maria", eta: 10, link: false, optOut: true } },
  { title: "Delivery and installation · professional", input: { trade: "delivery", tone: "professional", company: "Riverside Furniture", tech: "Dev", eta: 30, link: true, optOut: false } },
  { title: "Landscaping · brief", input: { trade: "landscaping", tone: "brief", company: "Green Acre Lawn Care", tech: "Alex", eta: 12, link: false, optOut: false } },
];

const omwGenerator: LandingPage = {
  path: "/tools/on-my-way-text-generator",
  label: "On-my-way text generator",
  parent: toolsParent,
  meta: {
    title: "Free On-My-Way Text Generator for Service Techs | ArrivePing",
    description:
      "Free on-my-way text generator: pick your trade and tone, add your company, tech and ETA, then copy ready-to-send on-my-way, running-late and arrived texts.",
  },
  eyebrow: "Free tool",
  h1: "On-my-way text generator for service teams",
  lede:
    "Pick your trade and tone, type your company name, the technician's first name and an ETA, and copy three ready-to-send texts: on my way, running late and arrived. It runs in your browser, saves nothing and needs no signup.",
  answer: {
    q: "What should an on-my-way text say?",
    a: "Answer three things in one short text: who is coming, from which company, and roughly when. Add a live tracking link if you have one, and at most one practical ask, such as clearing a path to the furnace. Send it when the technician actually leaves, follow up only if the time slips, and use plain characters: a single emoji cuts an SMS segment from 160 characters to 70.",
  },
  next: [
    { label: "All free tools", href: "/tools" },
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "Customer notifications", href: "/customer-notifications" },
    { label: "ArrivePing pricing", href: "/pricing" },
  ],
  faqTitle: "On-my-way texts: FAQs",
  sections: [
    {
      kind: "tool",
      id: "generator",
      tool: "omw-text",
      eyebrow: "Generator",
      title: "What will your texts say?",
      body: "Change any field and the three texts update. Copy one, paste it into your phone or messaging tool, and replace [tracking link] with your own link.",
    },
    {
      kind: "examples",
      id: "examples",
      title: "What does a good on-my-way text look like in each trade?",
      body: "Six worked examples made with the generator above. The companies and people are samples.",
      groups: EXAMPLES.map((e) => {
        const t = generateTexts(e.input);
        return {
          title: `${tradeFor(e.input.trade).label.split(" (")[0]}: ${e.title.split(" · ")[1]}`,
          items: [
            { label: "On my way", text: t.onMyWay },
            { label: "Running late", text: t.runningLate },
            { label: "Arrived", text: t.arrived },
          ],
        };
      }),
    },
    {
      kind: "rich",
      id: "length",
      title: "How long should an on-my-way text be?",
      paragraphs: [
        "One SMS segment holds 160 characters when every character is in the standard GSM-7 set, and 153 per segment once a message is split. A single emoji, curly apostrophe or other character outside that set switches the whole text to UCS-2, which fits 70 characters, then 67 per segment. A 170-character text with one emoji is three segments, not two.",
        "The generator counts characters and segments as you type, using those limits. Its templates stick to plain characters, with straight apostrophes and no dashes or emoji, so the brief versions stay within one segment for most company names. A real link replaces [tracking link], so check the count again once yours is in.",
      ],
      bullets: [
        "Lead with your company name so the customer knows who is texting",
        "Use the technician's first name; it's who they'll open the door to",
        "Give a time in minutes or a clock time, never just \"soon\"",
        "One link and one ask at most",
        "Skip emoji and curly quotes",
      ],
    },
    {
      kind: "rich",
      id: "opt-out",
      title: "Do on-my-way texts need opt-out wording?",
      paragraphs: [
        "It depends on where you operate and what the message says, so get advice for your own business. Two primary sources are worth reading:",
      ],
      bullets: [
        "Canada: [CASL section 6](https://laws-lois.justice.gc.ca/eng/acts/e-1.6/section-6.html) requires a commercial electronic message to identify the sender, give contact information and include an unsubscribe mechanism. Section 6(6) exempts messages that solely facilitate, complete or confirm a transaction, give factual information about an ongoing purchase, or deliver a service from the consent requirement in 6(1)(a), but not from those content rules.",
        "United States: in its 2024 order on revoking consent, the [FCC](https://www.govinfo.gov/content/pkg/FR-2024-03-05/html/2024-04587.htm) said that replying \"stop\", \"quit\", \"end\", \"revoke\", \"opt out\", \"cancel\" or \"unsubscribe\" is a reasonable way to revoke consent to texts, to be honoured within 10 business days. The order delayed the effective date of some of its provisions.",
        "In practice: name your business in every text, keep marketing out of arrival texts, and act on a STOP reply. The generator's \"Reply STOP to opt out\" option adds that line.",
      ],
    },
    {
      kind: "shots",
      id: "automatic",
      title: "How does ArrivePing send these automatically?",
      paragraphs: [
        `In ArrivePing nobody copies and pastes. When the technician taps Start Driving, the customer gets the on-the-way text with a live tracking link. By default it reads: "${AP_DEFAULT_ENROUTE}". The customer sees the technician's location only from that moment until arrival.`,
        "If a job runs 15 minutes past its promised time (the default), it's flagged on the dispatch board. If nobody sends, adjusts or mutes the notice within 10 minutes, ArrivePing texts the customer a running-late update with the new time and the live link: by text, not email, and never once the technician has arrived. An arrived text goes out when the technician gets there.",
        "The setup agent drafts every message in your voice and you can edit any of them. See [on-my-way text software](/on-my-way-text-software), [customer notifications](/customer-notifications) and [pricing](/pricing).",
      ],
      shots: [SHOT_RULES, SHOT_TRACK],
    },
    {
      kind: "refs",
      title: "Sources",
      body: "Checked November 1, 2026. This page is general information, not legal advice.",
      items: [
        { ...REF.twilioLength, note: "GSM-7 and UCS-2 segment lengths" },
        { ...REF.casl6, note: "content requirements and the 6(6) exemptions" },
        { ...REF.fcc2024, note: "revoking consent by reply text" },
      ],
    },
  ],
  faqs: [
    {
      q: "Is this on-my-way text generator free?",
      a: "Yes. It's free, needs no signup, and runs entirely in your browser. Nothing you type is saved or sent anywhere.",
    },
    {
      q: "When should I send an on-my-way text?",
      a: "When the technician actually leaves for the job, not when the day starts; that's when the ETA is real. If the time slips, send one running-late update with a new time rather than several small ones.",
    },
    {
      q: "Should an on-my-way text include a tracking link?",
      a: "If you have one, yes: a live link answers \"where are they now?\" without a call to the office. ArrivePing adds the link automatically and shows the technician's location only from on the way until arrival.",
    },
    {
      q: "How many characters fit in one text message?",
      a: "160 characters in one segment with the standard GSM-7 character set, or 153 per segment once a message is split. One emoji or curly quote switches the message to UCS-2, which fits 70 characters, then 67 per segment.",
    },
    {
      q: "Can ArrivePing send these texts automatically?",
      a: `Yes. ArrivePing sends the on-the-way text when the technician taps Start Driving, a running-late text when a job slips past your threshold and nobody acts, and an arrived text at the door. Plans start at US$${P} a month for one dispatcher and two drivers, with a 30-day free trial.`,
    },
  ],
  related: ["/on-my-way-text-software", "/tools/no-show-cost-calculator", "/customer-notifications", "/pricing", "/features"],
};

/* ------------------------------------------------------------------ */
/* No-show cost calculator                                               */
/* ------------------------------------------------------------------ */

const D = NO_SHOW_DEFAULTS;
const R = noShowCost(D);
const ROUND_TRIP = money(R.perTrip);
const YEAR = money(R.yearly, 0);

const noShowCalculator: LandingPage = {
  path: "/tools/no-show-cost-calculator",
  label: "No-show cost calculator",
  parent: toolsParent,
  meta: {
    title: "No-Show Cost Calculator for Field Service | ArrivePing",
    description:
      "Free no-show cost calculator for field service: what a customer-not-home trip costs in technician time and vehicle cost, per month and per year, formula shown.",
  },
  eyebrow: "Free tool",
  h1: "No-show cost calculator: what a customer-not-home trip costs",
  lede:
    "Enter your technician's loaded hourly rate, the drive, the minutes lost at the door, your vehicle cost and how often it happens. The calculator shows the cost per wasted trip, per month and per year, and the formula behind every number. It runs in your browser and saves nothing.",
  answer: {
    q: "How do you calculate the cost of a no-show?",
    a: `Multiply the technician's loaded hourly rate by the time lost, meaning the drive plus the minutes at the door, then add the vehicle cost for the distance driven. With a $${D.hourlyRate} loaded rate, ${D.driveMinutes} minutes of driving, ${D.onSiteMinutes} minutes at the door and ${D.distance} miles at ${Math.round(D.vehicleRate * 100)} cents a mile, one wasted trip costs about ${money(Math.round(R.perTrip), 0)}. Multiply by your monthly count, then by 12, for the yearly figure.`,
  },
  next: [
    { label: "All free tools", href: "/tools" },
    { label: "On-my-way text generator", href: "/tools/on-my-way-text-generator" },
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "ArrivePing pricing", href: "/pricing" },
  ],
  faqTitle: "No-show costs: FAQs",
  sections: [
    {
      kind: "tool",
      id: "calculator",
      tool: "no-show",
      eyebrow: "Calculator",
      title: "What do customer-not-home trips cost your team?",
      body: "The example numbers are filled in; replace them with yours. Every result updates as you type.",
    },
    {
      kind: "rich",
      id: "formula",
      title: "What goes into the formula?",
      paragraphs: [
        "Cost per wasted trip = loaded hourly rate × (drive minutes + minutes at the door) ÷ 60 + vehicle cost per mile (or km) × distance driven. Per month = cost per trip × wasted trips a month. Per year = per month × 12.",
      ],
      bullets: [
        "Loaded hourly rate: what an hour of a technician costs you, including payroll taxes, benefits, insurance and overhead, not just the wage.",
        "Drive minutes: the time spent driving to the empty house and on to the next job or back, which is time that earns nothing.",
        "Minutes at the door: knocking, calling the customer and the office, and waiting before giving up.",
        "Vehicle cost: fuel, wear, insurance and depreciation per mile or km, times the distance driven for that trip.",
        "Wasted trips per month: your own count across the whole team.",
      ],
    },
    {
      kind: "rich",
      id: "defaults",
      title: "Where do the example numbers come from?",
      paragraphs: [
        `$${D.hourlyRate} an hour is the loaded technician rate ArrivePing uses as a standard assumption in its own examples. ${Math.round(D.vehicleRate * 100)} cents a mile is the IRS business standard mileage rate from July 1, 2026, up from 72.5 cents, as reported by the [Journal of Accountancy](https://www.journalofaccountancy.com/news/2026/jul/irs-raises-standard-mileage-rates-for-remainder-of-2026.html) (IRS Announcement 2026-11). The trip (${D.driveMinutes} minutes, ${D.onSiteMinutes} minutes at the door, ${D.distance} miles) and ${D.perMonth} trips a month are round illustrative numbers, not industry averages. Use your own.`,
        `With those inputs, one wasted trip costs ${ROUND_TRIP}: ${money(R.labour)} of technician time and ${money(R.vehicle)} of vehicle cost. ${D.perMonth} a month is ${money(R.monthly)}, or ${YEAR} and ${R.hoursPerYear} technician hours a year.`,
        "The calculator leaves out the margin on the job you could have done instead and the office time spent rebooking. If you track those, add them to the result.",
      ],
    },
    {
      kind: "rich",
      id: "reduce",
      title: "How do you reduce customer-not-home trips?",
      paragraphs: ["Most wasted trips start with a customer who didn't know when to expect you. Five habits help:"],
      bullets: [
        "Confirm the appointment and the arrival window the day before.",
        "Text when the technician actually leaves, with a live ETA, so the customer can say \"I'm not home\" before the truck rolls. Try the [on-my-way text generator](/tools/on-my-way-text-generator).",
        "Give the customer a one-tap way to reach the technician directly.",
        "When the day slips, send a running-late update with a new time instead of letting the window lapse.",
        "Put access notes, such as a gate code or \"use the side door\", on the work order so the technician isn't stuck outside.",
      ],
      ordered: true,
    },
    {
      kind: "shots",
      id: "arriveping",
      title: "How does ArrivePing help the customer be home?",
      paragraphs: [
        "When the technician taps Start Driving, the customer gets a text with a live tracking link and can text or call the technician from that page, so a \"running 10 minutes late, side door is open\" reply reaches the technician before the truck does. If the job slips past its promised time and nobody acts, ArrivePing sends a running-late text with the new time.",
        `See [on-my-way text software](/on-my-way-text-software), [automatic dispatch](/dispatch-software) and [pricing](/pricing): from US$${P} a month, with a 30-day free trial.`,
      ],
      shots: [SHOT_CONTACT, SHOT_RULES],
    },
    {
      kind: "refs",
      title: "Sources",
      body: "Checked November 1, 2026.",
      items: [{ ...REF.irs2026, note: "76 cents a mile from July 1, 2026 (IRS Announcement 2026-11)" }],
    },
  ],
  faqs: [
    {
      q: "What does a no-show cost a field service business?",
      a: `It depends on your rate, your drive times and how often it happens; the calculator shows your number. With the example inputs, a $${D.hourlyRate} loaded hourly rate, ${D.driveMinutes} minutes of driving, ${D.onSiteMinutes} minutes at the door and ${D.distance} miles at ${Math.round(D.vehicleRate * 100)} cents a mile, each wasted trip costs ${ROUND_TRIP}, and ${D.perMonth} a month add up to ${YEAR} a year.`,
    },
    {
      q: "What is a loaded hourly rate?",
      a: `What an hour of a technician costs you, not just their wage: pay plus payroll taxes, benefits, insurance and overhead. If you don't know yours yet, $${D.hourlyRate} an hour is the planning figure ArrivePing uses in its own examples; replace it with your own.`,
    },
    {
      q: "What vehicle cost per mile should I use?",
      a: "Your own cost if you track it. If not, the IRS business standard mileage rate is a common stand-in: 76 cents a mile from July 1, 2026, up from 72.5 cents, according to the Journal of Accountancy's report on IRS Announcement 2026-11. Switch to kilometres and the calculator converts the rate for you.",
    },
    {
      q: "Does the calculator save my numbers?",
      a: "No. It runs entirely in your browser; nothing you type is saved or sent anywhere, and there is no form to submit.",
    },
    {
      q: "How does ArrivePing reduce customer-not-home trips?",
      a: `The customer gets a text with a live tracking link when the technician starts driving, can text or call the technician in one tap, and gets a running-late update with a new time if the job slips. That gives them the chance to say they're not home before the truck arrives. Plans start at US$${P} a month.`,
    },
  ],
  related: ["/tools/on-my-way-text-generator", "/on-my-way-text-software", "/dispatch-software", "/pricing", "/features"],
};

/* ------------------------------------------------------------------ */
/* /tools hub                                                            */
/* ------------------------------------------------------------------ */

const toolsHub: LandingPage = {
  path: "/tools",
  label: "Free tools",
  meta: {
    title: "Free Tools for Field Service Teams: Texts and Calculators",
    description:
      "Free tools for HVAC, plumbing, electrical, cleaning and delivery teams: an on-my-way text generator and a no-show cost calculator. No signup, nothing saved.",
  },
  eyebrow: "Free tools",
  h1: "Free tools for field service teams",
  lede:
    "Two free tools that run in your browser, with no signup and nothing saved: write better arrival texts, and put a number on the trips where nobody answers the door.",
  answer: {
    q: "What free tools does ArrivePing offer?",
    a: `Two, both free and browser-only. The on-my-way text generator writes on-my-way, running-late and arrived texts for your trade and tone, with a character and segment count and a copy button. The no-show cost calculator shows what a customer-not-home trip costs in technician time and vehicle cost, with the formula shown. ArrivePing itself sends those texts automatically, from $${P} a month.`,
  },
  next: [
    { label: "On-my-way text software", href: "/on-my-way-text-software" },
    { label: "Every ArrivePing feature", href: "/features" },
    { label: "ArrivePing pricing", href: "/pricing" },
    { label: "Alternatives and comparisons", href: "/alternatives" },
  ],
  faqTitle: "Free tools: FAQs",
  sections: [
    {
      kind: "cards",
      title: "Which tool do you need?",
      items: [
        {
          title: "On-my-way text generator",
          body: "Pick your trade and tone, add your company, technician and ETA, and copy on-my-way, running-late and arrived texts.",
          href: "/tools/on-my-way-text-generator",
          cta: "Write your texts",
        },
        {
          title: "No-show cost calculator",
          body: "What a customer-not-home trip costs in technician time and vehicle cost, per month and per year, with the formula shown.",
          href: "/tools/no-show-cost-calculator",
          cta: "Calculate your cost",
        },
        {
          title: "On-my-way text software",
          body: "How ArrivePing sends these texts automatically, with a live tracking link, when the technician taps Start Driving.",
          href: "/on-my-way-text-software",
          cta: "See how it works",
        },
      ],
    },
    {
      kind: "rich",
      title: "How do these tools relate to ArrivePing?",
      paragraphs: [
        "The tools stand on their own: use the texts with any phone or messaging app, and the calculator with your own numbers. ArrivePing is the field service software that does the same jobs automatically: it sends the on-the-way text with a live tracking link when the technician starts driving, warns the customer when a job is running late, and assigns each job to the closest qualified technician.",
        `See [every feature](/features) and [pricing](/pricing): from US$${P} a month for one dispatcher and two drivers, with a 30-day free trial.`,
      ],
    },
  ],
  faqs: [
    {
      q: "Are these tools really free?",
      a: "Yes. Both are free to use as often as you like, with no signup and no email address required.",
    },
    {
      q: "Do the tools store what I type?",
      a: "No. Both run entirely in your browser. Nothing you type is saved or sent anywhere, and there is no form to submit.",
    },
    {
      q: "Can ArrivePing send these texts for me?",
      a: "Yes. ArrivePing sends the on-the-way text when the technician taps Start Driving, a running-late text when a job slips and nobody acts, and an arrived text at the door, all drafted in your voice and editable.",
    },
  ],
  related: ["/tools/on-my-way-text-generator", "/tools/no-show-cost-calculator", "/on-my-way-text-software", "/pricing", "/features"],
};

export const toolPages: LandingPage[] = [toolsHub, omwGenerator, noShowCalculator];
