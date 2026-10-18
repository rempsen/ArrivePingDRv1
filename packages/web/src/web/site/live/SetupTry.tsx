import { useId, useRef, useState, type FormEvent } from "react";
import { brand, setupTry as T } from "../config";
import { getConsent, hubspotIdentify } from "../lib/hubspot-tracking";

/**
 * "Your turn", right under the setup film: the visitor's website and work
 * email, then straight on to signup with the website filled in.
 *
 * On submit it posts to /api/public/setup-demo, which makes them a HubSpot
 * lead (source "ArrivePing setup demo") for marketing. This visit is linked
 * to that contact only if they accepted analytics cookies (hubspotIdentify
 * checks consent). The email reaches signup through sessionStorage (used
 * once, and only with the matching ?site=), never the URL. If the lead call
 * fails they still go on to signup.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors cleanDomain() on the server. */
export function cleanSite(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
  return /^(?=.{4,200}$)([a-z0-9-]+\.)+[a-z]{2,24}$/.test(d) && !d.split(".").some((p) => p.startsWith("-") || p.endsWith("-")) ? d : null;
}

const hasAnalyticsConsent = () => {
  try {
    return getConsent() === "granted";
  } catch {
    return false;
  }
};

type Errors = Partial<Record<"site" | "email", string>>;

export function SetupTry() {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState(""); // honeypot
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const siteRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (sending) return;
    const domain = cleanSite(site);
    const mail = email.trim();
    const e: Errors = {};
    if (!domain) e.site = site.trim() ? "Enter a website like yourcompany.com" : "Add your website";
    if (!EMAIL_RE.test(mail)) e.email = mail ? "Check the email address" : "Add your work email";
    setErrors(e);
    if (e.site) return siteRef.current?.focus();
    if (e.email) return emailRef.current?.focus();

    setSending(true);
    try {
      const r = await fetch("/api/public/setup-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail, website: domain, nickname }),
      });
      if (r.status === 400) {
        const j: any = await r.json().catch(() => ({}));
        const f = j?.error?.fields ?? j?.error?.details?.fields ?? j?.fields ?? {};
        const next: Errors = { site: f.website, email: f.email };
        if (next.site || next.email) {
          setErrors(next);
          setSending(false);
          return (next.site ? siteRef : emailRef).current?.focus();
        }
      }
      // Link this visit to the lead in HubSpot (no-op without analytics
      // consent), and give the tracker a moment to send before we navigate.
      if (r.ok) {
        hubspotIdentify(mail);
        if (hasAnalyticsConsent()) await new Promise((res) => setTimeout(res, 350));
      }
    } catch {
      /* the lead is best effort; signup is what matters */
    }
    try {
      window.sessionStorage.setItem("ap_signup_handoff", JSON.stringify({ email: mail, site: domain }));
    } catch {
      /* storage blocked: they'll type it on signup */
    }
    window.location.assign(`${brand.urls.signUp}?site=${encodeURIComponent(domain!)}`);
  }

  return (
    <form className="st" onSubmit={onSubmit} noValidate aria-labelledby={id("title")}>
      <div className="st__copy">
        <span className="st__eyebrow">{T.eyebrow}</span>
        <h3 id={id("title")}>{T.title}</h3>
        <p>{T.body}</p>
      </div>
      <div className="st__fields">
        <div className="st__field">
          <label htmlFor={id("site")}>{T.site.label}</label>
          <div className={`st__input${errors.site ? " has-error" : ""}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <input
              ref={siteRef}
              id={id("site")}
              aria-label={T.site.label}
              name="website"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={T.site.placeholder}
              value={site}
              onChange={(e) => setSite(e.target.value)}
              aria-invalid={errors.site ? true : undefined}
              aria-describedby={errors.site ? id("site-err") : undefined}
            />
          </div>
          {errors.site ? (
            <span className="st__err" id={id("site-err")}>
              {errors.site}
            </span>
          ) : null}
        </div>
        <div className="st__field">
          <label htmlFor={id("email")}>{T.email.label}</label>
          <div className={`st__input${errors.email ? " has-error" : ""}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.8" y="3.3" width="12.4" height="9.4" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2.4 4.3L8 8.6l5.6-4.3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <input
              ref={emailRef}
              id={id("email")}
              aria-label={T.email.label}
              name="email"
              type="email"
              autoComplete="email"
              placeholder={T.email.placeholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? id("email-err") : undefined}
            />
          </div>
          {errors.email ? (
            <span className="st__err" id={id("email-err")}>
              {errors.email}
            </span>
          ) : null}
        </div>
        <div className="st__hp" aria-hidden="true">
          <label htmlFor={id("nick")}>Leave this empty</label>
          <input id={id("nick")} aria-label="Leave this empty" name="nickname" type="text" tabIndex={-1} autoComplete="off" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <button type="submit" className="btn btn--primary beam st__go" disabled={sending}>
          {sending ? "Opening signup…" : T.button}
          <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="st__foot">
        <p className="st__price">{T.price}</p>
        <p className="st__fine">
          {T.fine}{" "}
          <a href={brand.urls.privacy}>Privacy policy</a>
          <span aria-hidden="true"> · </span>
          <a href={T.noSite.href}>{T.noSite.label}</a>
        </p>
      </div>
    </form>
  );
}
