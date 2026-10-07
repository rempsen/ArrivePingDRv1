/**
 * ROSTER FROM A PHOTO (scrape audit item F.3).
 *
 * Most contractor sites never list their crew, so the onboarding concierge's
 * "paste your people" step is the workhorse. This is the shortcut for the
 * owner who has the roster on a whiteboard, a dispatch board, a stack of
 * business cards, a payroll printout or a screenshot of their old software:
 * snap it, we read it, the concierge takes it from there exactly as if they
 * had typed it in.
 *
 * Pure function over bytes — no DB access. The onboarding route owns auth,
 * size limits and what to do with the result.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { gateway, MODELS } from "../api/agent/gateway";
import { log } from "../api/lib/logger";

export const RosterPersonSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().max(120).nullable(),
  role: z.enum(["tech", "driver", "dispatcher", "manager", "owner", "other"]),
  email: z.string().max(200).nullable(),
  phone: z.string().max(60).nullable(),
});
export type RosterPerson = z.infer<typeof RosterPersonSchema>;

const RosterSchema = z.object({
  people: z.array(RosterPersonSchema).max(60),
  /** What the image actually is, in a few words — helps the concierge phrase its reply. */
  sourceKind: z.string().max(80),
  /** Anything the model couldn't read with confidence (smudged phone digits etc.). */
  uncertain: z.array(z.string().max(160)).max(20),
});
export type RosterFromImage = z.infer<typeof RosterSchema>;

export const ROSTER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"];
export const ROSTER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads every person visible in the image. Returns an empty `people` list
 * (not an error) when the picture simply has no roster in it, so the UI can
 * say "couldn't find any names" instead of failing.
 */
export async function extractRosterFromImage(bytes: Uint8Array, mime: string): Promise<RosterFromImage> {
  const { object } = await generateObject({
    model: gateway(MODELS.vision),
    schema: RosterSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This photo was uploaded by the owner of a field-service company (plumbing, HVAC, electrical, roofing, delivery and the like) who wants to add their staff to our dispatch software. It may be a whiteboard, a dispatch board, business cards, an org chart, a payroll or schedule printout, a screenshot of another app, a team photo with captions, or a handwritten list.

Extract EVERY real person you can read. For each one:
- name: as written (fix obvious OCR casing, don't invent surnames)
- title: their job title/label exactly as shown, or null
- role: your best mapping — "tech" for technicians/installers/plumbers/electricians/service staff who go to customer sites, "driver" for delivery/route drivers, "dispatcher" for dispatch/office/CSR/scheduler, "manager" for ops/service managers, "owner" for owner/president/CEO, otherwise "other"
- email / phone: only if actually visible; null otherwise. Never guess.

Ignore customer names, company names, vehicle names and anything that isn't a staff member. If there are no people, return an empty list. In \`uncertain\`, list anything you had to guess at (e.g. "Phone for Mike — last digit unclear").`,
          },
          { type: "image", image: bytes, mediaType: mime },
        ],
      },
    ],
  });

  const seen = new Set<string>();
  const people = object.people
    .map((p) => ({
      ...p,
      name: p.name.replace(/\s+/g, " ").trim(),
      title: p.title?.trim() || null,
      email: p.email && EMAIL_RE.test(p.email.trim()) ? p.email.trim().toLowerCase() : null,
      phone: p.phone?.replace(/[^\d+()\-\s]/g, "").trim() || null,
    }))
    .filter((p) => {
      if (p.name.length < 2) return false;
      const k = p.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  log.info("roster-vision: extracted", { people: people.length, kind: object.sourceKind });
  return { ...object, people };
}

/** Formats the result the way the concierge already asks owners to paste it: "name, job, email, mobile" per line. */
export function rosterToPasteText(r: RosterFromImage): string {
  return r.people
    .map((p) => [p.name, p.title || p.role, p.email || "", p.phone || ""].join(", ").replace(/(, )+$/, ""))
    .join("\n");
}
