/**
 * The onboarding chat's team form (components/onboarding-team-form.tsx): rows
 * of name / phone / email the owner fills in instead of typing a comma
 * separated list. These are the pure parts — validating the rows and turning
 * them into the message the concierge reads, in the same spirit as the
 * "(From a photo of our team list)" message it already handles.
 */

export type TeamRow = { name: string; phone: string; email: string };

/** add_team_members takes at most 40 people (api/routes/onboarding.ts). */
export const MAX_TEAM_ROWS = 40;

export const emptyTeamRow = (): TeamRow => ({ name: "", phone: "", email: "" });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isBlank = (r: TeamRow) => !r.name.trim() && !r.phone.trim() && !r.email.trim();

/** What's wrong with one row, or null if it's fine or completely empty. Name
 * and email are needed to invite someone; the phone is optional. */
export function teamRowProblem(r: TeamRow): string | null {
  if (isBlank(r)) return null;
  if (r.name.trim().length < 2) return "Add a name";
  if (!r.email.trim()) return "Add an email so they can log in";
  if (!EMAIL_RE.test(r.email.trim())) return "That email doesn't look right";
  return null;
}

/** Index → problem for every row that has one. Empty rows are ignored. */
export function teamRowProblems(rows: TeamRow[]): Record<number, string> {
  const out: Record<number, string> = {};
  rows.forEach((r, i) => {
    const p = teamRowProblem(r);
    if (p) out[i] = p;
  });
  return out;
}

/** The rows that have anything in them, trimmed. */
export function filledTeamRows(rows: TeamRow[]): TeamRow[] {
  return rows
    .filter((r) => !isBlank(r))
    .map((r) => ({ name: r.name.trim(), phone: r.phone.trim(), email: r.email.trim() }));
}

/** The user message the form sends. Labelled so nothing depends on column
 * order; the concierge treats it like a pasted list (step 2b of its prompt). */
export function teamRowsMessage(rows: TeamRow[]): string {
  const lines = filledTeamRows(rows).map(
    (r) => `- ${r.name} | email: ${r.email}${r.phone ? ` | mobile: ${r.phone}` : ""}`,
  );
  return `(From the team form)\n${lines.join("\n")}`;
}
