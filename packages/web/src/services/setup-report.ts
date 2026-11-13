/**
 * What signup built for a company, and from what.
 *
 * Every seeded section is either written from the company's own website or is
 * a starter set (their industry's, or a general one). The product used to say
 * "built from your site" either way. This is the record that keeps it honest:
 * stored on the company (companies.setup_report), shown at the end of signup,
 * given to the onboarding concierge, and sent with the new-signup notice.
 */
import type { BuiltFrom } from "./scout-prompt";

export type SectionKey = "services" | "templates" | "forms" | "catalog" | "options" | "notifications";
/** website = from their site; industry = their trade's starter set; general = a general starter set. */
export type SectionSource = "website" | "industry" | "general";

export interface SetupReport {
  v: 1;
  scan: {
    /** ok / partial = the site was read; anything else = it was not; none = no website given. */
    status: "ok" | "partial" | "blocked" | "unreachable" | "timeout" | "invalid_url" | "none" | "unknown";
    via: "direct" | "render" | null;
    pagesRead: number;
  };
  sections: Partial<Record<SectionKey, { from: SectionSource; count: number }>>;
}

export const SECTION_LABEL: Record<SectionKey, string> = {
  services: "services",
  templates: "work-order templates",
  forms: "intake forms",
  catalog: "price catalog",
  options: "option tiers",
  notifications: "customer messages",
};

const ORDER: SectionKey[] = ["services", "templates", "forms", "catalog", "options", "notifications"];

/** Collects the writers' marks during provisioning. */
export function setupRecorder(hasIndustryPreset: boolean) {
  const marks: Partial<Record<SectionKey, BuiltFrom>> = {};
  const counts: Partial<Record<SectionKey, number>> = {};
  return {
    mark: (key: SectionKey) => (from: BuiltFrom) => {
      marks[key] = from;
    },
    count: (key: SectionKey, n: number) => {
      counts[key] = n;
    },
    report(scan: SetupReport["scan"]): SetupReport {
      const sections: SetupReport["sections"] = {};
      for (const key of ORDER) {
        const n = counts[key] ?? 0;
        if (n <= 0) continue;
        sections[key] = { from: marks[key] === "website" ? "website" : hasIndustryPreset ? "industry" : "general", count: n };
      }
      return { v: 1, scan, sections };
    },
  };
}

export function parseSetupReport(raw: unknown): SetupReport | null {
  if (!raw) return null;
  try {
    const r = typeof raw === "string" ? JSON.parse(raw) : raw;
    return r && r.v === 1 && r.scan && r.sections ? (r as SetupReport) : null;
  } catch {
    return null;
  }
}

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Section names grouped by where they came from, in display order. */
export function groupSections(r: SetupReport): Record<SectionSource, SectionKey[]> {
  const out: Record<SectionSource, SectionKey[]> = { website: [], industry: [], general: [] };
  for (const key of ORDER) {
    const s = r.sections[key];
    if (s) out[s.from].push(key);
  }
  return out;
}

/** Plain sentences for a person: what came from their site and what is a starter set. */
export function setupSummary(r: SetupReport): string[] {
  const g = groupSections(r);
  const lines: string[] = [];
  const names = (keys: SectionKey[]) => list(keys.map((k) => SECTION_LABEL[k]));
  if (g.website.length) lines.push(`Written from your website: ${names(g.website)}.`);
  const starter = [...g.industry, ...g.general];
  if (starter.length) lines.push(`${g.industry.length ? "Starter set for your industry" : "General starter set"}: ${names(starter)}. Rename or replace these to match how you work.`);
  if (r.sections.catalog) lines.push("Catalog prices are starting estimates. Check them before you quote.");
  return lines;
}

/** One line for staff (Slack notice, Control Hub). */
export function setupOneLine(r: SetupReport): string {
  const scan =
    r.scan.status === "none"
      ? "no website given"
      : r.scan.status === "ok" || r.scan.status === "partial"
        ? `site read (${r.scan.status === "partial" ? "thin, " : ""}${r.scan.pagesRead} page${r.scan.pagesRead === 1 ? "" : "s"}${r.scan.via === "render" ? ", hosted browser" : ""})`
        : r.scan.status === "unknown"
          ? "site scan not recorded"
          : `site NOT read (${r.scan.status})`;
  const g = groupSections(r);
  const starter = [...g.industry, ...g.general];
  return `${scan}; from website: ${g.website.length ? g.website.join(", ") : "nothing"}; starter set: ${starter.length ? starter.join(", ") : "nothing"}`;
}
