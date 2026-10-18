/**
 * Custom milestones: moments a company names itself ("Water restored",
 * "Day-before reminder"), next to the built-in ones.
 *
 * Four triggers:
 *   - stage           rides on a built-in event (dispatch.ts fireEvent calls onBuiltInEvent)
 *   - checklist       the tech ticks a checklist item with that label (bookings PATCH /:id/checklist)
 *   - before_start    a set time before the appointment (sweepCustomMilestones, once a minute)
 *   - after_complete  a set time after the job is completed (same sweep)
 *
 * Each goes off at most once per job: a row in custom_milestone_fires claims it
 * first (unique on milestone + job), so a double tick, a second server or a
 * tech unticking and re-ticking an item can't send it twice. The one exception
 * is a before-the-appointment reminder on a job that gets rescheduled: the
 * claim is released so the customer is reminded about the new time.
 *
 * Messages are ordinary notification_rules rows keyed `custom:<id>` (one per
 * recipient), so the Notifications table, its editor, branded email, quiet
 * hours and the delivery log all treat a custom milestone like a built-in one.
 * Sample jobs get the timeline line and nothing else (fireCustomEvent).
 */
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { and, eq, gte, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { fireCustomEvent, seedNotificationRules, type EventMeta } from "./dispatch";
import {
  MILESTONE_RECIPIENTS,
  customEventKey,
  milestoneProblem,
  normalizeChecklistLabel,
  type MilestoneRecipient,
  type MilestoneTrigger,
} from "../shared/custom-milestones";

export type CustomMilestone = typeof schema.customMilestones.$inferSelect;
type Rule = typeof schema.notificationRules.$inferSelect;

/** How late a timed milestone may still go out (a deploy, a slow tick). Older than this, it is skipped. */
export const GRACE_MS = 60 * 60_000;

/** Channels a recipient gets when a message is written for them: customers by text, staff in the app. */
const DEFAULT_CHANNELS: Record<MilestoneRecipient, { inApp: boolean; email: boolean; sms: boolean }> = {
  client: { inApp: true, email: false, sms: true },
  tech: { inApp: true, email: false, sms: false },
  office: { inApp: true, email: false, sms: false },
};

export function milestoneMeta(m: Pick<CustomMilestone, "name">): EventMeta {
  return { label: m.name, defaultTitle: m.name, notifType: "reminder" };
}

export interface MilestoneFields {
  name: string;
  trigger: MilestoneTrigger;
  triggerEvent?: string;
  checklistLabel?: string;
  offsetMinutes?: number;
  customerTimeline?: boolean;
}

/** Per recipient: whether they get a message, and what it says ({{vars}} allowed). */
export type MilestoneMessages = Partial<Record<MilestoneRecipient, { on: boolean; text: string }>>;

/** Keep only the field the trigger uses, so a milestone never carries a stale one. */
function triggerColumns(f: MilestoneFields) {
  return {
    name: f.name.trim(),
    trigger: f.trigger,
    triggerEvent: f.trigger === "stage" ? (f.triggerEvent ?? "") : "",
    checklistLabel: f.trigger === "checklist" ? (f.checklistLabel ?? "").trim().replace(/\s+/g, " ") : "",
    offsetMinutes: f.trigger === "before_start" || f.trigger === "after_complete" ? (f.offsetMinutes ?? 0) : 0,
  };
}

export async function listMilestones(companyId: string): Promise<CustomMilestone[]> {
  const rows = await tdb(companyId).select(schema.customMilestones);
  return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getMilestone(companyId: string, id: string): Promise<CustomMilestone | undefined> {
  return tdb(companyId).selectOne(schema.customMilestones, eq(schema.customMilestones.id, id));
}

/** The milestone's notification rules, one per recipient. */
export async function milestoneRules(companyId: string, id: string): Promise<Rule[]> {
  return tdb(companyId).select(schema.notificationRules, eq(schema.notificationRules.event, customEventKey(id)));
}

/**
 * Write the three recipient rules. A recipient switched on gets the message as
 * its copy and, if every channel was off, the default channels; switched off,
 * every channel goes off but the words are kept, so switching back on restores
 * them. A recipient not mentioned is left exactly as it is.
 */
async function writeRules(companyId: string, id: string, messages: MilestoneMessages) {
  const t = tdb(companyId);
  const event = customEventKey(id);
  const existing = await milestoneRules(companyId, id);
  for (const recipient of MILESTONE_RECIPIENTS) {
    const row = existing.find((r) => r.recipient === recipient);
    const msg = messages[recipient];
    const on = !!msg?.on && !!msg.text.trim();
    const text = msg?.text.trim() ?? "";
    if (!row) {
      const channels = on ? DEFAULT_CHANNELS[recipient] : { inApp: false, email: false, sms: false };
      await t.insert(schema.notificationRules, { event, recipient, ...channels, webhook: false, template: text, enabled: true });
      continue;
    }
    if (!msg) continue;
    if (on) {
      const anyOn = row.inApp || row.email || row.sms || row.webhook;
      await t.update(
        schema.notificationRules,
        { template: text, ...(anyOn ? {} : DEFAULT_CHANNELS[recipient]), enabled: true, updatedAt: new Date() },
        eq(schema.notificationRules.id, row.id),
      );
    } else {
      await t.update(
        schema.notificationRules,
        { inApp: false, email: false, sms: false, webhook: false, updatedAt: new Date() },
        eq(schema.notificationRules.id, row.id),
      );
    }
  }
}

export class MilestoneError extends Error {}

export async function createMilestone(
  companyId: string,
  fields: MilestoneFields,
  messages: MilestoneMessages = {},
): Promise<CustomMilestone> {
  const problem = milestoneProblem(fields);
  if (problem) throw new MilestoneError(problem);
  // The built-in matrix is seeded "if the company has no rules yet". A custom
  // milestone's rows must never be what makes a new company look seeded.
  await seedNotificationRules(companyId);
  const [m] = await tdb(companyId).insert(schema.customMilestones, {
    ...triggerColumns(fields),
    customerTimeline: !!fields.customerTimeline,
    enabled: true,
  });
  if (!m) throw new Error("failed to create milestone");
  await writeRules(companyId, m.id, messages);
  return m;
}

export async function updateMilestone(
  companyId: string,
  id: string,
  patch: Partial<MilestoneFields> & { enabled?: boolean },
  messages?: MilestoneMessages,
): Promise<CustomMilestone | null> {
  const cur = await getMilestone(companyId, id);
  if (!cur) return null;
  const merged: MilestoneFields = {
    name: patch.name ?? cur.name,
    trigger: (patch.trigger ?? cur.trigger) as MilestoneTrigger,
    triggerEvent: patch.triggerEvent ?? cur.triggerEvent,
    checklistLabel: patch.checklistLabel ?? cur.checklistLabel,
    offsetMinutes: patch.offsetMinutes ?? cur.offsetMinutes,
  };
  const problem = milestoneProblem(merged);
  if (problem) throw new MilestoneError(problem);
  const [m] = await tdb(companyId).update(
    schema.customMilestones,
    {
      ...triggerColumns(merged),
      customerTimeline: patch.customerTimeline ?? cur.customerTimeline,
      enabled: patch.enabled ?? cur.enabled,
      updatedAt: new Date(),
    },
    eq(schema.customMilestones.id, id),
  );
  if (messages) await writeRules(companyId, id, messages);
  return m ?? null;
}

/** Remove the milestone, its messages and its once-per-job record. Past timeline lines stay. */
export async function deleteMilestone(companyId: string, id: string): Promise<boolean> {
  const cur = await getMilestone(companyId, id);
  if (!cur) return false;
  const t = tdb(companyId);
  await t.delete(schema.notificationRules, eq(schema.notificationRules.event, customEventKey(id)));
  await t.delete(schema.customMilestoneFires, eq(schema.customMilestoneFires.milestoneId, id));
  await t.delete(schema.customMilestones, eq(schema.customMilestones.id, id));
  return true;
}

/** Checklist item labels used in the company's templates, for the dialog's suggestions. */
export async function checklistLabels(companyId: string): Promise<string[]> {
  const templates = await tdb(companyId).select(schema.taskTemplates);
  const seen = new Map<string, string>();
  for (const tpl of templates) {
    let items: unknown = [];
    try {
      items = JSON.parse(tpl.checklist || "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const label = typeof it === "string" ? it : typeof it?.label === "string" ? it.label : "";
      const clean = label.trim().replace(/\s+/g, " ");
      if (clean && !seen.has(normalizeChecklistLabel(clean))) seen.set(normalizeChecklistLabel(clean), clean);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 300);
}

/**
 * Fire one milestone on one job, at most once. Returns whether it went off.
 * `test` (the admin's Test button) skips the once-per-job claim and the
 * timeline line: it only shows what the messages look like.
 */
export async function fireMilestone(m: CustomMilestone, bookingId: string, opts: { test?: boolean } = {}): Promise<boolean> {
  if (!opts.test) {
    const claimed = await tdb(m.companyId).transaction((tx) =>
      tx
        .insert(schema.customMilestoneFires)
        .values({ companyId: m.companyId, milestoneId: m.id, bookingId })
        .onConflictDoNothing()
        .returning({ id: schema.customMilestoneFires.id }),
    );
    if (!claimed.length) return false;
  }
  await fireCustomEvent({
    companyId: m.companyId,
    bookingId,
    milestoneId: m.id,
    meta: milestoneMeta(m),
    customerVisible: m.customerTimeline,
    timeline: !opts.test,
  });
  return true;
}

/** Called by fireEvent after every built-in event on a job. */
export async function onBuiltInEvent(event: string, b: { id: string; companyId: string }): Promise<void> {
  const t = tdb(b.companyId);
  const ms = await t.select(schema.customMilestones, eq(schema.customMilestones.enabled, true));
  if (!ms.length) return;
  if (event === "rescheduled") {
    // The appointment moved: a reminder that already went out was about the
    // old time, so let it go again for the new one.
    const timed = ms.filter((m) => m.trigger === "before_start").map((m) => m.id);
    if (timed.length) {
      await t.delete(
        schema.customMilestoneFires,
        and(eq(schema.customMilestoneFires.bookingId, b.id), inArray(schema.customMilestoneFires.milestoneId, timed)),
      );
    }
  }
  for (const m of ms) {
    if (m.trigger === "stage" && m.triggerEvent === event) await fireMilestone(m, b.id);
  }
}

/** Called when a tech ticks a checklist item on a job (not when they untick it). */
export async function onChecklistTicked(companyId: string, bookingId: string, label: string): Promise<number> {
  const key = normalizeChecklistLabel(label);
  if (!key) return 0;
  const ms = await tdb(companyId).select(
    schema.customMilestones,
    and(eq(schema.customMilestones.enabled, true), eq(schema.customMilestones.trigger, "checklist")),
  );
  let fired = 0;
  for (const m of ms) {
    if (normalizeChecklistLabel(m.checklistLabel) === key && (await fireMilestone(m, bookingId))) fired++;
  }
  return fired;
}

/**
 * The two timed triggers. Nothing happens on a job at "2 hours before" or
 * "3 days after", so they are swept once a minute (server.ts). A milestone
 * fires for a job whose moment has passed within the last hour (GRACE_MS),
 * so a restart doesn't lose one and an old job is never suddenly messaged.
 */
export async function sweepCustomMilestones(now: Date = new Date()): Promise<{ fired: number }> {
  const result = { fired: 0 };
  // sdb (BYPASSRLS): one cross-tenant read to find which companies have a
  // timed milestone at all; everything after is scoped to that company.
  const ms = await sdb
    .select()
    .from(schema.customMilestones)
    .where(
      and(
        eq(schema.customMilestones.enabled, true),
        inArray(schema.customMilestones.trigger, ["before_start", "after_complete"]),
      ),
    );
  const nowMs = now.getTime();
  for (const m of ms) {
    try {
      const t = tdb(m.companyId);
      const off = m.offsetMinutes * 60_000;
      let jobs: { id: string }[];
      if (m.trigger === "before_start") {
        // moment = scheduledAt - offset, wanted in [now - grace, now]
        const rows = await t.select(
          schema.bookings,
          and(
            gte(schema.bookings.scheduledAt, new Date(nowMs - GRACE_MS + off)),
            lte(schema.bookings.scheduledAt, new Date(nowMs + off)),
            notInArray(schema.bookings.status, ["completed", "cancelled"]),
            isNull(schema.bookings.deletedAt),
          ),
        );
        // A job booked after its reminder time ("1 hour before" on a job made
        // 20 minutes out) doesn't get a reminder seconds after it was booked.
        jobs = rows.filter(
          (b) => new Date(b.createdAt).getTime() <= new Date(b.scheduledAt).getTime() - off,
        );
      } else {
        // moment = finishedAt + offset, wanted in [now - grace, now]
        jobs = await t.select(
          schema.bookings,
          and(
            eq(schema.bookings.status, "completed"),
            gte(schema.bookings.finishedAt, new Date(nowMs - GRACE_MS - off)),
            lte(schema.bookings.finishedAt, new Date(nowMs - off)),
            isNull(schema.bookings.deletedAt),
          ),
        );
      }
      for (const b of jobs) {
        if (await fireMilestone(m, b.id)) result.fired++;
      }
    } catch (e) {
      console.error("[custom-milestones] sweep failed for", m.id, e);
    }
  }
  return result;
}
