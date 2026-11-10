/**
 * The "My vehicle" form on the technician's Profile: make & model, colour and
 * plate. The pure parts live here — checking the fields and deciding what to
 * send — so the sheet stays presentation. The server enforces the same rules
 * (PATCH /api/riders/me): colour and plate may be blank, the make and model
 * may not.
 */

export type VehicleForm = { vehicle: string; vehicleColor: string; licensePlate: string };

/** The fields of a rider row this form reads. */
type RiderVehicle = { vehicle?: string | null; vehicleColor?: string | null; licensePlate?: string | null };

export const VEHICLE_MAX = 120;
export const COLOR_MAX = 40;
export const PLATE_MAX = 32;

/** The form's starting values from the technician's profile. */
export function formFromRider(rider: RiderVehicle | null | undefined): VehicleForm {
  return {
    vehicle: rider?.vehicle ?? "",
    vehicleColor: rider?.vehicleColor ?? "",
    licensePlate: rider?.licensePlate ?? "",
  };
}

/** What's wrong with the form, or null if it can be saved. */
export function vehicleProblem(f: VehicleForm): string | null {
  const make = f.vehicle.trim();
  if (make.length < 2) return "Add the make and model, e.g. Ford Transit.";
  if (make.length > VEHICLE_MAX) return `Make and model must be ${VEHICLE_MAX} characters or fewer.`;
  if (f.vehicleColor.trim().length > COLOR_MAX) return `Colour must be ${COLOR_MAX} characters or fewer.`;
  if (f.licensePlate.trim().length > PLATE_MAX) return `Plate must be ${PLATE_MAX} characters or fewer.`;
  return null;
}

/** The body to PATCH: trimmed, with the plate upper-cased as the server stores it. */
export function vehiclePatch(f: VehicleForm): VehicleForm {
  return {
    vehicle: f.vehicle.trim(),
    vehicleColor: f.vehicleColor.trim(),
    licensePlate: f.licensePlate.trim().toUpperCase(),
  };
}

/** True when saving would change nothing, so Save can stay disabled. */
export function vehicleUnchanged(f: VehicleForm, rider: RiderVehicle | null | undefined): boolean {
  const next = vehiclePatch(f);
  const cur = vehiclePatch(formFromRider(rider));
  return next.vehicle === cur.vehicle && next.vehicleColor === cur.vehicleColor && next.licensePlate === cur.licensePlate;
}
