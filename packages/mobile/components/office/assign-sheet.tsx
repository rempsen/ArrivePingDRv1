import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Star } from "phosphor-react-native";
import { Sheet } from "./sheet";
import { Avatar, Empty, ListSkeleton } from "../ui";
import { statusColor } from "./tech-row";
import { C, R, S } from "../../lib/theme";
import { STATUS_LABEL, type OfficeTech } from "../../lib/board";
import { useBoard } from "../../lib/use-board";
import { useCandidates, type Candidate } from "../../lib/use-booking";
import { useAssign } from "./use-assign";

const FIT_LABEL: Record<Candidate["fit"], string> = { ready: "Ready", busy: "Busy", unqualified: "Not qualified", offline: "Off shift" };
const FIT_COLOR: Record<Candidate["fit"], string> = { ready: C.green, busy: C.amber, unqualified: C.muted, offline: C.muted };

/**
 * "Who should take this?" — the server's ranked candidates for one job,
 * joined with the board for names and photos. Tapping a technician
 * assigns; a forceable refusal (double-booked, time off, already accepted)
 * shows the server's reason with "Assign anyway". Success shows an Undo
 * toast backed by the server's undo token.
 */
export function AssignSheet({
  open,
  bookingId,
  currentRiderId,
  jobLabel,
  onClose,
  onAssigned,
}: {
  open: boolean;
  bookingId: string;
  currentRiderId: string | null;
  jobLabel: string;
  onClose: () => void;
  onAssigned?: (riderId: string) => void;
}) {
  const board = useBoard(null, open);
  const candidates = useCandidates(bookingId, open);
  const { assignTo, busyId } = useAssign(bookingId, currentRiderId, jobLabel);

  const techs = new Map<string, OfficeTech>((board.data?.techs ?? []).map((t) => [t.id, t]));

  function pick(c: Candidate) {
    assignTo(c.techId, techs.get(c.techId)?.name ?? "that technician", () => {
      onClose();
      onAssigned?.(c.techId);
    });
  }

  const rows = (candidates.data ?? []).filter((c) => c.techId !== currentRiderId);

  return (
    <Sheet open={open} title={currentRiderId ? "Reassign to" : "Assign to"} onClose={onClose}>
      {candidates.isLoading || board.isLoading ? (
        <ListSkeleton rows={4} height={64} />
      ) : candidates.isError ? (
        <Empty text="Couldn't rank technicians" sub={(candidates.error as Error)?.message} />
      ) : rows.length === 0 ? (
        <Empty text="Nobody else to assign" sub="Add technicians in the web console." />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.techId}
          style={{ maxHeight: 440 }}
          renderItem={({ item }) => {
            const tech = techs.get(item.techId);
            const name = tech?.name ?? "Technician";
            const disabled = busyId !== null;
            return (
              <Pressable
                onPress={() => pick(item)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${FIT_LABEL[item.fit]}, ${item.reason}`}
                style={({ pressed }) => [s.row, item.best && s.best, { opacity: pressed || (disabled && busyId !== item.techId) ? 0.6 : 1 }]}
              >
                <View>
                  <Avatar name={name} photoUrl={tech?.photoUrl} color={tech?.color} size={40} />
                  <View style={[s.dot, { backgroundColor: statusColor(tech?.status ?? item.fit) }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.top}>
                    <Text style={s.name} numberOfLines={1}>
                      {name}
                    </Text>
                    {item.best ? (
                      <View style={s.bestPill}>
                        <Star color={C.brand} size={11} weight="fill" />
                        <Text style={s.bestTxt}>Best</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={s.reason} numberOfLines={2}>
                    {item.reason || (tech ? (STATUS_LABEL[tech.status] ?? tech.status) : FIT_LABEL[item.fit])}
                  </Text>
                </View>
                {busyId === item.techId ? (
                  <ActivityIndicator color={C.brand} />
                ) : (
                  <Text style={[s.fit, { color: FIT_COLOR[item.fit] }]}>{FIT_LABEL[item.fit]}</Text>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, paddingHorizontal: S.sm, borderRadius: R.control, borderBottomWidth: 1, borderBottomColor: C.border },
  best: { backgroundColor: "rgba(14,165,233,0.08)" },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: R.pill, borderWidth: 2, borderColor: C.bg2 },
  top: { flexDirection: "row", alignItems: "center", gap: S.sm },
  name: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  bestPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(14,165,233,0.16)", borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 2 },
  bestTxt: { color: C.brand, fontSize: 10, fontWeight: "800" },
  reason: { color: C.sub, fontSize: 12, marginTop: 2 },
  fit: { fontSize: 11, fontWeight: "800" },
});
