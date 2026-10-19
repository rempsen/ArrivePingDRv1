/**
 * Plans: which entitlements (shared/features.ts) each plan includes. Billing
 * is seat-based and doesn't change with the plan; a plan only packages the
 * product.
 *
 * Every plan includes everything for now (Dan, 2026-10-18: all plans stay
 * full-featured until pricing changes), so no existing tenant loses anything.
 * To hold a feature back from a plan, replace "all" with the list of keys it
 * keeps; the Control Hub shows how many tenants that would affect.
 */
export const PLAN_IDS = ["starter", "pro", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDef {
  id: PlanId;
  label: string;
  /** "all" or the entitlement keys this plan includes. */
  features: "all" | readonly string[];
}

export const PLANS: Record<PlanId, PlanDef> = {
  starter: { id: "starter", label: "Starter", features: "all" },
  pro: { id: "pro", label: "Pro", features: "all" },
  enterprise: { id: "enterprise", label: "Enterprise", features: "all" },
};

export function asPlanId(v: unknown): PlanId {
  return (PLAN_IDS as readonly string[]).includes(String(v)) ? (v as PlanId) : "starter";
}

/** Does this plan include the entitlement? Unknown plans are treated as Starter. */
export function planIncludes(plan: string | null | undefined, featureKey: string): boolean {
  const p = PLANS[asPlanId(plan)];
  return p.features === "all" || p.features.includes(featureKey);
}
