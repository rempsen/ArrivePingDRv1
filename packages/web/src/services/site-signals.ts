/**
 * Facts a website states outright, read without a model.
 *
 * The AI read works from visible body text with the header, nav and footer
 * removed (they are menus, mostly). But the footer is where a business puts
 * its phone, email and address, and the <head> is where it names itself. These
 * are read here, straight from the markup, and used two ways:
 *   - as hints the AI read is told to trust;
 *   - as the answer when the AI read is unavailable or left a field empty.
 *
 * Nothing here depends on the page's language.
 */

export interface SiteSignals {
  name: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  /** Visible footer text of the page, where address and hours usually live. */
  footer: string;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#124;/g, "|")
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, key: string): string | null {
  const head = html.slice(0, 200_000);
  const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, "i");
  const tag = re.exec(head)?.[0];
  if (!tag) return null;
  const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
  const v = decode(c?.[1] ?? c?.[2] ?? "");
  return v || null;
}

const GENERIC = /^(home|homepage|welcome|accueil|inicio|startseite|index|untitled|website|site|page|main|contact|about( us)?)$/i;
const letters = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

/**
 * The business name from a page title like "Home | Valley Fiber" or
 * "Valley Fiber - Rural Internet". The part that matches the domain wins
 * (valleyfiber.ca -> "Valley Fiber"); otherwise the first part that isn't a
 * generic word.
 */
export function nameFromTitle(title: string, host: string): string | null {
  const parts = decode(title)
    .split(/\s+[|–—·•:]\s+|\s+-\s+|\s*\|\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 80 && !GENERIC.test(p));
  if (!parts.length) return null;
  const domain = letters(host.replace(/^www\./, "").split(".")[0] ?? "");
  if (domain.length >= 3) {
    const exact = parts.find((p) => letters(p) === domain);
    if (exact) return exact;
    // "Valley Fiber Ltd." for valleyfiber, or "VF Internet" would not match: keep it strict.
    const starts = parts.find((p) => letters(p).startsWith(domain) && letters(p).length <= domain.length + 12);
    if (starts) return starts;
    const inside = parts.find((p) => domain.includes(letters(p)) && letters(p).length >= Math.max(4, domain.length - 4));
    if (inside) return inside;
  }
  // No tie to the domain: a short first or last part is usually the name.
  const first = parts[0]!;
  return parts.length === 1 || first.split(" ").length <= 4 ? first : parts[parts.length - 1]!;
}

const BAD_EMAIL = /(sentry|wixpress|example\.|domain\.com|email\.com|yourname|\.(png|jpe?g|gif|webp|svg)$|^(no-?reply|donotreply)@)/i;

function mostCommon(values: string[]): string | null {
  const count = new Map<string, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  // Ties go to the first one seen: the header number, not a branch office.
  for (const [v, c] of count) {
    if (c > n) {
      best = v;
      n = c;
    }
  }
  return best;
}

function phones(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']tel:([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let raw = m[1]!;
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep as is */
    }
    // tel:+1-204-555-0100;ext=123 or ",123": the extension is not part of the number.
    raw = raw.split(/[;,]|\s*(?:ext\.?|x)\s*\d/i)[0]!;
    const digits = raw.replace(/[^\d+]/g, "");
    const n = digits.replace(/\D/g, "").length;
    if (n >= 7 && n <= 15) out.push(digits);
  }
  return out;
}

function emails(html: string, host: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']mailto:([^"'?]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let e = m[1]!.trim();
    try {
      e = decodeURIComponent(e);
    } catch {
      /* keep as is */
    }
    e = e.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e)) out.push(e);
  }
  // An address on the site's own domain beats a webmaster's Gmail.
  const domain = host.replace(/^www\./, "");
  const own = out.filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`));
  return own.length ? own : out;
}

/** Visible text of the page's <footer> (the last one, if several). */
export function footerText(html: string): string {
  const noCode = html
    .slice(0, 3_000_000)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const all = noCode.match(/<footer\b[\s\S]*?<\/footer>/gi);
  const block = all?.[all.length - 1];
  if (!block) return "";
  return decode(block.replace(/<[^>]+>/g, " ")).slice(0, 1_500);
}

export function extractSignals(html: string, url: string): SiteSignals {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* no host */
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 200_000))?.[1] ?? "";
  const siteName = meta(html, "og:site_name") ?? meta(html, "application-name");
  const name = siteName && !GENERIC.test(siteName) && siteName.length <= 80 ? siteName : nameFromTitle(title, host);
  const description = meta(html, "description") ?? meta(html, "og:description");
  return {
    name: name || null,
    description: description ? description.slice(0, 600) : null,
    phone: mostCommon(phones(html)),
    email: mostCommon(emails(html, host)),
    footer: footerText(html),
  };
}

/** Homepage first: its values win, later pages only fill what is missing. */
export function mergeSignals(list: SiteSignals[]): SiteSignals {
  const out: SiteSignals = { name: null, description: null, phone: null, email: null, footer: "" };
  for (const s of list) {
    out.name ||= s.name;
    out.description ||= s.description;
    out.phone ||= s.phone;
    out.email ||= s.email;
    out.footer ||= s.footer;
  }
  return out;
}

export function signalsBlock(s: SiteSignals): string {
  const lines = [
    s.name && `site name: ${s.name}`,
    s.description && `meta description: ${s.description}`,
    s.phone && `phone link: ${s.phone}`,
    s.email && `email link: ${s.email}`,
  ].filter(Boolean);
  const head = lines.length ? `READ FROM THE PAGE MARKUP (the site's own name tag, description tag and phone/email links; trust these):\n${lines.join("\n")}\n\n` : "";
  const foot = s.footer ? `FOOTER TEXT (often holds the address, hours and service area):\n${s.footer}\n\n` : "";
  return head + foot;
}

/** `<loc>` entries of a sitemap, same origin only. */
export function sitemapLocs(xml: string, origin: string): { pages: string[]; children: string[] } {
  const pages: string[] = [];
  const children: string[] = [];
  const isIndex = /<sitemapindex\b/i.test(xml);
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && pages.length + children.length < 2_000) {
    const loc = decode(m[1]!);
    try {
      if (new URL(loc).origin !== origin) continue;
    } catch {
      continue;
    }
    if (isIndex || /\.xml(\.gz)?$/i.test(loc)) children.push(loc);
    else pages.push(loc);
  }
  return { pages, children };
}
