import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { LiveTripGeometry } from "../live-trip-geometry";

/**
 * Live technician on the customer arrival map.
 *
 * Sits on top of a real app recording (same pixel grid as the video, so it
 * scales with `object-fit: contain`). A patch image erases the baked route,
 * van and ETA texts; this layer redraws them and drives the van along the
 * street route at a realistic speed:
 *
 *  - route length is ~500 m (the map shows roughly 400 m across)
 *  - cruise 40 km/h, accelerate 1.6 m/s², brake 2 m/s², ~16 km/h through turns,
 *    and a full stop at the door
 *  - minutes, distance and arrival time are computed from what is left of the
 *    route (routing-engine style average of 26 km/h including lights)
 *
 * "clock" geometries run on elapsed viewing time (no loop seam — the van keeps
 * driving while the video loops underneath). "video" geometries are tied to
 * video.currentTime for one-shot clips (the closing shot's final approach).
 */

const ROUTE_M = 500; // metres along the drawn route
const EFF_MPS = 7.2; // ETA average incl. lights and stops
const VMAX = 11.1; // 40 km/h
const ACCEL = 1.6;
const DECEL = 2.0;
const V_CORNER = 4.5; // ~16 km/h through a turn
const SIM_HZ = 20;
const CLOCK_START = 21 * 3600 + 9 * 60 + 20; // matches the 9:09 status bar in the recordings
const HOLD_AFTER_ARRIVAL = 4; // seconds parked at the door before the next trip starts
const FONT = "var(--font-body, 'Inter Variable', Inter, system-ui, sans-serif)";

type Track = { pts: [number, number][]; cum: number[]; lenPx: number; mPerPx: number; cornersM: number[] };

function buildTrack(route: [number, number][]): Track {
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const lenPx = cum[cum.length - 1];
  const mPerPx = ROUTE_M / lenPx;
  const cornersM: number[] = [];
  for (let i = 1; i < route.length - 1; i++) {
    const a = Math.atan2(route[i][1] - route[i - 1][1], route[i][0] - route[i - 1][0]);
    const b = Math.atan2(route[i + 1][1] - route[i][1], route[i + 1][0] - route[i][0]);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.6) cornersM.push(cum[i] * mPerPx);
  }
  return { pts: route, cum, lenPx, mPerPx, cornersM };
}

function pointAt(t: Track, px: number): [number, number] {
  const d = Math.max(0, Math.min(t.lenPx, px));
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < d) i++;
  const seg = t.cum[i] - t.cum[i - 1] || 1;
  const f = (d - t.cum[i - 1]) / seg;
  const a = t.pts[i - 1];
  const b = t.pts[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Distance travelled (m) sampled at SIM_HZ from rest-or-cruise to a stop at the door. */
function simulate(t: Track, v0: number): Float32Array {
  const out: number[] = [];
  let d = 0;
  let v = v0;
  const dt = 1 / SIM_HZ;
  for (let k = 0; k < SIM_HZ * 600; k++) {
    out.push(d);
    let lim = VMAX;
    for (const c of t.cornersM) if (c > d) lim = Math.min(lim, Math.sqrt(V_CORNER * V_CORNER + 2 * DECEL * (c - d)));
    lim = Math.min(lim, Math.sqrt(Math.max(0, 2 * DECEL * (ROUTE_M - d))));
    v = v < lim ? Math.min(lim, v + ACCEL * dt) : Math.max(lim, v - DECEL * 1.5 * dt);
    d = Math.min(ROUTE_M, d + v * dt);
    if (ROUTE_M - d < 0.05 && v < 0.05) {
      out.push(ROUTE_M);
      break;
    }
  }
  return Float32Array.from(out);
}

function clockLabel(sec: number): string {
  const m = Math.floor(sec / 60);
  const h24 = Math.floor(m / 60) % 24;
  const h = h24 % 12 || 12;
  return `~${h}:${String(m % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

function rampOpacity(fades: LiveTripGeometry["fades"], t: number): number {
  let o = 1;
  for (const [a, b, from, to] of fades) {
    if (t < a && from < to) o = Math.min(o, from);
    else if (t >= a && t <= b) o = Math.min(o, from + (to - from) * ((t - a) / (b - a || 1)));
    else if (t > b && to < from) o = Math.min(o, to);
  }
  return Math.max(0, Math.min(1, o));
}

export function LiveTripOverlay({ geo, videoRef, playing }: { geo: LiveTripGeometry; videoRef: RefObject<HTMLVideoElement | null>; playing: boolean }) {
  const track = useMemo(() => buildTrack(geo.route), [geo]);
  const trip = useMemo(() => simulate(track, geo.mode === "video" ? 0 : 9), [track, geo.mode]);
  const tripSec = trip.length / SIM_HZ;

  const root = useRef<SVGGElement>(null);
  const routeRef = useRef<SVGPathElement>(null);
  const vanRef = useRef<SVGGElement>(null);
  const bubbleTxt = useRef<SVGTextElement>(null);
  const bigTxt = useRef<SVGTextElement>(null);
  const timeTxt = useRef<SVGTextElement>(null);
  const kmTxt = useRef<SVGTextElement>(null);
  const elapsed = useRef(0); // seconds of viewing time ("clock" mode)

  const d = useMemo(() => "M " + geo.route.map((p) => `${p[0]} ${p[1]}`).join(" L "), [geo.route]);

  useEffect(() => {
    const render = (travelM: number, clockSec: number, opacity: number) => {
      const px = travelM / track.mPerPx;
      const [x, y] = pointAt(track, px);
      vanRef.current?.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      if (routeRef.current) routeRef.current.style.strokeDashoffset = String(-px);
      const rem = Math.max(0, ROUTE_M - travelM);
      const etaS = rem / EFF_MPS;
      const min = rem < 15 ? "<1" : String(Math.max(1, Math.ceil(etaS / 60)));
      const label = `${min} min`;
      if (bubbleTxt.current) bubbleTxt.current.textContent = label;
      if (bigTxt.current) bigTxt.current.textContent = label;
      if (kmTxt.current) kmTxt.current.textContent = rem >= 100 ? `${(rem / 1000).toFixed(1)} km away` : `${Math.round(rem / 5) * 5} m away`;
      if (timeTxt.current) timeTxt.current.textContent = clockLabel(clockSec + Math.ceil(etaS / 60) * 60);
      if (root.current) root.current.style.opacity = opacity.toFixed(3);
    };

    const stateAtClock = (t: number) => {
      // trip, then a short hold at the door, then a soft restart
      const cycle = tripSec + HOLD_AFTER_ARRIVAL + 0.6;
      const tc = t % cycle;
      const idx = Math.min(trip.length - 1, Math.floor(tc * SIM_HZ));
      const fade = tc > tripSec + HOLD_AFTER_ARRIVAL ? 1 - (tc - tripSec - HOLD_AFTER_ARRIVAL) / 0.6 : tc < 0.6 && t > 1 ? tc / 0.6 : 1;
      return { travel: trip[idx], fade };
    };

    const stateAtVideo = (vt: number) => {
      // final approach: 10 m to the door, braking to a stop just as the clip cuts to "arrived"
      const D = 10;
      const t0 = 0.5;
      const T = 2.2;
      const v0 = (2 * D) / T;
      const a = v0 / T;
      const s = Math.max(0, Math.min(T, vt - t0));
      return { travel: ROUTE_M - D + v0 * s - 0.5 * a * s * s, fade: 1 };
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
      last = now;
      const v = videoRef.current;
      const vt = v && v.readyState >= 2 && (v.currentTime > 0 || !v.paused) ? v.currentTime : -1;
      const base = vt >= 0 ? rampOpacity(geo.fades, vt) : 1;
      if (geo.mode === "video") {
        const s = stateAtVideo(Math.max(0, vt));
        render(s.travel, CLOCK_START + 2, base);
      } else {
        if (playing) elapsed.current += dt;
        const s = stateAtClock(elapsed.current);
        render(s.travel, CLOCK_START + elapsed.current, base * s.fade);
      }
      if (playing) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geo, track, trip, tripSec, playing, videoRef]);

  const [W, H] = geo.size;
  const [mx, my, mw, mh] = geo.map;
  const clipId = `ltm-${geo.id}`;
  const b = geo.bubble;
  const r = geo.van.r;

  return (
    <svg className="slot__live" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <rect x={mx} y={my} width={mw} height={mh} rx={Math.round(mw * 0.035)} />
        </clipPath>
      </defs>
      <g ref={root}>
        <image href={geo.patch.src} x={geo.patch.rect[0]} y={geo.patch.rect[1]} width={geo.patch.rect[2]} height={geo.patch.rect[3]} />
        <g clipPath={`url(#${clipId})`}>
          <path
            ref={routeRef}
            d={d}
            fill="none"
            stroke={geo.routeColor}
            strokeWidth={geo.routeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ strokeDasharray: `${track.lenPx + 4} ${track.lenPx + 4}` }}
          />
          <g ref={vanRef} transform={`translate(${geo.route[0][0]} ${geo.route[0][1]})`}>
            <image href={geo.van.src} x={-r} y={-r} width={r * 2 + 1} height={r * 2 + 1} />
            <g transform={`translate(${b.dx} ${b.dy})`}>
              <rect x={-b.w / 2} y={0} width={b.w} height={b.h} rx={b.h * 0.32} fill={b.bg} />
              <path d={`M ${-b.h * 0.18} ${b.h - 0.5} L 0 ${b.h * 1.2} L ${b.h * 0.18} ${b.h - 0.5} Z`} fill={b.bg} />
              <text ref={bubbleTxt} x={0} y={b.h * 0.5} dy="0.36em" textAnchor="middle" fontSize={b.fs} fontWeight={700} fill="#ffffff" style={{ fontFamily: FONT }}>
                2 min
              </text>
            </g>
          </g>
        </g>
        <text ref={bigTxt} x={geo.big.x} y={geo.big.baseline} fontSize={geo.big.fs} fontWeight={750} fill="#ffffff" letterSpacing="-0.01em" style={{ fontFamily: FONT }}>
          2 min
        </text>
        <text ref={timeTxt} x={geo.time.right} y={geo.time.baseline} textAnchor="end" fontSize={geo.time.fs} fontWeight={700} fill="#f1f5f9" style={{ fontFamily: FONT }}>
          ~9:11 PM
        </text>
        <text ref={kmTxt} x={geo.km.right} y={geo.km.baseline} textAnchor="end" fontSize={geo.km.fs} fontWeight={500} fill={geo.km.color} style={{ fontFamily: FONT }}>
          0.5 km away
        </text>
      </g>
    </svg>
  );
}
