/**
 * Email block renderer — converts a JSON block design into branded, email-safe
 * inline-styled HTML. Used both by the dispatch sender (real emails) and the
 * /preview endpoint. The web editor has a mirrored TS copy for live preview.
 *
 * A "design" is an array of blocks. Each block:
 *   { type: "heading" | "text" | "button" | "image" | "divider" | "spacer" | "details", ... }
 */

export type EmailBlock =
  | { type: "heading"; text: string; align?: "left" | "center" | "right"; size?: "sm" | "md" | "lg" }
  | { type: "text"; text: string; align?: "left" | "center" | "right" }
  | { type: "button"; label: string; url: string; align?: "left" | "center" | "right" }
  | { type: "image"; url: string; alt?: string; width?: number; align?: "left" | "center" | "right" }
  | { type: "divider" }
  | { type: "spacer"; size?: "sm" | "md" | "lg" }
  | { type: "details"; rows: { label: string; value: string }[] };

export interface EmailBrand {
  company: string;
  logoUrl?: string;
  // header logo height in px. Unset/0 renders at the DEFAULT_LOGO_HEIGHT default.
  logoHeight?: number;
  brandColor?: string;
  headerStyle?: "gradient" | "solid" | "minimal";
  bgColor?: string;
  footer?: string;
  // base origin to resolve relative logo paths (e.g. /uploads/x.png)
  origin?: string;
}

/**
 * Header logo used to render at a hardcoded 40px tall everywhere. Doubled to
 * 80px as the new baseline default (Dan: "make it twice as large as it is
 * now"), applied automatically to every tenant that hasn't picked a custom
 * size yet — see emailLogoHeight on notification_channels.
 */
export const DEFAULT_LOGO_HEIGHT = 80;
// Keep the header logo's max-width proportional to its height, same ratio the
// old hardcoded 40px/220px pair used, so wide logos never get cropped oddly
// as the size control moves.
export function logoDims(height?: number): { height: number; maxWidth: number } {
  const h = height && height > 0 ? height : DEFAULT_LOGO_HEIGHT;
  return { height: h, maxWidth: Math.round(h * 5.5) };
}

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** light formatting inside text blocks: **bold**, *italic*, [label](url), and newlines */
function inlineFormat(s: string): string {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => `<a href="${url}" style="color:inherit;text-decoration:underline">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/\n/g, "<br/>");
  return out;
}

function resolveUrl(url: string, origin?: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
  if (origin && url.startsWith("/")) return origin.replace(/\/$/, "") + url;
  return url;
}

function renderBlock(b: EmailBlock, brand: EmailBrand, interp: (s: string) => string): string {
  const accent = brand.brandColor || "#06B6D4";
  switch (b.type) {
    case "heading": {
      const sizes = { sm: 17, md: 21, lg: 26 } as const;
      const fs = sizes[b.size || "md"];
      return `<tr><td style="padding:4px 0 10px 0;text-align:${b.align || "left"}"><h1 style="margin:0;font-size:${fs}px;line-height:1.3;font-weight:800;color:#0f172a">${inlineFormat(interp(b.text))}</h1></td></tr>`;
    }
    case "text":
      return `<tr><td style="padding:6px 0;text-align:${b.align || "left"};font-size:15px;line-height:1.65;color:#334155">${inlineFormat(interp(b.text))}</td></tr>`;
    case "button": {
      const al = b.align || "left";
      const textColor = contrastText(accent);
      // A subtle border so the button keeps a visible pill outline even when
      // accent is white/near-white against the card's own white background —
      // without it a white-on-white button has correct (readable) text but no
      // visible edges at all, still looking broken.
      return `<tr><td style="padding:14px 0;text-align:${al}"><a href="${esc(interp(b.url))}" style="display:inline-block;background:${accent};color:${textColor};text-decoration:none;font-weight:700;font-size:15px;padding:12px 29px;border:1px solid rgba(15,23,42,0.14);border-radius:10px">${esc(interp(b.label))}</a></td></tr>`;
    }
    case "image": {
      const al = b.align || "center";
      const w = b.width ? `width:${b.width}px;max-width:100%;` : "max-width:100%;";
      return `<tr><td style="padding:10px 0;text-align:${al}"><img src="${esc(resolveUrl(interp(b.url), brand.origin))}" alt="${esc(b.alt || "")}" style="${w}border-radius:10px;display:inline-block"/></td></tr>`;
    }
    case "divider":
      return `<tr><td style="padding:14px 0"><div style="height:1px;background:#e2e8f0;width:100%"></div></td></tr>`;
    case "spacer": {
      const h = { sm: 8, md: 18, lg: 32 } as const;
      return `<tr><td style="height:${h[b.size || "md"]}px;line-height:${h[b.size || "md"]}px;font-size:0">&nbsp;</td></tr>`;
    }
    case "details": {
      const rows = (b.rows || [])
        .filter((r) => r && (r.label || r.value))
        .map(
          (r) =>
            `<tr><td style="padding:7px 0;color:#94a3b8;font-size:14px;width:140px;vertical-align:top">${esc(interp(r.label))}</td><td style="padding:7px 0;font-weight:600;color:#0f172a;font-size:14px">${esc(interp(r.value))}</td></tr>`
        )
        .join("");
      return `<tr><td style="padding:8px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:6px 16px"><tbody>${rows}</tbody></table></td></tr>`;
    }
    default:
      return "";
  }
}

/** Render a full branded email from a block design. */
export function renderEmailDesign(
  blocks: EmailBlock[],
  brand: EmailBrand,
  interpolate: (s: string) => string = (s) => s
): string {
  const accent = brand.brandColor || "#06B6D4";
  const bg = brand.bgColor || "#f1f5f9";
  const style = brand.headerStyle || "gradient";
  const logo = brand.logoUrl ? resolveUrl(brand.logoUrl, brand.origin) : "";

  const headerBg =
    style === "gradient"
      ? `background:linear-gradient(135deg,${accent},${shade(accent)})`
      : style === "solid"
        ? `background:${accent}`
        : "background:#ffffff;border-bottom:1px solid #e2e8f0";
  const headerColor = style === "minimal" ? "#0f172a" : contrastText(accent);

  const { height: logoH, maxWidth: logoMaxW } = logoDims(brand.logoHeight);
  const brandMark = logo
    ? `<img src="${logo}" alt="${esc(brand.company)}" style="height:${logoH}px;max-width:${logoMaxW}px;display:inline-block"/>`
    : `<span style="font-size:24px;font-weight:800;color:${headerColor};letter-spacing:-0.5px">${esc(brand.company)}</span>`;

  const body = (blocks || []).map((b) => renderBlock(b, brand, interpolate)).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${bg};font-family:'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${bg}"><tr><td style="padding:28px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="width:100%;max-width:580px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 28px rgba(2,6,23,0.10)">
      <tr><td style="${headerBg};padding:26px 32px;text-align:center">${brandMark}</td></tr>
      <tr><td style="padding:30px 34px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tbody>${body}</tbody></table>
      </td></tr>
      ${
        brand.footer
          ? // Footer is system-generated markup (buildEmailFooter in dispatch.ts —
            // <strong>/<a>/<br/> for the company name, address, phone, email, site)
            // so it must render as trusted HTML, not run through inlineFormat's
            // esc()-then-markdown pass — that was escaping the tags into visible
            // "<strong>Company</strong>" text instead of rendering them.
            `<tr><td style="padding:18px 34px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center">${interpolate(brand.footer)}</td></tr>`
          : ""
      }
    </table>
    <p style="text-align:center;color:#94a3b8;font-size:11px;margin:18px 0 0">Sent by ${esc(brand.company)}</p>
  </td></tr></table>
</body></html>`;
}

/** darken a hex color ~25% for gradient end-stop */
function shade(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#0e7490";
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 255) * 0.7) | 0;
  const g = Math.max(0, ((n >> 8) & 255) * 0.7) | 0;
  const b = Math.max(0, (n & 255) * 0.7) | 0;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Pick a readable text color (near-white or near-black) for text/icons sitting
 * on top of a `bg` color, using perceived luminance (WCAG-ish weighting).
 * Every button/header/CTA in the email system paints its label in a hardcoded
 * white on top of the tenant's `brandColor` — invisible whenever a tenant sets
 * a light/white brand color (e.g. a black-and-white logo brand). This is the
 * single source of truth other files import to fix that instead of hardcoding.
 */
export function contrastText(bg: string | undefined | null, light = "#ffffff", dark = "#0f172a"): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg ?? "").trim());
  if (!m) return light;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance (0 = black, 255 = white).
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 165 ? dark : light;
}

/** Plain-text fallback derived from blocks (for the email `text` field). */
export function designToText(blocks: EmailBlock[], interpolate: (s: string) => string = (s) => s): string {
  return (blocks || [])
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "text":
          return interpolate(b.text || "");
        case "button":
          return `${interpolate(b.label || "")}: ${interpolate(b.url || "")}`;
        case "details":
          return (b.rows || []).map((r) => `${interpolate(r.label)}: ${interpolate(r.value)}`).join("\n");
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Starter designs available out of the box (also seeded as builtin templates). */
export function starterDesigns(): { name: string; description: string; subject: string; design: EmailBlock[] }[] {
  return [
    {
      name: "Job Update",
      description: "Clean status update with job details and a tracking button.",
      subject: "{{company}}: update on your {{service}}",
      design: [
        { type: "heading", text: "Hi {{firstName}}, here's an update", size: "lg" },
        { type: "text", text: "Your job **{{jobName}}** (#{{jobNumber}}) has a new update. Here are the details:" },
        {
          type: "details",
          rows: [
            { label: "Service", value: "{{service}}" },
            { label: "When", value: "{{when}}" },
            { label: "Address", value: "{{address}}" },
            { label: "Technician", value: "{{techName}}" },
          ],
        },
        { type: "button", label: "Track live", url: "{{trackUrl}}", align: "left" },
        { type: "spacer", size: "sm" },
        { type: "text", text: "Questions? Just reply to this email." },
      ],
    },
    {
      name: "Appointment Confirmed",
      description: "Friendly booking confirmation with a green confirmed banner.",
      subject: "Booking confirmed — {{service}}",
      design: [
        { type: "heading", text: "You're all set, {{firstName}} 🎉", size: "lg" },
        { type: "text", text: "Your appointment is **confirmed**. We'll let you know the moment a pro is on the way." },
        {
          type: "details",
          rows: [
            { label: "Service", value: "{{service}}" },
            { label: "When", value: "{{when}}" },
            { label: "Address", value: "{{address}}" },
            { label: "Total", value: "{{price}}" },
          ],
        },
        { type: "button", label: "View booking", url: "{{trackUrl}}" },
      ],
    },
    {
      name: "Receipt",
      description: "Payment receipt with itemized total.",
      subject: "Your receipt from {{company}}",
      design: [
        { type: "heading", text: "Payment received ✓", size: "lg" },
        { type: "text", text: "Thanks {{firstName}}! Here's your receipt." },
        {
          type: "details",
          rows: [
            { label: "Service", value: "{{service}}" },
            { label: "Job #", value: "{{jobNumber}}" },
            { label: "Amount", value: "{{price}}" },
            { label: "Status", value: "PAID" },
          ],
        },
        { type: "divider" },
        { type: "text", text: "We appreciate your business. — {{company}}" },
      ],
    },
  ];
}
