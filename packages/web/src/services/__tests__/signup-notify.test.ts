import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

let sent: any[] = [];
// Installed only around this file's tests (mock.module is process-wide).
const realEmail = { ...(await import("../email")) };
beforeAll(() => {
  mock.module("../email", () => ({
    ...realEmail,
    sendEmail: async (opts: any) => {
      sent.push(opts);
      return { ok: true };
    },
  }));
});
afterAll(() => {
  mock.module("../email", () => realEmail);
});

const { postSlack, emailTeam, signupRows } = await import("../signup-notify");

const notice = {
  companyId: "prairie-comfort-hvac",
  companyName: "Prairie Comfort HVAC",
  website: "prairiecomfort.ca",
  industry: "hvac-plumbing",
  adminName: "Marcus Bell",
  adminEmail: "marcus@prairiecomfort.ca",
  adminPhone: "204-555-0199",
  trialEndsAt: new Date("2026-11-14T18:00:00Z"),
};

const saved = process.env.SLACK_ONBOARDING_WEBHOOK_URL;
beforeEach(() => {
  sent = [];
  process.env.SLACK_ONBOARDING_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SLACK_ONBOARDING_WEBHOOK_URL;
  else process.env.SLACK_ONBOARDING_WEBHOOK_URL = saved;
});

describe("signup notifications", () => {
  it("posts a Slack message with the company, contact, industry and trial end", async () => {
    let posted: { url: string; body: any } | null = null;
    const ok = await postSlack(notice, (async (url: any, init: any) => {
      posted = { url: String(url), body: JSON.parse(init.body) };
      return new Response("ok", { status: 200 });
    }) as typeof fetch);
    expect(ok).toBe(true);
    expect(posted!.url).toBe("https://hooks.slack.com/services/T/B/x");
    expect(posted!.body.text).toContain("Prairie Comfort HVAC");
    const fields = posted!.body.blocks[1].fields.map((f: any) => f.text).join("\n");
    expect(fields).toContain("Marcus Bell");
    expect(fields).toContain("HVAC");
    expect(fields).toContain("Nov 14, 2026");
    expect(posted!.body.blocks[2].elements[1].url).toBe("https://prairiecomfort.ca");
  });

  it("skips Slack quietly when no webhook is configured", async () => {
    delete process.env.SLACK_ONBOARDING_WEBHOOK_URL;
    let called = false;
    const ok = await postSlack(notice, (async () => {
      called = true;
      return new Response("ok");
    }) as typeof fetch);
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });

  it("emails contact@nvc360.com with reply-to set to the new admin", async () => {
    expect(await emailTeam(notice)).toBe(true);
    expect(sent[0].to).toBe("contact@nvc360.com");
    expect(sent[0].replyTo).toBe("marcus@prairiecomfort.ca");
    expect(sent[0].subject).toBe("New signup — Prairie Comfort HVAC (Marcus Bell)");
    expect(sent[0].text).toContain("Trial ends (30 days): Nov 14, 2026");
  });

  it("says when there is no card on file", () => {
    const rows = signupRows({ ...notice, trialEndsAt: null });
    expect(rows.find(([k]) => k.startsWith("Trial"))![1]).toBe("no card on file");
  });
});
