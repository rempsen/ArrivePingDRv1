import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { inputCls, BtnGhost, BtnPrimary } from "./modal";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MINUTE_STEP = 5;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Same "YYYY-MM-DDTHH:mm" shape the native datetime-local input used —
 * kept so every call site (buildPayload, the editBooking populate effect,
 * etc.) that already reads/writes scheduledAt in this format needs no
 * changes. `new Date(...)` on this exact shape parses it as LOCAL time,
 * which is what round-trips correctly here. */
function toLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseValue(value: string): Date {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatDisplay(d: Date) {
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateStr}, ${timeStr}`;
}

/**
 * Replaces the browser's native <input type="datetime-local"> picker.
 *
 * The native widget commits every click immediately and only closes when you
 * click elsewhere — nothing on screen ever says "that took", so office staff
 * kept re-checking or re-clicking it. This version holds the date/month/time
 * you're setting as a DRAFT until you hit the Save/Update button in the
 * bottom-right of the popover; clicking outside or Cancel discards the draft
 * and keeps whatever was last actually saved. One explicit action, one clear
 * confirmation — not an implicit blur.
 */
export function DateTimePicker({
  value,
  onChange,
  saveLabel = "Save",
  ariaLabel = "Schedule",
}: {
  value: string;
  onChange: (value: string) => void;
  saveLabel?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => parseValue(value));
  const boxRef = useRef<HTMLDivElement>(null);

  // Re-seed the draft from the committed value each time the popover opens,
  // so re-opening never shows a stale in-progress edit from last time.
  useEffect(() => {
    if (open) setDraft(parseValue(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const committed = useMemo(() => parseValue(value), [value]);
  const monthCursor = useMemo(() => new Date(draft.getFullYear(), draft.getMonth(), 1), [draft]);

  const grid = useMemo(() => {
    const first = monthCursor;
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const leading = first.getDay();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(first.getFullYear(), first.getMonth(), day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [monthCursor]);

  function setDay(d: Date) {
    setDraft((prev) => {
      const next = new Date(prev);
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      return next;
    });
  }
  function shiftMonth(delta: number) {
    setDraft((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  }
  function setHour12(h12: number) {
    setDraft((prev) => {
      const next = new Date(prev);
      const isPM = prev.getHours() >= 12;
      const h24 = (h12 % 12) + (isPM ? 12 : 0);
      next.setHours(h24);
      return next;
    });
  }
  function setMinute(m: number) {
    setDraft((prev) => {
      const next = new Date(prev);
      next.setMinutes(m);
      return next;
    });
  }
  function setMeridiem(pm: boolean) {
    setDraft((prev) => {
      const next = new Date(prev);
      const h12 = prev.getHours() % 12;
      next.setHours(pm ? h12 + 12 : h12);
      return next;
    });
  }

  const today = new Date();
  const hour12 = draft.getHours() % 12 === 0 ? 12 : draft.getHours() % 12;
  const isPM = draft.getHours() >= 12;
  const minuteRounded = Math.round(draft.getMinutes() / MINUTE_STEP) * MINUTE_STEP;

  function save() {
    onChange(toLocalValue(draft));
    setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
      >
        <span>{value ? formatDisplay(committed) : "Pick a date & time…"}</span>
        <CalendarDays className="h-4 w-4 flex-shrink-0 text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[320px] rounded-xl border border-white/10 bg-ink-2 p-3 shadow-2xl">
          {/* month header */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">
              {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* weekday row */}
          <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] font-medium text-slate-500">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>

          {/* day grid */}
          <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
            {grid.map((d, i) => {
              if (!d) return <span key={i} />;
              const isSelected = d.toDateString() === draft.toDateString();
              const isToday = d.toDateString() === today.toDateString();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setDay(d)}
                  className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                    isSelected
                      ? "bg-brand font-semibold text-white"
                      : isToday
                        ? "text-brand ring-1 ring-brand/40"
                        : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* time controls */}
          <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
            <select
              aria-label="Hour"
              value={hour12}
              onChange={(e) => setHour12(Number(e.target.value))}
              className="min-h-9 flex-1 rounded-lg border border-white/10 bg-ink-3/60 px-2 py-1 text-sm text-white focus:border-brand focus:outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span className="text-slate-500">:</span>
            <select
              aria-label="Minute"
              value={minuteRounded}
              onChange={(e) => setMinute(Number(e.target.value))}
              className="min-h-9 flex-1 rounded-lg border border-white/10 bg-ink-3/60 px-2 py-1 text-sm text-white focus:border-brand focus:outline-none"
            >
              {Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP).map((m) => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setMeridiem(false)}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${!isPM ? "bg-brand text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
              >
                AM
              </button>
              <button
                type="button"
                onClick={() => setMeridiem(true)}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${isPM ? "bg-brand text-white" : "bg-transparent text-slate-400 hover:text-white"}`}
              >
                PM
              </button>
            </div>
          </div>

          {/* footer: explicit confirm, bottom-right — nothing above this line
              has touched the real value yet */}
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setDraft(new Date())}
              className="text-xs font-medium text-brand hover:text-brand-deep"
            >
              Today
            </button>
            <div className="flex items-center gap-2">
              <BtnGhost type="button" onClick={() => setOpen(false)}>Cancel</BtnGhost>
              <BtnPrimary type="button" onClick={save}>{saveLabel}</BtnPrimary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
