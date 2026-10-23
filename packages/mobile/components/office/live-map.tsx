import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { ArrowsOutCardinal, Eye, EyeSlash } from "phosphor-react-native";
import { statusColor } from "./tech-row";
import { C, R, S } from "../../lib/theme";
import type { OfficeJob, OfficeTech } from "../../lib/board";
import { fitRegion, visibleJobs, visibleTechs, type PinKind } from "../../lib/map-pins";

const PIN_COLOR: Record<PinKind, string> = { unassigned: C.red, offered: C.amber, active: C.green, scheduled: C.brand };
const PIN_LABEL: Record<PinKind, string> = { unassigned: "Unassigned", offered: "Offered", active: "In the field", scheduled: "Scheduled" };

export type MapSelection = { kind: "tech" | "job"; id: string } | null;

/**
 * Everyone and everything with a position, on Apple Maps: technicians as
 * initials in a status-coloured ring, open jobs as pins coloured by who has
 * them. Positions come from the board the tab already holds, which the
 * dispatch stream's `locations` event keeps fresh. Tapping a marker selects
 * it; tapping the map clears the selection.
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
  const [showOffline, setShowOffline] = useState(false);
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

  return (
    <View style={s.wrap}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={fitRegion([...techPins, ...jobPins], office)}
        userInterfaceStyle="dark"
        showsPointsOfInterest={false}
        showsCompass={false}
        onPress={() => onSelect(null)}
        accessibilityLabel="Live map of technicians and jobs"
      >
        {jobPins.map((j) => {
          const on = selected?.kind === "job" && selected.id === j.id;
          return (
            <Marker
              key={`job-${j.id}`}
              coordinate={{ latitude: j.lat!, longitude: j.lng! }}
              onPress={(e) => {
                e.stopPropagation();
                onSelect({ kind: "job", id: j.id });
              }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              accessibilityLabel={`${j.customerName || j.title}, ${PIN_LABEL[j.kind]}`}
            >
              <View style={[s.pin, { borderColor: PIN_COLOR[j.kind] }, on && s.pinOn]}>
                <View style={[s.pinDot, { backgroundColor: PIN_COLOR[j.kind] }]} />
              </View>
              <View style={[s.pinTail, { borderTopColor: on ? C.text : PIN_COLOR[j.kind] }]} />
            </Marker>
          );
        })}
        {techPins.map((t) => {
          const on = selected?.kind === "tech" && selected.id === t.id;
          const color = statusColor(t.status);
          return (
            <Marker
              key={`tech-${t.id}`}
              coordinate={{ latitude: t.lat!, longitude: t.lng! }}
              onPress={(e) => {
                e.stopPropagation();
                onSelect({ kind: "tech", id: t.id });
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              zIndex={2}
              accessibilityLabel={`${t.name}, ${t.status}`}
            >
              <View style={[s.tech, { borderColor: color }, on && s.techOn, t.stale && { opacity: 0.6 }]}>
                <Text style={s.techTxt} allowFontScaling={false}>
                  {initials(t.name)}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  pin: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  pinOn: { borderColor: C.text, transform: [{ scale: 1.2 }] },
  pinDot: { width: 8, height: 8, borderRadius: 4 },
  pinTail: { alignSelf: "center", width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7, borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -2 },
  tech: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, backgroundColor: C.bg2, alignItems: "center", justifyContent: "center" },
  techOn: { borderColor: C.text, transform: [{ scale: 1.15 }] },
  techTxt: { color: C.text, fontSize: 11, fontWeight: "900" },
  // Top-left: the iPad selection card sits down the right edge.
  controls: { position: "absolute", top: S.md, left: S.md, gap: S.sm },
  ctl: { width: 40, height: 40, borderRadius: R.control, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  ctlOn: { borderColor: C.brand },
  legend: { position: "absolute", left: S.md, bottom: S.md, flexDirection: "row", flexWrap: "wrap", gap: S.sm, backgroundColor: "rgba(7,11,18,0.85)", borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { color: C.sub, fontSize: 11, fontWeight: "700" },
});
