import { Link } from "wouter";
import { cn } from "../lib/utils";
import { STATUS_META } from "../lib/utils";

export function Logo({
  className,
  imgClassName,
  to = "/",
  light = true,
  showText = true,
}: {
  className?: string;
  imgClassName?: string;
  to?: string;
  light?: boolean;
  showText?: boolean;
}) {
  // Official ArrivePing wordmark lockups (transparent, pick by surface —
  // never rebuild the mark as a separate icon + styled text).
  if (!showText) {
    return (
      <Link to={to} className={cn("inline-flex items-center py-1 lg:py-0", className)}>
        <img
          src={light ? "/arriveping-icon-light.png" : "/arriveping-icon-dark.png"}
          alt="ArrivePing"
          className={cn("h-9 w-9 rounded-xl object-contain", imgClassName)}
        />
      </Link>
    );
  }
  return (
    <Link to={to} className={cn("inline-flex items-center py-1 lg:py-0", className)}>
      <img
        src={light ? "/arriveping-logo-light.png" : "/arriveping-logo-dark.png"}
        alt="ArrivePing"
        className={cn("h-8 w-auto object-contain", imgClassName)}
      />
    </Link>
  );
}

/** Standard padded content wrapper for dispatcher console pages.
 *  `wide` bumps the cap from max-w-6xl (72rem) to max-w-[86rem] — ~20%
 *  wider — for pages like the Scheduler calendar where the default width
 *  crowds day cells and truncates job chips. Opt-in per page so every
 *  other admin page keeps its current width. */
export function PageWrap({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto px-4 py-6 pb-24 md:px-8 ${wide ? "max-w-[86rem]" : "max-w-6xl"}`}>{children}</div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? {
    label: status,
    color: "#475569",
    bg: "#f1f5f9",
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: m.color, background: m.bg }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: m.color }}
      />
      {m.label}
    </span>
  );
}
