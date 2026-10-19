/**
 * Control Hub frame: the header, the section tabs, the Cmd-K command palette,
 * and the small pieces every hub screen shares (kind badges, where a switch's
 * value comes from, empty states). Looks like Analytics on purpose: hairline
 * cards, tabular numbers, one accent.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Command, CornerDownLeft, LayoutGrid, Search } from "lucide-react";
import { useDialog } from "../../../hooks/use-dialog";
import { PageHead } from "../shell";
import { hub, KIND_LABEL, ROLE_LABEL, type HubMe, type HubTenant, type TenantKind } from "./hub-data";

export function useHubMe() {
  return useQuery({ queryKey: ["hub", "me"], queryFn: () => hub<HubMe>("/me"), staleTime: 60_000 });
}

export function useHubTenants() {
  return useQuery({ queryKey: ["hub", "tenants"], queryFn: () => hub<{ tenants: HubTenant[] }>("/tenants"), staleTime: 30_000 });
}

const SECTIONS: { to: string; label: string; need?: keyof HubMe["can"] }[] = [
  { to: "/admin/hub", label: "Overview" },
  { to: "/admin/hub/tenants", label: "Companies" },
  { to: "/admin/hub/features", label: "Features" },
  { to: "/admin/hub/plans", label: "Plans" },
  { to: "/admin/hub/demos", label: "Demos" },
  { to: "/admin/hub/leads", label: "Leads & sales" },
  { to: "/admin/hub/ops", label: "Operations", need: "seeAudit" },
  { to: "/admin/hub/audit", label: "Audit", need: "seeAudit" },
  { to: "/admin/hub/team", label: "Team", need: "seeAudit" },
];

function sectionActive(loc: string, to: string) {
  if (to === "/admin/hub") return loc === "/admin/hub" || loc === "/admin/hub/";
  return loc === to || loc.startsWith(`${to}/`);
}

export function HubLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const [loc] = useLocation();
  const me = useHubMe();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const sections = SECTIONS.filter((s) => !s.need || me.data?.can[s.need]);
  return (
    <div className="page-wrap w-full min-w-0 px-4 py-6 pb-24 md:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-cyan-300/80">
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
        Control Hub
        {me.data && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] tracking-wide text-slate-300">{ROLE_LABEL[me.data.role]}</span>}
      </div>
      <PageHead
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] text-slate-300 transition hover:border-white/20 hover:text-white"
              aria-label="Open the command palette"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Jump to…
              <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border border-white/10 px-1 text-[10px] text-slate-400">
                <Command className="h-2.5 w-2.5" aria-hidden="true" />K
              </kbd>
            </button>
          </div>
        }
      />
      <nav aria-label="Control Hub sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-white/[0.06] px-1 pb-px">
        {sections.map((s) => {
          const on = sectionActive(loc, s.to);
          return (
            <Link
              key={s.to}
              href={s.to}
              aria-current={on ? "page" : undefined}
              className={`relative shrink-0 whitespace-nowrap rounded-t-lg px-3 py-2 text-[13px] font-medium transition ${on ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {s.label}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan-400" />}
            </Link>
          );
        })}
      </nav>
      {children}
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

const KIND_CLS: Record<TenantKind, string> = {
  customer: "border-white/[0.1] text-slate-300",
  demo: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  test: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  internal: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
};

export function KindBadge({ kind }: { kind: TenantKind }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${KIND_CLS[kind]}`}>{KIND_LABEL[kind]}</span>;
}

export function StatusText({ status }: { status: string }) {
  if (status === "active") return null;
  const cls = status === "suspended" ? "bg-amber-400/10 text-amber-200" : "bg-rose-400/10 text-rose-200";
  return <span className={`rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{status === "suspended" ? "Suspended" : "Closed"}</span>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[13px] text-slate-500">{children}</p>;
}

export function sourceText(source: string, inherited: boolean, kind?: string) {
  if (source === "override") return `Set here (default ${inherited ? "on" : "off"})`;
  if (source === "plan") return "Not in this plan";
  if (source === "kind") return `Default for ${kind ? KIND_LABEL[kind as TenantKind]?.toLowerCase() ?? kind : "this kind"} accounts`;
  return "Default";
}

/* ---------------------------------------------------- command palette -- */

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  href: string;
  keywords: string;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { panelRef, dialogProps, titleId } = useDialog({ open, onClose });
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ["hub", "tenants"], queryFn: () => hub<{ tenants: HubTenant[] }>("/tenants"), enabled: open, staleTime: 30_000 });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = SECTIONS.map((s) => ({ id: `p:${s.to}`, label: s.label, hint: "Go to", href: s.to, keywords: s.label }));
    pages.push({ id: "p:new-demo", label: "Make a demo", hint: "Action", href: "/admin/hub/demos?new=1", keywords: "new demo create" });
    pages.push({ id: "p:analytics", label: "Analytics", hint: "Go to", href: "/admin/analytics", keywords: "analytics numbers mrr" });
    const ts: PaletteItem[] = (tenants.data?.tenants ?? []).map((t) => ({
      id: `t:${t.id}`,
      label: t.name,
      hint: `${KIND_LABEL[t.kind]}${t.city ? ` · ${t.city}` : ""}`,
      href: `/admin/hub/tenants/${t.id}`,
      keywords: `${t.name} ${t.id} ${t.industryLabel} ${t.city} ${t.kind}`,
    }));
    const all = [...pages, ...ts];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all.slice(0, 12);
    return all.filter((i) => words.every((w) => i.keywords.toLowerCase().includes(w) || i.label.toLowerCase().includes(w))).slice(0, 12);
  }, [q, tenants.data]);

  if (!open) return null;
  const go = (i: PaletteItem | undefined) => {
    if (!i) return;
    onClose();
    void qc.invalidateQueries({ queryKey: ["hub"] });
    navigate(i.href);
  };
  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center px-4 pt-[12vh]">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} {...dialogProps} className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-ink-2 shadow-2xl outline-none">
        <h2 id={titleId} className="sr-only">
          Jump to a company or page
        </h2>
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4">
          <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[sel]);
              }
            }}
            placeholder="Company name, city, industry or page…"
            aria-label="Search companies and pages"
            className="h-12 w-full bg-transparent text-[15px] text-white placeholder:text-slate-500 focus:outline-none"
          />
        </div>
        <ul aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-slate-500">Nothing matches “{q}”.</li>}
          {items.map((i, n) => (
            <li key={i.id}>
              <button
                type="button"
                aria-current={n === sel ? "true" : undefined}
                onMouseEnter={() => setSel(n)}
                onClick={() => go(i)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] ${n === sel ? "bg-white/[0.08] text-white" : "text-slate-300"}`}
              >
                <span className="truncate">{i.label}</span>
                <span className="flex shrink-0 items-center gap-2 text-[12px] text-slate-500">
                  {i.hint}
                  {n === sel && <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
