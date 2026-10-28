/**
 * When to show Google Play's prominent disclosure for background location.
 * Pure (no React Native imports) so it runs under `bun test`.
 *
 * Play policy: an Android app that uses location in the background must show
 * its own in-app disclosure — what is collected, that it's collected even when
 * the app is closed or not in use, and why — and get the user's OK before the
 * system location prompts. iOS has no such rule (its prompt carries our
 * purpose string), so the disclosure is Android only.
 */

export type PermissionSnapshot = { granted: boolean; canAskAgain: boolean };

/** "Not now" (or a refusal at Android's prompt) is honoured this long before we ask again. */
export const ASK_AGAIN_AFTER_MS = 3 * 24 * 60 * 60_000;

export type DisclosureDecision =
  /** Nothing to disclose: go ahead (iOS, already granted, or no prompt can appear). */
  | "proceed"
  /** Show the disclosure; request permissions only if the technician agrees. */
  | "show"
  /** They said "Not now" recently: don't show it again, don't prompt. */
  | "skip";

export function disclosureDecision(input: {
  os: string;
  background: PermissionSnapshot;
  foreground: PermissionSnapshot;
  declinedAt: number | null;
  now: number;
}): DisclosureDecision {
  const { os, background, foreground, declinedAt, now } = input;
  if (os !== "android") return "proceed";
  if (background.granted) return "proceed";
  // A permanently denied permission shows no system prompt, so a disclosure
  // would lead nowhere; the requests that follow just read the status.
  const promptable = background.canAskAgain && (foreground.granted || foreground.canAskAgain);
  if (!promptable) return "proceed";
  if (declinedAt !== null && Number.isFinite(declinedAt) && declinedAt > 0 && now - declinedAt < ASK_AGAIN_AFTER_MS) {
    return "skip";
  }
  return "show";
}
