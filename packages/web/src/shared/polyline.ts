/**
 * Polyline helpers: decoding Google's encoded format and projecting a GPS
 * position onto a route. Pure functions, no I/O, so the trip engine's maths
 * is unit-testable.
 */

/** Decode a Google encoded polyline (precision 5) into [lat, lng] pairs. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Encode [lat, lng] pairs as a Google polyline. Used by tests and fixtures. */
export function encodePolyline(points: [number, number][]): string {
  let out = "";
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += enc(iLat - pLat) + enc(iLng - pLng);
    pLat = iLat;
    pLng = iLng;
  }
  return out;
}

const M_PER_DEG_LAT = 111_320;

/** Metres between two points on a local flat approximation (fine below ~50 km). */
export function flatDistanceM(a: [number, number], b: [number, number]): number {
  const cos = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const dy = (b[0] - a[0]) * M_PER_DEG_LAT;
  const dx = (b[1] - a[1]) * M_PER_DEG_LAT * cos;
  return Math.hypot(dx, dy);
}

/** Cumulative distance (m) at each vertex; [0, d01, d01+d12, ...]. */
export function cumulativeDistances(path: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + flatDistanceM(path[i - 1]!, path[i]!));
  return cum;
}

export interface Projection {
  /** Index of the segment start vertex. */
  segment: number;
  /** The closest point on the route. */
  point: [number, number];
  /** Metres from the start of the route to `point`, along the route. */
  alongM: number;
  /** Metres from the position to the route (perpendicular, or to a vertex). */
  offRouteM: number;
}

/**
 * Closest point on the route to `pos`. `fromSegment` lets the caller skip
 * segments already driven, so a route that doubles back on itself doesn't
 * snap the van to the wrong leg; pass 0 to search the whole route.
 */
export function projectOntoPath(
  pos: [number, number],
  path: [number, number][],
  cum: number[],
  fromSegment = 0,
): Projection {
  const cos = Math.cos((pos[0] * Math.PI) / 180);
  const toXY = (p: [number, number]) => [(p[1] - pos[1]) * M_PER_DEG_LAT * cos, (p[0] - pos[0]) * M_PER_DEG_LAT] as const;

  let best: Projection = { segment: 0, point: path[0]!, alongM: 0, offRouteM: Infinity };
  const start = Math.max(0, Math.min(fromSegment, path.length - 2));
  for (let i = start; i < path.length - 1; i++) {
    const [ax, ay] = toXY(path[i]!);
    const [bx, by] = toXY(path[i + 1]!);
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    // pos is the origin in this frame, so the vector a→pos is (-ax, -ay)
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * vx - ay * vy) / len2));
    const px = ax + t * vx;
    const py = ay + t * vy;
    const d = Math.hypot(px, py);
    if (d < best.offRouteM) {
      const a = path[i]!;
      const b = path[i + 1]!;
      best = {
        segment: i,
        point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        alongM: cum[i]! + t * (cum[i + 1]! - cum[i]!),
        offRouteM: d,
      };
    }
  }
  if (path.length === 1) best = { segment: 0, point: path[0]!, alongM: 0, offRouteM: flatDistanceM(pos, path[0]!) };
  return best;
}
