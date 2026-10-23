import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { CheckSquare, Square, CalendarBlank, Paperclip, Info } from "phosphor-react-native";
import { DatetimeSheet } from "./datetime-sheet";
import { C, R, S } from "../../lib/theme";
import type { CustomFieldDef } from "../../lib/edit-job";

/**
 * One custom field on the work-order editor, by type. Photos, signatures and
 * instructions show but don't take input here: capture stays on the
 * technician's app and the web.
 */
export function CustomFieldInput({ def, value, tz, onChange }: { def: CustomFieldDef; value: unknown; tz: string; onChange: (v: unknown) => void }) {
  const [dateOpen, setDateOpen] = useState(false);
  const label = (
    <Text style={s.label}>
      {def.label || "Field"}
      {def.required ? <Text style={{ color: C.red }}> *</Text> : null}
    </Text>
  );
  switch (def.type) {
    case "text":
    case "number":
      return (
        <View>
          {label}
          <TextInput
            value={value == null ? "" : String(value)}
            onChangeText={(t) => onChange(def.type === "number" ? (t.trim() === "" ? "" : Number.isFinite(Number(t)) ? Number(t) : t) : t)}
            keyboardType={def.type === "number" ? "decimal-pad" : "default"}
            placeholder={def.type === "number" ? "0" : "—"}
            placeholderTextColor={C.muted}
            style={s.input}
            accessibilityLabel={def.label}
          />
        </View>
      );
    case "checkbox": {
      const on = value === true || value === "true";
      return (
        <Pressable onPress={() => onChange(!on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={def.label} style={s.check}>
          {on ? <CheckSquare color={C.green} size={22} weight="fill" /> : <Square color={C.muted} size={22} />}
          <Text style={s.checkTxt}>{def.label}</Text>
          {def.required ? <Text style={{ color: C.red }}> *</Text> : null}
        </Pressable>
      );
    }
    case "select":
      return (
        <View>
          {label}
          <View style={s.chips}>
            {(def.options ?? []).map((opt) => {
              const on = value === opt;
              return (
                <Pressable key={opt} onPress={() => onChange(on ? "" : opt)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipTxt, on && { color: C.brand }]}>{opt}</Text>
                </Pressable>
              );
            })}
            {(def.options ?? []).length === 0 ? <Text style={s.quiet}>No options set up.</Text> : null}
          </View>
        </View>
      );
    case "date": {
      const iso = typeof value === "string" && value ? value : null;
      return (
        <View>
          {label}
          <Pressable onPress={() => setDateOpen(true)} accessibilityRole="button" accessibilityLabel={`${def.label}: ${iso ? new Date(iso).toLocaleDateString() : "not set"}`} style={s.dateBtn}>
            <CalendarBlank color={C.brand} size={18} />
            <Text style={[s.dateTxt, !iso && { color: C.muted }]}>{iso ? new Date(iso).toLocaleDateString(undefined, { timeZone: tz }) : "Pick a date"}</Text>
            {iso ? (
              <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${def.label}`}>
                <Text style={s.clear}>Clear</Text>
              </Pressable>
            ) : null}
          </Pressable>
          <DatetimeSheet open={dateOpen} title={def.label || "Date"} tz={tz} initial={iso} allowAsap={false} onClose={() => setDateOpen(false)} onPick={(v) => {
              onChange(v);
              setDateOpen(false);
            }} />
        </View>
      );
    }
    case "instructions":
      return (
        <View style={s.note}>
          <Info color={C.brand} size={16} weight="fill" />
          <Text style={s.noteTxt}>{def.body || def.label}</Text>
        </View>
      );
    default:
      // "file" (photo, signature) and anything newer: shown, not edited.
      return (
        <View style={s.readOnly}>
          <Paperclip color={C.muted} size={16} />
          <Text style={s.readOnlyTxt}>
            {def.label}: {value ? "attached" : "not yet"} — captured in the field or on the web
          </Text>
        </View>
      );
  }
}

const s = StyleSheet.create({
  label: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: { backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.control, paddingHorizontal: S.md, paddingVertical: 10, color: C.text, fontSize: 15 },
  check: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 6 },
  checkTxt: { color: C.text, fontSize: 15, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: S.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: R.pill, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  chipTxt: { color: C.sub, fontSize: 13, fontWeight: "700" },
  quiet: { color: C.muted, fontSize: 12 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: S.sm, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.control, paddingHorizontal: S.md, paddingVertical: 10 },
  dateTxt: { color: C.text, fontSize: 15, flex: 1 },
  clear: { color: C.sub, fontSize: 12, fontWeight: "700" },
  note: { flexDirection: "row", gap: S.sm, backgroundColor: "rgba(14,165,233,0.07)", borderRadius: R.control, padding: S.md },
  noteTxt: { color: C.text, fontSize: 13, lineHeight: 19, flex: 1 },
  readOnly: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 4 },
  readOnlyTxt: { color: C.muted, fontSize: 12, flex: 1 },
});
