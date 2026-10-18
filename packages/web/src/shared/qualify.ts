/**
 * Is this technician qualified for this job? — the ONE rule.
 *
 * The map, the scheduler's highlight and the dispatch ranking used to each
 * have their own idea: the scheduler compared skill classes, the ranking
 * looked for the first word of the service category in the tech's skills, and
 * the map had nothing. A tech could look right on one screen and wrong on the
 * next. Everything now asks this function.
 *
 * The rule, in order (comparisons ignore case and surrounding spaces):
 *
 *  1. Explicit requirements win. A job can name a required skill class
 *     (`requiredSkillClass`, e.g. "HVAC") and individual skill tags
 *     (`requiredSkills`, e.g. "Boiler, Gas"). Every one of them must appear in
 *     the technician's skills or be their skill class.
 *  2. With no explicit requirement, the job's service category stands in —
 *     "HVAC Repair" asks for "HVAC Repair" or "HVAC" — but only when the
 *     technician has listed skills at all. A tech with no skills recorded is
 *     unknown, not unqualified: most small teams never fill skills in, and
 *     greying out everybody there would make dispatch worse, not safer.
 *  3. Otherwise everyone qualifies.
 *
 * "General" (the default skill class) and catch-all categories never count as
 * a requirement or as a skill.
 */

export interface QualifyTech {
  /** CSV ("HVAC, Electrical") or a list. */
  skills?: string | readonly string[] | null;
  skillClass?: string | null;
}

export interface QualifyJob {
  requiredSkillClass?: string | null;
  /** CSV or a list of individual skill tags. */
  requiredSkills?: string | readonly string[] | null;
  /** The service's category, used only when nothing is explicitly required. */
  serviceCategory?: string | null;
}

export interface Qualification {
  qualified: boolean;
  /** Requirements the technician doesn't meet, in the job's own spelling. */
  missing: string[];
  /** Requirements they do meet. */
  matched: string[];
  /** What decided it: explicit requirements, the service category, or nothing to check. */
  basis: "required" | "category" | "none";
}

const GENERIC = new Set(["", "general", "other", "misc", "miscellaneous", "any", "none"]);

const norm = (s: string) => s.trim().toLowerCase();

/** Split a CSV (or list) into trimmed, de-duplicated (case-insensitively) skills. */
export function parseSkills(v: string | readonly string[] | null | undefined): string[] {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const s = String(raw ?? "").trim();
    const k = norm(s);
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** The technician's skills plus their skill class, normalised. */
function techSet(t: QualifyTech): Set<string> {
  const set = new Set(parseSkills(t.skills).map(norm).filter((s) => !GENERIC.has(s)));
  const cls = norm(t.skillClass ?? "");
  if (!GENERIC.has(cls)) set.add(cls);
  return set;
}

export function qualifies(tech: QualifyTech, job: QualifyJob): Qualification {
  const have = techSet(tech);

  const required: string[] = [];
  const cls = (job.requiredSkillClass ?? "").trim();
  if (!GENERIC.has(norm(cls))) required.push(cls);
  for (const s of parseSkills(job.requiredSkills)) {
    if (!GENERIC.has(norm(s)) && !required.some((r) => norm(r) === norm(s))) required.push(s);
  }

  if (required.length > 0) {
    const missing = required.filter((r) => !have.has(norm(r)));
    const matched = required.filter((r) => have.has(norm(r)));
    return { qualified: missing.length === 0, missing, matched, basis: "required" };
  }

  const category = (job.serviceCategory ?? "").trim();
  if (!GENERIC.has(norm(category)) && have.size > 0) {
    const first = norm(category).split(/\s+/)[0] ?? "";
    const ok = have.has(norm(category)) || (first !== "" && have.has(first));
    return ok
      ? { qualified: true, missing: [], matched: [category], basis: "category" }
      : { qualified: false, missing: [category], matched: [], basis: "category" };
  }

  return { qualified: true, missing: [], matched: [], basis: "none" };
}
