/**
 * Skill classes: the one trade each technician is filed under (the "Skill
 * class" on a technician, and the class a job can require). Each company
 * keeps its own list in company_settings.skill_classes (a JSON array of
 * names, in display order). Empty means it hasn't set one and gets the
 * defaults below, so nothing changes for a company until an admin edits it.
 */

export const DEFAULT_SKILL_CLASSES: readonly string[] = ["General", "HVAC", "Electrical", "Plumbing", "Appliance", "Carpentry", "Landscaping"];

export const MAX_SKILL_CLASSES = 50;
export const MAX_SKILL_CLASS_LEN = 60;

/** The stored value as a list; the defaults when nothing usable is stored. */
export function parseSkillClasses(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [...DEFAULT_SKILL_CLASSES];
    try {
      v = JSON.parse(raw);
    } catch {
      return [...DEFAULT_SKILL_CLASSES];
    }
  }
  if (!Array.isArray(v)) return [...DEFAULT_SKILL_CLASSES];
  const list = cleanSkillClasses(v.map(String));
  return list.length ? list : [...DEFAULT_SKILL_CLASSES];
}

/** Trimmed, single-spaced, no blanks, first spelling wins on a case-insensitive repeat. */
export function cleanSkillClasses(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const name = n.replace(/\s+/g, " ").trim().slice(0, MAX_SKILL_CLASS_LEN);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * The list after renaming `from` to `to`. Renaming onto a class that already
 * exists merges the two (the old entry goes, the existing one keeps its place).
 */
export function renameSkillClass(list: readonly string[], from: string, to: string): string[] {
  const target = to.replace(/\s+/g, " ").trim();
  const exists = list.some((n) => n.toLowerCase() === target.toLowerCase() && n.toLowerCase() !== from.toLowerCase());
  const next = exists ? list.filter((n) => n.toLowerCase() !== from.toLowerCase()) : list.map((n) => (n.toLowerCase() === from.toLowerCase() ? target : n));
  return cleanSkillClasses(next);
}
