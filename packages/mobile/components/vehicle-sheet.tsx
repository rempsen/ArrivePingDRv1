import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView, type TextInputInstance } from "react-native";
import { Van } from "phosphor-react-native";
import { api } from "../lib/api";
import { messageFromBody, SIGNED_OUT } from "../lib/api-error";
import { useBottomBarPadding } from "../lib/bottom-inset";
import { C, R } from "../lib/theme";
import {
  COLOR_MAX,
  PLATE_MAX,
  VEHICLE_MAX,
  formFromRider,
  vehiclePatch,
  vehicleProblem,
  vehicleUnchanged,
  type VehicleForm,
} from "../lib/vehicle-form";

type RiderVehicle = { vehicle?: string | null; vehicleColor?: string | null; licensePlate?: string | null };

/**
 * "My vehicle" — a technician edits the make & model, colour and plate of
 * their own vehicle from Profile. Saves straight to their rider profile
 * (PATCH /api/riders/me), so the office and customers see the change at once.
 */
export function VehicleSheet({ open, rider, onClose, onSaved }: { open: boolean; rider: RiderVehicle | null | undefined; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<VehicleForm>(() => formFromRider(rider));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const colorRef = useRef<TextInputInstance>(null);
  const plateRef = useRef<TextInputInstance>(null);
  // Above Android's navigation bar when the phone shows one (lib/bottom-inset-core.ts).
  const sheetPad = useBottomBarPadding(34, 20);

  // Start from what's on file each time it opens, not from a previous abandoned edit.
  useEffect(() => {
    if (!open) return;
    setForm(formFromRider(rider));
    setErr("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const problem = vehicleProblem(form);
  const unchanged = vehicleUnchanged(form, rider);
  const canSave = !problem && !unchanged && !busy;
  const set = (k: keyof VehicleForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api.riders.me.$patch({ json: vehiclePatch(form) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(messageFromBody(body) ?? (res.status === 401 ? SIGNED_OUT : "Couldn't save your vehicle. Check your connection and try again."));
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Couldn't save your vehicle. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: sheetPad }]} accessibilityViewIsModal>
          <View style={s.handle} />
          <View style={s.titleRow}>
            <View style={s.iconWrap}>
              <Van color={C.brand} size={20} weight="bold" />
            </View>
            <Text style={s.title}>My vehicle</Text>
          </View>
          <Text style={s.body}>Dispatch and your customers see this, so keep it current if you switch vehicles.</Text>

          <Text style={s.label}>Make and model</Text>
          <TextInput
            value={form.vehicle}
            onChangeText={set("vehicle")}
            placeholder="Ford Transit"
            placeholderTextColor={C.muted}
            style={s.input}
            maxLength={VEHICLE_MAX}
            editable={!busy}
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => colorRef.current?.focus()}
            accessibilityLabel="Make and model"
          />

          <Text style={s.label}>Colour</Text>
          <TextInput
            ref={colorRef}
            value={form.vehicleColor}
            onChangeText={set("vehicleColor")}
            placeholder="White"
            placeholderTextColor={C.muted}
            style={s.input}
            maxLength={COLOR_MAX}
            editable={!busy}
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => plateRef.current?.focus()}
            accessibilityLabel="Colour"
          />

          <Text style={s.label}>License plate</Text>
          <TextInput
            ref={plateRef}
            value={form.licensePlate}
            onChangeText={set("licensePlate")}
            placeholder="ABC 123"
            placeholderTextColor={C.muted}
            style={s.input}
            maxLength={PLATE_MAX}
            editable={!busy}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel="License plate"
          />

          {!!err && (
            <Text style={[s.body, { color: C.red }]} accessibilityRole="alert">
              {err}
            </Text>
          )}

          <View style={s.actions}>
            <Pressable onPress={onClose} disabled={busy} style={s.cancel} accessibilityRole="button">
              <Text style={s.cancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={!canSave}
              style={[s.save, !canSave && { opacity: 0.45 }]}
              accessibilityRole="button"
              accessibilityLabel="Save vehicle"
              accessibilityHint={problem ?? undefined}
              accessibilityState={{ disabled: !canSave, busy }}
            >
              {busy && <ActivityIndicator color="#04121c" size="small" />}
              <Text style={s.saveTxt}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 34,
    gap: 8,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: R.control, backgroundColor: "rgba(14,165,233,0.14)", alignItems: "center", justifyContent: "center" },
  title: { color: C.text, fontSize: 18, fontWeight: "800" },
  body: { color: C.sub, fontSize: 13.5, lineHeight: 19, marginBottom: 4 },
  label: { color: C.text, fontSize: 12.5, fontWeight: "700", marginTop: 6 },
  input: {
    height: 46,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg3,
    color: C.text,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 10 },
  cancel: { height: 44, paddingHorizontal: 16, justifyContent: "center" },
  cancelTxt: { color: C.sub, fontSize: 15, fontWeight: "600" },
  save: { height: 44, paddingHorizontal: 22, borderRadius: R.control, backgroundColor: C.brand, flexDirection: "row", alignItems: "center", gap: 8 },
  saveTxt: { color: "#04121c", fontSize: 15, fontWeight: "700" },
});
