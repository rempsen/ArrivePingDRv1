/** Blog categories. Each maps to the product page that answers the commercial version of its questions. */
export const blogCategories = [
  {
    slug: "customer-communication",
    label: "Customer communication",
    description: "On-my-way texts, live tracking links, ETAs and customer updates: how service businesses end the four-hour window and the calls it causes.",
    // The on-my-way page owns the "on my way text" queries; /customer-notifications targets notification software.
    productPath: "/on-my-way-text-software",
  },
  {
    slug: "dispatch-scheduling",
    label: "Dispatch & scheduling",
    description: "Getting the right technician to the right job: automatic assignment, scheduling, the dispatch board and what a dispatcher's day looks like.",
    productPath: "/dispatch-software",
  },
  {
    slug: "technician-tracking",
    label: "Fleet & technician tracking",
    description: "Real-time visibility of technicians, drivers and vans: phone vs vehicle GPS, live maps, arrival logging and what tracking does for the business.",
    productPath: "/fleet-tracking",
  },
  {
    slug: "construction",
    label: "Construction & trades",
    description: "Crews, job sites, rework and the labour shortage: field communication and scheduling for construction, installers and specialty trades.",
    productPath: "/construction-trades",
  },
  {
    slug: "ai-operations",
    label: "AI & operations",
    description: "Where AI genuinely helps field service operations, and where it doesn't: dispatch, setup, customer messages and the adoption gap, with sources.",
    productPath: "/field-service-software",
  },
  {
    slug: "growth",
    label: "Growth & profitability",
    description: "Margins, pricing power, software costs and becoming the preferred provider in your market, with sourced figures for service business owners.",
    productPath: "/pricing",
  },
] as const;

export type BlogCategorySlug = (typeof blogCategories)[number]["slug"];
export const categoryBySlug = Object.fromEntries(blogCategories.map((c) => [c.slug, c])) as Record<string, (typeof blogCategories)[number]>;
