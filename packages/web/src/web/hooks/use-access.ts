import { useQuery } from "@tanstack/react-query";
import { apiHeaders } from "../lib/api";
import { canOpen, permAllows, type OfficeAccess } from "../../shared/office-pages";
import { useAuth } from "./use-auth";

/**
 * What the signed-in person can do in the company they're acting as
 * (GET /api/me/access). Admins are known from the session straight away;
 * other office roles wait for their permissions before anything is shown,
 * so a page they can't use never flashes up.
 */
export function useAccess() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin" || role === "superadmin";
  const q = useQuery({
    queryKey: ["me", "access", user?.id],
    enabled: Boolean(user) && !isAdmin,
    staleTime: 60_000,
    queryFn: async (): Promise<OfficeAccess> => {
      const r = await fetch("/api/me/access", { headers: apiHeaders(), credentials: "include" });
      if (!r.ok) throw new Error(`access ${r.status}`);
      return r.json();
    },
  });
  const access: OfficeAccess | null = isAdmin
    ? { role, admin: true, superadmin: role === "superadmin", permissions: ["*"] }
    : (q.data ?? null);
  return {
    access,
    loading: !isAdmin && q.isPending,
    isAdmin,
    can: (perm: string) => (access ? permAllows(access.permissions, perm) : false),
    canOpen: (path: string) => (access ? canOpen(path, access) : false),
  };
}
