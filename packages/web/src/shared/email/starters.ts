/**
 * Ready-made notification emails: the designer's gallery, the built-in
 * templates in the library, and the first draft when a rule has no design.
 */
import { newBlockId, normalizeDesign, type Block, type EmailDesign } from "./design";

export interface Starter {
  key: string;
  name: string;
  description: string;
  /** Events this starter fits best (shown first for them). */
  events: string[];
  recipient: "client" | "tech" | "office";
  subject: string;
  design: EmailDesign;
}

type Raw = Record<string, unknown>;
const d = (preheader: string, blocks: Raw[]): EmailDesign => normalizeDesign({ v: 2, preheader, blocks });

const DETAILS: Raw = {
  type: "details",
  style: "boxed",
  rows: [
    { label: "Service", value: "{{service}}" },
    { label: "When", value: "{{when}}" },
    { label: "Address", value: "{{address}}" },
  ],
} as Raw;
const REPLY: Raw = { type: "text", text: "Questions? Just reply to this email.", tone: "muted" } as Raw;

export const STARTERS: Starter[] = [
  {
    key: "job-update",
    name: "Job Update",
    description: "A clean status update with the job details and a tracking button.",
    events: ["created", "accepted", "started", "change_declined"],
    recipient: "client",
    subject: "{{company}}: an update on your {{service}}",
    design: d("Here's the latest on your {{service}} appointment.", [
      { type: "heading", text: "Hi {{firstName}}, here's an update", level: 1 },
      { type: "text", text: "Your **{{service}}** appointment (#{{jobNumber}}) has a new update. Everything you need is below." },
      { ...DETAILS, rows: [...(DETAILS as any).rows, { label: "{{workerNoun}}", value: "{{techName}}" }] } as Raw,
      { type: "button", label: "Track live", url: "{{trackUrl}}", variant: "solid" },
      REPLY,
    ] as Raw[]),
  },
  {
    key: "confirmed",
    name: "Appointment Confirmed",
    description: "A friendly booking confirmation with a green confirmed note.",
    events: ["created", "assigned", "rescheduled"],
    recipient: "client",
    subject: "You're booked: {{service}} on {{when}}",
    design: d("Your {{service}} is confirmed for {{when}}.", [
      { type: "callout", text: "**Confirmed.** We'll text you when your {{workerNoun}} is on the way.", tone: "success" },
      { type: "heading", text: "You're all set, {{firstName}}", level: 1 },
      { type: "text", text: "Thanks for booking with {{company}}. Here are your appointment details." },
      {
        type: "columns",
        ratio: "1:1",
        cols: [
          [{ type: "text", text: "**When**\n{{when}}" }],
          [{ type: "text", text: "**Where**\n{{address}}" }],
        ],
      },
      { type: "button", label: "View or change booking", url: "{{trackUrl}}", variant: "solid" },
      REPLY,
    ] as Raw[]),
  },
  {
    key: "on-the-way",
    name: "On the Way",
    description: "A big arrival-time banner with the technician's photo and a live tracking button.",
    events: ["enroute"],
    recipient: "client",
    subject: "{{techName}} is on the way",
    design: d("{{techName}} is on the way. Track them live.", [
      { type: "eta", label: "Arriving in", value: "{{eta}} min", note: "Your {{service}} appointment", fallback: "On the way now" },
      { type: "heading", text: "Your {{workerNoun}} is on the way", level: 2 },
      { type: "tech", name: "{{techName}}", photo: "{{techPhoto}}", role: "{{workerNoun}} · {{company}}", note: "" },
      { type: "button", label: "Track live on the map", url: "{{trackUrl}}", variant: "solid", full: true },
      { type: "text", text: "Please make sure someone is home and any pets are secured.", tone: "muted" },
    ] as Raw[]),
  },
  {
    key: "arrived",
    name: "Arrived",
    description: "Lets the customer know the technician is at the door.",
    events: ["arrived"],
    recipient: "client",
    subject: "{{techName}} has arrived",
    design: d("{{techName}} has arrived for your {{service}}.", [
      { type: "heading", text: "{{techName}} has arrived", level: 1 },
      { type: "tech", name: "{{techName}}", photo: "{{techPhoto}}", role: "{{workerNoun}} · {{company}}", note: "" },
      { type: "text", text: "Your {{workerNoun}} is at **{{address}}** and ready to start your {{service}}." },
      REPLY,
    ] as Raw[]),
  },
  {
    key: "running-late",
    name: "Running Late",
    description: "An honest heads-up with the new arrival time.",
    events: ["delayed"],
    recipient: "client",
    subject: "We're running about {{delayMins}} minutes behind",
    design: d("New arrival time: about {{newWhen}}.", [
      { type: "callout", text: "**We're running about {{delayMins}} minutes behind.** Sorry for the wait.", tone: "warning" },
      { type: "eta", label: "New arrival time", value: "{{newWhen}}", note: "Originally {{when}}", fallback: "Shortly" },
      { type: "text", text: "Hi {{firstName}}, the job before yours took longer than planned. {{techName}} will be with you as soon as possible." },
      { type: "button", label: "Track live", url: "{{trackUrl}}", variant: "solid" },
    ] as Raw[]),
  },
  {
    key: "completed",
    name: "Job Complete",
    description: "A thank-you with a summary and a link to the job history.",
    events: ["completed"],
    recipient: "client",
    subject: "Your {{service}} is complete",
    design: d("Thanks for choosing {{company}}.", [
      { type: "heading", text: "All done, {{firstName}}", level: 1 },
      { type: "text", text: "{{techName}} has finished your **{{service}}**. Thanks for choosing {{company}}." },
      { ...DETAILS, rows: [{ label: "Service", value: "{{service}}" }, { label: "Job #", value: "{{jobNumber}}" }, { label: "Completed by", value: "{{techName}}" }] } as Raw,
      { type: "button", label: "See the job report", url: "{{trackUrl}}", variant: "solid" },
      REPLY,
    ] as Raw[]),
  },
  {
    key: "receipt",
    name: "Receipt",
    description: "A payment receipt with the amount and job number.",
    events: ["receipt"],
    recipient: "client",
    subject: "Your receipt from {{company}}",
    design: d("Payment received for your {{service}}.", [
      { type: "callout", text: "**Payment received.** Thank you!", tone: "success" },
      { type: "heading", text: "Receipt", level: 2 },
      { type: "details", title: "Summary", style: "lines", rows: [{ label: "Service", value: "{{service}}" }, { label: "Job #", value: "{{jobNumber}}" }, { label: "Amount", value: "${{price}}" }, { label: "Status", value: "Paid" }] },
      { type: "text", text: "We appreciate your business.", tone: "muted" },
    ] as Raw[]),
  },
  {
    key: "rescheduled",
    name: "Rescheduled",
    description: "Confirms the new date and time.",
    events: ["rescheduled", "change_requested"],
    recipient: "client",
    subject: "Your {{service}} has moved to {{when}}",
    design: d("New time: {{when}}.", [
      { type: "heading", text: "Your appointment has moved", level: 1 },
      { type: "text", text: "Hi {{firstName}}, your **{{service}}** is now booked for:" },
      { type: "eta", label: "New time", value: "{{when}}", note: "{{address}}", fallback: "To be confirmed" },
      { type: "button", label: "View booking", url: "{{trackUrl}}", variant: "outline" },
    ] as Raw[]),
  },
  {
    key: "tech-job",
    name: "Technician Job Card",
    description: "Everything a technician needs: customer, time, address and a button to open the job.",
    events: ["assigned", "rescheduled", "cancelled"],
    recipient: "tech",
    subject: "{{jobNoun}} #{{jobNumber}}: {{service}} at {{when}}",
    design: d("{{service}} at {{address}}, {{when}}.", [
      { type: "heading", text: "{{service}}", level: 2 },
      { type: "details", style: "boxed", rows: [{ label: "{{jobNoun}} #", value: "{{jobNumber}}" }, { label: "Customer", value: "{{firstName}}" }, { label: "When", value: "{{when}}" }, { label: "Address", value: "{{address}}" }] },
      { type: "button", label: "Open the {{jobNoun}}", url: "{{trackUrl}}", variant: "solid" },
    ] as Raw[]),
  },
  {
    key: "office-alert",
    name: "Office Alert",
    description: "A compact alert for the office with the job and technician.",
    events: ["declined", "released", "change_requested", "cancelled"],
    recipient: "office",
    subject: "{{jobNoun}} #{{jobNumber}} needs attention",
    design: d("{{jobNoun}} #{{jobNumber}}: {{service}}.", [
      { type: "callout", text: "**{{jobNoun}} #{{jobNumber}}** needs your attention.", tone: "warning" },
      { type: "details", style: "lines", rows: [{ label: "Service", value: "{{service}}" }, { label: "Customer", value: "{{firstName}}" }, { label: "{{workerNoun}}", value: "{{techName}}" }, { label: "When", value: "{{when}}" }] },
      { type: "button", label: "Open in ArrivePing", url: "{{trackUrl}}", variant: "outline" },
    ] as Raw[]),
  },
];

/** Fresh ids, so two uses of the same starter never share block ids. */
function withFreshIds(design: EmailDesign): EmailDesign {
  const re = (b: Block): Block => (b.type === "columns" ? { ...b, id: newBlockId(), cols: [b.cols[0].map(re), b.cols[1].map(re)] } : { ...b, id: newBlockId() });
  return { ...design, blocks: design.blocks.map(re) };
}

export function starterByKey(key: string): Starter | undefined {
  return STARTERS.find((s) => s.key === key);
}

/** Starters ordered for an event and recipient: the best fit first. */
export function startersFor(event: string, recipient: string): Starter[] {
  const score = (s: Starter) => (s.recipient === recipient ? 2 : 0) + (s.events.includes(event) ? 3 : 0);
  return [...STARTERS].sort((a, b) => score(b) - score(a));
}

/** The first draft for a rule that has no design yet. */
export function starterDesignFor(event: string, recipient: string, eventLabel?: string): { subject: string; design: EmailDesign } {
  const best = startersFor(event, recipient)[0]!;
  const fits = best.recipient === recipient;
  if (fits) return { subject: best.subject, design: withFreshIds(best.design) };
  const title = eventLabel || "An update";
  return {
    subject: `{{company}}: ${title}`,
    design: withFreshIds(
      d("", [
        { type: "heading", text: title, level: 2 },
        { type: "text", text: "There's an update on {{jobNoun}} #{{jobNumber}}." },
        { type: "details", style: "boxed", rows: [{ label: "Service", value: "{{service}}" }, { label: "When", value: "{{when}}" }, { label: "Address", value: "{{address}}" }] },
        { type: "button", label: "Open", url: "{{trackUrl}}", variant: "outline" },
      ] as Raw[]),
    ),
  };
}

export function copyStarter(s: Starter): { subject: string; design: EmailDesign } {
  return { subject: s.subject, design: withFreshIds(s.design) };
}
