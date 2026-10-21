import Constants from "expo-constants";

/**
 * Where the web console lives, for "Open in web" links from office mode.
 * The API and the console are served from the same origin in production
 * (arriveping.com), so `apiUrl` is the fallback when no `webUrl` is set.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; webUrl?: string };
const WEB = (extra.webUrl ?? extra.apiUrl ?? "").replace(/\/$/, "");

export function webUrl(path: string): string {
  return `${WEB}${path.startsWith("/") ? path : `/${path}`}`;
}
