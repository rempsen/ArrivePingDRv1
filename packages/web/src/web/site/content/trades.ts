import type { LandingPage, TradeContent } from "./landing";

/**
 * Trade pages, from the October 2026 industry research (scratch briefs, one per
 * trade). Every statistic is quoted from its linked source; every product claim
 * is something ArrivePing does today. Scenarios use sample names only.
 */

const media = (key: string, film = true): TradeContent["media"] => ({
  poster: `/img/site/trades/${key}-hero.jpg`,
  posterWebp: `/img/site/trades/${key}-hero.webp`,
  ...(film ? { film: { large: `/media/trades/${key}-1600.mp4`, small: `/media/trades/${key}-960.mp4` } } : {}),
});

/** The same offer on every trade page, in the trade's own word for the field team. */
const priceFaq = (q: string, noun: string, plural: string) => ({
  q,
  a: `Start with a 30-day free trial for as many users as you like. Your card is kept on file and nothing is charged until day 30; cancel before then and you pay nothing. After that it's US$49 a month for one dispatcher and two ${plural}, US$30 a month for each ${noun} from 3 to 29, and US$25 from the 30th. No setup fee, no contract.`,
});

const ONE_HOUR = {
  source: "One Hour Heating & Air Conditioning survey of 1,124 U.S. homeowners, 2026",
  href: "https://www.prnewswire.com/news-releases/on-time-or-running-behind-new-one-hour-heating--air-conditioning-survey-reveals-how-americans-stack-up-302893650.html",
};

/* ------------------------------------------------------------------ */
/* HVAC                                                                 */
/* ------------------------------------------------------------------ */

export const hvac: LandingPage = {
  path: "/hvac-dispatch-software",
  label: "HVAC dispatch software",
  meta: {
    title: "HVAC Dispatch Software with Live ETAs | ArrivePing",
    description:
      "Send the right licensed tech to every no-heat or no-cool call and text customers a live ETA. No GPS hardware. Try ArrivePing free for 30 days.",
  },
  eyebrow: "HVAC & mechanical",
  h1: "Send the right HVAC tech. Keep customers posted.",
  lede: "Match no-heat and no-cool calls to a qualified, nearby technician and text customers a live ETA, all from the phones your crew already carries.",
  answer: {
    q: "What should HVAC dispatch software do?",
    a: "HVAC dispatch software should show every open call and technician on one board and suggest the best tech by licenses, skills, distance and workload. It should text customers a live ETA once the tech starts driving, record arrival automatically, require checklist items before a job closes, and keep photos and signatures with each job.",
  },
  trade: {
    media: media("hvac"),
    proof: ["Suggests the best tech by skills and distance", "Live ETA link, no customer app", "Arrival and on-site time logged automatically"],
    sms: { company: "Northwind Heating", who: "technician", tech: "Devon", eta: 19, time: "6:44 AM" },
    statsTitle: "Why the arrival matters in HVAC",
    stats: [
      { value: "85%", label: "of homeowners say arriving within the estimated window is extremely or very important", ...ONE_HOUR },
      {
        value: "47%",
        label: "of appointments don't go according to schedule, field workers estimate",
        source: "Salesforce survey of 350 U.S. field workers, 2025",
        href: "https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/service-cloud/fIeld-service-guide-4th-edition.pdf",
      },
      {
        value: "40,600",
        label: "openings projected each year for HVAC mechanics and installers in the U.S.",
        source: "U.S. Bureau of Labor Statistics, 2026",
        href: "https://www.bls.gov/ooh/installation-maintenance-and-repair/heating-air-conditioning-and-refrigeration-mechanics-and-installers.htm",
      },
    ],
    day: {
      eyebrow: "A no-heat call, start to finish",
      title: "6:38 a.m., −27°C, and a baby in unit 2.",
      cta: "Follow a no-heat call",
      steps: [
        {
          time: "6:38 a.m.",
          title: "The call comes in",
          body: "Priya, a property manager, sends the online request for a 1960s fourplex with no heat. Marco, the dispatcher, marks it Emergency, requires the Gas fitter skill and adds the lockbox code to the access notes.",
        },
        {
          time: "6:41 a.m.",
          title: "The right tech, not just the nearest",
          body: "ArrivePing suggests Devon: gas-licensed, free and 7 km away. Marco moves Devon's 8:00 tune-up and sends that homeowner a running-late update. Devon accepts and taps Start Driving.",
        },
        {
          time: "6:44 a.m.",
          title: "Everyone can see him coming",
          body: "Priya's text reads “Your technician Devon is on the way! ETA ~19 min.” Her live page follows him through unplowed side streets. She messages “Side door, unit 2,” and the note stays on the job where Marco sees it.",
        },
        {
          time: "7:04 a.m.",
          title: "Fixed, and on the record",
          body: "Devon is checked in automatically within 150 m, and his location leaves Priya's page. He clears snow from the furnace intake and the burners relight. He logs the required CO reading, adds a vent photo, the tenant signs, and he taps Complete Job.",
        },
      ],
    },
    features: {
      eyebrow: "Built for HVAC",
      title: "No-heat emergencies, tune-up season and everything between.",
      items: [
        { title: "License-aware assignment", body: "Tag techs with gas, oil, refrigerant or boiler credentials, then require them on the work order." },
        { title: "Emergencies to the top", body: "Give no-heat calls top priority and see on the live map who's free and close." },
        { title: "Tune-ups that can't skip steps", body: "Spring and fall templates can require readings, filter checks and safety steps before a job is completed." },
        { title: "Equipment and access notes", body: "Furnace model, filter size and refrigerant type, plus lockbox and roof-hatch access, travel with the job." },
        { title: "Live ETA, no app", body: "The on-the-way text opens a browser page with who's coming, a live ETA, and call, text and message buttons." },
        { title: "Proof for property managers", body: "On-site time, photos and signatures stay with each job and export to CSV, Excel or PDF." },
      ],
    },
  },
  sections: [{ kind: "trades", title: "Other trades on ArrivePing." }],
  faqs: [
    priceFaq("How much does HVAC dispatch software cost?", "technician", "technicians"),
    {
      q: "Do I need GPS trackers in my service vans?",
      a: "No. ArrivePing runs on the iPhone, iPad or Android phone your techs already carry. Techs tap Start Driving and the customer's ETA updates live. Location is shared only while a tech is on shift, and arrival checks in automatically within 150 metres of the address.",
    },
    {
      q: "Can customers see where my technician is all day?",
      a: "No. A customer sees the tech's location only after the tech starts driving to their job, and it disappears on arrival. Their page shows who's coming and a live ETA, with options to call, text or message. It works in any browser, with no app or account.",
    },
    {
      q: "How do I send only licensed techs to gas or refrigerant jobs?",
      a: "Tag each technician with skills such as a gas license, EPA 608 Universal or boiler experience, then require those skills on the work order or job template. ArrivePing's suggestions weigh skills alongside distance, availability and workload, and dispatchers can always override them.",
    },
    {
      q: "How do I fit emergency no-heat calls into a full schedule?",
      a: "Create a high-priority work order. It lands in the work queue, and the live map shows which technicians are nearby and available. Take the suggested tech or choose another, and send any bumped customers a running-late update so they don't have to call.",
    },
    {
      q: "Can it handle seasonal tune-ups?",
      a: "Yes, visit by visit. Build spring and fall tune-up templates with required checklist items, price each tune-up in your service catalog, and capture photos and the customer's signature on every visit. Import your maintenance customers from a spreadsheet to get started.",
    },
  ],
  related: ["/plumbing-dispatch-software", "/electrical-dispatch-software", "/on-my-way-text-software", "/compare/housecall-pro"],
};

/* ------------------------------------------------------------------ */
/* Plumbing                                                             */
/* ------------------------------------------------------------------ */

export const plumbing: LandingPage = {
  path: "/plumbing-dispatch-software",
  label: "Plumbing dispatch software",
  meta: {
    title: "Plumbing Dispatch Software with Live ETAs | ArrivePing",
    description:
      "Dispatch burst pipes and booked jobs to the nearest licensed plumber and text customers a live ETA. Try free for 30 days, then from US$49/mo.",
  },
  eyebrow: "Plumbing",
  h1: "Send the right plumber and keep customers posted.",
  lede: "Put burst pipes and booked jobs on one board, match each to a nearby licensed plumber, and text customers a live ETA.",
  answer: {
    q: "What should plumbing dispatch software do?",
    a: "Plumbing dispatch software should put emergencies and booked jobs on one board, match each job to the nearest available plumber with the right license, and tell customers who is coming and when. Look for live ETA texts that need no app, automatic arrival check-in, checklist items you can make required, photos and signatures on the job, and location sharing only while on shift.",
  },
  trade: {
    media: media("plumbing"),
    proof: ["Live ETA text, no customer app", "Suggests the nearest qualified, available plumber", "Automatic check-in within 150 m"],
    sms: { company: "Riverbend Plumbing", who: "plumber", tech: "Jordan", eta: 14, time: "6:55 AM" },
    statsTitle: "Why minutes matter in plumbing",
    stats: [
      {
        value: "1 in 60",
        label: "insured homes, roughly, has a property damage claim from water damage or freezing; those claims averaged $15,400",
        source: "Insurance Information Institute, ISO/Verisk data 2019–2023",
        href: "https://www.iii.org/fact-statistic/facts-statistics-homeowners-and-renters-insurance",
      },
      { value: "85%", label: "of homeowners say arriving within the estimated window is extremely or very important", ...ONE_HOUR },
      {
        value: "42,000",
        label: "openings projected each year for plumbers, pipefitters and steamfitters in the U.S.",
        source: "U.S. Bureau of Labor Statistics, 2026",
        href: "https://www.bls.gov/ooh/construction-and-extraction/plumbers-pipefitters-and-steamfitters.htm",
      },
    ],
    day: {
      eyebrow: "A burst pipe, start to finish",
      title: "6:52 a.m., −24°C, and water on the basement floor.",
      cta: "Follow a burst-pipe call",
      steps: [
        {
          time: "6:52 a.m.",
          title: "A frozen line lets go",
          body: "Lena, a property manager, books online: water is spraying from a frozen line in a rental duplex basement. Kim, dispatching from home, marks it Emergency, notes “shutoff behind furnace; tenant Ana home” and requires the Licensed plumber skill.",
        },
        {
          time: "6:55 a.m.",
          title: "The nearest licensed plumber",
          body: "The board suggests Jordan, a journeyperson 5 km away. Kim moves Jordan's 8:00 water-heater job, and that customer gets a running-late update. Jordan accepts and taps Start Driving. Ana's text reads “ETA ~14 min.”",
        },
        {
          time: "7:10 a.m.",
          title: "Help she can watch arrive",
          body: "Ana watches Jordan's van approach on the live page. The map disappears as he's checked in automatically within 150 m. He shuts off the main, photographs the split pipe and messages the office from the job: “Need drywall cut for access.”",
        },
        {
          time: "8:25 a.m.",
          title: "Closed with proof",
          body: "The job can't be completed until the required items are ticked: water restored, leak check done. Jordan adds photos, Ana signs on his phone, Kim exports the job as a PDF for Lena, and Jordan heads to the water-heater job.",
        },
      ],
    },
    features: {
      eyebrow: "Built for plumbing",
      title: "From the emergency call to the signed-off job.",
      items: [
        { title: "Emergencies jump the queue", body: "Mark burst pipes and backups high priority so they show first in the work queue of unassigned jobs." },
        { title: "License-aware assignment", body: "Tag plumbers as journeyperson, master, gas or backflow-certified, and require that skill on matching work orders." },
        { title: "Nearest qualified plumber, suggested", body: "Suggestions weigh distance, skills, availability and workload. The dispatcher can always override." },
        { title: "Live ETA for worried homeowners", body: "One text shows who's coming and when, with call, text and message buttons. No app or account needed." },
        { title: "Proof on every job", body: "Checklist items you can make required, plus photos and a signature on the job, document inspections, leak checks and cleanouts." },
        { title: "Shutoffs and access, noted", body: "Custom fields and access notes give the plumber shutoff locations, lockbox instructions and tenant contacts." },
      ],
    },
  },
  sections: [{ kind: "trades", title: "Other trades on ArrivePing." }],
  faqs: [
    priceFaq("How much does plumbing dispatch software cost?", "plumber", "plumbers"),
    {
      q: "Can my customers track the plumber on the way?",
      a: "Yes. When the plumber taps Start Driving, the customer gets a text linking to a live page. It shows who's coming, an ETA that updates as they drive, and buttons to call, text or message them. There's no app or account, and the map disappears when the plumber arrives.",
    },
    {
      q: "Do I need GPS trackers in my vans?",
      a: "No. ArrivePing runs on the iPhone, iPad or Android phone your plumbers already carry. Location is shared only while a plumber is on shift. Customers see it only after the plumber starts driving to their job, and it disappears on arrival. Arrival is recorded automatically within 150 m.",
    },
    {
      q: "How do I make sure only licensed plumbers get gas or backflow jobs?",
      a: "Tag each plumber's skills, such as journeyperson, master or backflow tester, and require the matching skill on the work order. ArrivePing then suggests qualified plumbers, weighing distance, availability and workload, and dispatchers can override it.",
    },
    {
      q: "How should I dispatch emergency calls like burst pipes?",
      a: "Enter the call or take it through an online request form, set emergency priority, and it appears at the top of the work queue. The live map and suggestions show the nearest qualified plumber who's free. Send any bumped customer a running-late update. Job messages stay with the job, so the office can follow along.",
    },
    {
      q: "How long does setup take, and can I import my customers?",
      a: "Paste your website into the AI setup agent and it builds your branding, services, priced catalog, job templates, request forms and customer texts. Teams typically dispatch their first job within the first hour. Import customers and plumbers from a spreadsheet, and export to CSV, Excel, PDF or JSON.",
    },
  ],
  related: ["/hvac-dispatch-software", "/property-maintenance-software", "/on-my-way-text-software", "/compare/jobber"],
};

/* ------------------------------------------------------------------ */
/* Electrical                                                           */
/* ------------------------------------------------------------------ */

export const electrical: LandingPage = {
  path: "/electrical-dispatch-software",
  label: "Electrical dispatch software",
  meta: {
    title: "Electrician Scheduling & Dispatch Software | ArrivePing",
    description:
      "Send the right licensed electrician, text customers a live ETA and log arrivals automatically. No GPS hardware. Try ArrivePing free for 30 days.",
  },
  eyebrow: "Electrical",
  h1: "Send the right electrician and keep customers posted.",
  lede: "Match each call to a qualified, nearby tech, text customers a live ETA, and log arrival automatically on the phones your crew carries.",
  answer: {
    q: "What should electrician dispatch software do?",
    a: "Electrician dispatch software should match each call to an available, nearby technician with the right license and skills, put no-power emergencies ahead of routine work, text the customer a live ETA once the tech starts driving, log arrival and on-site time automatically, and keep photos, checklists and signatures with the job.",
  },
  trade: {
    media: media("electrical"),
    proof: ["Suggests by license, distance and workload", "Live ETA link, no customer app", "Arrival logged automatically within 150 m"],
    sms: { company: "Brightline Electric", who: "electrician", tech: "Malik", eta: 14, time: "3:44 PM" },
    statsTitle: "Why dispatch matters in electrical work",
    stats: [
      {
        value: "11 hrs",
        label: "of power interruptions per U.S. electricity customer in 2024, nearly twice the decade's average",
        source: "U.S. Energy Information Administration, 2025",
        href: "https://www.eia.gov/todayinenergy/detail.php?id=66744",
      },
      {
        value: "47%",
        label: "of appointments don't go according to schedule, field workers estimate",
        source: "Salesforce survey of 350 U.S. field workers, 2025",
        href: "https://www.salesforce.com/news/stories/field-service-agentic-ai-transformation/",
      },
      {
        value: "72,700",
        label: "electrician openings projected each year in the U.S.",
        source: "U.S. Bureau of Labor Statistics, 2026",
        href: "https://www.bls.gov/ooh/Construction-and-Extraction/Electricians.htm",
      },
    ],
    day: {
      eyebrow: "A no-power call, start to finish",
      title: "Friday, 3:40 p.m., and a kitchen without power.",
      cta: "Follow a no-power call",
      steps: [
        {
          time: "3:40 p.m.",
          title: "The cooler goes quiet",
          body: "Sam's pizzeria has lost its walk-in cooler and half the kitchen, and a breaker won't reset. Rosa opens an Emergency work order that requires “Journeyman, commercial,” notes “rear door, ask for Sam” and attaches the No-Power template.",
        },
        {
          time: "3:44 p.m.",
          title: "The right license, not just the closest",
          body: "ArrivePing suggests Malik, a journeyman 5 km away, over Tyler, a closer apprentice who isn't tagged for solo commercial calls. Rosa confirms. Malik accepts and taps Start Driving, and Sam gets a text with Malik's name and an ETA of about 14 minutes.",
        },
        {
          time: "4:04 p.m.",
          title: "No calls to the office",
          body: "Traffic adds six minutes, and Sam watches the ETA update instead of phoning. His message, “use the back lane,” stays on the job. Malik is checked in automatically within 150 m, and his location disappears from Sam's page.",
        },
        {
          time: "4:46 p.m.",
          title: "Fixed and documented",
          body: "A failed two-pole breaker with a scorched lug. Malik fits a replacement priced from the catalog, logs the template's required readings and adds panel photos. Sam signs on Malik's phone, and Rosa sees 42 minutes on site.",
        },
      ],
    },
    features: {
      eyebrow: "Built for electrical contractors",
      title: "Service calls, installs and outage days on one board.",
      items: [
        { title: "License-aware assignment", body: "Tag masters, journeymen, apprentices and EV or generator skills; require them so only qualified techs are suggested." },
        { title: "One queue for outage days", body: "Unassigned no-power calls wait in one prioritized queue, so dispatch clears emergencies before routine installs." },
        { title: "Checklists that block shortcuts", body: "Panel and EV templates can require readings and labelling before a job can be completed." },
        { title: "ETA without phone tag", body: "Customers get the on-the-way text and a live page to call, text or message the tech. No app needed." },
        { title: "Proof for inspectors and owners", body: "Photos, signatures and on-site time stay with each job; export PDF or CSV for owners, inspectors or warranties." },
        { title: "Subs on the same board", body: "Subcontracted electricians can sit on your roster and other contractors' too, dispatched like your own crew." },
      ],
    },
  },
  sections: [{ kind: "trades", title: "Other trades on ArrivePing." }],
  faqs: [
    {
      q: "What is the best scheduling app for a small electrical company?",
      a: "The one your electricians will actually open. ArrivePing runs on the iPhone, iPad or Android phone they already carry. Paste your website and the AI setup agent builds your services, priced catalog, job templates and customer texts in minutes; the first job is typically dispatched within an hour.",
    },
    {
      q: "Can I assign jobs by license level, like journeyman or apprentice?",
      a: "Yes. Tag technicians with skills such as master, journeyman, apprentice, commercial, EV or generator, and mark the skills each work order requires. ArrivePing suggests the best match by skills, distance, availability and workload; dispatchers can override. Local licensing and supervision rules still decide who may work alone.",
    },
    {
      q: "Do I need GPS trackers in my vans?",
      a: "No. Location comes from the technician's phone, so there is no hardware to buy. Techs share location only while on the clock, and customers see it only after the tech starts driving to their job; it disappears on arrival. Check-in happens automatically within 150 m of the address.",
    },
    {
      q: "How do customers know when the electrician is on the way?",
      a: "When the tech taps Start Driving, the customer gets a text with the tech's name, an ETA and a link. The live page updates as the tech drives and lets the customer call, text or message them, with no app or account. Running-late updates are available, and messages stay on the job.",
    },
    {
      q: "Does it integrate with QuickBooks?",
      a: "Not natively yet: QuickBooks and Xero are on our roadmap. Today you can export your data as CSV, Excel, PDF or JSON, or send job events through webhooks to Zapier or Make. Custom integrations are welcome on every plan, and included with Fleet.",
    },
    priceFaq("How much does dispatch software for electricians cost?", "electrician", "electricians"),
  ],
  related: ["/hvac-dispatch-software", "/construction-trades", "/on-my-way-text-software", "/compare/servicetitan"],
};

/* ------------------------------------------------------------------ */
/* Installers & construction                                            */
/* ------------------------------------------------------------------ */

export const construction: LandingPage = {
  path: "/construction-trades",
  label: "Installers & construction",
  meta: {
    title: "Installer & Subcontractor Scheduling Software | ArrivePing",
    description:
      "Schedule installers by skill and distance, track installers between job sites, and text homeowners a live ETA. No GPS hardware. Try it free for 30 days.",
  },
  eyebrow: "Installers & specialty subcontractors",
  h1: "Get the right installer to every site.",
  lede: "Assign installers by skill and distance, track them between job sites, and text customers a live ETA from the phones they already carry.",
  answer: {
    q: "What should dispatch software for installers do?",
    a: "Dispatch software for installers should match each job to a qualified, available installer by skill and distance. It should carry site access notes and time windows, and track installers between sites without hardware. It should text the homeowner or site supervisor a live ETA, and record photos, checklists and sign-off as the work is completed.",
  },
  trade: {
    media: media("construction"),
    proof: ["Automatic check-in within 150 m of the site", "Required checklist items before close-out", "One installer, several companies' rosters"],
    sms: { company: "Keystone Interiors", who: "installer", tech: "Marcus", eta: 27, time: "7:35 AM" },
    statsTitle: "Why scheduling breaks down on site",
    stats: [
      {
        value: "45%",
        label: "of construction firms report project delays due to shortages of their own or subcontractors' workers",
        source: "AGC 2025 Workforce Survey, 1,342 firms",
        href: "https://www.agc.org/sites/default/files/users/user21902/2025%20Workforce%20Survey%20Analysis_V2.pdf",
      },
      {
        value: "24%",
        label: "of general contractors trust their own schedule updates to reflect field reality",
        source: "SmartPM, State of Construction Scheduling, 2026",
        href: "https://smartpm.com/press/second-annual-state-of-construction-report",
      },
      {
        value: "70%",
        label: "of subcontractors with $15M+ in revenue worked with more than 10 GCs in 2024",
        source: "Billd National Subcontractor Market Report, 2025",
        href: "https://billd.com/pdf/billd-2025-market-report.pdf",
      },
    ],
    day: {
      eyebrow: "A deficiency list, start to finish",
      title: "Eleven deficiencies before a 1 p.m. occupancy walk.",
      cta: "Follow a deficiency list",
      steps: [
        {
          time: "6:50 a.m.",
          title: "The list lands overnight",
          body: "A GC's site supervisor sent 11 flooring deficiencies for Suite 405 of a six-storey condo, due before the 1:00 p.m. occupancy walk. Grace builds the work order from her deficiency template, and ArrivePing suggests Marcus: tile-tagged, free and 9 km away.",
        },
        {
          time: "7:35 a.m.",
          title: "The supervisor sees him coming",
          body: "Marcus accepts the job and taps Start Driving. Dana, the site supervisor, gets an on-the-way text with a live ETA and a link to message him. The access notes ride along: north loading dock, service elevator booked.",
        },
        {
          time: "8:02 a.m.",
          title: "On site, on the clock",
          body: "Marcus is checked in automatically as he reaches the building, and his on-site time starts. In the job thread he writes, “Two cracked vanity tiles, need one box.” Grace sees it and sends Leo with the box.",
        },
        {
          time: "11:40 a.m.",
          title: "Closed out with proof",
          body: "The job can't be completed until every required checklist item is ticked, and Marcus photographs each repair. Dana signs on his phone, and Grace exports the closed work orders to PDF for the GC.",
        },
      ],
    },
    features: {
      eyebrow: "Built for installers and subs",
      title: "Installers, sites and close-out on one board.",
      items: [
        { title: "Installers matched by skill", body: "Tag installers for tile, plank, shades or cabinets and require skills per job. ArrivePing suggests the nearest qualified, available installer." },
        { title: "Built for multi-company subs", body: "One installer can be on several companies' rosters and take work from builders and dealers." },
        { title: "Site access notes", body: "Gate codes, loading docks, elevator bookings and time windows travel with the work order." },
        { title: "Deficiency lists with proof", body: "Required checklist items must be done before a deficiency job closes; photos and the signature stay on the job." },
        { title: "Live ETA for supervisors", body: "The on-the-way text opens a live page where supervisors and homeowners can call, text or message the installer." },
        { title: "Automatic site check-in", body: "Arrival is logged within 150 m and on-site time recorded, backing time-and-materials billing and backcharge questions." },
      ],
    },
  },
  sections: [
    {
      kind: "prose",
      eyebrow: "Why we built it",
      title: "Built by people who ran crews.",
      paragraphs: [
        "ArrivePing began as the system our founding team built for National Interiors, a Winnipeg specialty subcontractor with more than 800 field technicians. Dispatchers tied to the phone, crews at the wrong site and hours that didn't add up were daily problems. ArrivePing is the tool we wanted, rebuilt by NVC360 for every trade.",
      ],
    },
    { kind: "trades", title: "Other trades on ArrivePing." },
  ],
  faqs: [
    priceFaq("How much does installer scheduling software cost?", "installer", "installers"),
    {
      q: "How do I schedule installers across several job sites?",
      a: "Unassigned jobs wait in the work queue. Drag them onto the scheduler, or let ArrivePing suggest the best installer based on distance, skills, availability and workload. The live map shows every installer, the dispatcher can override any suggestion, and time windows stay on each work order.",
    },
    {
      q: "Can a subcontractor work for more than one company?",
      a: "Yes. An installer can be on more than one company's roster, which suits subs who install for a builder, a dealer and a renovator. They accept jobs, start driving and complete work in the same phone app.",
    },
    {
      q: "Do I need GPS trackers, and is tracking fair to installers?",
      a: "You don't need any hardware. ArrivePing runs on the phones your installers already carry, and installers share their location only while they're on the clock. A customer sees it only after the installer starts driving to their job, and it disappears on arrival. Check your provincial or state rules on monitoring employees.",
    },
    {
      q: "How do I text homeowners when the installer is on the way?",
      a: "It happens automatically when the installer taps Start Driving. The homeowner gets a text with a live link that shows who's coming and an ETA that updates as the installer drives. From that page they can call, text or message the installer. Running-late updates and messages stay with the job.",
    },
    {
      q: "How do we track deficiency items to close-out?",
      a: "Build job templates with checklist items, and mark some as required so the job can't be completed without them. Installers add photos and capture a signature on the job. Export to CSV, Excel or PDF for the GC, or connect your systems through webhooks to Zapier or Make.",
    },
  ],
  related: ["/electrical-dispatch-software", "/dispatch-software", "/fleet-tracking", "/about"],
};

/* ------------------------------------------------------------------ */
/* Property maintenance                                                 */
/* ------------------------------------------------------------------ */

export const property: LandingPage = {
  path: "/property-maintenance-software",
  label: "Property maintenance software",
  meta: {
    title: "Property Maintenance Dispatch Software | ArrivePing",
    description:
      "Dispatch in-house techs and vendors, text residents a live ETA, and keep photos, checklists and on-site times with every work order. Try it free, 30 days.",
  },
  eyebrow: "Property maintenance",
  h1: "Residents know exactly when maintenance is coming.",
  lede: "Dispatch in-house techs and vendors from one board, text residents a live ETA, and keep photos, checklists and on-site times with every work order.",
  answer: {
    q: "What should property maintenance dispatch software do?",
    a: "Property maintenance dispatch software should turn resident requests into prioritized work orders and match each job to the right in-house tech or vendor by skill and distance. It should text residents a live ETA, and keep access notes, entry details, photos, required checklists and on-site times with each job, so managers can show what happened in every unit.",
  },
  trade: {
    media: media("property"),
    proof: ["Live ETA text, no resident app", "Automatic check-in records time on site", "Required checklist steps before jobs close"],
    sms: { company: "Parkside Residences", who: "technician", tech: "Omar", eta: 16, time: "6:58 AM" },
    statsTitle: "What residents expect from maintenance",
    stats: [
      {
        value: "84%",
        label: "of renters expect a response from their property manager within 24 hours",
        source: "Buildium 2026 Renters' Report, 1,500 U.S. renters",
        href: "https://www.buildium.com/resource/2026-renters-report/",
      },
      {
        value: "6.8 days",
        label: "is the point where resident satisfaction begins to decline as a repair drags on",
        source: "Property Meld benchmarking report, 10M+ work orders, 2025",
        href: "https://propertymeld.com/wp-content/uploads/2026/03/PM25-Industry-Benchmarking-Report-October-FNL.pdf",
      },
      {
        value: "24%",
        label: "of property owners and managers report being understaffed for maintenance operations",
        source: "Parks Associates and GE Appliances survey of 100 owners and managers, 2023",
        href: "https://www.parksassociates.com/blogs/pr-smart-home/04252023",
      },
    ],
    day: {
      eyebrow: "An emergency request, start to finish",
      title: "6:52 a.m., and water through the bathroom ceiling.",
      cta: "Follow a leak call",
      steps: [
        {
          time: "6:52 a.m.",
          title: "The request lands",
          body: "Hannah, on the third floor of a 48-unit rental building, sends the resident request form: water is dripping through her bathroom ceiling. It lands in the work queue as an emergency, with her access note: “dog in bedroom, please knock.”",
        },
        {
          time: "6:58 a.m.",
          title: "The right tech, rolling",
          body: "Ines, the maintenance coordinator, accepts ArrivePing's suggestion of Omar: tagged for plumbing, on call and closest. He accepts and taps Start Driving. Hannah gets a text with his live ETA and a link to message him.",
        },
        {
          time: "7:14 a.m.",
          title: "On site, on record",
          body: "Omar is checked in automatically as he parks. He traces the leak to a failed toilet supply line in the unit above, where Victor lets him in. He shuts the water off and photographs both units.",
        },
        {
          time: "8:05 a.m.",
          title: "Closed, with follow-up booked",
          body: "The job can't be completed until its required items are ticked: water off, both units checked, entry recorded. Ines books Leo, a drywall subcontractor on two companies' rosters, for Thursday 9–11 a.m., and the office serves Hannah written notice for that window.",
        },
      ],
    },
    features: {
      eyebrow: "Built for property maintenance",
      title: "Requests, entry and proof, unit by unit.",
      items: [
        { title: "Entry steps you can't skip", body: "Make “notice served” or “consent recorded” a required checklist item, so no in-unit job closes without it." },
        { title: "Access notes on every order", body: "Lockbox codes, pets, alarms and permission to enter live in fields the tech reads before knocking." },
        { title: "Windows residents can plan around", body: "Book a time window; on-the-way texts and running-late updates keep residents informed without calling the office." },
        { title: "In-house techs and vendors", body: "Tag skills like licensed electrical work. Vendor techs can be on your roster and on their own company's." },
        { title: "Make-ready by template", body: "Turnover templates hold paint, cleaning, appliance and safety checks, with photos and sign-off on every job." },
        { title: "Proof of every visit", body: "Automatic check-in records arrival and time on site. Messages and photos stay with the work order." },
      ],
    },
  },
  sections: [{ kind: "trades", title: "Other trades on ArrivePing." }],
  faqs: [
    {
      q: "How much notice do we need before maintenance enters a unit?",
      a: "It depends on the province or state. Ontario requires 24 hours' written notice, with entry between 8 a.m. and 8 p.m.; Washington requires two days; Texas has no statute, so the lease governs. Always check your local rules. ArrivePing doesn't serve notices, but it keeps notice details on the work order and can require a “notice served” checklist item before the job closes.",
    },
    {
      q: "Do residents need an app, and can they always see the tech?",
      a: "No app or account is needed. Residents get a text that opens a live page with the tech's name, the ETA, and options to call, text or message. The tech's location appears only once they start driving to that job, and it disappears when they arrive.",
    },
    {
      q: "Can outside vendors work alongside our in-house techs?",
      a: "Yes. Vendor techs use the same phone app and can stay on their own company's roster too. Tag their skills, such as electrical or appliance work, and ArrivePing suggests the best match by distance, skills, availability and workload. Your coordinator can always override it.",
    },
    {
      q: "Can we run make-ready and turnover work in it?",
      a: "Yes. Build a turnover template with checklists for paint, cleaning, appliances and safety, and make the critical items required. Techs add photos and a sign-off. Priorities and time windows set the order of the turns, and the live map shows who can take the next one.",
    },
    {
      q: "Does it connect to AppFolio, Buildium or Yardi?",
      a: "Not with a built-in connector today. You can import from spreadsheets and export to CSV, Excel, PDF or JSON, and send job events through calendar feeds, webhooks to Zapier or Make, or an MCP server. Custom integrations are welcome on every plan, and included with Fleet along with live onboarding.",
    },
    priceFaq("What does it cost for a maintenance team?", "technician", "technicians"),
  ],
  related: ["/plumbing-dispatch-software", "/customer-notifications", "/dispatch-software", "/canada"],
};

/* ------------------------------------------------------------------ */
/* Delivery & installation                                              */
/* ------------------------------------------------------------------ */

export const delivery: LandingPage = {
  path: "/delivery-dispatch-software",
  label: "Delivery & installation software",
  meta: {
    title: "Delivery Scheduling Software with Live ETAs | ArrivePing",
    description:
      "Schedule delivery windows, assign the right driver and text customers a live ETA link. Photos and signatures as proof of delivery. Try free for 30 days.",
  },
  eyebrow: "Delivery & installation",
  h1: "Every customer knows when your truck arrives.",
  lede: "Book delivery windows, assign the right driver, and text customers a live ETA link so they're home, ready and not calling the office.",
  answer: {
    q: "What should delivery dispatch software do?",
    a: "For appointment-based deliveries, dispatch software should show every order's time window on one board and assign the right driver by distance, skills and workload. When the truck leaves, it should text the customer a live ETA link and send late notices. It should also record arrival automatically and capture photos and a signature as proof of delivery.",
  },
  trade: {
    media: media("delivery"),
    proof: ["Live ETA link, no customer app", "Automatic arrival check-in within 150 m", "Photos and a signature as proof of delivery"],
    sms: { company: "Maple Home Appliances", who: "driver", tech: "Luis", eta: 17, time: "10:05 AM" },
    statsTitle: "Why the delivery window matters",
    stats: [
      {
        value: "44%",
        label: "of shoppers surveyed said their big and bulky items arrived outside the scheduled window",
        source: "DispatchTrack survey of 1,606 U.S. adults, 2022",
        href: "https://www.dispatchtrack.com/blog/big-bulky/",
      },
      {
        value: "61%",
        label: "are unlikely to buy from a retailer again after an order misses its delivery window",
        source: "DispatchTrack survey of 1,606 U.S. adults, 2022",
        href: "https://www.dispatchtrack.com/blog/big-bulky/",
      },
      {
        value: "41%",
        label: "of recipients agreed they were told their delivery was running late; after a bad delivery, only 19%",
        source: "Ryder consumer study of 1,000 U.S. recipients, 2025",
        href: "https://www.ryder.com/globalassets/media/documents/insights/white-papers/ryder-last-mile/2025-ryder-last-mile-consumer-study-ada.pdf",
      },
    ],
    day: {
      eyebrow: "A same-day delivery, start to finish",
      title: "A dead fridge, a 9–11 window and an elevator booked until 11.",
      cta: "Follow a delivery",
      steps: [
        {
          time: "7:10 a.m.",
          title: "A fridge that can't wait",
          body: "Nadia, dispatching for an appliance retailer, sees an urgent order: Mei's fridge has died. The replacement is booked for 9–11 a.m. at a third-floor condo, with the elevator reserved until 11:00 and a water-line hookup. She accepts the suggested driver, Luis, tagged for hookups.",
        },
        {
          time: "9:52 a.m.",
          title: "Late, but never silent",
          body: "A stair carry at the previous stop runs long, so Nadia sends Mei a running-late update. At 10:05 Luis taps Start Driving. Mei watches a live ETA of about 17 minutes and messages that her elevator booking ends at 11:00; Nadia sees it on the job.",
        },
        {
          time: "10:22 a.m.",
          title: "Checked in at the door",
          body: "Luis comes within 150 m of the building and is checked in automatically, and his on-site time starts. The access notes show the dock code and elevator instructions. On Mei's page, his location disappears.",
        },
        {
          time: "10:58 a.m.",
          title: "Proof of delivery",
          body: "Luis ticks the required checklist: water line leak-checked, old fridge strapped for haul-away, walkthrough done. He takes photos, Mei signs, and he taps Complete Job with two minutes left on the elevator booking.",
        },
      ],
    },
    features: {
      eyebrow: "Built for appointment deliveries",
      title: "From the booked window to the signature.",
      items: [
        { title: "Windows and access notes", body: "Each order carries its time window, priority, dock hours, gate codes and elevator bookings." },
        { title: "Live ETA, fewer calls", body: "When the driver starts driving, customers get a live ETA page and can call, text or message them. No app needed." },
        { title: "Say “late” early", body: "Send running-late updates before customers start wondering. Their replies stay on the job for the office." },
        { title: "Right driver, right truck", body: "Tag liftgate, stair-carry or hookup skills. ArrivePing suggests the best driver by distance, skills and workload." },
        { title: "Proof of delivery, built in", body: "Make walkthrough and haul-away required before the job closes, and capture photos and the customer's signature on the job." },
        { title: "Contract drivers, one board", body: "Subcontracted drivers and installers can be on several companies' rosters and still use one app." },
      ],
    },
  },
  sections: [
    {
      kind: "prose",
      eyebrow: "Fit",
      title: "Appointment deliveries, not parcel routing.",
      paragraphs: [
        "ArrivePing is at its best when each delivery or install is an appointment the customer is waiting for: a sofa, a fridge, a jobsite drop, a courier run with a promised window. It picks who goes and keeps the customer informed about when they'll arrive.",
        "It doesn't sequence hundreds of parcel stops per driver. If that's your main problem, a dedicated route optimizer such as Onfleet or Routific is the better tool.",
      ],
    },
    { kind: "trades", title: "Other trades on ArrivePing." },
  ],
  faqs: [
    {
      q: "Can customers track the delivery truck live?",
      a: "Yes. When the driver taps Start Driving, the customer gets a text linking to a live page showing who is coming and an updating ETA, with buttons to call, text or message the driver. No app or account needed. Location shows only while that delivery is under way and disappears on arrival.",
    },
    {
      q: "How do I cut down on “not home” re-deliveries?",
      a: "Give every order a time window and access notes, then let the on-the-way text send a live ETA. Falling behind? Send a running-late update. Customers can reply or call the driver from the live page, and messages stay on the job so dispatch can step in before a wasted trip.",
    },
    {
      q: "Does ArrivePing optimize routes for high-volume deliveries?",
      a: "ArrivePing is built for appointment-based deliveries: installs, white-glove and jobsite drops. It suggests the best driver for each job by distance, skills, availability and workload, on a live map. It doesn't sequence multi-stop parcel routes; parcel fleets are better served by a dedicated routing tool.",
    },
    {
      q: "How do I get proof of delivery for damage claims?",
      a: "Build job templates with checklists, such as unit inspected, walkthrough done and haul-away loaded, and make key items required before a job can be completed. Drivers take photos and collect the customer's signature on their phone. Arrival and on-site time are recorded automatically, so you have a dated record.",
    },
    {
      q: "Do my drivers need GPS trackers in the trucks?",
      a: "No. Drivers use the iPhone, iPad or Android phone they already carry to accept jobs, tap Start Driving and complete the job, and arrival check-in is automatic within 150 m. Location is shared only while they're on shift, and customers see it only while that driver is heading to them.",
    },
    priceFaq("How much does delivery scheduling software cost?", "driver", "drivers"),
  ],
  related: ["/fleet-tracking", "/on-my-way-text-software", "/compare/onfleet", "/compare/routific"],
};
