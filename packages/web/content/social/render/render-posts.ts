/**
 * Render ArrivePing social post images (1080x1350, 4:5) from a card list.
 *
 *   bun content/social/render/render-posts.ts content/social/cards/<batch>.json
 *
 * The card file is a JSON array of:
 *   { "out": "public/social/<batch>/<name>.png",   // relative to packages/web
 *     "kicker": "What the customer sees",           // small caps label, top right
 *     "html": "<h1>…</h1><p class=\"lead\">…</p>",  // body; classes from post-template.html
 *     "pill": "Real screen from the app",           // optional, bottom-left pill
 *     "light": false }                               // optional light theme
 *
 * Images inside `html` must be REAL app screenshots from public/img/site/app/
 * (reference them as ../../../public/img/site/app/<file>.webp). Never draw mock UI.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface Card { out: string; kicker: string; html: string; pill?: string; light?: boolean }

const WEB = resolve(import.meta.dir, "..", "..", "..");
const file = process.argv[2];
if (!file) {
  console.error("usage: bun content/social/render/render-posts.ts <cards.json>");
  process.exit(1);
}
const cards = JSON.parse(readFileSync(resolve(WEB, file), "utf8")) as Card[];
const template = "file://" + join(WEB, "content/social/render/post-template.html");

// Playwright is deliberately not a repo dependency: the Claude cloud sessions
// that run the drafter ship a pre-installed Playwright + Chromium, and a second
// copy would not find that browser. Elsewhere, install it locally with --no-save (see below).
let chromium: typeof import("playwright").chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not available. From packages/web, install it without\n" +
      "touching package.json or the lockfile, then run this script again:\n" +
      "  bun add --no-save playwright && bunx playwright install chromium",
  );
  process.exit(1);
}

const browser = await chromium.launch();
try {
  for (const card of cards) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.addInitScript((c) => { (window as unknown as { CARD: Card }).CARD = c; }, card);
    await page.goto(template);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const out = resolve(WEB, card.out);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    await page.close();
    console.log("rendered", card.out);
  }
} finally {
  await browser.close();
}
