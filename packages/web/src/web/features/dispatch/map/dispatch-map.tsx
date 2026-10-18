/**
 * The map surface. Thin React wrapper that owns one MapController and the three
 * layers on it (technician markers, job pins, assign line), and keeps them in
 * step with the board. It renders no panels: the page lays those over the top
 * and hands its occupied edges in as `padding`.
 */
import "maplibre-gl-6/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { BoardJob } from "../data/types";
import type { Board } from "../data/types";
import { AssignLine } from "./assign-line";
import { JobLayer, type JobHit } from "./job-layer";
import { createMapController, type LngLat, type MapController, type Padding } from "./map-controller";
import type { MapMode } from "./style";
import { TechMarkers, type DragFit } from "./tech-markers";

export interface DispatchMapHandle {
  controller(): MapController | null;
  techs(): TechMarkers | null;
  jobs(): JobLayer | null;
  line(): AssignLine | null;
  fitAll(): void;
  focus(point: LngLat, zoom?: number): void;
}

interface Props {
  board: Board | undefined;
  mode: MapMode;
  selectedTech: string | null;
  selectedJob: string | null;
  hoverJob?: string | null;
  padding: Padding;
  /** Which jobs show as pins (the queue filter). */
  showJob?: (j: BoardJob) => boolean;
  onSelectTech(id: string | null): void;
  onSelectJob(id: string | null): void;
  onHoverTech?(id: string | null, el: HTMLElement | null): void;
  onReady?(h: DispatchMapHandle): void;
}

const FALLBACK: LngLat = [-97.14, 49.9]; // Winnipeg, until the board says otherwise

export const DispatchMap = forwardRef<DispatchMapHandle, Props>(function DispatchMap(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const parts = useRef<{ ctl: MapController; techs: TechMarkers; jobs: JobLayer; line: AssignLine } | null>(null);
  const framed = useRef(false);

  const handle: DispatchMapHandle = {
    controller: () => parts.current?.ctl ?? null,
    techs: () => parts.current?.techs ?? null,
    jobs: () => parts.current?.jobs ?? null,
    line: () => parts.current?.line ?? null,
    fitAll() {
      const p = parts.current;
      if (!p) return;
      const pts = [...p.techs.lngLats(), ...p.jobs.points()];
      if (pts.length) p.ctl.fitTo(pts, { maxZoom: 13 });
    },
    focus: (pt, z) => parts.current?.ctl.flyTo(pt, z),
  };
  useImperativeHandle(ref, () => handle);

  // Create once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const o = live.current.board?.office;
    const ctl = createMapController(el, {
      mode: live.current.mode,
      center: o ? [o.lng, o.lat] : FALLBACK,
      zoom: 10,
    });
    const techs = new TechMarkers(ctl, {
      onClick: (id) => live.current.onSelectTech(id),
      onHover: (id, node) => live.current.onHoverTech?.(id, node),
    });
    const jobs = new JobLayer(ctl);
    const line = new AssignLine(ctl);
    parts.current = { ctl, techs, jobs, line };

    // Clicks on the bare map: a pin selects, a cluster opens, empty space deselects.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const onClick = (e: { point: { x: number; y: number } }) => {
      const hit: JobHit | null = jobs.hit(e.point.x, e.point.y, coarse ? 14 : 8);
      if (!hit) {
        live.current.onSelectJob(null);
        live.current.onSelectTech(null);
      } else if (hit.type === "job") {
        live.current.onSelectJob(hit.id);
      } else {
        jobs.expand(hit.clusterId, hit.lngLat);
      }
    };
    ctl.map.on("click", onClick);
    const onMove = (e: { point: { x: number; y: number } }) => {
      if (coarse) return;
      const hit = jobs.hit(e.point.x, e.point.y, 6);
      jobs.setHover(hit?.type === "job" ? hit.id : null);
      ctl.map.getCanvas().style.cursor = hit ? "pointer" : "";
    };
    ctl.map.on("mousemove", onMove);

    live.current.onReady?.(handle);
    return () => {
      ctl.map.off("click", onClick);
      ctl.map.off("mousemove", onMove);
      line.destroy();
      jobs.destroy();
      techs.destroy();
      ctl.destroy();
      parts.current = null;
      framed.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Board -> markers and pins.
  useEffect(() => {
    const p = parts.current;
    if (!p || !props.board) return;
    p.techs.sync(props.board.techs, props.selectedTech);
    p.jobs.sync(props.board.jobs, Date.now(), props.showJob);
    if (!framed.current) {
      const pts = [...p.techs.lngLats(), ...p.jobs.points()];
      if (pts.length) {
        framed.current = true;
        p.ctl.fitTo(pts, { duration: 0, maxZoom: 13 });
      }
    }
  }, [props.board, props.showJob, props.selectedTech]);

  useEffect(() => {
    parts.current?.jobs.setSelected(props.selectedJob);
  }, [props.selectedJob]);
  useEffect(() => {
    parts.current?.jobs.setHover(props.hoverJob ?? null);
  }, [props.hoverJob]);
  useEffect(() => {
    parts.current?.ctl.setMode(props.mode);
  }, [props.mode]);
  const { top, right, bottom, left } = props.padding;
  useEffect(() => {
    parts.current?.ctl.setPadding({ top, right, bottom, left });
  }, [top, right, bottom, left]);

  return <div ref={host} className="ap-map" data-testid="dispatch-map" />;
});

export type { DragFit };
