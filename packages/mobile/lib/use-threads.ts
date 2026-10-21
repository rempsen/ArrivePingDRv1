import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { getActiveCompany } from "./active-company";
import { useLiveMessageSignal } from "./live-messages";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/** One row of `GET /api/messages/dispatch/threads`. */
export interface DispatchThread {
  techId: string;
  name: string;
  photoUrl?: string | null;
  color?: string | null;
  status?: string;
  tags?: Array<{ id: string; name: string }>;
  lastMessage: string | null;
  lastSenderRole: string | null;
  lastAt: string | null;
  unread: number;
}

export const threadsKey = (company: string) => ["dispatch-threads", company] as const;

async function fetchThreads(): Promise<DispatchThread[]> {
  const res = await fetch(`${API}/api/messages/dispatch/threads`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Threads failed (${res.status})`);
  const json = (await res.json()) as { threads?: DispatchThread[] } | DispatchThread[];
  return Array.isArray(json) ? json : (json.threads ?? []);
}

/**
 * The dispatcher's inbox: one thread per technician, unread-first (the
 * server sorts). Refreshed by the tenant-wide inbox stream, with a slow poll
 * as the safety net, exactly like the rider's thread screen.
 */
export function useDispatchThreads(enabled = true) {
  const company = getActiveCompany();
  const q = useQuery({
    queryKey: threadsKey(company),
    queryFn: fetchThreads,
    refetchInterval: 30_000,
    enabled,
  });
  useLiveMessageSignal(enabled ? "/api/messages/inbox/stream" : null, () => q.refetch());
  const unread = (q.data ?? []).reduce((n, t) => n + (t.unread ?? 0), 0);
  return { ...q, threads: q.data ?? [], unread };
}
