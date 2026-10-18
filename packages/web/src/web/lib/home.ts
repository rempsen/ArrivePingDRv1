/**
 * Where each role works (Dan, 2026-10-17): owners/admins, managers,
 * dispatchers and project managers in the dispatch dashboard; field staff in
 * the technician app (/rider on the web); customers in the customer portal.
 * What office staff see inside the dashboard is their role's permissions
 * (shared/office-pages.ts).
 */
export const OFFICE_ROLES = ["admin", "superadmin", "manager", "dispatcher", "project_manager"] as const;

export function isOfficeRole(role: string | null | undefined): boolean {
  return (OFFICE_ROLES as readonly string[]).includes(role ?? "");
}

export function homeFor(role: string | null | undefined): "/admin" | "/rider" | "/app" {
  if (isOfficeRole(role)) return "/admin";
  return role === "rider" ? "/rider" : "/app";
}
