/**
 * Practice and sample jobs on the technician's phone.
 *
 * A practice job is the one pretend job a new technician gets for their first
 * run (server: packages/web/src/services/practice-job.ts). Its id is
 * deterministic, `smp-<company>-practice-<technician>`, which is how the app
 * recognises it (the server strips the internal `__sample` marker from
 * fieldData). Any other `isSample` job is from the office's sample day, for
 * example a sample job the office assigned to a real technician to try things.
 * Neither ever messages anyone, and neither is paid.
 */
export function isSampleJob(b: { isSample?: boolean | null } | null | undefined): boolean {
  return Boolean(b?.isSample);
}

export function isPracticeJob(b: { id?: string; isSample?: boolean | null } | null | undefined): boolean {
  return Boolean(b?.isSample && typeof b.id === "string" && /^smp-[a-z0-9]+-practice-/.test(b.id));
}
