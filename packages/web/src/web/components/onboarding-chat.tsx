import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiHeaders } from "../lib/api";
import { useAuth } from "../hooks/use-auth";
import {
  Sparkles,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  Bot,
  X,
  ListChecks,
  Camera,
} from "lucide-react";

/**
 * The finishing-touches onboarding conversation — the "agentic" step Dan
 * asked for. Every freshly-provisioned tenant (self-serve OR built by hand in
 * the superadmin panel — same gate either way) lands here on first login and
 * talks to an AI that already knows what the site scrape found and asks,
 * one thing at a time, about whatever it couldn't. This is deliberately NOT
 * a form: no fields, no "next" button — just a conversation that ends with
 * `finish_onboarding` and a fully-set-up tenant.
 *
 * Self-contained: mounted once in AdminShell (so it's present on every admin
 * screen) and renders nothing until GET /api/onboarding/status says this
 * tenant's onboarding is still open (`companies.onboardingCompletedAt` null).
 */

type Snapshot = {
  company: { name: string; industry: string | null };
  settings: { workerNoun: string; customerNoun: string; jobNoun: string; tagline: string | null; serviceArea: string | null };
  counts: { forms: number; templates: number; services: number; catalogItems: number; optionCategories: number };
  checklist: {
    hasIndustry: boolean;
    hasLogo: boolean;
    hasTagline: boolean;
    hasServiceArea: boolean;
    hasCatalog: boolean;
    hasForms: boolean;
    hasTemplates: boolean;
    hasRoster?: boolean;
    done: boolean;
  };
};

type ChatMsg = { role: "user" | "assistant"; content: string };
type ToolEvent = { name: string; input: any; output: any };
/** One rendered line in the transcript — either a chat bubble or a small
 * "✓ did a thing" pill dropped in between bubbles. */
type Line = { kind: "msg"; msg: ChatMsg } | { kind: "tool"; tool: ToolEvent; key: number };

/** One row in the live fact panel — everything the AI has extracted from the
 * conversation so far, not just the quantifiable business numbers. Rows with
 * a stable `id` (brand/baseline fields) upsert in place if corrected later;
 * rows with a generated id (catalog items, ICP-specific Q&A) always append,
 * since each one is its own distinct fact. */
type Fact = { id: string; label: string; value: string; swatch?: string };

const FIELD_LABELS: Record<string, string> = {
  tagline: "Tagline",
  workerNoun: "Worker term",
  workerNounPlural: "Worker term (plural)",
  customerNoun: "Customer term",
  customerNounPlural: "Customer term (plural)",
  jobNoun: "Job term",
  jobNounPlural: "Job term (plural)",
  primaryColor: "Primary color",
  accentColor: "Accent color",
  hours: "Hours",
  serviceArea: "Service area",
  technicianCount: "Team size",
  vehicleCount: "Fleet size",
  jobsPerDay: "Jobs per day",
  offersMaintenancePlans: "Maintenance plans",
  offersEmergencyPremium: "Rush pricing",
  emergencyMultiplierPct: "Rush multiplier",
};

function formatFieldValue(key: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  if (key === "emergencyMultiplierPct" && typeof val === "number") {
    const x = val / 100;
    return `${x % 1 === 0 ? x.toFixed(0) : x.toFixed(1)}x`;
  }
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

let factIdSeq = 0;
function nextFactId(prefix: string): string {
  factIdSeq += 1;
  return `${prefix}-${factIdSeq}`;
}

/** Turns one resolved tool call into zero or more fact-panel rows. This is
 * the ONLY place the fact panel's content comes from — every tool already
 * streamed over SSE for the checklist/pill UI feeds it, no backend change
 * needed. */
function factsFromTool(t: ToolEvent): Fact[] {
  switch (t.name) {
    case "update_brand_profile": {
      const updated: string[] = Array.isArray(t.output?.updated) ? t.output.updated : [];
      return updated
        .filter((k) => t.input?.[k] !== undefined && t.input?.[k] !== "")
        .map((k) => ({
          id: k,
          label: FIELD_LABELS[k] ?? k,
          value: formatFieldValue(k, t.input[k]),
          swatch: k === "primaryColor" || k === "accentColor" ? String(t.input[k]) : undefined,
        }));
    }
    case "set_industry":
      return t.output?.ok
        ? [{ id: "industry", label: "Industry", value: String(t.output.industry ?? t.input?.industryId ?? "") }]
        : [];
    case "add_catalog_item":
      return [
        {
          id: nextFactId("catalog"),
          label: "Catalog item added",
          value: String(t.output?.name ?? t.input?.name ?? ""),
        },
      ];
    case "save_qualifying_baseline": {
      const saved: string[] = Array.isArray(t.output?.saved) ? t.output.saved : [];
      return saved
        .filter((k) => t.input?.[k] !== undefined)
        .map((k) => ({ id: k, label: FIELD_LABELS[k] ?? k, value: formatFieldValue(k, t.input[k]) }));
    }
    case "save_icp_qualifying_answer":
      return [
        {
          id: nextFactId("icp"),
          label: String(t.input?.question ?? "Detail").slice(0, 70),
          value: String(t.input?.answer ?? "").slice(0, 200),
        },
      ];
    case "add_team_members": {
      const invited: Array<{ name: string; kind: string }> = Array.isArray(t.output?.invited) ? t.output.invited : [];
      const kindLabel: Record<string, string> = { tech: "technician", driver: "driver", dispatcher: "dispatcher", manager: "manager", owner: "owner" };
      return invited.map((m) => ({
        id: nextFactId("team"),
        label: "Team member invited",
        value: `${m.name} — ${kindLabel[m.kind] ?? m.kind}`,
      }));
    }
    default:
      return [];
  }
}

function toolLabel(t: ToolEvent): string {
  switch (t.name) {
    case "update_brand_profile": {
      const fields = Array.isArray(t.output?.updated) ? t.output.updated : [];
      return fields.length ? `Updated ${fields.join(", ")}` : "Updated brand profile";
    }
    case "set_industry":
      return t.output?.ok ? `Set industry to ${t.output.industry}${t.output.catalogSeeded ? ` — seeded ${t.output.catalogSeeded} catalog items` : ""}` : "Updated industry";
    case "add_catalog_item":
      return `Added "${t.output?.name ?? t.input?.name}" to your catalog`;
    case "save_qualifying_baseline": {
      const saved: string[] = Array.isArray(t.output?.saved) ? t.output.saved : [];
      const pretty: Record<string, string> = {
        technicianCount: "team size",
        vehicleCount: "fleet size",
        jobsPerDay: "daily volume",
        offersMaintenancePlans: "maintenance plans",
        offersEmergencyPremium: "rush pricing",
        emergencyMultiplierPct: "rush multiplier",
      };
      const names = saved.map((s) => pretty[s] ?? s);
      return names.length ? `Saved ${names.join(", ")}` : "Saved business profile";
    }
    case "save_icp_qualifying_answer":
      return "Noted — will use this to tune your setup";
    case "add_team_members": {
      const n = Array.isArray(t.output?.invited) ? t.output.invited.length : 0;
      const failed = Array.isArray(t.output?.failed) ? t.output.failed.length : 0;
      const bits = [n ? `Invited ${n} team member${n === 1 ? "" : "s"} — each sets their own password` : "No one new to invite"];
      if (failed) bits.push(`${failed} couldn't be added`);
      return bits.join("; ");
    }
    case "finish_onboarding": {
      const tuning = t.output?.tuning;
      const bits: string[] = [];
      if (tuning?.emergencyTemplatesTuned) bits.push(`${tuning.emergencyTemplatesTuned} rush rate${tuning.emergencyTemplatesTuned === 1 ? "" : "s"} adjusted`);
      if (tuning?.emergencyTemplateCreated) bits.push("rush template added");
      if (tuning?.maintenanceTemplateCreated) bits.push("maintenance-plan template added");
      if (tuning?.capacityApplied) bits.push("capacity defaults set");
      const icp = t.output?.icpTuning;
      if (icp?.applied && Array.isArray(icp.actions) && icp.actions.length) bits.push(`${icp.actions.length} setup tweak${icp.actions.length === 1 ? "" : "s"} from your answers`);
      return bits.length ? `Wrapped up onboarding — ${bits.join(", ")}` : "Wrapped up onboarding";
    }
    default:
      return t.name.replace(/_/g, " ");
  }
}

/** Bold-only inline formatting: splits on **text** and wraps the middle in
 * <strong>. The system prompt tells the model not to use markdown at all,
 * but this is a cheap safety net so an occasional "**word**" slip renders as
 * emphasis instead of literal asterisks on screen. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-white">
        {part}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

/** Renders an assistant message's plain text as paragraphs, turning any
 * "- " / "* " line runs into a real bulleted list rather than showing the
 * dash literally — same safety-net reasoning as renderInline above. */
function AssistantText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n").filter((l) => l.length > 0);
        const isList = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={pi} className={pi > 0 ? "mt-2 list-disc space-y-1 pl-4" : "list-disc space-y-1 pl-4"}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^[-*]\s+/, ""), `${pi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={pi} className={pi > 0 ? "mt-2" : undefined}>
            {lines.flatMap((l, li) => (li > 0 ? [<br key={`br-${li}`} />, ...renderInline(l, `${pi}-${li}`)] : renderInline(l, `${pi}-${li}`)))}
          </p>
        );
      })}
    </>
  );
}

/** Incremental SSE line parser for a hand-rolled protocol (event:/data: blocks
 * separated by a blank line) — the endpoint streams via hono's `streamSSE`,
 * not the ai-sdk data-stream protocol, since no ai-sdk React client is
 * installed here. */
async function streamChat(
  history: ChatMsg[],
  onDelta: (text: string) => void,
  onTool: (t: ToolEvent) => void,
  onDone: () => void,
  onComplete: () => void,
  onError: (msg: string) => void,
) {
  const res = await fetch("/api/onboarding/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiHeaders() },
    body: JSON.stringify({ messages: history }),
  });
  if (!res.ok || !res.body) {
    let msg = `Chat failed (${res.status})`;
    try {
      const d = await res.json();
      if (d?.message) msg = d.message;
    } catch {}
    onError(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      const data = dataLines.join("\n");
      if (event === "delta") onDelta(data);
      else if (event === "tool") {
        try {
          onTool(JSON.parse(data));
        } catch {}
      } else if (event === "error") onError(data || "Something went wrong");
      else if (event === "complete") onComplete();
      else if (event === "done") onDone();
    }
  }
}

export function OnboardingChat() {
  const { isAuthed, role } = useAuth();
  const qc = useQueryClient();
  const enabled = isAuthed && (role === "admin" || role === "superadmin");

  const statusQ = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: async () => {
      const res = await (api as any).onboarding.status.$get();
      if (!res.ok) throw new Error("status failed");
      return (await res.json()) as Snapshot;
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  const [dismissed, setDismissed] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState("");
  const historyRef = useRef<ChatMsg[]>([]); // full role/content log sent to the API
  const kickedOffRef = useRef(false);
  const toolKeyRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const factsBottomRef = useRef<HTMLDivElement>(null);
  const [checklist, setChecklist] = useState<Snapshot["checklist"] | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  // "Question N of M" — M starts at a floor of 5 (the 5 mandatory qualifying
  // fields) and extends live, 3 steps ahead of wherever we currently are,
  // the moment the conversation runs longer than first guessed. It only
  // ever grows, never shrinks, so the number on screen never looks like it
  // "reset" mid-conversation.
  const [qProgress, setQProgress] = useState<{ current: number; total: number }>({ current: 0, total: 5 });

  useEffect(() => {
    if (statusQ.data) setChecklist(statusQ.data.checklist);
  }, [statusQ.data]);

  useEffect(() => {
    factsBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [facts]);

  const shouldShow = enabled && !dismissed && !!statusQ.data && !statusQ.data.checklist.done;

  // Kick the conversation off automatically the moment the wizard opens — the
  // tenant should never have to type "hi" to get the AI talking first.
  useEffect(() => {
    if (!shouldShow || kickedOffRef.current) return;
    kickedOffRef.current = true;
    runTurn([
      {
        role: "user",
        content:
          "(I just finished signing up. Greet me and open our setup conversation based on what you already know.)",
      },
    ], /* showUserBubble */ false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, streaming]);

  async function runTurn(newHistory: ChatMsg[], showUserBubble = true) {
    setErr("");
    historyRef.current = newHistory;
    const lastMsg = newHistory[newHistory.length - 1];
    if (showUserBubble && lastMsg) {
      setLines((l) => [...l, { kind: "msg", msg: lastMsg }]);
    }
    setStreaming(true);
    // Every assistant turn is one more question/step (the system prompt
    // keeps it to one thought per reply) — advance the live "N of M"
    // counter the instant this turn starts, not after it finishes, so the
    // number on screen matches what the user is reading right now.
    setQProgress((p) => {
      const current = p.current + 1;
      const total = Math.max(current + 3, 5, p.total);
      return { current, total };
    });
    let assistantText = "";
    setLines((l) => [...l, { kind: "msg", msg: { role: "assistant", content: "" } }]);

    await streamChat(
      newHistory,
      (chunk) => {
        assistantText += chunk;
        setLines((l) => {
          const copy = l.slice();
          for (let i = copy.length - 1; i >= 0; i--) {
            const item = copy[i];
            if (item?.kind === "msg" && item.msg.role === "assistant") {
              copy[i] = { kind: "msg", msg: { role: "assistant", content: assistantText } };
              break;
            }
          }
          return copy;
        });
      },
      (t) => {
        toolKeyRef.current += 1;
        setLines((l) => [...l, { kind: "tool", tool: t, key: toolKeyRef.current }]);
        // Fact panel — upsert by id so a correction (tenant changes their
        // mind about the industry, say) updates the existing row in place
        // instead of piling up a duplicate; list-type facts (catalog items,
        // ICP-specific Q&A) always get a fresh id, so each stays its own row.
        const newFacts = factsFromTool(t);
        if (newFacts.length) {
          setFacts((prev) => {
            const byId = new Map(prev.map((f) => [f.id, f]));
            const order = prev.map((f) => f.id);
            for (const nf of newFacts) {
              byId.set(nf.id, nf);
              if (!order.includes(nf.id)) order.push(nf.id);
            }
            return order.map((id) => byId.get(id)!);
          });
        }
        // Optimistic local checklist update so the sidebar feels instant
        // instead of waiting on a refetch.
        setChecklist((c) => {
          if (!c) return c;
          if (t.name === "set_industry" && t.output?.ok) return { ...c, hasIndustry: true, hasCatalog: c.hasCatalog || (t.output.catalogSeeded ?? 0) > 0 };
          if (t.name === "add_team_members" && Array.isArray(t.output?.invited) && t.output.invited.length) return { ...c, hasRoster: true };
          if (t.name === "update_brand_profile") {
            const upd: string[] = t.output?.updated ?? [];
            return {
              ...c,
              hasTagline: c.hasTagline || upd.includes("tagline"),
              hasServiceArea: c.hasServiceArea || upd.includes("serviceArea"),
            };
          }
          return c;
        });
      },
      () => {
        historyRef.current = [...newHistory, { role: "assistant", content: assistantText }];
        setStreaming(false);
      },
      () => {
        setStreaming(false);
        setChecklist((c) => (c ? { ...c, done: true } : c));
        qc.invalidateQueries({ queryKey: ["onboarding", "status"] });
        setTimeout(() => setDismissed(true), 1400);
      },
      (msg) => {
        setStreaming(false);
        setErr(msg);
      },
    );
  }

  function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    runTurn([...historyRef.current, { role: "user", content: text }]);
  }

  // Roster-from-photo (scrape audit F.3): the owner snaps their whiteboard /
  // business cards / printout; the server reads the people off it and we send
  // the result into the chat as the same "paste your people" message the
  // concierge already handles — so confirm → add_team_members stays one path.
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  async function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || streaming || reading) return;
    setErr("");
    setReading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/onboarding/roster-from-image", { method: "POST", headers: apiHeaders(), body: fd });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        pasteText?: string;
        sourceKind?: string;
        uncertain?: string[];
        people?: unknown[];
      };
      if (!res.ok) throw new Error(body.message || "Couldn't read that photo");
      if (!body.people?.length) {
        setErr("Couldn't find any names in that photo — try a sharper shot, or paste the list instead.");
        return;
      }
      const notes = body.uncertain?.length ? `\nUnclear in the photo: ${body.uncertain.join("; ")}` : "";
      const text = `(From a photo of our team list${body.sourceKind ? ` — ${body.sourceKind}` : ""})\n${body.pasteText ?? ""}${notes}`;
      runTurn([...historyRef.current, { role: "user", content: text }]);
    } catch (e: any) {
      setErr(e?.message || "Couldn't read that photo");
    } finally {
      setReading(false);
    }
  }

  async function finishLater() {
    try {
      await (api as any).onboarding.complete.$post();
    } catch {}
    setDismissed(true);
  }

  if (!shouldShow) return null;

  const checks: Array<{ key: keyof Snapshot["checklist"]; label: string }> = [
    { key: "hasIndustry", label: "Industry" },
    { key: "hasServiceArea", label: "Service area" },
    { key: "hasCatalog", label: "Catalog" },
    { key: "hasForms", label: "Intake forms" },
    { key: "hasTemplates", label: "Work-order templates" },
    { key: "hasRoster", label: "Team invited" },
  ];

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      {/* Row: [phantom spacer][chat][fact panel] — the spacer matches the
          panel's width so the chat card stays dead-center on screen exactly
          like it always has, with the panel simply appended into the room
          that opens up to its right on wide screens. Below `lg` the spacer
          and panel both disappear and this is pixel-identical to before. */}
      <div className="flex w-full max-w-lg items-stretch justify-center gap-4 lg:max-w-[66rem]">
        <div className="hidden w-64 shrink-0 lg:block" aria-hidden="true" />
        <div className="flex h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-ink-2 shadow-2xl sm:h-[80vh] sm:rounded-2xl">
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-gradient-to-r from-brand/10 to-transparent px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-cyan-glow">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="font-display text-sm font-bold text-white">Let's finish setting up</p>
              <p className="text-xs text-slate-500">{statusQ.data?.company.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={finishLater}
            aria-label="Finish this later"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* "Question N of M" — always visible while the conversation is
            still open, extends live, never goes backwards. */}
        {checklist && !checklist.done && (
          <div className="flex items-center gap-2.5 border-b border-white/5 bg-white/[0.02] px-5 py-2">
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">
              Question {Math.max(qProgress.current, 1)} of {qProgress.total}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, (Math.max(qProgress.current, 1) / qProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* live checklist */}
        {checklist && (
          <div className="flex flex-wrap gap-1.5 border-b border-white/5 bg-white/[0.02] px-5 py-2.5">
            {checks.map((c) => {
              const okVal = checklist[c.key] as boolean;
              return (
                <span
                  key={c.key}
                  className={
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                    (okVal ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-slate-500")
                  }
                >
                  {okVal ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
                  {c.label}
                </span>
              );
            })}
          </div>
        )}

        {/* transcript */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {lines.map((l, i) =>
            l.kind === "tool" ? (
              <div key={`t-${l.key}`} className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-[11px] font-semibold text-cyan-300">
                  <CheckCircle2 className="h-3 w-3" /> {toolLabel(l.tool)}
                </span>
              </div>
            ) : (
              <div key={`m-${i}`} className={"flex " + (l.msg.role === "user" ? "justify-end" : "justify-start")}>
                {l.msg.role === "assistant" && (
                  <span className="mr-2 grid h-7 w-7 shrink-0 place-items-center self-end rounded-full bg-brand/15 text-cyan-glow">
                    <Bot className="h-3.5 w-3.5" />
                  </span>
                )}
                <div
                  className={
                    "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm " +
                    (l.msg.role === "user"
                      ? "bg-brand text-white"
                      : "bg-white/5 text-slate-200")
                  }
                >
                  {l.msg.content ? (
                    l.msg.role === "assistant" ? (
                      <AssistantText text={l.msg.content} />
                    ) : (
                      l.msg.content
                    )
                  ) : streaming && i === lines.length - 1 ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    ""
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>

        {err && <p className="px-5 pb-1 text-xs text-red-400">{err}</p>}

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-white/5 p-3">
          <input
            aria-label="Reply"
            className="flex-1 rounded-xl border border-white/10 bg-ink-3/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-brand"
            placeholder="Type your answer…"
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <input
            ref={fileRef}
            type="file"
            aria-label="Upload a photo of your team list"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPhotoPicked}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={streaming || reading}
            aria-label="Photo of your team list"
            title="Snap a photo of your team list — whiteboard, business cards, printout"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-ink-3/60 text-slate-300 transition hover:border-brand hover:text-white disabled:opacity-40"
          >
            {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={streaming || !input.trim()}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-white transition hover:bg-brand-deep disabled:opacity-40"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <button
          type="button"
          onClick={finishLater}
          className="w-full border-t border-white/5 py-2 text-center text-xs font-medium text-slate-500 hover:text-slate-300"
        >
          I'll finish this later
        </button>
        </div>

        {/* fact panel — everything the AI has extracted so far, live. Wide
            screens only; the chat works exactly the same without it. */}
        <div className="hidden h-[80vh] w-64 shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-2 shadow-2xl lg:flex">
          <div className="flex items-center gap-2 border-b border-white/5 bg-gradient-to-r from-brand/10 to-transparent px-4 py-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/15 text-cyan-glow">
              <ListChecks className="h-4 w-4" />
            </span>
            <div>
              <p className="font-display text-sm font-bold text-white">What I'm learning</p>
              <p className="text-xs text-slate-500">Updates live as we talk</p>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {facts.length === 0 ? (
              <p className="px-2 pt-8 text-center text-xs leading-relaxed text-slate-600">
                Nothing yet — answer a question or two and it'll start filling in here.
              </p>
            ) : (
              facts.map((f) => (
                <div
                  key={f.id}
                  className="animate-in fade-in slide-in-from-right-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 duration-300"
                >
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {f.label}
                  </p>
                  <div className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-200">
                    {f.swatch && (
                      <span
                        className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                        style={{ backgroundColor: f.swatch }}
                      />
                    )}
                    <span className="line-clamp-3">{f.value || "—"}</span>
                  </div>
                </div>
              ))
            )}
            <div ref={factsBottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
