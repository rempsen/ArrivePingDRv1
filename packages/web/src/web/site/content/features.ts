/**
 * The Features page, as data. Organised around the life of one job, not a
 * feature checklist: the page reads top to bottom the way a work order does.
 */

export type FeatureTile = { icon: string; title: string; text: string };

export type Chapter = {
  id: string;
  n: string;
  label: string;
  title: string;
  promise: string;
  tiles: FeatureTile[];
};

export const featuresMeta = {
  path: "/features",
  title: "ArrivePing Features: Work Orders, Live Tracking, Auto Time & Payments",
  description:
    "Every ArrivePing feature in one place: custom work orders, GPS tracking of the drive, mileage and travel time, automatic on-site time, photos, signatures, Stripe payments, customer texts and exports.",
  summary:
    "A tour of ArrivePing features by stage of the job: create the work order, track the drive and the visit with automatic geofence time, capture the work, keep customers informed, price the job and pay your team, start with AI-built workflows, and export your data.",
};

export const hero = {
  eyebrow: "Features",
  title: "Everything a job needs, from the first call to the final payment.",
  lede: "ArrivePing follows one job the whole way: created, dispatched, driven to, worked, signed off, paid and exported. Here is what it does at each step, and what you can track.",
};

export const chapters: Chapter[] = [
  {
    id: "create",
    n: "01",
    label: "Create",
    title: "Create the work order",
    promise: "One place to describe the job, with exactly the fields your trade needs.",
    tiles: [
      { icon: "form", title: "Work orders that fit your trade", text: "Custom fields and forms, so a furnace call, a leak and a delivery each ask for what they should." },
      { icon: "catalog", title: "Add parts, time and services in a tap", text: "Pick from your catalog and the job is priced as you build it." },
      { icon: "pin", title: "Skills and location built in", text: "Each job carries the skills it needs and where it is, so assignment starts from facts." },
      { icon: "spark", title: "Assign by hand or automatically", text: "Drag a job onto a technician, or let ArrivePing offer it to the closest qualified one." },
    ],
  },
  {
    id: "track",
    n: "02",
    label: "Track",
    title: "Track the drive and the visit",
    promise: "No clocking in or out. Location does it for you, and every number is recorded against the job.",
    tiles: [
      { icon: "route", title: "The driving path", text: "The route to and from each job is recorded and saved on the job." },
      { icon: "gauge", title: "Mileage", text: "Mileage to and from the job location, calculated for you." },
      { icon: "clock", title: "Travel time", text: "How long it took to get there, on every job." },
      { icon: "fence", title: "Time on site", text: "Starts when the technician arrives and stops when they leave, using a GPS geofence around the job address." },
    ],
  },
  {
    id: "capture",
    n: "03",
    label: "Capture",
    title: "Capture the work on site",
    promise: "Everything the technician needs to finish the job, in the app they already carry.",
    tiles: [
      { icon: "camera", title: "Before, during and after photos", text: "Captured on site, following the steps of your workflow." },
      { icon: "mic", title: "Voice notes", text: "Typing is slow with gloves on. Record a note and it is added to the job record." },
      { icon: "sign", title: "Customer signature on the phone", text: "The customer signs on the technician's screen. No paper." },
      { icon: "card", title: "Take payment through Stripe", text: "Charge the customer's card on the spot, right from the job." },
    ],
  },
  {
    id: "inform",
    n: "04",
    label: "Inform",
    title: "Keep your customer in the loop",
    promise: "Your customer always knows what is happening, and it arrives under your name.",
    tiles: [
      { icon: "sms", title: "Texts at the milestones you choose", text: "Decide when customers hear from you, from booking to completion." },
      { icon: "map", title: "A tracking link with a live ETA", text: "Job details and the technician's live arrival time, on a page branded for your company." },
      { icon: "phone", title: "Call or text the technician", text: "If the customer needs something, the options are on the same page." },
      { icon: "mail", title: "Branded confirmation and completion emails", text: "Sent from your company, for the appointment and again when the job is done." },
    ],
  },
  {
    id: "price",
    n: "05",
    label: "Price & pay",
    title: "Price the job and pay your people",
    promise: "Charge the way you do business, and record how every driver and technician is paid.",
    tiles: [
      { icon: "catalog", title: "A catalog ready on day one", text: "Parts, time, services and assemblies (combinations of them) are pre-filled. Edit, delete or add your own." },
      { icon: "calc", title: "Pricing logic that fits your rules", text: "A service fee that includes the first hour, with charges after that. You set the rules." },
      { icon: "wallet", title: "Pay by hour, by mileage, or both", text: "Set how each driver or technician is paid. ArrivePing records each method." },
    ],
  },
  {
    id: "start",
    n: "06",
    label: "Start smart",
    title: "Start with your business already set up",
    promise: "You do not begin with a blank screen.",
    tiles: [
      { icon: "spark", title: "Four AI-built workflows", text: "Everyone who signs up gets at least four workflows generated from their own website." },
      { icon: "book", title: "18 industries of know-how", text: "Best practices and workflows from the NVC360 and ArrivePing research on 18 industries, built in." },
    ],
  },
  {
    id: "own",
    n: "07",
    label: "Own",
    title: "Your data, your team",
    promise: "Take your data wherever you need it, and run a crew that works for more than one company.",
    tiles: [
      { icon: "export", title: "Export everything", text: "CSV, Excel, PDF and JSON, ready to import into any of your other tools." },
      { icon: "swap", title: "Subcontractors, handled", text: "A technician can work for you and for other companies. They choose which company they are working for each time they open the app." },
    ],
  },
];

export const milestones = [
  { key: "booked", label: "Booked", when: "When the job is scheduled", text: "Hi Dana, your appointment with Prairie Heating & Cooling is confirmed for Tuesday between 9 and 11 am." },
  { key: "route", label: "On the way", when: "When the technician heads out", text: "Jordan is on the way and will arrive in about 18 minutes. Follow along live:" },
  { key: "near", label: "Almost there", when: "A few minutes out", text: "Jordan is 3 minutes away." },
  { key: "done", label: "Complete", when: "When the job is closed", text: "All done. Thanks, Dana. Your job summary and receipt are here:" },
] as const;

export const exportFormats = ["CSV", "Excel", "PDF", "JSON"] as const;

export const workflows = ["Emergency call-out", "Quote to booked job", "Seasonal service reminder", "Follow-up and review request"];
