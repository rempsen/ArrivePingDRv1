/**
 * The record of every website scan (table `scan_runs`).
 *
 * Until now a failed scan left nothing behind but a log line, so nobody could
 * say how often the scan fails, on which sites, or whether a company's thin
 * setup came from a thin site or a site we never got into. One small row per
 * attempt answers all three. Recording is best-effort: it never fails a scan.
 */
import { and, desc, eq, gte, or } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";

export type ScanSource = "signup" | "fallback" | "rescan" | "superadmin" | "check" | "demo";

export interface ScanRunInput {
  website: string;
  status: string;
  via: string | null;
  httpStatus: number | null;
  pagesRead: number;
  ms: number;
  source: ScanSource;
  /** Only a real company id: never the placeholder slug used before signup. */
  companyId?: string;
}

export function hostOfSite(website: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase().slice(0, 200);
  } catch {
    return "";
  }
}

export async function recordScanRun(r: ScanRunInput): Promise<void> {
  try {
    await sdb.insert(schema.scanRuns).values({
      companyId: r.companyId ?? "",
      host: hostOfSite(r.website),
      status: r.status.slice(0, 20),
      via: r.via ?? "",
      httpStatus: r.httpStatus,
      pagesRead: Math.max(0, Math.min(1000, Math.round(r.pagesRead))),
      ms: Math.max(0, Math.round(r.ms)),
      source: r.source,
    });
  } catch (e) {
    log.warn("scan-runs: could not record a scan", { err: String(e) });
  }
}

export interface ScanRunRow {
  id: string;
  host: string;
  status: string;
  via: string;
  httpStatus: number | null;
  pagesRead: number;
  ms: number;
  source: string;
  createdAt: string;
}

/** A company's scans, newest first: its own, plus any made on its website before it existed. */
export async function scansForCompany(companyId: string, website: string, limit = 8): Promise<ScanRunRow[]> {
  const host = hostOfSite(website);
  try {
    const rows = await sdb
      .select()
      .from(schema.scanRuns)
      .where(host ? or(eq(schema.scanRuns.companyId, companyId), and(eq(schema.scanRuns.host, host), eq(schema.scanRuns.companyId, ""))) : eq(schema.scanRuns.companyId, companyId))
      .orderBy(desc(schema.scanRuns.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, host: r.host, status: r.status, via: r.via, httpStatus: r.httpStatus, pagesRead: r.pagesRead, ms: r.ms, source: r.source, createdAt: new Date(r.createdAt).toISOString() }));
  } catch {
    return [];
  }
}

export interface ScanHealth {
  days: number;
  total: number;
  /** Read with something to show. */
  ok: number;
  /** Read, but the site had little on it. */
  partial: number;
  /** Not read at all. */
  failed: number;
  /** Of those read, how many needed the hosted browser. */
  viaRender: number;
  byReason: Record<string, number>;
  /** Share of scans that read the site, 0 to 100; null when there were none. */
  readPct: number | null;
  /** Hosts that failed most recently, newest first, one line each. */
  recentFailures: { host: string; status: string; at: string }[];
}

export function summarizeScans(rows: { host: string; status: string; via: string; createdAt: Date | string }[], days: number): ScanHealth {
  const h: ScanHealth = { days, total: rows.length, ok: 0, partial: 0, failed: 0, viaRender: 0, byReason: {}, readPct: null, recentFailures: [] };
  const seen = new Set<string>();
  for (const r of [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
    if (r.status === "ok" || r.status === "partial") {
      h[r.status]++;
      if (r.via === "render") h.viaRender++;
      continue;
    }
    h.failed++;
    h.byReason[r.status] = (h.byReason[r.status] ?? 0) + 1;
    if (r.host && !seen.has(r.host) && h.recentFailures.length < 8) {
      seen.add(r.host);
      h.recentFailures.push({ host: r.host, status: r.status, at: new Date(r.createdAt).toISOString() });
    }
  }
  if (h.total) h.readPct = Math.round(((h.ok + h.partial) / h.total) * 100);
  return h;
}

/** Scans in the last `days`: how many read the site, how, and which did not. Signup scans only by default. */
export async function scanHealth(days = 30, now = new Date()): Promise<ScanHealth> {
  try {
    const since = new Date(now.getTime() - days * 86_400_000);
    const rows = await sdb
      .select({ host: schema.scanRuns.host, status: schema.scanRuns.status, via: schema.scanRuns.via, createdAt: schema.scanRuns.createdAt })
      .from(schema.scanRuns)
      .where(gte(schema.scanRuns.createdAt, since))
      .orderBy(desc(schema.scanRuns.createdAt))
      .limit(5_000);
    return summarizeScans(rows, days);
  } catch {
    return summarizeScans([], days);
  }
}
