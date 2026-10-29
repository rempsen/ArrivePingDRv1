import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiHeaders } from "../lib/api";
import { inputCls } from "./modal";

/** This company's skill classes (Settings → Skill Classes), in its order. */
export function useSkillClasses(): string[] {
  const q = useQuery({
    queryKey: ["skill-classes"],
    queryFn: async () => {
      const r = await fetch("/api/skill-classes", { headers: apiHeaders() });
      if (!r.ok) throw new Error(`Couldn't load skill classes (${r.status})`);
      return (await r.json()) as { classes: Array<{ name: string }> };
    },
    staleTime: 60_000,
  });
  return useMemo(() => (q.data?.classes ?? []).map((c) => c.name), [q.data]);
}

/** The company's classes, plus the person's current one when it's no longer listed (kept, never silently changed). */
export function SkillClassSelect({ value, onChange, classes }: { value: string; onChange: (v: string) => void; classes: string[] }) {
  const missing = !!value && !classes.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Skill class">
      {missing ? <option value={value}>{value} (no longer in the list)</option> : null}
      {classes.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
