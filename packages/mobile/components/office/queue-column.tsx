import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Tray } from "phosphor-react-native";
import { StatusBadge } from "../ui";
import { C, R, S, fmtTime } from "../../lib/theme";
import type { OfficeJob } from "../../lib/board";
import { canArm } from "../../lib/board-place";

export const QUEUE_W = 300;

/**
 * The day's jobs with nobody on them, soonest first. Tapping one arms it for
 * placement on the timeline; a long press opens it.
 */
export function QueueColumn({
  jobs,
  jobNoun,
  armedId,
  canEdit,
  onArm,
  onOpenJob,
}: {
  jobs: readonly OfficeJob[];
  jobNoun: string;
  armedId: string | null;
  canEdit: boolean;
  onArm: (job: OfficeJob) => void;
  onOpenJob: (jobId: string) => void;
}) {
  return (
    <View style={s.col}>
      <View style={s.head}>
        <Tray color={jobs.length ? C.red : C.muted} size={16} weight="fill" />
        <Text style={s.headTxt}>Unassigned</Text>
        <View style={[s.count, jobs.length > 0 && { backgroundColor: C.red + "33" }]}>
          <Text style={[s.countTxt, jobs.length > 0 && { color: C.red }]}>{jobs.length}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={s.list}>
        {jobs.length === 0 ? <Text style={s.quiet}>Every {jobNoun.replace(/s$/, "")} today has someone.</Text> : null}
        {jobs.map((job) => {
          const armed = job.id === armedId;
          const movable = canEdit && canArm(job);
          return (
            <Pressable
              key={job.id}
              onPress={() => (movable ? onArm(job) : onOpenJob(job.id))}
              onLongPress={() => onOpenJob(job.id)}
              accessibilityRole="button"
              accessibilityLabel={`${job.customerName || job.title}, ${fmtTime(job.scheduledAt)}${movable ? ", tap to place, hold to open" : ""}`}
              accessibilityState={armed ? { selected: true } : undefined}
              style={({ pressed }) => [s.item, armed && s.armed, { opacity: pressed ? 0.8 : 1 }]}
            >
              <View style={s.itemTop}>
                <Text style={s.time} allowFontScaling={false}>
                  {fmtTime(job.scheduledAt)}
                </Text>
                {job.durationMins ? <Text style={s.dur}>{job.durationMins} min</Text> : null}
                {job.late ? <Text style={s.late}>Late</Text> : null}
              </View>
              <Text style={s.customer} numberOfLines={1}>
                {job.customerName || job.title || "Work order"}
              </Text>
              <Text style={s.service} numberOfLines={1}>
                {job.service || job.title}
              </Text>
              <Text style={s.addr} numberOfLines={1}>
                {job.address}
              </Text>
              <View style={{ marginTop: 6, flexDirection: "row" }}>
                <StatusBadge status={job.status} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  col: { width: QUEUE_W, borderLeftWidth: 1, borderLeftColor: C.border, backgroundColor: C.bg2 },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, height: 36, borderBottomWidth: 1, borderBottomColor: C.border },
  headTxt: { color: C.text, fontSize: 13, fontWeight: "800", flex: 1 },
  count: { backgroundColor: C.bg3, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countTxt: { color: C.sub, fontSize: 12, fontWeight: "800" },
  list: { padding: S.md, gap: S.sm, paddingBottom: S.xxl },
  quiet: { color: C.muted, fontSize: 12, paddingVertical: S.md },
  item: { backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.border, borderRadius: R.card, padding: S.md },
  armed: { borderColor: C.text, backgroundColor: "rgba(14,165,233,0.14)" },
  itemTop: { flexDirection: "row", alignItems: "center", gap: S.sm },
  time: { color: C.text, fontSize: 13, fontWeight: "800" },
  dur: { color: C.muted, fontSize: 11 },
  late: { color: C.red, fontSize: 11, fontWeight: "800", marginLeft: "auto" },
  customer: { color: C.text, fontSize: 14, fontWeight: "700", marginTop: 4 },
  service: { color: C.sub, fontSize: 12, marginTop: 1 },
  addr: { color: C.muted, fontSize: 11, marginTop: 1 },
});
