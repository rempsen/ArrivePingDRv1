/**
 * The dashed line drawn from a job to the technician it would be assigned to
 * while it is being dragged. A GeoJSON line, redrawn when the style changes.
 */
import type * as maplibregl from "maplibre-gl-6";
import type { LngLat, MapController } from "./map-controller";

const SRC = "assign-line";

export class AssignLine {
  private line: [LngLat, LngLat] | null = null;
  private off: () => void;

  constructor(private ctl: MapController) {
    this.off = ctl.onStyleReady(() => {
      this.install();
      this.draw();
    });
  }

  /** Draw from a to b, or clear with null. */
  set(a: LngLat | null, b: LngLat | null) {
    this.line = a && b ? [a, b] : null;
    this.draw();
  }

  destroy() {
    this.off();
    const m = this.ctl.map;
    try {
      if (m.getLayer(SRC)) m.removeLayer(SRC);
      if (m.getSource(SRC)) m.removeSource(SRC);
    } catch {
      /* the map is already gone */
    }
  }

  private install() {
    const m = this.ctl.map;
    if (!m.getSource(SRC)) m.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!m.getLayer(SRC)) {
      m.addLayer({
        id: SRC,
        type: "line",
        source: SRC,
        layout: { "line-cap": "round" },
        paint: { "line-color": "#38bdf8", "line-width": 2, "line-dasharray": [1.5, 2], "line-opacity": 0.9 },
      });
    }
  }

  private draw() {
    const src = this.ctl.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: this.line ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.line } }] : [],
    });
  }
}
