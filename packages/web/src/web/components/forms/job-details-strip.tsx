/**
 * The details every job already carries (from the work order), shown above a
 * template's questions so nobody adds them again as questions.
 */
import { Calendar, FileText, Lock, MapPin, Phone, User, Wrench } from "lucide-react";

export const BUILT_IN_DETAILS = [
  { icon: User, label: "Client name" },
  { icon: Phone, label: "Phone, tap to call" },
  { icon: MapPin, label: "Address" },
  { icon: Calendar, label: "Date and time" },
  { icon: Wrench, label: "Service" },
  { icon: FileText, label: "Job notes" },
] as const;

/** Words in a question that suggest it repeats a built-in job detail. */
export function duplicatesJobDetail(label: string): string | null {
  const l = label.toLowerCase();
  if (/\b(client|customer)('s)?\s*(name)?\b/.test(l) && !/sign|signature|present|home|concern|initial/.test(l)) return "the client's name";
  if (/\b(address|location|site address)\b/.test(l)) return "the address";
  if (/\b(phone|telephone|cell|mobile number)\b/.test(l)) return "the client's phone number";
  if (/\b(appointment|scheduled|visit)\s*(date|time)\b|^date( and time)?$|^time$/.test(l)) return "the date and time";
  return null;
}

export function JobDetailsStrip() {
  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-tour="job-details">
      <div className="flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-200">Job details, always included</p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        These come from the work order and show at the top of every job, so they don't need questions. Add only what the technician should record for this kind of job.
      </p>
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {BUILT_IN_DETAILS.map((d) => (
          <li key={d.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
            <d.icon className="h-3 w-3 text-slate-500" aria-hidden="true" /> {d.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A sample job header for previews: what the technician sees above the form. */
export function SampleJobHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-ink-3/60 p-3">
      <p className="text-[11px] text-slate-500">Job details · from the work order</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{title || "Untitled template"}</p>
      <ul className="mt-2 space-y-1.5 text-xs text-slate-300">
        <li className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> Sample client</li>
        <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> (204) 555-0142</li>
        <li className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> 123 Main St</li>
        <li className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> Today, 10:00 AM</li>
      </ul>
      <p className="mt-2 border-t border-white/5 pt-2 text-[11px] text-slate-500">This template's questions follow below.</p>
    </div>
  );
}
