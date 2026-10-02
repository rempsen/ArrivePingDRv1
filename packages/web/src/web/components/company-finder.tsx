import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import {
  INDEX_THRESHOLD,
  LETTERS,
  OTHER_BUCKET,
  groupAlpha,
  matchesQuery,
} from "../lib/alpha-index";

/**
 * Search box + A–Z jump bar + lettered sections for any long list of named
 * things. Built for the superadmin Companies page (hundreds of tenants) but
 * generic: give it the items, how to read a name, and which fields are
 * searchable, and it renders the grid you hand back from `renderGrid`.
 *
 * Behaviour:
 *  - Under INDEX_THRESHOLD items with no query → flat grid, nothing extra.
 *  - At or over the threshold → A–Z bar (letters with no entries are dimmed
 *    and unclickable) and the grid is split into lettered sections you can
 *    jump to. "#" collects names that start with a digit or symbol.
 *  - Typing a query flattens the list to the matches (the index would just
 *    point at holes) and shows "N of M" so people know the filter is on.
 *  - "/" focuses the search box from anywhere on the page, Esc clears it.
 */

export function useCompanyFinder() {
  const [query, setQuery] = useState("");
  return { query, setQuery };
}

type Props<T> = {
  finder: ReturnType<typeof useCompanyFinder>;
  items: T[];
  getName: (t: T) => string;
  /** Fields the search box matches against (name, slug, email, phone…). */
  getFields: (t: T) => Array<string | null | undefined>;
  /** Plural noun for the counter, e.g. "companies". */
  noun: string;
  renderGrid: (rows: T[]) => ReactNode;
  /** Optional slot to the right of the search box (filters, etc). */
  trailing?: ReactNode;
};

export function CompanyFinder<T>({
  finder,
  items,
  getName,
  getFields,
  noun,
  renderGrid,
  trailing,
}: Props<T>) {
  const { query, setQuery } = finder;
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);

  // "/" anywhere → focus search (unless already typing somewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(
    () => items.filter((it) => matchesQuery(query, getFields(it))),
    [items, query, getFields],
  );

  const indexed = items.length >= INDEX_THRESHOLD;
  const searching = query.trim().length > 0;
  const groups = useMemo(
    () => (indexed && !searching ? groupAlpha(filtered, getName) : null),
    [indexed, searching, filtered, getName],
  );
  const present = useMemo(() => new Set(groups?.map((g) => g.letter) ?? []), [groups]);

  // Track which section is in view so the jump bar highlights it.
  useEffect(() => {
    if (!groups) {
      setActiveLetter(null);
      return;
    }
    const els = groups
      .map((g) => document.getElementById(sectionId(g.letter)))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((en) => en.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActiveLetter(hit.target.getAttribute("data-letter"));
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);

  function jump(letter: string) {
    const el = document.getElementById(sectionId(letter));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveLetter(letter);
  }

  const showToolbar = items.length > 0;

  return (
    <div>
      {showToolbar && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[240px] flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={`Search ${noun} by name, slug, email or phone…`}
                aria-label={`Search ${noun}`}
                className="w-full rounded-xl border border-white/10 bg-ink-2 py-2.5 pl-9 pr-16 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  /
                </kbd>
              )}
            </label>
            {trailing}
            <span className="text-xs tabular-nums text-slate-500" aria-live="polite">
              {searching
                ? `${filtered.length} of ${items.length} ${noun}`
                : `${items.length} ${noun}`}
            </span>
          </div>
        </div>
      )}

      {groups && (
        <nav
          aria-label="Jump to letter"
          className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-0.5 rounded-xl border border-white/5 bg-ink/90 p-1 shadow-lg shadow-black/20 backdrop-blur"
        >
          {[...LETTERS, OTHER_BUCKET].map((l) => {
            const has = present.has(l);
            const isOn = activeLetter === l;
            return (
              <button
                key={l}
                type="button"
                disabled={!has}
                onClick={() => jump(l)}
                aria-current={isOn ? "true" : undefined}
                className={`grid h-7 min-w-7 place-items-center rounded-md px-1 font-mono text-xs font-semibold transition ${
                  !has
                    ? "cursor-default text-slate-700"
                    : isOn
                      ? "bg-brand/20 text-cyan-glow"
                      : "text-slate-300 hover:bg-white/10 hover:text-slate-100"
                }`}
              >
                {l}
              </button>
            );
          })}
        </nav>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-ink-2/50 p-10 text-center">
          <p className="text-sm text-slate-300">
            No {noun} match <span className="font-semibold text-slate-100">“{query.trim()}”</span>.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Try fewer words, or search by the slug or contact email instead.
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-4 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Clear search
          </button>
        </div>
      ) : groups ? (
        <div className="space-y-8">
          {groups.map((g) => (
            <section
              key={g.letter}
              id={sectionId(g.letter)}
              data-letter={g.letter}
              className="scroll-mt-16"
            >
              <div className="mb-3 flex items-baseline gap-2">
                <h3 className="font-mono text-lg font-bold text-slate-100">{g.letter}</h3>
                <span className="text-xs text-slate-500">
                  {g.items.length} {g.items.length === 1 ? noun.replace(/ies$/, "y").replace(/s$/, "") : noun}
                </span>
                <span className="h-px flex-1 bg-white/5" />
              </div>
              {renderGrid(g.items)}
            </section>
          ))}
        </div>
      ) : (
        renderGrid(filtered)
      )}
    </div>
  );
}

function sectionId(letter: string) {
  return `alpha-${letter === OTHER_BUCKET ? "other" : letter}`;
}
