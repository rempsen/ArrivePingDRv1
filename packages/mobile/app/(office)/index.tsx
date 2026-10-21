import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Warning, CalendarCheck, ClipboardText } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { StatusTiles } from "../../components/office/status-tiles";
import { JobRow } from "../../components/office/job-row";
import { Button, Empty, ListSkeleton } from "../../components/ui";
import { C, R, S, WIDE } from "../../lib/theme";
import { useBoard } from "../../lib/use-board";
import { useAccess } from "../../lib/use-access";
import { needsAttention, nextUp, tallies, NO_JOBS, NO_TECHS } from "../../lib/board";

/**
 * Today: the first thing a dispatcher looks at between calls. Who is where,
 * what is late or has no technician, and what starts next. Everything here
 * is derived from one board read, kept live by the dispatch stream.
 */
export default function Today() {
  const router = useRouter();
  const { can } = useAccess();
  const board = useBoard(null);
  const [now, setNow] = useState(() => new Date());

  const techs = board.data?.techs ?? NO_TECHS;
  const jobs = board.data?.jobs ?? NO_JOBS;
  const t = useMemo(() => tallies(techs), [techs]);
  const attention = useMemo(() => needsAttention(jobs), [jobs]);
  const upcoming = useMemo(() => nextUp(jobs, now), [jobs, now]);
  const techName = (riderId: string | null) => (riderId ? (techs.find((x) => x.id === riderId)?.name ?? "") : "");
  const noun = board.data?.workerNoun ?? "techs";
  const jobNoun = board.data?.jobNoun ?? "jobs";

  const refresh = () => {
    setNow(new Date());
    return board.refetch();
  };

  return (
    <View style={s.screen}>
      <OfficeHeader title="Today" />
      <ScrollView
        contentContainerStyle={[s.content, WIDE]}
        refreshControl={<RefreshControl refreshing={board.isFetching && !board.isLoading} onRefresh={refresh} tintColor={C.brand} />}
      >
        {board.isLoading ? (
          <ListSkeleton rows={3} height={110} />
        ) : board.isError ? (
          <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load the board" sub={(board.error as Error)?.message} />
        ) : (
          <>
            <StatusTiles t={t} workerNoun={noun} onPick={(status) => router.push({ pathname: "/(office)/team", params: { status } })} />

            <Section
              title="Needs attention"
              count={attention.length}
              icon={<Warning color={attention.length ? C.red : C.muted} size={16} weight="fill" />}
            >
              {attention.length === 0 ? (
                <Text style={s.quiet}>Nothing late and every {jobNoun.replace(/s$/, "")} has a {noun.replace(/s$/, "")}.</Text>
              ) : (
                attention.slice(0, 8).map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    techName={techName(job.riderId)}
                    onPress={() => router.push(`/office/job/${job.id}`)}
                    actions={
                      can("work_orders:edit") ? (
                        <Button
                          title={job.riderId ? "Reassign" : "Assign"}
                          small
                          variant="outline"
                          onPress={() => router.push({ pathname: "/office/job/[id]", params: { id: job.id, assign: "1" } })}
                        />
                      ) : undefined
                    }
                  />
                ))
              )}
              {attention.length > 8 ? (
                <Button title={`See all ${attention.length}`} variant="ghost" small onPress={() => router.push("/(office)/jobs")} />
              ) : null}
            </Section>

            <Section title="Next up" count={upcoming.length} icon={<CalendarCheck color={C.brand} size={16} weight="fill" />}>
              {upcoming.length === 0 ? (
                <Text style={s.quiet}>No more {jobNoun} scheduled today.</Text>
              ) : (
                upcoming.map((job) => (
                  <JobRow key={job.id} job={job} techName={techName(job.riderId)} onPress={() => router.push(`/office/job/${job.id}`)} />
                ))
              )}
            </Section>

            {board.data?.truncated ? (
              <Text style={s.note}>Showing the first {jobs.length} {jobNoun}. Open the web console for the full day.</Text>
            ) : null}

            {can("work_orders:create") ? (
              <Button
                title="New job"
                icon={<ClipboardText color="#04121c" size={18} weight="bold" />}
                onPress={() => router.push("/office/new-job")}
                style={{ marginTop: S.lg }}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, count, icon, children }: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        {icon}
        <Text style={s.sectionTitle}>{title}</Text>
        {count > 0 ? (
          <View style={s.count}>
            <Text style={s.countTxt}>{count}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: S.lg, paddingBottom: S.xxl },
  section: { marginTop: S.xl },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: S.sm, marginBottom: S.xs },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: "800", flex: 1 },
  count: { backgroundColor: C.bg3, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countTxt: { color: C.sub, fontSize: 12, fontWeight: "800" },
  quiet: { color: C.muted, fontSize: 13, paddingVertical: S.md },
  note: { color: C.muted, fontSize: 12, marginTop: S.lg, textAlign: "center" },
});
