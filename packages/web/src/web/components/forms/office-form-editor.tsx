/** Office correction of a job's form answers (saved under the office person's name). */
import { FormFill } from "./form-fill";
import { useJobForm } from "./use-job-form";

export function OfficeFormEditor({ bookingId, by }: { bookingId: string; by?: string }) {
  const jf = useJobForm(bookingId);
  if (!jf.data) return <p className="text-sm text-slate-500">{jf.loading ? "Loading the form…" : "This job has no form."}</p>;
  return (
    <div className="space-y-2">
      <p aria-live="polite" className={`text-right text-[11px] ${jf.saveState === "error" ? "text-red-400" : "text-slate-500"}`}>
        {jf.saveState === "saving" ? "Saving…" : jf.saveState === "error" ? (
          <button type="button" onClick={jf.retry} className="underline">
            Not saved. Retry
          </button>
        ) : "Changes save as you go"}
      </p>
      <FormFill form={jf.data.form} answers={jf.answers} onAnswer={jf.answer} uploadPhoto={jf.uploadPhoto} photoUrls={jf.photoUrls} by={by} />
    </div>
  );
}
