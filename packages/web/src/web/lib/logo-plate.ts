/**
 * Browser-side twin of services/logo-contrast.ts: read a loaded <img>'s pixels
 * and say which plate it needs. Used when the server hasn't analysed the logo
 * yet ("auto"), or couldn't (WebP, GIF, ICO — the browser decodes those fine).
 *
 * Same rule as the server so the two never disagree:
 *   opaque (≥ 97% coverage)                     → light
 *   ink ≥ 35% near-white and whiter than dark   → dark
 *   otherwise                                   → light
 *
 * Returns null when the pixels can't be read — a cross-origin image taints the
 * canvas — in which case the caller keeps the default white plate.
 */
export type LogoPlate = "light" | "dark";

export const NEAR_WHITE_LUMA = 230;
export const DARK_LUMA = 90;
export const OPAQUE_COVERAGE = 0.97;
export const DARK_PLATE_MIN_WHITE = 0.35;

export function decidePlate(m: { coverage: number; nearWhite: number; dark: number }): LogoPlate {
  if (m.coverage >= OPAQUE_COVERAGE) return "light";
  if (m.nearWhite >= DARK_PLATE_MIN_WHITE && m.nearWhite > m.dark) return "dark";
  return "light";
}

export function metricsFromRgba(data: Uint8ClampedArray | Uint8Array, n: number): { coverage: number; nearWhite: number; dark: number } | null {
  let ink = 0;
  let white = 0;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3]! <= 40) continue;
    ink++;
    const l = 0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!;
    if (l >= NEAR_WHITE_LUMA) white++;
    else if (l <= DARK_LUMA) dark++;
  }
  if (!ink || !n) return null;
  return { coverage: ink / n, nearWhite: white / ink, dark: dark / ink };
}

/** Which plate a loaded image needs, or null if its pixels can't be read. */
export function plateForImage(img: HTMLImageElement): LogoPlate | null {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    // Downsample to ≤ 128px on the long side: plenty for a classification and
    // cheap enough to run on every sidebar render.
    const scale = Math.min(1, 128 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);
    const m = metricsFromRgba(data, cw * ch);
    return m ? decidePlate(m) : null;
  } catch {
    // Tainted canvas (cross-origin logo without CORS) or a browser that
    // refuses getImageData. Keep the default plate.
    return null;
  }
}
