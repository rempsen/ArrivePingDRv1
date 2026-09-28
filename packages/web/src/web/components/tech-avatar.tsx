import { useState } from "react";
import { cn } from "../lib/utils";

function initials(name?: string | null): string {
  return (name ?? "T")
    .trim()
    .split(/\s+/)
    .map((x) => x[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Technician avatar — shows the uploaded headshot when available,
 * otherwise falls back to colour-coded initials.
 */
export function TechAvatar({
  name,
  photoUrl,
  color,
  className,
  textClassName,
}: {
  name?: string | null;
  photoUrl?: string | null;
  color?: string | null;
  /** sizing + shape utility classes, e.g. "h-12 w-12 rounded-full" */
  className?: string;
  /** text sizing for the initials fallback */
  textClassName?: string;
}) {
  const base = cn(
    "grid place-items-center overflow-hidden rounded-full bg-cover bg-center font-semibold text-slate-100 shrink-0",
    className,
  );
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed) {
    return (
      <span
        className={base}
        style={{ backgroundImage: `url(${photoUrl})`, background: undefined }}
        aria-label={name ?? "Technician"}
      >
        <img
          src={photoUrl}
          alt={name ?? "Technician"}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    // Restrained fallback: one tinted surface for every tech, with the
    // tech's map colour kept as a thin ring so the list still maps to the
    // fleet-map markers without turning the roster into a rainbow.
    <span
      className={base}
      style={{
        background: "rgba(14,165,233,0.10)",
        boxShadow: `inset 0 0 0 1.5px ${color || "#0ea5e9"}`,
      }}
    >
      <span className={textClassName}>{initials(name)}</span>
    </span>
  );
}
