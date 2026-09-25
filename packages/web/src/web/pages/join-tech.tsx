import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { authClient, captureToken } from "../lib/auth";
import { Logo } from "../components/brand";
import { Loader, FullLoader } from "../components/loader";
import { Wrench, Lock, Phone, User, CheckCircle2, ArrowRight, MapPin, Radio, Navigation } from "lucide-react";

export default function JoinTech() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const lookup = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => (await api.invites.lookup[":token"].$get({ param: { token } })).json(),
    retry: false,
  });

  const data = lookup.data as any;
  const valid = data?.invite;
  const company = data?.company || "ArrivePing";
  const workerNoun = (data?.workerNoun as string) || "Technician";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.invites.accept[":token"].$post({
        param: { token },
        json: { name: name || valid.name, password, phone },
      });
      const j: any = await res.json();
      if (!res.ok) throw new Error(j.message || "Could not create account");
      // sign in automatically
      const { error } = await authClient.signIn.email({ email: valid.email, password }, { onSuccess: captureToken });
      if (error) throw new Error(error.message);
      navigate("/rider");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (lookup.isLoading) return <FullLoader label="Checking your invite…" />;

  if (!valid) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink px-6 text-center">
        <div className="max-w-sm space-y-4">
          <Logo />
          <h1 className="text-xl font-bold text-white">Invite not available</h1>
          <p className="text-sm text-slate-400">This invitation link is invalid, expired, or already used.</p>
          <Link to="/sign-in" className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-glow">Go to sign in <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* left: brand / pitch */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-deep p-12 text-white lg:flex">
        <Logo />
        <div className="space-y-6">
          <h2 className="text-3xl font-extrabold leading-tight">Welcome to the {company} field team.</h2>
          <ul className="space-y-3 text-white/90">
            <li className="flex items-center gap-3"><MapPin className="h-5 w-5" /> Get assigned jobs near you</li>
            <li className="flex items-center gap-3"><Navigation className="h-5 w-5" /> Turn-by-turn navigation to clients</li>
            <li className="flex items-center gap-3"><Radio className="h-5 w-5" /> Share live location — clients track your ETA</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5" /> Update job status & get paid faster</li>
          </ul>
        </div>
        <p className="text-sm text-white/70">Invited as a {valid.skillClass} {workerNoun.toLowerCase()}.</p>
      </div>

      {/* right: form */}
      <div className="grid place-items-center bg-ink px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden"><Logo /></div>
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-brand/15 px-3 py-1 text-xs font-bold text-cyan-glow"><Wrench className="h-3.5 w-3.5" /> {workerNoun} onboarding</div>
            <h1 className="text-2xl font-extrabold text-white">Set up your account</h1>
            <p className="mt-1 text-sm text-slate-400">For <span className="font-semibold text-slate-200">{valid.email}</span></p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input aria-label={valid.name || "Full name"} value={name} onChange={(e) => setName(e.target.value)} placeholder={valid.name || "Full name"} className="w-full rounded-xl border border-white/10 bg-ink-2 py-3 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-brand focus:outline-none" />
            </div>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input aria-label="Mobile phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile phone" className="w-full rounded-xl border border-white/10 bg-ink-2 py-3 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-brand focus:outline-none" />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input aria-label="Create a password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" className="w-full rounded-xl border border-white/10 bg-ink-2 py-3 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-brand focus:outline-none" />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={loading || !password} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-deep disabled:opacity-60">
              {loading ? <Loader className="h-5 w-5 border-white/40 border-t-white" /> : <>Activate my account <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
          <p className="text-center text-xs text-slate-500">Already set up? <Link to="/sign-in" className="font-semibold text-cyan-glow">Sign in</Link></p>
        </div>
      </div>
    </div>
  );
}
