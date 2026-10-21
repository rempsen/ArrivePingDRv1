/**
 * Which office controls to show.
 *
 * `GET /api/me/access` returns the permission keys the web console uses
 * (`work_orders:create`, `scheduler:edit`, …; `*` for admins). The app only
 * uses them to show or hide buttons — the server checks every call again, so
 * a stale cache can hide a control but never grant one.
 *
 * `<module>:view` is implied by holding any other action on that module: the
 * server's defaults list create/edit/delete keys and treat view as the floor,
 * so a dispatcher with `work_orders:edit` must still see the Jobs tab.
 */
export type Access = {
  role: string;
  admin: boolean;
  superadmin: boolean;
  office: boolean;
  permissions: string[];
};

export type Can = (key: string) => boolean;

export function makeCan(perms: readonly string[] | null | undefined): Can {
  const set = new Set(perms ?? []);
  if (set.has("*")) return () => true;
  const modules = new Set<string>();
  for (const p of set) {
    const i = p.indexOf(":");
    if (i > 0) modules.add(p.slice(0, i));
  }
  return (key) => {
    if (set.has(key)) return true;
    const i = key.indexOf(":");
    return i > 0 && key.slice(i + 1) === "view" && modules.has(key.slice(0, i));
  };
}
