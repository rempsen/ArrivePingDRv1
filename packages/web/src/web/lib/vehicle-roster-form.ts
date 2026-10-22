/**
 * The onboarding chat's vehicle form (components/onboarding-vehicle-form.tsx):
 * rows of make & model / colour / license plate, optionally tied to one of the field
 * staff just added, instead of one question per person. The pure parts —
 * validating the rows and turning them into the message the concierge reads,
 * which it passes on as each person's `vehicle` in add_team_members.
 */

export type VehicleRow = { who: string; makeModel: string; color: string; plate: string };

/** Nobody has this many vehicles at onboarding; also keeps the message small. */
export const MAX_VEHICLE_ROWS = 40;

export const emptyVehicleRow = (who = ""): VehicleRow => ({ who, makeModel: "", color: "", plate: "" });

// `who` alone doesn't make a row: a person pre-listed on the form with nothing
// typed is "skipped", not an error.
const isBlank = (r: VehicleRow) => !r.makeModel.trim() && !r.color.trim() && !r.plate.trim();

/** What's wrong with one row, or null if fine or untouched. A colour or plate
 * on its own isn't enough to say which vehicle it is. */
export function vehicleRowProblem(r: VehicleRow): string | null {
  if (isBlank(r)) return null;
  if (r.makeModel.trim().length < 2) return "Add the make and model";
  return null;
}

/** Index → problem for every row that has one. */
export function vehicleRowProblems(rows: VehicleRow[]): Record<number, string> {
  const out: Record<number, string> = {};
  rows.forEach((r, i) => {
    const p = vehicleRowProblem(r);
    if (p) out[i] = p;
  });
  return out;
}

/** The rows with a vehicle in them, trimmed, plates upper-cased. */
export function filledVehicleRows(rows: VehicleRow[]): VehicleRow[] {
  return rows
    .filter((r) => !isBlank(r))
    .map((r) => ({ who: r.who.trim(), makeModel: r.makeModel.trim(), color: r.color.trim(), plate: r.plate.trim().toUpperCase() }));
}

/** Sent by "Skip for now": the concierge is waiting on the form, so say so. */
export const VEHICLES_SKIPPED_MESSAGE = "(From the vehicle form)\nSkip the vehicles for now — I'll add them later in Settings.";

/** The user message the form sends, one labelled line per vehicle. */
export function vehicleRowsMessage(rows: VehicleRow[]): string {
  const lines = filledVehicleRows(rows).map(
    (r) => `- ${r.who || "(not assigned to anyone)"}: ${r.makeModel}${r.color ? ` | colour: ${r.color}` : ""}${r.plate ? ` | plate: ${r.plate}` : ""}`,
  );
  return `(From the vehicle form)\n${lines.join("\n")}`;
}
