/**
 * EVERY OFFICE REQUEST CARRIES THE TENANT.
 *
 * A raw fetch that sends only the bearer token is answered for the signed-in
 * person's home company. For a superadmin switched into another company, or
 * acting as one from the Control Hub, that is the wrong company: the dispatch
 * messenger listed ArrivePing's own staff while Dan was acting as Prairie
 * Comfort HVAC, so Prairie's technicians couldn't be messaged. Raw fetches
 * must build their headers with apiHeaders() (lib/api.ts), which adds
 * X-Company-Id and X-Act-As.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
/** Files allowed to read the token directly: the auth layer itself. */
const ALLOWED = new Set(["lib/auth.ts", "lib/api.ts", "lib/act-as.ts"]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("raw fetches send the tenant headers", () => {
  const offenders = files(ROOT)
    .map((p) => ({ rel: p.slice(ROOT.length + 1), src: readFileSync(p, "utf8") }))
    .filter(({ rel, src }) => !ALLOWED.has(rel) && /getToken\(\)/.test(src) && /fetch\(/.test(src) && !/apiHeaders\(\)/.test(src))
    .map(({ rel }) => rel);

  it("no component builds its own token-only headers", () => {
    expect(offenders).toEqual([]);
  });

  it("the dispatch messenger uses apiHeaders()", () => {
    const src = readFileSync(join(ROOT, "components/dispatch-messenger.tsx"), "utf8");
    expect(src).toContain("apiHeaders()");
    expect(src).not.toContain("getToken");
  });
});
