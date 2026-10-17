import { describe, expect, test } from "bun:test";
import { EMPTY_ONBOARDING, mergeOnboarding, parseOnboarding } from "../onboarding";
import { OnboardingPatchSchema } from "../onboarding-schema";

const at = "2026-10-17T22:00:00.000Z";

describe("guide onboarding state", () => {
  test("parses empty, junk and partial records safely", () => {
    expect(parseOnboarding(null)).toEqual({ v: 1, tours: {} });
    expect(parseOnboarding("not json")).toEqual({ v: 1, tours: {} });
    expect(parseOnboarding('{"goal":"eta"}')).toEqual({ v: 1, tours: {}, goal: "eta" });
  });

  test("merges tours per chapter and keeps other fields", () => {
    const a = mergeOnboarding(EMPTY_ONBOARDING, { goal: "track", tours: { scheduler: { status: "skipped", at } } });
    const b = mergeOnboarding(a, { tours: { "find-your-way": { status: "completed", at } } });
    expect(b.goal).toBe("track");
    expect(Object.keys(b.tours).sort()).toEqual(["find-your-way", "scheduler"]);
  });

  test("a completed chapter is never downgraded to skipped", () => {
    const done = mergeOnboarding(EMPTY_ONBOARDING, { tours: { scheduler: { status: "completed", at } } });
    const replayClosed = mergeOnboarding(done, { tours: { scheduler: { status: "skipped", at } } });
    expect(replayClosed.tours.scheduler.status).toBe("completed");
  });

  test("PATCH schema rejects unknown fields and bad chapter ids", () => {
    expect(OnboardingPatchSchema.safeParse({ goal: "eta" }).success).toBe(true);
    expect(OnboardingPatchSchema.safeParse({ admin: true }).success).toBe(false);
    expect(OnboardingPatchSchema.safeParse({ tours: { "../x": { status: "completed", at } } }).success).toBe(false);
    expect(OnboardingPatchSchema.safeParse({ tours: { scheduler: { status: "done", at } } }).success).toBe(false);
  });
});
