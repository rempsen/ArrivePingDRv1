import { useState } from "react";
import { useConfirm } from "../../components/confirm-dialog";
import { DialogPanel } from "../../components/dialog-panel";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { FullLoader } from "../../components/loader";
import { money, dismiss } from "../../lib/utils";
import { Plus, X, Pencil, Trash2, Clock } from "lucide-react";

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

  return (
    <div className="w-full min-w-0 space-y-5 px-4 py-6 pb-24 md:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-white">Services</h1>
          <p className="text-sm text-slate-500">
            {list.length} {list.length === 1 ? "service" : "services"} — these are the choices in the "Service" picker when you create a job, and on your customer booking page.
          </p>
        </div>
        <button
          onClick={() => setEditing(EMPTY)}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep"
        >
          <Plus className="h-4 w-4" /> New service
        </button>
      </div>

      {list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
          No services yet. Add your first one — it will show up immediately in the New Job dialog.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <div key={s.id} className="overflow-hidden rounded-2xl border border-white/5 nvc-card">
            {s.image && <img src={s.image} alt="" className="h-32 w-full object-cover" />}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-white">{s.name}</h3>
                  <span className="text-xs font-medium text-cyan-glow">{s.category}</span>
                </div>
                <div className="text-right">
                  <div className="font-extrabold text-white">{money(s.basePrice)}</div>
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="h-3 w-3" /> {s.durationMins} min
                  </span>
                </div>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{s.description}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditing(s as Svc)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({ title: `Delete "${s.name}"?`, message: "It will no longer be selectable on new jobs or the booking page. Existing jobs keep their service." }))
                      del.mutate(s.id);
                  }}
                  aria-label={`Delete ${s.name}`}
                  title={`Delete ${s.name}`}
                  className="grid w-10 place-items-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
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
