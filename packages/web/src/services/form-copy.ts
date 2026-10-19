/**
 * Job forms v2: email the customer a copy of the filled form when the job is
 * done, if the job's template has "Email the customer a copy" on
 * (task_templates.sendCustomerCopy).
 *
 * Sent on its own, after the job is completed and its form closed
 * (POST /api/bookings/:id/status), not folded into the "job completed"
 * notification: that one is driven by the company's notification rules and
 * goes out before the form is closed. Uses the company's sender and email
 * brand (resolveFromAddress / loadEmailBrand) like every other system email,
 * honours the company's email master switch, and logs to the delivery log.
 *
 * Only what the customer may see: answered questions, never office-only
 * (internal) ones, never flags. Never throws.
 */
import { and, eq } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { formResults } from "../shared/forms/form-results";
import { isUndeliverableEmail } from "../shared/sample-contact";
import { emailTemplates, loadEmailBrand, resolveFromAddress, sendEmail } from "./email";
import { jobForm } from "./job-forms";
import { trackingUrl } from "./sms";

export type FormCopyResult = { sent: true } | { sent: false; reason: string };

/** Swappable in tests (the way services/welcome.ts takes `deps.send`). */
export const formCopyDeps: { send: typeof sendEmail } = { send: sendEmail };

export async function sendFormCopy(companyId: string, bookingId: string, deps = formCopyDeps): Promise<FormCopyResult> {
  try {
    const t = tdb(companyId);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    if (!b?.templateVersionId) return { sent: false, reason: "not a forms job" };
    if (b.isSample) return { sent: false, reason: "sample" };
    const v = await t.selectOne(schema.templateVersions, eq(schema.templateVersions.id, b.templateVersionId));
    const tpl = v ? await t.selectOne(schema.taskTemplates, eq(schema.taskTemplates.id, v.templateId)) : undefined;
    if (!tpl?.sendCustomerCopy) return { sent: false, reason: "off" };

    const [cust] = await sdb.select().from(schema.user).where(eq(schema.user.id, b.customerId));
    const to = (cust?.email || "").trim();
    if (!to || cust?.isSample || isUndeliverableEmail(to)) return { sent: false, reason: "no email" };

    const log = async (status: "sent" | "failed" | "skipped", detail = "") => {
      await t
        .insert(schema.notificationDeliveries, { event: "form_copy", bookingId: b.id, recipient: "client", channel: "email", target: to, status, detail })
        .catch((e) => console.error("[form-copy] log failed", e));
    };

    // Once per job: the office re-marking a finished job "completed" (or a
    // retried request) doesn't send the customer a second copy.
    const already = await t.select(
      schema.notificationDeliveries,
      and(eq(schema.notificationDeliveries.bookingId, b.id), eq(schema.notificationDeliveries.event, "form_copy"), eq(schema.notificationDeliveries.status, "sent")),
    );
    if (already.length) return { sent: false, reason: "already sent" };

    const chan = await t.selectOne(schema.notificationChannels);
    if (chan && !chan.emailEnabled) {
      await log("skipped", "Emails are switched off for your company on the Channels tab.");
      return { sent: false, reason: "email off" };
    }

    const f = await jobForm(companyId, b);
    if (!f) return { sent: false, reason: "no form" };
    const sections = formResults(f, "customer")
      .map((g) => ({
        title: g.section?.label ?? "",
        rows: g.rows.filter((r) => r.answered).map((r) => ({ label: r.item.label, value: r.text })),
      }))
      .filter((s) => s.rows.length);
    if (!sections.length) return { sent: false, reason: "nothing answered" };

    const svc = b.serviceId ? await t.selectOne(schema.services, eq(schema.services.id, b.serviceId)) : undefined;
    const [brand, sender] = await Promise.all([loadEmailBrand(companyId), resolveFromAddress(companyId)]);
    const mail = emailTemplates.formCopy(
      {
        customerName: (cust?.name || "").trim().split(/\s+/)[0] || "there",
        formName: f.templateName || tpl.name,
        serviceName: svc?.name || b.title || "service",
        sections,
        // The tracking link becomes the customer's permanent job record once
        // the job is completed (services/booking-status.ts).
        url: b.publicToken ? trackingUrl(b.publicToken) : undefined,
      },
      brand,
    );
    const r = (await deps.send({ to, subject: mail.subject, html: mail.html, text: mail.text, ...sender })) as {
      ok?: boolean;
      skipped?: boolean;
      error?: string;
    };
    if (r?.ok === false && !r.skipped) {
      await log("failed", r.error || "");
      return { sent: false, reason: "send failed" };
    }
    if (r?.skipped) {
      await log("skipped", "email not configured");
      return { sent: false, reason: "email not configured" };
    }
    await log("sent");
    return { sent: true };
  } catch (e) {
    console.error("[form-copy] failed", bookingId, e);
    return { sent: false, reason: "error" };
  }
}
