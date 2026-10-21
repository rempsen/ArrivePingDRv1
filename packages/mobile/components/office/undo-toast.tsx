import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { C, R, S } from "../../lib/theme";

/**
 * "Assigned to Sam · Undo" for ten seconds after a dispatch write.
 *
 * One module-level store so any screen can show a toast and the single
 * `<UndoToastHost />` in the office layout renders it. The undo handler is
 * supplied by the caller (it holds the server's undo token); a second toast
 * replaces the first, which matches how the web console's undo bar behaves.
 */
type Toast = { id: number; label: string; onUndo?: () => Promise<unknown> | void; ms: number };

let current: Toast | null = null;
let seq = 0;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function showToast(label: string, opts: { onUndo?: () => Promise<unknown> | void; ms?: number } = {}) {
  current = { id: ++seq, label, onUndo: opts.onUndo, ms: opts.ms ?? (opts.onUndo ? 10_000 : 3_500) };
  emit();
}

export function hideToast() {
  current = null;
  emit();
}

export function UndoToastHost() {
  const toast = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    setBusy(false);
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        if (current?.id === toast.id) hideToast();
      });
    }, toast.ms);
    return () => clearTimeout(t);
  }, [toast, fade]);

  if (!toast) return null;

  return (
    <Animated.View pointerEvents="box-none" style={[s.wrap, { bottom: 92 + insets.bottom, opacity: fade }]}>
      <View style={s.toast} accessibilityLiveRegion="polite">
        <Text style={s.label} numberOfLines={2}>
          {toast.label}
        </Text>
        {toast.onUndo ? (
          <Pressable
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              try {
                await toast.onUndo?.();
              } finally {
                hideToast();
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Undo"
            hitSlop={8}
          >
            <Text style={[s.undo, busy && { opacity: 0.5 }]}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: S.lg, right: S.lg, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.lg,
    maxWidth: 520,
    width: "100%",
    backgroundColor: C.bg3,
    borderColor: C.borderHi,
    borderWidth: 1,
    borderRadius: R.card,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  label: { color: C.text, fontSize: 14, fontWeight: "600", flex: 1 },
  undo: { color: C.brand, fontSize: 14, fontWeight: "800" },
});
