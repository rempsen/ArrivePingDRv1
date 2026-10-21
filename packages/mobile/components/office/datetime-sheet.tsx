import { useEffect, useMemo, useState } from "react";
import { Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Lightning } from "phosphor-react-native";
import { Sheet } from "./sheet";
import { Button } from "../ui";
import { C, R, S } from "../../lib/theme";
import { addDays } from "../../lib/board";
import { asap, daySlots, partsIn, slotLabel, toIso } from "../../lib/when";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Pick a day (next two weeks) and a quarter-hour slot on the company's
 * clock, or "ASAP" (now, rounded up). Returns an ISO instant. No native
 * picker: chips are faster one-handed and identical on both platforms.
 */
export function DatetimeSheet({
  open,
  title = "When",
  tz,
  initial,
  allowAsap = true,
  busy,
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  tz: string;
  initial?: string | null;
  allowAsap?: boolean;
  busy?: boolean;
  onClose: () => void;
  onPick: (iso: string, kind: "asap" | "at") => void;
}) {
  const now = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps -- fresh per open
  const start = useMemo(() => (initial ? partsIn(new Date(initial), tz) : partsIn(now, tz)), [initial, tz, now]);
  const today = partsIn(now, tz).day;
  const [day, setDay] = useState(start.day);
  const [slot, setSlot] = useState<{ hour: number; minute: number }>({ hour: start.hour, minute: Math.floor(start.minute / 15) * 15 });
  // The sheet can mount before the company's timezone is known, or stay
  // mounted while the job's time changes. Re-derive the selection every time
  // it opens, or the inputs change, so a 9 AM job never shows as 2 PM.
  useEffect(() => {
    if (!open) return;
    setDay(start.day);
    setSlot({ hour: start.hour, minute: Math.floor(start.minute / 15) * 15 });
  }, [open, start.day, start.hour, start.minute]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const slots = useMemo(() => daySlots(), []);
  const nowParts = partsIn(now, tz);
  const isPast = (d: string, h: number, m: number) => d < today || (d === today && (h < nowParts.hour || (h === nowParts.hour && m <= nowParts.minute)));

  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <Button
          title={`Set ${day === today ? "today" : `${DOW[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${Number(day.slice(8, 10))}`} at ${slotLabel(slot.hour, slot.minute)}`}
          loading={busy}
          disabled={isPast(day, slot.hour, slot.minute)}
          onPress={() => onPick(toIso(day, slot.hour, slot.minute, tz), "at")}
        />
      }
    >
      {allowAsap ? (
        <Pressable onPress={() => onPick(asap(now).toISOString(), "asap")} accessibilityRole="button" style={({ pressed }) => [s.asap, { opacity: pressed ? 0.8 : 1 }]}>
          <Lightning color={C.amber} size={18} weight="fill" />
          <Text style={s.asapTxt}>ASAP — next available slot</Text>
        </Pressable>
      ) : null}
      <Text style={s.label}>Day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {days.map((d) => {
          const on = d === day;
          const date = new Date(`${d}T12:00:00Z`);
          return (
            <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
              <Text style={[s.dow, on && s.on]}>{d === today ? "Today" : DOW[date.getUTCDay()]}</Text>
              <Text style={[s.num, on && s.on]}>{date.getUTCDate()}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={s.label}>Time</Text>
      <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={s.grid}>
        {slots.map((sl) => {
          const on = sl.hour === slot.hour && sl.minute === slot.minute;
          const past = isPast(day, sl.hour, sl.minute);
          return (
            <Pressable
              key={`${sl.hour}:${sl.minute}`}
              onPress={() => setSlot(sl)}
              disabled={past}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: past }}
              style={[s.slot, on && s.chipOn, past && s.past]}
            >
              <Text style={[s.slotTxt, on && s.on, past && { color: C.muted }]}>{slotLabel(sl.hour, sl.minute)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  asap: { flexDirection: "row", alignItems: "center", gap: S.sm, padding: S.md, borderRadius: R.control, backgroundColor: C.amberBg, marginBottom: S.sm },
  asapTxt: { color: C.amber, fontSize: 14, fontWeight: "800" },
  label: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: S.md, marginBottom: S.sm },
  strip: { gap: S.sm },
  chip: { width: 56, alignItems: "center", paddingVertical: S.sm, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  dow: { color: C.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  num: { color: C.text, fontSize: 18, fontWeight: "800", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: S.sm, paddingBottom: S.sm },
  slot: { width: "23%", flexGrow: 1, alignItems: "center", paddingVertical: S.sm, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  slotTxt: { color: C.text, fontSize: 13, fontWeight: "700" },
  past: { opacity: 0.4 },
  on: { color: C.brand },
});
