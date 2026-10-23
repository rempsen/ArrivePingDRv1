import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView } from "react-native";
import { Trash, Warning } from "phosphor-react-native";
import Constants from "expo-constants";
import { authHeaders } from "../lib/auth";
import { C, R } from "../lib/theme";
import { messageFromBody } from "../lib/api-error";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/**
 * "Delete my account" — App Store guideline 5.1.1(v).
 *
 * Opens on the Profile screen. First asks the server whether deletion is even
 * possible (a person who is the only admin of a company has to hand that over
 * first), then makes the person type DELETE so a mis-tap can never do it.
 * The server anonymizes the account and ends every company membership; the
 * caller handles local sign-out once `onDeleted` fires.
 */

type Blocker = { companyId: string; company: string; reason: string };
type Preview = { allowed: boolean; blockers: Blocker[]; reason?: string };

export function DeleteAccountSheet({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => Promise<void> | void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setPreviewErr("");
    setTyped("");
    setErr("");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/me/deletion-preview`, { headers: authHeaders() });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Your session has expired. Sign out, sign in again, then try deleting your account.");
        }
        if (!res.ok) throw new Error(`ArrivePing returned an error (${res.status}). Try again in a minute, or email support@nvc360.com.`);
        const data = (await res.json()) as Preview;
        if (!cancelled) setPreview(data);
      } catch (e: any) {
        if (!cancelled) setPreviewErr(e?.message || "Couldn't reach ArrivePing. Check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const ready = typed.trim().toUpperCase() === "DELETE";

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`${API}/api/me`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status >= 500
            ? "ArrivePing hit a problem partway through. Your login may already be disabled — try again in a minute; running it again is safe."
            : messageFromBody(data) || "Something went wrong. Your account was not deleted.",
        );
      }
    } catch (e: any) {
      setErr(e?.message || "Something went wrong. Your account was not deleted.");
      setBusy(false);
      return;
    }
    // Server side is done. Whatever happens on the device from here must not
    // be reported as "not deleted".
    try {
      await onDeleted();
    } catch {
      /* the caller handles its own fallback */
    }
  }

  const blocked = preview && !preview.allowed;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
        <View style={s.sheet} accessibilityViewIsModal>
          <View style={s.handle} />
          <View style={s.titleRow}>
            <View style={s.iconWrap}>
              <Trash color={C.red} size={20} weight="bold" />
            </View>
            <Text style={s.title}>Delete my account</Text>
          </View>

          {!preview && !previewErr && (
            <View style={s.loading}>
              <ActivityIndicator color={C.sub} />
              <Text style={s.body}>Checking your account…</Text>
            </View>
          )}

          {!!previewErr && (
            <Text style={[s.body, { color: C.red }]} accessibilityRole="alert">
              {previewErr}
            </Text>
          )}

          {blocked && (
            <View style={s.blockBox}>
              <Warning color={C.amber} size={18} weight="bold" />
              <Text style={[s.body, { flex: 1 }]}>
                {preview!.reason === "superadmin"
                  ? "Platform administrator accounts can't be deleted from the app. Email support@nvc360.com."
                  : `You're the only admin at ${preview!.blockers.map((b) => b.company).join(", ")}. Make someone else an admin there first (Settings → Team on the web), then come back.`}
              </Text>
            </View>
          )}

          {preview?.allowed && (
            <>
              <Text style={s.body}>This permanently removes your ArrivePing login. Here's exactly what happens:</Text>
              <View style={s.list}>
                <Text style={s.li}>• You're signed out everywhere and can't sign back in.</Text>
                <Text style={s.li}>• Your name, email, phone, photo and licence details are erased.</Text>
                <Text style={s.li}>• Any jobs still assigned to you go back to the dispatch board.</Text>
                <Text style={s.li}>• The companies you worked for keep their job records (invoices, photos, time on site) with your name removed.</Text>
                <Text style={s.li}>• Any pay you're owed is still settled by your employer outside the app.</Text>
              </View>
              <Text style={s.label}>Type DELETE to confirm</Text>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="DELETE"
                placeholderTextColor={C.muted}
                style={s.input}
                editable={!busy}
                accessibilityLabel="Type DELETE to confirm"
                returnKeyType="done"
                onSubmitEditing={confirm}
              />
            </>
          )}

          {!!err && (
            <Text style={[s.body, { color: C.red }]} accessibilityRole="alert">
              {err}
            </Text>
          )}

          <View style={s.actions}>
            <Pressable onPress={onClose} disabled={busy} style={s.cancel} accessibilityRole="button">
              <Text style={s.cancelTxt}>{blocked || previewErr ? "Close" : "Cancel"}</Text>
            </Pressable>
            {preview?.allowed && (
              <Pressable
                onPress={confirm}
                disabled={!ready || busy}
                style={[s.danger, (!ready || busy) && { opacity: 0.45 }]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !ready || busy, busy }}
              >
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Trash color="#fff" size={16} weight="bold" />}
                <Text style={s.dangerTxt}>Delete account</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 34,
    gap: 12,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: R.control, backgroundColor: C.redBg, alignItems: "center", justifyContent: "center" },
  title: { color: C.text, fontSize: 18, fontWeight: "800" },
  loading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  body: { color: C.sub, fontSize: 13.5, lineHeight: 19 },
  list: { gap: 6 },
  li: { color: C.text, fontSize: 13.5, lineHeight: 19 },
  blockBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(245,158,11,0.10)",
    borderColor: "rgba(245,158,11,0.35)",
    borderWidth: 1,
    borderRadius: R.control,
    padding: 12,
  },
  label: { color: C.text, fontSize: 12.5, fontWeight: "700", marginTop: 4 },
  input: {
    height: 46,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg3,
    color: C.text,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 2,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 4 },
  cancel: { height: 44, paddingHorizontal: 16, justifyContent: "center" },
  cancelTxt: { color: C.sub, fontSize: 15, fontWeight: "600" },
  danger: { height: 44, paddingHorizontal: 16, borderRadius: R.control, backgroundColor: C.red, flexDirection: "row", alignItems: "center", gap: 8 },
  dangerTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
