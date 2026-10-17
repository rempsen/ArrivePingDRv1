import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCustomerNoun, useJobNoun, useWorkerNoun } from "../lib/use-brand";
import { useAuth } from "../hooks/use-auth";
import { apiFetch, apiHeaders } from "../lib/api";
import { EMPTY_ONBOARDING, mergeOnboarding, type OnboardingPatch, type OnboardingState } from "../../shared/onboarding";
import { chapterById, CHAPTERS, type Chapter, type Terms } from "./registry";

/**
 * ArrivePing Guide state.
 *
 * Progress lives on the membership (GET/PATCH /api/me/onboarding), so it
 * follows the person across devices and is per company. Writes are
 * optimistic; if the server is unreachable the tour still works and the
 * record catches up on the next successful save.
 *
 * `?guide=<chapterId>` on any admin URL starts that chapter — used by the
 * AI "Show me how" answers, help articles and the guide-lint e2e test.
 */
const TourRunner = lazy(() => import("./TourRunner"));
const WelcomeSheet = lazy(() => import("./WelcomeSheet").then((m) => ({ default: m.WelcomeSheet })));

type ChapterStatus = "completed" | "skipped";
interface GuideContextValue {
  chapters: Chapter[];
  status: Record<string, ChapterStatus | undefined>;
  activeChapterId: string | null;
  startChapter: (id: string) => void;
  /** The full stored record (Welcome answers etc.); null until loaded. */
  state: OnboardingState | null;
  save: (patch: OnboardingPatch) => Promise<void>;
  /** The company's own words for jobs/technicians/customers, for copy. */
  terms: Terms;
}

const GuideContext = createContext<GuideContextValue | null>(null);
const QK = ["me", "onboarding"] as const;

async function fetchState(): Promise<OnboardingState> {
  const res = await apiFetch("/api/me/onboarding", { headers: apiHeaders() });
  return ((await res.json()) as { state: OnboardingState }).state;
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = (user as { id?: string } | null)?.id ?? "anon";
  const job = useJobNoun();
  const worker = useWorkerNoun();
  const customer = useCustomerNoun();
  const terms: Terms = useMemo(
    () => ({
      job: job.noun,
      jobs: job.nounPlural,
      worker: worker.noun,
      workers: worker.nounPlural,
      customer: customer.noun,
      customers: customer.nounPlural,
    }),
    [job.noun, job.nounPlural, worker.noun, worker.nounPlural, customer.noun, customer.nounPlural],
  );

  const qc = useQueryClient();
  const stateQ = useQuery({ queryKey: [...QK, userId], queryFn: fetchState, staleTime: 60_000, enabled: userId !== "anon" });
  const state = stateQ.data ?? null;
  const [activeChapterId, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeChapterId;

  const status = useMemo(() => {
    const out: Record<string, ChapterStatus | undefined> = {};
    for (const [id, p] of Object.entries(state?.tours ?? {})) out[id] = p.status;
    return out;
  }, [state]);

  const save = useCallback(
    async (patch: OnboardingPatch) => {
      const key = [...QK, userId];
      qc.setQueryData<OnboardingState>(key, (cur) => mergeOnboarding(cur ?? EMPTY_ONBOARDING, patch));
      try {
        const res = await apiFetch("/api/me/onboarding", {
          method: "PATCH",
          headers: { ...apiHeaders(), "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = (await res.json()) as { state: OnboardingState };
        qc.setQueryData(key, body.state);
      } catch (e) {
        console.warn("[guide] could not save progress", e);
      }
    },
    [qc, userId],
  );

  const startChapter = useCallback((id: string) => {
    if (chapterById[id]) setActive(id);
  }, []);

  // Deep link: ?guide=scheduler
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("guide");
    if (id && chapterById[id]) {
      const url = new URL(window.location.href);
      url.searchParams.delete("guide");
      window.history.replaceState(window.history.state, "", url.toString());
      setActive(id);
    }
  }, []);

  const onFinish = useCallback(
    (result: ChapterStatus) => {
      const id = activeRef.current;
      setActive(null);
      if (id) void save({ tours: { [id]: { status: result, at: new Date().toISOString() } } });
    },
    [save],
  );

  const value = useMemo(
    () => ({ chapters: CHAPTERS, status, activeChapterId, startChapter, state, save, terms }),
    [status, activeChapterId, startChapter, state, save, terms],
  );
  const active = activeChapterId ? chapterById[activeChapterId] : null;

  return (
    <GuideContext.Provider value={value}>
      {children}
      {state && !state.welcomeDoneAt && (
        <Suspense fallback={null}>
          <WelcomeSheet />
        </Suspense>
      )}
      {active && (
        <Suspense fallback={null}>
          <TourRunner key={active.id} chapter={active} terms={terms} onFinish={onFinish} />
        </Suspense>
      )}
    </GuideContext.Provider>
  );
}

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide must be used inside <GuideProvider>");
  return ctx;
}
