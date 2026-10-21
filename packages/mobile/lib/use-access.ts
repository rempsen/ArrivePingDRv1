import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { getActiveCompany } from "./active-company";
import { makeCan, type Access, type Can } from "./permissions";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

const EMPTY: Access = { role: "", admin: false, superadmin: false, office: false, permissions: [] };

export const ACCESS_KEY = ["me", "access"] as const;

async function fetchAccess(): Promise<Access> {
  const res = await fetch(`${API}/api/me/access`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Access check failed (${res.status})`);
  const json = (await res.json()) as Partial<Access>;
  return { ...EMPTY, ...json, permissions: json.permissions ?? [] };
}

/**
 * The signed-in person's resolved permissions at the active company, and a
 * `can()` for gating office controls. Keyed by company so a switch refetches.
 * Until the first response lands `can()` returns false, which hides buttons
 * rather than showing ones the server will refuse.
 */
export function useAccess(enabled = true): { access: Access | undefined; isLoading: boolean; can: Can } {
  const company = getActiveCompany();
  const q = useQuery({
    queryKey: [...ACCESS_KEY, company],
    queryFn: fetchAccess,
    staleTime: 60_000,
    enabled,
  });
  const can = useMemo(() => makeCan(q.data?.permissions), [q.data?.permissions]);
  return { access: q.data, isLoading: q.isLoading, can };
}
