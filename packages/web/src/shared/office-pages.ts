/**
 * Which dashboard pages each office person sees (lib/office-access.ts has the
 * server side). Shared by the sidebar, the page guard and Ask ArrivePing so
 * they never disagree. A new /admin page must be added here, or only admins
 * can open it.
 *
 * The rule (how an operations lead would lay it out): day-to-day pages need
 * the permission to *see* that area; setup pages need the permission to
 * *change* it, because a read-only settings page is a page of buttons that
 * fail. Admins see everything; "admin" pages (the launch checklist) and the
 * super admin tools are theirs alone.
 */

import { featureForPage } from "./features";

export type PageNeed = string | "admin" | "superadmin" | "platform";

/** Longest prefix wins, so /admin/work-orders/123 follows /admin/work-orders. */
export const PAGE_ACCESS: { prefix: string; need: PageNeed }[] = [
  { prefix: "/admin", need: "dashboard:view" },
  { prefix: "/admin/scheduler", need: "scheduler:view" },
  { prefix: "/admin/fleet", need: "fleet_map:view" },
  // The dispatch map in progress (api /api/dispatch); listed so it opens for dispatchers when it ships.
  { prefix: "/admin/dispatch", need: "work_orders:view" },
  { prefix: "/admin/work-orders", need: "work_orders:view" },
  { prefix: "/admin/jobs", need: "work_orders:view" },
  { prefix: "/admin/inbox", need: "work_orders:view" },
  { prefix: "/admin/change-requests", need: "work_orders:view" },
  { prefix: "/admin/maintenance", need: "work_orders:view" },
  { prefix: "/admin/services", need: "catalog:view" },
  { prefix: "/admin/catalog", need: "catalog:view" },
  { prefix: "/admin/options", need: "catalog:view" },
  { prefix: "/admin/builder", need: "forms:view" },
  { prefix: "/admin/intake-forms", need: "forms:view" },
  { prefix: "/admin/techs", need: "techs:view" },
  { prefix: "/admin/clients", need: "clients:view" },
  { prefix: "/admin/reviews", need: "reviews:view" },
  { prefix: "/admin/payouts", need: "payouts:view" },
  { prefix: "/admin/reports", need: "reports:view" },
  { prefix: "/admin/zones", need: "zones:edit" },
  { prefix: "/admin/notifications", need: "notifications:edit" },
  { prefix: "/admin/automation", need: "automation:edit" },
  { prefix: "/admin/tags", need: "tags:edit" },
  { prefix: "/admin/integrations", need: "integrations:edit" },
  { prefix: "/admin/audit", need: "audit:view" },
  { prefix: "/admin/settings", need: "settings:manage" },
  { prefix: "/admin/api-access", need: "admin" },
  { prefix: "/admin/getting-started", need: "admin" },
  { prefix: "/admin/companies", need: "superadmin" },
  { prefix: "/admin/analytics", need: "superadmin" },
  { prefix: "/admin/mobile-release", need: "superadmin" },
  // Control Hub: NVC360 platform staff (owner, staff or sales), inside our own tenant.
  { prefix: "/admin/hub", need: "platform" },
];

/** Does a permission set satisfy a key? "*" = all; edit/create/delete/manage imply view. */
export function permAllows(perms: Iterable<string>, required: string): boolean {
  const set = perms instanceof Set ? (perms as Set<string>) : new Set(perms);
  if (set.has("*") || set.has(required)) return true;
  const [mod] = required.split(":");
  if (set.has(`${mod}:*`)) return true;
  if (required.endsWith(":view")) {
    for (const a of ["create", "edit", "delete", "manage"]) if (set.has(`${mod}:${a}`)) return true;
  }
  return false;
}

/** What opening this path needs; null for paths outside the dashboard. */
export function pageNeed(path: string): PageNeed | null {
  const p = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  let best: { prefix: string; need: PageNeed } | null = null;
  for (const e of PAGE_ACCESS) {
    // "/admin" itself is the dashboard; it isn't a prefix for pages not listed.
    const under = e.prefix !== "/admin" && p.startsWith(`${e.prefix}/`);
    if ((p === e.prefix || under) && (!best || e.prefix.length > best.prefix.length)) best = e;
  }
  return best?.need ?? null;
}

export interface OfficeAccess {
  role: string;
  admin: boolean;
  superadmin?: boolean;
  permissions: string[];
  /** Control Hub role (NVC360 staff only). */
  platformRole?: "owner" | "staff" | "sales" | null;
  /** Feature switches that are on for the acting company (shared/features.ts). */
  features?: string[];
  /** The company this request acts as. */
  companyId?: string;
  /** Set while ArrivePing support is signed in as this person (Control Hub act-as). */
  actingAs?: { sessionId: string; actorName: string; targetName: string; companyId: string; reason: string; expiresAt: string } | null;
}

/** May this person open this dashboard path? Unknown /admin paths are admin-only. */
export function canOpen(path: string, a: OfficeAccess): boolean {
  const need = pageNeed(path);
  if (need === "platform") return Boolean(a.platformRole);
  // A page whose feature is switched off for this company is closed to everyone.
  const feature = featureForPage(path);
  if (feature && a.features && !a.features.includes(feature)) return false;
  if (a.platformRole === "sales" && need === "superadmin") return false;
  if (a.superadmin || a.role === "superadmin") return true;
  if (need === "superadmin") return false;
  if (a.admin) return true;
  if (!need || need === "admin") return false;
  return permAllows(a.permissions, need);
}
