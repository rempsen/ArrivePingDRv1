import { integrations } from "../config";

/**
 * Reporting, built in — between the integration tiles and the custom-
 * integration card. One real Reports screen (local instance, sample company
 * and data) with its parts called out: (1) filters, (2) the Export menu, and
 * two close-ups of the same screen, (3) the detail table sorted by a column
 * and (4) the raw data exports. Numbered marks on the images match the
 * numbered points beside them.
 *
 * Callout boxes are positioned in % of each image, measured on the capture
 * (CSS px; main crop x 240–1424, y 0–730 of a 1440-wide page).
 */

const r = integrations.reports;

type Box = { n: number; x: number; y: number; w: number; h: number; tag: string; side?: boolean };

// Main view (1184 × 730 CSS px).
const MAIN: Box[] = [
  { n: 1, x: 1.9, y: 14.5, w: 74.7, h: 7.4, tag: "Filters" },
  { n: 2, x: 83.4, y: 5.5, w: 15.5, h: 29.3, tag: "Export" },
];
// Phone crop of the same view (x 860–1424, y 0–280).
const PHONE: Box[] = [
  { n: 1, x: 3.2, y: 37.9, w: 46.8, h: 19.3, tag: "Filters" },
  { n: 2, x: 65.2, y: 14.3, w: 32.6, h: 76.4, tag: "Export" },
];
// Detail table close-up (x 900–1408, y 772–1066): the sorted Revenue column.
const SORT: Box[] = [{ n: 3, x: 48, y: 4.8, w: 17.7, h: 10.2, tag: "Sorted", side: true }];
// Raw data exports close-up (x 520–960, y 1092–1292): one dataset's four formats.
const RAW: Box[] = [{ n: 4, x: 46.5, y: 41.5, w: 50, h: 15.5, tag: "Every record", side: true }];

function Marks({ boxes }: { boxes: Box[] }) {
  return (
    <>
      {boxes.map((b) => (
        <span
          key={`${b.n}-${b.tag}`}
          className={`ap-rep__mark${b.side ? " ap-rep__mark--side" : ""}`}
          style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` } as React.CSSProperties}
          aria-hidden="true"
        >
          <b>{b.n}</b>
        </span>
      ))}
    </>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 1.8V5.3h3.5M6 8.5h4.5M6 11h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ReportsShowcase() {
  return (
    <div className="ap-rep" data-reveal="">
      <div className="ap-rep__head">
        <div>
          <span className="ap-rep__eyebrow">{r.eyebrow}</span>
          <h3 id="rep-title">
            {r.title} <span>{r.titleMuted}</span>
          </h3>
          <p>{r.body}</p>
        </div>
        <div className="ap-rep__formats">
          <span className="ap-rep__formatlabel">Download as</span>
          <ul aria-label="Export formats">
            {r.formats.map((f) => (
              <li key={f}>
                <FileIcon />
                {f}
              </li>
            ))}
          </ul>
          <p className="ap-rep__usewith">{r.useWith}</p>
        </div>
      </div>

      <div className="ap-rep__stage">
        <figure className="ap-rep__frame">
          <div className="ap-rep__chrome" aria-hidden="true">
            <span />
            <span />
            <span />
            <em>{r.url}</em>
            <strong className="ap-rep__badge">
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 8.4l2.8 2.7 6.2-6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {r.badge}
            </strong>
          </div>
          <div className="ap-rep__shot ap-rep__shot--main">
            <picture>
              <source media="(max-width: 640px)" type="image/webp" srcSet={r.main.phone} />
              <source type="image/webp" srcSet={`${r.main.src1200} 1200w, ${r.main.src} 2368w`} sizes="(max-width: 1184px) 100vw, 1136px" />
              <img src={r.main.src1200} alt={r.main.alt} width={r.main.width} height={r.main.height} loading="lazy" decoding="async" />
            </picture>
            <span className="ap-rep__marks ap-rep__marks--wide">
              <Marks boxes={MAIN} />
            </span>
            <span className="ap-rep__marks ap-rep__marks--phone">
              <Marks boxes={PHONE} />
            </span>
          </div>
        </figure>

        <div className="ap-rep__insets">
          <figure className="ap-rep__inset">
            <figcaption className="ap-rep__insetlabel">{r.sort.label}</figcaption>
            <div className="ap-rep__shot">
              <img src={r.sort.src} alt={r.sort.alt} width={r.sort.width} height={r.sort.height} loading="lazy" decoding="async" />
              <span className="ap-rep__marks">
                <Marks boxes={SORT} />
              </span>
            </div>
          </figure>
          <figure className="ap-rep__inset">
            <figcaption className="ap-rep__insetlabel">{r.raw.label}</figcaption>
            <div className="ap-rep__shot">
              <img src={r.raw.src} alt={r.raw.alt} width={r.raw.width} height={r.raw.height} loading="lazy" decoding="async" />
              <span className="ap-rep__marks">
                <Marks boxes={RAW} />
              </span>
            </div>
          </figure>
        </div>
      </div>

      <ol className="ap-rep__points">
        {r.points.map((p) => (
          <li key={p.n}>
            <b aria-hidden="true">{p.n}</b>
            <span>
              <strong>{p.title}</strong>
              {p.body}
            </span>
          </li>
        ))}
      </ol>
      <p className="ap-rep__note">{r.note}</p>
    </div>
  );
}
