/**
 * Office access (Dan, 2026-10-17): owners, managers and dispatchers all work
 * in the dashboard, each limited to what their role includes.
 *
 *  - permissionFor: every dashboard API path maps to the permission an office
 *    role below admin needs; money and keys stay admin-only; anything
 *    unmapped is admin-only.
 *  - requireOffice: admins pass; managers/dispatchers/PMs pass with the
 *    permission (role default or their own override); field staff and
 *    customers never; their own password change is always theirs.
 *  - pageNeed / canOpen: the sidebar and page guard use the same map.
 */
import { describe, it, expect } from "bun:test";
import { Hono } from "hono";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { permissionFor, actionFor, isOfficeRole } = await import("../office-access");
const { requireOffice } = await import("../../middleware/auth");
const { canOpen, pageNeed } = await import("../../../shared/office-pages");
const { DEFAULT_ROLE_PERMS } = await import("../permissions");

describe("permissionFor", () => {
  const cases: [string, string, string | null][] = [
    ["GET", "/api/admin/stats", "dashboard:view"],
    ["GET", "/api/admin/users", "clients:view"],
    ["POST", "/api/admin/users", "clients:create"],
    ["PATCH", "/api/admin/users/u1", "clients:edit"],
    ["POST", "/api/admin/users/u1/reset-password", null],
    ["POST", "/api/admin/me/change-password", "self"],
    ["GET", "/api/billing/summary", null],
    ["POST", "/api/billing/seats", null],
    ["POST", "/api/payments/connect/start", null],
    ["GET", "/api/api-keys", null],
    ["POST", "/api/riders", "techs:create"],
    ["PATCH", "/api/riders/r1", "techs:edit"],
    ["DELETE", "/api/riders/r1", "techs:delete"],
    ["GET", "/api/notif-config/rules", "notifications:view"],
    ["PATCH", "/api/notif-config/rules/x", "notifications:edit"],
    ["POST", "/api/notif-config/email/test", "notifications:edit"],
    // Webhook rows include their signing secret.
    ["GET", "/api/notif-config/webhooks", "notifications:edit"],
    ["PUT", "/api/settings", "settings:manage"],
    ["GET", "/api/settings/brand/crawl", "settings:view"],
    ["POST", "/api/change-requests/c1/approve", "work_orders:edit"],
    ["GET", "/api/change-requests/count", "work_orders:view"],
    ["POST", "/api/messages/dispatch/t1", "work_orders:edit"],
    ["GET", "/api/messages/inbox", "work_orders:view"],
    ["GET", "/api/fleet/t1/thread", "fleet_map:view"],
    ["POST", "/api/fleet/t1/sms", "work_orders:edit"],
    ["POST", "/api/dispatch/assign", "work_orders:edit"],
    ["POST", "/api/dispatch/schedule", "scheduler:edit"],
    ["GET", "/api/dispatch/load", "scheduler:view"],
    ["POST", "/api/dispatch/undo", "self"],
    ["GET", "/api/dispatch/board", "self"],
    ["GET", "/api/dispatch/stream", "self"],
    ["POST", "/api/import/rider", "techs:create"],
    ["POST", "/api/import/customer", "clients:create"],
    ["POST", "/api/import/admin", null],
    ["GET", "/api/import/template/rider", "techs:view"],
    ["POST", "/api/payouts/generate", "payouts:edit"],
    ["GET", "/api/reports/revenue", "reports:view"],
    ["GET", "/api/export/customers", "reports:export"],
    ["POST", "/api/automation", "automation:edit"],
    ["GET", "/api/integrations", "integrations:view"],
    ["POST", "/api/maintenance", "work_orders:create"],
    ["POST", "/api/sample-day", "settings:manage"],
    ["GET", "/api/something-new", null],
  ];
  for (const [method, path, want] of cases) {
    it(`${method} ${path} → ${want ?? "admins only"}`, () => expect(permissionFor(method, path)).toBe(want));
  }

  it("uses the nearest action a module has", () => {
    expect(actionFor("settings", "PUT")).toBe("manage");
    expect(actionFor("notifications", "DELETE")).toBe("edit");
    expect(actionFor("work_orders", "DELETE")).toBe("delete");
    expect(actionFor("reports", "GET")).toBe("view");
  });

  it("office roles", () => {
    for (const r of ["admin", "superadmin", "manager", "dispatcher", "project_manager"]) expect(isOfficeRole(r)).toBe(true);
    for (const r of ["rider", "customer", undefined, "deleted"]) expect(isOfficeRole(r)).toBe(false);
  });
});

describe("requireOffice", () => {
  const app = new Hono()
    .use("*", async (c, next) => {
      const role = c.req.header("X-Role");
      const perms = c.req.header("X-Perms");
      c.set("user" as never, (role ? { id: "u", role, permissions: perms ?? null } : null) as never);
      return next();
    })
    .all("/api/*", requireOffice, (c) => c.text("ok"));
  const call = (method: string, path: string, role?: string, perms?: string[]) =>
    app.request(path, { method, headers: { ...(role ? { "X-Role": role } : {}), ...(perms ? { "X-Perms": JSON.stringify(perms) } : {}) } }).then((r) => r.status);

  it("admins pass everything their company has, including money and keys", async () => {
    expect(await call("GET", "/api/billing/summary", "admin")).toBe(200);
    expect(await call("POST", "/api/api-keys", "admin")).toBe(200);
    expect(await call("GET", "/api/something-new", "admin")).toBe(200);
  });

  it("a dispatcher dispatches, but doesn't touch settings, billing or keys", async () => {
    expect(await call("GET", "/api/admin/stats", "dispatcher")).toBe(200);
    expect(await call("POST", "/api/dispatch/assign", "dispatcher")).toBe(200);
    expect(await call("POST", "/api/messages/dispatch/t1", "dispatcher")).toBe(200);
    expect(await call("POST", "/api/admin/users", "dispatcher")).toBe(200);
    expect(await call("GET", "/api/export/customers", "dispatcher")).toBe(200);
    expect(await call("PUT", "/api/settings", "dispatcher")).toBe(403);
    expect(await call("PATCH", "/api/notif-config/rules/x", "dispatcher")).toBe(403);
    expect(await call("POST", "/api/riders", "dispatcher")).toBe(403);
    expect(await call("POST", "/api/automation", "dispatcher")).toBe(403);
    expect(await call("GET", "/api/billing/summary", "dispatcher")).toBe(403);
    expect(await call("GET", "/api/api-keys", "dispatcher")).toBe(403);
    expect(await call("POST", "/api/admin/users/u1/reset-password", "dispatcher")).toBe(403);
    expect(await call("GET", "/api/something-new", "dispatcher")).toBe(403);
  });

  it("a manager adds technicians; nobody below admin sees billing", async () => {
    expect(await call("POST", "/api/riders", "manager")).toBe(200);
    expect(await call("DELETE", "/api/riders/r1", "manager")).toBe(403);
    expect(await call("POST", "/api/billing/seats", "manager")).toBe(403);
  });

  it("a per-person override widens or narrows one dispatcher", async () => {
    expect(await call("PUT", "/api/settings", "dispatcher", ["settings:manage"])).toBe(200);
    expect(await call("GET", "/api/admin/stats", "dispatcher", ["work_orders:view"])).toBe(403);
    // …but never into money or keys.
    expect(await call("GET", "/api/billing/summary", "dispatcher", ["*"])).toBe(403);
  });

  it("their own password change is always theirs", async () => {
    expect(await call("POST", "/api/admin/me/change-password", "dispatcher", [])).toBe(200);
  });

  it("field staff and customers never get in; signed out is 401", async () => {
    for (const role of ["rider", "customer"]) {
      expect(await call("GET", "/api/export/customers", role)).toBe(403);
      expect(await call("POST", "/api/automation", role)).toBe(403);
      expect(await call("GET", "/api/admin/stats", role)).toBe(403);
    }
    expect(await call("GET", "/api/admin/stats")).toBe(401);
  });
});

describe("pages", () => {
  const as = (role: string, permissions?: string[]) => ({ role, admin: role === "admin", permissions: permissions ?? DEFAULT_ROLE_PERMS[role] ?? [] });

  it("detail pages follow their section; unlisted /admin pages are admin-only", () => {
    expect(pageNeed("/admin")).toBe("dashboard:view");
    expect(pageNeed("/admin/work-orders/abc")).toBe("work_orders:view");
    expect(pageNeed("/admin/jobs/abc/report")).toBe("work_orders:view");
    expect(pageNeed("/admin/settings?section=payments")).toBe("settings:manage");
    expect(pageNeed("/admin/not-a-page")).toBeNull();
    expect(canOpen("/admin/not-a-page", as("dispatcher"))).toBe(false);
    expect(canOpen("/admin/not-a-page", as("admin"))).toBe(true);
  });

  it("a dispatcher's sidebar: operations, people, catalog, reports; no setup", () => {
    const d = as("dispatcher");
    for (const p of ["/admin", "/admin/scheduler", "/admin/fleet", "/admin/work-orders", "/admin/inbox", "/admin/clients", "/admin/techs", "/admin/catalog", "/admin/builder", "/admin/reports", "/admin/tags"])
      expect([p, canOpen(p, d)]).toEqual([p, true]);
    for (const p of ["/admin/settings", "/admin/notifications", "/admin/zones", "/admin/automation", "/admin/getting-started", "/admin/api-access", "/admin/companies"])
      expect([p, canOpen(p, d)]).toEqual([p, false]);
  });

  it("super admin tools are for super admins only, even for company admins", () => {
    expect(canOpen("/admin/companies", as("admin"))).toBe(false);
    expect(canOpen("/admin/companies", { role: "superadmin", admin: true, permissions: ["*"] })).toBe(true);
  });
});
