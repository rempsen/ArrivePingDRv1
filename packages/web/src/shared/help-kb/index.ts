/**
 * The whole ArrivePing screen map (see types.ts), and the search over it that
 * "Ask ArrivePing" uses to pick what the model reads in full.
 */
import { searchTerms } from "../../web/site/support/search";
import type { KbEntry, KbRole, KbSurface } from "./types";
import { entries as officeWebDispatch } from "./office-web-dispatch";
import { entries as officeWebPeople } from "./office-web-people";
import { entries as officeWebCatalogForms } from "./office-web-catalog-forms";
import { entries as officeWebSetup } from "./office-web-setup";
import { entries as officeMobile } from "./office-mobile";
import { entries as techApp } from "./tech-app";
import { entries as customerAccount } from "./customer-account";

export type { KbEntry, KbRole, KbSurface } from "./types";

export const KB: KbEntry[] = [...officeWebDispatch, ...officeWebPeople, ...officeWebCatalogForms, ...officeWebSetup, ...officeMobile, ...techApp, ...customerAccount];

export const kbById: Record<string, KbEntry> = Object.fromEntries(KB.map((e) => [e.id, e]));

/** Plain words for each app, as the model and people say them. */
export const SURFACE_LABEL: Record<KbSurface, string> = {
  "office-web": "Office dashboard (web browser)",
  "office-mobile": "ArrivePing app, office side (iPhone, iPad, Android)",
  "tech-app": "ArrivePing app, technician side (iPhone, Android)",
  customer: "What customers see (tracking page, booking forms, texts, emails)",
  account: "Signing up, signing in and joining a company",
};

/** Words that point at one app. A question naming one ranks that app's screens first. */
const SURFACE_HINTS: Record<KbSurface, RegExp> = {
  "office-web": /\b(dashboard|browser|computer|desktop|web|laptop|sidebar)\b/i,
  "office-mobile": /\b(ipad|tablet)\b/i,
  "tech-app": /\b(technician|tech|driver|installer|crew|field|my phone|app)\b/i,
  customer: /\b(customer|client|homeowner|tracking link|track|booking form)\b/i,
  account: /\b(sign ?in|log ?in|password|sign ?up|signup|invite|trial|account)\b/i,
};

interface Indexed {
  e: KbEntry;
  title: string;
  kw: string;
  head: string; // summary + path
  tasks: string; // task questions
  body: string; // controls, steps, fixes
}

const lower = (s: string | undefined) => (s ?? "").toLowerCase();

const INDEX: Indexed[] = KB.map((e) => ({
  e,
  title: lower(e.title),
  kw: lower((e.keywords ?? []).join(" ")),
  head: lower(`${e.summary} ${e.path}`),
  tasks: lower(e.tasks.map((t) => t.q).join(" ")),
  body: lower(
    [
      ...e.controls.map((c) => `${c.label} ${c.does}`),
      ...e.tasks.flatMap((t) => [...t.steps, t.note ?? ""]),
      ...(e.fixes ?? []).map((f) => `${f.problem} ${f.fix}`),
    ].join(" "),
  ),
}));

export interface KbSearchOpts {
  /** Only these apps (e.g. the office dashboard's assistant skips the customer pages' internals). */
  surfaces?: KbSurface[];
  /** Only screens these roles use ("anyone" screens always pass). */
  roles?: KbRole[];
  limit?: number;
}

/** Screens that best match a question, best first. */
export function searchKb(q: string, opts: KbSearchOpts = {}): KbEntry[] {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  const hinted = (Object.keys(SURFACE_HINTS) as KbSurface[]).filter((s) => SURFACE_HINTS[s].test(q));
  const scored = INDEX.filter(({ e }) => {
    if (opts.surfaces && !opts.surfaces.includes(e.surface)) return false;
    if (opts.roles && !e.roles.includes("anyone") && !e.roles.some((r) => opts.roles!.includes(r))) return false;
    return true;
  })
    .map((x) => {
      let score = 0;
      let hits = 0;
      for (const t of terms) {
        const s =
          (x.title.includes(t) ? 6 : 0) + (x.kw.includes(t) ? 4 : 0) + (x.tasks.includes(t) ? 4 : 0) + (x.head.includes(t) ? 2 : 0) + (x.body.includes(t) ? 1 : 0);
        score += s;
        if (s > 0) hits++;
      }
      // Screens that match more of the question's words beat ones that repeat one word.
      score += hits * 3;
      if (hinted.includes(x.e.surface)) score += 3;
      return { e: x.e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 6).map((x) => x.e);
}

/** One screen as text for the model: everything on it, compactly. */
export function kbEntryText(e: KbEntry): string {
  const lines = [
    `<screen id="${e.id}">`,
    `${e.title} — ${SURFACE_LABEL[e.surface]} (${e.platforms.join(", ")}); used by: ${e.roles.join(", ")}`,
    `Where: ${e.path}${e.route ? ` [${e.route}]` : ""}${e.permission ? ` (needs permission ${e.permission})` : ""}`,
    e.summary,
  ];
  if (e.controls.length) lines.push("Controls:", ...e.controls.map((c) => `- "${c.label}": ${c.does}`));
  if (e.tasks.length)
    lines.push(
      "How to:",
      ...e.tasks.map((t) => `* ${t.q}\n${t.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}${t.note ? `\n  Note: ${t.note}` : ""}`),
    );
  if (e.fixes?.length) lines.push("Problems:", ...e.fixes.map((f) => `- ${f.problem}: ${f.fix}`));
  lines.push("</screen>");
  return lines.join("\n");
}

/** Every screen in one line each, so the model knows what exists even when it isn't retrieved in full. */
export function kbOutline(opts: KbSearchOpts = {}): string {
  return KB.filter((e) => !opts.surfaces || opts.surfaces.includes(e.surface))
    .map((e) => `- ${e.id}: ${e.title} — ${e.path}`)
    .join("\n");
}
