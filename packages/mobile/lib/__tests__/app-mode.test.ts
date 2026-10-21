import { describe, expect, test } from "bun:test";
import { isOfficeRole, resolveMode } from "../app-mode";

/**
 * Who lands where after picking a company. A small-shop owner is often both
 * the dispatcher and a technician, so the same account can need either side
 * of the app; everyone else gets exactly one.
 */
describe("resolveMode", () => {
  test("rider only → field, no switch", () => {
    expect(resolveMode({ role: "rider", staffType: "technician", saved: null })).toEqual({
      mode: "field",
      canSwitch: false,
    });
  });

  test("rider ignores a stale office preference", () => {
    expect(resolveMode({ role: "rider", staffType: null, saved: "office" }).mode).toBe("field");
  });

  test("dispatcher only → office, no switch, even with a saved field preference", () => {
    expect(resolveMode({ role: "dispatcher", staffType: null, saved: "field" })).toEqual({
      mode: "office",
      canSwitch: false,
    });
  });

  test("dual role defaults to office and honours the saved choice", () => {
    expect(resolveMode({ role: "admin", staffType: "technician", saved: null })).toEqual({
      mode: "office",
      canSwitch: true,
    });
    expect(resolveMode({ role: "admin", staffType: "driver", saved: "field" })).toEqual({
      mode: "field",
      canSwitch: true,
    });
  });

  test("every office role is office", () => {
    for (const role of ["superadmin", "admin", "manager", "dispatcher", "project_manager"]) {
      expect(isOfficeRole(role)).toBe(true);
      expect(resolveMode({ role, staffType: null, saved: null }).mode).toBe("office");
    }
  });

  test("customers and unknown roles are neither", () => {
    expect(isOfficeRole("customer")).toBe(false);
    expect(isOfficeRole(undefined)).toBe(false);
    expect(resolveMode({ role: "customer", staffType: null, saved: null })).toEqual({
      mode: "field",
      canSwitch: false,
    });
  });
});
