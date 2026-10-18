import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SignIn, SignOut } from "phosphor-react-native";
import { C } from "../lib/theme";
import { useShift } from "../lib/shift";

/**
 * The big Sign in / Sign out button at the bottom of Jobs: green when the
 * technician is on the clock, red when they're off it. One tap switches. It
 * shows their shift at the company they're working for right now, the same
 * one Profile's "On the clock" switch sets.
 */
export function ShiftButton() {
  const shift = useShift();
  if (!shift.known) return null;
  const on = shift.onShift;
  const fg = on ? "#03130d" : "#ffffff";
  const Icon = on ? SignOut : SignIn;
  return (
    <Pressable
      onPress={shift.toggle}
      disabled={shift.pending}
      accessibilityRole="switch"
      accessibilityLabel={on ? "Signed in, on the clock" : "Signed out, off the clock"}
      accessibilityState={{ checked: on, busy: shift.pending }}
      accessibilityHint={on ? "Double tap to sign out and go off the clock" : "Double tap to sign in and go on the clock"}
      style={({ pressed }) => [s.btn, { backgroundColor: on ? C.green : C.red }, pressed && s.pressed]}
    >
      <View style={s.icon}>
        {shift.pending ? <ActivityIndicator color={fg} /> : <Icon color={fg} size={26} weight="bold" />}
      </View>
      <View style={s.text}>
        <Text style={[s.title, { color: fg }]}>{on ? "Signed in" : "Sign in"}</Text>
        <Text style={[s.sub, { color: fg }]} numberOfLines={1}>
          {on ? (shift.busy ? "On the clock · on a job" : "On the clock · tap to sign out") : "Off the clock · tap to start"}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  // One size in both states, so the button doesn't jump when it changes.
  btn: {
    width: "100%",
    maxWidth: 360,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  icon: { width: 28, alignItems: "center" },
  text: { flexShrink: 1 },
  title: { fontSize: 19, fontWeight: "800" },
  sub: { fontSize: 13, fontWeight: "600", opacity: 0.85, marginTop: 1 },
});
