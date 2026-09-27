import { tdb } from "../database/tenant";
import * as schema from "../database/schema";

interface AuditArgs {
  actorId?: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary?: string;
  meta?: Record<string, unknown>;
  /** Tenant the entry belongs to. Defaults to "default" when unset. */
  companyId?: string;
}

/** Write an audit log entry. Fire-and-forget safe. */
export async function audit(a: AuditArgs) {
  try {
    await tdb(a.companyId ?? "default").insert(schema.auditLog, {
      actorId: a.actorId ?? "",
      actorName: a.actorName ?? "",
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? "",
      summary: a.summary ?? "",
      meta: JSON.stringify(a.meta ?? {}),
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}
