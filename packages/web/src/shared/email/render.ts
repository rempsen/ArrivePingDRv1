/**
 * Email renderer: a v2 design + the company theme -> email-client-safe HTML.
 *
 * Runs on the server for real sends and in the browser for the designer's
 * instant preview, so it has no dependencies. The markup follows the patterns
 * that hold up across Gmail, Apple Mail, Outlook.com and classic (Word-engine)
 * Outlook:
 *   - 600px container with an MSO "ghost table"; role="presentation" tables
 *   - every style inline; the <style> block only adds phone and dark tweaks
 *   - fluid-hybrid columns (inline-block divs + MSO table) that stack on phones
 *   - bulletproof buttons (padding on the link, mso-text-raise for Outlook)
 *   - images with width attributes; hidden preheader padded with &zwnj;
 *   - color-scheme light dark, with dark styles and Outlook.com [data-ogsc]
 *
 * Safety: the tenant's text is escaped; {{token}} values are escaped AND kept
 * from forming bold/links (a customer named "[x](evil)" stays text); links and
 * image addresses are allowlisted after the tokens are filled in.
 */
import {
  FONT_OPTIONS,
  defaultTheme,
  isRealLink,
  safeFinalUrl,
  type Align,
  type Block,
  type EmailDesign,
  type EmailTheme,
  type Vars,
} from "./design";

export interface EmailBrand {
  company: string;
  logoUrl?: string;
  /** Header logo height in px; 0/blank = DEFAULT_LOGO_HEIGHT. */
  logoHeight?: number;
  brandColor?: string;
  bgColor?: string;
  /** Company footer (system-built HTML: name, address, phone, links). Trusted. */
  footer?: string;
  /** Origin used to make /uploads/... links absolute. */
  origin?: string;
  theme?: EmailTheme;
}

export const DEFAULT_LOGO_HEIGHT = 80;
export const DEFAULT_BRAND = "#06B6D4";
export const CONTAINER = 600;

export function logoDims(height?: number): { height: number; maxWidth: number } {
  const h = height && height > 0 ? height : DEFAULT_LOGO_HEIGHT;
  return { height: h, maxWidth: Math.min(Math.round(h * 5.5), CONTAINER - 80) };
}

/* ---------------------------------------------------------------- colour -- */

const HEX6 = /^#?([0-9a-f]{6})$/i;
/** "#abc" or "#aabbcc" as "#aabbcc"; "" when it isn't a hex colour. */
export function hex6(c: string | null | undefined): string {
  const s = String(c ?? "").trim();
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  const m6 = HEX6.exec(s);
  return m6 ? `#${m6[1]!.toLowerCase()}` : "";
}
function rgb(hex: string): [number, number, number] | null {
  const m = HEX6.exec(hex6(hex));
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;

function relLum(hex: string): number {
  const c = rgb(hex);
  if (!c) return 1;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
/** Mix a colour toward white (amount 0..1 of white). */
export function tint(hex: string, amount: number): string {
  const c = rgb(hex);
  if (!c) return "#f3f4f6";
  return toHex(...(c.map((v) => v + (255 - v) * amount) as [number, number, number]));
}
function shade(hex: string, amount: number): string {
  const c = rgb(hex);
  if (!c) return "#0e7490";
  return toHex(...(c.map((v) => v * (1 - amount)) as [number, number, number]));
}

/** A readable label colour (near-white or near-black) on top of `bg`. */
export function contrastText(bg: string | undefined | null, light = "#ffffff", dark = "#0f172a"): string {
  if (!rgb(String(bg ?? ""))) return light;
  return contrastRatio(String(bg), light) >= contrastRatio(String(bg), dark) ? light : dark;
}

/** The brand colour darkened until it reads as text on white (links, outlines). */
function readableOnWhite(hex: string): string {
  let c = hex;
  for (let i = 0; i < 12 && contrastRatio(c, "#ffffff") < 4.5; i++) c = shade(c, 0.12);
  return c;
}

/* -------------------------------------------------------------- escaping -- */

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;
const val = (vars: Vars, k: string) => {
  const v = (vars as Record<string, unknown>)[k];
  return v == null ? "" : String(v);
};
/** Escaped value that can't form markdown (bold, italic, links). */
const neutral = (s: string) => esc(s).replace(/\*/g, "&#42;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\(/g, "&#40;").replace(/\)/g, "&#41;");

/** Template -> escaped HTML text with values filled in (no formatting). */
export function fillText(tpl: string | undefined, vars: Vars): string {
  return String(tpl ?? "")
    .split(/(\{\{\s*\w+\s*\}\})/)
    .map((part, i) => (i % 2 ? neutral(val(vars, part.replace(/[{}\s]/g, ""))) : esc(part)))
    .join("");
}

/** Template -> a safe URL for an attribute, or "" when it isn't one. */
export function fillUrl(tpl: string | undefined, vars: Vars, origin?: string): string {
  const raw = String(tpl ?? "").replace(TOKEN, (_m, k: string) => val(vars, k)).trim();
  const ok = safeFinalUrl(raw);
  if (!ok) return "";
  if (ok.startsWith("/") && origin) return esc(origin.replace(/\/$/, "") + ok);
  return esc(ok);
}

/** True when the template has tokens and every one of them is blank. */
export function tokensBlank(tpl: string | undefined, vars: Vars): boolean {
  const keys = [...String(tpl ?? "").matchAll(TOKEN)].map((m) => m[1]!);
  return keys.length > 0 && keys.every((k) => !val(vars, k).trim());
}

function inline(html: string, link: string, origin?: string): string {
  // Links become placeholders first, so bold/italic can't reach inside an href.
  const links: string[] = [];
  const withLinks = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeFinalUrl(unesc(url));
    if (!href) return label;
    const abs = href.startsWith("/") && origin ? origin.replace(/\/$/, "") + href : href;
    links.push(esc(abs));
    return `\uE000${links.length - 1}\uE001${label}\uE002`;
  });
  return withLinks
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700">$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/\uE000(\d+)\uE001([^\uE002]*)\uE002/g, (_m, i: string, label: string) => `<a href="${links[Number(i)]}" style="color:${link};text-decoration:underline">${label}</a>`);
}

/** Template -> paragraphs and bullet lists with **bold**, *italic* and [links](url). */
export function fillRich(tpl: string | undefined, vars: Vars, o: { link: string; color: string; size: number; origin?: string }): string {
  const html = fillText(String(tpl ?? "").replace(/\r\n?/g, "\n"), vars).replace(/\r\n?/g, "\n").trim();
  if (!html) return "";
  const paras = html.split(/\n{2,}/);
  return paras
    .map((p, i) => {
      const lines = p.split("\n");
      const last = i === paras.length - 1;
      const mb = last ? 0 : Math.round(o.size * 0.75);
      if (lines.every((l) => /^\s*(?:[-•*])\s+/.test(l))) {
        const items = lines.map((l) => `<li style="margin:0 0 6px 0;padding:0">${inline(l.replace(/^\s*(?:[-•*])\s+/, ""), o.link, o.origin)}</li>`).join("");
        return `<ul style="margin:0 0 ${mb}px 0;padding:0 0 0 22px;list-style:disc;color:${o.color}">${items}</ul>`;
      }
      return `<p style="margin:0 0 ${mb}px 0">${lines.map((l) => inline(l, o.link, o.origin)).join("<br>")}</p>`;
    })
    .join("");
}

/* --------------------------------------------------------------- context -- */

export interface Ctx {
  brand: EmailBrand;
  theme: EmailTheme;
  vars: Vars;
  editor: boolean;
  accent: string;
  accentText: string;
  /** Brand colour too pale to carry white text or a header of its own. */
  paleAccent: boolean;
  link: string;
  font: string;
  googleFont?: string;
  text: string;
  heading: string;
  muted: string;
  border: string;
  pageBg: string;
  cardBg: string;
  radius: { card: number; box: number; btn: number };
  weight: number;
  header: EmailTheme["header"];
  padX: number;
  contentWidth: number;
}

export function makeCtx(brand: EmailBrand, vars: Vars, opts: { editor?: boolean } = {}): Ctx {
  const theme = brand.theme ?? defaultTheme();
  const accent = hex6(brand.brandColor) || DEFAULT_BRAND.toLowerCase();
  const paleAccent = contrastRatio(accent, "#ffffff") < 1.6;
  const font = FONT_OPTIONS.find((f) => f.key === theme.font) ?? FONT_OPTIONS[0]!;
  const corner = { sharp: { card: 0, box: 0 }, soft: { card: 12, box: 8 }, round: { card: 20, box: 14 } }[theme.corners];
  const btn = { square: Math.min(4, corner.box), rounded: 8, pill: 999 }[theme.buttonShape];
  const flat = theme.layout === "flat";
  let header = theme.header;
  if ((header === "brand" || header === "gradient") && paleAccent) header = "light";
  const padX = 40;
  return {
    brand,
    theme,
    vars,
    editor: !!opts.editor,
    accent,
    accentText: contrastText(accent),
    paleAccent,
    link: readableOnWhite(accent),
    font: font.stack,
    googleFont: font.google,
    text: theme.textColor || "#374151",
    heading: "#111827",
    muted: "#6b7280",
    border: "#e5e7eb",
    pageBg: flat ? "#ffffff" : hex6(brand.bgColor) || "#f3f4f6",
    cardBg: "#ffffff",
    radius: { card: flat ? 0 : corner.card, box: corner.box, btn },
    weight: { medium: 600, bold: 700, heavy: 800 }[theme.headingWeight],
    header,
    padX,
    // minus the card's 1px borders, so two columns that fill it never wrap
    contentWidth: CONTAINER - padX * 2 - 2,
  };
}

/* ---------------------------------------------------------------- blocks -- */

const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const table = (inner: string, attrs = "", style = "") =>
  `<table ${T} width="100%" ${attrs} style="width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;${style}">${inner}</table>`;
const bid = (ctx: Ctx, b: Block) => (ctx.editor ? ` data-bid="${esc(b.id)}"` : "");
const wrap = (ctx: Ctx, b: Block, inner: string, pb: number, align: Align = "left") =>
  table(`<tr><td align="${align}" style="padding:0 0 ${pb}px 0;text-align:${align}">${inner}</td></tr>`, `${bid(ctx, b)} class="ap-block"`);

function placeholder(ctx: Ctx, b: Block, label: string): string {
  if (!ctx.editor) return "";
  return wrap(
    ctx,
    b,
    `<div style="border:1px dashed #cbd5e1;border-radius:${ctx.radius.box}px;padding:18px;text-align:center;color:#94a3b8;font-size:13px;font-family:${ctx.font}">${esc(label)}</div>`,
    20,
    "center",
  );
}

function button(ctx: Ctx, b: Extract<Block, { type: "button" }>): string {
  const filled = fillUrl(b.url, ctx.vars, ctx.brand.origin);
  // A button whose link came out blank (no tracking page for this job) is left out.
  if (!filled && !ctx.editor) return "";
  const href = filled || "#";
  const label = fillText(b.label, ctx.vars) || "Open";
  const align = b.align || "left";
  const r = ctx.radius.btn;
  if (b.variant === "link") {
    return wrap(ctx, b, `<a href="${href}" style="color:${ctx.link};font-weight:700;font-size:16px;text-decoration:none;font-family:${ctx.font}">${label}&nbsp;&rarr;</a>`, 24, align);
  }
  const outline = b.variant === "outline";
  // A near-white brand colour can't carry a button: use near-black instead.
  const solid = ctx.paleAccent ? "#111827" : ctx.accent;
  const bg = outline ? "#ffffff" : solid;
  const color = outline ? ctx.link : contrastText(solid);
  const border = outline ? ctx.link : solid;
  const full = b.full ? "display:block;text-align:center;" : "display:inline-block;";
  // Padding sits on the link so the whole button is clickable; Outlook ignores
  // link padding, so the <i>/<span> pair raises the text inside a box of the
  // same size (the "bulletproof button" pattern).
  const a =
    `<a href="${href}" class="ap-btn${outline ? " ap-btn-o" : ""}" style="${full}background:${bg};color:${color};border:2px solid ${border};border-radius:${r}px;font-family:${ctx.font};font-size:16px;font-weight:700;line-height:20px;padding:13px 26px;text-decoration:none;mso-padding-alt:0;text-underline-color:${bg}">` +
    `<!--[if mso]><i style="mso-font-width:150%;mso-text-raise:20pt" hidden>&emsp;&emsp;</i><span style="mso-text-raise:10pt"><![endif]-->${label}<!--[if mso]></span><i style="mso-font-width:150%" hidden>&emsp;&emsp;&#8203;</i><![endif]--></a>`;
  return wrap(ctx, b, a, 24, align);
}

function heading(ctx: Ctx, b: Extract<Block, { type: "heading" }>): string {
  const lvl = b.level ?? 1;
  const size = { 1: 28, 2: 22, 3: 18 }[lvl];
  const lh = { 1: 1.25, 2: 1.3, 3: 1.4 }[lvl];
  const text = fillText(b.text, ctx.vars);
  if (!text && !ctx.editor) return "";
  return wrap(
    ctx,
    b,
    `<h${lvl} class="ap-h ap-h${lvl}" style="margin:0;font-family:${ctx.font};font-size:${size}px;line-height:${lh};font-weight:${ctx.weight};letter-spacing:${lvl === 1 ? "-0.02em" : "-0.01em"};color:${ctx.heading};mso-line-height-rule:exactly">${inline(text, ctx.link, ctx.brand.origin)}</h${lvl}>`,
    lvl === 1 ? 14 : 10,
    b.align || "left",
  );
}

function text(ctx: Ctx, b: Extract<Block, { type: "text" }>): string {
  const small = b.tone === "small";
  const size = small ? 13 : 16;
  const color = b.tone === "muted" || small ? ctx.muted : ctx.text;
  const html = fillRich(b.text, ctx.vars, { link: ctx.link, color, size, origin: ctx.brand.origin });
  if (!html && !ctx.editor) return "";
  return wrap(
    ctx,
    b,
    `<div class="${b.tone === "muted" || small ? "ap-m" : "ap-t"}" style="font-family:${ctx.font};font-size:${size}px;line-height:1.6;color:${color};mso-line-height-rule:exactly">${html || "&nbsp;"}</div>`,
    small ? 12 : 18,
    b.align || "left",
  );
}

function image(ctx: Ctx, b: Extract<Block, { type: "image" }>, width: number): string {
  const src = fillUrl(b.url, ctx.vars, ctx.brand.origin);
  if (!src) return placeholder(ctx, b, "Image: add a picture in the panel on the right");
  const w = Math.min(b.width || width, width);
  const align = b.align || "center";
  const margin = align === "center" ? "margin:0 auto" : align === "right" ? "margin:0 0 0 auto" : "margin:0";
  let img = `<img src="${src}" width="${w}" alt="${esc(b.alt || "")}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${ctx.radius.box}px;${margin}">`;
  const href = fillUrl(b.href, ctx.vars, ctx.brand.origin);
  if (href) img = `<a href="${href}" style="text-decoration:none">${img}</a>`;
  return wrap(ctx, b, img, 20, align);
}

function details(ctx: Ctx, b: Extract<Block, { type: "details" }>): string {
  const rows = b.rows.filter((r) => r.label || r.value);
  if (!rows.length) return placeholder(ctx, b, "Details: add rows in the panel on the right");
  const boxed = b.style !== "lines";
  const tr = rows
    .map((r, i) => {
      const line = i === 0 ? (boxed ? "" : `border-top:1px solid ${ctx.border};`) : `border-top:1px solid ${boxed ? "#eceef1" : ctx.border};`;
      const pad = boxed ? "11px 18px" : "11px 0";
      return `<tr><td class="ap-m ap-line" valign="top" style="${line}padding:${pad};width:38%;font-family:${ctx.font};font-size:14px;line-height:1.5;color:${ctx.muted}">${fillText(r.label, ctx.vars)}</td><td class="ap-h ap-line" valign="top" style="${line}padding:${pad};padding-left:${boxed ? 8 : 12}px;font-family:${ctx.font};font-size:14px;line-height:1.5;font-weight:600;color:${ctx.heading}">${fillText(r.value, ctx.vars) || "&mdash;"}</td></tr>`;
    })
    .join("");
  const titled = b.title
    ? `<div class="ap-m" style="font-family:${ctx.font};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${ctx.muted};padding:0 0 8px 0">${fillText(b.title, ctx.vars)}</div>`
    : "";
  const inner = boxed
    ? table(tr, `bgcolor="#f9fafb" class="ap-box"`, `background:#f9fafb;border:1px solid ${ctx.border};border-radius:${ctx.radius.box}px;border-collapse:separate`)
    : table(tr, "", `border-bottom:1px solid ${ctx.border}`);
  return wrap(ctx, b, titled + inner, 22);
}

const TONES = {
  info: { bar: "#2563eb", bg: "#eff6ff" },
  success: { bar: "#16a34a", bg: "#f0fdf4" },
  warning: { bar: "#d97706", bg: "#fffbeb" },
} as const;

function callout(ctx: Ctx, b: Extract<Block, { type: "callout" }>): string {
  const tone = b.tone === "brand" || !b.tone ? { bar: ctx.paleAccent ? "#9ca3af" : ctx.accent, bg: tint(ctx.paleAccent ? "#9ca3af" : ctx.accent, 0.9) } : TONES[b.tone];
  const html = fillRich(b.text, ctx.vars, { link: ctx.link, color: "#1f2937", size: 15, origin: ctx.brand.origin });
  if (!html && !ctx.editor) return "";
  return wrap(
    ctx,
    b,
    table(
      `<tr><td class="ap-t" style="padding:14px 18px;font-family:${ctx.font};font-size:15px;line-height:1.55;color:#1f2937">${html || "&nbsp;"}</td></tr>`,
      `bgcolor="${tone.bg}" class="ap-box"`,
      `background:${tone.bg};border-left:4px solid ${tone.bar};border-radius:${ctx.radius.box}px;border-collapse:separate`,
    ),
    20,
  );
}

function eta(ctx: Ctx, b: Extract<Block, { type: "eta" }>): string {
  const blank = tokensBlank(b.value, ctx.vars);
  const value = blank ? fillText(b.fallback, ctx.vars) : fillText(b.value, ctx.vars);
  if (!value.trim() && !ctx.editor) return "";
  const bg = ctx.paleAccent ? tint("#111827", 0.94) : ctx.accent;
  const fg = ctx.paleAccent ? "#111827" : ctx.accentText;
  const label = fillText(b.label, ctx.vars);
  const note = fillText(b.note, ctx.vars);
  const inner =
    (label ? `<div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.85;padding:0 0 6px 0">${label}</div>` : "") +
    `<div class="ap-eta" style="font-size:${blank ? 26 : 40}px;line-height:1.1;font-weight:800;letter-spacing:-0.02em">${value || "&nbsp;"}</div>` +
    (note ? `<div style="font-size:15px;line-height:1.5;padding:8px 0 0 0;opacity:0.92">${note}</div>` : "");
  return wrap(
    ctx,
    b,
    table(
      `<tr><td align="center" style="padding:24px 20px;text-align:center;font-family:${ctx.font};color:${fg}">${inner}</td></tr>`,
      `bgcolor="${bg}"`,
      `background:${bg};border-radius:${ctx.radius.box}px;border-collapse:separate`,
    ),
    22,
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

function tech(ctx: Ctx, b: Extract<Block, { type: "tech" }>): string {
  const rawName = String(b.name ?? "").replace(TOKEN, (_m, k: string) => val(ctx.vars, k)).trim();
  const name = fillText(b.name, ctx.vars);
  const role = fillText(b.role, ctx.vars);
  const note = fillText(b.note, ctx.vars);
  const photo = fillUrl(b.photo, ctx.vars, ctx.brand.origin);
  const avBg = ctx.paleAccent ? "#e5e7eb" : ctx.accent;
  const avatar = photo
    ? `<img src="${photo}" width="56" height="56" alt="${esc(rawName)}" style="display:block;width:56px;height:56px;border-radius:50%;border:0;object-fit:cover">`
    : table(
        `<tr><td width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;border-radius:50%;background:${avBg};color:${contrastText(avBg)};font-family:${ctx.font};font-size:20px;font-weight:700;text-align:center">${esc(initials(rawName))}</td></tr>`,
        `bgcolor="${avBg}"`,
        "width:56px;border-radius:50%;border-collapse:separate",
      ).replace('width="100%"', 'width="56"');
  const body =
    `<div class="ap-h" style="font-family:${ctx.font};font-size:17px;line-height:1.35;font-weight:700;color:${ctx.heading}">${name || "&nbsp;"}</div>` +
    (role ? `<div class="ap-m" style="font-family:${ctx.font};font-size:14px;line-height:1.5;color:${ctx.muted}">${role}</div>` : "") +
    (note ? `<div class="ap-t" style="font-family:${ctx.font};font-size:14px;line-height:1.5;color:${ctx.text};padding-top:4px">${note}</div>` : "");
  return wrap(
    ctx,
    b,
    table(
      `<tr><td width="56" valign="middle" style="width:56px;padding:16px 0 16px 16px">${avatar}</td><td valign="middle" style="padding:16px 16px 16px 14px">${body}</td></tr>`,
      `class="ap-box" bgcolor="#ffffff"`,
      `border:1px solid ${ctx.border};border-radius:${ctx.radius.box}px;border-collapse:separate`,
    ),
    20,
  );
}

function socialLinks(ctx: Ctx, align: Align): string {
  const links = ctx.theme.social.filter((s) => s.label.trim() && isRealLink(s.url));
  if (!links.length) return "";
  return links
    .map((s) => {
      const href = fillUrl(s.url, ctx.vars, ctx.brand.origin);
      if (!href) return "";
      return `<a href="${href}" class="ap-pill" style="display:inline-block;margin:0 ${align === "center" ? 4 : 8}px 8px 0;padding:7px 14px;border:1px solid #d1d5db;border-radius:999px;font-family:${ctx.font};font-size:13px;font-weight:600;line-height:16px;color:#374151;text-decoration:none">${esc(s.label)}</a>`;
    })
    .join("");
}

function social(ctx: Ctx, b: Extract<Block, { type: "social" }>): string {
  const html = socialLinks(ctx, b.align || "center");
  if (!html) return placeholder(ctx, b, "Social links: add yours in the Theme tab");
  return wrap(ctx, b, html, 14, b.align || "center");
}

function columns(ctx: Ctx, b: Extract<Block, { type: "columns" }>): string {
  const total = ctx.contentWidth;
  const half = 12; // half the gutter, on the inner side of each column
  const [l, r] = { "1:1": [1, 1], "1:2": [1, 2], "2:1": [2, 1] }[b.ratio || "1:1"] as [number, number];
  const w1 = Math.floor((total * l) / (l + r));
  const w2 = total - w1;
  const col = (blocks: Block[], w: number, side: "left" | "right") => {
    const inner = blocks.map((x) => renderBlock(ctx, x, w - half)).join("") || (ctx.editor ? `<div style="height:40px"></div>` : "");
    const pad = side === "left" ? `padding:0 ${half}px 0 0` : `padding:0 0 0 ${half}px`;
    return `<div class="ap-col" style="display:inline-block;width:100%;max-width:${w}px;vertical-align:top;text-align:left;font-size:16px"><div class="ap-colin" style="${pad}">${inner}</div></div>`;
  };
  // Fluid hybrid: the two inline-blocks sit side by side when there is room
  // and wrap (full width on phones) when there isn't; Outlook gets a table.
  const mso1 = `<!--[if mso]><table ${T} width="${total}"><tr><td width="${w1}" valign="top"><![endif]-->`;
  const mso2 = `<!--[if mso]></td><td width="${w2}" valign="top"><![endif]-->`;
  const mso3 = `<!--[if mso]></td></tr></table><![endif]-->`;
  const inner = `<div class="ap-cols" style="font-size:0;text-align:left">${mso1}${col(b.cols[0], w1, "left")}${mso2}${col(b.cols[1], w2, "right")}${mso3}</div>`;
  return wrap(ctx, b, inner, 6);
}

export function renderBlock(ctx: Ctx, b: Block, width = ctx.contentWidth): string {
  switch (b.type) {
    case "heading":
      return heading(ctx, b);
    case "text":
      return text(ctx, b);
    case "button":
      return button(ctx, b);
    case "image":
      return image(ctx, b, width);
    case "details":
      return details(ctx, b);
    case "callout":
      return callout(ctx, b);
    case "eta":
      return eta(ctx, b);
    case "tech":
      return tech(ctx, b);
    case "columns":
      return columns(ctx, b);
    case "social":
      return social(ctx, b);
    case "divider":
      return wrap(ctx, b, table(`<tr><td style="border-top:1px solid ${ctx.border};font-size:0;line-height:0;height:1px" class="ap-line">&nbsp;</td></tr>`), 24);
    case "spacer": {
      const h = { sm: 8, md: 20, lg: 40 }[b.size || "md"];
      return table(`<tr><td style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`, `${bid(ctx, b)} class="ap-block"`);
    }
  }
}

/* ----------------------------------------------------------------- frame -- */

function logoSize(ctx: Ctx): { w: number; h: number; maxWidth: number } {
  const { height, maxWidth } = logoDims(ctx.brand.logoHeight);
  const ratio = ctx.theme.logoRatio;
  let h = height;
  let w = ratio ? Math.round(h * ratio) : 0;
  if (w > maxWidth) {
    w = maxWidth;
    h = Math.round(w / ratio);
  }
  return { w, h, maxWidth };
}

function logoImg(ctx: Ctx): string {
  const src = fillUrl(ctx.brand.logoUrl, {}, ctx.brand.origin);
  if (!src) return "";
  const { w, h } = logoSize(ctx);
  // width/height attributes size it in Outlook; the styles let it shrink on phones.
  const size = w ? `width="${w}" height="${h}" ` : `height="${h}" `;
  const style = w ? `width:100%;max-width:${w}px;height:auto` : `height:${h}px;width:auto;max-width:100%`;
  return `<img src="${src}" ${size}alt="${esc(ctx.brand.company)}" style="display:block;${style};border:0;outline:none;text-decoration:none;${ctx.theme.logoAlign === "center" ? "margin:0 auto" : "margin:0"}">`;
}

function wordmark(ctx: Ctx, color: string): string {
  return `<span class="${color === ctx.heading ? "ap-h" : ""}" style="font-family:${ctx.font};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${color}">${esc(ctx.brand.company)}</span>`;
}

/** The header at the top of the card (empty for "Logo only", which sits above the card). */
export function renderHeader(ctx: Ctx): string {
  const align = ctx.theme.logoAlign;
  const logo = logoImg(ctx);
  const r = ctx.radius.card;
  const top = `border-radius:${r}px ${r}px 0 0`;
  if (ctx.header === "none") return "";
  if (ctx.header === "light") {
    const bar = table(`<tr><td height="4" bgcolor="${ctx.paleAccent ? "#d1d5db" : ctx.accent}" style="height:4px;line-height:4px;font-size:0;background:${ctx.paleAccent ? "#d1d5db" : ctx.accent};${top}">&nbsp;</td></tr>`);
    return (
      bar +
      table(
        `<tr><td align="${align}" class="ap-pad ap-lhead" bgcolor="#ffffff" style="padding:28px ${ctx.padX}px 24px;text-align:${align};background:#ffffff;border-bottom:1px solid #f0f1f3">${logo || wordmark(ctx, ctx.heading)}</td></tr>`,
      )
    );
  }
  const bgImage = ctx.header === "gradient" ? `background-image:linear-gradient(135deg,${ctx.accent} 0%,${shade(ctx.accent, 0.28)} 100%);` : "";
  const mark = logo
    ? ctx.theme.logoBacking
      ? `<table ${T} ${align === "center" ? 'align="center"' : ""} ${logoSize(ctx).w ? `width="${logoSize(ctx).w + 32}"` : ""} style="border-collapse:separate;${logoSize(ctx).w ? `width:100%;max-width:${logoSize(ctx).w + 32}px;` : ""}${align === "center" ? "margin:0 auto" : ""}"><tr><td class="ap-plate" bgcolor="#ffffff" style="background:#ffffff;padding:10px 16px;border-radius:${Math.max(6, ctx.radius.box)}px">${logo}</td></tr></table>`
      : logo
    : wordmark(ctx, ctx.accentText);
  return table(
    `<tr><td align="${align}" class="ap-pad" bgcolor="${ctx.accent}" style="padding:30px ${ctx.padX}px;text-align:${align};background-color:${ctx.accent};${bgImage}${top}">${mark}</td></tr>`,
  );
}

/** Logo above the card, for the "Logo only" header. */
export function renderAboveCard(ctx: Ctx): string {
  if (ctx.header !== "none") return "";
  const align = ctx.theme.logoAlign;
  return table(`<tr><td align="${align}" style="padding:0 ${ctx.theme.layout === "flat" ? ctx.padX : 4}px 20px;text-align:${align}">${logoImg(ctx) || wordmark(ctx, ctx.heading)}</td></tr>`);
}

/**
 * The company footer is stored as a little HTML (buildEmailFooter) but can be
 * edited by hand, so only bold, italics, line breaks and safe links survive;
 * every other tag and attribute is dropped and stray "<" is escaped.
 */
export function sanitizeFooter(html: string, link = "inherit"): string {
  return String(html ?? "")
    .replace(/<[^>]*>?/g, (tag) => {
      const t = tag.toLowerCase();
      const simple = /^<\s*(\/?)\s*(strong|b|em|i)\s*>$/.exec(t) || /^<\s*(\/?)\s*(strong|b|em|i)\s[^>]*>$/.exec(t);
      if (simple) return `<${simple[1]}${simple[2] === "b" ? "strong" : simple[2] === "i" ? "em" : simple[2]}>`;
      if (/^<\s*br\s*\/?\s*>$/.test(t)) return "<br>";
      if (/^<\s*\/\s*a\s*>$/.test(t)) return "</a>";
      const a = /^<\s*a\s[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>$/i.exec(tag);
      if (a) {
        const href = safeFinalUrl(unesc(a[2] ?? a[3] ?? ""));
        return href ? `<a href="${esc(href)}" style="color:${link};text-decoration:underline">` : "<a>";
      }
      return tag.endsWith(">") ? "" : esc(tag);
    });
}

/** Company footer at the bottom of the card. */
export function renderCardFooter(ctx: Ctx): string {
  const footer = ctx.theme.showFooter ? String(ctx.brand.footer || "").trim() : "";
  if (!footer) return "";
  const filled = sanitizeFooter(footer).replace(TOKEN, (_m, k: string) => esc(val(ctx.vars, k)));
  return table(
    `<tr><td align="center" class="ap-pad ap-m ap-line" style="padding:22px ${ctx.padX}px 26px;border-top:1px solid ${ctx.border};text-align:center;font-family:${ctx.font};font-size:13px;line-height:1.6;color:${ctx.muted}">${filled}</td></tr>`,
  );
}

/** Social links and the "Sent by" line under the card. */
export function renderBelowCard(ctx: Ctx): string {
  const links = socialLinks(ctx, "center");
  return table(
    `<tr><td align="center" style="padding:24px 16px 0;text-align:center">${links ? `<div style="padding:0 0 10px 0">${links}</div>` : ""}<div class="ap-m" style="font-family:${ctx.font};font-size:12px;line-height:1.6;color:#9ca3af">Sent by ${esc(ctx.brand.company)}</div></td></tr>`,
  );
}

/** Preview text: the design's own, else the first words of the email. */
export function preheaderText(design: EmailDesign, vars: Vars): string {
  if (design.preheader.trim()) return fillText(design.preheader, vars);
  for (const b of design.blocks) {
    const t = b.type === "text" || b.type === "callout" ? b.text : b.type === "eta" ? (tokensBlank(b.value, vars) ? b.fallback || "" : `${b.label} ${b.value}`) : "";
    if (t.trim()) {
      const plain = unesc(fillText(t, vars)).replace(/\*\*|\*|\[|\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
      return esc(plain.length > 140 ? `${plain.slice(0, 137)}…` : plain);
    }
  }
  return "";
}

function styleBlock(): string {
  return `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
u+#body a{color:inherit;text-decoration:none}
@media (max-width:620px){
.ap-pad{padding-left:24px!important;padding-right:24px!important}
.ap-col{max-width:100%!important}
.ap-colin{padding:0!important}
.ap-h1{font-size:24px!important}
.ap-eta{font-size:34px!important}
.ap-outer{padding:16px 8px!important}
}
@media (prefers-color-scheme:dark){
.ap-bg{background:#0b0f17!important}
.ap-card{background:#111827!important;border-color:#1f2937!important}
.ap-h{color:#f3f4f6!important}
.ap-t{color:#d1d5db!important}
.ap-m{color:#9ca3af!important}
.ap-box{background:#1f2937!important;border-color:#374151!important}
.ap-line{border-color:#374151!important}
.ap-pill{color:#e5e7eb!important;border-color:#4b5563!important}
.ap-btn-o{background:#111827!important}
}
[data-ogsc] .ap-h{color:#f3f4f6!important}
[data-ogsc] .ap-t{color:#d1d5db!important}
[data-ogsc] .ap-m{color:#9ca3af!important}
</style>`;
}

/** Visual settings the in-page designer canvas mirrors. */
export function shellStyle(ctx: Ctx) {
  const flat = ctx.theme.layout === "flat";
  return {
    pageBg: ctx.pageBg,
    cardBg: ctx.cardBg,
    cardBorder: flat ? "none" : `1px solid ${ctx.border}`,
    cardRadius: ctx.radius.card,
    padX: ctx.padX,
    font: ctx.font,
    googleFont: ctx.googleFont,
    flat,
  };
}

export function googleFontHref(spec?: string): string {
  return spec ? `https://fonts.googleapis.com/css2?family=${spec.replace(/ /g, "+")}&display=swap` : "";
}

/** The full email document. */
export function renderEmail(design: EmailDesign, brand: EmailBrand, vars: Vars, opts: { editor?: boolean; lang?: string } = {}): string {
  const ctx = makeCtx(brand, vars, opts);
  const s = shellStyle(ctx);
  const pre = preheaderText(design, vars);
  const body = design.blocks.map((b) => renderBlock(ctx, b)).join("");
  const font = ctx.googleFont ? `<link href="${googleFontHref(ctx.googleFont)}" rel="stylesheet">` : "";
  const msoFont = ctx.theme.font === "classic" ? "Georgia,serif" : "'Segoe UI',Arial,sans-serif";
  const card = table(
    `<tr><td style="padding:0">${renderHeader(ctx)}${table(`<tr><td class="ap-pad" style="padding:36px ${ctx.padX}px 16px;font-family:${ctx.font}">${body}</td></tr>`)}${renderCardFooter(ctx)}</td></tr>`,
    `class="ap-card" bgcolor="${s.cardBg}"`,
    `background:${s.cardBg};${s.flat ? "" : `border:${s.cardBorder};`}border-radius:${s.cardRadius}px;border-collapse:separate;overflow:hidden`,
  );
  return `<!DOCTYPE html>
<html lang="${esc(opts.lang || "en")}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(brand.company)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>body,table,td,p,a,span,h1,h2,h3,div,li{font-family:${msoFont}!important}</style><![endif]-->
${font}
${styleBlock()}
</head>
<body id="body" class="ap-bg" style="margin:0;padding:0;width:100%;background:${s.pageBg};word-spacing:normal">
<div role="article" aria-roledescription="email" aria-label="${esc(brand.company)}" lang="${esc(opts.lang || "en")}" dir="ltr" style="font-size:16px;font-family:${ctx.font};background:${s.pageBg}" class="ap-bg">
${pre ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${s.pageBg}">${pre}${"&#847;&zwnj;&nbsp;".repeat(70)}</div>` : ""}
${table(
  `<tr><td align="center" class="ap-outer" style="padding:${s.flat ? "28px 0 24px" : "32px 12px"}">
<!--[if mso]><table ${T} width="${CONTAINER}" align="center"><tr><td><![endif]-->
<div style="max-width:${CONTAINER}px;margin:0 auto">
${renderAboveCard(ctx)}${card}${renderBelowCard(ctx)}
</div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`,
  `class="ap-bg" bgcolor="${s.pageBg}"`,
  `background:${s.pageBg}`,
)}
</div>
</body>
</html>`;
}

/**
 * A plain message (the same copy as the text/in-app) in the branded frame:
 * the event title, the message, a "View details" button and the job line.
 */
export function renderPlainMessage(title: string, message: string, brand: EmailBrand, vars: Vars): string {
  // The title and message are already filled in: they go in as VALUES, so
  // they are escaped and anything in them (a customer's name) can't become
  // formatting or a link.
  const v = vars as Record<string, unknown>;
  const jobLine = [v.service, v.when, v.address].map((x) => (x == null ? "" : String(x).trim())).filter(Boolean).join(" · ");
  const design: EmailDesign = {
    v: 2,
    preheader: "{{__message}}",
    blocks: [
      { id: "m1", type: "heading", text: "{{__title}}", level: 2 },
      { id: "m2", type: "text", text: "{{__message}}" },
      { id: "m3", type: "button", label: "View details", url: "{{trackUrl}}", variant: "solid" },
      { id: "m4", type: "text", text: "{{__jobLine}}", tone: "small" },
    ],
  };
  const short = message.length > 140 ? `${message.slice(0, 137)}…` : message;
  return renderEmail({ ...design, preheader: short ? "{{__short}}" : "" }, brand, { ...vars, __title: title, __message: message, __short: short, __jobLine: jobLine });
}
