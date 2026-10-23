import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Avatar } from "../ui";
import { statusColor } from "./tech-row";
import { C, R, S } from "../../lib/theme";
import type { OfficeTech } from "../../lib/board";
import { DAY_CAPACITY_MINS, GUTTER_W, ROW_H, loadLevel, weekCells } from "../../lib/timeline";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LOAD_COLOR = { ok: C.green, high: C.amber, over: C.red } as const;
const HEADER_H = 56;

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
                <Text style={[s.unassignedTxt, n > 0 && { color: C.red }]}>{n}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {techs.map((t) => {
        const cells = week.byTech.get(t.id) ?? [];
        return (
          <View key={t.id} style={s.row}>
            <View style={[s.gutter, s.gutterRow, { height: ROW_H }]}>
              <View>
                <Avatar name={t.name} photoUrl={t.photoUrl} color={t.color} size={36} />
                <View style={[s.dot, { backgroundColor: statusColor(t.status) }]} />
              </View>
              <Text style={s.name} numberOfLines={1}>
                {t.name}
              </Text>
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
                      <Text style={[s.count, c.count === 0 && { color: C.muted }]}>{c.count === 0 ? "—" : `${c.count} ${c.count === 1 ? "job" : "jobs"}`}</Text>
                      <Text style={s.hours}>{c.bookedMin ? `${(c.bookedMin / 60).toFixed(c.bookedMin % 60 ? 1 : 0)} h` : ""}</Text>
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

const s = StyleSheet.create({
  row: { flexDirection: "row" },
  gutter: { width: GUTTER_W, justifyContent: "center", paddingHorizontal: S.md, borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border },
  gutterRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  gutterHeadTxt: { color: C.muted, fontSize: 11, fontWeight: "700" },
  gutterSub: { color: C.muted, fontSize: 10, marginTop: 2 },
  dayHead: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border },
  todayHead: { backgroundColor: "rgba(14,165,233,0.08)" },
  dow: { color: C.muted, fontSize: 11, fontWeight: "700" },
  date: { color: C.text, fontSize: 15, fontWeight: "800" },
  unassigned: { backgroundColor: C.bg3, borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 1, marginTop: 2 },
  unassignedTxt: { color: C.sub, fontSize: 10, fontWeight: "800" },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg },
  name: { color: C.text, fontSize: 13, fontWeight: "700", flex: 1 },
  cell: { flex: 1, justifyContent: "center", paddingHorizontal: S.sm, borderRightWidth: 1, borderRightColor: C.border, borderBottomWidth: 1, borderBottomColor: C.border },
  cellOff: { backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center" },
  todayCell: { backgroundColor: "rgba(14,165,233,0.05)" },
  offTxt: { color: C.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  count: { color: C.text, fontSize: 12, fontWeight: "700" },
  hours: { color: C.sub, fontSize: 11, marginTop: 1 },
  bar: { height: 4, borderRadius: 2, backgroundColor: C.bg3, marginTop: 6, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  empty: { color: C.muted, fontSize: 13, padding: S.lg },
});
