import { useRef } from "react";
import { fixture } from "../config";
import { useSceneClock } from "../motion/use-scene-clock";
import { ArrivalCard, Panel, Phone, SceneFrame, Toast } from "./primitives";

/**
 * Office → customer update: a quick-pick chip fills a short delay message,
 * it is sent, and the customer's notification + arrival window change together.
 * 600 chip → 1200 message → 1800 send → 2300 customer updates → 3000 settle.
 */
const MARKS = [600, 1200, 1800, 2300, 3000] as const;

export function UpdateToCustomer() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useSceneClock(ref, { marks: MARKS, total: 6200 });
  const s = clock.step;
  const { appointment: a, technician: t, customer: c, company, messages } = fixture;

  return (
    <SceneFrame sceneRef={ref} clock={clock}>
      <div className="scene__pair">
        <Panel title={<><strong>{a.title}</strong> · {c.name}</>} right={<span>Send update</span>}>
          <div className="panel__body composer">
            <div className="chips">
              <span className="chip" data-t="" data-active={s >= 1}>
                Running 10 min late
              </span>
              <span className="chip">Arriving earlier</span>
              <span className="chip">Need to reschedule</span>
            </div>
            <div className="textarea" data-t="" data-focus={s >= 1 && s < 3}>
              <span className="stack">
                <span className="textarea__ph" data-t="" data-show={s < 2}>
                  Write a short update for {c.short}…
                </span>
                <span data-t="" data-show={s >= 2}>
                  {messages.delay}
                </span>
              </span>
            </div>
            <div className="composer__foot">
              <span>Sent by text and email with the live link</span>
              <span className="stack">
                <span className="ui-btn ui-btn--solid" data-t="" data-show={s < 4} data-pressed={s === 3}>
                  Send
                </span>
                <span className="sent" data-t="" data-show={s >= 4}>
                  ✓ Sent 10:36
                </span>
              </span>
            </div>
            <ul className="hist" style={{ listStyle: "none", padding: 0, margin: "0.2em 0 0" }}>
              <li>
                <time>10:31</time>
                <span>On the way · window {a.window}</span>
              </li>
              <li data-t="" data-show={s >= 5}>
                <time>10:36</time>
                <span>Delay sent · new window {a.windowLate}</span>
              </li>
            </ul>
          </div>
        </Panel>

        <Phone company={company} toast={<Toast show={s >= 4 && s < 5} title={company} body={messages.delay} />}>
          <ArrivalCard
            label="Expected arrival"
            window={a.window}
            windowAlt={a.windowLate}
            showAlt={s >= 4}
            techName={t.name}
            techInitials={t.initials}
            status={s >= 4 ? "late" : "on_the_way"}
            emph={s === 4}
          />
          <div className="arrival__note" data-t="" data-show={s >= 4}>
            <b>Update from {company}:</b> {messages.delay}
          </div>
        </Phone>
      </div>
    </SceneFrame>
  );
}
