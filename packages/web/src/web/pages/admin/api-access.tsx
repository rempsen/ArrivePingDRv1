import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiHeaders } from "../../lib/api";
import { FullLoader } from "../../components/loader";
import { PageWrap } from "../../components/brand";
import { PageHead } from "./shell";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost, ConfirmModal } from "../../components/modal";
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Ban,
  Terminal,
  Plug,
  ShieldCheck,
  FileText,
} from "lucide-react";

type Scope = { id: string; label: string; group: string };
type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  keyType: "secret" | "public";
  allowedOrigins: string[];
  scopes: string[];
  createdByName: string;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  active: boolean;
  publicKey?: string;
};

const authHeaders = () => ({ ...apiHeaders(), "Content-Type": "application/json" });

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function fmtDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {label ?? (done ? "Copied" : "Copy")}
    </button>
  );
}

export default function AdminApiAccess() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [keyType, setKeyType] = useState<"secret" | "public">("secret");
  const [allowedOrigins, setAllowedOrigins] = useState("");
  const [label, setLabel] = useState("");
  const [selScopes, setSelScopes] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [newSecret, setNewSecret] = useState<{ secret: string; label: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [delTarget, setDelTarget] = useState<ApiKey | null>(null);

  const keysQ = useQuery({ queryKey: ["api-keys"], queryFn: () => jget<{ keys: ApiKey[] }>("/api/api-keys") });
  const scopesQ = useQuery({ queryKey: ["api-scopes"], queryFn: () => jget<{ scopes: Scope[] }>("/api/api-keys/scopes") });
  const mcpQ = useQuery({ queryKey: ["mcp-info"], queryFn: () => jget<{ mcpUrl: string; baseUrl: string }>("/api/api-keys/mcp-info") });

  const createM = useMutation({
    mutationFn: () =>
      jpost<{ key: ApiKey; secret: string }>("/api/api-keys", {
        label,
        keyType,
        scopes: keyType === "secret" ? selScopes : undefined,
        allowedOrigins: keyType === "public" ? allowedOrigins : undefined,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      }),
    onSuccess: (d) => {
      setNewSecret({ secret: d.secret, label: d.key.label });
      setCreating(false);
      setLabel("");
      setSelScopes([]);
      setExpiresInDays("");
      setAllowedOrigins("");
      setKeyType("secret");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeM = useMutation({
    mutationFn: (id: string) => jpost(`/api/api-keys/${id}/revoke`),
    onSuccess: () => {
      setRevokeTarget(null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const delM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/api-keys/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      setDelTarget(null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const grouped = useMemo(() => {
    const g: Record<string, Scope[]> = {};
    for (const s of scopesQ.data?.scopes ?? []) (g[s.group] ??= []).push(s);
    return g;
  }, [scopesQ.data]);

  const mcpUrl = mcpQ.data?.mcpUrl ?? "";
  const claudeSnippet = useMemo(() => {
    return JSON.stringify(
      {
        mcpServers: {
          arriveping: {
            type: "http",
            url: mcpUrl,
            headers: { Authorization: "Bearer nvc_YOUR_KEY_HERE" },
          },
        },
      },
      null,
      2,
    );
  }, [mcpUrl]);
  const claudeCli = `claude mcp add --transport http arriveping ${mcpUrl} --header "Authorization: Bearer nvc_YOUR_KEY_HERE"`;

  if (keysQ.isLoading || scopesQ.isLoading) return <FullLoader />;
  const keys = keysQ.data?.keys ?? [];

  return (
    <PageWrap>
      <PageHead
        title="API & MCP"
        subtitle="Issue API keys and connect external agents (Claude Code, MCP clients) to ArrivePing."
        actions={
          <BtnPrimary onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New API key
          </BtnPrimary>
        }
      />

      {/* MCP connection card */}
      <div className="mb-6 rounded-2xl border border-white/10 bg-ink-2 p-5">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-cyan-glow" />
          <h2 className="font-display text-lg font-bold text-white">Connect via MCP</h2>
          <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Remote · streamable HTTP</span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Point any MCP client at this URL and authenticate with one of your API keys. Tools are gated by each key's scopes.
        </p>

        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">MCP server URL</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-cyan-glow">{mcpUrl || "…"}</code>
            <CopyBtn text={mcpUrl} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Terminal className="h-3.5 w-3.5" /> Claude Code (CLI)
            </div>
            <div className="relative rounded-lg border border-white/10 bg-ink-3/60 p-3">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[12px] leading-relaxed text-slate-300">{claudeCli}</pre>
              <div className="mt-2"><CopyBtn text={claudeCli} label="Copy command" /></div>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Terminal className="h-3.5 w-3.5" /> Claude Desktop / config JSON
            </div>
            <div className="relative rounded-lg border border-white/10 bg-ink-3/60 p-3">
              <pre className="overflow-x-auto text-[12px] leading-relaxed text-slate-300">{claudeSnippet}</pre>
              <div className="mt-2"><CopyBtn text={claudeSnippet} label="Copy JSON" /></div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Replace <code className="text-slate-400">nvc_YOUR_KEY_HERE</code> with a key generated below.</p>
      </div>

      {/* Keys table */}
      <div className="rounded-2xl border border-white/10 bg-ink-2">
        <div className="flex items-center gap-2 border-b border-white/5 px-5 py-4">
          <KeyRound className="h-5 w-5 text-cyan-glow" />
          <h2 className="font-display text-lg font-bold text-white">API keys</h2>
          <span className="ml-auto text-xs text-slate-500">{keys.length} total</span>
        </div>
        {keys.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">No API keys yet. Create one to let agents connect.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{k.label}</span>
                    {k.keyType === "public" ? (
                      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-300">Publishable</span>
                    ) : (
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300">Secret</span>
                    )}
                    {k.active ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Active</span>
                    ) : (
                      <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300">{k.revokedAt ? "Revoked" : "Expired"}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <code className="text-slate-400">{k.prefix}••••</code>
                    {k.keyType === "public"
                      ? <span>{k.allowedOrigins.length ? `${k.allowedOrigins.length} allowed origin${k.allowedOrigins.length === 1 ? "" : "s"}` : "any origin"}</span>
                      : <span>{k.scopes.includes("*") ? "all scopes" : `${k.scopes.length} scope${k.scopes.length === 1 ? "" : "s"}`}</span>}
                    <span>last used {fmtDate(k.lastUsedAt)}</span>
                    <span>created {fmtDate(k.createdAt)}{k.createdByName ? ` by ${k.createdByName}` : ""}</span>
                    {k.expiresAt && <span>expires {fmtDate(k.expiresAt)}</span>}
                  </div>
                  {k.keyType === "secret" && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(k.scopes.includes("*") ? ["*"] : k.scopes).slice(0, 12).map((s) => (
                        <span key={s} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{s}</span>
                      ))}
                    </div>
                  )}
                  {k.keyType === "public" && k.allowedOrigins.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {k.allowedOrigins.slice(0, 8).map((o) => (
                        <span key={o} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{o}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {k.active && (
                    <button onClick={() => setRevokeTarget(k)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-white/5">
                      <Ban className="h-3.5 w-3.5" /> Revoke
                    </button>
                  )}
                  <button onClick={() => setDelTarget(k)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-white/5">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Intake forms moved to their own area */}
      <a href="/admin/intake-forms" className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-2 px-5 py-4 hover:border-cyan-500/40 hover:bg-white/5">
        <FileText className="h-5 w-5 text-cyan-glow" />
        <div className="flex-1">
          <div className="font-semibold text-white">Customer intake forms</div>
          <div className="text-xs text-slate-400">Build forms with custom sections, fields & a recipient — now in its own “Intake Forms” area.</div>
        </div>
        <span className="text-sm font-semibold text-cyan-glow">Open →</span>
      </a>

      {/* Create modal */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create API key"
        subtitle="Issue a server-side secret key or a browser-safe publishable key for intake forms."
        size="lg"
        footer={
          <>
            <BtnGhost onClick={() => setCreating(false)}>Cancel</BtnGhost>
            <BtnPrimary
              disabled={!label.trim() || (keyType === "secret" && selScopes.length === 0) || createM.isPending}
              onClick={() => createM.mutate()}
            >
              {createM.isPending ? "Generating…" : "Generate key"}
            </BtnPrimary>
          </>
        }
      >
        <div className="space-y-4">
          {/* key type selector */}
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Key type</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                { t: "secret", title: "Secret key", desc: "Server-side full REST API. Scoped. Starts with nvc_", icon: KeyRound },
                { t: "public", title: "Publishable key", desc: "Browser-safe, for hosted intake forms only. Starts with nvcpub_", icon: ShieldCheck },
              ] as const).map((o) => {
                const on = keyType === o.t;
                return (
                  <button
                    key={o.t}
                    type="button"
                    aria-label={o.title}
                    onClick={() => setKeyType(o.t)}
                    className={`flex items-start gap-2 rounded-lg border p-3 text-left transition ${on ? "border-cyan-500/50 bg-cyan-500/10" : "border-white/10 bg-ink-3/40 hover:border-white/20"}`}
                  >
                    <o.icon className={`mt-0.5 h-4 w-4 ${on ? "text-cyan-glow" : "text-slate-500"}`} />
                    <span>
                      <span className="block text-sm font-semibold text-white">{o.title}</span>
                      <span className="block text-[11px] text-slate-500">{o.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Field label="Label" hint="Human-friendly name e.g. 'Claude Code – ops bot' or 'Website intake form'">
            <input aria-label={keyType === "public" ? "Website intake form" : "My agent"} className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={keyType === "public" ? "Website intake form" : "My agent"} />
          </Field>
          <Field label="Expiry (optional)" hint="Days until the key auto-expires. Leave blank for no expiry.">
            <input aria-label="e.g. 90" className={inputCls} type="number" min="1" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} placeholder="e.g. 90" />
          </Field>

          {keyType === "public" && (
            <Field label="Allowed website origins (optional)" hint="Comma-separated, e.g. https://acmehvac.com. Leave blank to allow any site. Restricts where the form can be embedded.">
              <input aria-label="https://acmehvac.com, https://www.acmehvac.com" className={inputCls} value={allowedOrigins} onChange={(e) => setAllowedOrigins(e.target.value)} placeholder="https://acmehvac.com, https://www.acmehvac.com" />
            </Field>
          )}

          <div className={keyType === "public" ? "hidden" : ""}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scopes</span>
              <div className="flex gap-2">
                <button
                  className="text-xs font-semibold text-cyan-glow hover:underline"
                  onClick={() => setSelScopes((scopesQ.data?.scopes ?? []).map((s) => s.id))}
                >
                  Select all
                </button>
                <button className="text-xs font-semibold text-slate-400 hover:underline" onClick={() => setSelScopes([])}>
                  Clear
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(grouped).map(([group, scopes]) => (
                <div key={group} className="rounded-lg border border-white/10 bg-ink-3/40 p-3">
                  <div className="mb-2 text-xs font-bold text-slate-300">{group}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {scopes.map((s) => {
                      const on = selScopes.includes(s.id);
                      return (
                        <label key={s.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                          <input aria-label="On"
                            type="checkbox"
                            checked={on}
                            onChange={() => setSelScopes((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-ink-3 accent-cyan-500"
                          />
                          <span>
                            {s.label}
                            <span className="ml-1 text-[11px] text-slate-600">{s.id}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {createM.isError && <p className="text-sm text-rose-400">{String((createM.error as Error)?.message)}</p>}
        </div>
      </Modal>

      {/* Secret reveal modal */}
      <Modal
        open={!!newSecret}
        onClose={() => setNewSecret(null)}
        title="API key created"
        subtitle="Copy it now — for security it will never be shown again."
        footer={<BtnPrimary onClick={() => setNewSecret(null)}>Done</BtnPrimary>}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            <ShieldCheck className="h-4 w-4 shrink-0" /> Key for “{newSecret?.label}”
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-3/60 p-3">
            <code className="block break-all text-sm text-cyan-glow">{newSecret?.secret}</code>
          </div>
          {newSecret && <CopyBtn text={newSecret.secret} label="Copy key" />}
          {newSecret?.secret?.startsWith("nvcpub_") ? (
            <p className="text-xs text-slate-500">Publishable key — bind it to an intake form below, then paste it into the form's share link (<code className="text-slate-400">?k={newSecret?.secret?.slice(0, 15)}…</code>) or embed code. Safe to expose in the browser.</p>
          ) : (
            <p className="text-xs text-slate-500">Use as <code className="text-slate-400">Authorization: Bearer {newSecret?.secret?.slice(0, 12)}…</code> in API requests or your MCP client config.</p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && revokeM.mutate(revokeTarget.id)}
        title="Revoke API key?"
        message={`"${revokeTarget?.label}" will immediately stop working for all agents. This cannot be undone.`}
        confirmLabel="Revoke"
        pending={revokeM.isPending}
      />
      <ConfirmModal
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        onConfirm={() => delTarget && delM.mutate(delTarget.id)}
        title="Delete API key?"
        message={`"${delTarget?.label}" will be permanently removed.`}
        confirmLabel="Delete"
        pending={delM.isPending}
      />
    </PageWrap>
  );
}
