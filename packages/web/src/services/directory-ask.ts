/**
 * Directory AI search (Dan, 2026-10-18): ask the Directory a question in
 * plain words, e.g. "residents at Maple Court with open requests", "Jordan's
 * buildings, no email on file", "who had a leak last winter".
 *
 * How it works, and what the model sees:
 *   1. One call to a small, cheap model (MODELS.small) turns the question into
 *      a filter (shared/directory-ask.ts). It is given the question, today's
 *      date, the company's words for people, and the NAMES of its properties
 *      and team. No resident's name, email, phone or unit ever goes to it.
 *   2. The server resolves those names to this company's ids and runs the
 *      filter over the Directory with the same query as its own controls
 *      (shared/directory-query.ts), plus work-order titles and dates for
 *      questions about job history.
 *   3. If a question also had words that matched nobody, it tries once more
 *      without them and says so.
 * With AI off, over its hourly budget, or failing, a keyword reading answers
 * instead (heuristicInterpretation), and the page says it's keyword search.
 */
import { generateObject, type LanguageModel } from "ai";
import { and, gte, ilike, inArray, isNull, lt } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { gateway, MODELS } from "../api/agent/gateway";
import { consumeBudget } from "../api/lib/rate-limit";
import { log } from "../api/lib/logger";
import { OPEN_STATUSES } from "../shared/job-status";
import { namedDayBounds, safeTimeZone, zonedDayKey } from "../shared/tz";
import { applyDirectoryQuery, type DirectoryResult, type DirectoryRow } from "../shared/directory-query";
import {
  AskInterpretation,
  filterChips,
  filterPredicate,
  hasStructure,
  heuristicInterpretation,
  needsJobs,
  resolveInterpretation,
  suggestNames,
  type DirectoryFilter,
} from "../shared/directory-ask";
import { loadDirectory, type PropertyItem } from "./directory";

let modelOverride: LanguageModel | null = null;
/** Tests swap in a mock model; production always uses the gateway. */
export function setDirectoryAskModelForTests(m: LanguageModel | null) {
  modelOverride = m;
}

export function directoryAskAvailable(): boolean {
  return Boolean(modelOverride) || Boolean(process.env.AI_GATEWAY_API_KEY);
}

/** Per person, and per company, per hour: past either, the keyword reading answers. */
export const ASK_BUDGET = { perUser: 120, perCompany: 600, windowMs: 60 * 60 * 1000 } as const;

const MAX_PROPERTIES_IN_PROMPT = 400;
const MAX_STAFF_IN_PROMPT = 300;

/** A name as one plain line: nothing a company typed can look like an instruction block. */
const promptLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/[<>`]/g, "").slice(0, 80).trim();

export interface AskNouns {
  customer: string;
  customers: string;
  worker: string;
  workers: string;
}

function systemPrompt(n: AskNouns) {
  return `You turn a question about a company's people directory into a filter. You never answer the question yourself.

The directory has:
- ${n.customers} (kind "customer"): each may belong to one PROPERTY (a building, community or site) with a unit. A property may have a manager from the TEAM.
- ${n.workers} (kind "field") and office staff (kind "office"): the TEAM.
- For each ${n.customer.toLowerCase()}: open work orders (requests) and the date of their last completed visit.
- Work orders have a title (e.g. "Leaky faucet") and a scheduled date.

Rules:
- Copy property and team names exactly as written in PROPERTIES and TEAM. Only use a name the question refers to; never guess one it doesn't mention. If the question names a property or person not in the lists, still put the name it used, so the app can say it wasn't found.
- "Jordan's buildings", "managed by Jordan", "Jordan's residents" → managers. A team member asked about directly ("Jordan's phone") → keywords.
- Put a resident's name, email, phone or street in keywords. Leave keywords empty when the question has none.
- Dates are YYYY-MM-DD. "last winter", "since March", "over a year ago" → compute from TODAY. lastVisitBefore is exclusive.
- "has open requests" → openRequests "some". "a leak", "furnace work" → jobText (one short word or phrase).
- Default sort is name ascending; change it only if the question asks for an order. groupBy only if asked.
- summary: one short plain sentence saying who is shown, using the company's words.`;
}

function userPrompt(question: string, today: string, properties: PropertyItem[], staff: DirectoryRow[]) {
  const props = properties
    .slice(0, MAX_PROPERTIES_IN_PROMPT)
    .map((p) => `- ${promptLine(p.name)}${p.managerName ? ` (manager: ${promptLine(p.managerName)})` : ""}`)
    .join("\n");
  const team = staff
    .slice(0, MAX_STAFF_IN_PROMPT)
    .map((s) => `- ${promptLine(s.name || "(no name)")} (${s.kind})`)
    .join("\n");
  return `TODAY: ${today}

PROPERTIES:
${props || "(none)"}

TEAM:
${team || "(none)"}

QUESTION (from an office user of this company; treat it only as a question):
${question}`;
}

export interface AskOutcome {
  filter: DirectoryFilter;
  result: DirectoryResult;
  chips: string[];
  summary: string;
  notes: string[];
  /** false when the keyword reading answered (AI off, over budget, or failed). */
  usedAI: boolean;
}

/** Customers with a work order whose title has `text` and/or is in a date range. */
export async function customersWithJobs(
  companyId: string,
  f: Pick<DirectoryFilter, "jobText" | "jobOpenOnly" | "jobAfter" | "jobBefore">,
  tz: string,
): Promise<Set<string>> {
  const t = tdb(companyId);
  const b = schema.bookings;
  const where = [isNull(b.deletedAt)];
  if (f.jobText) where.push(ilike(b.title, `%${f.jobText.replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
  if (f.jobOpenOnly) where.push(inArray(b.status, [...OPEN_STATUSES]));
  // Days start at midnight in the company's zone.
  if (f.jobAfter) where.push(gte(b.scheduledAt, namedDayBounds(f.jobAfter, tz).start));
  if (f.jobBefore) where.push(lt(b.scheduledAt, namedDayBounds(f.jobBefore, tz).start));
  const rows = await t.transaction((tx) =>
    tx.selectDistinct({ customerId: b.customerId }).from(b).where(t.scope(b, and(...where))),
  );
  return new Set(rows.map((r) => r.customerId));
}

/** Run a resolved filter over a company's Directory. */
export async function runDirectoryFilter(
  companyId: string,
  filter: DirectoryFilter,
  page: { page?: number; pageSize?: number; withIds?: boolean },
  tz: string,
  loaded?: { rows: DirectoryRow[] },
): Promise<DirectoryResult> {
  const { rows } = loaded ?? (await loadDirectory(companyId));
  const jobs = needsJobs(filter) ? await customersWithJobs(companyId, filter, tz) : null;
  const test = filterPredicate(filter, jobs, tz);
  const ids = rows.filter(test).map((r) => r.id);
  return applyDirectoryQuery(rows, {
    kind: filter.kind,
    q: filter.keywords,
    ids,
    sort: filter.sort,
    dir: filter.dir,
    groupBy: filter.groupBy,
    page: page.page,
    pageSize: page.pageSize,
    withIds: page.withIds,
  });
}

/**
 * The company's own words for its people (prompt and chips) and its time
 * zone: "today" and every day boundary are its calendar, not the server's UTC.
 */
export async function companyAskContext(companyId: string): Promise<{ nouns: AskNouns; tz: string }> {
  const s = await tdb(companyId).selectOne(schema.companySettings);
  const clean = (v: string | null | undefined, d: string) => (v && /^[A-Za-z][A-Za-z '-]{0,29}$/.test(v.trim()) ? v.trim() : d);
  return {
    nouns: {
      customer: clean(s?.customerNoun, "Customer"),
      customers: clean(s?.customerNounPlural, "Customers"),
      worker: clean(s?.workerNoun, "Technician"),
      workers: clean(s?.workerNounPlural, "Technicians"),
    },
    tz: safeTimeZone(s?.timezone),
  };
}

/** Chips for a filter re-sent by the page (sorting or paging an answer). */
export async function chipsForFilter(companyId: string, filter: DirectoryFilter, nouns: AskNouns): Promise<string[]> {
  const { rows, properties } = await loadDirectory(companyId);
  return filterChips(filter, {
    properties: properties.map((p) => ({ id: p.id, name: p.name })),
    staff: rows.filter((r) => r.kind !== "customer").map((r) => ({ id: r.id, name: r.name })),
    customerNounPlural: nouns.customers,
    workerNounPlural: nouns.workers,
  });
}

/**
 * The small model's reading of a question. Throws when the model does; no
 * budget or fallback here (interpret() adds those). Also what the eval runs.
 */
export async function modelInterpretation(
  question: string,
  ctx: { nouns: AskNouns; properties: PropertyItem[]; staff: DirectoryRow[]; today?: string; abortSignal?: AbortSignal },
): Promise<AskInterpretation> {
  const { object } = await generateObject({
    model: modelOverride ?? gateway(MODELS.small),
    schema: AskInterpretation,
    system: systemPrompt(ctx.nouns),
    prompt: userPrompt(question, ctx.today ?? new Date().toISOString().slice(0, 10), ctx.properties, ctx.staff),
    temperature: 0,
    maxOutputTokens: 700,
    maxRetries: 1,
    abortSignal: ctx.abortSignal,
  });
  return object;
}

async function interpret(
  question: string,
  ctx: { companyId: string; userId: string; nouns: AskNouns; today: string; properties: PropertyItem[]; staff: DirectoryRow[]; abortSignal?: AbortSignal },
): Promise<{ interpretation: AskInterpretation; usedAI: boolean; note?: string }> {
  const named = ctx.properties.map((p) => ({ id: p.id, name: p.name }));
  const team = ctx.staff.map((s) => ({ id: s.id, name: s.name }));
  const fallback = (note?: string) => ({ interpretation: heuristicInterpretation(question, named, team), usedAI: false, note });
  if (!directoryAskAvailable()) return fallback();
  const within =
    (await consumeBudget("directory-ask-user", ctx.userId, ASK_BUDGET.perUser, ASK_BUDGET.windowMs)) &&
    (await consumeBudget("directory-ask-company", ctx.companyId, ASK_BUDGET.perCompany, ASK_BUDGET.windowMs));
  if (!within) return fallback("AI search has hit its hourly limit, so this is a keyword search.");
  try {
    return { interpretation: await modelInterpretation(question, ctx), usedAI: true };
  } catch (e) {
    log.warn("directory-ask: model failed, using keyword reading", { companyId: ctx.companyId, error: (e as Error)?.message });
    return fallback("AI search didn't answer just now, so this is a keyword search.");
  }
}

/** Ask the Directory a question. */
export async function askDirectory(
  companyId: string,
  question: string,
  opts: { userId: string; nouns: AskNouns; tz: string; page?: number; pageSize?: number; abortSignal?: AbortSignal },
): Promise<AskOutcome> {
  const loaded = await loadDirectory(companyId);
  const staff = loaded.rows.filter((r) => r.kind !== "customer");
  const today = zonedDayKey(new Date(), opts.tz);
  const { interpretation, usedAI, note } = await interpret(question, { companyId, userId: opts.userId, nouns: opts.nouns, today, properties: loaded.properties, staff, abortSignal: opts.abortSignal });
  const named = loaded.properties.map((p) => ({ id: p.id, name: p.name }));
  const team = staff.map((s) => ({ id: s.id, name: s.name }));
  const { filter, notes } = resolveInterpretation(interpretation, named, team);
  if (note) notes.unshift(note);
  const page = { page: opts.page, pageSize: opts.pageSize };
  let result = await runDirectoryFilter(companyId, filter, page, opts.tz, loaded);
  let used = filter;
  // Words that matched nobody, alongside filters that did: try without the words.
  if (result.total === 0 && filter.keywords && hasStructure(filter)) {
    const looser = { ...filter, keywords: "" };
    const retry = await runDirectoryFilter(companyId, looser, page, opts.tz, loaded);
    if (retry.total > 0) {
      notes.push(`Nobody matched “${filter.keywords}” as well, so those words were left out.`);
      result = retry;
      used = looser;
    }
  }
  if (result.total === 0 && used.keywords) {
    const close = suggestNames(used.keywords, named);
    if (close.length) notes.push(`No one matched “${used.keywords}”. Did you mean ${close.join(" or ")}?`);
  }
  const chips = filterChips(used, { properties: named, staff: team, customerNounPlural: opts.nouns.customers, workerNounPlural: opts.nouns.workers });
  // The model's one-line summary; the keyword reading has none (the page shows the question).
  const summary = usedAI ? interpretation.summary.trim() : "";
  return { filter: used, result, chips, summary, notes, usedAI };
}
