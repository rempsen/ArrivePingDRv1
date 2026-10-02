import { useId, useState, type FormEvent } from "react";
import { brand, closing } from "../config";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function DemoForm() {
  const uid = useId();
  const f = closing.form;
  const [values, setValues] = useState({ name: "", email: "", company: "", teamSize: "", website: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const er: typeof errors = {};
    if (!values.name.trim()) er.name = "Please enter your name.";
    if (!EMAIL_RE.test(values.email.trim())) er.email = "Please enter a valid work email.";
    if (!values.company.trim()) er.company = "Please enter your company name.";
    setErrors(er);
    if (Object.keys(er).length) return;

    setStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/public/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          company: values.company.trim(),
          teamSize: values.teamSize || undefined,
          website: values.website || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || !data.ok) {
        setStatus({ kind: "error", message: data.error?.message || `We couldn't send your request. Please email ${brand.contactEmail}.` });
        return;
      }
      setStatus({ kind: "ok" });
    } catch {
      setStatus({ kind: "error", message: `We couldn't reach the server. Please email ${brand.contactEmail}.` });
    }
  }

  if (status.kind === "ok") {
    return (
      <div className="form-card" role="status" aria-live="polite">
        <h3>Thanks — we'll be in touch.</h3>
        <p className="small">
          Your request has gone to the ArrivePing team. Expect a reply from {brand.contactEmail} within one business day.
        </p>
      </div>
    );
  }

  const loading = status.kind === "loading";

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate aria-busy={loading}>
      <h3>{f.title}</h3>
      <p className="small">{closing.body}</p>
      <div className="form-grid">
        <Field id={`${uid}-name`} label={f.fields.name} error={errors.name}>
          <input id={`${uid}-name`} name="name" autoComplete="name" value={values.name} onChange={set("name")} required aria-invalid={!!errors.name} />
        </Field>
        <Field id={`${uid}-email`} label={f.fields.email} error={errors.email}>
          <input id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={set("email")} required aria-invalid={!!errors.email} />
        </Field>
        <Field id={`${uid}-company`} label={f.fields.company} error={errors.company}>
          <input id={`${uid}-company`} name="company" autoComplete="organization" value={values.company} onChange={set("company")} required aria-invalid={!!errors.company} />
        </Field>
        <Field id={`${uid}-size`} label={f.fields.teamSize}>
          <select id={`${uid}-size`} name="teamSize" value={values.teamSize} onChange={set("teamSize")}>
            <option value="">Select…</option>
            {f.teamSizes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {/* honeypot — hidden from people, filled by bots */}
        <div className="hp" aria-hidden="true">
          <label htmlFor={`${uid}-website`}>Website</label>
          <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} />
        </div>
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? "Sending…" : f.submit}
        </button>
        {status.kind === "error" && (
          <div className="form-status form-status--err" role="alert">
            {status.message}
          </div>
        )}
        <p className="small" style={{ fontSize: 12 }}>
          We only use these details to arrange your demo. Prefer email? <a className="link" href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>
        </p>
      </div>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field" data-invalid={!!error}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <div className="field__error" id={`${id}-err`}>
          {error}
        </div>
      )}
    </div>
  );
}
