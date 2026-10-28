import { useEffect, useState } from "react";
import type { BoardJob, BoardTech } from "../data/types";
import { jobTitle, whenLabel } from "./format";

interface Props {
  tech: BoardTech | null;
  anchor: HTMLElement | null;
  jobs: BoardJob[];
  tz: string;
  noun: string;
}

const STATUS: Record<string, string> = { available: "Available", enroute: "En route", onsite: "On site", busy: "Busy", break: "On break", offline: "Offline" };

function ago(iso: string | null): string {
  if (!iso) return "no location yet";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** A small card beside a technician on hover: what they're doing now and next. Mouse only. */
export function HoverPeek({ tech, anchor, jobs, tz, noun }: Props) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!tech || !anchor) return;
    const t = setTimeout(() => setShown(true), 280); // no flicker while crossing markers
    return () => clearTimeout(t);
  }, [tech, anchor]);
  if (!tech || !anchor || !shown || !anchor.isConnected) return null;

  const r = anchor.getBoundingClientRect();
  const cur = tech.currentJobId ? jobs.find((j) => j.id === tech.currentJobId) : null;
  const next = tech.nextJobIds.map((id) => jobs.find((j) => j.id === id)).find(Boolean) ?? null;
  const above = r.top > 150;
  const left = Math.max(12, Math.min(window.innerWidth - 252, r.left + r.width / 2 - 120));
  const style = above ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 };

  return (
    <div className="ap-peek ap-glass" style={style} role="presentation">
      <strong>{tech.name}</strong>
      <span className="ap-peek__line">
        <span className="ap-dot" data-status={tech.status} /> {STATUS[tech.status] ?? tech.status}
        {/* The age of the GPS fix, not of the app's last check-in: a phone can
            be online with an old position. */}
        {tech.status !== "offline" && (tech.locationAt ? ` · location ${ago(tech.locationAt)}` : " · no location yet")}
      </span>
      {cur && <span className="ap-peek__line">Now: {jobTitle(cur, noun)}</span>}
      {next && (
        <span className="ap-peek__line">
          Next: {jobTitle(next, noun)} · {whenLabel(next.scheduledAt, tz)}
        </span>
      )}
      {!cur && !next && <span className="ap-peek__line">Nothing assigned</span>}
    </div>
  );
}
