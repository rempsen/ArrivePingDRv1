/**
 * Shared building blocks for the illustrative demo scenes.
 * Scenes are decorative (aria-hidden) — the accessible summary lives on the
 * <MediaSlot> figure. Controls are real buttons and stay reachable.
 */
import type { ReactNode, RefObject } from "react";
import { illustrativeLabel, statusLabel, type ApptStatus } from "../config";
import type { SceneClock } from "../motion/use-scene-clock";
import { usePlayback } from "../motion/playback";

export function SceneFrame({
  sceneRef,
  clock,
  className = "",
  children,
  loop = true,
}: {
  sceneRef: RefObject<HTMLDivElement | null>;
  clock: SceneClock;
  className?: string;
  children: ReactNode;
  loop?: boolean;
}) {
  const { paused, toggle, reduced } = usePlayback();
  return (
    <div ref={sceneRef} className={`scene ${className}`.trim()} data-step={clock.step} data-cycle={clock.cycle}>
      <div className="scene__inner" key={clock.cycle} aria-hidden="true">
        {children}
      </div>
      <span className="slot__label">{illustrativeLabel}</span>
      <div className="slot__controls">
        {reduced ? (
          <>
            <button type="button" className="btn btn--secondary btn--sm" onClick={clock.prev} disabled={clock.step === 0} aria-label="Previous step">
              Prev
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={clock.next} disabled={clock.settled} aria-label="Next step">
              Next
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--secondary btn--sm" onClick={clock.restart} aria-label="Replay demo">
              Replay
            </button>
            {loop && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={toggle} aria-pressed={paused} aria-label={paused ? "Resume demo" : "Pause demo"}>
                {paused ? "Resume" : "Pause"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Pill({ status, label, compact = false }: { status: ApptStatus | "late"; label?: string; compact?: boolean }) {
  return (
    <span className={compact ? "pill pill--compact" : "pill"} data-status={status} data-t="">
      {label ?? (status === "late" ? "Running late" : statusLabel[status])}
    </span>
  );
}

export function Avatar({ initials, accent = false }: { initials: string; accent?: boolean }) {
  return <span className={`avatar${accent ? " avatar--accent" : ""}`}>{initials}</span>;
}

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel ${className}`.trim()}>
      <div className="panel__bar">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Customer arrival page framed as a phone. */
export function Phone({
  company,
  children,
  toast,
}: {
  company: string;
  children: ReactNode;
  toast?: ReactNode;
}) {
  return (
    <div className="phone">
      <div className="phone__screen">
        {toast}
        <div className="phone__status">
          <span>10:31</span>
          <span>●●●</span>
        </div>
        <div className="phone__brand">
          <i aria-hidden="true" /> {company}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ArrivalCard({
  label,
  window,
  windowAlt,
  showAlt = false,
  techName,
  techInitials,
  status,
  emph = false,
}: {
  label: string;
  window: string;
  windowAlt?: string;
  showAlt?: boolean;
  techName: string;
  techInitials: string;
  status: ApptStatus | "late";
  emph?: boolean;
}) {
  return (
    <div className="arrival" data-t="" data-emph={emph}>
      <div className="arrival__label">{label}</div>
      <div className="arrival__window">
        <span data-t="" data-show={!showAlt}>
          {window}
        </span>
        {windowAlt && (
          <span data-t="" data-show={showAlt}>
            {windowAlt}
          </span>
        )}
      </div>
      <div className="arrival__tech">
        <Avatar initials={techInitials} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div>{techName}</div>
          <small>Your technician</small>
        </div>
        <Pill status={status} />
      </div>
    </div>
  );
}

export function Toast({ show, title, body }: { show: boolean; title: string; body: string }) {
  return (
    <div className="toast" data-t="" data-show={show}>
      <i aria-hidden="true" />
      <div>
        <b>{title}</b>
        <span>{body}</span>
      </div>
    </div>
  );
}
