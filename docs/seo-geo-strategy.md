# ArrivePing search and AI visibility strategy (SEO, GEO, AEO)

Status: Phase 1 implemented on branch `feat/seo-geo`, awaiting review · Researched 2026-10-07 · Owner: Dan Rosenblat

## 1. Goal

Make arriveping.com one of the easiest field service sites to find, and one of the most cited, across:

- classic search engines (Google, Bing);
- AI answer engines (ChatGPT search, Claude, Perplexity, Gemini, Google AI Overviews / AI Mode, Copilot).

The strategy covers four topic clusters: fleet management, field service management, construction and trade efficiency, and client communications.

## 2. What we found

### ArrivePing before this work

| Problem | Effect |
|---|---|
| The whole site was a client-rendered React app, served as an empty `<div id="root"></div>` (713 bytes) | GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot do not run JavaScript ([Vercel, Dec 2024](https://vercel.com/blog/the-rise-of-the-ai-crawler)). They saw only a title and meta description. |
| `/robots.txt`, `/sitemap.xml` and `/llms.txt` returned the app's HTML with status 200; every unknown URL also returned 200 | No robots file, no sitemap and no llms.txt existed, and every unknown URL was a soft 404. |
| The title "Arrivals your customers can count on" had no category words | Nothing told a crawler this is field service software. |
| Searches for "ArrivePing" are dominated by other brands: arrive.gg (a gaming lag-fix product), Arrive / ParkWhiz, Arrive Logistics and Arrive AI | We need explicit entity signals to separate the brand. |
| Only one indexable page | There was nothing to rank for any cluster query. |

### Competitors (checked 2026-10-07)

| | ServiceTitan | Jobber | Housecall Pro |
|---|---|---|---|
| Rendering | Prerendered (Gatsby) | Server-rendered (Next.js) | Server-rendered (WordPress) |
| AI crawlers in robots.txt | All named and allowed | All named and allowed, plus an `LLMs:` line | All allowed except Bytespider |
| llms.txt | 119 lines, entity summary | 129 lines, feature synonyms | 62 lines, entity block with intent-tagged links |
| Homepage JSON-LD | Organization, WebSite | None found | Organization, Product with ratings, more |
| Scale | ~4,000 URLs, ~1,800 blog posts, ~30 free calculators, vs and "alternatives" pages | 56 feature, 60 industry and 57 comparison pages, 121 free tools, 783 Academy articles | ~1,000 pages, a compare hub, ~40 industry pages, templates and calculators |
| Pricing | Not public ("Request Pricing") | Public, from $49/mo (Core, 1 user) | Public, from $59/mo annual / $79 monthly |
| Customer tracking link | Yes; needs device GPS and a URL token | Not described on the feature page | Tied to a $20/vehicle/mo GPS add-on |
| Auto-assignment by skill and location | Dispatch Pro (paid Pro product) | Not described | Not described |

### The gaps we can own

1. **The customer arrival experience** (on-my-way texts, live tracking link, ETA, "end the 4-hour window") is fragmented. It sits across Workiz, Glympse, Locate2u and FixyFlow, and no big FSM brand owns it. Each incumbent gates it behind hardware, add-ons or configuration.
2. **Auto-dispatch by proximity and skill at a small-business price.** Only ServiceTitan claims it, behind a premium add-on.
3. **Phone-based tracking with no hardware**, against Jobber's FleetSharp and Housecall Pro's OBD-II plug-in.
4. **Transparent graduated pricing**, against ServiceTitan's "Request Pricing" and per-user add-on fees elsewhere.
5. **Canada.** "Field service software Canada" results are dominated by directories (Capterra.ca, GetApp.ca). No big-three Canada page was found.
6. **AI-agent integration** (an MCP server for AI agents). We found no incumbent content on it.

### What actually drives AI recommendations

| Lever | What the evidence says | Strength of evidence |
|---|---|---|
| Server-rendered HTML | Non-rendering AI crawlers can only cite text that is in the HTML | Documented (Vercel) |
| Allowing OAI-SearchBot | Required for inclusion in ChatGPT search ([OpenAI](https://developers.openai.com/api/docs/bots)) | Documented |
| Branded web mentions | Correlate 0.664 with AI Overview visibility, versus 0.218 for backlinks ([Ahrefs, 75K brands](https://ahrefs.com/blog/ai-overview-brand-correlation/)) | Correlation only |
| Reddit, YouTube, LinkedIn, G2 | Among the most-cited domains across AI engines ([Peec AI, 30M sources](https://peec.ai/blog/top-domains-cited-by-ai-search-analysis-based-on-30m-sources)) | Independent study |
| Structured data | Google: no special schema is needed for AI features; keep it accurate and matching the visible text ([Google](https://developers.google.com/search/docs/appearance/ai-features)) | Documented |
| llms.txt | Google says Search doesn't use it ([guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)). No major AI vendor documents using it. All three competitors ship one. | Weak; cheap to ship anyway |
| IndexNow | Bing, Naver, Seznam and Yandex take part; Google does not ([indexnow.org](https://www.indexnow.org/)) | Documented |

## 3. Phase 1: implemented (branch `feat/seo-geo`)

### Technical foundation

- **Prerendering.** A Vite plugin (`packages/web/vite/plugins/prerender-plugin.ts`) renders every public page to static HTML at build time. Each page gets its own title, description, canonical, Open Graph tags and JSON-LD. The server (`src/site-server.ts`) serves these files first, and the browser boots the app on top.
- **Real files:**
  - `robots.txt`: names and allows 20 search and AI crawlers, blocks private app paths, and links the sitemap.
  - `sitemap.xml`: all 14 public pages.
  - `llms.txt`: an entity block plus a page list.
  - `llms-full.txt`: every page's answer and FAQs in one file.
- **Correct status codes:**
  - Unknown URLs return a real 404.
  - App routes (`/admin`, `/app`, `/rider`, `/t/…`, sign-in) carry `X-Robots-Tag: noindex`.
  - Trailing-slash and uppercase URLs 301 to the canonical form; `/index.html` 301s to `/`.
- **IndexNow:**
  - A key file is published, and the public URLs are submitted once per deploy.
  - Submission happens on the first request served on arriveping.com, so local and preview servers never submit.
- **Section links** now use `/#pricing` form, so they work from any page and without JavaScript.

### Metadata and labelling

- **Home title:** "ArrivePing: Field Service Software with Live Tech Tracking". The description names the trades, auto-dispatch, ETA texts and the $49 price.
- **Hero label:** "Field service software · Launching November 2026". This puts the category next to the H1 without changing the headline.
- **JSON-LD:**
  - Organization (NVC360, Winnipeg, MB, brand ArrivePing)
  - WebSite
  - SoftwareApplication (category, feature list, $49 USD Offer, iOS/Android/Web)
  - FAQPage (generated from the FAQs visible on each page)
  - BreadcrumbList
  - AboutPage
- **No ratings or reviews in schema** until real ones exist.
- **Brand disambiguation.** "ArrivePing by NVC360" appears throughout. The About page and llms.txt state there is no affiliation with Arrive, Arrive Logistics, Arrive AI or arrive.gg.

### New pages (11 new; 14 prerendered public pages in total)

| Cluster | Page | Main queries |
|---|---|---|
| Field service management | `/field-service-software` | field service management software, FSM for small HVAC business |
| Fleet management | `/fleet-tracking` | fleet tracking for service businesses, GPS tracking without hardware |
| Trade efficiency | `/dispatch-software` | auto-assign technicians by location and skill, dispatch software |
| Construction | `/construction-trades` | construction crew scheduling, geofence time clock, multi-site crews |
| Client communications | `/customer-notifications` | on-my-way text, technician tracking link, ETA texts |
| Commercial | `/pricing` | ArrivePing pricing, affordable field service software |
| Comparison | `/compare` and `/compare/{jobber,housecall-pro,servicetitan}` | Jobber / Housecall Pro / ServiceTitan alternatives, "X vs Y" |
| Entity | `/about` | who makes ArrivePing |

Every page follows the same answer-engine pattern:

- A question-form H2 with a 50–80 word quotable answer near the top.
- Feature and step sections with H3s.
- Visible FAQs, which feed the FAQPage schema.
- Related-page links.
- The demo form.

Comparison pages also carry:

- A dated, sourced side-by-side table.
- An honest "choose them if" column.
- A sources list.

## 4. Phase 2: next 30–60 days

1. **Register and verify** (needs your logins):
   - Google Search Console and Bing Webmaster Tools; submit `https://arriveping.com/sitemap.xml`.
   - Bing also feeds Copilot and DuckDuckGo, and is widely reported to power ChatGPT search.
2. **Decide the nvc360.com ↔ arriveping.com relationship.** nvc360.com is a separate server-rendered site with its own SoftwareApplication schema. Either:
   - point product traffic to arriveping.com with clear cross-links, or
   - 301 the overlapping product pages.

   Two domains competing for the same queries split authority.
3. **Free tools.** This is the incumbents' strongest link and citation magnet:
   - an on-my-way text template generator;
   - a "cost of a 4-hour service window" / missed-appointment calculator;
   - a technician drive-time cost calculator.
4. **Trade pages** for HVAC, plumbing, electrical, property maintenance and delivery. Each needs trade-specific content, not swapped nouns.
5. **A Canada page.** Use only verified facts. Confirm where production data is hosted before claiming Canadian data residency.
6. **"Alternatives" articles:**
   - "Jobber alternatives with live tracking"
   - "Housecall Pro alternatives without GPS hardware"
   - "ServiceTitan alternatives for small business"

   Include ArrivePing honestly, alongside others.
7. **Developer / AI-agent page:** the MCP server, webhooks, Zapier and Make, with real examples. No incumbent owns this yet.

## 5. Phase 3: off-site (what AI engines actually cite)

1. **Review profiles before launch:**
   - G2, Capterra / GetApp / Software Advice, including the .ca directories.
   - After launch, invite founding customers to leave real reviews. Never seed them.
2. **Listicle inclusion.** Pitch the publishers that surface for buyer questions (toolsforhumans.ai, fieldservicesoftware.io, contractorplus-style "alternatives" lists) with a short, factual fact sheet (`/llms-full.txt` is a ready source).
3. **YouTube:**
   - 3–5 short demos: the live tracking page, auto-dispatch, and the setup agent building a workspace in under an hour.
   - Titles that match the buyer questions.
4. **Reddit and trade communities.** Founder participation in r/HVAC, r/Plumbing and r/sweatystartup where it's genuinely useful, disclosed, and never astroturfed.
5. **Launch moments:**
   - a Product Hunt launch in November 2026;
   - local Winnipeg / Manitoba tech press;
   - trade association directories (HRAI, MCA, CHBA-MB).

## 6. Measurement

| What | How | Cadence |
|---|---|---|
| Indexing and queries | Google Search Console and Bing Webmaster: impressions and clicks by page and query | Weekly |
| AI visibility | Run 20 fixed buyer prompts in ChatGPT, Claude, Perplexity, Gemini and Google AI Mode; log whether ArrivePing is mentioned, cited or linked | Monthly |
| Crawler access | Server logs for GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot hitting `/_pages` routes | Monthly |
| Technical regressions | The build fails if any prerendered page lacks an H1. Re-check robots, sitemap and status codes after each deploy | Each deploy |
| Competitor facts | Re-verify comparison tables (prices change; Housecall Pro was running promos) | Quarterly, or before any campaign |

Options for automating the AI-visibility audit, starting with the cheapest:

1. A monthly scheduled Claude task that runs the prompts and writes a scorecard.
2. A dedicated tracker (Peec AI, Profound, Ahrefs Brand Radar). Pricing was not verified this session.

## 7. Open decisions for Dan

1. Approve the comparison pages for publication. They name competitors with sourced, dated facts, so a quick legal read is sensible.
2. nvc360.com versus arriveping.com: consolidate or cross-link?
3. Where production customer data is hosted (needed before any "Canadian data" claim).
4. Who owns the review-site profiles and the monthly AI-visibility audit.

## Sources

- ServiceTitan: [robots.txt](https://www.servicetitan.com/robots.txt), [llms.txt](https://www.servicetitan.com/llms.txt), [pricing](https://www.servicetitan.com/pricing), [Dispatch Pro](https://www.servicetitan.com/features/pro/dispatch), [Fleet Pro](https://www.servicetitan.com/features/pro/fleet), [notifications help](https://help.servicetitan.com/docs/enable-text-and-email-dispatch-notifications)
- Jobber: [robots.txt](https://www.getjobber.com/robots.txt), [llms.txt](https://www.getjobber.com/llms.txt), [pricing](https://www.getjobber.com/pricing/), [GPS tracking](https://www.getjobber.com/features/gps-tracking-app/), [customer communication](https://www.getjobber.com/features/customer-communication-management/), [scheduling](https://www.getjobber.com/features/scheduling/)
- Housecall Pro: [robots.txt](https://www.housecallpro.com/robots.txt), [llms.txt](https://www.housecallpro.com/llms.txt), [pricing](https://www.housecallpro.com/pricing/), [vehicle GPS](https://www.housecallpro.com/features/vehicle-gps-tracking/), [dispatching](https://www.housecallpro.com/features/dispatching-software/)
- Others: [Workiz on-my-way](https://www.workiz.com/features/on-my-way/), [FixyFlow](https://fixyflow.com/)
- GEO evidence: [Vercel: AI crawlers and JavaScript](https://vercel.com/blog/the-rise-of-the-ai-crawler), [Google AI features](https://developers.google.com/search/docs/appearance/ai-features), [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [OpenAI crawlers](https://developers.openai.com/api/docs/bots), [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-the-web-and-how-can-site-owners-block-the-crawler), [IndexNow](https://www.indexnow.org/), [Peec AI citation study](https://peec.ai/blog/top-domains-cited-by-ai-search-analysis-based-on-30m-sources), [Ahrefs brand-mention correlation](https://ahrefs.com/blog/ai-overview-brand-correlation/)
