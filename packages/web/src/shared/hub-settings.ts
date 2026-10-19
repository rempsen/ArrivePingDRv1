/**
 * The company settings platform staff may fine-tune for a tenant from the
 * Control Hub (Tenant → Settings). Shared by the hub API (which validates and
 * writes only these) and the hub screen (which draws one control per entry).
 *
 * Deliberately left out: anything about money or identity (tax, currency,
 * legal name, address), and the tenant's own "allow ArrivePing support to
 * sign in" consent, which only the tenant can change.
 */
export type HubSettingDef =
  | { key: string; label: string; group: string; type: "boolean"; help?: string }
  | { key: string; label: string; group: string; type: "int"; min: number; max: number; unit?: string; help?: string }
  | { key: string; label: string; group: string; type: "choice"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; group: string; type: "text"; max: number; help?: string };

export const HUB_SETTINGS = [
  { key: "distanceUnit", label: "Distances", group: "Map & arrival", type: "choice", options: [{ value: "metric", label: "Metres and km" }, { value: "imperial", label: "Feet and miles" }] },
  { key: "geofenceRadiusM", label: "Arrival radius", group: "Map & arrival", type: "int", min: 25, max: 2000, unit: "m", help: "How close a technician must be for the job to count as arrived." },
  { key: "officeStaffAssignable", label: "Office staff can take jobs", group: "Map & arrival", type: "boolean" },
  { key: "timezone", label: "Time zone", group: "Map & arrival", type: "text", max: 64 },
  { key: "allowCustomerReschedule", label: "Customers can ask to reschedule", group: "Customer changes", type: "boolean" },
  { key: "allowCustomerCancelRequest", label: "Customers can ask to cancel", group: "Customer changes", type: "boolean" },
  { key: "customerChangeCutoffHours", label: "Change cut-off", group: "Customer changes", type: "int", min: 0, max: 168, unit: "h", help: "No customer changes this close to the appointment." },
  { key: "delayNoticeEnabled", label: "Running-late notices", group: "Running late", type: "boolean" },
  { key: "delayNoticeThresholdMins", label: "Late by", group: "Running late", type: "int", min: 5, max: 240, unit: "min" },
  { key: "delayNoticeAutoSendAfterMins", label: "Send on its own after", group: "Running late", type: "int", min: 0, max: 240, unit: "min" },
  { key: "reviewRequestEnabled", label: "Ask for a review after each job", group: "Reviews", type: "boolean" },
  { key: "reviewRequestDelayMins", label: "Ask after", group: "Reviews", type: "int", min: 0, max: 10080, unit: "min" },
  { key: "workerNoun", label: "Name for technicians", group: "Words", type: "text", max: 40 },
  { key: "workerNounPlural", label: "…plural", group: "Words", type: "text", max: 40 },
  { key: "customerNoun", label: "Name for customers", group: "Words", type: "text", max: 40 },
  { key: "customerNounPlural", label: "…plural", group: "Words", type: "text", max: 40 },
  { key: "jobNoun", label: "Name for jobs", group: "Words", type: "text", max: 40 },
  { key: "jobNounPlural", label: "…plural", group: "Words", type: "text", max: 40 },
] as const satisfies readonly HubSettingDef[];

export type HubSettingKey = (typeof HUB_SETTINGS)[number]["key"];

const BY_KEY = new Map<string, HubSettingDef>(HUB_SETTINGS.map((s) => [s.key, s as HubSettingDef]));

/**
 * Check a patch against the allow-list. Returns the clean values, or the first
 * problem in plain words. Unknown keys are refused, not dropped, so a typo
 * never looks like it worked.
 */
export function validateHubSettings(patch: Record<string, unknown>): { ok: true; values: Record<string, string | number | boolean> } | { ok: false; message: string } {
  const values: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(patch)) {
    const d = BY_KEY.get(k);
    if (!d) return { ok: false, message: `"${k}" can't be changed from the Control Hub.` };
    if (d.type === "boolean") {
      if (typeof v !== "boolean") return { ok: false, message: `${d.label}: choose on or off.` };
      values[k] = v;
    } else if (d.type === "int") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < d.min || n > d.max) return { ok: false, message: `${d.label}: enter a whole number from ${d.min} to ${d.max}.` };
      values[k] = n;
    } else if (d.type === "choice") {
      if (!d.options.some((o) => o.value === v)) return { ok: false, message: `${d.label}: pick one of the options.` };
      values[k] = String(v);
    } else {
      const s = String(v ?? "").trim();
      if (!s || s.length > d.max) return { ok: false, message: `${d.label}: enter 1 to ${d.max} characters.` };
      if (k === "timezone") {
        try {
          new Intl.DateTimeFormat("en-CA", { timeZone: s });
        } catch {
          return { ok: false, message: "Time zone: use a name like America/Winnipeg." };
        }
      }
      values[k] = s;
    }
  }
  if (Object.keys(values).length === 0) return { ok: false, message: "Nothing to change." };
  return { ok: true, values };
}
