import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { fetch as streamFetch } from "expo/fetch";
import Constants from "expo-constants";
import { ArrowLeft, Sparkle, PaperPlaneRight, BookOpen, PlayCircle, Lifebuoy, ThumbsUp, ThumbsDown } from "phosphor-react-native";
import { authHeaders } from "../lib/auth";
import { C, R, S, WIDE } from "../lib/theme";
import { answerBlocks, boldSpans, HELP_LIMITS, sseParser, type HelpAction } from "../lib/help-ask-core";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");
const SUPPORT_EMAIL = "support@nvc360.com";

type Turn = { q: string; a: string; actions: HelpAction[]; id?: string; error?: string; done: boolean; vote?: 1 | -1 };

const SUGGESTED = ["How do I reschedule a job?", "Why does the app need my location all the time?", "How do I add photos to a job?"];

/**
 * Ask ArrivePing: how-to questions answered as numbered steps naming the
 * real buttons (POST /api/help/ask). The server knows from the sign-in
 * whether this is an office person or a technician and answers for their
 * side of the app. Opened from Profile → Ask ArrivePing.
 */
export default function HelpScreen() {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const scroll = useRef<ScrollView>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = turns.some((t) => !t.done);

  useEffect(() => () => abort.current?.abort(), []);

  const patch = (i: number, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, n) => (n === i ? f(t) : t)));

  async function ask(text: string) {
    const question = text.trim().slice(0, HELP_LIMITS.question);
    if (!question || busy) return;
    setQ("");
    const history = turns
      .filter((t) => t.done && !t.error)
      .slice(-3)
      .flatMap((t) => [
        { role: "user" as const, text: t.q },
        { role: "assistant" as const, text: t.a.slice(0, HELP_LIMITS.historyText) },
      ]);
    const i = turns.length;
    setTurns((ts) => [...ts, { q: question, a: "", actions: [], done: false }]);
    abort.current = new AbortController();
    try {
      const res = await streamFetch(`${API}/api/help/ask`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", Accept: "text/event-stream" }),
        body: JSON.stringify({ question, history, platform: Platform.OS === "ios" ? "ios" : "android" }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        patch(i, (t) => ({ ...t, done: true, error: body.message || (res.status === 429 ? "That's a lot of questions. Try again in a little while." : "Ask isn't available right now.") }));
        return;
      }
      const parser = sseParser((e) => {
        if (e.event === "delta") patch(i, (t) => ({ ...t, a: t.a + e.data.text }));
        else if (e.event === "action") patch(i, (t) => ({ ...t, actions: [...t.actions, e.data] }));
        else if (e.event === "error") patch(i, (t) => ({ ...t, error: e.data.message }));
        else if (e.event === "done") patch(i, (t) => ({ ...t, id: e.data.id, done: true }));
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(dec.decode(value, { stream: true }));
      }
      patch(i, (t) => ({ ...t, done: true }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      patch(i, (t) => ({ ...t, done: true, error: "Couldn't reach ArrivePing. Check your connection and try again." }));
    }
  }

  function vote(i: number, rating: 1 | -1) {
    const t = turns[i];
    if (!t?.id || t.vote) return;
    patch(i, (x) => ({ ...x, vote: rating }));
    void streamFetch(`${API}/api/public/help/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, rating }) }).catch(() => {});
  }

  function open(path: string) {
    Linking.openURL(`${API}${path}`).catch(() => Alert.alert("Couldn't open link", `${API}${path}`));
  }

  function contact(t: Turn, reason: string) {
    const body = `${reason ? `${reason}\n\n` : ""}My question: ${t.q}${t.a ? `\n\nWhat Ask said:\n${t.a.slice(0, 1500)}` : ""}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Help: ${t.q.slice(0, 80)}`)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => Alert.alert("Email us", SUPPORT_EMAIL));
  }

  return (
    <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft color={C.text} size={22} />
        </Pressable>
        <Text style={s.topTitle}>Ask ArrivePing</Text>
        <View style={{ width: 22 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={[s.content, WIDE]} keyboardShouldPersistTaps="handled" onContentSizeChange={() => turns.length && scroll.current?.scrollToEnd({ animated: true })}>
          {turns.length === 0 ? (
            <View style={s.intro}>
              <Sparkle color={C.brand} size={28} weight="fill" />
              <Text style={s.introTitle}>How can we help?</Text>
              <Text style={s.introSub}>Ask how to do anything in ArrivePing. You'll get the steps, button by button.</Text>
              {SUGGESTED.map((x) => (
                <Pressable key={x} onPress={() => ask(x)} style={({ pressed }) => [s.suggest, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                  <Text style={s.suggestTxt}>{x}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => open("/support")} accessibilityRole="link" style={s.centerLink}>
                <Text style={s.linkTxt}>Browse the Help Center</Text>
              </Pressable>
            </View>
          ) : (
            turns.map((t, i) => (
              <View key={i} style={s.turn}>
                <Text style={s.q}>{t.q}</Text>
                <View style={s.answer} accessibilityLiveRegion="polite">
                  {t.a ? <AnswerView text={t.a} /> : !t.error ? <Text style={s.muted}>Finding the steps…</Text> : null}
                  {t.error ? <Text style={s.error}>{t.error}</Text> : null}
                </View>
                {t.actions.map((a, n) =>
                  a.type === "article" ? (
                    <ActionBtn key={n} icon={<BookOpen color={C.text} size={16} />} label="Read the guide" onPress={() => open(`/support/${a.slug}`)} />
                  ) : a.type === "video" ? (
                    <ActionBtn key={n} icon={<PlayCircle color={C.text} size={16} />} label="Watch the video" onPress={() => open("/support/videos")} />
                  ) : (
                    <ActionBtn key={n} primary icon={<Lifebuoy color="#04121c" size={16} />} label="Email our support team" onPress={() => contact(t, a.reason)} />
                  ),
                )}
                {t.done && !t.error && t.id ? (
                  <View style={s.voteRow}>
                    {t.vote ? (
                      <Text style={s.muted}>{t.vote === 1 ? "Thanks!" : "Thanks. We'll use this to improve the answer."}</Text>
                    ) : (
                      <>
                        <Text style={s.muted}>Did this help?</Text>
                        <Pressable onPress={() => vote(i, 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Yes, this helped">
                          <ThumbsUp color={C.sub} size={20} />
                        </Pressable>
                        <Pressable onPress={() => vote(i, -1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="No, this didn't help">
                          <ThumbsDown color={C.sub} size={20} />
                        </Pressable>
                      </>
                    )}
                  </View>
                ) : null}
                {t.vote === -1 && !t.actions.some((a) => a.type === "contact") ? (
                  <ActionBtn icon={<Lifebuoy color={C.text} size={16} />} label="Email our support team" onPress={() => contact(t, "")} />
                ) : null}
              </View>
            ))
          )}
          {turns.length > 0 ? <Text style={s.fine}>Answers are written by AI from ArrivePing's own screens and guides.</Text> : null}
        </ScrollView>
        <View style={[s.bar, WIDE]}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask a question…"}
            placeholderTextColor={C.muted}
            style={s.input}
            maxLength={HELP_LIMITS.question}
            returnKeyType="send"
            onSubmitEditing={() => ask(q)}
            accessibilityLabel="Your question"
          />
          <Pressable onPress={() => ask(q)} disabled={!q.trim() || busy} style={[s.send, (!q.trim() || busy) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Ask">
            <PaperPlaneRight color="#04121c" size={18} weight="fill" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AnswerView({ text }: { text: string }) {
  return (
    <View style={{ gap: 6 }}>
      {answerBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <Rich key={i} text={b.text} />
        ) : (
          <View key={i} style={{ gap: 4 }}>
            {b.items.map((it, n) => (
              <View key={n} style={s.li}>
                <Text style={s.bullet}>{b.kind === "ol" ? `${n + 1}.` : "•"}</Text>
                <Rich text={it} style={{ flex: 1 }} />
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

function Rich({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={[s.body, style]}>
      {boldSpans(text).map((p, i) => (
        <Text key={i} style={p.bold ? s.bold : undefined}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

function ActionBtn({ icon, label, onPress, primary }: { icon: React.ReactNode; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, primary && s.actionPrimary, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      {icon}
      <Text style={[s.actionTxt, primary && { color: "#04121c" }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingVertical: S.md },
  topTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xl },
  intro: { alignItems: "center", gap: S.sm, paddingTop: S.xl },
  introTitle: { color: C.text, fontSize: 22, fontWeight: "800" },
  introSub: { color: C.sub, fontSize: 15, textAlign: "center", marginBottom: S.md },
  suggest: { alignSelf: "stretch", borderWidth: 1, borderColor: C.border, borderRadius: R.control, paddingHorizontal: S.md, paddingVertical: 12 },
  suggestTxt: { color: C.text, fontSize: 15 },
  centerLink: { marginTop: S.md, padding: S.sm },
  linkTxt: { color: C.brand, fontSize: 15, fontWeight: "600" },
  turn: { backgroundColor: C.bg2, borderRadius: R.card, borderWidth: 1, borderColor: C.border, padding: S.md, gap: S.sm },
  q: { color: C.text, fontSize: 15, fontWeight: "700" },
  answer: { gap: 6 },
  body: { color: C.sub, fontSize: 15, lineHeight: 22 },
  bold: { color: C.text, fontWeight: "700" },
  li: { flexDirection: "row", gap: 6 },
  bullet: { color: C.sub, fontSize: 15, lineHeight: 22, minWidth: 18 },
  muted: { color: C.muted, fontSize: 14 },
  error: { color: C.amber, fontSize: 14 },
  action: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", borderWidth: 1, borderColor: C.borderHi, borderRadius: R.control, paddingHorizontal: 12, paddingVertical: 9 },
  actionPrimary: { backgroundColor: C.brand, borderColor: C.brand },
  actionTxt: { color: C.text, fontSize: 14, fontWeight: "600" },
  voteRow: { flexDirection: "row", alignItems: "center", gap: S.md },
  fine: { color: C.muted, fontSize: 12, textAlign: "center" },
  bar: { flexDirection: "row", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 },
  input: { flex: 1, minHeight: 44, borderRadius: R.control, borderWidth: 1, borderColor: C.border, color: C.text, paddingHorizontal: S.md, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: R.control, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
});
