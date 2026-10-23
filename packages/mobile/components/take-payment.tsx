import { useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle, CreditCard, X } from "phosphor-react-native";
import { authHeaders } from "../lib/auth";
import { C, money } from "../lib/theme";
import { Button } from "./ui";
import { messageFromBody } from "../lib/api-error";

type LinkResp = { url: string; qr: string; total: number; paid: boolean; cardPayments: boolean; canText: boolean; sent: boolean };

async function fetchLink(api: string, bookingId: string, send = false): Promise<LinkResp> {
  const r = await fetch(`${api}/api/payments/link/${encodeURIComponent(bookingId)}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ send }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(messageFromBody(j) ?? "Couldn't start the payment");
  return j as LinkResp;
}

/**
 * Take payment on site (jobs set to "Collect payment on site"): the total, a
 * QR code for the customer's own phone, "Pay on this phone" (opens the secure
 * Stripe page in the browser, where Apple Pay / Google Pay work), and a text
 * with the link. Polls so the technician sees the payment land.
 */
export function TakePayment({ api, bookingId, total, paid }: { api: string; bookingId: string; total?: number; paid?: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["pay-link", bookingId],
    queryFn: () => fetchLink(api, bookingId),
    enabled: open,
    refetchInterval: (query) => (open && !query.state.data?.paid ? 4000 : false),
  });
  const text = useMutation({ mutationFn: () => fetchLink(api, bookingId, true) });
  const d = q.data;
  const isPaid = paid || d?.paid;

  if (isPaid && !open) {
    return (
      <View style={s.paidRow}>
        <CheckCircle color={C.green} size={18} weight="fill" />
        <Text style={s.paidTxt}>Paid{total ? ` · ${money(total)}` : ""}</Text>
      </View>
    );
  }

  return (
    <>
      <Button
        title={`Take payment${total ? ` · ${money(total)}` : ""}`}
        variant="success"
        icon={<CreditCard color="#03130d" size={18} weight="bold" />}
        onPress={() => setOpen(true)}
        accessibilityLabel="Take payment"
      />
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Take payment</Text>
                <Text style={s.sub}>Card, Apple Pay or Google Pay, through Stripe</Text>
              </View>
              <Pressable accessibilityLabel="Close" onPress={() => setOpen(false)} hitSlop={12}>
                <X color={C.sub} size={22} />
              </Pressable>
            </View>

            {q.isLoading && <ActivityIndicator color={C.brand} style={{ marginVertical: 40 }} />}
            {q.isError && <Text style={s.err}>{(q.error as Error).message}</Text>}

            {d && d.paid && (
              <View style={s.center}>
                <CheckCircle color={C.green} size={56} weight="fill" />
                <Text style={s.big}>Paid {money(d.total)}</Text>
                <Text style={s.sub}>The customer's receipt is on its way.</Text>
                <Button title="Done" onPress={() => setOpen(false)} style={{ marginTop: 16, alignSelf: "stretch" }} />
              </View>
            )}

            {d && !d.paid && !d.cardPayments && (
              <Text style={s.warn}>Card payments aren't switched on for this company yet. Ask the office to connect Stripe in Settings → Payments.</Text>
            )}

            {d && !d.paid && d.cardPayments && (
              <View style={{ gap: 14 }}>
                <View style={s.totalRow}>
                  <Text style={s.sub}>Total</Text>
                  <Text style={s.big}>{money(d.total)}</Text>
                </View>
                <View style={s.qrBox}>
                  <Image source={{ uri: d.qr }} style={s.qr} accessibilityLabel="QR code: scan with a phone camera to pay" />
                </View>
                <Text style={[s.sub, { textAlign: "center" }]}>The customer scans this with their phone camera to pay.</Text>
                <Button title="Pay on this phone" onPress={() => Linking.openURL(d.url)} />
                <Button
                  title={text.data?.sent ? "Link sent" : "Text the link to the customer"}
                  variant="outline"
                  disabled={!d.canText || text.isPending || !!text.data?.sent}
                  loading={text.isPending}
                  onPress={() => text.mutate()}
                />
                {!d.canText && <Text style={[s.sub, { textAlign: "center" }]}>No phone number on this job to text.</Text>}
                {text.data && !text.data.sent && <Text style={s.warnSmall}>The text couldn't be sent. Use the QR code instead.</Text>}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, borderTopWidth: 1, borderColor: C.border },
  head: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  title: { color: C.text, fontSize: 18, fontWeight: "800" },
  sub: { color: C.sub, fontSize: 13 },
  big: { color: C.text, fontSize: 26, fontWeight: "800" },
  totalRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  qrBox: { backgroundColor: "#fff", borderRadius: 18, padding: 12, alignItems: "center" },
  qr: { width: 240, height: 240 },
  center: { alignItems: "center", gap: 6, paddingVertical: 12 },
  err: { color: C.red, fontSize: 14, marginVertical: 12 },
  warn: { color: C.amber, fontSize: 14, lineHeight: 20, backgroundColor: C.amberBg, borderRadius: 12, padding: 12 },
  warnSmall: { color: C.amber, fontSize: 12, textAlign: "center" },
  paidRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: C.greenBg },
  paidTxt: { color: C.green, fontSize: 15, fontWeight: "700" },
});
