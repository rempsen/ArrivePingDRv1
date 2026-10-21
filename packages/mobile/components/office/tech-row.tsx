import { View, Text, Pressable, StyleSheet, Linking, Platform } from "react-native";
import { Phone, ChatCircleDots, MapPin, ChatText } from "phosphor-react-native";
import { Avatar } from "../ui";
import { C, R, S, fmtTime } from "../../lib/theme";
import { ageLabel, STATUS_LABEL, type OfficeTech } from "../../lib/board";

const DOT: Record<string, string> = {
  enroute: C.cyan,
  onsite: "#2dd4bf",
  available: C.green,
  busy: C.amber,
  break: C.amber,
  offline: C.muted,
};

export function statusColor(status: string): string {
  return DOT[status] ?? C.muted;
}

/** Apple Maps on iOS, the geo: intent on Android, both showing a dropped pin. */
export function openMap(lat: number, lng: number, label: string) {
  const q = encodeURIComponent(label);
  const url = Platform.OS === "ios" ? `maps://?ll=${lat},${lng}&q=${q}` : `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`).catch(() => {}));
}

/**
 * One technician on the Team list: who, where they are in the day, and the
 * three ways to reach them. `currentJob` is the title of the job they're on,
 * resolved by the screen from the board's jobs.
 */
export function TechRow({
  tech,
  currentJob,
  now,
  onMessage,
}: {
  tech: OfficeTech;
  currentJob?: string | null;
  now: Date;
  onMessage?: (tech: OfficeTech) => void;
}) {
  const color = statusColor(tech.status);
  const detail =
    tech.status === "offline"
      ? "Off shift"
      : currentJob
        ? `${currentJob}${tech.freeAt ? ` · free ~${fmtTime(tech.freeAt)}` : ""}`
        : tech.openJobs > 0
          ? `${tech.openJobs} open ${tech.openJobs === 1 ? "job" : "jobs"}`
          : "No jobs assigned";
  const where = tech.status === "offline" ? "" : ageLabel(tech.locationAt, now) + (tech.stale ? " (stale)" : "");

  return (
    <View style={s.row}>
      <View>
        <Avatar name={tech.name} photoUrl={tech.photoUrl} color={tech.color} size={44} />
        <View style={[s.dot, { backgroundColor: color }]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.top}>
          <Text style={s.name} numberOfLines={1}>
            {tech.name}
          </Text>
          <Text style={[s.status, { color }]}>{STATUS_LABEL[tech.status] ?? tech.status}</Text>
        </View>
        <Text style={s.detail} numberOfLines={1}>
          {detail}
        </Text>
        {where ? (
          <Text style={s.where} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </View>
      <View style={s.actions}>
        {tech.phone ? (
          <Action label={`Call ${tech.name}`} onPress={() => Linking.openURL(`tel:${tech.phone}`)}>
            <Phone color={C.sub} size={18} />
          </Action>
        ) : null}
        {tech.phone ? (
          <Action label={`Text ${tech.name}`} onPress={() => Linking.openURL(`sms:${tech.phone}`)}>
            <ChatText color={C.sub} size={18} />
          </Action>
        ) : null}
        {tech.lat != null && tech.lng != null && tech.status !== "offline" ? (
          <Action label={`See ${tech.name} on the map`} onPress={() => openMap(tech.lat!, tech.lng!, tech.name)}>
            <MapPin color={C.sub} size={18} />
          </Action>
        ) : null}
        {onMessage ? (
          <Action label={`Message ${tech.name} in ArrivePing`} onPress={() => onMessage(tech)}>
            <ChatCircleDots color={C.brand} size={18} weight="fill" />
          </Action>
        ) : null}
      </View>
    </View>
  );
}

function Action({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.action, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  dot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg },
  top: { flexDirection: "row", alignItems: "center", gap: S.sm },
  name: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  status: { fontSize: 11, fontWeight: "800" },
  detail: { color: C.sub, fontSize: 13, marginTop: 2 },
  where: { color: C.muted, fontSize: 11, marginTop: 1 },
  actions: { flexDirection: "row", gap: 2 },
  action: { width: 34, height: 34, borderRadius: R.control, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
});
