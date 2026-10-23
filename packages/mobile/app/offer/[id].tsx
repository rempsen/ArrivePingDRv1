/**
 * Offer details: what a tech looks at before accepting or declining a job.
 *
 * The job itself comes from GET /api/bookings/:id (same as the job screen).
 * GET /api/bookings/:id/offer adds what only the server can work out: the
 * drive from where the tech is now, the estimated pay, and the scope.
 * Opened from the Details button on an offer card, by tapping an offer push,
 * or by the Details / Decline buttons on that push (?decline=1 opens the
 * reason sheet straight away).
 */
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import {
  CaretLeft,
  CarProfile,
  Clock,
  CurrencyDollar,
  MapPin,
  NavigationArrow,
  Note,
  ListChecks,
  Wrench,
  Package,
  ClipboardText,
  Warning,
  CalendarBlank,
  User,
} from "phosphor-react-native";
import { api } from "../../lib/api";
import { authHeaders } from "../../lib/auth";
import { C, R, money, fmtDate, WIDE } from "../../lib/theme";
import { Button, Card, FullLoader } from "../../components/ui";
import { DeclineSheet, OfferError, useOfferActions } from "../../components/offer-actions";
import { useCustomerNoun, useDistanceUnit, useJobNoun } from "../../lib/use-brand";
import { fmtKm } from "../../lib/units";
import { fmtMins, fmtMinsShort } from "../../lib/offer";
import { isPracticeJob, isSampleJob } from "../../lib/practice";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/** GET /api/bookings/:id/offer (packages/web/src/services/job-offer.ts). */
interface Offer {
  bookingId: string;
  assignStatus: string;
  status: string;
  duration: { mins: number; source: "history" | "service" } | null;
  drive: { km: number; mins: number; provider: string; locationAgeMins: number; fresh: boolean } | null;
  driveUnavailable: "" | "no_location" | "no_job_location" | "no_route";
  pay: {
    estimate: number;
    hourlyPay: number;
    mileagePay: number;
    unitPay: number;
    flatPay: number;
    hours: number;
    paidKm: number;
    unrated: boolean;
  } | null;
  scope: {
    serviceName: string;
    description: string;
    category: string;
    priority: string;
    skillClass: string;
    skills: string[];
    lines: { name: string; qty: number; unit: string; kind: string }[];
    checklist: { label: string; required: boolean }[];
    form: { name: string; questions: number; sections: string[] } | null;
  };
  declineReasons: { key: string; label: string }[];
}

function ago(mins: number): string {
  if (mins < 0) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default function OfferDetails() {
  const { id, decline: declineParam } = useLocalSearchParams<{ id: string; decline?: string }>();
  const router = useRouter();
  const unit = useDistanceUnit();
  const { noun: jobNoun } = useJobNoun();
  const { noun: customerNoun } = useCustomerNoun();
  const { accept, decline, pendingId } = useOfferActions();
  const [declineOpen, setDeclineOpen] = useState(false);

  const job = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const res = await api.bookings[":id"].$get({ param: { id: id! } });
      if (!res.ok) throw new Error("Couldn't load this job");
      return (await res.json()).booking as any;
    },
    enabled: !!id,
  });

  const offer = useQuery({
    queryKey: ["offer", id],
    queryFn: async (): Promise<Offer | null> => {
      const res = await fetch(`${API}/api/bookings/${encodeURIComponent(id!)}/offer`, { headers: authHeaders() });
      // 403: offered to someone else now (or never to this tech).
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error("Couldn't load the offer details");
      return ((await res.json()) as { offer: Offer }).offer;
    },
    enabled: !!id,
    // Drive time changes as the tech moves; refresh while they look.
    refetchInterval: 60_000,
  });

  const open = offer.data?.assignStatus === "offered";

  // The Decline button on the push lands here with the reason sheet up.
  useEffect(() => {
    if (declineParam === "1" && open) setDeclineOpen(true);
  }, [declineParam, open]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/(rider)" as never));

  const onError = (e: unknown) => {
    if (e instanceof OfferError && e.status === 409) {
      Alert.alert("Offer no longer open", `This ${jobNoun.toLowerCase()} was changed or taken by dispatch.`, [{ text: "OK", onPress: leave }]);
      return;
    }
    Alert.alert("Something went wrong", e instanceof Error ? e.message : "Try again.");
  };

  const doAccept = () =>
    accept.mutate(id!, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace(`/job/${id}` as never);
      },
      onError,
    });

  const doDecline = (code: string, note: string) =>
    decline.mutate(
      { id: id!, code, note },
      {
        onSuccess: () => {
          setDeclineOpen(false);
          leave();
        },
        onError: (e) => {
          setDeclineOpen(false);
          onError(e);
        },
      },
    );

  if (job.isLoading || offer.isLoading) return <FullLoader />;
  const j = job.data;
  const o = offer.data;
  if (!j) return <FullLoader label="Not found" />;

  const busy = pendingId === id;
  const title = isPracticeJob(j) ? "Practice job" : o?.scope.serviceName || j.service?.name || j.title || jobNoun;
  const urgent = o?.scope.priority === "high" || o?.scope.priority === "urgent";

  const openMaps = () => {
    const q = o?.driveUnavailable === "no_job_location" || !(j.lat && j.lng) ? encodeURIComponent(j.address) : `${j.lat},${j.lng}`;
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${q}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    })!;
    Linking.openURL(url).catch(() => {});
  };

  const driveNote = (() => {
    if (!o) return "";
    if (o.drive) {
      const when = ago(o.drive.locationAgeMins);
      const from = o.drive.fresh ? "From where you are now" : `From your last known location${when ? `, ${when}` : ""}`;
      return o.drive.provider === "estimate" ? `${from} · straight-line estimate` : from;
    }
    if (o.driveUnavailable === "no_location") return "Turn on location sharing to see the drive.";
    if (o.driveUnavailable === "no_job_location") return "This address hasn't been placed on the map yet.";
    return "Couldn't work out the drive right now.";
  })();

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={s.topbar}>
        <Pressable onPress={leave} style={s.backBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back">
          <CaretLeft color={C.text} size={22} />
        </Pressable>
        <Text style={s.topTitle}>{open ? "New offer" : `${jobNoun} details`}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {!o && (
          <Card style={s.banner}>
            <Warning color={C.amber} size={20} />
            <Text style={s.bannerTxt}>This offer isn't open to you any more.</Text>
          </Card>
        )}
        {o && !open && (
          <Card style={s.banner}>
            <Warning color={C.amber} size={20} />
            <Text style={s.bannerTxt}>
              {o.assignStatus === "accepted" ? `You've accepted this ${jobNoun.toLowerCase()}.` : "This offer is no longer open."}
            </Text>
          </Card>
        )}

        {/* What and where */}
        <Card>
          {isSampleJob(j) && <Text style={s.practiceTag}>{isPracticeJob(j) ? "PRACTICE · NOBODY IS TEXTED" : "SAMPLE · NOBODY IS TEXTED"}</Text>}
          <View style={s.headRow}>
            <Text style={s.title}>{title}</Text>
            {urgent && (
              <View style={s.urgent}>
                <Text style={s.urgentTxt}>{o!.scope.priority === "urgent" ? "URGENT" : "HIGH PRIORITY"}</Text>
              </View>
            )}
          </View>
          <Line icon={<User color={C.sub} size={15} />} text={j.customer?.name || customerNoun} />
          <Line icon={<CalendarBlank color={C.sub} size={15} />} text={j.scheduledAt ? fmtDate(j.scheduledAt) : "Not scheduled"} />
          <Line icon={<MapPin color={C.sub} size={15} />} text={j.address || "No address"} />
          {Number(j.price) > 0 && <Text style={s.price}>{money(Number(j.price))} job price</Text>}
        </Card>

        {/* The three numbers that decide it */}
        {o && (
          <View style={s.tiles}>
            <Tile
              icon={<CarProfile color={C.brand} size={18} />}
              label="Drive"
              value={o.drive ? fmtMinsShort(o.drive.mins) : "—"}
              sub={o.drive ? fmtKm(o.drive.km, unit) : ""}
            />
            <Tile
              icon={<Clock color={C.brand} size={18} />}
              label="On site"
              value={o.duration ? fmtMinsShort(o.duration.mins) : "—"}
              sub={o.duration ? (o.duration.source === "history" ? "your team's average" : "estimate") : ""}
            />
            {o.pay && (
              <Tile
                icon={<CurrencyDollar color={C.green} size={18} />}
                label="Your pay"
                value={o.pay.unrated && o.pay.estimate === 0 ? "Not set" : money(o.pay.estimate)}
                sub={o.pay.unrated && o.pay.estimate === 0 ? "ask the office" : "estimated"}
                valueColor={C.green}
              />
            )}
          </View>
        )}

        {/* Drive */}
        {o && (
          <Card>
            <Text style={s.cardTitle}>Getting there</Text>
            <Text style={s.body}>{driveNote}</Text>
            <Button
              title="Preview route in Maps"
              variant="outline"
              small
              icon={<NavigationArrow color={C.text} size={16} />}
              onPress={openMaps}
              style={{ marginTop: 10 }}
            />
          </Card>
        )}

        {/* Pay */}
        {o?.pay && !(o.pay.unrated && o.pay.estimate === 0) && (
          <Card>
            <Text style={s.cardTitle}>Estimated pay</Text>
            {o.pay.hourlyPay > 0 && <PayRow label={`Time on site · ${fmtMins(o.pay.hours * 60)}`} value={o.pay.hourlyPay} />}
            {o.pay.mileagePay > 0 && <PayRow label={`Mileage · ${fmtKm(o.pay.paidKm, unit)}`} value={o.pay.mileagePay} />}
            {o.pay.unitPay > 0 && <PayRow label="Per-unit work" value={o.pay.unitPay} />}
            {o.pay.flatPay > 0 && <PayRow label="Flat pay" value={o.pay.flatPay} />}
            <View style={s.payTotal}>
              <Text style={s.payTotalLabel}>Estimated total</Text>
              <Text style={s.payTotalValue}>{money(o.pay.estimate)}</Text>
            </View>
            <Text style={s.fine}>Final pay is worked out from your actual time and distance when the job is done.</Text>
          </Card>
        )}

        {/* Scope */}
        {o && (
          <Card>
            <Text style={s.cardTitle}>The work</Text>
            {!!o.scope.description && <Text style={s.body}>{o.scope.description}</Text>}
            {(!!o.scope.skillClass || o.scope.skills.length > 0) && (
              <View style={s.chips}>
                {[o.scope.skillClass, ...o.scope.skills].filter(Boolean).map((k) => (
                  <View key={k} style={s.chip}>
                    <Wrench color={C.sub} size={12} />
                    <Text style={s.chipTxt}>{k}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!j.staffNotes && <Block icon={<Note color={C.brand} size={15} />} title="From dispatch" text={j.staffNotes} />}
            {!!j.notes && <Block icon={<Note color={C.sub} size={15} />} title={`From the ${customerNoun.toLowerCase()}`} text={j.notes} />}
            {o.scope.lines.length > 0 && (
              <View style={s.block}>
                <View style={s.blockHead}>
                  <Package color={C.sub} size={15} />
                  <Text style={s.blockTitle}>Parts and work</Text>
                </View>
                {o.scope.lines.map((l, i) => (
                  <Text key={`${l.name}-${i}`} style={s.listItem}>
                    • {l.qty > 0 ? `${l.qty}${l.unit ? ` ${l.unit}` : " ×"} ` : ""}
                    {l.name}
                  </Text>
                ))}
              </View>
            )}
            {o.scope.form && (
              <View style={s.block}>
                <View style={s.blockHead}>
                  <ClipboardText color={C.sub} size={15} />
                  <Text style={s.blockTitle}>
                    Form to fill in: {o.scope.form.name} · {o.scope.form.questions} question{o.scope.form.questions === 1 ? "" : "s"}
                  </Text>
                </View>
                {o.scope.form.sections.length > 0 && <Text style={s.body}>{o.scope.form.sections.join(" · ")}</Text>}
              </View>
            )}
            {!o.scope.form && o.scope.checklist.length > 0 && (
              <View style={s.block}>
                <View style={s.blockHead}>
                  <ListChecks color={C.sub} size={15} />
                  <Text style={s.blockTitle}>Checklist</Text>
                </View>
                {o.scope.checklist.map((c, i) => (
                  <Text key={`${c.label}-${i}`} style={s.listItem}>
                    • {c.label}
                    {c.required ? <Text style={s.req}>  required</Text> : null}
                  </Text>
                ))}
              </View>
            )}
            {!o.scope.description &&
              !j.staffNotes &&
              !j.notes &&
              o.scope.lines.length === 0 &&
              !o.scope.form &&
              o.scope.checklist.length === 0 && <Text style={s.body}>No extra details on this {jobNoun.toLowerCase()}.</Text>}
          </Card>
        )}
        <View style={{ height: 110 }} />
      </ScrollView>

      {open ? (
        <View style={s.footer}>
          <Button title="Decline" variant="outline" disabled={busy} onPress={() => setDeclineOpen(true)} style={{ flex: 1 }} />
          <Button title="Accept" variant="success" loading={busy && accept.isPending} disabled={busy} onPress={doAccept} style={{ flex: 2 }} />
        </View>
      ) : o?.assignStatus === "accepted" ? (
        <View style={s.footer}>
          <Button title={`Open ${jobNoun.toLowerCase()}`} onPress={() => router.replace(`/job/${id}` as never)} style={{ flex: 1 }} />
        </View>
      ) : null}

      <DeclineSheet
        visible={declineOpen}
        jobNoun={jobNoun}
        reasons={o?.declineReasons}
        loading={busy && decline.isPending}
        onClose={() => setDeclineOpen(false)}
        onSubmit={doDecline}
      />
    </SafeAreaView>
  );
}

function Line({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={s.line}>
      {icon}
      <Text style={s.lineTxt}>{text}</Text>
    </View>
  );
}

function Tile({ icon, label, value, sub, valueColor }: { icon: React.ReactNode; label: string; value: string; sub: string; valueColor?: string }) {
  return (
    <View style={s.tile} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`}>
      {icon}
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, valueColor ? { color: valueColor } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {!!sub && <Text style={s.tileSub}>{sub}</Text>}
    </View>
  );
}

function PayRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.payRow}>
      <Text style={s.payLabel}>{label}</Text>
      <Text style={s.payValue}>{money(value)}</Text>
    </View>
  );
}

function Block({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <View style={s.block}>
      <View style={s.blockHead}>
        {icon}
        <Text style={s.blockTitle}>{title}</Text>
      </View>
      <Text style={s.body}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, color: C.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  scroll: { ...WIDE, padding: 16, gap: 14 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, borderColor: C.amber, borderWidth: 1 },
  bannerTxt: { color: C.text, fontSize: 14, fontWeight: "700", flex: 1 },
  practiceTag: { color: C.amber, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8 },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  title: { color: C.text, fontSize: 20, fontWeight: "900", flex: 1 },
  urgent: { backgroundColor: C.redBg, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 3 },
  urgentTxt: { color: C.red, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  lineTxt: { color: C.sub, fontSize: 14, flex: 1 },
  price: { color: C.sub, fontSize: 13, marginTop: 10 },
  tiles: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 3,
  },
  tileLabel: { color: C.sub, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 },
  tileValue: { color: C.text, fontSize: 18, fontWeight: "900" },
  tileSub: { color: C.muted, fontSize: 12 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "800", marginBottom: 6 },
  body: { color: C.sub, fontSize: 14, lineHeight: 20 },
  fine: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  payLabel: { color: C.sub, fontSize: 14 },
  payValue: { color: C.text, fontSize: 14, fontWeight: "700" },
  payTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 6,
    paddingTop: 8,
  },
  payTotalLabel: { color: C.text, fontSize: 15, fontWeight: "800" },
  payTotalValue: { color: C.green, fontSize: 15, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.bg3,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipTxt: { color: C.sub, fontSize: 12, fontWeight: "700" },
  block: { marginTop: 12, gap: 4 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockTitle: { color: C.text, fontSize: 13, fontWeight: "800", flex: 1 },
  listItem: { color: C.sub, fontSize: 14, lineHeight: 21 },
  req: { color: C.amber, fontSize: 12, fontWeight: "700" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: C.bg2,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
});
