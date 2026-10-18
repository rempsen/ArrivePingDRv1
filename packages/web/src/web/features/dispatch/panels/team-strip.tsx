import { forwardRef } from "react";
import type { BoardTech } from "../data/types";
import type { DragFit } from "../map/tech-markers";
import { statusColor } from "../map/tech-markers";
import { firstName } from "./format";

interface Props {
  techs: BoardTech[];
  selectedId: string | null;
  fits: Record<string, DragFit> | null;
  targetId: string | null;
  jobNoun: string;
  onSelect(id: string): void;
}

const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

export const TeamStrip = forwardRef<HTMLUListElement, Props>(function TeamStrip({ techs, selectedId, fits, targetId, jobNoun, onSelect }, ref) {
  return (
    <ul ref={ref} className="ap-strip ap-glass" aria-label="Team">
      {techs.map((t) => {
        const f = fits?.[t.id];
        return (
          <li key={t.id}>
          <button
            type="button"
            className="ap-chipbtn"
            data-drop-tech={t.id}
            data-tech={t.id}
            data-selected={selectedId === t.id ? "" : undefined}
            data-status={t.status}
            data-fit={f?.fit}
            data-best={f?.best ? "" : undefined}
            data-over={targetId === t.id ? "" : undefined}
            onClick={() => onSelect(t.id)}
          >
            <span className="ap-chipbtn__face" style={{ boxShadow: `0 0 0 2px ${statusColor(t.status)}` }}>
              {t.photoUrl ? <img src={t.photoUrl} alt="" draggable={false} /> : initials(t.name)}
            </span>
            <span className="ap-chipbtn__text">
              <span className="ap-chipbtn__name">{firstName(t.name)}</span>
              <span className="ap-chipbtn__meta tnum">{f ? f.chip : `${t.openJobs} ${t.openJobs === 1 ? jobNoun.toLowerCase() : jobNoun.toLowerCase() + "s"}`}</span>
            </span>
          </button>
          </li>
        );
      })}
    </ul>
  );
});
