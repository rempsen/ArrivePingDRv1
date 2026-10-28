import type { BoardJob, BoardTech, DispatchCandidate } from "../data/types";
import { techRoute } from "../../../../shared/job-kind";
import { FIT_LABEL, firstName, jobSub, jobTitle, whenLabel } from "./format";

interface Common {
  tz: string;
  noun: string;
  workerNoun: string;
  onClose(): void;
}

export function TechInspector({
  tech,
  jobs,
  onSelectJob,
  onCenter,
  onOpenJob,
  onMessage,
  tz,
  noun,
  onClose,
}: Common & { tech: BoardTech; jobs: BoardJob[]; onSelectJob(id: string): void; onCenter(): void; onOpenJob(id: string): void; onMessage(mode: "sms" | "chat"): void }) {
  const route = techRoute(jobs, tech.id, Date.now());
  return (
    <aside tabIndex={-1} className="ap-panel ap-inspector ap-glass" aria-label={tech.name} data-drop-tech={tech.id} data-tech={tech.id}>
      <header className="ap-panel__head">
        <div>
          <h2>{tech.name}</h2>
          <p className="ap-muted">
            <span className="ap-dot" data-status={tech.status} /> {statusText(tech)}
            {tech.vehicle ? ` · ${tech.vehicle}` : ""}
          </p>
        </div>
        <button type="button" className="ap-btn ap-btn--icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ap-actions">
        {tech.phone && (
          <a className="ap-btn" href={`tel:${tech.phone}`}>
            Call
          </a>
        )}
        <button type="button" className="ap-btn" onClick={() => onMessage("chat")}>
          Message
        </button>
        {tech.phone && (
          <button type="button" className="ap-btn" onClick={() => onMessage("sms")}>
            Text
          </button>
        )}
        <button type="button" className="ap-btn" onClick={onCenter} disabled={tech.lat == null}>
          Center
        </button>
      </div>
      {tech.skills.length > 0 && <p className="ap-muted ap-skills">{tech.skills.join(" · ")}</p>}
      <h3 className="ap-sub">Today</h3>
      {route.length === 0 ? (
        <p className="ap-empty">Nothing assigned. Drop a {noun.toLowerCase()} here.</p>
      ) : (
        <ol className="ap-route">
          {route.map((j) => (
            <li key={j.id}>
              <button type="button" className="ap-row" onClick={() => onSelectJob(j.id)} onDoubleClick={() => onOpenJob(j.id)}>
                <span className="ap-row__title">{jobTitle(j, noun)}</span>
                <span className="ap-row__sub">{jobSub(j, tz)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="ap-hint">Drag an unassigned {noun.toLowerCase()} onto this panel to assign it.</p>
    </aside>
  );
}

function statusText(t: BoardTech): string {
  const s = t.status === "enroute" ? "En route" : t.status.charAt(0).toUpperCase() + t.status.slice(1);
  if (!t.stale || t.status === "offline" || !t.locationAt) return s;
  const mins = Math.round((Date.now() - new Date(t.locationAt).getTime()) / 60_000);
  return `${s} · location ${mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`} old`;
}

export function JobInspector({
  job,
  candidates,
  techName,
  holder,
  onAssign,
  onUnassign,
  onOpen,
  onSelectTech,
  tz,
  noun,
  workerNoun,
  onClose,
}: Common & {
  job: BoardJob;
  candidates: DispatchCandidate[];
  techName(id: string): string;
  holder: BoardTech | null;
  onAssign(techId: string): void;
  onUnassign(): void;
  onOpen(): void;
  onSelectTech(id: string): void;
}) {
  const directions = job.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}` : null;
  return (
    <aside tabIndex={-1} className="ap-panel ap-inspector ap-glass" aria-label={jobTitle(job, noun)}>
      <header className="ap-panel__head">
        <div>
          <h2
            data-drag-job={job.riderId ? undefined : job.id}
            data-drag-title={jobTitle(job, noun)}
            data-drag-sub={jobSub(job, tz)}
          >
            {jobTitle(job, noun)}
          </h2>
          <p className="ap-muted">
            {whenLabel(job.scheduledAt, tz)}
            {job.customerName ? ` · ${job.customerName}` : ""}
          </p>
          {job.address && <p className="ap-muted">{job.address}</p>}
        </div>
        <button type="button" className="ap-btn ap-btn--icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ap-actions">
        <button type="button" className="ap-btn" onClick={onOpen}>
          Open
        </button>
        {directions && (
          <a className="ap-btn" href={directions} target="_blank" rel="noreferrer noopener">
            Directions
          </a>
        )}
        {job.address && (
          <button type="button" className="ap-btn" onClick={() => void navigator.clipboard?.writeText(job.address)}>
            Copy address
          </button>
        )}
      </div>
      {job.riderId && holder ? (
        <>
          <h3 className="ap-sub">{job.assignStatus === "offered" ? "Offered to" : "Assigned to"}</h3>
          <button type="button" className="ap-row" onClick={() => onSelectTech(holder.id)}>
            <span className="ap-row__title">{holder.name}</span>
          </button>
          {job.assignStatus === "offered" && (
            <button type="button" className="ap-btn" onClick={onUnassign}>
              Unassign
            </button>
          )}
        </>
      ) : (
        <>
          <h3 className="ap-sub">Assign to a {workerNoun.toLowerCase()}</h3>
          {candidates.length === 0 ? (
            <p className="ap-empty">Finding the best match…</p>
          ) : (
            <ul className="ap-cands">
              {candidates.slice(0, 6).map((c) => (
                <li key={c.techId}>
                  <div className="ap-cand" data-fit={c.fit} data-best={c.best ? "" : undefined}>
                    <div className="ap-cand__main">
                      <span className="ap-row__title">
                        {firstName(techName(c.techId))}
                        {c.best && <span className="ap-chip ap-chip--best">Best match</span>}
                      </span>
                      <span className="ap-row__sub">{c.reason || FIT_LABEL[c.fit]}</span>
                    </div>
                    <button type="button" className={c.fit === "ready" ? "ap-btn ap-btn--primary" : "ap-btn"} onClick={() => onAssign(c.techId)}>
                      Assign
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="ap-hint">Or drag this {noun.toLowerCase()} onto a {workerNoun.toLowerCase()}.</p>
        </>
      )}
    </aside>
  );
}
