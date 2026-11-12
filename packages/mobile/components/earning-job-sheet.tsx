import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { CheckCircle } from "phosphor-react-native";
import { useBottomBarPadding } from "../lib/bottom-inset";
import { C, R, money, fmtDate } from "../lib/theme";
import { payLines, quickbooksNote, type EarnJob } from "../lib/earning-job";

/** Tap a completed job on Earnings: who it was for, and exactly how it was paid. */
export function EarningJobSheet({ job, onClose }: { job: EarnJob | null; onClose: () => void }) {
  const sheetPad = useBottomBarPadding(34, 20);
  const qb = job ? quickbooksNote(job) : null;
  return (
    <Modal visible={!!job} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        {job && (
          <View style={[s.sheet, { paddingBottom: sheetPad }]} accessibilityViewIsModal>
            <View style={s.handle} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              <View style={s.titleRow}>
                <CheckCircle color={C.green} size={22} weight="fill" />
                <Text style={s.title} numberOfLines={2}>
                  {job.service || job.title || "Job"}
                </Text>
              </View>
              <Text style={s.meta}>
                {job.company}
                {job.customerName ? ` · ${job.customerName}` : ""}
              </Text>
              <Text style={s.meta}>Completed {fmtDate(job.finishedAt ?? job.scheduledAt ?? 0)}</Text>
              {!!job.title && !!job.service && job.title !== job.service && <Text style={s.meta}>{job.title}</Text>}

              <View style={s.card}>
                <Text style={s.section}>How this job was paid</Text>
                {payLines(job).map((l) => (
                  <View key={l.label} style={s.row}>
                    <Text style={s.lbl}>
                      {l.label}
                      {l.hint ? `\n` : ""}
                      {l.hint ? <Text style={s.hint}>{l.hint}</Text> : null}
                    </Text>
                    <Text style={s.val}>{money(l.amount)}</Text>
                  </View>
                ))}
                <View style={[s.row, s.total]}>
                  <Text style={s.totalLbl}>You earned</Text>
                  <Text style={s.totalVal}>{money(job.pay)}</Text>
                </View>
                {job.unrated && <Text style={s.note}>No pay rate set — ask the office.</Text>}
              </View>

              <View style={s.row}>
                <Text style={s.hint}>Job value to the company (before tax)</Text>
                <Text style={s.hint}>{money(job.price)}</Text>
              </View>
              {qb && <Text style={[s.note, qb.paid && { color: C.green }]}>{qb.text}</Text>}
            </ScrollView>
            <Pressable onPress={onClose} style={s.close} accessibilityRole="button">
              <Text style={s.closeTxt}>Done</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: R.sheet, borderTopRightRadius: R.sheet, borderWidth: 1, borderColor: C.border, padding: 20, maxHeight: "85%", gap: 8 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: C.text, fontSize: 18, fontWeight: "800", flex: 1 },
  meta: { color: C.sub, fontSize: 13.5 },
  card: { backgroundColor: C.bg3, borderRadius: R.card, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10, marginTop: 6 },
  section: { color: C.sub, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  lbl: { color: C.text, fontSize: 13, fontWeight: "700", flex: 1 },
  hint: { color: C.sub, fontSize: 11.5, fontWeight: "600" },
  val: { color: C.text, fontSize: 14, fontWeight: "800" },
  total: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  totalLbl: { color: C.sub, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  totalVal: { color: C.green, fontSize: 18, fontWeight: "900" },
  note: { color: C.sub, fontSize: 12, fontWeight: "600" },
  close: { height: 46, borderRadius: R.control, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", marginTop: 6 },
  closeTxt: { color: "#04121c", fontSize: 15, fontWeight: "700" },
});
