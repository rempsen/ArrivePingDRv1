/**
 * MOBILE RELEASE — one-click iOS → TestFlight for NVC360 staff.
 *
 * Superadmin-only. Triggers the "Ship iOS to TestFlight" GitHub Actions
 * workflow (.github/workflows/ship-ios.yml) and lets the admin dashboard
 * poll its progress.
 *
 * Why GitHub Actions and not this server: production here is a trimmed
 * deployment that doesn't carry packages/mobile's source at all, and this
 * host is internet-facing — not where an Apple signing key should live.
 * GitHub Actions checks out the full repo on every run and keeps the real
 * secrets (EXPO_TOKEN, IOS_ASC_KEY_P8_BASE64) in GitHub's own secret store,
 * never on this server. This server only needs one narrow token
 * (GITHUB_ACTIONS_TOKEN, scoped to Actions: read+write on this repo only)
 * to press the button and read status back.
 */
import { Hono } from "hono";
import { requireSuperadmin } from "../middleware/auth";
import type { AppEnv } from "../env";

const OWNER = "rempsen";
const REPO = "ArrivePingDRv1";
const WORKFLOW_FILE = "ship-ios.yml";
const GH_API = "https://api.github.com";

type Step = { name: string; status: string; conclusion: string | null };

// Not clustered — fine for a single-admin, occasional-use button. Tracks the
// most recent dispatch so /status can tell which workflow run is "ours" even
// though the dispatch API itself doesn't hand back a run id.
let lastDispatchAt: number | null = null;
let lastDispatchBy: string | null = null;

function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) throw new Error("GITHUB_ACTIONS_TOKEN is not set on the server.");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Runs that haven't finished: queued, waiting, or building. */
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

/** The workflow's run that is still going, if any. */
export async function activeShipRun(headers: Record<string, string>): Promise<{ created_at: string; html_url: string } | null> {
  const data = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`, headers);
  return ((data.workflow_runs ?? []) as any[]).find((r) => ACTIVE.has(r.status)) ?? null;
}

async function gh(path: string, headers: Record<string, string>) {
  const res = await fetch(`${GH_API}${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<any>;
}

export const mobileReleaseRoutes = new Hono<AppEnv>()
  .post("/start", requireSuperadmin, async (c) => {
    let headers: Record<string, string>;
    try {
      headers = ghHeaders();
    } catch (e) {
      return c.json({ message: (e as Error).message }, 400);
    }

    // One release at a time: a second build on top of a running one ends in a
    // duplicate upload that Apple refuses.
    try {
      const busy = await activeShipRun(headers);
      if (busy)
        return c.json(
          { message: "A TestFlight release is already running. Wait for it to finish before starting another.", htmlUrl: busy.html_url },
          409,
        );
    } catch (e) {
      return c.json({ message: `Couldn't check for a release in progress: ${(e as Error).message}` }, 502);
    }

    const user = c.get("user");
    const res = await fetch(`${GH_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { requestedBy: user?.email ?? "unknown" } }),
    });
    if (!res.ok) {
      return c.json({ message: `GitHub rejected the trigger (${res.status}): ${await res.text()}` }, 502);
    }

    lastDispatchAt = Date.now();
    lastDispatchBy = user?.email ?? null;
    return c.json({ ok: true }, 200);
  })

  .get("/status", requireSuperadmin, async (c) => {
    let headers: Record<string, string>;
    try {
      headers = ghHeaders();
    } catch (e) {
      return c.json({ message: (e as Error).message }, 400);
    }

    if (!lastDispatchAt) {
      return c.json(
        { status: "idle", steps: [] as Step[], startedAt: null, finishedAt: null, startedBy: null, htmlUrl: null },
        200,
      );
    }

    try {
      const runsData = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`, headers);
      const runs: any[] = runsData.workflow_runs ?? [];
      // GitHub's dispatch API doesn't return a run id, so match by timing:
      // the newest run created at/after our dispatch (with slack for queueing).
      // Until GitHub lists the new run (a few seconds), report "running" rather
      // than the previous run's result, so the button stays disabled.
      const ours = runs.find((r) => new Date(r.created_at).getTime() >= lastDispatchAt! - 15_000);
      const run = ours ?? (Date.now() - lastDispatchAt < 120_000 ? null : runs[0] ?? null);

      if (!run) {
        return c.json(
          { status: "running", steps: [] as Step[], startedAt: lastDispatchAt, finishedAt: null, startedBy: lastDispatchBy, htmlUrl: null },
          200,
        );
      }

      let steps: Step[] = [];
      try {
        const jobsData = await gh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs`, headers);
        const job = jobsData.jobs?.[0];
        if (job) steps = job.steps.map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion }));
      } catch {
        // Steps are a nice-to-have; a run with no step detail yet is still reportable.
      }

      const status = run.status !== "completed" ? "running" : run.conclusion === "success" ? "success" : "failed";

      return c.json(
        {
          status,
          steps,
          startedAt: new Date(run.run_started_at ?? run.created_at).getTime(),
          finishedAt: run.status === "completed" ? new Date(run.updated_at).getTime() : null,
          startedBy: lastDispatchBy,
          htmlUrl: run.html_url as string,
        },
        200,
      );
    } catch (e) {
      return c.json({ message: (e as Error).message }, 502);
    }
  });
