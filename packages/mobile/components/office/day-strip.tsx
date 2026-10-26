import { ScrollView, View, Text, Pressable, StyleSheet } from "react-native";
import { CaretLeft, CaretRight } from "phosphor-react-native";
import { C, R, S } from "../../lib/theme";
import { addDays } from "../../lib/board";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const STRIP_DAYS = 9;

/**
 * Nine days from `from` (yesterday, by default), one chip per day, with the
 * job count under each so a dispatcher can see a heavy day coming without
 * opening it. The arrows page a week at a time; "Today" comes back.
 */
export function DayStrip({
  today,
  day,
  from,
  counts,
  onChange,
  onFrom,
}: {
  today: string;
  day: string;
  /** First day shown; the screen owns it so it can load that range's counts. */
  from: string;
  counts: Record<string, number>;
  onChange: (day: string) => void;
  onFrom: (from: string) => void;
}) {
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(from, i));
  const todayShown = days.includes(today);
  // A ScrollView grows and shrinks like any flex child: on the iPad board it
  // took half the screen, on the jobs list it was squeezed. Size to content.
  return (
    <View style={s.row}>
      <Pressable onPress={() => onFrom(addDays(from, -7))} hitSlop={6} accessibilityRole="button" accessibilityLabel="Previous week" style={s.arrow}>
        <CaretLeft color={C.sub} size={16} weight="bold" />
      </Pressable>
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
      <Pressable onPress={() => onFrom(addDays(from, 7))} hitSlop={6} accessibilityRole="button" accessibilityLabel="Next week" style={s.arrow}>
        <CaretRight color={C.sub} size={16} weight="bold" />
      </Pressable>
      {todayShown ? null : (
        <Pressable
          onPress={() => {
            onFrom(addDays(today, -1));
            onChange(today);
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to today"
          style={s.todayBtn}
        >
          <Text style={s.todayTxt}>Today</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: S.sm },
  arrow: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  strip: { paddingHorizontal: S.xs, gap: S.sm, paddingVertical: S.sm },
  todayBtn: { marginLeft: S.xs, paddingHorizontal: 10, height: 32, borderRadius: R.pill, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.brand, justifyContent: "center" },
  todayTxt: { color: C.brand, fontSize: 12, fontWeight: "800" },
  chip: { width: 56, alignItems: "center", paddingVertical: S.sm, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  dow: { color: C.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  num: { color: C.text, fontSize: 18, fontWeight: "800", marginTop: 2 },
  countWrap: { minHeight: 14 },
  countHidden: { opacity: 0 },
  count: { color: C.sub, fontSize: 10, fontWeight: "700" },
  on: { color: C.brand },
});
