import { useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from "react-native";
import { Phone, ChatText, MapPin, ChatCircleDots, Warning, CalendarCheck } from "phosphor-react-native";
import { Avatar, Button, Empty } from "../ui";
import { JobRow } from "./job-row";
import { Panel, Quiet, Tiles } from "./today-parts";
import { openMap, statusColor } from "./tech-row";
import { C, R, S, WIDE, fmtTime } from "../../lib/theme";
import { useBoard } from "../../lib/use-board";
import { ageLabel, jobsForTech, NO_JOBS, STATUS_LABEL, TERMINAL } from "../../lib/board";
import { bookedMinutes, DAY_CAPACITY_MINS, loadLevel } from "../../lib/timeline";

const LOAD_COLOR = { ok: C.green, high: C.amber, over: C.red } as const;

/**
 * One technician, the right pane of the Team tab on an iPad (and the map's
 * card): a title row with the ways to reach them, the day in four numbers
 * with a load bar against an 8-hour day, and today's jobs. Same layout
 * language as the job detail and Today. Everything comes from the board the
 * tab already holds, so there's nothing to load.
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
  const done = mine.filter((j) => TERMINAL.has(j.status)).length;
  const booked = bookedMinutes(mine);
  const lvl = loadLevel(booked);
  const hours = Math.round((booked / 60) * 10) / 10;
  const canMap = tech.lat != null && tech.lng != null && tech.status !== "offline";

  return (
    <View style={s.screen}>
      <View style={s.title}>
        <View>
          <Avatar name={tech.name} photoUrl={tech.photoUrl} color={tech.color} size={56} />
          <View style={[s.dot, { backgroundColor: color }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={[s.pill, { backgroundColor: color + "24" }]}>
            <View style={[s.pillDot, { backgroundColor: color }]} />
            <Text style={[s.pillTxt, { color }]}>{STATUS_LABEL[tech.status] ?? tech.status}</Text>
          </View>
          <Text style={s.name} numberOfLines={1}>
            {tech.name}
          </Text>
          <Text style={s.sub} numberOfLines={2}>
            {current ? `On ${current.customerName || current.title}` : tech.openJobs > 0 ? `${tech.openJobs} open` : "No jobs assigned"}
            {tech.freeAt ? ` · free ~${fmtTime(tech.freeAt)}` : ""} · {where}
          </Text>
        </View>
        <View style={s.quick}>
          {tech.phone ? <QuickBtn label={`Call ${tech.name}`} icon={<Phone color={C.text} size={18} />} onPress={() => Linking.openURL(`tel:${tech.phone}`)} /> : null}
          {tech.phone ? <QuickBtn label={`Text ${tech.name}`} icon={<ChatText color={C.text} size={18} />} onPress={() => Linking.openURL(`sms:${tech.phone}`)} /> : null}
          {canMap ? <QuickBtn label={`${tech.name} on the map`} icon={<MapPin color={C.text} size={18} />} onPress={() => openMap(tech.lat!, tech.lng!, tech.name)} /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.content, WIDE]}>
        <Tiles
          columns={4}
          tiles={[
            { key: "jobs", n: mine.length, label: "Jobs today", color: C.text },
            { key: "done", n: done, label: "Done", color: C.green },
            { key: "booked", n: hours, label: "Hours booked", sub: "of 8", color: LOAD_COLOR[lvl] },
            { key: "left", n: mine.length - done, label: "Still to do", color: C.brand },
          ]}
        />
        <View style={s.loadBar} accessibilityLabel={`${hours} of 8 hours booked`}>
          <View style={[s.loadFill, { width: `${Math.min(100, (booked / DAY_CAPACITY_MINS) * 100)}%`, backgroundColor: LOAD_COLOR[lvl] }]} />
        </View>

        <Panel title="Today" icon={<CalendarCheck color={C.brand} size={16} weight="fill" />} count={mine.length}>
          {mine.length === 0 ? <Quiet text="Nothing assigned today." /> : mine.map((job) => <JobRow key={job.id} job={job} techName={tech.name} onPress={() => onOpenJob(job.id)} />)}
        </Panel>
      </ScrollView>

      <View style={s.bar}>
        <Button title={`Message ${tech.name.split(" ")[0]}`} icon={<ChatCircleDots color="#04121c" size={18} weight="fill" />} onPress={() => onMessage(tech.id)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function QuickBtn({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={({ pressed }) => [s.quickBtn, pressed && { opacity: 0.6 }]}>
      {icon}
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  title: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  dot: { position: "absolute", right: 0, bottom: 0, width: 16, height: 16, borderRadius: R.pill, borderWidth: 3, borderColor: C.bg },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillTxt: { fontSize: 12, fontWeight: "700" },
  name: { color: C.text, fontSize: 22, fontWeight: "800", lineHeight: 26 },
  sub: { color: C.sub, fontSize: 14 },
  quick: { flexDirection: "row", gap: S.sm, flexShrink: 0 },
  quickBtn: { width: 40, height: 40, borderRadius: R.control, borderWidth: 1, borderColor: C.borderHi, alignItems: "center", justifyContent: "center" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl },
  loadBar: { height: 6, borderRadius: 3, backgroundColor: C.bg3, overflow: "hidden" },
  loadFill: { height: 6, borderRadius: 3 },
  bar: { flexDirection: "row", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 },
});
