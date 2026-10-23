import { describe, expect, test } from "bun:test";
import { isWideLayout, WIDE_MIN, LIST_PANE_W } from "../layout";

describe("isWideLayout", () => {
  test("a tablet at full width is wide", () => {
    expect(isWideLayout(1024, "tablet")).toBe(true);
    expect(isWideLayout(WIDE_MIN, "tablet")).toBe(true);
  });
  test("a tablet in narrow Split View gets the phone layout", () => {
    expect(isWideLayout(507, "tablet")).toBe(false);
    expect(isWideLayout(WIDE_MIN - 1, "tablet")).toBe(false);
  });
  test("phones and unknown devices are never wide, whatever the width", () => {
    expect(isWideLayout(1024, "phone")).toBe(false);
    expect(isWideLayout(800, "unknown")).toBe(false);
  });
  test("the list pane leaves room for a detail pane at the minimum width", () => {
    expect(WIDE_MIN - LIST_PANE_W).toBeGreaterThanOrEqual(360);
  });
});
