import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Linking, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarPlus,
  CaretRight,
  CheckCircle,
  WarningCircle,
  ShareNetwork,
  ArrowCounterClockwise,
  Desktop,
} from "phosphor-react-native";
import { api } from "../lib/api";
import { authClient } from "../lib/auth";
import { C, R, S, WIDE } from "../lib/theme";
import { Card, Button } from "../components/ui";
import {
  CalendarPermissionError,
  calendarSyncAvailable,
  connectCalendar,
  disconnectCalendar,
  listWritableCalendars,
  requestCalendarPermission,
  syncCalendarNow,
  useCalendarSyncSettings,
  type CalendarTarget,
} from "../lib/calendar-sync";

/**
 * Profile → Calendar sync (Dan, 2026-10-23). Technicians don't use the web
 * console, so this is where their jobs get into Apple Calendar, Google
 * Calendar or Outlook. Two ways, top to bottom in order of how well they work
 * from a phone:
 *
 *  1. Sync to this phone — real events written through the phone's calendar
 *     (lib/calendar-sync.ts). Changes show within minutes of opening the app.
 *  2. Subscribe with a link — the private iCalendar feed. Updates even when the
 *     app is closed, but on the calendar service's own schedule, and Google and
 *     Outlook only take a subscription from a computer.
 */

const isIOS = Platform.OS === "ios";

function ago(iso?: string): string {
  if (!iso) return "not yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString();
}

function summary(r?: { added: number; updated: number; removed: number }): string {
  if (!r) return "";
  const parts = [
    r.added ? `${r.added} added` : "",
    r.updated ? `${r.updated} updated` : "",
    r.removed ? `${r.removed} removed` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "everything up to date";
}

export default function CalendarSyncScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const settings = useCalendarSyncSettings();
  const connected = !!settings && settings.userId === userId;
  const available = calendarSyncAvailable();

  const [choosing, setChoosing] = useState(false);
  const [calendars, setCalendars] = useState<CalendarTarget[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  async function startChoosing() {
    setBusy("choose");
    try {
      // Listing calendars needs calendar access, so this is where iOS / Android
      // asks for it — right after the tech said they want this.
      await connectPreflight();
      setCalendars(await listWritableCalendars());
      setChoosing(true);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  }

  async function connectPreflight() {
    const p = await requestCalendarPermission();
    if (p !== "granted") throw new CalendarPermissionError(p);
    setBlocked(false);
  }

  function handleError(e: unknown) {
    if (e instanceof CalendarPermissionError) {
      setBlocked(true);
      return;
    }
    Alert.alert("Couldn't connect the calendar", e instanceof Error ? e.message : String(e));
  }

  async function connect(target: { mode: "own" } | { mode: "existing"; calendar: CalendarTarget }) {
    if (!userId) return;
    setBusy(target.mode === "own" ? "own" : target.calendar.id);
    try {
      await connectCalendar(userId, target);
      setChoosing(false);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    try {
      await syncCalendarNow(userId);
    } finally {
      setBusy(null);
    }
  }

  function turnOff() {
    if (!settings) return;
    const own = settings.mode === "own";
    Alert.alert(
      "Turn off calendar sync?",
      own
        ? "Your jobs stop updating on this phone. You can also remove the ArrivePing Jobs calendar."
        : `Your jobs stop updating in ${settings.label}. You can also remove the jobs ArrivePing added there. Nothing else in that calendar is touched.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Keep the jobs", onPress: () => disconnectCalendar({ removeEvents: false }) },
        {
          text: own ? "Remove the calendar" : "Remove the jobs",
          style: "destructive",
          onPress: () => disconnectCalendar({ removeEvents: true }),
        },
      ],
    );
  }

  // ------------------------------------------------------ subscribe with a link
  const feed = useQuery({
    queryKey: ["calendar-feed"],
    queryFn: async () => {
      const res = await api.calendar.feed.$get();
      if (!res.ok) throw new Error("Failed");
      return (await res.json()) as { url: string; webcal: string; google: string; outlook: string; outlookPersonal: string };
    },
    staleTime: Infinity,
  });
  const reset = useMutation({
    mutationFn: async () => {
      const res = await api.calendar.feed.regenerate.$post();
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar-feed"] }),
    onError: () => Alert.alert("Couldn't reset the link", "Check your connection and try again."),
  });

  const send = (message: string) => Share.share({ message }).catch(() => {});
  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert("Couldn't open the link"));

  function confirmReset() {
    Alert.alert(
      "Reset your calendar link?",
      "Any calendar subscribed with the current link stops getting updates. You'd subscribe again with the new one. Syncing to this phone isn't affected.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset link", style: "destructive", onPress: () => reset.mutate() },
      ],
    );
  }

  const byAccount = (calendars ?? []).reduce<Record<string, CalendarTarget[]>>((acc, c) => {
    (acc[c.account] ??= []).push(c);
    return acc;
  }, {});

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft color={C.text} size={22} />
        </Pressable>
        <Text style={s.topTitle}>Calendar sync</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[s.content, WIDE]}>
        <Text style={s.intro}>
          Your assigned jobs in the calendar you already use. When a job is added, moved or cancelled, your calendar follows.
        </Text>

        {/* 1. Sync to this phone ------------------------------------------------ */}
        <Card>
          <View style={s.headRow}>
            <CalendarCheck color={C.brand} size={20} weight="bold" />
            <Text style={s.cardTitle}>Sync to this phone</Text>
          </View>

          {!available ? (
            <Text style={s.sub}>Update ArrivePing to the latest version to sync jobs to this phone's calendar.</Text>
          ) : blocked ? (
            <>
              <View style={s.noteRow}>
                <WarningCircle color={C.amber} size={18} />
                <Text style={[s.sub, { flex: 1 }]}>
                  Calendar access is turned off for ArrivePing. Turn on {isIOS ? "Calendars → Full Access" : "Calendar"} in Settings, then come back.
                </Text>
              </View>
              <Button title="Open Settings" variant="outline" small onPress={() => Linking.openSettings().catch(() => {})} />
            </>
          ) : connected && !choosing ? (
            <>
              <View style={s.noteRow}>
                <CheckCircle color={C.green} size={18} weight="fill" />
                <Text style={[s.statusTxt, { flex: 1 }]}>On · {settings!.label}</Text>
              </View>
              <Text style={s.sub}>
                Last synced {ago(settings!.lastSyncAt)}
                {settings!.lastResult ? ` · ${summary(settings!.lastResult)}` : ""}. Jobs from the past 2 weeks and the next 90 days. Updates when you open ArrivePing and every 15 minutes while it's open.
              </Text>
              {settings!.lastError ? (
                <View style={s.noteRow}>
                  <WarningCircle color={C.amber} size={18} />
                  <Text style={[s.warnTxt, { flex: 1 }]}>{settings!.lastError}</Text>
                </View>
              ) : null}
              <View style={s.btnRow}>
                <Button title="Sync now" small loading={busy === "sync"} onPress={syncNow} style={{ flex: 1 }} />
                <Button title="Change calendar" variant="outline" small disabled={!!busy} onPress={startChoosing} style={{ flex: 1 }} />
              </View>
              <Button title="Turn off" variant="ghost" small onPress={turnOff} />
            </>
          ) : choosing ? (
            <>
              <Text style={s.sub}>Where should your jobs go?</Text>
              <Pressable
                style={[s.option, s.optionHi]}
                onPress={() => connect({ mode: "own" })}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel="A separate ArrivePing Jobs calendar"
              >
                <CalendarPlus color={C.brand} size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={s.optionTitle}>A separate “ArrivePing Jobs” calendar</Text>
                  <Text style={s.optionSub}>
                    {isIOS
                      ? "Recommended. Shows in Apple Calendar, and on your other Apple devices when iCloud Calendars is on. Easy to show or hide."
                      : "Recommended. Shows in this phone's calendar app. Easy to show or hide."}
                  </Text>
                </View>
                {busy === "own" ? <ActivityIndicator color={C.brand} /> : <CaretRight color={C.muted} size={16} />}
              </Pressable>

              <Text style={s.groupLabel}>Or add them to one of your calendars</Text>
              <Text style={s.optionSub}>
                Pick a Google or Outlook calendar and your jobs show in Google Calendar or Outlook everywhere you use it. ArrivePing only ever changes the jobs it added.
              </Text>
              {Object.keys(byAccount).length === 0 ? (
                <Text style={s.sub}>
                  No other calendars on this phone yet. To use Google Calendar or Outlook, add that account to this phone in Settings with Calendars turned on
                  {isIOS ? "" : " (in the Outlook app: Settings → your account → Sync calendars)"}, then come back.
                </Text>
              ) : (
                Object.entries(byAccount).map(([account, list]) => (
                  <View key={account}>
                    <Text style={s.accountLabel}>{account}</Text>
                    {list.map((c) => (
                      <Pressable
                        key={c.id}
                        style={s.option}
                        onPress={() => connect({ mode: "existing", calendar: c })}
                        disabled={!!busy}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.title}, ${account}`}
                      >
                        <View style={[s.dot, { backgroundColor: c.color || C.muted }]} />
                        <Text style={[s.optionTitle, { flex: 1 }]}>{c.title}</Text>
                        {busy === c.id ? <ActivityIndicator color={C.brand} /> : <CaretRight color={C.muted} size={16} />}
                      </Pressable>
                    ))}
                  </View>
                ))
              )}
              <Button title="Cancel" variant="ghost" small onPress={() => setChoosing(false)} />
            </>
          ) : (
            <>
              <Text style={s.sub}>
                Works with Apple Calendar, Google Calendar and Outlook — whichever accounts are on this phone. Jobs from the past 2 weeks and the next 90 days, with a reminder an hour before.
              </Text>
              <Button title="Add my jobs to this phone" loading={busy === "choose"} onPress={startChoosing} />
            </>
          )}
        </Card>

        {/* 2. Subscribe with a link ---------------------------------------------- */}
        <Card>
          <View style={s.headRow}>
            <ShareNetwork color={C.brand} size={20} weight="bold" />
            <Text style={s.cardTitle}>Subscribe with a link</Text>
          </View>
          <Text style={s.sub}>
            A private link to your jobs. The calendar keeps it updated even when ArrivePing is closed, but each calendar service decides how often it checks, so a change can take hours to appear.
          </Text>

          {feed.isLoading ? (
            <ActivityIndicator color={C.brand} style={{ marginVertical: S.md }} />
          ) : feed.isError || !feed.data ? (
            <Button title="Try again" variant="outline" small onPress={() => feed.refetch()} />
          ) : (
            <>
              {isIOS && (
                <LinkRow
                  title="Apple Calendar"
                  sub="Subscribe on this iPhone."
                  action="Subscribe"
                  onPress={() => open(feed.data.webcal)}
                />
              )}
              <LinkRow
                title="Google Calendar"
                sub="Google only adds subscriptions on a computer. Send yourself the link and open it there."
                action="Send"
                computer
                onPress={() => send(`Add my ArrivePing jobs to Google Calendar (open this on a computer signed in to Google): ${feed.data.google}`)}
              />
              <LinkRow
                title="Outlook.com"
                sub="Personal Outlook, Hotmail or Live accounts. Opens Outlook on the web; easiest on a computer."
                action="Send"
                computer
                onPress={() => send(`Add my ArrivePing jobs to Outlook (open this and sign in): ${feed.data.outlookPersonal}`)}
              />
              <LinkRow
                title="Outlook for work or school"
                sub="Microsoft 365 accounts. Opens Outlook on the web; easiest on a computer."
                action="Send"
                computer
                onPress={() => send(`Add my ArrivePing jobs to Outlook (open this and sign in): ${feed.data.outlook}`)}
              />
              <LinkRow
                title="Any other calendar"
                sub="Share the feed address to paste into “Subscribe from URL”."
                action="Share"
                onPress={() => send(feed.data.url)}
              />
              <Pressable onPress={confirmReset} style={s.resetRow} accessibilityRole="button" accessibilityLabel="Reset calendar link" disabled={reset.isPending}>
                <ArrowCounterClockwise color={C.sub} size={16} />
                <Text style={s.resetTxt}>{reset.isPending ? "Resetting…" : "Reset link"}</Text>
              </Pressable>
              <Text style={s.fine}>Anyone with this link can see your job times and addresses. Reset it if it's shared by mistake.</Text>
            </>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkRow({ title, sub, action, onPress, computer }: { title: string; sub: string; action: string; onPress: () => void; computer?: boolean }) {
  return (
    <Pressable onPress={onPress} style={s.linkRow} accessibilityRole="button" accessibilityLabel={`${title}: ${action}`} accessibilityHint={sub}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.headRow}>
          <Text style={s.optionTitle}>{title}</Text>
          {computer ? <Desktop color={C.muted} size={14} /> : null}
        </View>
        <Text style={s.optionSub}>{sub}</Text>
      </View>
      <Text style={s.action}>{action}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingVertical: S.md },
  topTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl },
  intro: { color: C.sub, fontSize: 14, lineHeight: 20 },
  headRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: "800" },
  sub: { color: C.sub, fontSize: 13, lineHeight: 19, marginTop: S.sm, marginBottom: S.sm },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: S.sm, marginTop: S.sm },
  statusTxt: { color: C.text, fontSize: 14, fontWeight: "700" },
  warnTxt: { color: C.amber, fontSize: 13, lineHeight: 18 },
  btnRow: { flexDirection: "row", gap: S.sm, marginTop: S.xs },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    paddingVertical: S.md,
    paddingHorizontal: S.md,
    borderRadius: R.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.bg3,
    marginTop: S.sm,
  },
  optionHi: { borderColor: C.brand },
  optionTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  optionSub: { color: C.sub, fontSize: 12, lineHeight: 17, marginTop: 2 },
  groupLabel: { color: C.text, fontSize: 13, fontWeight: "800", marginTop: S.lg },
  accountLabel: { color: C.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: S.md },
  dot: { width: 10, height: 10, borderRadius: R.pill },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  action: { color: C.brand, fontSize: 14, fontWeight: "800" },
  resetRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  resetTxt: { color: C.sub, fontSize: 14, fontWeight: "700" },
  fine: { color: C.muted, fontSize: 12, lineHeight: 17 },
});
