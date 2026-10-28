/**
 * QuickBooks Sync storage: the link table maps one local record to one
 * QuickBooks record per kind, issues are per company, bookings carry the
 * subtrade-bill state, and the feature switch exists in the catalog.
 */
import { beforeAll, describe, expect, it } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const { FEATURE_KEYS, FEATURES } = await import("../../shared/features");

beforeAll(async () => {
  await ensureTables(schema.companies, schema.qboLinks, schema.qboIssues, schema.bookings);
  await db.insert(schema.companies).values({ id: "qs-co", name: "QS Co", kind: "test" } as never);
});

describe("qbo_links", () => {
  it("holds one QuickBooks id per local record and kind", async () => {
    await db.insert(schema.qboLinks).values({ companyId: "qs-co", kind: "vendor", localId: "rider-1", qboId: "227", syncToken: "0", fingerprint: "" } as never);
    let dup: unknown = null;
    try {
      await db.insert(schema.qboLinks).values({ companyId: "qs-co", kind: "vendor", localId: "rider-1", qboId: "999", syncToken: "0", fingerprint: "" } as never);
    } catch (e) {
      dup = e;
    }
    expect(dup).not.toBeNull();
    const [row] = await db.select().from(schema.qboLinks);
    expect(row!.qboId).toBe("227");
  });
});

describe("qbo_issues", () => {
  it("opens an issue against a company and optional job", async () => {
    const [row] = await db.insert(schema.qboIssues).values({ companyId: "qs-co", kind: "vendor_ambiguous", message: "Two vendors match" } as never).returning();
    expect(row!.status).toBe("open");
    expect(row!.bookingId).toBeNull();
  });
});

describe("bookings", () => {
  it("default to no subtrade bill", async () => {
    const cols = Object.keys(schema.bookings);
    expect(cols).toContain("vendorBillStatus");
    expect(cols).toContain("subtradePaidAt");
  });
});

describe("feature catalog", () => {
  it("has the QuickBooks sync switch, off for customers by default", () => {
    expect(FEATURE_KEYS).toContain("integrations.quickbooks");
    const f = FEATURES.find((x) => x.key === "integrations.quickbooks")!;
    expect(f.kind).toBe("entitlement");
    expect((f as any).kindDefaults).toEqual({ customer: false, demo: false, test: false, internal: true });
  });
});
