import { describe, it, expect } from "bun:test";
import { edgePan, nearestWithin, pointInRect } from "../drag-geometry";

const RECT = { left: 100, top: 50, right: 900, bottom: 650 };

describe("nearestWithin", () => {
  const targets = [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 40, y: 10 },
    { id: "c", x: 300, y: 300 },
  ];
  it("picks the closest target inside the radius", () => {
    expect(nearestWithin({ x: 32, y: 10 }, targets, 56)).toEqual({ id: "b", d: 8 });
  });
  it("counts a target exactly on the radius", () => {
    expect(nearestWithin({ x: 300, y: 356 }, targets, 56)?.id).toBe("c");
  });
  it("returns null when nothing is close enough", () => {
    expect(nearestWithin({ x: 600, y: 600 }, targets, 56)).toBeNull();
    expect(nearestWithin({ x: 0, y: 0 }, [], 56)).toBeNull();
  });
  it("keeps the first of two equally close targets", () => {
    expect(nearestWithin({ x: 25, y: 10 }, targets, 56)?.id).toBe("a");
  });
  it("skips targets without a real position", () => {
    expect(nearestWithin({ x: 0, y: 0 }, [{ id: "n", x: NaN, y: 0 }, { id: "ok", x: 3, y: 4 }], 56)).toEqual({ id: "ok", d: 5 });
  });
});

describe("pointInRect", () => {
  it("includes the border", () => {
    expect(pointInRect({ x: 100, y: 50 }, RECT)).toBe(true);
    expect(pointInRect({ x: 99, y: 50 }, RECT)).toBe(false);
  });
});

describe("edgePan", () => {
  it("doesn't pan in the middle", () => {
    expect(edgePan({ x: 500, y: 350 }, RECT)).toEqual({ dx: 0, dy: 0 });
  });
  it("pans west near the left edge, faster the closer it gets", () => {
    const near = edgePan({ x: 110, y: 350 }, RECT);
    const nearer = edgePan({ x: 101, y: 350 }, RECT);
    expect(near.dx).toBeLessThan(0);
    expect(nearer.dx).toBeLessThan(near.dx);
    expect(near.dy).toBe(0);
  });
  it("reaches full speed on the border", () => {
    expect(edgePan({ x: 900, y: 350 }, RECT, 32, 18)).toEqual({ dx: 18, dy: 0 });
  });
  it("pans diagonally in a corner", () => {
    const p = edgePan({ x: 895, y: 55 }, RECT);
    expect(p.dx).toBeGreaterThan(0);
    expect(p.dy).toBeLessThan(0);
  });
  it("never pans once the pointer leaves the map", () => {
    expect(edgePan({ x: 50, y: 350 }, RECT)).toEqual({ dx: 0, dy: 0 });
  });
});
