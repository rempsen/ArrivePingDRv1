import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Warning, X, Check } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { DayStrip, STRIP_DAYS } from "../../components/office/day-strip";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Timeline, type TimelineHandle } from "../../components/office/timeline";
import type { DragCallbacks } from "../../components/office/drag-handle";
import { QueueColumn } from "../../components/office/queue-column";
import { WeekGrid } from "../../components/office/week-grid";
import { showToast } from "../../components/office/undo-toast";
import { Button, Empty, ListSkeleton } from "../../components/ui";
import { C, R, S } from "../../lib/theme";
import { useBoard, useDayLoad } from "../../lib/use-board";
import { useAccess } from "../../lib/use-access";
import { useLayout } from "../../lib/use-layout";
import { useDispatchActions } from "../../lib/use-dispatch-actions";
import { addDays, isUnassigned, NO_JOBS, NO_TECHS } from "../../lib/board";
import { IDLE, canPlaceOn, placeReducer, placedStart, placementRequest } from "../../lib/board-place";
import { jobMinutes, minLabel, mondayOf, type Range } from "../../lib/timeline";
import { fmtInTz } from "../../lib/when";

/**
 * Board: the whole crew's day on one screen (iPad only — the tab hides on a
 * phone). Jobs sit on their technician's row by time; the Unassigned column
 * holds the rest. Two ways to move work, both ending at the same confirm
 * card: tap a job then tap a time on a row, or hold a job and drag it onto
 * a row (lib/board-drag.ts). Place runs the same assign / schedule calls as
 * the Assign sheet, with the server's conflict reasons and Undo.
 */
export default function Board() {
  const router = useRouter();
  const { can } = useAccess();
  // Every placement sets a time (scheduler:edit); landing on another
  // technician is also an assignment (work_orders:edit). See lib/board-place.ts.
  const perms = { schedule: can("scheduler:edit"), assign: can("scheduler:edit") && can("work_orders:edit") };
  const actions = useDispatchActions();
  const [day, setDay] = useState<string | null>(null);
  const [view, setView] = useState<"day" | "week">("day");
  const board = useBoard(day);
  const [place, dispatch] = useReducer(placeReducer, IDLE);
  // The tab hides at phone width (Split View narrowed mid-session); the
  // screen itself goes with it.
  const { wide } = useLayout();
  useEffect(() => {
    if (!wide) router.replace("/(office)/jobs");
  }, [wide, router]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // "Today" on the company's clock, learned from the first (day-less) read.
  const [anchor, setAnchor] = useState<string | null>(null);
  const serverDay = board.data?.day;
  useEffect(() => {
    if (day === null && serverDay) setAnchor(serverDay);
  }, [day, serverDay]);
  // Today's "Plan tomorrow" / "Plan the week" land here (one-shot, cleared).
  const params = useLocalSearchParams<{ day?: string; anchor?: string; view?: string }>();
  useEffect(() => {
    if (!params.day && !params.view) return;
    const today = anchor ?? params.anchor ?? null;
    if (params.anchor && !anchor) setAnchor(params.anchor);
    if (params.day) setDay(params.day === today ? null : params.day);
    if (params.view === "day" || params.view === "week") setView(params.view);
    router.setParams({ day: undefined, anchor: undefined, view: undefined });
  }, [params.day, params.anchor, params.view, anchor, router]);
  // First day on the strip; yesterday until the dispatcher pages to another week.
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => {
    if (anchor && from === null) setFrom(addDays(anchor, -1));
  }, [anchor, from]);
  const load = useDayLoad(from, STRIP_DAYS);
  // The week holding the shown day, Monday first; fetched only while the Week view is up.
  const weekFrom = anchor ? mondayOf(day ?? anchor) : null;
  const week = useBoard(weekFrom, view === "week" && !!weekFrom, 7);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of load.data?.days ?? []) m[d.day] = d.jobs;
    return m;
  }, [load.data]);

  // The "now" line moves on its own.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const techs = board.data?.techs ?? NO_TECHS;
  const jobs = board.data?.jobs ?? NO_JOBS;
  const tz = board.data?.tz ?? "UTC";
  const shownDay = board.data?.day ?? day ?? "";
  const jobNoun = board.data?.jobNoun ?? "jobs";
  const queue = useMemo(() => jobs.filter(isUnassigned).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)), [jobs]);
  const nowParts = jobMinutes(now.toISOString(), tz);
  const nowMin = nowParts.day === shownDay ? nowParts.min : null;

  // An armed job that left the board (done elsewhere, other day picked) disarms.
  useEffect(() => {
    if (place.kind !== "idle" && board.data && !board.data.jobs.some((j) => j.id === place.jobId)) dispatch({ type: "cancel" });
  }, [place, board.data]);

  // Switching to the week drops a half-done placement.
  useEffect(() => {
    if (view === "week") dispatch({ type: "cancel" });
  }, [view]);

  const armedJob = place.kind === "idle" ? undefined : jobs.find((j) => j.id === place.jobId);

  // ------------------------------------------------------- drag and drop --
  // The job in the air follows the finger as a floating card (shared values,
  // so it moves on the UI thread); the timeline answers "which row, what
  // time" and draws a dashed ghost there. Dropping fills in the same confirm
  // card as tap-to-place.
  const rootRef = useRef<View>(null);
  const tlRef = useRef<TimelineHandle>(null);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const [dragging, setDragging] = useState<(typeof jobs)[number] | null>(null);
  const [hover, setHover] = useState<{ jobId: string; techId: string; startMin: number; ok: boolean } | null>(null);
  const hoverKey = useRef("");
  const dayOff = useMemo(() => new Set((board.data?.timeOff ?? []).filter((t) => t.day === shownDay).map((t) => t.techId)), [board.data, shownDay]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateX: fx.value - ox.value - 90 }, { translateY: fy.value - oy.value - 30 }] }));

  const landing = (job: (typeof jobs)[number], absX: number, absY: number) => {
    const h = tlRef.current?.hit(absX, absY);
    if (!h) return null;
    return { techId: h.techId, startMin: placedStart(h.rawMin, job, h.range), ok: canPlaceOn(job, h.techId, dayOff.has(h.techId), perms) };
  };
  const endDrag = () => {
    setDragging(null);
    setHover(null);
    hoverKey.current = "";
  };
  const dragFor = (job: (typeof jobs)[number]): DragCallbacks => ({
    onDragStart: (absX, absY) => {
      rootRef.current?.measureInWindow((x, y) => {
        ox.value = x;
        oy.value = y;
      });
      tlRef.current?.measure();
      dispatch({ type: "cancel" });
      fx.value = absX;
      fy.value = absY;
      setDragging(job);
    },
    onDragMove: (absX, absY) => {
      fx.value = absX;
      fy.value = absY;
      tlRef.current?.edge(absX, absY);
      const l = landing(job, absX, absY);
      const key = l ? `${l.techId}:${l.startMin}:${l.ok}` : "";
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      setHover(l ? { jobId: job.id, ...l } : null);
    },
    onDrop: (absX, absY) => {
      const l = landing(job, absX, absY);
      endDrag();
      if (!l) return;
      if (!l.ok) {
        const who = techs.find((t) => t.id === l.techId)?.name ?? "That person";
        showToast(dayOff.has(l.techId) ? `${who} is off that day` : `You can't move work onto ${who}'s row`);
        return;
      }
      dispatch({ type: "arm", jobId: job.id });
      dispatch({ type: "tapCell", techId: l.techId, startMin: l.startMin });
    },
    onDragCancel: endDrag,
  });
  const targetTech = place.kind === "confirm" ? techs.find((t) => t.id === place.techId) : undefined;

  function tapCell(techId: string, rawMin: number, range: Range) {
    if (!armedJob) return;
    dispatch({ type: "tapCell", techId, startMin: placedStart(rawMin, armedJob, range) });
  }

  async function confirm(overrides: { force?: boolean; forceBusy?: boolean } = {}) {
    if (place.kind !== "confirm" || !armedJob || !targetTech) return;
    const req = placementRequest(armedJob, place.techId, place.startMin, shownDay, tz);
    const label = armedJob.customerName || armedJob.title || "Job";
    setBusy(true);
    const r =
      req.kind === "assign"
        ? await actions.assign(armedJob.id, req.riderId, { scheduledAt: req.scheduledAt, expectRiderId: req.expectRiderId, force: !!overrides.force, forceBusy: !!overrides.forceBusy })
        : await actions.schedule(armedJob.id, req.scheduledAt, { force: !!overrides.force || !!overrides.forceBusy });
    setBusy(false);
    if (r.ok) {
      dispatch({ type: "done" });
      const token = r.undo;
      showToast(req.kind === "assign" ? `${label} → ${targetTech.name}, ${minLabel(place.startMin)}` : `${label} moved to ${fmtInTz(req.scheduledAt, tz)}`, {
        onUndo: token
          ? async () => {
              const u = await actions.undo(token, armedJob.id);
              if (!u.ok) Alert.alert("Couldn't undo", u.message);
            }
          : undefined,
      });
      return;
    }
    if (r.forceable) {
      // Same split as the Assign sheet: a reason means an availability clash
      // (forceBusy); none means the job is in the field (force).
      const next = r.reason ? { ...overrides, forceBusy: true } : { ...overrides, force: true };
      Alert.alert("Place it anyway?", r.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Place anyway", style: "destructive", onPress: () => confirm(next) },
      ]);
      return;
    }
    Alert.alert("Couldn't place", r.message);
  }

  const segment = (
    <View style={s.segments}>
      {(["day", "week"] as const).map((v) => {
        const on = view === v;
        return (
          <Pressable key={v} onPress={() => setView(v)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.seg, on && s.segOn]}>
            <Text style={[s.segTxt, on && s.segTxtOn]}>{v === "day" ? "Day" : "Week"}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View ref={rootRef} style={s.screen} collapsable={false}>
      <OfficeHeader title="Board" right={segment} />
      {anchor && from ? (
        <DayStrip today={anchor} day={day ?? anchor} from={from} counts={counts} onChange={(d) => setDay(d === anchor ? null : d)} onFrom={setFrom} />
      ) : null}

      {view === "week" ? (
        week.isLoading || !weekFrom ? (
          <View style={{ padding: S.lg }}>
            <ListSkeleton rows={4} height={72} />
          </View>
        ) : week.isError ? (
          <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load the week" sub={(week.error as Error)?.message} />
        ) : (
          <View style={s.body}>
            <WeekGrid
              techs={week.data?.techs ?? NO_TECHS}
              jobs={week.data?.jobs ?? NO_JOBS}
              timeOff={week.data?.timeOff ?? []}
              tz={week.data?.tz ?? tz}
              from={weekFrom}
              today={anchor ?? ""}
              onPickDay={(d) => {
                setDay(d === anchor ? null : d);
                setView("day");
              }}
            />
            {week.data?.truncated ? <TruncatedNote /> : null}
          </View>
        )
      ) : board.isLoading ? (
        <View style={{ padding: S.lg }}>
          <ListSkeleton rows={4} height={72} />
        </View>
      ) : board.isError ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load the board" sub={(board.error as Error)?.message} />
      ) : (
        <View style={s.body}>
          <Timeline
            ref={tlRef}
            hover={hover}
            dragFor={dragFor}
            techs={techs}
            jobs={jobs}
            timeOff={board.data?.timeOff ?? []}
            day={shownDay}
            tz={tz}
            nowMin={nowMin}
            place={place}
            perms={perms}
            bottomPad={place.kind === "idle" ? 0 : 140}
            onArm={(job) => dispatch({ type: "arm", jobId: job.id })}
            onTapCell={tapCell}
            onOpenJob={(id) => router.push(`/office/job/${id}`)}
          />
          {board.data?.truncated ? <TruncatedNote /> : null}
          <QueueColumn
            jobs={queue}
            jobNoun={jobNoun}
            day={shownDay}
            tz={tz}
            armedId={place.kind === "idle" ? null : place.jobId}
            perms={perms}
            dragFor={dragFor}
            draggingId={dragging?.id ?? null}
            onArm={(job) => dispatch({ type: "arm", jobId: job.id })}
            onOpenJob={(id) => router.push(`/office/job/${id}`)}
          />
        </View>
      )}

      {/* Armed: say what to do next. Confirm: say what will happen, then do it. */}
      {place.kind === "armed" && armedJob ? (
        <View style={s.banner} accessibilityLiveRegion="polite">
          <Text style={s.bannerTxt} numberOfLines={1}>
            Tap a time on a {board.data?.workerNoun?.replace(/s$/, "") ?? "technician"}'s row for <Text style={s.bold}>{armedJob.customerName || armedJob.title}</Text>, or hold and drag it there
          </Text>
          <Pressable onPress={() => dispatch({ type: "cancel" })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel placing">
            <X color={C.text} size={18} />
          </Pressable>
        </View>
      ) : null}
      {place.kind === "confirm" && armedJob && targetTech ? (
        <View style={s.confirm} accessibilityLiveRegion="polite">
          <Text style={s.confirmTxt}>
            {armedJob.riderId === targetTech.id ? "Move" : "Send"} <Text style={s.bold}>{armedJob.customerName || armedJob.title}</Text> to{" "}
            <Text style={s.bold}>{targetTech.name}</Text> at <Text style={s.bold}>{minLabel(place.startMin)}</Text>?
          </Text>
          <Text style={s.confirmSub}>Tap another time, or drag again, to adjust.</Text>
          <View style={s.confirmBtns}>
            <Button title="Cancel" variant="ghost" small onPress={() => dispatch({ type: "cancel" })} />
            <Button title="Place" small loading={busy} icon={<Check color="#04121c" size={16} weight="bold" />} onPress={() => confirm()} />
          </View>
        </View>
      ) : null}

      {/* The job in the air. */}
      {dragging ? (
        <Animated.View pointerEvents="none" style={[s.float, floatStyle]}>
          <Text style={s.floatTime} allowFontScaling={false}>
            {hover?.ok ? minLabel(hover.startMin) : minLabel(jobMinutes(dragging.scheduledAt, tz).min)}
            {dragging.durationMins ? ` · ${dragging.durationMins} min` : ""}
          </Text>
          <Text style={s.floatName} numberOfLines={1}>
            {dragging.customerName || dragging.title}
          </Text>
          <Text style={s.floatSub} numberOfLines={1}>
            {hover ? (hover.ok ? (techs.find((t) => t.id === hover.techId)?.name ?? "") : "Can't place here") : "Drop on a row"}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** The server caps a board read; counts and bars below it are partial. */
function TruncatedNote() {
  return (
    <View style={s.truncated} accessibilityLiveRegion="polite">
      <Warning color={C.amber} size={14} weight="fill" />
      <Text style={s.truncatedTxt}>Too many jobs to show them all — these counts are partial. Use the web console for the full picture.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  truncated: { position: "absolute", top: S.sm, left: S.sm, right: S.sm, flexDirection: "row", alignItems: "center", gap: S.sm, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.amber, borderRadius: R.control, paddingHorizontal: S.md, paddingVertical: 6 },
  truncatedTxt: { color: C.text, fontSize: 12, flex: 1 },
  body: { flex: 1, flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border },
  segments: { flexDirection: "row", backgroundColor: C.bg3, borderRadius: R.pill, padding: 3, borderWidth: 1, borderColor: C.border },
  seg: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: R.pill },
  segOn: { backgroundColor: C.brand },
  segTxt: { color: C.sub, fontSize: 12, fontWeight: "800" },
  segTxtOn: { color: "#04121c" },
  banner: { position: "absolute", left: S.lg, right: S.lg, bottom: S.lg, flexDirection: "row", alignItems: "center", gap: S.md, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.brand, borderRadius: R.card, paddingHorizontal: S.lg, paddingVertical: S.md },
  bannerTxt: { color: C.text, fontSize: 14, flex: 1 },
  bold: { fontWeight: "800", color: C.text },
  confirm: { position: "absolute", left: S.lg, right: S.lg, bottom: S.lg, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.card, padding: S.lg, gap: S.xs },
  confirmTxt: { color: C.text, fontSize: 15 },
  confirmSub: { color: C.muted, fontSize: 12 },
  confirmBtns: { flexDirection: "row", justifyContent: "flex-end", gap: S.sm, marginTop: S.sm },
  float: { position: "absolute", left: 0, top: 0, width: 180, borderRadius: R.control, borderWidth: 1.5, borderColor: C.text, backgroundColor: C.bg3, paddingHorizontal: S.sm, paddingVertical: 6, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  floatTime: { color: C.brand, fontSize: 11, fontWeight: "800" },
  floatName: { color: C.text, fontSize: 14, fontWeight: "800" },
  floatSub: { color: C.sub, fontSize: 11 },
});
