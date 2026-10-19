import { tdb } from "../database/tenant";
import * as schema from "../database/schema";
import { requestFacts } from "./request-context";

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

/**
 * Write an audit log entry. Fire-and-forget safe. During Control Hub act-as
 * the entry also names the ArrivePing support person behind it
 * (lib/request-context.ts), so the company can see who really made a change.
 */
export async function audit(a: AuditArgs) {
  const support = requestFacts()?.supportActor;
  try {
    await tdb(a.companyId ?? "default").insert(schema.auditLog, {
      actorId: a.actorId ?? "",
      actorName: a.actorName ?? "",
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? "",
      summary: a.summary ?? "",
      meta: JSON.stringify(a.meta ?? {}),
      supportActorId: support?.id ?? "",
      supportActorName: support?.name ?? "",
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}
