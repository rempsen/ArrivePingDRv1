/**
 * The record of every website scan: what share read the site, how, and which
 * sites did not. Before this a failed scan left only a log line.
 */
import { beforeAll, describe, expect, test } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const { hostOfSite, recordScanRun, scanHealth, scansForCompany, summarizeScans } = await import("../scan-runs");

const at = (mins: number) => new Date(Date.UTC(2026, 10, 13, 12, mins));

describe("summarizeScans", () => {
  test("counts reads, the hosted browser, and failures by reason", () => {
    const h = summarizeScans(
      [
        { host: "a.ca", status: "ok", via: "direct", createdAt: at(1) },
        { host: "b.ca", status: "ok", via: "render", createdAt: at(2) },
        { host: "c.ca", status: "partial", via: "render", createdAt: at(3) },
        { host: "d.ca", status: "blocked", via: "", createdAt: at(4) },
        { host: "d.ca", status: "blocked", via: "", createdAt: at(5) },
        { host: "e.ca", status: "timeout", via: "", createdAt: at(6) },
        { host: "", status: "invalid_url", via: "", createdAt: at(7) },
        { host: "f.ca", status: "unreachable", via: "", createdAt: at(8) },
      ],
      30,
    );
    expect(h).toMatchObject({ total: 8, ok: 2, partial: 1, failed: 5, viaRender: 2, readPct: 38 });
    expect(h.byReason).toEqual({ blocked: 2, timeout: 1, invalid_url: 1, unreachable: 1 });
    // newest first, one line per site, none for a scan with no host
    expect(h.recentFailures.map((f) => f.host)).toEqual(["f.ca", "e.ca", "d.ca"]);
    expect(h.recentFailures[2]!.at).toBe(at(5).toISOString());
  });

  test("no scans is not 0% or 100%", () => {
    expect(summarizeScans([], 30)).toMatchObject({ total: 0, readPct: null, recentFailures: [] });
  });

  test("all read", () => {
    expect(summarizeScans([{ host: "a.ca", status: "ok", via: "direct", createdAt: at(1) }], 7).readPct).toBe(100);
  });
});

describe("hostOfSite", () => {
  test.each([
    ["valleyfiber.ca", "valleyfiber.ca"],
    ["https://www.ValleyFiber.ca/business/", "valleyfiber.ca"],
    ["http://shop.acme.com:8080/x", "shop.acme.com"],
    ["not a url at all", ""],
    ["", ""],
  ])("%s", (input, want) => {
    expect(hostOfSite(input)).toBe(want);
  });
});

describe("stored scans", () => {
  beforeAll(async () => {
    await ensureTables(schema.scanRuns);
  });

  test("a company sees its own scans and the ones made on its website before it existed", async () => {
    await recordScanRun({ website: "https://www.acme-rec.ca/", status: "blocked", via: null, httpStatus: 403, pagesRead: 0, ms: 900, source: "signup" });
    await recordScanRun({ website: "acme-rec.ca", status: "ok", via: "render", httpStatus: 200, pagesRead: 6, ms: 24_000, source: "fallback", companyId: "acme-rec" });
    await recordScanRun({ website: "other-rec.ca", status: "ok", via: "direct", httpStatus: 200, pagesRead: 3, ms: 9_000, source: "signup" });
    await recordScanRun({ website: "other-rec.ca", status: "ok", via: "direct", httpStatus: 200, pagesRead: 3, ms: 9_000, source: "rescan", companyId: "someone-else" });

    const mine = await scansForCompany("acme-rec", "https://acme-rec.ca");
    expect(mine.map((r) => [r.status, r.source]).sort()).toEqual([
      ["blocked", "signup"],
      ["ok", "fallback"],
    ]);
    expect(mine.find((r) => r.status === "ok")).toMatchObject({ host: "acme-rec.ca", via: "render", pagesRead: 6, ms: 24_000 });
    // No website on file: only scans recorded against the company itself.
    expect((await scansForCompany("acme-rec", "")).length).toBe(1);
  });

  test("health over the window counts what was stored", async () => {
    const h = await scanHealth(30);
    expect(h.total).toBeGreaterThanOrEqual(4);
    expect(h.byReason.blocked).toBeGreaterThanOrEqual(1);
    expect(h.recentFailures.some((f) => f.host === "acme-rec.ca")).toBe(true);
  });
});
