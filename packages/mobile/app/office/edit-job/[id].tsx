import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, KeyboardAvoidingView, Platform, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { X, User, Wrench, MapPin, Clock, Trash, Plus, Warning } from "phosphor-react-native";
import { Button, Card, Empty, FullLoader } from "../../../components/ui";
import { ClientSheet, ServiceSheet, AddressSheet, Field } from "../../../components/office/pickers";
import { DatetimeSheet } from "../../../components/office/datetime-sheet";
import { PickCard } from "../../../components/office/pick-card";
import { CustomFieldInput } from "../../../components/office/field-inputs";
import { showToast } from "../../../components/office/undo-toast";
import { C, R, S, WIDE } from "../../../lib/theme";
import { authHeaders } from "../../../lib/auth";
import { getActiveCompany } from "../../../lib/active-company";
import { useBooking, bookingKey } from "../../../lib/use-booking";
import { useBoard } from "../../../lib/use-board";
import { useAccess } from "../../../lib/use-access";
import { classifyResponse } from "../../../lib/dispatch-result";
import { buildPatch, draftFromBooking, isEmptyPatch, OFFICE_STATUSES, PRIORITIES, setFieldValue, validateEdit, isEditableField, type EditDraft, type EditErrors } from "../../../lib/edit-job";
import { customLine, sumLineItems, withTotals } from "../../../lib/line-items";
import { fmtInTz } from "../../../lib/when";
import { geocodeAddress } from "../../../lib/use-lookups";
import { STATUS_LABEL } from "../../../lib/board";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");
const PRIO_COLOR: Record<string, string> = { low: C.sub, normal: C.brand, high: C.amber, urgent: C.red };
const STATUS_WORD: Record<string, string> = { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };

/**
 * The full work-order editor, phone and iPad. Everything the office edits on
 * the web modal that makes sense on a touch screen: the job itself, the
 * client and where, the notes, the template's custom fields, and the line
 * items. Rate models, tech pay and intake-form design stay on the web.
 *
 * Saves are one PATCH with only what changed; a forceable 409 (the new time
 * double-books the technician) offers "Save anyway". A status change goes
 * through its own endpoint after the patch lands.
 */
export default function EditJob() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAccess();
  const job = useBooking(id);
  const board = useBoard(null);
  const tz = board.data?.tz ?? "UTC";

  const [original, setOriginal] = useState<EditDraft | null>(null);
  const [d, setD] = useState<EditDraft | null>(null);
  const [errors, setErrors] = useState<EditErrors>({});
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<"client" | "service" | "address" | "when" | null>(null);
  const [newLine, setNewLine] = useState<{ name: string; qty: string; price: string } | null>(null);
  // What's typed in a line's qty / price box, kept as text so "10." survives
  // the keystroke; the draft gets the parsed number.
  const [lineText, setLineText] = useState<Record<string, string>>({});
  const lineField = (i: number, key: "qty" | "unitPrice", fallback: number) => lineText[`${i}:${key}`] ?? String(fallback);
  const setLineField = (i: number, key: "qty" | "unitPrice", t: string) => {
    setLineText((m) => ({ ...m, [`${i}:${key}`]: t }));
    const n = Number(t);
    if (t.trim() !== "" && Number.isFinite(n)) update({ lineItems: d!.lineItems.map((x, j) => (j === i ? withTotals({ ...x, [key]: n }) : x)) });
  };

  // Seed the draft once from the loaded job; later refetches don't clobber edits.
  useEffect(() => {
    if (job.data && !original) {
      const seed = draftFromBooking(job.data);
      setOriginal(seed);
      setD(seed);
    }
  }, [job.data, original]);

  const totals = useMemo(() => (d ? sumLineItems(d.lineItems.map(withTotals)) : null), [d]);
  const update = (patch: Partial<EditDraft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));
  const editable = can("work_orders:edit");

  async function save(force = false) {
    if (!d || !original) return;
    const errs = validateEdit(d);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // An address typed or taken from the client's record has no coordinates
    // yet; PATCH only writes what it's sent, so the old pin would survive the
    // new street. Resolve it first, or stop.
    let draft = d;
    if (d.address !== original.address && (d.lat == null || d.lng == null)) {
      setSaving(true);
      const hit = await geocodeAddress(d.address).catch(() => null);
      setSaving(false);
      if (!hit) {
        Alert.alert("Couldn't place that address", "Pick it from the suggestions so the technician gets the right pin.");
        return;
      }
      draft = { ...d, lat: hit.lat, lng: hit.lng };
      setD(draft);
    }
    const patch = buildPatch(draft, original, { force });
    const statusChanged = draft.status !== original.status;
    if (isEmptyPatch(patch) && !statusChanged) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      if (!isEmptyPatch(patch)) {
        const res = await fetch(`${API}/api/bookings/${encodeURIComponent(id!)}`, {
          method: "PATCH",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(patch),
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const r = classifyResponse<{ id: string }>(res.status, body);
        if (!r.ok) {
          setSaving(false);
          if (r.forceable && !force) {
            Alert.alert("Save anyway?", r.message, [
              { text: "Cancel", style: "cancel" },
              { text: "Save anyway", style: "destructive", onPress: () => save(true) },
            ]);
            return;
          }
          Alert.alert("Couldn't save", r.message);
          return;
        }
      }
      if (statusChanged) {
        const res = await fetch(`${API}/api/bookings/${encodeURIComponent(id!)}/status`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ status: draft.status }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          setSaving(false);
          Alert.alert("Saved, but the status didn't change", j.message || `The server said ${res.status}.`);
          qc.invalidateQueries({ queryKey: bookingKey(getActiveCompany(), id!) });
          qc.invalidateQueries({ queryKey: ["board", getActiveCompany()] });
          return;
        }
      }
    } catch {
      setSaving(false);
      Alert.alert("No connection", "Check your signal and try again.");
      return;
    }
    setSaving(false);
    qc.invalidateQueries({ queryKey: bookingKey(getActiveCompany(), id!) });
    qc.invalidateQueries({ queryKey: ["board", getActiveCompany()] });
    showToast("Saved");
    router.back();
  }

  function addLine() {
    if (!newLine) return;
    const qty = Number(newLine.qty);
    const price = Number(newLine.price);
    if (!newLine.name.trim() || !(qty > 0) || !(price >= 0)) {
      Alert.alert("Check the line", "A name, a quantity above zero and a price of zero or more.");
      return;
    }
    update({ lineItems: [...d!.lineItems, customLine(newLine.name, qty, price)] });
    setNewLine(null);
  }

  const dirty = d && original && (!isEmptyPatch(buildPatch(d, original)) || d.status !== original.status);
  function close() {
    if (dirty) {
      Alert.alert("Discard changes?", undefined, [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ]);
    } else router.back();
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <X color={C.sub} size={22} />
        </Pressable>
        <Text style={s.topTitle}>Edit job</Text>
        <Button title="Save" small loading={saving} disabled={!d || !editable} onPress={() => save()} />
      </View>

      {job.isLoading || !d ? (
        job.isError ? (
          <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load this job" sub={(job.error as Error)?.message} />
        ) : (
          <FullLoader />
        )
      ) : !editable ? (
        <Empty icon={<Warning color={C.amber} size={28} />} text="Your role can view this job but not edit it" sub="Ask an admin on your account." />
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[s.content, WIDE]} keyboardShouldPersistTaps="handled">
            {/* The job */}
            <Card>
              <Field label="Title" value={d.title} onChange={(v) => update({ title: v })} placeholder={d.serviceName || "What's the job?"} />
              {errors.title ? <Text style={s.error}>{errors.title}</Text> : null}
              <Text style={[s.label, { marginTop: S.md }]}>Priority</Text>
              <View style={s.chips}>
                {PRIORITIES.map((p) => {
                  const on = d.priority === p;
                  return (
                    <Pressable key={p} onPress={() => update({ priority: p })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.chip, on && { borderColor: PRIO_COLOR[p], backgroundColor: PRIO_COLOR[p] + "26" }]}>
                      <Text style={[s.chipTxt, on && { color: PRIO_COLOR[p] }]}>{p[0]!.toUpperCase() + p.slice(1)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[s.label, { marginTop: S.md }]}>Status</Text>
              <View style={s.chips}>
                {OFFICE_STATUSES.map((st) => {
                  const on = d.status === st;
                  return (
                    <Pressable key={st} onPress={() => update({ status: st })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
                      <Text style={[s.chipTxt, on && { color: C.brand }]}>{STATUS_WORD[st]}</Text>
                    </Pressable>
                  );
                })}
                {!(OFFICE_STATUSES as readonly string[]).includes(d.status) ? (
                  <View style={[s.chip, s.chipOn]}>
                    <Text style={[s.chipTxt, { color: C.brand }]}>{STATUS_LABEL[d.status] ?? d.status} (in the field)</Text>
                  </View>
                ) : null}
              </View>
              {!(OFFICE_STATUSES as readonly string[]).includes(original!.status) ? <Text style={s.hint}>The technician's clock owns this status; pick one here only to override it.</Text> : null}
            </Card>

            <PickCard icon={<Wrench color={C.brand} size={20} weight="fill" />} label="Service" value={d.serviceName || undefined} placeholder="Pick a service" onPress={() => setSheet("service")} />
            <PickCard icon={<User color={C.brand} size={20} weight="fill" />} label="Client" value={d.customerName || undefined} placeholder="Pick a client" onPress={() => setSheet("client")}>
              <Field label="Phone for this job" value={d.customerPhone} onChange={(v) => update({ customerPhone: v })} keyboardType="phone-pad" placeholder="Optional" />
              {errors.customerPhone ? <Text style={s.error}>{errors.customerPhone}</Text> : null}
            </PickCard>
            <PickCard icon={<MapPin color={C.brand} size={20} weight="fill" />} label="Address" value={d.address || undefined} placeholder="Where is it?" error={errors.address} onPress={() => setSheet("address")} />
            <PickCard icon={<Clock color={C.brand} size={20} weight="fill" />} label="When" value={fmtInTz(d.scheduledAt, tz)} placeholder="Pick a time" onPress={() => board.data && setSheet("when")} />

            {/* Notes */}
            <Card>
              <Field label="Notes for the tech" value={d.notes} onChange={(v) => update({ notes: v })} multiline placeholder="Gate code, parking, what to bring…" />
              <View style={{ height: S.md }} />
              <Field label="Office notes" value={d.staffNotes} onChange={(v) => update({ staffNotes: v })} multiline placeholder="Internal, never shown to the client" />
            </Card>

            {/* Template fields */}
            {d.fields.length > 0 ? (
              <Card>
                <Text style={s.cardTitle}>Job fields</Text>
                <View style={{ gap: S.md }}>
                  {d.fields.map((f) => (
                    <CustomFieldInput key={f.id} def={f} value={d.fieldData[f.id]} tz={tz} onChange={(v) => setD((cur) => (cur ? setFieldValue(cur, f.id, v) : cur))} />
                  ))}
                </View>
                {errors.fields ? <Text style={s.error}>{errors.fields}</Text> : null}
                {d.fields.some((f) => !isEditableField(f)) ? <Text style={s.hint}>Photos and signatures are captured in the field or on the web.</Text> : null}
              </Card>
            ) : null}

            {/* Line items */}
            <Card>
              <Text style={s.cardTitle}>Line items</Text>
              {d.lineItems.length === 0 ? <Text style={s.hint}>No lines yet. The service's base price applies.</Text> : null}
              {d.lineItems.map((li, i) => (
                <View key={`${li.itemId}-${i}`} style={s.line}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.lineName} numberOfLines={1}>
                      {li.name || "Line"}
                    </Text>
                    <Text style={s.lineMeta}>
                      {li.kind}
                      {li.sku ? ` · ${li.sku}` : ""}
                      {li.taxable === false ? " · no tax" : ""}
                    </Text>
                  </View>
                  <TextInput
                    value={lineField(i, "qty", li.qty)}
                    onChangeText={(t) => setLineField(i, "qty", t)}
                    keyboardType="decimal-pad"
                    style={[s.lineInput, { width: 56 }]}
                    accessibilityLabel={`Quantity for ${li.name}`}
                  />
                  <Text style={s.times}>×</Text>
                  <TextInput
                    value={lineField(i, "unitPrice", li.unitPrice)}
                    onChangeText={(t) => setLineField(i, "unitPrice", t)}
                    keyboardType="decimal-pad"
                    style={[s.lineInput, { width: 80 }]}
                    accessibilityLabel={`Unit price for ${li.name}`}
                  />
                  <Text style={s.lineTotal} allowFontScaling={false}>
                    ${withTotals(li).price.toFixed(2)}
                  </Text>
                  <Pressable
                    onPress={() => {
                      setLineText({});
                      update({ lineItems: d.lineItems.filter((_, j) => j !== i) });
                    }}
                    hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${li.name}`}>
                    <Trash color={C.muted} size={18} />
                  </Pressable>
                </View>
              ))}
              {errors.lineItems ? <Text style={s.error}>{errors.lineItems}</Text> : null}
              {newLine ? (
                <View style={s.newLine}>
                  <TextInput value={newLine.name} onChangeText={(t) => setNewLine({ ...newLine, name: t })} placeholder="Description" placeholderTextColor={C.muted} style={[s.lineInput, { flex: 1 }]} accessibilityLabel="New line description" />
                  <TextInput value={newLine.qty} onChangeText={(t) => setNewLine({ ...newLine, qty: t })} placeholder="Qty" placeholderTextColor={C.muted} keyboardType="decimal-pad" style={[s.lineInput, { width: 56 }]} accessibilityLabel="New line quantity" />
                  <TextInput value={newLine.price} onChangeText={(t) => setNewLine({ ...newLine, price: t })} placeholder="Price" placeholderTextColor={C.muted} keyboardType="decimal-pad" style={[s.lineInput, { width: 80 }]} accessibilityLabel="New line price" />
                  <Button title="Add" small onPress={addLine} />
                </View>
              ) : (
                <Button title="Add line" small variant="outline" icon={<Plus color={C.text} size={16} weight="bold" />} onPress={() => setNewLine({ name: "", qty: "1", price: "" })} style={{ alignSelf: "flex-start", marginTop: S.sm }} />
              )}
              {totals && d.lineItems.length > 0 ? (
                <View style={s.totals}>
                  <Text style={s.totalLbl}>Subtotal (pre-tax)</Text>
                  <Text style={s.totalVal}>${totals.price.toFixed(2)}</Text>
                </View>
              ) : null}
            </Card>

            <Text style={s.foot}>Rate models, tech pay and form design are edited in the web console.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {d ? (
        <>
          <ClientSheet
            open={sheet === "client"}
            onClose={() => setSheet(null)}
            onPick={(c) => {
              if (c.kind === "new") {
                Alert.alert("New clients are created from New job", "Pick an existing client here, or create the client first.");
                return;
              }
              // A different client means their number and their place; the old
              // client's phone must never ride along (it's where texts go).
              update({ customerId: c.id, customerName: c.name, customerPhone: c.phone ?? "", ...(c.lastAddress ? { address: c.lastAddress, lat: null, lng: null } : {}) });
              setSheet(null);
            }}
          />
          <ServiceSheet
            open={sheet === "service"}
            value={d.serviceId || null}
            onClose={() => setSheet(null)}
            onPick={(svc) => {
              update({ serviceId: svc.id, serviceName: svc.name });
              setSheet(null);
            }}
          />
          <AddressSheet
            open={sheet === "address"}
            initial={d.address}
            onClose={() => setSheet(null)}
            onPick={(a) => {
              update({ address: a.address, lat: a.lat, lng: a.lng });
              setSheet(null);
            }}
          />
          {board.data ? (
            <DatetimeSheet
              open={sheet === "when"}
              title="Move to"
              tz={tz}
              initial={d.scheduledAt}
              allowAsap={false}
              onClose={() => setSheet(null)}
              onPick={(iso) => {
                update({ scheduledAt: iso });
                setSheet(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  topTitle: { color: C.text, fontSize: 20, fontWeight: "800", flex: 1 },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl * 2 },
  cardTitle: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: S.sm },
  label: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: S.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: R.pill, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  chipTxt: { color: C.sub, fontSize: 13, fontWeight: "700" },
  hint: { color: C.muted, fontSize: 12, marginTop: S.sm, lineHeight: 17 },
  error: { color: C.red, fontSize: 12, marginTop: S.sm },
  line: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: S.sm, borderBottomWidth: 1, borderBottomColor: C.border },
  lineName: { color: C.text, fontSize: 14, fontWeight: "700" },
  lineMeta: { color: C.muted, fontSize: 11, marginTop: 1 },
  lineInput: { backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.control, paddingHorizontal: 8, paddingVertical: 8, color: C.text, fontSize: 14, textAlign: "right" },
  times: { color: C.muted, fontSize: 14 },
  lineTotal: { color: C.text, fontSize: 14, fontWeight: "800", minWidth: 68, textAlign: "right" },
  newLine: { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: S.md },
  totals: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.border },
  totalLbl: { color: C.sub, fontSize: 13, fontWeight: "700" },
  totalVal: { color: C.text, fontSize: 18, fontWeight: "900" },
  foot: { color: C.muted, fontSize: 12, textAlign: "center", lineHeight: 17, marginTop: S.sm },
});
