/**
 * Control Hub act-as in the browser. Starting stores the session id (sent as
 * X-Act-As by lib/api.ts) and opens the company as that person; leaving tells
 * the server, forgets it and goes back to the hub. The server is the only
 * judge of whether a session is live; this just carries the id.
 */
import { getToken } from "./auth";

const KEY = "act_as_session";
const RETURN = "act_as_return";

export function actAsSession(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(KEY);
}

/** Begin acting: remember where to come back to, then open the tenant. */
export function beginActAs(sessionId: string, companyId: string, returnTo: string) {
  localStorage.setItem(KEY, sessionId);
  localStorage.setItem(RETURN, JSON.stringify({ path: returnTo, company: localStorage.getItem("active_company") ?? "default" }));
  localStorage.setItem("active_company", companyId);
  window.location.assign("/admin");
}

function goBack() {
  let back: { path?: string; company?: string } = {};
  try {
    back = JSON.parse(localStorage.getItem(RETURN) ?? "{}");
  } catch {
    back = {};
  }
  localStorage.removeItem(KEY);
  localStorage.removeItem(RETURN);
  localStorage.setItem("active_company", back.company || "default");
  window.location.assign(back.path || "/admin/hub");
}

/** Leave act-as from the banner. */
export async function leaveActAs() {
  const id = actAsSession();
  try {
    await fetch("/api/act-as/end", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...(id ? { "X-Act-As": id } : {}),
      },
      body: JSON.stringify({ sessionId: id ?? undefined }),
    });
  } catch {
    /* the server ends it on its own when time runs out */
  }
  goBack();
}

let ending = false;
/** The server says the session is over (time up, or the company switched support access off). */
export function actAsEnded(reason: string) {
  if (ending || !actAsSession()) return;
  ending = true;
  const msg =
    reason === "expired"
      ? "Your act-as time ran out. Taking you back to the Control Hub."
      : reason === "support_off"
        ? "This company switched off support access, so act-as has ended."
        : "Act-as has ended.";
  try {
    sessionStorage.setItem("act_as_notice", msg);
  } catch {
    /* ignore */
  }
  goBack();
}
