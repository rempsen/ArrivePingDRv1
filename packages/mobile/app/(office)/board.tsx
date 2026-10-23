import { useEffect, useMemo, useReducer, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Warning, X, Check } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { DayStrip } from "../../components/office/day-strip";
import { Timeline } from "../../components/office/timeline";
import { QueueColumn } from "../../components/office/queue-column";
import { WeekGrid } from "../../components/office/week-grid";
import { showToast } from "../../components/office/undo-toast";
import { Button, Empty, ListSkeleton } from "../../components/ui";
import { C, R, S } from "../../lib/theme";
import { useBoard, useDayLoad } from "../../lib/use-board";
import { useAccess } from "../../lib/use-access";
import { useDispatchActions } from "../../lib/use-dispatch-actions";
import { addDays, isUnassigned, NO_JOBS, NO_TECHS } from "../../lib/board";
import { IDLE, placeReducer, placedStart, placementRequest } from "../../lib/board-place";
import { jobMinutes, minLabel, mondayOf, type Range } from "../../lib/timeline";
import { fmtInTz } from "../../lib/when";

/**
 * Board: the whole crew's day on one screen (iPad only — the tab hides on a
 * phone). Jobs sit on their technician's row by time; the Unassigned column
 * holds the rest. Moving work is tap-to-place: tap a job, tap a time on a
 * row, confirm. The same assign / schedule calls as the Assign sheet, with
 * the server's conflict reasons and Undo.
 */
export default function Board() {
  const router = useRouter();
  const { can } = useAccess();
  const canEdit = can("work_orders:edit");
  const actions = useDispatchActions();
  const [day, setDay] = useState<string | null>(null);
  const [view, setView] = useState<"day" | "week">("day");
  const board = useBoard(day);
  const [place, dispatch] = useReducer(placeReducer, IDLE);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // "Today" on the company's clock, learned from the first (day-less) read.
  const [anchor, setAnchor] = useState<string | null>(null);
  const serverDay = board.data?.day;
  useEffect(() => {
    if (day === null && serverDay) setAnchor(serverDay);
  }, [day, serverDay]);
  const load = useDayLoad(anchor ? addDays(anchor, -1) : null, 9);
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
    <View style={s.screen}>
      <OfficeHeader title="Board" right={segment} />
      {anchor ? <DayStrip today={anchor} day={day ?? anchor} counts={counts} onChange={(d) => setDay(d === anchor ? null : d)} /> : null}

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
            techs={techs}
            jobs={jobs}
            timeOff={board.data?.timeOff ?? []}
            day={shownDay}
            tz={tz}
            nowMin={nowMin}
            place={place}
            canEdit={canEdit}
            onArm={(job) => dispatch({ type: "arm", jobId: job.id })}
            onTapCell={tapCell}
            onOpenJob={(id) => router.push(`/office/job/${id}`)}
          />
          <QueueColumn
            jobs={queue}
            jobNoun={jobNoun}
            armedId={place.kind === "idle" ? null : place.jobId}
            canEdit={canEdit}
            onArm={(job) => dispatch({ type: "arm", jobId: job.id })}
            onOpenJob={(id) => router.push(`/office/job/${id}`)}
          />
        </View>
      )}

      {/* Armed: say what to do next. Confirm: say what will happen, then do it. */}
      {place.kind === "armed" && armedJob ? (
        <View style={s.banner} accessibilityLiveRegion="polite">
          <Text style={s.bannerTxt} numberOfLines={1}>
            Tap a time on a {board.data?.workerNoun?.replace(/s$/, "") ?? "technician"}'s row for <Text style={s.bold}>{armedJob.customerName || armedJob.title}</Text>
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
          <Text style={s.confirmSub}>Tap another time to adjust.</Text>
          <View style={s.confirmBtns}>
            <Button title="Cancel" variant="ghost" small onPress={() => dispatch({ type: "cancel" })} />
            <Button title="Place" small loading={busy} icon={<Check color="#04121c" size={16} weight="bold" />} onPress={() => confirm()} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
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
});
