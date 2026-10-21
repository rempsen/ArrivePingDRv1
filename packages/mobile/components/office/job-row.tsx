import { View, Text, Pressable, StyleSheet } from "react-native";
import { Warning } from "phosphor-react-native";
import { StatusBadge } from "../ui";
import { C, R, S, fmtTime } from "../../lib/theme";
import type { OfficeJob } from "../../lib/board";

const PRIORITY: Record<string, string> = { urgent: C.red, high: C.amber };

/**
 * One work order in a list. Time, who it's for, what, where, and who has it.
 * `techName` is resolved by the screen from the board's techs ("" = nobody).
 */
export function JobRow({
  job,
  techName,
  onPress,
  actions,
}: {
  job: OfficeJob;
  techName: string;
  onPress?: () => void;
  actions?: React.ReactNode;
}) {
  const pc = PRIORITY[job.priority];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${job.customerName}, ${job.service}, ${fmtTime(job.scheduledAt)}`}
      style={({ pressed }) => [s.row, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={s.timeCol}>
        <Text style={s.time} allowFontScaling={false}>
          {fmtTime(job.scheduledAt)}
        </Text>
        {job.durationMins ? <Text style={s.dur}>{job.durationMins} min</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.top}>
          {pc ? <View style={[s.prio, { backgroundColor: pc }]} /> : null}
          <Text style={s.customer} numberOfLines={1}>
            {job.customerName || job.title || "Work order"}
          </Text>
          {job.late ? (
            <View style={s.late}>
              <Warning color={C.red} size={12} weight="fill" />
              <Text style={s.lateTxt}>Late</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.service} numberOfLines={1}>
          {job.service || job.title}
        </Text>
        <Text style={s.addr} numberOfLines={1}>
          {job.address}
        </Text>
        <View style={s.bottom}>
          <StatusBadge status={job.status} />
          <Text style={[s.tech, !techName && s.unassigned]} numberOfLines={1}>
            {techName || "Unassigned"}
          </Text>
        </View>
        {actions ? <View style={s.actions}>{actions}</View> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: S.md, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  timeCol: { width: 64, alignItems: "flex-start" },
  time: { color: C.text, fontSize: 15, fontWeight: "800" },
  dur: { color: C.muted, fontSize: 11, marginTop: 2 },
  top: { flexDirection: "row", alignItems: "center", gap: S.sm },
  prio: { width: 8, height: 8, borderRadius: R.pill },
  customer: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  late: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: C.redBg, borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 2 },
  lateTxt: { color: C.red, fontSize: 10, fontWeight: "800" },
  service: { color: C.sub, fontSize: 13, marginTop: 2 },
  addr: { color: C.muted, fontSize: 12, marginTop: 1 },
  bottom: { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: S.sm },
  tech: { color: C.sub, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  unassigned: { color: C.amber },
  actions: { flexDirection: "row", gap: S.sm, marginTop: S.sm },
});
