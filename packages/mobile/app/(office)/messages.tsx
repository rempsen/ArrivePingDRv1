import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet, Pressable, TextInput, Alert } from "react-native";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatCircleDots, Warning, Megaphone, MagnifyingGlass } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { Avatar, Button, Empty, ListSkeleton } from "../../components/ui";
import { Sheet } from "../../components/office/sheet";
import { showToast } from "../../components/office/undo-toast";
import { authHeaders } from "../../lib/auth";
import { useAccess } from "../../lib/use-access";
import { C, R, S, WIDE } from "../../lib/theme";
import { useDispatchThreads } from "../../lib/use-threads";
import { statusColor } from "../../components/office/tech-row";
import { ThreadView } from "../../components/office/thread-view";
import { SplitScreen, EmptyPane } from "../../components/office/split-screen";
import { useLayout } from "../../lib/use-layout";
import { throwIfNotOk } from "../../lib/api-error";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (24 * 60))}d`;
}

/**
 * The dispatcher's inbox: one thread per technician, unread first. On a phone
 * a row opens the thread screen; on an iPad it opens beside the list. Other
 * tabs ("Message" on a job or a technician) land here with `?techId=`.
 */
export default function Messages() {
  const router = useRouter();
  const inbox = useDispatchThreads();
  const { wide } = useLayout();
  const { techId: wanted, broadcast } = useLocalSearchParams<{ techId?: string; broadcast?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    if (wide) setSelectedId(wanted);
    else router.push(`/office/thread/${wanted}`);
    // The param is a one-shot request; clear it so a later tab tap doesn't replay it.
    router.setParams({ techId: undefined });
  }, [wanted, wide, router]);
  const open = (techId: string) => (wide ? setSelectedId(techId) : router.push(`/office/thread/${techId}`));
  // Reading threads needs work_orders:view; sending (broadcast, replies)
  // is a POST on /api/messages and needs work_orders:edit (office-access.ts).
  const { can } = useAccess();
  const canSend = can("work_orders:edit");
  const [cast, setCast] = useState(false);
  // Today's "Broadcast" button opens the sheet here (one-shot, cleared).
  useEffect(() => {
    if (broadcast !== "1") return;
    if (canSend) setCast(true);
    router.setParams({ broadcast: undefined });
  }, [broadcast, canSend, router]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => inbox.threads ?? [], [inbox.threads]);
  const unreadN = all.filter((t) => t.unread > 0).length;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((t) => (!unreadOnly || t.unread > 0) && (!needle || t.name.toLowerCase().includes(needle) || (t.lastMessage ?? "").toLowerCase().includes(needle)));
  }, [all, unreadOnly, q]);
  // On an iPad the conversation pane shouldn't sit empty: open the first
  // thread (unread ones sort first) until the dispatcher picks one.
  const firstShown = shown[0]?.techId;
  useEffect(() => {
    if (wide && !selectedId && firstShown) setSelectedId(firstShown);
  }, [wide, selectedId, firstShown]);

  const list = (
    <View style={s.screen}>
      <OfficeHeader
        title="Messages"
        right={
          canSend ? (
            <Pressable onPress={() => setCast(true)} accessibilityRole="button" accessibilityLabel="Broadcast to the team" style={({ pressed }) => [s.cast, { opacity: pressed ? 0.8 : 1 }]}>
              <Megaphone color={C.brand} size={20} weight="fill" />
            </Pressable>
          ) : undefined
        }
      />
      <BroadcastSheet open={cast} onClose={() => setCast(false)} />
      <View style={[s.segments, WIDE]}>
        {(
          [
            [false, "All", all.length],
            [true, "Unread", unreadN],
          ] as const
        ).map(([key, label, n]) => {
          const on = unreadOnly === key;
          return (
            <Pressable key={label} onPress={() => setUnreadOnly(key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.seg, on && s.segOn]}>
              <Text style={[s.segTxt, on && s.segTxtOn]}>{label}</Text>
              <Text style={[s.segN, on && s.segTxtOn]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[s.search, WIDE]}>
        <MagnifyingGlass color={C.muted} size={16} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search people and messages"
          placeholderTextColor={C.muted}
          style={s.input}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search conversations"
        />
      </View>
      {inbox.isLoading ? (
        <View style={[s.pad, WIDE]}>
          <ListSkeleton rows={5} height={72} />
        </View>
      ) : inbox.isError ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load messages" sub={(inbox.error as Error)?.message} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(t) => t.techId}
          contentContainerStyle={[s.pad, WIDE, { paddingBottom: S.xxl }]}
          refreshControl={<RefreshControl refreshing={inbox.isFetching && !inbox.isLoading} onRefresh={() => inbox.refetch()} tintColor={C.brand} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item.techId)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${item.unread ? `, ${item.unread} unread` : ""}`}
              accessibilityState={wide && item.techId === selectedId ? { selected: true } : undefined}
              style={({ pressed }) => [s.row, wide && item.techId === selectedId && s.selected, { opacity: pressed ? 0.8 : 1 }]}
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
          ListEmptyComponent={
            q || unreadOnly ? (
              <Empty icon={<ChatCircleDots color={C.muted} size={28} />} text={q ? "No matches" : "All caught up"} />
            ) : (
              <Empty icon={<ChatCircleDots color={C.muted} size={28} />} text="No conversations yet" sub="Threads appear here once you or a technician sends a message." />
            )
          }
        />
      )}
    </View>
  );

  return (
    <SplitScreen
      list={list}
      detail={selectedId ? <ThreadView key={selectedId} techId={selectedId} embedded /> : null}
      empty={<EmptyPane icon={<ChatCircleDots color={C.muted} size={32} />} text="Pick a conversation" sub="Messages with that technician open here." />}
    />
  );
}

/**
 * One message to everyone on shift, or everyone on the roster. The server
 * fans it out as individual direct messages (`POST /messages/broadcast`),
 * so each tech sees it in their normal thread and gets a push.
 */
function BroadcastSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"available" | "all">("available");
  const [sending, setSending] = useState(false);
  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/messages/broadcast`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ body: text, target: { type: target } }),
      });
      await throwIfNotOk(res, `Couldn't send (${res.status})`);
      const j = (await res.json().catch(() => ({}))) as { sent?: number; count?: number };
      const n = j.sent ?? j.count;
      showToast(n != null ? `Sent to ${n} ${n === 1 ? "technician" : "technicians"}` : "Broadcast sent");
      setBody("");
      onClose();
    } catch (e) {
      Alert.alert("Not sent", (e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <Sheet open={open} title="Broadcast" onClose={onClose} footer={<Button title="Send to team" loading={sending} disabled={!body.trim()} icon={<Megaphone color="#04121c" size={18} weight="fill" />} onPress={send} />}>
      <View style={s.targets}>
        {(
          [
            ["available", "On shift & available"],
            ["all", "Everyone on the roster"],
          ] as const
        ).map(([k, label]) => {
          const on = target === k;
          return (
            <Pressable key={k} onPress={() => setTarget(k)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.target, on && s.targetOn]}>
              <Text style={[s.targetTxt, on && { color: C.brand }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Heads up: the shop closes at 4 today…"
        placeholderTextColor={C.muted}
        multiline
        style={s.castInput}
        accessibilityLabel="Broadcast message"
      />
    </Sheet>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  cast: { width: 36, height: 36, borderRadius: R.control, backgroundColor: "rgba(14,165,233,0.12)", alignItems: "center", justifyContent: "center" },
  targets: { flexDirection: "row", gap: S.sm, marginBottom: S.md },
  target: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: R.control, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3 },
  targetOn: { borderColor: C.brand, backgroundColor: "rgba(14,165,233,0.16)" },
  targetTxt: { color: C.sub, fontSize: 12, fontWeight: "800" },
  castInput: { minHeight: 110, textAlignVertical: "top", color: C.text, fontSize: 15, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.card, paddingHorizontal: S.md, paddingVertical: 12 },
  pad: { paddingHorizontal: S.lg },
  segments: { flexDirection: "row", paddingHorizontal: S.lg, gap: S.xs, marginTop: S.xs },
  seg: { flex: 1, alignItems: "center", paddingVertical: S.sm, borderRadius: R.control, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  segOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  segTxt: { color: C.sub, fontSize: 11, fontWeight: "700" },
  segTxtOn: { color: C.brand },
  segN: { color: C.muted, fontSize: 13, fontWeight: "800", marginTop: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginVertical: S.md, paddingHorizontal: S.md, height: 40, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  input: { flex: 1, color: C.text, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  selected: { backgroundColor: C.bg3, borderRadius: R.card, marginHorizontal: -S.sm, paddingHorizontal: S.sm, borderBottomColor: "transparent" },
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
