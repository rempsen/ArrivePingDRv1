/**
 * Jobs on the map: one clustered GeoJSON source drawn by GPU circle layers, so
 * two thousand jobs cost no more than a few hundred. Waiting jobs are amber
 * (red once their time has passed), assigned ones blue, work in the field
 * cyan, finished work grey. Zoomed out they merge into numbered clusters whose
 * ring turns amber while any job inside is still waiting.
 *
 * Selection, hover and "this is the job you're dragging" are three small DOM
 * rings that follow a job's position, so none of them depends on the style
 * (they survive a switch to satellite untouched).
 */
import * as maplibregl from "maplibre-gl-6";
import type { BoardJob } from "../data/types";
import { jobKind, type JobKind } from "../../../../shared/job-kind";
import type { MapController } from "./map-controller";

const SRC = "jobs";
export const KIND_COLOR: Record<JobKind, string> = {
  wait: "#f59e0b",
  late: "#ef4444",
  assigned: "#0ea5e9",
  live: "#38bdf8",
  done: "#475569",
};

export type JobHit = { type: "job"; id: string } | { type: "cluster"; clusterId: number; lngLat: [number, number] };

interface Placed {
  job: BoardJob;
  lngLat: [number, number];
}

export class JobLayer {
  private placed = new Map<string, Placed>();
  private data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  private rings: Record<"selected" | "hover" | "pulse", maplibregl.Marker | null> = { selected: null, hover: null, pulse: null };
  private ids: Record<"selected" | "hover" | "pulse", string | null> = { selected: null, hover: null, pulse: null };
  private off: () => void;

  constructor(private ctl: MapController) {
    this.off = ctl.onStyleReady(() => this.install());
  }

  /** Draw these jobs (those without a location are skipped; the queue still lists them). */
  sync(jobs: readonly BoardJob[], now: number, show: (j: BoardJob) => boolean = () => true) {
    this.placed.clear();
    const features: GeoJSON.Feature[] = [];
    for (const j of jobs) {
      if (j.lat == null || j.lng == null || !Number.isFinite(j.lat) || !Number.isFinite(j.lng)) continue;
      const lngLat: [number, number] = [j.lng, j.lat];
      this.placed.set(j.id, { job: j, lngLat });
      if (!show(j)) continue;
      const k = jobKind(j, now);
      features.push({
        type: "Feature",
        properties: { id: j.id, k, u: k === "wait" || k === "late" ? 1 : 0 },
        geometry: { type: "Point", coordinates: lngLat },
      });
    }
    this.data = { type: "FeatureCollection", features };
    (this.ctl.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(this.data);
    // Rings follow their job if it moved or disappeared.
    for (const r of ["selected", "hover", "pulse"] as const) this.place(r, this.ids[r]);
  }

  setSelected(id: string | null) {
    this.place("selected", id);
  }
  setHover(id: string | null) {
    this.place("hover", id);
  }
  /** Mark the job being dragged so you can see where it is. */
  pulse(id: string | null) {
    this.place("pulse", id);
  }

  positionOf(jobId: string): [number, number] | null {
    return this.placed.get(jobId)?.lngLat ?? null;
  }

  /** Every drawn job's position, for "fit everything". */
  points(): [number, number][] {
    return [...this.placed.values()].map((p) => p.lngLat);
  }

  /**
   * What is under (or near) a point, in pixels from the container's corner. The
   * search box is bigger than the dot, so a fingertip can hit a small pin.
   */
  hit(x: number, y: number, pad: number): JobHit | null {
    const m = this.ctl.map;
    if (!m.getLayer("job-pins")) return null;
    const feats = m.queryRenderedFeatures([[x - pad, y - pad], [x + pad, y + pad]], { layers: ["job-pins", "job-clusters"] });
    let best: { hit: JobHit; d: number } | null = null;
    for (const f of feats) {
      if (f.geometry.type !== "Point") continue;
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const p = m.project([lng, lat]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (best && d >= best.d) continue;
      const props = f.properties as { id?: string; cluster_id?: number };
      if (props.cluster_id != null) best = { hit: { type: "cluster", clusterId: props.cluster_id, lngLat: [lng, lat] }, d };
      else if (props.id) best = { hit: { type: "job", id: props.id }, d };
    }
    return best?.hit ?? null;
  }

  /** Open a cluster: zoom to where it splits. */
  async expand(clusterId: number, lngLat: [number, number]) {
    const src = this.ctl.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    try {
      const zoom = await src.getClusterExpansionZoom(clusterId);
      this.ctl.map.easeTo({ center: lngLat, zoom: Math.min(zoom + 0.25, 18), duration: 350 });
    } catch {
      /* the cluster changed under us; the next click will find it */
    }
  }

  destroy() {
    this.off();
    for (const r of Object.values(this.rings)) r?.remove();
    const m = this.ctl.map;
    try {
      for (const id of ["job-cluster-count", "job-clusters", "job-pins", "job-halo"]) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(SRC)) m.removeSource(SRC);
    } catch {
      /* the map is already gone */
    }
  }

  private place(which: "selected" | "hover" | "pulse", id: string | null) {
    this.ids[which] = id;
    const at = id ? this.placed.get(id)?.lngLat : null;
    if (!at) {
      this.rings[which]?.remove();
      this.rings[which] = null;
      return;
    }
    let mk = this.rings[which];
    if (!mk) {
      const el = document.createElement("span");
      el.className = `ap-ring ap-ring--${which}`;
      el.setAttribute("aria-hidden", "true");
      mk = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(at).addTo(this.ctl.map);
      this.rings[which] = mk;
    } else {
      mk.setLngLat(at);
    }
  }

  private install() {
    const m = this.ctl.map;
    if (!m.getSource(SRC)) {
      m.addSource(SRC, {
        type: "geojson",
        data: this.data,
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 14,
        clusterProperties: { unassigned: ["+", ["get", "u"]] },
      });
    }
    const color: maplibregl.ExpressionSpecification = [
      "match", ["get", "k"],
      "wait", KIND_COLOR.wait, "late", KIND_COLOR.late, "assigned", KIND_COLOR.assigned, "live", KIND_COLOR.live, "done", KIND_COLOR.done,
      "#64748b",
    ];
    if (!m.getLayer("job-clusters")) {
      m.addLayer({
        id: "job-clusters",
        type: "circle",
        source: SRC,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25],
          "circle-color": "#0c1220",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["case", [">", ["get", "unassigned"], 0], KIND_COLOR.wait, "#3b4a63"],
        },
      });
      m.addLayer({
        id: "job-cluster-count",
        type: "symbol",
        source: SRC,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#e2e8f0" },
      });
    }
    if (!m.getLayer("job-halo")) {
      m.addLayer({
        id: "job-halo",
        type: "circle",
        source: SRC,
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "u"], 1]],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 15, 14], "circle-color": color, "circle-opacity": 0.2 },
      });
      m.addLayer({
        id: "job-pins",
        type: "circle",
        source: SRC,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 7],
          "circle-color": color,
          "circle-stroke-color": "#070b12",
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["==", ["get", "k"], "done"], 0.6, 1],
        },
      });
    }
  }
}
