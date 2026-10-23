import { View, Text, Pressable, StyleSheet } from "react-native";
import { CaretRight } from "phosphor-react-native";
import { Card } from "../ui";
import { C, R, S } from "../../lib/theme";

/** A card that opens a picker sheet: icon, label, the current value or a placeholder. */
export function PickCard({
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
  pick: { flexDirection: "row", alignItems: "center", gap: S.md },
  iconWrap: { width: 40, height: 40, borderRadius: R.control, backgroundColor: "rgba(14,165,233,0.12)", alignItems: "center", justifyContent: "center" },
  label: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  value: { color: C.text, fontSize: 16, fontWeight: "700", marginTop: 2 },
  placeholder: { color: C.sub, fontWeight: "500" },
  error: { color: C.red, fontSize: 12, marginTop: S.sm },
  extra: { marginTop: S.md, gap: S.sm },
});
