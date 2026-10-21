import { View, Text, StyleSheet, Linking, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Browser } from "phosphor-react-native";
import { Button } from "../ui";
import { C, S, WIDE } from "../../lib/theme";
import { webUrl } from "../../lib/office-nav";

/**
 * Stand-in for an office screen that ships in a later update. Keeps every
 * link in this build working: the person can open the same thing in the
 * web console instead of hitting an unmatched route.
 */
export function NotYet({ title, webPath }: { title: string; webPath: string }) {
  const router = useRouter();
  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft color={C.text} size={22} />
        </Pressable>
      </View>
      <View style={[s.body, WIDE]}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>This part of office mode is coming in the next update. Until then it's a tap away in the web console.</Text>
        <Button title="Open in web console" icon={<Browser color="#04121c" size={18} weight="bold" />} onPress={() => Linking.openURL(webUrl(webPath)).catch(() => {})} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { paddingHorizontal: S.lg, paddingVertical: S.md },
  body: { flex: 1, padding: S.xl, gap: S.md, justifyContent: "center" },
  title: { color: C.text, fontSize: 22, fontWeight: "800" },
  sub: { color: C.sub, fontSize: 14, lineHeight: 20, marginBottom: S.sm },
});
