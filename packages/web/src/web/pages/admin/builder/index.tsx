/**
 * /admin/builder — job templates. With the Job forms v2 switch on this is the
 * template library (search, filter, open, duplicate, delete with undo, and
 * three ways to start a new one); with it off, the previous builder.
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LayoutTemplate, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../../../lib/api";
import { ok } from "../../../lib/api-ok";
import { useAccess } from "../../../hooks/use-access";
import { FullLoader } from "../../../components/loader";
import { PageWrap } from "../../../components/brand";
import { ConfirmModal } from "../../../components/modal";
import { toast } from "../../../components/toast";
import { PageHead } from "../shell";
import LegacyBuilderPage from "./legacy";
import { NewTemplateDialog } from "./new-template";
import { putSeed } from "./seed";
import { parseRateModel, EMPTY_RATE_MODEL } from "../../../../shared/pricing";
import { parseTechPayModel } from "../../../../shared/tech-pay";

export default function BuilderPage() {
  const { access, loading } = useAccess();
  if (loading && !access) return <FullLoader />;
  const on = access?.features?.includes("forms.v2");
  return on ? <TemplateLibrary /> : <LegacyBuilderPage />;
}

function TemplateLibrary() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [creating, setCreating] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const templatesQ = useQuery({ queryKey: ["templates"], queryFn: async () => ok(await api.templates.$get()) });
  const all = useMemo(() => ((templatesQ.data as any)?.templates ?? []) as any[], [templatesQ.data]);
  const cats = useMemo(() => [...new Set(all.map((t) => t.category || "General"))].sort(), [all]);
  const list = all
    .filter((t) => (!cat || (t.category || "General") === cat) && (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(new Date(b.updatedAt ?? b.createdAt)) - Number(new Date(a.updatedAt ?? a.createdAt)));

  const del = useMutation({
    mutationFn: async (id: string) => ok(await api.templates[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast({ kind: "success", message: "Template deleted", detail: "Jobs that used it keep their own copy of the form." });
      setDelId(null);
    },
  });

  function duplicate(t: any) {
    const k = putSeed({
      name: `${t.name} (copy)`,
      category: t.category,
      description: t.description,
      color: t.color,
      estimatedMins: t.estimatedMins,
      sendCustomerCopy: !!t.sendCustomerCopy,
      rateModel: parseRateModel(t.rateModel) ?? { ...EMPTY_RATE_MODEL },
      techPayModel: parseTechPayModel(t.techPayModel),
      collectPayment: t.collectPayment === "on_site" ? "on_site" : "",
      items: t.formDef?.items ?? [],
    });
    navigate(`/admin/builder/new?seed=${k}`);
  }

  const target = all.find((t) => t.id === delId);

  return (
    <PageWrap>
      <PageHead
        title="Job templates"
        subtitle="The forms technicians fill in on site, with each job type's prices and pay."
        actions={
          <button type="button" onClick={() => setCreating(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-deep">
            <Plus className="h-4 w-4" aria-hidden="true" /> New template
          </button>
        }
      />

      {templatesQ.isLoading ? (
        <FullLoader />
      ) : all.length === 0 ? (
        <div className="nvc-card mx-auto mt-6 max-w-xl p-8 text-center">
          <LayoutTemplate className="mx-auto h-9 w-9 text-cyan-300" aria-hidden="true" />
          <p className="mt-3 text-base font-semibold text-white">Make your first job template</p>
          <p className="mt-1 text-sm text-slate-400">Start from a ready-made form for your trade, describe the job and let AI draft it, or build one from scratch.</p>
          <button type="button" onClick={() => setCreating(true)} className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-deep">
            <Plus className="h-4 w-4" aria-hidden="true" /> New template
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="h-10 w-full rounded-lg border border-white/10 bg-ink-3/60 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-brand focus:outline-none" />
            </div>
            <div className="flex flex-wrap gap-1">
              {["", ...cats].map((c) => (
                <button
                  key={c || "all"}
                  type="button"
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${cat === c ? "bg-white/15 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                >
                  {c || `All (${all.length})`}
                </button>
              ))}
            </div>
          </div>
          {list.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No templates match. Clear the search or pick another category.</p>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((t) => (
              <li key={t.id} className="group relative">
                <Link href={`/admin/builder/${t.id}`} className="nvc-card flex h-full flex-col p-4 transition hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
                  <span className="flex items-start gap-3 pr-8">
                    <span className="mt-1 h-8 w-1.5 shrink-0 rounded-full" style={{ background: t.color || "#0ea5e9" }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block break-words text-[15px] font-semibold leading-snug text-white">{t.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{t.category || "General"}</span>
                    </span>
                  </span>
                  {t.description && <span className="mt-2 line-clamp-2 text-[13px] text-slate-400">{t.description}</span>}
                  <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3 text-xs text-slate-400">
                    <span>{t.questionCount} question{t.questionCount === 1 ? "" : "s"}</span>
                    <span>~{t.estimatedMins} min</span>
                    <span>{t.jobCount ? `On ${t.jobCount} job${t.jobCount === 1 ? "" : "s"}` : "Not used yet"}</span>
                    {t.version > 0 && <span>Version {t.version}</span>}
                  </span>
                </Link>
                <div className="absolute right-2 top-2">
                  <button
                    type="button"
                    aria-label={`More for ${t.name}`}
                    aria-expanded={menu === t.id}
                    onClick={() => setMenu(menu === t.id ? null : t.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {menu === t.id && (
                    <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-white/10 bg-ink-3 p-1 shadow-xl">
                      <button type="button" onClick={() => duplicate(t)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5">
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          setDelId(t.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <NewTemplateDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmModal
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => delId && del.mutate(delId)}
        title="Delete template"
        message={`Delete “${target?.name ?? "this template"}”? ${target?.jobCount ? `The ${target.jobCount} job${target.jobCount === 1 ? "" : "s"} that used it keep their own copy of the form.` : "No jobs use it yet."}`}
        pending={del.isPending}
      />
    </PageWrap>
  );
}
