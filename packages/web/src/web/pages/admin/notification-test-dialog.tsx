/**
 * The Test button on a notification event. It sends the event's text and
 * email messages to the person testing, never to a customer, and says what
 * happened to each one: sent, or why not, in words they can act on.
 *
 * The mobile number comes from their profile; when they have none, they
 * type it here and it is saved to their profile (so office texts reach them
 * too), unless they untick that.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleMinus, Mail, MessageSquare, Send, XCircle } from "lucide-react";
import { apiHeaders } from "../../lib/api";
import { useAuth } from "../../hooks/use-auth";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost } from "../../components/modal";

export type TestPlanRow = { recipientLabel: string; sms: boolean; email: boolean };

type Result = {
  recipientLabel: string;
  channel: "sms" | "email";
  status: "sent" | "failed" | "skipped";
  target: string;
  detail: string;
};

export function NotificationTestDialog({
  event,
  label,
  plan,
  onClose,
}: {
  event: string;
  label: string;
  /** What this event sends, per recipient, as the rules table shows it. */
  plan: TestPlanRow[];
  onClose: () => void;
}) {
  const { user, refetchSession } = useAuth();
  const qc = useQueryClient();
  const profilePhone = (user?.phone || "").trim();
  const [phone, setPhone] = useState(profilePhone);
  const [email, setEmail] = useState(user?.email || "");
  const [remember, setRemember] = useState(!profilePhone);
  const wantsSms = plan.some((p) => p.sms);
  const wantsEmail = plan.some((p) => p.email);
  const nothing = !wantsSms && !wantsEmail;

  const send = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/notif-config/test/${encodeURIComponent(event)}`, {
        method: "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: wantsSms ? phone.trim() || undefined : undefined,
          email: wantsEmail ? email.trim() || undefined : undefined,
          rememberPhone: wantsSms && !profilePhone && remember,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; results?: Result[]; jobLabel?: string | null };
      if (!res.ok) throw new Error(body.message || "The test couldn't be sent. Try again.");
      return body as { results: Result[]; jobLabel: string | null };
    },
    onSuccess: () => {
      if (!profilePhone && remember && phone.trim()) refetchSession?.();
      qc.invalidateQueries({ queryKey: ["notif-deliveries"] });
    },
  });

  const phoneMissing = wantsSms && !phone.trim();
  const emailMissing = wantsEmail && !email.trim();
  const canSend = !nothing && !(phoneMissing && emailMissing) && !send.isPending;
  const results = send.data?.results;

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Test: ${label}`}
      subtitle="Sends this event's messages to you, not to anyone on a job."
      footer={
        <>
          <BtnGhost onClick={onClose}>{results ? "Done" : "Cancel"}</BtnGhost>
          {!nothing && (
            <BtnPrimary onClick={() => send.mutate()} disabled={!canSend}>
              <Send className="h-4 w-4" /> {send.isPending ? "Sending…" : results ? "Send again" : "Send test"}
            </BtnPrimary>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {nothing ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100">
            Nothing to test yet: this event has no text or email switched on. Turn on the message or envelope icon for a recipient in the table, then
            test again.
          </p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-sm text-slate-300">You'll get:</p>
              <ul className="space-y-1.5 text-sm">
                {plan
                  .filter((p) => p.sms || p.email)
                  .map((p) => (
                    <li key={p.recipientLabel} className="flex items-center gap-2 text-slate-200">
                      {p.sms && <MessageSquare className="h-4 w-4 text-cyan-glow" aria-hidden="true" />}
                      {p.email && <Mail className="h-4 w-4 text-cyan-glow" aria-hidden="true" />}
                      <span>
                        The {[p.sms && "text", p.email && "email"].filter(Boolean).join(" and ")} your {p.recipientLabel.toLowerCase()} gets
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            {wantsSms && (
              <Field
                label="Your mobile number"
                hint={
                  profilePhone
                    ? "From your profile. Change it here for this test only."
                    : "Needed for the text. Include the area code."
                }
              >
                <input
                  aria-label="Your mobile number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(204) 555-0123"
                  aria-invalid={phoneMissing || undefined}
                  className={`${inputCls} ${phoneMissing ? "border-amber-400/60" : ""}`}
                />
              </Field>
            )}
            {wantsSms && !profilePhone && (
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input type="checkbox" aria-label="Save this number to my profile" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[var(--brand,#06b6d4)]" />
                <span>
                  Save this number to my profile{user?.role === "admin" ? ", so texts meant for the office reach me too" : ""}.
                </span>
              </label>
            )}
            {wantsEmail && (
              <Field label="Your email">
                <input aria-label="Your email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputCls} />
              </Field>
            )}
          </>
        )}

        {send.isError && <p className="text-sm text-red-300" role="alert">{(send.error as Error).message}</p>}

        {results && (
          <div className="rounded-xl border border-white/10 bg-ink/50 p-3" aria-live="polite">
            {results.length === 0 ? (
              <p className="text-sm text-slate-300">Nothing was sent: this event has no text or email switched on.</p>
            ) : (
              <ul className="space-y-2">
                {results.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {r.status === "sent" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-label="Sent" />
                    ) : r.status === "failed" ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-label="Failed" />
                    ) : (
                      <CircleMinus className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-label="Not sent" />
                    )}
                    <span className="min-w-0">
                      <span className="text-slate-100">
                        {r.channel === "sms" ? "Text" : "Email"} for the {r.recipientLabel.toLowerCase()}
                        {r.status === "sent" ? ` sent to ${r.target}` : r.status === "failed" ? " failed" : " not sent"}
                      </span>
                      {r.detail && <span className="block text-xs text-slate-400">{r.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">
              {send.data?.jobLabel
                ? `Filled in with the details of ${send.data.jobLabel}. The job itself wasn't changed and nobody on it was messaged.`
                : "Filled in with example details, since there are no jobs yet."}{" "}
              Each test is also in the Delivery Log.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
