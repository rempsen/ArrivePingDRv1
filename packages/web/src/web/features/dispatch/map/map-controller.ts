/**
 * The dispatch map's camera and canvas, with no opinion about what is drawn on
 * it. MapLibre GL JS 6 comes in under the alias `maplibre-gl-6` (the Leaflet
 * maps elsewhere keep their own copy) and loads its web worker from a hashed
 * asset, because the default location, next to the library file, does not
 * exist once the library is bundled.
 */
import * as maplibregl from "maplibre-gl-6";
import workerUrl from "maplibre-gl-6/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl-6/dist/maplibre-gl.css";
import { inkStyle, satelliteStyle, type MapMode } from "./style";

maplibregl.setWorkerUrl(workerUrl);

export type LngLat = [number, number];
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapController {
  readonly map: maplibregl.Map;
  readonly container: HTMLElement;
  /** Keep the interesting middle of the map clear of floating panels. */
  setPadding(p: Padding): void;
  /** Frame these points. One point zooms in on it; none does nothing. */
  fitTo(points: readonly LngLat[], opts?: { duration?: number; maxZoom?: number }): void;
  flyTo(point: LngLat, zoom?: number): void;
  zoomBy(delta: number): void;
  panBy(dx: number, dy: number): void;
  /** A point on the map in pixels from the container's top-left corner. */
  project(lng: number, lat: number): { x: number; y: number };
  containerRect(): DOMRect;
  zoom(): number;
  setMode(mode: MapMode): void;
  /** Stop the map reacting to pointers (while a drag owns them). */
  lockGestures(locked: boolean): void;
  /** Called on every camera move or resize. */
  onCamera(fn: () => void): () => void;
  /** Called once the style is ready, and again after every change of look. */
  onStyleReady(fn: () => void): () => void;
  destroy(): void;
}

export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createMapController(
  container: HTMLElement,
  opts: { mode: MapMode; center: LngLat; zoom: number },
): MapController {
  const map = new maplibregl.Map({
    container,
    style: opts.mode === "satellite" ? satelliteStyle() : inkStyle(),
    center: opts.center,
    zoom: opts.zoom,
    minZoom: 2,
    maxZoom: 19,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: 120,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // The data credit is always on screen: the full text, not a collapsed (i).
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");

  // The ink style asks for a sprite image the sprite doesn't contain.
  map.on("styleimagemissing", (e) => {
    if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });

  const styleReady = new Set<() => void>();
  let loaded = false;
  map.on("style.load", () => {
    loaded = true;
    for (const fn of styleReady) fn();
  });

  const dur = (ms: number) => (prefersReducedMotion() ? 0 : ms);

  return {
    map,
    container,
    setPadding: (p) => map.setPadding(p),
    fitTo(points, o = {}) {
      if (points.length === 0) return;
      if (points.length === 1) {
        map.easeTo({ center: points[0]!, zoom: Math.max(map.getZoom(), 13), duration: dur(o.duration ?? 400) });
        return;
      }
      const b = new maplibregl.LngLatBounds(points[0]!, points[0]!);
      for (const p of points) b.extend(p);
      map.fitBounds(b, { padding: 56, maxZoom: o.maxZoom ?? 15, duration: dur(o.duration ?? 400) });
    },
    flyTo(point, zoom) {
      map.easeTo({ center: point, zoom: zoom ?? Math.max(map.getZoom(), 14), duration: dur(500) });
    },
    zoomBy: (d) => map.easeTo({ zoom: map.getZoom() + d, duration: dur(250) }),
    panBy: (dx, dy) => map.panBy([dx, dy], { duration: 0 }),
    project(lng, lat) {
      const p = map.project([lng, lat]);
      return { x: p.x, y: p.y };
    },
    containerRect: () => container.getBoundingClientRect(),
    zoom: () => map.getZoom(),
    setMode(mode) {
      loaded = false;
      map.setStyle(mode === "satellite" ? satelliteStyle() : inkStyle(), { diff: false });
    },
    lockGestures(locked) {
      const parts = [map.dragPan, map.scrollZoom, map.touchZoomRotate, map.doubleClickZoom, map.boxZoom, map.keyboard];
      for (const h of parts) {
        if (locked) h.disable();
        else h.enable();
      }
      if (!locked) map.touchZoomRotate.disableRotation();
    },
    onCamera(fn) {
      map.on("move", fn);
      map.on("resize", fn);
      return () => {
        map.off("move", fn);
        map.off("resize", fn);
      };
    },
    onStyleReady(fn) {
      styleReady.add(fn);
      if (loaded) fn();
      return () => styleReady.delete(fn);
    },
    destroy() {
      styleReady.clear();
      map.remove();
    },
  };
}
