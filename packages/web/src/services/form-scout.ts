/**
 * Form Scout — generates 2-3 industry-appropriate starter intake forms for a
 * brand-new tenant during provisioning ("Grab Brand Assets" onboarding).
 *
 * Given what we learned about the company (name, services, description,
 * website, worker-noun) AND the service library just seeded for it, it asks
 * the text model to design starter forms that match how THAT industry actually
 * intakes work: sensible fields worded for the form, titles, intros, success
 * messages, and which of the company's real services each form offers.
 *
 * That last part is what a form needs to make decisions with. Each form now
 * names the services a visitor of that form could be asking for (a leasing
 * inquiry offers leasing services, never an owner NTE review) and the one a
 * submission is booked under when the visitor doesn't choose. The names are
 * constrained to the library, so they map back to real service ids.
 *
 * Field keys are constrained to the platform's INTAKE_FIELD_CATALOG so every
 * generated field maps to a real, renderable input. Everything degrades
 * gracefully: if the model is unavailable or returns junk, we fall back to
 * generic forms (which offer every service, as before) so provisioning never
 * blocks.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { gateway, MODELS } from "../api/agent/gateway";
import { INTAKE_FIELD_CATALOG } from "../api/routes/forms";
import { log } from "../api/lib/logger";
import { getIndustryPreset } from "./industry-presets";
import { siteBlock, sourcePriority, SCOUT_TIMEOUT_MS } from "./scout-prompt";
import type { IcpKnowledge } from "./template-scout";

/** Render an IcpKnowledge block for prompt injection, or "" when empty. */
function knowledgeBlock(k: IcpKnowledge | null | undefined): string {
  if (!k) return "";
  const lines: string[] = [];
  if (k.summary) lines.push(`Industry context: ${k.summary}`);
  if (k.workflowNotes) lines.push(`How this business's intake/lead-capture actually works: ${k.workflowNotes}`);
  if (k.bestPractices?.length) lines.push(`Best practices to reflect in form design:\n${k.bestPractices.map((b) => `  - ${b}`).join("\n")}`);
  if (k.terminologyNotes) lines.push(`Industry terminology to use: ${k.terminologyNotes}`);
  if (k.complianceNotes) lines.push(`Compliance/regulatory considerations: ${k.complianceNotes}`);
  if (k.toneRefinement) lines.push(`Tone refinement: ${k.toneRefinement}`);
  if (!lines.length) return "";
  return `\n\nDEEP INDUSTRY RESEARCH (trade publications / standards bodies — reflect this in form titles, fields, and copy, it is more authoritative than generic assumptions):\n${lines.join("\n")}`;
}

/** Allowed field keys — must mirror INTAKE_FIELD_CATALOG so they render. */
const FIELD_KEYS = INTAKE_FIELD_CATALOG.map((f) => f.key) as string[];
const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  INTAKE_FIELD_CATALOG.map((f) => [f.key, f.label]),
);
// name/email/phone/address are always present & required on every form.
const ALWAYS_REQUIRED = new Set(["name", "email", "phone", "address"]);

/** Longest label / placeholder the model may set (the form is read on a phone). */
const LABEL_MAX = 60;
const PLACEHOLDER_MAX = 120;

export interface StarterFormField {
  key: string;
  label: string;
  placeholder?: string;
  enabled: boolean;
  required: boolean;
  fixed?: boolean;
}
export interface StarterForm {
  title: string;
  slug: string;
  intro: string;
  successMessage: string;
  fields: StarterFormField[];
  /** Library services this form offers, by exact name. Empty = every service. */
  serviceNames: string[];
  /** The service a submission is booked under when the visitor doesn't pick one. */
  defaultServiceName: string;
}

/** A service in the tenant's library, as the scout sees it. */
export interface LibraryService {
  name: string;
  category: string;
}

export interface FormScoutInput {
  name: string;
  // Primary Industry (ICP) preset id — same driver template-scout uses.
  // Previously this scout got NO industry context at all; now the same
  // preset (services/categories/tone) shapes intake-form design too.
  industry?: string | null;
  industryOther?: string | null; // free-text business type when industry === "other"
  services?: string[];
  description?: string | null;
  website?: string | null;
  workerNoun?: string | null;
  customerNoun?: string | null;
  // Optional deep research (trade publications, standards bodies) curated
  // per ICP — purely additive, forms degrade gracefully without it.
  knowledge?: IcpKnowledge | null;
  // Verbatim excerpts of the tenant's own website (item D) — when present
  // this is the PRIMARY source; the ICP preset becomes the fallback.
  siteExcerpts?: string | null;
  // The service library seeded for this tenant (exact names). When present,
  // each form picks the services it offers from it.
  library?: LibraryService[] | null;
}

const slugify = (s: string) =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "intake";

/** Unique, non-empty library names in library order. */
export function libraryNames(library: readonly LibraryService[] | null | undefined): string[] {
  const out: string[] = [];
  for (const s of library ?? []) {
    const n = (s?.name || "").trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The rules for which services a form offers. Shared by onboarding and the
 * form editor's "Suggest" button so both pick the same way.
 */
export const SERVICE_PICK_RULES = `- Offer ONLY the services a person filling in this particular form could be asking for. A leasing or viewing inquiry offers leasing / viewing services; a maintenance or repair request offers repair and work-order services; a quote request offers the services that get quoted.
- Never offer office-side work on a customer-facing form: approvals, accounting or financial reporting, compliance / insurance / certificate checks, internal reviews, vendor management. People don't request those from a public web form.
- If exactly one service fits, offer just that one: the dropdown is then hidden and every submission is booked under it.
- The default service is the one a submission is booked under when the visitor doesn't choose: the most common request for this form. It must be one of the offered services.`;

/** The model's output schema, with service names constrained to the library. */
function formSchema(names: string[]) {
  const nameEnum = names.length ? z.enum(names as [string, ...string[]]) : null;
  const form = z.object({
    title: z
      .string()
      .describe("Short, customer-facing form title, e.g. 'Request a Roofing Estimate'"),
    intro: z
      .string()
      .describe("1-2 sentence intro shown atop the form, friendly and on-brand"),
    successMessage: z
      .string()
      .describe("Confirmation message shown after submission"),
    fieldKeys: z
      .array(z.enum(FIELD_KEYS as [string, ...string[]]))
      .describe(
        "Which catalog fields this specific form should collect. Always include name, email, phone, address. Add serviceType, preferredAt, notes, photo only when they make sense for this form's purpose.",
      ),
    requiredKeys: z
      .array(z.enum(FIELD_KEYS as [string, ...string[]]))
      .describe(
        "Subset of fieldKeys that are mandatory. name/email/phone/address are always required.",
      ),
    fieldCopy: z
      .array(
        z.object({
          key: z.enum(FIELD_KEYS as [string, ...string[]]),
          label: z.string().describe(`The question as this form asks it, under ${LABEL_MAX} characters`),
          placeholder: z.string().describe(`Example or hint shown inside the input, under ${PLACEHOLDER_MAX} characters; "" for none`),
        }),
      )
      .describe("Wording for each field in fieldKeys, written for this form's purpose."),
    ...(nameEnum
      ? {
          serviceNames: z
            .array(nameEnum)
            .describe("The company's services this form offers in its Service type dropdown (exact names from the SERVICE LIBRARY)."),
          defaultServiceName: nameEnum.describe(
            "The service a submission is booked under when the visitor doesn't pick one. One of serviceNames.",
          ),
        }
      : {}),
  });
  return z.object({
    forms: z.array(form).min(2).max(3).describe("2 or 3 distinct starter intake forms tailored to this company's work"),
  });
}

type CopyMap = Record<string, { label?: string; placeholder?: string }>;

/** Build the platform field array from a model's key picks. */
function toFields(fieldKeys: string[], requiredKeys: string[], copy: CopyMap = {}): StarterFormField[] {
  const enabled = new Set<string>([...ALWAYS_REQUIRED, ...fieldKeys]);
  const required = new Set<string>([...ALWAYS_REQUIRED, ...requiredKeys]);
  // preserve catalog order; only emit catalog fields
  return INTAKE_FIELD_CATALOG.filter((f) => enabled.has(f.key)).map((f) => {
    const label = (copy[f.key]?.label || "").trim().slice(0, LABEL_MAX);
    const placeholder = (copy[f.key]?.placeholder || "").trim().slice(0, PLACEHOLDER_MAX);
    return {
      key: f.key,
      label: label || FIELD_LABEL[f.key] || f.label,
      ...(placeholder ? { placeholder } : {}),
      enabled: true,
      required: required.has(f.key),
      ...(f.key === "name" ? { fixed: true } : {}),
    };
  });
}

/**
 * Settle a model-designed form against the library: offered services limited
 * to real library names, a default that is one of them, and a Service type
 * field that is always present (it carries the form's service list) but only
 * shown when there are two or more services to choose between.
 */
export function settleServices(
  form: Omit<StarterForm, "serviceNames" | "defaultServiceName">,
  picked: { serviceNames?: readonly string[] | null; defaultServiceName?: string | null },
  names: readonly string[],
): StarterForm {
  const known = new Set(names);
  const serviceNames: string[] = [];
  for (const n of picked.serviceNames ?? []) {
    if (known.has(n) && !serviceNames.includes(n)) serviceNames.push(n);
  }
  const dflt = picked.defaultServiceName && known.has(picked.defaultServiceName) ? picked.defaultServiceName : "";
  // The default is always offered; with no list, the default alone is the list.
  if (dflt && serviceNames.length && !serviceNames.includes(dflt)) serviceNames.unshift(dflt);
  const defaultServiceName = dflt || serviceNames[0] || "";
  if (!serviceNames.length && defaultServiceName) serviceNames.push(defaultServiceName);

  let fields = form.fields;
  if (names.length) {
    const showDropdown = serviceNames.length >= 2;
    const existing = fields.find((f) => f.key === "serviceType");
    if (existing) {
      fields = fields.map((f) => (f.key === "serviceType" ? { ...f, enabled: showDropdown && f.enabled } : f));
    } else {
      const def = INTAKE_FIELD_CATALOG.find((f) => f.key === "serviceType")!;
      const at = fields.findIndex((f) => f.key === "address");
      const svcField: StarterFormField = { key: "serviceType", label: def.label, enabled: showDropdown, required: false };
      fields = [...fields.slice(0, at + 1), svcField, ...fields.slice(at + 1)];
    }
  }
  return { ...form, fields, serviceNames, defaultServiceName };
}

/**
 * A starter form as stored: its services (by name) become ids on the Service
 * type field, and its default becomes the form's defaultServiceId. Names the
 * library doesn't have are dropped; no list stays "every service".
 */
export function starterFormServiceIds(
  form: Pick<StarterForm, "fields" | "serviceNames" | "defaultServiceName">,
  library: ReadonlyArray<{ id: string; name: string }>,
): { fields: Array<StarterFormField & { serviceIds?: string[] }>; defaultServiceId: string } {
  const idByName = new Map<string, string>();
  for (const s of library) {
    const n = (s.name || "").trim();
    if (n && !idByName.has(n)) idByName.set(n, s.id);
  }
  const serviceIds = form.serviceNames.map((n) => idByName.get(n)).filter((x): x is string => !!x);
  return {
    fields: form.fields.map((f) => (f.key === "serviceType" ? { ...f, serviceIds } : f)),
    defaultServiceId: idByName.get(form.defaultServiceName) ?? "",
  };
}

/** A safe single-form fallback so provisioning never fails. */
export function fallbackStarterForms(input: FormScoutInput): StarterForm[] {
  const allKeys = INTAKE_FIELD_CATALOG.map((f) => f.key);
  return [
    {
      title: "Request Service",
      slug: "request-service",
      intro: `Tell us what you need and ${input.name} will reach out shortly.`,
      successMessage:
        "Thanks! We've received your request and will reach out shortly.",
      fields: toFields(allKeys, ["serviceType"]),
      serviceNames: [],
      defaultServiceName: "",
    },
    {
      title: "Get a Free Quote",
      slug: "free-quote",
      intro: `Share a few details and we'll prepare a no-obligation quote.`,
      successMessage:
        "Thanks! We'll review your details and send your quote soon.",
      fields: toFields(
        ["name", "email", "phone", "address", "serviceType", "notes", "photo"],
        ["serviceType"],
      ),
      serviceNames: [],
      defaultServiceName: "",
    },
  ];
}

/**
 * Generate 2-3 tailored starter forms. Never throws — returns a fallback on
 * any failure so tenant provisioning continues.
 */
export async function scoutStarterForms(
  input: FormScoutInput,
): Promise<StarterForm[]> {
  const servicesLine =
    input.services && input.services.length
      ? input.services.join(", ")
      : "(unknown — infer from the company name / description)";
  const noun = input.workerNoun || "technician";
  const customerNoun = input.customerNoun || "customer";
  const preset = getIndustryPreset(input.industry);
  const industryLine = preset
    ? `${preset.label} — design forms that fit how this industry actually intakes work.`
    : input.industry === "other" && input.industryOther
      ? `${input.industryOther} (no exact preset — use this description as the primary guide).`
      : "(not specified — infer from the company name / services)";
  const toneLine = preset
    ? `\nTONE FOR THIS INDUSTRY: ${preset.aiTone}`
    : "";
  const suggestedCategories = preset
    ? `\nSUGGESTED FORM INTENTS for this industry (adapt names to ${input.name}; pick the 2-3 most useful, do not force all): ${preset.templates.join(", ")}.`
    : "";
  const research = knowledgeBlock(input.knowledge);
  const site = siteBlock(input.siteExcerpts);
  const names = libraryNames(input.library);
  const libraryBlock = names.length
    ? `\n\nSERVICE LIBRARY (the company's bookable services, exact names — every submission becomes a job under ONE of these):\n${(input.library ?? [])
        .filter((s) => (s.name || "").trim())
        .map((s) => `  - ${s.name.trim()} (${s.category || "General"})`)
        .join("\n")}`
    : "";
  const serviceRules = names.length
    ? `
- serviceNames / defaultServiceName — which services from the SERVICE LIBRARY this form offers:
${SERVICE_PICK_RULES}
- Include serviceType in fieldKeys only when the form offers two or more services.`
    : "";

  try {
    const { object } = await generateObject({
      abortSignal: AbortSignal.timeout(SCOUT_TIMEOUT_MS),
      model: gateway(MODELS.text),
      schema: formSchema(names),
      prompt: `You are onboarding a service business into a dispatch & booking platform and must design its starter customer intake forms (the public web forms prospects fill out to request work).

PRIMARY INDUSTRY (ICP): ${industryLine}
COMPANY: ${input.name}
WEBSITE: ${input.website || "(unknown)"}
SERVICES OFFERED: ${servicesLine}
DESCRIPTION: ${input.description || "(none)"}
THEY CALL THEIR FIELD WORKERS: ${noun}
THEY CALL THE PEOPLE THEY SERVE: ${customerNoun}${toneLine}${suggestedCategories}${research}${site}${libraryBlock}

${sourcePriority(
        Boolean(site),
        "The PRIMARY INDUSTRY (ICP) above is the main driver — let it shape form titles, intros, and field choices first; use the services/website only as secondary detail. Match the TONE guidance above in the intro and success message copy.",
        "form titles, intros, and field choices",
      )}

Design 2 or 3 DISTINCT starter intake forms that reflect how this specific industry actually takes in work and follows best practices for lead capture. Examples of good differentiation:
- A roofing/exterior company: "Request a Free Inspection", "Get a Roof Replacement Quote", "Emergency Leak / Storm Damage".
- A building-materials supplier: "Request a Materials Quote", "Schedule a Delivery", "Contractor / Bulk Order Inquiry".
- An HVAC company: "Book a Tune-Up", "Request Emergency Repair", "New System Estimate".
- A nanny/childcare agency: "Request a Sitter", "New Family Intake", "Recurring Care Inquiry".
- A home health aide agency: "Request Care for a Loved One", "New Client Intake", "Respite Care Inquiry".

For each form:
- Pick a clear, conversion-friendly title and a short friendly intro that matches the tone guidance.
- Choose ONLY fields from this catalog (use the exact keys): ${FIELD_KEYS.join(", ")}.
- name, email, phone, address are ALWAYS included and required. Add serviceType, preferredAt, notes, photo only when they fit that form's purpose (e.g. include photo for damage/inspection forms; include preferredAt for scheduling/delivery forms).
- CONVERSION vs. FIRST-VISIT-EFFECTIVENESS tradeoff: shorter forms convert better (fewer required fields = more submissions), but for repair/service-call industries, capturing a bit more diagnostic detail up front (in "notes", or via serviceType) measurably raises first-time-fix rate and avoids a wasted second truck roll — ACCA and field-service research both treat this as a real efficiency lever, not just a data-collection nicety. Balance the two: keep required fields minimal, but make the notes/serviceType prompt text explicitly ask for the 1-2 diagnostic details that matter most for this trade (e.g. "What's the make/model and what's it doing?" for an appliance/HVAC repair form; "What symptoms are you noticing?" for a request-emergency-repair form). Don't add this friction to forms that don't need it (e.g. a simple delivery-scheduling or quote-request form).
- fieldCopy: word each field for THIS form (label + placeholder). The address is where the work or visit happens — it is checked against the company's service area and becomes the job's location on the map — so label it that way ("Unit address", "Property address", "Which building are you interested in?"), never as the visitor's mailing address. The notes field asks for the 1-2 details this form's request needs. For serviceType, label it as the choice this form offers ("What do you need?", "What can we help with?").${serviceRules}
- Write a warm, on-brand success message.

Tailor everything to ${input.name}'s actual line of work. Avoid generic duplicates — each form should serve a different customer intent.`,
    });

    const forms = ((object as any).forms || [])
      .slice(0, 3)
      .map((f: any) => {
        const copy: CopyMap = {};
        for (const c of f.fieldCopy || []) if (c?.key) copy[c.key] = { label: c.label, placeholder: c.placeholder };
        const base = {
          title: (f.title || "Request Service").trim(),
          slug: slugify(f.title),
          intro: (f.intro || "").trim(),
          successMessage:
            (f.successMessage || "").trim() ||
            "Thanks! We've received your request and will reach out shortly.",
          fields: toFields(f.fieldKeys || [], f.requiredKeys || [], copy),
        };
        return settleServices(base, { serviceNames: f.serviceNames, defaultServiceName: f.defaultServiceName }, names);
      })
      .filter((f: StarterForm) => f.fields.filter((x) => x.enabled).length >= 4); // sanity: must keep core contact fields

    if (forms.length < 2) {
      log.warn("form-scout: model returned too few usable forms; using fallback", {
        company: input.name,
        got: forms.length,
      });
      return fallbackStarterForms(input);
    }

    // de-dupe slugs within the batch
    const seen = new Set<string>();
    for (const f of forms as StarterForm[]) {
      let s = f.slug;
      let i = 2;
      while (seen.has(s)) s = `${f.slug}-${i++}`;
      f.slug = s;
      seen.add(s);
    }

    return forms;
  } catch (e) {
    log.warn("form-scout: generation failed; using fallback", {
      company: input.name,
      err: String(e),
    });
    return fallbackStarterForms(input);
  }
}

/**
 * Which of a company's services an existing form should offer — the form
 * editor's "Suggest" button. Returns null when the model can't answer, so the
 * editor says so instead of guessing.
 */
export async function suggestFormServices(input: {
  companyName: string;
  industry?: string | null;
  industryOther?: string | null;
  form: { title: string; intro: string; fieldLabels: string[] };
  library: Array<{ id: string; name: string; category: string }>;
}): Promise<{ serviceIds: string[]; defaultServiceId: string } | null> {
  const names = libraryNames(input.library);
  if (!names.length) return null;
  const preset = getIndustryPreset(input.industry);
  const industry = preset?.label || (input.industry === "other" ? input.industryOther : "") || "(not specified)";
  const nameEnum = z.enum(names as [string, ...string[]]);
  try {
    const { object } = await generateObject({
      abortSignal: AbortSignal.timeout(SCOUT_TIMEOUT_MS),
      model: gateway(MODELS.text),
      schema: z.object({
        serviceNames: z.array(nameEnum).describe("The services this form offers (exact names from the SERVICE LIBRARY)."),
        defaultServiceName: nameEnum.describe("The service a submission is booked under when the visitor doesn't pick one."),
      }),
      prompt: `A service company's public intake form needs its Service type dropdown narrowed to the services that fit the form.

COMPANY: ${input.companyName}
INDUSTRY: ${industry}
FORM TITLE: ${input.form.title}
FORM INTRO: ${input.form.intro || "(none)"}
FORM QUESTIONS: ${input.form.fieldLabels.join("; ") || "(none)"}

SERVICE LIBRARY (exact names):
${input.library.map((s) => `  - ${s.name} (${s.category || "General"})`).join("\n")}

Pick the services this form offers and its default:
${SERVICE_PICK_RULES}`,
    });
    const settled = settleServices(
      { title: "", slug: "", intro: "", successMessage: "", fields: [] },
      object,
      names,
    );
    const idOf = new Map<string, string>();
    for (const s of input.library) if (!idOf.has(s.name.trim())) idOf.set(s.name.trim(), s.id);
    const serviceIds = settled.serviceNames.map((n) => idOf.get(n)).filter((x): x is string => !!x);
    const defaultServiceId = idOf.get(settled.defaultServiceName) || serviceIds[0] || "";
    return serviceIds.length ? { serviceIds, defaultServiceId } : null;
  } catch (e) {
    log.warn("form-scout: service suggestion failed", { company: input.companyName, err: String(e) });
    return null;
  }
}
