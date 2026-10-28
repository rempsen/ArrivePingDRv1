import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { getActiveCompany, upgradeActiveCompanyKeychain } from "./active-company";
import { backgroundKeychain } from "./keychain";

const isWeb = Platform.OS === "web";
const TOKEN_KEY = "bearer_token";
/** The session token, readable by the background location task on a locked phone (lib/keychain.ts). */
const tokenStore = backgroundKeychain(TOKEN_KEY);

export type Role =
  | "customer"
  | "rider"
  | "admin"
  | "manager"
  | "dispatcher"
  | "project_manager";

const baseURL =
  (Constants.expoConfig?.extra?.apiUrl as string) ??
  process.env.EXPO_PUBLIC_API_URL;

// BUG (root cause of a real production crash): `isWeb` was defined but never
// used to gate the fallback path below — `localStorage` doesn't exist at all
// in the React Native/Hermes runtime (it's a browser-only global). On native,
// SecureStore's Keychain-backed calls CAN throw — most commonly when a
// background task (e.g. the location heartbeat) tries to read the token while
// the device is locked, since Keychain items stored with the default
// "when-unlocked" accessibility reject reads from a locked device. That threw
// a normal, catchable Error — but the `catch` block then called
// `localStorage.getItem(...)`, which throws its OWN uncaught
// `ReferenceError: localStorage is not defined` (nothing wraps the catch body
// itself). That second exception propagated all the way up through
// getToken() -> pushLocation() -> the native background-location task
// callback with no further try/catch above it, which is exactly what
// escalates to RN's fatal-JS-exception path (RCTExceptionsManager
// reportFatal -> RCTFatal -> SIGABRT) — a real TestFlight crash seen ~90-180s
// after backgrounding while on shift. `localStorage` must only ever be used
// on the web build; on native, a SecureStore failure should just mean
// "no token available" (safe no-op), not a second crash.
export function getToken(): string {
  return tokenStore.read().value;
}

/**
 * Is there a session, and can it be read right now? "unreadable" is NOT
 * "signed out": the Keychain can refuse a read (before the first unlock after
 * a restart) while the session is fine. The background location task waits
 * that out instead of stopping tracking.
 */
export function tokenState(): "present" | "missing" | "unreadable" {
  return tokenStore.read().state;
}

function setToken(token: string) {
  try {
    tokenStore.write(token);
  } catch {
    /* Keychain refused; the next response carrying the token tries again */
  }
}

async function removeToken() {
  await tokenStore.clear();
}

/**
 * Move the session and active company saved by older builds to Keychain items
 * the background task can read on a locked phone. Call once the app is in the
 * foreground; harmless on every launch.
 */
export async function upgradeKeychainForBackground(): Promise<void> {
  await tokenStore.upgrade();
  await upgradeActiveCompanyKeychain();
}

/**
 * Capture a rotated/renewed bearer token from the `set-auth-token` response
 * header. better-auth's bearer plugin re-issues this header on ANY
 * authenticated request whenever the underlying session is refreshed
 * server-side (see session updateAge/expiresIn rotation in better-auth's
 * /get-session handler) — not just on sign-in.
 */
export function captureToken(ctx: { response: Response }) {
  const token = ctx.response.headers.get("set-auth-token");
  if (token) setToken(token);
}

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/auth",
  plugins: [inferAdditionalFields({ user: { role: { type: "string" }, phone: { type: "string" } } })],
  fetchOptions: {
    ...(isWeb ? { credentials: "omit" as const } : {}),
    auth: {
      type: "Bearer",
      token: () => getToken(),
    },
    headers: isWeb ? {} : { "expo-origin": "homeserve://" },
    // BUG FIX: captureToken was previously wired ONLY as a one-off onSuccess
    // callback on the sign-in call (app/sign-in.tsx). That means the very
    // first token was stored fine, but any LATER rotation of the session
    // token — which better-auth issues transparently on ~every request as
    // the session approaches its updateAge window, and especially on the
    // /get-session refetch that fires when the app returns from background
    // (via @better-auth/expo's AppState-driven focus manager) — was silently
    // dropped. The client kept sending the stale old token forever, so the
    // first background/foreground cycle after a silent rotation got a 401
    // and bounced the driver to the sign-in screen with no way to recover
    // short of logging in again. Capturing on EVERY response fixes this.
    onSuccess: isWeb ? undefined : captureToken,
  },
});

export async function clearToken() {
  await removeToken();
}

/**
 * The one place request headers are built for the driver app.
 *
 * Every authenticated call needs BOTH the bearer token and the active company
 * — the backend resolves what this driver is allowed to see from
 * `X-Company-Id` on each request. Before this helper existed the token was
 * hand-written into ~19 separate `fetch()` header objects, which is exactly
 * how you end up with one screen that forgets the company header and quietly
 * serves the wrong company's jobs. Adding a header now happens once, here.
 *
 * The company header is omitted when no company has been chosen, which makes
 * the backend fall back to the driver's home company — the right behaviour for
 * a single-company driver who never sees the picker.
 *
 * `X-Forms: 2` tells the server this build can fill in Job forms v2, so it may
 * refuse "Complete job" while required questions are unanswered (older builds
 * without the header are never blocked by a form they can't show).
 */
export const FORMS_HEADER = { "X-Forms": "2" } as const;

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  const company = getActiveCompany();
  return {
    ...FORMS_HEADER,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(company ? { "X-Company-Id": company } : {}),
    ...extra,
  };
}

