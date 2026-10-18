/**
 * PHONE SCREENS CAN'T GO STALE.
 *
 * The site's app screenshots (public/img/site/app) are served under fixed
 * names, and the CDN tells browsers to keep images for hours. When a screen
 * was repainted in place (the grey Safari header on the customer pages), people
 * who had visited earlier kept seeing the old grey version. Every screenshot
 * URL in the site config therefore carries ?v=<first 8 of the file's sha256>,
 * so a changed file is a new URL. This fails when a file changes and its
 * ?v= wasn't updated, or a screenshot is referenced without one.
 */
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "../../..");
const config = readFileSync(join(WEB, "src/web/site/config.ts"), "utf8");
const refs = [...config.matchAll(/"(\/img\/site\/app\/[^"?]+)(\?v=([a-f0-9]+))?"/g)];

describe("site phone screenshots are versioned by their content", () => {
  it("finds the screenshots", () => {
    expect(refs.length).toBeGreaterThan(5);
  });

  for (const [, path, , v] of refs) {
    it(`${path} has ?v= matching the file`, () => {
      const hash = createHash("sha256").update(readFileSync(join(WEB, "public", path!))).digest("hex").slice(0, 8);
      expect({ path, v: v ?? null }).toEqual({ path, v: hash });
    });
  }
});
