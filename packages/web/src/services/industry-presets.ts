// Industry (ICP) presets — the single source of truth for every supported
// client type. Drives: New Company dropdown, service-library seeding,
// work-order template generation, Form Builder default categories, AI-agent
// tone/terminology guidance, and notification defaults.
//
// SOURCE OF RECORD (2026-07-28): this list is NOT an ad-hoc pilot — it is a
// direct reconciliation against NVC 360's real, business-validated ICP
// research program:
//   - Supabase project `nvc360-icp-intelligence` (ref baqduvribxicrzalwycb)
//   - Notion "ICP Intelligence — Industry Reporting" (ICP Registry database)
//   - Google Drive `Claude Projects/NVC360-Hub/ICPs/` — 17 per-ICP research
//     lanes (01-Industry-Overview / 02-Associations-and-Sources /
//     03-Workflows-and-Best-Practices / 04-NVC360-App-Customization),
//     approved by Dan 2026-07-27, Phase 1 ranking + Phase 3 cross-ICP
//     synthesis documents.
// Every `id` below is the exact `icps.slug` from that program. Do not rename
// slugs without updating Supabase + Notion + this file together.
//
// 13 core ICPs (workflow shape is product-ready today) + 4 outliers
// (structural blocker exists — see each preset's `tier`/notes) + 6 alias
// rows that route to a core ICP's template for dropdown clarity without
// becoming a 18th/19th ICP. The "Other / General Home Services" catch-all
// is a hardcoded dropdown option in the New Company form, not a preset row.
//
// This is the foundation for deeper per-ICP customization: the goal is that
// once a tenant identifies their website + company name + ICP, the whole
// platform (starter templates, staff/customer terminology, default
// notification behavior, generated intake forms) adapts to THEM instead of
// making them adapt to a one-size-fits-all tool.

export type IndustryPreset = {
  id: string; // slug stored on companies.industry — matches icps.slug in Supabase
  label: string; // human label in dropdowns — matches icps.signup_dropdown_label
  group: string; // dropdown section grouping, e.g. "Building & Renovation"
  tier: "core" | "outlier" | "alias"; // core = beta-ready; outlier = structural blocker (see rationale); alias = routes to another ICP's template for a clearer signup label
  rank?: number; // Phase 1 ranking (1-17), lower = higher fit
  fitScore?: number; // Phase 1 weighted fit score (0-10)
  aliasOf?: string; // set on tier: "alias" rows — the real ICP id this routes to
  rationale?: string; // one-line "why this ICP" from Phase 1 research, shown to superadmins
  /** Tenant-SAFE honesty note for outlier ICPs — what ArrivePing covers well for
   * this trade today and what it deliberately doesn't. Fed to the onboarding
   * concierge so it sets expectations instead of over-promising. `rationale`
   * above is internal (GTM language) and must never reach a tenant. */
  fitNote?: string;
  // Terminology — relabels the app for this tenant. Singular + plural so
  // copy reads naturally. workerNoun already flows through useWorkerNoun();
  // customerNoun/jobNoun are newer and currently apply to the same dynamic
  // surfaces (a full app-wide reskin is a larger follow-on pass).
  workerNoun: string; // e.g. "Technician", "Superintendent", "Crew Lead"
  workerNounPlural: string;
  customerNoun: string; // e.g. "Customer", "Buyer", "Client", "Homeowner"
  customerNounPlural: string;
  jobNoun: string; // e.g. "Job", "Project", "Visit"
  jobNounPlural: string;
  // Short guidance string fed into AI generation prompts (template-scout,
  // form-scout, notification copy) so tone matches how this industry
  // actually talks to its customers.
  aiTone: string;
  // Short guidance surfaced as a hint in the Notifications config UI —
  // what's normal to default on/off for this kind of business.
  notificationGuidance: string;
  // Service library seeded on company create (schema.services rows).
  services: { name: string; category: string; durationMins: number }[];
  // Suggested work-order template names (drives template-scout primary intent).
  templates: string[];
  // Default Form Builder categories (first = default).
  categories: string[];
};

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  // ───────────────────────── Building & Renovation ─────────────────────────
  {
    id: "home-builder-developer",
    label: "Home Building & Development",
    group: "Building & Renovation",
    tier: "core",
    rank: 1,
    fitScore: 9.3,
    rationale:
      "The only ICP validated by delivered revenue (Karma/Glendale, $25K). Options/upgrade pricing is the wedge — buyers on a visual design studio spend ~35% more on upgrades.",
    workerNoun: "Superintendent",
    workerNounPlural: "Superintendents",
    customerNoun: "Buyer",
    customerNounPlural: "Buyers",
    jobNoun: "Project",
    jobNounPlural: "Projects",
    aiTone:
      "Confident and milestone-driven. Buyers are making the biggest purchase of their life — be precise about dates, options pricing, and what happens next. Never bury a cutoff deadline in fine print.",
    notificationGuidance:
      "Speed-to-lead alerts, selection deadline reminders, and milestone photo updates are default-on. Warranty request aging (7/14 days) should escalate — that's where service complaints turn into disputes.",
    services: [
      { name: "Structural Options Consultation", category: "Selections", durationMins: 90 },
      { name: "Design-Studio Colour & Finish Selections", category: "Selections", durationMins: 120 },
      { name: "Pre-Possession Walkthrough", category: "Handoff", durationMins: 90 },
      { name: "Possession-Day Handoff", category: "Handoff", durationMins: 60 },
      { name: "Warranty Service Call", category: "Warranty", durationMins: 90 },
      { name: "Change Order Site Visit", category: "Change Orders", durationMins: 60 },
    ],
    templates: [
      "Selections & Options Sale",
      "Change Order",
      "Possession Walkthrough",
      "Warranty Service Call",
      "Milestone Update",
    ],
    categories: ["Selections", "Change Orders", "Scheduling", "Warranty"],
  },
  {
    id: "painting-decorating",
    label: "Painting & Decorating",
    group: "Building & Renovation",
    tier: "core",
    rank: 2,
    fitScore: 8.2,
    rationale:
      "Direct customer signal (Valour Decorating). Huge, hyper-fragmented trade where incumbents win the quote but are weak on scheduling, crew dispatch, and builder-facing B2B workflows.",
    workerNoun: "Painter",
    workerNounPlural: "Painters",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Warm and detail-confident. Customers are picking colours they'll live with for years — reassure on the plan (surfaces, coats, colour schedule) and be upfront about weather-driven exterior scheduling.",
    notificationGuidance:
      "Estimate follow-up nudges (48h/5d/10d) are the single biggest close-rate lever — keep them on. Weather reschedule alerts matter for exterior work; stage-complete updates (prep/prime/coat/touch-up) cut 'when will you be done' calls.",
    services: [
      { name: "Interior Repaint", category: "Painting", durationMins: 240 },
      { name: "Exterior Repaint", category: "Painting", durationMins: 300 },
      { name: "Cabinet Refinishing", category: "Painting", durationMins: 240 },
      { name: "Colour Consultation", category: "Selections", durationMins: 60 },
      { name: "Builder Production Painting", category: "Builder Work", durationMins: 240 },
      { name: "Touch-Up / Punch List", category: "Closeout", durationMins: 90 },
    ],
    templates: [
      "Residential Repaint Estimate",
      "Builder Production Job",
      "Colour Schedule Sign-Off",
      "Touch-Up / Punch List",
      "Warranty Check-In",
    ],
    categories: ["Painting", "Selections", "Builder Work", "Closeout"],
  },
  {
    id: "design-build",
    label: "Design-Build Renovations & Additions",
    group: "Building & Renovation",
    tier: "core",
    rank: 3,
    fitScore: 8.0,
    rationale:
      "Live pipeline revenue (SMLXL Projects onboarding). Design-led, single-contract firm doing renovations/additions/design-managed projects — near-total overlap with the selections/allowances engine.",
    workerNoun: "Production Manager",
    workerNounPlural: "Production Managers",
    customerNoun: "Client",
    customerNounPlural: "Clients",
    jobNoun: "Project",
    jobNounPlural: "Projects",
    aiTone:
      "Design-forward and consultative. Clients are making dozens of decisions across a design phase before a hammer swings — narrate progress through phase gates, not just task lists.",
    notificationGuidance:
      "Selection deadline reminders and weekly client update digests are the highest-leverage CX practice — default on. Change orders must require signature before work proceeds; draw milestone alerts protect cash flow.",
    services: [
      { name: "Design Consultation", category: "Design", durationMins: 90 },
      { name: "Selections Session", category: "Selections", durationMins: 90 },
      { name: "Site Walk & Handoff", category: "Handoff", durationMins: 60 },
      { name: "Construction Milestone Review", category: "Construction", durationMins: 60 },
      { name: "Closeout Walkthrough", category: "Closeout", durationMins: 90 },
    ],
    templates: [
      "Design Agreement / Retainer",
      "Selections Board Update",
      "Change Order",
      "Draw Milestone Invoice",
      "Closeout & Warranty Survey",
    ],
    categories: ["Design", "Selections", "Change Orders", "Billing"],
  },
  {
    id: "renovation-contractor",
    label: "Home Renovation & General Contracting",
    group: "Building & Renovation",
    tier: "core",
    rank: 8,
    fitScore: 6.9,
    rationale:
      "The named volume ICP for the purchased Winnipeg lead list with live outbound motion. Build-only GC executing owner/designer-specified scopes — allowances map directly onto the options engine.",
    workerNoun: "Site Lead",
    workerNounPlural: "Site Leads",
    customerNoun: "Homeowner",
    customerNounPlural: "Homeowners",
    jobNoun: "Project",
    jobNounPlural: "Projects",
    aiTone:
      "Plain-spoken and reassuring under pressure. Most renovation clients have never managed a multi-week project before — be explicit about what's happening this week and what's next, and flag allowance overages before they become invoice surprises.",
    notificationGuidance:
      "Change-order-required-before-work should default ON. Selection deadline reminders, draw invoice/payment reminders, and margin slippage alerts (owner-facing) are core to this ICP's economics.",
    services: [
      { name: "Kitchen Remodel", category: "Projects", durationMins: 120 },
      { name: "Bathroom Remodel", category: "Projects", durationMins: 120 },
      { name: "Basement Development", category: "Projects", durationMins: 120 },
      { name: "Home Addition", category: "Projects", durationMins: 120 },
      { name: "Change Order Site Visit", category: "Change Orders", durationMins: 60 },
      { name: "Punch List Walkthrough", category: "Closeout", durationMins: 90 },
    ],
    templates: [
      "Fixed-Price Estimate with Allowances",
      "Change Order",
      "Draw Milestone Invoice",
      "Site-Ready-for-Trade Notice",
      "Punch List & Closeout",
    ],
    categories: ["Projects", "Selections & Allowances", "Change Orders", "Billing"],
  },
  {
    id: "flooring",
    label: "Flooring",
    group: "Building & Renovation",
    tier: "core",
    rank: 10,
    fitScore: 6.7,
    rationale:
      "Flooring is the #1 buyer-upgrade category in new homes — same ecosystem as Karma/Glendale. No incumbent does builder-linked options; vertical ERPs (QFloors, RFMS) are retail-focused, not installer-focused.",
    workerNoun: "Installer",
    workerNounPlural: "Installers",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Practical and material-literate. Customers are choosing between carpet/LVP/hardwood tiers — confirm measurements, material lead times, and site-readiness (moisture, subfloor) before locking a schedule date.",
    notificationGuidance:
      "Material-received / ready-to-schedule alerts prevent wasted crew trips. Aged-quote follow-up (48h/7d/21d) matters — flooring quotes go cold fast.",
    services: [
      { name: "Flooring Estimate & Measure", category: "Estimating", durationMins: 60 },
      { name: "Carpet Installation", category: "Installation", durationMins: 180 },
      { name: "LVP / Laminate Installation", category: "Installation", durationMins: 240 },
      { name: "Hardwood Installation", category: "Installation", durationMins: 300 },
      { name: "Builder Program Installation", category: "Builder Work", durationMins: 240 },
    ],
    templates: [
      "Flooring Estimate & Options Catalog",
      "Ready-to-Schedule Gate",
      "Builder Program Job",
      "Quote-to-PO",
    ],
    categories: ["Estimating", "Installation", "Builder Work"],
  },
  {
    id: "concrete-foundation-repair",
    label: "Concrete & Foundation Repair",
    group: "Building & Renovation",
    tier: "core",
    rank: 13,
    fitScore: 7.3,
    rationale:
      "Re-scored from provisional 6.3 to 7.3 (core, non-provisional) after a dedicated market scan — Winnipeg's expansive clay soil makes this one of the densest local trades. High-ticket, estimate-centric with natural good/better/best tiers (piering, waterproofing, finish).",
    workerNoun: "Crew Lead",
    workerNounPlural: "Crew Leads",
    customerNoun: "Homeowner",
    customerNounPlural: "Homeowners",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Technical but plain-English. Foundation issues scare homeowners — explain the inspection finding, the tiered fix options, and the engineer sign-off step clearly before pricing.",
    notificationGuidance:
      "Deposit-on-acceptance and aged-quote nudges are standard. Telepost/pier anniversary outreach is a good recurring-revenue notification once warranty periods exist.",
    services: [
      { name: "Structural Inspection", category: "Inspection", durationMins: 90 },
      { name: "Piering / Underpinning", category: "Foundation Repair", durationMins: 240 },
      { name: "Basement Waterproofing", category: "Waterproofing", durationMins: 240 },
      { name: "Driveway / Garage Pad Pour", category: "Flatwork", durationMins: 240 },
      { name: "Weeping Tile Repair", category: "Waterproofing", durationMins: 180 },
    ],
    templates: [
      "Tiered Pier/Waterproofing Quote",
      "Structural Inspection Report",
      "Engineer Sign-Off Gate",
      "Flatwork Estimate",
    ],
    categories: ["Inspection", "Foundation Repair", "Waterproofing", "Flatwork"],
  },
  {
    id: "garage-door",
    label: "Garage Doors",
    group: "Building & Renovation",
    tier: "core",
    rank: 11,
    fitScore: 6.6,
    rationale:
      "The options/upgrade engine transfers almost verbatim from Glendale (door model, insulation R-value, window inserts, opener tiers). No incumbent between generic Jobber and 20+-tech ServiceTitan.",
    workerNoun: "Technician",
    workerNounPlural: "Technicians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Fast and reassuring — a broken garage door is often a security or access emergency. Confirm ETA quickly and explain tiered door/opener options clearly on install quotes.",
    notificationGuidance:
      "Emergency-board after-hours surcharge alerts and annual tune-up reminders (11-month) are good defaults. Builder site-readiness confirmations matter for new-construction installs.",
    services: [
      { name: "Garage Door Installation", category: "Installation", durationMins: 180 },
      { name: "Emergency Repair", category: "Repair", durationMins: 90 },
      { name: "Opener Installation", category: "Installation", durationMins: 90 },
      { name: "Annual Tune-Up", category: "Maintenance", durationMins: 60 },
      { name: "Builder New-Construction Install", category: "Builder Work", durationMins: 180 },
    ],
    templates: [
      "Door Configurator Quote",
      "Emergency Repair Dispatch",
      "Annual Tune-Up",
      "Builder Site-Readiness Confirm",
    ],
    categories: ["Installation", "Repair", "Maintenance", "Builder Work"],
  },

  // ───────────────────────── Mechanical & Electrical Trades ─────────────────────────
  {
    id: "electrical",
    label: "Electrical",
    group: "Mechanical & Electrical Trades",
    tier: "core",
    rank: 4,
    fitScore: 7.6,
    rationale:
      "Largest firm count of any trade researched; strongest builder-ecosystem tie-in (pot lights, EV chargers, panel upgrades are the exact Karma/Glendale options-pricing workflow).",
    workerNoun: "Electrician",
    workerNounPlural: "Electricians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Safety-first and precise. Electrical work makes people nervous about fire/shock risk — be explicit about what was fixed, what's now safe, and permit/inspection status.",
    notificationGuidance:
      "Safety inspection reminders and permit inactivity alerts are good defaults. After-hours escalation recommended for power-outage calls; holdback release on final inspection matters for builder-sub work.",
    services: [
      { name: "Panel Upgrade", category: "Electrical", durationMins: 240 },
      { name: "Outlet & Switch Repair", category: "Electrical", durationMins: 60 },
      { name: "Lighting Installation", category: "Electrical", durationMins: 120 },
      { name: "EV Charger Install", category: "Electrical", durationMins: 180 },
      { name: "Electrical Inspection", category: "Electrical", durationMins: 90 },
      { name: "Builder Rough-In", category: "Builder Work", durationMins: 240 },
    ],
    templates: [
      "Service & Repair",
      "Builder Rough-In / Upgrade Catalogue",
      "Permit & Inspection",
      "Emergency Power Restore",
    ],
    categories: ["Electrical", "Builder Work", "Permits & Inspections", "Emergency"],
  },
  {
    id: "exteriors",
    label: "Roofing, Siding & Exteriors",
    group: "Mechanical & Electrical Trades",
    tier: "core",
    rank: 5,
    fitScore: 7.3,
    rationale:
      "Merged roofing + siding + soffit/fascia/eavestrough. Material-tier/colour/trim/shingle-grade options quoting is the closest analogue anywhere to the Karma-proven upgrade engine.",
    workerNoun: "Crew Lead",
    workerNounPlural: "Crew Leads",
    customerNoun: "Homeowner",
    customerNounPlural: "Homeowners",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Confident and weather-aware. Roofing/siding customers worry about leaks and cost surprises — present tiered material options clearly and communicate weather-hold delays proactively.",
    notificationGuidance:
      "Weather-hold notices and 5-minute unclaimed-lead alerts are high priority (storm-driven demand is time-sensitive). Review requests on close are the reputation loop for this trade.",
    services: [
      { name: "Roof Replacement", category: "Roofing", durationMins: 240 },
      { name: "Siding Installation", category: "Siding", durationMins: 240 },
      { name: "Eavestrough / Soffit / Fascia", category: "Exteriors", durationMins: 180 },
      { name: "Storm Damage Inspection", category: "Inspection", durationMins: 60 },
      { name: "Window & Door Installation", category: "Windows & Doors", durationMins: 180 },
    ],
    templates: [
      "Three-Tier Material Proposal",
      "Storm Damage Inspection",
      "Weather-Hold Reschedule",
      "Production Board Job",
    ],
    categories: ["Roofing", "Siding", "Exteriors", "Inspection"],
  },
  {
    id: "hvac-plumbing",
    label: "HVAC & Plumbing",
    group: "Mechanical & Electrical Trades",
    tier: "core",
    rank: 6,
    fitScore: 7.2,
    rationale:
      "Highest proven willingness-to-pay of any trade. Win on the builder-sub wedge (furnace/AC/HRV tiers tied to builder schedules) and the $1-5M 'outgrew Jobber, priced out of ServiceTitan' middle.",
    workerNoun: "Technician",
    workerNounPlural: "Technicians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Direct, reassuring, and urgency-aware — HVAC/plumbing customers are often uncomfortable (too hot/cold) or dealing with active water damage. Lead with ETA and a clear fix, not jargon.",
    notificationGuidance:
      "SMS on-the-way + arrival alerts are high value (comfort/water emergencies). Membership failed-payment and season-flip PM reminders are good recurring-revenue notifications.",
    services: [
      { name: "Furnace Repair", category: "HVAC", durationMins: 90 },
      { name: "AC Repair", category: "HVAC", durationMins: 90 },
      { name: "Seasonal Maintenance / Membership Visit", category: "HVAC", durationMins: 60 },
      { name: "Leak Repair", category: "Plumbing", durationMins: 90 },
      { name: "Water Heater Install", category: "Plumbing", durationMins: 180 },
      { name: "Emergency Burst Pipe", category: "Plumbing", durationMins: 120 },
    ],
    templates: [
      "Emergency Dispatch",
      "Maintenance / Membership Visit",
      "Installation Work Order",
      "Builder Install Quote",
      "After-Hours Escalation",
    ],
    categories: ["HVAC", "Plumbing", "Maintenance", "Emergency"],
  },

  // ───────────────────────── Grounds, Snow & Trees ─────────────────────────
  {
    id: "landscaping-grounds-snow",
    label: "Landscaping & Snow Removal",
    group: "Grounds, Snow & Trees",
    tier: "core",
    rank: 7,
    fitScore: 7.1,
    rationale:
      "Probably the single best local-density story NVC 360 has. Storm-triggered 3am dispatch, per-push/seasonal billing, and proof-of-service notifications are exactly NVC 360's strengths.",
    workerNoun: "Crew Lead",
    workerNounPlural: "Crew Leads",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Visit",
    jobNounPlural: "Visits",
    aiTone:
      "Reliable and proof-driven. Customers want to know the job got done (driveway cleared, lawn mowed) without watching it happen — lead notifications with timestamped photo proof.",
    notificationGuidance:
      "Storm/season toggle drives everything — manual storm-mode declaration for now. Proof-of-service photo notifications on completion are core; per-push auto-billing on storm events is a strong default.",
    services: [
      { name: "Lawn Maintenance Visit", category: "Landscaping", durationMins: 60 },
      { name: "Snow Plow / Clear", category: "Snow Removal", durationMins: 45 },
      { name: "Spring / Fall Cleanup", category: "Landscaping", durationMins: 120 },
      { name: "Irrigation Startup / Blowout", category: "Irrigation", durationMins: 60 },
      { name: "Fence / Deck Install", category: "Outdoor Structures", durationMins: 240 },
    ],
    templates: [
      "Seasonal Maintenance Contract",
      "Storm/Snow Dispatch",
      "Proof-of-Service Visit",
      "Fence & Deck Estimate",
    ],
    categories: ["Landscaping", "Snow Removal", "Irrigation", "Outdoor Structures"],
  },
  {
    id: "tree-care",
    label: "Tree Care & Arborist Services",
    group: "Grounds, Snow & Trees",
    tier: "core",
    rank: 12,
    fitScore: 6.5,
    rationale:
      "The sleeper pick — less incumbent saturation than any other green-industry vertical. Winnipeg's Dutch Elm Disease program and elm pruning ban create recurring, compliance-windowed work.",
    workerNoun: "Arborist",
    workerNounPlural: "Arborists",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Knowledgeable and safety-conscious. Tree work is inherently risky-looking to homeowners — explain the removal/prune/cable options and any regulatory windows (elm ban, EAB) plainly.",
    notificationGuidance:
      "Aged-quote nudges matter (per-tree quotes go cold). Compliance-calendar alerts (elm ban Apr 1-Jul 31, PHC treatment due) should be default-on for Manitoba tenants.",
    services: [
      { name: "Tree Removal", category: "Tree Care", durationMins: 180 },
      { name: "Pruning / Trimming", category: "Tree Care", durationMins: 120 },
      { name: "Cabling & Bracing", category: "Tree Care", durationMins: 120 },
      { name: "Plant Health Care Treatment", category: "PHC", durationMins: 60 },
      { name: "Stump Grinding", category: "Tree Care", durationMins: 90 },
    ],
    templates: [
      "Per-Tree Tiered Quote",
      "Compliance Calendar Job (Elm Ban / EAB)",
      "PHC Program Visit",
      "Storm Damage Response",
    ],
    categories: ["Tree Care", "PHC Programs", "Compliance"],
  },

  // ───────────────────────── Facilities & Property Management ─────────────────────────
  {
    id: "commercial-building-maintenance",
    label: "Commercial Building Maintenance Contractor",
    group: "Facilities & Property Management",
    tier: "core",
    rank: 9,
    fitScore: 6.8,
    rationale:
      "Best capability-plus-white-space combination of any zero-signal vertical. Recurring multi-site scheduling, SLA dispatch, and PM-approval loops are squarely NVC 360-shaped.",
    workerNoun: "Technician",
    workerNounPlural: "Technicians",
    customerNoun: "Site Contact",
    customerNounPlural: "Site Contacts",
    jobNoun: "Work Order",
    jobNounPlural: "Work Orders",
    aiTone:
      "Professional and SLA-aware. Property managers care about response time against contract terms and proof the work happened — lead with SLA status, not small talk.",
    notificationGuidance:
      "SLA-breach warning at 75% elapsed is critical. Recurring PM-generation reminders and proof-of-service checklists (invisible work is the #1 churn driver) should be default-on.",
    services: [
      { name: "Recurring PM Visit", category: "Preventive Maintenance", durationMins: 90 },
      { name: "Work Order — General Repair", category: "Work Orders", durationMins: 90 },
      { name: "Emergency SLA Dispatch", category: "Emergency", durationMins: 90 },
      { name: "Site Inspection", category: "Inspection", durationMins: 60 },
    ],
    templates: [
      "SLA Work Order",
      "Recurring PM Generation",
      "NTE Approval Request",
      "QBR Client Report",
    ],
    categories: ["Work Orders", "Preventive Maintenance", "Emergency", "Inspection"],
  },
  {
    id: "property-management-maintenance",
    label: "Property Manager — Maintenance Operations",
    group: "Facilities & Property Management",
    tier: "outlier",
    rank: 15,
    fitScore: 6.2,
    rationale:
      "Outlier: displacement of PM accounting suites (Yardi/AppFolio/Buildium) is blocked by trust accounting/leasing needs. Play the maintenance-ops/work-order layer beside the accounting suite, never replace it.",
    fitNote:
      "ArrivePing is the maintenance-operations layer: tenant work-order intake, vendor dispatch, unit turns, owner NTE approvals and vendor COI tracking. It is NOT a property-management accounting suite \u2014 rent roll, trust accounting, leasing and tenant ledgers stay in Yardi/AppFolio/Buildium and ArrivePing sits beside them.",
    workerNoun: "Vendor",
    workerNounPlural: "Vendors",
    customerNoun: "Tenant",
    customerNounPlural: "Tenants",
    jobNoun: "Work Order",
    jobNounPlural: "Work Orders",
    aiTone:
      "Calm and process-driven. Tenants are often frustrated when they submit a maintenance request — acknowledge fast, set a realistic timeline, and confirm completion clearly.",
    notificationGuidance:
      "Work-order-received acknowledgment and NTE-exceeded owner-approval alerts are core. COI/credential expiry reminders (vendor compliance) should be default-on.",
    services: [
      { name: "Unit Turn", category: "Unit Turns", durationMins: 120 },
      { name: "Work Order — Tenant Request", category: "Work Orders", durationMins: 90 },
      { name: "Vendor Dispatch", category: "Vendors", durationMins: 60 },
    ],
    templates: [
      "Work Order Intake & Triage",
      "Owner Approval (NTE)",
      "Unit Turn Checklist",
      "Vendor COI Compliance",
    ],
    categories: ["Work Orders", "Unit Turns", "Owner Approvals", "Vendor Compliance"],
  },

  // ───────────────────────── Specialty (Outlier ICPs) ─────────────────────────
  {
    id: "equipment-rental",
    label: "Equipment & Tool Rental",
    group: "Specialty (Outlier ICPs)",
    tier: "outlier",
    rank: 14,
    fitScore: 6.4,
    rationale:
      "Highest-scoring outlier. Blocked on a serialized asset-availability/utilization engine NVC 360 doesn't have yet — do not sell ahead of it. Sequence after current onboarding queue clears.",
    fitNote:
      "ArrivePing covers the reservation quote, delivery/pickup dispatch and check-out/check-in inspections well. It does NOT yet have a serialized asset-availability or utilization engine, so per-unit fleet availability, cycle billing and telematics are not in the product today \u2014 reservations are scheduled jobs, not inventory holds.",
    workerNoun: "Yard Staff",
    workerNounPlural: "Yard Staff",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Reservation",
    jobNounPlural: "Reservations",
    aiTone:
      "Efficient and availability-focused. Customers need to know exactly what's available, when, and what it costs including add-ons — confirm delivery/pickup windows clearly.",
    notificationGuidance:
      "Reservation-confirmed and off-rent-confirmed status pushes are essential. Cycle-billing notices (28-day) should be default-on once the availability engine ships.",
    services: [
      { name: "Equipment Reservation", category: "Reservations", durationMins: 30 },
      { name: "Delivery / Pickup", category: "Delivery", durationMins: 60 },
      { name: "Check-Out / Check-In Inspection", category: "Inspection", durationMins: 30 },
    ],
    templates: ["Reservation & Quote", "Delivery/Pickup Dispatch", "Off-Rent Inspection"],
    categories: ["Reservations", "Delivery", "Inspection"],
  },
  {
    id: "restoration",
    label: "Fire & Flood Restoration",
    group: "Specialty (Outlier ICPs)",
    tier: "outlier",
    rank: 16,
    fitScore: 5.7,
    rationale:
      "Outlier: the insurance workflow is captured — Xactimate is mandated on ~80% of claims, structurally locking NVC 360's native estimating out of the largest revenue stream. Serve self-pay/rebuild work opportunistically; don't lead with this ICP.",
    fitNote:
      "ArrivePing covers emergency dispatch, drying logs, mitigation-to-rebuild handoff and self-pay/deductible billing. It does NOT integrate with Xactimate or carrier claim portals, so insurance estimating and claim submission stay in those tools; use ArrivePing for the field workflow and the customer-facing side.",
    workerNoun: "Technician",
    workerNounPlural: "Technicians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone:
      "Empathetic and process-driven — customers are usually mid-disaster (fire/flood/mold) and stressed about insurance. Explain next steps and documentation clearly.",
    notificationGuidance:
      "Emergency dispatch and drying-log/documentation reminders matter for insurance claims. AR aging (30/60/90) is critical given payment-collection difficulty in this trade.",
    services: [
      { name: "Water Damage Mitigation", category: "Restoration", durationMins: 240 },
      { name: "Fire & Smoke Cleanup", category: "Restoration", durationMins: 240 },
      { name: "Mold Remediation", category: "Restoration", durationMins: 180 },
      { name: "Structural Drying", category: "Restoration", durationMins: 120 },
      { name: "Rebuild / Reconstruction", category: "Rebuild", durationMins: 180 },
    ],
    templates: [
      "Emergency Response",
      "Mitigation → Rebuild Handoff",
      "Drying Log",
      "Deductible / AR Chase",
    ],
    categories: ["Restoration", "Rebuild", "Emergency"],
  },
  {
    id: "sports-organization",
    label: "Sports Clubs & Academies",
    group: "Specialty (Outlier ICPs)",
    tier: "outlier",
    rank: 17,
    fitScore: 4.4,
    rationale:
      "Outlier, lowest fit — no GTM investment planned until 3+ paying prospects appear. Roster-level signal only (One Team Sports); registration/rosters/payments checkout is an explicit do-not-build.",
    fitNote:
      "ArrivePing covers session scheduling, coach assignment, space/court allocation, SMS reminders and coach credential tracking. It does NOT do program registration, rosters, league standings or a parent payments checkout \u2014 those stay in a registration platform and ArrivePing handles the day-of operations.",
    workerNoun: "Coach",
    workerNounPlural: "Coaches",
    customerNoun: "Member",
    customerNounPlural: "Members",
    jobNoun: "Session",
    jobNounPlural: "Sessions",
    aiTone:
      "Upbeat and schedule-focused. Parents/members care about session times, space assignments, and coach communication — keep it simple and fast.",
    notificationGuidance:
      "SMS-first session reminders (24h + 2h) cut no-shows 30-60%. Credential/COI expiry alerts for coaches should be default-on.",
    services: [
      { name: "Training Session", category: "Sessions", durationMins: 60 },
      { name: "Program Registration Consult", category: "Programs", durationMins: 30 },
    ],
    templates: ["Session Schedule", "Program Calendar", "Coach Certification Tracking"],
    categories: ["Sessions", "Programs", "Compliance"],
  },

  // ───────────────────────── Care & Family Services ─────────────────────────
  // Added 2026-10-01 at Dan's request (not part of the 2026-07 Phase 1 ranking
  // program — no rank/fitScore yet). Workflow shape is a direct fit for the
  // core ArrivePing loop: a parent books a sitter, the sitter is assigned and
  // confirmed, the parent gets en-route/arrived pings, and the card on file is
  // charged through Stripe at completion. No cash handling — card only.
  // icp_knowledge_base row to be curated from Dan's two babysitting ICP docs.
  {
    id: "childcare-babysitting",
    label: "Childcare & Babysitting",
    group: "Care & Family Services",
    tier: "core",
    rationale:
      "Parents booking in-home sitters want exactly what ArrivePing already does well: a confirmed named sitter, en-route and arrived pings, and card-on-file payment through Stripe with no cash at the door. Trust and safety signals (who is coming, when, and that they're vetted) are the product.",
    workerNoun: "Sitter",
    workerNounPlural: "Sitters",
    customerNoun: "Parent",
    customerNounPlural: "Parents",
    jobNoun: "Booking",
    jobNounPlural: "Bookings",
    aiTone:
      "Warm, calm and trust-first. Parents are handing over their children — always name the sitter, state the exact arrival window, and say what happens next. Plain language, no jargon, never casual about safety or lateness. Payment is by card on file through Stripe; never ask for or mention cash.",
    notificationGuidance:
      "Parents need to know who is coming and when: sitter-assigned (name + photo), en-route, arrived, and running-late should all be SMS default-on. Booking confirmation plus 24h/2h reminders cut no-shows. Session complete + card receipt go by email so parents have a record. Cancellation must reach the parent by SMS immediately.",
    services: [
      { name: "Meet & Greet / Family Intro Visit", category: "Family Intake", durationMins: 30 },
      { name: "Evening Babysitting", category: "Bookings", durationMins: 240 },
      { name: "Date-Night Sitting", category: "Bookings", durationMins: 180 },
      { name: "Daytime Childcare", category: "Bookings", durationMins: 480 },
      { name: "After-School Care & Pick-Up", category: "Bookings", durationMins: 180 },
      { name: "Overnight Care", category: "Bookings", durationMins: 720 },
      { name: "Newborn / Infant Care", category: "Bookings", durationMins: 240 },
      { name: "Backup / Same-Day Care", category: "Bookings", durationMins: 240 },
      { name: "Event & Wedding Childcare", category: "Bookings", durationMins: 300 },
    ],
    templates: [
      "Babysitting Booking",
      "Family Intake & Meet-and-Greet",
      "Care Notes & Handoff Report",
      "Recurring Care Schedule",
      "Incident / Health Report",
    ],
    categories: ["Bookings", "Family Intake", "Care Notes", "Safety & Compliance"],
  },

  // ───────────────────────── Aliases (route to a core ICP's template) ─────────────────────────
  // These exist only so a self-selecting signup sees a label that matches
  // their trade; selecting one sets companies.industry to the target ICP's
  // id above. Per Phase 1 dropdown spec — telemetry should track alias
  // selections separately once that plumbing exists (not yet wired).
  {
    id: "exteriors",
    label: "Windows & Doors",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "exteriors",
    workerNoun: "Installer",
    workerNounPlural: "Installers",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone: "See Roofing, Siding & Exteriors.",
    notificationGuidance: "See Roofing, Siding & Exteriors.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    id: "exteriors",
    label: "Eavestrough & Gutters",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "exteriors",
    workerNoun: "Installer",
    workerNounPlural: "Installers",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone: "See Roofing, Siding & Exteriors.",
    notificationGuidance: "See Roofing, Siding & Exteriors.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    id: "landscaping-grounds-snow",
    label: "Snow Removal",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "landscaping-grounds-snow",
    workerNoun: "Crew Lead",
    workerNounPlural: "Crew Leads",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Visit",
    jobNounPlural: "Visits",
    aiTone: "See Landscaping & Snow Removal.",
    notificationGuidance: "See Landscaping & Snow Removal.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    id: "landscaping-grounds-snow",
    label: "Irrigation & Sprinklers",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "landscaping-grounds-snow",
    workerNoun: "Crew Lead",
    workerNounPlural: "Crew Leads",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Visit",
    jobNounPlural: "Visits",
    aiTone: "See Landscaping & Snow Removal.",
    notificationGuidance: "See Landscaping & Snow Removal.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    id: "landscaping-grounds-snow",
    label: "Fence & Deck",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "landscaping-grounds-snow",
    workerNoun: "Crew Lead",
    workerNounPlural: "Crew Leads",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone: "See Landscaping & Snow Removal.",
    notificationGuidance: "See Landscaping & Snow Removal.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    id: "electrical",
    label: "Solar & EV Chargers",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "electrical",
    workerNoun: "Electrician",
    workerNounPlural: "Electricians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone: "See Electrical.",
    notificationGuidance: "See Electrical.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    // Dan, 2026-09-28: a plumbing-only shop (no HVAC side) selecting from
    // the New Company dropdown, or correcting the onboarding AI, shouldn't
    // have to pick a label with "HVAC" in it. Same underlying preset/
    // catalog as hvac-plumbing — this exists purely so the dropdown (and
    // the onboarding AI, via industryOtherLabel below) can call it what it
    // actually is.
    id: "hvac-plumbing",
    label: "Plumbing",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "hvac-plumbing",
    workerNoun: "Technician",
    workerNounPlural: "Technicians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone: "See HVAC & Plumbing.",
    notificationGuidance: "See HVAC & Plumbing.",
    services: [],
    templates: [],
    categories: [],
  },
  {
    // Dan, 2026-09-28: same reasoning as Plumbing above — a mechanical
    // contractor (boilers, hydronic/mechanical systems, not general HVAC
    // service) gets a label that fits, still on the hvac-plumbing catalog.
    id: "hvac-plumbing",
    label: "Mechanical",
    group: "Aliases (route to a core industry)",
    tier: "alias",
    aliasOf: "hvac-plumbing",
    workerNoun: "Technician",
    workerNounPlural: "Technicians",
    customerNoun: "Customer",
    customerNounPlural: "Customers",
    jobNoun: "Job",
    jobNounPlural: "Jobs",
    aiTone: "See HVAC & Plumbing.",
    notificationGuidance: "See HVAC & Plumbing.",
    services: [],
    templates: [],
    categories: [],
  },
];

export const INDUSTRY_LABELS: { id: string; label: string; group: string }[] =
  INDUSTRY_PRESETS.map((p) => ({ id: p.id, label: p.label, group: p.group }));

/** Distinct dropdown groups, in a sensible display order. */
export const INDUSTRY_GROUPS: string[] = [
  "Building & Renovation",
  "Mechanical & Electrical Trades",
  "Grounds, Snow & Trees",
  "Facilities & Property Management",
  "Care & Family Services",
  "Specialty (Outlier ICPs)",
  "Aliases (route to a core industry)",
];

export function getIndustryPreset(id: string | undefined | null): IndustryPreset | undefined {
  if (!id) return undefined;
  // Prefer a real (non-alias) preset for the id; alias rows share the same
  // id as their target so template/service/notification data always
  // resolves to the real ICP's content even if an alias row is matched first.
  const exact = INDUSTRY_PRESETS.find((p) => p.id === id && p.tier !== "alias");
  if (exact) return exact;
  return INDUSTRY_PRESETS.find((p) => p.id === id);
}

export function industryLabel(id: string | undefined | null): string {
  if (id === "other") return "Other";
  return getIndustryPreset(id)?.label ?? "";
}
