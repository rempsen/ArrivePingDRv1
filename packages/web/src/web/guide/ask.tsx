import { useCallback, useEffect, useRef, useState } from "react";
import { Answer } from "../lib/answer-text";
import { trackGuide } from "./events";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, BookOpen, PlayCircle, Sparkles } from "lucide-react";
import { apiHeaders } from "../lib/api";
import { ASK_LIMITS, ASK_PAGES, type AskAction } from "../../shared/guide-ask";
import { articleBySlug } from "../site/support/articles";
import { interpolate, type Chapter, type Terms } from "./registry";

/**
 * "Ask ArrivePing" in the Guide panel (server: api/routes/guide-ask.ts).
 *
 * The answer streams in; the assistant's suggestions arrive as buttons (start
 * a tour, open a page, read an article) that only do something when pressed.
 * Follow-up questions send the last few turns back so "and for emails?" works.
 */
export interface AskTurn {
  question: string;
  answer: string;
  actions: AskAction[];
  status: "streaming" | "done" | "error";
  error?: string;
}

/** Shown only when the server says Ask works for this person (office role, gateway configured). */
export function useAskAvailable(): boolean {
  const q = useQuery({
    queryKey: ["guide-ask-available"],
    queryFn: async () => {
      const res = await fetch("/api/guide/ask", { headers: apiHeaders() });
      if (!res.ok) return { available: false };
      return (await res.json()) as { available: boolean };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.available === true;
}

const FRIENDLY: Record<number, string> = {
  429: "You've asked a lot of questions this hour. Try again a little later, or search the help articles.",
  503: "Ask ArrivePing isn't available right now. Search the help articles instead.",
};

async function postAsk(
  body: unknown,
  signal: AbortSignal,
  on: { delta: (t: string) => void; action: (a: AskAction) => void; error: (m: string) => void },
) {
  const res = await fetch("/api/guide/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = FRIENDLY[res.status] ?? "Sorry, something went wrong. Try again, or search the help articles.";
    if (res.status === 400) msg = "Try a shorter question.";
    on.error(msg);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      let payload: any;
      try {
        payload = JSON.parse(data.join("\n"));
      } catch {
        continue;
      }
      if (event === "delta" && typeof payload?.text === "string") on.delta(payload.text);
      else if (event === "action" && payload?.type) on.action(payload as AskAction);
      else if (event === "error") on.error(payload?.message ?? "Sorry, something went wrong.");
    }
  }
}

export function useAsk(terms: Terms) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (f: (t: AskTurn) => AskTurn) => setTurns((ts) => (ts.length ? [...ts.slice(0, -1), f(ts[ts.length - 1]!)] : ts));

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, ASK_LIMITS.question);
      if (!question || turnsRef.current.some((t) => t.status === "streaming")) return;
      const history = turnsRef.current
        .filter((t) => t.status === "done")
        .slice(-(ASK_LIMITS.history / 2))
        .flatMap((t) => [
          { role: "user" as const, text: t.question.slice(0, ASK_LIMITS.historyText) },
          { role: "assistant" as const, text: t.answer.slice(0, ASK_LIMITS.historyText) },
        ]);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setTurns((ts) => [...ts, { question, answer: "", actions: [], status: "streaming" }]);
      // For the analytics event: did it answer, and with how many buttons.
      let text = "";
      let buttons = 0;
      let failed = false;
      try {
        await postAsk({ question, history, terms }, ctrl.signal, {
          delta: (d) => {
            text += d;
            patchLast((t) => ({ ...t, answer: t.answer + d }));
          },
          action: (a) => {
            buttons++;
            patchLast((t) => ({ ...t, actions: [...t.actions, a] }));
          },
          error: (m) => {
            failed = true;
            patchLast((t) => ({ ...t, status: "error", error: m }));
          },
        });
        patchLast((t) => (t.status === "streaming" ? { ...t, status: "done" } : t));
        trackGuide({ name: "guide.ask_question", answered: Boolean(text.trim()) && !failed, actions: Math.min(5, buttons) });
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        // Lost connection counts as unanswered too.
        trackGuide({ name: "guide.ask_question", answered: false, actions: Math.min(5, buttons) });
        patchLast((t) => ({ ...t, status: "error", error: "Couldn't reach ArrivePing. Check your connection and try again." }));
      }
    },
    [terms],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, []);

  return { turns, ask, reset, busy: turns.some((t) => t.status === "streaming") };
}


function pageLabel(route: string, terms: Terms): string {
  const label = ASK_PAGES.find((p) => p.route === route)?.label ?? route;
  return interpolate(label.split(" (")[0]!, terms);
}

export function AskConversation({
  turns,
  chapters,
  terms,
  onReset,
  onStartTour,
  onOpenArticle,
  onNavigate,
}: {
  turns: AskTurn[];
  chapters: Chapter[];
  terms: Terms;
  onReset: () => void;
  onStartTour: (id: string) => void;
  onOpenArticle: (slug: string) => void;
  onNavigate: () => void;
}) {
  const last = turns[turns.length - 1];
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, last?.status, last?.actions.length]);

  return (
    <section aria-label="Ask ArrivePing" data-tour="guide.ask">
      <button
        type="button"
        onClick={onReset}
        className="-ml-1 mb-3 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to help
      </button>

      <ol className="space-y-4">
        {turns.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="ml-8 rounded-[0.75rem] rounded-br-sm bg-white/[0.06] px-3 py-2 text-sm text-slate-100">{t.question}</p>
            <div className="flex gap-2.5">
              <Sparkles className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <div className="min-w-0 flex-1" aria-busy={t.status === "streaming"}>
                {t.answer ? (
                  <div className="text-sm leading-relaxed text-slate-300" data-testid="ask-answer">
                    <Answer text={t.answer} cls={{ p: "mt-2 first:mt-0", ol: "mt-2 list-decimal space-y-1 pl-5", ul: "mt-2 list-disc space-y-1 pl-5", strong: "text-white" }} />
                  </div>
                ) : t.status === "streaming" ? (
                  <p className="text-sm text-slate-500">
                    <span className="animate-pulse">Looking through the help…</span>
                  </p>
                ) : null}
                {t.status === "error" && <p className="mt-1 text-sm text-amber-300">{t.error}</p>}
                {t.actions.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {t.actions.map((a, j) => (
                      <ActionButton
                        key={j}
                        action={a}
                        chapters={chapters}
                        terms={terms}
                        onStartTour={onStartTour}
                        onOpenArticle={onOpenArticle}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {last?.status === "done" ? "Answer ready." : last?.status === "error" ? last.error : ""}
      </p>
      <p className="mt-5 text-xs text-slate-500">
        Answers come from the ArrivePing help articles and can be wrong. Ask can't see or change your {terms.jobs.toLowerCase()} or{" "}
        {terms.customers.toLowerCase()}.
      </p>
      <div ref={endRef} />
    </section>
  );
}

// rounded-[0.5rem], not rounded-lg: styles.css turns rounded-lg buttons into
// 44px-tall inline-flex rows on phones, which breaks these compact chips.
const CHIP =
  "inline-flex items-center gap-1.5 rounded-[0.5rem] px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/[0.06] text-slate-200";

function ActionButton({
  action,
  chapters,
  terms,
  onStartTour,
  onOpenArticle,
  onNavigate,
}: {
  action: AskAction;
  chapters: Chapter[];
  terms: Terms;
  onStartTour: (id: string) => void;
  onOpenArticle: (slug: string) => void;
  onNavigate: () => void;
}) {
  if (action.type === "tour") {
    const c = chapters.find((ch) => ch.id === action.id);
    if (!c) return null;
    return (
      <button
        type="button"
        className={CHIP}
        onClick={() => {
          trackGuide({ name: "guide.ask_action", type: "tour" });
          onStartTour(c.id);
        }}
      >
        <PlayCircle className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> Show me: {interpolate(c.title, terms)}
      </button>
    );
  }
  if (action.type === "article") {
    const a = articleBySlug[action.slug];
    if (!a) return null;
    return (
      <button
        type="button"
        className={CHIP}
        onClick={() => {
          trackGuide({ name: "guide.ask_action", type: "article" });
          onOpenArticle(a.slug);
        }}
      >
        <BookOpen className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Read: {a.title}
      </button>
    );
  }
  if (!ASK_PAGES.some((p) => p.route === action.route)) return null;
  return (
    <Link
      href={action.route}
      className={CHIP}
      onClick={() => {
        trackGuide({ name: "guide.ask_action", type: "page" });
        onNavigate();
      }}
    >
      Open {pageLabel(action.route, terms)} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
