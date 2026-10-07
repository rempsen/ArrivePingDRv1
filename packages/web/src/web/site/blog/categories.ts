/** Blog categories. Each maps to the product page that answers the commercial version of its questions. */
export const blogCategories = [
  {
    slug: "customer-communication",
    label: "Customer communication",
    description: "On-my-way texts, live tracking links, ETAs and the end of the four-hour service window.",
    productPath: "/customer-notifications",
  },
  {
    slug: "dispatch-scheduling",
    label: "Dispatch & scheduling",
    description: "Getting the right technician to the right job: assignment, scheduling and the dispatch board.",
    productPath: "/dispatch-software",
  },
  {
    slug: "technician-tracking",
    label: "Fleet & technician tracking",
    description: "Real-time visibility of technicians, drivers and vans, and what it does for the business.",
    productPath: "/fleet-tracking",
  },
  {
    slug: "construction",
    label: "Construction & trades",
    description: "Crews, job sites, rework and the labour shortage in construction and specialty trades.",
    productPath: "/construction-trades",
  },
  {
    slug: "ai-operations",
    label: "AI & operations",
    description: "Where AI genuinely helps field service operations, and where it doesn't.",
    productPath: "/field-service-software",
  },
  {
    slug: "growth",
    label: "Growth & profitability",
    description: "Margins, pricing power and becoming the preferred provider in your market.",
    productPath: "/pricing",
  },
] as const;

export type BlogCategorySlug = (typeof blogCategories)[number]["slug"];
export const categoryBySlug = Object.fromEntries(blogCategories.map((c) => [c.slug, c])) as Record<string, (typeof blogCategories)[number]>;
