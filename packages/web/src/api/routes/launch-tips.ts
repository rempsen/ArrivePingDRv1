/**
 * The unsubscribe link in the day 1 / 3 / 7 launch tip emails
 * (services/launch-progress.ts). No sign-in: the link carries a signed token
 * naming one membership. GET shows a page; POST is the one-click unsubscribe
 * mail apps send (List-Unsubscribe-Post).
 */
import type { AppEnv } from "../env";
import { Hono } from "hono";
import { rateLimit, keyByIp } from "../lib/rate-limit";
import { readUnsubscribeToken, unsubscribeLaunchTips } from "../../services/launch-progress";

const limit = rateLimit({ limit: 30, windowMs: 60_000, keyFn: keyByIp, name: "launch-tips" });

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · ArrivePing</title></head>
<body style="margin:0;background:#070b12;color:#e2e8f0;font-family:-apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif">
<main style="max-width:480px;margin:0 auto;padding:64px 20px">
<p style="font-weight:800;color:#0ea5e9;margin:0 0 24px">ArrivePing</p>
<h1 style="font-size:22px;margin:0 0 10px;color:#fff">${title}</h1>
<p style="color:#94a3b8;line-height:1.6;margin:0">${body}</p>
</main></body></html>`;
}

async function handle(token: string | undefined) {
  const id = readUnsubscribeToken(token ?? "");
  return Boolean(id && (await unsubscribeLaunchTips(id)));
}

export const launchTipsRoutes = new Hono<AppEnv>()
  .get("/unsubscribe", limit, async (c) => {
    const ok = await handle(c.req.query("t"));
    return ok
      ? c.html(page("You won't get these tips again", "We've stopped the setup tip emails for you. Your checklist is still under Getting started, and the Guide is always one click away."))
      : c.html(page("This link didn't work", "It may be incomplete. Copy the whole link from the email, or write to support@nvc360.com and we'll stop the tips for you."), 400);
  })
  .post("/unsubscribe", limit, async (c) => {
    const ok = await handle(c.req.query("t"));
    return c.body(null, ok ? 200 : 400);
  });
