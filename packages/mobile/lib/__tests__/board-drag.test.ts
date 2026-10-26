import { describe, expect, test } from "bun:test";
import { edgeScroll, hitCell, HEADER_H, travelled, type TimelineGeom } from "../board-drag";
import { GUTTER_W, HOUR_W, ROW_H } from "../timeline";

const range = { startMin: 7 * 60, endMin: 19 * 60 };
const g: TimelineGeom = { x: 100, y: 200, w: GUTTER_W + 6 * HOUR_W, h: HEADER_H + 4 * ROW_H, scrollX: 0, scrollY: 0 };
const techs = ["a", "b", "c"];

describe("hitCell", () => {
  test("row from y under the header, minute from x past the gutter", () => {
    const x = g.x + GUTTER_W + 2 * HOUR_W; // 9:00
    expect(hitCell(g, x, g.y + HEADER_H + 10, techs, range)).toEqual({ techId: "a", rawMin: 9 * 60 });
    expect(hitCell(g, x, g.y + HEADER_H + ROW_H + 1, techs, range)?.techId).toBe("b");
  });

  test("scroll offsets shift both axes", () => {
    const s = { ...g, scrollX: HOUR_W, scrollY: ROW_H };
    expect(hitCell(s, g.x + GUTTER_W, g.y + HEADER_H + 1, techs, range)).toEqual({ techId: "b", rawMin: 8 * 60 });
  });

  test("gutter, header, past the last row and outside the frame are not drops", () => {
    expect(hitCell(g, g.x + 10, g.y + HEADER_H + 10, techs, range)).toBeNull();
    expect(hitCell(g, g.x + GUTTER_W + 10, g.y + 5, techs, range)).toBeNull();
    expect(hitCell(g, g.x + GUTTER_W + 10, g.y + HEADER_H + 3 * ROW_H + 5, techs, range)).toBeNull();
    expect(hitCell(g, g.x + g.w + 1, g.y + HEADER_H + 10, techs, range)).toBeNull();
  });
});

describe("edgeScroll", () => {
  test("near the right and bottom edges scrolls forward, near the grid's left and top back, middle not at all", () => {
    expect(edgeScroll(g, g.x + g.w - 10, g.y + 100)).toEqual({ dx: 18, dy: 0 });
    expect(edgeScroll(g, g.x + GUTTER_W + 10, g.y + 100)).toEqual({ dx: -18, dy: 0 });
    expect(edgeScroll(g, g.x + 400, g.y + g.h - 5)).toEqual({ dx: 0, dy: 18 });
    expect(edgeScroll(g, g.x + 400, g.y + 120)).toEqual({ dx: 0, dy: 0 });
  });
});

test("travelled", () => {
  expect(travelled(3, 4)).toBe(false);
  expect(travelled(6, 4)).toBe(true);
});
