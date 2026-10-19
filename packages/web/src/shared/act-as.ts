/**
 * Control Hub act-as: what a staff member signed in as one of a tenant's
 * people may never do, however the request is made. Checked by the server on
 * every request during a session (middleware/auth.ts) and listed on the
 * banner so nobody is surprised.
 */
export const ACT_AS_MINUTES = [15, 30, 60] as const;
export type ActAsMinutes = (typeof ACT_AS_MINUTES)[number];

export const ACT_AS_MIN_REASON = 10;

/** Writes (anything but GET/HEAD/OPTIONS) under these paths answer 403 during act-as. */
export const ACT_AS_DENY: { prefix: string; label: string }[] = [
  { prefix: "/api/billing", label: "billing and closing the account" },
  { prefix: "/api/payments/connect", label: "payment setup" },
  { prefix: "/api/payments/refund", label: "refunds" },
  { prefix: "/api/payouts", label: "payouts" },
  { prefix: "/api/api-keys", label: "API keys" },
  { prefix: "/api/integrations", label: "connecting apps" },
  { prefix: "/api/me", label: "their own account and deleting it" },
  { prefix: "/api/settings/support-access", label: "the support-access setting" },
  { prefix: "/api/team/roles", label: "role defaults" },
];

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const PASSWORD = /^\/api\/admin\/users\/[^/]+\/reset-password\/?$/;

/** The plain-words reason this request is refused during act-as, or null. */
export function deniedDuringActAs(method: string, path: string): string | null {
  if (READS.has(method.toUpperCase())) return null;
  if (PASSWORD.test(path)) return "passwords";
  for (const d of ACT_AS_DENY) if (path === d.prefix || path.startsWith(`${d.prefix}/`)) return d.label;
  return null;
}
