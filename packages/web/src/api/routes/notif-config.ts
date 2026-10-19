import type { AppEnv } from "../env";
import { Hono } from "hono";
import * as schema from "../database/schema";
import { sdb } from "../database";
import { eq } from "drizzle-orm";
import { requireAdmin, tx, tenantId } from "../middleware/auth";
import { audit } from "../lib/audit";
import { sendTestMessages, seedNotificationRules, EVENT_META, defaultTemplateFor, interpolateSample, TEMPLATE_VARS, renderDesignPreview, sendDesignTest, type NvcEvent } from "../../services/dispatch";
import { STARTERS } from "../../shared/email/starters";
import { normalizeDesign, normalizeTheme, serializeDesign } from "../../shared/email/design";
import { EmailGenerateError, generateEmailDraft } from "../../services/email-generate";
import { rateLimit, keyByUser } from "../lib/rate-limit";
import { putObject } from "../lib/storage";
import { resendAvailable, triggerVerify, removeDomain } from "../../services/email-domains";
import { isFreeMailboxDomain } from "../../services/sender";
import { PLATFORM_FROM } from "../../services/email";
import { z } from "zod";
import {
  MILESTONE_TRIGGERS,
  MILESTONE_RECIPIENTS,
  STAGE_OPTIONS,
  MAX_MILESTONE_NAME,
  MAX_MILESTONE_MESSAGE,
  MAX_MILESTONES_PER_COMPANY,
  MAX_OFFSET_MINUTES,
  customEventKey,
  customMilestoneId,
  describeTrigger,
  type MilestoneRecipient,
} from "../../shared/custom-milestones";
import {
  MilestoneError,
  checklistLabels,
  createMilestone,
  deleteMilestone,
  getMilestone,
  hasEmailDesign,
  listMilestones,
  milestoneMeta,
  milestoneRules,
  updateMilestone,
  type CustomMilestone,
  type MilestoneMessages,
} from "../../services/custom-milestones";
import { jsonBody,
  parseBody,
  shortText,
  longText,
  optText,
  email,
  jsonBlob,
  hhmm,
  bool,
  hexColor,
  outboundUrl,
  pixelSize,
} from "../lib/validate";

const EVENTS = Object.keys(EVENT_META) as NvcEvent[];
const RECIPIENTS = ["client", "tech", "office"] as const;
const CHANNELS = ["inApp", "email", "sms", "webhook"] as const;

/* -------------------------------------------------------------------------- */
/*  Request bodies                                                            */
/*                                                                            */
/*  Every body on this file was a raw c.req.json() copied field-by-field into  */
/*  an update. Reproduced live before this pass:                              */
/*                                                                            */
/*   - PATCH /rules/:id { email: "yes" } -> 200, writing a string into a       */
/*     boolean column; { enabled: {} } was accepted too. And a bogus rule id   */
/*     returned 200 with an empty body instead of 404, so the UI showed a      */
/*     successful toggle that had updated nothing.                             */
/*   - PATCH /rules/:id { emailSubject: 50_000 chars } -> 200.                 */
/*   - POST /rules/bulk { event: "made.up", value: "yes" } -> 200 ok:true, a   */
/*     silent no-op against an event that doesn't exist.                       */
/*   - POST /preview { template: {} } -> bare 500 (interpolate on a non-string)*/
/*   - POST /email/test { to: "not an email" } -> 200 and a real Resend call   */
/*     that bounced against the tenant's own verified sending domain.          */
/*   - POST /email/templates with a 20,000-character name -> 201.              */
/*   - PATCH /channels { emailFromAddress: "totally not an email" } -> 200.    */
/*     That is the tenant's sending identity: every notification email from    */
/*     that company then fails at the provider. quietStart: "99:99" and        */
/*     emailEnabled: "no" were accepted the same way.                          */
/*   - POST /webhooks with no url -> bare 500 (NOT NULL); with                 */
/*     "javascript:alert(1)" -> 201 (stored XSS); with                         */
/*     "http://localhost:4200/..." -> 201, and /webhooks/:id/test then fetched */
/*     it, turning our own test-ping into an SSRF probe of the host network.   */
/* -------------------------------------------------------------------------- */

const RulePatch = z
  .object({
    inApp: bool("In-app"),
    email: bool("Email"),
    sms: bool("SMS"),
    webhook: bool("Webhook"),
    enabled: bool("Enabled"),
    template: longText(10_000),
    // Blank = the default "Company: Event" subject.
    emailSubject: z.union([shortText("Subject", 200), z.literal("")]),
    emailDesign: z.union([z.string().max(200_000), jsonBlob()]),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });

const BulkBody = z.object({
  event: z.enum(EVENTS as [NvcEvent, ...NvcEvent[]], { error: "Unknown event" }),
  channel: z.enum(CHANNELS, { error: "Channel must be one of: inApp, email, sms, webhook" }),
  value: z.boolean({ error: "Value must be true or false" }),
});

const PreviewBody = z.object({ template: longText(20_000).optional() });

/** A design as the designer sends it: a v2 object, or a v1 list of blocks. */
const DesignInput = jsonBlob(200_000);

/** Unsaved brand changes the designer previews and test-sends. */
const BrandOverrideBody = z
  .object({
    brandColor: z.union([hexColor("Brand colour"), z.literal("")]).optional(),
    bgColor: z.union([hexColor("Background colour"), z.literal("")]).optional(),
    logoUrl: z.string().trim().max(2_000).optional(),
    logoHeight: z.union([z.literal(0), pixelSize("Logo height", 20, 400)]).optional(),
    theme: jsonBlob(20_000).optional(),
  })
  .optional();

const RenderBody = z.object({
  design: DesignInput.optional(),
  brand: BrandOverrideBody,
});

const TestEmailBody = z.object({
  to: email("Recipient"),
  subject: shortText("Subject", 200).optional(),
  design: DesignInput.optional(),
  brand: BrandOverrideBody,
});

const GenerateBody = z.object({
  description: z.string().trim().min(12, "Describe the email in a sentence or two.").max(1500, "Keep the description under 1,500 characters"),
  event: z.string().trim().max(80).optional(),
  recipient: z.enum(["client", "tech", "office"]).optional(),
});

const generateLimit = rateLimit({ limit: 20, windowMs: 60 * 60 * 1000, keyFn: keyByUser, name: "email-generate" });

const TemplateFields = {
  name: shortText("Name", 120),
  description: optText(500),
  subject: shortText("Subject", 200).optional(),
  design: z.union([z.string().max(200_000), jsonBlob()]).optional(),
};
const TemplateCreate = z.object(TemplateFields);
const TemplatePatch = z
  .object(TemplateFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });

const ChannelsPatch = z
  .object({
    inAppEnabled: bool("In-app notifications"),
    emailEnabled: bool("Email notifications"),
    smsEnabled: bool("SMS notifications"),
    webhookEnabled: bool("Webhooks"),
    // These are all legitimately blank in live data (the sender name falls back
    // to the company name, SMS sender id is Twilio-optional), and the Channels
    // tab PATCHes the WHOLE row on save — so a min-length rule here would 400
    // the entire Save button. Length-capped only.
    emailFromName: longText(120),
    // Allowed to be cleared (falls back to the platform default sender), but
    // never allowed to be a non-address.
    emailFromAddress: z.union([email("Sender address"), z.literal("")]),
    emailReplyTo: z.union([email("Reply-to address"), z.literal("")]),
    emailFooter: longText(2_000),
    emailBodyTemplate: longText(20_000),
    smsBodyTemplate: longText(2_000),
    smsFromNumber: longText(32),
    smsSenderId: longText(32),
    quietHoursEnabled: bool("Quiet hours"),
    quietStart: hhmm("Quiet hours start"),
    quietEnd: hhmm("Quiet hours end"),
    quietChannels: z.string().trim().max(120),
    emailLogoUrl: z.string().trim().max(2_000),
    // Header logo height in px. 0 = auto (renders at the shared default —
    // see DEFAULT_LOGO_HEIGHT in email-render.ts).
    emailLogoHeight: z.union([z.literal(0), pixelSize("Logo height", 20, 400)]),
    emailBrandColor: z.union([hexColor("Brand colour"), z.literal("")]),
    emailHeaderStyle: z.enum(["gradient", "solid", "minimal", "plain", "logo"], {
      error: "Header style must be gradient, solid, minimal, plain or logo",
    }),
    // The company email theme (font, corners, buttons, header, social links).
    emailTheme: z.union([z.string().max(20_000), jsonBlob(20_000)]),
    emailBgColor: z.union([hexColor("Background colour"), z.literal("")]),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });

const WebhookFields = {
  label: shortText("Label", 120).optional(),
  url: outboundUrl("Webhook URL"),
  secret: shortText("Secret", 200).optional(),
  events: z.string().trim().max(2_000).optional(),
  active: bool("Active").optional(),
};
const WebhookCreate = z.object(WebhookFields);
const WebhookPatch = z
  .object({ ...WebhookFields, url: outboundUrl("Webhook URL").optional() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });

/** Where a Test goes: the person testing, never a customer. */
const TestEventBody = z.object({
  phone: z.string().trim().max(40, "That phone number is too long").optional(),
  email: z.string().trim().max(254).optional(),
  /** Save the number on the tester's own profile, so office texts reach them too. */
  rememberPhone: z.boolean().optional(),
});

/** A mobile number with its area code (10 digits, or 11+ with a country code), or a clear reason it isn't one. */
export function testPhoneProblem(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 10 || digits.length > 15) return "Enter your mobile number with its area code, like (204) 555-0123.";
  return null;
}

const MilestoneMessage = z.object({
  on: bool("Send"),
  text: z.string().max(MAX_MILESTONE_MESSAGE, `Keep each message under ${MAX_MILESTONE_MESSAGE} characters`),
});
const MilestoneMessagesBody = z
  .object({ client: MilestoneMessage, tech: MilestoneMessage, office: MilestoneMessage })
  .partial();
const MilestoneFieldsBody = {
  name: shortText("Name", MAX_MILESTONE_NAME),
  trigger: z.enum(MILESTONE_TRIGGERS, { error: "Pick what sets the milestone off" }),
  triggerEvent: z.string().trim().max(40).optional(),
  checklistLabel: z.string().trim().max(200, "That checklist item is too long").optional(),
  offsetMinutes: z
    .number({ error: "Set how long before or after" })
    .int("Use whole minutes")
    .min(0)
    .max(MAX_OFFSET_MINUTES, "Keep it within 30 days")
    .optional(),
  customerTimeline: bool("Show on the customer's timeline").optional(),
};
const MilestoneCreate = z.object({ ...MilestoneFieldsBody, messages: MilestoneMessagesBody.optional() });
const MilestonePatch = z
  .object({ ...MilestoneFieldsBody, enabled: bool("Enabled"), messages: MilestoneMessagesBody })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });

const RECIPIENT_WORD: Record<MilestoneRecipient, string> = {
  client: "the customer",
  tech: "the technician",
  office: "the office",
};

/**
 * A recipient ticked with nothing written is a mistake worth saying out loud,
 * unless a branded email is designed for them (`designed`): that is the message.
 */
function messagesProblem(
  messages: MilestoneMessages | undefined,
  designed: ReadonlySet<string> = new Set(),
): string | null {
  for (const r of MILESTONE_RECIPIENTS) {
    const m = messages?.[r];
    if (m?.on && !m.text.trim() && !designed.has(r)) return `Write the message for ${RECIPIENT_WORD[r]}, or untick them.`;
  }
  return null;
}

/** A milestone as the Notifications page shows it: when it fires, and who gets what. */
async function milestoneView(t: ReturnType<typeof tx>, m: CustomMilestone) {
  const rules = await t.select(schema.notificationRules, eq(schema.notificationRules.event, customEventKey(m.id)));
  const messages = Object.fromEntries(
    MILESTONE_RECIPIENTS.map((r) => {
      const rule = rules.find((x) => x.recipient === r);
      return [
        r,
        {
          on: !!rule && rule.enabled && (rule.inApp || rule.email || rule.sms || rule.webhook),
          text: rule?.template ?? "",
          designed: hasEmailDesign(rule?.emailDesign),
        },
      ];
    }),
  );
  return { ...m, event: customEventKey(m.id), summary: describeTrigger(m), messages };
}

/** A booking id from the request, only if it is this company's. */
/**
 * Resolve (creating if needed) the single notification_channels row for the
 * active company. Tenancy: one row per company, keyed by companyId. The legacy
 * `id="default"` singleton no longer exists.
 */
async function getOrCreateChannels(c: any) {
  const t = tx(c);
  let row = await t.selectOne(schema.notificationChannels);
  if (!row) {
    const co = await t.selectOne(schema.companySettings);
    [row] = await t.insert(schema.notificationChannels, {
      emailFromName: co?.name || "NVC 360",
      emailFromAddress: co?.email || "",
    });
  }
  if (!row) throw new Error("failed to load notification channels");
  return row;
}

/** The name people know an event by: a built-in's label, or a custom milestone's own name. */
async function eventLabel(companyId: string, event: string): Promise<string> {
  const customId = customMilestoneId(event);
  if (customId) return (await getMilestone(companyId, customId))?.name ?? "custom milestone";
  return EVENT_META[event as NvcEvent]?.label ?? event;
}

export const notifConfigRoutes = new Hono<AppEnv>()
  // full rule matrix (seeds defaults on first call)
  .get("/rules", requireAdmin, async (c) => {
    await seedNotificationRules(tenantId(c));
    const t = tx(c);
    const rules = await t.select(schema.notificationRules);
    const customs = await listMilestones(tenantId(c));
    // ensure a row exists for every event×recipient so the UI grid is complete
    const have = new Set(rules.map((r) => `${r.event}:${r.recipient}`));
    const toAdd: any[] = [];
    for (const event of [...EVENTS, ...customs.map((m) => customEventKey(m.id))])
      for (const recipient of RECIPIENTS)
        if (!have.has(`${event}:${recipient}`))
          toAdd.push({ event, recipient, inApp: false, email: false, sms: false, webhook: false, enabled: true });
    if (toAdd.length) {
      await t.insert(schema.notificationRules, toAdd);
    }
    const all = await t.select(schema.notificationRules);
    // Built-in events first, then the company's own milestones (each row says
    // when it goes off, so the table reads on its own).
    const meta = [
      ...EVENTS.map((e) => ({ event: e as string, label: EVENT_META[e].label })),
      ...customs.map((m) => ({
        event: customEventKey(m.id),
        label: m.name,
        custom: true as const,
        summary: describeTrigger(m),
        enabled: m.enabled,
      })),
    ];
    return c.json({ rules: all, events: meta, recipients: RECIPIENTS }, 200);
  })
  // update one rule (toggle a channel etc.)
  .patch("/rules/:id", requireAdmin, jsonBody(RulePatch), async (c) => {
    const ruleId = c.req.param("id");
    const body = c.req.valid("json");
    const t = tx(c);
    const existing = await t.selectOne(schema.notificationRules, eq(schema.notificationRules.id, ruleId));
    if (!existing) return c.json({ message: "Notification rule not found" }, 404);
    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.emailDesign !== undefined) {
      // "" = no design (plain message). Anything else is stored as a cleaned v2 design.
      const blank = body.emailDesign === "" || body.emailDesign === null;
      const d = blank ? null : normalizeDesign(body.emailDesign);
      patch.emailDesign = d && d.blocks.length ? serializeDesign(d) : "";
    }
    const [r] = await t.update(schema.notificationRules, patch as any, eq(schema.notificationRules.id, ruleId));
    // A change to the WORDS (not a channel toggle) is recorded: it's what the
    // Launch checklist's "Make a milestone message yours" looks for.
    const copyChanged =
      (body.template !== undefined && body.template !== existing.template) ||
      (body.emailSubject !== undefined && body.emailSubject !== existing.emailSubject) ||
      (patch.emailDesign !== undefined && patch.emailDesign !== existing.emailDesign);
    if (copyChanged) {
      const me = c.get("user") as { id?: string; name?: string; email?: string } | undefined;
      await audit({
        companyId: tenantId(c),
        actorId: me?.id ?? "",
        actorName: me?.name ?? me?.email ?? "",
        action: "update",
        entityType: "notification_copy",
        entityId: ruleId,
        summary: `Edited the ${await eventLabel(tenantId(c), existing.event)} message for ${existing.recipient}`,
      });
    }
    return c.json({ rule: r }, 200);
  })
  // bulk set a whole column for an event row (convenience)
  .post("/rules/bulk", requireAdmin, jsonBody(BulkBody), async (c) => {
    const { event, channel, value } = c.req.valid("json");
    await tx(c).update(
      schema.notificationRules,
      { [channel]: value, updatedAt: new Date() } as any,
      eq(schema.notificationRules.event, event),
    );
    return c.json({ ok: true }, 200);
  })

  // ---- single event detail (all 3 recipient rows + meta + sample template vars) ----
  .get("/events/:event", requireAdmin, async (c) => {
    await seedNotificationRules(tenantId(c));
    const event = c.req.param("event") as NvcEvent;
    const customId = customMilestoneId(event);
    const custom = customId ? await getMilestone(tenantId(c), customId) : undefined;
    if (customId && !custom) return c.json({ message: "That milestone no longer exists" }, 404);
    if (!custom && !EVENT_META[event]) return c.json({ message: "unknown event" }, 404);
    const t = tx(c);
    const rows = await t.select(schema.notificationRules, eq(schema.notificationRules.event, event));
    // make sure all 3 recipient rows exist
    const have = new Set(rows.map((r) => r.recipient));
    const toAdd = RECIPIENTS.filter((r) => !have.has(r)).map((recipient) => ({ event, recipient, inApp: false, email: false, sms: false, webhook: false, enabled: true }));
    if (toAdd.length) await t.insert(schema.notificationRules, toAdd);
    const all = await t.select(schema.notificationRules, eq(schema.notificationRules.event, event));
    return c.json({
      event,
      meta: custom ? milestoneMeta(custom) : EVENT_META[event],
      rules: all,
      // A custom milestone has no built-in copy: what the company writes is all it sends.
      defaults: Object.fromEntries(RECIPIENTS.map((r) => [r, custom ? "" : defaultTemplateFor(event, r as any)])),
      vars: TEMPLATE_VARS,
      custom: custom ? { id: custom.id, summary: describeTrigger(custom) } : null,
    }, 200);
  })

  // ---- template preview (interpolate {{vars}} against sample data) ----
  .post("/preview", requireAdmin, jsonBody(PreviewBody), async (c) => {
    const { template } = c.req.valid("json");
    const channels = await tx(c).selectOne(schema.notificationChannels);
    return c.json({ rendered: interpolateSample(template || "", channels?.emailFromName) }, 200);
  })

  // ---- render a full branded HTML email from a block design (live editor preview) ----
  .post("/email/render", requireAdmin, jsonBody(RenderBody), async (c) => {
    const { design, brand } = c.req.valid("json");
    const origin = new URL(c.req.url).origin;
    const html = await renderDesignPreview(tenantId(c), design ?? [], { origin, brand });
    return c.json({ html }, 200);
  })

  // ---- send a test email rendered from a design ----
  .post("/email/test", requireAdmin, jsonBody(TestEmailBody), async (c) => {
    const { to, subject, design, brand } = c.req.valid("json");
    const origin = new URL(c.req.url).origin;
    const r = await sendDesignTest(tenantId(c), to, subject || "", design ?? [], origin, brand);
    return c.json(r, 200);
  })

  // ---- "Describe it": AI drafts an email for review (nothing saved) ----
  .post("/email/generate", requireAdmin, generateLimit, jsonBody(GenerateBody), async (c) => {
    const b = c.req.valid("json");
    const co = await tx(c).selectOne(schema.companySettings);
    const eventLabelText = b.event ? await eventLabel(tenantId(c), b.event) : undefined;
    try {
      const draft = await generateEmailDraft({ description: b.description, eventLabel: eventLabelText, recipient: b.recipient, companyName: co?.name || undefined });
      return c.json({ draft }, 200);
    } catch (e) {
      if (e instanceof EmailGenerateError) return c.json({ message: e.message }, 502);
      throw e;
    }
  })

  // ---- reusable email templates library ----
  .get("/email/templates", requireAdmin, async (c) => {
    const t = tx(c);
    // Keep the built-in starters in step with the current set: add new ones,
    // refresh ones whose design changed (built-ins can't be edited by tenants).
    const existing = await t.select(schema.emailTemplates, eq(schema.emailTemplates.isBuiltin, true));
    for (const st of STARTERS) {
      const design = JSON.stringify(st.design);
      const row = existing.find((r) => r.name === st.name);
      if (!row) await t.insert(schema.emailTemplates, { name: st.name, description: st.description, subject: st.subject, design, isBuiltin: true });
      else if (row.design !== design || row.description !== st.description || row.subject !== st.subject)
        await t.update(schema.emailTemplates, { design, description: st.description, subject: st.subject, updatedAt: new Date() }, eq(schema.emailTemplates.id, row.id));
    }
    const rows = await t.select(schema.emailTemplates);
    rows.sort((a, b) =>
      (Number(b.isBuiltin) - Number(a.isBuiltin)) ||
      (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    );
    return c.json({ templates: rows }, 200);
  })
  .post("/email/templates", requireAdmin, jsonBody(TemplateCreate), async (c) => {
    const b = c.req.valid("json");
    const [t] = await tx(c).insert(schema.emailTemplates, {
      name: b.name || "Untitled template",
      description: b.description || "",
      subject: b.subject || "",
      design: serializeDesign(normalizeDesign(b.design ?? [])),
      isBuiltin: false,
    });
    return c.json({ template: t }, 201);
  })
  .patch("/email/templates/:id", requireAdmin, jsonBody(TemplatePatch), async (c) => {
    const templateId = c.req.param("id");
    const b = c.req.valid("json");
    const t = tx(c);
    const existing = await t.selectOne(schema.emailTemplates, eq(schema.emailTemplates.id, templateId));
    if (!existing) return c.json({ message: "Template not found" }, 404);
    if (existing.isBuiltin) return c.json({ message: "Builtin templates can't be edited — duplicate it first" }, 400);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["name", "description", "subject"] as const) if (b[k] !== undefined) patch[k] = b[k];
    if (b.design !== undefined) patch.design = serializeDesign(normalizeDesign(b.design));
    const [row] = await t.update(schema.emailTemplates, patch as any, eq(schema.emailTemplates.id, templateId));
    return c.json({ template: row }, 200);
  })
  .delete("/email/templates/:id", requireAdmin, async (c) => {
    const t = tx(c);
    const row = await t.selectOne(schema.emailTemplates, eq(schema.emailTemplates.id, c.req.param("id")));
    if (row?.isBuiltin) return c.json({ message: "cannot delete a builtin template" }, 400);
    await t.delete(schema.emailTemplates, eq(schema.emailTemplates.id, c.req.param("id")));
    return c.json({ ok: true }, 200);
  })

  // ---- logo upload for email header (stored under /uploads, returns its URL) ----
  .post("/email/logo", requireAdmin, async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ message: "No file" }, 400);
    if (file.size > 4 * 1024 * 1024) return c.json({ message: "Logo too large (max 4MB)" }, 400);
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name))
      return c.json({ message: "Gmail and Outlook can't show SVG images. Upload a PNG or JPG instead." }, 400);
    if (file.type && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
      return c.json({ message: `Unsupported type ${file.type}. Upload a PNG or JPG.` }, 400);
    const ext = (file.name.split(".").pop() || "png").toLowerCase().slice(0, 8);
    const key = `email-logos/${crypto.randomUUID()}.${ext}`;
    const stored = await putObject(
      key,
      Buffer.from(await file.arrayBuffer()),
      file.type || "image/png",
    );
    // Body images (?persist=0) are just uploaded; a header logo is also saved
    // on this company's channel config.
    if (c.req.query("persist") === "0") return c.json({ url: stored.url }, 200);
    const existing = await getOrCreateChannels(c);
    await tx(c).update(schema.notificationChannels, { emailLogoUrl: stored.url, updatedAt: new Date() }, eq(schema.notificationChannels.id, existing.id));
    return c.json({ url: stored.url }, 200);
  })

  // ---- per-company channel settings (sender identity, quiet hours, master switches) ----
  .get("/channels", requireAdmin, async (c) => {
    const row = await getOrCreateChannels(c);
    return c.json({ channels: row }, 200);
  })
  .patch("/channels", requireAdmin, jsonBody(ChannelsPatch), async (c) => {
    const b = c.req.valid("json");
    const patch: Record<string, unknown> = { ...b, updatedAt: new Date() };
    const existing = await getOrCreateChannels(c);
    // Stored cleaned: unknown keys dropped, unsafe social links removed.
    if (b.emailTheme !== undefined) patch.emailTheme = JSON.stringify(normalizeTheme(b.emailTheme, b.emailHeaderStyle ?? existing.emailHeaderStyle));
    const [row] = await tx(c).update(schema.notificationChannels, patch as any, eq(schema.notificationChannels.id, existing.id));
    return c.json({ channels: row }, 200);
  })

  // ---- webhooks ----
  .get("/webhooks", requireAdmin, async (c) => {
    const rows = await tx(c).select(schema.webhookEndpoints);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ webhooks: rows }, 200);
  })
  .post("/webhooks", requireAdmin, jsonBody(WebhookCreate), async (c) => {
    const b = c.req.valid("json");
    const [w] = await tx(c).insert(schema.webhookEndpoints, {
      label: b.label || "",
      url: b.url,
      secret: b.secret || "",
      events: b.events || "*",
      active: b.active ?? true,
    });
    return c.json({ webhook: w }, 201);
  })
  .patch("/webhooks/:id", requireAdmin, jsonBody(WebhookPatch), async (c) => {
    const hookId = c.req.param("id");
    const b = c.req.valid("json");
    const t = tx(c);
    const existing = await t.selectOne(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, hookId));
    if (!existing) return c.json({ message: "Webhook not found" }, 404);
    const [w] = await t.update(schema.webhookEndpoints, b as any, eq(schema.webhookEndpoints.id, hookId));
    return c.json({ webhook: w }, 200);
  })
  .delete("/webhooks/:id", requireAdmin, async (c) => {
    await tx(c).delete(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, c.req.param("id")));
    return c.json({ ok: true }, 200);
  })
  // test-ping a webhook
  .post("/webhooks/:id/test", requireAdmin, async (c) => {
    const w = await tx(c).selectOne(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, c.req.param("id")));
    if (!w) return c.json({ message: "not found" }, 404);
    try {
      const res = await fetch(w.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(w.secret ? { "X-Webhook-Secret": w.secret } : {}) },
        body: JSON.stringify({ event: "test", message: "ArrivePing webhook test", at: new Date().toISOString() }),
      });
      return c.json({ ok: res.ok, status: res.status }, 200);
    } catch (e: any) {
      return c.json({ ok: false, error: e?.message }, 200);
    }
  })

  // ---- delivery log ----
  .get("/deliveries", requireAdmin, async (c) => {
    const event = c.req.query("event");
    const t = tx(c);
    const rows = event
      ? await t.select(schema.notificationDeliveries, eq(schema.notificationDeliveries.event, event))
      : await t.select(schema.notificationDeliveries);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // The name people know each event by, so a custom milestone reads as
    // "Water restored", not custom:<id>.
    const names = new Map((await listMilestones(tenantId(c))).map((m) => [customEventKey(m.id), m.name]));
    const label = (e: string) =>
      names.get(e) ?? (customMilestoneId(e) ? "Deleted milestone" : (EVENT_META[e as NvcEvent]?.label ?? e));
    return c.json({ deliveries: rows.slice(0, 200).map((r) => ({ ...r, eventLabel: label(r.event) })) }, 200);
  })

  // ---- send an event's messages to the person testing (never to a customer) ----
  .post("/test/:event", requireAdmin, jsonBody(TestEventBody), async (c) => {
    const event = c.req.param("event") as NvcEvent;
    const customId = customMilestoneId(event);
    const custom = customId ? await getMilestone(tenantId(c), customId) : undefined;
    if (customId && !custom) return c.json({ message: "That milestone no longer exists" }, 404);
    if (!custom && !EVENT_META[event]) return c.json({ message: "unknown event" }, 404);
    const body = c.req.valid("json");
    const phone = body.phone || "";
    const mail = body.email || "";
    if (!phone && !mail) return c.json({ message: "Enter your mobile number or email address to get the test." }, 400);
    if (phone) {
      const problem = testPhoneProblem(phone);
      if (problem) return c.json({ message: problem }, 400);
    }
    if (mail && !email().safeParse(mail).success) return c.json({ message: "Enter a valid email address." }, 400);
    const me = c.get("user") as { id?: string; phone?: string } | undefined;
    // Only fills an empty profile number: a test never overwrites one.
    if (phone && body.rememberPhone && me?.id && !me.phone) {
      await sdb.update(schema.user).set({ phone, updatedAt: new Date() }).where(eq(schema.user.id, me.id));
    }
    const out = await sendTestMessages({
      companyId: tenantId(c),
      event,
      meta: custom ? milestoneMeta(custom) : EVENT_META[event],
      to: { phone: phone || undefined, email: mail || undefined },
    });
    return c.json({ ok: true, event, ...out }, 200);
  })

  // ---- custom milestones (services/custom-milestones.ts) ----
  .get("/custom", requireAdmin, async (c) => {
    const t = tx(c);
    const ms = await listMilestones(tenantId(c));
    const milestones = await Promise.all(ms.map((m) => milestoneView(t, m)));
    return c.json(
      { milestones, stages: STAGE_OPTIONS, checklistLabels: await checklistLabels(tenantId(c)), vars: TEMPLATE_VARS },
      200,
    );
  })
  .post("/custom", requireAdmin, jsonBody(MilestoneCreate), async (c) => {
    const body = c.req.valid("json");
    const problem = messagesProblem(body.messages);
    if (problem) return c.json({ message: problem }, 400);
    const existing = await listMilestones(tenantId(c));
    if (existing.length >= MAX_MILESTONES_PER_COMPANY)
      return c.json({ message: `You can have up to ${MAX_MILESTONES_PER_COMPANY} custom milestones.` }, 400);
    try {
      const { messages, ...fields } = body;
      const m = await createMilestone(tenantId(c), fields, messages);
      const me = c.get("user") as { id?: string; name?: string; email?: string } | undefined;
      await audit({
        companyId: tenantId(c),
        actorId: me?.id ?? "",
        actorName: me?.name ?? me?.email ?? "",
        action: "create",
        entityType: "custom_milestone",
        entityId: m.id,
        summary: `Created the milestone "${m.name}" (${describeTrigger(m)})`,
      });
      return c.json({ milestone: await milestoneView(tx(c), m) }, 201);
    } catch (e) {
      if (e instanceof MilestoneError) return c.json({ message: e.message }, 400);
      throw e;
    }
  })
  .patch("/custom/:id", requireAdmin, jsonBody(MilestonePatch), async (c) => {
    const body = c.req.valid("json");
    const designed = new Set(
      (await milestoneRules(tenantId(c), c.req.param("id")))
        .filter((r) => hasEmailDesign(r.emailDesign))
        .map((r) => r.recipient),
    );
    const problem = messagesProblem(body.messages, designed);
    if (problem) return c.json({ message: problem }, 400);
    try {
      const { messages, ...fields } = body;
      const m = await updateMilestone(tenantId(c), c.req.param("id"), fields, messages);
      if (!m) return c.json({ message: "That milestone no longer exists" }, 404);
      return c.json({ milestone: await milestoneView(tx(c), m) }, 200);
    } catch (e) {
      if (e instanceof MilestoneError) return c.json({ message: e.message }, 400);
      throw e;
    }
  })
  .delete("/custom/:id", requireAdmin, async (c) => {
    const m = await getMilestone(tenantId(c), c.req.param("id"));
    if (!m) return c.json({ message: "That milestone no longer exists" }, 404);
    await deleteMilestone(tenantId(c), m.id);
    const me = c.get("user") as { id?: string; name?: string; email?: string } | undefined;
    await audit({
      companyId: tenantId(c),
      actorId: me?.id ?? "",
      actorName: me?.name ?? me?.email ?? "",
      action: "delete",
      entityType: "custom_milestone",
      entityId: m.id,
      summary: `Deleted the milestone "${m.name}"`,
    });
    return c.json({ ok: true }, 200);
  })

  // ---- email sending domains (tenant self-serve) ----
  // List the active company's submitted domains (+ parsed DNS records).
  .get("/email-domains", requireAdmin, async (c) => {
    const rows = await tx(c).select(schema.tenantEmailDomains);
    const domains = rows.map((r) => ({
      ...r,
      records: safeParse(r.records),
    }));
    domains.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // platformFrom: the address tenants send "via" until their own domain is
    // verified — the settings page previews the exact From line with it.
    return c.json({ domains, resendAvailable: resendAvailable(), platformFrom: PLATFORM_FROM }, 200);
  })

  // Submit a new domain for approval (status starts "pending").
  .post("/email-domains", requireAdmin, async (c) => {
    const body = await parseBody(c, z.object({ domain: shortText("Domain", 253) }));
    const raw = body.domain.toLowerCase();
    // strip scheme / path / leading "www." and any from-address local part
    const domain = raw
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^.*@/, "")
      .replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
      return c.json({ message: "Enter a valid domain, e.g. mail.acme.com" }, 400);
    // Nobody can add DNS records to icloud.com / gmail.com — Apple and Google
    // own them and Resend refuses them outright. Say so here, in plain words,
    // instead of letting the request sit "pending" until approval fails.
    if (isFreeMailboxDomain(domain))
      return c.json(
        {
          message:
            `${domain} is a public mailbox provider, so it can't be verified — only a domain you own (like yourbusiness.com) can be. ` +
            `No problem though: leave this blank and your emails go out as "Your business name via ArrivePing", with replies landing in your ${domain} inbox. ` +
            `Just put your ${domain} address in the From or Reply-to field above.`,
        },
        400,
      );
    const existing = await tx(c).selectOne(
      schema.tenantEmailDomains,
      eq(schema.tenantEmailDomains.domain, domain),
    );
    if (existing) return c.json({ message: "Domain already submitted" }, 409);
    const user = c.get("user") as { id?: string } | undefined;
    const [row] = await tx(c).insert(schema.tenantEmailDomains, {
      domain,
      status: "pending",
      createdBy: user?.id || "",
    });
    return c.json({ domain: { ...row, records: [] } }, 201);
  })

  // Re-check verification with Resend (tenant "Check verification" button).
  .post("/email-domains/:id/check", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const row = await tx(c).selectOne(
      schema.tenantEmailDomains,
      eq(schema.tenantEmailDomains.id, id),
    );
    if (!row) return c.json({ message: "not found" }, 404);
    if (!row.resendDomainId)
      return c.json({ message: "Awaiting approval — not yet created in Resend." }, 409);
    const updated = await triggerVerify(id);
    if (!updated) return c.json({ message: "not found" }, 404);
    return c.json({ domain: { ...updated, records: safeParse(updated.records) } }, 200);
  })

  // Remove a domain (tenant-scoped; also removes it from Resend).
  .delete("/email-domains/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const row = await tx(c).selectOne(
      schema.tenantEmailDomains,
      eq(schema.tenantEmailDomains.id, id),
    );
    if (!row) return c.json({ message: "not found" }, 404);
    await removeDomain(id);
    return c.json({ ok: true }, 200);
  });

function safeParse(s: string | null | undefined) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}
