/**
 * Sample-day contact details, and the test the senders use to refuse them.
 *
 * Every sample person gets an email under the reserved `.invalid` top-level
 * domain (RFC 2606: guaranteed never to resolve) and a phone number in the
 * North American fictional range 555-0100 to 555-0199. Both are undeliverable
 * by definition, and sendSms/sendEmail refuse them outright, so even a code
 * path that forgets the is_sample guard can never reach a real person.
 */
export const SAMPLE_EMAIL_DOMAIN = "sample.arriveping.invalid";

/** Fictional NANP area code used for sample phone numbers. */
const SAMPLE_AREA = "204";

export function sampleEmail(companyId: string, who: string): string {
  const cid = companyId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "co";
  return `${who}.${cid}@${SAMPLE_EMAIL_DOMAIN}`;
}

/** (204) 555-01NN for n in 0..99. */
export function samplePhone(n: number): string {
  const nn = String(Math.max(0, Math.min(99, Math.floor(n)))).padStart(2, "0");
  return `(${SAMPLE_AREA}) 555-01${nn}`;
}

/** True for any address under a `.invalid` domain — never deliverable. */
export function isUndeliverableEmail(addr: string | null | undefined): boolean {
  const a = String(addr ?? "").trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 0) return false;
  const host = a.slice(at + 1).replace(/\.$/, "");
  return host === "invalid" || host.endsWith(".invalid");
}

/**
 * True for a North American number whose local part is 555-0100..555-0199,
 * the range reserved for fiction. Accepts any formatting and an optional
 * leading 1 / +1.
 */
export function isFictionalPhone(phone: string | null | undefined): boolean {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 && /^\d{3}55501\d{2}$/.test(d);
}
