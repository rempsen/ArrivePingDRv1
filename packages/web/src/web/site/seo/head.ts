/**
 * Page <head> for the public pages.
 *
 *  - `headTags()` returns the HTML string the prerender step writes into each
 *    page's <head> (what crawlers and AI agents read).
 *  - `usePageMeta()` keeps the same tags correct when a visitor moves between
 *    pages inside the single-page app.
 */
import { useEffect } from "react";
import { brand } from "../config";
import { absolute, SITE_URL } from "./schema";
import { seoByPath, type SeoPage } from "./pages";

const OG_IMAGE = `${SITE_URL}/og-image.png`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON for a <script> body: escape "<" so "</script>" can never close the tag early. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

type Tag = { kind: "meta-name" | "meta-prop" | "link"; key: string; value: string };

function tagsFor(p: SeoPage): Tag[] {
  const url = absolute(p.path);
  return [
    { kind: "meta-name", key: "description", value: p.description },
    { kind: "meta-name", key: "robots", value: "index, follow, max-image-preview:large, max-snippet:-1" },
    { kind: "link", key: "canonical", value: url },
    { kind: "meta-prop", key: "og:site_name", value: brand.lockup },
    { kind: "meta-prop", key: "og:locale", value: "en_US" },
    { kind: "meta-prop", key: "og:type", value: p.ogType },
    { kind: "meta-prop", key: "og:title", value: p.title },
    { kind: "meta-prop", key: "og:description", value: p.description },
    { kind: "meta-prop", key: "og:url", value: url },
    { kind: "meta-prop", key: "og:image", value: OG_IMAGE },
    { kind: "meta-prop", key: "og:image:width", value: "1200" },
    { kind: "meta-prop", key: "og:image:height", value: "630" },
    { kind: "meta-prop", key: "og:image:alt", value: "ArrivePing: live technician tracking and customer ETAs" },
    { kind: "meta-name", key: "twitter:card", value: "summary_large_image" },
    { kind: "meta-name", key: "twitter:title", value: p.title },
    { kind: "meta-name", key: "twitter:description", value: p.description },
    { kind: "meta-name", key: "twitter:image", value: OG_IMAGE },
  ];
}

export function headTags(p: SeoPage): string {
  const lines = [`<title>${esc(p.title)}</title>`];
  for (const t of tagsFor(p)) {
    if (t.kind === "link") lines.push(`<link rel="${t.key}" href="${esc(t.value)}" />`);
    else lines.push(`<meta ${t.kind === "meta-prop" ? "property" : "name"}="${t.key}" content="${esc(t.value)}" />`);
  }
  lines.push(`<script type="application/ld+json" id="ap-jsonld">${scriptJson(p.jsonLd)}</script>`);
  return lines.join("\n\t\t");
}

function upsert(t: Tag) {
  const sel =
    t.kind === "link" ? `link[rel="${t.key}"]` : t.kind === "meta-prop" ? `meta[property="${t.key}"]` : `meta[name="${t.key}"]`;
  let el = document.head.querySelector<HTMLElement>(sel);
  if (!el) {
    el = document.createElement(t.kind === "link" ? "link" : "meta");
    if (t.kind === "link") el.setAttribute("rel", t.key);
    else el.setAttribute(t.kind === "meta-prop" ? "property" : "name", t.key);
    document.head.appendChild(el);
  }
  el.setAttribute(t.kind === "link" ? "href" : "content", t.value);
}

/** Keep title, description, canonical, Open Graph and JSON-LD in step with the current public page. */
export function usePageMeta(path: string) {
  useEffect(() => {
    const p = seoByPath[path];
    if (!p) return;
    document.title = p.title;
    for (const t of tagsFor(p)) upsert(t);
    let ld = document.getElementById("ap-jsonld");
    if (!ld) {
      ld = document.createElement("script");
      ld.id = "ap-jsonld";
      ld.setAttribute("type", "application/ld+json");
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify(p.jsonLd);
  }, [path]);
}
