/**
 * Shared shape for the public legal documents (Privacy Policy, Terms).
 *
 * Content is plain data so the two pages share one renderer. Paragraph text
 * may contain `[label](href)` links; `mailto:` and site-relative hrefs both work.
 */
export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "note"; title: string; text: string };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  /** Short label above the title, e.g. "Legal". */
  eyebrow: string;
  title: string;
  /** Human-readable date, e.g. "October 2, 2026". */
  updated: string;
  /** Opening paragraph(s) before the numbered sections. */
  intro: string[];
  sections: LegalSection[];
  /** Canonical path, used for the <link rel="canonical"> and the document title. */
  path: "/privacy" | "/terms";
}
