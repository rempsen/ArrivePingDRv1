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

### Cover images

The first three covers in this format were too alike: same angle, same warm golden-hour palette, same person-holding-a-phone-on-the-left composition, and a visibly AI-generated look. Rules from 2026-10-15:

- **Photorealistic model.** Use a model chosen for photorealism (in the ElevenLabs image tools: `bytedance-seedream-5-pro`, or `flux-2-pro`), not the general default. Prompt for an editorial photograph: named camera and lens, natural grain, imperfect framing, no rendered text on screens, no logos.
- **Vary every cover against the log below.** Before generating, read the log and change at least four of: subject (person vs. no person; gender; age; role: technician, driver, dispatcher, homeowner), which hand holds the phone (or no phone), setting (kitchen, porch, construction site, warehouse dock, truck cab, dispatch office, driveway, apartment lobby), time and light (dawn, overcast, noon, rain, night under streetlights, fluorescent office), palette and grade (cool, neutral, desaturated, high-contrast black and white, film-stock looks), camera angle (over-shoulder, wide, from the van, from the doorway, overhead), and composition direction (subject on the right, centred, in the background).
- **Not every cover has a phone.** A van at a loading dock, a dispatcher's screen, a technician's hands on a furnace, a row of trucks at dawn all say "arrival" without repeating the phone shot.
- **Log each cover here** when the post merges, so the next one is forced to differ.

| Post | Subject | Phone hand | Setting | Light / grade | Angle |
|---|---|---|---|---|---|
| preferred-provider | woman, homeowner | right (device in bg) | front door, van arriving | dusk, warm | wide |
| no-call-no-show (replaced 2026-10-18) | man 20s–30s, contractor in hard hat and hi-vis vest, clipboard; real Pexels photo | none (real "Your technician has arrived!" card overlaid, lower right) | home's front doorway, white siding | bright daylight, neutral | eye level from the porch, subject centre-right |
| last-mile | woman 30s, homeowner | right | front porch, van on street | golden hour, warm | over-shoulder from left |
| phone-vs-vehicle-gps-tracking | woman 30s, technician | left (into dash mount) | van cab, residential street | rainy overcast, cool desaturated | through open passenger door, subject right |
| field-service-software-cost | no person: rows of hi-vis vests and hard hats on a rack; real Pexels photo (inline: an office user at a warehouse desk; an aerial grid of vans) | none | equipment room, indoors | dark interior, hard artificial light, high-contrast orange and blue | eye level, straight on, symmetrical |
| field-service-software-for-small-business | man 40s–50s, HVAC technician in blue T-shirt, glasses and face mask, reading manifold gauges; real Pexels photo, shirt print and maker's badge painted out | none | rooftop condenser, trees and satellite dish behind | overcast daylight, slightly desaturated teal | eye level, subject left |
| base-hit-software-small-business | no person: an open laptop on a worn workbench in a small workshop (drawer, drill, calipers, safety glasses); real Pexels photo, handwritten note and drill maker's name painted out | none | small workshop, indoors | soft window light, muted warm-neutral, shallow depth of field | slightly high, three-quarter from the left, subject centre-right |
| software-adoption-cost-and-complexity | woman late 30s, electrician in grey work shirt and yellow hard hat, wire strippers at her side; generated (Seedream 5 Pro), cropped from a wider frame | none | commercial construction interior: steel studs, open electrical panel, stacked drywall | overcast daylight plus portable LED work light, neutral-cool, desaturated, high contrast | eye level, 28mm wide, subject left of centre in profile, panel centre |

Next cover must avoid: golden hour, warm grade, homeowner holding a phone in the right hand, over-shoulder-from-left, another front door or porch (three covers are at the door), another still life of gear with no person (field-service-software-cost), another rooftop or HVAC equipment shot (field-service-software-for-small-business), another empty workbench or laptop-on-a-desk shot (base-hit-software-small-business), and another construction-site electrician or open panel (software-adoption-cost-and-complexity). Good next options: a dispatch office with a real screen, night under streetlights, an overhead or drone view of a fleet, a plumber indoors, a delivery crew at a loading dock.

The blog index has many covers built from app mock-ups on a dark gradient with a big statistic, and several AI-generated people holding phones. Prefer real photographs that show the reader's world from a new angle (the gear, the office, the fleet, the job) over another rendered screen.

Real stock photos are fine instead of a generated image: Pexels (Pexels License: free for commercial use, edits allowed) is what the site already uses. Credit the photographer and photo URL in an HTML comment at the top of the post, and paint out house numbers, street signs and brand logos. Combining a photo with a real app screenshot works well, shown as a floating card rather than faked into someone's hand.

## Why the format works, and what to add (researched 2026-10-17)

The evidence behind the standard format, and four habits the research says to add. Strategy-level and technical work lives in `docs/seo-geo-strategy.md`.

**What the evidence says**

| Finding | Source | What it means for a post |
|---|---|---|
| Adding quotations (+41%), statistics (+31%) and cited sources (+28%) raised a page's visibility in generative-engine answers; keyword stuffing lowered it (−8%). Sources ranked 5th in search gained the most: +115% from citing sources, while the top-ranked source lost ground | [Aggarwal et al., "GEO: Generative Engine Optimization", KDD 2024](https://arxiv.org/abs/2311.09735) | A new, low-authority site benefits most from cited, quotable writing. Keep every number sourced, and quote the primary source's own words where they are short and strong |
| Only 38% of pages cited in Google AI Overviews also rank in the top 10 for that query (863,000 keywords, early 2026), down from 76% in July 2025 | [Ahrefs via Search Engine Journal, 2026](https://www.searchenginejournal.com/google-ai-overview-citations-from-top-ranking-pages-drop-sharply/568637/) | A post can be cited before it ranks. Write for the exact sub-question an assistant fans out to, not only the head term |
| AI Mode and AI Overviews use "query fan-out": several related searches across subtopics, which surfaces a wider set of pages | [Google Search Central](https://developers.google.com/search/docs/appearance/ai-features) | One specific question per post, with H2s phrased as the follow-up questions |
| 28.3% of the 1,000 pages ChatGPT cited most had no organic keywords at all; educational pages were 19.4% of citations, blog posts 1.9% | [Ahrefs, Oct 2025](https://ahrefs.com/blog/chatgpts-most-cited-pages/) | Write reference pages (definitions, comparisons, how-tos), not company news |
| 75% of pages cited by ChatGPT, Gemini and Perplexity were updated within the past year; 28% of "fresh" pages were older posts that had been refreshed | [Seer Interactive, July 2026](https://www.seerinteractive.com/insights/study-content-recencys-impact-on-ai-visibility-in-2026) | Re-check figures and bump `updated` when a post is genuinely revised; never bump it without a change |
| Branded web mentions (0.66–0.71) and YouTube mentions (~0.74) correlate with AI visibility far more than backlinks or Domain Rating (≤0.33), across 75,000 brands | [Ahrefs, Dec 2025](https://ahrefs.com/blog/ai-brand-visibility-correlations/) | Correlation, not proof. Off-site mentions matter most for a new brand, so write posts others will quote, and say "ArrivePing by NVC360" plainly |
| Google: no special schema or AI file is needed; "unique, non-commodity content" for visitors is the foundation | [Google Search Central](https://developers.google.com/search/docs/appearance/ai-features); [John Mueller, May 2025](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search) | Information gain beats volume. Every post needs something the other ten results don't have |
| Microsoft Bing: descriptive headings, Q&A, tables, one-to-two-sentence self-contained answers; don't hide answers in tabs, images or PDFs | [Microsoft, Oct 2025](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers) | Matches our format; add a comparison table where a choice is being made |

**Add to every post from now on**

1. **A comparison or decision table** whenever the reader is choosing between options.
2. **One or two short direct quotes** from a primary source (a regulator, a study), in quotation marks, attributed in the sentence.
3. **An entity line** in "How ArrivePing does this": "ArrivePing is field service software made by NVC360 in Winnipeg, Manitoba," plus the origin fact from `/about` where it fits. It separates the brand from Arrive, Arrive Logistics and arrive.gg.
4. **A "when not to choose us" paragraph.** Honest limits make the page safer to cite and match the comparison pages.

**Topic selection for a new brand:** pick buyer questions where ArrivePing's real differentiators are the answer (phone-based tracking, auto-dispatch by distance and skill, the customer tracking page, Canada), rather than another "Uber effect" or 4-hour-window post.

Checks before a pull request is opened:

- `description` is 120–158 characters. Count it with code, not by eye.
- Every number in the body has an inline link, and every link appears in Sources.
- No competitor is characterised beyond what its own public materials say.
- `bun run build` passes and `bun run seo:check` reports the new URL.
- The cover differs from the log above on at least four variables, and the log row for the new post is added.
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
