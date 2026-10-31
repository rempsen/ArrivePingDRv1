/**
 * The `?next=` on /sign-in and /sign-up (set by join-company and by the
 * session-expired redirect) says where to go after signing in. It comes from
 * the URL, so anyone can craft it: only a same-site relative path is honoured,
 * never another site (an open redirect would let a phishing link bounce a
 * freshly signed-in user to a look-alike page).
 *
 * Accepted: starts with a single "/" (not "//"), no backslashes, no
 * whitespace or control characters (browsers strip tabs/newlines, which turns
 * "/\t/evil.com" into "//evil.com"), and still resolves to this origin.
 * Returns the path to use, or null to fall back to the role's home page.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  const base = "https://arriveping.invalid";
  try {
    const u = new URL(raw, base);
    if (u.origin !== base) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

/** `next` from a query string ("?next=..."), already checked; null if unsafe or absent. */
export function nextFromSearch(search: string): string | null {
  return safeNextPath(new URLSearchParams(search).get("next"));
}
