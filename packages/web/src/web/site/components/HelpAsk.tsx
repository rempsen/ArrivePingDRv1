import { useEffect, useRef, useState } from "react";
import { Answer } from "../../lib/answer-text";
import { articles } from "../support/articles";
import { videoByKey } from "../support/videos";
import { useVideoDialog } from "./HelpVideo";
import { prefillSupportMessage } from "./SupportMessageForm";
import { HELP_ASK_LIMITS, readHelpStream, type HelpAskAction } from "../../../shared/help-ask";

/**
 * "Ask ArrivePing" on the Help Center (server: api/routes/help-ask.ts).
 *
 * Asked from the hero's box with Enter. The answer streams in as numbered
 * steps naming the real buttons, with up to two buttons under it (an article
 * or a video) and, when the assistant couldn't answer, a button that fills in
 * the "Send us a message" form with the question. Follow-ups keep the thread.
 */

type Turn = { q: string; a: string; actions: HelpAskAction[]; id?: string; error?: string; done: boolean; vote?: 1 | -1 };

/** Is Ask on? (Off without an AI key, and the hero stays a plain search.) */
export function useAskAvailable(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/public/help/ask")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => live && setOn(Boolean(d.available)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return on;
}

export function useHelpAsk() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((t) => !t.done);
  const abort = useRef<AbortController | null>(null);

  const patch = (i: number, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, n) => (n === i ? f(t) : t)));

  async function ask(question: string) {
    const q = question.trim().slice(0, HELP_ASK_LIMITS.question);
    if (!q || busy) return;
    const history = turns
      .filter((t) => t.done && !t.error)
      .slice(-3)
      .flatMap((t) => [
        { role: "user" as const, text: t.q },
        { role: "assistant" as const, text: t.a.slice(0, HELP_ASK_LIMITS.historyText) },
      ]);
    const i = turns.length;
    setTurns((ts) => [...ts, { q, a: "", actions: [], done: false }]);
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/public/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, platform: "web" }),
        signal: abort.current.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        patch(i, (t) => ({ ...t, done: true, error: body.message || (res.status === 429 ? "That's a lot of questions. Try again in a little while, or search the articles below." : "Ask isn't available right now. Search the articles below.") }));
        return;
      }
      await readHelpStream(res, (e) => {
        if (e.event === "delta") patch(i, (t) => ({ ...t, a: t.a + e.data.text }));
        else if (e.event === "action") patch(i, (t) => ({ ...t, actions: [...t.actions, e.data] }));
        else if (e.event === "error") patch(i, (t) => ({ ...t, error: e.data.message }));
        else if (e.event === "done") patch(i, (t) => ({ ...t, id: e.data.id, done: true }));
      });
      patch(i, (t) => ({ ...t, done: true }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      patch(i, (t) => ({ ...t, done: true, error: "We couldn't reach Ask. Check your connection and try again." }));
    }
  }

  function vote(i: number, rating: 1 | -1) {
    const t = turns[i];
    if (!t?.id || t.vote) return;
    patch(i, (x) => ({ ...x, vote: rating }));
    void fetch("/api/public/help/rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, rating }) }).catch(() => {});
  }

  function reset() {
    abort.current?.abort();
    setTurns([]);
  }

  return { turns, busy, ask, vote, reset };
}

/** The answer thread under the hero. */
export function HelpAskThread({ ask }: { ask: ReturnType<typeof useHelpAsk> }) {
  const [follow, setFollow] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { open: openVideo } = useVideoDialog();
  const last = ask.turns[ask.turns.length - 1];

  useEffect(() => {
    if (ask.turns.length > 1) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ask.turns.length]);

  if (!ask.turns.length) return null;

  const contact = (q: string, a: string, reason: string) => {
    prefillSupportMessage(`${reason ? `${reason}\n\n` : ""}My question: ${q}${a ? `\n\nWhat Ask said:\n${a.slice(0, 1500)}` : ""}`);
  };

  return (
    <section className="help-ask" aria-label="Answers from Ask ArrivePing" aria-live="polite">
      {ask.turns.map((t, i) => (
        <article key={i} className="help-ask__turn">
          <p className="help-ask__q">{t.q}</p>
          <div className="help-ask__a">
            {t.a ? <Answer text={t.a} /> : !t.error && <p className="help-ask__thinking">Finding the steps…</p>}
            {t.error && <p className="help-ask__error">{t.error}</p>}
          </div>
          {(t.actions.length > 0 || (t.done && !t.error)) && (
            <div className="help-ask__actions">
              {t.actions.map((a, n) => {
                if (a.type === "article") {
                  const art = articles.find((x) => x.slug === a.slug);
                  return art ? (
                    <a key={n} className="help-ask__btn" href={`/support/${art.slug}`}>
                      Read: {art.title}
                    </a>
                  ) : null;
                }
                if (a.type === "video") {
                  const v = videoByKey[a.key];
                  return v ? (
                    <button key={n} type="button" className="help-ask__btn" onClick={() => openVideo(v.key)}>
                      ▶ Watch: {v.title}
                    </button>
                  ) : null;
                }
                return (
                  <button key={n} type="button" className="help-ask__btn help-ask__btn--primary" onClick={() => contact(t.q, t.a, a.reason)}>
                    Ask our support team
                  </button>
                );
              })}
              {t.done && !t.error && t.id && (
                <span className="help-ask__vote">
                  {t.vote ? (
                    <span>{t.vote === 1 ? "Thanks!" : "Thanks. We'll use this to improve the answer."}</span>
                  ) : (
                    <>
                      Did this help?
                      <button type="button" onClick={() => ask.vote(i, 1)} aria-label="Yes, this helped">
                        👍
                      </button>
                      <button type="button" onClick={() => ask.vote(i, -1)} aria-label="No, this didn't help">
                        👎
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          )}
          {t.vote === -1 && !t.actions.some((a) => a.type === "contact") && (
            <p className="help-ask__still">
              Still stuck?{" "}
              <button type="button" className="legal__link" onClick={() => contact(t.q, t.a, "")}>
                Send this question to our support team
              </button>
              .
            </p>
          )}
        </article>
      ))}
      <div ref={endRef} />
      {last?.done && (
        <form
          className="help-ask__follow"
          onSubmit={(e) => {
            e.preventDefault();
            void ask.ask(follow);
            setFollow("");
          }}
        >
          <input
            value={follow}
            onChange={(e) => setFollow(e.target.value)}
            maxLength={HELP_ASK_LIMITS.question}
            placeholder="Ask a follow-up…"
            aria-label="Ask a follow-up question"
          />
          <button type="submit" disabled={!follow.trim() || ask.busy}>
            Ask
          </button>
          <button type="button" className="help-ask__clear" onClick={ask.reset}>
            Start over
          </button>
        </form>
      )}
      <p className="help-ask__fine">Answers are written by AI from ArrivePing's own screens and guides. If something doesn't match what you see, tell us.</p>
    </section>
  );
}
