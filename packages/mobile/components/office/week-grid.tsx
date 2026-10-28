import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { CaretLeft, CaretRight } from "phosphor-react-native";
import { Avatar } from "../ui";
import { statusColor } from "./tech-row";
import { C, R, S } from "../../lib/theme";
import { addDays, type OfficeTech } from "../../lib/board";
import { DAY_CAPACITY_MINS, GUTTER_W, ROW_H, loadLevel, weekCells } from "../../lib/timeline";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LOAD_COLOR = { ok: C.green, high: C.amber, over: C.red } as const;
const HEADER_H = 64;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hrs = (min: number) => `${(min / 60).toFixed(min % 60 ? 1 : 0)} h`;

/**
 * Seven days across, technicians down: how full each day is against an
 * 8-hour day, with the unassigned count per day along the top. Tapping a
 * cell opens that day on the timeline.
 */
export function WeekGrid({
  techs,
  jobs,
  timeOff,
  tz,
  from,
  today,
  onPickDay,
}: {
  techs: readonly OfficeTech[];
  jobs: ReadonlyArray<{ riderId: string | null; status: string; scheduledAt: string; durationMins?: number | null }>;
  timeOff: ReadonlyArray<{ techId: string; day: string }>;
  tz: string;
  from: string;
  today: string;
  onPickDay: (day: string) => void;
}) {
  const week = useMemo(() => weekCells({ techs, jobs, timeOff, tz }, from), [techs, jobs, timeOff, tz, from]);
  const label = (day: string) => {
    const d = new Date(`${day}T12:00:00Z`);
    return { dow: DOW[d.getUTCDay()], date: d.getUTCDate() };
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: S.xxl }}>
      <View style={s.row}>
        <View style={[s.gutter, { height: HEADER_H }]}>
          <Text style={s.gutterHeadTxt}>{techs.length} on roster</Text>
          <Text style={s.gutterSub}>Unassigned →</Text>
        </View>
        {week.days.map((day) => {
          const { dow, date } = label(day);
          const n = week.unassigned[day] ?? 0;
          return (
            <Pressable key={day} onPress={() => onPickDay(day)} accessibilityRole="button" accessibilityLabel={`${dow} ${date}, ${n} unassigned, open the day`} style={[s.dayHead, { height: HEADER_H }, day === today && s.todayHead]}>
              <Text style={[s.dow, day === today && { color: C.brand }]}>{dow}</Text>
              <Text style={[s.date, day === today && { color: C.brand }]}>{date}</Text>
              <View style={[s.unassigned, n > 0 && { backgroundColor: C.red + "33" }]}>
                <Text style={[s.unassignedTxt, n > 0 && { color: C.red }]}>{n} open</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {techs.map((t) => {
        const cells = week.byTech.get(t.id) ?? [];
        const weekMin = cells.reduce((n, c) => n + (c.off ? 0 : c.bookedMin), 0);
        return (
          <View key={t.id} style={s.row}>
            <View style={[s.gutter, s.gutterRow, { height: ROW_H }]}>
              <View>
                <Avatar name={t.name} photoUrl={t.photoUrl} color={t.color} size={36} />
                <View style={[s.dot, { backgroundColor: statusColor(t.status) }]} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={s.weekHrs}>{hrs(weekMin)} this week</Text>
              </View>
            </View>
            {cells.map((c) => {
              const lvl = loadLevel(c.bookedMin);
              const pct = Math.min(100, (c.bookedMin / DAY_CAPACITY_MINS) * 100);
              return (
                <Pressable
                  key={c.day}
                  onPress={() => onPickDay(c.day)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.name}, ${label(c.day).dow}: ${c.off ? "day off" : `${c.count} jobs, ${Math.round(c.bookedMin / 60)} hours`}`}
                  style={({ pressed }) => [s.cell, { height: ROW_H }, c.off && s.cellOff, c.day === today && s.todayCell, { opacity: pressed ? 0.7 : 1 }]}
                >
                  {c.off ? (
                    <Text style={s.offTxt}>Off</Text>
                  ) : (
                    <>
                      <View style={s.cellTop}>
                        <Text style={[s.count, c.count === 0 && { color: C.muted }]} numberOfLines={1}>
                          {c.count === 0 ? "—" : `${c.count} ${c.count === 1 ? "job" : "jobs"}`}
                        </Text>
                        <Text style={s.hours}>{c.bookedMin ? hrs(c.bookedMin) : ""}</Text>
                      </View>
                      <View style={s.bar}>
                        <View style={[s.fill, { width: `${pct}%`, backgroundColor: LOAD_COLOR[lvl] }]} />
                      </View>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        );
      })}
      {techs.length === 0 ? <Text style={s.empty}>No technicians on the roster.</Text> : null}
    </ScrollView>
  );
}

/**
 * Week mode's header under the board title: ‹ Oct 26 – Nov 1 › with a
 * "This week" jump, then the key for the load colours. Stands in for the day
 * strip while the Week view is up.
 */
export function WeekBar({
  from,
  thisWeek,
  jobs,
  techs,
  onWeek,
}: {
  from: string;
  thisWeek: string;
  jobs: number;
  techs: number;
  onWeek: (monday: string) => void;
}) {
  const fmt = (day: string) => {
    const d = new Date(`${day}T12:00:00Z`);
    return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  const range = `${fmt(from)} – ${fmt(addDays(from, 6))}`;
  return (
    <View style={s.weekBarWrap}>
      <View style={s.weekBar}>
        <Pressable onPress={() => onWeek(addDays(from, -7))} accessibilityRole="button" accessibilityLabel="Previous week" hitSlop={6} style={s.arrow}>
          <CaretLeft color={C.sub} size={16} weight="bold" />
        </Pressable>
        <Text style={s.range} accessibilityRole="header">
          {range}
        </Text>
        {from !== thisWeek ? (
          <Pressable onPress={() => onWeek(thisWeek)} accessibilityRole="button" style={s.thisWeek}>
            <Text style={s.thisWeekTxt}>This week</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => onWeek(addDays(from, 7))} accessibilityRole="button" accessibilityLabel="Next week" hitSlop={6} style={s.arrow}>
          <CaretRight color={C.sub} size={16} weight="bold" />
        </Pressable>
      </View>
      <View style={s.legend}>
        <Text style={s.legendTxt}>
          {jobs} jobs · {techs} on roster · 8-hour days
        </Text>
        {(
          [
            ["Under 6 h", C.green],
            ["6–8 h", C.amber],
            ["Over 8 h", C.red],
          ] as const
        ).map(([t, c]) => (
          <View key={t} style={s.key}>
            <View style={[s.swatch, { backgroundColor: c }]} />
            <Text style={s.keyTxt}>{t}</Text>
          </View>
        ))}
        <Text style={s.hint}>Tap a day to open it on the timeline</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  weekBarWrap: { backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.border },
  weekBar: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.sm },
  arrow: { width: 36, height: 40, borderRadius: R.control, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
  range: { color: C.text, fontSize: 17, fontWeight: "800", marginHorizontal: S.xs },
  thisWeek: { height: 32, paddingHorizontal: 12, borderRadius: R.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3, justifyContent: "center" },
  thisWeekTxt: { color: C.sub, fontSize: 12, fontWeight: "700" },
  legend: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: S.sm, paddingHorizontal: S.lg, paddingBottom: S.sm },
  legendTxt: { color: C.sub, fontSize: 13, marginRight: S.sm },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  keyTxt: { color: C.sub, fontSize: 12, fontWeight: "700" },
  hint: { color: C.muted, fontSize: 12, marginLeft: "auto" },
  row: { flexDirection: "row" },
  gutter: { width: GUTTER_W, backgroundColor: C.bg2, justifyContent: "center", paddingHorizontal: S.md, borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border },
  gutterRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  gutterHeadTxt: { color: C.muted, fontSize: 11, fontWeight: "700" },
  gutterSub: { color: C.muted, fontSize: 10, marginTop: 2 },
  dayHead: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border },
  todayHead: { backgroundColor: "rgba(14,165,233,0.08)" },
  dow: { color: C.muted, fontSize: 11, fontWeight: "700" },
  date: { color: C.text, fontSize: 16, fontWeight: "800" },
  unassigned: { backgroundColor: C.bg3, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 1, marginTop: 2 },
  unassignedTxt: { color: C.sub, fontSize: 10, fontWeight: "800" },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg },
  name: { color: C.text, fontSize: 13, fontWeight: "700" },
  weekHrs: { color: C.sub, fontSize: 11, marginTop: 1 },
  cellTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 4 },
  cell: { flex: 1, justifyContent: "center", paddingHorizontal: S.sm, borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border },
  cellOff: { backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  todayCell: { backgroundColor: "rgba(14,165,233,0.05)" },
  offTxt: { color: C.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  count: { color: C.text, fontSize: 12, fontWeight: "700" },
  hours: { color: C.sub, fontSize: 11 },
  bar: { height: 5, borderRadius: 3, backgroundColor: C.bg3, marginTop: 6, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3 },
  empty: { color: C.muted, fontSize: 13, padding: S.lg },
});
