import { useCallback } from "react";
import { View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { ArrowLeft, Phone, ChatCircleDots } from "phosphor-react-native";
import { Avatar, FullLoader } from "../../../components/ui";
import { MessageThread, type ThreadMessage } from "../../../components/message-thread";
import { statusColor } from "../../../components/office/tech-row";
import { C, R, S, WIDE } from "../../../lib/theme";
import { authHeaders } from "../../../lib/auth";
import { getActiveCompany } from "../../../lib/active-company";
import { useLiveMessageSignal } from "../../../lib/live-messages";
import { threadsKey } from "../../../lib/use-threads";
import { useBoard } from "../../../lib/use-board";
import { STATUS_LABEL } from "../../../lib/board";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

type ThreadData = {
  tech: { techId: string; name: string; photoUrl: string | null; status: string };
  messages: ThreadMessage[];
};

/**
 * One technician's direct thread, the dispatcher's side. Read is acked once
 * when the screen gains focus (never from a poll), the same rule as the
 * web inbox, so the unread badge only clears when someone actually looked.
 */
export default function OfficeThread() {
  const router = useRouter();
  const qc = useQueryClient();
  const { techId } = useLocalSearchParams<{ techId: string }>();
  const company = getActiveCompany();
  const board = useBoard(null);
  const tech = board.data?.techs.find((t) => t.id === techId);

  const key = ["dispatch-thread", company, techId] as const;
  const thread = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`${API}/api/messages/dispatch/${encodeURIComponent(techId!)}`, { headers: authHeaders() });
      if (res.status === 404) throw new Error("That technician is no longer on the roster.");
      if (!res.ok) throw new Error(`Couldn't load the thread (${res.status})`);
      return (await res.json()) as ThreadData;
    },
    enabled: !!techId,
    refetchInterval: 20_000,
  });
  useLiveMessageSignal(techId ? "/api/messages/inbox/stream" : null, () => thread.refetch());

  useFocusEffect(
    useCallback(() => {
      if (!techId) return;
      fetch(`${API}/api/messages/dispatch/${encodeURIComponent(techId)}/mark-read`, { method: "POST", headers: authHeaders() })
        .then(() => qc.invalidateQueries({ queryKey: threadsKey(company) }))
        .catch(() => {});
    }, [techId, qc, company]),
  );

  const send = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`${API}/api/messages/dispatch/${encodeURIComponent(techId!)}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message || `Couldn't send (${res.status})`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: threadsKey(company) });
    },
    onError: (e) => Alert.alert("Not sent", (e as Error).message),
  });

  const name = thread.data?.tech.name ?? tech?.name ?? "Technician";
  const status = tech?.status ?? thread.data?.tech.status ?? "offline";

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft color={C.text} size={22} />
        </Pressable>
        <View>
          <Avatar name={name} photoUrl={thread.data?.tech.photoUrl ?? tech?.photoUrl} color={tech?.color} size={36} />
          <View style={[s.dot, { backgroundColor: statusColor(status) }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[s.status, { color: statusColor(status) }]}>{STATUS_LABEL[status] ?? status}</Text>
        </View>
        {tech?.phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${tech.phone}`)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Call ${name}`} style={s.call}>
            <Phone color={C.text} size={18} />
          </Pressable>
        ) : null}
      </View>

      {thread.isLoading ? (
        <FullLoader label="Loading messages…" />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={70}>
          <MessageThread
            messages={thread.data?.messages ?? []}
            mine={(m) => m.senderRole === "dispatch"}
            theirName={name}
            placeholder={`Message ${name.split(" ")[0]}…`}
            sending={send.isPending}
            refreshing={thread.isRefetching}
            onRefresh={() => thread.refetch()}
            onSend={async (body) => {
              try {
                await send.mutateAsync(body);
                return true;
              } catch {
                return false;
              }
            }}
            empty={
              <View style={s.empty}>
                <ChatCircleDots color={C.muted} size={40} />
                <Text style={s.emptyTxt}>No messages yet</Text>
                <Text style={s.emptySub}>{name} sees your messages in the app and gets a push.</Text>
                {thread.isError ? <Text style={[s.emptySub, { color: C.red }]}>{(thread.error as Error).message}</Text> : null}
              </View>
            }
          />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.sm, borderBottomWidth: 1, borderBottomColor: C.border },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg },
  name: { color: C.text, fontSize: 16, fontWeight: "800" },
  status: { fontSize: 11, fontWeight: "700" },
  call: { width: 36, height: 36, borderRadius: R.control, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 6, paddingVertical: 48 },
  emptyTxt: { color: C.text, fontSize: 16, fontWeight: "700" },
  emptySub: { color: C.sub, fontSize: 13, textAlign: "center" },
});
