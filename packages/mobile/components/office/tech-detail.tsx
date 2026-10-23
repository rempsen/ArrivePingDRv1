import { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Linking } from "react-native";
import { Phone, ChatText, MapPin, ChatCircleDots, Warning, CalendarCheck } from "phosphor-react-native";
import { Avatar, Button, Card, Empty } from "../ui";
import { JobRow } from "./job-row";
import { openMap, statusColor } from "./tech-row";
import { C, R, S, WIDE, fmtTime } from "../../lib/theme";
import { useBoard } from "../../lib/use-board";
import { ageLabel, jobsForTech, NO_JOBS, STATUS_LABEL } from "../../lib/board";

/**
 * One technician, the right pane of the Team tab on an iPad: where they are
 * in the day, the ways to reach them, and today's jobs. Everything comes from
 * the board the tab already holds, so there's nothing to load.
 */
export function TechDetail({
  techId,
  onMessage,
  onOpenJob,
}: {
  techId: string;
  onMessage: (techId: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const board = useBoard(null);
  const tech = board.data?.techs.find((t) => t.id === techId);
  const jobs = board.data?.jobs ?? NO_JOBS;
  const mine = useMemo(() => jobsForTech(jobs, techId), [jobs, techId]);
  const now = new Date();

  if (!tech) {
    return <Empty icon={<Warning color={C.muted} size={28} />} text="That technician is no longer on the roster" />;
  }
  const color = statusColor(tech.status);
  const current = tech.currentJobId ? jobs.find((j) => j.id === tech.currentJobId) : undefined;
  const where = tech.status === "offline" ? "Off shift" : ageLabel(tech.locationAt, now) + (tech.stale ? " (stale)" : "");

  return (
    <ScrollView contentContainerStyle={[s.content, WIDE]}>
      <View style={s.hero}>
        <View>
          <Avatar name={tech.name} photoUrl={tech.photoUrl} color={tech.color} size={64} />
          <View style={[s.dot, { backgroundColor: color }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>
            {tech.name}
          </Text>
          <Text style={[s.status, { color }]}>{STATUS_LABEL[tech.status] ?? tech.status}</Text>
          <Text style={s.dim}>
            {current ? `On ${current.customerName || current.title}` : tech.openJobs > 0 ? `${tech.openJobs} open` : "No jobs assigned"}
            {tech.freeAt ? ` · free ~${fmtTime(tech.freeAt)}` : ""}
          </Text>
          <Text style={s.where}>{where}</Text>
        </View>
      </View>

      <View style={s.actions}>
        {tech.phone ? (
          <Button title="Call" small variant="outline" icon={<Phone color={C.text} size={16} />} onPress={() => Linking.openURL(`tel:${tech.phone}`)} />
        ) : null}
        {tech.phone ? (
          <Button title="Text" small variant="outline" icon={<ChatText color={C.text} size={16} />} onPress={() => Linking.openURL(`sms:${tech.phone}`)} />
        ) : null}
        {tech.lat != null && tech.lng != null && tech.status !== "offline" ? (
          <Button title="Map" small variant="outline" icon={<MapPin color={C.text} size={16} />} onPress={() => openMap(tech.lat!, tech.lng!, tech.name)} />
        ) : null}
        <Button title="Message" small icon={<ChatCircleDots color="#04121c" size={16} weight="fill" />} onPress={() => onMessage(tech.id)} />
      </View>

      <Card>
        <View style={s.cardHead}>
          <CalendarCheck color={C.brand} size={16} weight="fill" />
          <Text style={s.cardTitle}>Today</Text>
          {mine.length ? <Text style={s.count}>{mine.length}</Text> : null}
        </View>
        {mine.length === 0 ? (
          <Text style={s.quiet}>Nothing assigned today.</Text>
        ) : (
          mine.map((job) => <JobRow key={job.id} job={job} techName={tech.name} onPress={() => onOpenJob(job.id)} />)
        )}
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl },
  hero: { flexDirection: "row", alignItems: "center", gap: S.lg },
  dot: { position: "absolute", right: 0, bottom: 0, width: 18, height: 18, borderRadius: R.pill, borderWidth: 3, borderColor: C.bg },
  name: { color: C.text, fontSize: 22, fontWeight: "800" },
  status: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  dim: { color: C.sub, fontSize: 13, marginTop: 4 },
  where: { color: C.muted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: S.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: S.sm, marginBottom: S.xs },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "800", flex: 1 },
  count: { color: C.muted, fontSize: 12, fontWeight: "800" },
  quiet: { color: C.muted, fontSize: 13, paddingVertical: S.sm },
});
