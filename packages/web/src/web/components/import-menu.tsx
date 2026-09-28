import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Upload, ChevronDown, FileText, FileSpreadsheet, Download,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { apiHeaders } from "../lib/api";
import { Modal, BtnPrimary, BtnGhost } from "./modal";

export type ImportType = "customer" | "admin" | "rider";

const TYPE_LABEL: Record<ImportType, string> = {
  customer: "Customers",
  admin: "Dispatchers",
  rider: "Technicians",
};

function filenameFrom(res: Response): string {
  const cd = res.headers.get("content-disposition") || "";
  return /filename="?([^"]+)"?/.exec(cd)?.[1] || "";
}

type ImportResult = {
  total: number;
  created: number;
  invited: number;
  failedCount: number;
  failed: { row: number; email: string; reason: string }[];
};

/**
 * "Import" control for a roster page. Handles CSV/Excel upload + a
 * download-a-template action for one or more entity types (customer,
 * dispatcher, technician). When more than one `types` entry is given and the
 * caller doesn't pass a fixed `activeType`, the person is asked which type
 * they're importing before the CSV/Excel/template menu opens — templates and
 * validation differ per type, so it has to be picked once, up front.
 */
export function ImportMenu({
  types,
  activeType,
  customerLabel,
  workerLabel,
  onDone,
}: {
  /** Entity types this page's Import button can produce. */
  types: ImportType[];
  /** Skip the "what are you importing" step and always use this type. */
  activeType?: ImportType;
  /** Overrides the "Customers" label (e.g. tenant's own customer noun). */
  customerLabel?: string;
  /** Overrides the "Technicians" label (e.g. tenant's own worker noun). */
  workerLabel?: string;
  onDone?: () => void;
}) {
  const label = (t: ImportType) =>
    t === "customer" ? customerLabel || TYPE_LABEL.customer : t === "rider" ? workerLabel || TYPE_LABEL.rider : TYPE_LABEL.admin;

  const [menuOpen, setMenuOpen] = useState(false);
  const [pickType, setPickType] = useState(false);
  const [type, setType] = useState<ImportType | null>(activeType ?? (types.length === 1 ? types[0] : null));
  const [busy, setBusy] = useState<"csv" | "xlsx" | "template" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<"csv" | "xlsx">("csv");

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function openMenu() {
    if (activeType) { setType(activeType); setMenuOpen(true); return; }
    if (types.length === 1) { setType(types[0]); setMenuOpen(true); return; }
    setPickType(true);
  }

  function choose(t: ImportType) {
    setType(t);
    setPickType(false);
    setMenuOpen(true);
  }

  function startUpload(kind: "csv" | "xlsx") {
    setMenuOpen(false);
    pendingKind.current = kind;
    if (fileRef.current) {
      fileRef.current.accept = kind === "xlsx" ? ".xlsx,.xls" : ".csv";
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !type) return;
    setBusy(pendingKind.current);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/import/${type}`, { method: "POST", headers: apiHeaders(), body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Import failed");
      setResult(data as ImportResult);
      onDone?.();
    } catch (err: any) {
      setError(err.message || "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function downloadTemplate(format: "csv" | "xlsx") {
    if (!type) return;
    setMenuOpen(false);
    setBusy("template");
    try {
      const res = await fetch(`/api/import/template/${type}?format=${format}`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res) || `${type}-import-template.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Could not download template");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          onClick={openMenu}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-2 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
        >
          <Upload className="h-4 w-4" /> Import <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {menuOpen && type && (
          <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-2 shadow-2xl">
            <div className="border-b border-white/5 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Importing {label(type)}
            </div>
            <MenuItem icon={FileText} label="Import CSV" onClick={() => startUpload("csv")} />
            <MenuItem icon={FileSpreadsheet} label="Import Excel" onClick={() => startUpload("xlsx")} />
            <MenuItem icon={Download} label="Download template" onClick={() => downloadTemplate("csv")} />
          </div>
        )}
        <input ref={fileRef} type="file" className="hidden" onChange={onFileSelected} />
      </div>

      {/* which entity type — only shown when the tab is "All" (or the page offers more than one type) */}
      <Modal open={pickType} onClose={() => setPickType(false)} title="What are you importing?" subtitle="Templates and required fields differ by type." size="sm">
        <div className="flex flex-col gap-2">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => choose(t)}
              className="rounded-xl border border-white/10 bg-ink-3/60 px-4 py-3 text-left text-sm font-semibold text-slate-100 hover:border-brand hover:bg-white/5"
            >
              {label(t)}
            </button>
          ))}
        </div>
      </Modal>

      {/* busy state while an upload/download is in flight, and errors */}
      {busy && createPortal(
        <div className="fixed inset-0 z-[1100] grid place-items-center bg-black/50">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-2 px-5 py-4 text-sm font-semibold text-white shadow-2xl">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            {busy === "template" ? "Preparing template…" : "Importing…"}
          </div>
        </div>,
        document.body,
      )}

      {error && (
        <Modal open onClose={() => setError("")} title="Import problem" size="sm">
          <p className="text-sm text-slate-300">{error}</p>
          <div className="mt-4 flex justify-end"><BtnGhost onClick={() => setError("")}>Close</BtnGhost></div>
        </Modal>
      )}

      {/* results summary */}
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title="Import complete"
        subtitle={type ? `${label(type)} · ${result?.total ?? 0} rows` : undefined}
        footer={<BtnPrimary onClick={() => setResult(null)}>Done</BtnPrimary>}
      >
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <StatCard icon={CheckCircle2} tint="text-emerald-live" label="Created" value={result.created} />
              <StatCard icon={CheckCircle2} tint="text-cyan-glow" label="Invited" value={result.invited} />
              <StatCard icon={XCircle} tint="text-red-400" label="Failed" value={result.failedCount} />
            </div>
            {result.failed.length > 0 && (
              <div className="max-h-52 overflow-y-auto rounded-xl border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-slate-500">
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">Email</th>
                      <th className="px-3 py-2 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {result.failed.map((f, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-slate-400">{f.row}</td>
                        <td className="px-3 py-2 text-slate-300">{f.email || "—"}</td>
                        <td className="px-3 py-2 text-red-400">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Newly created accounts have no password yet — invite each person from their profile (Reset password / Resend invite) when you're ready to give them access.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

function MenuItem({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-slate-200 hover:bg-white/5"
    >
      <Icon className="h-4 w-4 text-slate-400" /> {label}
    </button>
  );
}

function StatCard({ icon: Icon, tint, label, value }: { icon: any; tint: string; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-3/60 px-3 py-3 text-center">
      <Icon className={`mx-auto h-4 w-4 ${tint}`} />
      <div className="mt-1 text-lg font-bold text-white">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
