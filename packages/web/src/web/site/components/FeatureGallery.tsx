import { useEffect, useRef, useState } from "react";
import type { Shot } from "../content/geo-sections";

/**
 * Feature cards that show the real app. Each card carries a small mosaic of
 * its screenshots and opens a gallery dialog with the full-size screens,
 * captions, arrows (and ←/→ keys) to step through them. Cards without a
 * gallery render as plain cards.
 */
export type GalleryItem = { title: string; body: string; gallery?: readonly Shot[] };

export function FeatureGalleryGrid({ items }: { items: readonly GalleryItem[] }) {
  const [open, setOpen] = useState<{ item: number; shot: number } | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dlg.current;
    if (d && open && !d.open) d.showModal();
  }, [open]);

  // A click on the backdrop (outside the panel) closes; Escape closes natively.
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  const item = open ? items[open.item] : undefined;
  const shots = item?.gallery ?? [];
  const shot = open ? shots[open.shot] : undefined;
  const step = (by: number) => setOpen((o) => (o ? { ...o, shot: (o.shot + by + shots.length) % shots.length } : o));

  return (
    <>
      <div className="lp-grid">
        {items.map((it, i) => {
          const g = it.gallery ?? [];
          if (!g.length)
            return (
              <div key={it.title} className="lp-card" data-reveal="" data-reveal-delay={String(i % 3)}>
                <h3 className="h-card">{it.title}</h3>
                <p>{it.body}</p>
              </div>
            );
          return (
            <button
              key={it.title}
              type="button"
              className="lp-card fg-card"
              data-reveal=""
              data-reveal-delay={String(i % 3)}
              aria-haspopup="dialog"
              onClick={(e) => {
                opener.current = e.currentTarget;
                setOpen({ item: i, shot: 0 });
              }}
            >
              <span className={`fg-mosaic fg-mosaic--${Math.min(g.length, 4)}`} aria-hidden="true">
                {g.slice(0, 4).map((s) => (
                  <span key={s.src} className={`fg-thumb${s.phone ? " fg-thumb--phone" : ""}`}>
                    <img src={s.src} alt="" width={s.w} height={s.h} loading="lazy" decoding="async" />
                  </span>
                ))}
              </span>
              <h3 className="h-card">{it.title}</h3>
              <p>{it.body}</p>
              <span className="fg-more">
                See {g.length} screens <span aria-hidden="true">→</span>
              </span>
            </button>
          );
        })}
      </div>

      <dialog
        ref={dlg}
        className="hv-dialog fg-dialog"
        aria-labelledby="fg-title"
        onClose={() => {
          setOpen(null);
          opener.current?.focus?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
      >
        {item && shot && open && (
          <div className="hv-dialog__panel">
            <header className="hv-dialog__head">
              <div>
                <span className="eyebrow">
                  Screen {open.shot + 1} of {shots.length} · Real ArrivePing screens, sample company
                </span>
                <h2 id="fg-title">{item.title}</h2>
              </div>
              <button type="button" className="hv-dialog__close" onClick={() => dlg.current?.close()} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <figure className={`fg-stage${shot.phone ? " fg-stage--phone" : ""}`}>
              <img key={shot.src} src={shot.src} width={shot.w} height={shot.h} alt={shot.alt} decoding="async" />
              <figcaption>{shot.caption}</figcaption>
            </figure>
            {shots.length > 1 && (
              <div className="fg-nav">
                <button type="button" onClick={() => step(-1)} aria-label="Previous screen">
                  ←
                </button>
                <div className="fg-dots">
                  {shots.map((s, n) => (
                    <button
                      key={s.src}
                      type="button"
                      className={`fg-dot${s.phone ? " fg-dot--phone" : ""}`}
                      aria-label={`Screen ${n + 1}`}
                      aria-current={n === open.shot ? "true" : undefined}
                      onClick={() => setOpen({ ...open, shot: n })}
                    >
                      <img src={s.src} alt="" width={s.w} height={s.h} loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => step(1)} aria-label="Next screen">
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
