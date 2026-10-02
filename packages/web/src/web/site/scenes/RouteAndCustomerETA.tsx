import { useLayoutEffect, useRef, useState } from "react";
import { fixture } from "../config";
import { useSceneClock } from "../motion/use-scene-clock";
import { ArrivalCard, Phone, Pill, SceneFrame, Toast } from "./primitives";

/**
 * Arrival tracking: a marker advances along an abstract route while the
 * customer's arrival page updates in sync. Not a map — a stylised path.
 * 500 leave → 1500 midway → 2600 arriving soon → 3400 arrived (geofence).
 */
const MARKS = [500, 1500, 2600, 3400] as const;
const PROGRESS = [0, 0.3, 0.68, 0.9, 1] as const;
const PATH = "M 26 164 C 60 164, 84 64, 150 76 S 232 150, 294 44";

export function RouteAndCustomerETA() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: MARKS, total: 6800 });
  const s = clock.step;
  const p = PROGRESS[Math.min(s, PROGRESS.length - 1)];
  const { appointment: a, technician: t, company } = fixture;

  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(400);
  const [pt, setPt] = useState({ x: 26, y: 164 });
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const L = el.getTotalLength();
    setLen(L);
    const q = el.getPointAtLength(L * p);
    setPt({ x: q.x, y: q.y });
  }, [p]);

  const status = s >= 4 ? "arrived" : s >= 3 ? "arriving" : s >= 1 ? "on_the_way" : "assigned";

  return (
    <SceneFrame sceneRef={ref} clock={clock}>
      <div className="scene__pair">
        <div className="route-card">
          <div className="route-card__head">
            <b>{t.name}</b>
            <Pill status={status} />
          </div>
          <svg className="route" viewBox="0 0 320 200" role="presentation">
            <circle className="route__fence" cx="294" cy="44" r="22" />
            <path className="route__path" d={PATH} />
            <path
              ref={pathRef}
              className="route__done"
              d={PATH}
              strokeDasharray={len}
              strokeDashoffset={len * (1 - p)}
            />
            <g transform="translate(26 164)">
              <circle className="route__pin route__pin--home" r="5" />
              <text className="route__text" x="-14" y="22">
                Depot
              </text>
            </g>
            <g transform="translate(294 44)">
              <circle className="route__pin" r="5" />
              <text className="route__text" x="-10" y="-13" textAnchor="end">
                {a.address}
              </text>
            </g>
            <g className="route__marker" style={{ transform: `translate(${pt.x}px, ${pt.y}px)` }}>
              <circle className={`route__van${s >= 4 ? " route__van--arrived" : ""}`} r="7" />
            </g>
          </svg>
          <ul className="hist" style={{ listStyle: "none", padding: 0, margin: "0.4em 0 0" }}>
            <li>
              <time>10:31</time>
              <span>Left depot · window {a.window}</span>
            </li>
            <li data-t="" data-show={s >= 3}>
              <time>10:41</time>
              <span>Arriving soon · customer notified</span>
            </li>
            <li data-t="" data-show={s >= 4}>
              <time>10:46</time>
              <span>Arrived on site · confirmed by geofence</span>
            </li>
          </ul>
        </div>

        <Phone company={company} toast={<Toast show={s === 3} title="Arriving soon" body={`${t.short.split(" ")[0]} is a few minutes away.`} />}>
          <ArrivalCard
            label={s >= 4 ? "Arrived" : "Expected arrival"}
            window={a.window}
            windowAlt="10:46"
            showAlt={s >= 4}
            techName={t.name}
            techInitials={t.initials}
            status={status}
            emph={s === 4}
          />
          <div className="stack" style={{ margin: "0 0.9em 0.9em" }}>
            <div className="arrival__note" data-t="" data-show={s >= 1 && s < 4} style={{ margin: 0 }}>
              Location is shared with you only while {t.short.split(" ")[0]} is travelling to your appointment.
            </div>
            <div className="arrival__note" data-t="" data-show={s >= 4} style={{ margin: 0 }}>
              <b>{fixture.messages.arrived}</b> Location sharing has stopped.
            </div>
          </div>
        </Phone>
      </div>
    </SceneFrame>
  );
}
