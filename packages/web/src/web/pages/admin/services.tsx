import { useState } from "react";
import { useConfirm } from "../../components/confirm-dialog";
import { DialogPanel } from "../../components/dialog-panel";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { FullLoader } from "../../components/loader";
import { money, dismiss } from "../../lib/utils";
import { Plus, X, Pencil, Trash2, Clock, ChevronDown, ChevronRight, Search } from "lucide-react";

type Svc = {
  id?: string;
  name: string;
  category: string;
  description: string;
  image: string;
  basePrice: number;
  durationMins: number;
};

const EMPTY: Svc = { name: "", category: "General", description: "", image: "", basePrice: 0, durationMins: 60 };
// Category is free text (every trade names its work differently); these are
// only suggestions, merged with whatever categories the tenant already uses.
const SUGGESTED_CATEGORIES = ["General", "Installation", "Repair", "Maintenance", "Inspection", "Consultation", "Delivery"];

export default function AdminServices() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Svc | null>(null);
  const [q, setQ] = useState("");
  // Groups start open; the set holds the ones the admin has collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const services = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await api.services.$get()).json(),
  });

  const del = useMutation({
    mutationFn: async (id: string) => api.services[":id"].$delete({ param: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
  });

  if (services.isLoading) return <FullLoader label="Loading services…" />;
  const list = services.data?.services ?? [];
  const categories = Array.from(new Set([...list.map((s) => s.category).filter(Boolean), ...SUGGESTED_CATEGORIES]));

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? list.filter((s) => `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(needle))
    : list;
  // Group by category, biggest groups first, services A–Z inside each.
  const groups = new Map<string, typeof list>();
  for (const s of visible) {
    const key = s.category?.trim() || "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const ordered = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, items]) => [name, [...items].sort((x, y) => x.name.localeCompare(y.name))] as const);
  const allOpen = collapsed.size === 0;

  const toggle = (name: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="w-full min-w-0 space-y-5 px-4 py-6 pb-24 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-white">Services</h1>
          <p className="text-sm text-slate-500">
            {list.length} {list.length === 1 ? "service" : "services"} in {groups.size || 0} {groups.size === 1 ? "group" : "groups"} — the choices in the
            "Service" picker on new jobs and on your booking page.
          </p>
        </div>
        <button
          onClick={() => setEditing(EMPTY)}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep"
        >
          <Plus className="h-4 w-4" /> New service
        </button>
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              aria-label="Search services"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search services…"
              className="w-full rounded-lg border border-white/10 bg-ink-2 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-brand"
            />
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(allOpen ? new Set(ordered.map(([n]) => n)) : new Set())}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
          No services yet. Add your first one — it will show up immediately in the New Job dialog.
        </div>
      )}
      {list.length > 0 && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">No services match "{q}".</div>
      )}

      <div className="space-y-3">
        {ordered.map(([name, items]) => {
          const isOpen = !collapsed.has(name);
          return (
            <div key={name} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              <div className="flex items-center justify-between pr-2 hover:bg-white/5">
                <button
                  type="button"
                  onClick={() => toggle(name)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
                  <span className="truncate text-sm font-semibold text-white">{name}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {items.length} {items.length === 1 ? "service" : "services"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ ...EMPTY, category: name })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-cyan-glow hover:bg-white/10"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>

              {isOpen && (
                <ul className="divide-y divide-white/5 border-t border-white/10">
                  {items.map((s) => (
                    <li key={s.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04]">
                      {s.image ? (
                        <img src={s.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/5 text-[11px] font-bold text-slate-400">
                          {s.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">{s.name}</div>
                        {s.description && <div className="truncate text-[11px] text-slate-500">{s.description}</div>}
                      </div>
                      <span className="hidden shrink-0 items-center gap-1 text-xs text-slate-500 sm:flex">
                        <Clock className="h-3 w-3" /> {s.durationMins} min
                      </span>
                      <span className="w-20 shrink-0 text-right text-sm font-semibold text-white">{money(s.basePrice)}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(s as Svc)}
                          aria-label={`Edit ${s.name}`}
                          title="Edit"
                          className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `Delete "${s.name}"?`,
                                message: "It will no longer be selectable on new jobs or the booking page. Existing jobs keep their service.",
                              })
                            )
                              del.mutate(s.id);
                          }}
                          aria-label={`Delete ${s.name}`}
                          title="Delete"
                          className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white/10 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <ServiceModal
          svc={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["services"] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ServiceModal({ svc, categories, onClose, onDone }: { svc: Svc; categories: string[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Svc>(svc);
  const isEdit = !!svc.id;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        category: form.category.trim() || "General",
        description: form.description,
        image: form.image,
        basePrice: Number(form.basePrice),
        durationMins: Number(form.durationMins),
      };
      const r = isEdit
        ? await api.services[":id"].$patch({ param: { id: svc.id! }, json: payload })
        : await api.services.$post({ json: payload });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "Could not save this service");
      }
      return r;
    },
    onSuccess: onDone,
  });

  function set<K extends keyof Svc>(k: K, v: Svc[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" {...dismiss(onClose)}>
      <DialogPanel onClose={onClose} label={isEdit ? "Edit service" : "New service"} className="w-full max-w-4xl rounded-2xl bg-ink-2 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h3 className="font-bold text-white">{isEdit ? "Edit service" : "New service"}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Landscape layout: name spans two columns next to category/price;
            duration + image share the next row; description takes the full
            width. Collapses to a single column on phones. */}
        <div className="grid max-h-[82vh] gap-3 overflow-y-auto p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Field label="Name">
              <input aria-label="Service name" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="e.g. Site Visit & Measurement" />
            </Field>
          </div>
          <Field label="Category">
            <input
              aria-label="Category"
              list="service-categories"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              className={inputCls}
              placeholder="e.g. Installation"
            />
            <datalist id="service-categories">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </datalist>
          </Field>
          <Field label="Base price ($)">
            <input aria-label="Base price" type="number" min={0} step="0.01" value={form.basePrice} onChange={(e) => set("basePrice", Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Typical duration (minutes)">
            <input aria-label="Duration in minutes" type="number" min={5} step={5} value={form.durationMins} onChange={(e) => set("durationMins", Number(e.target.value))} className={inputCls} />
          </Field>
          <div className="sm:col-span-1 lg:col-span-3">
            <Field label="Image URL (optional)">
              <input aria-label="Image URL" value={form.image} onChange={(e) => set("image", e.target.value)} className={inputCls} placeholder="https://…" />
            </Field>
          </div>
          <div className="sm:col-span-full">
            <Field label="Description">
              <textarea aria-label="Description" value={form.description} onChange={(e) => set("description", e.target.value)} rows={4} className={inputCls} />
            </Field>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-4">
          {save.isError && <span className="mr-auto text-xs text-red-400">{(save.error as Error).message}</span>}
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-slate-400 hover:bg-white/5">
            Cancel
          </button>
          <button
            disabled={save.isPending || !form.name.trim()}
            onClick={() => save.mutate()}
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-ink-2 px-3 py-2 text-sm outline-none focus:border-brand";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-400">{label}</span>
      {children}
    </label>
  );
}
