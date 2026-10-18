import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChapterSource } from "../../shared/guide-events";
import { ArrowLeft, Check, CircleHelp, CornerDownLeft, ExternalLink, FlaskConical, LifeBuoy, PlayCircle, Search, Sparkles, X } from "lucide-react";
import { useAuth } from "../hooks/use-auth";
import { useAddSampleDay, useSampleDay } from "./SampleDayBanner";
import { Link } from "wouter";
import { ProgressRing, useLaunchChecklist } from "./launch";
import { DialogPanel } from "../components/dialog-panel";
import { dismiss } from "../lib/utils";
import { articleBySlug, categoryById, popularSlugs, support, type ArticleBlock } from "../site/support/articles";
import { searchArticles } from "../site/support/search";
import { useGuide } from "./GuideProvider";
import { interpolate } from "./registry";
import { AskConversation, useAsk, useAskAvailable } from "./ask";

/**
 * The Guide panel: the one permanent place to relearn ArrivePing.
 *
 *  - Guided tours: every chapter this person's role can open, with progress.
 *  - Ask ArrivePing: type a question, press Enter, get a short answer from the
 *    help articles with buttons to the right tour, page or article (ask.tsx).
 *  - Help Center search, reading articles in place (no new tab), with
 *    "Show me in ArrivePing" when an article has a matching tour.
 *  - A clear path to a person.
 *
 * Lazy-loaded by GuideButton, so the Help Center text only downloads when
 * someone opens the panel.
 */

/** Help article → the tour that shows the same thing in the app. */
const ARTICLE_TOUR: Record<string, string> = {
  "set-up-your-company": "find-your-way",
  "your-first-job": "create-job",
  "assigning-jobs": "scheduler",
  "invite-your-technicians": "people",
  "roles-and-permissions": "people",
  "what-customers-receive": "notifications",
  "not-receiving-notifications": "notifications",
  "customize-messages": "milestones",
  "custom-milestones": "milestones",
  "running-late": "milestones",
  "set-your-reply-to-email": "reply-to",
  "exports-and-integrations": "export",
  "scheduler-views": "scheduler",
  "run-a-report": "reports",
  "check-what-was-sent": "notifications",
  "quiet-hours": "notifications",
};

export default function GuidePanel({ onClose }: { onClose: () => void }) {
  const { chapters, status, startChapter, terms } = useGuide();
  const { role } = useAuth();
  const sample = useSampleDay();
  const addSample = useAddSampleDay();
  // Admins can bring back a sample day after clearing it (services/sample-day.ts).
  const canAddSample = (role === "admin" || role === "superadmin") && sample.data && !sample.data.active;
  const launch = useLaunchChecklist();
  const launchDone = launch.data?.items.filter((i) => i.done).length ?? 0;
  const [q, setQ] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const canAsk = useAskAvailable();
  const asking = useAsk(terms);
  const inChat = asking.turns.length > 0;

  // useDialog focuses the first control; the search box is the better start.
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);
  // Each new view starts at the top.
  useEffect(() => {
    if (!inChat) bodyRef.current?.scrollTo({ top: 0 });
  }, [slug, q, inChat]);

  const results = useMemo(() => searchArticles(q, 8), [q]);
  const article = slug ? articleBySlug[slug] : undefined;
  const done = chapters.filter((c) => status[c.id] === "completed").length;
  const tourFor = (s: string) => {
    const id = ARTICLE_TOUR[s];
    return id ? chapters.find((c) => c.id === id) : undefined;
  };

  const start = (id: string, source: ChapterSource = "panel") => {
    onClose();
    startChapter(id, source);
  };
  const submitAsk = () => {
    if (!canAsk || !q.trim() || asking.busy) return;
    void asking.ask(q);
    setQ("");
    setSlug(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* The shaded backdrop is what a click outside the panel lands on, so the
          dismiss handler goes here (on the wrapper it never saw target ===
          currentTarget and the panel wouldn't close). */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-hidden="true" {...dismiss(onClose)} />
      <DialogPanel
        onClose={onClose}
        label="Guide & help"
        data-tour="guide.panel"
        className="relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-ink-2 shadow-2xl"
      >
        <header className="flex items-center gap-2.5 border-b border-white/5 px-5 pb-3 pt-4">
          <CircleHelp className="h-5 w-5 text-brand" aria-hidden="true" />
          <h2 className="flex-1 text-base font-bold text-white">Guide &amp; help</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <form
          className="border-b border-white/5 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitAsk();
          }}
        >
          <div className="relative">
            {canAsk ? (
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" aria-hidden="true" />
            ) : (
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            )}
            <input
              ref={searchRef}
              type="search"
              enterKeyHint={canAsk ? "send" : "search"}
              aria-label={canAsk ? (inChat ? "Ask a follow-up question" : "Ask a question or search help articles") : "Search help articles"}
              value={q}
              maxLength={500}
              onChange={(e) => {
                setQ(e.target.value);
                setSlug(null);
              }}
              placeholder={canAsk ? (inChat ? "Ask a follow-up…" : "Ask a question or search help") : "Search help: reply-to, invite, export…"}
              className="h-10 w-full rounded-lg border border-white/10 bg-ink pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:outline-none"
            />
          </div>
        </form>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {article ? (
            <ArticleView
              slug={article.slug}
              title={article.title}
              category={categoryById[article.category]?.title ?? ""}
              blocks={article.blocks}
              tour={tourFor(article.slug)}
              terms={terms}
              onBack={() => setSlug(null)}
              onStart={(id) => start(id, "article")}
              onOpenArticle={setSlug}
            />
          ) : inChat ? (
            <AskConversation
              turns={asking.turns}
              chapters={chapters}
              terms={terms}
              onReset={() => {
                asking.reset();
                searchRef.current?.focus({ preventScroll: true });
              }}
              onStartTour={(id) => start(id, "ask")}
              onOpenArticle={setSlug}
              onNavigate={onClose}
            />
          ) : q.trim() ? (
            <section aria-label="Search results">
              {canAsk && (
                <button
                  type="button"
                  onClick={submitAsk}
                  data-tour="guide.ask.start"
                  className="mb-3 flex w-full items-center gap-3 rounded-[0.5rem] bg-brand/10 px-2.5 py-2.5 text-left ring-1 ring-brand/25 hover:bg-brand/15"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-100">Ask ArrivePing</span>
                    <span className="block truncate text-xs text-slate-400">&ldquo;{q.trim()}&rdquo;</span>
                  </span>
                  <CornerDownLeft className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="sr-only">(Enter)</span>
                </button>
              )}
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500" aria-live="polite">
                {results.length ? `${results.length} article${results.length === 1 ? "" : "s"}` : "No articles match"}
              </p>
              {results.length ? (
                <ul className="space-y-1">
                  {results.map((a) => (
                    <li key={a.slug}>
                      <ArticleRow title={a.title} summary={a.summary} onOpen={() => setSlug(a.slug)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">Try other words, or email us below. A person reads every message.</p>
              )}
            </section>
          ) : (
            <>
              {launch.data && (
                <Link
                  href="/admin/getting-started"
                  onClick={onClose}
                  className="mb-5 flex items-center gap-3 rounded-[0.75rem] bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.06] hover:bg-white/[0.06]"
                >
                  <ProgressRing done={launchDone} total={launch.data.items.length} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-100">Launch checklist</span>
                    <span className="block text-xs text-slate-500">
                      {launch.data.complete ? "All done. You're ready to go live." : `${launchDone} of ${launch.data.items.length} steps done`}
                    </span>
                  </span>
                </Link>
              )}

              <section aria-labelledby="guide-tours-h">
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 id="guide-tours-h" className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Guided tours
                  </h3>
                  <span className="text-xs tabular-nums text-slate-500">
                    {done} of {chapters.length} done
                  </span>
                </div>
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-brand transition-[width]"
                    style={{ width: `${chapters.length ? (done / chapters.length) * 100 : 0}%` }}
                  />
                </div>
                <ul className="space-y-1">
                  {chapters.map((c) => {
                    const complete = status[c.id] === "completed";
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => start(c.id)}
                          className="flex w-full items-start gap-3 rounded-[0.5rem] px-2.5 py-2 text-left hover:bg-white/[0.05]"
                        >
                          {complete ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-live" aria-label="Completed" />
                          ) : (
                            <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                          )}
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-slate-100">
                              {c.number}. {interpolate(c.title, terms)}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {interpolate(c.summary, terms)} · {c.steps.length} steps
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {canAddSample && (
                <section aria-labelledby="guide-sample-h" className="mt-6">
                  <h3 id="guide-sample-h" className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Practice
                  </h3>
                  <button
                    type="button"
                    disabled={addSample.isPending}
                    onClick={() => {
                      onClose();
                      addSample.mutate();
                    }}
                    className="flex w-full items-start gap-3 rounded-[0.5rem] px-2.5 py-2 text-left hover:bg-white/[0.05] disabled:opacity-60"
                  >
                    <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-100">Add a sample day</span>
                      <span className="block text-xs text-slate-500">
                        {interpolate("Pretend {workers}, {customers} and {jobs} to practise on. Nobody is messaged.", terms)}
                      </span>
                    </span>
                  </button>
                </section>
              )}

              <section aria-labelledby="guide-popular-h" className="mt-6">
                <h3 id="guide-popular-h" className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Popular in the Help Center
                </h3>
                <ul className="space-y-1">
                  {popularSlugs
                    .map((s) => articleBySlug[s])
                    .filter((a): a is NonNullable<typeof a> => Boolean(a))
                    .map((a) => (
                      <li key={a.slug}>
                        <ArticleRow title={a.title} summary={a.summary} onOpen={() => setSlug(a.slug)} />
                      </li>
                    ))}
                </ul>
              </section>
            </>
          )}
        </div>

        <footer className="border-t border-white/5 px-5 py-3 text-xs text-slate-400">
          <div className="flex items-start gap-2.5">
            <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <p className="min-w-0">
              Still stuck? Email{" "}
              <a href={`mailto:${support.email}`} className="font-semibold text-cyan-glow hover:underline">
                {support.email}
              </a>
              . {support.hours}.{" "}
              <a href="/support" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-slate-300 hover:text-white">
                Help Center <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </p>
          </div>
        </footer>
      </DialogPanel>
    </div>
  );
}

function ArticleRow({ title, summary, onOpen }: { title: string; summary: string; onOpen: () => void }) {
  return (
    // rounded-[0.5rem], not rounded-lg: styles.css turns every full-width
    // rounded-lg button into a centred inline-flex row on phones.
    <button type="button" onClick={onOpen} className="block w-full rounded-[0.5rem] px-2.5 py-2 text-left hover:bg-white/[0.05]">
      <span className="block text-sm font-semibold text-slate-100">{title}</span>
      <span className="block text-xs text-slate-500">{summary}</span>
    </button>
  );
}

function ArticleView({
  slug,
  title,
  category,
  blocks,
  tour,
  terms,
  onBack,
  onStart,
  onOpenArticle,
}: {
  slug: string;
  title: string;
  category: string;
  blocks: ArticleBlock[];
  tour?: { id: string; title: string };
  terms: Parameters<typeof interpolate>[1];
  onBack: () => void;
  onStart: (id: string) => void;
  onOpenArticle: (slug: string) => void;
}) {
  const inline = (text: string) => rich(text, onOpenArticle);
  return (
    <article aria-labelledby="guide-article-h">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-3 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
      </button>
      {category && <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">{category}</p>}
      <h3 id="guide-article-h" className="mt-1 text-lg font-bold leading-snug text-white">
        {title}
      </h3>
      {tour && (
        <button
          type="button"
          onClick={() => onStart(tour.id)}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-deep"
        >
          <PlayCircle className="h-4 w-4" aria-hidden="true" /> Show me in ArrivePing: {interpolate(tour.title, terms)}
        </button>
      )}
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
        {blocks.map((b, i) => (
          <Block key={i} b={b} inline={inline} />
        ))}
      </div>
      <a
        href={`/support/${slug}`}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
      >
        Open in the Help Center <ExternalLink className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </article>
  );
}

function Block({ b, inline }: { b: ArticleBlock; inline: (t: string) => ReactNode }) {
  switch (b.type) {
    case "p":
      return <p>{inline(b.text)}</p>;
    case "h3":
      return <h4 className="pt-1 text-sm font-bold text-white">{b.text}</h4>;
    case "ul":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {b.items.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal space-y-1 pl-5">
          {b.items.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </ol>
      );
    case "note":
      return (
        <aside className="rounded-lg border border-brand/20 bg-brand/[0.06] px-3 py-2.5">
          <strong className="text-white">{b.title}</strong> {inline(b.text)}
        </aside>
      );
  }
}

/**
 * The Help Center's inline syntax: [text](href) and **bold**. A link to another
 * help article opens in the panel; anything else opens in a new tab so the
 * person never loses their place in the app.
 */
function rich(text: string, openArticle: (slug: string) => void): ReactNode[] {
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[3] !== undefined) {
      out.push(
        <strong key={m.index} className="text-white">
          {m[3]}
        </strong>,
      );
    } else {
      const href = m[2]!;
      const help = /^\/support\/([a-z0-9-]+)$/.exec(href);
      out.push(
        help && articleBySlug[help[1]!] ? (
          <button key={m.index} type="button" onClick={() => openArticle(help[1]!)} className="font-semibold text-cyan-glow hover:underline">
            {m[1]}
          </button>
        ) : (
          <a key={m.index} href={href} target="_blank" rel="noreferrer" className="font-semibold text-cyan-glow hover:underline">
            {m[1]}
          </a>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
