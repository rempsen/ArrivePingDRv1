import { describe, expect, test } from "bun:test";
import { TripEngine, type RecomputeReason } from "../trip-engine";
import type { LatLng, RouteResult } from "../routing";
import {
  cumulativeDistances,
  decodePolyline,
  encodePolyline,
  flatDistanceM,
  projectOntoPath,
} from "../../shared/polyline";
import fixture from "./fixtures/winnipeg-drive.json";

const DRIVE = decodePolyline(fixture.encodedPolyline);
const DRIVE_CUM = cumulativeDistances(DRIVE);
const DRIVE_M = DRIVE_CUM[DRIVE_CUM.length - 1]!;
const DEST: LatLng = { lat: DRIVE[DRIVE.length - 1]![0], lng: DRIVE[DRIVE.length - 1]![1] };
/** Traffic-aware duration the fake Google reports for the whole drive. */
const TRAFFIC_SEC = 25 * 60;

/** Point at `m` metres along a path. */
function pointAt(path: [number, number][], cum: number[], m: number): [number, number] {
  if (m <= 0) return path[0]!;
  for (let i = 1; i < path.length; i++) {
    if (cum[i]! >= m) {
      const t = (m - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
      const a = path[i - 1]!;
      const b = path[i]!;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return path[path.length - 1]!;
}

/** Offset `m` metres sideways (to the left) from the road at `along`. */
function sideways(along: number, m: number): [number, number] {
  const a = pointAt(DRIVE, DRIVE_CUM, along);
  const b = pointAt(DRIVE, DRIVE_CUM, along + 20);
  const cos = Math.cos((a[0] * Math.PI) / 180);
  const dn = (b[0] - a[0]) * 111_320;
  const de = (b[1] - a[1]) * 111_320 * cos;
  const len = Math.hypot(dn, de) || 1;
  return offset(a, (de / len) * m, (-dn / len) * m);
}

/** Offset a point by metres north/east. */
function offset(p: [number, number], northM: number, eastM: number): [number, number] {
  return [p[0] + northM / 111_320, p[1] + eastM / (111_320 * Math.cos((p[0] * Math.PI) / 180))];
}

/**
 * Fake Google: answers with the rest of the real drive from wherever the
 * tech is, with a traffic duration proportional to what's left. When the
 * tech is off the road, the route starts at the tech and rejoins the drive.
 */
function fakeGoogle() {
  const calls: { o: LatLng; d: LatLng }[] = [];
  const router = async (o: LatLng, d: LatLng): Promise<RouteResult> => {
    calls.push({ o, d });
    const proj = projectOntoPath([o.lat, o.lng], DRIVE, DRIVE_CUM);
    const rest = DRIVE.slice(proj.segment + 1);
    const path: [number, number][] = [[o.lat, o.lng], proj.point, ...rest];
    const leftM = DRIVE_M - proj.alongM + proj.offRouteM;
    return {
      path,
      durationSec: (TRAFFIC_SEC * leftM) / DRIVE_M,
      staticDurationSec: null,
      distanceM: leftM,
      provider: "google",
    };
  };
  return { calls, router };
}

function engineWithClock(extra: ConstructorParameters<typeof TripEngine>[0] = {}) {
  let t = 1_000_000;
  const reasons: RecomputeReason[] = [];
  const g = fakeGoogle();
  const engine = new TripEngine({
    router: g.router,
    now: () => t,
    onRecompute: (_id, r) => reasons.push(r),
    ...extra,
  });
  return {
    engine,
    g,
    reasons,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const asLatLng = (p: [number, number]): LatLng => ({ lat: p[0], lng: p[1] });

describe("polyline helpers", () => {
  test("encode/decode round-trips at 1e-5 precision", () => {
    const pts: [number, number][] = [
      [49.86621, -97.17352],
      [49.87, -97.16],
      [49.9301, -97.06],
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });

  test("the fixture is a real ~13 km road route", () => {
    expect(DRIVE.length).toBeGreaterThan(200);
    expect(Math.abs(DRIVE_M - fixture.distanceM) / fixture.distanceM).toBeLessThan(0.02);
  });

  test("projection: a point beside the road snaps to it, with the right along-distance", () => {
    const along = 4_000;
    const onRoad = pointAt(DRIVE, DRIVE_CUM, along);
    const beside = offset(onRoad, 30, 0);
    const proj = projectOntoPath(beside, DRIVE, DRIVE_CUM);
    expect(proj.offRouteM).toBeLessThan(31);
    expect(Math.abs(proj.alongM - along)).toBeLessThan(60);
  });

  test("projection respects fromSegment so earlier legs aren't matched", () => {
    const proj = projectOntoPath(DRIVE[0]!, DRIVE, DRIVE_CUM, 100);
    expect(proj.segment).toBeGreaterThanOrEqual(100);
  });
});

describe("TripEngine", () => {
  test("first position computes a route; later positions on it are free", async () => {
    const { engine, g, reasons, advance } = engineWithClock();
    const s1 = await engine.update("b1", asLatLng(DRIVE[0]!), DEST);
    expect(g.calls.length).toBe(1);
    expect(reasons).toEqual(["start"]);
    expect(s1!.etaMins).toBe(25);
    expect(s1!.provider).toBe("google");

    advance(8_000);
    const half = pointAt(DRIVE, DRIVE_CUM, DRIVE_M / 2);
    const s2 = await engine.update("b1", asLatLng(half), DEST);
    expect(g.calls.length).toBe(1);
    expect(s2!.etaMins).toBeGreaterThanOrEqual(12);
    expect(s2!.etaMins).toBeLessThanOrEqual(13);
    expect(s2!.distanceKm).toBeCloseTo(DRIVE_M / 2000, 0);
    // remaining path starts where the van is
    expect(flatDistanceM(s2!.remainingPath[0]!, half)).toBeLessThan(5);
  });

  test("refreshes after 4 minutes only if the tech has moved", async () => {
    const { engine, g, reasons, advance } = engineWithClock();
    const start = asLatLng(DRIVE[0]!);
    await engine.update("b1", start, DEST);
    advance(5 * 60_000);
    await engine.update("b1", start, DEST); // parked: no refresh
    expect(g.calls.length).toBe(1);
    await engine.update("b1", asLatLng(pointAt(DRIVE, DRIVE_CUM, 500)), DEST);
    expect(g.calls.length).toBe(2);
    expect(reasons.at(-1)).toBe("refresh");
  });

  test("off-route needs two consecutive positions, then recomputes", async () => {
    const { engine, g, reasons, advance } = engineWithClock();
    await engine.update("b1", asLatLng(DRIVE[0]!), DEST);
    advance(30_000);
    const away = sideways(800, 400);
    const away2 = sideways(820, 400);
    const s1 = await engine.update("b1", asLatLng(away), DEST);
    expect(g.calls.length).toBe(1);
    expect(s1!.offRoute).toBe(true);
    // the page re-polling the same fix doesn't count
    advance(2_500);
    await engine.update("b1", asLatLng(away), DEST);
    expect(g.calls.length).toBe(1);
    advance(5_500);
    await engine.update("b1", asLatLng(away2), DEST);
    expect(g.calls.length).toBe(2);
    expect(reasons.at(-1)).toBe("off-route");
  });

  test("never recomputes more than once per minIntervalMs", async () => {
    const { engine, g, advance } = engineWithClock();
    await engine.update("b1", asLatLng(DRIVE[0]!), DEST);
    for (let i = 0; i < 3; i++) {
      advance(4_000);
      await engine.update("b1", asLatLng(sideways(100 + i * 20, 500)), DEST);
    }
    expect(g.calls.length).toBe(1); // 12 s < 20 s
    advance(10_000);
    await engine.update("b1", asLatLng(sideways(200, 500)), DEST);
    expect(g.calls.length).toBe(2);
  });

  test("a new destination recomputes immediately", async () => {
    const { engine, g, reasons } = engineWithClock();
    await engine.update("b1", asLatLng(DRIVE[0]!), DEST);
    await engine.update("b1", asLatLng(DRIVE[0]!), asLatLng(DRIVE[Math.floor(DRIVE.length / 2)]!));
    expect(g.calls.length).toBe(2);
    expect(reasons).toEqual(["start", "destination"]);
  });

  test("concurrent callers share one Google request", async () => {
    const { engine, g } = engineWithClock();
    const p = asLatLng(DRIVE[0]!);
    const [a, b, c] = await Promise.all([
      engine.update("b1", p, DEST),
      engine.update("b1", p, DEST),
      engine.update("b1", p, DEST),
    ]);
    expect(g.calls.length).toBe(1);
    expect(a!.etaMins).toBe(b!.etaMins);
    expect(b!.etaMins).toBe(c!.etaMins);
  });

  test("end() drops the trip; LRU caps memory; idle trips expire", async () => {
    const { engine, g, advance } = engineWithClock({ maxTrips: 3, ttlMs: 60_000 });
    const p = asLatLng(DRIVE[0]!);
    for (const id of ["a", "b", "c", "d"]) await engine.update(id, p, DEST);
    expect(engine.size).toBe(3); // "a" evicted
    await engine.update("a", p, DEST);
    expect(g.calls.length).toBe(5);

    engine.end("a");
    expect(engine.size).toBe(2);

    advance(61_000);
    await engine.update("b", p, DEST);
    expect(g.calls.length).toBe(6); // expired, recomputed
  });

  test("a router failure returns null without poisoning the trip", async () => {
    let fail = true;
    const g = fakeGoogle();
    const engine = new TripEngine({ router: async (o, d) => (fail ? null : g.router(o, d)) });
    expect(await engine.update("b1", asLatLng(DRIVE[0]!), DEST)).toBeNull();
    fail = false;
    expect((await engine.update("b1", asLatLng(DRIVE[0]!), DEST))!.etaMins).toBe(25);
  });

  test("an estimate (straight line) route doesn't trigger off-route recomputes", async () => {
    let calls = 0;
    const engine = new TripEngine({
      router: async (o, d) => {
        calls++;
        return { path: [[o.lat, o.lng], [d.lat, d.lng]], durationSec: 600, staticDurationSec: null, distanceM: 5000, provider: "estimate" };
      },
    });
    await engine.update("b1", asLatLng(DRIVE[0]!), DEST);
    for (let i = 0; i < 5; i++) await engine.update("b1", asLatLng(sideways(300 + i * 50, 600)), DEST);
    expect(calls).toBe(1);
  });

  test("invalid coordinates return null and never call the router", async () => {
    const { engine, g } = engineWithClock();
    expect(await engine.update("b1", { lat: NaN, lng: 1 }, DEST)).toBeNull();
    expect(g.calls.length).toBe(0);
  });
});

describe("simulated 25-minute drive (8 s pings + public page polling)", () => {
  test("≤ 10 Google calls, one consistent ETA, counting down to arrival", async () => {
    const { engine, g, reasons, advance } = engineWithClock();
    const pingEvery = 8_000;
    const pings = Math.ceil((TRAFFIC_SEC * 1000) / pingEvery);
    const etas: number[] = [];
    // deterministic GPS noise, ±12 m
    let seed = 42;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return ((seed / 2147483647) * 2 - 1) * 12;
    };

    for (let i = 0; i <= pings; i++) {
      // uneven pace: slower in the middle (traffic), like a real drive
      const f = i / pings;
      const along = DRIVE_M * (f - 0.08 * Math.sin(2 * Math.PI * f));
      const detour = i >= Math.floor(pings * 0.4) && i < Math.floor(pings * 0.4) + 3;
      // a short detour 40% of the way: 3 pings ~250 m off the planned road
      const pos = offset(detour ? sideways(along, 250) : pointAt(DRIVE, DRIVE_CUM, along), noise(), noise());

      const ping = await engine.update("job-1", asLatLng(pos), DEST);
      // the public page and the signed-in page both poll between pings
      advance(2_500);
      const publicPage = await engine.update("job-1", asLatLng(pos), DEST);
      advance(2_500);
      const authedPage = await engine.update("job-1", asLatLng(pos), DEST);
      advance(pingEvery - 5_000);

      expect(Math.abs(publicPage!.etaMins - ping!.etaMins)).toBeLessThanOrEqual(1);
      expect(Math.abs(authedPage!.etaMins - ping!.etaMins)).toBeLessThanOrEqual(1);
      etas.push(ping!.etaMins);
    }

    // Before: ~170 Distance Matrix + ~40 Directions calls for this trip.
    expect(g.calls.length).toBeLessThanOrEqual(10);
    expect(reasons[0]).toBe("start");
    expect(reasons).toContain("off-route");

    expect(etas[0]).toBe(25);
    expect(etas.at(-1)!).toBeLessThanOrEqual(1);
    // counts down: never jumps up by more than 2 min between pings
    for (let i = 1; i < etas.length; i++) expect(etas[i]! - etas[i - 1]!).toBeLessThanOrEqual(2);
  });
});
