import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiHeaders } from "../lib/api";
import { useAuth } from "../hooks/use-auth";
import { activeCompany, switchCompany } from "../lib/tenant";
import { Building2, ChevronsUpDown, Check, Search } from "lucide-react";
import { INDEX_THRESHOLD, groupAlpha, matchesQuery } from "../lib/alpha-index";

type Company = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  project_manager: "Project manager",
  rider: "Technician",
  customer: "Client",
};

/**
 * Company selector.
 *
 * Shows for two audiences:
 *  - superadmins, who can act as any tenant (amber "acting as tenant" styling,
 *    unchanged), and
 *  - anyone who genuinely belongs to more than one company, e.g. a contract
 *    technician working for both Acme and Bolt. They see only their own
 *    companies and the role they hold at each.
 *
 * Someone with a single company sees nothing at all, so the common case is
 * exactly as it was before.
 */
export function TenantSwitcher() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stored = activeCompany();

  const { data } = useQuery({
    queryKey: ["me", "companies"],
    queryFn: async () => {
      const res = await fetch("/api/me/companies", { headers: apiHeaders() });
      if (!res.ok) return { companies: [], superadmin: false, activeCompanyId: null };
      return res.json();
    },
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Fresh search + focus every time the menu opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const isSuper = role === "superadmin" || !!data?.superadmin;
  const companies = ((data?.companies ?? []) as Company[]).filter(
    (c) => c.status !== "suspended",
  );
  // The server is the source of truth for what we're acting as; localStorage is
  // only a hint (and may be stale after a membership is revoked).
  const active = stored ?? data?.activeCompanyId ?? "default";

  const list = isSuper
    ? companies.some((c) => c.id === "default")
      ? companies
      : [{ id: "default", name: "ArrivePing (Home)" }, ...companies]
    : companies;
  const current = list.find((c) => c.id === active);

  // Alphabetical, with the platform home tenant pinned to the top so it's
  // always one click away no matter how many tenants exist.
  const sorted = useMemo(() => {
    const home = list.filter((c) => c.id === "default");
    const rest = list
      .filter((c) => c.id !== "default")
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return [...home, ...rest];
  }, [list]);
  const searchable = sorted.length >= 6;
  const visible = useMemo(
    () => (query ? sorted.filter((c) => matchesQuery(query, [c.name, c.id])) : sorted),
    [sorted, query],
  );
  // Letter dividers only help on long, unfiltered lists.
  const dividers = !query && sorted.length >= INDEX_THRESHOLD;
  const groups = useMemo(
    () => (dividers ? groupAlpha(visible.filter((c) => c.id !== "default"), (c) => c.name) : null),
    [dividers, visible],
  );
  // Flat order used for keyboard navigation (matches render order).
  const flat = useMemo(
    () =>
      groups
        ? [...visible.filter((c) => c.id === "default"), ...groups.flatMap((g) => g.items)]
        : visible,
    [groups, visible],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // A single-company person has nothing to switch between — render nothing.
  // (Kept below every hook so the hook order is stable across renders.)
  if (!isSuper && companies.length < 2) return null;
  if (isSuper && companies.length === 0) return null;

  function pick(c: Company) {
    setOpen(false);
    if (c.id !== active) switchCompany(c.id);
  }

  function onKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = flat[cursor];
      if (c) pick(c);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  let idx = 0;
  const row = (c: Company) => {
    const i = idx++;
    return (
      <button
        key={c.id}
        role="option"
        data-idx={i}
        aria-selected={c.id === active}
        onMouseEnter={() => setCursor(i)}
        onClick={() => pick(c)}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-300 transition ${
          i === cursor ? "bg-white/5" : ""
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate">{c.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {/* Superadmins care about the tenant slug; a technician cares
                about what they are at that company. */}
            {isSuper ? c.id : (ROLE_LABEL[c.role ?? ""] ?? c.role ?? "")}
          </span>
        </span>
        {c.id === active && <Check className="h-4 w-4 shrink-0 text-cyan-glow" />}
      </button>
    );
  };

  const label = isSuper ? "Acting as tenant" : "Company";
  const tone = isSuper
    ? "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-500/50"
    : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20";
  const labelTone = isSuper ? "text-amber-400/70" : "text-slate-500";

  return (
    <div ref={ref} className="relative px-3 py-3">
      <div
        className={`mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide ${labelTone}`}
      >
        {label}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${tone}`}
        title={isSuper ? "Switch active tenant" : "Switch company"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Building2 className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.name ?? "Select company"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-ink-2 shadow-2xl"
          onKeyDown={onKey}
        >
          {searchable && (
            <div className="relative border-b border-white/5 p-2">
              <Search className="pointer-events-none absolute left-[18px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isSuper ? "Search tenants…" : "Search companies…"}
                aria-label="Search companies"
                className="w-full rounded-lg border border-white/10 bg-ink py-1.5 pl-8 pr-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand/60 focus:outline-none"
              />
            </div>
          )}
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1" role="listbox">
            {flat.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-500">
                No match for “{query.trim()}”
              </p>
            ) : groups ? (
              <>
                {visible.filter((c) => c.id === "default").map(row)}
                {groups.map((g) => (
                  <div key={g.letter}>
                    <div className="sticky top-0 z-10 bg-ink-2/95 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 backdrop-blur">
                      {g.letter}
                    </div>
                    {g.items.map(row)}
                  </div>
                ))}
              </>
            ) : (
              visible.map(row)
            )}
          </div>
          {searchable && (
            <div className="border-t border-white/5 px-3 py-1.5 text-[10px] text-slate-600">
              {query ? `${flat.length} of ${sorted.length}` : `${sorted.length} total`} · ↑↓ to move, Enter to switch
            </div>
          )}
        </div>
      )}
    </div>
  );
}
