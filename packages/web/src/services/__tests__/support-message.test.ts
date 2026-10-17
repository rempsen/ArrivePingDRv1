import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

let sent: any[] = [];
let emailResult: any = { ok: true };
// Installed only around this file's tests (mock.module is process-wide).
const realEmail = { ...(await import("../email")) };
beforeAll(() => {
  mock.module("../email", () => ({
    ...realEmail,
    sendEmail: async (opts: any) => {
      sent.push(opts);
      return emailResult;
    },
  }));
});
afterAll(() => {
  mock.module("../email", () => realEmail);
});

const { slackPayload, slackEsc, postSupportToSlack, emailSupport, deliverSupportMessage } = await import("../support-message");

const msg = {
  name: "Marcus Bell",
  email: "marcus@prairiecomfort.ca",
  company: "Prairie Comfort HVAC",
  topic: "Technician app",
  message: "ETAs stopped updating for <@channel> Jordan's truck & the map <https://evil.example|click>.",
  page: "/support/troubleshooting",
};

const savedHook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
const savedTo = process.env.SUPPORT_MESSAGE_TO;
beforeEach(() => {
  sent = [];
  emailResult = { ok: true };
  process.env.SLACK_SUPPORT_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
  delete process.env.SUPPORT_MESSAGE_TO;
});
afterEach(() => {
  if (savedHook === undefined) delete process.env.SLACK_SUPPORT_WEBHOOK_URL;
  else process.env.SLACK_SUPPORT_WEBHOOK_URL = savedHook;
  if (savedTo === undefined) delete process.env.SUPPORT_MESSAGE_TO;
  else process.env.SUPPORT_MESSAGE_TO = savedTo;
});

const okFetch = (calls: any[]) =>
  (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

describe("slackPayload", () => {
  it("escapes Slack control characters in the fields", () => {
    expect(slackEsc("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
    const p = slackPayload({ ...msg, company: "<!here> Co" });
    const fields = (p.blocks[1] as any).fields.map((f: any) => f.text).join("\n");
    expect(fields).toContain("&lt;!here&gt; Co");
    expect(fields).not.toContain("<!here>");
  });

  it("escapes the fallback text, which Slack parses as mrkdwn and shows in notifications", () => {
    const p = slackPayload({ ...msg, name: "<!channel> Bob", company: "<!here>", message: "<@U123> hi" });
    expect(p.text).not.toMatch(/<[!@]/);
    expect(p.text).toContain("&lt;!channel&gt; Bob");
  });

  it("puts the message in a plain_text block so links and mentions don't render", () => {
    const body = (slackPayload(msg).blocks[2] as any).text;
    expect(body.type).toBe("plain_text");
    expect(body.text).toBe(msg.message);
  });

  it("links the sender's email for a reply and caps long messages", () => {
    const p = slackPayload({ ...msg, message: "x".repeat(5_000) });
    expect(JSON.stringify(p)).toContain("mailto:marcus@prairiecomfort.ca");
    expect((p.blocks[2] as any).text.text.length).toBeLessThanOrEqual(2_901);
    expect(p.text.length).toBeLessThanOrEqual(160);
  });
});

describe("postSupportToSlack", () => {
  it("posts to the configured webhook", async () => {
    const calls: any[] = [];
    expect(await postSupportToSlack(msg, okFetch(calls))).toBe(true);
    expect(calls[0].url).toBe("https://hooks.slack.com/services/T/B/x");
    expect(calls[0].body.blocks.length).toBe(4);
  });

  it("skips quietly when no webhook is configured", async () => {
    delete process.env.SLACK_SUPPORT_WEBHOOK_URL;
    const calls: any[] = [];
    expect(await postSupportToSlack(msg, okFetch(calls))).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("reports false when Slack rejects or the request throws", async () => {
    const bad = (async () => new Response("invalid_blocks", { status: 400 })) as unknown as typeof fetch;
    expect(await postSupportToSlack(msg, bad)).toBe(false);
    const boom = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await postSupportToSlack(msg, boom)).toBe(false);
  });
});

describe("emailSupport", () => {
  it("emails support@ with Reply-To set to the sender and the message escaped", async () => {
    expect(await emailSupport(msg)).toBe("sent");
    expect(sent[0].to).toBe("support@nvc360.com");
    expect(sent[0].replyTo).toBe("marcus@prairiecomfort.ca");
    expect(sent[0].subject).toBe("Support message — Prairie Comfort HVAC · Technician app");
    expect(sent[0].html).toContain("&lt;@channel&gt;");
    expect(sent[0].html).not.toContain("<@channel>");
  });

  it("honours SUPPORT_MESSAGE_TO", async () => {
    process.env.SUPPORT_MESSAGE_TO = "help@example.com";
    await emailSupport(msg);
    expect(sent[0].to).toBe("help@example.com");
  });
});

describe("deliverSupportMessage", () => {
  const failFetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;

  it("is delivered when either channel takes it", async () => {
    expect((await deliverSupportMessage(msg, okFetch([]))).delivered).toBe(true);
    expect((await deliverSupportMessage(msg, failFetch)).delivered).toBe(true); // email still sent
    emailResult = { ok: false };
    expect((await deliverSupportMessage(msg, okFetch([]))).delivered).toBe(true); // Slack still posted
  });

  it("fails when Slack is configured but both channels fail", async () => {
    emailResult = { ok: false };
    expect((await deliverSupportMessage(msg, failFetch)).delivered).toBe(false);
  });

  it("fails when Slack is configured and rejected and email is not configured", async () => {
    emailResult = { ok: false, skipped: true };
    expect((await deliverSupportMessage(msg, failFetch)).delivered).toBe(false);
  });

  it("treats a fully unconfigured environment (local dev) as delivered", async () => {
    delete process.env.SLACK_SUPPORT_WEBHOOK_URL;
    emailResult = { ok: false, skipped: true };
    expect((await deliverSupportMessage(msg, okFetch([]))).delivered).toBe(true);
  });
});
