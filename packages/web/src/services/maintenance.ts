/**
 * Maintenance plans — recurring service agreements.
 *
 * A plan is "this address needs this service every N days". This module owns
 * the whole lifecycle:
 *
 *   activate/save plan  -> queue the next reminder task
 *   reminder fires      -> text the customer, notify the office, roll the due
 *                          date forward by intervalDays, queue the next one
 *   deactivate/delete   -> cancel the pending task so it goes quiet at once
 *
 * Reminders are best-effort notifications, not bookings: nothing is scheduled
 * on anyone's calendar automatically. The customer replies or taps through to
 * the intake form, and the office books it like any other job.
 */
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { and, eq } from "drizzle-orm";
import { registerTaskHandler, scheduleTask } from "./scheduler";
import { sendSms } from "./sms";
import { propertyUrl } from "./properties";
import { companyTimeZone } from "./company-tz";
import { fmtInZone } from "../shared/tz";

const KIND = "maintenance_reminder";

/** When the reminder for a given plan should go out. */
export function reminderRunAt(plan: {
  nextDueAt: Date | number | null;
  remindDaysBefore: number;
}): Date | null {
  if (!plan.nextDueAt) return null;
  const due = Number(plan.nextDueAt);
  const at = due - Math.max(0, plan.remindDaysBefore) * 86_400_000;
  // never queue in the past — a plan created late reminds right away
  return new Date(Math.max(at, Date.now() + 60_000));
}

/** Cancel any pending reminder for a plan (plan paused, deleted, rescheduled). */
export async function cancelPlanReminders(planId: string): Promise<void> {
  try {
    // A plan's pending reminder can be for any tenant and there is no
    // companyId to scope this scan by until it's decoded from the task's
    // JSON payload below, so the scan itself runs on the system connection;
    // each matching task's own cancel-update then goes back through tdb().
    const pending = await sdb
      .select()
      .from(schema.scheduledTasks)
      .where(
        and(
          eq(schema.scheduledTasks.kind, KIND),
          eq(schema.scheduledTasks.status, "pending"),
        ),
      );
    for (const task of pending) {
      let pid = "";
      try {
        pid = String(JSON.parse(task.payload || "{}").planId ?? "");
      } catch {
        /* ignore */
      }
      if (pid !== planId) continue;
      await tdb(task.companyId).update(
        schema.scheduledTasks,
        { status: "cancelled", completedAt: new Date() },
        eq(schema.scheduledTasks.id, task.id),
      );
    }
  } catch (e) {
    console.error("[maintenance] cancel failed", planId, e);
  }
}

/**
 * Sync the queued reminder to match the plan's current state.
 * Idempotent — safe to call on every create/update.
 */
export async function syncPlanReminder(planId: string): Promise<void> {
  try {
    // Pre-resolution: only a planId is known here, not its tenant.
    const [plan] = await sdb
      .select()
      .from(schema.maintenancePlans)
      .where(eq(schema.maintenancePlans.id, planId));
    if (!plan) return;

    await cancelPlanReminders(planId);
    if (!plan.active || !plan.nextDueAt) return;

    const runAt = reminderRunAt(plan);
    if (!runAt) return;
    await scheduleTask({
      companyId: plan.companyId,
      kind: KIND,
      propertyId: plan.propertyId,
      runAt,
      payload: { planId },
    });
  } catch (e) {
    console.error("[maintenance] sync failed", planId, e);
  }
}

/**
 * The words that actually go out for a maintenance reminder.
 *
 * Pure, and takes the tenant's zone explicitly, because the due DATE was being
 * rendered on the server's clock (UTC). A plan due 8pm Winnipeg is already the
 * next calendar day in UTC, so the customer was texted the wrong day.
 */
export function maintenanceReminderCopy(input: {
  company: string;
  what: string;
  dueAt: Date | number | null;
  address: string;
  hubUrl: string;
  tz: string;
}): { due: string; sms: string; officeTitle: string } {
  const due = fmtInZone(
    input.dueAt == null ? null : Number(input.dueAt),
    input.tz,
    { month: "short", day: "numeric" },
    "en-US",
    "soon",
  );
  const sms =
    `${input.company}: ${input.what} is due ${due}` +
    (input.address ? ` at ${input.address}` : "") +
    `. Reply to book a time.` +
    (input.hubUrl ? ` Service history: ${input.hubUrl}` : "");
  return { due, sms, officeTitle: `${input.what} due ${due}` };
}

// ── Scheduler handler ────────────────────────────────────────────────────────
registerTaskHandler(KIND, async (task) => {
  const planId = String((task.payload as any)?.planId ?? "");
  if (!planId) return;

  // task.companyId came from our own scheduleTask() call, so it's a
  // trustworthy tenant — no need to bypass RLS to look the plan up.
  const t0 = tdb(task.companyId);
  const plan = await t0.selectOne(schema.maintenancePlans, eq(schema.maintenancePlans.id, planId));
  if (!plan || !plan.active) return;
  const cs = await t0.selectOne(schema.companySettings);
  const company = cs?.name || "ArrivePing";

  // Customer text — with the property hub link so they can see the history
  // behind the recommendation instead of taking our word for it.
  let hubUrl = "";
  if (plan.propertyId) {
    const prop = await t0.selectOne(schema.properties, eq(schema.properties.id, plan.propertyId));
    if (prop) hubUrl = propertyUrl(prop.publicToken);
  }

  let phone = "";
  if (plan.customerId) {
    const cust = await t0.selectOne(schema.user, eq(schema.user.id, plan.customerId));
    phone = cust?.phone || "";
  }

  const what = plan.name || "your scheduled service";
  const copy = maintenanceReminderCopy({
    company,
    what,
    dueAt: plan.nextDueAt ? Number(plan.nextDueAt) : null,
    address: plan.address || "",
    hubUrl,
    tz: await companyTimeZone(plan.companyId),
  });

  if (phone) {
    const res = await sendSms(phone, copy.sms);
    if (!res.ok && !res.skipped) throw new Error(res.error || "sms failed");
  }

  // Office copy so nothing depends on the customer replying.
  const t = tdb(plan.companyId);
  const admins = await t.select(schema.user, eq(schema.user.role, "admin"));
  for (const a of admins) {
    await t.insert(schema.notifications, {
      userId: a.id,
      type: "maintenance_due",
      title: copy.officeTitle,
      body: plan.address || "Recurring maintenance plan is due.",
    });
  }

  // Roll forward and queue the next cycle.
  const nextDue = new Date(
    Number(plan.nextDueAt ?? Date.now()) +
      Math.max(1, plan.intervalDays) * 86_400_000,
  );
  await tdb(plan.companyId).update(
    schema.maintenancePlans,
    {
      nextDueAt: nextDue,
      remindersSent: (plan.remindersSent ?? 0) + 1,
    },
    eq(schema.maintenancePlans.id, planId),
  );

  await syncPlanReminder(planId);
});
