import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { X, User, Wrench, MapPin, Clock, UserCircle, CaretRight, Lightning } from "phosphor-react-native";
import { Button, Card } from "../../components/ui";
import { ClientSheet, ServiceSheet, AddressSheet, TechSheet, Field } from "../../components/office/pickers";
import { DatetimeSheet } from "../../components/office/datetime-sheet";
import { showToast } from "../../components/office/undo-toast";
import { C, R, S, WIDE, fmtDate } from "../../lib/theme";
import { authHeaders } from "../../lib/auth";
import { getActiveCompany } from "../../lib/active-company";
import { useBoard } from "../../lib/use-board";
import { useServices, type ServiceRow } from "../../lib/use-lookups";
import { classifyResponse } from "../../lib/dispatch-result";
import { buildAdminBooking, EMPTY_DRAFT, type DraftErrors, type NewJobDraft, type Priority } from "../../lib/new-job";
import { asap } from "../../lib/when";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");
const PRIORITIES: Array<{ key: Priority; label: string; color: string }> = [
  { key: "low", label: "Low", color: C.muted },
  { key: "normal", label: "Normal", color: C.sub },
  { key: "high", label: "High", color: C.amber },
  { key: "urgent", label: "Urgent", color: C.red },
];

/**
 * Quick create: the four things a dispatcher knows when the phone rings —
 * who, what, where and when — then who takes it. One screen, four cards,
 * each opening a sheet. Pricing, custom fields and forms stay on the web;
 * the job can be finished there afterwards.
 */
export default function NewJob() {
  const router = useRouter();
  const qc = useQueryClient();
  const board = useBoard(null);
  const services = useServices();
  const [d, setD] = useState<NewJobDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [sheet, setSheet] = useState<"client" | "service" | "address" | "when" | "who" | null>(null);
  const [saving, setSaving] = useState(false);

  const tz = board.data?.tz ?? "UTC";
  const svc = useMemo(() => (services.data ?? []).find((x) => x.id === d.serviceId) ?? null, [services.data, d.serviceId]);
  const tech = useMemo(() => (d.riderId ? (board.data?.techs ?? []).find((t) => t.id === d.riderId) : undefined), [board.data?.techs, d.riderId]);
  const patch = (p: Partial<NewJobDraft>) => {
    setD((prev) => ({ ...prev, ...p }));
    setErrors({});
  };

  const [whoPicked, setWhoPicked] = useState(false);

  function pickService(s: ServiceRow) {
    patch({ serviceId: s.id });
    setSheet(null);
  }

  async function submit(force = false) {
    const built = buildAdminBooking(d, new Date(), { force });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setSaving(true);
    let res: Response;
    try {
      res = await fetch(`${API}/api/bookings/admin`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(built.body),
      });
    } catch {
      setSaving(false);
      Alert.alert("No connection", "Check your signal and try again.");
      return;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const r = classifyResponse<{ id: string }>(res.status, body);
    setSaving(false);
    if (r.ok) {
      qc.invalidateQueries({ queryKey: ["board", getActiveCompany()] });
      showToast(tech ? `Created and sent to ${tech.name}` : "Created — waiting for a technician");
      router.replace(`/office/job/${r.job.id}`);
      return;
    }
    if (r.forceable) {
      Alert.alert(`Send ${tech?.name ?? "them"} anyway?`, r.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Book anyway", style: "destructive", onPress: () => submit(true) },
      ]);
      return;
    }
    Alert.alert("Couldn't create the job", r.message);
  }

  const whenLabel = d.when ? (d.when.kind === "asap" ? `ASAP · ~${fmtDate(asap(new Date()).toISOString())}` : fmtDate(d.when.iso)) : "Pick a time";

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Text style={s.topTitle}>New job</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <X color={C.sub} size={22} />
        </Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.content, WIDE]} keyboardShouldPersistTaps="handled">
          <PickCard
            icon={<User color={C.brand} size={20} weight="fill" />}
            label="Client"
            value={d.client ? (d.client.kind === "existing" ? d.client.name : `${d.client.name} (new)`) : undefined}
            placeholder="Who is it for?"
            error={errors.client}
            onPress={() => setSheet("client")}
          />

          <PickCard
            icon={<Wrench color={C.brand} size={20} weight="fill" />}
            label="Service"
            value={svc ? `${svc.name} · ${svc.durationMins} min` : undefined}
            placeholder="What needs doing?"
            error={errors.serviceId}
            onPress={() => setSheet("service")}
          >
            <View style={s.prioRow}>
              {PRIORITIES.map((p) => {
                const on = d.priority === p.key;
                return (
                  <Pressable key={p.key} onPress={() => patch({ priority: p.key })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.prio, on && { borderColor: p.color, backgroundColor: p.color + "22" }]}>
                    <Text style={[s.prioTxt, on && { color: p.color }]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Field label="Notes for the tech" value={d.notes} onChange={(v) => patch({ notes: v })} placeholder="Gate code, where the panel is, what the client said…" multiline />
          </PickCard>

          <PickCard
            icon={<MapPin color={C.brand} size={20} weight="fill" />}
            label="Address"
            value={d.address || undefined}
            placeholder="Where?"
            error={errors.address}
            onPress={() => setSheet("address")}
          >
            {!d.address && d.client?.kind === "existing" && d.client.lastAddress ? (
              <Button title={`Use ${d.client.lastAddress}`} small variant="ghost" onPress={() => patch({ address: d.client!.kind === "existing" ? (d.client!.lastAddress ?? "") : "", lat: null, lng: null })} />
            ) : null}
          </PickCard>

          <PickCard
            icon={<Clock color={C.brand} size={20} weight="fill" />}
            label="When"
            value={d.when ? whenLabel : undefined}
            placeholder="Pick a time"
            error={errors.when}
            onPress={() => setSheet("when")}
          >
            {!d.when ? (
              <Button title="ASAP" small variant="outline" icon={<Lightning color={C.amber} size={16} weight="fill" />} onPress={() => patch({ when: { kind: "asap" } })} />
            ) : null}
          </PickCard>

          <PickCard
            icon={<UserCircle color={C.brand} size={20} weight="fill" />}
            label="Who takes it"
            value={tech ? tech.name : whoPicked ? "Offer later — unassigned" : undefined}
            placeholder="Pick a technician, or offer later"
            onPress={() => setSheet("who")}
          />

          <Button title={tech ? `Create and send to ${tech.name}` : "Create job"} loading={saving} onPress={() => submit()} style={{ marginTop: S.md }} />
          <Text style={s.foot}>Pricing, line items, custom fields and forms can be added to the job in the web console.</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <ClientSheet
        open={sheet === "client"}
        onClose={() => setSheet(null)}
        onPick={(c) => {
          patch({ client: c, address: d.address || (c.kind === "existing" ? (c.lastAddress ?? "") : "") });
          setSheet(null);
        }}
      />
      <ServiceSheet open={sheet === "service"} value={d.serviceId} onClose={() => setSheet(null)} onPick={pickService} />
      <AddressSheet
        open={sheet === "address"}
        initial={d.address}
        onClose={() => setSheet(null)}
        onPick={(a) => {
          patch({ address: a.address, lat: a.lat, lng: a.lng });
          setSheet(null);
        }}
      />
      <DatetimeSheet
        open={sheet === "when"}
        tz={tz}
        initial={d.when?.kind === "at" ? d.when.iso : null}
        onClose={() => setSheet(null)}
        onPick={(iso, kind) => {
          patch({ when: kind === "asap" ? { kind: "asap" } : { kind: "at", iso } });
          setSheet(null);
        }}
      />
      <TechSheet
        open={sheet === "who"}
        value={d.riderId}
        onClose={() => setSheet(null)}
        onPick={(t) => {
          patch({ riderId: t?.id ?? null });
          setWhoPicked(true);
          setSheet(null);
        }}
      />
    </SafeAreaView>
  );
}

function PickCard({
  icon,
  label,
  value,
  placeholder,
  error,
  onPress,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  placeholder: string;
  error?: string;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Card style={error ? { borderColor: C.red } : undefined}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? placeholder}`} style={({ pressed }) => [s.pick, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={s.iconWrap}>{icon}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.label}>{label}</Text>
          <Text style={[s.value, !value && s.placeholder]} numberOfLines={2}>
            {value ?? placeholder}
          </Text>
        </View>
        <CaretRight color={C.muted} size={18} />
      </Pressable>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {children ? <View style={s.extra}>{children}</View> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingVertical: S.md },
  topTitle: { color: C.text, fontSize: 22, fontWeight: "800" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl * 2 },
  pick: { flexDirection: "row", alignItems: "center", gap: S.md },
  iconWrap: { width: 40, height: 40, borderRadius: R.control, backgroundColor: "rgba(14,165,233,0.12)", alignItems: "center", justifyContent: "center" },
  label: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  value: { color: C.text, fontSize: 16, fontWeight: "700", marginTop: 2 },
  placeholder: { color: C.sub, fontWeight: "500" },
  error: { color: C.red, fontSize: 12, marginTop: S.sm },
  extra: { marginTop: S.md, gap: S.sm },
  prioRow: { flexDirection: "row", gap: S.sm },
  prio: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: R.control, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3 },
  prioTxt: { color: C.sub, fontSize: 12, fontWeight: "800" },
  foot: { color: C.muted, fontSize: 12, textAlign: "center", lineHeight: 17, marginTop: S.sm },
});
