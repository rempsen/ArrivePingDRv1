import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api } from "./api";
import { tokenState, upgradeKeychainForBackground } from "./auth";
import { activeCompanyState } from "./active-company";
import { noteBackgroundLocationAnswer, okToAskForBackgroundLocation } from "./location-disclosure";
import { Sentry } from "./sentry";

/**
 * Continuously reports the driver's live GPS location to the backend
 * (PATCH /api/riders/me { lat, lng, fixAt }) so the dispatch-map pin always
 * reflects the technician's real position — even when the phone is locked or
 * the app is backgrounded.
 *
 * GATING (important — this is what keeps the app from running in the
 * background when the tech never asked it to): native background location
 * tracking is only started while the rider is explicitly on shift
 * (`enabled` === true, driven by rider.status !== "offline"). It is NOT
 * enough to just have a signed-in session — a stored session survives every
 * app relaunch (including a HEADLESS background relaunch iOS performs for an
 * app with UIBackgroundModes:["location"]), so starting tracking merely
 * because a session exists means the app can be silently woken by the OS
 * forever, even for a tech who is off duty and never opened the app that day.
 * `enabled` must reflect an explicit user action (going on shift), not mere
 * auth state.
 *
 * Two layers, both start/stop together based on `enabled`:
 *  1. Background task (expo-task-manager + Location.startLocationUpdatesAsync)
 *     keeps reporting when the app is not in the foreground. iOS requires the
 *     "Always" location permission + UIBackgroundModes:location for this.
 *  2. Foreground watcher gives tighter, more responsive updates while the tech
 *     has the app open and is looking at the map.
 *
 * SELF-HEALING (the pin froze for 40 minutes while the tech was signed in and
 * only a sign-out/in moved it): nothing here may need a shift toggle to come
 * back. Every keepalive tick checks that tracking is actually running and
 * restarts whatever stopped — the foreground watcher, the background task —
 * and takes a fresh fix when none has gone out for a while. Two ways it used
 * to die for good while `enabled` stayed true:
 *  - The foreground watcher was only restarted on "app became active" if a
 *    flag set from the BACKGROUND permission result was true. With "While
 *    Using" permission, an app opened behind Face ID or a permission prompt
 *    (so not yet "active" when tracking started) never started its watcher.
 *  - The background task read the session from a Keychain item locked
 *    phones can't read, took the tech for signed out and stopped itself.
 *    See lib/keychain.ts.
 *
 * Presence: the app also sends a heartbeat (no GPS) so the server knows it is
 * alive; that stamps lastSeenAt only, never the location's age — a phone can
 * be online with an old position, and the map says so.
 *
 * Per-job ETA pings still happen separately inside the job screen while enroute.
 */

const BG_TASK = "nvc-location-heartbeat";

/** How often the keepalive checks in (and checks that tracking still runs). */
const KEEPALIVE_MS = 60_000;
/** No fix sent for this long while tracking should be running → take one now. */
const FIX_OVERDUE_MS = 2 * 60_000;
/** Still none after this long → restart the foreground watcher too, and tell Sentry once. */
const WATCHER_STALL_MS = 5 * 60_000;

/**
 * Guards a promise with a hard timeout. Critical for anything awaited inside
 * the native background-location task callback: iOS keeps this whole app
 * process alive (not suspended) while UIBackgroundModes:["location"] is
 * active, and a hung network call with no timeout can tie up that execution
 * indefinitely — a well-known cause of the OS watchdog silently killing an
 * app in the background (0x8badf00d-style termination). These terminations
 * happen at the OS level, outside the JS/native exception handlers Sentry
 * hooks into, so they show up to the user as "app quit unexpectedly" with
 * NO corresponding Sentry event — exactly the pattern this fixes. Also used on
 * one-shot GPS fixes, which can take a very long time to resolve indoors.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** Shared throttle so background + foreground don't double-spam the API. */
let lastSent = 0;
/** When a GPS fix last reached the server (any path). Drives the self-healing. */
let lastFixSentAt = 0;
/** Sentry is told about a stalled watcher once per app run, not every minute. */
let stallReported = false;

/**
 * Can a report be sent right now, and for whom?
 *  - "signed-out": no session — stop tracking.
 *  - "wait": the Keychain refused a read (phone locked before its first
 *    unlock since starting). The session is fine; sending now would go
 *    without a token or to the home company, so skip this one and keep going.
 */
function credentials(): "ok" | "signed-out" | "wait" {
  const t = tokenState();
  if (t === "missing") return "signed-out";
  if (t === "unreadable" || activeCompanyState() === "unreadable") return "wait";
  return "ok";
}

/**
 * @returns "off-duty" when the server (or a missing/rejected session) says
 * this device should not be reporting location at all, so the caller can shut
 * native tracking down. "ok" means keep going; "unknown" means we learned
 * nothing this round (throttled, offline, timed out, Keychain locked) and must
 * NOT shut down — a flaky tunnel is not a reason to stop tracking a tech who
 * is on a job.
 */
async function pushLocation(lat: number, lng: number, fixAt?: number): Promise<"ok" | "off-duty" | "unknown"> {
  const cred = credentials();
  if (cred === "signed-out") return "off-duty";
  if (cred === "wait") return "unknown";
  const now = Date.now();
  if (now - lastSent < 6_000) return "unknown"; // at most once per 6s
  lastSent = now;
  try {
    const json: { lat: number; lng: number; fixAt?: number } = { lat, lng };
    if (fixAt && Number.isFinite(fixAt)) json.fixAt = Math.round(fixAt);
    const res = await withTimeout(api.riders.me.$patch({ json }), 15_000);
    // 401/403 = session revoked or the membership was pulled. Keeping the GPS
    // running for a device the server no longer accepts is pure battery burn.
    // Cast: the typed hono client only knows the handler's own 200/404 returns.
    // 401/403 are produced by the auth middleware in front of it, so they are
    // absent from the inferred union but very much possible at runtime.
    const code = res.status as number;
    if (code === 401 || code === 403) return "off-duty";
    if (!res.ok) return "unknown";
    lastFixSentAt = Date.now();
    const body = (await res.json()) as { rider?: { status?: string; manualOffline?: boolean } | null };
    // Only the tech's OWN sign-out stops tracking. A status of "offline" the
    // server derived from a gap in check-ins (phone was locked, signal lost)
    // is cured by this very report; stopping on it froze the pin for good.
    const rider = body?.rider;
    const signedOut = rider?.manualOffline ?? rider?.status === "offline";
    return signedOut ? "off-duty" : "ok";
  } catch {
    /* offline / transient / timed out — next tick retries */
    return "unknown";
  }
}

/**
 * Send an "I'm alive" signal without requiring GPS coords and WITHOUT
 * changing shift status. Stamps lastSeenAt on the server so presence sees the
 * tech as online even before a GPS fix has arrived. It never touches the
 * location's age, and a rider who has explicitly gone Offline must stay
 * Offline; this must never flip status back to "available".
 */
async function pingOnline() {
  if (credentials() !== "ok") return;
  try {
    await withTimeout(api.riders.me.$patch({ json: { heartbeat: true } }), 15_000);
  } catch {
    /* transient / timed out — ignore */
  }
}

/**
 * One fix, now. GPS can take a long time indoors, so it is bounded; failing
 * that, a fix the phone took in the last few minutes (sent with its own time,
 * so the map shows its real age).
 */
async function fixNow(): Promise<void> {
  try {
    const loc = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 15_000);
    await pushLocation(loc.coords.latitude, loc.coords.longitude, loc.timestamp);
    return;
  } catch {
    /* fall back to a recent cached fix */
  }
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    if (last) await pushLocation(last.coords.latitude, last.coords.longitude, last.timestamp);
  } catch {
    /* nothing to send this round */
  }
}

// ---- Background task definition (module scope — required by TaskManager) ----
//
// SELF-SHUTOFF (this is what stops the app running in the background forever):
// a registered location task is owned by the OS, not by our React tree. When
// the app is force-quit or iOS relaunches it HEADLESSLY to deliver a location,
// the rider layout never mounts, so the `enabled === false` branch in
// useLocationHeartbeat never runs and nothing was left to call
// stopLocationUpdatesAsync. The task therefore cancels ITSELF — but only on a
// definite "this tech is signed out": no session, a rejected one, or their own
// sign-out. A Keychain it can't read yet, or a server that marked them offline
// for a gap in check-ins, is not that.
TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
  if (error) return;
  try {
    const cred = credentials();
    if (cred === "signed-out") {
      await stopBackgroundUpdates();
      return;
    }
    if (cred === "wait") return;
    const locs = (data as { locations?: Location.LocationObject[] })?.locations;
    const loc = locs?.[locs.length - 1];
    if (loc) {
      const verdict = await pushLocation(loc.coords.latitude, loc.coords.longitude, loc.timestamp);
      // Only shut down on a definite off-duty answer. "unknown" (offline,
      // timeout, throttled) must keep tracking alive — a tech driving through
      // a dead zone still needs to be on the dispatch map.
      if (verdict === "off-duty") await stopBackgroundUpdates();
    }
  } catch {
    // Never let an unexpected error inside the background delivery callback
    // propagate — the native side is holding a background execution slice
    // open while this runs.
  }
});

/** Start background delivery if "Always" is granted. Asks for permission only when `ask`. */
async function startBackgroundUpdates(ask: boolean): Promise<boolean> {
  try {
    // Android: Play requires our own disclosure before the system prompts.
    // "Not now" means don't prompt (the foreground watcher still runs if
    // foreground permission was granted earlier).
    if (ask && !(await okToAskForBackgroundLocation())) return false;
    // "Always" permission is required for background delivery.
    const fg = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (!fg.granted) {
      if (ask) noteBackgroundLocationAnswer(false);
      return false;
    }
    const bg = ask ? await Location.requestBackgroundPermissionsAsync() : await Location.getBackgroundPermissionsAsync();
    if (ask) noteBackgroundLocationAnswer(bg.granted);
    if (!bg.granted) return false;

    const already = await Location.hasStartedLocationUpdatesAsync(BG_TASK).catch(
      () => false,
    );
    if (already) return true;

    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 10_000,
      distanceInterval: 25, // meters
      pausesUpdatesAutomatically: false,
      // Keeps the OS from killing updates; shows the system location banner.
      foregroundService: {
        notificationTitle: "ArrivePing is sharing your location",
        notificationBody: "Your live location is visible to dispatch while on shift.",
        notificationColor: "#0ea5e9",
      },
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.AutomotiveNavigation,
    });
    return true;
  } catch {
    return false;
  }
}

async function stopBackgroundUpdates() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BG_TASK).catch(
      () => false,
    );
    if (started) await Location.stopLocationUpdatesAsync(BG_TASK);
  } catch {
    /* ignore */
  }
}

/**
 * @param enabled Only start native background/foreground GPS tracking while
 * this is true. Must reflect the rider's explicit on-shift/"available"
 * status (never just "is there a session") — see file header.
 */
export function useLocationHeartbeat(enabled: boolean) {
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const watcherStarting = useRef(false);
  const watcherStartedAt = useRef(0);
  const live = useRef(false); // tracking wanted (enabled and mounted)
  const keepaliveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = useRef(false);

  function stopForeground() {
    watcher.current?.remove();
    watcher.current = null;
  }

  /**
   * Start the foreground watcher if the app is in front, tracking is wanted
   * and none is running. Checks the FOREGROUND permission itself: "While
   * Using" is all a foreground watcher needs.
   */
  async function ensureWatcher() {
    if (!live.current || watcher.current || watcherStarting.current) return;
    if (AppState.currentState !== "active") return;
    watcherStarting.current = true;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 6_000, distanceInterval: 15 },
        (loc) => {
          void pushLocation(loc.coords.latitude, loc.coords.longitude, loc.timestamp);
        },
      );
      // The app left the foreground, or tracking was turned off, while this
      // was starting: don't leave a watcher running behind it.
      if (!live.current || AppState.currentState !== "active" || watcher.current) {
        sub.remove();
        return;
      }
      watcher.current = sub;
      watcherStartedAt.current = Date.now();
    } catch {
      /* the next keepalive tick tries again */
    } finally {
      watcherStarting.current = false;
    }
  }

  /** The self-healing check, every keepalive tick and on returning to the app. */
  async function heal() {
    if (!live.current) return;
    const quietFor = Date.now() - lastFixSentAt;
    if (AppState.currentState === "active") {
      const watcherQuietFor = Date.now() - Math.max(lastFixSentAt, watcherStartedAt.current);
      if (watcherQuietFor > WATCHER_STALL_MS && watcher.current) {
        // A watcher that has sent nothing for this long has stalled: replace it.
        stopForeground();
        if (!stallReported) {
          stallReported = true;
          Sentry.captureMessage("Location watcher stalled; restarted", {
            level: "warning",
            extra: { quietForMs: watcherQuietFor },
          });
        }
      }
      await ensureWatcher();
    } else {
      // Running in the background (only possible with "Always"): make sure
      // the background task is still registered.
      await startBackgroundUpdates(false);
    }
    // Standing still sends nothing (the watchers report movement), but the
    // map needs a recent fix to show the position as current.
    if (quietFor > FIX_OVERDUE_MS) await fixNow();
  }

  useEffect(() => {
    let mounted = true;

    if (!enabled) {
      live.current = false;
      // Off shift (or status not yet known) — make sure nothing is running.
      // This is what actually stops the OS from ever waking the app for a
      // location event once a tech goes Offline, instead of just relying on
      // sign-out (which most techs rarely do — they stay logged in for days).
      if (running.current) {
        stopForeground();
        stopBackgroundUpdates();
        running.current = false;
      }
      if (keepaliveTimer.current) {
        clearInterval(keepaliveTimer.current);
        keepaliveTimer.current = null;
      }
      return () => {
        mounted = false;
      };
    }

    running.current = true;
    live.current = true;

    // ── Immediate online signal ──────────────────────────────────────────────
    pingOnline();
    if (AppState.currentState === "active") void upgradeKeychainForBackground();

    // ── Keepalive + self-healing ─────────────────────────────────────────────
    // Keeps lastSeenAt fresh within the 3-minute liveness window, and restarts
    // whatever part of tracking has stopped (see `heal`).
    keepaliveTimer.current = setInterval(() => {
      pingOnline();
      void heal();
    }, KEEPALIVE_MS);

    (async () => {
      // Ask for permission and start background delivery (handles the
      // locked-phone case), then the tighter foreground watcher if the app is
      // in front. If it isn't yet (opened behind Face ID or a permission
      // prompt), the "active" handler below or the next keepalive starts it.
      await startBackgroundUpdates(true);
      if (!mounted || !live.current) return;
      await ensureWatcher();
      if (AppState.currentState === "active") {
        lastSent = 0;
        await fixNow();
      }
    })();

    // Foreground watcher vs. background task, on AppState change:
    //  - going to background/inactive: stop the tighter foreground watcher.
    //    The native background task (started above) is what's designed to
    //    keep reporting location while backgrounded/locked — running BOTH
    //    simultaneously is redundant work for no benefit.
    //  - returning to foreground: start the watcher (whatever the background
    //    permission is) and send a fresh fix right away.
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") {
        pingOnline();
        void upgradeKeychainForBackground();
        lastSent = 0; // the fix below goes out immediately
        void ensureWatcher();
        void fixNow();
        void startBackgroundUpdates(false);
      } else {
        stopForeground();
      }
    });

    return () => {
      mounted = false;
      live.current = false;
      stopForeground();
      if (keepaliveTimer.current) {
        clearInterval(keepaliveTimer.current);
        keepaliveTimer.current = null;
      }
      sub.remove();
      // NOTE: background native updates are intentionally left running across
      // this effect's own cleanup (e.g. component re-render) — they are only
      // ever stopped by the `enabled === false` branch above (shift toggled
      // off) or by stopLocationSharing() on sign-out.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Stop all location sharing — call on logout or when the tech goes offline. */
export async function stopLocationSharing() {
  await stopBackgroundUpdates();
}
