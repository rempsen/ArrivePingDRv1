import { useEffect, useId, useRef, useState } from "react";
import { Check, Compass, PlayCircle } from "lucide-react";
import { tourAttr } from "./anchors";
import { useGuide } from "./GuideProvider";
import { interpolate } from "./registry";

/**
 * The always-available entry point to the Guide: a button that opens the
 * chapter list. Phase 3 grows this into the full Guide panel (Help Center
 * search + Ask ArrivePing); the trigger and anchor stay the same.
 */
export function GuideButton({ variant }: { variant: "sidebar" | "icon" }) {
  const { chapters, status, startChapter, terms } = useGuide();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const done = chapters.filter((c) => status[c.id] === "completed").length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        {...tourAttr("guide.button")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={variant === "icon" ? "Guide and help" : undefined}
        onClick={() => setOpen((o) => !o)}
        className={
          variant === "sidebar"
            ? "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.04] hover:text-slate-200"
            : "grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/5"
        }
      >
        <Compass className="h-[17px] w-[17px] shrink-0 text-brand" aria-hidden="true" />
        {variant === "sidebar" && (
          <>
            <span className="flex-1 text-left">Guide &amp; help</span>
            <span className="text-[11px] tabular-nums text-slate-600">
              {done}/{chapters.length}
            </span>
          </>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute z-50 w-72 rounded-xl border border-white/10 bg-ink-2 p-2 shadow-2xl ${variant === "sidebar" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"}`}
        >
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Guided tours</p>
          {chapters.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                startChapter(c.id);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[0.05]"
            >
              {status[c.id] === "completed" ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-live" aria-label="Completed" />
              ) : (
                <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-100">{interpolate(c.title, terms)}</span>
                <span className="block text-xs text-slate-500">
                  {interpolate(c.summary, terms)} · {c.steps.length} steps
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
