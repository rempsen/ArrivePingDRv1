import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { support } from "../support/articles";
import { hubspotIdentify } from "../lib/hubspot-tracking";

/**
 * "Send us a message" — a short form in the Help Center's contact card that
 * posts straight to our customer-support Slack channel (and emails a copy to
 * support@). Visitors don't need Slack; we answer by email.
 */

const TOPICS = ["Web dashboard", "Technician app", "Billing or account", "Something else"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 4_000;

type Fields = { name: string; email: string; company: string; topic: string; message: string; website: string };
type Errors = Partial<Record<"name" | "email" | "message", string>>;
type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

const EMPTY: Fields = { name: "", email: "", company: "", topic: "", message: "", website: "" };

function validate(f: Fields): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = "Add your name";
  if (!f.email.trim()) e.email = "Add your email so we can reply";
  else if (!EMAIL_RE.test(f.email.trim())) e.email = "Check your email address";
  if (!f.message.trim()) e.message = "Write a short message";
  else if (f.message.length > MESSAGE_MAX) e.message = `Keep it under ${MESSAGE_MAX.toLocaleString()} characters`;
  return e;
}

export function SupportMessageForm() {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  // Move focus to the confirmation once it renders, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (status.kind === "sent") doneRef.current?.focus();
  }, [status.kind]);

  const set = (k: keyof Fields) => (ev: { target: { value: string } }) => {
    const v = ev.target.value;
    setF((prev) => ({ ...prev, [k]: v }));
    if (k in errors) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (status.kind === "sending") return;
    const e = validate(f);
    setErrors(e);
    const first = (["name", "email", "message"] as const).find((k) => e[k]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id(first))}`)?.focus();
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const r = await fetch("/api/public/support-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name.trim(),
          email: f.email.trim(),
          company: f.company.trim() || undefined,
          topic: f.topic || undefined,
          message: f.message.trim(),
          page: window.location.pathname,
          website: f.website,
        }),
      });
      if (r.ok) {
        hubspotIdentify(f.email); // only with analytics consent
        setStatus({ kind: "sent", email: f.email.trim() });
        setF(EMPTY);
        return;
      }
      const j: any = await r.json().catch(() => ({}));
      const serverFields = j?.fields ?? j?.error?.details?.fields ?? j?.error?.fields;
      if (r.status === 400 && serverFields) {
        setErrors({ name: serverFields.name, email: serverFields.email, message: serverFields.message });
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({
        kind: "error",
        message:
          r.status === 429
            ? `That's a few messages in a row. Wait a few minutes, or email ${support.email}.`
            : j?.error?.message || `We couldn't send your message. Please email ${support.email}.`,
      });
    } catch {
      setStatus({ kind: "error", message: `You seem to be offline. Try again, or email ${support.email}.` });
    }
  }

  const sending = status.kind === "sending";

  return (
    <section className="help-msg" aria-labelledby={id("h")}>
      <div className="help-msg__head">
        <span className="help-msg__mark">
          <SlackMark />
        </span>
        <div>
          <h3 id={id("h")} className="help-msg__title">
            Send us a message
          </h3>
          <p className="help-msg__lede">Goes straight to our support team in Slack. No Slack account needed — we reply by email.</p>
        </div>
      </div>

      {status.kind === "sent" ? (
        <div className="help-msg__done" ref={doneRef} tabIndex={-1}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="help-msg__done-title">Message sent</p>
            <p className="help-msg__done-text">
              Our team has it. We'll reply to <strong>{status.email}</strong> within one business day.
            </p>
            <button type="button" className="help-msg__again" onClick={() => setStatus({ kind: "idle" })}>
              Send another message
            </button>
          </div>
        </div>
      ) : (
        <form ref={formRef} className="help-msg__form" onSubmit={onSubmit} noValidate aria-busy={sending}>
          <div className="help-msg__row">
            <div className="field" data-invalid={errors.name ? "true" : undefined}>
              <label htmlFor={id("name")} id={id("name-label")}>Name</label>
              <input
                id={id("name")}
                aria-labelledby={id("name-label")}
                name="name"
                autoComplete="name"
                value={f.name}
                onChange={set("name")}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? id("name-err") : undefined}
                maxLength={200}
              />
              {errors.name && (
                <p className="field__error" id={id("name-err")}>
                  {errors.name}
                </p>
              )}
            </div>
            <div className="field" data-invalid={errors.email ? "true" : undefined}>
              <label htmlFor={id("email")} id={id("email-label")}>Email</label>
              <input
                id={id("email")}
                aria-labelledby={id("email-label")}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={f.email}
                onChange={set("email")}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? id("email-err") : undefined}
                maxLength={254}
              />
              {errors.email && (
                <p className="field__error" id={id("email-err")}>
                  {errors.email}
                </p>
              )}
            </div>
          </div>
          <div className="help-msg__row">
            <div className="field">
              <label htmlFor={id("company")} id={id("company-label")}>
                Company <span className="help-msg__opt">optional</span>
              </label>
              <input id={id("company")} aria-labelledby={id("company-label")} name="company" autoComplete="organization" value={f.company} onChange={set("company")} maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor={id("topic")} id={id("topic-label")}>
                About <span className="help-msg__opt">optional</span>
              </label>
              <select id={id("topic")} aria-labelledby={id("topic-label")} name="topic" value={f.topic} onChange={set("topic")}>
                <option value="">Choose one</option>
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field" data-invalid={errors.message ? "true" : undefined}>
            <label htmlFor={id("message")} id={id("message-label")}>
              How can we help?
            </label>
            <textarea
              id={id("message")}
              name="message"
              aria-labelledby={id("message-label")}
              rows={4}
              value={f.message}
              onChange={set("message")}
              aria-invalid={!!errors.message}
              aria-describedby={errors.message ? id("message-err") : undefined}
              maxLength={MESSAGE_MAX}
              placeholder="What happened, and on which screen or device?"
            />
            {errors.message && (
              <p className="field__error" id={id("message-err")}>
                {errors.message}
              </p>
            )}
          </div>
          {/* Honeypot: hidden from people and screen readers; bots fill it. */}
          <div className="hp" aria-hidden="true">
            <label htmlFor={id("website")}>Website</label>
            <input id={id("website")} name="website" aria-label="Website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
          </div>
          <div className="help-msg__foot">
            <button type="submit" className="btn btn--primary help-msg__send" disabled={sending}>
              {sending ? "Sending…" : "Send message"}
              {!sending && (
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M3.5 10h12M11 5.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <a className="help-msg__channel" href={support.slackUrl} target="_blank" rel="noopener noreferrer">
              In our Slack workspace? Open the channel<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          <div aria-live="polite">
            {status.kind === "error" && (
              <p className="form-status form-status--err" role="alert">
                {status.message}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

/** Official Slack mark (four-colour hash). Brand colours must not be altered. */
function SlackMark() {
  return (
    <svg viewBox="0 0 122.8 122.8" aria-hidden="true" focusable="false">
      <path
        fill="#e01e5a"
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
      />
      <path
        fill="#36c5f0"
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
      />
      <path
        fill="#2eb67d"
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
      />
      <path
        fill="#ecb22e"
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
      />
    </svg>
  );
}
