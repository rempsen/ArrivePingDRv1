// Industry (ICP) option/tier catalog presets — starter "good/better/best"
// categories seeded on company create so a new tenant's Options & Tiers page
// (admin) isn't empty on day one, and the wedge feature (Phase 3 cross-ICP
// synthesis #1 build priority — the Karma/Glendale options/upgrade-pricing
// engine, generalized) is immediately usable end to end.
//
// Grounded directly in the per-ICP research (Claude Projects/NVC360-Hub/ICPs/
// <slug>/04-NVC360-App-Customization.md, "Menus & navigation" + "Template
// fields" sections) — every category name below traces back to a named
// module in that research: Selections Studio / Options Catalog / Upgrade
// Catalogue / Material Tier Catalog / Door Configurator / Price Book /
// Colour Schedules are all instances of this same shape.
//
// Price deltas are realistic starting points (a tenant tunes them), not
// guesses presented as fact — sourced from the same key_data cited in each
// ICP's research docs where possible (e.g. LVP vs carpet flooring deltas).

export type OptionTierPreset = {
  tierLabel: string; // "Good" | "Better" | "Best" | custom
  name: string;
  description: string;
  priceDelta: number; // CAD, relative to the default/included tier
  isDefault: boolean;
};

export type OptionCategoryPreset = {
  name: string;
  description: string;
  tiers: OptionTierPreset[];
};

export const OPTION_CATALOG_PRESETS: Record<string, OptionCategoryPreset[]> = {
  // ───────────────────────── Wave 1 (deepest research + live customers) ─────────────────────────
  "home-builder-developer": [
    {
      name: "Flooring",
      description: "Selections Studio — flooring tier for the home's main living areas.",
      tiers: [
        { tierLabel: "Good", name: "Builder-Grade Carpet", description: "Standard included carpet.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Luxury Vinyl Plank", description: "Waterproof, scratch-resistant plank flooring.", priceDelta: 4500, isDefault: false },
        { tierLabel: "Best", name: "Engineered Hardwood", description: "Premium engineered hardwood throughout main living areas.", priceDelta: 9500, isDefault: false },
      ],
    },
    {
      name: "Kitchen Countertops",
      description: "Selections Studio — kitchen countertop material.",
      tiers: [
        { tierLabel: "Good", name: "Laminate", description: "Standard included laminate countertop.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Quartz", description: "Engineered quartz countertop.", priceDelta: 3800, isDefault: false },
        { tierLabel: "Best", name: "Granite", description: "Natural granite countertop, premium slab selection.", priceDelta: 6200, isDefault: false },
      ],
    },
    {
      name: "Electrical Upgrade Package",
      description: "Structural options — pot lights, EV charger rough-in, panel capacity.",
      tiers: [
        { tierLabel: "Good", name: "Base Electrical", description: "Standard included electrical package.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Pot Light + EV Rough-In Package", description: "Recessed lighting package plus garage EV charger rough-in.", priceDelta: 2200, isDefault: false },
        { tierLabel: "Best", name: "Full Smart-Home Package", description: "Pot lights, EV charger installed, smart panel, structured wiring.", priceDelta: 5800, isDefault: false },
      ],
    },
  ],
  "painting-decorating": [
    {
      name: "Paint Grade",
      description: "Interior repaint quote — paint quality tier.",
      tiers: [
        { tierLabel: "Good", name: "Standard Interior Paint", description: "Quality washable interior paint, one colour per room.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Premium Interior Paint", description: "Premium low-VOC paint with enhanced durability.", priceDelta: 350, isDefault: false },
        { tierLabel: "Best", name: "Designer Paint + Accent Wall", description: "Designer-brand paint plus one accent wall or feature finish.", priceDelta: 750, isDefault: false },
      ],
    },
    {
      name: "Cabinet Refinishing Add-On",
      description: "Optional cabinet refinishing bundled with a repaint job.",
      tiers: [
        { tierLabel: "None", name: "No Cabinet Work", description: "Repaint only, no cabinets.", priceDelta: 0, isDefault: true },
        { tierLabel: "Add-On", name: "Kitchen Cabinet Refinish", description: "Spray-finish refinishing for kitchen cabinet doors and drawers.", priceDelta: 1800, isDefault: false },
      ],
    },
  ],
  "design-build": [
    {
      name: "Kitchen Package",
      description: "Selections Board — kitchen finishes allowance tier.",
      tiers: [
        { tierLabel: "Good", name: "Standard Kitchen Package", description: "Base allowance kitchen finish package.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Upgraded Kitchen Package", description: "Quartz counters, soft-close cabinetry, upgraded backsplash.", priceDelta: 12000, isDefault: false },
        { tierLabel: "Best", name: "Premium Kitchen Package", description: "Custom cabinetry, premium stone counters, designer fixtures.", priceDelta: 26000, isDefault: false },
      ],
    },
    {
      name: "Bathroom Package",
      description: "Selections Board — bathroom finishes allowance tier.",
      tiers: [
        { tierLabel: "Good", name: "Standard Bathroom Package", description: "Base allowance bathroom finish package.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Upgraded Bathroom Package", description: "Tile shower surround, upgraded vanity and fixtures.", priceDelta: 6500, isDefault: false },
        { tierLabel: "Best", name: "Spa Bathroom Package", description: "Custom tile work, freestanding tub, premium fixtures.", priceDelta: 14000, isDefault: false },
      ],
    },
  ],
  "renovation-contractor": [
    {
      name: "Flooring Allowance",
      description: "Allowance category — flooring selection for the renovated space.",
      tiers: [
        { tierLabel: "Good", name: "Standard LVP", description: "Standard-grade luxury vinyl plank.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Premium LVP", description: "Premium waterproof plank with enhanced wear layer.", priceDelta: 1200, isDefault: false },
        { tierLabel: "Best", name: "Hardwood", description: "Solid or engineered hardwood flooring.", priceDelta: 3400, isDefault: false },
      ],
    },
    {
      name: "Cabinetry Allowance",
      description: "Allowance category — kitchen/bath cabinetry.",
      tiers: [
        { tierLabel: "Good", name: "Stock Cabinets", description: "Standard stock cabinetry.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Semi-Custom Cabinets", description: "Semi-custom cabinetry with soft-close hardware.", priceDelta: 4200, isDefault: false },
        { tierLabel: "Best", name: "Custom Cabinets", description: "Fully custom cabinetry, built to the space.", priceDelta: 9800, isDefault: false },
      ],
    },
  ],

  // ───────────────────────── Wave 2 (near-ready, options-engine direct fit) ─────────────────────────
  electrical: [
    {
      name: "Panel Upgrade",
      description: "Upgrade Catalogue — service panel capacity.",
      tiers: [
        { tierLabel: "Good", name: "100A Panel", description: "Standard 100A panel upgrade.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "150A Panel", description: "150A panel for added capacity (EV charger, hot tub, etc.).", priceDelta: 650, isDefault: false },
        { tierLabel: "Best", name: "200A Panel", description: "200A panel for full-home future-proofing.", priceDelta: 1400, isDefault: false },
      ],
    },
    {
      name: "EV Charger",
      description: "Upgrade Catalogue — EV charger install tier.",
      tiers: [
        { tierLabel: "None", name: "No EV Charger", description: "No EV charger install.", priceDelta: 0, isDefault: true },
        { tierLabel: "Standard", name: "Level 2 EV Charger (40A)", description: "Hardwired Level 2 EV charging station.", priceDelta: 1450, isDefault: false },
        { tierLabel: "Premium", name: "Smart Level 2 EV Charger (48A)", description: "App-connected Level 2 charger with load management.", priceDelta: 2100, isDefault: false },
      ],
    },
  ],
  exteriors: [
    {
      name: "Roofing Material Tier",
      description: "Three-tier material proposal — shingle/material grade.",
      tiers: [
        { tierLabel: "Good", name: "Standard Architectural Shingles", description: "Standard 30-year architectural asphalt shingles.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Premium Architectural Shingles", description: "Premium 40-50 year architectural shingles, enhanced wind rating.", priceDelta: 1800, isDefault: false },
        { tierLabel: "Best", name: "Designer / Metal Roofing", description: "Designer shingle line or standing-seam metal roofing.", priceDelta: 5500, isDefault: false },
      ],
    },
    {
      name: "Siding Material Tier",
      description: "Three-tier material proposal — siding grade.",
      tiers: [
        { tierLabel: "Good", name: "Standard Vinyl Siding", description: "Standard-grade vinyl siding.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Insulated Vinyl Siding", description: "Insulated vinyl siding for improved R-value.", priceDelta: 2400, isDefault: false },
        { tierLabel: "Best", name: "Fibre Cement Siding", description: "Premium fibre cement (Hardie board) siding.", priceDelta: 6800, isDefault: false },
      ],
    },
  ],
  "hvac-plumbing": [
    {
      name: "Furnace Tier",
      description: "Good/Better/Best install quote template — furnace efficiency tier.",
      tiers: [
        { tierLabel: "Good", name: "80% AFUE Furnace", description: "Standard-efficiency single-stage furnace.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "95% AFUE Two-Stage Furnace", description: "High-efficiency two-stage furnace.", priceDelta: 1400, isDefault: false },
        { tierLabel: "Best", name: "96%+ AFUE Variable-Speed Furnace", description: "Top-tier variable-speed, whisper-quiet furnace.", priceDelta: 2600, isDefault: false },
      ],
    },
    {
      name: "Smart Thermostat Add-On",
      description: "Optional smart thermostat upgrade with any install.",
      tiers: [
        { tierLabel: "None", name: "Standard Thermostat", description: "Basic programmable thermostat included.", priceDelta: 0, isDefault: true },
        { tierLabel: "Add-On", name: "Wi-Fi Smart Thermostat", description: "App-connected smart thermostat with scheduling.", priceDelta: 320, isDefault: false },
      ],
    },
  ],
  "garage-door": [
    {
      name: "Door Configurator",
      description: "Door model / insulation R-value tier.",
      tiers: [
        { tierLabel: "Good", name: "Non-Insulated Steel Door", description: "Single-layer steel door, no insulation.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Insulated Door (R-12)", description: "Double-layer insulated steel door.", priceDelta: 450, isDefault: false },
        { tierLabel: "Best", name: "Premium Insulated Door (R-18, Windows)", description: "Triple-layer insulated door with window inserts.", priceDelta: 950, isDefault: false },
      ],
    },
    {
      name: "Opener Tier",
      description: "Door Configurator — opener tier.",
      tiers: [
        { tierLabel: "Good", name: "Chain-Drive Opener", description: "Standard chain-drive opener.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Belt-Drive Smart Opener", description: "Quiet belt-drive opener with smartphone control.", priceDelta: 220, isDefault: false },
        { tierLabel: "Best", name: "Battery-Backup Smart Opener", description: "Belt-drive opener with battery backup and camera.", priceDelta: 420, isDefault: false },
      ],
    },
  ],
  flooring: [
    {
      name: "Flooring Tier",
      description: "Options Catalog — carpet vs LVP vs hardwood tier (per room).",
      tiers: [
        { tierLabel: "Good", name: "Builder-Grade Carpet", description: "Standard carpet, per average room.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Luxury Vinyl Plank", description: "Waterproof LVP, per average room.", priceDelta: 900, isDefault: false },
        { tierLabel: "Best", name: "Engineered Hardwood", description: "Engineered hardwood, per average room.", priceDelta: 1900, isDefault: false },
      ],
    },
  ],
  "concrete-foundation-repair": [
    {
      name: "Foundation Repair Tier",
      description: "Tiered pier/waterproofing quote builder.",
      tiers: [
        { tierLabel: "Good", name: "Spot Pier Repair", description: "Targeted piering at identified problem areas only.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Extended Pier Package + Waterproofing", description: "Extended piering plus exterior waterproofing membrane.", priceDelta: 3200, isDefault: false },
        { tierLabel: "Best", name: "Full Perimeter Underpinning + Waterproofing", description: "Full perimeter underpinning with complete waterproofing system.", priceDelta: 8500, isDefault: false },
      ],
    },
  ],
  "tree-care": [
    {
      name: "Tree Service Tier",
      description: "Per-tree good/better/best: removal vs prune vs cable.",
      tiers: [
        { tierLabel: "Good", name: "Prune / Trim Only", description: "Standard pruning and trimming.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Prune + Cabling", description: "Pruning plus structural cabling/bracing support.", priceDelta: 180, isDefault: false },
        { tierLabel: "Best", name: "Full Removal + Stump Grind", description: "Complete tree removal with stump grinding.", priceDelta: 420, isDefault: false },
      ],
    },
  ],
  "landscaping-grounds-snow": [
    {
      name: "Fence & Deck Material Tier",
      description: "Outdoor-structures template — material tier.",
      tiers: [
        { tierLabel: "Good", name: "Pressure-Treated Wood", description: "Standard pressure-treated lumber.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Cedar", description: "Natural cedar, improved weather resistance and appearance.", priceDelta: 1400, isDefault: false },
        { tierLabel: "Best", name: "Composite", description: "Low-maintenance composite decking/fencing material.", priceDelta: 3200, isDefault: false },
      ],
    },
  ],
  restoration: [
    {
      name: "Rebuild Finish Tier",
      description: "Rebuild-phase finish tier for self-pay/non-TPA jobs (residential remodeling adjacency).",
      tiers: [
        { tierLabel: "Good", name: "Standard Restore-to-Match", description: "Restore affected areas to pre-loss standard finish.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Upgraded Finish Package", description: "Upgrade finishes during the rebuild (flooring, paint grade).", priceDelta: 2400, isDefault: false },
        { tierLabel: "Best", name: "Full Remodel Upgrade", description: "Treat the rebuild as a full remodel opportunity.", priceDelta: 6800, isDefault: false },
      ],
    },
  ],

  // ───────────────────────── Wave 3 / conditional (lighter options fit, seeded thin on purpose) ─────────────────────────
  "commercial-building-maintenance": [
    {
      name: "Service Response Tier",
      description: "Contract service-level tier (not a materials upgrade — SLA speed tier).",
      tiers: [
        { tierLabel: "Standard", name: "Standard Response (48h)", description: "Standard SLA response window.", priceDelta: 0, isDefault: true },
        { tierLabel: "Priority", name: "Priority Response (24h)", description: "Priority response SLA.", priceDelta: 150, isDefault: false },
        { tierLabel: "Emergency", name: "Emergency Response (4h)", description: "Emergency same-day response SLA.", priceDelta: 400, isDefault: false },
      ],
    },
  ],

  // ───────────────────────── Outlier ICPs (added 2026-10-01) ─────────────────────────
  // These three were the only industry presets with no option/tier groups, so
  // an outlier-tier tenant landed on an empty Options & Tiers page while every
  // core/adjacent ICP got good/better/best out of the box. Service-level and
  // add-on tiers below are the conventional upsell shapes in each trade.
  "property-management-maintenance": [
    {
      name: "Work Order Priority",
      description: "Response-time tier on a tenant maintenance request — drives dispatch urgency and the owner-facing NTE.",
      tiers: [
        { tierLabel: "Routine", name: "Routine (3-5 business days)", description: "Non-urgent repair scheduled with the next vendor route.", priceDelta: 0, isDefault: true },
        { tierLabel: "Urgent", name: "Urgent (24-48h)", description: "Habitability-adjacent issue (no hot water, appliance down) dispatched next business day.", priceDelta: 75, isDefault: false },
        { tierLabel: "Emergency", name: "Emergency (same-day / after-hours)", description: "Active leak, no heat, lockout or safety issue — immediate dispatch at after-hours rates.", priceDelta: 250, isDefault: false },
      ],
    },
    {
      name: "Unit Turn Scope",
      description: "How deep the make-ready goes between tenants.",
      tiers: [
        { tierLabel: "Good", name: "Standard Turn", description: "Clean, patch and touch-up paint, smoke/CO test, locks rekeyed.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Refresh Turn", description: "Standard turn plus full repaint and carpet clean or LVP repair.", priceDelta: 1200, isDefault: false },
        { tierLabel: "Best", name: "Renovation Turn", description: "Refresh turn plus flooring, fixtures and appliance replacement for a rent-lift reposition.", priceDelta: 4500, isDefault: false },
      ],
    },
    {
      name: "Vendor Tier",
      description: "Which vendor pool the work order is routed to.",
      tiers: [
        { tierLabel: "Standard", name: "In-House / Handyman", description: "Owned maintenance tech for general repairs.", priceDelta: 0, isDefault: true },
        { tierLabel: "Licensed", name: "Licensed Trade", description: "Licensed plumber/electrician/HVAC with COI on file — required for permitted work.", priceDelta: 95, isDefault: false },
      ],
    },
  ],
  "equipment-rental": [
    {
      name: "Rental Period",
      description: "Rate basis for the reservation — daily, weekly or 4-week cycle billing.",
      tiers: [
        { tierLabel: "Daily", name: "Daily Rate", description: "24-hour rental, returned next business day.", priceDelta: 0, isDefault: true },
        { tierLabel: "Weekly", name: "Weekly Rate", description: "7-day rental at roughly 3x the daily rate.", priceDelta: 0, isDefault: false },
        { tierLabel: "4-Week", name: "4-Week Cycle Rate", description: "28-day cycle billing at roughly 3x the weekly rate.", priceDelta: 0, isDefault: false },
      ],
    },
    {
      name: "Damage Waiver",
      description: "Optional rental protection plan, typically 10-15% of the rental charge.",
      tiers: [
        { tierLabel: "None", name: "Declined — Customer Insured", description: "Customer provides certificate of insurance naming the rental company.", priceDelta: 0, isDefault: true },
        { tierLabel: "Standard", name: "Rental Protection Plan", description: "Covers accidental damage, excludes theft and negligence.", priceDelta: 45, isDefault: false },
        { tierLabel: "Plus", name: "Rental Protection Plus", description: "Adds theft coverage and a reduced deductible.", priceDelta: 90, isDefault: false },
      ],
    },
    {
      name: "Delivery & Pickup",
      description: "Logistics tier for getting the equipment to and from the site.",
      tiers: [
        { tierLabel: "Pickup", name: "Customer Pickup", description: "Customer collects and returns at the yard.", priceDelta: 0, isDefault: true },
        { tierLabel: "Delivery", name: "Delivery + Pickup (local)", description: "Flatbed delivery and pickup within the standard zone.", priceDelta: 150, isDefault: false },
        { tierLabel: "Priority", name: "Same-Day Delivery", description: "Priority same-day drop at the site, subject to availability.", priceDelta: 300, isDefault: false },
      ],
    },
    {
      name: "Fuel & Cleaning",
      description: "Return-condition handling.",
      tiers: [
        { tierLabel: "Standard", name: "Return Full & Clean", description: "Customer returns fuelled and cleaned; charges apply if not.", priceDelta: 0, isDefault: true },
        { tierLabel: "Prepaid", name: "Prepaid Refuel & Clean", description: "Flat convenience fee; return as-is.", priceDelta: 60, isDefault: false },
      ],
    },
  ],
  "sports-organization": [
    {
      name: "Session Type",
      description: "Coaching ratio for a booked session.",
      tiers: [
        { tierLabel: "Good", name: "Group Session", description: "Standard group training, up to 12 athletes per coach.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Small Group (3-4)", description: "Semi-private session with 3-4 athletes.", priceDelta: 25, isDefault: false },
        { tierLabel: "Best", name: "Private 1-on-1", description: "Private session with a head coach.", priceDelta: 60, isDefault: false },
      ],
    },
    {
      name: "Time Slot",
      description: "Prime-time vs off-peak pricing for court/field/ice time.",
      tiers: [
        { tierLabel: "Off-Peak", name: "Off-Peak (weekday daytime)", description: "Weekday sessions before 4pm.", priceDelta: 0, isDefault: true },
        { tierLabel: "Prime", name: "Prime Time (weekday evening)", description: "Weekday 4-9pm — highest demand window.", priceDelta: 20, isDefault: false },
        { tierLabel: "Weekend", name: "Weekend", description: "Saturday/Sunday sessions and tournaments.", priceDelta: 15, isDefault: false },
      ],
    },
    {
      name: "Space Rental",
      description: "Facility rental tier when a member or outside group books the space itself.",
      tiers: [
        { tierLabel: "Half", name: "Half Court / Half Field", description: "Shared space, one hour.", priceDelta: 0, isDefault: true },
        { tierLabel: "Full", name: "Full Court / Full Field", description: "Exclusive use of the full space, one hour.", priceDelta: 50, isDefault: false },
        { tierLabel: "Event", name: "Full Facility (event block)", description: "Whole facility for a tournament or camp block, includes staff.", priceDelta: 400, isDefault: false },
      ],
    },
  ],

  // ───────────────────────── Care & Family Services (added 2026-10-01) ─────────────────────────
  "childcare-babysitting": [
    {
      name: "Sitter Experience Level",
      description: "Per-hour good/better/best on who shows up: screened sitter vs senior sitter vs certified early-childhood educator.",
      tiers: [
        { tierLabel: "Good", name: "Screened Sitter", description: "Background-checked, First Aid/CPR certified, 1+ years experience.", priceDelta: 0, isDefault: true },
        { tierLabel: "Better", name: "Senior Sitter", description: "3+ years experience, infant and special-needs experience, can drive.", priceDelta: 4, isDefault: false },
        { tierLabel: "Best", name: "Certified Educator (ECE/RECE)", description: "Credentialed early-childhood educator; structured activities and homework support.", priceDelta: 9, isDefault: false },
      ],
    },
    {
      name: "Booking Notice",
      description: "How much lead time the parent is giving — drives the same-day surcharge.",
      tiers: [
        { tierLabel: "Standard", name: "48h+ Notice", description: "Booked two or more days ahead.", priceDelta: 0, isDefault: true },
        { tierLabel: "Short", name: "24-48h Notice", description: "Booked the day before.", priceDelta: 10, isDefault: false },
        { tierLabel: "Same-Day", name: "Under 24h / Same-Day", description: "Backup or emergency care placed with under 24 hours' notice.", priceDelta: 25, isDefault: false },
      ],
    },
    {
      name: "Number of Children",
      description: "Per-hour delta for the number of children in care.",
      tiers: [
        { tierLabel: "1-2", name: "One or Two Children", description: "Standard rate.", priceDelta: 0, isDefault: true },
        { tierLabel: "3", name: "Three Children", description: "Adds one additional-child increment.", priceDelta: 3, isDefault: false },
        { tierLabel: "4+", name: "Four or More Children", description: "Adds two increments; a second sitter may be required for 5+.", priceDelta: 6, isDefault: false },
      ],
    },
  ],
};
