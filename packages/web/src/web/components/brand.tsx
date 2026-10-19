import { useEffect, useState } from "react";
import { Link } from "wouter";
import { plateForImage, type LogoPlate } from "../lib/logo-plate";
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
          src={light ? "/arriveping-icon-light.png?v=4" : "/arriveping-icon-dark.png?v=4"}
          alt="ArrivePing"
          className={cn("h-9 w-9 rounded-xl object-contain", imgClassName)}
        />
      </Link>
    );
  }
  return (
    <Link to={to} className={cn("inline-flex items-center py-1 lg:py-0", className)}>
      <img
        src={light ? "/arriveping-logo-light.png?v=3" : "/arriveping-logo-dark.png?v=3"}
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
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Tenant logo. Renders the company's uploaded logo; if there is none — or the
 * URL is not actually an image (a Google Drive share link, a dead link) —
 * falls back to a monogram tile in the company's brand colour so the
 * workspace is still unmistakably theirs.
 *
 * variant "tile"  — square dark tile, logo inset (avatars, settings rows).
 * variant "plate" — the logo sits on a plate at whatever size `className`
 *                   gives it. Most real-world logos are drawn for white
 *                   paper/letterhead (navy text, dark marks) and get a white
 *                   plate. Logos drawn for a dark website header — white
 *                   lettering on a transparent background — vanish on white,
 *                   so `plate` picks the backing: "light" | "dark" from the
 *                   server's analysis (services/logo-contrast.ts), or "auto",
 *                   where the browser reads the pixels itself once the image
 *                   loads (lib/logo-plate.ts). The monogram fallback uses
 *                   `fallbackClassName` so it can stay square while the plate
 *                   is wide.
 */
export function TenantLogo({
  src,
  name,
  color,
  className,
  textClassName,
  variant = "tile",
  plate = "auto",
  fallbackClassName,
  imgClassName,
}: {
  src?: string;
  name: string;
  color?: string;
  className?: string;
  textClassName?: string;
  variant?: "tile" | "plate";
  /** Backing for variant "plate": light, dark, or let the browser decide. */
  plate?: LogoPlate | "auto";
  fallbackClassName?: string;
  imgClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  // What the browser worked out from the pixels when `plate` is "auto".
  const [seen, setSeen] = useState<LogoPlate | null>(null);
  useEffect(() => {
    setBroken(false);
    setSeen(null);
  }, [src]);
  const ok = !!src && !broken && /^(https?:)?\//.test(src);
  if (ok && variant === "plate") {
    const backing: LogoPlate = plate === "auto" ? seen ?? "light" : plate;
    return (
      // Flex (not grid) + min-h-0/min-w-0 on the image: a grid item's implicit
      // `min-height: auto` let tall-ish logos overflow the plate's padding and
      // `overflow-hidden` then sliced the bottom row of letters off (BMD's
      // "MATERIALS" line). Flex with min sizes zeroed forces the image to fit
      // entirely inside the padded box, centred on both axes, for any shape.
      <span
        data-plate={backing}
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-xl px-3 py-2 ring-1",
          backing === "dark" ? "bg-slate-950 ring-white/15" : "bg-white ring-white/10",
          className,
        )}
      >
        <img
          src={src}
          alt={name}
          onError={() => setBroken(true)}
          onLoad={(e) => {
            if (plate !== "auto" || seen) return;
            const p = plateForImage(e.currentTarget);
            if (p) setSeen(p);
          }}
          className={cn("block h-full max-h-full w-full min-h-0 min-w-0 max-w-full object-contain object-center", imgClassName)}
        />
      </span>
    );
  }
  if (ok) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/10", className)}>
        <img src={src} alt={name} onError={() => setBroken(true)} className={cn("block h-full max-h-full w-full min-h-0 min-w-0 max-w-full object-contain object-center p-1", imgClassName)} />
      </span>
    );
  }
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#06B6D4";
  return (
    <span
      aria-label={name}
      className={cn(
        "grid shrink-0 place-items-center rounded-xl font-display font-extrabold tracking-tight text-white ring-1 ring-white/10",
        variant === "plate" ? fallbackClassName ?? className : className,
        textClassName,
      )}
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

/**
 * A tenant logo on a light public page (booking form, work-order form, pay
 * page). Most logos sit straight on the page; one drawn with white lettering
 * gets a dark pill behind it, decided from its pixels once it loads. Falls
 * back to nothing (so the caller's text header shows) when the file is broken.
 */
export function PublicLogo({
  src,
  alt = "",
  className,
  plate = "auto",
  onBroken,
}: {
  src: string;
  alt?: string;
  className?: string;
  plate?: LogoPlate | "auto";
  onBroken?: () => void;
}) {
  const [seen, setSeen] = useState<LogoPlate | null>(null);
  useEffect(() => setSeen(null), [src]);
  const backing: LogoPlate = plate === "auto" ? seen ?? "light" : plate;
  const img = (
    <img
      src={src}
      alt={alt}
      onError={onBroken}
      onLoad={(e) => {
        if (plate !== "auto" || seen) return;
        const p = plateForImage(e.currentTarget);
        if (p) setSeen(p);
      }}
      className={cn("block object-contain", className)}
    />
  );
  if (backing === "dark") {
    return <span className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 ring-1 ring-slate-900/10">{img}</span>;
  }
  return img;
}
