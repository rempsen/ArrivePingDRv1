import { describe, expect, test } from "bun:test";
import { extractCssColors, pickBrandColorsFromCss } from "../brand-scout";

describe("extractCssColors", () => {
  test("pulls hex (3/6/8 digit) and rgb()/rgba() literals as #rrggbb", () => {
    const css = `
      :root { --brand: #0ea5e9; --bg: #070b12; --fg: #fff; }
      .btn { background: rgb(14, 165, 233); color: rgba(255,255,255,0.9); }
      .cta { border-color: #0EA5E9ff; }
    `;
    const colors = extractCssColors(css);
    expect(colors).toContain("#0ea5e9");
    expect(colors).toContain("#070b12");
    expect(colors).toContain("#ffffff");
    expect(colors.filter((c) => c === "#0ea5e9").length).toBe(3); // hex, rgb(), 8-digit
  });

  test("drops mostly-transparent colors", () => {
    const css = `.a { box-shadow: 0 0 0 1px rgba(14,165,233,0.2); background: #0ea5e933; color: #f004; }`;
    expect(extractCssColors(css)).toEqual([]);
  });

  test("accepts modern space-separated rgb() syntax", () => {
    expect(extractCssColors(".a { color: rgb(220 38 38 / 100%); }")).toEqual(["#dc2626"]);
    expect(extractCssColors(".a { color: rgb(220 38 38 / 20%); }")).toEqual([]);
  });

  test("ignores url fragments / ids that merely look like hex", () => {
    // #main is not hex; #abc is (3-digit) — only the real one should come through.
    expect(extractCssColors("#main { color: #abc }")).toEqual(["#aabbcc"]);
  });
});

describe("pickBrandColorsFromCss", () => {
  test("picks the most repeated saturated color, ignoring greys/black/white", () => {
    const colors = [
      "#070b12", "#070b12", "#070b12", "#070b12", // near-black bg, repeated a lot
      "#ffffff", "#ffffff", "#ffffff", "#ffffff",
      "#9ca3af", "#6b7280", // greys
      "#0ea5e9", "#0ea5e9", "#0ea5e9",
      "#f97316", // one orange accent
    ];
    const { primary, accent } = pickBrandColorsFromCss(colors);
    expect(primary).toBe("#0ea5e9");
    expect(accent).toBe("#f97316");
  });

  test("merges hover/active shades into their base color", () => {
    // Four distinct reds should bucket together and beat the three identical greens.
    const colors = ["#dc2626", "#ef4444", "#b91c1c", "#e11d48", "#16a34a", "#16a34a", "#16a34a"];
    const { primary } = pickBrandColorsFromCss(colors);
    expect(["#dc2626", "#ef4444", "#b91c1c", "#e11d48"]).toContain(primary);
  });

  test("a shade of the primary is not used as the accent", () => {
    const { primary, accent } = pickBrandColorsFromCss(["#0ea5e9", "#0ea5e9", "#38bdf8"]);
    expect(primary).toBe("#0ea5e9");
    expect(accent).toBeNull();
  });

  test("theme-color meta wins the primary slot when it's a real color", () => {
    const { primary, accent } = pickBrandColorsFromCss(["#f97316", "#f97316", "#0ea5e9"], "#0ea5e9");
    expect(primary).toBe("#0ea5e9");
    expect(accent).toBe("#f97316");
  });

  test("a grey/white theme-color is ignored", () => {
    const { primary } = pickBrandColorsFromCss(["#f97316", "#f97316"], "#ffffff");
    expect(primary).toBe("#f97316");
  });

  test("returns nulls when there is nothing but greys", () => {
    expect(pickBrandColorsFromCss(["#000000", "#ffffff", "#888888"])).toEqual({ primary: null, accent: null });
    expect(pickBrandColorsFromCss([])).toEqual({ primary: null, accent: null });
  });
});
