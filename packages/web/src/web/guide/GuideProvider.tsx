import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCustomerNoun, useJobNoun, useWorkerNoun } from "../lib/use-brand";
import { useAuth } from "../hooks/use-auth";
import { apiFetch, apiHeaders } from "../lib/api";
import { EMPTY_ONBOARDING, mergeOnboarding, mergePatches, parseOnboarding, type OnboardingPatch, type OnboardingState } from "../../shared/onboarding";
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

/**
 * Someone with no membership at the acting company (a superadmin acting as a
 * tenant) has nowhere to store progress on the server, so it is kept in this
 * browser instead. Without it the Welcome sheet would reopen on every load.
 */
/** The company being acted as (the superadmin switcher), or "home". Progress is per person per company. */
function activeCompany(): string {
  try {
    return window.localStorage.getItem("active_company") || "home";
  } catch {
    return "home";
  }
}
const localKey = (userId: string) => `ap.guide.onboarding.${userId}.${activeCompany()}`;
function readLocal(userId: string): OnboardingState {
  try {
    return parseOnboarding(window.localStorage.getItem(localKey(userId)));
  } catch {
    return { ...EMPTY_ONBOARDING, tours: {} };
  }
}
function writeLocal(userId: string, state: OnboardingState) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(state));
  } catch {
    /* private mode / storage full: progress is session-only */
  }
}

async function fetchState(userId: string, persistedRef: { current: boolean | null }): Promise<OnboardingState> {
  const res = await apiFetch("/api/me/onboarding", { headers: apiHeaders() });
  const body = (await res.json()) as { state: OnboardingState; persisted?: boolean };
  persistedRef.current = body.persisted !== false;
  return body.persisted === false ? readLocal(userId) : body.state;
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
  const persistedRef = useRef<boolean | null>(null);
  // Keyed by company too, so switching tenants never shows another tenant's progress.
  const company = activeCompany();
  const stateQ = useQuery({
    queryKey: [...QK, userId, company],
    queryFn: () => fetchState(userId, persistedRef),
    staleTime: 60_000,
    enabled: userId !== "anon",
  });
  const state = stateQ.data ?? null;
  const [activeChapterId, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeChapterId;

  const status = useMemo(() => {
    const out: Record<string, ChapterStatus | undefined> = {};
    for (const [id, p] of Object.entries(state?.tours ?? {})) out[id] = p.status;
    return out;
  }, [state]);

  // Changes not yet confirmed by the server. Every save sends all of them, so
  // a save that failed is retried by the next one instead of being lost, and
  // the server's reply never wipes a change that is still on its way.
  const pendingRef = useRef<OnboardingPatch | null>(null);
  const seqRef = useRef(0);

  const save = useCallback(
    async (patch: OnboardingPatch) => {
      const key = [...QK, userId, company];
      const local = qc.setQueryData<OnboardingState>(key, (cur) => mergeOnboarding(cur ?? EMPTY_ONBOARDING, patch));
      if (persistedRef.current === false) {
        if (local) writeLocal(userId, local);
        return;
      }
      pendingRef.current = mergePatches(pendingRef.current, patch);
      const sending = pendingRef.current;
      const seq = ++seqRef.current;
      try {
        const res = await apiFetch("/api/me/onboarding", {
          method: "PATCH",
          headers: { ...apiHeaders(), "content-type": "application/json" },
          body: JSON.stringify(sending),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { state: OnboardingState; persisted?: boolean };
        // A newer save was sent after this one and carries everything this one
        // did: its reply is the one to trust, even if it arrives first.
        if (seq !== seqRef.current) return;
        pendingRef.current = null;
        const confirmed = body.state;
        qc.setQueryData(key, confirmed);
        if (body.persisted === false) {
          persistedRef.current = false;
          pendingRef.current = null;
          writeLocal(userId, confirmed);
        }
      } catch (e) {
        console.warn("[guide] could not save progress; will retry with the next save", e);
      }
    },
    [qc, userId, company],
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
