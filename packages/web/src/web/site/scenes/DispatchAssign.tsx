import { useRef } from "react";
import { fixture, type ApptStatus } from "../config";
import { useSceneClock } from "../motion/use-scene-clock";
import { Avatar, Panel, Pill, SceneFrame } from "./primitives";

/**
 * Dispatch board: an unassigned row is selected, its detail opens, a
 * technician is chosen and the row's status settles to "Assigned".
 * 600 select → 1100 detail → 1700 picker → 2300 assign → 3000 settle.
 */
const MARKS = [600, 1100, 1700, 2300, 3000] as const;
const TARGET = "ap-1043";

export function DispatchAssign() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: MARKS, total: 6000 });
  const s = clock.step;
  const { technician: t1, technician2: t2 } = fixture;
  const target = fixture.list.find((r) => r.id === TARGET)!;

  return (
    <SceneFrame sceneRef={ref} clock={clock}>
      <div className="scene__pair">
        <Panel title={<><strong>Dispatch board</strong> · Today</>} right={<span>{fixture.list.length} appointments</span>}>
          <div className="list">
            {fixture.list.map((r) => {
              const isTarget = r.id === TARGET;
              const status: ApptStatus = isTarget && s >= 4 ? "assigned" : r.status;
              const tech = isTarget ? (s >= 4 ? t2.short : "") : r.tech;
              return (
                <div key={r.id} className="row" data-t="" data-selected={isTarget && s >= 1}>
                  <span className="row__time">{r.time}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="row__who">{r.who}</span>
                    <span className="row__what" style={{ display: "block" }}>
                      {r.what}
                    </span>
                  </span>
                  <span className="row__end">
                    {tech ? (
                      <span data-t="" data-emph={isTarget && s === 4} style={{ borderRadius: "999px" }}>
                        <Avatar initials={tech.split(" ").map((p) => p[0]).join("")} />
                      </span>
                    ) : (
                      <span className="row__empty">Unassigned</span>
                    )}
                    <Pill status={status} />
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <div data-t="" data-show={s >= 2}>
          <Panel title={<strong>{target.what}</strong>} right={<span>{target.time} today</span>}>
            <div className="panel__body">
              <div className="panel__meta">{target.who} · 18 Quay Street</div>
              <dl className="kv">
                <dt>Technician</dt>
                <dd>
                  <div className="chips" style={{ marginTop: "0.1em" }}>
                    <span className="chip" data-t="" data-active={false}>
                      {t1.short}
                    </span>
                    <span className="chip" data-t="" data-active={s >= 4}>
                      {t2.short}
                    </span>
                    <span className="chip" data-t="" style={{ opacity: s >= 3 ? 1 : 0.5 }}>
                      Anyone available
                    </span>
                  </div>
                </dd>
                <dt>Status</dt>
                <dd>
                  <Pill status={s >= 4 ? "assigned" : "scheduled"} />
                </dd>
              </dl>
              <div style={{ marginTop: "1em", display: "flex", gap: "0.6em", alignItems: "center" }}>
                <span className="ui-btn ui-btn--solid" data-t="" data-pressed={s === 3} data-done={s >= 4}>
                  {s >= 4 ? "Assigned to " + t2.short : "Assign technician"}
                </span>
                <span className="sent" data-t="" data-show={s >= 5} style={{ fontSize: "0.8em" }}>
                  ✓ Technician notified
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </SceneFrame>
  );
}
