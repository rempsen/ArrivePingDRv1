import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../motion/playback";

/**
 * ArrivePing → your system, as it really happens: a job event leaves
 * ArrivePing, your endpoint receives the webhook (the readout types the real
 * payload shape from services/dispatch.ts), answers 200, and the next event
 * follows. Decorative (aria-hidden by the caller); the copy beside it says the
 * same thing in words.
 *
 * Packets move with CSS (paused by [data-play="off"] like every live section);
 * a light JS clock, running only while `play` is on, drives which event is
 * current and how much of the payload has been typed. Reduced motion shows one
 * settled frame.
 */

type Ev = { chip: string; event: string; extra: [string, string] };
const EVENTS: Ev[] = [
  { chip: "Job created", event: "created", extra: ["service", "Furnace tune-up"] },
  { chip: "Technician on the way", event: "enroute", extra: ["tech", "Jordan"] },
  { chip: "Arrived", event: "arrived", extra: ["tech", "Jordan"] },
  { chip: "Completed", event: "completed", extra: ["status", "completed"] },
];

// One event's timeline (ms): packet out, payload typed on arrival, 200 back.
const OUT = 900;
const TYPE_END = 1800;
const ACK = 2500;
const STEP = 3600;
const IDS = ["7F3A2C", "B81E04", "4C9D17", "E25A90"];

function payload(e: Ev, id: string): string {
  return `{ "event": "${e.event}", "shortId": "${id}", "${e.extra[0]}": "${e.extra[1]}" }`;
}

export function IntegrationTrace({ play }: { play: "on" | "off" }) {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ step: 0, t: 0, run: 0 });
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (reduced || play !== "on") {
      last.current = null;
      return;
    }
    const id = window.setInterval(() => {
      const now = performance.now();
      // Real elapsed time, so a main-thread stall doesn't put the readout behind
      // the CSS packets. Pausing stops this interval and clears `last`, so a
      // resume starts from zero rather than counting the pause.
      const dt = last.current == null ? 0 : now - last.current;
      last.current = now;
      setState((s) => {
        const t = s.t + dt;
        if (t < STEP) return { ...s, t };
        const step = (s.step + 1) % EVENTS.length;
        return { step, t: 0, run: s.run + 1 };
      });
    }, 40);
    return () => window.clearInterval(id);
  }, [play, reduced]);

  // Settled frame for reduced motion: "on the way" delivered and acknowledged.
  const { step, t, run } = reduced ? { step: 1, t: STEP - 1, run: 0 } : state;
  const ev = EVENTS[step]!;
  const shortId = IDS[run % IDS.length]!;
  const body = payload(ev, shortId);
  const typed = t < OUT ? 0 : Math.min(body.length, Math.ceil(((t - OUT) / (TYPE_END - OUT)) * body.length));
  const delivered = t >= OUT;
  const acked = t >= ACK;
  // A small, plausible spread so it reads as live traffic rather than a loop.
  const ms = 62 + ((run * 37) % 58);

  return (
    <div className="ap-trace" data-phase={acked ? "ack" : delivered ? "in" : "out"}>
      <div className="ap-int__node ap-int__node--ap">
        <span className="ap-int__dot" />
        ArrivePing
      </div>
      <div className="ap-int__wire">
        {!reduced && (
          <>
            <span key={`o${run}`} className="ap-trace__pkt ap-trace__pkt--out" />
            <span key={`b${run}`} className="ap-trace__pkt ap-trace__pkt--back" />
          </>
        )}
      </div>
      <div className="ap-int__node ap-int__node--yours ap-trace__yours">Your system</div>

      <div className="ap-int__events">
        {EVENTS.map((e, i) => (
          <span key={e.event} data-on={i === step && delivered ? "true" : undefined} data-done={i < step ? "true" : undefined}>
            {e.chip}
          </span>
        ))}
      </div>

      <div className="ap-trace__log">
        <div className="ap-trace__req">
          <span className="ap-trace__verb">POST</span> your-system/webhooks/arriveping
          <span className="ap-trace__hdr"> · X-Webhook-Secret</span>
        </div>
        <div className="ap-trace__body">
          {body.slice(0, typed)}
          {delivered && !acked && <span className="ap-trace__caret" />}
          {/* holds the line height so the card doesn't jump while typing */}
          <span className="ap-trace__ghost">{body.slice(typed)}</span>
        </div>
        <div className="ap-trace__res" data-on={acked ? "true" : undefined}>
          ← 200 OK · {ms} ms
        </div>
      </div>
    </div>
  );
}
