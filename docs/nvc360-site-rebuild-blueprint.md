# Blueprint: NVC360 corporate site rebuild ("nvc360.com v2")

Status: Proposed, awaiting Dan's review · 2026-10-07 · Tier: Standard blueprint

## 1. Recommendation

**Leading option:** rebuild nvc360.com off WordPress.

- **Build:** a static, prerendered **Astro 7** site, using ArrivePing's design tokens and motion components.
- **Hosting:** **Cloudflare Pages** on the free plan, deploying automatically on every push to GitHub.
- **DNS:** moves from GoDaddy to Cloudflare (free). The Google Workspace email records are carried over exactly.
- **Forms:** HubSpot (portal 342390247), so leads keep landing in HubSpot.
- **Analytics:** GA4 (G-9XF378BTGD) stays.
- **Running cost:** $0/month, plus a saving once the GoDaddy WordPress plan is cancelled.

**Alternatives:**

| Option | Choose it instead when | Cost |
|---|---|---|
| Vercel Pro hosting | You'd rather not move DNS. Vercel takes an apex A record at GoDaddy, and Claude can deploy through the connected Vercel connector. | $20/month per developer seat (Hobby is non-commercial only) |
| New WordPress block theme on GoDaddy | Staff need to edit pages themselves. Ruled out: Dan chose "Claude edits on request". | Current GoDaddy plan |

**Rejected:**

- **Netlify Free:** credit-capped. The site pauses when credits run out, which is unacceptable for a corporate site.
- **Serving nvc360.com from the ArrivePing app:** couples the corporate site to app deploys and outages.

## 2. Decision record

**Context.** The current site has 6 pages (home, blog, onboarding questionnaire, support, privacy, terms) on a custom WordPress theme at GoDaddy. Plugins: HubSpot, WPForms, Beta Leads, Site Kit, Yoast, WP Mail SMTP. It markets NVC360 as field service software, which ArrivePing now owns.

NVC360's new role is the parent company: AI software solutions (tooling and automations), custom AI and enterprise software development, and consulting (NCS). ArrivePing is its first commercial product.

Decisions confirmed by Dan:

- Rebuild off WordPress.
- Claude edits content on request.
- Keep the Support page and HubSpot tracking and forms.
- Proof is shown as anonymized examples.

**Options scored** (gates first, then weighted):

| | Astro + Cloudflare Pages | Vercel Pro | WP block theme |
|---|---|---|---|
| Gates: cost, commercial use, reachable by Claude | Pass ($0, commercial OK) | Pass ($20/mo) | Pass |
| Fit: same design system as ArrivePing | High (shared tokens and React islands) | High | Medium (rebuild in PHP/blocks) |
| SEO/GEO: real HTML, schema, llms.txt | High | High | Medium (plugin-dependent) |
| Upkeep: updates, security, plugins | Very low (static) | Very low | High (core, theme and plugin updates) |
| Claude can ship changes end to end | Yes (git push → auto deploy) | Yes | Partly (needs WP access and file access) |
| Switching risk | DNS move (email records) | Lowest | None |

**Consequences:**

- No WordPress to patch.
- Every page is plain HTML that AI crawlers can read.
- Text edits go through Claude.
- A one-time DNS move, done with a record-by-record checklist.
- WPForms, Beta Leads and the WordPress support search lose their home:
  - Forms move to HubSpot.
  - The product support centre moves to arriveping.com, where product support belongs.

## 3. Outcome, constraints, assumptions

**Outcome.** nvc360.com clearly reads as the parent company, says what NVC360 sells, and sends product buyers to ArrivePing.

The services are:

- AI software tooling and automations
- Custom AI solutions and enterprise software
- Consulting
- Software development

**Success criteria:**

- Every page is prerendered and scores 95+ on Lighthouse SEO.
- Organization schema links NVC360 to ArrivePing in both directions.
- Contact and support forms create HubSpot contacts.
- Email delivery is unaffected through the DNS move.
- All old URLs redirect (none return 404).

**Stated:**

- Same look and feel as ArrivePing.
- National Interiors history: sold 2021; NVC360 founded late 2023; ArrivePing is the first commercial product.
- Anonymized examples only.

**Assumed (to confirm):**

- The services can be described with these four headings.
- The team page shows Dan only until others approve.
- The onboarding questionnaire is retired. Its URL redirects to /contact, and ArrivePing signups use arriveping.com/get-started.

## 4. Architecture

```
GitHub repo (rempsen/nvc360-site)
  └─ push to main ──► Cloudflare Pages build (astro build)
                        └─ static HTML + assets ──► nvc360.com (Cloudflare edge)
Browser ─► HubSpot embed form ─► HubSpot CRM (portal 342390247) ─► email to team
Browser ─► GA4 + HubSpot tracking script
Old URLs ─► public/_redirects (301) ─► arriveping.com/blog/... or new pages
```

**Site map:**

| Page | Purpose |
|---|---|
| `/` | Parent positioning, the four offerings, ArrivePing feature band, how we work, anonymized results, origin story, contact |
| `/ai-automation` | AI software tooling and automations |
| `/custom-software` | Custom AI solutions and finished enterprise applications |
| `/consulting` | AI and operations consulting (NCS) |
| `/products` | ArrivePing, with room for future products |
| `/work` | Anonymized examples |
| `/about` | Story and team |
| `/contact` | HubSpot form |
| `/support` | Routes ArrivePing customers to ArrivePing support; clients to a form or support@nvc360.com |
| `/privacy`, `/terms` | Migrated |

**Search and AI readability** (same pattern as arriveping.com):

- Per-page metadata.
- JSON-LD: Organization with `@id https://nvc360.com/#organization`, Brand and Product → ArrivePing, Service per offering.
- sitemap, robots.txt (AI crawlers allowed), llms.txt.
- IndexNow.

## 5. Integrations and scaffolding

**Integrations:**

| Service | Purpose / note |
|---|---|
| HubSpot embed (forms + tracking) | Leads land in HubSpot |
| GA4 | Analytics continue |
| Cloudflare Pages Git integration | Dan connects GitHub once |
| Cloudflare DNS | Import all GoDaddy records; verify MX, SPF, DKIM and DMARC before switching nameservers |

**Repo layout:**

```
nvc360-site/
  astro.config.mjs        # site, sitemap, react integration
  src/styles/tokens.css   # shared with ArrivePing (ink, cyan, Inter/Manrope)
  src/components/         # Header, Footer, ServiceCard, ProductBand (React island), CaseCard, HubSpotForm
  src/content/            # pages and examples as Markdown/MDX (content collections)
  src/pages/              # index, ai-automation, custom-software, consulting, products, work, about, contact, support, privacy, terms
  public/_redirects       # 301 map: old WP URLs + 42 blog posts → arriveping.com
  public/llms.txt, robots.txt
```

## 6. Implementation steps

1. **Design.** 2–3 homepage directions on the Canvas; Dan picks one.
2. **Content.** Write services, anonymized examples and About copy. Dan approves the claims.
3. **Build.** Create the repo and build the Astro site, with a preview at the `*.pages.dev` address.
4. **Forms.** Create HubSpot forms (contact, support) and embed them.
5. **Redirects.** Write the redirect map and the search/AI files (sitemap, robots.txt, llms.txt).
6. **DNS preparation.** Add nvc360.com to Cloudflare. Compare every imported record against GoDaddy, especially MX, SPF, DKIM, DMARC and Google site-verification.
7. **Cutover.** Switch nameservers at GoDaddy, attach the domain to Pages, and check email both ways.
8. **Post-launch.** Search Console (sitemap, URL inspection), then cancel GoDaddy WordPress hosting after 2 weeks.

## 7. Acceptance criteria, risks, open dependencies

**Acceptance:**

- All pages are reachable with 200 status.
- The old URLs return 301 redirects.
- A form test lands in HubSpot.
- Test emails in and out succeed after the cutover.
- Rich Results test passes.
- llms.txt and sitemap.xml are live.

**Risks:**

| Risk | Mitigation |
|---|---|
| Email disruption from a missed DNS record | Record-by-record checklist; switch at a quiet time; GoDaddy records kept for rollback |
| Overclaiming services | Every claim approved by Dan; examples anonymized and accurate |
| HubSpot form styling | Use HubSpot's raw-HTML form option and site CSS |

**Dependencies (Dan):**

- Create an empty GitHub repo, or approve Claude creating it.
- Create a free Cloudflare account and connect GitHub.
- Have GoDaddy access available on cutover day.
- Confirm the HubSpot form recipients.
- Supply 3–5 anonymized project summaries.

## 8. Evidence appendix

**Documented, checked 2026-10-07:**

- Cloudflare Pages free plan: 500 builds/month, 100 projects, 100 custom domains per project. An apex domain requires Cloudflare nameservers; subdomains can CNAME from external DNS. https://developers.cloudflare.com/pages/platform/limits/ · https://developers.cloudflare.com/pages/configuration/custom-domains/
- Vercel Hobby is "non-commercial, personal use only"; Pro developer seats cost $20/user/month. https://vercel.com/docs/plans/hobby
- Netlify Free: 300 credits/month with hard limits, and sites pause when reached. Personal plan is $9/month. https://www.netlify.com/pricing/

**Observed:**

- Current site:
  - Pages from the WP REST API; theme `nvc360-theme`.
  - HubSpot portal 342390247 and GA4 G-9XF378BTGD, from the page source.
  - DNS at GoDaddy (domaincontrol.com), with MX on Google Workspace.
- npm registry, 2026-10-07: astro 7.3.7, @astrojs/react 7.0.1, @astrojs/sitemap 3.7.4.

**Practitioner signal (Announced):** an "agent-readiness" audit pattern of buyer prompts plus llms.txt, schema, pricing and FAQs (Greg Isenberg, 2026-08-10). https://www.youtube.com/watch?v=MNNfat_QP0E
