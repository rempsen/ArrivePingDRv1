/**
 * A four-step guide the first time someone opens the form editor:
 * Add → Drag → Preview → Save. Dismissible, remembered in this browser.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const KEY = "builder:tour:v2:done";

const STEPS: { target: string; title: string; body: string }[] = [
  { target: "palette", title: "Add questions", body: "Click a type to add it below the selected question, or drag it to exactly where you want it." },
  { target: "canvas", title: "Drag to reorder", body: "Grab the handle on the left of any question. A section brings its questions with it." },
  { target: "preview", title: "Try it as a technician", body: "Preview shows the form the way it looks on the phone. Answers, logic and required checks all work." },
  { target: "save", title: "Save when it's right", body: "Each save becomes a new version. Jobs already booked keep the version they were booked with." },
];

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function BuilderTour({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!enabled || seen() || window.innerWidth < 1280) return;
    const t = setTimeout(() => setStep(0), 700);
    return () => clearTimeout(t);
  }, [enabled]);

  useLayoutEffect(() => {
    if (step === null) return;
    const find = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step]!.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    find();
    window.addEventListener("resize", find);
    window.addEventListener("scroll", find, true);
    return () => {
      window.removeEventListener("resize", find);
      window.removeEventListener("scroll", find, true);
    };
  }, [step]);

  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setStep(null);
  };

  if (step === null || !rect) return null;
  const s = STEPS[step]!;
  const right = rect.left + rect.width / 2 < window.innerWidth / 2;
  const top = Math.min(window.innerHeight - 190, Math.max(12, rect.top + 8));
  const left = right ? Math.min(window.innerWidth - 300, rect.right + 12) : Math.max(12, rect.left - 300);

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[60] rounded-xl ring-2 ring-cyan-400 ring-offset-4 ring-offset-transparent transition-all"
        style={{ top: rect.top - 2, left: rect.left - 2, width: rect.width + 4, height: Math.min(rect.height + 4, window.innerHeight - rect.top) }}
      />
      <div aria-live="polite" aria-label={s.title} className="fixed z-[61] w-[288px] rounded-xl border border-cyan-400/40 bg-ink-3 p-4 shadow-2xl shadow-black/60" style={{ top, left }}>
        <button type="button" onClick={finish} aria-label="Close the guide" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white/5 hover:text-white">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="text-[11px] text-cyan-300">
          Step {step + 1} of {STEPS.length}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-white">{s.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{s.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={finish} className="text-xs text-slate-400 hover:text-white">
            Skip the guide
          </button>
          <button type="button" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep">
            {step + 1 < STEPS.length ? "Next" : "Got it"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
