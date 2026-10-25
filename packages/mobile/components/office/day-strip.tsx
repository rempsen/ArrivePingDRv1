import { ScrollView, View, Text, Pressable, StyleSheet } from "react-native";
import { C, R, S } from "../../lib/theme";
import { addDays } from "../../lib/board";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Yesterday through a week out, one chip per day, with the job count under
 * each so a dispatcher can see a heavy day coming without opening it.
 */
export function DayStrip({
  today,
  day,
  counts,
  onChange,
}: {
  today: string;
  day: string;
  counts: Record<string, number>;
  onChange: (day: string) => void;
}) {
  const days = Array.from({ length: 9 }, (_, i) => addDays(today, i - 1));
  // A ScrollView grows and shrinks like any flex child: on the iPad board it
  // took half the screen, on the jobs list it was squeezed. Size to content.
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scroll} contentContainerStyle={s.strip}>
      {days.map((d) => {
        const on = d === day;
        const date = new Date(`${d}T12:00:00Z`);
        const n = counts[d];
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${d}${n != null ? `, ${n} jobs` : ""}`}
            style={[s.chip, on && s.chipOn]}
          >
            <Text style={[s.dow, on && s.on]}>{d === today ? "Today" : DOW[date.getUTCDay()]}</Text>
            <Text style={[s.num, on && s.on]} allowFontScaling={false}>
              {date.getUTCDate()}
            </Text>
            <View style={[s.countWrap, n ? null : s.countHidden]}>
              <Text style={[s.count, on && s.on]}>{n ?? ""}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  strip: { paddingHorizontal: S.lg, gap: S.sm, paddingVertical: S.sm },
  chip: { width: 56, alignItems: "center", paddingVertical: S.sm, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  dow: { color: C.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  num: { color: C.text, fontSize: 18, fontWeight: "800", marginTop: 2 },
  countWrap: { minHeight: 14 },
  countHidden: { opacity: 0 },
  count: { color: C.sub, fontSize: 10, fontWeight: "700" },
  on: { color: C.brand },
});
