import { useRef } from "react";
import { fixture } from "../config";
import { useSceneClock } from "../motion/use-scene-clock";
import { ArrivalCard, Avatar, Panel, Phone, Pill, SceneFrame } from "./primitives";

/**
 * Hero: the technician is marked "On the way" in the business view and the
 * customer's arrival page updates with the arrival window.
 * 0 assigned → 700 on the way → 1100 connector → 1500 customer updates →
 * 2200 one-time emphasis → 3000 settle → hold → loop.
 */
const MARKS = [700, 1100, 1500, 2200, 3000] as const;

export function HeroDispatchArrival() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: MARKS, total: 6000 });
  const s = clock.step;
  const { appointment: a, technician: t, customer: c, company } = fixture;

  return (
    <SceneFrame sceneRef={ref} clock={clock} className="scene--hero">
      <div className="scene__pair scene__pair--connected">
        <Panel title={<><strong>Appointments</strong> · Today</>} right={<span>Business view</span>}>
          <div className="hero-board">
          <ul className="hero-board__list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {fixture.list.map((r) => {
              const live = r.id === a.id && s >= 1 ? "on_the_way" : r.status;
              return (
                <li key={r.id} className="row row--compact" data-selected={r.id === a.id}>
                  <span className="row__time">{r.time}</span>
                  <span style={{ minWidth: 0 }}>
                    <div className="row__who">{r.who}</div>
                    <div className="row__what">{r.what}</div>
                  </span>
                  <span className="row__end">
                    <i className="dot" data-status={live} data-t="" aria-hidden="true" />
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="panel__body">
            <div className="panel__title">{a.title}</div>
            <div className="panel__meta">
              {c.name} · {a.address} · {a.scheduledFor}
            </div>
            <dl className="kv">
              <dt>Technician</dt>
              <dd style={{ display: "flex", alignItems: "center", gap: "0.5em" }}>
                <Avatar initials={t.initials} /> {t.name}
              </dd>
              <dt>Status</dt>
              <dd>
                <Pill status={s >= 1 ? "on_the_way" : "assigned"} />
              </dd>
              <dt>Arrival window</dt>
              <dd data-t="" style={{ color: s >= 1 ? "var(--ink)" : "var(--ink-muted)" }}>
                {s >= 1 ? a.window : "Calculated when the technician leaves"}
              </dd>
            </dl>
            <div style={{ marginTop: "1em", display: "flex", gap: "0.6em", alignItems: "center" }}>
              <span className="ui-btn ui-btn--solid" data-t="" data-pressed={s === 1} data-done={s >= 2}>
                {s >= 2 ? "On the way · sent" : "Mark on the way"}
              </span>
              <span className="small" style={{ fontSize: "0.8em" }}>
                Technician app
              </span>
            </div>
            <ul className="hist" style={{ listStyle: "none", padding: 0, margin: "0.9em 0 0" }}>
              <li>
                <time>10:02</time>
                <span>Assigned to {t.short}</span>
              </li>
              <li data-t="" data-show={s >= 5}>
                <time>10:31</time>
                <span>On the way · customer notified</span>
              </li>
            </ul>
          </div>
          </div>
        </Panel>

        <div className="connector" data-travel={s >= 2} aria-hidden="true" />

        <Phone company={company}>
          <ArrivalCard
            label={s >= 3 ? "Expected arrival" : "Scheduled visit"}
            window={a.scheduledFor}
            windowAlt={a.window}
            showAlt={s >= 3}
            techName={t.name}
            techInitials={t.initials}
            status={s >= 3 ? "on_the_way" : "assigned"}
            emph={s >= 4 && s < 5}
          />
          <div className="arrival__note" data-t="" data-show={s >= 3}>
            <b>{t.short.split(" ")[0]} is on the way.</b> You will get another update when they are close.
          </div>
        </Phone>
      </div>
    </SceneFrame>
  );
}
