/**
 * MOBILE RELEASE — one-click iOS → TestFlight for NVC360 staff.
 *
 * Superadmin-only. Runs `packages/mobile/scripts/ship-ios-ci.sh` in the
 * background (EAS build on Expo's servers, then submit to App Store
 * Connect) and lets the admin dashboard poll its progress.
 *
 * This process is NOT clustered — state lives in module scope. If the web
 * server restarts mid-release, the in-process EAS CLI invocation dies, but
 * the actual build on Expo's infra is unaffected; the admin can just open
 * expo.dev to check that build and re-run submit manually if needed.
 *
 * Secrets:
 *  - EXPO_TOKEN: a non-interactive Expo access token (expo.dev → account →
 *    settings → Access Tokens). Required.
 *  - IOS_ASC_KEY_P8_BASE64: the App Store Connect API key (AuthKey.p8),
 *    base64-encoded. Decoded to packages/mobile/keys/AuthKey.p8 on first use
 *    if that file isn't already on disk. Required unless the key file is
 *    already present some other way.
 */
import { Hono } from "hono";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireSuperadmin } from "../middleware/auth";
import type { AppEnv } from "../env";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/web/src/api/routes -> repo root -> packages/mobile
const MOBILE_DIR = join(__dirname, "../../../../mobile");
const KEY_PATH = join(MOBILE_DIR, "keys", "AuthKey.p8");
const LOG_DIR = join(MOBILE_DIR, ".release-logs");
const LOG_PATH = join(LOG_DIR, "latest.log");

type Status = "idle" | "running" | "success" | "failed";

const state: {
  status: Status;
  startedAt: number | null;
  finishedAt: number | null;
  startedBy: string | null;
  exitCode: number | null;
} = { status: "idle", startedAt: null, finishedAt: null, startedBy: null, exitCode: null };

/** Writes keys/AuthKey.p8 from the base64 secret if the file isn't already there. */
function ensureKeyFile(): string | null {
  if (existsSync(KEY_PATH)) return null;
  const b64 = process.env.IOS_ASC_KEY_P8_BASE64;
  if (!b64) return "Missing keys/AuthKey.p8 and IOS_ASC_KEY_P8_BASE64 is not set.";
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, Buffer.from(b64, "base64"), { mode: 0o600 });
  return null;
}

function tailLog(maxBytes = 20_000): string {
  if (!existsSync(LOG_PATH)) return "";
  const buf = readFileSync(LOG_PATH);
  return buf.length > maxBytes ? "…\n" + buf.subarray(buf.length - maxBytes).toString("utf8") : buf.toString("utf8");
}

export const mobileReleaseRoutes = new Hono<AppEnv>()
  .get("/status", requireSuperadmin, (c) => {
    return c.json({ ...state, log: tailLog() }, 200);
  })

  .post("/start", requireSuperadmin, async (c) => {
    if (state.status === "running") {
      return c.json({ message: "A release is already running." }, 409);
    }

    const keyError = ensureKeyFile();
    if (keyError) return c.json({ message: keyError }, 400);
    if (!process.env.EXPO_TOKEN) {
      return c.json({ message: "EXPO_TOKEN is not set on the server." }, 400);
    }

    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(LOG_PATH, `== started ${new Date().toISOString()} ==\n`);

    const user = c.get("user");
    state.status = "running";
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.startedBy = user?.email ?? null;
    state.exitCode = null;

    const outFd = openSync(LOG_PATH, "a");
    const child = spawn("bash", ["scripts/ship-ios-ci.sh"], {
      cwd: MOBILE_DIR,
      env: process.env,
      stdio: ["ignore", outFd, outFd],
      detached: true,
    });
    child.unref();
    closeSync(outFd);

    child.on("exit", (code) => {
      state.status = code === 0 ? "success" : "failed";
      state.finishedAt = Date.now();
      state.exitCode = code;
    });

    return c.json({ ok: true }, 200);
  });
