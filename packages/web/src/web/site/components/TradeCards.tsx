import { trades, tradeMedia } from "../config";

/**
 * One card per trade, linking to that trade's page. Each is a real photograph
 * of the work (see tradeMedia in config.ts), and over it, the one thing
 * ArrivePing adds to that moment: the text the trade's customer gets ("Jordan
 * is on the way…"). The text slides in as the card scrolls into view (plain
 * CSS off the shared reveal; static with reduced motion).
 *
 * On phones the six become a swipeable row, one card at a time with the next
 * peeking in, so the photo and the message both stay readable.
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
  return (
    <li className="trade-card" data-reveal="" data-reveal-delay={String(delay)}>
      <a href={trade.href} aria-label={`${trade.label}: ${trade.line} See how it works`}>
        <span className="trade-card__media">
          <picture>
            <source type="image/webp" srcSet={m.card} />
            <img src={m.cardJpg} alt="" loading="lazy" decoding="async" width={800} height={600} />
          </picture>
          {/* Illustration of the customer's text; the link's label carries the meaning. */}
          <span className="trade-ping" aria-hidden="true">
            <span className="trade-ping__meta">
              <span className="trade-ping__dot" aria-hidden="true" />
              Text message · now
            </span>
            <span className="trade-ping__text">{trade.ping}</span>
          </span>
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
