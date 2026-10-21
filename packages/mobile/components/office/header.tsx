import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UserCircle } from "phosphor-react-native";
import { C, S, WIDE } from "../../lib/theme";
import { useActiveCompanyName } from "../../lib/my-companies";

/**
 * Office screen header: the title, the company being worked (so a
 * superadmin on three tenants always knows which board this is), and the
 * avatar button that opens office Profile. Same on every office tab.
 */
export function OfficeHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const company = useActiveCompanyName();
  return (
    <View style={[s.wrap, { paddingTop: insets.top + S.sm }]}>
      <View style={[s.inner, WIDE]}>
        <View style={{ flex: 1 }}>
          {company ? (
            <Text style={s.company} numberOfLines={1}>
              {company}
            </Text>
          ) : null}
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {right}
        <Pressable
          onPress={() => router.push("/office/profile")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <UserCircle color={C.sub} size={30} weight="regular" />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: C.bg, paddingHorizontal: S.lg, paddingBottom: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  inner: { flexDirection: "row", alignItems: "center", gap: S.md },
  company: { color: C.brand, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  title: { color: C.text, fontSize: 24, fontWeight: "800", marginTop: 2 },
});
