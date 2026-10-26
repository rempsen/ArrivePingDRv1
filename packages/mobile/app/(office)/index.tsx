import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, StyleSheet, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Warning, Clock, Megaphone, MapPin, Plus, CheckCircle, CalendarBlank } from "phosphor-react-native";
import { OfficeHeader } from "../../components/office/header";
import { OfficeIntroCard } from "../../components/office/intro-card";
import { CrewChips, DayBar, NeedRow, NextRow, Panel, Quiet, Tiles, timeIn, type NeedAction, type Tile } from "../../components/office/today-parts";
import { Empty, ListSkeleton } from "../../components/ui";
import { C, R, S } from "../../lib/theme";
import { useBoard } from "../../lib/use-board";
import { useAccess } from "../../lib/use-access";
import { useLayout } from "../../lib/use-layout";
import { useStreamHealthy } from "../../lib/use-dispatch-stream";
import { TWO_COLUMN_MIN } from "../../lib/layout";
import { addDays, ageLabel, NO_JOBS, NO_TECHS, type OfficeJob, type OfficeTech } from "../../lib/board";
import { crewGroups, dayAhead, hourRange, needsYou, pulseBlocks, pulseOf, upNext, type Need } from "../../lib/today";
import { instantFor, jobMinutes, minLabel } from "../../lib/timeline";
import { partsIn } from "../../lib/when";

/**
 * Today: the operations dashboard a dispatcher or manager opens between
 * calls. Four bands, all derived from the live board (see lib/today.ts):
 *
 *   Day pulse   today's numbers, each a shortcut, over a strip of the day
 *   Crew now    the roster grouped by what each person is doing
 *   Needs you   one queue: the reason, and a one-tap fix
 *   Up next     assigned jobs starting soon, with who and how they're doing
 *
 * Once nothing is left to run today the pulse becomes "Day wrapped" plus a
 * Tomorrow card, and the queues look at tomorrow instead. Design source:
 * "ArrivePing iPad Office" canvas (Today boards). Patterns from Jobber's
 * Today's appointments, Housecall Pro's Open items + Employee status, and
 * ServiceTitan's alert tray with reasons.
 */
export default function Today() {
  const router = useRouter();
  const { can } = useAccess();
  const canEdit = can("work_orders:edit");
  const canCreate = can("work_orders:create");
  const live = useStreamHealthy();
  const board = useBoard(null);
  const { wide, width } = useLayout();
  const twoCol = wide && width >= TWO_COLUMN_MIN;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const techs = board.data?.techs ?? NO_TECHS;
  const jobs = board.data?.jobs ?? NO_JOBS;
  const tz = board.data?.tz ?? "UTC";
  const today = board.data?.day ?? null;
  const tomorrow = today ? addDays(today, 1) : null;
  // The next six days: tomorrow's preview and "N more unassigned this week".
  const ahead = useBoard(tomorrow, !!tomorrow, 6);
  const noun = board.data?.workerNoun ?? "technicians";
  const one = noun.replace(/s$/, "");

  const nowMin = useMemo(() => {
    const p = partsIn(now, tz);
    return p.hour * 60 + p.minute;
  }, [now, tz]);
  const pulse = useMemo(() => pulseOf(jobs, tz), [jobs, tz]);
  const strip = useMemo(() => pulseBlocks(jobs, tz), [jobs, tz]);
  const crew = useMemo(() => crewGroups(techs, jobs), [techs, jobs]);
  const wrapped = pulse.wrapped && !board.isLoading;

  const aheadJobs = ahead.data?.jobs ?? NO_JOBS;
  const preview = useMemo(
    () => (tomorrow ? dayAhead(aheadJobs, ahead.data?.techs ?? techs, ahead.data?.timeOff ?? [], tomorrow, ahead.data?.tz ?? tz) : null),
    [aheadJobs, ahead.data, techs, tomorrow, tz],
  );
  const tomorrowJobs = useMemo(() => (tomorrow ? aheadJobs.filter((j) => jobMinutes(j.scheduledAt, tz).day === tomorrow) : []), [aheadJobs, tomorrow, tz]);

  // After hours the queues look at tomorrow; today's leftovers (rare) stay on top.
  const needs = useMemo(() => {
    const todays = needsYou(jobs, techs);
    return wrapped ? [...todays, ...needsYou(tomorrowJobs, [])] : todays;
  }, [jobs, techs, wrapped, tomorrowJobs]);
  const next = useMemo(() => {
    if (!wrapped) return upNext(jobs, now, needs);
    return tomorrow ? upNext(tomorrowJobs, new Date(instantFor(tomorrow, 0, tz)), needs) : [];
  }, [wrapped, jobs, now, needs, tomorrowJobs, tomorrow, tz]);

  const byJob = useMemo(() => new Map([...jobs, ...aheadJobs].map((j) => [j.id, j])), [jobs, aheadJobs]);
  const byTech = useMemo(() => new Map([...techs, ...(ahead.data?.techs ?? [])].map((t) => [t.id, t])), [techs, ahead.data]);

  // ------------------------------------------------------------ navigation --
  const openJob = (id: string) => router.push(`/office/job/${id}`);
  const assign = (id: string) => router.push({ pathname: "/office/job/[id]", params: { id, assign: "1" } });
  const message = (techId: string) => router.push(wide ? { pathname: "/(office)/messages", params: { techId } } : `/office/thread/${techId}`);
  const jobsAt = (bucket: string, day?: string | null) => router.push({ pathname: "/(office)/jobs", params: { bucket, ...(day ? { day, anchor: today ?? "" } : {}) } });
  const team = (status: string) => router.push({ pathname: "/(office)/team", params: { status } });
  const plan = (day: string | null, view: "day" | "week") =>
    wide ? router.push({ pathname: "/(office)/board", params: { view, ...(day ? { day, anchor: today ?? "" } : {}) } }) : jobsAt("unassigned", day);
  const first = (t?: OfficeTech) => (t ? (t.name.split(/\s+/)[0] ?? t.name) : "");

  // ------------------------------------------------------------- the queue --
  const needRow = (n: Need) => {
    const job = n.jobId ? byJob.get(n.jobId) : undefined;
    const tech = n.techId ? byTech.get(n.techId) : undefined;
    const when = job ? timeIn(job.scheduledAt, tz) : "";
    const isTomorrow = !!job && tomorrow != null && jobMinutes(job.scheduledAt, tz).day === tomorrow;
    const whenLabel = isTomorrow ? `tomorrow ${when}` : when;
    const customer = job ? job.customerName || job.title || "Work order" : "";
    const msg: NeedAction | undefined = tech && canEdit ? { label: `Message ${first(tech)}`, onPress: () => message(tech.id) } : undefined;
    const reassign: NeedAction | undefined = job && canEdit ? { label: tech ? "Reassign" : "Assign", onPress: () => assign(job.id) } : undefined;
    const open: NeedAction | undefined = job ? { label: "Open", onPress: () => openJob(job.id) } : undefined;
    switch (n.kind) {
      case "late":
        return { color: C.red, reason: `Late · ${whenLabel}${job?.etaMins != null ? ` · ETA ${job.etaMins} min` : ""}`, title: customer, detail: [tech ? tech.name : `No ${one}`, job?.service].filter(Boolean).join(" · "), primary: msg ?? reassign, secondary: msg ? reassign : open };
      case "unassigned":
        return { color: C.red, reason: `Unassigned · ${whenLabel}`, title: customer, detail: [job?.service, job?.address].filter(Boolean).join(" · "), primary: reassign, secondary: open };
      case "offered":
        return { color: C.amber, reason: `Offered · not accepted · ${whenLabel}`, title: customer, detail: `Waiting on ${tech?.name ?? `the ${one}`}`, primary: msg, secondary: reassign };
      case "stale":
        return {
          color: C.amber,
          reason: `Location stale · ${ageLabel(tech?.locationAt ?? null, now)}`,
          title: tech?.name ?? one,
          detail: tech?.currentJobId ? `On ${byJob.get(tech.currentJobId)?.customerName ?? "a job"}` : "No job in progress",
          primary: msg,
          secondary: tech?.phone ? { label: "Call", onPress: () => Linking.openURL(`tel:${tech.phone}`).catch(() => {}) } : undefined,
        };
      case "unconfirmed":
        return { color: C.amber, reason: `Unconfirmed · ${whenLabel}`, title: customer, detail: [job?.service, tech?.name].filter(Boolean).join(" · "), primary: open, secondary: undefined };
    }
  };
  const SHOW = twoCol ? 6 : 5;
  const later = preview ? (wrapped ? preview.laterUnassigned : preview.laterUnassigned + preview.tomorrow.unassigned) : 0;

  const etaOf = (job: OfficeJob, tech?: OfficeTech): { text: string; color: string } => {
    if (wrapped) return job.status === "pending" ? { text: "Unconfirmed", color: C.amber } : { text: "Confirmed", color: "#38bdf8" };
    if (job.status === "enroute") return { text: job.etaMins != null ? `ETA ${job.etaMins} min` : "On the way", color: C.cyan };
    if (tech?.status === "offline") return { text: "Not on shift", color: C.amber };
    if (tech?.currentJobId && tech.currentJobId !== job.id) return { text: tech.freeAt ? `Free ~${timeIn(tech.freeAt, tz)}` : "Finishing a job", color: "#2dd4bf" };
    if (job.status === "pending") return { text: "Unconfirmed", color: C.amber };
    return { text: "On time", color: C.green };
  };

  // ----------------------------------------------------------------- bands --
  const tiles: Tile[] = [
    { key: "total", n: pulse.total, label: "Jobs today", sub: `${techs.filter((x) => x.status !== "offline").length} of ${techs.length} on shift`, color: C.text, onPress: () => jobsAt("scheduled") },
    { key: "done", n: pulse.done, label: "Done", sub: pulse.total ? `${Math.round((pulse.done / pulse.total) * 100)}% of the day` : undefined, color: C.green, onPress: () => jobsAt("done") },
    { key: "active", n: pulse.inProgress, label: "In progress", color: C.cyan, onPress: () => jobsAt("in_progress") },
    { key: "remaining", n: pulse.remaining, label: "To start", sub: pulse.lastEnd != null ? `last ends ${minLabel(pulse.lastEnd % 1440)}` : undefined, color: C.text, onPress: () => jobsAt("scheduled") },
    { key: "late", n: pulse.late, label: "Late", color: C.red, hot: true, onPress: () => jobsAt("scheduled") },
    { key: "unassigned", n: pulse.unassigned, label: "Unassigned", sub: later ? `+${later} this week` : undefined, color: C.red, hot: true, onPress: () => jobsAt("unassigned") },
    { key: "offered", n: pulse.offered, label: "Offer pending", sub: pulse.unconfirmed ? `${pulse.unconfirmed} unconfirmed` : undefined, color: C.amber, onPress: () => jobsAt("scheduled") },
  ];

  const pulseCard = wrapped ? (
    <View style={[s.split, !twoCol && { flexDirection: "column" }]}>
      <View style={[s.card, { flex: 1 }]}>
        <View style={s.cardHead}>
          <CheckCircle color={C.green} size={18} weight="fill" />
          <Text style={s.cardTitle}>Day wrapped</Text>
          <Text style={s.cardNote}>{pulse.lastEnd != null ? `last job ended ${minLabel(pulse.lastEnd % 1440)}` : "no jobs today"}</Text>
        </View>
        <Tiles
          columns={3}
          tiles={[
            { key: "w-total", n: pulse.total + pulse.cancelled, label: "Jobs", color: C.text, onPress: () => jobsAt("done") },
            { key: "w-done", n: pulse.done, label: "Completed", color: C.green, onPress: () => jobsAt("done") },
            { key: "w-cxl", n: pulse.cancelled, label: "Cancelled", color: "#f87171", onPress: () => jobsAt("done") },
          ]}
        />
      </View>
      {preview ? (
        <View style={[s.card, s.cardTomorrow, { flex: 1 }]}>
          <View style={s.cardHead}>
            <CalendarBlank color={C.brand} size={18} weight="fill" />
            <Text style={s.cardTitle}>Tomorrow</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => plan(tomorrow, "day")} accessibilityRole="button" hitSlop={8}>
              <Text style={s.link}>Plan tomorrow ›</Text>
            </Pressable>
          </View>
          <Tiles
            columns={4}
            tiles={[
              { key: "t-total", n: preview.tomorrow.total, label: "Jobs", color: C.text, onPress: () => jobsAt("scheduled", tomorrow) },
              { key: "t-roster", n: preview.tomorrow.onRoster, label: "On roster", color: C.text, onPress: () => team("available") },
              { key: "t-open", n: preview.tomorrow.unassigned, label: "Unassigned", color: C.red, hot: true, onPress: () => jobsAt("unassigned", tomorrow) },
              { key: "t-pending", n: preview.tomorrow.unconfirmed, label: "Unconfirmed", color: C.amber, onPress: () => jobsAt("scheduled", tomorrow) },
            ]}
          />
          <Text style={s.cardFoot} numberOfLines={2}>
            {[
              preview.tomorrow.firstStart != null ? `First job ${minLabel(preview.tomorrow.firstStart)}` : "No jobs booked yet",
              preview.tomorrow.offNames.length ? `off: ${preview.tomorrow.offNames.join(", ")}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      ) : null}
    </View>
  ) : (
    <View style={s.card}>
      <Tiles tiles={tiles} columns={twoCol ? 7 : wide ? 4 : 3} />
      {pulse.total > 0 ? <DayBar blocks={strip.blocks} startMin={strip.startMin} endMin={strip.endMin} nowMin={nowMin} pulse={pulse} /> : null}
    </View>
  );

  const crewCard = (
    <View style={[s.card, s.crewCard]}>
      <View style={{ width: wide ? 110 : undefined }}>
        <Text style={s.cardTitle}>{wrapped ? "Crew" : "Crew now"}</Text>
        <Text style={s.cardNote}>
          {techs.length} on roster{preview && wrapped ? ` · ${preview.tomorrow.onRoster} tomorrow` : ""}
        </Text>
      </View>
      <View style={wide ? { flex: 1, minWidth: 0 } : { width: "100%" }}>{techs.length ? <CrewChips groups={crew} tz={tz} onPick={team} /> : <Text style={s.cardNote}>No {noun} yet.</Text>}</View>
    </View>
  );

  const needsPanel = (
    <Panel title={wrapped ? "Needs you before tomorrow" : "Needs you"} icon={<Warning color={needs.length ? C.red : C.muted} size={16} weight="fill" />} count={needs.length} countHot>
      {needs.length === 0 ? (
        <Quiet text={wrapped ? "Tomorrow is covered: every job has a " + one + "." : `All clear: nothing late and every job has a ${one}.`} />
      ) : (
        needs.slice(0, SHOW).map((n) => {
          const r = needRow(n);
          return <NeedRow key={n.key} {...r} onOpen={n.jobId ? () => openJob(n.jobId!) : n.techId ? () => team("") : undefined} />;
        })
      )}
      {needs.length > SHOW || later > 0 ? (
        <View style={s.more}>
          <Text style={s.moreTxt} numberOfLines={1}>
            {[needs.length > SHOW ? `${needs.length - SHOW} more here` : null, later > 0 ? `${later} unassigned later this week` : null].filter(Boolean).join(" · ")}
          </Text>
          <Pressable onPress={() => (later > 0 ? plan(tomorrow, "week") : jobsAt("unassigned"))} accessibilityRole="button" hitSlop={8}>
            <Text style={s.link}>{later > 0 ? "Plan the week ›" : "See all ›"}</Text>
          </Pressable>
        </View>
      ) : null}
    </Panel>
  );

  const nextPanel = (
    <Panel
      title={wrapped ? "First up tomorrow" : "Up next"}
      icon={<Clock color={C.brand} size={16} weight="bold" />}
      right={<Text style={s.cardNote}>{wrapped ? (preview?.tomorrow.firstStart != null ? `from ${minLabel(preview.tomorrow.firstStart)}` : "") : "next 2 hours"}</Text>}
    >
      {next.length === 0 ? (
        <Quiet text={wrapped ? "Nothing assigned for tomorrow yet." : `No more assigned ${board.data?.jobNoun ?? "jobs"} today.`} />
      ) : (
        next.map((j) => {
          const tech = j.riderId ? byTech.get(j.riderId) : undefined;
          return <NextRow key={j.id} job={j} tz={tz} tech={tech} eta={etaOf(j, tech)} onPress={() => openJob(j.id)} />;
        })
      )}
    </Panel>
  );

  // ---------------------------------------------------------------- header --
  const quick = (
    <View style={s.quick}>
      <View style={s.live} accessibilityLabel={wrapped ? "After hours" : live ? "Live updates on" : "Refreshing every 30 seconds"}>
        <View style={[s.liveDot, { backgroundColor: wrapped ? C.muted : live ? C.green : C.amber }]} />
        {wide ? <Text style={[s.liveTxt, { color: wrapped ? C.muted : live ? C.green : C.amber }]}>{wrapped ? "After hours" : live ? "Live" : "Polling"}</Text> : null}
      </View>
      {canEdit ? <QuickButton label="Broadcast" wide={wide} icon={<Megaphone color={C.text} size={18} />} onPress={() => router.push({ pathname: "/(office)/messages", params: { broadcast: "1" } })} /> : null}
      <QuickButton label="Map" wide={wide} icon={<MapPin color={C.text} size={18} />} onPress={() => router.push({ pathname: "/(office)/team", params: { mode: "map" } })} />
      {canCreate ? <QuickButton label="New job" primary wide={wide} icon={<Plus color="#04121c" size={18} weight="bold" />} onPress={() => router.push("/office/new-job")} /> : null}
    </View>
  );

  return (
    <View style={s.screen}>
      <OfficeHeader title="Today" right={quick} />
      <ScrollView
        contentContainerStyle={[s.content, { maxWidth: wide ? 1180 : 760 }]}
        refreshControl={
          <RefreshControl
            refreshing={board.isFetching && !board.isLoading}
            onRefresh={() => {
              setNow(new Date());
              ahead.refetch();
              return board.refetch();
            }}
            tintColor={C.brand}
          />
        }
      >
        {board.isLoading ? (
          <ListSkeleton rows={4} height={110} />
        ) : board.isError ? (
          <Empty icon={<Warning color={C.red} size={28} />} text="Couldn't load the board" sub={(board.error as Error)?.message} />
        ) : (
          <>
            <Text style={s.dateLine}>
              {today ? new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }) : ""}
              {pulse.busiestHour != null && !wrapped ? ` · busiest ${hourRange(pulse.busiestHour)}` : ""}
            </Text>
            {pulseCard}
            {crewCard}
            {twoCol ? (
              <View style={s.split}>
                <View style={s.col}>{needsPanel}</View>
                <View style={s.col}>{nextPanel}</View>
              </View>
            ) : (
              <>
                {needsPanel}
                {nextPanel}
              </>
            )}
            {board.data?.truncated ? <Text style={s.note}>Showing the first {jobs.length} jobs. Open the web console for the full day.</Text> : null}
            <OfficeIntroCard />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function QuickButton({ label, icon, onPress, primary, wide }: { label: string; icon: React.ReactNode; onPress: () => void; primary?: boolean; wide: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [s.qBtn, primary ? s.qPrimary : s.qOutline, !wide && s.qIcon, { opacity: pressed ? 0.85 : 1 }]}
    >
      {icon}
      {wide ? <Text style={[s.qTxt, primary && { color: "#04121c" }]}>{label}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { width: "100%", alignSelf: "center", padding: S.lg, paddingBottom: S.xxl, gap: S.md },
  dateLine: { color: C.sub, fontSize: 13, fontWeight: "700" },
  card: { borderRadius: R.card, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, padding: S.lg, gap: S.md },
  cardTomorrow: { borderColor: C.brand, backgroundColor: "rgba(14,165,233,0.06)" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: S.sm },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  cardNote: { color: C.muted, fontSize: 12 },
  cardFoot: { color: C.sub, fontSize: 12 },
  crewCard: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingVertical: S.md },
  link: { color: C.brand, fontSize: 13, fontWeight: "700" },
  split: { flexDirection: "row", gap: S.md, alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0 },
  more: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.md },
  moreTxt: { color: C.sub, fontSize: 13, flex: 1 },
  note: { color: C.muted, fontSize: 12, textAlign: "center" },
  quick: { flexDirection: "row", alignItems: "center", gap: S.sm },
  live: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: S.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveTxt: { fontSize: 12, fontWeight: "700" },
  qBtn: { height: 40, borderRadius: R.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.sm, paddingHorizontal: 14 },
  qIcon: { width: 40, paddingHorizontal: 0 },
  qPrimary: { backgroundColor: C.brand },
  qOutline: { borderWidth: 1, borderColor: C.borderHi },
  qTxt: { color: C.text, fontSize: 14, fontWeight: "700" },
});
