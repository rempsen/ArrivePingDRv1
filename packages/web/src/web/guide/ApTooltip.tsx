import { useEffect, useRef } from "react";
import type { TooltipRenderProps } from "react-joyride";
import { X } from "lucide-react";

/**
 * ArrivePing-styled step card for the Guide.
 *
 * Joyride v3 supplies the button props (labels, aria, handlers) and traps
 * focus; this component only decides how the card looks. Rules from the
 * blueprint: progress always visible ("2 of 4"), Back / Next / Skip on every
 * step, Esc exits the chapter (handled in TourRunner), short copy.
 */
export function ApTooltip(props: TooltipRenderProps) {
  const { index, size, step, isLastStep, backProps, primaryProps, skipProps, closeProps, tooltipProps } = props;
  const headingId = `ap-guide-step-${step.id ?? index}`;
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Move focus into the card so keyboard and screen-reader users land on it.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [index]);

  const chapterLabel = (step.data as { chapter?: string } | undefined)?.chapter;

  return (
    <div
      {...tooltipProps}
      aria-labelledby={headingId}
      className="ap-guide-card w-[min(360px,calc(100vw-24px))] rounded-2xl border border-white/10 bg-ink-2 p-4 text-left shadow-2xl ring-1 ring-brand/20"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {chapterLabel && (
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand">{chapterLabel}</p>
          )}
          <h2 id={headingId} className="mt-1 font-display text-base font-bold leading-snug text-white">
            {step.title}
          </h2>
        </div>
        <button
          {...closeProps}
          type="button"
          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 text-sm leading-relaxed text-slate-300">{step.content}</div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: size }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-brand" : i < index ? "w-1.5 bg-brand/60" : "w-1.5 bg-white/15"}`}
            />
          ))}
        </div>
        <span className="text-xs font-medium tabular-nums text-slate-500">
          {index + 1} of {size}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!isLastStep && (
            <button
              {...skipProps}
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-200"
            >
              Skip
            </button>
          )}
          {index > 0 && (
            <button
              {...backProps}
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5"
            >
              Back
            </button>
          )}
          <button
            {...primaryProps}
            ref={primaryRef}
            type="button"
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep"
          >
            {isLastStep ? "Done" : "Next"}
          </button>
        </div>
      </div>
      <p className="mt-2 hidden text-[10px] text-slate-600 sm:block">Esc to exit · ← → to move</p>
    </div>
  );
}
