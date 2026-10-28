import { useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { C } from "../../lib/theme";

/**
 * The grip on a block's right edge: drag sideways to make the job longer or
 * shorter. Reports the horizontal travel while dragging and once on release;
 * the timeline turns that into minutes (snapped) and draws the preview.
 * Sideways only, so a vertical swipe still scrolls the board.
 */
export function ResizeEdge({
  left,
  top,
  height,
  color,
  label,
  onMove,
  onEnd,
}: {
  left: number;
  top: number;
  height: number;
  color: string;
  label: string;
  onMove: (dx: number) => void;
  onEnd: (dx: number | null) => void;
}) {
  const cb = useRef({ onMove, onEnd });
  cb.current = { onMove, onEnd };
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-6, 6])
        .failOffsetY([-14, 14])
        .runOnJS(true)
        .onStart(() => {
          Haptics.selectionAsync().catch(() => {});
        })
        .onUpdate((e) => cb.current.onMove(e.translationX))
        .onEnd((e, ok) => cb.current.onEnd(ok ? e.translationX : null))
        .onFinalize((_e, ok) => {
          if (!ok) cb.current.onEnd(null);
        }),
    [],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityLabel={label}
        hitSlop={{ left: 6, right: 10, top: 4, bottom: 4 }}
        style={[s.edge, { left, top, height }]}
      >
        <View style={[s.grip, { backgroundColor: color }]} />
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  // 20 pt wide, centred on the block's right edge.
  edge: { position: "absolute", width: 20, alignItems: "center", justifyContent: "center" },
  grip: { width: 4, height: "46%", borderRadius: 2, opacity: 0.9, borderWidth: 0.5, borderColor: C.bg },
});
