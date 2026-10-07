// ─── ArrivePing basemap ──────────────────────────────────────────────────
// One place that decides what every Leaflet map in the product draws under
// the pins. Two modes:
//
//   "ink"       (default) — ArrivePing Ink: OpenFreeMap vector tiles rendered
//               by MapLibre GL inside Leaflet, recoloured to the brand palette
//               (ink #070b12, blue-black water, cyan-leaning highways). Vector
//               means crisp roads/labels at every zoom and no "map data not
//               yet available" placeholder past z16. Free, no API key.
//   "satellite" — Esri World Imagery dimmed + ink tint, with Esri's dark
//               reference labels on top, so aerial photos keep the same dark
//               tone as the rest of the UI. Keyless.
//
// The user's choice is remembered in localStorage and every mounted map
// follows it, so flipping the toggle on the fleet map also flips the job
// detail mini-map.
//
// Falls back to Esri's raster "World Dark Gray" (the pre-2026 default) when
// WebGL is unavailable, so a dispatcher on a locked-down box still gets a map.
import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";
import inkStyle from "./arriveping-ink.style.json";

export type BasemapMode = "ink" | "satellite";

const STORAGE_KEY = "arriveping.basemap";
const EVENT = "arriveping:basemap";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const SAT_URL = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const LABELS_URL = `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const FALLBACK_URL = `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

export function getBasemapMode(): BasemapMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "satellite" ? "satellite" : "ink";
  } catch {
    return "ink";
  }
}

export function setBasemapMode(mode: BasemapMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / quota — the in-memory state below still updates */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

let webglOk: boolean | null = null;
function hasWebGL(): boolean {
  if (webglOk != null) return webglOk;
  try {
    const c = document.createElement("canvas");
    webglOk = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

function inkLayer(): L.Layer {
  if (!hasWebGL()) {
    return L.tileLayer(FALLBACK_URL, { maxZoom: 19, maxNativeZoom: 16, className: "ap-ink-fallback" });
  }
  return L.maplibreGL({
    // Vendored copy of OpenFreeMap "dark" with ArrivePing colours; regenerate
    // with packages/web/tools/gen-ink-style.py.
    style: inkStyle as unknown as string,
    attributionControl: false,
    // Leaflet owns interaction; the GL canvas is a dumb renderer underneath.
    interactive: false,
  } as any);
}

function satelliteLayers(): L.Layer[] {
  return [
    L.tileLayer(SAT_URL, { maxZoom: 19, className: "ap-sat-layer" }),
    // Esri's label cache has nothing past z16 — let Leaflet upscale instead of
    // requesting tiles that 404 into a placeholder.
    L.tileLayer(LABELS_URL, { maxZoom: 19, maxNativeZoom: 16, className: "ap-sat-labels" }),
  ];
}

const ICON_SAT = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`;
const ICON_MAP = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`;

export interface AttachBasemapOptions {
  /** Show the Map/Satellite toggle. `false` hides it; a position string places it. Default "bottomright". */
  toggle?: boolean | L.ControlPosition;
  /** Icon-only button for small embedded maps. */
  compact?: boolean;
}

export interface BasemapHandle {
  getMode(): BasemapMode;
  setMode(mode: BasemapMode): void;
  /** Detach layers, control and listeners. Called automatically on map `unload`. */
  destroy(): void;
}

/**
 * Attach the ArrivePing basemap (and optional Map/Satellite toggle) to a
 * Leaflet map. Replaces the old `L.tileLayer(<Esri dark gray>).addTo(map)`.
 */
export function attachBasemap(map: L.Map, opts: AttachBasemapOptions = {}): BasemapHandle {
  let current: L.Layer[] = [];
  let mode: BasemapMode = getBasemapMode();
  const container = map.getContainer();
  container.classList.add("ap-basemap");

  function apply(next: BasemapMode) {
    for (const l of current) map.removeLayer(l);
    current = next === "satellite" ? satelliteLayers() : [inkLayer()];
    for (const l of current) l.addTo(map);
    container.classList.toggle("ap-basemap-sat", next === "satellite");
    mode = next;
    renderButton();
  }

  // ── toggle control ──
  let button: HTMLButtonElement | null = null;
  function renderButton() {
    if (!button) return;
    const toSat = mode !== "satellite";
    const label = toSat ? "Satellite" : "Map";
    button.innerHTML = `${toSat ? ICON_SAT : ICON_MAP}${opts.compact ? "" : `<span>${label}</span>`}`;
    button.title = toSat ? "Switch to satellite view" : "Switch to map view";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(!toSat));
  }

  let control: L.Control | null = null;
  if (opts.toggle !== false) {
    const position: L.ControlPosition = typeof opts.toggle === "string" ? opts.toggle : "bottomright";
    const Toggle = L.Control.extend({
      onAdd() {
        const wrap = L.DomUtil.create("div", "leaflet-bar ap-basemap-toggle" + (opts.compact ? " ap-basemap-toggle--compact" : ""));
        button = L.DomUtil.create("button", "", wrap) as HTMLButtonElement;
        button.type = "button";
        renderButton();
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.on(button, "click", (e) => {
          L.DomEvent.stop(e);
          setBasemapMode(mode === "satellite" ? "ink" : "satellite");
        });
        return wrap;
      },
      onRemove() {
        button = null;
      },
    });
    control = new Toggle({ position });
    control.addTo(map);
  }

  // ── keep every map on the page in sync ──
  const onChange = (e: Event) => {
    const next = (e as CustomEvent<BasemapMode>).detail;
    if (next !== mode) apply(next);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      const next = getBasemapMode();
      if (next !== mode) apply(next);
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);

  apply(mode);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    try {
      control?.remove();
    } catch {
      /* map already torn down */
    }
    control = null;
  };
  map.once("unload", destroy);

  return {
    getMode: () => mode,
    setMode: setBasemapMode,
    destroy,
  };
}
