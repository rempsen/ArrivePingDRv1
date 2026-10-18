import { describe, expect, it } from "bun:test";
import { chapters, exportFormats, featuresMeta, milestones } from "../../web/site/content/features";
import { nav } from "../../web/site/config";

describe("features page content", () => {
  it("has unique chapter ids and numbered chapters in order", () => {
    expect(new Set(chapters.map((c) => c.id)).size).toBe(chapters.length);
    chapters.forEach((c, i) => expect(c.n).toBe(String(i + 1).padStart(2, "0")));
  });
  it("gives every tile a title and text", () => {
    for (const c of chapters) for (const t of c.tiles) expect(t.title && t.text && t.icon).toBeTruthy();
  });
  it("covers the four export formats and the milestone texts", () => {
    expect([...exportFormats]).toEqual(["CSV", "Excel", "PDF", "JSON"]);
    expect(milestones.length).toBeGreaterThanOrEqual(3);
  });
  it("is in the header nav", () => {
    expect(nav.some((n) => n.label === "Features" && n.href === "/features")).toBe(true);
    expect(featuresMeta.path).toBe("/features");
  });
});
