import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ClipboardText, MagnifyingGlass, Plus, Warning } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { DayStrip } from "../../components/office/day-strip";
import { JobRow } from "../../components/office/job-row";
import { Empty, ListSkeleton } from "../../components/ui";
import { C, R, S, WIDE } from "../../lib/theme";
import { useBoard, useDayLoad } from "../../lib/use-board";
import { useAccess } from "../../lib/use-access";
import { addDays, bucketOf, type JobBucket } from "../../lib/board";

const BUCKETS: Array<{ key: JobBucket; label: string }> = [
  { key: "unassigned", label: "Unassigned" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

/**
 * Jobs: one day at a time, split the way a dispatcher thinks about it. The
 * first read is for "today" by the company's clock (the server picks the
 * day); once it answers we know the date and can offer the strip.
 */
export default function Jobs() {
  const router = useRouter();
  const { can } = useAccess();
  const [day, setDay] = useState<string | null>(null);
  const [bucket, setBucket] = useState<JobBucket>("unassigned");
  const [q, setQ] = useState("");

  const board = useBoard(day);
  // "Today" on the company's clock, learned from the first (day-less) read and
  // kept while the dispatcher browses other days.
  const [anchor, setAnchor] = useState<string | null>(null);
  const serverDay = board.data?.day;
  useEffect(() => {
    if (day === null && serverDay) setAnchor(serverDay);
  }, [day, serverDay]);
  const load = useDayLoad(anchor ? addDays(anchor, -1) : null, 9);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of load.data?.days ?? []) m[d.day] = d.jobs;
    return m;
  }, [load.data]);

  const techs = board.data?.techs ?? [];
  const jobs = board.data?.jobs ?? [];
  const techName = (riderId: string | null) => (riderId ? (techs.find((x) => x.id === riderId)?.name ?? "") : "");

  const perBucket = useMemo(() => {
    const m: Record<JobBucket, number> = { unassigned: 0, scheduled: 0, in_progress: 0, done: 0 };
    for (const j of jobs) m[bucketOf(j)]++;
    return m;
  }, [jobs]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs
      .filter((j) => bucketOf(j) === bucket)
      .filter((j) => !needle || [j.customerName, j.address, j.title, j.service].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [jobs, bucket, q]);

  const jobNoun = board.data?.jobNoun ?? "jobs";

  return (
    <View style={s.screen}>
      <OfficeHeader
        title="Jobs"
        right={
          can("work_orders:create") ? (
            <Pressable
              onPress={() => router.push("/office/new-job")}
              accessibilityRole="button"
              accessibilityLabel="New job"
              style={({ pressed }) => [s.fab, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Plus color="#04121c" size={20} weight="bold" />
            </Pressable>
          ) : undefined
        }
      />
      {anchor ? <DayStrip today={anchor} day={day ?? anchor} counts={counts} onChange={(d) => setDay(d === anchor ? null : d)} /> : null}
      <View style={[s.segments, WIDE]}>
        {BUCKETS.map((b) => {
          const on = b.key === bucket;
          return (
            <Pressable key={b.key} onPress={() => setBucket(b.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.seg, on && s.segOn]}>
              <Text style={[s.segTxt, on && s.segTxtOn]} numberOfLines={1}>
                {b.label}
              </Text>
              <Text style={[s.segN, on && s.segTxtOn]}>{perBucket[b.key]}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[s.search, WIDE]}>
        <MagnifyingGlass color={C.muted} size={16} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search client, address, service"
          placeholderTextColor={C.muted}
          style={s.input}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      {board.isLoading ? (
        <View style={[s.pad, WIDE]}>
          <ListSkeleton rows={5} height={96} />
        </View>
      ) : board.isError ? (
        <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load jobs" sub={(board.error as Error)?.message} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(j) => j.id}
          contentContainerStyle={[s.pad, WIDE, { paddingBottom: S.xxl }]}
          refreshControl={<RefreshControl refreshing={board.isFetching && !board.isLoading} onRefresh={() => board.refetch()} tintColor={C.brand} />}
          renderItem={({ item }) => <JobRow job={item} techName={techName(item.riderId)} onPress={() => router.push(`/office/job/${item.id}`)} />}
          ListEmptyComponent={
            <Empty
              icon={<ClipboardText color={C.muted} size={28} />}
              text={q ? "No matches" : `No ${BUCKETS.find((b) => b.key === bucket)!.label.toLowerCase()} ${jobNoun}`}
            />
          }
          ListFooterComponent={
            board.data?.truncated ? <Text style={s.note}>Showing the first {jobs.length}. Open the web console for the full day.</Text> : null
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { paddingHorizontal: S.lg },
  fab: { width: 36, height: 36, borderRadius: R.pill, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  segments: { flexDirection: "row", paddingHorizontal: S.lg, gap: S.xs, marginTop: S.xs },
  seg: { flex: 1, alignItems: "center", paddingVertical: S.sm, borderRadius: R.control, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  segOn: { backgroundColor: "rgba(14,165,233,0.16)", borderColor: C.brand },
  segTxt: { color: C.sub, fontSize: 11, fontWeight: "700" },
  segTxtOn: { color: C.brand },
  segN: { color: C.muted, fontSize: 13, fontWeight: "800", marginTop: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginVertical: S.md, paddingHorizontal: S.md, height: 40, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  input: { flex: 1, color: C.text, fontSize: 14 },
  note: { color: C.muted, fontSize: 12, marginTop: S.lg, textAlign: "center" },
});
