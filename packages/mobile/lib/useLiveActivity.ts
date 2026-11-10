/**
 * useLiveActivity — ArrivePing Driver Live Activity / Dynamic Island integration
 *
 * Manages a single iOS Live Activity for the current active job.
 * - Starts when driver accepts (assigned) or begins driving (enroute)
 * - Updates on each status change and GPS ping
 * - Ends when job is completed or cancelled
 * - Push token is sent to server so backend can update via APNs
 *
 * Safe on Android / older iOS (all calls are no-ops there).
 *
 * ── Why we end activities by asking the system ────────────────────────────────
 * iOS Live Activities are owned by the SYSTEM, not by the app process. Once
 * started, the pill stays on the Lock Screen / Dynamic Island until the app
 * explicitly ends it (or up to 8h/12h later when iOS reaps it). Killing the
 * app does NOT remove it.
 *
 * Earlier versions held the activity id only in a `useRef` inside the job
 * screen, so once it unmounted — navigating back, signing out, the app being
 * closed — a driver with no jobs left still had an ArrivePing activity in the
 * Dynamic Island. We now use expo-widgets' `getInstances()` to enumerate the
 * activities iOS is actually showing, so `endAllLiveActivities()` works from
 * anywhere, including a fresh cold start of a process that never started them.
 *
 * The widget UI lives in ./live-activity-widget.tsx. The server pushes the
 * same props shape (`LiveActivityProps`) from packages/web/src/services/apns.ts.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import type { LiveActivityProps } from "./live-activity-widget";

// Lazy import so the Android bundle doesn't pull in the iOS-only native module.
type WidgetsModule = typeof import("expo-widgets");
type Activity = ReturnType<typeof import("./live-activity-widget").arrivePingActivity.start>;
let widgets: WidgetsModule | null = null;
let factory: (typeof import("./live-activity-widget"))["arrivePingActivity"] | null = null;
try {
  if (Platform.OS === "ios") {
    widgets = require("expo-widgets");
    factory = require("./live-activity-widget").arrivePingActivity;
  }
} catch {}

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

export interface LiveActivityJobState {
  jobId: string;
  clientName: string;
  address: string;
  status: string;
  etaMins?: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  assigned:    "Job assigned",
  enroute:     "Tech is on the way",
  arrived:     "Tech has arrived",
  in_progress: "Job in progress",
  completed:   "Job complete",
};

function buildProps(job: LiveActivityJobState): LiveActivityProps {
  const done = job.status === "completed";
  return {
    title: STATUS_LABELS[job.status] ?? job.status,
    subtitle: job.clientName ? `${job.clientName} · ${job.address}` : job.address,
    etaEndMs: job.etaMins != null && job.etaMins > 0 ? Date.now() + job.etaMins * 60 * 1000 : undefined,
    progress: done ? 1 : 0.5,
    done,
  };
}

/** Tapping the activity / Dynamic Island deep-links straight into the active job. */
function deepLink(jobId: string): string {
  return `arriveping:///job/${jobId}`;
}

/**
 * Ends every Live Activity iOS is currently showing for this app.
 *
 * Call it whenever the driver should have NOTHING on screen from us:
 * sign-out, going off shift, no active job left, or a cold start that finds
 * no session. Safe to call repeatedly and on Android (no-op).
 */
export async function endAllLiveActivities(): Promise<void> {
  if (!factory) return;
  let instances: Activity[] = [];
  try {
    instances = factory.getInstances();
  } catch {
    return;
  }
  for (const activity of instances) {
    try {
      await activity.end("immediate");
    } catch {
      /* already gone / unsupported */
    }
  }
}

/** POST push token to server so backend can send APNs Live Activity updates */
async function sendTokenToServer(jobId: string, token: string, type: "update" | "start") {
  try {
    await fetch(`${API}/api/tracking/${jobId}/live-activity-token`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, type }),
    });
  } catch {
    // non-critical — local updates still work
  }
}

export function useLiveActivity(job: LiveActivityJobState | null | undefined) {
  const activityRef = useRef<Activity | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const tokenSubRef = useRef<{ remove(): void } | null>(null);

  function endCurrent(finalState?: LiveActivityJobState) {
    const activity = activityRef.current;
    if (!activity) return;
    activityRef.current = null;
    prevStatusRef.current = null;
    tokenSubRef.current?.remove();
    tokenSubRef.current = null;
    activity
      .end("default", finalState ? buildProps(finalState) : { title: "Job closed", subtitle: "", progress: 1, done: true })
      .catch(() => {
        /* already gone */
      });
  }

  // Push-to-start token: lets the server start the activity remotely via APNs.
  useEffect(() => {
    if (!widgets || !job) return;
    const sub = widgets.addPushToStartTokenListener?.((ev) => {
      if (job.jobId && ev.activityPushToStartToken) {
        sendTokenToServer(job.jobId, ev.activityPushToStartToken, "start");
      }
    });
    return () => sub?.remove?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.jobId]);

  // Start / update / stop activity based on job status changes
  useEffect(() => {
    if (!factory) return;

    // No job in scope any more (job cleared, data gone, driver navigated away
    // from a job that no longer exists): end whatever we started, so the pill
    // never outlives the job.
    if (!job) {
      endCurrent();
      return;
    }

    const { status } = job;
    const ACTIVE = ["assigned", "enroute", "arrived", "in_progress"];
    const isActive = ACTIVE.includes(status);

    // Start activity when job becomes active and no activity is running
    if (isActive && !activityRef.current) {
      try {
        const activity = factory.start(buildProps(job), deepLink(job.jobId));
        activityRef.current = activity;
        prevStatusRef.current = status;
        // Per-activity token so the server can push updates via APNs.
        const jobId = job.jobId;
        tokenSubRef.current = activity.addPushTokenListener((ev) => sendTokenToServer(jobId, ev.pushToken, "update"));
        activity.getPushToken().then((t) => { if (t) void sendTokenToServer(jobId, t, "update"); }).catch(() => {});
      } catch {
        // Live Activities not supported (simulator, old iOS, etc.)
      }
      return;
    }

    // Update if status changed or ETA changed
    if (activityRef.current && isActive && status !== prevStatusRef.current) {
      activityRef.current.update(buildProps(job)).catch(() => {});
      prevStatusRef.current = status;
      return;
    }

    // End activity on completion/cancellation
    if (activityRef.current && !isActive) {
      endCurrent(job);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.etaMins, job?.jobId, !job]);

  // Leaving the job screen must not leave a pill behind with no owner. The job
  // screen is only mounted while the tech is actually working that job; the
  // server can restart the activity via APNs push-to-start if needed.
  useEffect(() => {
    return () => {
      endCurrent();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Call this on each GPS ping to update ETA countdown in real time */
  function updateEta(etaMins: number) {
    if (!activityRef.current || !job) return;
    activityRef.current.update(buildProps({ ...job, etaMins })).catch(() => {});
  }

  return { updateEta };
}
