import { View, Text, Pressable, StyleSheet } from "react-native";
import { C, R, S } from "../../lib/theme";
import type { Tallies } from "../../lib/board";

/**
 * The four numbers a dispatcher checks first: who is driving, who is at a
 * job, who can take one, who can't right now. Tapping a tile opens Team
 * filtered to that group. Off-shift sits under the tiles as a line, not a
 * tile, so the grid stays four-up and the eye lands on the working crew.
 */
export function StatusTiles({ t, workerNoun = "techs", onPick }: { t: Tallies; workerNoun?: string; onPick?: (status: string) => void }) {
  const tiles: Array<{ key: string; label: string; n: number; color: string; bg: string }> = [
    { key: "enroute", label: "On route", n: t.enroute, color: C.cyan, bg: "rgba(34,211,238,0.14)" },
    { key: "onsite", label: "On site", n: t.onsite, color: "#2dd4bf", bg: "rgba(45,212,191,0.14)" },
    { key: "available", label: "Available", n: t.available, color: C.green, bg: C.greenBg },
    { key: "busy", label: "Busy", n: t.busy, color: C.amber, bg: C.amberBg },
  ];
  return (
    <View>
      <View style={s.grid}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            onPress={onPick ? () => onPick(tile.key) : undefined}
            accessibilityRole="button"
            accessibilityLabel={`${tile.n} ${tile.label.toLowerCase()}`}
            style={({ pressed }) => [s.tile, { backgroundColor: tile.bg, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[s.n, { color: tile.color }]} allowFontScaling={false}>
              {tile.n}
            </Text>
            <Text style={[s.label, { color: tile.color }]}>{tile.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.off}>
        {t.offline === 0 ? `Everyone is on shift` : `${t.offline} ${t.offline === 1 ? workerNoun.replace(/s$/, "") : workerNoun} off shift`}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", gap: S.sm },
  tile: { flex: 1, borderRadius: R.card, paddingVertical: S.md, paddingHorizontal: S.sm, alignItems: "center", gap: 2 },
  n: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  label: { fontSize: 11, fontWeight: "700" },
  off: { color: C.muted, fontSize: 12, marginTop: S.sm, textAlign: "center" },
});
