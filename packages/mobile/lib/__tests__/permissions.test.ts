import { describe, expect, test } from "bun:test";
import { makeCan } from "../permissions";

describe("makeCan", () => {
  test("admin wildcard allows everything", () => {
    expect(makeCan(["*"])("anything:at_all")).toBe(true);
  });

  test("an exact key matches", () => {
    const can = makeCan(["work_orders:create", "scheduler:edit"]);
    expect(can("work_orders:create")).toBe(true);
    expect(can("scheduler:edit")).toBe(true);
    expect(can("work_orders:delete")).toBe(false);
  });

  test("view is implied by any other action on the module", () => {
    const can = makeCan(["work_orders:edit"]);
    expect(can("work_orders:view")).toBe(true);
    expect(can("work_orders:create")).toBe(false);
    expect(can("techs:view")).toBe(false);
  });

  test("nothing is allowed without permissions", () => {
    expect(makeCan([])("techs:view")).toBe(false);
    expect(makeCan(undefined)("techs:view")).toBe(false);
  });
});
