import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { eq, inArray } from "drizzle-orm";
import { log } from "../api/lib/logger";

/**
 * Expo push notifications.
 *
 * We talk to the Expo Push API directly (https://exp.host/--/api/v2/push/send)
 * — no SDK dependency. Expo relays to APNs/FCM, so a single code path covers
 * iOS and Android. Tokens are stored in the `push_tokens` table and pruned
 * automatically when Expo reports them as DeviceNotRegistered.
 *
 * This is intentionally fire-and-forget: a failed push must never block or
 * fail the business action (job assignment, payment, etc.) that triggered it.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  badge?: number;
  priority?: "default" | "normal" | "high";
  channelId?: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Look up all active push tokens for a user.
 *
 * sdb (BYPASSRLS): this leaf notification helper is called from several
 * places (dispatch, messages, notify) purely with a userId — the caller's
 * request-scoped tenant isn't threaded through here. Safe because the
 * predicate below is an exact userId match, not a cross-tenant scan.
 */
async function tokensForUser(userId: string): Promise<string[]> {
  const rows = await sdb
    .select({ token: schema.pushTokens.token })
    .from(schema.pushTokens)
    .where(eq(schema.pushTokens.userId, userId));
  return rows.map((r) => r.token);
}

/** Delete tokens Expo told us are no longer valid (uninstalled / logged out). */
async function pruneTokens(tokens: string[]) {
  if (!tokens.length) return;
  try {
    await sdb
      .delete(schema.pushTokens)
      .where(inArray(schema.pushTokens.token, tokens));
    log.info("pruned invalid push tokens", { count: tokens.length });
  } catch (e) {
    log.error("push token prune failed", { err: (e as Error).message });
  }
}

/**
 * Send a push notification to every device a user has registered.
 * No-op (and never throws) when the user has no tokens.
 *
 * `badge`, when provided, sets the app-icon unread count on the recipient's
 * devices (iOS reads this directly off the push payload; Android launchers
 * that support badges pick it up too). Omit it to leave the badge unchanged.
 */
export async function sendPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  badge?: number,
): Promise<void> {
  let tokens: string[];
  try {
    tokens = await tokensForUser(userId);
  } catch (e) {
    log.error("push token lookup failed", { err: (e as Error).message });
    return;
  }
  if (!tokens.length) return;

  const messages: PushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    data: data ?? {},
    sound: "default",
    priority: "high",
    channelId: "default",
    ...(badge != null ? { badge } : {}),
  }));

  await deliver(messages);
}

/** Low-level: POST a batch of messages to Expo and handle the ticket response. */
async function deliver(messages: PushMessage[]): Promise<void> {
  // Expo accepts up to 100 messages per request.
  const chunks: PushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        log.error("expo push http error", { status: res.status });
        continue;
      }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];

      // Map error tickets back to the tokens that produced them so we can prune
      // DeviceNotRegistered entries.
      const dead: string[] = [];
      tickets.forEach((ticket, idx) => {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const msg = chunk[idx];
          if (msg) dead.push(msg.to);
        } else if (ticket.status === "error") {
          log.error("expo push ticket error", {
            error: ticket.details?.error,
            message: ticket.message,
          });
        }
      });

      if (dead.length) await pruneTokens(dead);
    } catch (e) {
      log.error("expo push send failed", { err: (e as Error).message });
    }
  }
}
