import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chapters, exportFormats, featuresMeta, industries, jobPhotos, screens } from "../../web/site/content/features";
import { nav } from "../../web/site/config";
import { INDUSTRY_PRESETS } from "../../services/industry-presets";

const PUBLIC = join(import.meta.dir, "../../../public");

/** Pixel size of a lossy/lossless WebP, read from its header. */
async function webpSize(path: string) {
  const b = new Uint8Array(await Bun.file(path).arrayBuffer());
  const tag = String.fromCharCode(...b.slice(12, 16));
  if (tag === "VP8 ") return { w: (b[26]! | (b[27]! << 8)) & 0x3fff, h: (b[28]! | (b[29]! << 8)) & 0x3fff };
  if (tag === "VP8L") {
    const n = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
  }
  return { w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
}

describe("features page content", () => {
  it("has unique chapter ids and numbered chapters in order", () => {
    expect(new Set(chapters.map((c) => c.id)).size).toBe(chapters.length);
    chapters.forEach((c, i) => expect(c.n).toBe(String(i + 1).padStart(2, "0")));
  });
  it("gives every tile a title and text", () => {
    for (const c of chapters) for (const t of c.tiles) expect(t.title && t.text && t.icon).toBeTruthy();
  });
  it("covers the four export formats", () => {
    expect([...exportFormats]).toEqual(["CSV", "Excel", "PDF", "JSON"]);
  });
  it("is in the header nav", () => {
    expect(nav.some((n) => n.label === "Features" && n.href === "/features")).toBe(true);
    expect(featuresMeta.path).toBe("/features");
  });
  it("lists exactly the 18 researched industries, with their workflows", () => {
    const presets = INDUSTRY_PRESETS.filter((p) => p.tier !== "alias");
    expect(industries.length).toBe(18);
    expect(industries.map((i) => i.id)).toEqual(presets.map((p) => p.id));
    for (const i of industries) {
      const p = presets.find((x) => x.id === i.id)!;
      expect(i.label).toBe(p.label);
      expect(i.workflows).toEqual(p.templates);
      expect(i.workflows.length).toBeGreaterThan(0);
    }
  });
  it("points every screen at a real image of the declared size, with alt text", async () => {
    for (const [id, list] of Object.entries(screens)) {
      expect(chapters.some((c) => c.id === id)).toBe(true);
      for (const s of list) {
        const file = join(PUBLIC, s.src);
        expect(existsSync(file)).toBe(true);
        expect(await webpSize(file)).toEqual({ w: s.w, h: s.h });
        expect(s.alt.length).toBeGreaterThan(20);
      }
    }
    for (const p of jobPhotos) {
      expect(existsSync(join(PUBLIC, `${p.src}.webp`))).toBe(true);
      expect(existsSync(join(PUBLIC, `${p.src}.jpg`))).toBe(true);
    }
  });
});
