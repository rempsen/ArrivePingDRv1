import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardJob, BoardTech } from "../data/types";
import { jobTitle } from "./format";

interface Item {
  key: string;
  kind: "tech" | "job";
  id: string;
  title: string;
  sub: string;
  haystack: string;
}

interface Props {
  open: boolean;
  techs: BoardTech[];
  jobs: BoardJob[];
  noun: string;
  workerNoun: string;
  onPick(kind: "tech" | "job", id: string): void;
  onClose(): void;
}

/** Find a technician or a job by name, address or customer. Opens with / or Cmd-K. */
export function CommandPalette({ open, techs, jobs, noun, workerNoun, onPick, onClose }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setAt(0);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  // Clicking the dimmed backdrop closes it.
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    const off = (e: MouseEvent) => {
      if (e.target === d) onClose();
    };
    d.addEventListener("click", off);
    return () => d.removeEventListener("click", off);
  }, [onClose]);

  const items = useMemo<Item[]>(
    () => [
      ...techs.map((t) => ({ key: `t:${t.id}`, kind: "tech" as const, id: t.id, title: t.name, sub: workerNoun, haystack: `${t.name} ${t.skills.join(" ")} ${t.vehicle}`.toLowerCase() })),
      ...jobs
        .filter((j) => j.status !== "completed" && j.status !== "cancelled")
        .map((j) => ({
          key: `j:${j.id}`,
          kind: "job" as const,
          id: j.id,
          title: jobTitle(j, noun),
          sub: [j.customerName, j.address].filter(Boolean).join(" · "),
          haystack: `${j.title} ${j.service} ${j.customerName} ${j.address}`.toLowerCase(),
        })),
    ],
    [techs, jobs, noun, workerNoun],
  );

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? items.filter((i) => words.every((w) => i.haystack.includes(w))) : items;
    return list.slice(0, 12);
  }, [items, q]);

  const pick = (i: Item | undefined) => {
    if (!i) return;
    onPick(i.kind, i.id);
    onClose();
  };

  return (
    <dialog
      ref={dlg}
      className="ap-palette ap-glass"
      aria-label="Find"
      onClose={onClose}
    >
      <input
        className="ap-palette__input"
        aria-label={`Find a ${workerNoun.toLowerCase()} or ${noun.toLowerCase()}`}
        placeholder={`Find a ${workerNoun.toLowerCase()} or ${noun.toLowerCase()}`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((v) => Math.min(v + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((v) => Math.max(v - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(shown[at]);
          }
        }}
      />
      <ul className="ap-palette__list">
        {shown.length === 0 && <li className="ap-empty">Nothing matches.</li>}
        {shown.map((i, idx) => (
          <li key={i.key}>
            <button type="button" className="ap-row" data-active={idx === at ? "" : undefined} onMouseEnter={() => setAt(idx)} onClick={() => pick(i)}>
              <span className="ap-row__title">{i.title}</span>
              <span className="ap-row__sub">{i.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="ap-hint ap-palette__keys">Enter to open · F fit all · S satellite · Esc clear</p>
    </dialog>
  );
}
