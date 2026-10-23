import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { getActiveCompany } from "./active-company";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/** `GET /api/bookings/:id` — the enriched booking, the fields office mode shows. */
export interface OfficeBooking {
  id: string;
  title: string;
  status: string;
  assignStatus: string;
  priority: string;
  scheduledAt: string;
  address: string;
  lat: number;
  lng: number;
  notes: string;
  staffNotes: string;
  driverNotes: string;
  riderId: string | null;
  customerId: string;
  customerPhone?: string | null;
  price: number;
  total: number;
  signedAt?: string | null;
  finishedAt?: string | null;
  assignedAt?: string | null;
  acceptedAt?: string | null;
  enrouteAt?: string | null;
  startedAt?: string | null;
  createdAt: string;
  isSample?: boolean;
  /** JSON strings on the row; `lib/edit-job.ts` parses them. */
  fieldData?: unknown;
  lineItems?: unknown;
  service: { id: string; name: string; category?: string; durationMins?: number } | null;
  rider: { id: string; name?: string | null; phone?: string | null; photoUrl?: string | null; color?: string | null; status?: string } | null;
  customer: { id: string; name?: string | null; email?: string | null; phone?: string | null } | null;
}

export const bookingKey = (company: string, id: string) => ["booking", company, id] as const;

export function useBooking(id: string | undefined) {
  const company = getActiveCompany();
  return useQuery({
    queryKey: bookingKey(company, id ?? ""),
    queryFn: async () => {
      const res = await fetch(`${API}/api/bookings/${encodeURIComponent(id!)}`, { headers: authHeaders() });
      if (res.status === 404) throw new Error("That job no longer exists.");
      if (!res.ok) throw new Error(`Couldn't load the job (${res.status})`);
      return ((await res.json()) as { booking: OfficeBooking }).booking;
    },
    enabled: !!id,
    staleTime: 10_000,
  });
}

/** One row of `GET /api/dispatch/candidates?jobs=` for a job. */
export interface Candidate {
  techId: string;
  fit: "ready" | "busy" | "unqualified" | "offline";
  clash: { message?: string } | null;
  qualified: boolean;
  missing: string[];
  distanceKm: number | null;
  etaMins: number | null;
  openJobs: number;
  freeAt: string | null;
  score: number;
  best: boolean;
  reason: string;
}

export function useCandidates(bookingId: string | undefined, enabled = true) {
  const company = getActiveCompany();
  return useQuery({
    queryKey: ["candidates", company, bookingId ?? ""],
    queryFn: async () => {
      const res = await fetch(`${API}/api/dispatch/candidates?jobs=${encodeURIComponent(bookingId!)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Couldn't rank technicians (${res.status})`);
      const json = (await res.json()) as { candidates: Record<string, Candidate[]> };
      return json.candidates[bookingId!] ?? [];
    },
    enabled: enabled && !!bookingId,
    staleTime: 15_000,
  });
}
