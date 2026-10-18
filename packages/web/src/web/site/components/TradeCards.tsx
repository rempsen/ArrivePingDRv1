import { useRef, useState } from "react";
import { trades, tradeMedia } from "../config";
import { usePlayback } from "../motion/playback";

/**
 * One card per trade, linking to that trade's page. The still is a generated
 * scene of the trade; on hover or keyboard focus (and only when motion is
 * allowed) its short silent loop plays in place. The video loads on first
 * hover, so the cards cost nothing extra on page load.
 */
export function TradeCards({ exclude }: { exclude?: string }) {
  return (
    <ul className="trade-cards">
      {trades
        .filter((t) => t.href !== exclude)
        .map((t, i) => (
          <TradeCard key={t.key} trade={t} delay={(i % 3) + 1} />
        ))}
    </ul>
  );
}

function TradeCard({ trade, delay }: { trade: (typeof trades)[number]; delay: number }) {
  const m = tradeMedia(trade.key);
  const { reduced, paused } = usePlayback();
  const [armed, setArmed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const motion = !reduced && !paused;

  const start = () => {
    if (!motion) return;
    setArmed(true);
    requestAnimationFrame(() => video.current?.play().catch(() => {}));
  };
  const stop = () => video.current?.pause();

  return (
    <li className="trade-card" data-reveal="" data-reveal-delay={String(delay)}>
      <a href={trade.href} onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop}>
        <span className="trade-card__media">
          <picture>
            <source type="image/webp" srcSet={m.card} />
            <img src={m.cardJpg} alt="" loading="lazy" decoding="async" width={800} height={600} />
          </picture>
          {armed ? <video ref={video} src={m.film} muted loop playsInline preload="auto" aria-hidden="true" tabIndex={-1} /> : null}
        </span>
        <span className="trade-card__copy">
          <span className="trade-card__label">{trade.label}</span>
          <span className="trade-card__line">{trade.line}</span>
          <span className="trade-card__more">
            See how it works
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </a>
    </li>
  );
}
