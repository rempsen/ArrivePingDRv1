import { Fragment, type ReactNode } from "react";
import type { Cell, LandingPage } from "../content/landing";
import type { GeoSection } from "../content/geo-sections";
import { OmwTextGenerator } from "./OmwTextGenerator";
import { NoShowCalculator } from "./NoShowCalculator";
import "../geo.css";

/**
 * Renders the extra section kinds used by the comparison, alternatives and
 * free-tool pages (content/geo-sections.ts). Same containers, cards and table
 * styles as the rest of the landing pages (landing.css), plus geo.css for the
 * tools, screenshots and product cards.
 */
export function GeoSectionBlock({ section: s, page }: { section: GeoSection; page: LandingPage }) {
  switch (s.kind) {
    case "tool":
      return (
        <section className="section section--divided geo-tool-wrap" id={s.id} aria-labelledby={`${s.id ?? "tool"}-h`}>
          <div className="container">
            <Head id={`${s.id ?? "tool"}-h`} eyebrow={s.eyebrow} title={s.title} body={s.body} />
            {s.tool === "omw-text" ? <OmwTextGenerator /> : <NoShowCalculator />}
          </div>
        </section>
      );
    case "rich":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <div className="lp-prose geo-rich" data-reveal="">
              {s.eyebrow && <span className="eyebrow">{s.eyebrow}</span>}
              <h2 className="h-section">{s.title}</h2>
              {s.paragraphs.map((p) => (
                <p key={p}>{inline(p)}</p>
              ))}
              {s.bullets &&
                (s.ordered ? (
                  <ol>
                    {s.bullets.map((b) => (
                      <li key={b}>{inline(b)}</li>
                    ))}
                  </ol>
                ) : (
                  <ul>
                    {s.bullets.map((b) => (
                      <li key={b}>{inline(b)}</li>
                    ))}
                  </ul>
                ))}
            </div>
          </div>
        </section>
      );
    case "shots":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <div className={`geo-shots${s.shots.every((x) => x.phone) ? " geo-shots--side" : ""}`}>
              <div className="lp-prose geo-rich" data-reveal="">
                {s.eyebrow && <span className="eyebrow">{s.eyebrow}</span>}
                <h2 className="h-section">{s.title}</h2>
                {s.paragraphs?.map((p) => (
                  <p key={p}>{inline(p)}</p>
                ))}
              </div>
              <div className={`geo-shots__row geo-shots__row--${s.shots.length}`}>
                {s.shots.map((x) => (
                  <figure key={x.src} className={`geo-shot${x.phone ? " geo-shot--phone" : ""}`} data-reveal="">
                    <div className="geo-shot__frame">
                      <img src={x.src} width={x.w} height={x.h} alt={x.alt} loading="lazy" decoding="async" />
                    </div>
                    <figcaption>{x.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </section>
      );
    case "matrix":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <div className="lp-table-wrap" data-reveal="">
              <table className="lp-table geo-matrix">
                <caption className="visually-hidden">{s.title}</caption>
                <thead>
                  <tr>
                    {s.columns.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.label} className={r.ours ? "geo-matrix__ours" : undefined}>
                      <th scope="row">{r.label}</th>
                      {r.cells.map((c, i) => (
                        <td key={i} data-col={s.columns[i + 1] || undefined}>
                          <CellView cell={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(s.note || page.verified) && (
              <p className="small lp-table__note">
                {s.note ? `${s.note} ` : ""}
                {page.verified ? `Competitor details checked ${page.verified}.` : ""}
              </p>
            )}
          </div>
        </section>
      );
    case "picks":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <ol className="geo-picks">
              {s.items.map((p, i) => (
                <li key={p.name} className={`lp-card geo-pick${p.ours ? " lp-card--ours" : ""}`} data-reveal="" data-reveal-delay={String(i % 3)}>
                  <h3 className="h-card">
                    <span className="geo-pick__n tnum" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {p.name}
                  </h3>
                  <dl className="geo-pick__facts">
                    {p.facts.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>
                          <CellView cell={f.value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="geo-pick__choose">Choose it if</p>
                  <ul>
                    {p.chooseIf.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {p.more && (
                    <p className="geo-pick__more">
                      <a href={p.more.href}>{p.more.label}</a>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>
      );
    case "cards":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <ul className="geo-cards">
              {s.items.map((c, i) => (
                <li key={c.href} data-reveal="" data-reveal-delay={String(i % 3)}>
                  <a href={c.href} className="lp-card geo-card">
                    <h3 className="h-card">{c.title}</h3>
                    <p>{c.body}</p>
                    <span className="geo-card__cta">
                      {c.cta} <span aria-hidden="true">→</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "examples":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <div className="geo-examples">
              {s.groups.map((g, i) => (
                <div key={g.title} className="lp-card" data-reveal="" data-reveal-delay={String(i % 3)}>
                  <h3 className="h-card">{g.title}</h3>
                  <dl className="geo-examples__list">
                    {g.items.map((it) => (
                      <Fragment key={it.label}>
                        <dt>{it.label}</dt>
                        <dd>{it.text}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "refs":
      return (
        <section className="section--tight lp-sources-wrap" id={s.id} aria-labelledby={`${s.id ?? "refs"}-h`}>
          <div className="container">
            <h2 id={`${s.id ?? "refs"}-h`} className="lp-sources__title">
              {s.title}
            </h2>
            {s.body && <p className="small">{inline(s.body)}</p>}
            <ul className="geo-refs">
              {s.items.map((r) => (
                <li key={r.href}>
                  <a href={r.href} rel="nofollow noopener" target="_blank">
                    {r.label}
                  </a>
                  {r.note && <span>: {r.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
  }
}

function Head({ id, eyebrow, title, body }: { id?: string; eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="intro" data-reveal="">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2 id={id} className="h-section">
        {title}
      </h2>
      {body && <p className="lede">{inline(body)}</p>}
    </div>
  );
}

function CellView({ cell }: { cell: Cell }) {
  if (typeof cell === "string") return <>{inline(cell)}</>;
  if (!cell.href) return <>{cell.text}</>;
  const external = cell.href.startsWith("http");
  return (
    <a href={cell.href} {...(external ? { rel: "nofollow noopener", target: "_blank" } : {})}>
      {cell.text}
    </a>
  );
}

/** Text with [label](href) links. Internal links stay in the tab; external ones open a new tab. */
export function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = m[2]!;
    const external = /^https?:/.test(href);
    parts.push(
      <a key={m.index} href={href} {...(external ? { rel: "nofollow noopener", target: "_blank" } : {})}>
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}
