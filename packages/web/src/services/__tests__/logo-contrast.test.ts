/**
 * Logo contrast (services/logo-contrast.ts): which plate a logo needs.
 *
 * The rule is calibrated on the tenant logos that were in the database on
 * 2026-10-19; the fixtures here are the shapes of those files, not copies.
 */
import { describe, it, expect } from "bun:test";
import { PNG } from "pngjs";
import { analyzeLogo, decidePlate, metricsFromRgba, metricsFromSvg, resolveLogoPlate } from "../logo-contrast";

process.env.DATABASE_URL = ":memory:";

/** A PNG with a transparent background and the given share of white vs dark ink. */
function png(opts: { size?: number; coverage: number; whiteShare: number; opaqueBg?: "white" | "dark" }): Buffer {
  const size = opts.size ?? 64;
  const p = new PNG({ width: size, height: size });
  const n = size * size;
  const inkCount = Math.round(n * opts.coverage);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const isInk = i < inkCount;
    if (opts.opaqueBg) {
      const bg = opts.opaqueBg === "white" ? 255 : 16;
      p.data[o] = p.data[o + 1] = p.data[o + 2] = bg;
      p.data[o + 3] = 255;
    } else {
      p.data[o] = p.data[o + 1] = p.data[o + 2] = 0;
      p.data[o + 3] = 0;
    }
    if (isInk) {
      const white = i < inkCount * opts.whiteShare;
      const v = white ? 250 : 20;
      p.data[o] = v;
      p.data[o + 1] = v;
      p.data[o + 2] = v;
      p.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(p);
}

describe("decidePlate", () => {
  it("keeps an opaque logo on the white plate whatever its colours", () => {
    expect(decidePlate({ coverage: 1, nearWhite: 0.79, dark: 0.2 })).toBe("light"); // BMD: white box, dark text
    expect(decidePlate({ coverage: 0.98, nearWhite: 0.05, dark: 0.9 })).toBe("light");
  });
  it("sends white-lettered transparent logos to the dark plate", () => {
    expect(decidePlate({ coverage: 0.36, nearWhite: 0.69, dark: 0.31 })).toBe("dark"); // Towers Realty
    expect(decidePlate({ coverage: 0.32, nearWhite: 1, dark: 0 })).toBe("dark"); // Neighbourly
  });
  it("keeps dark-lettered and mixed logos on white", () => {
    expect(decidePlate({ coverage: 0.26, nearWhite: 0, dark: 0.48 })).toBe("light"); // Prairie Comfort
    expect(decidePlate({ coverage: 0.3, nearWhite: 0.25, dark: 0.22 })).toBe("light"); // Sityr, cream wordmark
    expect(decidePlate({ coverage: 0.5, nearWhite: 0.4, dark: 0.5 })).toBe("light"); // more dark than white
  });
});

describe("metricsFromRgba", () => {
  it("ignores transparent pixels and classifies the ink", () => {
    const buf = png({ coverage: 0.4, whiteShare: 0.75 });
    const p = PNG.sync.read(buf);
    const m = metricsFromRgba(p.data, p.width, p.height)!;
    expect(m.coverage).toBeCloseTo(0.4, 1);
    expect(m.nearWhite).toBeCloseTo(0.75, 1);
    expect(m.dark).toBeCloseTo(0.25, 1);
  });
  it("returns null for a fully transparent image", () => {
    const p = PNG.sync.read(png({ coverage: 0, whiteShare: 0 }));
    expect(metricsFromRgba(p.data, p.width, p.height)).toBeNull();
  });
});

describe("metricsFromSvg", () => {
  it("reads direct fills: a red mark with white lettering is mostly white", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 96">
      <polygon fill="#C41230" points="0,0 10,10 0,10"/>
      <polygon fill="#C41230" points="0,0 10,10 0,10"/>
      <path fill="#FFFFFF" d="M0 0h10v10z"/>
      <path fill="#FFFFFF" d="M0 0h10v10z"/>
      <path fill="#FFFFFF" d="M0 0h10v10z"/>
      <path fill="#FFFFFF" d="M0 0h10v10z"/>
    </svg>`;
    const m = metricsFromSvg(svg)!;
    expect(m.basis).toBe("svg-fills");
    expect(m.nearWhite).toBeCloseTo(4 / 6, 2);
    expect(decidePlate(m)).toBe("dark");
  });
  it("resolves class fills from a <style> block", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><style>.s0 { fill: #ffffff } .s1{fill:#111}</style>
      <path class="s0" d="M0 0"/><path class="s0" d="M0 0"/><path class="s0" d="M0 0"/><path class="s1" d="M0 0"/></svg>`;
    const m = metricsFromSvg(svg)!;
    expect(m.nearWhite).toBeCloseTo(0.75, 2);
    expect(decidePlate(m)).toBe("dark");
  });
  it("treats pale blue as not white and unfilled shapes as black", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path fill="#C7EAFB" d="M0 0"/><path fill="#C7EAFB" d="M0 0"/><path fill="#002D5B" d="M0 0"/><path d="M0 0"/></svg>`;
    const m = metricsFromSvg(svg)!;
    expect(m.nearWhite).toBe(0);
    expect(m.dark).toBeCloseTo(0.5, 2);
    expect(decidePlate(m)).toBe("light");
  });
  it("skips gradients, none and currentColor", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="none"/><path fill="url(#g)"/><path fill="currentColor"/></svg>`;
    expect(metricsFromSvg(svg)).toBeNull();
  });
});

describe("analyzeLogo", () => {
  it("decodes a PNG and decides", () => {
    expect(analyzeLogo(png({ coverage: 0.4, whiteShare: 0.9 }), "image/png")!.plate).toBe("dark");
    expect(analyzeLogo(png({ coverage: 0.4, whiteShare: 0.1 }), "image/png")!.plate).toBe("light");
    expect(analyzeLogo(png({ coverage: 0.4, whiteShare: 0.9, opaqueBg: "dark" }), "image/png")!.plate).toBe("light");
  });
  it("sniffs the format when the content type is missing", () => {
    expect(analyzeLogo(png({ coverage: 0.4, whiteShare: 0.9 }))!.plate).toBe("dark");
    expect(analyzeLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff"/></svg>'))!.plate).toBe("dark");
  });
  it("returns null for formats it doesn't read", () => {
    expect(analyzeLogo(Buffer.from([0, 0, 1, 0, 1, 0]), "image/x-icon")).toBeNull();
    expect(analyzeLogo(Buffer.from("not an image"), "image/webp")).toBeNull();
  });
});

describe("resolveLogoPlate", () => {
  const base = { logo: "/api/public/file/brand%2Fx%2Flogo.svg", logoPlate: "auto", logoPlateAuto: "dark", logoPlateFor: "/api/public/file/brand%2Fx%2Flogo.svg" };
  it("uses the analysis when it is for the current logo", () => {
    expect(resolveLogoPlate(base)).toMatchObject({ plate: "dark", source: "auto", current: true });
  });
  it("is unknown once the logo changes, until it is analysed again", () => {
    expect(resolveLogoPlate({ ...base, logo: "/api/public/file/brand%2Fx%2Flogo-2.png" })).toMatchObject({ plate: "auto", source: "none", current: false });
  });
  it("lets a staff override win, and still reports what the file reads as", () => {
    expect(resolveLogoPlate({ ...base, logoPlate: "light" })).toMatchObject({ plate: "light", source: "manual", auto: "dark" });
  });
  it("has nothing to say without a logo", () => {
    expect(resolveLogoPlate({ ...base, logo: "" })).toMatchObject({ plate: "auto", hasLogo: false });
  });
});
