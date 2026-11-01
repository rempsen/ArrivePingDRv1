/**
 * Extra section kinds for the comparison, alternatives and free-tool pages
 * (content/compare-more.ts, content/tools.ts). They render through the same
 * landing page component (pages/marketing/landing.tsx → components/GeoSections.tsx),
 * so these pages share its hero, answer box, sources, FAQs, related links and CTA.
 *
 * Text fields may contain [label](/path) links; nothing else is parsed.
 */
import type { Cell } from "./landing";

/** A real ArrivePing screenshot from public/img/site (never a mock-up). */
export type Shot = { src: string; w: number; h: number; alt: string; caption: string; phone?: boolean };

export type Pick = {
  name: string;
  /** ArrivePing's own card: listed first and highlighted. */
  ours?: boolean;
  facts: { label: string; value: Cell }[];
  chooseIf: string[];
  /** Our side-by-side page for this product, when there is one. */
  more?: { label: string; href: string };
};

export type GeoSection =
  | { kind: "tool"; id?: string; tool: "omw-text" | "no-show"; eyebrow?: string; title: string; body?: string }
  | { kind: "rich"; id?: string; eyebrow?: string; title: string; paragraphs: string[]; bullets?: string[]; ordered?: boolean }
  | { kind: "shots"; id?: string; eyebrow?: string; title: string; paragraphs?: string[]; shots: Shot[] }
  | {
      kind: "matrix";
      id?: string;
      eyebrow?: string;
      title: string;
      body?: string;
      /** First entry labels the row-header column ("Tool"). */
      columns: string[];
      rows: { label: string; ours?: boolean; cells: Cell[] }[];
      note?: string;
    }
  | { kind: "picks"; id?: string; eyebrow?: string; title: string; body?: string; items: Pick[] }
  | { kind: "cards"; id?: string; eyebrow?: string; title: string; body?: string; items: { title: string; body: string; href: string; cta: string }[] }
  | {
      kind: "examples";
      id?: string;
      eyebrow?: string;
      title: string;
      body?: string;
      groups: { title: string; items: { label: string; text: string }[] }[];
    }
  | { kind: "refs"; id?: string; title: string; body?: string; items: { label: string; href: string; note?: string }[] };
