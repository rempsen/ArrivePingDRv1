# Publishing on the ArrivePing blog

The blog lives at https://arriveping.com/blog.

Each post is one Markdown file in `packages/web/src/web/site/blog/posts/`. When the site is built, each post becomes a prerendered page, and the build updates:

- `/blog/rss.xml`
- the sitemap
- `llms.txt`
- the post's structured data (BlogPosting and breadcrumbs)

## Add a post

1. Create `packages/web/src/web/site/blog/posts/<slug>.md`. The file name must equal the slug: lowercase words joined by hyphens.
2. Start the file with this frontmatter. Each line is `key: <JSON value>`, so strings need double quotes:

   ```
   ---
   title: "How to Write an On-My-Way Text Customers Actually Read"
   slug: "how-to-write-an-on-my-way-text"
   description: "120–158 characters: what the reader learns, in plain words."
   date: "2026-10-08"
   updated: "2026-10-08"
   author: "Dan Rosenblat"
   category: "customer-communication"
   tags: ["on-my-way texts", "customer experience", "hvac"]
   image: "/blog/img/how-to-write-an-on-my-way-text-0.webp"
   imageAlt: "A homeowner reading an arrival text on her phone at the front door"
   ---
   ```

3. Write the body in Markdown:
   - Start with `##` headings. The title is the page's only H1.
   - Three or more `##` headings add an "On this page" menu.
4. Put images in `packages/web/public/blog/img/`:
   - WebP format, about 1600 px wide, 16:9 for the cover.
   - Leave `image` empty (`""`) to use the category-coloured cover instead.
5. Commit, push, then `git pull` and publish as usual.

Category must be one of:

- `customer-communication`
- `dispatch-scheduling`
- `technician-tracking`
- `construction`
- `ai-operations`
- `growth`

Two optional frontmatter lines control publishing:

| Line | Effect |
|---|---|
| `draft: true` | Keeps the file out of the build |
| A future `date` | Hides the post until the first build on or after that date |

## House rules (what gets cited by Google and AI assistants)

- **Answer first.** Put a 2–3 sentence direct answer near the top, then the detail. Phrase headings the way people search: "How do I…", "What does … cost".
- **Every number has a source.** Use an inline link to the original study, not to a blog that quotes it. Leave out "internal data" and unsourced percentages.
- **Product claims match the product today.** Check the claim list in `packages/web/src/web/site/content/landing.ts`. Never claim customers, results or features we don't have.
- **Internal links:**
  - 2–3 per post to the matching product page: `/customer-notifications`, `/dispatch-software`, `/fleet-tracking`, `/construction-trades`, `/field-service-software`, `/pricing`, `/compare`.
  - 1–2 links to related posts.
- **One topic per post.** Many older posts cover the same ground, such as the "Uber effect" and the 4-hour window. New posts should go deeper on a specific question rather than repeat those.
- **No stock phrases** ("in today's fast-paced world", "game-changer", "unlock"). Write like an operator who has run crews.

## The standard format (approved 2026-10-09)

The reference post is `preferred-provider-lower-customer-acquisition-cost.md`. Every new post follows its shape so Google and AI assistants (ChatGPT, Claude, Perplexity, Gemini, Grok) can treat the blog as a source of truth:

1. **Opening answer** (2–3 sentences, no heading): the claim the post proves, with the single strongest statistic and its source link.
2. **Evidence sections** (`##`): each section makes one point and backs it with 2–5 cited figures. Name the source in the sentence ("Bain & Company found…"), link the original report, and give the year. If a figure is widely repeated but the original is weak or unverifiable, say so in the text rather than quietly dropping the caveat.
3. **A sourced chart or stats graphic** where the numbers support one: WebP in `public/blog/img/`, each figure labelled with its source, and an `alt` text that states the figures (AI crawlers read alt text, not pixels).
4. **Playbook**: a numbered, do-this-next list the reader can act on this week.
5. **How ArrivePing does this**: one short section with 2–3 product links. Claims come from `landing.ts` only.
6. **FAQ** (`## FAQ`): 3–5 questions phrased the way people ask assistants, each with a 2–4 sentence answer that stands on its own. The build emits these as FAQPage structured data.
7. **Sources** (`## Sources`): a numbered list of every source cited, title, publisher, year and link. Prefer primary sources (the study, the regulator, the vendor's own report) over articles that quote them.

Checks before a pull request is opened:

- `description` is 120–158 characters. Count it with code, not by eye.
- Every number in the body has an inline link, and every link appears in Sources.
- No competitor is characterised beyond what its own public materials say.
- `bun run build` passes and `bun run seo:check` reports the new URL.
- Codex review comments are addressed with a pushed commit before replying to them.

## Daily publishing (proposed)

Publishing still needs a deploy (`git pull` + publish), so the practical daily loop is:

1. **Plan.** Build a 60-day topic calendar from the keyword list in `docs/seo-geo-strategy.md`, with one question per post.
2. **Draft.** A scheduled Claude task drafts the next post each morning to these rules, with sources linked, and opens a pull request.
3. **Approve.** You or Gregor approve or edit the pull request on your phone. Merging it is the approval.
4. **Publish.** Publish once a day. Posts can also be written ahead with future `date`s and go live with the next publish on or after that date.

If daily deploys become a burden, the next step is moving posts into the database with an editor in the admin console, so publishing doesn't need a deploy.

## Moving from nvc360.com

`docs/nvc360-blog-redirects.csv` maps every old nvc360.com post URL to its new ArrivePing URL with a 301. It's ready to import into the WordPress **Redirection** plugin: Tools → Redirection → Import/Export.

Do this the same day the blog goes live on ArrivePing. Until then, the same articles exist on both domains, and Google may keep treating the nvc360.com copies as the originals.
