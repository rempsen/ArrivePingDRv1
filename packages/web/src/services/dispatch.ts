/**
 * Central event dispatch engine.
 *
 * fireEvent(event, bookingId) is the single entry point the booking lifecycle
 * calls whenever something happens. It looks up the configurable notification
 * rules (event × recipient × channel), resolves the actual recipients (client /
 * tech / office), and delivers across in-app, email, SMS, and webhook — logging
 * every delivery for the admin Notifications module.
 */
import { db, sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail, PLATFORM_FROM } from "./email";
import { renderEmail, renderPlainMessage, type EmailBrand } from "../shared/email/render";
import { EMAIL_SAMPLE_VARS, designToText, normalizeDesign, normalizeTheme, parseDesign, type EmailTheme } from "../shared/email/design";
import { verifiedDomainsForCompany } from "./email-domains";
import { pickSender } from "./sender";
import { sendSms, trackingUrl } from "./sms";
import { sendPush } from "./push";
import { officeUsersAt } from "../api/lib/memberships";
import { applyNotificationOverrides } from "./notification-presets";
import { logJobEvent, type JobEventKind } from "./job-events";
import { propertyUrl } from "./properties";
import { companyTimeZone } from "./company-tz";
import { zonedMinutesOfDay } from "../shared/tz";
import { runAutomations, EVENT_TO_TRIGGER } from "./automation";
import { scheduleReviewRequest } from "./reviews";
import { publishDispatch } from "./realtime";

export type NvcEvent =
  | "created"
  | "assigned"
  | "accepted"
  | "declined"
  | "released"
  | "enroute"
  | "arrived"
  | "started"
  | "completed"
  | "cancelled"
  // Customer-initiated appointment changes (shared/change-policy.ts). Separate
  // events on purpose: "the customer is asking for something" is an office
  // to-do, while "the appointment actually moved" is news for the tech and a
  // confirmation for the customer.
  | "change_requested"
  | "change_declined"
  | "rescheduled"
  // The tech is going to miss the promised time. Fired by the running-late
  // sweep (services/delay-watch.ts), not by anything the tech taps: the whole
  // point is that nobody has to remember to send it.
  | "delayed"
  | "receipt";

export type Recipient = "client" | "tech" | "office";

export const EVENT_META: Record<
  NvcEvent,
  { label: string; defaultTitle: string; notifType: string }
> = {
  created: { label: "Work order created", defaultTitle: "New work order", notifType: "reminder" },
  assigned: { label: "Tech assigned", defaultTitle: "You've been assigned a job", notifType: "assigned" },
  accepted: { label: "Tech accepts", defaultTitle: "Technician accepted the job", notifType: "assigned" },
  declined: { label: "Tech declines", defaultTitle: "Technician declined the job", notifType: "reminder" },
  // A tech bailing on a job they already ACCEPTED (van broke down, emergency,
  // running too late). Separate from "declined" on purpose: declining an offer
  // is routine, dropping a committed job mid-flight is an operational problem
  // the office must see and re-dispatch.
  released: { label: "Tech releases an accepted job", defaultTitle: "Technician released a job back to dispatch", notifType: "reminder" },
  enroute: { label: "En route (on the way)", defaultTitle: "Your technician is on the way", notifType: "enroute" },
  arrived: { label: "Arrived", defaultTitle: "Your technician has arrived", notifType: "arrived" },
  started: { label: "Job started", defaultTitle: "Service has started", notifType: "reminder" },
  completed: { label: "Job completed", defaultTitle: "Job completed", notifType: "completed" },
  cancelled: { label: "Cancelled", defaultTitle: "Work order cancelled", notifType: "reminder" },
  change_requested: { label: "Customer requests a change", defaultTitle: "Customer requested a change", notifType: "reminder" },
  change_declined: { label: "Change request declined", defaultTitle: "We kept your appointment as booked", notifType: "reminder" },
  rescheduled: { label: "Appointment rescheduled", defaultTitle: "Appointment rescheduled", notifType: "reminder" },
  delayed: { label: "Running late", defaultTitle: "We're running behind", notifType: "reminder" },
  receipt: { label: "Payment / receipt", defaultTitle: "Payment receipt", notifType: "receipt" },
};

/** Default SMS / push copy per event+recipient. {{vars}} interpolated. */
function defaultMessage(event: NvcEvent, recipient: Recipient, v: Vars): string {
  const co = v.company;
  switch (event) {
    case "created":
      if (recipient === "client") return `${co}: We've received your request for ${v.service}. We'll confirm a technician shortly.`;
      return `${co}: New ${v.jobNoun.toLowerCase()} #${v.shortId} — ${v.service} at ${v.address}.`;
    case "assigned":
      if (recipient === "tech") return `${co}: New job offer — ${v.service} at ${v.address} on ${v.when}. Open the app to accept or decline.`;
      if (recipient === "client") return `${co}: ${v.techName} has been assigned to your ${v.service} appointment.`;
      return `${co}: ${v.techName} assigned to ${v.jobNoun.toLowerCase()} #${v.shortId}.`;
    case "accepted":
      if (recipient === "client") return `${co}: ${v.techName} accepted your ${v.service} job and is scheduled for ${v.when}.`;
      return `${co}: ${v.techName} accepted ${v.jobNoun.toLowerCase()} #${v.shortId}.`;
    case "declined":
      return `${co}: ${v.techName} declined ${v.jobNoun.toLowerCase()} #${v.shortId}. It's back in the dispatch queue.`;
    case "released":
      return `${co}: ${v.techName} can no longer do ${v.jobNoun.toLowerCase()} #${v.shortId} (${v.service} at ${v.address}). It's unassigned and back in the dispatch queue — needs a new tech.`;
    case "enroute":
      if (recipient === "client")
        return `${co}: Your technician ${v.techName} is on the way!${v.eta ? ` ETA ~${v.eta} min.` : ""} Track live, see ETA & message them: ${v.trackUrl}`;
      return `${co}: ${v.techName} is en route to ${v.jobNoun.toLowerCase()} #${v.shortId}.`;
    case "arrived":
      if (recipient === "client") return `${co}: ${v.techName} has arrived at your location.`;
      return `${co}: ${v.techName} arrived on site for #${v.shortId}.`;
    case "started":
      if (recipient === "client") return `${co}: ${v.techName} has started your ${v.service}.`;
      return `${co}: Service started on #${v.shortId}.`;
    case "completed":
      if (recipient === "client")
        return (
          `${co}: Your ${v.service} is complete. Thank you! ` +
          `Your record (photos, work done) + feedback: ${v.trackUrl}` +
          (v.propertyUrl ? ` · Full history for this address: ${v.propertyUrl}` : "")
        );
      return `${co}: #${v.shortId} completed by ${v.techName}.`;
    case "cancelled":
      return `${co}: ${v.jobNoun} #${v.shortId} (${v.service}) was cancelled.`;
    case "change_requested":
      if (recipient === "client")
        return `${co}: We've got your request for the ${v.service} appointment on ${v.when}. The office will confirm shortly — nothing has changed yet.`;
      if (recipient === "tech")
        return `${co}: The ${v.customerNoun.toLowerCase()} asked to change ${v.jobNoun.toLowerCase()} #${v.shortId} (${v.service} on ${v.when}). Dispatch is reviewing it.`;
      return `${co}: ${v.customerNoun} change request on ${v.jobNoun.toLowerCase()} #${v.shortId} — ${v.service} at ${v.address}, currently ${v.when}. Needs a decision.`;
    case "change_declined":
      if (recipient === "client")
        return `${co}: We weren't able to make that change — your ${v.service} appointment stays as booked for ${v.when}. Call us if that doesn't work.`;
      return `${co}: Change request declined on #${v.shortId} — still ${v.when}.`;
    case "rescheduled":
      if (recipient === "client")
        return `${co}: Your ${v.service} appointment is now ${v.when}. Details: ${v.trackUrl}`;
      if (recipient === "tech")
        return `${co}: Work order #${v.shortId} moved — ${v.service} at ${v.address} is now ${v.when}.`;
      return `${co}: #${v.shortId} rescheduled to ${v.when}.`;
    case "delayed":
      // Says the three things a waiting customer actually wants: that we know,
      // roughly how long, and where to look. No apology theatre, no promise we
      // can't keep, and no "sorry for any inconvenience caused".
      if (recipient === "client")
        return (
          `${co}: Update on your ${v.service} — we're running about ${v.delayMins} minutes behind, ` +
          `so ${v.techName} should reach you closer to ${v.newWhen}. ` +
          `Sorry to hold you up. Live status: ${v.trackUrl}`
        );
      if (recipient === "tech")
        return `${co}: #${v.shortId} (${v.address}) is now ~${v.delayMins} min late — the ${v.customerNoun.toLowerCase()} has been told you're arriving closer to ${v.newWhen}.`;
      return `${co}: #${v.shortId} is running ~${v.delayMins} min late (${v.service} at ${v.address}, promised ${v.when}). ${v.customerNoun} notified.`;
    case "receipt":
      return `${co}: Receipt for ${v.service} — $${v.price}. Thank you!`;
  }
}

interface Vars {
  company: string;
  service: string;
  jobName: string;
  jobNumber: string;
  firstName: string;
  techName: string;
  /** Absolute URL of the technician's headshot, "" when there isn't one. */
  techPhoto: string;
  address: string;
  when: string;
  eta: number | null;
  price: string;
  shortId: string;
  trackUrl: string;
  bookingUrl: string;
  workerNoun: string;
  /** Tenant's terminology for a job/work order, e.g. "Session" for a sports club. */
  jobNoun: string;
  /** Tenant's terminology for a customer, e.g. "Member" for a sports club. */
  customerNoun: string;
  /** Permanent, no-login property service-history hub. "" when unlinked. */
  propertyUrl: string;
  /** Rounded minutes late — only meaningful on a `delayed` notice. */
  delayMins: number;
  /** Revised arrival time in the company's timezone, e.g. "2:45 PM". */
  newWhen: string;
}

function interpolate(tpl: string, v: Vars): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String((v as any)[k] ?? ""));
}

/** Variables available to template authors, with descriptions (for the editor UI). */
export const TEMPLATE_VARS: { key: keyof Vars; label: string }[] = [
  { key: "company", label: "Company name" },
  { key: "firstName", label: "Customer first name" },
  { key: "jobName", label: "Job name" },
  { key: "jobNumber", label: "Job number" },
  { key: "service", label: "Service name" },
  { key: "techName", label: "Technician name" },
  { key: "workerNoun", label: "Tenant's word for a technician (e.g. \"Consultant\")" },
  { key: "address", label: "Job address" },
  { key: "when", label: "Scheduled date/time" },
  { key: "eta", label: "ETA (minutes)" },
  { key: "price", label: "Price" },
  { key: "shortId", label: "Work order # (short)" },
  { key: "trackUrl", label: "Live tracking link" },
  { key: "bookingUrl", label: "Booking link" },
  { key: "propertyUrl", label: "Property service-history link" },
  { key: "jobNoun", label: "Tenant's word for a job/work order (e.g. \"Session\")" },
  { key: "customerNoun", label: "Tenant's word for a customer (e.g. \"Member\")" },
  { key: "delayMins", label: "Minutes late (running-late notice)" },
  { key: "newWhen", label: "Revised arrival time (running-late notice)" },
];

/** Sample values used for live preview in the template editor. */
const SAMPLE_VARS: Vars = { ...EMAIL_SAMPLE_VARS };

/** Default copy for a given event+recipient (exposed so the editor can show/restore it). */
export function defaultTemplateFor(event: NvcEvent, recipient: Recipient): string {
  return defaultMessage(event, recipient, SAMPLE_VARS);
}

/** Render a template against sample data for preview. Empty => empty.
 *  `company` overrides SAMPLE_VARS.company so previews reflect the active
 *  tenant (e.g. "BMD Materials") instead of always showing "ArrivePing by NVC360". */
export function interpolateSample(tpl: string, company?: string): string {
  return interpolate(tpl, company ? { ...SAMPLE_VARS, company } : SAMPLE_VARS);
}

/**
 * Resolve the per-company notification channel config row, creating it lazily.
 * Tenancy: notification_channels is one-row-per-company (companyId is the key);
 * the legacy `id="default"` singleton is gone.
 */
async function channelConfig(companyId: string) {
  return tdb(companyId).selectOne(schema.notificationChannels);
}

/** Brand overrides the designer sends so previews and tests show unsaved changes. */
export interface BrandOverride {
  brandColor?: string;
  bgColor?: string;
  logoUrl?: string;
  logoHeight?: number;
  theme?: unknown;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A company's email brand: the channel row's colours/logo/footer plus its theme. */
export function emailBrandFrom(
  cfg: { emailLogoUrl?: string | null; emailLogoHeight?: number | null; emailBrandColor?: string | null; emailBgColor?: string | null; emailHeaderStyle?: string | null; emailFooter?: string | null; emailTheme?: string | null } | null | undefined,
  company: string,
  origin: string,
  over: BrandOverride = {},
): EmailBrand {
  const theme: EmailTheme = normalizeTheme(over.theme !== undefined ? over.theme : cfg?.emailTheme, cfg?.emailHeaderStyle);
  const color = over.brandColor && HEX.test(over.brandColor) ? over.brandColor : cfg?.emailBrandColor || "#06B6D4";
  const bg = over.bgColor && HEX.test(over.bgColor) ? over.bgColor : cfg?.emailBgColor || "#f1f5f9";
  const h = over.logoHeight !== undefined ? over.logoHeight : cfg?.emailLogoHeight;
  return {
    company,
    logoUrl: over.logoUrl !== undefined ? over.logoUrl : cfg?.emailLogoUrl || "",
    logoHeight: h && h >= 20 && h <= 400 ? h : undefined,
    brandColor: color,
    bgColor: bg,
    footer: cfg?.emailFooter || "",
    origin,
    theme,
  };
}

/** Render a design against sample data, for previews. */
export async function renderDesignPreview(companyId: string, design: unknown, opts?: { origin?: string; brand?: BrandOverride }): Promise<string> {
  const cfg = await channelConfig(companyId);
  const companyName = cfg?.emailFromName || SAMPLE_VARS.company;
  // {{company}} must reflect the ACTIVE tenant, not the hardcoded sample.
  const vars: Vars = { ...SAMPLE_VARS, company: companyName };
  return renderEmail(normalizeDesign(design), emailBrandFrom(cfg, companyName, opts?.origin || "", opts?.brand), vars);
}

/** Send a one-off test email rendered from a design (unsaved brand changes included). */
export async function sendDesignTest(
  companyId: string,
  to: string,
  subject: string,
  design: unknown,
  origin?: string,
  over?: BrandOverride,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const cfg = await channelConfig(companyId);
  const companyName = cfg?.emailFromName || SAMPLE_VARS.company;
  const vars: Vars = { ...SAMPLE_VARS, company: companyName };
  const d = normalizeDesign(design);
  const brand = emailBrandFrom(cfg, companyName, origin || "", over);
  const html = renderEmail(d, brand, vars);
  const text = designToText(d, vars);
  const sender = pickSender(
    { ...cfg, emailFromName: cfg?.emailFromName || SAMPLE_VARS.company },
    await verifiedDomainsForCompany(companyId).catch((): string[] => []),
    PLATFORM_FROM,
  );
  const subj = interpolate(subject || `${brand.company}: test email`, vars);
  const r: any = await sendEmail({ to, subject: `[TEST] ${subj}`, html, text, from: sender.from, replyTo: sender.replyTo }).catch((e) => ({ error: e?.message }));
  if (r?.skipped) return { ok: false, skipped: true };
  if (r?.error) return { ok: false, error: r.error };
  return { ok: true };
}

/**
 * Check whether a channel is globally enabled + outside quiet hours.
 *
 * Quiet hours are the tenant's LOCAL hours (the label in Notifications says
 * "24h local"). This used to read `new Date().getHours()`, which is the server
 * process time zone — UTC in production. A Winnipeg tenant asking for quiet
 * 21:00-08:00 actually got silence from 16:00 to 02:00 local: no customer SMS
 * all afternoon, and messages delivered at 3 AM.
 *
 * `now` is injectable so the window can be tested at a fixed instant.
 */
export async function channelAllowed(
  companyId: string,
  channel: "inApp" | "email" | "sms" | "webhook",
  now: Date = new Date(),
): Promise<boolean> {
  const cfg = await channelConfig(companyId);
  if (!cfg) return true;
  const master: Record<string, boolean> = {
    inApp: cfg.inAppEnabled, email: cfg.emailEnabled, sms: cfg.smsEnabled, webhook: cfg.webhookEnabled,
  };
  if (!master[channel]) return false;
  if (cfg.quietHoursEnabled && cfg.quietChannels.split(",").map((s) => s.trim()).includes(channel)) {
    const tz = await companyTimeZone(companyId);
    const cur = zonedMinutesOfDay(now, tz);
    const [sh = 0, sm = 0] = cfg.quietStart.split(":").map(Number);
    const [eh = 0, em = 0] = cfg.quietEnd.split(":").map(Number);
    const start = sh * 60 + sm, end = eh * 60 + em;
    const inQuiet = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
    if (inQuiet) return false;
  }
  return true;
}

async function logDelivery(row: {
  companyId: string;
  event: string;
  bookingId?: string;
  recipient: Recipient;
  channel: string;
  target?: string;
  status?: string;
  detail?: string;
}) {
  try {
    // row.companyId is already resolved by the caller — tenant-scoped write.
    await tdb(row.companyId).insert(schema.notificationDeliveries, {
      event: row.event,
      bookingId: row.bookingId ?? null,
      recipient: row.recipient,
      channel: row.channel,
      target: row.target ?? "",
      status: row.status ?? "sent",
      detail: row.detail ?? "",
    });
  } catch (e) {
    console.error("[dispatch] log failed", e);
  }
}

/** Resolve everything we need to message about a booking. Tenant is the booking's companyId. */
async function context(bookingId: string) {
  // Pre-tenant lookup: fireEvent is called with only a bookingId, before any
  // tenant is known. Every lookup after this one resolves companyId and goes
  // through tdb(companyId).
  const [b] = await sdb.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!b) return null;
  const companyId = b.companyId;
  const t = tdb(companyId);
  const svc = await t.selectOne(schema.services, eq(schema.services.id, b.serviceId));
  const cust = await t.selectOne(schema.user, eq(schema.user.id, b.customerId));
  let rider: any = null;
  let riderUser: any = null;
  if (b.riderId) {
    rider = await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId));
    if (rider) riderUser = await t.selectOne(schema.user, eq(schema.user.id, rider.userId));
  }
  const co = await t.selectOne(schema.companySettings);
  // Format in the COMPANY's timezone, not the server's. Every appointment time
  // in every outgoing SMS and email flows through here, so a bare
  // toLocaleString quoted UTC to a Winnipeg customer — the same bug that was
  // already fixed on-screen (shared/fmt-appointment.ts) was still going out in
  // the messages themselves.
  const tz = await companyTimeZone(companyId);
  const fmtWhen = (ms: number) =>
    new Date(ms).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz,
    });
  const when = b.scheduledAt ? fmtWhen(Number(b.scheduledAt)) : "TBD";
  // Revised arrival for a running-late notice: the promised time plus the slip
  // the customer is actually being told about.
  const delayMins = Number(b.delayNotifiedMins ?? b.delayFlaggedMins ?? 0);
  const newWhen =
    b.scheduledAt && delayMins > 0
      ? new Date(Number(b.scheduledAt) + delayMins * 60_000).toLocaleString("en-US", {
          hour: "numeric", minute: "2-digit", timeZone: tz,
        })
      : when;
  // Best-effort: the property hub link is a nice-to-have, never a reason to
  // fail a notification.
  let propToken = "";
  try {
    if (b.propertyId) {
      const prop = await t.selectOne(schema.properties, eq(schema.properties.id, b.propertyId));
      propToken = prop?.publicToken ?? "";
    }
  } catch {
    /* ignore */
  }
  const vars: Vars = {
    company: co?.name || "ArrivePing by NVC360",
    service: svc?.name || b.title || "service",
    jobName: b.title || svc?.name || "service",
    jobNumber: b.id.slice(0, 6).toUpperCase(),
    firstName: (cust?.name || "").trim().split(/\s+/)[0] || "there",
    techName: riderUser?.name || "your technician",
    techPhoto: absUrl(rider?.photoUrl || ""),
    address: b.address || "",
    when,
    eta: b.etaMins ?? null,
    price: (b.price ?? 0).toFixed(2),
    shortId: b.id.slice(0, 6).toUpperCase(),
    trackUrl: trackingUrl(b.publicToken),
    bookingUrl: trackingUrl(b.publicToken),
    workerNoun: co?.workerNoun || "Technician",
    jobNoun: co?.jobNoun || "Job",
    customerNoun: co?.customerNoun || "Customer",
    propertyUrl: propToken ? propertyUrl(propToken) : "",
    delayMins,
    newWhen,
  };
  return { b, companyId, svc, cust, rider, riderUser, co, vars };
}

/** Everyone running the office here: admins, managers, dispatchers, PMs (api/lib/memberships.ts). */
const officeUsers = officeUsersAt;

async function activeWebhooks(companyId: string, event: string) {
  const eps = await tdb(companyId).select(schema.webhookEndpoints, eq(schema.webhookEndpoints.active, true));
  return eps.filter((e) => e.events === "*" || e.events.split(",").map((s) => s.trim()).includes(event));
}

/**
 * Fire all configured notifications for an event on a booking.
 * Safe to await; individual channel failures are logged, never thrown.
 */
export async function fireEvent(event: NvcEvent, bookingId: string) {
  try {
    const ctx = await context(bookingId);
    if (!ctx) return;
    const { b, companyId, riderUser, vars } = ctx;

    // Append to the job's permanent timeline. Every lifecycle event in the
    // system funnels through fireEvent, so this single call is what gives the
    // customer-facing timeline and the permanent job record their history.
    // Visibility policy lives in job-events.ts, not here.
    await logJobEvent({
      companyId,
      bookingId: b.id,
      kind: event as JobEventKind,
      actorRole:
        event === "accepted" || event === "declined" || event === "released" ? "tech" : "system",
      actorName: riderUser?.name || "",
      detail:
        (event === "declined" || event === "released") && b.declineReason ? b.declineReason : "",
      meta: { status: b.status, service: vars.service },
    });

    // Every lifecycle change also refreshes open dispatch maps — sample-day
    // jobs included, they're on the map too.
    void publishDispatch(companyId, { kind: "job", jobId: b.id });

    // Sample-day jobs (services/sample-day.ts) keep their timeline but send
    // nothing: no automations, review asks, in-app/push, email, SMS or
    // webhooks. Office admins are real people and would otherwise be told
    // about a pretend job.
    if (!b.isSample) {
      await notifyForEvent(ctx, event).catch((e) => console.error("[dispatch] notify failed", event, e));
    }

    // Then any milestones the company made itself that ride on this event
    // ("Water restored" on job completed). Loaded lazily: custom-milestones.ts
    // imports this module. Sample jobs get those timeline lines too, and
    // fireCustomEvent below sends nothing for them.
    try {
      const { onBuiltInEvent } = await import("./custom-milestones");
      await onBuiltInEvent(event, b);
    } catch (e) {
      console.error("[dispatch] custom milestone hook failed", event, e);
    }
  } catch (e) {
    console.error("[dispatch] fireEvent failed", event, e);
  }
}

type DispatchContext = NonNullable<Awaited<ReturnType<typeof context>>>;

/** What a notification needs to know about the event it is for. */
export type EventMeta = { label: string; defaultTitle: string; notifType: string };

/** Automations, the review ask, then the built-in event's notification rules. */
async function notifyForEvent(ctx: DispatchContext, event: NvcEvent) {
  const { b, companyId, cust, vars } = ctx;
  // Automation rules + the post-completion review ask. Both are strictly
  // best-effort side effects: a failure here must never stop the real
  // notifications below from going out.
  try {
    const trigger = EVENT_TO_TRIGGER[event];
    if (trigger) {
      await runAutomations(trigger, {
        companyId,
        bookingId: b.id,
        vars: {
          ...(vars as unknown as Record<string, string | number | null>),
          customerName: cust?.name ?? "",
          customerPhone: b.customerPhone || cust?.phone || "",
          token: b.publicToken,
        },
        facts: {
          priority: b.priority,
          service: vars.service,
          status: b.status,
          region: b.region,
        },
      });
    }
    if (event === "completed") await scheduleReviewRequest(b.id);
  } catch (e) {
    console.error("[dispatch] automation/review hook failed", e);
  }

  await deliver(ctx, event, EVENT_META[event], (recipient) => defaultMessage(event, recipient, vars));
}

/**
 * Fire a milestone the company made itself (services/custom-milestones.ts) on
 * a job: its notification rules (event key `custom:<id>`) through the same
 * delivery path as a built-in event, so channels, quiet hours, branded email
 * and the delivery log all apply, then a line on the job's timeline.
 *
 * A custom milestone has no built-in copy: a recipient nobody wrote a message
 * for gets nothing in-app or by text. Sample jobs get the timeline line only.
 *
 * Returns "failed" when it broke before anything was sent (the caller lets
 * the milestone go again), "skipped" when the job isn't this company's or no
 * longer exists, and "done" otherwise. Once a message has gone out it is
 * "done" even if a later one failed, so nobody is ever messaged twice.
 */
export async function fireCustomEvent(input: {
  companyId: string;
  bookingId: string;
  milestoneId: string;
  meta: EventMeta;
  customerVisible: boolean;
  /** false for an admin's Test send: deliver, but leave the job's record alone. */
  timeline?: boolean;
}): Promise<"done" | "skipped" | "failed"> {
  const event = `custom:${input.milestoneId}`;
  try {
    const ctx = await context(input.bookingId);
    // The booking is looked up across tenants; a milestone only ever fires on
    // its own company's jobs.
    if (!ctx || ctx.companyId !== input.companyId) return "skipped";
    // Messages before the timeline line, so a failure before anything was
    // sent leaves no trace and the milestone can simply go again.
    if (!ctx.b.isSample) {
      const progress = { sending: false };
      try {
        await deliver(ctx, event, input.meta, () => "", progress);
      } catch (e) {
        if (!progress.sending) throw e;
        console.error("[dispatch] fireCustomEvent partly delivered", event, e);
      }
    }
    if (input.timeline !== false) {
      await logJobEvent({
        companyId: ctx.companyId,
        bookingId: ctx.b.id,
        kind: "milestone",
        actorRole: "system",
        label: input.meta.label,
        customerVisible: input.customerVisible,
        meta: { milestoneId: input.milestoneId },
      });
      void publishDispatch(ctx.companyId, { kind: "job", jobId: ctx.b.id });
    }
    return "done";
  } catch (e) {
    console.error("[dispatch] fireCustomEvent failed", event, e);
    return "failed";
  }
}

/**
 * Send one event's enabled notification rules to their recipients. `fallback`
 * is the copy for a recipient whose rule has no message of its own; an empty
 * message means nothing goes out in-app or by text (email still can, from a
 * designed email).
 */
async function deliver(
  ctx: DispatchContext,
  event: string,
  meta: EventMeta,
  fallback: (recipient: Recipient) => string,
  /** Set at the first message actually created or handed to a provider (see fireCustomEvent). */
  progress?: { sending: boolean },
) {
  const { b, companyId, cust, rider, riderUser, vars } = ctx;
  const rules = await tdb(companyId).select(
    schema.notificationRules,
    and(
      eq(schema.notificationRules.event, event),
      eq(schema.notificationRules.enabled, true),
    ),
  );

  // per-company channel gates (master switches + quiet hours)
  const [allowInApp, allowEmail, allowSms, allowWebhook] = await Promise.all([
    channelAllowed(companyId, "inApp"), channelAllowed(companyId, "email"), channelAllowed(companyId, "sms"), channelAllowed(companyId, "webhook"),
  ]);
  const env = await emailEnv(companyId, vars);
  const { emailFrom, emailReplyTo } = env;

  for (const rule of rules) {
    const recipient = rule.recipient as Recipient;
    const msg = rule.template ? interpolate(rule.template, vars) : fallback(recipient);

    // resolve targets per recipient
    let targets: { userId?: string; email?: string; phone?: string; name: string }[] = [];
    if (recipient === "client" && cust) {
      targets = [{ userId: cust.id, email: cust.email, phone: b.customerPhone || (cust as any).phone || "", name: cust.name }];
    } else if (recipient === "tech" && rider && riderUser) {
      targets = [{ userId: riderUser.id, email: riderUser.email, phone: rider.phone || (riderUser as any).phone || "", name: riderUser.name }];
    } else if (recipient === "office") {
      const admins = await officeUsers(companyId);
      targets = admins.map((a) => ({ userId: a.id, email: a.email, phone: (a as any).phone || "", name: a.name }));
    }

    for (const t of targets) {
      // in-app
      if (rule.inApp && allowInApp && t.userId && msg) {
        await tdb(companyId).insert(schema.notifications, {
          userId: t.userId,
          bookingId: b.id,
          type: meta.notifType,
          title: meta.defaultTitle,
          body: msg,
        });
        // The alert now exists: from here on, retrying would send it twice.
        if (progress) progress.sending = true;
        // Push to the recipient's devices (fire-and-forget). The tech app
        // relies on this for job assignment / enroute alerts when backgrounded.
        sendPush(t.userId, meta.defaultTitle, msg, {
          type: meta.notifType,
          event,
          bookingId: b.id,
          // Office users can be on several companies; the app switches to
          // this one before opening the job.
          companyId,
        }).catch(() => {});
        await logDelivery({ companyId, event, bookingId: b.id, recipient, channel: "in_app", target: t.userId, status: "sent" });
      }
      // email — use the rich block design when present, else the legacy text template
      // Nothing written for this recipient (a custom milestone with no message
      // and no designed email) sends no email: an empty one is worse than none.
      const mail = rule.email && allowEmail && t.email ? ruleEmail(rule, msg, meta, vars, env) : null;
      if (mail && t.email) {
        const { subject, html, text } = mail;
        // Marked before the attempt: a provider error can still mean it went.
        if (progress) progress.sending = true;
        const r = await sendEmail({ to: t.email, subject, html, text, from: emailFrom, replyTo: emailReplyTo }).catch((e) => ({ ok: false, error: e?.message }));
        await logDelivery({ companyId, event, bookingId: b.id, recipient, channel: "email", target: t.email, status: (r as any)?.ok === false ? "failed" : "sent", detail: (r as any)?.error || "" });
      }
      // sms
      if (rule.sms && allowSms && t.phone && msg) {
        if (progress) progress.sending = true;
        const r = await sendSms(t.phone, msg);
        await logDelivery({ companyId, event, bookingId: b.id, recipient, channel: "sms", target: t.phone, status: r.ok ? "sent" : r.skipped ? "skipped" : "failed", detail: r.error || (r.skipped ? "sms not configured" : r.sid || "") });
      }
    }

    // webhook (fire once per rule that enables it)
    if (rule.webhook && allowWebhook) {
      const eps = await activeWebhooks(companyId, event);
      for (const ep of eps) {
        const payload = {
          event,
          recipient,
          bookingId: b.id,
          shortId: vars.shortId,
          status: b.status,
          service: vars.service,
          tech: vars.techName,
          address: b.address,
          scheduledAt: b.scheduledAt,
          trackUrl: vars.trackUrl,
          label: meta.label,
          message: msg,
          at: new Date().toISOString(),
        };
        try {
          if (progress) progress.sending = true;
          const res = await fetch(ep.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(ep.secret ? { "X-Webhook-Secret": ep.secret } : {}) },
            body: JSON.stringify(payload),
          });
          await logDelivery({ companyId, event, bookingId: b.id, recipient, channel: "webhook", target: ep.url, status: res.ok ? "sent" : "failed", detail: `HTTP ${res.status}` });
        } catch (e: any) {
          await logDelivery({ companyId, event, bookingId: b.id, recipient, channel: "webhook", target: ep.url, status: "failed", detail: e?.message || "error" });
        }
      }
    }
  }
}

/** Sender, branding and template filling for a company's emails. */
async function emailEnv(companyId: string, vars: Vars) {
  // sender identity from channel config
  const chanCfg = await channelConfig(companyId);
  // Only honor a tenant's custom from-address if its domain is verified in
  // Resend. Otherwise fall through to undefined so email.ts uses its safe
  // shared sender (onboarding@resend.dev) and mail still goes out.
  const sender = pickSender(
    { ...chanCfg, emailFromName: chanCfg?.emailFromName || vars.company },
    await verifiedDomainsForCompany(companyId).catch((): string[] => []),
    PLATFORM_FROM,
  );
  const emailFooter = chanCfg?.emailFooter || "";
  const emailBrand = emailBrandFrom(chanCfg, vars.company, process.env.WEBSITE_URL || process.env.APP_URL || process.env.PUBLIC_URL || "");

  return {
    chanCfg,
    emailFrom: sender.from,
    emailReplyTo: sender.replyTo,
    emailFooter,
    emailBrand,
    interp: (s: string) => interpolate(s, vars),
  };
}

/** The email a rule would send: its designed email, else the plain message in the branded frame. */
function ruleEmail(
  rule: { emailDesign?: string | null; emailSubject?: string | null },
  msg: string,
  meta: EventMeta,
  vars: Vars,
  env: Awaited<ReturnType<typeof emailEnv>>,
): { subject: string; html: string; text?: string } | null {
  const design = parseDesign(rule.emailDesign);
  if (!design && !msg) return null;
  const subject = rule.emailSubject ? env.interp(rule.emailSubject) : `${vars.company}: ${meta.label}`;
  if (design) return { subject, html: renderEmail(design, env.emailBrand, vars), text: designToText(design, vars) };
  // No design: the plain message, escaped, in the same branded frame.
  return { subject, html: renderPlainMessage(meta.defaultTitle, msg, env.emailBrand, vars), text: msg };
}

/* ---------------------------------------------------------------- tests -- */

export type TestSendResult = {
  recipient: Recipient;
  /** The company's word for who this message is for ("Resident", "Property manager", "Office"). */
  recipientLabel: string;
  channel: "sms" | "email";
  status: "sent" | "failed" | "skipped";
  target: string;
  /** Plain words: what went wrong, or what to do. */
  detail: string;
};

/**
 * The Test button on an event: send each message the event's rules would
 * send (text and email, for every recipient switched on) to the person
 * testing, and to nobody else. The messages are filled in from the
 * company's latest job, sample-day ones included, or from example values
 * when there is no job yet; the job itself is never touched (no timeline
 * line, no automations, no webhooks). Quiet hours don't apply to a test;
 * a channel switched off on the Channels tab does, and says so.
 */
export async function sendTestMessages(input: {
  companyId: string;
  event: string;
  meta: EventMeta;
  to: { phone?: string; email?: string };
}): Promise<{ results: TestSendResult[]; jobLabel: string | null }> {
  const { companyId, event, meta } = input;
  const t = tdb(companyId);
  const jobs = await t.select(schema.bookings);
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const ctx = jobs[0] ? await context(jobs[0].id) : null;
  const co = ctx?.co ?? (await t.selectOne(schema.companySettings));
  const vars: Vars = ctx?.vars ?? {
    ...SAMPLE_VARS,
    company: co?.name || SAMPLE_VARS.company,
    workerNoun: co?.workerNoun || "Technician",
    jobNoun: co?.jobNoun || "Job",
    customerNoun: co?.customerNoun || "Customer",
  };
  const builtIn = (EVENT_META as Record<string, EventMeta | undefined>)[event] ? (event as NvcEvent) : null;
  const rules = await t.select(
    schema.notificationRules,
    and(eq(schema.notificationRules.event, event), eq(schema.notificationRules.enabled, true)),
  );
  const env = await emailEnv(companyId, vars);
  const label = (r: Recipient) => (r === "client" ? vars.customerNoun : r === "tech" ? vars.workerNoun : "Office");
  const order: Recipient[] = ["client", "tech", "office"];
  rules.sort((a, b) => order.indexOf(a.recipient as Recipient) - order.indexOf(b.recipient as Recipient));

  const results: TestSendResult[] = [];
  for (const rule of rules) {
    const recipient = rule.recipient as Recipient;
    const who = label(recipient);
    const msg = rule.template ? interpolate(rule.template, vars) : builtIn ? defaultMessage(builtIn, recipient, vars) : "";
    const base = { recipient, recipientLabel: who };
    if (rule.sms) {
      const phone = input.to.phone || "";
      let r: TestSendResult;
      if (!phone) r = { ...base, channel: "sms", status: "skipped", target: "", detail: "Add your mobile number to get the text." };
      else if (env.chanCfg && !env.chanCfg.smsEnabled) r = { ...base, channel: "sms", status: "skipped", target: phone, detail: "Texts are switched off for your company on the Channels tab." };
      else if (!msg) r = { ...base, channel: "sms", status: "skipped", target: phone, detail: `No text is written for the ${who.toLowerCase()} yet. Choose Edit to write one.` };
      else {
        const sent = await sendSms(phone, `[Test for ${who}] ${msg}`);
        r = sent.ok
          ? { ...base, channel: "sms", status: "sent", target: phone, detail: "" }
          : {
              ...base,
              channel: "sms",
              status: sent.skipped ? "skipped" : "failed",
              target: phone,
              detail: sent.error === "sample contact"
                ? "That's a sample number (555-01xx), so nothing was sent. Use a real mobile number."
                : sent.skipped
                  ? "Texting isn't set up on this server yet. Contact ArrivePing support."
                  : smsErrorInWords(sent.error),
            };
      }
      results.push(r);
      if (r.status !== "skipped" || phone) {
        await logDelivery({ companyId, event, recipient, channel: "sms", target: r.target, status: r.status, detail: `Test: ${r.detail || "sent"}` });
      }
    }
    if (rule.email) {
      const email = input.to.email || "";
      let r: TestSendResult;
      const mail = ruleEmail(rule, msg, meta, vars, env);
      if (!email) r = { ...base, channel: "email", status: "skipped", target: "", detail: "Add your email address to get the email." };
      else if (env.chanCfg && !env.chanCfg.emailEnabled) r = { ...base, channel: "email", status: "skipped", target: email, detail: "Emails are switched off for your company on the Channels tab." };
      else if (!mail) r = { ...base, channel: "email", status: "skipped", target: email, detail: `No email is written for the ${who.toLowerCase()} yet. Choose Edit to write one.` };
      else {
        const sent = await sendEmail({
          to: email,
          subject: `[Test for ${who}] ${mail.subject}`,
          html: mail.html,
          text: mail.text,
          from: env.emailFrom,
          replyTo: env.emailReplyTo,
        }).catch((e) => ({ ok: false, error: e?.message }));
        const ok = (sent as any)?.ok !== false;
        r = { ...base, channel: "email", status: ok ? "sent" : "failed", target: email, detail: ok ? "" : (sent as any)?.error || "The email couldn't be sent." };
      }
      results.push(r);
      if (email) await logDelivery({ companyId, event, recipient, channel: "email", target: r.target, status: r.status, detail: `Test: ${r.detail || "sent"}` });
    }
  }
  return { results, jobLabel: ctx ? `${vars.jobName} (#${vars.shortId})${ctx.b.isSample ? ", a sample job" : ""}` : null };
}

/** Twilio's reasons, in words an office manager can act on. */
function smsErrorInWords(error?: string): string {
  const e = (error || "").toLowerCase();
  if (/not a valid phone|invalid.*'to'|is not a mobile|landline/.test(e)) return "That number can't receive texts. Check it's a mobile number with its area code.";
  if (/unsubscribed|blacklist|opted out/.test(e)) return "This number replied STOP earlier, so texts to it are blocked. Text START to the sending number to allow them again.";
  if (/permission|region|geo/.test(e)) return "Texts to that country aren't allowed yet. Contact ArrivePing support.";
  return error ? `The text couldn't be sent: ${error}` : "The text couldn't be sent.";
}

/** Make a stored/relative logo URL absolute so email clients can load it. */
function absUrl(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.APP_URL || process.env.WEBSITE_URL || "").replace(/\/$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}


/**
 * Build a branded email footer (HTML) from a company's contact details.
 * Goes at the bottom of every outgoing email: legal/business name, address,
 * phone, email — so clients always know who's contacting them and how to reach
 * the tenant company back.
 */
export function buildEmailFooter(input: {
  name?: string;
  legalName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}): string {
  // Every value is escaped: they can come from a scraped website.
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const who = (input.legalName || input.name || "").trim();
  const lines: string[] = [];
  if (who) lines.push(`<strong>${e(who)}</strong>`);
  const contact: string[] = [];
  if (input.address?.trim()) contact.push(e(input.address.trim()));
  if (input.phone?.trim()) contact.push(e(input.phone.trim()));
  const mail = input.email?.trim() || "";
  if (mail) contact.push(/^[^\s@<>"]+@[^\s@<>"]+$/.test(mail) ? `<a href="mailto:${e(mail)}">${e(mail)}</a>` : e(mail));
  if (contact.length) lines.push(contact.join(" &nbsp;·&nbsp; "));
  if (input.website?.trim()) {
    const w = input.website.trim();
    const href = /^https?:\/\//i.test(w) ? w : `https://${w}`;
    const label = w.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    lines.push(/^https?:\/\/[^\s<>"']+$/i.test(href) ? `<a href="${e(href)}">${e(label)}</a>` : e(label));
  }
  return lines.join("<br/>");
}

/**
 * Auto-provision a tenant's notification channel identity from its (possibly
 * AI-scraped) brand. This is what makes outgoing email + SMS instantly feel
 * like *their* company: logo in the header, brand color theming, a footer with
 * their address/phone/email, and a sender name = their company name.
 *
 * Idempotent: only writes the row if one doesn't already exist for the tenant.
 */
export async function provisionNotificationBranding(input: {
  companyId: string;
  name: string;
  logoUrl?: string;
  brandColor?: string;
  legalName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}) {
  const t = tdb(input.companyId);
  const existing = await t.selectOne(schema.notificationChannels);
  const footer = buildEmailFooter(input);
  const values = {
    emailFromName: input.name || "ArrivePing by NVC360",
    emailReplyTo: input.email?.trim() || "",
    emailFooter: footer,
    emailLogoUrl: input.logoUrl?.trim() || "",
    emailBrandColor: input.brandColor?.trim() || "#06B6D4",
    updatedAt: new Date(),
  };
  if (existing) {
    await t.update(schema.notificationChannels, values, eq(schema.notificationChannels.id, existing.id));
  } else {
    await t.insert(schema.notificationChannels, {
      id: input.companyId,
      ...values,
    });
  }
}

export type RuleSeed = {
  event: NvcEvent;
  recipient: Recipient;
  inApp: boolean;
  email: boolean;
  sms: boolean;
  webhook: boolean;
};

/**
 * Shipped default rule matrix (event x recipient x channel), before per-ICP
 * overrides. Module-level rather than inline in the seeder because
 * ensureEventRules() needs the same defaults to backfill a company that was
 * provisioned before a new event existed.
 */
const BASE_RULES: RuleSeed[] = [
    { event: "created", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
    { event: "created", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "assigned", recipient: "tech", inApp: true, email: true, sms: true, webhook: false },
    { event: "assigned", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "accepted", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
    { event: "accepted", recipient: "client", inApp: true, email: false, sms: false, webhook: false },
    { event: "declined", recipient: "office", inApp: true, email: true, sms: false, webhook: false },
    { event: "released", recipient: "office", inApp: true, email: true, sms: false, webhook: false },
    { event: "enroute", recipient: "client", inApp: true, email: true, sms: true, webhook: false },
    { event: "arrived", recipient: "client", inApp: true, email: true, sms: true, webhook: false },
    { event: "started", recipient: "client", inApp: true, email: false, sms: false, webhook: false },
    { event: "completed", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "completed", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
    { event: "cancelled", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
    { event: "cancelled", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "receipt", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    // Customer-initiated appointment changes. The office MUST hear about a
    // request (in-app + email) — an unseen request is a truck rolling to a job
    // the customer thinks is cancelled. The customer gets a written "we've got
    // it, nothing has changed yet" so they don't call to check, and the assigned
    // tech is told their day may move.
    { event: "change_requested", recipient: "office", inApp: true, email: true, sms: false, webhook: false },
    { event: "change_requested", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "change_requested", recipient: "tech", inApp: true, email: false, sms: false, webhook: false },
    { event: "change_declined", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "change_declined", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
    // A moved appointment is the one change where the tech needs SMS: it changes
    // where they have to be, and they may not have the app open.
    { event: "rescheduled", recipient: "client", inApp: true, email: true, sms: false, webhook: false },
    { event: "rescheduled", recipient: "tech", inApp: true, email: true, sms: true, webhook: false },
    { event: "rescheduled", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
    // Running late. SMS for the customer on purpose and NOT email: this is only
    // useful in the next twenty minutes, and nobody sitting on a couch waiting
    // for a technician is refreshing their inbox. No email means no
    // "we're late" letter landing at 9pm either. The tech gets in-app only so
    // they know what the customer was told before they walk in the door.
    { event: "delayed", recipient: "client", inApp: true, email: false, sms: true, webhook: false },
    { event: "delayed", recipient: "tech", inApp: true, email: false, sms: false, webhook: false },
    { event: "delayed", recipient: "office", inApp: true, email: false, sms: false, webhook: false },
];

/**
 * Backfill the default rules for ONE event on a company that already has a rule
 * matrix. seedNotificationRules() is all-or-nothing on first run, so a tenant
 * provisioned before an event was added would silently deliver nothing for it:
 * the event fires, finds zero rules, and nobody is told. Call this immediately
 * before firing a newly added event.
 *
 * Idempotent, and deliberately keyed on "any rule for this event exists" rather
 * than "an enabled rule exists" — so an admin who turned a notification OFF
 * never has that decision quietly undone.
 */
export async function ensureEventRules(companyId: string, event: NvcEvent) {
  try {
    const t = tdb(companyId);
    const existing = await t.select(
      schema.notificationRules,
      eq(schema.notificationRules.event, event),
    );
    if (existing.length) return;
    const seeds = BASE_RULES.filter((r) => r.event === event);
    for (const d of seeds) await t.insert(schema.notificationRules, { ...d });
    if (seeds.length)
      console.log("[dispatch] backfilled", seeds.length, "rules for", event, "on", companyId);
  } catch (e) {
    console.error("[dispatch] ensureEventRules failed", event, companyId, e);
  }
}

/**
 * Branded per-tenant copy overrides, keyed `${event}:${recipient}` — produced
 * by notification-copy-scout.ts at signup. Optional: a tenant with no scout
 * result (or a company created before this existed) just gets the generic
 * copy already in defaultMessage().
 */
export type NotificationCopyOverrides = Partial<
  Record<string, { sms?: string; emailSubject?: string }>
>;

/** Seed the default rule matrix on first run for a company (idempotent). */
export async function seedNotificationRules(companyId: string, copy?: NotificationCopyOverrides) {
  const t = tdb(companyId);
  const existing = await t.select(schema.notificationRules);
  if (existing.length) return;
  // sensible defaults, then adjusted per-ICP (see notification-presets.ts)
  const base: RuleSeed[] = BASE_RULES.slice();
  // companies is a GLOBAL table (see GLOBAL_TABLES) — plain db is correct here.
  const [company] = await db
    .select({ industry: schema.companies.industry })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId))
    .limit(1);
  const defaults = applyNotificationOverrides(base, company?.industry);
  let brandedCount = 0;
  for (const d of defaults) {
    const override = copy?.[`${d.event}:${d.recipient}`];
    const template = override?.sms?.trim() || "";
    const emailSubject = override?.emailSubject?.trim() || "";
    if (template || emailSubject) brandedCount++;
    await t.insert(schema.notificationRules, { ...d, template, emailSubject });
  }
  console.log(
    "[dispatch] seeded", defaults.length, "notification rules for", companyId,
    "(industry:", company?.industry || "none", ")",
    brandedCount ? `— ${brandedCount} with branded copy` : "— generic copy (no scout result)",
  );
}
