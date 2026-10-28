/**
 * OAuth handshake state. The `state` value we send to a provider comes back
 * on the redirect and tells us which integration row (and tenant) is being
 * connected. It lives in the database so it survives a restart and works
 * across instances; each value is single-use and expires after 10 minutes.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { ProviderId } from "../../services/oauth-types";

const TTL_MS = 10 * 60_000;

export async function putState(integrationId: string, provider: ProviderId, companyId: string, ttlMs = TTL_MS): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  await db.insert(schema.oauthStates).values({ id, integrationId, provider, companyId, expiresAt: new Date(Date.now() + ttlMs) });
  // opportunistic sweep of stale rows
  void db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date(Date.now() - TTL_MS))).catch(() => {});
  return id;
}

export async function takeState(id: string): Promise<{ integrationId: string; provider: ProviderId; companyId: string } | null> {
  const rows = await db
    .delete(schema.oauthStates)
    .where(and(eq(schema.oauthStates.id, id), gt(schema.oauthStates.expiresAt, new Date())))
    .returning();
  const v = rows[0];
  if (!v) return null;
  return { integrationId: v.integrationId, provider: v.provider as ProviderId, companyId: v.companyId };
}
