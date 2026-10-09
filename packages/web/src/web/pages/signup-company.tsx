import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { api } from "../lib/api";
import { authClient, captureToken } from "../lib/auth";
import { Logo } from "../components/brand";
import { Loader } from "../components/loader";
import { Field, inputCls } from "../components/modal";
import { ProvisioningProgress, type ProvisioningSeeded } from "../components/provisioning-progress";
import { INDUSTRY_LABELS, INDUSTRY_GROUPS } from "../../services/industry-presets";
import {
  Building2,
  Globe,
  Sparkles,
  Loader2,
  User,
  Mail,
  Lock,
  Phone,
  MapPin,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Wand2,
  AlertCircle,
} from "lucide-react";

/**
 * Public self-serve company signup — the front door onboarding.ts calls
 * "the public flow" in its own comments.
 *
 * URL-first, in three short steps:
 *
 *   1. Website.   The only thing we ask for up front. The moment it looks
 *                 like a real domain we read the site (brand-scout) — name,
 *                 phone, address, email, industry, logo, colours, team.
 *   2. Details.   Everything the scout found is pre-filled and editable; what
 *                 it couldn't find is flagged so the admin fills the gap
 *                 before it becomes a problem (a tenant with no phone can't
 *                 be reached by its own customers).
 *   3. Login.     Name / email / password for the admin account.
 *
 * Then /admin, where the AI finishing-touches conversation (OnboardingChat)
 * picks up whatever is still missing — hours, service area, team roster.
 * The admin-reviewed values are posted both as the top-level company fields
 * AND written back onto the `brand` proposal, because provisionCompany()
 * prefers brand.phone/email/address over the top-level ones.
 */

type BrandProposal = {
  companyName: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  workerNoun: string | null;
  customerNoun: string | null;
  jobNoun: string | null;
  tagline: string | null;
  description: string | null;
  services: unknown;
  email: string | null;
  phone: string | null;
  address: string | null;
  hours: string | null;
  serviceArea: string | null;
  contactEmails?: string[] | null;
  teamMembers?: { name: string; title: string | null; role: string }[];
  suggestedIndustry: string | null;
  suggestedIndustryOther: string | null;
  suggestedIndustryRationale: string | null;
  warnings: string[];
};

type Step = "site" | "details" | "login";

/** Loose "is this at least a domain" check — gates the auto-scout so it
 * doesn't fire on every keystroke of "a", "ac", "acm…". The real validation
 * (SSRF/scheme checks) lives server-side in websiteUrlSchema; this is just a
 * client-side "don't bother yet" filter. */
function looksLikeDomain(v: string): boolean {
  const s = v.trim();
  if (s.length < 4) return false;
  return /^(https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}([/?#].*)?$/i.test(s);
}

const AUTO_SCOUT_DEBOUNCE_MS = 900;

/** What the scout is doing while the admin waits — rotated every few seconds
 * so a 30–60 s scrape reads as progress, not a hung spinner. */
const SCOUT_STAGES = [
  "Reading your homepage…",
  "Picking out your logo and brand colours…",
  "Looking for your phone number and address…",
  "Checking your About and Contact pages…",
  "Finding the people on your team page…",
  "Working out what kind of business you run…",
  "Almost there — pulling it all together…",
];

export default function SignupCompanyPage() {
  const [step, setStep] = useState<Step>("site");
  const [website, setWebsite] = useState("");
  const [noWebsite, setNoWebsite] = useState(false);

  // Company details — pre-filled from the scout, always editable.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [brand, setBrand] = useState<BrandProposal | null>(null);
  const [scouting, setScouting] = useState(false);
  const [scoutStage, setScoutStage] = useState(0);
  const [scoutErr, setScoutErr] = useState("");
  const [scoutedFor, setScoutedFor] = useState(""); // last website string we actually scouted

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [detailsErr, setDetailsErr] = useState("");
  // Provisioning pop-up — the form swaps for this staged narrative the
  // instant the account is submitted, instead of just a spinner on the
  // button, same pattern as the superadmin "New Company" panel.
  const [provisionResult, setProvisionResult] = useState<ProvisioningSeeded | null>(null);
  const [provisionDone, setProvisionDone] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Values the LAST scout wrote into each field. A re-scan only overwrites a
  // field the admin hasn't touched since (current value === what we put there).
  const prefilledRef = useRef<{ name: string; phone: string; address: string; email: string; industry: string }>({
    name: "",
    phone: "",
    address: "",
    email: "",
    industry: "",
  });

  function applyPrefill(p: BrandProposal) {
    const prev = prefilledRef.current;
    const next = {
      name: p.companyName ?? "",
      phone: p.phone ?? "",
      address: p.address ?? "",
      email: p.email ?? "",
      industry:
        p.suggestedIndustry && INDUSTRY_LABELS.some((i) => i.id === p.suggestedIndustry)
          ? p.suggestedIndustry
          : p.suggestedIndustry === "other"
            ? "other"
            : "",
    };
    const take = (cur: string, prevVal: string, nextVal: string) => (!cur || cur === prevVal ? nextVal || cur : cur);
    setName((cur) => take(cur, prev.name, next.name));
    setPhone((cur) => take(cur, prev.phone, next.phone));
    setAddress((cur) => take(cur, prev.address, next.address));
    setContactEmail((cur) => take(cur, prev.email, next.email));
    setIndustry((cur) => take(cur, prev.industry, next.industry));
    setIndustryOther((cur) => cur || (next.industry === "other" ? p.suggestedIndustryOther || "" : cur));
    prefilledRef.current = next;
  }

  async function runScout(site: string) {
    setScouting(true);
    setScoutStage(0);
    setScoutErr("");
    try {
      const res = await (api.public as any).onboarding.scout.$post({
        json: { website: site, name: name || undefined },
      });
      const d = await res.json();
      if (!res.ok) throw new Error((d as any)?.message || "Couldn't read that site");
      const p = d.proposal as BrandProposal;
      setBrand(p);
      setScoutedFor(site);
      applyPrefill(p);
      setStep((s) => (s === "site" ? "details" : s));
    } catch (e: any) {
      setScoutErr(e.message || "Couldn't read that site — you can still sign up and fill this in yourself.");
    } finally {
      setScouting(false);
    }
  }

  // Auto-fire the moment the website field settles into something that looks
  // like a real domain — no button required. The "Scan my site" button is
  // the same action for people who'd rather click.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const site = website.trim();
    if (step !== "site" || !looksLikeDomain(site) || site === scoutedFor) return;
    timerRef.current = setTimeout(() => runScout(site), AUTO_SCOUT_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [website]);

  // Rotate the "what we're doing" line while the scout runs.
  useEffect(() => {
    if (!scouting) return;
    const id = setInterval(() => setScoutStage((s) => Math.min(s + 1, SCOUT_STAGES.length - 1)), 4500);
    return () => clearInterval(id);
  }, [scouting]);

  function skipWebsite() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNoWebsite(true);
    setScoutErr("");
    setStep("details");
  }

  function continueToLogin(e: React.FormEvent) {
    e.preventDefault();
    setDetailsErr("");
    if (!name.trim()) {
      setDetailsErr("We need your company name to set up your account.");
      return;
    }
    if (industry === "other" && !industryOther.trim()) {
      setDetailsErr("Tell us in a few words what your business does.");
      return;
    }
    setStep("login");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      const site = noWebsite ? "" : website.trim();
      // Admin-reviewed values win over whatever the scout read. provisionCompany
      // prefers brand.phone/email/address to the top-level fields, so write
      // them back onto the proposal too (nulls are stripped server-side).
      const reviewedBrand = {
        ...brand,
        companyName: name.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        email: contactEmail.trim() || null,
      };
      const res = await (api.public as any).onboarding.signup.$post({
        json: {
          name: name.trim(),
          website: site || undefined,
          industry: industry || undefined,
          industryOther: industry === "other" ? industryOther : undefined,
          contactEmail: contactEmail.trim() || undefined,
          phone: phone.trim() || undefined,
          adminName,
          adminEmail,
          adminPassword,
          brand: reviewedBrand,
        },
      });
      const d = await res.json();
      if (!res.ok) throw new Error((d as any)?.message || "Signup failed");
      setProvisionResult((d as any)?.seeded ?? null);

      // Sign the new admin in with the credentials they just typed. Reveal
      // the final "all set" line for a beat before handing off to /admin —
      // the onboarding chat picks up from there.
      const { error } = await authClient.signIn.email(
        { email: adminEmail, password: adminPassword },
        { onSuccess: (ctx) => captureToken(ctx) },
      );
      if (error) throw new Error(error.message);
      setProvisionDone(true);
      await new Promise((r) => setTimeout(r, 1600));
      window.location.assign("/admin");
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
      setSubmitting(false);
      setProvisionResult(null);
      setProvisionDone(false);
    }
  }

  const fromSite = (field: "name" | "phone" | "address" | "email", cur: string) =>
    !!brand && !!cur && cur === prefilledRef.current[field];

  const found = [brand?.companyName, brand?.phone, brand?.address, brand?.email, brand?.suggestedIndustry].filter(Boolean).length;

  return (
    <div className="grid min-h-screen bg-ink md:grid-cols-2">
      {/* left visual */}
      <div className="nvc-grid-bg relative hidden overflow-hidden bg-ink-2 md:block">
        <div className="absolute -right-20 top-20 h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-cyan-glow/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Logo light imgClassName="h-10 w-auto" />
          <div>
            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight">
              Give us your website.
              <br /> <span className="text-glow text-cyan-glow">We'll set up the rest.</span>
            </h1>
            <p className="mt-4 max-w-sm text-slate-400">
              We read your site for your name, phone, address, brand and services,
              then preload your catalog, forms and notifications — before you've
              even picked a password.
            </p>
            <div className="mt-8 space-y-3">
              {[
                { t: "Company details & brand, pulled from your site", i: Wand2 },
                { t: "Starter catalog, forms & work-order templates", i: CheckCircle2 },
                { t: "A short AI conversation fills in anything we missed", i: Sparkles },
              ].map((x) => (
                <div key={x.t} className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/15 text-cyan-glow">
                    <x.i className="h-4 w-4" />
                  </span>
                  <span className="text-slate-200">{x.t}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Trusted by HVAC, plumbing, electrical & facilities teams.
          </p>
        </div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 md:hidden">
            <Logo light />
          </div>
          {submitting ? (
            <>
              <h2 className="font-display text-3xl font-bold tracking-tight text-white">Setting up {name || "your company"}</h2>
              <p className="mt-1 text-slate-400">Hang tight — this takes about a minute.</p>
              <div className="mt-5 rounded-2xl border border-white/10 bg-ink-2 px-2 py-2">
                <ProvisioningProgress
                  website={noWebsite ? "" : website}
                  industryId={industry}
                  done={provisionDone}
                  result={provisionResult}
                  error={err || null}
                />
              </div>
            </>
          ) : (
            <>
              <StepDots step={step} />

              {/* ── Step 1: website ─────────────────────────────────────── */}
              {step === "site" && (
                <>
                  <h2 className="font-display text-3xl font-bold tracking-tight text-white">Start with your website</h2>
                  <p className="mt-1 text-slate-400">We'll read it and fill in your company details for you.</p>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const site = website.trim();
                      if (looksLikeDomain(site) && !scouting) runScout(site);
                    }}
                    className="mt-5 space-y-4"
                  >
                    <Field label="Company website">
                      <div className="relative">
                        <Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          aria-label="Company website"
                          className={inputCls + " pl-11 text-base"}
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          placeholder="acmehvac.com"
                          autoComplete="url"
                          inputMode="url"
                          disabled={scouting}
                        />
                        {scouting && (
                          <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-glow" />
                        )}
                      </div>
                    </Field>

                    {scouting ? (
                      <div className="rounded-xl border border-brand/20 bg-brand/[0.06] px-4 py-3" aria-live="polite">
                        <p className="flex items-center gap-2 text-sm font-semibold text-cyan-glow">
                          <Sparkles className="h-4 w-4" /> Reading {website.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")}
                        </p>
                        <p className="mt-1 text-sm text-slate-300">{SCOUT_STAGES[scoutStage]}</p>
                        <p className="mt-1 text-xs text-slate-500">Usually under a minute.</p>
                      </div>
                    ) : (
                      <button
                        type="submit"
                        disabled={!looksLikeDomain(website.trim())}
                        className="nvc-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
                      >
                        Scan my site <ArrowRight className="h-4 w-4" />
                      </button>
                    )}

                    {scoutErr && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
                        <p>{scoutErr}</p>
                        <button type="button" onClick={skipWebsite} className="mt-1.5 font-semibold text-amber-200 underline">
                          Fill in my details by hand instead
                        </button>
                      </div>
                    )}

                    {!scouting && (
                      <p className="text-center text-sm text-slate-500">
                        No website?{" "}
                        <button type="button" onClick={skipWebsite} className="font-semibold text-cyan-glow hover:underline">
                          Skip this step
                        </button>
                      </p>
                    )}
                  </form>
                </>
              )}

              {/* ── Step 2: review details ──────────────────────────────── */}
              {step === "details" && (
                <>
                  <h2 className="font-display text-3xl font-bold tracking-tight text-white">
                    {brand ? "Here's what we found" : "Tell us about your company"}
                  </h2>
                  <p className="mt-1 text-slate-400">
                    {brand
                      ? found >= 4
                        ? "Check it over and fix anything that's off."
                        : found > 0
                          ? "We got some of it — fill in the rest below."
                          : "Your site didn't give us much — fill in the basics below."
                      : "Just the basics. You can change any of this later."}
                  </p>

                  <form onSubmit={continueToLogin} className="mt-5 space-y-4">
                    {brand && <BrandDetected brand={brand} />}

                    <Field label="Company name" hint={fromSite("name", name) ? <FromSite /> : brand ? <Gap text="We couldn't read your company name off the site." /> : undefined}>
                      <div className="relative">
                        <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          aria-label="Company name"
                          className={inputCls + " pl-11"}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Acme HVAC"
                          required
                        />
                      </div>
                    </Field>

                    <Field label="What kind of business is this?">
                      <select
                        aria-label="Industry"
                        className={inputCls}
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                      >
                        <option value="">Select industry…</option>
                        {INDUSTRY_GROUPS.map((g) => (
                          <optgroup key={g} label={g}>
                            {INDUSTRY_LABELS.filter((i) => i.group === g).map((i) => (
                              <option key={i.id} value={i.id}>{i.label}</option>
                            ))}
                          </optgroup>
                        ))}
                        <option value="other">Other — describe it below…</option>
                      </select>
                      {brand?.suggestedIndustry && industry === brand.suggestedIndustry && (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1.5 text-[11px] text-cyan-300">
                          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            We guessed this from your site
                            {brand.suggestedIndustryRationale ? `: ${brand.suggestedIndustryRationale}` : "."}
                            {" "}Change it if it's not quite right.
                          </span>
                        </p>
                      )}
                    </Field>
                    {industry === "other" && (
                      <Field label="Describe your business">
                        <input
                          aria-label="Describe your business"
                          className={inputCls}
                          value={industryOther}
                          onChange={(e) => setIndustryOther(e.target.value)}
                          placeholder="e.g. Wedding Photography, Pest Control, Mobile Notary…"
                        />
                      </Field>
                    )}

                    <Field
                      label="Business phone"
                      hint={
                        fromSite("phone", phone) ? (
                          <FromSite />
                        ) : brand && !phone ? (
                          <Gap text="Not on your site — add it so customers can reach you." />
                        ) : undefined
                      }
                    >
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          aria-label="Business phone"
                          type="tel"
                          className={inputCls + " pl-11"}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="(204) 555-0199"
                          autoComplete="tel"
                        />
                      </div>
                    </Field>

                    <Field
                      label="Business address"
                      hint={
                        fromSite("address", address) ? (
                          <FromSite />
                        ) : brand && !address ? (
                          <Gap text="Not on your site — your address shows on customer notifications." />
                        ) : undefined
                      }
                    >
                      <div className="relative">
                        <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          aria-label="Business address"
                          className={inputCls + " pl-11"}
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder="123 Main St, Winnipeg, MB"
                          autoComplete="street-address"
                        />
                      </div>
                    </Field>

                    <Field
                      label="Contact email"
                      hint={
                        fromSite("email", contactEmail) ? (
                          <FromSite />
                        ) : brand && !contactEmail ? (
                          <Gap text="Not on your site — this is where customer replies land." />
                        ) : undefined
                      }
                    >
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          aria-label="Contact email"
                          type="email"
                          className={inputCls + " pl-11"}
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="office@acmehvac.com"
                          autoComplete="email"
                        />
                      </div>
                    </Field>

                    <div className="min-h-[20px]" role="alert" aria-live="polite">
                      {detailsErr && <p className="text-sm font-medium text-red-400">{detailsErr}</p>}
                    </div>

                    <button
                      type="submit"
                      className="nvc-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white transition hover:bg-brand-deep"
                    >
                      {brand ? "Looks right — continue" : "Continue"} <ArrowRight className="h-4 w-4" />
                    </button>

                    <div className="flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setNoWebsite(false);
                          setStep("site");
                        }}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
                      >
                        <ArrowLeft className="h-3 w-3" /> {brand ? "Different website" : "I do have a website"}
                      </button>
                      {brand && !noWebsite && (
                        <button
                          type="button"
                          onClick={() => runScout(website.trim())}
                          disabled={scouting}
                          className="inline-flex items-center gap-1.5 font-semibold text-cyan-glow hover:underline disabled:opacity-40"
                        >
                          <RefreshCw className={"h-3 w-3" + (scouting ? " animate-spin" : "")} />
                          {scouting ? "Re-reading your site…" : "Re-scan my site"}
                        </button>
                      )}
                    </div>
                    {scoutErr && <p className="text-xs text-amber-400">{scoutErr}</p>}
                  </form>
                </>
              )}

              {/* ── Step 3: admin login ─────────────────────────────────── */}
              {step === "login" && (
                <>
                  <h2 className="font-display text-3xl font-bold tracking-tight text-white">Last step — your login</h2>
                  <p className="mt-1 text-slate-400">
                    This is the account that runs {name.trim() || "your company"} on ArrivePing.
                  </p>

                  <form onSubmit={submit} className="mt-5 space-y-4">
                    <div className="space-y-3">
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input aria-label="Your name" className={inputCls + " pl-11"} value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Your name" required autoComplete="name" />
                      </div>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input aria-label="Email address" type="email" className={inputCls + " pl-11"} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Your work email" required autoComplete="email" />
                      </div>
                      {contactEmail.trim() && !adminEmail && (
                        <button
                          type="button"
                          onClick={() => setAdminEmail(contactEmail.trim())}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                        >
                          <Sparkles className="h-3 w-3 text-cyan-glow" /> Use {contactEmail.trim()}
                        </button>
                      )}
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input aria-label="Password" type="password" className={inputCls + " pl-11"} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Password (min. 8 characters)" minLength={8} required autoComplete="new-password" />
                      </div>
                    </div>

                    <p className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-xs leading-relaxed text-slate-400">
                      <Sparkles className="mr-1 inline h-3 w-3 text-cyan-glow" />
                      After this, a short AI conversation picks up anything we still don't know — hours, service area, your team — and finishes the setup with you.
                    </p>

                    <div className="min-h-[44px]" role="alert" aria-live="polite">
                      {err && (
                        <div className="flex min-h-[44px] items-center rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400">
                          {err}
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="nvc-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
                    >
                      {submitting ? (
                        <Loader className="h-5 w-5 border-white/40 border-t-white" />
                      ) : (
                        <>Create my account <ArrowRight className="h-4 w-4" /></>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep("details")}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                    >
                      <ArrowLeft className="h-3 w-3" /> Back to company details
                    </button>
                  </form>
                </>
              )}
            </>
          )}

          <p className="mt-5 text-center text-sm text-slate-500">
            Already set up?{" "}
            <Link to="/sign-in" className="inline-flex min-h-[32px] items-center px-1 font-semibold text-cyan-glow hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "site", label: "Website" },
    { id: "details", label: "Details" },
    { id: "login", label: "Login" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  return (
    <ol className="mb-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider" aria-label="Signup progress">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={
              "grid h-5 w-5 place-items-center rounded-full text-[10px] " +
              (i < idx ? "bg-cyan-glow/20 text-cyan-glow" : i === idx ? "bg-brand text-white" : "bg-white/5 text-slate-500")
            }
            aria-current={i === idx ? "step" : undefined}
          >
            {i < idx ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
          </span>
          <span className={i === idx ? "text-white" : "text-slate-500"}>{s.label}</span>
          {i < steps.length - 1 && <span className="h-px w-5 bg-white/10" />}
        </li>
      ))}
    </ol>
  );
}

function FromSite() {
  return (
    <span className="inline-flex items-center gap-1 text-cyan-300">
      <Sparkles className="h-3 w-3" /> Pulled from your site
    </span>
  );
}

function Gap({ text }: { text: string }) {
  return (
    <span className="inline-flex items-start gap-1 text-amber-300">
      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {text}
    </span>
  );
}

/** Compact "here's what we found" confidence card. The editable fields
 * below it are where corrections happen; this just shows the brand bits
 * (logo, colour, terminology, team) that don't get their own input. */
function BrandDetected({ brand }: { brand: BrandProposal }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-gradient-to-br from-brand/[0.07] to-transparent p-3.5">
      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="detected logo" className="max-h-9 max-w-9 object-contain" />
        ) : (
          <Building2 className="h-4 w-4 text-slate-500" />
        )}
      </div>
      <div className="min-w-0 flex-1 text-xs">
        <p className="flex items-center gap-1.5 font-bold text-cyan-glow">
          <Sparkles className="h-3 w-3" /> Detected from your site
        </p>
        <p className="mt-1 text-slate-300">
          {brand.tagline || brand.description || "Colors, services and terminology pulled in."}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {brand.primaryColor && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: brand.primaryColor }} />
              brand color
            </span>
          )}
          {brand.workerNoun && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">calls staff "{brand.workerNoun}"</span>
          )}
          {brand.serviceArea && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">serves {brand.serviceArea}</span>
          )}
          {brand.hours && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">hours found</span>
          )}
          {(brand.teamMembers?.length ?? 0) > 0 && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">
              found {brand.teamMembers!.length} team member{brand.teamMembers!.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {brand.warnings.length > 0 && (
          <p className="mt-1.5 text-amber-400">{brand.warnings[0]}</p>
        )}
      </div>
    </div>
  );
}
