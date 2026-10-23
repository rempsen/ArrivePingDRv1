import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, S } from "../../lib/theme";
import { LIST_PANE_W } from "../../lib/layout";
import { useLayout } from "../../lib/use-layout";

/**
 * List beside detail on a wide iPad; just the list anywhere else.
 *
 * The list is the phone screen unchanged. The detail is whatever the list
 * selected, rendered `embedded` (see JobDetail / ThreadView / TechDetail), or
 * `empty` when nothing is selected — including when the selection vanished
 * because the job was cancelled or the technician left the roster.
 */
export function SplitScreen({ list, detail, empty }: { list: React.ReactNode; detail: React.ReactNode | null; empty: React.ReactNode }) {
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  if (!wide) return <>{list}</>;
  // The list's own header pads the top inset; the detail pane has none, so
  // it takes the inset here and its content starts level with the header.
  return (
    <View style={s.row}>
      <View style={s.list}>{list}</View>
      <View style={[s.detail, { paddingTop: insets.top }]}>{detail ?? empty}</View>
    </View>
  );
}

/** The right pane before anything is picked. */
export function EmptyPane({ icon, text, sub }: { icon?: React.ReactNode; text: string; sub?: string }) {
  return (
    <View style={s.empty}>
      {icon}
      <Text style={s.emptyText}>{text}</Text>
      {sub ? <Text style={s.emptySub}>{sub}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", backgroundColor: C.bg },
  list: { width: LIST_PANE_W, borderRightWidth: 1, borderRightColor: C.border },
  detail: { flex: 1, minWidth: 0 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: S.sm, padding: S.xl },
  emptyText: { color: C.sub, fontSize: 16, fontWeight: "700" },
  emptySub: { color: C.muted, fontSize: 13, textAlign: "center" },
});
