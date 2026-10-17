import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { brand, closing } from "../config";

/**
 * "Would you like to be contacted by an NVC360 associate?" — a Yes/No choice
 * under the homepage "Sign up free" card. Yes opens a three-field form (name,
 * email or phone, optional company) that posts to /api/public/contact-request,
 * which saves the lead, pushes it to HubSpot and emails contact@nvc360.com.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors parseContact() on the server: a valid email, or a phone with 10–15 digits. */
function contactProblem(v: string): string | undefined {
  const t = v.trim();
  if (!t) return "Add an email or phone number";
  if (t.includes("@")) return EMAIL_RE.test(t) ? undefined : "Check the email address";
  const digits = t.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(t) || digits.length < 10 || digits.length > 15) return "Enter a phone number with area code, or an email";
  return undefined;
}

type Choice = "" | "yes" | "no";
type Errors = Partial<Record<"name" | "contact", string>>;
type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; first: string } | { kind: "error"; message: string };

export function ContactAsk() {
  const c = closing.contact;
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [choice, setChoice] = useState<Choice>("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const nameRef = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  // Put the cursor in the first field the moment someone says Yes.
  useEffect(() => {
    if (choice === "yes" && opened.current) nameRef.current?.focus();
    opened.current = true;
  }, [choice]);

  useEffect(() => {
    if (status.kind === "sent") doneRef.current?.focus();
  }, [status.kind]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (status.kind === "sending") return;
    const e: Errors = {};
    if (!name.trim()) e.name = "Add your name";
    const cp = contactProblem(contact);
    if (cp) e.contact = cp;
    setErrors(e);
    if (e.name) return nameRef.current?.focus();
    if (e.contact) return contactRef.current?.focus();

    setStatus({ kind: "sending" });
    try {
      const r = await fetch("/api/public/contact-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), contact: contact.trim(), company: company.trim() || undefined, website }),
      });
      if (r.ok) {
        setStatus({ kind: "sent", first: name.trim().split(/\s+/)[0] ?? "" });
        return;
      }
      const j: any = await r.json().catch(() => ({}));
      const f = j?.fields ?? j?.error?.details?.fields ?? j?.error?.fields;
      if (r.status === 400 && f) {
        setErrors({ name: f.name, contact: f.contact });
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({
        kind: "error",
        message:
          r.status === 429
            ? `That's a few requests in a row. Wait a few minutes, or email ${brand.contactEmail}.`
            : `We couldn't send that. Please email ${brand.contactEmail}.`,
      });
    } catch {
      setStatus({ kind: "error", message: `You seem to be offline. Try again, or email ${brand.contactEmail}.` });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="contact-ask">
        <div className="contact-ask__done" ref={doneRef} tabIndex={-1}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p>
            <strong>Thanks{status.first ? `, ${status.first}` : ""}.</strong> An NVC360 associate will reach out within one business day.
          </p>
        </div>
      </div>
    );
  }

  const sending = status.kind === "sending";
  return (
    <div className="contact-ask">
      <fieldset className="contact-ask__q">
        <legend>{c.question}</legend>
        <div className="contact-ask__opts">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className="contact-ask__opt">
              <input type="radio" name={id("choice")} value={v} aria-label={v === "yes" ? "Yes" : "No"} checked={choice === v} onChange={() => setChoice(v)} />
              <span>{v === "yes" ? "Yes" : "No"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {choice === "no" && <p className="contact-ask__note">{c.noNote}</p>}

      {choice === "yes" && (
        <form className="contact-ask__form" onSubmit={onSubmit} noValidate aria-busy={sending}>
          <p className="contact-ask__lede">{c.yesLede}</p>
          <div className="field" data-invalid={errors.name ? "true" : undefined}>
            <label htmlFor={id("name")} id={id("name-l")}>
              Name
            </label>
            <input
              ref={nameRef}
              id={id("name")}
              aria-labelledby={id("name-l")}
              name="name"
              autoComplete="name"
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? id("name-e") : undefined}
            />
            {errors.name && (
              <p className="field__error" id={id("name-e")}>
                {errors.name}
              </p>
            )}
          </div>
          <div className="field" data-invalid={errors.contact ? "true" : undefined}>
            <label htmlFor={id("contact")} id={id("contact-l")}>
              Email or phone
            </label>
            <input
              ref={contactRef}
              id={id("contact")}
              aria-labelledby={id("contact-l")}
              name="contact"
              autoComplete="email"
              inputMode="email"
              value={contact}
              maxLength={254}
              placeholder="you@company.com or 204-555-0123"
              onChange={(e) => {
                setContact(e.target.value);
                if (errors.contact) setErrors((p) => ({ ...p, contact: undefined }));
              }}
              aria-invalid={!!errors.contact}
              aria-describedby={errors.contact ? id("contact-e") : undefined}
            />
            {errors.contact && (
              <p className="field__error" id={id("contact-e")}>
                {errors.contact}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={id("company")} id={id("company-l")}>
              Company <span className="contact-ask__opt-label">optional</span>
            </label>
            <input
              id={id("company")}
              aria-labelledby={id("company-l")}
              name="company"
              autoComplete="organization"
              value={company}
              maxLength={200}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          {/* Honeypot: hidden from people and screen readers; bots fill it. */}
          <div className="hp" aria-hidden="true">
            <input name="website" aria-label="Website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <button type="submit" className="btn btn--secondary contact-ask__send" disabled={sending}>
            {sending ? "Sending…" : c.cta}
          </button>
          <div aria-live="polite">
            {status.kind === "error" && (
              <p className="form-status form-status--err" role="alert">
                {status.message}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
