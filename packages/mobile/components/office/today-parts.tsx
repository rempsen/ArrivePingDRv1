import { View, Text, Pressable, StyleSheet } from "react-native";
import { Avatar } from "../ui";
import { C, R, S } from "../../lib/theme";
import type { OfficeJob, OfficeTech } from "../../lib/board";
import type { BlockKind, CrewGroup, Pulse } from "../../lib/today";
import { hourRange } from "../../lib/today";
import { jobMinutes, minLabel } from "../../lib/timeline";

/**
 * The bands of the Today dashboard. Layout only: every number and queue comes
 * from lib/today.ts, every tap is a callback the screen wires to a route.
 * Design source: "ArrivePing iPad Office" canvas, Today boards.
 */

export const timeIn = (iso: string, tz: string) => minLabel(jobMinutes(iso, tz).min);

// ------------------------------------------------------------------ tiles --

export interface Tile {
  key: string;
  n: number;
  /** Shown instead of `n` (money, say); `n` still drives the empty styling. */
  text?: string;
  label: string;
  sub?: string;
  color: string;
  /** Red outline: something here needs a person. */
  hot?: boolean;
  onPress?: () => void;
}

export function Tiles({ tiles, columns }: { tiles: Tile[]; columns: number }) {
  return (
    <View style={s.tiles}>
      {tiles.map((t) => (
        <Pressable
          key={t.key}
          onPress={t.onPress}
          disabled={!t.onPress}
          accessibilityRole={t.onPress ? "button" : undefined}
          accessibilityLabel={`${t.text ?? t.n} ${t.label}${t.sub ? `, ${t.sub}` : ""}`}
          style={({ pressed }) => [
            s.tile,
            { flexBasis: `${100 / columns - 2}%` as const },
            t.hot && t.n > 0 && { borderColor: t.color, backgroundColor: "rgba(239,68,68,0.08)" },
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[s.tileN, { color: t.n === 0 && t.hot ? C.sub : t.color }]} allowFontScaling={false}>
            {t.text ?? t.n}
          </Text>
          <Text style={s.tileLabel} numberOfLines={1}>
            {t.label}
          </Text>
          {t.sub ? (
            <Text style={s.tileSub} numberOfLines={1}>
              {t.sub}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

// ------------------------------------------------------------- day strip --

const BLOCK: Record<BlockKind, string> = { done: C.green, active: C.cyan, scheduled: C.brand, unassigned: C.red, late: C.red };

/** The day as blocks between the window's ends, a now-marker, hour labels and a legend that doubles as the summary. */
export function DayBar({
  blocks,
  startMin,
  endMin,
  nowMin,
  pulse,
}: {
  blocks: Array<{ id: string; from: number; to: number; kind: BlockKind }>;
  startMin: number;
  endMin: number;
  nowMin: number | null;
  pulse: Pulse;
}) {
  const span = endMin - startMin;
  const marks: number[] = [];
  for (let m = Math.ceil(startMin / 120) * 120; m <= endMin; m += 120) marks.push(m);
  const now = nowMin != null && nowMin >= startMin && nowMin <= endMin ? (nowMin - startMin) / span : null;
  // Many jobs overlap; drawing them in two thin rows keeps neighbours apart.
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`Day timeline: ${pulse.done} done, ${pulse.inProgress} in progress, ${pulse.remaining} still to start`}>
      <View style={s.bar}>
        {blocks.map((b, i) => (
          <View
            key={b.id}
            style={[
              s.block,
              {
                left: `${b.from * 100}%`,
                width: `${Math.max(0.6, (b.to - b.from) * 100)}%`,
                top: i % 2 === 0 ? 4 : 13,
                backgroundColor: BLOCK[b.kind],
                opacity: b.kind === "done" ? 0.55 : 1,
              },
            ]}
          />
        ))}
        {now != null ? <View style={[s.now, { left: `${now * 100}%` }]} /> : null}
      </View>
      <View style={s.marks}>
        {marks.map((m) => (
          <Text key={m} style={[s.mark, { left: `${((m - startMin) / span) * 100}%` }]}>
            {minLabel(m).replace(":00", "")}
          </Text>
        ))}
      </View>
      <View style={s.legend}>
        <Legend color={C.green} label={`Done ${pulse.done}`} />
        <Legend color={C.cyan} label={`In progress ${pulse.inProgress}`} />
        <Legend color={C.brand} label={`To start ${Math.max(0, pulse.remaining - pulse.unassigned)}`} />
        <Legend color={C.red} label={`Unassigned or late ${pulse.unassigned + pulse.late}`} />
        <View style={{ flex: 1 }} />
        {pulse.busiestHour != null && pulse.lastEnd != null ? (
          <Text style={s.legendNote} numberOfLines={1}>
            Busiest {hourRange(pulse.busiestHour)} · last job ends {minLabel(pulse.lastEnd % (24 * 60))}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.legendDot, { backgroundColor: color }]} />
      <Text style={s.legendTxt}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------------- crew --

const CREW: Record<CrewGroup["key"], { label: string; color: string }> = {
  available: { label: "available", color: C.green },
  enroute: { label: "on the way", color: C.cyan },
  onsite: { label: "on site", color: "#2dd4bf" },
  busy: { label: "busy or on break", color: C.amber },
  offline: { label: "off shift", color: C.muted },
};

export function CrewChips({ groups, tz, onPick }: { groups: CrewGroup[]; tz: string; onPick: (status: string) => void }) {
  return (
    <View style={s.chips}>
      {groups.map((g) => {
        const meta = CREW[g.key];
        const first = (t: OfficeTech) => t.name.split(/\s+/)[0] ?? t.name;
        const sub =
          g.key === "available"
            ? g.techs.slice(0, 3).map(first).join(", ") + (g.techs.length > 3 ? ` +${g.techs.length - 3}` : "")
            : g.key === "enroute"
              ? g.etaMins != null
                ? `next ETA ${g.etaMins} min`
                : g.techs.map(first).slice(0, 2).join(", ")
              : g.freeAt
                ? `free from ${timeIn(g.freeAt, tz)}`
                : g.techs.map(first).slice(0, 2).join(", ");
        return (
          <Pressable
            key={g.key}
            onPress={() => onPick(g.key)}
            accessibilityRole="button"
            accessibilityLabel={`${g.techs.length} ${meta.label}: ${sub}`}
            style={({ pressed }) => [s.chip, { opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={s.faces}>
              {g.techs.slice(0, 3).map((t, i) => (
                <View key={t.id} style={[s.face, i > 0 && { marginLeft: -10 }, g.key === "offline" && { opacity: 0.6 }]}>
                  <Avatar name={t.name} photoUrl={t.photoUrl} color={t.color} size={28} />
                </View>
              ))}
            </View>
            <View style={{ minWidth: 0 }}>
              <Text style={[s.chipN, { color: meta.color }]} numberOfLines={1}>
                {g.techs.length} {meta.label}
              </Text>
              {sub ? (
                <Text style={s.chipSub} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ panels --

export function Panel({ title, icon, count, countHot, right, children }: { title: string; icon?: React.ReactNode; count?: number; countHot?: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={s.panel}>
      <View style={s.panelHead}>
        {icon}
        <Text style={s.panelTitle} numberOfLines={1}>
          {title}
        </Text>
        {count != null && count > 0 ? (
          <View style={[s.count, countHot && { backgroundColor: C.redBg }]}>
            <Text style={[s.countTxt, countHot && { color: C.red }]}>{count}</Text>
          </View>
        ) : null}
        {right}
      </View>
      {children}
    </View>
  );
}

export interface NeedAction {
  label: string;
  onPress: () => void;
}

/** One item in Needs you: a colour bar, the reason, the job or person, and up to two fixes. */
export function NeedRow({
  color,
  reason,
  title,
  detail,
  primary,
  secondary,
  onOpen,
}: {
  color: string;
  reason: string;
  title: string;
  detail: string;
  primary?: NeedAction;
  secondary?: NeedAction;
  onOpen?: () => void;
}) {
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole={onOpen ? "button" : undefined} accessibilityLabel={`${reason}. ${title}. ${detail}`} style={({ pressed }) => [s.row, { opacity: pressed && onOpen ? 0.85 : 1 }]}>
      <View style={[s.rowBar, { backgroundColor: color }]} />
      <View style={s.rowBody}>
        <Text style={[s.reason, { color }]} numberOfLines={1}>
          {reason}
        </Text>
        <Text style={s.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={s.rowDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {primary ? (
        <Pressable onPress={primary.onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={primary.label} style={({ pressed }) => [s.btn, s.btnPrimary, { opacity: pressed ? 0.85 : 1 }]}>
          <Text style={s.btnPrimaryTxt} numberOfLines={1}>
            {primary.label}
          </Text>
        </Pressable>
      ) : null}
      {secondary ? (
        <Pressable onPress={secondary.onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={secondary.label} style={({ pressed }) => [s.btn, s.btnOutline, { opacity: pressed ? 0.85 : 1 }]}>
          <Text style={s.btnOutlineTxt} numberOfLines={1}>
            {secondary.label}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** One job in Up next: time, customer and service, who has it and how they're doing. */
export function NextRow({ job, tz, tech, eta, onPress }: { job: OfficeJob; tz: string; tech?: OfficeTech; eta: { text: string; color: string }; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${timeIn(job.scheduledAt, tz)}, ${job.customerName || job.title}, ${tech?.name ?? ""}, ${eta.text}`} style={({ pressed }) => [s.row, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={s.when}>
        <Text style={s.whenT} numberOfLines={1} allowFontScaling={false}>
          {timeIn(job.scheduledAt, tz)}
        </Text>
        {job.durationMins ? <Text style={s.whenD}>{job.durationMins} min</Text> : null}
      </View>
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {job.customerName || job.title || "Work order"}
        </Text>
        <Text style={s.rowDetail} numberOfLines={1}>
          {[job.service, job.address].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {tech ? (
        <View style={s.who}>
          <Avatar name={tech.name} photoUrl={tech.photoUrl} color={tech.color} size={28} />
          <View style={{ width: 104 }}>
            <Text style={s.whoName} numberOfLines={1}>
              {tech.name}
            </Text>
            <Text style={[s.whoEta, { color: eta.color }]} numberOfLines={1}>
              {eta.text}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Quiet({ text }: { text: string }) {
  return <Text style={s.quiet}>{text}</Text>;
}

const s = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: S.sm, justifyContent: "space-between" },
  tile: { flexGrow: 1, minWidth: 96, borderRadius: R.control, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3, paddingVertical: 10, paddingHorizontal: S.md, gap: 1 },
  tileN: { fontSize: 26, fontWeight: "900", letterSpacing: -0.5, lineHeight: 30 },
  tileLabel: { color: C.sub, fontSize: 11, fontWeight: "700" },
  tileSub: { color: C.muted, fontSize: 11 },

  bar: { height: 24, borderRadius: 6, backgroundColor: C.bg3, overflow: "hidden" },
  block: { position: "absolute", height: 7, borderRadius: 2 },
  now: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: C.red },
  marks: { height: 12 },
  mark: { position: "absolute", color: C.muted, fontSize: 10, fontWeight: "700", transform: [{ translateX: -10 }] },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: S.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 6, borderRadius: 2 },
  legendTxt: { color: C.sub, fontSize: 11, fontWeight: "700" },
  legendNote: { color: C.muted, fontSize: 11 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: S.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 44, paddingLeft: 10, paddingRight: S.md, paddingVertical: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3, maxWidth: 260 },
  faces: { flexDirection: "row" },
  face: { borderRadius: R.pill, borderWidth: 2, borderColor: C.bg3 },
  chipN: { fontSize: 13, fontWeight: "800" },
  chipSub: { color: C.sub, fontSize: 11 },

  panel: { borderRadius: R.card, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, overflow: "hidden" },
  panelHead: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: 1, borderBottomColor: C.border },
  panelTitle: { color: C.text, fontSize: 15, fontWeight: "800", flex: 1 },
  count: { backgroundColor: C.bg3, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countTxt: { color: C.sub, fontSize: 12, fontWeight: "800" },

  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  rowBar: { width: 6, alignSelf: "stretch", borderRadius: 3 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  reason: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  rowDetail: { color: C.sub, fontSize: 12 },
  btn: { height: 36, paddingHorizontal: S.md, borderRadius: R.control, alignItems: "center", justifyContent: "center", maxWidth: 150 },
  btnPrimary: { backgroundColor: C.brand },
  btnPrimaryTxt: { color: "#04121c", fontSize: 13, fontWeight: "700" },
  btnOutline: { borderWidth: 1, borderColor: C.borderHi },
  btnOutlineTxt: { color: C.text, fontSize: 13, fontWeight: "700" },

  when: { width: 70 },
  whenT: { color: C.text, fontSize: 15, fontWeight: "800" },
  whenD: { color: C.muted, fontSize: 11, marginTop: 1 },
  who: { flexDirection: "row", alignItems: "center", gap: S.sm },
  whoName: { color: C.text, fontSize: 12, fontWeight: "700" },
  whoEta: { fontSize: 11, fontWeight: "700" },

  quiet: { color: C.muted, fontSize: 13, paddingHorizontal: S.lg, paddingVertical: S.lg },
});
