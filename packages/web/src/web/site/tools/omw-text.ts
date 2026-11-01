/**
 * The free on-my-way text generator (/tools/on-my-way-text-generator).
 *
 * Pure functions only, so the page can prerender the default output at build
 * time and the same code runs in the browser. Nothing is stored or sent
 * anywhere: the visitor's inputs stay in component state.
 *
 * Templates use plain GSM-7 characters on purpose (no curly quotes, em dashes
 * or emoji), so a short text stays a single SMS segment.
 */

export type TradeKey =
  | "hvac"
  | "plumbing"
  | "electrical"
  | "cleaning"
  | "delivery"
  | "handyman"
  | "landscaping"
  | "pest"
  | "appliance"
  | "general";

export type Tone = "friendly" | "professional" | "brief";

export type OmwInput = {
  trade: TradeKey;
  tone: Tone;
  company: string;
  tech: string;
  /** Minutes until the technician arrives. */
  eta: number;
  /** Add a "[tracking link]" placeholder where a live link would go. */
  link: boolean;
  /** Add "Reply STOP to opt out." to each text. */
  optOut: boolean;
};

export type OmwTexts = { onMyWay: string; runningLate: string; arrived: string };

export type Trade = {
  key: TradeKey;
  label: string;
  /** The trade's word for the person at the door. */
  person: string;
  /** "your ___ appointment" */
  service: string;
  /** One practical ask, used by the friendly on-my-way text only. */
  tip: string;
};

export const TRADES: readonly Trade[] = [
  { key: "hvac", label: "HVAC (heating and cooling)", person: "technician", service: "heating and cooling", tip: "If you can, clear a path to the furnace or AC unit." },
  { key: "plumbing", label: "Plumbing", person: "plumber", service: "plumbing", tip: "If you can, clear the area around the fixture." },
  { key: "electrical", label: "Electrical", person: "electrician", service: "electrical", tip: "If you can, make sure the electrical panel is easy to reach." },
  { key: "cleaning", label: "Cleaning and maid service", person: "cleaner", service: "cleaning", tip: "Please secure any pets before we arrive." },
  { key: "delivery", label: "Delivery and installation", person: "driver", service: "delivery", tip: "Please make sure the entrance and the path inside are clear." },
  { key: "handyman", label: "Handyman and home repair", person: "technician", service: "repair", tip: "If you can, clear the area where we will be working." },
  { key: "landscaping", label: "Landscaping and lawn care", person: "crew lead", service: "lawn care", tip: "Please unlock any gates to the yard." },
  { key: "pest", label: "Pest control", person: "technician", service: "pest control", tip: "Please keep pets inside until the treatment is done." },
  { key: "appliance", label: "Appliance repair", person: "technician", service: "appliance repair", tip: "If you can, clear space around the appliance." },
  { key: "general", label: "Other home service", person: "technician", service: "service", tip: "" },
];

export const TONES: readonly { key: Tone; label: string; hint: string }[] = [
  { key: "friendly", label: "Friendly", hint: "Warm, with one practical ask" },
  { key: "professional", label: "Professional", hint: "Polite and complete" },
  { key: "brief", label: "Brief", hint: "Shortest, single segment" },
];

export const LINK_PLACEHOLDER = "[tracking link]";
export const OPT_OUT = "Reply STOP to opt out.";

export const OMW_DEFAULTS: OmwInput = {
  trade: "hvac",
  tone: "friendly",
  company: "Prairie Comfort HVAC",
  tech: "Jordan",
  eta: 20,
  link: true,
  optOut: false,
};

export const tradeFor = (key: string): Trade => TRADES.find((t) => t.key === key) ?? TRADES[TRADES.length - 1]!;

/** Collapse whitespace, drop characters that would break the SMS, cap the length. */
function clean(v: string, fallback: string, max = 40): string {
  const s = (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max).trim();
  return s || fallback;
}

/** A whole number of minutes between 1 and 240; anything else falls back to the default. */
export function cleanEta(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n < 1) return OMW_DEFAULTS.eta;
  return Math.min(240, Math.round(n));
}

const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/** The on-my-way, running-late and arrived texts for one set of inputs. */
export function generateTexts(input: OmwInput): OmwTexts {
  const t = tradeFor(input.trade);
  const co = clean(input.company, "[your company]", 60);
  const tech = clean(input.tech, "[tech name]");
  const eta = cleanEta(input.eta);
  const link = (lead: string) => (input.link ? ` ${lead} ${LINK_PLACEHOLDER}` : "");
  const stop = input.optOut ? ` ${OPT_OUT}` : "";

  switch (input.tone) {
    case "professional":
      return {
        onMyWay: `${co}: Your ${t.person} ${tech} is on the way to your ${t.service} appointment. Estimated arrival: about ${minutes(eta)}.${link("Live tracking:")}${stop}`,
        runningLate: `${co}: Update on your ${t.service} appointment. ${tech} is running late and now expects to arrive in about ${minutes(eta)}. We apologize for the delay.${link("Live status:")} Reply if you need to reschedule.${stop}`,
        arrived: `${co}: Your ${t.person} ${tech} has arrived for your ${t.service} appointment.${stop}`,
      };
    case "brief":
      return {
        onMyWay: `${co}: ${tech} is on the way, ETA ${eta} min.${link("Track:")}${stop}`,
        runningLate: `${co}: Running late. ${tech} now ${eta} min away.${link("Track:")}${stop}`,
        arrived: `${co}: ${tech} has arrived.${stop}`,
      };
    case "friendly":
    default:
      return {
        onMyWay: `Hi! ${tech} from ${co} is on the way and should be there in about ${minutes(eta)}.${link("Follow along live:")}${t.tip ? ` ${t.tip}` : ""}${stop}`,
        runningLate: `Hi, quick update from ${co}: ${tech} is running a little behind and should reach you in about ${minutes(eta)}. Sorry to keep you waiting.${link("Live status:")} Reply if that time no longer works.${stop}`,
        arrived: `Hi! ${tech} from ${co} has arrived for your ${t.service} appointment.${stop}`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* SMS length                                                           */
/* ------------------------------------------------------------------ */

/** GSM 03.38 basic character set (each counts as one character). */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** GSM 03.38 extension table (each takes an escape, so counts as two). */
const GSM_EXT = "^{}\\[~]|€\f";

export type SmsInfo = { characters: number; encoding: "GSM-7" | "UCS-2"; segments: number; perSegment: number };

/**
 * Character count and SMS segments, using the standard limits: GSM-7 is 160
 * characters in one segment and 153 per segment once split; UCS-2 (any emoji,
 * curly quote or character outside GSM-7) is 70, then 67 per segment.
 */
export function smsInfo(text: string): SmsInfo {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153);
    return { characters: units, encoding: "GSM-7", segments, perSegment: segments > 1 ? 153 : 160 };
  }
  // UCS-2 counts UTF-16 code units: most emoji take two.
  const len = text.length;
  const segments = len === 0 ? 0 : len <= 70 ? 1 : Math.ceil(len / 67);
  return { characters: len, encoding: "UCS-2", segments, perSegment: segments > 1 ? 67 : 70 };
}

export function describeSms(text: string): string {
  const i = smsInfo(text);
  return `${i.characters} characters · ${i.segments} SMS segment${i.segments === 1 ? "" : "s"} (${i.encoding})`;
}
