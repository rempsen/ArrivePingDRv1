/**
 * TripEngine: one live route + ETA per active booking, shared by every caller.
 *
 * Before this, the GPS ping handler called Google Distance Matrix every 30 s
 * for the whole visit, and two separate route caches (public tracking page,
 * signed-in customer page) called Google Directions whenever the tech moved
 * ~120 m, which while driving was nearly every 8 s ping. That came to roughly
 * 200 traffic-aware calls per job, and three different ETAs for one trip.
 *
 * Now each booking holds one traffic-aware route. Every ping and every page
 * poll projects the tech's position onto that route, which costs nothing:
 *
 *     ETA = traffic duration × (remaining distance ÷ route distance)
 *
 * Google is called again only when:
 *   - the trip starts, or the job's destination changes;
 *   - the route is older than `refreshMs` (4 min) and the tech has moved;
 *   - the tech is more than `offRouteM` (150 m) off the route for
 *     `offRouteStreak` (2) positions in a row;
 *   - the projection jumps backwards by more than `jumpBackM` (300 m).
 * And never more often than once per `minIntervalMs`. A 25-minute drive
 * comes to about 7 calls.
 *
 * State is in memory (a single API process today), bounded by an LRU of
 * `maxTrips` with a `ttlMs` idle expiry. Concurrent callers for the same
 * booking share one in-flight Google request.
 */
import { computeRoute, type LatLng, type RouteResult } from "./routing";
import { cumulativeDistances, flatDistanceM, projectOntoPath } from "../shared/polyline";

export type RecomputeReason = "start" | "destination" | "refresh" | "off-route" | "jump";

export interface TripSnapshot {
  etaMins: number;
  /** Driving distance still to go, km (1 decimal). */
  distanceKm: number;
  /** What's left of the route, starting at the tech's position on it. */
  remainingPath: [number, number][];
  provider: RouteResult["provider"];
  /** When the underlying route was fetched (ms epoch). */
  computedAt: number;
  /** Tech is currently further than `offRouteM` from the route. */
  offRoute: boolean;
}

interface Trip {
  dest: LatLng;
  route: RouteResult;
  cum: number[];
  totalM: number;
  computedAt: number;
  computedFrom: [number, number];
  lastSegment: number;
  lastAlongM: number;
  offRouteStreak: number;
  /** Last distinct GPS fix seen, so repeated polls of one fix count once. */
  lastPos: [number, number] | null;
  lastSeen: number;
}

export interface TripEngineOptions {
  router?: (o: LatLng, d: LatLng) => Promise<RouteResult | null>;
  now?: () => number;
  maxTrips?: number;
  ttlMs?: number;
  refreshMs?: number;
  minIntervalMs?: number;
  offRouteM?: number;
  offRouteStreak?: number;
  jumpBackM?: number;
  movedM?: number;
  destChangeM?: number;
  /** Called on every recompute, for metrics and tests. */
  onRecompute?: (bookingId: string, reason: RecomputeReason, route: RouteResult) => void;
}

export class TripEngine {
  private trips = new Map<string, Trip>();
  private inflight = new Map<string, Promise<Trip | null>>();
  private readonly o: Required<Omit<TripEngineOptions, "onRecompute">> & Pick<TripEngineOptions, "onRecompute">;

  constructor(opts: TripEngineOptions = {}) {
    this.o = {
      router: opts.router ?? ((a, b) => computeRoute(a, b)),
      now: opts.now ?? Date.now,
      maxTrips: opts.maxTrips ?? 500,
      ttlMs: opts.ttlMs ?? 2 * 60 * 60_000,
      refreshMs: opts.refreshMs ?? 4 * 60_000,
      minIntervalMs: opts.minIntervalMs ?? 20_000,
      offRouteM: opts.offRouteM ?? 150,
      offRouteStreak: opts.offRouteStreak ?? 2,
      jumpBackM: opts.jumpBackM ?? 300,
      movedM: opts.movedM ?? 100,
      destChangeM: opts.destChangeM ?? 50,
      onRecompute: opts.onRecompute,
    };
  }

  get size(): number {
    return this.trips.size;
  }

  /** Forget a booking's trip (status left en route, job cancelled, …). */
  end(bookingId: string): void {
    this.trips.delete(bookingId);
  }

  /**
   * Feed the tech's current position. Returns the live ETA snapshot, or null
   * when coordinates are invalid or no route could be produced at all.
   */
  async update(bookingId: string, pos: LatLng, dest: LatLng): Promise<TripSnapshot | null> {
    if (![pos.lat, pos.lng, dest.lat, dest.lng].every(Number.isFinite)) return null;
    const now = this.o.now();
    const p: [number, number] = [pos.lat, pos.lng];
    let trip = this.get(bookingId, now);

    const reason = trip ? this.recomputeReason(trip, p, dest, now) : "start";
    if (reason) {
      const fresh = await this.recompute(bookingId, pos, dest, reason);
      if (fresh) trip = fresh;
      if (!trip) return null;
    }
    return this.snapshot(trip!, p);
  }

  // ---- internals ---------------------------------------------------------

  private get(bookingId: string, now: number): Trip | undefined {
    const t = this.trips.get(bookingId);
    if (!t) return undefined;
    if (now - t.lastSeen > this.o.ttlMs) {
      this.trips.delete(bookingId);
      return undefined;
    }
    // LRU: re-insert so Map order tracks recency
    this.trips.delete(bookingId);
    this.trips.set(bookingId, t);
    t.lastSeen = now;
    return t;
  }

  private recomputeReason(t: Trip, p: [number, number], dest: LatLng, now: number): RecomputeReason | null {
    if (flatDistanceM([t.dest.lat, t.dest.lng], [dest.lat, dest.lng]) > this.o.destChangeM) return "destination";

    const proj = projectOntoPath(p, t.route.path, t.cum, Math.max(0, t.lastSegment - 3));
    // The streak counts distinct GPS fixes, not calls: the tracking pages
    // re-send the latest ping every few seconds, and one bad fix must not
    // count three times.
    const freshFix = !t.lastPos || flatDistanceM(p, t.lastPos) > 1;
    if (freshFix) {
      t.offRouteStreak = proj.offRouteM > this.o.offRouteM ? t.offRouteStreak + 1 : 0;
      t.lastPos = p;
    }

    const sinceCompute = now - t.computedAt;
    const throttled = sinceCompute < this.o.minIntervalMs;
    let reason: RecomputeReason | null = null;
    // A straight-line estimate isn't a road, so being "off" it means nothing;
    // the 4-minute refresh is what retries Google for those.
    if (t.offRouteStreak >= this.o.offRouteStreak && t.route.provider !== "estimate") reason = "off-route";
    else if (proj.alongM < t.lastAlongM - this.o.jumpBackM) reason = "jump";
    else if (sinceCompute > this.o.refreshMs && flatDistanceM(p, t.computedFrom) > this.o.movedM) reason = "refresh";

    if (!reason || throttled) {
      // Only advance along the route while on it, so a detour doesn't drag
      // the "driven so far" marker forward.
      if (proj.offRouteM <= this.o.offRouteM && proj.alongM >= t.lastAlongM) {
        t.lastSegment = proj.segment;
        t.lastAlongM = proj.alongM;
      }
      return null;
    }
    return reason;
  }

  private recompute(bookingId: string, pos: LatLng, dest: LatLng, reason: RecomputeReason): Promise<Trip | null> {
    const pending = this.inflight.get(bookingId);
    if (pending) return pending;
    const job = (async () => {
      try {
        const route = await this.o.router(pos, dest);
        if (!route || route.path.length < 2) return null;
        const now = this.o.now();
        const cum = cumulativeDistances(route.path);
        const trip: Trip = {
          dest: { ...dest },
          route,
          cum,
          totalM: cum[cum.length - 1]!,
          computedAt: now,
          computedFrom: [pos.lat, pos.lng],
          lastSegment: 0,
          lastAlongM: 0,
          offRouteStreak: 0,
          lastPos: [pos.lat, pos.lng],
          lastSeen: now,
        };
        this.trips.delete(bookingId);
        this.trips.set(bookingId, trip);
        while (this.trips.size > this.o.maxTrips) {
          const oldest = this.trips.keys().next().value as string;
          this.trips.delete(oldest);
        }
        this.o.onRecompute?.(bookingId, reason, route);
        return trip;
      } finally {
        this.inflight.delete(bookingId);
      }
    })();
    this.inflight.set(bookingId, job);
    return job;
  }

  private snapshot(t: Trip, p: [number, number]): TripSnapshot {
    const proj = projectOntoPath(p, t.route.path, t.cum, Math.max(0, t.lastSegment - 3));
    const offRoute = proj.offRouteM > this.o.offRouteM;
    // Off the route: don't let a wrong projection shorten the trip; use the
    // furthest point reached while on it.
    const alongM = offRoute ? t.lastAlongM : Math.max(proj.alongM, t.lastAlongM);
    const remainingM = Math.max(0, t.totalM - alongM);
    const share = t.totalM > 0 ? remainingM / t.totalM : 0;
    const etaSec = t.route.durationSec * share;

    const seg = offRoute ? t.lastSegment : Math.max(proj.segment, t.lastSegment);
    const start: [number, number] = offRoute ? t.route.path[seg]! : proj.point;
    const remainingPath: [number, number][] = [start, ...t.route.path.slice(seg + 1)];
    // Draw from the van itself when it's visibly off the line.
    if (proj.offRouteM > 25) remainingPath.unshift(p);

    // Scale the reported distance the same way, so km and minutes agree with
    // the route's own distance figure rather than our flat-earth sum.
    const routeKm = (t.route.distanceM || t.totalM) / 1000;
    return {
      etaMins: Math.max(1, Math.round(etaSec / 60)),
      distanceKm: Math.round(routeKm * share * 10) / 10,
      remainingPath,
      provider: t.route.provider,
      computedAt: t.computedAt,
      offRoute,
    };
  }
}

/** Process-wide engine shared by the ping handler and both tracking pages. */
export const tripEngine = new TripEngine();

/** Statuses where the tech is (about to be) driving to the job. */
export const EN_ROUTE_STATUSES = new Set(["assigned", "accepted", "enroute"]);
