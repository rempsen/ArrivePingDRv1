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
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Wand2,
} from "lucide-react";

/**
 * Public self-serve company signup — the front door onboarding.ts calls
 * "the public flow" in its own comments. A prospective tenant types their
 * business name + website and gets a fully-seeded ArrivePing tenant without
 * anyone on our side touching it, then lands in /admin where the AI
 * finishing-touches conversation (OnboardingChat) picks up whatever the
 * scrape couldn't fill in.
 *
 * Deliberately lighter than the superadmin "New Company" panel's brand
 * review: this is the outside-facing door, so it shows what was detected as
 * a quick confidence signal (logo, colors, suggested industry) rather than a
 * full field-by-field editor. Deep correction happens in the chat right
 * after, which is the "agentic" step Dan asked for — not a second form here.
 */

type BrandProposal = {
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
  serviceArea: string | null;
  teamMembers?: { name: string; title: string | null; role: string }[];
  suggestedIndustry: string | null;
  suggestedIndustryOther: string | null;
  suggestedIndustryRationale: string | null;
  warnings: string[];
};

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

export default function SignupCompanyPage() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [brand, setBrand] = useState<BrandProposal | null>(null);
  const [scouting, setScouting] = useState(false);
  const [scoutErr, setScoutErr] = useState("");
  const [scoutedFor, setScoutedFor] = useState(""); // last website string we actually scouted

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  // Provisioning pop-up — the form swaps for this staged narrative the
  // instant the account is submitted, instead of just a spinner on the
  // button, same pattern as the superadmin "New Company" panel.
  const [provisionResult, setProvisionResult] = useState<ProvisioningSeeded | null>(null);
  const [provisionDone, setProvisionDone] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function runScout(site: string) {
    setScouting(true);
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
      // Only fill industry if the admin hasn't already picked one themselves.
      setIndustry((cur) => {
        if (cur) return cur;
        if (p.suggestedIndustry && INDUSTRY_LABELS.some((i) => i.id === p.suggestedIndustry)) {
          return p.suggestedIndustry;
        }
        return p.suggestedIndustry === "other" ? "other" : cur;
      });
      setIndustryOther((cur) => cur || (p.suggestedIndustry === "other" ? p.suggestedIndustryOther || "" : cur));
    } catch (e: any) {
      setScoutErr(e.message || "Couldn't read that site — you can still sign up and fill this in yourself.");
    } finally {
      setScouting(false);
    }
  }

  // Auto-fire the moment the website field settles into something that looks
  // like a real domain — no button required. The manual "Re-scan" button
  // below stays as the fallback for a site that changed, or a scrape that
  // came back thin.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const site = website.trim();
    if (!looksLikeDomain(site) || site === scoutedFor) return;
    timerRef.current = setTimeout(() => runScout(site), AUTO_SCOUT_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [website]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      const res = await (api.public as any).onboarding.signup.$post({
        json: {
          name,
          website: website.trim() || undefined,
          industry: industry || undefined,
          industryOther: industry === "other" ? industryOther : undefined,
          contactEmail: brand?.email || undefined,
          phone: brand?.phone || undefined,
          adminName,
          adminEmail,
          adminPassword,
          brand: brand ?? undefined,
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
              We read your site for your brand, your services and your service area,
              then preload your catalog, forms and notifications — before you've
              even picked a password.
            </p>
            <div className="mt-8 space-y-3">
              {[
                { t: "Brand & terminology, pulled from your site", i: Wand2 },
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
                  website={website}
                  industryId={industry}
                  done={provisionDone}
                  result={provisionResult}
                  error={err || null}
                />
              </div>
            </>
          ) : (
          <>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white">Set up your company</h2>
          <p className="mt-1 text-slate-400">Two minutes, mostly done for you.</p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Company name">
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

            <Field label="Company website" hint="The moment this looks like a real site, we start reading it — no button needed.">
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  aria-label="Company website"
                  className={inputCls + " pl-11"}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="acmehvac.com"
                />
                {scouting && (
                  <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-glow" />
                )}
              </div>
            </Field>

            {website.trim().length > 3 && (
              <button
                type="button"
                onClick={() => runScout(website.trim())}
                disabled={scouting || !looksLikeDomain(website.trim())}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-glow hover:underline disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className={"h-3 w-3" + (scouting ? " animate-spin" : "")} />
                {scoutedFor ? "Re-scan this site" : "Scan now"}
              </button>
            )}

            {scoutErr && <p className="text-xs text-amber-400">{scoutErr}</p>}

            {brand && <BrandDetected brand={brand} />}

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

            <div className="!mt-6 border-t border-white/10 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Your admin login</p>
              <div className="space-y-3">
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input aria-label="Your name" className={inputCls + " pl-11"} value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Your name" required />
                </div>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input aria-label="Email address" type="email" className={inputCls + " pl-11"} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Email address" required />
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input aria-label="Password" type="password" className={inputCls + " pl-11"} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Password (min. 8 characters)" minLength={8} required />
                </div>
              </div>
            </div>

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
          </form>
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

/** Compact "here's what we found" confidence card — not an editor. Deep
 * correction happens in the AI conversation right after signup. */
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
