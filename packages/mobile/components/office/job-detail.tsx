import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Phone, MapPin, ChatCircleDots, ChatText, UserSwitch, CalendarBlank, Warning, Envelope, PencilSimple, DotsThree } from "phosphor-react-native";
import { Avatar, Button, Card, Empty, FullLoader, StatusBadge } from "../ui";
import { AssignSheet } from "./assign-sheet";
import { DatetimeSheet } from "./datetime-sheet";
import { showToast } from "./undo-toast";
import { openMap, statusColor } from "./tech-row";
import { C, R, S, WIDE, fmtDate, fmtTime, money } from "../../lib/theme";
import { parseLineItems, sumLineItems } from "../../lib/line-items";
import { useAssign } from "./use-assign";
import { useBooking, useCandidates } from "../../lib/use-booking";
import { useBoard } from "../../lib/use-board";
import { useAccess } from "../../lib/use-access";
import { useDispatchActions } from "../../lib/use-dispatch-actions";
import { webUrl } from "../../lib/office-nav";
import { STATUS_LABEL, TERMINAL, type OfficeTech } from "../../lib/board";
import { fmtInTz } from "../../lib/when";

const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
const PRIORITY_COLOR: Record<string, string> = { urgent: C.red, high: C.amber };

/**
 * One work order, the office view. Everything a dispatcher does from the
 * phone: call the client, send the address to Maps, assign or reassign
 * (with the server's conflict reason and Undo), move the time, message the
 * tech, cancel, and Edit for the rest (title, client, address, time, notes,
 * fields, line items). Rate models and form design stay on the web.
 *
 * Rendered two ways: as the full-screen route `app/office/job/[id].tsx` on a
 * phone (and from push taps and deep links on any device), and `embedded` as
 * the right pane of the Jobs tab on an iPad, where it has no back button.
 * Layout follows the "Jobs · split view" mockup: a title row with quick
 * actions, two columns once the pane is wide enough, suggested technicians
 * for an unassigned job, and a fixed action bar.
 */
export function JobDetail({
  id,
  assign: openAssignParam,
  embedded,
  onMessageTech,
}: {
  id: string;
  /** Open the Assign sheet as soon as the job lands (Today's "Assign" button). */
  assign?: boolean;
  /** Right pane of a split screen: no back button, no top safe-area inset. */
  embedded?: boolean;
  /** Where "message the tech" goes; defaults to the full-screen thread route. */
  onMessageTech?: (techId: string) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { can } = useAccess();
  const job = useBooking(id);
  const board = useBoard(null);
  const actions = useDispatchActions();
  const [assignOpen, setAssignOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  // Today's "Assign" button deep-links here with ?assign=1.
  useEffect(() => {
    if (openAssignParam && job.data && can("work_orders:edit")) setAssignOpen(true);
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

  const phone = b ? b.customerPhone || b.customer?.phone || "" : "";
  const boardJob = b ? board.data?.jobs.find((j) => j.id === b.id) : undefined;
  const duration = boardJob?.durationMins ?? b?.service?.durationMins ?? null;
  const lines = b ? parseLineItems(b.lineItems) : [];
  const canEdit = !!b && !done && can("work_orders:edit");
  const canMove = !!b && !done && can("scheduler:edit");
  const unassigned = !!b && !b.riderId;

  function more() {
    if (!b) return;
    const opts: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [
      { text: "Open in web console", onPress: () => Linking.openURL(webUrl("/admin/work-orders")).catch(() => {}) },
    ];
    // At most three buttons: Android drops the rest (Close included). Maps
    // lives on the address in the facts card.
    if (canEdit) opts.push({ text: "Cancel job", style: "destructive", onPress: cancelJob });
    opts.push({ text: "Close", style: "cancel" });
    Alert.alert(label, undefined, opts);
  }

  // Two columns once the pane is wide enough (an iPad in landscape); one
  // column on a phone or a narrow Split View pane.
  const [paneW, setPaneW] = useState(0);
  const twoCol = paneW >= 640;

  const facts = b ? (
    <Card>
      <View style={s.facts}>
        <Fact label="When" value={fmtInTz(b.scheduledAt, tz)} />
        <Fact label="Duration" value={duration ? `${duration} min` : "—"} />
        <Fact label="Client" value={b.customer?.name ?? "Client"} sub={b.customer?.email ?? undefined} />
        <Fact label="Phone" value={phone || "—"} onPress={phone ? () => Linking.openURL(`tel:${phone}`) : undefined} />
        <Pressable
          style={s.factWide}
          onPress={() => openMap(b.lat, b.lng, b.address)}
          accessibilityRole="link"
          accessibilityLabel={`Address ${b.address}. Open in Maps`}
        >
          <Text style={s.cardTitle}>Address</Text>
          <View style={s.addrRow}>
            <MapPin color={C.brand} size={16} weight="fill" />
            <Text style={s.factValue}>{b.address || "—"}</Text>
          </View>
        </Pressable>
      </View>
    </Card>
  ) : null;

  const notes = b ? (
    <>
      {(
        [
          ["Notes for the tech", b.notes],
          ["Office notes", b.staffNotes],
          ["Field notes", b.driverNotes],
        ] as Array<[string, string]>
      )
        .filter(([, v]) => !!v)
        .map(([t, v]) => (
          <Card key={t}>
            <Text style={s.cardTitle}>{t}</Text>
            <Text style={s.body}>{v}</Text>
          </Card>
        ))}
    </>
  ) : null;

  const items =
    lines.length > 0 ? (
      <Card>
        <Text style={s.cardTitle}>Line items</Text>
        {lines.map((li, i) => (
          <View key={`${li.itemId}-${i}`} style={s.line}>
            <Text style={s.lineName} numberOfLines={2}>
              {li.name || "Item"}
              {li.qty !== 1 ? <Text style={s.dimInline}>{`  × ${li.qty}`}</Text> : null}
            </Text>
            <Text style={s.lineAmt}>{money(li.price)}</Text>
          </View>
        ))}
        <View style={[s.line, s.lineTotal]}>
          <Text style={s.dimInline}>Total</Text>
          <Text style={s.lineSum}>{money(sumLineItems(lines).price)}</Text>
        </View>
      </Card>
    ) : null;

  const techCard = b ? (
    <Card style={unassigned && !done ? s.needsTech : undefined}>
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
            onPress={() => (onMessageTech ? onMessageTech(b.riderId!) : router.push(`/office/thread/${b.riderId}`))}
            accessibilityRole="button"
            accessibilityLabel={`Message ${techName}`}
            style={s.iconBtn}
          >
            <ChatCircleDots color={C.brand} size={20} weight="fill" />
          </Pressable>
        </View>
      ) : (
        <Text style={[s.big, { color: C.amber }]}>Nobody yet</Text>
      )}
      {unassigned && canEdit ? <Suggestions bookingId={b.id} jobLabel={label} techs={board.data?.techs ?? []} /> : null}
    </Card>
  ) : null;

  const activity = b ? (
    <Card>
      <Text style={s.cardTitle}>Activity</Text>
      {(
        [
          ["Finished", b.finishedAt],
          ["Signed", b.signedAt],
          ["Started", b.startedAt],
          ["On the way", b.enrouteAt],
          ["Accepted", b.acceptedAt],
          ["Assigned", b.assignedAt],
          ["Created", b.createdAt],
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
  ) : null;

  const body = (
    <>
      {!embedded ? (
        <View style={[s.topBar, WIDE]}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeft color={C.text} size={22} />
          </Pressable>
        </View>
      ) : null}

      {job.isLoading ? (
        <FullLoader />
      ) : job.isError || !b ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load this job" sub={(job.error as Error)?.message} />
      ) : (
        <View style={{ flex: 1 }} onLayout={(e) => setPaneW(e.nativeEvent.layout.width)}>
          {/* Title row: who, what, when, and the quick actions. */}
          <View style={[s.title, embedded && s.titleEmbedded]}>
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <View style={s.heroTop}>
                <StatusBadge status={b.status} />
                {unassigned && !done ? (
                  <View style={[s.pill, { backgroundColor: C.amber + "24" }]}>
                    <Text style={[s.pillTxt, { color: C.amber }]}>Nobody assigned yet</Text>
                  </View>
                ) : null}
                {PRIORITY_COLOR[b.priority] ? (
                  <View style={[s.pill, { backgroundColor: PRIORITY_COLOR[b.priority] + "26" }]}>
                    <Text style={[s.pillTxt, { color: PRIORITY_COLOR[b.priority] }]}>{PRIORITY_LABEL[b.priority] ?? b.priority}</Text>
                  </View>
                ) : null}
                {b.isSample ? <Text style={s.sample}>Sample</Text> : null}
              </View>
              <Text style={s.name} numberOfLines={2}>
                {label}
              </Text>
              <Text style={s.service} numberOfLines={2}>
                {[b.service?.name ?? b.title, fmtInTz(b.scheduledAt, tz), duration ? `${duration} min` : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <View style={s.quick}>
              {phone ? <QuickBtn label={`Call ${label}`} onPress={() => Linking.openURL(`tel:${phone}`)} icon={<Phone color={C.text} size={18} />} /> : null}
              {b.customer?.email ? <QuickBtn label={`Email ${label}`} onPress={() => Linking.openURL(`mailto:${b.customer!.email}`)} icon={<Envelope color={C.text} size={18} />} /> : null}
              {canEdit ? <QuickBtn label="Edit job" onPress={() => router.push(`/office/edit-job/${b.id}`)} icon={<PencilSimple color={C.text} size={18} />} /> : null}
              <QuickBtn label="More" onPress={more} icon={<DotsThree color={C.text} size={20} weight="bold" />} />
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[s.content, !twoCol && WIDE]}
            refreshControl={<RefreshControl refreshing={job.isFetching && !job.isLoading} onRefresh={() => job.refetch()} tintColor={C.brand} />}
          >
            {twoCol ? (
              <View style={s.cols}>
                <View style={s.col}>
                  {facts}
                  {notes}
                  {items}
                </View>
                <View style={s.col}>
                  {techCard}
                  {activity}
                </View>
              </View>
            ) : (
              <>
                {facts}
                {techCard}
                {notes}
                {items}
                {activity}
              </>
            )}
          </ScrollView>

          {/* Fixed action bar: the next thing a dispatcher does with this job. */}
          {!done && (canEdit || canMove || phone) ? (
            <View style={[s.bar, { paddingBottom: S.md + (embedded ? 0 : insets.bottom) }]}>
              {canEdit ? (
                <Button
                  title={techName ? "Reassign" : "Assign a technician"}
                  variant={techName ? "outline" : "primary"}
                  icon={<UserSwitch color={techName ? C.text : "#04121c"} size={18} weight="bold" />}
                  onPress={() => setAssignOpen(true)}
                  style={{ flex: 2 }}
                />
              ) : null}
              {canMove ? (
                <Button
                  title="Reschedule"
                  variant="outline"
                  icon={<CalendarBlank color={C.text} size={18} />}
                  // The picker works on the company's clock, which comes with the board.
                  disabled={!board.data}
                  onPress={() => setWhenOpen(true)}
                  style={{ flex: 1 }}
                />
              ) : null}
              {phone ? (
                <Button
                  title={twoCol ? "Message client" : "Text"}
                  variant="outline"
                  icon={<ChatText color={C.text} size={18} />}
                  onPress={() => Linking.openURL(`sms:${phone}`).catch(() => {})}
                  style={{ flex: 1 }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      )}

      {b && board.data ? (
        <>
          <AssignSheet open={assignOpen} bookingId={b.id} currentRiderId={b.riderId} jobLabel={label} onClose={() => setAssignOpen(false)} />
          <DatetimeSheet open={whenOpen} title="Move to" tz={tz} initial={b.scheduledAt} allowAsap={false} busy={moving} onClose={() => setWhenOpen(false)} onPick={(iso) => reschedule(iso)} />
        </>
      ) : null}
    </>
  );
  return embedded ? (
    <View style={s.screen}>{body}</View>
  ) : (
    <SafeAreaView style={s.screen} edges={["top"]}>
      {body}
    </SafeAreaView>
  );
}

function Fact({ label, value, sub, onPress }: { label: string; value: string; sub?: string; onPress?: () => void }) {
  const inner = (
    <>
      <Text style={s.cardTitle}>{label}</Text>
      <Text style={[s.factValue, onPress && { color: C.brand }]} numberOfLines={2}>
        {value}
      </Text>
      {sub ? (
        <Text style={s.dim} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </>
  );
  return onPress ? (
    <Pressable style={s.fact} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
      {inner}
    </Pressable>
  ) : (
    <View style={s.fact}>{inner}</View>
  );
}

function QuickBtn({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={({ pressed }) => [s.quickBtn, pressed && { opacity: 0.6 }]}>
      {icon}
    </Pressable>
  );
}

/**
 * Up to three people the server ranks best for an unassigned job, each one
 * tap from assigned (same Undo and "Assign anyway" as the sheet).
 */
function Suggestions({ bookingId, jobLabel, techs }: { bookingId: string; jobLabel: string; techs: readonly OfficeTech[] }) {
  const candidates = useCandidates(bookingId);
  const { assignTo, busyId } = useAssign(bookingId, null, jobLabel);
  const top = (candidates.data ?? []).filter((c) => c.fit === "ready" || c.fit === "busy").slice(0, 3);
  if (candidates.isLoading || top.length === 0) return null;
  return (
    <View style={{ gap: S.sm, marginTop: S.sm }}>
      <Text style={s.dim}>Suggested</Text>
      {top.map((c) => {
        const t = techs.find((x) => x.id === c.techId);
        const name = t?.name ?? "Technician";
        return (
          <Pressable
            key={c.techId}
            onPress={() => assignTo(c.techId, name)}
            disabled={busyId !== null}
            accessibilityRole="button"
            accessibilityLabel={`Assign ${name}. ${c.reason}`}
            style={({ pressed }) => [s.sugg, { opacity: pressed || (busyId && busyId !== c.techId) ? 0.6 : 1 }]}
          >
            <Avatar name={name} photoUrl={t?.photoUrl} color={t?.color} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.suggName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={s.suggWhy} numberOfLines={1}>
                {c.reason || (c.distanceKm != null ? `${c.distanceKm.toFixed(1)} km away` : "")}
              </Text>
            </View>
            {busyId === c.techId ? (
              <ActivityIndicator color={C.brand} />
            ) : (
              <Text style={[s.suggFit, { color: c.fit === "ready" ? C.green : C.amber }]}>{c.fit === "ready" ? "Fits" : "Tight"}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingTop: S.md },
  title: { flexDirection: "row", alignItems: "flex-start", gap: S.md, paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  titleEmbedded: { paddingHorizontal: S.xl, paddingTop: S.lg },
  heroTop: { flexDirection: "row", alignItems: "center", gap: S.sm, flexWrap: "wrap" },
  pill: { borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 4 },
  pillTxt: { fontSize: 12, fontWeight: "700" },
  sample: { color: C.muted, fontSize: 11, fontWeight: "700" },
  name: { color: C.text, fontSize: 22, fontWeight: "800", lineHeight: 26 },
  service: { color: C.sub, fontSize: 15 },
  quick: { flexDirection: "row", gap: S.sm, flexShrink: 0 },
  quickBtn: { width: 40, height: 40, borderRadius: R.control, borderWidth: 1, borderColor: C.borderHi, alignItems: "center", justifyContent: "center" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl },
  cols: { flexDirection: "row", gap: S.lg, alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0, gap: S.lg },
  facts: { flexDirection: "row", flexWrap: "wrap", rowGap: S.md },
  fact: { width: "50%", paddingRight: S.md, gap: 3 },
  factWide: { width: "100%", gap: 3 },
  factValue: { color: C.text, fontSize: 15, fontWeight: "700" },
  cardTitle: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: S.xs },
  big: { color: C.text, fontSize: 16, fontWeight: "700" },
  dim: { color: C.sub, fontSize: 13, marginTop: 2 },
  dimInline: { color: C.sub, fontSize: 13, fontWeight: "400" },
  body: { color: C.text, fontSize: 15, lineHeight: 21 },
  addrRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  line: { flexDirection: "row", justifyContent: "space-between", gap: S.md, paddingVertical: 4 },
  lineName: { color: C.text, fontSize: 14, flex: 1 },
  lineAmt: { color: C.text, fontSize: 14, fontWeight: "700" },
  lineTotal: { borderTopWidth: 1, borderTopColor: C.border, marginTop: S.xs, paddingTop: S.sm },
  lineSum: { color: C.text, fontSize: 15, fontWeight: "800" },
  needsTech: { borderColor: C.amber, backgroundColor: "rgba(245,158,11,0.07)" },
  techRow: { flexDirection: "row", alignItems: "center", gap: S.md },
  dot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: R.pill, borderWidth: 2, borderColor: C.card },
  iconBtn: { width: 40, height: 40, borderRadius: R.control, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
  sugg: { flexDirection: "row", alignItems: "center", gap: S.md, padding: S.sm, borderRadius: R.control, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3 },
  suggName: { color: C.text, fontSize: 14, fontWeight: "700" },
  suggWhy: { color: C.sub, fontSize: 12 },
  suggFit: { fontSize: 12, fontWeight: "800" },
  tl: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 6 },
  tlDot: { width: 8, height: 8, borderRadius: R.pill, backgroundColor: C.brand },
  tlWhat: { color: C.text, fontSize: 14, fontWeight: "600", flex: 1 },
  tlWhen: { color: C.muted, fontSize: 12 },
  bar: { flexDirection: "row", gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg2 },
});
