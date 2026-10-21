import { Modal, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "phosphor-react-native";
import { C, R, S } from "../../lib/theme";

/**
 * Bottom sheet for office mode pickers (assign, reschedule, tech, service).
 * A plain Modal with a dimmed backdrop: no gesture library, works on iPad,
 * and the content area scrolls on its own.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.root}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, S.lg) }]}>
          <View style={s.grab} />
          <View style={s.head}>
            <Text style={s.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X color={C.sub} size={20} />
            </Pressable>
          </View>
          <View style={s.body}>{children}</View>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.bg2,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    borderWidth: 1,
    borderColor: C.border,
    maxHeight: "88%",
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  grab: { width: 40, height: 4, borderRadius: R.pill, backgroundColor: C.borderHi, alignSelf: "center", marginTop: S.sm },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.sm },
  title: { color: C.text, fontSize: 17, fontWeight: "800" },
  body: { flexShrink: 1, paddingHorizontal: S.lg },
  footer: { paddingHorizontal: S.lg, paddingTop: S.md },
});
