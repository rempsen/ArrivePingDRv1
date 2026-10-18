import { useQuery } from "@tanstack/react-query";
import { apiHeaders } from "../lib/api";
import { canOpen, permAllows, type OfficeAccess } from "../../shared/office-pages";
import { useAuth } from "./use-auth";

/**
 * What the signed-in person can do in the company they're acting as
 * (GET /api/me/access). Always asked of the server, because the session only
 * knows their home-company role: someone can be an admin at one company and
 * a dispatcher (or a customer) at the one they've switched to. Nothing that
 * depends on it is shown until it arrives, so a page they can't use never
 * flashes up.
 */
export function useAccess() {
  const { role, user } = useAuth();
  const q = useQuery({
    queryKey: ["me", "access", user?.id],
    enabled: Boolean(user),
    staleTime: 60_000,
    retry: 2,
    queryFn: async (): Promise<OfficeAccess> => {
      const r = await fetch("/api/me/access", { headers: apiHeaders(), credentials: "include" });
      if (!r.ok) throw new Error(`access ${r.status}`);
      return r.json();
    },
  });
  // If the server can't be asked, fall back to the session's role; the API
  // still enforces the real one on every request.
  const sessionAdmin = role === "admin" || role === "superadmin";
  const access: OfficeAccess | null =
    q.data ?? (q.isError && sessionAdmin ? { role, admin: true, superadmin: role === "superadmin", permissions: ["*"] } : null);
  return {
    access,
    /** Their role at the company they're acting as (the session's until known). */
    role: access?.role ?? role,
    loading: Boolean(user) && q.isPending,
    isAdmin: Boolean(access?.admin),
    can: (perm: string) => (access ? permAllows(access.permissions, perm) : false),
    canOpen: (path: string) => (access ? canOpen(path, access) : false),
  };
}
