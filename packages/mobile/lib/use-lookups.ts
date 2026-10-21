import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { getActiveCompany } from "./active-company";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/** A value that lags the input by `ms`, for search-as-you-type. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** One client row from `GET /api/directory?kind=customer`. */
export interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  propertyName?: string;
  unit?: string;
  openJobs?: number;
  lastVisitAt?: string | null;
  isSample?: boolean;
}

export function useClientSearch(q: string, enabled = true) {
  const company = getActiveCompany();
  const needle = useDebounced(q.trim(), 250);
  return useQuery({
    queryKey: ["clients", company, needle],
    queryFn: async () => {
      const p = new URLSearchParams({ kind: "customer", pageSize: "25", sort: "name" });
      if (needle) p.set("q", needle);
      const res = await fetch(`${API}/api/directory?${p}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Couldn't search clients (${res.status})`);
      const json = (await res.json()) as { rows?: ClientRow[] };
      return json.rows ?? [];
    },
    enabled,
    staleTime: 30_000,
  });
}

/** `GET /api/services` — active services for the picker. */
export interface ServiceRow {
  id: string;
  name: string;
  category: string;
  durationMins: number;
  basePrice: number;
  icon?: string;
}

export function useServices(enabled = true) {
  const company = getActiveCompany();
  return useQuery({
    queryKey: ["services", company],
    queryFn: async () => {
      const res = await fetch(`${API}/api/services`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Couldn't load services (${res.status})`);
      return ((await res.json()) as { services: ServiceRow[] }).services;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface AddressPrediction {
  placeId: string;
  description: string;
  main: string;
  secondary: string;
}

export function useAddressSearch(q: string, sessionToken: string, enabled = true) {
  const needle = useDebounced(q.trim(), 300);
  return useQuery({
    queryKey: ["geo-autocomplete", needle, sessionToken],
    queryFn: async () => {
      const p = new URLSearchParams({ q: needle, sessionToken });
      const res = await fetch(`${API}/api/geo/autocomplete?${p}`, { headers: authHeaders() });
      if (!res.ok) return [] as AddressPrediction[];
      return ((await res.json()) as { predictions?: AddressPrediction[] }).predictions ?? [];
    },
    enabled: enabled && needle.length >= 3,
    staleTime: 60_000,
  });
}

export async function resolvePlace(placeId: string, description: string, sessionToken: string): Promise<{ lat: number | null; lng: number | null; address: string }> {
  const p = new URLSearchParams({ placeId, description, sessionToken });
  const res = await fetch(`${API}/api/geo/details?${p}`, { headers: authHeaders() });
  if (!res.ok) return { lat: null, lng: null, address: description };
  const j = (await res.json()) as { lat?: number | null; lng?: number | null; address?: string };
  return { lat: j.lat ?? null, lng: j.lng ?? null, address: j.address || description };
}
