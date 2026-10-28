#!/usr/bin/env bun
/**
 * App Store release via the App Store Connect API. Run by
 * .github/workflows/ship-ios.yml; never prompts.
 *
 *   bun scripts/asc/release.ts preflight --version 1.0.6
 *     Fails fast (before a 15-minute build) when this version can't go to
 *     the App Store: not newer than the live one, or another one is in review.
 *
 *   bun scripts/asc/release.ts submit --version 1.0.6 --build 57 [--notes "..."]
 *     Waits for Apple to finish processing that uploaded build, puts it on
 *     the App Store version (creating or reusing the draft), sets "What's
 *     New", and submits it for review. Release type is "automatically after
 *     approval", so customers get it as soon as Apple approves.
 *
 * Needs ASC_KEY_ID, ASC_ISSUER_ID, ASC_APP_ID and ASC_KEY_PATH (the .p8).
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { planVersion, whatsNew, type AscVersion } from "./lib";

const API = "https://api.appstoreconnect.apple.com/v1";

function env(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} is not set.`);
  return v;
}

function fail(msg: string): never {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// ---------------------------------------------------------------- auth --

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function token(): string {
  const key = createPrivateKey(readFileSync(env("ASC_KEY_PATH"), "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: env("ASC_KEY_ID"), typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: env("ASC_ISSUER_ID"), iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

// A fresh token per call: the processing wait outlives a 15-minute token.
async function asc(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (json?.errors ?? []).map((e: any) => e.detail ?? e.title).join("; ") || text;
    throw new Error(`App Store Connect ${method} ${path.split("?")[0]} → ${res.status}: ${detail}`);
  }
  return json;
}

// ------------------------------------------------------------ versions --

async function versions(app: string): Promise<AscVersion[]> {
  const r = await asc("GET", `/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=50&fields[appStoreVersions]=versionString,appStoreState,appVersionState`);
  return (r.data ?? []).map((d: any) => ({ id: d.id, versionString: d.attributes.versionString, state: d.attributes.appVersionState ?? d.attributes.appStoreState }));
}

async function preflight(app: string, version: string) {
  const all = await versions(app);
  const plan = planVersion(all, version);
  if (plan.kind === "blocked") fail(plan.reason);
  console.log(`App Store preflight OK: ${version} can be submitted (${plan.kind === "create" ? "new version" : "reusing the open draft"}).`);
}

// --------------------------------------------------------------- build --

async function waitForBuild(app: string, version: string, build: string): Promise<string> {
  const deadline = Date.now() + 60 * 60_000;
  const q = `/builds?filter[app]=${app}&filter[version]=${encodeURIComponent(build)}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&filter[preReleaseVersion.platform]=IOS&fields[builds]=processingState,usesNonExemptEncryption`;
  for (;;) {
    const r = await asc("GET", q);
    const b = r.data?.[0];
    const state = b?.attributes?.processingState;
    if (state === "VALID") {
      // app.json declares no non-exempt encryption; set it on the build too
      // in case Apple didn't read it, or the submission stalls on compliance.
      if (b.attributes.usesNonExemptEncryption == null)
        await asc("PATCH", `/builds/${b.id}`, { data: { type: "builds", id: b.id, attributes: { usesNonExemptEncryption: false } } });
      return b.id;
    }
    if (state === "FAILED" || state === "INVALID") fail(`Apple rejected build ${version} (${build}) while processing it (${state}). See App Store Connect → TestFlight.`);
    if (Date.now() > deadline) fail(`Build ${version} (${build}) was still processing after 60 minutes. Submit it by hand in App Store Connect once it's ready.`);
    console.log(`Waiting for Apple to process build ${version} (${build})… ${state ?? "not listed yet"}`);
    await Bun.sleep(30_000);
  }
}

// -------------------------------------------------------------- submit --

async function submit(app: string, version: string, build: string, notes: string) {
  const plan = planVersion(await versions(app), version);
  if (plan.kind === "blocked") fail(plan.reason);

  const buildId = await waitForBuild(app, version, build);

  let versionId: string;
  if (plan.kind === "create") {
    const r = await asc("POST", "/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: version, releaseType: "AFTER_APPROVAL" },
        relationships: { app: { data: { type: "apps", id: app } } },
      },
    });
    versionId = r.data.id;
    console.log(`Created App Store version ${version}.`);
  } else {
    versionId = plan.versionId;
    await asc("PATCH", `/appStoreVersions/${versionId}`, {
      data: { type: "appStoreVersions", id: versionId, attributes: { releaseType: "AFTER_APPROVAL", ...(plan.rename ? { versionString: version } : {}) } },
    });
    console.log(`Using the open App Store version draft${plan.rename ? `, renamed to ${version}` : ""}.`);
  }

  await asc("PATCH", `/appStoreVersions/${versionId}/relationships/build`, { data: { type: "builds", id: buildId } });
  console.log(`Attached build ${version} (${build}).`);

  const locs = await asc("GET", `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
  for (const l of locs.data ?? [])
    await asc("PATCH", `/appStoreVersionLocalizations/${l.id}`, { data: { type: "appStoreVersionLocalizations", id: l.id, attributes: { whatsNew: whatsNew(notes) } } });
  console.log(`Set "What's New" in ${(locs.data ?? []).length} language(s).`);

  // One open (unsubmitted) review submission per app: reuse it if there is one.
  const open = await asc("GET", `/reviewSubmissions?filter[app]=${app}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=5`);
  let subId: string = open.data?.[0]?.id;
  if (!subId) {
    const r = await asc("POST", "/reviewSubmissions", {
      data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app } } } },
    });
    subId = r.data.id;
  }
  try {
    await asc("POST", "/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: subId } }, appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
      },
    });
  } catch (e) {
    // Already in this submission from an earlier, interrupted run.
    if (!/already|409/i.test((e as Error).message)) throw e;
  }
  await asc("PATCH", `/reviewSubmissions/${subId}`, { data: { type: "reviewSubmissions", id: subId, attributes: { submitted: true } } });
  console.log(`Submitted ${version} (${build}) for App Store review. It goes live automatically once Apple approves it.`);
}

// ---------------------------------------------------------------- main --

const cmd = process.argv[2];
const version = arg("version") ?? fail("--version is required.");
const app = env("ASC_APP_ID");
try {
  if (cmd === "preflight") await preflight(app, version);
  else if (cmd === "submit") await submit(app, version, arg("build") ?? fail("--build is required."), arg("notes") ?? "");
  else fail(`Unknown command "${cmd}". Use preflight or submit.`);
} catch (e) {
  fail((e as Error).message);
}
