/**
 * QuickBooks Online API client for one tenant's connection.
 *
 *  - every call carries the tenant's access token and the pinned minor version;
 *  - the token is refreshed before it expires (and once more after a 401);
 *    the rotated refresh token Intuit returns is kept, sealed;
 *  - a refresh that fails with invalid_grant means the tenant revoked us:
 *    the integration flips to `needs_reconnect` and callers stop retrying;
 *  - every error says whether a retry can help (429 and 5xx: yes; Intuit's
 *    validation faults 6xxx: no) and carries Intuit's `intuit_tid` so a
 *    problem can be raised with them.
 *
 * Intuit limits: 500 requests/min and 10 concurrent per company. The sync
 * makes a handful of calls per job, so nothing here rate-limits locally.
 */
import { and, eq } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { open, seal } from "../../api/lib/secretbox";
import { refreshTokens } from "../oauth";
import { qboApiBase } from "./company";
import type { CdcResponse, QueryResponse } from "./entities";

export const MINOR_VERSION = "75";
export { qboApiBase as qboBaseUrl };

export class QboError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: string,
    public tid: string,
    public retryable: boolean,
  ) {
    super(`QuickBooks ${status} ${code}: ${detail.slice(0, 300)}`);
  }
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = fetch;
/** Tests swap the transport. */
export function _setQboFetch(f: Fetch | null): void {
  fetchImpl = f ?? fetch;
}

export interface QboConnection {
  integrationId: string;
  companyId: string;
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  status: string;
}

/**
 * The tenant's QuickBooks connection, tokens opened. Null when the tenant has
 * never connected (or disconnected). A `needs_reconnect` row is returned so
 * callers can tell the user; `qboFetch` refuses to use it.
 *
 * Reads with the system connection: the scheduler and the webhook handler
 * call this without a request's tenant context.
 */
export async function loadConnection(companyId: string): Promise<QboConnection | null> {
  const [row] = await sdb
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.companyId, companyId), eq(schema.integrations.provider, "quickbooks")));
  if (!row || row.status === "disconnected" || !row.externalAccountId) return null;
  return {
    integrationId: row.id,
    companyId,
    realmId: row.externalAccountId,
    accessToken: open(row.accessToken),
    refreshToken: open(row.refreshToken),
    expiresAt: row.expiresAt,
    status: row.status,
  };
}

async function refresh(conn: QboConnection): Promise<QboConnection> {
  try {
    const t = await refreshTokens("quickbooks", conn.refreshToken);
    const next: QboConnection = {
      ...conn,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken || conn.refreshToken,
      expiresAt: t.expiresAt ? new Date(t.expiresAt) : conn.expiresAt,
    };
    await sdb
      .update(schema.integrations)
      .set({
        accessToken: seal(next.accessToken),
        refreshToken: seal(next.refreshToken),
        expiresAt: next.expiresAt,
        status: "connected",
      })
      .where(eq(schema.integrations.id, conn.integrationId));
    return next;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_grant|invalid_client|unauthorized_client/i.test(msg)) {
      await sdb.update(schema.integrations).set({ status: "needs_reconnect" }).where(eq(schema.integrations.id, conn.integrationId));
      throw new QboError(401, "needs_reconnect", msg, "", false);
    }
    throw new QboError(503, "refresh_failed", msg, "", true);
  }
}

function expiring(conn: QboConnection): boolean {
  return !conn.expiresAt || conn.expiresAt.getTime() - 60_000 < Date.now();
}

interface FetchInit {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string>;
}

async function parseError(r: Response): Promise<QboError> {
  const tid = r.headers.get("intuit_tid") ?? "";
  let code = String(r.status);
  let detail = "";
  try {
    const j = (await r.json()) as { Fault?: { Error?: { code?: string; Message?: string; Detail?: string }[]; type?: string } };
    const first = j.Fault?.Error?.[0];
    if (first) {
      code = first.code ?? code;
      detail = [first.Message, first.Detail].filter(Boolean).join(" — ");
    } else {
      detail = JSON.stringify(j).slice(0, 300);
    }
  } catch {
    detail = r.statusText;
  }
  const retryable = r.status === 429 || r.status >= 500;
  return new QboError(r.status, code, detail, tid, retryable);
}

/** Call the Accounting API for a tenant. `path` is relative to /v3/company/{realmId}. */
export async function qboFetch<T = unknown>(companyId: string, path: string, init: FetchInit = {}): Promise<T> {
  let conn = await loadConnection(companyId);
  if (!conn) throw new QboError(0, "not_connected", "QuickBooks is not connected for this company", "", false);
  if (conn.status === "needs_reconnect") throw new QboError(401, "needs_reconnect", "QuickBooks must be reconnected", "", false);
  if (expiring(conn)) conn = await refresh(conn);

  const url = new URL(`${qboApiBase()}/v3/company/${conn.realmId}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("minorversion", MINOR_VERSION);

  const send = async (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    return fetchImpl(url.toString(), {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  };

  let r = await send(conn.accessToken);
  if (r.status === 401) {
    conn = await refresh(conn);
    r = await send(conn.accessToken);
  }
  if (!r.ok) {
    const err = await parseError(r);
    console.warn(`[qbo] ${init.method ?? "GET"} ${path} → ${err.status} ${err.code} tid=${err.tid}`);
    throw err;
  }
  return (await r.json()) as T;
}

/** Run a QuickBooks query and return the entity list (empty when nothing matches). */
export async function qboQuery<T>(companyId: string, sql: string): Promise<T[]> {
  const res = await qboFetch<QueryResponse<T>>(companyId, "/query", { query: { query: sql } });
  const qr = res.QueryResponse ?? {};
  for (const [k, v] of Object.entries(qr)) {
    if (Array.isArray(v) && k !== "Fault") return v as T[];
  }
  return [];
}

/** Change data capture: everything of the given kinds changed since `since`. */
export async function qboCdc(companyId: string, entities: string[], since: Date): Promise<CdcResponse> {
  return qboFetch<CdcResponse>(companyId, "/cdc", {
    query: { entities: entities.join(","), changedSince: since.toISOString() },
  });
}

/** Escape a string literal for a QuickBooks query. */
export function q(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}
