/**
 * Control Hub → Help questions: what people asked Ask ArrivePing (Help
 * Center, office app, technician app), and above all what it couldn't
 * answer: handed to support, a thumbs down, or a failed answer. Grouped by
 * the screen the question was about, so support knows which help to write
 * next. Nothing here says who asked.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { Card, Segmented, Skeleton, Stat, downloadCsv, fmt, selectCls } from "../analytics-ui";
import { HubLayout, EmptyNote } from "./hub-ui";
import { hub } from "./hub-data";
import { filterQuestions, gapTopics, helpStats, isGap, matchLabel, matchedIds, PLATFORM_LABEL, SOURCE_LABEL, type HelpQuestion } from "./help-gaps";

const DAYS = [7, 30, 90] as const;

export default function HubHelpQuestions() {
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [view, setView] = useState<"gaps" | "all">("gaps");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["hub", "help-questions", days],
    queryFn: () => hub<{ days: number; questions: HelpQuestion[] }>(`/help-questions?days=${days}`),
  });
  const all = useMemo(() => q.data?.questions ?? [], [q.data]);
  const stats = useMemo(() => helpStats(all), [all]);
  const topics = useMemo(() => gapTopics(all), [all]);
  const rows = useMemo(() => filterQuestions(all, { onlyGaps: view === "gaps", source, search }), [all, view, source, search]);

  return (
    <HubLayout
      title="Help questions"
      subtitle="What people ask Ask ArrivePing, and what it couldn't answer. Write the missing help, then watch the gaps shrink."
      actions={
        <button
          type="button"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `ask-arriveping-${view}-${new Date().toISOString().slice(0, 10)}.csv`,
              rows.map((r) => ({
                when: r.createdAt,
                where: SOURCE_LABEL[r.source] ?? r.source,
                platform: PLATFORM_LABEL[r.platform] ?? r.platform,
                question: r.question,
                handed_to_support: r.handedOff ? "yes" : "",
                rating: r.rating > 0 ? "helpful" : r.rating < 0 ? "not helpful" : "",
                failed: r.failed ? "yes" : "",
                matched: matchedIds(r).map(matchLabel).join("; "),
              })),
            )
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[13px] font-semibold text-slate-200 hover:bg-white/[0.05] disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          CSV
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Period" value={String(days)} onChange={(v) => setDays(Number(v) as (typeof DAYS)[number])} options={DAYS.map((d) => ({ value: String(d), label: `${d} days` }))} />
      </div>

      {q.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : q.isError ? (
        <EmptyNote>{(q.error as Error).message}</EmptyNote>
      ) : (
        <>
          <Card pad={false} className="mb-6">
            <div className="grid grid-cols-2 divide-white/[0.05] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
              <Stat label="Questions asked" value={fmt.int(stats.asked)} />
              <Stat label="Answered without us" value={fmt.pct(stats.selfServed)} hint="Not handed to support, no thumbs down, no failure" />
              <Stat label="Handed to support" value={fmt.int(stats.handedOff)} />
              <Stat label="Thumbs down" value={fmt.int(stats.thumbsDown)} />
              <Stat label="Thumbs up" value={fmt.int(stats.thumbsUp)} />
              <Stat label="Failed answers" value={fmt.int(stats.failed)} hint="The AI service errored" />
            </div>
          </Card>

          {topics.length > 0 && (
            <Card title="Where the help falls short" caption="Unanswered questions, grouped by the screen they were about. Biggest first." className="mb-6">
              <ul className="grid gap-3 md:grid-cols-2">
                {topics.map((t) => (
                  <li key={t.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[14px] font-semibold text-slate-100">{t.label}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-amber-300">{t.count}</span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {t.examples.map((e, i) => (
                        <li key={i} className="truncate text-[12px] text-slate-400">
                          “{e}”
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              ariaLabel="Which questions"
              value={view}
              onChange={setView}
              options={[
                { value: "gaps", label: `Unanswered (${fmt.int(stats.gaps)})` },
                { value: "all", label: `All (${fmt.int(stats.asked)})` },
              ]}
            />
            <select aria-label="Where it was asked" value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
              <option value="">Everywhere</option>
              {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className="relative min-w-[12rem] flex-1">
              <span className="sr-only">Search questions</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input aria-label="Search questions" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className={`${selectCls} w-full pl-8`} />
            </label>
          </div>

          {rows.length === 0 ? (
            <EmptyNote>{view === "gaps" && !all.length ? "No questions yet in this period." : view === "gaps" ? "Every question in this period was answered." : "Nothing matches."}</EmptyNote>
          ) : (
            <Card pad={false}>
              <ol className="divide-y divide-white/[0.05]">
                {rows.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-[13px]">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="w-24 shrink-0 text-[12px] text-slate-500">{fmt.ago(r.createdAt)}</span>
                      <span className="min-w-0 flex-1 font-medium text-slate-100">{r.question}</span>
                      <span className="flex shrink-0 flex-wrap gap-1.5">
                        {r.handedOff && <Chip cls="border-amber-400/30 bg-amber-400/10 text-amber-200">Sent to support</Chip>}
                        {r.rating < 0 && <Chip cls="border-rose-400/30 bg-rose-400/10 text-rose-200">Not helpful</Chip>}
                        {r.rating > 0 && <Chip cls="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">Helpful</Chip>}
                        {r.failed && <Chip cls="border-rose-400/30 bg-rose-400/10 text-rose-200">Failed</Chip>}
                        {!isGap(r) && r.rating === 0 && <Chip cls="border-white/10 text-slate-400">Answered</Chip>}
                      </span>
                    </div>
                    <p className="mt-1 pl-0 text-[12px] text-slate-500 sm:pl-[6.75rem]">
                      {SOURCE_LABEL[r.source] ?? r.source}
                      {r.platform ? ` · ${PLATFORM_LABEL[r.platform] ?? r.platform}` : ""}
                      {matchedIds(r).length ? ` · drew on ${matchedIds(r).slice(0, 3).map(matchLabel).join(", ")}` : " · no help matched"}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </>
      )}
    </HubLayout>
  );
}

function Chip({ cls, children }: { cls: string; children: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}
