/**
 * Keep the tenant's notifications in the tenant's own words.
 *
 * Provisioning seeds every notification template, email subject and email
 * design with the default vocabulary (Technician / Customer / Job / Service).
 * The onboarding chat then learns the real words ("Consultant", "Client",
 * "Engagement") and saved them to companySettings, but the seeded copy kept
 * the old words, so a consultancy's emails still read "Technician: Jordan".
 *
 * `applyTerminology` rewrites that copy: whole-word, case-preserving, both
 * singular and plural, across SMS/in-app templates, email subjects and the
 * JSON email designs. It runs whenever a noun changes (onboarding chat and
 * Settings) and after provisioning when the scrape already found the nouns.
 */
import { eq } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";

export interface NounSet {
  workerNoun: string;
  workerNounPlural?: string;
  customerNoun: string;
  customerNounPlural?: string;
  jobNoun: string;
  jobNounPlural?: string;
}

export const DEFAULT_NOUNS: Required<NounSet> = {
  workerNoun: "Technician",
  workerNounPlural: "Technicians",
  customerNoun: "Customer",
  customerNounPlural: "Customers",
  jobNoun: "Job",
  jobNounPlural: "Jobs",
};

function plural(word: string): string {
  if (!word) return word;
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Copy the capitalisation pattern of `from` onto `to` ("technician" → "consultant", "Technician" → "Consultant", "TECH" → "CONSULTANT"). */
function matchCase(from: string, to: string): string {
  if (from === from.toUpperCase() && from.length > 1) return to.toUpperCase();
  if (from[0] === from[0]?.toUpperCase()) return to[0]!.toUpperCase() + to.slice(1);
  return to.toLowerCase();
}

/** Word pairs (old → new) to apply, longest first so plurals win over singulars. */
export function nounPairs(from: NounSet, to: NounSet): [string, string][] {
  const pairs: [string, string][] = [];
  const add = (a: string | undefined, b: string | undefined) => {
    const x = (a ?? "").trim();
    const y = (b ?? "").trim();
    if (x && y && x.toLowerCase() !== y.toLowerCase()) pairs.push([x, y]);
  };
  add(from.workerNounPlural || plural(from.workerNoun), to.workerNounPlural || plural(to.workerNoun));
  add(from.workerNoun, to.workerNoun);
  add(from.customerNounPlural || plural(from.customerNoun), to.customerNounPlural || plural(to.customerNoun));
  add(from.customerNoun, to.customerNoun);
  add(from.jobNounPlural || plural(from.jobNoun), to.jobNounPlural || plural(to.jobNoun));
  add(from.jobNoun, to.jobNoun);
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

/** Replace whole words in free text; template variables like {{jobNoun}} are left alone. */
export function retermText(text: string, pairs: [string, string][]): string {
  if (!text || pairs.length === 0) return text;
  let out = text;
  for (const [from, to] of pairs) {
    const re = new RegExp(`(?<![\\w{])${escapeRe(from)}(?![\\w}])`, "gi");
    out = out.replace(re, (m) => matchCase(m, to));
  }
  return out;
}

/** Walk an email design (JSON blocks) and reterm every string the reader sees. */
export function retermDesign(json: string, pairs: [string, string][]): string {
  if (!json || pairs.length === 0) return json;
  let blocks: unknown;
  try {
    blocks = JSON.parse(json);
  } catch {
    return json;
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return retermText(v, pairs);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        // never touch URLs, variable names or ids
        o[k] = k === "url" || k === "id" || k === "type" || k === "key" ? val : walk(val);
      }
      return o;
    }
    return v;
  };
  return JSON.stringify(walk(blocks));
}

/**
 * Rewrite the tenant's notification copy from `from` nouns to `to` nouns.
 * Returns the number of rules changed.
 */
export async function applyTerminology(companyId: string, from: NounSet, to: NounSet): Promise<number> {
  const pairs = nounPairs(from, to);
  if (pairs.length === 0) return 0;
  const t = tdb(companyId);
  const rules = await t.select(schema.notificationRules);
  let changed = 0;
  for (const r of rules) {
    const patch: Partial<typeof r> = {};
    const tpl = retermText(r.template, pairs);
    if (tpl !== r.template) patch.template = tpl;
    const subj = retermText(r.emailSubject, pairs);
    if (subj !== r.emailSubject) patch.emailSubject = subj;
    const design = retermDesign(r.emailDesign, pairs);
    if (design !== r.emailDesign) patch.emailDesign = design;
    if (Object.keys(patch).length) {
      await t.update(schema.notificationRules, patch, eq(schema.notificationRules.id, r.id));
      changed++;
    }
  }
  if (changed) log.info("terminology: notification copy re-termed", { companyId, changed, pairs });
  return changed;
}
