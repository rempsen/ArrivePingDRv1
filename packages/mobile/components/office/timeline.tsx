import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, type GestureResponderEvent } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { DragHandle, type DragCallbacks } from "./drag-handle";
import { ResizeEdge } from "./resize-edge";
import { Warning } from "phosphor-react-native";
import { Avatar } from "../ui";
import { statusColor } from "./tech-row";
import { C, R, S } from "../../lib/theme";
import { STATUS_LABEL, TERMINAL, type OfficeJob, type OfficeTech } from "../../lib/board";
import { GUTTER_W, HOUR_W, ROW_H, bookedMinutes, hoursIn, loadLevel, minLabel, minuteAtX, packLanes, spansFor, timelineRange, xOf, type Range } from "../../lib/timeline";
import { canArmWith, canPlaceOn, type PlacePerms, type PlaceState } from "../../lib/board-place";
import { edgeScroll, hitCell, HEADER_H, lengthLabel, resizedMins, type TimelineGeom } from "../../lib/board-drag";
const LOAD_COLOR = { ok: C.green, high: C.amber, over: C.red } as const;

/** Block colour by where the job is: nobody / offered / accepted / in the field / done. */
export function blockColor(job: Pick<OfficeJob, "assignStatus" | "status">): string {
  if (job.status === "completed") return C.muted;
  if (["enroute", "arrived", "onsite", "in_progress", "paused"].includes(job.status)) return C.green;
  if (job.assignStatus === "offered") return C.amber;
  if (job.assignStatus === "accepted") return C.brand;
  return C.sub;
}

export interface TimelineProps {
  techs: readonly OfficeTech[];
  jobs: readonly OfficeJob[];
  timeOff: ReadonlyArray<{ techId: string; day: string }>;
  day: string;
  tz: string;
  /** Minute of the day right now on the company's clock, or null when `day` isn't today. */
  nowMin: number | null;
  place: PlaceState;
  perms: PlacePerms;
  /** Extra room under the last row, so the placement card doesn't cover it. */
  bottomPad?: number;
  /** Where a dragged job would land right now, drawn as a ghost on that row. */
  hover?: { jobId: string; techId: string; startMin: number; ok: boolean } | null;
  onArm: (job: OfficeJob) => void;
  onTapCell: (techId: string, rawMin: number, range: Range) => void;
  onOpenJob: (jobId: string) => void;
  /** Drag callbacks for one job's block (the board owns the floating copy). */
  dragFor: (job: OfficeJob) => DragCallbacks;
  /** Dragging a block's right edge: the job's new length. Omit to hide the grips. */
  onResize?: (job: OfficeJob, durationMins: number) => Promise<boolean>;
}

/** What the board asks the timeline while a job is dragged over it. */
export interface TimelineHandle {
  /** Refresh the timeline's frame in window coordinates (call when a drag starts). */
  measure: () => void;
  /** The row and raw minute under a window point; null outside the grid. */
  hit: (absX: number, absY: number) => { techId: string; rawMin: number; range: Range } | null;
  /**
   * Nudge the scroll views one step when the finger is near an edge. The
   * board calls it on a timer while a drag is held, so a still finger keeps
   * scrolling. Offsets update at once (not on the next onScroll), so a hit
   * test right after sees where the grid now is. True when it moved.
   */
  edge: (absX: number, absY: number) => boolean;
}

/**
 * Technicians down the side, hours across, jobs as blocks. One vertical
 * scroll holds the gutter and the grid so they stay level; only the grid
 * scrolls sideways. Tapping a block arms it, tapping a row places it (see
 * lib/board-place.ts); a long press opens the job.
 */
export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  { techs, jobs, timeOff, day, tz, nowMin, place, perms, bottomPad = 0, hover = null, onArm, onTapCell, onOpenJob, dragFor, onResize },
  ref,
) {
  const spans = useMemo(() => spansFor(jobs, day, tz), [jobs, day, tz]);
  const range = useMemo(() => timelineRange(spans), [spans]);
  const hours = hoursIn(range);
  const gridW = hours.length * HOUR_W;
  const off = useMemo(() => new Set(timeOff.filter((t) => t.day === day).map((t) => t.techId)), [timeOff, day]);
  const byTech = useMemo(() => {
    const m = new Map<string, typeof spans>();
    for (const s of spans) {
      if (!s.job.riderId) continue;
      m.set(s.job.riderId, [...(m.get(s.job.riderId) ?? []), s]);
    }
    return m;
  }, [spans]);
  const armedId = place.kind === "idle" ? null : place.jobId;
  const armedJob = armedId ? jobs.find((j) => j.id === armedId) : undefined;
  const target = place.kind === "confirm" ? place : null;
  const targetJob = target ? jobs.find((j) => j.id === target.jobId) : undefined;
  const hoverJob = hover ? jobs.find((j) => j.id === hover.jobId) : undefined;

  // The length a block's edge is being dragged to. Kept after release until
  // the board's next read shows the job at that length (or 5 s pass), so the
  // block doesn't jump back while the save is in flight.
  const [resize, setResize] = useState<{ jobId: string; mins: number; done?: boolean } | null>(null);
  useEffect(() => {
    if (!resize?.done) return;
    const j = jobs.find((x) => x.id === resize.jobId);
    if (!j || j.durationMins === resize.mins) {
      setResize(null);
      return;
    }
    const t = setTimeout(() => setResize(null), 5_000);
    return () => clearTimeout(t);
  }, [jobs, resize]);

  // Drag geometry: the vertical scroll view's window frame plus both offsets.
  const frameRef = useRef<View>(null);
  const vRef = useRef<ScrollView>(null);
  const hRef = useRef<ScrollView>(null);
  const geom = useRef<TimelineGeom>({ x: 0, y: 0, w: 0, h: 0, scrollX: 0, scrollY: 0 });
  const measured = useRef(false);
  const contentH = useRef(0);
  const techIds = useMemo(() => techs.map((t) => t.id), [techs]);
  useImperativeHandle(
    ref,
    () => ({
      measure: () => {
        // A plain View around the scroll view has the same frame and a reliable measureInWindow.
        frameRef.current?.measureInWindow((x, y, w, h) => {
          geom.current = { ...geom.current, x, y, w, h };
          measured.current = true;
        });
      },
      hit: (absX, absY) => {
        if (!measured.current) return null;
        const r = hitCell(geom.current, absX, absY, techIds, range);
        return r ? { ...r, range } : null;
      },
      edge: (absX, absY) => {
        if (!measured.current) return false;
        const g = geom.current;
        const { dx, dy } = edgeScroll(g, absX, absY);
        const maxX = Math.max(0, gridW - (g.w - GUTTER_W));
        const maxY = Math.max(0, contentH.current - g.h);
        const nx = Math.min(maxX, Math.max(0, g.scrollX + dx));
        const ny = Math.min(maxY, Math.max(0, g.scrollY + dy));
        if (nx === g.scrollX && ny === g.scrollY) return false;
        if (nx !== g.scrollX) hRef.current?.scrollTo({ x: nx, animated: false });
        if (ny !== g.scrollY) vRef.current?.scrollTo({ y: ny, animated: false });
        geom.current = { ...g, scrollX: nx, scrollY: ny };
        return true;
      },
    }),
    [techIds, range, gridW],
  );

  return (
    <View ref={frameRef} style={s.vertical} collapsable={false}>
    <ScrollView
      ref={vRef}
      style={s.vertical}
      contentContainerStyle={{ paddingBottom: S.xxl + bottomPad }}
      scrollEventThrottle={16}
      onContentSizeChange={(_w, h) => {
        contentH.current = h;
      }}
      onScroll={(e) => {
        geom.current.scrollY = e.nativeEvent.contentOffset.y;
      }}
    >
      <View style={s.row}>
        {/* Gutter: who, how their day is going, how full it is. */}
        <View style={s.gutter}>
          <View style={[s.gutterHead, { height: HEADER_H }]}>
            <Text style={s.gutterHeadTxt}>{techs.length} on roster</Text>
          </View>
          {techs.map((t) => {
            const mine = byTech.get(t.id) ?? [];
            const booked = bookedMinutes(mine.map((x) => x.job));
            const lvl = loadLevel(booked);
            const dayOff = off.has(t.id);
            return (
              <View key={t.id} style={[s.gutterRow, { height: ROW_H }]}>
                <View>
                  <Avatar name={t.name} photoUrl={t.photoUrl} color={t.color} size={36} />
                  <View style={[s.dot, { backgroundColor: statusColor(t.status) }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={[s.status, { color: dayOff ? C.muted : statusColor(t.status) }]} numberOfLines={1}>
                    {dayOff ? "Day off" : (STATUS_LABEL[t.status] ?? t.status)}
                  </Text>
                  <View style={s.loadBar}>
                    <View style={[s.loadFill, { width: `${Math.min(100, (booked / 480) * 100)}%`, backgroundColor: LOAD_COLOR[lvl] }]} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* Grid: hour header, one row per technician, blocks laid by lane. */}
        <ScrollView
          ref={hRef}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          contentContainerStyle={{ width: gridW }}
          scrollEventThrottle={16}
          onScroll={(e) => {
            geom.current.scrollX = e.nativeEvent.contentOffset.x;
          }}
        >
          <View style={{ width: gridW }}>
            <View style={[s.hours, { height: HEADER_H }]}>
              {hours.map((h) => (
                <View key={h} style={[s.hour, { width: HOUR_W }]}>
                  <Text style={s.hourTxt}>{minLabel(h * 60).replace(":00", "")}</Text>
                </View>
              ))}
            </View>
            {techs.map((t) => {
              const mine = byTech.get(t.id) ?? [];
              const lanes = new Map(packLanes(mine).map((l) => [l.id, l]));
              const dayOff = off.has(t.id);
              const placeable = !!armedJob && canPlaceOn(armedJob, t.id, dayOff, perms);
              return (
                <Pressable
                  key={t.id}
                  disabled={!placeable}
                  onPress={(e: GestureResponderEvent) => onTapCell(t.id, minuteAtX(e.nativeEvent.locationX, range), range)}
                  accessibilityRole={placeable ? "button" : undefined}
                  accessibilityLabel={placeable ? `Place on ${t.name}'s row` : undefined}
                  style={[s.techRow, { height: ROW_H }, dayOff && s.rowOff, placeable && s.rowPlaceable]}
                >
                  {hours.map((h) => (
                    <View key={h} pointerEvents="none" style={[s.gridLine, { left: xOf(h * 60, range) }]} />
                  ))}
                  {dayOff ? (
                    <Text pointerEvents="none" style={s.offTxt}>
                      Off
                    </Text>
                  ) : null}
                  {mine.map((sp) => {
                    const lane = lanes.get(sp.id)!;
                    const left = xOf(sp.startMin, range);
                    const resizing = resize && resize.jobId === sp.id ? resize : null;
                    const endMin = resizing ? sp.startMin + resizing.mins : sp.endMin;
                    const width = Math.max(28, xOf(endMin, range) - left - 2);
                    const h = lane.lanes === 2 ? (ROW_H - 10) / 2 : ROW_H - 10;
                    const top = 5 + lane.lane * ((ROW_H - 10) / 2);
                    const color = blockColor(sp.job);
                    const armed = sp.id === armedId;
                    const movable = canArmWith(sp.job, perms);
                    const lifted = (target && target.jobId === sp.id) || (hover && hover.jobId === sp.id);
                    const sizable = !!onResize && !TERMINAL.has(sp.job.status) && !lifted && !armed;
                    const baseMins = sp.job.durationMins || sp.endMin - sp.startMin;
                    return (
                      <View key={sp.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
                      <DragHandle
                        movable={movable}
                        onTap={() => (movable ? onArm(sp.job) : onOpenJob(sp.id))}
                        onOpen={() => onOpenJob(sp.id)}
                        drag={dragFor(sp.job)}
                        accessibilityLabel={`${sp.job.customerName || sp.job.title}, ${minLabel(sp.startMin)}${movable ? ", tap to move, hold and drag to move, hold to open" : ""}`}
                        selected={armed}
                        style={[
                          s.block,
                          { left, width, top, height: h, borderColor: armed ? C.text : color, backgroundColor: color + (armed ? "55" : "26") },
                          lane.conflict && s.conflict,
                          { opacity: lifted ? 0.35 : 1 },
                        ]}
                      >
                        <Text style={[s.blockTime, { color }]} numberOfLines={1} allowFontScaling={false}>
                          {minLabel(sp.startMin)}
                          {lane.conflict ? "  ⚠" : ""}
                        </Text>
                        {h > 30 ? (
                          <Text style={s.blockTxt} numberOfLines={1}>
                            {sp.job.customerName || sp.job.title}
                          </Text>
                        ) : null}
                        {resizing ? (
                          <Text style={[s.blockSub, { color: C.text, fontWeight: "800" }]} numberOfLines={1}>
                            {lengthLabel(resizing.mins)}
                          </Text>
                        ) : h > 48 ? (
                          <Text style={s.blockSub} numberOfLines={1}>
                            {sp.job.service}
                          </Text>
                        ) : null}
                      </DragHandle>
                      {sizable ? (
                        <ResizeEdge
                          left={left + width - 10}
                          top={top}
                          height={h}
                          color={color}
                          label={`Change how long ${sp.job.customerName || sp.job.title} takes, now ${lengthLabel(baseMins)}`}
                          onMove={(dx) => setResize({ jobId: sp.id, mins: resizedMins(sp.startMin, baseMins, dx, HOUR_W) })}
                          onEnd={(dx) => {
                            if (dx == null) return setResize(null);
                            const mins = resizedMins(sp.startMin, baseMins, dx, HOUR_W);
                            if (mins === baseMins) return setResize(null);
                            setResize({ jobId: sp.id, mins, done: true });
                            // Not saved (refused, cancelled at the prompt): snap back.
                            onResize!(sp.job, mins).then((ok) => {
                              if (!ok) setResize(null);
                            });
                          }}
                        />
                      ) : null}
                      </View>
                    );
                  })}
                  {/* Where the dragged job would land: dashed, red when it can't go there. */}
                  {hover && hover.techId === t.id && hoverJob ? (
                    <View
                      pointerEvents="none"
                      style={[
                        s.block,
                        s.ghost,
                        !hover.ok && s.ghostNo,
                        { left: xOf(hover.startMin, range), width: Math.max(28, xOf(hover.startMin + Math.max(15, hoverJob.durationMins || 60), range) - xOf(hover.startMin, range) - 2), top: 5, height: ROW_H - 10 },
                      ]}
                    >
                      <Text style={[s.blockTime, { color: hover.ok ? C.text : C.red }]} allowFontScaling={false}>
                        {hover.ok ? minLabel(hover.startMin) : "Can't place here"}
                      </Text>
                      <Text style={s.blockTxt} numberOfLines={1}>
                        {hoverJob.customerName || hoverJob.title}
                      </Text>
                    </View>
                  ) : null}
                  {/* The block's new place, before it's confirmed. */}
                  {target && target.techId === t.id && targetJob ? (
                    <View
                      pointerEvents="none"
                      style={[
                        s.block,
                        s.ghost,
                        { left: xOf(target.startMin, range), width: Math.max(28, xOf(target.startMin + Math.max(15, targetJob.durationMins || 60), range) - xOf(target.startMin, range) - 2), top: 5, height: ROW_H - 10 },
                      ]}
                    >
                      <Text style={[s.blockTime, { color: C.text }]} allowFontScaling={false}>
                        {minLabel(target.startMin)}
                      </Text>
                      <Text style={s.blockTxt} numberOfLines={1}>
                        {targetJob.customerName || targetJob.title}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
            {nowMin != null && nowMin >= range.startMin && nowMin <= range.endMin ? (
              <View pointerEvents="none" style={[s.now, { left: xOf(nowMin, range), top: HEADER_H, height: techs.length * ROW_H }]} />
            ) : null}
            {techs.length === 0 ? (
              <View style={s.emptyGrid}>
                <Warning color={C.muted} size={20} />
                <Text style={s.emptyTxt}>No technicians on the roster.</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
    </View>
  );
});

const s = StyleSheet.create({
  vertical: { flex: 1 },
  row: { flexDirection: "row" },
  gutter: { width: GUTTER_W, borderRightWidth: 1, borderRightColor: C.border, backgroundColor: C.bg },
  gutterHead: { justifyContent: "center", paddingHorizontal: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  gutterHeadTxt: { color: C.muted, fontSize: 11, fontWeight: "700" },
  gutterRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg },
  name: { color: C.text, fontSize: 13, fontWeight: "700" },
  status: { fontSize: 10, fontWeight: "800", marginTop: 1 },
  loadBar: { height: 3, borderRadius: 2, backgroundColor: C.bg3, marginTop: 5, overflow: "hidden" },
  loadFill: { height: 3, borderRadius: 2 },
  hours: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  hour: { justifyContent: "center", paddingLeft: 6, borderLeftWidth: 1, borderLeftColor: C.border },
  hourTxt: { color: C.muted, fontSize: 11, fontWeight: "700" },
  techRow: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowOff: { backgroundColor: "rgba(255,255,255,0.03)" },
  rowPlaceable: { backgroundColor: "rgba(14,165,233,0.06)" },
  gridLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: C.border },
  offTxt: { position: "absolute", left: 10, top: 6, color: C.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  block: { position: "absolute", borderRadius: R.control, borderWidth: 1.5, paddingHorizontal: 6, paddingVertical: 3, overflow: "hidden", justifyContent: "center" },
  conflict: { borderColor: C.red },
  ghost: { borderStyle: "dashed", borderColor: C.text, backgroundColor: "rgba(255,255,255,0.08)" },
  ghostNo: { borderColor: C.red, backgroundColor: "rgba(239,68,68,0.10)" },
  blockTime: { fontSize: 10, fontWeight: "800" },
  blockTxt: { color: C.text, fontSize: 12, fontWeight: "700" },
  blockSub: { color: C.sub, fontSize: 11 },
  now: { position: "absolute", width: 2, backgroundColor: C.brand, opacity: 0.8 },
  emptyGrid: { flexDirection: "row", alignItems: "center", gap: S.sm, padding: S.lg },
  emptyTxt: { color: C.muted, fontSize: 13 },
});
