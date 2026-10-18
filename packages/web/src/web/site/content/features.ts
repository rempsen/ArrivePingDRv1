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

export const exportFormats = ["CSV", "Excel", "PDF", "JSON"] as const;

/**
 * Real screens from the ArrivePing app, captured from the demo company
 * (tools/dispatch-demo.ts --showcase) at 2x: one finished rooftop AC call with
 * its driven route, photos, signature, voice note, price and tech pay.
 * `span` is the share of a 12-column row the screen takes on desktop.
 */
export type Screen = {
  src: string;
  w: number;
  h: number;
  alt: string;
  caption: string;
  span: 4 | 5 | 6 | 7 | 8 | 12;
  phone?: boolean;
};

const S = (name: string) => `/img/site/features/app-${name}.webp`;

export const screens: Record<string, Screen[]> = {
  create: [
    { src: S("create-materials"), w: 1800, h: 410, span: 12, alt: "Products and materials on an ArrivePing work order: a condenser fan motor, a run capacitor and 2 lb of R-410A refrigerant, priced from the catalog with the margin shown.", caption: "Work order: parts and materials added from the catalog, with cost and margin." },
    { src: S("create-catalog"), w: 1800, h: 866, span: 12, alt: "The ArrivePing catalog with 36 services, products and assemblies, grouped by category, each with cost, price and margin.", caption: "Catalog: pre-filled for HVAC, with services, products and assemblies you can edit, add or remove." },
  ],
  track: [
    { src: S("track-report"), w: 1520, h: 1216, span: 7, alt: "An ArrivePing job report showing the timeline, a 14 minute drive, 1 hour 25 minutes on site, 10.7 km of mileage and the road-matched route driven there and back on a map.", caption: "Job report: drive time, time on site, mileage and the route driven there and back." },
    { src: S("track-geofence"), w: 1130, h: 644, span: 5, alt: "ArrivePing Geofencing settings with the auto-arrive radius set to 150 meters.", caption: "Settings: each company sets its own auto-arrive radius." },
  ],
  capture: [
    { src: S("capture-signoff"), w: 1800, h: 505, span: 12, alt: "The job record showing the customer's drawn signature and a 12 second voice note from the technician with its transcript.", caption: "Job record: the customer's signature and the technician's voice note, transcribed." },
  ],
  inform: [
    { src: S("inform-phone"), w: 1170, h: 1920, span: 4, phone: true, alt: "The ArrivePing customer tracking page on a phone: a live map, the technician's arrival countdown, and Call and Text buttons.", caption: "What your customer sees: live ETA, map, and Call or Text." },
    { src: S("inform-rules"), w: 1800, h: 927, span: 8, alt: "ArrivePing notification rules: for each job event, toggles for in-app, email, text and webhook to the customer, technician and office.", caption: "Notification rules: choose which milestones text, email or notify whom." },
  ],
  price: [
    { src: S("price-rate"), w: 1172, h: 670, span: 7, alt: "ArrivePing pricing and rate model set to per hour: first hour $150, each hour after $90.", caption: "Pricing rule: $150 covers the first hour, then $90 an hour." },
    { src: S("price-job"), w: 744, h: 780, span: 5, alt: "The pricing on a finished ArrivePing job: parts, subtotal $570.90, GST and PST, total $639.41 paid, and technician pay of $53.96.", caption: "The finished job: billed from actual time and parts, paid, with tech pay." },
    { src: S("price-payouts"), w: 1800, h: 802, span: 12, alt: "ArrivePing technician payouts for the week: each technician's jobs, time on site, hourly pay and total, with one job's breakdown expanded.", caption: "Payouts: every technician's time and pay, job by job." },
  ],
  start: [
    { src: S("start-templates"), w: 560, h: 1056, span: 4, alt: "Saved work-order templates in ArrivePing: Residential Visit, Commercial Job, Service / Maintenance and Emergency / Rush Call.", caption: "Your first four workflows, created when you sign up." },
  ],
  own: [
    { src: S("own-export"), w: 364, h: 460, span: 4, alt: "The ArrivePing reports Export menu: CSV, Excel, JSON and PDF.", caption: "Every report exports to CSV, Excel, JSON or PDF." },
    { src: S("own-raw"), w: 1796, h: 438, span: 8, alt: "ArrivePing raw data exports for jobs, technicians, customers and invoices, each as CSV, XLSX, JSON or PDF.", caption: "Raw data: jobs, technicians, customers and invoices." },
  ],
};

/**
 * The finished call in the screens above, photographed at each stage. Real
 * photographs from one rooftop AC shoot by José Andrés Pacheco Cortes on Pexels
 * (Pexels License: free for commercial use, edits allowed; we credit anyway):
 * before https://www.pexels.com/photo/5463587/, during /5463580/, after /5463579/.
 * Cropped and graded like the trade photos; the unit's maker logo, a shop sign
 * and the leak detector's brand are blurred so no brand appears to endorse us.
 */
export const jobPhotos = [
  { stage: "Before", src: "/img/site/features/job-before", caption: "RTU-1 as found, access panel off", time: "9:38 AM" },
  { stage: "During", src: "/img/site/features/job-during", caption: "Leak check on the condenser coil", time: "10:15 AM" },
  { stage: "After", src: "/img/site/features/job-after", caption: "Pressures back in range after the recharge", time: "10:53 AM" },
] as const;

/**
 * The 18 industries with researched best practices and pre-built workflows,
 * mirrored from services/industry-presets.ts (core and specialty presets, not
 * the alias rows). A test keeps the two in step.
 */
export type Industry = { id: string; label: string; group: string; workflows: string[] };
export const industries: Industry[] = [
  { id: "home-builder-developer", label: "Home Building & Development", group: "Building & Renovation", workflows: ["Selections & Options Sale", "Change Order", "Possession Walkthrough", "Warranty Service Call", "Milestone Update"] },
  { id: "painting-decorating", label: "Painting & Decorating", group: "Building & Renovation", workflows: ["Residential Repaint Estimate", "Builder Production Job", "Colour Schedule Sign-Off", "Touch-Up / Punch List", "Warranty Check-In"] },
  { id: "design-build", label: "Design-Build Renovations & Additions", group: "Building & Renovation", workflows: ["Design Agreement / Retainer", "Selections Board Update", "Change Order", "Draw Milestone Invoice", "Closeout & Warranty Survey"] },
  { id: "renovation-contractor", label: "Home Renovation & General Contracting", group: "Building & Renovation", workflows: ["Fixed-Price Estimate with Allowances", "Change Order", "Draw Milestone Invoice", "Site-Ready-for-Trade Notice", "Punch List & Closeout"] },
  { id: "flooring", label: "Flooring", group: "Building & Renovation", workflows: ["Flooring Estimate & Options Catalog", "Ready-to-Schedule Gate", "Builder Program Job", "Quote-to-PO"] },
  { id: "concrete-foundation-repair", label: "Concrete & Foundation Repair", group: "Building & Renovation", workflows: ["Tiered Pier/Waterproofing Quote", "Structural Inspection Report", "Engineer Sign-Off Gate", "Flatwork Estimate"] },
  { id: "garage-door", label: "Garage Doors", group: "Building & Renovation", workflows: ["Door Configurator Quote", "Emergency Repair Dispatch", "Annual Tune-Up", "Builder Site-Readiness Confirm"] },
  { id: "electrical", label: "Electrical", group: "Mechanical & Electrical Trades", workflows: ["Service & Repair", "Builder Rough-In / Upgrade Catalogue", "Permit & Inspection", "Emergency Power Restore"] },
  { id: "exteriors", label: "Roofing, Siding & Exteriors", group: "Mechanical & Electrical Trades", workflows: ["Three-Tier Material Proposal", "Storm Damage Inspection", "Weather-Hold Reschedule", "Production Board Job"] },
  { id: "hvac-plumbing", label: "HVAC & Plumbing", group: "Mechanical & Electrical Trades", workflows: ["Emergency Dispatch", "Maintenance / Membership Visit", "Installation Work Order", "Builder Install Quote", "After-Hours Escalation"] },
  { id: "landscaping-grounds-snow", label: "Landscaping & Snow Removal", group: "Grounds, Snow & Trees", workflows: ["Seasonal Maintenance Contract", "Storm/Snow Dispatch", "Proof-of-Service Visit", "Fence & Deck Estimate"] },
  { id: "tree-care", label: "Tree Care & Arborist Services", group: "Grounds, Snow & Trees", workflows: ["Per-Tree Tiered Quote", "Compliance Calendar Job (Elm Ban / EAB)", "PHC Program Visit", "Storm Damage Response"] },
  { id: "commercial-building-maintenance", label: "Commercial Building Maintenance Contractor", group: "Facilities & Property Management", workflows: ["SLA Work Order", "Recurring PM Generation", "NTE Approval Request", "QBR Client Report"] },
  { id: "property-management-maintenance", label: "Property Manager \u2014 Maintenance Operations", group: "Facilities & Property Management", workflows: ["Work Order Intake & Triage", "Owner Approval (NTE)", "Unit Turn Checklist", "Vendor COI Compliance"] },
  { id: "equipment-rental", label: "Equipment & Tool Rental", group: "Specialty services", workflows: ["Reservation & Quote", "Delivery/Pickup Dispatch", "Off-Rent Inspection"] },
  { id: "restoration", label: "Fire & Flood Restoration", group: "Specialty services", workflows: ["Emergency Response", "Mitigation → Rebuild Handoff", "Drying Log", "Deductible / AR Chase"] },
  { id: "sports-organization", label: "Sports Clubs & Academies", group: "Specialty services", workflows: ["Session Schedule", "Program Calendar", "Coach Certification Tracking"] },
  { id: "childcare-babysitting", label: "Childcare & Babysitting", group: "Care & Family Services", workflows: ["Babysitting Booking", "Family Intake & Meet-and-Greet", "Care Notes & Handoff Report", "Recurring Care Schedule", "Incident / Health Report"] },
];
