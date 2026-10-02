import { useRef } from "react";
import { fixture, type ApptStatus } from "../config";
import { useSceneClock } from "../motion/use-scene-clock";
import { ArrivalCard, Avatar, Panel, Phone, Pill, SceneFrame } from "./primitives";

/** Appointment list in which one status changes and settles. */
export function ListStatusSettle() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: [900, 1700], total: 4600 });
  const s = clock.step;
  return (
    <SceneFrame sceneRef={ref} clock={clock} className="scene--compact">
      <Panel title={<strong>Today</strong>} right={<span>Live</span>}>
        <div className="list">
          {fixture.list.slice(0, 3).map((r, i) => {
            const isTarget = i === 0;
            const status: ApptStatus = isTarget && s >= 1 ? "on_the_way" : r.status;
            return (
              <div key={r.id} className="row" data-t="" data-emph={isTarget && s === 1} style={{ borderRadius: isTarget ? "0.4em" : undefined }}>
                <span className="row__time">{r.time}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="row__who">{r.who}</span>
                  <span className="row__what" style={{ display: "block" }}>
                    {r.what}
                  </span>
                </span>
                <span className="row__end">
                  {r.tech ? <Avatar initials={r.tech.split(" ").map((p) => p[0]).join("")} /> : <span className="row__empty">Unassigned</span>}
                  <Pill status={status} />
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </SceneFrame>
  );
}

/** Customer arrival card + message preview showing one coordinated update. */
export function CustomerCardUpdate() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: [900, 1800], total: 4800 });
  const s = clock.step;
  const { appointment: a, technician: t, company, messages } = fixture;
  return (
    <SceneFrame sceneRef={ref} clock={clock} className="scene--compact">
      <Phone company={company}>
        <ArrivalCard
          label="Expected arrival"
          window={a.window}
          windowAlt={a.windowLate}
          showAlt={s >= 1}
          techName={t.name}
          techInitials={t.initials}
          status={s >= 1 ? "late" : "on_the_way"}
          emph={s === 1}
        />
        <div className="arrival__note" data-t="" data-show={s >= 2}>
          <b>Update from {company}:</b> {messages.delay}
        </div>
      </Phone>
    </SceneFrame>
  );
}

/** Closing motif (dark surface): status moves scheduled → arrived, plays once. */
export function ClosingStatus() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: [500, 1100, 1700, 2300], total: 3200, loop: false, threshold: 0.3 });
  const s = clock.step;
  const steps = [
    { label: "Scheduled", time: "Mon 10:30" },
    { label: "Assigned to Alex R.", time: "10:02" },
    { label: "On the way · 10:40–10:55", time: "10:31" },
    { label: "Arrived", time: "10:46" },
  ];
  return (
    <SceneFrame sceneRef={ref} clock={clock} className="scene--compact scene--dark" loop={false}>
      <ol className="status-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {steps.map((st, i) => {
          const reached = s >= i + 1;
          const state = !reached ? "todo" : s === i + 1 && i < steps.length - 1 ? "active" : "done";
          return (
            <li key={st.label} className="status-step" data-t="" data-state={state}>
              <i aria-hidden="true" />
              <span>{st.label}</span>
              <time>{st.time}</time>
            </li>
          );
        })}
      </ol>
    </SceneFrame>
  );
}
