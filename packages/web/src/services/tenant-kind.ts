/**
 * A tenant's kind (customer, demo, test, internal) and the older "test tenant"
 * flag, kept in step. `is_internal` still drives platform analytics and the
 * company history trigger, so it is always written as kind <> 'customer'.
 */
import { eq } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { asTenantKind, type TenantKind } from "../shared/features";
import { invalidateFeatures } from "./features";

/** The kind to record when only the old flag is flipped (Analytics → Tenants). */
export function kindForInternalFlag(current: string | null | undefined, internal: boolean): TenantKind {
  const k = asTenantKind(current);
  if (!internal) return "customer";
  return k === "customer" ? "test" : k;
}

export async function setTenantKind(companyId: string, kind: TenantKind) {
  const k = asTenantKind(kind);
  const [row] = await sdb
    .update(schema.companies)
    .set({ kind: k, isInternal: k !== "customer", updatedAt: new Date() })
    .where(eq(schema.companies.id, companyId))
    .returning({ id: schema.companies.id, name: schema.companies.name, kind: schema.companies.kind, internal: schema.companies.isInternal });
  invalidateFeatures(companyId);
  return row ?? null;
}
