/**
 * Google Play rejects Android apps that ask for background location without
 * first showing their own disclosure. These pin when ours appears.
 */
import { describe, expect, test } from "bun:test";
import { ASK_AGAIN_AFTER_MS, disclosureDecision, type PermissionSnapshot } from "../location-disclosure-core";

const NOW = Date.UTC(2026, 9, 28, 18, 0);
const notAsked: PermissionSnapshot = { granted: false, canAskAgain: true };
const granted: PermissionSnapshot = { granted: true, canAskAgain: true };
const blocked: PermissionSnapshot = { granted: false, canAskAgain: false };

const decide = (o: Partial<Parameters<typeof disclosureDecision>[0]>) =>
  disclosureDecision({ os: "android", background: notAsked, foreground: notAsked, declinedAt: null, now: NOW, ...o });

describe("background location disclosure", () => {
  test("shows on Android before the first location prompt", () => {
    expect(decide({})).toBe("show");
  });

  test("shows before the 'Allow all the time' step when only foreground was granted", () => {
    expect(decide({ foreground: granted })).toBe("show");
  });

  test("never on iOS — its own prompt carries our purpose string", () => {
    expect(decide({ os: "ios" })).toBe("proceed");
  });

  test("not again once background location is granted", () => {
    expect(decide({ background: granted, foreground: granted })).toBe("proceed");
  });

  test("not when Android can't show a prompt anyway", () => {
    expect(decide({ background: blocked })).toBe("proceed");
    expect(decide({ foreground: blocked })).toBe("proceed");
  });

  test("'Not now' holds for a few days, then we ask again", () => {
    expect(decide({ declinedAt: NOW - 60 * 60_000 })).toBe("skip");
    expect(decide({ declinedAt: NOW - ASK_AGAIN_AFTER_MS - 1 })).toBe("show");
  });

  test("a garbled stored value doesn't suppress it", () => {
    expect(decide({ declinedAt: Number.NaN })).toBe("show");
    expect(decide({ declinedAt: 0 })).toBe("show");
  });
});
