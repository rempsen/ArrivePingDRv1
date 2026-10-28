/**
 * Pure helpers for the App Store release script (release.ts). No network,
 * no file system, so `bun test scripts` covers them.
 */

/** -1, 0, 1 comparing dotted versions numerically ("1.0.10" > "1.0.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface AscVersion {
  id: string;
  versionString: string;
  /** App Store Connect's appVersionState (falls back to the older appStoreState). */
  state: string;
}

/** States in which a version can still be edited and submitted. */
export const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
/** States meaning a version is already with Apple; a second submission would be refused. */
export const WITH_APPLE = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "PENDING_APPLE_RELEASE", "PROCESSING_FOR_DISTRIBUTION", "PROCESSING_FOR_APP_STORE"]);
/** States meaning the version is (or was) live. */
export const LIVE = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"]);

/** Highest version that has been on the App Store, or null for a first release. */
export function liveVersion(versions: readonly AscVersion[]): string | null {
  const live = versions.filter((v) => LIVE.has(v.state)).map((v) => v.versionString);
  return live.sort(compareVersions).at(-1) ?? null;
}

export type Plan =
  | { kind: "blocked"; reason: string }
  | { kind: "reuse"; versionId: string; rename: boolean }
  | { kind: "create" };

/**
 * What to do with App Store Connect's versions before submitting `version`:
 * refuse when it isn't newer than what's live or a review is already under
 * way, reuse the open draft (renaming it if needed), or create a new one.
 */
export function planVersion(versions: readonly AscVersion[], version: string): Plan {
  const live = liveVersion(versions);
  if (live && compareVersions(version, live) <= 0)
    return {
      kind: "blocked",
      reason: `Version ${version} is not newer than the live App Store version ${live}. Raise "version" in packages/mobile/app.json (e.g. to ${bumpPatch(live)}) and release again.`,
    };
  const busy = versions.find((v) => WITH_APPLE.has(v.state));
  if (busy)
    return {
      kind: "blocked",
      reason: `Version ${busy.versionString} is already with Apple (${busy.state}). Wait for it to be released or rejected, or withdraw it in App Store Connect, then release again.`,
    };
  const draft = versions.find((v) => EDITABLE.has(v.state));
  if (draft) return { kind: "reuse", versionId: draft.id, rename: draft.versionString !== version };
  return { kind: "create" };
}

export function bumpPatch(v: string): string {
  const p = v.split(".").map((n) => parseInt(n, 10) || 0);
  while (p.length < 3) p.push(0);
  p[2]++;
  return p.join(".");
}

/** Release notes fit Apple's 4000-character "What's New" limit and are never empty. */
export function whatsNew(notes: string | undefined): string {
  const t = (notes ?? "").trim();
  return (t || "Improvements and fixes.").slice(0, 4000);
}
