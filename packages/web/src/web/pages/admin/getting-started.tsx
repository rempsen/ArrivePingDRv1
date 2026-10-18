import { Link } from "wouter";
import { ArrowRight, Check, CircleDashed, Clock, EyeOff, PartyPopper, PlayCircle } from "lucide-react";
import { PageWrap } from "../../components/brand";
import { FullLoader } from "../../components/loader";
import { PageHead } from "./shell";
import { useGuide } from "../../guide/GuideProvider";
import { interpolate } from "../../guide/registry";
import { LAUNCH_ITEMS, ProgressRing, SETUP_LABELS, useLaunchChecklist } from "../../guide/launch";
import { useSampleDay } from "../../guide/SampleDayBanner";

/**
 * /admin/getting-started — the Launch checklist (HubSpot / Outseta pattern):
 * five things to go live, each ticked from real data, each with a tour that
 * shows how and a link that takes you there. The setup the AI already did is a
 * collapsed "done for you" group, so new companies start ahead.
 */
export default function GettingStarted() {
  const q = useLaunchChecklist();
  const { terms, startChapter, chapters, save, state } = useGuide();
  const sample = useSampleDay();
  const t = (s: string) => interpolate(s, terms);

  if (q.isLoading || !q.data) return <FullLoader label="Loading your checklist…" />;
  const data = q.data;
  const done = data.items.filter((i) => i.done).length;
  const setupDone = data.setup.filter((s) => s.done).length;
  const hasChapter = (id: string) => chapters.some((c) => c.id === id);

  return (
    <PageWrap>
      <PageHead
        title="Getting started"
        subtitle="Five steps to run your first real day on ArrivePing. Each one ticks itself when it's done."
      />

      <section
        aria-label="Progress"
        className="nvc-card mb-5 flex flex-wrap items-center gap-4 p-5"
        data-tour="launch.progress"
      >
        <ProgressRing done={done} total={data.items.length} size={56} />
        {/* min-w keeps the text readable: below it, the Hide button wraps
            to its own line instead of squeezing this column. */}
        <div className="min-w-[11rem] flex-1">
          <p className="text-lg font-bold text-white">
            {data.complete ? "You're ready to go live" : `${done} of ${data.items.length} done`}
          </p>
          <p className="text-sm text-slate-400">
            {data.complete
              ? "Every step is done. Your customers are getting live ETAs."
              : "Do them in any order. Stuck? Each step has a short tour."}
          </p>
        </div>
        {state?.checklistHidden ? (
          <button
            type="button"
            onClick={() => void save({ checklistHidden: false })}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 hover:text-white"
          >
            Show in the sidebar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void save({ checklistHidden: true })}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 hover:text-white"
          >
            <EyeOff className="h-4 w-4" aria-hidden="true" /> Hide from the sidebar
          </button>
        )}
      </section>

      {data.complete && (
        <section className="nvc-card mb-5 flex items-start gap-3 border border-emerald-live/20 p-5" aria-label="You're live">
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-emerald-live" aria-hidden="true" />
          <div className="text-sm text-slate-300">
            <p className="font-semibold text-white">Nice work. You're live.</p>
            {sample.data?.active ? (
              <p className="mt-1">
                When you're done practising, clear the sample data from the banner at the top of the screen. Your own work stays.
              </p>
            ) : (
              <p className="mt-1">You can hide this checklist now; it's always in Guide &amp; help if you want it back.</p>
            )}
          </div>
        </section>
      )}

      <ol className="space-y-3" aria-label="Launch checklist">
        {data.items.map((item, i) => {
          const meta = LAUNCH_ITEMS[item.id];
          return (
            <li key={item.id} className="nvc-card flex flex-wrap items-start gap-4 p-5" data-tour={`launch.item.${item.id}`}>
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  item.done ? "bg-emerald-live/15 text-emerald-live" : item.waiting ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-slate-500"
                }`}
              >
                {item.done ? (
                  <Check className="h-5 w-5" aria-hidden="true" />
                ) : item.waiting ? (
                  <Clock className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <CircleDashed className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className={`text-base font-semibold ${item.done ? "text-slate-400 line-through decoration-slate-600" : "text-white"}`}>
                  <span className="sr-only">{item.done ? "Done: " : item.waiting ? "Waiting: " : "To do: "}</span>
                  {i + 1}. {t(meta.title)}
                </h2>
                <p className="mt-1 text-sm text-slate-400">{item.waiting && meta.waiting ? meta.waiting : t(meta.body)}</p>
              </div>
              {!item.done && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  {hasChapter(meta.chapter) && (
                    <button
                      type="button"
                      onClick={() => startChapter(meta.chapter)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5"
                    >
                      <PlayCircle className="h-4 w-4 text-brand" aria-hidden="true" /> Show me
                    </button>
                  )}
                  <Link
                    href={meta.route}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-deep"
                  >
                    {t(meta.action)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <details className="nvc-card mt-5 p-5" data-tour="launch.setup">
        <summary className="cursor-pointer select-none text-sm font-semibold text-slate-300">
          Set up for you at signup · {setupDone} of {data.setup.length}
        </summary>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.setup.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm text-slate-400">
              {s.done ? (
                <Check className="h-4 w-4 text-emerald-live" aria-hidden="true" />
              ) : (
                <CircleDashed className="h-4 w-4 text-slate-600" aria-hidden="true" />
              )}
              <span className="sr-only">{s.done ? "Done: " : "Not yet: "}</span>
              {SETUP_LABELS[s.id]}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Change any of these under Settings, Catalog, Forms and People.
        </p>
      </details>
    </PageWrap>
  );
}
