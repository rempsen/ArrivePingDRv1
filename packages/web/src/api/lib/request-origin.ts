import type { Context } from "hono";

/**
 * Resolve the public-facing origin (scheme + host) that a browser actually
 * used to reach this request — for building links that get shared outside
 * the app (intake form share URLs, MCP connection info, etc.).
 *
 * Bug this fixes: several routes used to do
 *   process.env.APP_URL || new URL(c.req.url).origin
 * i.e. a global env var took priority over the real request. APP_URL is set
 * once for the whole deployment and goes stale the moment the product is
 * rebranded or moved to a new domain (it was still "https://uberize.ai" long
 * after the product became "ArrivePing"), so every tenant's share links
 * silently pointed at a dead/wrong domain. The request itself always knows
 * the correct current host, so it must win.
 *
 * Order: X-Forwarded-* headers (set by the reverse proxy in front of prod)
 * > the request's own origin > APP_URL, which is now only a last-resort
 * fallback for the rare case there's no request at all.
 */
export function publicOrigin(c: Context): string {
  const fwdHost = c.req.header("x-forwarded-host");
  const fwdProto = c.req.header("x-forwarded-proto");
  if (fwdHost) {
    const proto = (fwdProto ?? "https").split(",")[0]?.trim() || "https";
    return `${proto}://${fwdHost.split(",")[0]?.trim()}`.replace(/\/$/, "");
  }
  try {
    return new URL(c.req.url).origin.replace(/\/$/, "");
  } catch {
    return (process.env.APP_URL ?? "").replace(/\/$/, "");
  }
}
