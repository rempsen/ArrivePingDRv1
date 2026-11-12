import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MapView from "react-native-maps";
import { ArrowsOutCardinal, Eye, EyeSlash } from "phosphor-react-native";
import { C, R, S, initials } from "../../lib/theme";
import type { OfficeJob, OfficeTech } from "../../lib/board";
import { fitRegion, visibleJobs, visibleTechs, type PinKind } from "../../lib/map-pins";
import { statusColor } from "./tech-row";

const PIN_COLOR: Record<PinKind, string> = { unassigned: C.red, offered: C.amber, active: C.green, scheduled: C.brand };
const PIN_LABEL: Record<PinKind, string> = { unassigned: "Unassigned", offered: "Offered", active: "In the field", scheduled: "Scheduled" };

const TECH_SIZE = 32;
const JOB_SIZE = 20;
/** Pins this far outside the visible map are skipped. */
const EDGE = 48;

export type MapSelection = { kind: "tech" | "job"; id: string } | null;

type Pin = { key: string; kind: "tech" | "job"; id: string; lat: number; lng: number };

/**
 * Everyone and everything with a position, on Apple Maps: technicians as
 * initials in a status-coloured disc, open jobs as dots coloured by who has
 * them. Positions come from the board the tab already holds, which the
 * dispatch stream's `locations` event keeps fresh. Tapping a pin selects it;
 * tapping the map clears the selection.
 *
 * The pins are ordinary views laid over the map, placed with the map's own
 * `pointForCoordinate`, not native <Marker>s. With the New Architecture on iOS
 * (react-native-maps 1.29 + React Native 0.88) markers did not draw at all on
 * the iPad (custom images: #5912; markers lost after the screen is hidden:
 * #6053; child views: #5911 / #5971). Views can't be lost that way.
 */
export function LiveMap({
  techs,
  jobs,
  office,
  selected,
  onSelect,
}: {
  techs: readonly OfficeTech[];
  jobs: readonly OfficeJob[];
  office: { lat: number; lng: number } | null;
  selected: MapSelection;
  onSelect: (sel: MapSelection) => void;
}) {
  const ref = useRef<MapView>(null);
  // Off-shift technicians show too (dimmed), as on the web map; the eye button hides them.
  const [showOffline, setShowOffline] = useState(true);
  const techPins = useMemo(() => visibleTechs(techs, showOffline), [techs, showOffline]);
  const jobPins = useMemo(() => visibleJobs(jobs), [jobs]);
  const fit = () => ref.current?.animateToRegion(fitRegion([...techPins, ...jobPins], office), 400);
  // Fit once when the first positions arrive, not on every location tick.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || (techPins.length === 0 && jobPins.length === 0)) return;
    fitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when pins exist
  }, [techPins.length, jobPins.length]);

  const pins = useMemo<Pin[]>(
    () => [
      ...jobPins.map((j) => ({ key: `job-${j.id}`, kind: "job" as const, id: j.id, lat: j.lat!, lng: j.lng! })),
      ...techPins.map((t) => ({ key: `tech-${t.id}`, kind: "tech" as const, id: t.id, lat: t.lat!, lng: t.lng! })),
    ],
    [jobPins, techPins],
  );

  // Screen position of every pin, asked of the map so it always agrees with the tiles.
  const [pts, setPts] = useState<Record<string, { x: number; y: number }>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const busy = useRef(false);
  const again = useRef(false);
  const place = useCallback(() => {
    const map = ref.current;
    if (!map) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    Promise.all(
      pinsRef.current.map((p) => map.pointForCoordinate({ latitude: p.lat, longitude: p.lng }).then((pt) => [p.key, pt] as const)),
    )
      .then((rows) => setPts(Object.fromEntries(rows)))
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        if (again.current) {
          again.current = false;
          place();
        }
      });
  }, []);
  // New positions (a technician moved, a job appeared): place them again.
  const signature = pins.map((p) => `${p.key}:${p.lat},${p.lng}`).join("|");
  useEffect(() => {
    place();
  }, [signature, place]);

  const techById = useMemo(() => new Map(techs.map((t) => [t.id, t])), [techs]);
  const jobById = useMemo(() => new Map(jobPins.map((j) => [j.id, j])), [jobPins]);

  return (
    <View style={s.wrap} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={fitRegion([...techPins, ...jobPins], office)}
        userInterfaceStyle="dark"
        showsPointsOfInterests={false}
        showsCompass={false}
        onMapReady={place}
        onRegionChange={place}
        onRegionChangeComplete={place}
        onPress={() => onSelect(null)}
        accessibilityLabel="Live map of technicians and jobs"
      />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {pins.map((p) => {
          const pt = pts[p.key];
          if (!pt || pt.x < -EDGE || pt.y < -EDGE || pt.x > size.w + EDGE || pt.y > size.h + EDGE) return null;
          if (p.kind === "job") {
            const j = jobById.get(p.id);
            if (!j) return null;
            const on = selected?.kind === "job" && selected.id === p.id;
            return (
              <Pressable
                key={p.key}
                onPress={() => onSelect({ kind: "job", id: p.id })}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`${j.customerName || j.title}, ${PIN_LABEL[j.kind]}`}
                style={[s.job, { left: pt.x - JOB_SIZE / 2, top: pt.y - JOB_SIZE / 2, backgroundColor: on ? C.text : PIN_COLOR[j.kind], borderColor: on ? PIN_COLOR[j.kind] : "#fff" }]}
              />
            );
          }
          const t = techById.get(p.id);
          if (!t) return null;
          const on = selected?.kind === "tech" && selected.id === p.id;
          const col = statusColor(t.status === "break" ? "busy" : t.status);
          return (
            <Pressable
              key={p.key}
              onPress={() => onSelect({ kind: "tech", id: p.id })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${t.name}, ${t.status}`}
              style={[
                s.tech,
                { left: pt.x - TECH_SIZE / 2, top: pt.y - TECH_SIZE / 2, backgroundColor: on ? "#fff" : col, borderColor: on ? col : "#fff", opacity: t.status === "offline" || t.stale ? 0.6 : 1 },
              ]}
            >
              <Text style={[s.techTxt, on && { color: col }]} allowFontScaling={false}>
                {initials(t.name)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.controls}>
        <Pressable onPress={fit} accessibilityRole="button" accessibilityLabel="Fit everyone on screen" style={s.ctl}>
          <ArrowsOutCardinal color={C.text} size={18} />
        </Pressable>
        <Pressable
          onPress={() => setShowOffline((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={showOffline ? "Hide off-shift technicians" : "Show off-shift technicians"}
          accessibilityState={{ selected: showOffline }}
          style={[s.ctl, showOffline && s.ctlOn]}
        >
          {showOffline ? <Eye color={C.brand} size={18} /> : <EyeSlash color={C.text} size={18} />}
        </Pressable>
      </View>

      <View style={s.legend} pointerEvents="none">
        {(Object.keys(PIN_COLOR) as PinKind[]).map((k) => (
          <View key={k} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: PIN_COLOR[k] }]} />
            <Text style={s.legendTxt}>{PIN_LABEL[k]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tech: { position: "absolute", width: TECH_SIZE, height: TECH_SIZE, borderRadius: TECH_SIZE / 2, borderWidth: 2, alignItems: "center", justifyContent: "center", zIndex: 2 },
  techTxt: { color: "#04121c", fontSize: 11, fontWeight: "800" },
  job: { position: "absolute", width: JOB_SIZE, height: JOB_SIZE, borderRadius: JOB_SIZE / 2, borderWidth: 2, zIndex: 1 },
  wrap: { flex: 1, backgroundColor: C.bg },
  // Top-left: the iPad selection card sits down the right edge.
  controls: { position: "absolute", top: S.md, left: S.md, gap: S.sm },
  ctl: { width: 40, height: 40, borderRadius: R.control, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  ctlOn: { borderColor: C.brand },
  legend: { position: "absolute", left: S.md, bottom: S.md, flexDirection: "row", flexWrap: "wrap", gap: S.sm, backgroundColor: "rgba(7,11,18,0.85)", borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { color: C.sub, fontSize: 11, fontWeight: "700" },
});
