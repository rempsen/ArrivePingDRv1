import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import { X, House, ClipboardText, ChatCircleDots } from "phosphor-react-native";
import { C, R, S } from "../../lib/theme";

const KEY = "office_intro_seen_v1";

async function seen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return true;
    }
  }
}
async function markSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, "1");
  } catch {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* best-effort */
    }
  }
}

/**
 * First run of office mode on this device: three lines on what the tabs do,
 * dismissed once. Lighter than the technician coach tour (which walks a
 * practice job) because an office user already knows the console.
 */
export function OfficeIntroCard() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    seen().then((s) => setShow(!s));
  }, []);
  if (!show) return null;
  return (
    <View style={s.card} accessibilityRole="summary">
      <View style={s.head}>
        <Text style={s.title}>Dispatch from your phone</Text>
        <Pressable
          onPress={() => {
            setShow(false);
            markSeen();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <X color={C.sub} size={18} />
        </Pressable>
      </View>
      <Line icon={<House color={C.brand} size={16} weight="fill" />} text="Today shows who's on route, on site, free or busy, and what needs you." />
      <Line icon={<ClipboardText color={C.brand} size={16} weight="fill" />} text="Jobs: tap any job to assign, move or message. Use + to book a new one in under a minute." />
      <Line icon={<ChatCircleDots color={C.brand} size={16} weight="fill" />} text="Messages is your inbox with every technician. The megaphone sends one note to the whole team." />
    </View>
  );
}

function Line({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={s.line}>
      {icon}
      <Text style={s.lineTxt}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "rgba(14,165,233,0.10)", borderColor: "rgba(14,165,233,0.35)", borderWidth: 1, borderRadius: R.card, padding: S.lg, gap: S.sm, marginBottom: S.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: C.text, fontSize: 15, fontWeight: "800" },
  line: { flexDirection: "row", alignItems: "flex-start", gap: S.sm },
  lineTxt: { color: C.sub, fontSize: 13, lineHeight: 18, flex: 1 },
});
