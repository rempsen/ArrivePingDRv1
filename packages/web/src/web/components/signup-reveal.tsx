import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  MapPin,
  Palette,
  Phone,
  Sparkles,
  Users,
  Wrench,
  Mail,
  Search,
  X,
} from "lucide-react";
import { INDUSTRY_LABELS } from "../../services/industry-presets";

/**
 * The "show" on /signup. While the brand scout reads the site (30–60 s) the
 * left column walks through what it is doing; when the proposal lands the
 * findings reveal one card at a time, then the visitor confirms them.
 *
 * Purely presentational: it never calls the API itself. The page drives it
 * with `scouting` (request in flight) and `brand` (the result), and gets
 * back `onConfirm` / `onFix`.
 */

export type RevealBrand = {
  companyName: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  tagline: string | null;
  description: string | null;
  services: unknown;
  email: string | null;
  phone: string | null;
  address: string | null;
  hours: string | null;
  serviceArea: string | null;
  teamMembers?: { name: string; title: string | null; role: string }[];
  suggestedIndustry: string | null;
  suggestedIndustryOther: string | null;
  suggestedIndustryRationale: string | null;
  warnings: string[];
};

/** What the scout is doing, in the order it actually works. Each stage shows
 * for its `ms` before the next starts; the last one holds until the result. */
export const SHOW_STAGES: { icon: typeof Globe; text: string; ms: number }[] = [
  { icon: Globe, text: "Opening your homepage", ms: 3_500 },
  { icon: Palette, text: "Picking out your logo and brand colours", ms: 6_000 },
  { icon: Phone, text: "Looking for your phone number, email and address", ms: 6_000 },
  { icon: Search, text: "Reading your About, Services and Contact pages", ms: 9_000 },
  { icon: Wrench, text: "Working out which services you offer", ms: 8_000 },
  { icon: Users, text: "Finding the people on your team", ms: 7_000 },
  { icon: Sparkles, text: "Deciding what kind of business you run", ms: 8_000 },
  { icon: CheckCircle2, text: "Pulling it all together", ms: 60_000 },
];

/** Minimum time the stage list runs, so a fast scrape still reads as work. */
const MIN_SHOW_MS = 12_000;
/** Gap between finding cards as they reveal. */
const REVEAL_STEP_MS = 650;

function servicesOf(b: RevealBrand): string[] {
  const s = b.services;
  if (Array.isArray(s)) {
    return s
      .map((x) => (typeof x === "string" ? x : x && typeof x === "object" && "name" in x ? String((x as { name: unknown }).name) : ""))
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof s === "string" && s.trim()) return s.split(/[\n,;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  return [];
}

function industryLabelOf(b: RevealBrand): string | null {
  if (!b.suggestedIndustry) return null;
  if (b.suggestedIndustry === "other") return b.suggestedIndustryOther || "Other";
  return INDUSTRY_LABELS.find((i) => i.id === b.suggestedIndustry)?.label ?? null;
}

type Finding = { key: string; icon: typeof Globe; title: string; body: React.ReactNode };

export function findingsOf(b: RevealBrand): Finding[] {
  const out: Finding[] = [];
  if (b.companyName || b.logoUrl || b.primaryColor) {
    out.push({
      key: "brand",
      icon: Palette,
      title: b.companyName || "Your brand",
      body: (
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
            {b.logoUrl ? <img src={b.logoUrl} alt="" className="max-h-10 max-w-10 object-contain" /> : <Building2 className="h-5 w-5 text-slate-500" />}
          </div>
          <div className="min-w-0 text-sm text-slate-300">
            {b.tagline ? <p className="truncate italic">“{b.tagline}”</p> : <p>Logo and colours picked up.</p>}
            <div className="mt-1.5 flex items-center gap-1.5">
              {b.primaryColor && <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: b.primaryColor }} />}
              {b.accentColor && <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: b.accentColor }} />}
              {(b.primaryColor || b.accentColor) && <span className="text-xs text-slate-500">your colours</span>}
            </div>
          </div>
        </div>
      ),
    });
  }
  const ind = industryLabelOf(b);
  if (ind) {
    out.push({
      key: "industry",
      icon: Sparkles,
      title: `You're in ${ind}`,
      body: <p className="text-sm text-slate-300">{b.suggestedIndustryRationale || "We'll set up templates, forms and notifications built for this trade."}</p>,
    });
  }
  const svcs = servicesOf(b);
  if (svcs.length) {
    out.push({
      key: "services",
      icon: Wrench,
      title: `${svcs.length === 8 ? "8+" : svcs.length} services you offer`,
      body: (
        <div className="flex flex-wrap gap-1.5">
          {svcs.map((s) => (
            <span key={s} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">{s}</span>
          ))}
        </div>
      ),
    });
  }
  if (b.phone || b.email || b.address) {
    out.push({
      key: "contact",
      icon: Phone,
      title: "How customers reach you",
      body: (
        <ul className="space-y-1 text-sm text-slate-300">
          {b.phone && <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-cyan-glow" />{b.phone}</li>}
          {b.email && <li className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-cyan-glow" />{b.email}</li>}
          {b.address && <li className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-cyan-glow" />{b.address}</li>}
        </ul>
      ),
    });
  }
  if (b.hours || b.serviceArea) {
    out.push({
      key: "hours",
      icon: Clock,
      title: b.serviceArea ? `Serving ${b.serviceArea}` : "Your hours",
      body: <p className="text-sm text-slate-300">{b.hours || "Service area noted; we'll confirm hours in a moment."}</p>,
    });
  }
  const team = b.teamMembers ?? [];
  if (team.length) {
    out.push({
      key: "team",
      icon: Users,
      title: `${team.length} ${team.length === 1 ? "person" : "people"} on your team`,
      body: (
        <div className="flex flex-wrap gap-1.5">
          {team.slice(0, 8).map((m) => (
            <span key={m.name} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">
              {m.name}{m.title ? <span className="text-slate-500"> · {m.title}</span> : null}
            </span>
          ))}
        </div>
      ),
    });
  }
  return out;
}

export function SignupReveal({
  site,
  scouting,
  brand,
  error,
  onConfirm,
  onFix,
  onSkip,
}: {
  site: string;
  scouting: boolean;
  brand: RevealBrand | null;
  error: string;
  onConfirm: () => void;
  onFix: () => void;
  onSkip: () => void;
}) {
  const [stage, setStage] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [minElapsed, setMinElapsed] = useState(false);
  const [shown, setShown] = useState(0);

  // Walk the stage list on its own clock.
  useEffect(() => {
    if (!scouting && brand) return;
    if (stage >= SHOW_STAGES.length - 1) return;
    const id = setTimeout(() => setStage((s) => s + 1), SHOW_STAGES[stage]!.ms);
    return () => clearTimeout(id);
  }, [stage, scouting, brand]);

  useEffect(() => {
    const left = Math.max(0, MIN_SHOW_MS - (Date.now() - startedAt));
    const id = setTimeout(() => setMinElapsed(true), left);
    return () => clearTimeout(id);
  }, [startedAt]);

  const findings = useMemo(() => (brand ? findingsOf(brand) : []), [brand]);
  const ready = !scouting && !!brand && minElapsed;

  // Reveal findings one at a time once the result is in.
  useEffect(() => {
    if (!ready) return;
    if (shown >= findings.length) return;
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : REVEAL_STEP_MS);
    return () => clearTimeout(id);
  }, [ready, shown, findings.length]);

  const host = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const allShown = ready && shown >= findings.length;

  if (error && !scouting && !brand) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
        <p className="font-semibold text-amber-200">We couldn't read {host}</p>
        <p className="mt-1 text-sm text-amber-300/90">{error}</p>
        <button type="button" onClick={onSkip} className="mt-3 text-sm font-semibold text-amber-200 underline">
          Fill in my details by hand instead
        </button>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      {!ready && (
        <div className="rounded-2xl border border-brand/20 bg-brand/[0.05] p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-cyan-glow">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading {host}
          </p>
          <ol className="mt-4 space-y-2.5">
            {SHOW_STAGES.map((s, i) => {
              const done = i < stage || (!scouting && !!brand);
              const active = i === stage && !done;
              return (
                <li
                  key={s.text}
                  className={
                    "flex items-center gap-3 text-sm transition-all duration-500 " +
                    (done ? "text-slate-400" : active ? "text-white" : "text-slate-600")
                  }
                >
                  <span
                    className={
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full " +
                      (done ? "bg-cyan-glow/20 text-cyan-glow" : active ? "bg-brand text-white" : "bg-white/5")
                    }
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <s.icon className="h-3 w-3" />}
                  </span>
                  <span className={active ? "font-medium" : ""}>{s.text}{active ? "…" : ""}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-slate-500">Usually under a minute. We're building your workspace from what we find.</p>
        </div>
      )}

      {ready && (
        <div className="space-y-3">
          {findings.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-ink-2 p-5 text-sm text-slate-300">
              Your site didn't give us much to go on. No problem: the next screen takes a minute to fill in.
            </div>
          )}
          {findings.slice(0, shown).map((f, i) => (
            <div
              key={f.key}
              className="signup-reveal-card rounded-2xl border border-white/10 bg-ink-2 p-4"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-cyan-glow">
                  <f.icon className="h-3.5 w-3.5" />
                </span>
                {f.title}
              </p>
              {f.body}
            </div>
          ))}
          {allShown && (
            <div className="signup-reveal-card rounded-2xl border border-brand/30 bg-brand/[0.08] p-4">
              <p className="font-display text-lg font-bold text-white">
                {findings.length ? "Does this look right?" : "Ready when you are"}
              </p>
              {findings.length > 0 && <p className="mt-1 text-sm text-slate-300">You can change any of it later from Settings.</p>}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onConfirm}
                  className="nvc-btn nvc-btn-lg nvc-btn-brand flex-1"
                >
                  <CheckCircle2 className="h-4 w-4" /> {findings.length ? "Yes, that's us" : "Continue"}
                </button>
                {findings.length > 0 && (
                  <button
                    type="button"
                    onClick={onFix}
                    className="nvc-btn nvc-btn-lg flex-1 border border-white/15 text-slate-200 hover:bg-white/5"
                  >
                    <X className="h-4 w-4" /> Fix something
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
