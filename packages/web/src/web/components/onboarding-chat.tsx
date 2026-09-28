import { useEffect, useRef, useState, type ReactNode } from "react";
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
    done: boolean;
  };
};

type ChatMsg = { role: "user" | "assistant"; content: string };
type ToolEvent = { name: string; input: any; output: any };
/** One rendered line in the transcript — either a chat bubble or a small
 * "✓ did a thing" pill dropped in between bubbles. */
type Line = { kind: "msg"; msg: ChatMsg } | { kind: "tool"; tool: ToolEvent; key: number };

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
    case "finish_onboarding":
      return "Wrapped up onboarding";
    default:
      return t.name;
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
  const [checklist, setChecklist] = useState<Snapshot["checklist"] | null>(null);

  useEffect(() => {
    if (statusQ.data) setChecklist(statusQ.data.checklist);
  }, [statusQ.data]);

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
    if (showUserBubble) {
      setLines((l) => [...l, { kind: "msg", msg: newHistory[newHistory.length - 1] }]);
    }
    setStreaming(true);
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
            if (item.kind === "msg" && item.msg.role === "assistant") {
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
        // Optimistic local checklist update so the sidebar feels instant
        // instead of waiting on a refetch.
        setChecklist((c) => {
          if (!c) return c;
          if (t.name === "set_industry" && t.output?.ok) return { ...c, hasIndustry: true, hasCatalog: c.hasCatalog || (t.output.catalogSeeded ?? 0) > 0 };
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
  ];

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
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
    </div>
  );
}
