/**
 * Ranked technicians for a handful of jobs, fetched in one call (up to 20) so
 * the queue is already scored before anyone picks a card up. Refreshed whenever
 * the board says something changed.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { activeCompany } from "../../../lib/tenant";
import { fetchCandidates } from "./api";
import type { DispatchCandidate } from "./types";

const NONE: Record<string, DispatchCandidate[]> = {};

export function useCandidates(jobIds: readonly string[], enabled = true) {
  const company = activeCompany() ?? "home";
  const ids = useMemo(() => [...new Set(jobIds.filter(Boolean))].sort().slice(0, 20), [jobIds]);
  const joined = ids.join(",");
  const q = useQuery({
    queryKey: ["dispatch-candidates", company, joined],
    queryFn: ({ signal }) => fetchCandidates(ids, signal),
    enabled: enabled && ids.length > 0,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return { candidates: q.data ?? NONE, isFetching: q.isFetching };
}
