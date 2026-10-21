import { View, Text, FlatList, RefreshControl, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { ChatCircleDots, Warning } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { Avatar, Empty, ListSkeleton } from "../../components/ui";
import { C, R, S, WIDE } from "../../lib/theme";
import { useDispatchThreads } from "../../lib/use-threads";
import { statusColor } from "../../components/office/tech-row";

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (24 * 60))}d`;
}

/**
 * The dispatcher's inbox: one thread per technician, unread first. Opening
 * a thread is wired in the messaging phase; until then rows are read-only.
 */
export default function Messages() {
  const router = useRouter();
  const inbox = useDispatchThreads();
  return (
    <View style={s.screen}>
      <OfficeHeader title="Messages" />
      {inbox.isLoading ? (
        <View style={[s.pad, WIDE]}>
          <ListSkeleton rows={5} height={72} />
        </View>
      ) : inbox.isError ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load messages" sub={(inbox.error as Error)?.message} />
      ) : (
        <FlatList
          data={inbox.threads}
          keyExtractor={(t) => t.techId}
          contentContainerStyle={[s.pad, WIDE, { paddingBottom: S.xxl }]}
          refreshControl={<RefreshControl refreshing={inbox.isFetching && !inbox.isLoading} onRefresh={() => inbox.refetch()} tintColor={C.brand} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/office/thread/${item.techId}`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${item.unread ? `, ${item.unread} unread` : ""}`}
              style={({ pressed }) => [s.row, { opacity: pressed ? 0.8 : 1 }]}
            >
              <View>
                <Avatar name={item.name} photoUrl={item.photoUrl} color={item.color} size={44} />
                {item.status ? <View style={[s.dot, { backgroundColor: statusColor(item.status) }]} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.top}>
                  <Text style={[s.name, item.unread > 0 && s.bold]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={s.when}>{ago(item.lastAt)}</Text>
                </View>
                <Text style={[s.preview, item.unread > 0 && s.previewUnread]} numberOfLines={1}>
                  {item.lastMessage ? `${item.lastSenderRole === "dispatch" ? "You: " : ""}${item.lastMessage}` : "No messages yet"}
                </Text>
              </View>
              {item.unread > 0 ? (
                <View style={s.badge}>
                  <Text style={s.badgeTxt}>{item.unread > 9 ? "9+" : item.unread}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={<Empty icon={<ChatCircleDots color={C.muted} size={28} />} text="No conversations yet" sub="Threads appear here once you or a technician sends a message." />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { paddingHorizontal: S.lg },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  dot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg },
  top: { flexDirection: "row", alignItems: "center", gap: S.sm },
  name: { color: C.text, fontSize: 15, fontWeight: "600", flex: 1 },
  bold: { fontWeight: "800" },
  when: { color: C.muted, fontSize: 11 },
  preview: { color: C.muted, fontSize: 13, marginTop: 2 },
  previewUnread: { color: C.sub, fontWeight: "600" },
  badge: { minWidth: 22, height: 22, borderRadius: R.pill, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeTxt: { color: "#04121c", fontSize: 11, fontWeight: "900" },
});
