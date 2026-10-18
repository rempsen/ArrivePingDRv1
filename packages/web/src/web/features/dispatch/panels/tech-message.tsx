/**
 * Message a technician without leaving the map. "Text" sends a real SMS;
 * "Message" is the in-app thread (polled while open). Same endpoints the
 * classic page uses.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiFetch, apiHeaders } from "../../../lib/api";
import type { BoardTech } from "../data/types";

export type MessageMode = "sms" | "chat";

interface Msg {
  id: string;
  senderRole: string;
  senderName: string;
  body: string;
  createdAt: number | string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/fleet/${path}`, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...apiHeaders() },
  });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(j.message || "Couldn't send. Try again.");
  return j;
}

export function TechMessage({ tech, mode, onClose }: { tech: BoardTech | null; mode: MessageMode; onClose(): void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const open = !!tech;

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      setBody("");
      setNote("");
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const thread = useQuery({
    queryKey: ["dispatch-thread", tech?.id],
    queryFn: () => call<{ direct: Msg[] }>(`${tech!.id}/thread`),
    enabled: open && mode === "chat",
    refetchInterval: 4000,
  });
  useEffect(() => {
    if (open && mode === "chat" && tech) void call(`${tech.id}/thread/mark-read`, { method: "POST" }).catch(() => {});
  }, [open, mode, tech]);

  const send = useMutation({
    mutationFn: () =>
      mode === "sms"
        ? call<{ skipped?: boolean }>(`${tech!.id}/sms`, { method: "POST", body: JSON.stringify({ body }) })
        : call(`${tech!.id}/thread`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: (r) => {
      setBody("");
      if (mode === "sms") setNote((r as { skipped?: boolean }).skipped ? "Logged. Texting isn't set up for this company yet." : "Text sent.");
      else void qc.invalidateQueries({ queryKey: ["dispatch-thread", tech?.id] });
    },
  });

  const msgs = thread.data?.direct ?? [];
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [msgs.length]);

  const canSend = body.trim().length > 0 && !send.isPending;
  const submit = () => canSend && send.mutate();

  return (
    <dialog ref={dlg} className="ap-palette ap-glass ap-msg" aria-label={mode === "sms" ? "Text" : "Message"} onClose={onClose}>
      <header className="ap-panel__head">
        <div>
          <h2>
            {mode === "sms" ? "Text" : "Message"} {tech?.name}
          </h2>
          {mode === "sms" && <p className="ap-muted">{tech?.phone || "No number on file"}</p>}
        </div>
        <button type="button" className="ap-btn ap-btn--icon" aria-label="Close" onClick={() => dlg.current?.close()}>
          ×
        </button>
      </header>
      {mode === "chat" && (
        <div className="ap-thread">
          {msgs.length === 0 && <p className="ap-empty">No messages yet.</p>}
          {msgs.map((m) => (
            <div key={m.id} className="ap-bubble" data-mine={m.senderRole === "dispatch" ? "" : undefined}>
              <p>{m.body}</p>
              <span>
                {m.senderName} · {new Date(Number(m.createdAt) || m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}
      <textarea
        className="ap-palette__input"
        rows={mode === "sms" ? 4 : 2}
        aria-label="Message"
        placeholder="Type your message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (mode === "chat" && !e.shiftKey))) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {send.error && <p className="ap-error">{(send.error as Error).message}</p>}
      {note && <p className="ap-ok">{note}</p>}
      <div className="ap-clash__actions">
        <button type="button" className="ap-btn" onClick={() => dlg.current?.close()}>
          Close
        </button>
        <button type="button" className="ap-btn ap-btn--primary" disabled={!canSend} onClick={submit}>
          Send
        </button>
      </div>
    </dialog>
  );
}
