import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { authClient } from "../lib/auth";
import { Logo } from "../components/brand";
import { Loader } from "../components/loader";
import { Lock, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";

export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  // better-auth appends ?token=... (and may append &error=... on bad/expired links)
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const token = params.get("token") ?? "";
  const linkError = params.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) throw new Error(error.message);
      setDone(true);
      setTimeout(() => navigate("/sign-in"), 2200);
    } catch (err: any) {
      setError(err.message || "Could not reset password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  }

  const invalid = !token || linkError;

  return (
    <div className="grid min-h-screen bg-ink md:grid-cols-2">
      <div className="nvc-grid-bg relative hidden overflow-hidden bg-ink-2 md:block">
        <div className="absolute -right-20 top-20 h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-cyan-glow/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Logo light />
          <div>
            <h1 className="font-display text-4xl font-extrabold leading-tight">
              Set a new
              <br /> <span className="text-glow text-cyan-glow">password.</span>
            </h1>
            <p className="mt-4 max-w-sm text-slate-400">
              Choose something strong and unique. You'll use it to sign in to
              your console.
            </p>
          </div>
          <p className="text-xs text-slate-600">
            Trusted by HVAC, plumbing, electrical &amp; facilities teams.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 md:hidden">
            <Logo light />
          </div>

          {invalid ? (
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-400">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-3xl font-extrabold text-white">
                Invalid or expired link
              </h2>
              <p className="mt-2 text-slate-400">
                This password reset link is no longer valid. Request a fresh one
                and we'll email it right over.
              </p>
              <Link
                to="/forgot-password"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 font-semibold text-white nvc-btn-primary transition hover:bg-brand-deep"
              >
                Request new link <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-green-500/15 text-green-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="mt-5 font-display text-3xl font-extrabold text-white">
                Password updated
              </h2>
              <p className="mt-2 text-slate-400">
                Your password has been reset. Redirecting you to sign in…
              </p>
            </div>
          ) : (
            <>
              <h2 className="font-display text-3xl font-extrabold text-white">
                Choose a new password
              </h2>
              <p className="mt-1 text-slate-400">
                Make it at least 8 characters.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input aria-label="New password"
                    type="password"
                    placeholder="New password"
                    value={password}
                    required
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-ink-2 py-3 pl-11 pr-4 text-white outline-none transition placeholder:text-slate-600 focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input aria-label="Confirm new password"
                    type="password"
                    placeholder="Confirm new password"
                    value={confirm}
                    required
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-ink-2 py-3 pl-11 pr-4 text-white outline-none transition placeholder:text-slate-600 focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 font-semibold text-white nvc-btn-primary transition hover:bg-brand-deep disabled:opacity-60"
                >
                  {loading ? (
                    <Loader className="h-5 w-5 border-white/40 border-t-white" />
                  ) : (
                    <>
                      Reset password
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-5 text-center text-sm text-slate-500">
                <Link
                  to="/sign-in"
                  className="inline-flex items-center gap-1.5 font-semibold text-cyan-glow hover:underline"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
