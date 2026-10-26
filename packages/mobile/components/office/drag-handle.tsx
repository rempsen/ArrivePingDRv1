import { useMemo, useRef } from "react";
import { View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { travelled } from "../../lib/board-drag";

export interface DragCallbacks {
  /** Finger came down and held: the drag has begun at this window point. */
  onDragStart: (absX: number, absY: number) => void;
  onDragMove: (absX: number, absY: number) => void;
  /** Released after moving: drop here. */
  onDrop: (absX: number, absY: number) => void;
  /** Interrupted (system gesture, scroll took over) or released without moving. */
  onDragCancel: () => void;
}

/**
 * A board item you can tap, hold, or hold-and-drag:
 *   tap            → `onTap` (arms it for tap-to-place, as before)
 *   hold, release  → `onOpen` (opens the job, as the old long press did)
 *   hold, drag     → the drag callbacks, ending in a drop or a cancel
 * Non-movable items keep tap and hold-to-open only. VoiceOver keeps the
 * tap-to-place path: "activate" taps, the "longpress" action opens.
 *
 * Gestures run their callbacks on the JS thread; the floating copy under the
 * finger is moved through shared values by the board, so it stays smooth.
 */
export function DragHandle({
  movable,
  onTap,
  onOpen,
  drag,
  style,
  accessibilityLabel,
  selected,
  children,
}: {
  movable: boolean;
  onTap: () => void;
  onOpen: () => void;
  drag: DragCallbacks;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  selected?: boolean;
  children: React.ReactNode;
}) {
  // Latest callbacks without rebuilding the gesture on every render.
  const cb = useRef({ onTap, onOpen, drag });
  cb.current = { onTap, onOpen, drag };
  const state = useRef({ moved: false, active: false });

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(240)
      .runOnJS(true)
      .onEnd((_e, ok) => {
        if (ok) cb.current.onTap();
      });
    if (!movable) {
      const hold = Gesture.LongPress()
        .minDuration(350)
        .runOnJS(true)
        .onStart(() => cb.current.onOpen());
      return Gesture.Exclusive(hold, tap);
    }
    const pan = Gesture.Pan()
      .activateAfterLongPress(260)
      .runOnJS(true)
      .onStart((e) => {
        state.current = { moved: false, active: true };
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        cb.current.drag.onDragStart(e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        if (!state.current.moved && travelled(e.translationX, e.translationY)) state.current.moved = true;
        cb.current.drag.onDragMove(e.absoluteX, e.absoluteY);
      })
      .onEnd((e, ok) => {
        const { moved } = state.current;
        state.current.active = false;
        if (!ok) return cb.current.drag.onDragCancel();
        if (!moved) {
          cb.current.drag.onDragCancel();
          cb.current.onOpen();
          return;
        }
        cb.current.drag.onDrop(e.absoluteX, e.absoluteY);
      })
      .onFinalize(() => {
        // Cancelled before onEnd (e.g. the system took the touch).
        if (state.current.active) {
          state.current.active = false;
          cb.current.drag.onDragCancel();
        }
      });
    return Gesture.Exclusive(pan, tap);
  }, [movable]);

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "activate") onTap();
    if (e.nativeEvent.actionName === "longpress") onOpen();
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={selected ? { selected: true } : undefined}
        accessibilityActions={[{ name: "activate" }, { name: "longpress", label: "Open" }]}
        onAccessibilityAction={onAccessibilityAction}
        style={style}
      >
        {children}
      </View>
    </GestureDetector>
  );
}
