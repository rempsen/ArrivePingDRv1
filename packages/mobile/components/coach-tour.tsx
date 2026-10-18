import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { getActiveCompany } from "../lib/active-company";
import { C, R } from "../lib/theme";

/**
 * Technician coach marks (blueprint 2026-10-17, Phase 5).
 *
 * Four tips, one per screen, shown once to a new technician after the
 * permissions primer: their jobs, the "On the clock" switch, "Start Driving"
 * on their practice job, and Messages. Each tip dims the screen around one
 * real control and says what it does in two short lines. "Skip tour" ends it
 * at any step; Profile → "Show me around again" replays it.
 *
 * Built without a tour library on purpose: it's plain React Native (Modal,
 * measureInWindow), so it needs no native module, ships over the air, and runs
 * the same on iPhone, iPad, Android and the web build used for testing.
 *
 * Seen-state, per technician per company (a shared phone or a technician on
 * two rosters gets the tour once for each): `tours["tech-app"]` on the
 * membership (PATCH /api/me/onboarding), checked first, plus a SecureStore
 * flag keyed by user and company for when the server can't be reached.
 */
const SEEN_PREFIX = "tour_seen_v1";
const TOUR_ID = "tech-app";
const MISSING_ANCHOR_MS = 4000;
/** A job is ready for the "Start Driving" tip only while that's its next action. */
const DRIVABLE = "assigned";

type AnchorId = "jobs.list" | "profile.clock" | "job.primary" | "messages.header";

interface Step {
  id: "jobs" | "clock" | "drive" | "messages";
  /** Omitted: a centred tip with no spotlight. */
  anchor?: AnchorId;
  /** Omitted: stay on the current screen. */
  route?: string;
  title: string;
  body: string;
}

/** Where the "Start Driving" tip points: the practice job, one of their own jobs, or nowhere. */
type DriveTarget = { id: string; practice: boolean } | null;

function buildSteps(drive: DriveTarget): Step[] {
  return [
    {
      id: "jobs",
      anchor: "jobs.list",
      route: "/(rider)",
      title: "Your jobs land here",
      body: "New offers show up at the top with Accept and Decline. Tap a job to open it.",
    },
    {
      id: "clock",
      anchor: "profile.clock",
      route: "/(rider)/profile",
      title: "Go on the clock",
      body: "Turn this on when you start work. You get offers, and the office sees where you are, only while it's on.",
    },
    drive
      ? {
          id: "drive",
          anchor: "job.primary",
          route: `/job/${drive.id}`,
          title: "Tap when you leave",
          body: drive.practice
            ? "Start Driving texts the customer a live tracking link. This is your practice job, so nobody is texted."
            : "Start Driving texts the customer a live tracking link, so tap it as you head out.",
        }
      : {
          id: "drive",
          title: "Tap Start Driving when you leave",
          body: "Open a job and tap Start Driving as you head out. The customer gets a text with a live tracking link.",
        },
    {
      id: "messages",
      anchor: "messages.header",
      route: "/(rider)/messages",
      title: "Talk to the office",
      body: drive?.practice
        ? "Dispatch messages you here. Your practice job is on the Jobs tab whenever you want to try it."
        : "Dispatch messages you here, and you can reply from this screen.",
    },
  ];
}

/** SecureStore keys allow letters, digits, ".", "-" and "_" only. */
function seenKey(userId: string): string {
  const clean = (v: string) => v.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${SEEN_PREFIX}.${clean(userId)}.${clean(getActiveCompany() || "home")}`;
}
/**
 * What this phone remembers: how the tour ended ("completed" / "skipped"), so
 * an offline finish can be reported to the server as it really happened, or
 * "not-needed" for an experienced technician (nothing to report).
 */
type SeenState = "completed" | "skipped" | "not-needed";
async function readSeen(key: string): Promise<SeenState | null> {
  try {
    const v = Platform.OS === "web" ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
    if (v === "completed" || v === "skipped" || v === "not-needed") return v;
    return v === "1" ? "completed" : null; // the first build stored "1"
  } catch {
    return null;
  }
}
async function writeSeen(key: string, state: SeenState) {
  try {
    if (Platform.OS === "web") localStorage.setItem(key, state);
    else await SecureStore.setItemAsync(key, state);
  } catch {
    /* best effort: the server copy still stops a repeat */
  }
}

/** The practice job if it's still waiting for Start Driving, else one of their own that is. */
async function findDriveTarget(practiceJobId: string | null): Promise<DriveTarget> {
  if (practiceJobId) {
    try {
      const res = await api.bookings[":id"].$get({ param: { id: practiceJobId } });
      if (res.ok) {
        const b = (await res.json()).booking as { status?: string } | null;
        if (b?.status === DRIVABLE) return { id: practiceJobId, practice: true };
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const res = await api.bookings.$get();
    if (res.ok) {
      const list = ((await res.json()) as { bookings: { id: string; status: string; assignStatus?: string; isSample?: boolean }[] }).bookings;
      // Real jobs only: a sample-day job never texts anyone, so it would teach the wrong thing.
      const j = list.find((b) => !b.isSample && b.assignStatus === "accepted" && b.status === DRIVABLE);
      if (j) return { id: j.id, practice: false };
    }
  } catch {
    /* no target: the tip is shown without a spotlight */
  }
  return null;
}

type Rect = { x: number; y: number; w: number; h: number };
interface Run {
  steps: Step[];
  i: number;
  /** The seen-flag key this run records (user + company). */
  key: string;
}

interface CoachApi {
  register: (id: AnchorId, node: View | null) => void;
  /** First run: shows the tour if this technician hasn't seen it at this company. */
  maybeStart: (userId: string) => void;
  /** Profile → "Show me around again". */
  replay: (userId: string) => void;
  /** Leaving the technician screens (sign-out, company switch): close it without recording anything. */
  cancel: () => void;
  active: boolean;
}

const CoachCtx = createContext<CoachApi | null>(null);

export function useCoach(): CoachApi {
  return (
    useContext(CoachCtx) ?? {
      register: () => {},
      maybeStart: () => {},
      replay: () => {},
      cancel: () => {},
      active: false,
    }
  );
}

/** Wrap the control a tip points at. Renders a plain View, so layout is unchanged. */
export function CoachAnchor({ id, children, style }: { id: AnchorId; children: ReactNode; style?: object }) {
  const { register } = useCoach();
  const ref = useRef<View>(null);
  useEffect(() => {
    register(id, ref.current);
    return () => register(id, null);
  }, [id, register]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}

export function CoachProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const anchors = useRef(new Map<AnchorId, View>());
  const [run, setRun] = useState<Run | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  /** user + company the first-run check has already run for. */
  const startedKeyRef = useRef<string | null>(null);
  /**
   * Bumped by cancel() and by every new start. A start still waiting on the
   * network when the person signs out or switches company finds the number
   * changed and doesn't open, so a stale tour can't appear over sign-in or
   * under another company.
   */
  const genRef = useRef(0);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  const runRef = useRef(run);
  runRef.current = run;

  const register = useCallback((id: AnchorId, node: View | null) => {
    if (node) anchors.current.set(id, node);
    else anchors.current.delete(id);
  }, []);

  const finish = useCallback(
    (status: "completed" | "skipped") => {
      const key = runRef.current?.key;
      setRun(null);
      setRect(null);
      if (key) void writeSeen(key, status);
      api.me.onboarding
        .$patch({ json: { tours: { [TOUR_ID]: { status, at: new Date().toISOString() } } } })
        .catch(() => {});
      router.navigate("/(rider)");
    },
    [router],
  );

  const go = useCallback(
    (delta: 1 | -1) => {
      const r = runRef.current;
      if (!r) return;
      const i = r.i + delta;
      if (i < 0) return;
      if (i >= r.steps.length) return finish("completed");
      setRun({ ...r, i });
    },
    [finish],
  );

  const begin = useCallback(
    async (key: string, replay: boolean, gen: number) => {
      const stale = () => gen !== genRef.current;
      let practiceJobId: string | null = null;
      try {
        const res = await api.me["practice-job"].$post();
        const out = (await res.json()) as { jobId: string | null; reason?: string };
        practiceJobId = out.jobId;
        // A technician who has already done real work here doesn't need the
        // first-run tour; they can still replay it from Profile.
        if (!replay && !out.jobId && out.reason === "experienced") {
          if (!stale()) await writeSeen(key, "not-needed");
          return;
        }
      } catch {
        /* offline or older server: no practice job */
      }
      if (practiceJobId) await qc.invalidateQueries({ queryKey: ["bookings"] });
      // A removed or finished practice job can't show Start Driving: use one of
      // their own jobs that can, or show that tip without a spotlight.
      const drive = await findDriveTarget(practiceJobId);
      if (stale()) return;
      setRun({ steps: buildSteps(drive), i: 0, key });
    },
    [qc],
  );

  const maybeStart = useCallback(
    (userId: string) => {
      const key = seenKey(userId);
      if (startedKeyRef.current === key) return;
      startedKeyRef.current = key;
      const gen = ++genRef.current;
      const stale = () => gen !== genRef.current;
      (async () => {
        // The server decides when it can be reached (this membership's record);
        // the device flag covers being offline.
        try {
          const res = await api.me.onboarding.$get();
          if (res.ok) {
            const body = (await res.json()) as { state?: { tours?: Record<string, unknown> } };
            if (stale()) return;
            const done = body.state?.tours?.[TOUR_ID] as { status?: "completed" | "skipped" } | undefined;
            if (done) {
              await writeSeen(key, done.status === "skipped" ? "skipped" : "completed");
              return;
            }
            // Finished on this phone but the server never heard (offline at the
            // end): report it now, as it happened, instead of showing it again.
            const local = await readSeen(key);
            if (local) {
              if (local !== "not-needed")
                api.me.onboarding
                  .$patch({ json: { tours: { [TOUR_ID]: { status: local, at: new Date().toISOString() } } } })
                  .catch(() => {});
              return;
            }
            await begin(key, false, gen);
            return;
          }
        } catch {
          /* offline: fall back to the device flag */
        }
        if (stale() || (await readSeen(key))) return;
        await begin(key, false, gen);
      })();
    },
    [begin],
  );

  const replay = useCallback(
    (userId: string) => {
      void begin(seenKey(userId), true, ++genRef.current);
    },
    [begin],
  );

  const cancel = useCallback(() => {
    genRef.current++;
    setRun(null);
    setRect(null);
    // Coming back (another company, another person) checks again.
    startedKeyRef.current = null;
  }, []);

  // Each step: go to its screen, then find the control (it may still be loading).
  const step = run ? run.steps[run.i] : null;
  useEffect(() => {
    if (!run || !step) return;
    setRect(null);
    if (step.route) router.navigate(step.route as never);
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      if (cancelled) return;
      if (Date.now() - startedAt > MISSING_ANCHOR_MS) {
        // Never strand anyone on a tip whose control isn't there: show it
        // without a spotlight instead.
        setRect({ x: 0, y: 0, w: 0, h: 0 });
        return;
      }
      timer = setTimeout(measure, 150);
    };
    const measure = () => {
      if (cancelled) return;
      if (!step.anchor) return setRect({ x: 0, y: 0, w: 0, h: 0 });
      const node = anchors.current.get(step.anchor);
      if (!node) return retry();
      node.measureInWindow((x, y, w, h) => {
        if (cancelled) return;
        if (w > 0 && h > 0 && y < height && y + h > 0) setRect({ x, y, w, h });
        else retry();
      });
    };
    timer = setTimeout(measure, 350);
    AccessibilityInfo.announceForAccessibility?.(`Tip ${run.i + 1} of ${run.steps.length}. ${step.title}. ${step.body}`);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-measure when the screen rotates (iPad) or resizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.i, run?.steps, width, height]);

  const api_ = useMemo<CoachApi>(
    () => ({ register, maybeStart, replay, cancel, active: Boolean(run) }),
    [register, maybeStart, replay, cancel, run],
  );

  return (
    <CoachCtx.Provider value={api_}>
      {children}
      <Modal
        visible={Boolean(run && step)}
        transparent
        animationType={reduceMotion ? "none" : "fade"}
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => finish("skipped")}
      >
        {run && step && !rect && <View style={[st.dim, StyleSheet.absoluteFill]} />}
        {run && step && rect && (
          <Overlay
            rect={rect}
            width={width}
            height={height}
            cardH={cardH}
            onCardLayout={(e) => setCardH(e.nativeEvent.layout.height)}
            n={run.i + 1}
            total={run.steps.length}
            title={step.title}
            body={step.body}
            onNext={() => {
              Haptics.selectionAsync().catch(() => {});
              go(1);
            }}
            onBack={run.i > 0 ? () => go(-1) : undefined}
            onSkip={() => finish("skipped")}
          />
        )}
      </Modal>
    </CoachCtx.Provider>
  );
}

const PAD = 6;
const GAP = 14;
const EDGE = 16;
const DIM = "rgba(3,7,14,0.78)";

function Overlay({
  rect,
  width,
  height,
  cardH,
  onCardLayout,
  n,
  total,
  title,
  body,
  onNext,
  onBack,
  onSkip,
}: {
  rect: Rect;
  width: number;
  height: number;
  cardH: number;
  onCardLayout: (e: LayoutChangeEvent) => void;
  n: number;
  total: number;
  title: string;
  body: string;
  onNext: () => void;
  onBack?: () => void;
  onSkip: () => void;
}) {
  const spot = rect.w > 0 && rect.h > 0;
  const hole = spot
    ? {
        x: Math.max(0, rect.x - PAD),
        y: Math.max(0, rect.y - PAD),
        w: Math.min(width, rect.w + PAD * 2),
        h: rect.h + PAD * 2,
      }
    : null;
  const cardW = Math.min(360, width - EDGE * 2);
  const estH = cardH || 190;

  // Below the control if it fits, else above it, else centred.
  let pos: { left: number; top?: number; bottom?: number };
  if (!hole) {
    pos = { left: (width - cardW) / 2, top: Math.max(EDGE, (height - estH) / 2) };
  } else {
    const left = Math.min(Math.max(EDGE, hole.x + hole.w / 2 - cardW / 2), width - cardW - EDGE);
    const below = hole.y + hole.h + GAP;
    if (below + estH <= height - EDGE) pos = { left, top: below };
    else if (hole.y - GAP - estH >= EDGE) pos = { left, bottom: height - hole.y + GAP };
    else pos = { left, top: Math.max(EDGE, height - estH - EDGE * 2) };
  }
  const last = n === total;

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      {hole ? (
        <>
          <View style={[st.dim, { left: 0, top: 0, width, height: hole.y }]} />
          <View style={[st.dim, { left: 0, top: hole.y + hole.h, width, height: Math.max(0, height - hole.y - hole.h) }]} />
          <View style={[st.dim, { left: 0, top: hole.y, width: hole.x, height: hole.h }]} />
          <View style={[st.dim, { left: hole.x + hole.w, top: hole.y, width: Math.max(0, width - hole.x - hole.w), height: hole.h }]} />
          <View pointerEvents="none" testID="coach-ring" style={[st.ring, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]} />
        </>
      ) : (
        <View style={[st.dim, StyleSheet.absoluteFill]} />
      )}

      <View style={[st.card, { width: cardW }, pos]} onLayout={onCardLayout} testID="coach-card">
        <Text style={st.count} accessibilityLabel={`Tip ${n} of ${total}`}>
          {n} of {total}
        </Text>
        <Text style={st.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={st.body}>{body}</Text>
        <View style={st.progress} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: total }, (_, k) => (
            <View key={k} style={[st.dot, k < n && st.dotOn]} />
          ))}
        </View>
        <View style={st.row}>
          <Pressable onPress={onSkip} hitSlop={8} accessibilityRole="button" accessibilityLabel="Skip tour" style={st.ghost}>
            <Text style={st.ghostTxt}>Skip tour</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {onBack && (
            <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={st.ghost}>
              <Text style={st.ghostTxt}>Back</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel={last ? "Done" : "Next tip"}
            style={({ pressed }) => [st.next, pressed && { opacity: 0.85 }]}
          >
            <Text style={st.nextTxt}>{last ? "Done" : "Next"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: DIM },
  ring: { position: "absolute", borderRadius: R.card, borderWidth: 2, borderColor: C.brand },
  card: {
    position: "absolute",
    backgroundColor: C.bg3,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.borderHi,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  count: { color: C.brand, fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 4 },
  title: { color: C.text, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  body: { color: C.sub, fontSize: 14, lineHeight: 20 },
  progress: { flexDirection: "row", gap: 6, marginTop: 14 },
  dot: { width: 18, height: 4, borderRadius: R.pill, backgroundColor: C.border },
  dotOn: { backgroundColor: C.brand },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  ghost: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10 },
  ghostTxt: { color: C.sub, fontSize: 14, fontWeight: "700" },
  next: { minHeight: 44, minWidth: 88, borderRadius: R.control, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  nextTxt: { color: "#04121c", fontSize: 15, fontWeight: "800" },
});
