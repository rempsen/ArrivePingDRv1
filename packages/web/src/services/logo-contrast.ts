/**
 * Logo contrast — which backing a tenant's logo needs to stay legible.
 *
 * Why this exists: the dispatch console shows every tenant's logo on a white
 * plate, because most trade logos are drawn for white paper (navy lettering,
 * dark marks). Logos drawn for a dark website header are the other way round:
 * a coloured mark plus WHITE lettering on a transparent background. On the
 * white plate the mark shows and the name vanishes — Towers Realty Group's
 * sidebar showed a red mark and nothing else (Dan, 2026-10-19).
 *
 * So every logo is analysed when it lands and the plate follows the logo:
 *
 *   coverage  share of the image that is opaque. ≥ 97% means the logo carries
 *             its own background (a JPEG, a PNG with a white or dark box), so
 *             it reads the same on any plate → "light".
 *   nearWhite share of the opaque pixels that are near-white (luma ≥ 230).
 *   dark      share of the opaque pixels that are dark (luma ≤ 90).
 *
 *   A transparent logo whose ink is at least 35% near-white, and lighter than
 *   it is dark, needs the dark plate. Everything else keeps the white one.
 *
 * Calibrated on the 14 tenant logos in the database on 2026-10-19: Towers
 * (69% white → dark) and Neighbourly (100% white → dark) flip; Howell's pale
 * blue (luma 227) stays under the near-white line, and Sityr's cream wordmark
 * (25% white, 22% dark) stays on white, where it reads best.
 *
 * Decoding is pure TypeScript on purpose: PNG via pngjs, JPEG via jpeg-js, SVG
 * by reading its fill colours. No native image library, so the Runable and
 * Docker builds stay as they are. WebP, GIF and ICO aren't decoded here; they
 * come back "unknown" and the browser-side check in <TenantLogo> covers them.
 */
import { eq } from "drizzle-orm";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import * as schema from "../api/database/schema";
import { sdb } from "../api/database";
import { getObjectBody } from "../api/lib/storage";
import { log } from "../api/lib/logger";

export type LogoPlate = "light" | "dark";

export interface LogoMetrics {
  /** Share of pixels (or SVG shapes) that are opaque ink. */
  coverage: number;
  /** Share of the ink that is near-white (luma ≥ 230). */
  nearWhite: number;
  /** Share of the ink that is dark (luma ≤ 90). */
  dark: number;
  /** What was read: raster pixels or SVG fills. */
  basis: "pixels" | "svg-fills";
}

export interface LogoAnalysis {
  plate: LogoPlate;
  metrics: LogoMetrics;
}

export const NEAR_WHITE_LUMA = 230;
export const DARK_LUMA = 90;
export const OPAQUE_COVERAGE = 0.97;
export const DARK_PLATE_MIN_WHITE = 0.35;

/** The rule, on its own so it can be tested without an image. */
export function decidePlate(m: Pick<LogoMetrics, "coverage" | "nearWhite" | "dark">): LogoPlate {
  if (m.coverage >= OPAQUE_COVERAGE) return "light";
  if (m.nearWhite >= DARK_PLATE_MIN_WHITE && m.nearWhite > m.dark) return "dark";
  return "light";
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Metrics from RGBA bytes. Alpha ≤ 40 counts as background. */
export function metricsFromRgba(data: Uint8Array | Buffer, width: number, height: number): LogoMetrics | null {
  const n = width * height;
  if (!n) return null;
  // Sample at most ~64k pixels; logos are small and this is a classification.
  const step = Math.max(1, Math.floor(n / 65_536));
  let seen = 0;
  let ink = 0;
  let white = 0;
  let dark = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    seen++;
    if (data[o + 3]! <= 40) continue;
    ink++;
    const l = luma(data[o]!, data[o + 1]!, data[o + 2]!);
    if (l >= NEAR_WHITE_LUMA) white++;
    else if (l <= DARK_LUMA) dark++;
  }
  if (!ink) return null;
  return { coverage: ink / seen, nearWhite: white / ink, dark: dark / ink, basis: "pixels" };
}

// ── SVG: read the fills ────────────────────────────────────────────────────
const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  navy: [0, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
};

function parseColor(raw: string): [number, number, number] | null {
  const v = raw.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent" || v === "currentcolor" || v.startsWith("url(")) return null;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return NAMED[v] ?? null;
}

/**
 * SVG fills, counted per shape. A `<style>` block's class rules are resolved
 * so Illustrator/Figma exports (`class="s0"` + `.s0 { fill: #fff }`) count.
 * Shapes are weighted equally; that is coarse, but a logo drawn for a dark
 * background has most of its shapes (the letters) in white, which is the
 * signal we need. An SVG with a background rect is counted like any other
 * shape, and either plate works for a logo that brings its own background.
 */
export function metricsFromSvg(svg: string): LogoMetrics | null {
  const classFill = new Map<string, string>();
  for (const style of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of style[1]!.matchAll(/\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
      const fill = rule[2]!.match(/fill\s*:\s*([^;]+)/i);
      if (fill) classFill.set(rule[1]!, fill[1]!);
    }
  }
  const shapes = svg.matchAll(/<(path|polygon|rect|circle|ellipse|polyline|text|tspan|use)\b([^>]*)>/gi);
  let ink = 0;
  let white = 0;
  let dark = 0;
  for (const m of shapes) {
    const attrs = m[2]!;
    let fill: string | null = null;
    const direct = attrs.match(/\bfill\s*=\s*["']([^"']+)["']/i);
    const styled = attrs.match(/\bstyle\s*=\s*["'][^"']*fill\s*:\s*([^;"']+)/i);
    const cls = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    if (direct) fill = direct[1]!;
    else if (styled) fill = styled[1]!;
    else if (cls) {
      for (const c of cls[1]!.split(/\s+/)) {
        const f = classFill.get(c);
        if (f) {
          fill = f;
          break;
        }
      }
    }
    if (fill === null && m[1]!.toLowerCase() !== "use") fill = "black"; // SVG default fill
    const rgb = fill ? parseColor(fill) : null;
    if (!rgb) continue;
    ink++;
    const l = luma(...rgb);
    if (l >= NEAR_WHITE_LUMA) white++;
    else if (l <= DARK_LUMA) dark++;
  }
  if (!ink) return null;
  // An SVG never reports itself opaque: a background rect is one shape among
  // many, and a self-contained logo reads fine on either plate anyway.
  return { coverage: 0.5, nearWhite: white / ink, dark: dark / ink, basis: "svg-fills" };
}

/** Analyse logo bytes. Returns null when the format can't be read. */
export function analyzeLogo(bytes: Uint8Array | Buffer, contentType = ""): LogoAnalysis | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const ct = contentType.toLowerCase();
  const head = buf.subarray(0, 512).toString("latin1");
  let metrics: LogoMetrics | null = null;
  try {
    if (ct.includes("svg") || /<svg[\s>]/i.test(head)) {
      metrics = metricsFromSvg(buf.toString("utf8"));
    } else if (ct.includes("png") || head.startsWith("\x89PNG")) {
      const png = PNG.sync.read(buf);
      metrics = metricsFromRgba(png.data, png.width, png.height);
    } else if (ct.includes("jpeg") || ct.includes("jpg") || head.startsWith("\xff\xd8")) {
      const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 64 });
      metrics = metricsFromRgba(j.data, j.width, j.height);
    }
  } catch (err) {
    log.warn("logo-contrast: decode failed", { err: String(err), contentType });
    return null;
  }
  if (!metrics) return null;
  return { plate: decidePlate(metrics), metrics };
}

// ── Fetching a tenant's logo bytes ──────────────────────────────────────────
async function logoBytes(logo: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const m = logo.match(/^\/api\/public\/file\/(.+)$/);
  if (m) {
    const obj = await getObjectBody(decodeURIComponent(m[1]!));
    return obj ? { bytes: obj.body, contentType: obj.contentType } : null;
  }
  if (/^https?:\/\//i.test(logo)) {
    const res = await fetch(logo, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "ArrivePing logo check" } });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "" };
  }
  return null;
}

export interface LogoPlateStatus {
  /** The plate the UI should use right now. "auto" means nobody knows yet. */
  plate: LogoPlate | "auto";
  /** Where that answer came from. */
  source: "manual" | "auto" | "none";
  /** The analysis result, if there is one for the current logo. */
  auto: LogoPlate | "";
  /** Whether the analysis is for the current logo. */
  current: boolean;
  hasLogo: boolean;
}

type SettingsLike = { logo: string; logoPlate: string; logoPlateAuto: string; logoPlateFor: string };

/** Resolve the plate from a settings row without touching storage. */
export function resolveLogoPlate(s: SettingsLike): LogoPlateStatus {
  const hasLogo = Boolean(s.logo?.trim());
  const current = hasLogo && s.logoPlateFor === s.logo && (s.logoPlateAuto === "light" || s.logoPlateAuto === "dark");
  if (s.logoPlate === "light" || s.logoPlate === "dark") {
    return { plate: s.logoPlate, source: "manual", auto: current ? (s.logoPlateAuto as LogoPlate) : "", current, hasLogo };
  }
  if (current) return { plate: s.logoPlateAuto as LogoPlate, source: "auto", auto: s.logoPlateAuto as LogoPlate, current, hasLogo };
  return { plate: "auto", source: "none", auto: "", current: false, hasLogo };
}

/**
 * Make sure the stored analysis is for the tenant's current logo, running it
 * if not (or if `force`). Returns the resolved status. Safe to call from a
 * request path: one small decode, and nothing is written when the answer is
 * already current.
 */
export async function ensureLogoPlate(companyId: string, opts: { force?: boolean } = {}): Promise<LogoPlateStatus & { metrics?: LogoMetrics }> {
  const [row] = await sdb.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, companyId)).limit(1);
  if (!row) return { plate: "auto", source: "none", auto: "", current: false, hasLogo: false };
  const before = resolveLogoPlate(row);
  if (!before.hasLogo) {
    if (row.logoPlateFor || row.logoPlateAuto) {
      await sdb.update(schema.companySettings).set({ logoPlateAuto: "", logoPlateFor: "" }).where(eq(schema.companySettings.companyId, companyId));
    }
    return before;
  }
  // `logoPlateFor === logo` means this logo was already looked at — even when
  // the format couldn't be read — so read paths don't retry on every load.
  if (row.logoPlateFor === row.logo && !opts.force) return before;

  let analysis: LogoAnalysis | null = null;
  try {
    const got = await logoBytes(row.logo);
    analysis = got ? analyzeLogo(got.bytes, got.contentType) : null;
  } catch (err) {
    log.warn("logo-contrast: fetch failed", { companyId, err: String(err) });
  }
  if (!analysis) {
    // Unknown format or unreachable file: remember that we looked, so the
    // request path doesn't retry on every page load, but leave the answer
    // empty so the browser-side check decides.
    await sdb.update(schema.companySettings).set({ logoPlateAuto: "", logoPlateFor: row.logo }).where(eq(schema.companySettings.companyId, companyId));
    return resolveLogoPlate({ ...row, logoPlateAuto: "", logoPlateFor: row.logo });
  }
  await sdb
    .update(schema.companySettings)
    .set({ logoPlateAuto: analysis.plate, logoPlateFor: row.logo })
    .where(eq(schema.companySettings.companyId, companyId));
  log.info("logo-contrast: analysed", { companyId, plate: analysis.plate, ...analysis.metrics });
  return { ...resolveLogoPlate({ ...row, logoPlateAuto: analysis.plate, logoPlateFor: row.logo }), metrics: analysis.metrics };
}

/**
 * Fire-and-forget version for read paths: never throws, never awaited.
 * Deduped per company so a burst of page loads runs one analysis.
 */
const inFlight = new Set<string>();
export function ensureLogoPlateSoon(companyId: string): void {
  if (inFlight.has(companyId)) return;
  inFlight.add(companyId);
  ensureLogoPlate(companyId)
    .catch((err) => log.warn("logo-contrast: background check failed", { companyId, err: String(err) }))
    .finally(() => inFlight.delete(companyId));
}
