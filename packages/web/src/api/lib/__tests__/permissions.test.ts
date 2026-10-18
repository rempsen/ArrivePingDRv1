import { describe, it, expect } from "bun:test";
import {
  resolvePerms,
  permAllows,
  DEFAULT_ROLE_PERMS,
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  isAdminRole,
  isSuperadmin,
  INTERNAL_ROLES,
  overrideAt,
} from "../permissions";

describe("overrideAt: which per-person override applies at a company", () => {
  const mine = JSON.stringify(["work_orders:view"]);
  const old = JSON.stringify(["reports:view"]);
  it("the membership's override wins", () => {
    expect(overrideAt({ membership: mine, user: old, companyId: "a", homeCompany: "a" })).toBe(mine);
  });
  it("an older override on the user row still counts at their home company", () => {
    expect(overrideAt({ membership: null, user: old, companyId: "a", homeCompany: "a" })).toBe(old);
  });
  it("…but never at another company they work for", () => {
    expect(overrideAt({ membership: null, user: old, companyId: "b", homeCompany: "a" })).toBeNull();
  });
  it("no override anywhere means role defaults", () => {
    expect(overrideAt({ membership: null, user: null, companyId: "a", homeCompany: "a" })).toBeNull();
  });
});

describe("resolvePerms", () => {
  it("grants the wildcard to admins", () => {
    const p = resolvePerms({ role: "admin" }, DEFAULT_ROLE_PERMS);
    expect(p.has("*")).toBe(true);
  });

  it("grants the wildcard to superadmins", () => {
    const p = resolvePerms({ role: "superadmin" }, DEFAULT_ROLE_PERMS);
    expect(p.has("*")).toBe(true);
  });

  it("returns an empty set for null users", () => {
    expect(resolvePerms(null, DEFAULT_ROLE_PERMS).size).toBe(0);
  });

  it("honors an explicit per-person permission override", () => {
    const p = resolvePerms(
      { role: "manager", permissions: JSON.stringify(["work_orders:view", "reports:export"]) },
      DEFAULT_ROLE_PERMS,
    );
    expect(p.has("work_orders:view")).toBe(true);
    expect(p.has("reports:export")).toBe(true);
    // override fully replaces role defaults
    expect(p.has("clients:create")).toBe(false);
  });

  it("ignores malformed permission JSON and falls back to role defaults", () => {
    const p = resolvePerms({ role: "dispatcher", permissions: "{bad" }, DEFAULT_ROLE_PERMS);
    expect(p.has("work_orders:delete")).toBe(true);
  });

  it("falls back to seed defaults when roleDefaults lacks the role", () => {
    const p = resolvePerms({ role: "dispatcher" }, {});
    expect(p.has("catalog:create")).toBe(true);
  });

  it("gives field staff (rider) no web permissions", () => {
    expect(resolvePerms({ role: "rider" }, DEFAULT_ROLE_PERMS).size).toBe(0);
  });
});

describe("permAllows", () => {
  it("wildcard satisfies everything", () => {
    expect(permAllows(new Set(["*"]), "settings:manage")).toBe(true);
  });

  it("exact match passes", () => {
    expect(permAllows(new Set(["work_orders:edit"]), "work_orders:edit")).toBe(true);
  });

  it("module wildcard satisfies any action in that module", () => {
    expect(permAllows(new Set(["catalog:*"]), "catalog:delete")).toBe(true);
  });

  it("any write permission implies view on the same module", () => {
    expect(permAllows(new Set(["clients:edit"]), "clients:view")).toBe(true);
    expect(permAllows(new Set(["work_orders:create"]), "work_orders:view")).toBe(true);
  });

  it("denies actions the user does not hold", () => {
    expect(permAllows(new Set(["work_orders:view"]), "work_orders:delete")).toBe(false);
    expect(permAllows(new Set([]), "dashboard:view")).toBe(false);
  });

  it("view permission alone does not imply edit", () => {
    expect(permAllows(new Set(["catalog:view"]), "catalog:edit")).toBe(false);
  });
});

describe("role default integrity", () => {
  it("every default permission is a known permission key", () => {
    const known = new Set(ALL_PERMISSIONS);
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMS)) {
      for (const perm of perms) {
        if (perm === "*") continue;
        expect(known.has(perm), `${role} -> ${perm} should be a known permission`).toBe(true);
      }
    }
  });

  it("catalog action keys are well-formed", () => {
    for (const m of PERMISSION_CATALOG) {
      expect(m.key).toMatch(/^[a-z_]+$/);
      expect(m.actions.length).toBeGreaterThan(0);
    }
  });
});

describe("admin-tier role helpers", () => {
  it("isAdminRole is true for both admin and superadmin", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("superadmin")).toBe(true);
  });

  it("isAdminRole is false for lower roles and nullish", () => {
    for (const r of ["manager", "dispatcher", "project_manager", "rider", "customer", "", null, undefined]) {
      expect(isAdminRole(r as any)).toBe(false);
    }
  });

  it("isSuperadmin is true ONLY for superadmin", () => {
    expect(isSuperadmin("superadmin")).toBe(true);
    expect(isSuperadmin("admin")).toBe(false);
    expect(isSuperadmin("manager")).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
  });

  it("superadmin is registered as an internal role with full perms", () => {
    expect(INTERNAL_ROLES).toContain("superadmin");
    expect(DEFAULT_ROLE_PERMS.superadmin).toEqual(["*"]);
  });
});
