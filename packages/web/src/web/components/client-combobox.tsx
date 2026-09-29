import { useEffect, useMemo, useRef, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { inputCls } from "./modal";

export interface ClientOption {
  id: string;
  name: string;
  email?: string;
}

/**
 * Searchable client picker for the New/Edit Work Order modal.
 *
 * Replaces a plain <select> that rendered every client as an <option> —
 * fine for a handful of clients, but a real business with hundreds (or
 * thousands) of them turned that into an unusable, unsearchable wall of a
 * native dropdown. This is a type-to-filter combobox instead: click it (or
 * start typing) and the list narrows to whatever matches the name or email
 * as you go, same way the address field elsewhere in this form already
 * works.
 *
 * Filtering happens over the `clients` list already loaded into the modal
 * (one fetch, not one request per keystroke) — plenty fast up to several
 * thousand rows client-side.
 */
export function ClientCombobox({
  clients,
  value,
  onChange,
  noun = "Client",
  onCreateNew,
}: {
  clients: ClientOption[];
  value: string;
  onChange: (id: string) => void;
  noun?: string;
  /**
   * Offered as a row at the bottom of the dropdown whenever there's typed
   * text that doesn't already match — e.g. the office is booking someone
   * who isn't in the CRM yet. Passing this switches the parent into a
   * "create new" flow (name + email inputs) instead of picking from here;
   * whether that actually creates a new record or finds a duplicate is
   * decided server-side when the work order is saved (see bookings.ts —
   * same email anywhere reuses the existing person instead of duplicating
   * them).
   */
  onCreateNew?: (typedName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => clients.find((c) => c.id === value), [clients, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? clients
      : clients.filter(
          (c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q),
        );
    return list.slice(0, 50); // keep the open list snappy even with thousands of clients
  }, [clients, query]);

  useEffect(() => setHighlight(0), [query, open]);

  function pick(c: ClientOption) {
    onChange(c.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          aria-label={`Search ${noun.toLowerCase()}s`}
          className={`${inputCls} pl-9 ${selected && !open ? "pr-9" : ""}`}
          placeholder={selected && !open ? undefined : `Search ${noun.toLowerCase()}s by name or email…`}
          value={open ? query : selected ? `${selected.name}${selected.email ? ` — ${selected.email}` : ""}` : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {selected && !open && (
          <button
            type="button"
            aria-label={`Clear selected ${noun.toLowerCase()}`}
            onClick={() => {
              onChange("");
              setQuery("");
              inputRef.current?.focus();
              setOpen(true);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-ink-2 py-1 shadow-2xl">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">
              No {noun.toLowerCase()}s match "{query}".
            </li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => pick(c)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm ${
                  i === highlight ? "bg-white/10" : "hover:bg-white/5"
                } ${c.id === value ? "text-brand" : "text-white"}`}
              >
                <span className="truncate font-medium">{c.name || "(no name)"}</span>
                {c.email && <span className="truncate text-xs text-slate-500">{c.email}</span>}
              </button>
            </li>
          ))}
          {onCreateNew && query.trim() && (
            <li className="border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  const typed = query.trim();
                  setQuery("");
                  setOpen(false);
                  onCreateNew(typed);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand hover:bg-white/5"
              >
                <UserPlus className="h-4 w-4 shrink-0" />
                <span className="truncate">Add "{query.trim()}" as a new {noun.toLowerCase()}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
