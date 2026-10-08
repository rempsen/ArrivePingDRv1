import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";
import { todayInSiteZone } from "./site-date";

/**
 * The ArrivePing blog: Markdown files in src/web/site/blog/posts, compiled at
 * build time. No Markdown parser ships to the browser.
 *
 *   virtual:blog-index        → `posts` (metadata only, newest first) and
 *                               `bodyLoaders` (one lazy chunk per post body)
 *   virtual:blog-body/<slug>  → the rendered HTML of one post
 *   virtual:blog-bodies       → every body at once (used by the prerender only)
 *
 * Post files start with frontmatter, one `key: <JSON value>` per line:
 *   title, slug, description, date, updated, author, category, tags, image,
 *   imageAlt, legacyUrl (optional), draft (optional, true hides the post).
 */

const POSTS_DIR = "src/web/site/blog/posts";
const INDEX_ID = "virtual:blog-index";
const BODIES_ID = "virtual:blog-bodies";
const BODY_PREFIX = "virtual:blog-body/";

export type PostMeta = {
  title: string;
  slug: string;
  description: string;
  date: string;
  updated: string;
  author: string;
  category: string;
  tags: string[];
  image: string;
  imageAlt: string;
  legacyUrl?: string;
  words: number;
  readingMinutes: number;
  headings: { id: string; text: string }[];
};

type Post = { meta: PostMeta; html: string };

const REQUIRED = ["title", "slug", "description", "date", "updated", "author", "category"] as const;

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function render(markdown: string) {
  const headings: { id: string; text: string }[] = [];
  const used = new Set<string>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        const text = inner
          .replace(/<[^>]+>/g, "")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim();
        let id = slugify(text) || "section";
        while (used.has(id)) id += "-2";
        used.add(id);
        if (token.depth === 2) headings.push({ id, text });
        const level = Math.min(Math.max(token.depth, 2), 4);
        return `<h${level} id="${id}">${inner}</h${level}>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        const href = token.href.replace(/"/g, "&quot;");
        const external = /^https?:\/\//.test(token.href) && !/^https?:\/\/(www\.)?arriveping\.com/.test(token.href);
        const title = token.title ? ` title="${token.title.replace(/"/g, "&quot;")}"` : "";
        return external
          ? `<a href="${href}"${title} target="_blank" rel="noopener">${inner}</a>`
          : `<a href="${href.replace(/^https?:\/\/(www\.)?arriveping\.com/, "") || "/"}"${title}>${inner}</a>`;
      },
      image(token: Tokens.Image) {
        const alt = (token.text || "").replace(/"/g, "&quot;");
        return `<img src="${token.href}" alt="${alt}" loading="lazy" decoding="async">`;
      },
    },
  });
  // Wrap tables so they scroll on small screens instead of widening the page.
  const html = (md.parse(markdown) as string).replace(/<table>/g, '<div class="post__table"><table>').replace(/<\/table>/g, "</table></div>");
  return { html, headings };
}

function parse(file: string): Post {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(": ");
    if (i < 0) throw new Error(`${file}: bad frontmatter line "${line}"`);
    try {
      fm[line.slice(0, i).trim()] = JSON.parse(line.slice(i + 2));
    } catch {
      throw new Error(`${file}: frontmatter value for "${line.slice(0, i)}" must be JSON (quote strings)`);
    }
  }
  for (const k of REQUIRED) if (!fm[k]) throw new Error(`${file}: frontmatter "${k}" is required`);
  if (fm.slug !== path.basename(file, ".md")) throw new Error(`${file}: slug must match the file name`);
  const body = raw.slice(m[0].length);
  const { html, headings } = render(body);
  const words = body.replace(/[#*_>`[\]()!|-]/g, " ").split(/\s+/).filter(Boolean).length;
  const meta: PostMeta = {
    title: String(fm.title),
    slug: String(fm.slug),
    description: String(fm.description),
    date: String(fm.date),
    updated: String(fm.updated || fm.date),
    author: String(fm.author),
    category: String(fm.category),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    image: String(fm.image || ""),
    imageAlt: String(fm.imageAlt || ""),
    ...(fm.legacyUrl ? { legacyUrl: String(fm.legacyUrl) } : {}),
    words,
    readingMinutes: Math.max(1, Math.round(words / 230)),
    headings,
  };
  return { meta, html };
}

export function loadPosts(root: string): Post[] {
  const dir = path.resolve(root, POSTS_DIR);
  if (!fs.existsSync(dir)) return [];
  const today = todayInSiteZone();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const p = parse(path.join(dir, f));
      const draft = /\ndraft: true\n/.test(fs.readFileSync(path.join(dir, f), "utf8"));
      return { p, draft };
    })
    // Drafts and future-dated posts stay unpublished; a scheduled post goes live with the first build on or after
    // its date in America/Winnipeg (the same clock the sitemap uses for its lastmod ceiling).
    .filter(({ p, draft }) => !draft && p.meta.date <= today)
    .map(({ p }) => p)
    .sort((a, b) => (a.meta.date < b.meta.date ? 1 : a.meta.date > b.meta.date ? -1 : a.meta.slug.localeCompare(b.meta.slug)));
}

export default function blogPlugin(): Plugin {
  let root = process.cwd();
  let cache: Post[] | null = null;
  const posts = () => (cache ??= loadPosts(root));

  return {
    name: "arriveping-blog",
    configResolved(c) {
      root = c.root;
    },
    resolveId(id) {
      if (id === INDEX_ID || id === BODIES_ID || id.startsWith(BODY_PREFIX)) return `\0${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith("\0virtual:blog")) return null;
      const all = posts();
      if (id === `\0${INDEX_ID}`) {
        const loaders = all.map((p) => `  ${JSON.stringify(p.meta.slug)}: () => import(${JSON.stringify(BODY_PREFIX + p.meta.slug)}).then((m) => m.default),`);
        return `export const posts = ${JSON.stringify(all.map((p) => p.meta))};\nexport const bodyLoaders = {\n${loaders.join("\n")}\n};\n`;
      }
      if (id === `\0${BODIES_ID}`) {
        return `export default ${JSON.stringify(Object.fromEntries(all.map((p) => [p.meta.slug, p.html])))};\n`;
      }
      const slug = id.slice(`\0${BODY_PREFIX}`.length);
      const post = all.find((p) => p.meta.slug === slug);
      return `export default ${JSON.stringify(post?.html ?? "")};\n`;
    },
    configureServer(server: ViteDevServer) {
      const dir = path.resolve(root, POSTS_DIR);
      server.watcher.add(dir);
      const reload = (file: string) => {
        if (!file.startsWith(dir)) return;
        cache = null;
        for (const id of [INDEX_ID, BODIES_ID]) {
          const mod = server.moduleGraph.getModuleById(`\0${id}`);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
    },
  };
}
