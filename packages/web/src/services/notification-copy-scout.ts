/**
 * Notification Copy Scout — generates BRANDED, INDUSTRY-SPECIFIC SMS/email
 * copy for a brand-new tenant during provisioning, so the messages a
 * customer/tech actually receives sound like they came from "this sports
 * club" or "this HVAC shop", not a generic dispatch platform.
 *
 * This is copy only, not channel selection — notification-presets.ts already
 * decides WHICH channels fire per event/recipient per ICP archetype. This
 * scout decides WHAT THE MESSAGE SAYS, grounded in:
 *   - the tenant's own terminology (jobNoun/customerNoun/workerNoun)
 *   - the deep per-ICP research (icp_knowledge_base.toneRefinement +
 *     notificationRefinement — see /home/user/icp-research/<slug>/04-*.md)
 *   - the tenant's own scraped website (name/description/services)
 *
 * The result is a CopyMap keyed `${event}:${recipient}`, each entry an
 * optional `sms` (the {{var}}-templated message body — also reused as the
 * plain-text/legacy-HTML email body, per dispatch.ts's fireEvent) and an
 * optional `emailSubject`. It is written straight into notification_rules'
 * existing `template` / `emailSubject` override columns via
 * seedNotificationRules()'s optional second argument — no new schema.
 *
 * Best-effort and non-blocking: on any failure this returns {} and
 * provisioning/notifications fall back to the generic copy already shipped
 * in dispatch.ts's defaultMessage().
 */
import { generateObject } from "ai";
import { z } from "zod";
import { gateway, MODELS } from "../api/agent/gateway";
import { log } from "../api/lib/logger";
import type { NvcEvent, Recipient } from "./dispatch";
import { TEMPLATE_VARS } from "./dispatch";
import { getIndustryPreset } from "./industry-presets";
import { siteBlock } from "./scout-prompt";

export interface IcpKnowledgeForCopy {
  summary?: string | null;
  toneRefinement?: string | null;
  notificationRefinement?: string | null;
  terminologyNotes?: string | null;
}

export interface NotificationCopyInput {
  name: string;
  industry?: string | null;
  industryOther?: string | null;
  website?: string | null;
  description?: string | null;
  services?: string[];
  workerNoun?: string | null;
  workerNounPlural?: string | null;
  customerNoun?: string | null;
  jobNoun?: string | null;
  brandColor?: string | null;
  knowledge?: IcpKnowledgeForCopy | null;
  // Verbatim excerpts of the tenant's own website (item D) — the writer
  // matches THEIR voice and claims first; ICP tone is the fallback.
  siteExcerpts?: string | null;
}

export type CopyKey = `${NvcEvent}:${Recipient}`;
export type CopyOverride = { sms?: string; emailSubject?: string };
export type CopyMap = Partial<Record<CopyKey, CopyOverride>>;

/**
 * The event:recipient pairs worth spending a generation call on — the ones a
 * customer or tech actually reads, where brand voice and industry tone
 * matter. Office-only rows and rarely-seen events stay on the generic
 * defaultMessage() copy; there is no reader to brand it for.
 */
const COPY_TARGETS: { event: NvcEvent; recipient: Recipient }[] = [
  { event: "created", recipient: "client" },
  { event: "assigned", recipient: "client" },
  { event: "assigned", recipient: "tech" },
  { event: "accepted", recipient: "client" },
  { event: "enroute", recipient: "client" },
  { event: "arrived", recipient: "client" },
  { event: "completed", recipient: "client" },
  { event: "cancelled", recipient: "client" },
  { event: "delayed", recipient: "client" },
  { event: "receipt", recipient: "client" },
  { event: "rescheduled", recipient: "client" },
  { event: "change_requested", recipient: "client" },
];

const ALLOWED_VAR_NAMES = new Set(TEMPLATE_VARS.map((v) => v.key as string));

/** Strip any {{token}} the model invented that isn't a real template var — never ship a broken interpolation. */
function sanitizeTemplate(s: string): string {
  return s.replace(/\{\{(\w+)\}\}/g, (whole, name) => (ALLOWED_VAR_NAMES.has(name) ? whole : ""));
}

function knowledgeBlock(k: IcpKnowledgeForCopy | null | undefined): string {
  if (!k) return "";
  const lines: string[] = [];
  if (k.summary) lines.push(`Industry context: ${k.summary}`);
  if (k.toneRefinement) lines.push(`Tone this industry expects: ${k.toneRefinement}`);
  if (k.notificationRefinement) lines.push(`What this industry's research says about notifications specifically (event, audience, why it matters): ${k.notificationRefinement}`);
  if (k.terminologyNotes) lines.push(`Industry terminology to weave in naturally: ${k.terminologyNotes}`);
  if (!lines.length) return "";
  return `\n\nDEEP INDUSTRY RESEARCH (more authoritative than generic assumptions — reflect its tone and vocabulary):\n${lines.join("\n")}`;
}

const CopySchema = z.object({
  messages: z
    .array(
      z.object({
        event: z.enum([
          "created", "assigned", "accepted", "enroute", "arrived", "completed",
          "cancelled", "delayed", "receipt", "rescheduled", "change_requested",
        ]),
        recipient: z.enum(["client", "tech"]),
        sms: z
          .string()
          .min(10)
          .max(320)
          .describe(
            "The message body, SMS-length (<=320 chars). Also reused as the plain-text/basic-HTML email body when the tenant hasn't designed a rich email block layout, so keep it complete and readable on its own, not SMS-terse to the point of dropping information.",
          ),
        emailSubject: z
          .string()
          .min(4)
          .max(90)
          .describe("Short, specific email subject line for this same event, in the same voice."),
      }),
    )
    .min(1)
    .describe("One entry per requested event:recipient pair — cover every pair listed, do not invent new ones or skip any."),
});

/**
 * Generate branded, industry-tuned copy for the key customer/tech-facing
 * notification events. Never throws — returns {} on any failure so
 * provisioning always falls back to the generic copy already in dispatch.ts.
 */
export async function scoutNotificationCopy(input: NotificationCopyInput): Promise<CopyMap> {
  const preset = getIndustryPreset(input.industry);
  const jobNoun = (input.jobNoun || preset?.jobNoun || "Job").trim();
  const customerNoun = (input.customerNoun || preset?.customerNoun || "Customer").trim();
  const workerNoun = (input.workerNoun || preset?.workerNoun || "Technician").trim();
  const industryLine = preset
    ? `${preset.label} — write copy that sounds like it came from someone who actually runs this kind of business.`
    : input.industry === "other" && input.industryOther
      ? `${input.industryOther} (no exact preset — use this description as the primary guide).`
      : "(not specified — infer tone from the company name/services)";
  const toneLine = preset ? `\nBASELINE TONE FOR THIS INDUSTRY: ${preset.aiTone}` : "";
  const servicesLine = input.services?.length ? input.services.join(", ") : "(unknown)";
  const research = knowledgeBlock(input.knowledge);
  const site = siteBlock(input.siteExcerpts, 2_500);
  const targetsLine = COPY_TARGETS.map((t) => `${t.event}:${t.recipient}`).join(", ");
  const varsLine = TEMPLATE_VARS.map((v) => `{{${v.key}}} = ${v.label}`).join("\n  ");

  try {
    const { object } = await generateObject({
      // Deep reasoning model: 12 messages have to read as one consistent
      // brand voice, grounded in the ICP research's tone/notification
      // refinement, without drifting into generic customer-service filler
      // or breaking the strict per-event instructions/schema — the same
      // bar item 6's qualifying chat is held to, and it runs once per
      // tenant at signup so the extra latency/cost is a non-issue.
      model: gateway(MODELS.reasoning),
      schema: CopySchema,
      prompt: `You are writing the SMS + email copy a dispatch/field-service platform sends on behalf of "${input.name}", a ${industryLine}

WEBSITE: ${input.website || "(unknown)"}
DESCRIPTION: ${input.description || "(none)"}
SERVICES: ${servicesLine}
THIS TENANT CALLS A WORK ORDER: "${jobNoun}" (and its plural naturally)
THIS TENANT CALLS THE PEOPLE THEY SERVE: "${customerNoun}"
THIS TENANT CALLS ITS FIELD WORKERS: "${workerNoun}"${toneLine}${research}${site}

${site ? "VOICE: write the way the company's OWN WEBSITE above talks — same register, same phrasing habits, and reuse their real differentiators (24/7, free estimates, licensed & insured, family-owned, guarantees, years in business) where a message naturally has room for one. The BASELINE TONE for the industry is the fallback, not the override.\n\n" : ""}Every message is sent FROM "${input.name}" TO one of their own ${customerNoun.toLowerCase()}s or ${workerNoun.toLowerCase()}s — write in ${input.name}'s voice, not the dispatch platform's. Use "${jobNoun}"/"${customerNoun}"/"${workerNoun}" instead of generic "job"/"customer"/"technician" wherever it reads naturally — do not force it into every sentence if it gets awkward.

Available template variables (use {{name}} exactly as spelled, only from this list — anything else will be stripped):
  ${varsLine}

Write copy for EXACTLY these event:recipient pairs (cover every one, in this exact spelling): ${targetsLine}

For each:
- event="created": tell the ${customerNoun.toLowerCase()} (recipient=client) their request came in.
- event="assigned": tell the ${customerNoun.toLowerCase()} who's assigned (client), AND tell the ${workerNoun.toLowerCase()} they have a new offer to accept/decline (tech).
- event="accepted": confirm to the ${customerNoun.toLowerCase()} that a ${workerNoun.toLowerCase()} is locked in.
- event="enroute": tell the ${customerNoun.toLowerCase()} their ${workerNoun.toLowerCase()} is on the way, must include {{trackUrl}}.
- event="arrived": tell the ${customerNoun.toLowerCase()} their ${workerNoun.toLowerCase()} has arrived.
- event="completed": tell the ${customerNoun.toLowerCase()} the work is done — this is a relationship-building moment, make it feel finished and cared-for, may reference {{propertyUrl}} if natural.
- event="cancelled": tell the ${customerNoun.toLowerCase()} their ${jobNoun.toLowerCase()} was cancelled, calmly.
- event="delayed": tell the ${customerNoun.toLowerCase()} the ${workerNoun.toLowerCase()} is running late — state the delay and new time plainly, no groveling, must include {{trackUrl}}.
- event="receipt": send the payment receipt, must include {{price}}.
- event="rescheduled": tell the ${customerNoun.toLowerCase()} their appointment moved to the new time.
- event="change_requested": acknowledge the ${customerNoun.toLowerCase()}'s change request was received and is being reviewed — nothing has changed yet.

Keep every message specific to this business and this industry's real tone — not generic customer-service filler ("Thank you for your business!", "We appreciate you") unless the industry research above genuinely calls for that register.`,
    });

    const map: CopyMap = {};
    for (const m of object.messages || []) {
      const key = `${m.event}:${m.recipient}` as CopyKey;
      if (!COPY_TARGETS.some((t) => `${t.event}:${t.recipient}` === key)) continue; // ignore anything off-menu
      map[key] = {
        sms: sanitizeTemplate(String(m.sms || "").trim()).slice(0, 320),
        emailSubject: sanitizeTemplate(String(m.emailSubject || "").trim()).slice(0, 90),
      };
    }
    if (Object.keys(map).length === 0) {
      log.warn("notification-copy-scout: model returned no usable copy; falling back to generic", { company: input.name });
      return {};
    }
    return map;
  } catch (e) {
    log.warn("notification-copy-scout: generation failed; falling back to generic", {
      company: input.name,
      err: String(e),
    });
    return {};
  }
}
