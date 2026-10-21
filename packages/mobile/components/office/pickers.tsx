import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, ScrollView } from "react-native";
import { MagnifyingGlass, UserPlus, Check, MapPin } from "phosphor-react-native";
import { Sheet } from "./sheet";
import { Button, Empty, ListSkeleton } from "../ui";
import { C, R, S, fmtTime } from "../../lib/theme";
import { resolvePlace, useAddressSearch, useClientSearch, useServices, type ClientRow, type ServiceRow } from "../../lib/use-lookups";
import { useBoard } from "../../lib/use-board";
import { STATUS_LABEL, type OfficeTech } from "../../lib/board";
import { statusColor } from "./tech-row";
import { Avatar } from "../ui";
import type { DraftClient } from "../../lib/new-job";

/* ───────────────────────── Client ───────────────────────── */

export function ClientSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: DraftClient) => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const search = useClientSearch(q, open && !adding);

  function reset() {
    setQ("");
    setAdding(false);
    setName("");
    setEmail("");
    setPhone("");
  }

  return (
    <Sheet
      open={open}
      title={adding ? "New client" : "Client"}
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        adding ? (
          <View style={{ gap: S.sm }}>
            <Button
              title="Use this client"
              disabled={!name.trim() || !email.trim()}
              onPress={() => {
                onPick({ kind: "new", name: name.trim(), email: email.trim(), phone: phone.trim() || undefined });
                reset();
              }}
            />
            <Button title="Back to search" variant="ghost" onPress={() => setAdding(false)} />
          </View>
        ) : (
          <Button
            title={q.trim() ? `Add "${q.trim()}" as a new client` : "Add a new client"}
            variant="outline"
            icon={<UserPlus color={C.text} size={18} />}
            onPress={() => {
              setName(q.trim());
              setAdding(true);
            }}
          />
        )
      }
    >
      {adding ? (
        <View style={{ gap: S.sm }}>
          <Field label="Name" value={name} onChange={setName} placeholder="Full name" />
          <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" placeholder="name@example.com" />
          <Field label="Phone (optional)" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="204 555 0100" />
          <Text style={s.hint}>They get the usual booking texts and emails, the same as a client added on the web.</Text>
        </View>
      ) : (
        <>
          <View style={s.search}>
            <MagnifyingGlass color={C.muted} size={16} />
            <TextInput value={q} onChangeText={setQ} placeholder="Name, phone, address or email" placeholderTextColor={C.muted} style={s.input} autoCorrect={false} />
          </View>
          {search.isLoading ? (
            <ListSkeleton rows={4} height={60} />
          ) : (
            <FlatList
              data={search.data ?? []}
              keyExtractor={(r) => r.id}
              style={{ maxHeight: 360 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => <ClientRowView row={item} onPress={() => onPick({ kind: "existing", id: item.id, name: item.name, phone: item.phone || undefined, lastAddress: clientAddress(item) })} />}
              ListEmptyComponent={<Empty text={q ? "No clients match" : "No clients yet"} sub="Add one below." />}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

/** The place we'd send a tech: the client's own address, else their property (with unit). */
function clientAddress(row: ClientRow): string | undefined {
  if (row.address) return row.address;
  const prop = [row.propertyAddress, row.unit ? `Unit ${row.unit}` : ""].filter(Boolean).join(", ");
  return prop || undefined;
}

function ClientRowView({ row, onPress }: { row: ClientRow; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={row.name} style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>
          {row.name}
          {row.isSample ? <Text style={s.sample}>  sample</Text> : null}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {[row.phone, row.address || row.propertyName].filter(Boolean).join(" · ") || row.email}
        </Text>
      </View>
      {row.lastVisitAt ? <Text style={s.meta}>Last {new Date(row.lastVisitAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text> : null}
    </Pressable>
  );
}

/* ───────────────────────── Service ───────────────────────── */

export function ServiceSheet({ open, value, onClose, onPick }: { open: boolean; value: string | null; onClose: () => void; onPick: (svc: ServiceRow) => void }) {
  const services = useServices(open);
  const groups = useMemo(() => {
    const m = new Map<string, ServiceRow[]>();
    for (const svc of services.data ?? []) m.set(svc.category || "Other", [...(m.get(svc.category || "Other") ?? []), svc]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [services.data]);
  return (
    <Sheet open={open} title="Service" onClose={onClose}>
      {services.isLoading ? (
        <ListSkeleton rows={4} height={52} />
      ) : groups.length === 0 ? (
        <Empty text="No services yet" sub="Add services in the web console first." />
      ) : (
        <ScrollView style={{ maxHeight: 440 }}>
          {groups.map(([cat, list]) => (
            <View key={cat}>
              <Text style={s.group}>{cat}</Text>
              {list
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((svc) => {
                  const on = svc.id === value;
                  return (
                    <Pressable key={svc.id} onPress={() => onPick(svc)} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.name}>{svc.name}</Text>
                        <Text style={s.sub}>{svc.durationMins} min</Text>
                      </View>
                      {on ? <Check color={C.brand} size={18} weight="bold" /> : null}
                    </Pressable>
                  );
                })}
            </View>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

/* ───────────────────────── Address ───────────────────────── */

export function AddressSheet({
  open,
  initial,
  onClose,
  onPick,
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onPick: (a: { address: string; lat: number | null; lng: number | null }) => void;
}) {
  const [q, setQ] = useState(initial);
  // The sheet stays mounted between opens; show whatever the job has now.
  useEffect(() => {
    if (open) setQ(initial);
  }, [open, initial]);
  const [token] = useState(() => Math.random().toString(36).slice(2));
  const [resolving, setResolving] = useState(false);
  const preds = useAddressSearch(q, token, open);
  return (
    <Sheet
      open={open}
      title="Address"
      onClose={onClose}
      footer={<Button title="Use as typed" variant="outline" disabled={!q.trim() || resolving} onPress={() => onPick({ address: q.trim(), lat: null, lng: null })} />}
    >
      <View style={s.search}>
        <MapPin color={C.muted} size={16} />
        <TextInput value={q} onChangeText={setQ} placeholder="Street address" placeholderTextColor={C.muted} style={s.input} autoCorrect={false} />
      </View>
      <FlatList
        data={preds.data ?? []}
        keyExtractor={(p) => p.placeId}
        style={{ maxHeight: 320 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            disabled={resolving}
            onPress={async () => {
              setResolving(true);
              const r = await resolvePlace(item.placeId, item.description, token);
              setResolving(false);
              onPick(r);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.description}
            style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.main}</Text>
              <Text style={s.sub}>{item.secondary}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={q.trim().length >= 3 && !preds.isLoading ? <Text style={s.hint}>No suggestions. You can still use the address as typed.</Text> : null}
      />
    </Sheet>
  );
}

/* ───────────────────────── Technician ───────────────────────── */

const ORDER: Record<string, number> = { available: 0, enroute: 1, onsite: 2, busy: 3, break: 4, offline: 5 };

export function TechSheet({ open, value, onClose, onPick }: { open: boolean; value: string | null; onClose: () => void; onPick: (t: OfficeTech | null) => void }) {
  const board = useBoard(null, open);
  const techs = useMemo(
    () =>
      [...(board.data?.techs ?? [])].sort((a, b) => {
        const d = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
        if (d) return d;
        return (a.freeAt ?? "").localeCompare(b.freeAt ?? "") || a.name.localeCompare(b.name);
      }),
    [board.data?.techs],
  );
  return (
    <Sheet open={open} title="Who takes it?" onClose={onClose} footer={<Button title="Offer later — leave unassigned" variant="outline" onPress={() => onPick(null)} />}>
      {board.isLoading ? (
        <ListSkeleton rows={4} height={60} />
      ) : (
        <FlatList
          data={techs}
          keyExtractor={(t) => t.id}
          style={{ maxHeight: 400 }}
          renderItem={({ item }) => {
            const on = item.id === value;
            return (
              <Pressable onPress={() => onPick(item)} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}>
                <View>
                  <Avatar name={item.name} photoUrl={item.photoUrl} color={item.color} size={40} />
                  <View style={[s.dot, { backgroundColor: statusColor(item.status) }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {STATUS_LABEL[item.status] ?? item.status}
                    {item.freeAt && item.status !== "available" ? ` · free ~${fmtTime(item.freeAt)}` : ""}
                    {item.openJobs ? ` · ${item.openJobs} open` : ""}
                  </Text>
                </View>
                {on ? <Check color={C.brand} size={18} weight="bold" /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Empty text="No technicians yet" />}
        />
      )}
    </Sheet>
  );
}

/* ───────────────────────── Shared ───────────────────────── */

export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        autoCorrect={keyboardType !== "email-address"}
        style={[s.field, multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, height: 44, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, marginBottom: S.sm },
  input: { flex: 1, color: C.text, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  name: { color: C.text, fontSize: 15, fontWeight: "700" },
  sub: { color: C.sub, fontSize: 12, marginTop: 2 },
  meta: { color: C.muted, fontSize: 11 },
  sample: { color: C.muted, fontSize: 11, fontWeight: "600" },
  group: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: S.md, marginBottom: 2 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17, paddingVertical: S.sm },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg2 },
  label: { color: C.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  field: { color: C.text, fontSize: 15, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border, borderRadius: R.control, paddingHorizontal: S.md, paddingVertical: 10 },
});
