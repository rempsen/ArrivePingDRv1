/**
 * Technicians on the map.
 *
 * Zoomed out (below 9) they are small status-coloured dots from a GeoJSON
 * layer, which stays fast with hundreds of them. From zoom 9 they are face
 * markers (photo or initials in a status ring); from 13 they also carry a name.
 * A new position glides over 800 ms instead of jumping. While a job is being
 * dragged each marker shows how well that technician fits it.
 *
 * Everything user-supplied (names, photos) goes in through textContent and
 * element properties, never innerHTML.
 */
import * as maplibregl from "maplibre-gl-6";
import type { BoardTech } from "../data/types";
import type { Fit } from "../data/types";
import { prefersReducedMotion, type MapController } from "./map-controller";

export const STATUS_COLOR: Record<string, string> = {
  available: "#10b981",
  enroute: "#0ea5e9",
  onsite: "#38bdf8",
  busy: "#f59e0b",
  break: "#a78bfa",
  offline: "#64748b",
};
export const statusColor = (status: string) => STATUS_COLOR[status] ?? "#64748b";

/** Zoom levels at which the picture changes. */
export const ZOOM_AVATARS = 9;
export const ZOOM_NAMES = 13;
const GLIDE_MS = 800;
const SRC_DOTS = "tech-dots";

export interface DragFit {
  fit: Fit;
  best: boolean;
  /** A few words on the marker while dragging: "Best match", "Free at 3:20 PM". */
  chip: string;
}

export interface TechMarkerHooks {
  onClick(techId: string): void;
  /** The pointer is over a marker (null when it leaves). Only fired where hover exists. */
  onHover(techId: string | null, el: HTMLElement | null): void;
}

interface Entry {
  tech: BoardTech;
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  face: HTMLElement;
  chip: HTMLElement;
  name: HTMLElement;
  badge: HTMLElement;
  photo: string;
  /** Where the marker is drawn right now. */
  pos: [number, number];
  glide: { from: [number, number]; to: [number, number]; t0: number } | null;
}

const initials = (name: string) =>
  name.trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

/** "Tom Rivera" -> "Tom R." for the label under a marker. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

export class TechMarkers {
  private entries = new Map<string, Entry>();
  private raf = 0;
  private selected: string | null = null;
  private target: string | null = null;
  private dragFits: Record<string, DragFit> | null = null;
  private offStyle: () => void;
  private offCamera: () => void;

  constructor(
    private ctl: MapController,
    private hooks: TechMarkerHooks,
  ) {
    this.offStyle = ctl.onStyleReady(() => this.installDots());
    this.offCamera = ctl.onCamera(() => this.applyZoom());
    this.applyZoom();
  }

  /** Bring the markers in line with the board. */
  sync(techs: readonly BoardTech[], selectedId: string | null) {
    this.selected = selectedId;
    const seen = new Set<string>();
    for (const t of techs) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng) || t.lat == null || t.lng == null) continue;
      seen.add(t.id);
      const existing = this.entries.get(t.id);
      if (!existing) this.create(t);
      else this.update(existing, t);
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        e.marker.remove();
        this.entries.delete(id);
      }
    }
    this.paintAll();
    this.updateDots();
  }

  /** While a job is dragged: each technician's fit; null when it ends. */
  setDrag(fits: Record<string, DragFit> | null) {
    this.dragFits = fits;
    this.ctl.container.classList.toggle("ap-dragging-job", !!fits);
    this.paintAll();
  }

  /** The technician the dragged job would land on (null: none). */
  setTarget(techId: string | null, releaseText?: string) {
    this.target = techId;
    for (const [id, e] of this.entries) {
      const on = id === techId;
      e.el.toggleAttribute("data-target", on);
      if (on && releaseText) e.chip.textContent = releaseText;
    }
    if (!techId) this.paintAll();
  }

  /** Where each placeable marker is on screen (viewport pixels), for the drag magnet. */
  screenPoints(): { id: string; x: number; y: number }[] {
    if (this.ctl.zoom() < ZOOM_AVATARS) return [];
    const rect = this.ctl.containerRect();
    const out: { id: string; x: number; y: number }[] = [];
    for (const [id, e] of this.entries) {
      const p = this.ctl.project(e.pos[0], e.pos[1]);
      if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) continue;
      out.push({ id, x: rect.left + p.x, y: rect.top + p.y });
    }
    return out;
  }

  /** Every placed technician, for framing the map. */
  lngLats(): [number, number][] {
    return [...this.entries.values()].map((e) => e.pos);
  }

  /** The map position of a technician, if they have one. */
  positionOf(techId: string): [number, number] | null {
    return this.entries.get(techId)?.pos ?? null;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.offStyle();
    this.offCamera();
    for (const e of this.entries.values()) e.marker.remove();
    this.entries.clear();
    const m = this.ctl.map;
    try {
      if (m.getLayer("tech-dots")) m.removeLayer("tech-dots");
      if (m.getSource(SRC_DOTS)) m.removeSource(SRC_DOTS);
    } catch {
      /* the map is already gone */
    }
  }

  // ── building a marker ──
  private create(t: BoardTech) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ap-tech";
    el.tabIndex = -1;
    el.dataset.tech = t.id;
    const ring = document.createElement("span");
    ring.className = "ap-tech__ring";
    const face = document.createElement("span");
    face.className = "ap-tech__face";
    const badge = document.createElement("span");
    badge.className = "ap-tech__badge";
    const name = document.createElement("span");
    name.className = "ap-tech__name";
    const chip = document.createElement("span");
    chip.className = "ap-tech__chip";
    ring.append(face);
    el.append(ring, badge, name, chip);
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.hooks.onClick(t.id);
    });
    if (window.matchMedia?.("(hover: hover)").matches) {
      el.addEventListener("pointerenter", () => this.hooks.onHover(t.id, el));
      el.addEventListener("pointerleave", () => this.hooks.onHover(null, null));
    }
    const pos: [number, number] = [t.lng!, t.lat!];
    const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(this.ctl.map);
    const entry: Entry = { tech: t, marker, el, face, chip, name, badge, photo: "\0", pos, glide: null };
    this.entries.set(t.id, entry);
    this.fill(entry, t);
  }

  private update(e: Entry, t: BoardTech) {
    const to: [number, number] = [t.lng!, t.lat!];
    if (to[0] !== e.pos[0] || to[1] !== e.pos[1]) this.moveTo(e, to);
    e.tech = t;
    this.fill(e, t);
  }

  private fill(e: Entry, t: BoardTech) {
    const nm = t.name || "Technician";
    e.el.setAttribute("aria-label", `${nm}, ${t.status}${t.stale ? ", location out of date" : ""}`);
    e.el.dataset.status = t.status;
    e.el.style.setProperty("--ap-status", statusColor(t.status));
    e.el.toggleAttribute("data-stale", t.stale);
    e.name.textContent = shortName(nm);
    e.badge.textContent = t.openJobs > 0 ? String(t.openJobs) : "";
    e.badge.hidden = t.openJobs === 0;
    if (e.photo !== t.photoUrl) {
      e.photo = t.photoUrl;
      e.face.replaceChildren();
      if (t.photoUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.src = t.photoUrl;
        img.addEventListener("error", () => {
          e.face.replaceChildren(document.createTextNode(initials(nm)));
        });
        e.face.append(img);
      } else {
        e.face.textContent = initials(nm);
      }
    }
  }

  // ── gliding ──
  private moveTo(e: Entry, to: [number, number]) {
    if (prefersReducedMotion()) {
      e.pos = to;
      e.glide = null;
      e.marker.setLngLat(to);
      return;
    }
    e.glide = { from: e.pos, to, t0: performance.now() };
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    let busy = false;
    for (const e of this.entries.values()) {
      const g = e.glide;
      if (!g) continue;
      const k = Math.min(1, (now - g.t0) / GLIDE_MS);
      const eased = 1 - (1 - k) * (1 - k); // ease-out
      e.pos = [g.from[0] + (g.to[0] - g.from[0]) * eased, g.from[1] + (g.to[1] - g.from[1]) * eased];
      e.marker.setLngLat(e.pos);
      if (k >= 1) e.glide = null;
      else busy = true;
    }
    if (busy) this.raf = requestAnimationFrame(this.tick);
    // The zoomed-out dots only need to catch up once the glide has finished.
    else this.updateDots();
  };

  // ── looks: fit while dragging, selection ──
  private paintAll() {
    for (const [id, e] of this.entries) {
      const f = this.dragFits?.[id];
      if (f) {
        e.el.dataset.fit = f.fit;
        e.el.toggleAttribute("data-best", f.best);
        if (id !== this.target) e.chip.textContent = f.chip;
      } else {
        delete e.el.dataset.fit;
        e.el.removeAttribute("data-best");
        if (!this.dragFits) e.chip.textContent = "";
      }
      e.el.toggleAttribute("data-selected", id === this.selected);
    }
  }

  // ── zoomed-out dots ──
  private installDots() {
    const m = this.ctl.map;
    if (!m.getSource(SRC_DOTS)) m.addSource(SRC_DOTS, { type: "geojson", data: this.dotsData() });
    if (!m.getLayer("tech-dots")) {
      m.addLayer({
        id: "tech-dots",
        type: "circle",
        source: SRC_DOTS,
        maxzoom: ZOOM_AVATARS,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, ZOOM_AVATARS, 6],
          "circle-color": ["get", "c"],
          "circle-stroke-color": "#070b12",
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["==", ["get", "s"], "offline"], 0.45, 1],
        },
      });
    }
  }

  private dotsData(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (const [id, e] of this.entries) {
      features.push({
        type: "Feature",
        id: undefined,
        properties: { id, c: statusColor(e.tech.status), s: e.tech.status },
        geometry: { type: "Point", coordinates: e.pos },
      });
    }
    return { type: "FeatureCollection", features };
  }

  private updateDots() {
    const src = this.ctl.map.getSource(SRC_DOTS) as maplibregl.GeoJSONSource | undefined;
    src?.setData(this.dotsData());
  }

  private applyZoom() {
    const z = this.ctl.zoom();
    const c = this.ctl.container.classList;
    c.toggle("ap-lod-dots", z < ZOOM_AVATARS);
    c.toggle("ap-lod-names", z >= ZOOM_NAMES);
  }
}
