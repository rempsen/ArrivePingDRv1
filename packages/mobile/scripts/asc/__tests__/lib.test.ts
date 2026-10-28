import { describe, expect, test } from "bun:test";
import { bumpPatch, compareVersions, liveVersion, planVersion, whatsNew, type AscVersion } from "../lib";

const v = (id: string, versionString: string, state: string): AscVersion => ({ id, versionString, state });

describe("compareVersions", () => {
  test("numeric, not string, order", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.5", "1.0.5")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
  });
});

describe("planVersion", () => {
  test("first release creates a version", () => {
    expect(planVersion([], "1.0.0")).toEqual({ kind: "create" });
  });
  test("refuses a version that is not newer than live", () => {
    const p = planVersion([v("a", "1.0.5", "READY_FOR_SALE")], "1.0.5");
    expect(p.kind).toBe("blocked");
    if (p.kind === "blocked") expect(p.reason).toContain("1.0.6");
  });
  test("refuses while another version is in review", () => {
    const p = planVersion([v("a", "1.0.5", "READY_FOR_SALE"), v("b", "1.0.6", "WAITING_FOR_REVIEW")], "1.0.7");
    expect(p.kind).toBe("blocked");
  });
  test("reuses an open draft and renames it when the number differs", () => {
    expect(planVersion([v("a", "1.0.5", "READY_FOR_SALE"), v("b", "1.0.6", "PREPARE_FOR_SUBMISSION")], "1.0.7")).toEqual({ kind: "reuse", versionId: "b", rename: true });
    expect(planVersion([v("b", "1.0.6", "REJECTED"), v("a", "1.0.5", "READY_FOR_SALE")], "1.0.6")).toEqual({ kind: "reuse", versionId: "b", rename: false });
  });
  test("refuses while a version waits on export compliance", () => {
    expect(planVersion([v("a", "1.0.5", "READY_FOR_SALE"), v("b", "1.0.7", "WAITING_FOR_EXPORT_COMPLIANCE")], "1.0.8").kind).toBe("blocked");
  });
  test("reuses a version removed from review (READY_FOR_REVIEW)", () => {
    expect(planVersion([v("a", "1.0.5", "READY_FOR_SALE"), v("b", "1.0.7", "READY_FOR_REVIEW")], "1.0.8")).toEqual({ kind: "reuse", versionId: "b", rename: true });
  });
  test("reuses the one non-live version even in a state it doesn't know", () => {
    expect(planVersion([v("a", "1.0.5", "READY_FOR_SALE"), v("b", "1.0.7", "SOMETHING_NEW")], "1.0.8")).toEqual({ kind: "reuse", versionId: "b", rename: true });
  });
  test("creates the next version when only live ones exist", () => {
    expect(planVersion([v("a", "1.0.5", "READY_FOR_SALE"), v("z", "1.0.4", "REPLACED_WITH_NEW_VERSION")], "1.0.6")).toEqual({ kind: "create" });
  });
});

test("liveVersion picks the highest live one", () => {
  expect(liveVersion([v("a", "1.0.4", "REPLACED_WITH_NEW_VERSION"), v("b", "1.0.5", "READY_FOR_SALE"), v("c", "1.0.6", "PREPARE_FOR_SUBMISSION")])).toBe("1.0.5");
});

test("bumpPatch and whatsNew", () => {
  expect(bumpPatch("1.0.9")).toBe("1.0.10");
  expect(bumpPatch("2")).toBe("2.0.1");
  expect(whatsNew("  ")).toBe("Improvements and fixes.");
  expect(whatsNew("x".repeat(5000)).length).toBe(4000);
});
