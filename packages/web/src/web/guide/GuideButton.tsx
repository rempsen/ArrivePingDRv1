import { lazy, Suspense, useState } from "react";
import { Compass } from "lucide-react";
import { tourAttr } from "./anchors";
import { useGuide } from "./GuideProvider";

/** Lazy: the Help Center text only downloads when someone opens the panel. */
const GuidePanel = lazy(() => import("./GuidePanel"));

/**
 * The always-available entry point to the Guide: opens the Guide panel
 * (guided tours, Help Center search, contact). Sidebar variant shows tour
 * progress; the top-bar variant is an icon for phones.
 */
export function GuideButton({ variant }: { variant: "sidebar" | "icon" }) {
  const { chapters, status } = useGuide();
  const [open, setOpen] = useState(false);
  const done = chapters.filter((c) => status[c.id] === "completed").length;

  return (
    <>
      <button
        type="button"
        {...tourAttr("guide.button")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={variant === "icon" ? "Guide and help" : undefined}
        onClick={() => setOpen(true)}
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
        <Suspense fallback={null}>
          <GuidePanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
