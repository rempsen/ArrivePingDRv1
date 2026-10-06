import { useEffect, useState } from "react";
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

/** Up to two initials from a company name: "Prairie Comfort HVAC" → "PC". */
export function monogram(name: string): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Tenant logo tile. Renders the company's uploaded logo; if there is none —
 * or the URL is not actually an image (a Google Drive share link, a dead
 * link) — falls back to a monogram tile in the company's brand colour so the
 * workspace is still unmistakably theirs.
 */
export function TenantLogo({
  src,
  name,
  color,
  className,
  textClassName,
}: {
  src?: string;
  name: string;
  color?: string;
  className?: string;
  textClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const ok = !!src && !broken && /^(https?:)?\//.test(src);
  if (ok) {
    return (
      <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/10", className)}>
        <img src={src} alt={name} onError={() => setBroken(true)} className="h-full w-full object-contain p-1" />
      </span>
    );
  }
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#06B6D4";
  return (
    <span
      aria-label={name}
      className={cn("grid shrink-0 place-items-center rounded-xl font-display font-extrabold tracking-tight text-white ring-1 ring-white/10", className, textClassName)}
      style={{ background: `linear-gradient(135deg, ${c} 0%, ${c}99 100%)`, textShadow: "0 1px 2px rgba(0,0,0,.35)" }}
    >
      {monogram(name)}
    </span>
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
