import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Phone, MapPin, ChatCircleDots, UserSwitch, CalendarBlank, Browser, Prohibit, Warning, Envelope } from "phosphor-react-native";
import { Avatar, Button, Card, Empty, FullLoader, StatusBadge } from "../../../components/ui";
import { AssignSheet } from "../../../components/office/assign-sheet";
import { DatetimeSheet } from "../../../components/office/datetime-sheet";
import { showToast } from "../../../components/office/undo-toast";
import { openMap, statusColor } from "../../../components/office/tech-row";
import { C, R, S, WIDE, fmtDate, fmtTime } from "../../../lib/theme";
import { useBooking } from "../../../lib/use-booking";
import { useBoard } from "../../../lib/use-board";
import { useAccess } from "../../../lib/use-access";
import { useDispatchActions } from "../../../lib/use-dispatch-actions";
import { webUrl } from "../../../lib/office-nav";
import { STATUS_LABEL, TERMINAL } from "../../../lib/board";
import { fmtInTz } from "../../../lib/when";

const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
const PRIORITY_COLOR: Record<string, string> = { urgent: C.red, high: C.amber };

/**
 * One work order, the office view. Everything a dispatcher does from the
 * phone: call the client, send the address to Maps, assign or reassign
 * (with the server's conflict reason and Undo), move the time, message the
 * tech, cancel. The full editor stays on the web; "Open in web" goes there.
 */
export default function OfficeJob() {
  const router = useRouter();
  const { id, assign: openAssignParam } = useLocalSearchParams<{ id: string; assign?: string }>();
  const { can } = useAccess();
  const job = useBooking(id);
  const board = useBoard(null);
  const actions = useDispatchActions();
  const [assignOpen, setAssignOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  // Today's "Assign" button deep-links here with ?assign=1.
  useEffect(() => {
    if (openAssignParam === "1" && job.data && can("work_orders:edit")) setAssignOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the job lands
  }, [openAssignParam, job.data?.id]);

  const b = job.data;
  const tz = board.data?.tz ?? "UTC";
  const done = b ? TERMINAL.has(b.status) : false;
  const tech = b?.riderId ? board.data?.techs.find((t) => t.id === b.riderId) : undefined;
  const techName = b?.rider?.name ?? tech?.name ?? "";
  const label = b ? b.customer?.name || b.title || b.service?.name || "Job" : "Job";

  async function reschedule(iso: string, force = false) {
    if (!b) return;
    setMoving(true);
    const r = await actions.schedule(b.id, iso, { force });
    setMoving(false);
    if (r.ok) {
      setWhenOpen(false);
      // Forced or not, the server grants the same undo window.
      const token = r.undo;
      showToast(`Moved to ${fmtInTz(iso, tz)}`, {
        onUndo: token
          ? async () => {
              const u = await actions.undo(token, b.id);
              if (!u.ok) Alert.alert("Couldn't undo", u.message);
            }
          : undefined,
      });
      return;
    }
    if (r.forceable && !force) {
      Alert.alert("Move it anyway?", r.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Move anyway", style: "destructive", onPress: () => reschedule(iso, true) },
      ]);
      return;
    }
    Alert.alert("Couldn't move", r.message);
  }

  function cancelJob() {
    if (!b) return;
    Alert.alert("Cancel this job?", `${label} will be cancelled and the ${techName ? "technician" : "client"} notified.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel job",
        style: "destructive",
        onPress: async () => {
          const r = await actions.cancel(b.id);
          if (r.ok) showToast("Job cancelled");
          else Alert.alert("Couldn't cancel", r.message);
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft color={C.text} size={22} />
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1}>
          {label}
        </Text>
        <Pressable
          onPress={() => Linking.openURL(webUrl("/admin/work-orders")).catch(() => {})}
          hitSlop={10}
          accessibilityRole="link"
          accessibilityLabel="Open in web console"
        >
          <Browser color={C.sub} size={22} />
        </Pressable>
      </View>

      {job.isLoading ? (
        <FullLoader />
      ) : job.isError || !b ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load this job" sub={(job.error as Error)?.message} />
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, WIDE]}
          refreshControl={<RefreshControl refreshing={job.isFetching && !job.isLoading} onRefresh={() => job.refetch()} tintColor={C.brand} />}
        >
          <View style={s.hero}>
            <View style={s.heroTop}>
              <StatusBadge status={b.status} />
              {PRIORITY_COLOR[b.priority] ? (
                <View style={[s.prio, { backgroundColor: PRIORITY_COLOR[b.priority] + "26" }]}>
                  <Text style={[s.prioTxt, { color: PRIORITY_COLOR[b.priority] }]}>{PRIORITY_LABEL[b.priority] ?? b.priority}</Text>
                </View>
              ) : null}
              {b.isSample ? <Text style={s.sample}>Sample</Text> : null}
            </View>
            <Text style={s.when}>{fmtInTz(b.scheduledAt, tz)}</Text>
            <Text style={s.service}>
              {b.service?.name ?? b.title}
              {b.service?.durationMins ? ` · ${b.service.durationMins} min` : ""}
            </Text>
          </View>

          <Card>
            <Text style={s.cardTitle}>Client</Text>
            <Text style={s.big}>{b.customer?.name ?? "Client"}</Text>
            {b.customer?.email ? <Text style={s.dim}>{b.customer.email}</Text> : null}
            <View style={s.actionsRow}>
              {b.customerPhone || b.customer?.phone ? (
                <Button
                  title="Call"
                  small
                  variant="outline"
                  icon={<Phone color={C.text} size={16} />}
                  onPress={() => Linking.openURL(`tel:${b.customerPhone || b.customer?.phone}`)}
                />
              ) : null}
              {b.customer?.email ? (
                <Button title="Email" small variant="outline" icon={<Envelope color={C.text} size={16} />} onPress={() => Linking.openURL(`mailto:${b.customer!.email}`)} />
              ) : null}
            </View>
          </Card>

          <Card onPress={() => openMap(b.lat, b.lng, b.address)} accessibilityLabel="Open the address in Maps">
            <Text style={s.cardTitle}>Address</Text>
            <View style={s.addrRow}>
              <MapPin color={C.brand} size={18} weight="fill" />
              <Text style={s.addr}>{b.address}</Text>
            </View>
          </Card>

          <Card>
            <Text style={s.cardTitle}>Technician</Text>
            {techName ? (
              <View style={s.techRow}>
                <View>
                  <Avatar name={techName} photoUrl={b.rider?.photoUrl ?? tech?.photoUrl} color={b.rider?.color ?? tech?.color} size={44} />
                  <View style={[s.dot, { backgroundColor: statusColor(tech?.status ?? b.rider?.status ?? "offline") }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.big}>{techName}</Text>
                  <Text style={s.dim}>
                    {b.assignStatus === "offered" ? "Offered, waiting to accept" : (STATUS_LABEL[tech?.status ?? ""] ?? "Assigned")}
                    {tech?.freeAt && tech.currentJobId !== b.id ? ` · free ~${fmtTime(tech.freeAt)}` : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push(`/office/thread/${b.riderId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${techName}`}
                  style={s.iconBtn}
                >
                  <ChatCircleDots color={C.brand} size={20} weight="fill" />
                </Pressable>
              </View>
            ) : (
              <Text style={[s.dim, { color: C.amber }]}>Nobody yet</Text>
            )}
            {!done && can("work_orders:edit") ? (
              <Button
                title={techName ? "Reassign" : "Assign"}
                variant={techName ? "outline" : "primary"}
                icon={<UserSwitch color={techName ? C.text : "#04121c"} size={18} weight="bold" />}
                onPress={() => setAssignOpen(true)}
                style={{ marginTop: S.md }}
              />
            ) : null}
          </Card>

          {b.notes ? (
            <Card>
              <Text style={s.cardTitle}>Notes for the tech</Text>
              <Text style={s.body}>{b.notes}</Text>
            </Card>
          ) : null}
          {b.staffNotes ? (
            <Card>
              <Text style={s.cardTitle}>Office notes</Text>
              <Text style={s.body}>{b.staffNotes}</Text>
            </Card>
          ) : null}
          {b.driverNotes ? (
            <Card>
              <Text style={s.cardTitle}>Field notes</Text>
              <Text style={s.body}>{b.driverNotes}</Text>
            </Card>
          ) : null}

          <Card>
            <Text style={s.cardTitle}>Timeline</Text>
            {(
              [
                ["Created", b.createdAt],
                ["Assigned", b.assignedAt],
                ["Accepted", b.acceptedAt],
                ["On the way", b.enrouteAt],
                ["Started", b.startedAt],
                ["Signed", b.signedAt],
                ["Finished", b.finishedAt],
              ] as Array<[string, string | null | undefined]>
            )
              .filter(([, at]) => !!at)
              .map(([what, at]) => (
                <View key={what} style={s.tl}>
                  <View style={s.tlDot} />
                  <Text style={s.tlWhat}>{what}</Text>
                  <Text style={s.tlWhen}>{fmtDate(at!)}</Text>
                </View>
              ))}
          </Card>

          {!done ? (
            <View style={s.bottomActions}>
              {can("scheduler:edit") ? (
                <Button
                  title="Reschedule"
                  variant="outline"
                  icon={<CalendarBlank color={C.text} size={18} />}
                  // The picker works on the company's clock, which comes with the board.
                  disabled={!board.data}
                  onPress={() => setWhenOpen(true)}
                />
              ) : null}
              {can("work_orders:edit") ? (
                <Button title="Cancel job" variant="ghost" icon={<Prohibit color={C.red} size={18} />} onPress={cancelJob} style={{ marginTop: S.sm }} />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {b && board.data ? (
        <>
          <AssignSheet open={assignOpen} bookingId={b.id} currentRiderId={b.riderId} jobLabel={label} onClose={() => setAssignOpen(false)} />
          <DatetimeSheet open={whenOpen} title="Move to" tz={tz} initial={b.scheduledAt} allowAsap={false} busy={moving} onClose={() => setWhenOpen(false)} onPick={(iso) => reschedule(iso)} />
        </>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  topTitle: { color: C.text, fontSize: 17, fontWeight: "800", flex: 1, textAlign: "center" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl * 2 },
  hero: { gap: 4, paddingBottom: S.sm },
  heroTop: { flexDirection: "row", alignItems: "center", gap: S.sm },
  prio: { borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 3 },
  prioTxt: { fontSize: 11, fontWeight: "800" },
  sample: { color: C.muted, fontSize: 11, fontWeight: "700" },
  when: { color: C.text, fontSize: 22, fontWeight: "800", marginTop: S.xs },
  service: { color: C.sub, fontSize: 14 },
  cardTitle: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: S.xs },
  big: { color: C.text, fontSize: 16, fontWeight: "700" },
  dim: { color: C.sub, fontSize: 13, marginTop: 2 },
  body: { color: C.text, fontSize: 14, lineHeight: 20 },
  actionsRow: { flexDirection: "row", gap: S.sm, marginTop: S.md },
  addrRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  addr: { color: C.text, fontSize: 15, flex: 1 },
  techRow: { flexDirection: "row", alignItems: "center", gap: S.md },
  dot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: R.pill, borderWidth: 2, borderColor: C.card },
  iconBtn: { width: 40, height: 40, borderRadius: R.control, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
  tl: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 6 },
  tlDot: { width: 8, height: 8, borderRadius: R.pill, backgroundColor: C.brand },
  tlWhat: { color: C.text, fontSize: 13, fontWeight: "600", flex: 1 },
  tlWhen: { color: C.muted, fontSize: 12 },
  bottomActions: { marginTop: S.sm },
});
