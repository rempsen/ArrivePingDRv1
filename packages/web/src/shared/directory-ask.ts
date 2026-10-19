/**
 * Directory AI search: a question in plain words → a filter over the Directory.
 *
 * Two shapes:
 *   - AskInterpretation: what the small model fills in, in NAMES (it sees the
 *     company's property and team names, never a resident's details);
 *   - DirectoryFilter: the same with names resolved to this company's ids.
 *     The page sends it back to sort, group and page the answer without
 *     asking the model again.
 *
 * Everything here is pure, so the model's answer, the keyword fallback (when
 * AI is off, over budget or fails) and a re-sent filter all go through the
 * same rules as the Directory's own controls (shared/directory-query.ts).
 */
import { z } from "zod";
import { NONE, type DirectoryRow } from "./directory-query";
import { isUndeliverableEmail } from "./sample-contact";

const KINDS = ["all", "customer", "field", "office"] as const;
const SORTS = ["name", "property", "unit", "manager", "email", "phone", "role", "joined", "openJobs", "lastVisit"] as const;
const GROUPS = ["none", "property", "manager", "role"] as const;
const MISSING = ["email", "phone", "property", "unit"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").nullable();

export const ASK_LIMITS = { question: 300 } as const;

/** The model's answer. Every field is required (empty when unused) so it can't leave one out. */
export const AskInterpretation = z.object({
  kind: z.enum(KINDS).describe("customer for residents/tenants/clients; field or office for staff; all when unclear"),
  keywords: z.string().max(100).describe("Words to look for in a person's name, email, phone, unit or address. Empty when the question names no such thing."),
  properties: z.array(z.string().max(120)).max(10).describe("Names copied from PROPERTIES that the question is about"),
  noProperty: z.boolean().describe("true for people who are at no property"),
  managers: z.array(z.string().max(120)).max(10).describe("Names copied from TEAM: show the residents of the properties they manage"),
  noManager: z.boolean().describe("true for residents whose property has no manager"),
  units: z.array(z.string().max(40)).max(20).describe("Unit numbers, e.g. 4B"),
  city: z.string().max(60).describe("A city or town, or empty"),
  missing: z.array(z.enum(MISSING)).max(4).describe("Details the person has none of"),
  openRequests: z.enum(["any", "some", "none"]).describe("some = has open work orders; none = has none"),
  minOpenRequests: z.number().int().min(0).max(1000).nullable().describe("At least this many open work orders"),
  lastVisitAfter: day.describe("Last completed visit on or after this day"),
  lastVisitBefore: day.describe("Last completed visit before this day"),
  neverVisited: z.boolean().describe("No completed visit ever"),
  joinedAfter: day,
  joinedBefore: day,
  jobText: z.string().max(60).describe("A word a work order's title should contain, e.g. leak, furnace. Empty if none."),
  jobOpenOnly: z.boolean().describe("Only open work orders count for jobText or job dates"),
  jobAfter: day.describe("Has a work order scheduled on or after this day"),
  jobBefore: day.describe("Has a work order scheduled before this day"),
  status: z.enum(["any", "active", "invited", "disabled"]),
  sort: z.enum(SORTS),
  dir: z.enum(["asc", "desc"]),
  groupBy: z.enum(GROUPS),
  summary: z.string().max(200).describe("One short plain line saying who is being shown"),
});
export type AskInterpretation = z.infer<typeof AskInterpretation>;

const id = z.string().min(1).max(128);

/** A resolved filter: what the page sends back to re-sort or page an answer. */
export const DirectoryFilter = z.object({
  kind: z.enum(KINDS),
  keywords: z.string().max(100),
  /** Property ids; "none" = no property; "unmatched" = a name that matched nothing. */
  propertyIds: z.array(id).max(20),
  /** Manager (staff) ids whose properties' residents to show; "none" = property with no manager. */
  managerIds: z.array(id).max(20),
  units: z.array(z.string().max(40)).max(20),
  city: z.string().max(60),
  missing: z.array(z.enum(MISSING)).max(4),
  openRequests: z.enum(["any", "some", "none"]),
  minOpenRequests: z.number().int().min(0).max(1000).nullable(),
  lastVisitAfter: day,
  lastVisitBefore: day,
  neverVisited: z.boolean(),
  joinedAfter: day,
  joinedBefore: day,
  jobText: z.string().max(60),
  jobOpenOnly: z.boolean(),
  jobAfter: day,
  jobBefore: day,
  status: z.enum(["any", "active", "invited", "disabled"]),
  sort: z.enum(SORTS),
  dir: z.enum(["asc", "desc"]),
  groupBy: z.enum(GROUPS),
});
export type DirectoryFilter = z.infer<typeof DirectoryFilter>;

/** Matches no property id: a name in the question that isn't one of theirs. */
export const UNMATCHED = "unmatched";

export function emptyInterpretation(): AskInterpretation {
  return {
    kind: "all",
    keywords: "",
    properties: [],
    noProperty: false,
    managers: [],
    noManager: false,
    units: [],
    city: "",
    missing: [],
    openRequests: "any",
    minOpenRequests: null,
    lastVisitAfter: null,
    lastVisitBefore: null,
    neverVisited: false,
    joinedAfter: null,
    joinedBefore: null,
    jobText: "",
    jobOpenOnly: false,
    jobAfter: null,
    jobBefore: null,
    status: "any",
    sort: "name",
    dir: "asc",
    groupBy: "none",
    summary: "",
  };
}

type Named = { id: string; name: string };

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * The entries a name in a question means: exact (any case or punctuation),
 * else every entry it's a whole-word part of ("maple" → Maple Court), else
 * the one entry a small typo away ("Mapel Court").
 */
export function matchNames(wanted: string, list: Named[]): Named[] {
  const w = norm(wanted);
  if (!w) return [];
  const exact = list.filter((x) => norm(x.name) === w);
  if (exact.length) return exact;
  const words = (s: string) => ` ${s} `;
  const part = list.filter((x) => {
    const n = norm(x.name);
    return n && (words(n).includes(words(w)) || words(w).includes(words(n)));
  });
  if (part.length) return part;
  let best: Named | null = null;
  let bestD = Infinity;
  for (const x of list) {
    const n = norm(x.name);
    const d = editDistance(w, n);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return best && bestD <= Math.max(1, Math.floor(norm(best.name).length * 0.2)) ? [best] : [];
}

/** Up to three names sharing a word (4+ letters) with what was typed: "Juniper Hall" → Juniper House. */
export function suggestNames(text: string, list: Named[]): string[] {
  const words = norm(text)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOP.has(w));
  if (!words.length) return [];
  return list.filter((x) => words.some((w) => ` ${norm(x.name)} `.includes(` ${w} `))).slice(0, 3).map((x) => x.name);
}

const didYouMean = (names: string[]) => (names.length ? ` Did you mean ${names.join(" or ")}?` : "");

/** Names → this company's ids. Notes say what didn't match, so the answer is never silently wider. */
export function resolveInterpretation(
  i: AskInterpretation,
  properties: Named[],
  staff: Named[],
): { filter: DirectoryFilter; notes: string[] } {
  const notes: string[] = [];
  const propertyIds = new Set<string>();
  for (const p of i.properties) {
    const hit = matchNames(p, properties);
    if (hit.length) hit.forEach((h) => propertyIds.add(h.id));
    else {
      notes.push(`No property called “${p}”.${didYouMean(suggestNames(p, properties))}`);
      propertyIds.add(UNMATCHED);
    }
  }
  if (i.noProperty) propertyIds.add(NONE);
  const managerIds = new Set<string>();
  for (const m of i.managers) {
    const hit = matchNames(m, staff);
    if (hit.length) hit.forEach((h) => managerIds.add(h.id));
    else {
      notes.push(`Nobody on the team called “${m}”.${didYouMean(suggestNames(m, staff))}`);
      managerIds.add(UNMATCHED);
    }
  }
  if (i.noManager) managerIds.add(NONE);
  const ok = (d: string | null) => (d && !Number.isNaN(Date.parse(d)) ? d : null);
  const filter: DirectoryFilter = {
    kind: i.kind,
    openRequests: i.openRequests,
    minOpenRequests: i.minOpenRequests,
    neverVisited: i.neverVisited,
    jobOpenOnly: i.jobOpenOnly,
    status: i.status,
    sort: i.sort,
    dir: i.dir,
    groupBy: i.groupBy,
    keywords: i.keywords.trim(),
    city: i.city.trim(),
    jobText: i.jobText.trim(),
    units: [...new Set(i.units.map((u) => u.trim()).filter(Boolean))],
    missing: [...new Set(i.missing)],
    propertyIds: [...propertyIds],
    managerIds: [...managerIds],
    lastVisitAfter: ok(i.lastVisitAfter),
    lastVisitBefore: ok(i.lastVisitBefore),
    joinedAfter: ok(i.joinedAfter),
    joinedBefore: ok(i.joinedBefore),
    jobAfter: ok(i.jobAfter),
    jobBefore: ok(i.jobBefore),
  };
  // Asking about residents of a property or manager means residents.
  if (filter.kind === "all" && (filter.propertyIds.length || filter.managerIds.length || filter.units.length)) filter.kind = "customer";
  return { filter, notes };
}

/** Whether a filter asks for anything beyond keywords (so dropping the keywords still answers it). */
export function hasStructure(f: DirectoryFilter): boolean {
  return (
    f.propertyIds.length > 0 ||
    f.managerIds.length > 0 ||
    f.units.length > 0 ||
    !!f.city ||
    f.missing.length > 0 ||
    f.openRequests !== "any" ||
    f.minOpenRequests !== null ||
    !!(f.lastVisitAfter || f.lastVisitBefore || f.neverVisited) ||
    !!(f.joinedAfter || f.joinedBefore) ||
    !!(f.jobText || f.jobAfter || f.jobBefore) ||
    f.status !== "any"
  );
}

/** Whether a filter needs the job lookup (titles and dates of work orders). */
export function needsJobs(f: DirectoryFilter): boolean {
  return !!(f.jobText || f.jobAfter || f.jobBefore);
}

const dayStart = (d: string) => Date.parse(`${d}T00:00:00.000Z`);

/**
 * The filter as a row test (keywords and kind are left to applyDirectoryQuery).
 * `jobCustomers`: who has a matching work order, when the filter asks about jobs.
 */
export function filterPredicate(f: DirectoryFilter, jobCustomers: Set<string> | null): (r: DirectoryRow) => boolean {
  const props = new Set(f.propertyIds);
  const mgrs = new Set(f.managerIds);
  const units = new Set(f.units.map((u) => norm(u)));
  const city = norm(f.city);
  return (r) => {
    if (props.size && !(r.propertyId ? props.has(r.propertyId) : r.kind === "customer" && props.has(NONE))) return false;
    if (mgrs.size && !(r.managerId ? mgrs.has(r.managerId) : r.kind === "customer" && mgrs.has(NONE))) return false;
    if (units.size && !units.has(norm(r.unit))) return false;
    if (city && !` ${norm(`${r.city} ${r.address} ${r.propertyAddress}`)} `.includes(` ${city} `)) return false;
    for (const m of f.missing) {
      // A placeholder address (an import row without one, a sample) is no email.
      if (m === "email" && r.email && !isUndeliverableEmail(r.email)) return false;
      if (m === "phone" && r.phone) return false;
      if (m === "property" && (r.kind !== "customer" || r.propertyId)) return false;
      if (m === "unit" && (r.kind !== "customer" || r.unit)) return false;
    }
    if (f.openRequests === "some" && r.openJobs < 1) return false;
    if (f.openRequests === "none" && r.openJobs > 0) return false;
    if (f.minOpenRequests !== null && r.openJobs < f.minOpenRequests) return false;
    const last = r.lastVisitAt ? Date.parse(r.lastVisitAt) : null;
    if (f.neverVisited && last !== null) return false;
    if (f.lastVisitAfter && (last === null || last < dayStart(f.lastVisitAfter))) return false;
    if (f.lastVisitBefore && (last === null || last >= dayStart(f.lastVisitBefore))) return false;
    const joined = r.createdAt ? Date.parse(r.createdAt) : null;
    if (f.joinedAfter && (joined === null || joined < dayStart(f.joinedAfter))) return false;
    if (f.joinedBefore && (joined === null || joined >= dayStart(f.joinedBefore))) return false;
    if (f.status !== "any" && r.status !== f.status) return false;
    if (jobCustomers && !jobCustomers.has(r.id)) return false;
    return true;
  };
}

const SORT_LABEL: Record<(typeof SORTS)[number], string> = {
  name: "name",
  property: "property",
  unit: "unit",
  manager: "manager",
  email: "email",
  phone: "phone",
  role: "type",
  joined: "date joined",
  openJobs: "open requests",
  lastVisit: "last visit",
};

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The filter as short chips the page shows, so the person can see how the question was read. */
export function filterChips(
  f: DirectoryFilter,
  names: { properties: Named[]; staff: Named[]; customerNounPlural: string; workerNounPlural: string },
): string[] {
  const chips: string[] = [];
  if (f.kind === "customer") chips.push(names.customerNounPlural);
  else if (f.kind === "field") chips.push(names.workerNounPlural);
  else if (f.kind === "office") chips.push("Office staff");
  const nameOf = (list: Named[], idv: string) => list.find((x) => x.id === idv)?.name;
  for (const p of f.propertyIds) {
    if (p === NONE) chips.push("No property");
    else if (p !== UNMATCHED) chips.push(nameOf(names.properties, p) ?? "A property");
  }
  for (const m of f.managerIds) {
    if (m === NONE) chips.push("No manager");
    else if (m !== UNMATCHED) chips.push(`Manager: ${nameOf(names.staff, m) ?? "a team member"}`);
  }
  if (f.units.length) chips.push(`Unit ${f.units.join(", ")}`);
  if (f.city) chips.push(`In ${f.city}`);
  for (const m of f.missing) chips.push(m === "property" ? "No property" : m === "unit" ? "No unit" : `No ${m}`);
  if (f.minOpenRequests !== null && f.minOpenRequests > 1) chips.push(`${f.minOpenRequests}+ open requests`);
  else if (f.openRequests === "some" || f.minOpenRequests === 1) chips.push("Open requests");
  if (f.openRequests === "none") chips.push("No open requests");
  if (f.neverVisited) chips.push("Never visited");
  if (f.lastVisitAfter) chips.push(`Visited since ${fmtDay(f.lastVisitAfter)}`);
  if (f.lastVisitBefore) chips.push(`Last visit before ${fmtDay(f.lastVisitBefore)}`);
  if (f.joinedAfter) chips.push(`Joined since ${fmtDay(f.joinedAfter)}`);
  if (f.joinedBefore) chips.push(`Joined before ${fmtDay(f.joinedBefore)}`);
  if (f.jobText) chips.push(`${f.jobOpenOnly ? "Open work orders" : "Work orders"} mentioning “${f.jobText}”`);
  else if (f.jobOpenOnly && (f.jobAfter || f.jobBefore)) chips.push("Open work orders");
  if (f.jobAfter) chips.push(`Work order since ${fmtDay(f.jobAfter)}`);
  if (f.jobBefore) chips.push(`Work order before ${fmtDay(f.jobBefore)}`);
  if (f.status !== "any") chips.push(f.status === "disabled" ? "Deactivated" : f.status === "invited" ? "Invited" : "Active");
  if (f.keywords) chips.push(`“${f.keywords}”`);
  if (f.groupBy !== "none") chips.push(`Grouped by ${f.groupBy === "role" ? "type" : f.groupBy}`);
  if (f.sort !== "name" || f.dir !== "asc") chips.push(`Sorted by ${SORT_LABEL[f.sort]}${f.dir === "desc" ? ", highest first" : ""}`);
  return chips;
}

/* ----------------------------- keyword fallback ---------------------------- */

const STOP = new Set(
  (
    "a an and any are at all be by can could did do does every everyone everybody find for from get give has have help " +
    "i in is it list living lives live me my need of on or our please residents resident tenants tenant customers customer " +
    "clients client people person persons show the their them there these this those to us we what whats which who whom " +
    "whose with within without would you staff team members member property properties building buildings manager managers " +
    "managed manages unit units apt apartment suite open request requests order orders work job jobs ticket tickets no not " +
    "never any missing email emails phone phones number numbers contact details detail info sorted sort grouped group " +
    "first last recent recently newest oldest most least visit visits visited been since before after ago year years month " +
    "months week weeks day days today yesterday currently right now outstanding pending active invited deactivated disabled"
  ).split(" "),
);

/**
 * When the model isn't available: pick out property and team names, a few
 * common phrases, and use what's left as keywords. Never as clever as the
 * model, but it always answers.
 */
export function heuristicInterpretation(question: string, properties: Named[], staff: Named[]): AskInterpretation {
  const out = emptyInterpretation();
  let text = ` ${norm(question)} `;
  const q = text;
  const take = (n: string) => {
    text = text.replace(` ${n} `, " ");
  };
  // Longest names first, so "Maple Court East" wins over "Maple Court".
  for (const p of [...properties].sort((a, b) => b.name.length - a.name.length)) {
    const n = norm(p.name);
    if (n && text.includes(` ${n} `)) {
      out.properties.push(p.name);
      take(n);
    }
  }
  // A team member's name means "their residents" only when the question says
  // so; "Jordan Patel's phone" is a search for Jordan.
  if (/\b(manag\w*|pm|looks? after|responsible|run by|handled by|assigned to)\b/.test(text)) {
    for (const s of [...staff].sort((a, b) => b.name.length - a.name.length)) {
      const n = norm(s.name);
      if (n && text.includes(` ${n} `)) {
        out.managers.push(s.name);
        take(n);
      }
    }
  }
  const has = (re: RegExp) => re.test(q);
  if (has(/\b(no|without|missing)( an?)? (e ?mail|email address)\b/)) out.missing.push("email");
  if (has(/\b(no|without|missing)( an?)? (phone|cell|mobile|number|phone number)\b/)) out.missing.push("phone");
  if (has(/\b(no|without|missing)( an?)? unit\b/)) out.missing.push("unit");
  if (has(/\b(no|without)( an?)? (property|building)\b|\bunassigned\b/)) out.noProperty = true;
  if (has(/\b(no|without)( an?)? manager\b|\bunmanaged\b/)) out.noManager = true;
  if (has(/\bno open (requests?|work orders?|jobs?|tickets?)\b/)) out.openRequests = "none";
  else if (has(/\bopen (requests?|work orders?|jobs?|tickets?)\b|\boutstanding\b|\bpending (requests?|work orders?|jobs?)\b/)) out.openRequests = "some";
  if (has(/\bnever (been )?(visited|serviced|seen)\b|\bno visits?\b/)) out.neverVisited = true;
  const unit = /\b(?:unit|apt|apartment|suite)\s+([a-z0-9-]{1,8})\b/.exec(q);
  if (unit) {
    out.units.push(unit[1]!.toUpperCase());
    take(unit[1]!);
  }
  if (has(/\b(resident|tenant|customer|client|people at|who live|living)s?\b/) || out.properties.length || out.managers.length || out.units.length || out.noProperty)
    out.kind = "customer";
  else if (has(/\b(technicians?|techs?|field staff|vendors?)\b/)) out.kind = "field";
  else if (has(/\b(office|dispatchers?)\b/)) out.kind = "office";
  if (has(/\bby unit\b/)) out.sort = "unit";
  else if (has(/\bby property\b|\bby building\b/)) out.sort = "property";
  else if (has(/\bby manager\b/)) out.sort = "manager";
  else if (has(/\bmost open\b/)) [out.sort, out.dir] = ["openJobs", "desc"];
  else if (has(/\b(recent|latest) visit|\brecently visited\b/)) [out.sort, out.dir] = ["lastVisit", "desc"];
  else if (has(/\bnewest\b|\brecently (added|joined)\b/)) [out.sort, out.dir] = ["joined", "desc"];
  if (has(/\bgroup(ed)? by property\b|\bgroup(ed)? by building\b/)) out.groupBy = "property";
  else if (has(/\bgroup(ed)? by manager\b/)) out.groupBy = "manager";
  out.keywords = text
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .join(" ")
    .slice(0, 100);
  return out;
}
