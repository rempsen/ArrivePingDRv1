import type { BoardJob, DispatchCandidate } from "../data/types";
import { jobKind } from "../../../../shared/job-kind";
import { firstName, jobSub, jobTitle, PRIORITY_COLOR } from "./format";

interface Props {
  jobs: BoardJob[];
  tz: string;
  noun: string;
  nounPlural: string;
  workerNoun: string;
  selectedId: string | null;
  candidates: Record<string, DispatchCandidate[]>;
  techName(id: string): string;
  onSelect(id: string): void;
  onHover(id: string | null): void;
}

export function QueuePanel({ jobs, tz, noun, nounPlural, workerNoun, selectedId, candidates, techName, onSelect, onHover }: Props) {
  const now = Date.now();
  return (
    <section className="ap-panel ap-queue ap-glass" aria-label={`Unassigned ${nounPlural.toLowerCase()}`}>
      <header className="ap-panel__head">
        <h2>Unassigned</h2>
        <span className="ap-count tnum">{jobs.length}</span>
      </header>
      {jobs.length === 0 ? (
        <p className="ap-empty">Everything is assigned.</p>
      ) : (
        <ul className="ap-queue__list">
          {jobs.map((j) => {
            const best = candidates[j.id]?.find((c) => c.best);
            const late = jobKind(j, now) === "late";
            return (
              <li key={j.id}>
                <button
                  type="button"
                  className="ap-card"
                  data-selected={selectedId === j.id ? "" : undefined}
                  data-drag-job={j.id}
                  data-drag-title={jobTitle(j, noun)}
                  data-drag-sub={jobSub(j, tz)}
                  data-job={j.id}
                  aria-label={`${jobTitle(j, noun)}. ${jobSub(j, tz)}. Press Enter to choose a ${workerNoun.toLowerCase()}.`}
                  onClick={() => onSelect(j.id)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && onHover(j.id)}
                  onPointerLeave={() => onHover(null)}
                >
                  <span className="ap-card__bar" style={{ background: PRIORITY_COLOR[j.priority] ?? PRIORITY_COLOR.normal }} />
                  <span className="ap-card__body">
                    <span className="ap-card__title">
                      {jobTitle(j, noun)}
                      {late && <span className="ap-chip ap-chip--late">Late</span>}
                    </span>
                    <span className="ap-card__sub">{jobSub(j, tz)}</span>
                    {best && (
                      <span className="ap-card__best">
                        Best match <strong>{firstName(techName(best.techId))}</strong>
                        {best.etaMins != null ? ` · ${best.etaMins} min away` : ""}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
