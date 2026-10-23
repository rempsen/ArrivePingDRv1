import { useEffect, useMemo, useState } from "react";
import { View, Text, SectionList, RefreshControl, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UsersThree, Warning, MapTrifold, ListBullets, ArrowSquareOut, UserSwitch } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { TechRow, statusColor } from "../../components/office/tech-row";
import { TechDetail } from "../../components/office/tech-detail";
import { SplitScreen, EmptyPane } from "../../components/office/split-screen";
import { LiveMap, type MapSelection } from "../../components/office/live-map";
import { onDay } from "../../lib/map-pins";
import { JobDetail } from "../../components/office/job-detail";
import { JobRow } from "../../components/office/job-row";
import { Sheet } from "../../components/office/sheet";
import { Button, Empty, ListSkeleton } from "../../components/ui";
import { C, R, S, WIDE } from "../../lib/theme";
import { useBoard } from "../../lib/use-board";
import { useLayout } from "../../lib/use-layout";
import { useAccess } from "../../lib/use-access";
import { LIST_PANE_W } from "../../lib/layout";
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
  // Tab screens stay mounted, so a later tap on a Today tile or Crew row
  // arrives as a new param on the same screen. The param is consumed and
  // cleared, so tapping the same tile twice (with a chip change in between)
  // still lands on that status, and a plain tab tap keeps whatever chip was
  // picked last.
  useEffect(() => {
    if (!params.status) return;
    setFilter(params.status);
    router.setParams({ status: undefined });
  }, [params.status, router]);
  const board = useBoard(null);
  const now = new Date();
  const { wide } = useLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && board.data && !board.data.techs.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [selectedId, board.data]);
  const message = (techId: string) => router.push(wide ? { pathname: "/(office)/messages", params: { techId } } : `/office/thread/${techId}`);
  // List | Map. The map fills the screen; what's tapped opens in a card on
  // an iPad or a sheet on a phone.
  const [mode, setMode] = useState<"list" | "map">("list");
  const [sel, setSel] = useState<MapSelection>(null);
  const { can } = useAccess();
  useEffect(() => {
    if (!sel || !board.data) return;
    const gone = sel.kind === "tech" ? !board.data.techs.some((t) => t.id === sel.id) : !board.data.jobs.some((j) => j.id === sel.id);
    if (gone) setSel(null);
  }, [sel, board.data]);

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

  const segment = (
    <View style={s.segments}>
      {(["list", "map"] as const).map((m) => {
        const on = mode === m;
        return (
          <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={m === "list" ? "List" : "Map"} style={[s.seg, on && s.segOn]}>
            {m === "list" ? <ListBullets color={on ? "#04121c" : C.sub} size={16} weight="bold" /> : <MapTrifold color={on ? "#04121c" : C.sub} size={16} weight="bold" />}
          </Pressable>
        );
      })}
    </View>
  );

  const list = (
    <View style={s.screen}>
      <OfficeHeader title="Team" right={segment} />
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
              onMessage={(t) => message(t.id)}
              onPress={wide ? () => setSelectedId(item.id) : undefined}
              selected={wide && item.id === selectedId}
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

  if (mode === "map") {
    const selJob = sel?.kind === "job" ? jobs.find((j) => j.id === sel.id) : undefined;
    const selTech = sel?.kind === "tech" ? techs.find((t) => t.id === sel.id) : undefined;
    // The phone's sheet is a native Modal: close it before pushing, or the
    // job screen opens underneath it.
    const openJob = (id: string) => {
      setSel(null);
      router.push(`/office/job/${id}`);
    };
    const assignJob = (id: string) => {
      setSel(null);
      router.push({ pathname: "/office/job/[id]", params: { id, assign: "1" } });
    };
    // Today's jobs only: the board also carries every waiting job whatever its date.
    const dayJobs = board.data ? onDay(jobs, board.data.day, board.data.tz) : jobs;
    const picked =
      selJob ? (
        <>
          <JobRow job={selJob} techName={selJob.riderId ? (techs.find((t) => t.id === selJob.riderId)?.name ?? "") : ""} />
          <View style={s.pickBtns}>
            <Button title="Open" small variant="outline" icon={<ArrowSquareOut color={C.text} size={16} />} onPress={() => openJob(selJob.id)} />
            {can("work_orders:edit") && selJob.status !== "completed" && selJob.status !== "cancelled" ? (
              <Button title={selJob.riderId ? "Reassign" : "Assign"} small icon={<UserSwitch color="#04121c" size={16} weight="bold" />} onPress={() => assignJob(selJob.id)} />
            ) : null}
          </View>
        </>
      ) : selTech ? (
        <TechRow
          tech={selTech}
          now={now}
          currentJob={jobTitle(selTech.currentJobId)?.customerName ?? null}
          onMessage={(t) => {
            setSel(null);
            message(t.id);
          }}
        />
      ) : null;
    return (
      <View style={s.screen}>
        <OfficeHeader title="Team" right={segment} />
        <View style={{ flex: 1 }}>
          {board.isLoading ? (
            <View style={[s.pad, WIDE]}>
              <ListSkeleton rows={3} height={72} />
            </View>
          ) : board.isError ? (
            <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load the team" sub={(board.error as Error)?.message} />
          ) : (
            <LiveMap techs={techs} jobs={dayJobs} office={board.data?.office ?? null} selected={sel} onSelect={setSel} />
          )}
          {wide && sel && (selJob || selTech) ? (
            <View style={s.mapCard}>
              {selJob ? (
                <JobDetail key={selJob.id} id={selJob.id} embedded onMessageTech={message} />
              ) : (
                <TechDetail techId={selTech!.id} onMessage={message} onOpenJob={openJob} />
              )}
            </View>
          ) : null}
        </View>
        {!wide ? (
          <Sheet open={!!sel && !!(selJob || selTech)} title={selJob ? "Job" : "Technician"} onClose={() => setSel(null)}>
            {picked}
          </Sheet>
        ) : null}
      </View>
    );
  }

  return (
    <SplitScreen
      list={list}
      detail={selectedId ? <TechDetail techId={selectedId} onMessage={message} onOpenJob={(id) => router.push(`/office/job/${id}`)} /> : null}
      empty={<EmptyPane icon={<UsersThree color={C.muted} size={32} />} text="Pick a technician" sub="Their day and the ways to reach them open here." />}
    />
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
  segments: { flexDirection: "row", backgroundColor: C.bg3, borderRadius: R.pill, padding: 3, borderWidth: 1, borderColor: C.border },
  seg: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill },
  segOn: { backgroundColor: C.brand },
  mapCard: { position: "absolute", top: S.md, right: S.md, bottom: S.md, width: LIST_PANE_W, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  pickBtns: { flexDirection: "row", gap: S.sm, paddingVertical: S.md },
});
