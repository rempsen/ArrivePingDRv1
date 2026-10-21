import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
import { PaperPlaneRight } from "phosphor-react-native";
import { C, R, WIDE } from "../lib/theme";

export interface ThreadMessage {
  id: string;
  senderRole: string;
  senderName?: string | null;
  body: string;
  createdAt: string;
}

/**
 * A two-party chat: bubbles plus composer. The same visual language as the
 * technician's Messages screen (which keeps its own copy because it also
 * carries job offers and a coach mark), used by office threads.
 */
export function MessageThread({
  messages,
  mine,
  theirName,
  placeholder,
  sending,
  refreshing,
  onRefresh,
  onSend,
  empty,
}: {
  messages: ThreadMessage[];
  /** Is this message from the person holding the phone? */
  mine: (m: ThreadMessage) => boolean;
  /** Fallback label on incoming bubbles with no sender name. */
  theirName: string;
  placeholder: string;
  sending: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSend: (body: string) => Promise<boolean> | boolean;
  empty?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    const ok = await onSend(body);
    if (ok) setDraft("");
  }

  return (
    <>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[s.scroll, WIDE]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.brand} /> : undefined}
      >
        {messages.length === 0
          ? empty
          : messages.map((m) => {
              const me = mine(m);
              return (
                <View key={m.id} style={[s.bubble, me ? s.bubbleMine : s.bubbleThem]}>
                  {!me ? <Text style={s.bubbleName}>{m.senderName || theirName}</Text> : null}
                  <Text style={[s.bubbleTxt, me && { color: "#04121c" }]}>{m.body}</Text>
                  <Text style={[s.bubbleTime, me && { color: "rgba(4,18,28,0.55)" }]}>
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </Text>
                </View>
              );
            })}
      </ScrollView>
      <View style={s.composer}>
        <View style={[s.composerInner, WIDE]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={C.muted}
            style={s.input}
            multiline
            accessibilityLabel={placeholder}
          />
          <Pressable
            onPress={send}
            style={[s.sendBtn, !draft.trim() && { opacity: 0.5 }]}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {sending ? <ActivityIndicator color="#04121c" size="small" /> : <PaperPlaneRight color="#04121c" size={20} weight="fill" />}
          </Pressable>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 10, paddingBottom: 24 },
  bubble: { maxWidth: "82%", borderRadius: R.card, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: C.brand, alignSelf: "flex-end" },
  bubbleThem: { backgroundColor: C.bg3, alignSelf: "flex-start", borderWidth: 1, borderColor: C.border },
  bubbleName: { color: C.cyan, fontSize: 11, fontWeight: "700", marginBottom: 3 },
  bubbleTxt: { color: C.text, fontSize: 15, lineHeight: 20 },
  bubbleTime: { color: C.muted, fontSize: 10, marginTop: 4, opacity: 0.75 },
  composer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 },
  composerInner: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: { flex: 1, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.card, paddingHorizontal: 16, paddingVertical: 12, color: C.text, fontSize: 15, maxHeight: 120 },
  sendBtn: { width: 48, height: 48, borderRadius: R.card, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
});
