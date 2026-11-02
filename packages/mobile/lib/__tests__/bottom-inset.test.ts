/**
 * Android's navigation bar sits on top of the app's bottom edge (edge to edge).
 * These pin how much room the bottom bars leave for it.
 */
import { describe, expect, test } from "bun:test";
import { androidBottomInset, bottomBarPadding } from "../bottom-inset-core";

describe("bottom bar padding", () => {
  test("3-button navigation: the bar sits above the ◁ ○ □ buttons", () => {
    expect(bottomBarPadding("android", 48, 28, 8)).toBe(56);
  });

  test("gesture navigation: only the gesture strip is kept clear", () => {
    expect(bottomBarPadding("android", 24, 28, 8)).toBe(32);
  });

  test("no navigation shown: full screen, just the bar's own breathing room", () => {
    expect(bottomBarPadding("android", 0, 28, 8)).toBe(8);
  });

  test("fractional insets are rounded", () => {
    expect(bottomBarPadding("android", 47.6, 28, 16)).toBe(64);
  });

  test("a missing or bad inset counts as none", () => {
    expect(bottomBarPadding("android", Number.NaN, 28, 8)).toBe(8);
    expect(bottomBarPadding("android", -3, 28, 8)).toBe(8);
  });

  test("iOS keeps each bar's existing padding whatever the inset", () => {
    expect(bottomBarPadding("ios", 34, 28, 8)).toBe(28);
    expect(bottomBarPadding("ios", 0, 34, 20)).toBe(34);
  });
});

describe("space under scrolling content", () => {
  test("Android adds the navigation inset", () => {
    expect(androidBottomInset("android", 48)).toBe(48);
    expect(androidBottomInset("android", 0)).toBe(0);
  });

  test("iOS adds nothing", () => {
    expect(androidBottomInset("ios", 34)).toBe(0);
  });
});
