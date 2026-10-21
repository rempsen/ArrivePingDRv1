import { useMemo, useState } from "react";
import { View, Text, SectionList, RefreshControl, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UsersThree, Warning } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { TechRow, statusColor } from "../../components/office/tech-row";
import { Empty, ListSkeleton } from "../../components/ui";
import { C, R, S, WIDE } from "../../lib/theme";
import { useBoard } from "../../lib/use-board";
import { STATUS_LABEL, STATUS_ORDER, NO_JOBS, NO_TECHS, type OfficeTech } from "../../lib/board";

/**
 * Team: every technician grouped by what they're doing right now. Opened
 * from a Today tile with `?status=` to jump straight to that group; the
 * filter chips at the top clear it.
 */
export default function Team() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const [filter, setFilter] = useState<string | null>(params.status ?? null);
  const board = useBoard(null);
  const now = new Date();

  const techs = board.data?.techs ?? NO_TECHS;
  const jobs = board.data?.jobs ?? NO_JOBS;
  const jobTitle = (id: string | null) => (id ? jobs.find((j) => j.id === id) : undefined);

  const sections = useMemo(() => {
    const groups = new Map<string, OfficeTech[]>();
    for (const t of techs) {
      const key = STATUS_ORDER.includes(t.status) ? t.status : "offline";
      // The Busy tile on Today covers break as well.
      const matches = !filter || key === filter || (filter === "busy" && key === "break");
      if (!matches) continue;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return STATUS_ORDER.filter((k) => groups.has(k)).map((k) => ({
      key: k,
      title: STATUS_LABEL[k] ?? k,
      data: groups.get(k)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [techs, filter]);

  const chips: Array<{ key: string | null; label: string }> = [
    { key: null, label: "All" },
    { key: "enroute", label: "On route" },
    { key: "onsite", label: "On site" },
    { key: "available", label: "Available" },
    { key: "busy", label: "Busy" },
    { key: "offline", label: "Off shift" },
  ];

  return (
    <View style={s.screen}>
      <OfficeHeader title="Team" />
      <View style={[s.chips, WIDE]}>
        {chips.map((c) => {
          const on = filter === c.key;
          return (
            <Pressable
              key={c.label}
              onPress={() => setFilter(c.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[s.chip, on && s.chipOn]}
            >
              <Text style={[s.chipTxt, on && s.chipTxtOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {board.isLoading ? (
        <View style={[s.pad, WIDE]}>
          <ListSkeleton rows={5} height={72} />
        </View>
      ) : board.isError ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load the team" sub={(board.error as Error)?.message} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          contentContainerStyle={[s.pad, WIDE, { paddingBottom: S.xxl }]}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={board.isFetching && !board.isLoading} onRefresh={() => board.refetch()} tintColor={C.brand} />}
          renderSectionHeader={({ section }) => (
            <View style={s.head}>
              <View style={[s.dot, { backgroundColor: statusColor(section.key) }]} />
              <Text style={s.headTxt}>{section.title}</Text>
              <Text style={s.headN}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TechRow
              tech={item}
              now={now}
              currentJob={jobTitle(item.currentJobId)?.customerName ?? jobTitle(item.currentJobId)?.title ?? null}
              onMessage={(t) => router.push(`/office/thread/${t.id}`)}
            />
          )}
          ListEmptyComponent={
            <Empty
              icon={<UsersThree color={C.muted} size={28} />}
              text={filter ? `Nobody is ${(STATUS_LABEL[filter] ?? filter).toLowerCase()}` : "No technicians yet"}
              sub={filter ? undefined : "Add your team in the web console under Technicians & Managers."}
            />
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { paddingHorizontal: S.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.md },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  chipTxt: { color: C.sub, fontSize: 12, fontWeight: "700" },
  chipTxtOn: { color: C.brand },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingTop: S.lg, paddingBottom: S.xs },
  dot: { width: 8, height: 8, borderRadius: R.pill },
  headTxt: { color: C.text, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  headN: { color: C.muted, fontSize: 12, fontWeight: "700" },
});
