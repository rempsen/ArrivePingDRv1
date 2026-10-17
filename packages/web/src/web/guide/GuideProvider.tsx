import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCustomerNoun, useJobNoun, useWorkerNoun } from "../lib/use-brand";
import { useAuth } from "../hooks/use-auth";
import { chapterById, CHAPTERS, type Chapter, type Terms } from "./registry";

/**
 * ArrivePing Guide state.
 *
 * Phase 0 keeps progress in localStorage (per user) behind `progressStore`;
 * Phase 1 swaps that for `memberships.onboarding` via /api/me/onboarding so
 * progress follows the user across devices. Nothing else changes.
 *
 * `?guide=<chapterId>` on any admin URL starts that chapter — used by the
 * AI "Show me how" answers, help articles and the guide-lint e2e test.
 */
const TourRunner = lazy(() => import("./TourRunner"));

type ChapterStatus = "completed" | "skipped";
interface GuideContextValue {
  chapters: Chapter[];
  status: Record<string, ChapterStatus | undefined>;
  activeChapterId: string | null;
  startChapter: (id: string) => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

const progressStore = {
  key: (userId: string) => `ap_guide_v1:${userId}`,
  read(userId: string): Record<string, ChapterStatus> {
    try {
      return JSON.parse(localStorage.getItem(this.key(userId)) || "{}");
    } catch {
      return {};
    }
  },
  write(userId: string, v: Record<string, ChapterStatus>) {
    try {
      localStorage.setItem(this.key(userId), JSON.stringify(v));
    } catch {
      /* storage blocked: progress just won't persist */
    }
  },
};

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

  const [status, setStatus] = useState<Record<string, ChapterStatus | undefined>>({});
  const [activeChapterId, setActive] = useState<string | null>(null);

  useEffect(() => {
    setStatus(progressStore.read(userId));
  }, [userId]);

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
      setActive((id) => {
        if (id) {
          setStatus((prev) => {
            const next = { ...prev, [id]: prev[id] === "completed" ? "completed" : result } as Record<string, ChapterStatus>;
            progressStore.write(userId, next);
            return next;
          });
        }
        return null;
      });
    },
    [userId],
  );

  const value = useMemo(
    () => ({ chapters: CHAPTERS, status, activeChapterId, startChapter }),
    [status, activeChapterId, startChapter],
  );
  const active = activeChapterId ? chapterById[activeChapterId] : null;

  return (
    <GuideContext.Provider value={value}>
      {children}
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
