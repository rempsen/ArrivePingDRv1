import { customerView, hero } from "../config";

/**
 * "What your customer sees" — the homeowner's side of the same job, on a light
 * section that deliberately breaks from the dark ops sections around it.
 *
 * Three phones, left to right: the on-the-way text (ArrivePing's default wording
 * in iOS Messages), the live tracking page and the technician contact card
 * (real screenshots, sample data). Then the sourced figures, large.
 */

export function CustomerView() {
  const sms = hero.device.sms;
  return (
    <section id="customer-view" className="ap-cv anchor" aria-labelledby="cv-title">
      <div className="container">
        <div className="ap-cv__head" data-reveal="">
          <div>
            <span className="eyebrow">{customerView.eyebrow}</span>
            <h2 id="cv-title" className="h-section">
              {customerView.title} <span className="h-muted">{customerView.titleMuted}</span>
            </h2>
          </div>
          <div>
            <p className="lede">{customerView.body}</p>
            <p className="ap-cv__privacy">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <rect x="3.5" y="8" width="11" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 8V5.8a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {customerView.privacy}
            </p>
          </div>
        </div>

        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- on phones this row scrolls sideways; a focusable region lets keyboard users scroll it */}
        <section className="ap-cv__scroller" aria-label="What your customer sees, step by step" tabIndex={0}>
          <ol className="ap-cv__steps">
            {customerView.steps.map((s, i) => (
              <li key={s.kicker} className="ap-cv__step" data-reveal="" data-reveal-delay={String(i + 1)}>
                <div className="ap-cv__device">
                  <div className="ap-phone ap-phone--crop">
                    {s.screen.kind === "sms" ? (
                      <SmsScreen from={sms.from} body={sms.body} />
                    ) : (
                      <img src={s.screen.src} width={s.screen.width} height={s.screen.height} alt={s.screen.alt} loading="lazy" decoding="async" />
                    )}
                  </div>
                </div>
                <div className="ap-cv__text">
                  <span className="ap-cv__kicker">
                    <span className="ap-cv__n tnum">{i + 1}</span>
                    {s.kicker}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <p className="ap-cv__cap">{customerView.caption}</p>

        <div className="ap-cv__why" data-reveal="">
          <h3 className="ap-cv__whyhead">Why homeowners care</h3>
          <ul className="ap-cv__stats">
            {customerView.stats.map((st) => (
              <li key={st.value}>
                <span className="ap-cv__val tnum">{st.value}</span>
                <span className="ap-cv__lbl">{st.label}</span>
                <a className="ap-cv__src" href={st.href} target="_blank" rel="noopener noreferrer">
                  {st.source}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** iOS Messages, showing ArrivePing's default on-the-way text. */
function SmsScreen({ from, body }: { from: string; body: string }) {
  const url = body.match(/https?:\/\/\S+$/)?.[0] ?? "";
  const text = url ? body.slice(0, -url.length) : body;
  return (
    <div className="ap-sms">
      <div className="ap-sms__status" aria-hidden="true">
        <span className="tnum">9:16</span>
        <span className="ap-sms__island" />
        <span className="ap-sms__icons">
          <svg width="44" height="12" viewBox="0 0 44 12">
            <g fill="#fff">
              <rect x="0" y="8" width="3" height="4" rx="1" />
              <rect x="4.5" y="6" width="3" height="6" rx="1" />
              <rect x="9" y="3.5" width="3" height="8.5" rx="1" />
              <rect x="13.5" y="1" width="3" height="11" rx="1" />
              <rect x="22" y="1" width="19" height="10" rx="3" fill="none" stroke="#fff" strokeOpacity=".5" />
              <rect x="23.6" y="2.6" width="15.8" height="6.8" rx="1.8" />
              <rect x="41.8" y="4" width="1.6" height="4" rx=".8" opacity=".5" />
            </g>
          </svg>
        </span>
      </div>
      <div className="ap-sms__head" aria-hidden="true">
        <span className="ap-sms__back">
          <svg width="10" height="16" viewBox="0 0 10 16">
            <path d="M8.5 1.5L2 8l6.5 6.5" fill="none" stroke="#0a84ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="ap-sms__avatar">
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="8" r="4" fill="#fff" />
            <path d="M3 20c.8-4 4-6.2 8-6.2s7.2 2.2 8 6.2" fill="#fff" />
          </svg>
        </span>
        <span className="ap-sms__name">{from}</span>
      </div>
      <div className="ap-sms__thread">
        <span className="ap-sms__meta" aria-hidden="true">
          Text Message
          <br />
          Today 9:16 PM
        </span>
        <p className="ap-sms__bubble">
          <span className="visually-hidden">Text message from {from}: </span>
          {text}
          <span className="ap-sms__link">{url}</span>
        </p>
      </div>
    </div>
  );
}
