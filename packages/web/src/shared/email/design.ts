/**
 * Notification email designs (v2) and the company email theme.
 *
 * A design is data, not HTML: a list of blocks plus the inbox preview text.
 * It is stored as JSON on a notification rule (email_design) or a saved
 * template, rendered by ./render.ts on the server for real sends and in the
 * browser for the designer's instant preview.
 *
 * v1 designs (a bare array of the original seven block types) are still read:
 * normalizeDesign() lifts them to v2 without changing their words.
 */

export type Align = "left" | "center" | "right";

export type Block =
  | { id: string; type: "heading"; text: string; level?: 1 | 2 | 3; align?: Align }
  | { id: string; type: "text"; text: string; align?: Align; tone?: "normal" | "muted" | "small" }
  | { id: string; type: "button"; label: string; url: string; align?: Align; variant?: "solid" | "outline" | "link"; full?: boolean }
  | { id: string; type: "image"; url: string; alt?: string; width?: number; align?: Align; href?: string }
  | { id: string; type: "details"; title?: string; rows: { label: string; value: string }[]; style?: "boxed" | "lines" }
  | { id: string; type: "callout"; text: string; tone?: "info" | "success" | "warning" | "brand" }
  | { id: string; type: "eta"; label: string; value: string; note?: string; fallback?: string }
  | { id: string; type: "tech"; name: string; photo?: string; role?: string; note?: string }
  | { id: string; type: "columns"; ratio?: "1:1" | "1:2" | "2:1"; cols: [Block[], Block[]] }
  | { id: string; type: "social"; align?: Align }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; size?: "sm" | "md" | "lg" };

export type BlockType = Block["type"];

export interface EmailDesign {
  v: 2;
  /** The grey line inboxes show after the subject. Blank = taken from the first text. */
  preheader: string;
  blocks: Block[];
}

export const BLOCK_TYPES: BlockType[] = ["heading", "text", "button", "image", "details", "callout", "eta", "tech", "columns", "social", "divider", "spacer"];

/** What can go inside a column (no columns in columns). */
export const COLUMN_CHILD_TYPES: BlockType[] = ["heading", "text", "button", "image", "details", "callout", "tech", "social", "divider", "spacer"];

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  button: "Button",
  image: "Image",
  details: "Details",
  callout: "Callout",
  eta: "ETA banner",
  tech: "Technician card",
  columns: "Two columns",
  social: "Social links",
  divider: "Divider",
  spacer: "Spacer",
};

export const BLOCK_HINTS: Record<BlockType, string> = {
  heading: "A title line",
  text: "Paragraphs, bold, links, lists",
  button: "A call to action",
  image: "A photo or graphic",
  details: "Label and value rows",
  callout: "A highlighted note",
  eta: "Big arrival time",
  tech: "Photo, name and role",
  columns: "Side by side, stacks on phones",
  social: "Your social and web links",
  divider: "A thin line",
  spacer: "Extra space",
};

export const MAX_BLOCKS = 60;
const MAX_COL_BLOCKS = 12;
const MAX_ROWS = 20;

let seq = 0;
export function newBlockId(): string {
  seq = (seq + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** A fresh block of a type, with sensible starting content. */
export function makeBlock(type: BlockType): Block {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, text: "Your heading here", level: 1, align: "left" };
    case "text":
      return { id, type, text: "Write your message here. Use **bold**, *italic* and [links](https://example.com).", align: "left" };
    case "button":
      return { id, type, label: "Track your appointment", url: "{{trackUrl}}", align: "left", variant: "solid" };
    case "image":
      return { id, type, url: "", alt: "", align: "center" };
    case "details":
      return { id, type, rows: [{ label: "Service", value: "{{service}}" }, { label: "When", value: "{{when}}" }, { label: "Address", value: "{{address}}" }], style: "boxed" };
    case "callout":
      return { id, type, text: "**Heads-up:** add one important note here.", tone: "info" };
    case "eta":
      return { id, type, label: "Arriving in", value: "{{eta}} min", note: "{{techName}} is on the way", fallback: "On the way" };
    case "tech":
      return { id, type, name: "{{techName}}", photo: "{{techPhoto}}", role: "Your {{workerNoun}}", note: "" };
    case "columns":
      return {
        id,
        type,
        ratio: "1:1",
        cols: [
          [{ id: newBlockId(), type: "text", text: "**When**\n{{when}}" }],
          [{ id: newBlockId(), type: "text", text: "**Where**\n{{address}}" }],
        ],
      };
    case "social":
      return { id, type, align: "center" };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, size: "md" };
  }
}

/* ---------------------------------------------------------------- safety -- */

const str = (v: unknown, max: number): string => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt?: T): T | undefined => (allowed.includes(v as T) ? (v as T) : dflt);

const TOKEN_ONLY = /^\{\{\s*\w+\s*\}\}$/;

/**
 * A link or image address an email may carry: web, mail and phone links, an
 * uploaded file on our own site, or a single {{token}} filled in at send time.
 * Anything else (javascript:, data:, protocol-relative) is dropped.
 */
export function safeUrl(raw: unknown): string {
  const s = str(raw, 2000).trim();
  if (!s) return "";
  if (TOKEN_ONLY.test(s)) return s.replace(/\s+/g, "");
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return /[\s<>"']/.test(s) ? "" : s;
  if (/^\/(?!\/)[^\s<>"']*$/.test(s)) return s;
  // Older designs sometimes have "www.example.com" with no scheme.
  if (/^www\.[^\s<>"']+$/i.test(s)) return `https://${s}`;
  // A token followed by a path or query, e.g. {{trackUrl}}?ref=email.
  if (/^\{\{\w+\}\}[^\s<>"']*$/.test(s)) return s;
  return "";
}

/** A link with somewhere to go (not just "https://"). */
export function isRealLink(url: string): boolean {
  return /^(https?:\/\/[^\s/]+\.[^\s]+|mailto:\S+@\S+|tel:\+?[\d\s()-]{5,})$/i.test(url.trim());
}

/** Same rule, for a value AFTER tokens were filled in (no tokens left). */
export function safeFinalUrl(raw: string): string {
  const s = raw.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return /[\s<>"']/.test(s) ? "" : s;
  if (/^\/(?!\/)[^\s<>"']*$/.test(s)) return s;
  return "";
}

const ALIGNS = ["left", "center", "right"] as const;

function normBlock(raw: unknown, depth: number, used: Set<string>): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  let id = str(b.id, 40).replace(/[^\w-]/g, "");
  if (!id || used.has(id)) id = newBlockId();
  used.add(id);
  const align = pick(b.align, ALIGNS);
  const withAlign = <T extends Block>(o: T): T => (align ? { ...o, align } : o);
  switch (b.type) {
    case "heading": {
      // v1 used size sm|md|lg; v2 uses levels.
      const fromSize = b.size === "lg" ? 1 : b.size === "sm" ? 3 : b.size === "md" ? 2 : undefined;
      const level = ([1, 2, 3] as const).find((l) => l === Number(b.level)) ?? fromSize ?? 1;
      return withAlign({ id, type: "heading", text: str(b.text, 300), level });
    }
    case "text": {
      const tone = pick(b.tone, ["normal", "muted", "small"] as const);
      return withAlign({ id, type: "text", text: str(b.text, 5000), ...(tone && tone !== "normal" ? { tone } : {}) });
    }
    case "button": {
      const variant = pick(b.variant, ["solid", "outline", "link"] as const, "solid")!;
      return withAlign({ id, type: "button", label: str(b.label, 120), url: safeUrl(b.url), variant, ...(b.full ? { full: true } : {}) });
    }
    case "image": {
      const w = Math.round(Number(b.width));
      const href = safeUrl(b.href);
      return withAlign({
        id,
        type: "image",
        url: safeUrl(b.url),
        alt: str(b.alt, 300),
        ...(Number.isFinite(w) && w >= 24 && w <= 600 ? { width: w } : {}),
        ...(href ? { href } : {}),
      });
    }
    case "details": {
      const rows = (Array.isArray(b.rows) ? b.rows : [])
        .slice(0, MAX_ROWS)
        .map((r) => ({ label: str((r as any)?.label, 120), value: str((r as any)?.value, 500) }));
      const style = pick(b.style, ["boxed", "lines"] as const, "boxed")!;
      const title = str(b.title, 120);
      return { id, type: "details", rows, style, ...(title ? { title } : {}) };
    }
    case "callout":
      return { id, type: "callout", text: str(b.text, 2000), tone: pick(b.tone, ["info", "success", "warning", "brand"] as const, "info")! };
    case "eta":
      return {
        id,
        type: "eta",
        label: str(b.label, 80),
        value: str(b.value, 80),
        note: str(b.note, 200),
        fallback: str(b.fallback, 80),
      };
    case "tech":
      return { id, type: "tech", name: str(b.name, 120), photo: safeUrl(b.photo), role: str(b.role, 120), note: str(b.note, 300) };
    case "columns": {
      if (depth > 0) return null;
      const cols = Array.isArray(b.cols) ? b.cols : [];
      const side = (i: number): Block[] =>
        (Array.isArray(cols[i]) ? (cols[i] as unknown[]) : [])
          .map((x) => normBlock(x, depth + 1, used))
          .filter((x): x is Block => !!x && COLUMN_CHILD_TYPES.includes(x.type))
          .slice(0, MAX_COL_BLOCKS);
      return { id, type: "columns", ratio: pick(b.ratio, ["1:1", "1:2", "2:1"] as const, "1:1")!, cols: [side(0), side(1)] };
    }
    case "social":
      return withAlign({ id, type: "social" });
    case "divider":
      return { id, type: "divider" };
    case "spacer":
      return { id, type: "spacer", size: pick(b.size, ["sm", "md", "lg"] as const, "md")! };
    default:
      return null;
  }
}

/** Any stored or posted design (v1 array, v2 object, junk) as a clean v2 design. */
export function normalizeDesign(input: unknown): EmailDesign {
  let raw: unknown = input;
  if (typeof raw === "string") {
    try {
      raw = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      raw = [];
    }
  }
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.blocks) ? (obj!.blocks as unknown[]) : [];
  const used = new Set<string>();
  const blocks = list
    .map((b) => normBlock(b, 0, used))
    .filter((b): b is Block => !!b)
    .slice(0, MAX_BLOCKS);
  return { v: 2, preheader: str(obj?.preheader, 200), blocks };
}

/** A stored design JSON string as a design, or null when there is none. */
export function parseDesign(json: string | null | undefined): EmailDesign | null {
  if (!json || !json.trim()) return null;
  try {
    JSON.parse(json);
  } catch {
    return null;
  }
  const d = normalizeDesign(json);
  return d.blocks.length ? d : null;
}

export function hasDesign(json: string | null | undefined): boolean {
  return !!parseDesign(json);
}

export function serializeDesign(d: EmailDesign): string {
  return JSON.stringify(normalizeDesign(d));
}

/** Every block, including the ones inside columns. */
export function allBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.type === "columns") out.push(...b.cols[0], ...b.cols[1]);
  }
  return out;
}

/* ----------------------------------------------------------------- theme -- */

export type FontKey = "system" | "modern" | "classic" | "rounded" | "geometric";
export type HeaderKey = "brand" | "gradient" | "light" | "none";

export interface EmailTheme {
  font: FontKey;
  headingWeight: "medium" | "bold" | "heavy";
  corners: "sharp" | "soft" | "round";
  buttonShape: "square" | "rounded" | "pill";
  layout: "card" | "flat";
  header: HeaderKey;
  logoAlign: "left" | "center";
  /** On a coloured header, sit the logo on a white backing (logos made for white pages). */
  logoBacking: boolean;
  /** Logo width ÷ height, measured when it is uploaded; lets Outlook size it. 0 = unknown. */
  logoRatio: number;
  /** Body text colour; "" = the default dark grey. */
  textColor: string;
  social: { label: string; url: string }[];
  /** Show the company address/phone footer inside the email. */
  showFooter: boolean;
}

export const FONT_OPTIONS: { key: FontKey; label: string; stack: string; google?: string }[] = [
  { key: "system", label: "System", stack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" },
  { key: "modern", label: "Modern (Inter)", stack: "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif", google: "Inter:wght@400;500;600;700;800" },
  { key: "geometric", label: "Geometric (Poppins)", stack: "Poppins,'Century Gothic','Segoe UI',Arial,sans-serif", google: "Poppins:wght@400;500;600;700;800" },
  { key: "rounded", label: "Friendly (Nunito)", stack: "Nunito,'Trebuchet MS','Segoe UI',Arial,sans-serif", google: "Nunito:wght@400;600;700;800" },
  { key: "classic", label: "Classic (Georgia)", stack: "Georgia,'Times New Roman',Times,serif" },
];

export const HEADER_OPTIONS: { key: HeaderKey; label: string; hint: string }[] = [
  { key: "light", label: "Clean", hint: "White header with a brand-colour bar" },
  { key: "brand", label: "Brand colour", hint: "Solid brand-colour header" },
  { key: "gradient", label: "Gradient", hint: "Brand-colour gradient" },
  { key: "none", label: "Logo only", hint: "Logo above the email, no header bar" },
];

/** The old header style column, read as a v2 header. */
export function legacyHeader(style: string | null | undefined): HeaderKey {
  if (style === "solid") return "brand";
  if (style === "gradient" || !style) return "gradient";
  return "light"; // minimal | plain | logo
}

export function defaultTheme(legacyHeaderStyle?: string | null): EmailTheme {
  return {
    font: "system",
    headingWeight: "bold",
    corners: "soft",
    buttonShape: "rounded",
    layout: "card",
    header: legacyHeader(legacyHeaderStyle),
    logoAlign: "center",
    logoBacking: true,
    logoRatio: 0,
    textColor: "",
    social: [],
    showFooter: true,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A stored or posted theme as a clean theme. Unknown keys are dropped. */
export function normalizeTheme(input: unknown, legacyHeaderStyle?: string | null): EmailTheme {
  let raw: unknown = input;
  if (typeof raw === "string") {
    try {
      raw = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      raw = {};
    }
  }
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = defaultTheme(legacyHeaderStyle);
  const ratio = Number(t.logoRatio);
  const social = (Array.isArray(t.social) ? t.social : [])
    .map((s) => ({ label: str((s as any)?.label, 40).trim(), url: safeUrl((s as any)?.url) }))
    .filter((s) => s.label && isRealLink(s.url))
    .slice(0, 8);
  return {
    font: pick(t.font, FONT_OPTIONS.map((f) => f.key), d.font)!,
    headingWeight: pick(t.headingWeight, ["medium", "bold", "heavy"] as const, d.headingWeight)!,
    corners: pick(t.corners, ["sharp", "soft", "round"] as const, d.corners)!,
    buttonShape: pick(t.buttonShape, ["square", "rounded", "pill"] as const, d.buttonShape)!,
    layout: pick(t.layout, ["card", "flat"] as const, d.layout)!,
    header: pick(t.header, HEADER_OPTIONS.map((h) => h.key), d.header)!,
    logoAlign: pick(t.logoAlign, ["left", "center"] as const, d.logoAlign)!,
    logoBacking: t.logoBacking === undefined ? d.logoBacking : !!t.logoBacking,
    logoRatio: Number.isFinite(ratio) && ratio > 0.1 && ratio < 20 ? Math.round(ratio * 1000) / 1000 : 0,
    textColor: typeof t.textColor === "string" && HEX.test(t.textColor) ? t.textColor : "",
    social,
    showFooter: t.showFooter === undefined ? d.showFooter : !!t.showFooter,
  };
}

/* ---------------------------------------------------------------- tokens -- */

/** Fill-ins an email can use. Labels are the defaults; the UI swaps in the company's own words. */
export const EMAIL_TOKENS: { key: string; label: string }[] = [
  { key: "firstName", label: "Customer first name" },
  { key: "company", label: "Company name" },
  { key: "service", label: "Service" },
  { key: "jobName", label: "Job name" },
  { key: "jobNumber", label: "Job #" },
  { key: "when", label: "Date and time" },
  { key: "address", label: "Address" },
  { key: "techName", label: "Technician name" },
  { key: "techPhoto", label: "Technician photo" },
  { key: "eta", label: "ETA (minutes)" },
  { key: "newWhen", label: "Revised arrival time" },
  { key: "delayMins", label: "Minutes late" },
  { key: "price", label: "Price" },
  { key: "trackUrl", label: "Tracking link" },
  { key: "propertyUrl", label: "Property history link" },
  { key: "workerNoun", label: "Word for technician" },
  { key: "customerNoun", label: "Word for customer" },
  { key: "jobNoun", label: "Word for job" },
];

/** Sample values for previews. Kept in step with dispatch's SAMPLE_VARS. */
export const EMAIL_SAMPLE_VARS = {
  company: "ArrivePing by NVC360",
  service: "Furnace Tune-Up",
  jobName: "Furnace Tune-Up",
  jobNumber: "A1B2C3",
  firstName: "Alex",
  techName: "Jordan Lee",
  techPhoto: "",
  address: "423 Main Street, Winnipeg",
  when: "Jun 4, 2:30 PM",
  eta: 12,
  price: "149.00",
  shortId: "A1B2C3",
  trackUrl: "https://arriveping.com/t/abc123",
  bookingUrl: "https://arriveping.com/t/abc123",
  workerNoun: "Technician",
  jobNoun: "Job",
  customerNoun: "Customer",
  propertyUrl: "https://arriveping.com/p/abc123def456",
  delayMins: 20,
  newWhen: "2:50 PM",
};

/* -------------------------------------------------------------- plain text -- */

/** Fill-in values by token name (any object; read by key). */
export type Vars = object;

export function fillPlain(tpl: string, vars: Vars): string {
  return String(tpl ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
    const v = (vars as Record<string, unknown>)[k];
    return v == null ? "" : String(v);
  });
}

const stripMd = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)");

/** The plain-text part of the email (sent alongside the HTML). */
export function designToText(design: EmailDesign, vars: Vars): string {
  const f = (s: string | undefined) => stripMd(fillPlain(s || "", vars)).trim();
  const one = (b: Block): string => {
    switch (b.type) {
      case "heading":
      case "text":
      case "callout":
        return f(b.text);
      case "button": {
        const url = fillPlain(b.url, vars).trim();
        return url ? `${f(b.label)}: ${url}` : f(b.label);
      }
      case "details":
        return [b.title ? f(b.title) : "", ...b.rows.map((r) => `${f(r.label)}: ${f(r.value)}`)].filter(Boolean).join("\n");
      case "eta": {
        const keys = [...b.value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!);
        const blank = keys.length > 0 && keys.every((k) => !fillPlain(`{{${k}}}`, vars).trim());
        return blank ? f(b.fallback) : [f(b.label), f(b.value), f(b.note)].filter(Boolean).join(" ");
      }
      case "tech":
        return [f(b.name), f(b.role)].filter(Boolean).join(", ");
      case "columns":
        return [...b.cols[0], ...b.cols[1]].map(one).filter(Boolean).join("\n\n");
      default:
        return "";
    }
  };
  return design.blocks.map(one).filter(Boolean).join("\n\n");
}
