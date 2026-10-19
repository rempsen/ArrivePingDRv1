import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Upload, ChevronDown, FileText, FileSpreadsheet, Download,
  CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, apiHeaders } from "../lib/api";
import { ok } from "../lib/api-ok";
import type { ImportProfile } from "../../shared/import-profile";
import { Modal, BtnPrimary, BtnGhost } from "./modal";

export type ImportType = "customer" | "admin" | "rider" | "property";

const TYPE_LABEL: Record<ImportType, string> = {
  customer: "Customers",
  admin: "Dispatchers",
  rider: "Technicians",
  property: "Properties",
};

function filenameFrom(res: Response): string {
  const cd = res.headers.get("content-disposition") || "";
  return /filename="?([^"]+)"?/.exec(cd)?.[1] || "";
}

type ImportResult = {
  total: number;
  created: number;
  /** Already here: a customer moved to the row's property and unit, or a property updated. */
  updated?: number;
  /** Imported, but with something to look at (a manager nobody matched, say). */
  warnings?: { row: number; email: string; message: string }[];
  invited: number;
  /** Of `invited`, how many invitation emails didn't go out (they need a resend). */
  invitesNotEmailed?: number;
  /** New technicians / office staff being emailed a set-password link (services/welcome.ts). */
  welcoming?: number;
  /** What was imported (kept with the result so its note can't drift). */
  type?: ImportType;
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
  // This tenant's imports, named and shaped its way (shared/import-profile.ts):
  // a property manager imports Residents with Property and Unit columns; an
  // HVAC company imports Customers with Company and Address, and has no
  // places import at all.
  const profileQ = useQuery({
    queryKey: ["import-profile"],
    staleTime: 60_000,
    queryFn: async () => (await ok(await api.import.profile.$get())).profile as ImportProfile,
  });
  const profile = profileQ.data;
  const offered = types.filter((t) => (profile ? profile.types.includes(t) : t !== "property"));
  const label = (t: ImportType) =>
    profile?.label[t] ??
    (t === "customer" ? customerLabel || TYPE_LABEL.customer : t === "rider" ? workerLabel || TYPE_LABEL.rider : TYPE_LABEL[t]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [pickType, setPickType] = useState(false);
  const [type, setType] = useState<ImportType | null>(activeType ?? (offered.length === 1 ? offered[0]! : null));
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
    if (activeType && offered.includes(activeType)) { setType(activeType); setMenuOpen(true); return; }
    if (offered.length === 1) { setType(offered[0]!); setMenuOpen(true); return; }
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
      setResult({ ...(data as ImportResult), type });
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
            <div className="border-b border-white/5 px-3.5 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Importing {label(type)}</p>
              {profile && (
                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                  Template columns: {profile.columns[type].map((c) => c.label).join(", ")}
                </p>
              )}
            </div>
            <MenuItem icon={FileText} label="Import CSV" onClick={() => startUpload("csv")} />
            <MenuItem icon={FileSpreadsheet} label="Import Excel" onClick={() => startUpload("xlsx")} />
            <MenuItem icon={Download} label="Download CSV template" onClick={() => downloadTemplate("csv")} />
            <MenuItem icon={Download} label="Download Excel template" onClick={() => downloadTemplate("xlsx")} />
          </div>
        )}
        <input ref={fileRef} type="file" className="hidden" aria-label="Choose a file to import" onChange={onFileSelected} />
      </div>

      {/* which entity type — only shown when the tab is "All" (or the page offers more than one type) */}
      <Modal open={pickType} onClose={() => setPickType(false)} title="What are you importing?" subtitle="Templates and required fields differ by type." size="sm">
        <div className="flex flex-col gap-2">
          {offered.map((t) => (
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
            {(() => {
              const isProperty = result.type === "property";
              const showUpdated = isProperty || (result.updated ?? 0) > 0;
              const cards = [
                <StatCard key="c" icon={CheckCircle2} tint="text-emerald-live" label="Created" value={result.created} />,
                showUpdated && <StatCard key="u" icon={RefreshCw} tint="text-brand" label="Updated" value={result.updated ?? 0} />,
                !isProperty && <StatCard key="i" icon={CheckCircle2} tint="text-cyan-glow" label="Invited" value={result.invited} />,
                <StatCard key="f" icon={XCircle} tint="text-red-400" label="Failed" value={result.failedCount} />,
              ].filter(Boolean);
              return <div className={`grid gap-2 ${cards.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>{cards}</div>;
            })()}
            {result.failed.length > 0 && (
              <div className="max-h-52 overflow-y-auto rounded-xl border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-slate-500">
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">{result.type === "property" ? "Property" : "Email"}</th>
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
            {(result.warnings?.length ?? 0) > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-amber-400/20">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-slate-500">
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">{result.type === "property" ? "Property" : "Email"}</th>
                      <th className="px-3 py-2 font-semibold">Imported, but check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {result.warnings!.map((w, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-slate-400">{w.row}</td>
                        <td className="px-3 py-2 text-slate-300">{w.email || "—"}</td>
                        <td className="px-3 py-2 text-amber-300">
                          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
                          {w.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">
              {importNote(result, profile)}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

/** What happened by email after an import (services/welcome.ts, lib/join-invite.ts). */
function importNote(r: ImportResult, profile?: ImportProfile): string {
  const parts: string[] = [];
  // The tenant's words for its places and the people in them.
  const place = profile?.columns.customer.find((c) => c.key === "property")?.label ?? "Property";
  const unit = profile?.columns.customer.find((c) => c.key === "unit")?.label;
  const places = profile?.label.property ?? "Properties";
  const people = profile?.label.customer ?? "Customers";
  const workers = profile?.label.rider ?? "Technicians";
  const aPlace = `${/^[aeiou]/i.test(place) ? "an" : "a"} ${place.toLowerCase()}`;
  if (r.type === "property") {
    return r.created || r.updated
      ? `${places} don't sign in and nobody was emailed. ${people} join ${aPlace} from their own import (its ${place}${unit ? ` and ${unit}` : ""} column${unit ? "s" : ""}) or with “Assign to ${place.toLowerCase()}” in the Directory.`
      : "Nothing was added or changed.";
  }
  if (r.type === "customer" && r.updated) {
    parts.push(
      `${r.updated === 1 ? "One person was" : `${r.updated} people were`} already here, so only their ${place.toLowerCase()}${unit ? ` and ${unit.toLowerCase()}` : ""} ${unit ? "were" : "was"} updated.`,
    );
  }
  if (r.type === "customer") {
    if (r.created) parts.push(`New ${people.toLowerCase()} aren't emailed: they first hear from you when work is booked.`);
  } else if (r.welcoming) {
    parts.push(
      `We're emailing ${r.welcoming === 1 ? "the new person" : `the ${r.welcoming} new people`} a link to set a password, one after another over the next few minutes. Rows imported without an email address can't sign in until you add one on their profile.`,
    );
  } else if (r.created) {
    parts.push("Nobody new was emailed: the new rows had no email address, so they can't sign in yet. Add an email on each profile, then use “Email a sign-in link”.");
  }
  if (r.invited) {
    const missed = Math.min(r.invitesNotEmailed ?? 0, r.invited);
    const sent = r.invited - missed;
    parts.push(
      `${r.invited === 1 ? "One person" : `${r.invited} people`} already had an ArrivePing login, so they were added as invited instead of getting a new account.`,
    );
    if (sent) parts.push(missed ? `${sent} of those invitations were emailed.` : sent === 1 ? "Their invitation was emailed." : "Their invitations were emailed.");
    if (missed)
      parts.push(
        `${missed === 1 ? "One invitation" : `${missed} invitations`} couldn't be emailed${
          r.type === "customer" ? "." : `, so use “Resend invite” next to their name on the ${workers} page.`
        }`,
      );
  }
  return parts.join(" ") || "Nobody new was added, so nobody was emailed.";
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
