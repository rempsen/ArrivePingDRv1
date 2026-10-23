/**
 * Accepting and declining a job offer, shared by the Jobs list, the offer
 * details screen and the offer push buttons. Declining always asks why: a
 * short fixed list the office can count, plus an optional note.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CircleIcon } from "phosphor-react-native";
import Constants from "expo-constants";
import { authHeaders } from "../lib/auth";
import { NOTIFY_SUMMARY_KEY } from "../lib/notify-summary";
import { DECLINE_REASONS } from "../lib/offer";
import { C, R } from "../lib/theme";
import { Button } from "./ui";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/** A request the server refused: `conflict` means the offer is no longer open. */
export class OfferError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${API}/api/bookings/${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as any;
    throw new OfferError(j?.error?.message || j?.message || "Something went wrong. Try again.", res.status);
  }
}

export function acceptOffer(id: string) {
  return post(`${encodeURIComponent(id)}/accept`);
}

/**
 * Accept / decline mutations. `pendingId` says which offer is busy, so one
 * card's spinner doesn't spin on every card.
 */
export function useOfferActions() {
  const qc = useQueryClient();
  // Answering an offer is what clears a pending-offer badge, so refresh the
  // list and the badge counts at once rather than on the next poll.
  const refresh = (id: string) => {
    qc.invalidateQueries({ queryKey: ["bookings"] });
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["offer", id] });
    qc.invalidateQueries({ queryKey: NOTIFY_SUMMARY_KEY });
  };
  const accept = useMutation({
    mutationFn: (id: string) => acceptOffer(id),
    onSettled: (_d, _e, id) => refresh(id),
  });
  const decline = useMutation({
    mutationFn: ({ id, code, note }: { id: string; code: string; note: string }) =>
      post(`${encodeURIComponent(id)}/decline`, { code, note }),
    onSettled: (_d, _e, v) => refresh(v.id),
  });
  const pendingId = accept.isPending ? accept.variables : decline.isPending ? decline.variables?.id : undefined;
  return { accept, decline, pendingId };
}

/** Bottom sheet asking why. Calls `onSubmit` with the picked reason and note. */
export function DeclineSheet({
  visible,
  jobNoun,
  reasons,
  loading,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  jobNoun: string;
  /** From the server when it sent them; the app's own list otherwise. */
  reasons?: { key: string; label: string }[];
  loading?: boolean;
  onClose: () => void;
  onSubmit: (code: string, note: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const list = reasons?.length ? reasons : DECLINE_REASONS;
  const noun = jobNoun.toLowerCase();
  const close = () => {
    setCode(null);
    setNote("");
    onClose();
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
        <View style={s.sheet}>
          <Text style={s.title}>Decline this {noun}?</Text>
          <Text style={s.sub}>It goes back to dispatch to offer someone else. Tell the office why.</Text>
          <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
            {list.map((r) => {
              const on = code === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setCode(r.key)}
                  style={[s.row, on && s.rowOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={r.label}
                >
                  {on ? <CheckCircle color={C.brand} size={20} weight="fill" /> : <CircleIcon color={C.sub} size={20} />}
                  <Text style={[s.rowTxt, on && { color: C.text }]}>{r.label}</Text>
                </Pressable>
              );
            })}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={code === "other" ? "What's the reason?" : "Anything dispatch should know (optional)"}
              placeholderTextColor={C.sub}
              style={s.note}
              multiline
              maxLength={2000}
              accessibilityLabel="Note for dispatch, optional"
            />
          </ScrollView>
          <Button
            title={`Decline ${noun}`}
            variant="danger"
            loading={loading}
            disabled={!code || loading}
            accessibilityLabel={`Confirm declining this ${noun}`}
            onPress={() => {
              if (!code) return;
              onSubmit(code, note.trim());
              setCode(null);
              setNote("");
            }}
          />
          <Pressable onPress={close} style={s.cancel} accessibilityRole="button" accessibilityLabel="Go back without declining">
            <Text style={s.cancelTxt}>Go back</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bg2,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    borderTopWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 30,
    gap: 12,
  },
  title: { color: C.text, fontSize: 18, fontWeight: "900" },
  sub: { color: C.sub, fontSize: 13, lineHeight: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  rowOn: { borderColor: C.brand, backgroundColor: "rgba(14,165,233,0.10)" },
  rowTxt: { color: C.sub, fontSize: 14, fontWeight: "700", flex: 1 },
  note: {
    color: C.text,
    backgroundColor: C.bg3,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
    marginBottom: 4,
  },
  cancel: { alignItems: "center", paddingVertical: 10 },
  cancelTxt: { color: C.sub, fontSize: 14, fontWeight: "700" },
});
