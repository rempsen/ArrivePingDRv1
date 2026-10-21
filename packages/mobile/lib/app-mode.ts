/**
 * Field mode or office mode?
 *
 * The app has two halves: the technician screens under `app/(rider)` and the
 * office screens under `app/(office)` (dispatch board, jobs, messaging). Which
 * one a person gets is decided once per company pick, from three inputs:
 *
 *   role       the membership role at the chosen company (better-auth role)
 *   staffType  set on the membership when the person also works in the field
 *              ("technician" | "driver"); the only signal office mode may use
 *              for "is this person also a tech", because `GET /riders/me`
 *              self-creates a rider record for whoever calls it
 *   saved      the mode they last chose, kept on the device
 *
 * Riders only ever see field mode. Office-only people only ever see office
 * mode. A person who is both (an owner who dispatches AND runs calls) gets the
 * mode they last used, defaulting to office, plus a switch in Profile.
 */
export type AppMode = "field" | "office";

export const OFFICE_ROLES: ReadonlySet<string> = new Set([
  "superadmin",
  "admin",
  "manager",
  "dispatcher",
  "project_manager",
]);

export function isOfficeRole(role: string | null | undefined): boolean {
  return !!role && OFFICE_ROLES.has(role);
}

export function resolveMode(input: {
  role: string | null | undefined;
  staffType: string | null | undefined;
  saved: AppMode | null;
}): { mode: AppMode; canSwitch: boolean } {
  const office = isOfficeRole(input.role);
  const field = input.role === "rider" || !!input.staffType;
  if (office && field) return { mode: input.saved ?? "office", canSwitch: true };
  if (office) return { mode: "office", canSwitch: false };
  return { mode: "field", canSwitch: false };
}
