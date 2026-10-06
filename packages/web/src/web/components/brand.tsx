import { Link } from "wouter";
// Logo assets were re-cropped (tight bounding box); ?v=2 busts the 1h browser cache.
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
          src={light ? "/arriveping-icon-light.png?v=2" : "/arriveping-icon-dark.png?v=2"}
          alt="ArrivePing"
          className={cn("h-9 w-9 rounded-xl object-contain", imgClassName)}
        />
      </Link>
    );
  }
  return (
    <Link to={to} className={cn("inline-flex items-center py-1 lg:py-0", className)}>
      <img
        src={light ? "/arriveping-logo-light.png?v=2" : "/arriveping-logo-dark.png?v=2"}
        alt="ArrivePing"
        className={cn("h-8 w-auto object-contain", imgClassName)}
      />
    </Link>
  );
}

/** Standard padded content wrapper for dispatcher console pages.
 *  Fluid: fills whatever width the shell gives it (sidebar excluded) so the
 *  Jobs list, calendar, map, etc. grow with the browser window instead of
 *  floating in a centred 72rem column with dead space either side.
 *  `wide` is kept for backwards compatibility and is now a no-op. */
export function PageWrap({ children }: { children: React.ReactNode; wide?: boolean }) {
  return <div className="page-wrap w-full min-w-0 px-4 py-6 pb-24 md:px-8">{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? {
    label: status,
    color: "#475569",
    bg: "#f1f5f9",
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
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
