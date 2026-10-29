/**
 * The QuickBooks admin routes read tenant tables through the request's
 * tenant transaction, never the raw `db` client: in production `db` runs as
 * app_runtime, whose forced row-level security returns nothing until
 * app.tenant_id is set inside a transaction (api/database/tenant.ts). The
 * in-memory harness has no RLS, so this is checked at the source.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("routes/quickbooks.ts", () => {
  it("only touches global tables with the raw db client", () => {
    const src = readFileSync(join(import.meta.dir, "..", "quickbooks.ts"), "utf8");
    const raw = [...src.matchAll(/\bdb\s*\.\s*(select|update|insert|delete)\b[^;]*?schema\.(\w+)/gs)].map((m) => m[2]);
    expect(raw.filter((t) => t !== "idempotencyKeys")).toEqual([]);
  });
});
