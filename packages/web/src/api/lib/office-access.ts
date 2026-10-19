/**
 * Office access: who may use the dispatch dashboard's API, and for what.
 *
 * Dan, 2026-10-17: owners, managers and dispatchers all work in the admin
 * dashboard of their company; customers use the customer portal and field
 * staff the app. Until now only `admin` could: every other office role was
 * sent to the customer portal and refused by the API (`requireAdmin`), so a
 * company that added a dispatcher had no way to let them dispatch.
 *
 * How it's organised (the ops rule of thumb: everyone gets the workspace for
 * their job, and inside it only the controls their job needs):
 *   - `admin` (the owner and anyone they make an admin): everything in their
 *     company, as before.
 *   - `manager`, `dispatcher`, `project_manager`: the dashboard, limited by the
 *     role's permissions (lib/permissions.ts DEFAULT_ROLE_PERMS, editable per
 *     role or per person under Roles & Permissions). A request is allowed
 *     when the permission its path and method map to (below) is granted.
 *   - Money and keys stay with admins whatever the permissions say: billing
 *     and plan, payment-provider setup, API keys, setting another person's
 *     password, and anything this table doesn't name (fail closed).
 *   - Field staff and customers: never.
 */
import { isAdminRole, PERMISSION_CATALOG, type Action } from "./permissions";

/** Office roles below admin. */
export const STAFF_OFFICE_ROLES = new Set(["manager", "dispatcher", "project_manager"]);

/** Admin, superadmin, or an office role below admin. */
export function isOfficeRole(role: string | null | undefined): boolean {
  return isAdminRole(role) || STAFF_OFFICE_ROLES.has(role ?? "");
}

const ACTIONS = new Map(PERMISSION_CATALOG.map((m) => [m.key, m.actions]));

/** The action a method means for a module, using the nearest one the module has. */
export function actionFor(module: string, method: string): string {
  const has = ACTIONS.get(module) ?? [];
  const pick = (...want: Action[]) => want.find((a) => has.includes(a)) ?? want[want.length - 1]!;
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return pick("view");
    case "POST":
      return pick("create", "edit", "manage");
    case "DELETE":
      return pick("delete", "edit", "manage");
    default:
      return pick("edit", "manage");
  }
}

/** "self": any office role (their own account); null: admins only. */
export type Need = string | "self" | null;

type Rule = { re: RegExp; need: (method: string, m: RegExpMatchArray) => Need };
const mod = (module: string) => (method: string) => `${module}:${actionFor(module, method)}`;
const readOr = (view: string, write: string) => (method: string) => (["GET", "HEAD"].includes(method.toUpperCase()) ? view : write);
const adminOnly = () => null;

/**
 * First match wins. Paths are the full request path (/api/...). Anything not
 * matched is admin-only.
 */
const RULES: Rule[] = [
  // Admins only, whatever the permissions.
  { re: /^\/api\/billing(\/|$)/, need: adminOnly },
  { re: /^\/api\/payments\/connect(\/|$)/, need: adminOnly },
  { re: /^\/api\/api-keys(\/|$)/, need: adminOnly },
  { re: /^\/api\/admin\/users\/[^/]+\/reset-password$/, need: adminOnly },
  { re: /^\/api\/superadmin(\/|$)/, need: adminOnly },

  // Their own account.
  { re: /^\/api\/admin\/me\/change-password$/, need: () => "self" },

  { re: /^\/api\/admin\/stats$/, need: mod("dashboard") },
  { re: /^\/api\/ai\/delay-risk$/, need: () => "dashboard:view" },
  { re: /^\/api\/ai\//, need: () => "work_orders:view" },
  { re: /^\/api\/admin\/users(\/|$)/, need: mod("clients") },
  // The Directory: asking it a question or reading it is viewing clients;
  // moving people between properties is editing them.
  { re: /^\/api\/directory\/ask$/, need: () => "clients:view" },
  { re: /^\/api\/directory\/assign$/, need: () => "clients:edit" },
  { re: /^\/api\/directory(\/|$)/, need: mod("clients") },
  { re: /^\/api\/audit(\/|$)/, need: mod("audit") },
  { re: /^\/api\/(catalog|option-catalog|services)(\/|$)/, need: mod("catalog") },
  { re: /^\/api\/(change-requests|delays)(\/|$)/, need: readOr("work_orders:view", "work_orders:edit") },
  // The dispatch calendar: moving a job in time is scheduling, as on
  // POST /bookings/:id/schedule. Undo checks per token (assign vs time move).
  { re: /^\/api\/dispatch\/schedule$/, need: () => "scheduler:edit" },
  { re: /^\/api\/dispatch\/load$/, need: readOr("scheduler:view", "scheduler:edit") },
  { re: /^\/api\/dispatch\/undo$/, need: () => "self" },
  // The board and its stream feed both the dispatch map and the calendar, so
  // either work-order or scheduler viewing reads them; the route checks which.
  { re: /^\/api\/dispatch\/(board|stream)$/, need: () => "self" },
  // The dispatch map (board, candidates, assign/undo, live stream).
  { re: /^\/api\/dispatch(\/|$)/, need: readOr("work_orders:view", "work_orders:edit") },
  // Talking to technicians is dispatching.
  { re: /^\/api\/fleet(\/|$)/, need: readOr("fleet_map:view", "work_orders:edit") },
  { re: /^\/api\/messages(\/|$)/, need: readOr("work_orders:view", "work_orders:edit") },
  { re: /^\/api\/(custom-fields|tags)(\/|$)/, need: mod("tags") },
  { re: /^\/api\/(forms|templates)(\/|$)/, need: mod("forms") },
  {
    re: /^\/api\/import\/(template\/)?(rider|customer|admin|property)$/,
    need: (method, m) => {
      const type = m[2];
      if (type === "admin") return null;
      const module = type === "rider" ? "techs" : "clients";
      return `${module}:${method.toUpperCase() === "GET" ? "view" : "create"}`;
    },
  },
  { re: /^\/api\/invites(\/|$)/, need: readOr("techs:view", "techs:create") },
  { re: /^\/api\/riders(\/|$)/, need: mod("techs") },
  { re: /^\/api\/skills(\/|$)/, need: readOr("techs:view", "techs:edit") },
  // Webhooks carry their signing secrets: seeing them is changing them.
  { re: /^\/api\/notif-config\/webhooks(\/|$)/, need: () => "notifications:edit" },
  { re: /^\/api\/notif-config(\/|$)/, need: mod("notifications") },
  { re: /^\/api\/(onboarding|sample-day|settings)(\/|$)/, need: mod("settings") },
  { re: /^\/api\/payouts(\/|$)/, need: mod("payouts") },
  { re: /^\/api\/reports(\/|$)/, need: mod("reports") },
  { re: /^\/api\/export(\/|$)/, need: () => "reports:export" },
  { re: /^\/api\/shifts(\/|$)/, need: mod("scheduler") },
  { re: /^\/api\/zones(\/|$)/, need: mod("zones") },
  { re: /^\/api\/reviews(\/|$)/, need: mod("reviews") },
  { re: /^\/api\/automation(\/|$)/, need: mod("automation") },
  { re: /^\/api\/integrations(\/|$)/, need: mod("integrations") },
  { re: /^\/api\/maintenance(\/|$)/, need: mod("work_orders") },
];

/** The permission a request to this path needs from an office role below admin. */
export function permissionFor(method: string, path: string): Need {
  for (const r of RULES) {
    const m = path.match(r.re);
    if (m) return r.need(method, m);
  }
  return null;
}
