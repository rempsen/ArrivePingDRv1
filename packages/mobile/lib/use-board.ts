import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { getActiveCompany } from "./active-company";
import type { OfficeJob, OfficeTech } from "./board";
import { useStreamHealthy } from "./use-dispatch-stream";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/** `GET /api/dispatch/board` — the fields the office screens use. */
export interface Board {
  day: string;
  days: number;
  tz: string;
  workerNoun: string;
  jobNoun: string;
  office: { lat: number; lng: number } | null;
  truncated: boolean;
  generatedAt: string;
  techs: OfficeTech[];
  jobs: OfficeJob[];
}

export interface DayLoad {
  tz: string;
  techs: number;
  days: Array<{ day: string; jobs: number; bookedMins: number; techs: number }>;
}

export const boardKey = (company: string, day: string | null) => ["board", company, day ?? "today"] as const;

export async function fetchBoard(day: string | null, days = 1): Promise<Board> {
  const q = new URLSearchParams({ days: String(days) });
  if (day) q.set("day", day);
  const res = await fetch(`${API}/api/dispatch/board?${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(res.status === 403 ? "Your role can't see the dispatch board." : `Board failed (${res.status})`);
  return (await res.json()) as Board;
}

/**
 * The board for one company-time day. `day` null = today on the company's
 * clock (the server decides, so the app never guesses the timezone before
 * the first response). Polls every 30 s only while the live stream is down.
 */
export function useBoard(day: string | null, enabled = true) {
  const company = getActiveCompany();
  const healthy = useStreamHealthy();
  return useQuery({
    queryKey: boardKey(company, day),
    queryFn: () => fetchBoard(day),
    staleTime: 10_000,
    refetchInterval: healthy ? false : 30_000,
    enabled,
  });
}

export async function fetchDayLoad(from: string, days = 8): Promise<DayLoad> {
  const q = new URLSearchParams({ from, days: String(days) });
  const res = await fetch(`${API}/api/dispatch/load?${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Load failed (${res.status})`);
  return (await res.json()) as DayLoad;
}

/** Job counts per day for the day strip on Jobs. */
export function useDayLoad(from: string | null, days = 8) {
  const company = getActiveCompany();
  return useQuery({
    queryKey: ["day-load", company, from, days],
    queryFn: () => fetchDayLoad(from!, days),
    staleTime: 60_000,
    enabled: !!from,
  });
}
