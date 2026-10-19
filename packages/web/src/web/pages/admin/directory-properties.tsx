/**
 * The Directory's Properties tab: the named buildings, communities and sites a
 * company serves, each with the team member who manages it. Residents belong to
 * one (services/directory.ts), which is what lets a 2,500-person Directory be
 * sorted and grouped by property and by manager.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Search, Trash2, Users, ArrowUp, ArrowDown } from "lucide-react";
import { api } from "../../lib/api";
import { ok } from "../../lib/api-ok";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost, ConfirmModal } from "../../components/modal";
import { AddressAutocomplete } from "../../components/address-autocomplete";

export type PropertyItem = {
  id: string;
  name: string;
  address: string;
  notes: string;
  managerId: string | null;
  managerName: string;
  residents: number;
  openJobs: number;
  createdAt: string | null;
};
export type StaffOption = { id: string; name: string; role: string; kind: string };

/** The named properties and who can manage one. Shared by the tab, the filters and the assign dialog. */
export function useDirectoryProperties() {
  return useQuery({
    queryKey: ["directory-properties"],
    queryFn: async () => {
      const r = await ok(await api.directory.properties.$get());
      return { properties: r.properties as PropertyItem[], staff: r.staff as StaffOption[] };
    },
  });
}

/** Everything that shows a property or who's in one. */
export function invalidateDirectory(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["directory"] });
  qc.invalidateQueries({ queryKey: ["directory-properties"] });
  qc.invalidateQueries({ queryKey: ["admin-users"] });
}

type PropSort = "name" | "address" | "manager" | "residents" | "openJobs";

export function DirectoryProperties({
  edit,
  setEdit,
  onViewResidents,
  customerNoun,
  customerNounPlural,
}: {
  /** The property being edited, "new" while adding one, or null. */
  edit: PropertyItem | "new" | null;
  setEdit: (p: PropertyItem | "new" | null) => void;
  onViewResidents: (propertyId: string) => void;
  customerNoun: string;
  customerNounPlural: string;
}) {
  const data = useDirectoryProperties();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<PropSort>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    const all = data.data?.properties ?? [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = words.length
      ? all.filter((p) => {
          const hay = `${p.name} ${p.address} ${p.managerName} ${p.notes}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : all;
    const sign = dir === "desc" ? -1 : 1;
    const text = (a: string, b: string) => {
      // Blanks last either way, like the people table.
      if (!a && b) return 1;
      if (a && !b) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) * sign;
    };
    return [...hit].sort((a, b) => {
      const c =
        sort === "residents"
          ? (a.residents - b.residents) * sign
          : sort === "openJobs"
            ? (a.openJobs - b.openJobs) * sign
            : sort === "address"
              ? text(a.address, b.address)
              : sort === "manager"
                ? text(a.managerName, b.managerName)
                : text(a.name, b.name);
      return c || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
  }, [data.data, q, sort, dir]);

  const sortBy = (k: PropSort) => {
    if (k === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "residents" || k === "openJobs" ? "desc" : "asc");
    }
  };

  const total = data.data?.properties.length ?? 0;
  const head = (k: PropSort, label: string, cls = "") => (
    <th className={`px-4 py-3 font-semibold ${cls}`} aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-white">
        {label}
        {sort === k && (dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-400">Each {customerNoun.toLowerCase()} belongs to one property. Open one to change its manager.</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            aria-label="Search properties"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search properties…"
            className="w-full rounded-full border border-white/10 bg-ink-2 py-2 pl-9 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-brand sm:w-64"
          />
        </div>
      </div>

      <div className="nvc-card overflow-hidden">
        {data.isLoading ? (
          <p className="py-12 text-center text-sm text-slate-500">Loading properties…</p>
        ) : total === 0 ? (
          <div className="px-6 py-14 text-center">
            <Building2 className="mx-auto h-8 w-8 text-slate-600" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-slate-200">No properties yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Add your buildings, communities or sites and pick who manages each. Then put {customerNounPlural.toLowerCase()} in them with
              “Assign to property”, or with the Property and Unit columns of a {customerNounPlural.toLowerCase()} import.
            </p>
            <div className="mt-4 flex justify-center">
              <BtnPrimary onClick={() => setEdit("new")}>Add property</BtnPrimary>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs text-slate-500">
                  {head("name", "Property")}
                  {head("address", "Address", "hidden md:table-cell")}
                  {head("manager", "Manager", "hidden sm:table-cell")}
                  {head("residents", customerNounPlural, "text-right")}
                  {head("openJobs", "Open requests", "hidden text-right lg:table-cell")}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500">No properties match “{q}”</td>
                  </tr>
                ) : (
                  rows.map((p) => (
                    <tr key={p.id} onClick={() => setEdit(p)} className="cursor-pointer hover:bg-white/[0.03]">
                      <td className="px-4 py-3" aria-label={p.name}>
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/15 text-cyan-glow">
                            <Building2 className="h-4 w-4" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-100">{p.name}</p>
                            <p className="truncate text-xs text-slate-500 md:hidden">{p.address || "No address"}</p>
                            <p className="truncate text-xs text-slate-500 sm:hidden">{p.managerName ? `Manager: ${p.managerName}` : "No manager"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden max-w-[280px] truncate px-4 py-3 text-slate-400 md:table-cell">{p.address || "—"}</td>
                      <td className="hidden px-4 py-3 text-slate-300 sm:table-cell">{p.managerName || <span className="text-slate-600">No manager</span>}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewResidents(p.id);
                          }}
                          aria-label={`View the ${p.residents} ${customerNounPlural.toLowerCase()} at ${p.name}`}
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-brand/50 hover:text-white"
                        >
                          <Users className="h-3 w-3" aria-hidden /> {p.residents}
                        </button>
                      </td>
                      <td className="hidden px-4 py-3 text-right text-slate-300 lg:table-cell">{p.openJobs || <span className="text-slate-600">0</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PropertyEditor
        edit={edit}
        staff={data.data?.staff ?? []}
        onClose={() => setEdit(null)}
        onViewResidents={onViewResidents}
        customerNounPlural={customerNounPlural}
      />
    </>
  );
}

const EMPTY = { name: "", address: "", notes: "", managerId: "" };

function PropertyEditor({
  edit,
  staff,
  onClose,
  onViewResidents,
  customerNounPlural,
}: {
  edit: PropertyItem | "new" | null;
  staff: StaffOption[];
  onClose: () => void;
  onViewResidents: (propertyId: string) => void;
  customerNounPlural: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const existing = edit && edit !== "new" ? edit : null;

  useEffect(() => {
    setErr("");
    const p = edit && edit !== "new" ? edit : null;
    setForm(p ? { name: p.name, address: p.address, notes: p.notes, managerId: p.managerId ?? "" } : { ...EMPTY });
  }, [edit]);

  const save = useMutation({
    mutationFn: async () => {
      const json = { name: form.name.trim(), address: form.address.trim(), notes: form.notes.trim(), managerId: form.managerId || null };
      const res = existing
        ? await api.directory.properties[":id"].$patch({ param: { id: existing.id }, json })
        : await api.directory.properties.$post({ json });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string }).message || "Couldn't save the property");
      return data;
    },
    onSuccess: () => {
      invalidateDirectory(qc);
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.directory.properties[":id"].$delete({ param: { id } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string }).message || "Couldn't remove the property");
      return data;
    },
    onSuccess: () => {
      invalidateDirectory(qc);
      setConfirmDelete(false);
      onClose();
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      setErr(e.message);
    },
  });

  const field = staff.filter((s) => s.kind === "field");
  const office = staff.filter((s) => s.kind !== "field");
  // A manager who has since left the team still shows, so saving doesn't silently drop them.
  const missingManager = existing?.managerId && !staff.some((s) => s.id === existing.managerId) ? existing : null;

  return (
    <>
      <Modal
        open={!!edit}
        onClose={onClose}
        title={existing ? existing.name : "Add property"}
        subtitle={existing ? `${existing.residents} ${customerNounPlural.toLowerCase()} · ${existing.openJobs} open requests` : "A building, community or site you serve"}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {existing ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <BtnGhost onClick={onClose}>Cancel</BtnGhost>
              <BtnPrimary disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : existing ? "Save property" : "Add property"}
              </BtnPrimary>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{err}</p>}
          <Field label="Property name">
            <input
              aria-label="Property name"
              className={inputCls}
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Maple Court"
            />
          </Field>
          <Field label="Address">
            <AddressAutocomplete
              value={form.address}
              placeholder="123 Main St, Winnipeg, MB"
              onResolve={({ address }) => setForm((f) => ({ ...f, address }))}
            />
          </Field>
          <Field label="Manager">
            <select
              aria-label="Manager"
              className={inputCls}
              value={form.managerId}
              onChange={(e) => setForm({ ...form, managerId: e.target.value })}
            >
              <option value="">No manager</option>
              {missingManager && <option value={missingManager.managerId!}>{missingManager.managerName || "Former team member"}</option>}
              {field.length > 0 && (
                <optgroup label="Field team">
                  {field.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {office.length > 0 && (
                <optgroup label="Office team">
                  {office.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              aria-label="Notes"
              className={inputCls}
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Lockbox codes, parking, the superintendent's hours…"
            />
          </Field>
          {existing && existing.residents > 0 && (
            <button
              onClick={() => {
                onViewResidents(existing.id);
                onClose();
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-cyan-glow hover:underline"
            >
              <Users className="h-3.5 w-3.5" aria-hidden /> View the {existing.residents} {customerNounPlural.toLowerCase()} here
            </button>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => existing && remove.mutate(existing.id)}
        title="Remove property"
        confirmLabel="Remove"
        message={`Remove ${existing?.name ?? "this property"}? Its ${existing?.residents ?? 0} ${customerNounPlural.toLowerCase()} stay in your Directory with no property, and its job history is kept.`}
        pending={remove.isPending}
      />
    </>
  );
}
