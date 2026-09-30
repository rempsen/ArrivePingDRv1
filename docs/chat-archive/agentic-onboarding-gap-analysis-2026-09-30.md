NVC360's Agentic Tenant Onboarding — What It Does, and What's Left on the Table

For Dan. 30 September 2026. Code audit — every claim below is cited to a file, and the load-bearing ones to a line number.

Executive Summary

Bottom line: NVC360 has built three genuinely good pieces — a 17-industry ICP catalog backed by real trade research, a website scraper that fills in brand identity competently, and a reasoning-model onboarding chat that designs its own follow-up questions per tenant instead of running a static form. That combination is ahead of most vertical-SaaS onboarding. But the system stops one step short of "best in the world": it is excellent at collecting a rich, personalized picture of each tenant and mediocre at acting on it. Two of the three most bespoke data sources it gathers — the tenant's own qualifying answers and the industry-fit metadata already computed for every ICP — currently do nothing. They're captured, stored, and never read again. The gap between NVC360 and category-best isn't more data collection; it's closing the loop between the data it already has and the templates, pricing, and catalog it hands the tenant.

This is a segmentation-and-personalization problem, not a scraping problem. NVC360 already segments customers into 17 ICPs (a real, researched segmentation) and already runs a one-on-one qualifying conversation with each new tenant (a real, personalized information-gathering step). What's missing is the third leg of a proper adaptive-onboarding system: a translation layer that turns "this tenant said they run 4 trucks and offer 3 maintenance-plan tiers" into a materially different starting configuration than "this tenant said they run 40 trucks and don't." Today, regardless of what the tenant says in that conversation, every tenant in an ICP receives the same static catalog, the same static templates, and the same static option tiers — the AI only get to write copy and pick from a fixed menu, not reshape the menu.

Key Findings

ICP segmentation is real and well-sourced, not decorative. 17 industries, each with a researched fit score, a one-line rationale, full terminology mapping, and — as of this year — a knowledge-base row citing actual trade bodies (NAHB, PCA, provincial warranty programs) for all 17, up from 4 in July. But three pieces of that same metadata (tier, rank, fitScore) are computed and stored and then read by zero onboarding logic — they influence nothing about how deep, how fast, or in what order a tenant is onboarded.

Website extraction is single-page and text-only — it never follows a link to an About, Services, or Coverage-Area page, never reads embedded structured data (JSON-LD/schema.org, which a large share of local-business sites publish for exactly the fields NVC360 wants: hours, services, service area), and never cross-checks a Google Business Profile or review site. It gets a genuinely useful first pass from one page and stops there.

The onboarding chat is the most sophisticated piece of the pipeline — it's the only surface where a reasoning model looks at what was actually provisioned for this tenant plus the curated trade research and writes bespoke questions, rather than running a fixed script. But its two most personalized products — the 1–5 freeform ICP-specific answers, and 3 of 5 mandatory baseline answers (technician count, vehicle count, jobs/day) — have no automated effect on the tenant's setup. They are captured, displayed as a transcript, and stored as text. Only 2 of 5 baseline answers (maintenance plans, emergency premium) actually change anything, and they do it through brittle regex matching on template names rather than structured tags.

The system has already fixed its biggest 2026 gap once — a July internal audit found ICP research covering only 4 of 17 industries; that's now 17 of 17. The pattern of "build the collection mechanism, leave the last-mile wiring for later" recurs, though: the same audit flagged customer/job-noun terminology as scraped-but-unused, and the same is now true of qualifying answers and ICP fit metadata. Worth naming as a recurring habit to break, not a one-off.




1. How the ICPs are set up
1.1 What exists

industry-presets.ts (832 lines) is the single source of truth: an array of 17 IndustryPreset records — 13 "core" (product-ready) and 4 "outlier" ICPs each carrying a noted structural blocker, plus 6 alias labels (e.g. a roofing-specific signup label that routes to the exteriors core template) that widen the front door without multiplying the number of things that must be independently maintained.

Each preset is not a stub. It carries:

id, label, group, tier, rank (1–17, a Phase-1 prioritization the team ran), fitScore (0–10) and a one-line rationale — i.e., NVC360 has already done the market-segmentation homework an MBA course would assign as an exercise: rank your ICPs by fit, score them, write down why.

A full terminology set — singular/plural workerNoun, customerNoun, jobNoun — so a plumbing tenant's staff sees "Plumber" language and a home-care tenant's sees whatever fits that trade.

aiTone and notificationGuidance strings that steer downstream AI copy generation.

Seeded services[], suggested templates[], and Form Builder categories[] — the starter content every tenant in that ICP receives at signup.

This is reconciled against a real research program, not invented at the keyboard: the file header points to a dedicated Supabase project (nvc360-icp-intelligence), a Notion ICP-intelligence registry, and 17 per-ICP Google Drive research lanes Dan signed off on 27 July 2026.

1.2 The knowledge-base layer — the real differentiator

Sitting behind the presets is icp_knowledge_base, a Postgres table (schema.ts:1240) with one row per industry: summary, bestPractices[], workflowNotes, terminologyNotes, toneRefinement, notificationRefinement, complianceNotes, and cited sources[]. I queried production directly (SELECT industry FROM icp_knowledge_base) and confirmed all 17 industries now have a seeded row — this was 4 of 17 as of the July internal audit, so the team closed that gap over the summer. Spot-checking two rows (home-builder-developer, painting-decorating in scripts/seed-icp-knowledge-base.ts) shows the citations are real: NAHB, HousingWire, the Manitoba New Home Warranty Program, PCA concrete standards — not AI-hallucinated references.

This knowledge base is what makes NVC360's onboarding output feel like it was written by someone who has run a plumbing company, not a generic form generator. It's the single biggest quality lever the system has, and it's currently spent on only three consumers: form-scout.ts, template-scout.ts, and notification-copy-scout.ts — i.e., it shapes the words and field choices in the starter forms/templates/messages, and nothing about pricing, catalog depth, or the qualifying conversation's structure (only its content, via the onboarding-chat prompt).

1.3 What's built but not connected

tier, rank, and fitScore exist on every IndustryPreset record and are populated for all 17. A repo-wide search for consumers of these three fields turns up exactly one hit outside industry-presets.ts itself — an unrelated sort in bookings.tsx:1275. Nothing in signup, provisioning, or the onboarding chat reads them. In an MBA framing: NVC360 has scored its market segments by attractiveness and fit, and then treats every segment identically at the point of execution. A fitScore of 9 (say, a core trade with deep research and a mature template set) and a fitScore of 3 (an outlier ICP with a named structural blocker) currently produce the same shape of onboarding experience — same chat structure, same number of questions, same level of "we've got you" confidence — when the data already says they shouldn't.

The 4 outlier ICPs (property-management-maintenance, equipment-rental, restoration, sports-organization) each have a priced catalog entry in catalog-presets.ts — confirmed by direct grep — but none of the four have an entry in option-catalog-presets.ts, the good/better/best tier-pricing layer that ships for every core ICP. A tenant self-selecting one of these four industries during signup gets a flatter, less complete starter kit than a core-ICP tenant, and nothing in the flow tells the tenant or the onboarding agent that this is happening — the gap is silent.

2. How much the system extracts from a tenant's website
2.1 The pipeline

brand-scout.ts (scoutBrand(), 476 lines) runs four steps, all wrapped in Promise.allSettled with explicit warnings[] on failure so a bad scrape degrades gracefully instead of blocking signup — a genuinely good defensive pattern:

fetchHtml() — one HTTP GET, the homepage only, 15-second timeout, spoofed desktop-Chrome UA.

screenshot() — a full-page headless-Chrome capture fed to a vision model for primary/accent color extraction.

textSample() — the homepage HTML stripped to 12,000 characters of plain text, sent to a text model against a detailed schema that pulls: company description, tagline, worker/customer/job noun (singular + plural), up to 8 services, hours, service area (explicitly instructed not to infer from a mailing address alone), address, email, phone, six social links, and — the piece that feeds everything downstream — a suggestedIndustry constrained to the real 17-ICP enum plus "other," with a rationale.

logoCandidates() / hostLogo() — regex scan of the raw HTML for <img> tags with "logo" in any attribute, og:image, and touch-icon links; downloads and re-hosts the best candidate.

2.2 What it doesn't do

This is a single-page, HTML-only scrape. I grepped the file specifically for crawl/multi-page/sitemap logic and found none. Concretely, that means:

A homepage that says "Services" in its nav and links to /services never has that page fetched — the 8-service cap in the schema is filled from whatever the homepage itself happens to mention, which for many contractor sites is a short marketing blurb, not the actual service list.

No JSON-LD or schema.org structured-data parsing. A large share of local-business and home-services sites already publish machine-readable LocalBusiness/Service markup with exact hours, address, and service listings — data NVC360's own schema is trying to extract via a text model, when a chunk of it may already be sitting in the page's <head> in a parseable form, more reliably than prose inference.

No PDF/brochure parsing, no Google Business Profile cross-reference, no review-site signal (star rating, review volume, or review text — all of which are strong, free signals for company size and specialization that a human sales rep would glance at in 30 seconds).

No dedicated "About" page fetch, which is where service-area and years-in-business claims most often actually live for a home-services business, as opposed to the homepage.

None of this is a criticism of the code quality — textSample()'s schema descriptions are thoughtful (the service-area field explicitly guards against a bad inference from a mailing address, which is a real, specific failure mode someone clearly hit and fixed). It's a coverage ceiling: the extractor is well-built for the one page it reads, and it only reads one page.

2.3 Where the extracted data actually goes

Confirmed destinations: company_settings (brand fields), the email/SMS footer via dispatch.ts's provisionNotificationBranding(), the onboarding-chat system prompt (as "what brand-scout couldn't fill" — Part 1 of the conversation), and as grounding context into form-scout.ts / template-scout.ts / service-scout.ts alongside the ICP knowledge base. The scraped services[] list and companyDescription are the only tenant-specific (as opposed to ICP-generic) signals that reach the starter forms/templates at all — everything else those generators use is the same per-ICP static bundle every other tenant in that industry gets.

3. How the onboarding chatbot questions the tenant
3.1 Structure

POST /onboarding/chat (onboarding.ts, 684 lines) runs on gateway(MODELS.reasoning) — deliberately the reasoning-tier model rather than the faster text model, because the system prompt asks it to actually reason over provisioned data and trade research before deciding what to ask. This is the right architectural call for the stated goal: a script that "questions the tenant" well has to reason about what's already known, not fill blanks.

The conversation is structured in two mandatory parts:

Part 1 — close brand/profile gaps: confirm industry, terminology, tagline, service area — whatever the single-page scrape in §2 couldn't fill.

Part 2 — qualifying questions (5–10 total, one at a time):

5 hardcoded mandatory fields: technicianCount, vehicleCount, jobsPerDay, offersMaintenancePlans, offersEmergencyPremium (+ emergencyMultiplierPct if yes).

1–5 ICP-specific questions the model designs itself, reasoning over (a) what was actually auto-provisioned for this specific tenant, (b) the curated icp_knowledge_base row, (c) its own operational-consulting judgment. The prompt's worked examples are genuinely sharp — a sports facility gets asked about court/field count and prime-time split; HVAC/plumbing gets asked about number of service-agreement tiers and truck stock; equipment rental gets asked about typical rental duration and damage-waiver programs. This is the one part of the entire pipeline where the system behaves like a competent onboarding consultant rather than a form.

Tool surface: update_brand_profile, set_industry, add_catalog_item, save_qualifying_baseline, save_icp_qualifying_answer, finish_onboarding. stopWhen: stepCountIs(24) — sized up from an earlier 6-step cap that a code comment notes would truncate a full qualifying round; a small but telling sign the team is iterating on this loop based on real failures, not just shipping and moving on.

3.2 What happens when the tenant finishes — and what doesn't

finish_onboarding triggers exactly one deterministic, non-AI pass: applyQualifyingTuning() (qualifying-tuning.ts, 237 lines), gated so it never double-applies:

If offersEmergencyPremium: multiplies rate fields (flatRate, timeRate, kmRate, minCharge, firstHourRate, additionalHourRate) on any template whose name/category matches a regex (emergency|rush|urgent|after.?hours|off.?hours|overtime|priority|weekend); if nothing matches, it clones the best base template into a new "Emergency / After-Hours Call" template.

If offersMaintenancePlans: same pattern against a maintenance regex, cloning a "Maintenance Plan Visit" template with an added due-date field if nothing matches.

That's the entire downstream effect of a 5–10 question, reasoning-model conversation. Two concrete gaps, both confirmed directly in the code and schema:

technicianCount, vehicleCount, jobsPerDay do nothing. The code comment in qualifying-tuning.ts says so explicitly: they're "intentionally NOT wired into provisioning" because there's no capacity/scheduling feature yet to hand them to. The schema comment on qualifyingProfile (schema.ts, on company_settings) is even more direct: this data is "best-effort context for future features... never load-bearing for provisioning, which already ran before this exists." That is a first-party admission that 3 of the 5 questions every tenant is required to answer during onboarding currently exist purely for future use, with no promised timeline.

The 1–5 freeform ICP-specific answers — the most bespoke output of the whole system — go nowhere. They're stored as plain {question, answer} pairs in qualifyingProfile.icpAnswers[]. I found no reader of that array anywhere in the tuning or provisioning code. The model does the hard, genuinely valuable work of asking a sports facility how many courts it runs and what its prime-time split is — and then that answer sits in a JSON blob, visible only if someone opens the transcript, with zero effect on the catalog, templates, pricing, or capacity assumptions the tenant actually launches with.

The tuning logic that does run is pattern-matched against template name/category strings (RUSH_PATTERN, MAINTENANCE_PATTERN). This works today because template-scout.ts reliably produces names containing those keywords, but it's a string-matching contract between two AI-generated surfaces with no schema enforcing it — an AI-renamed template ("Weekend/Holiday Dispatch" instead of something matching weekend|priority) would silently fall through and get skipped.

3.3 A minor, cheap-to-fix UX gap

onboarding-chat.tsx's toolLabel() switch gives friendly pills to update_brand_profile, set_industry, add_catalog_item, and finish_onboarding, but not to save_qualifying_baseline or save_icp_qualifying_answer — those fall through to default: return t.name, so the tenant would see the raw tool name rather than a human label during the part of the conversation that's actually the most interesting to watch happen. Trivial fix, listed for completeness.

4. Gap Analysis — the strategic read

Frame this the way a segmentation-and-personalization case study would: NVC360 has built genuinely strong inputs (a researched 17-way segmentation, a competent single-page enrichment step, and a reasoning agent that personalizes its own questions) and a thin translation layer between those inputs and the tenant's actual starting configuration. The three findings above are really one finding wearing three costumes: the system is much better at asking than at acting.

Gap	Where it lives	Why it matters	Fix effort
ICP-specific Q&A answers never reach provisioning	qualifying_profile.icpAnswers[], never read	Highest-leverage gap — the most bespoke data point per tenant has zero automated effect	Medium: needs a second tuning pass that maps freeform Q&A to structured actions (new catalog items, template variants, capacity flags), likely via a second reasoning call at finish_onboarding time
tier/rank/fitScore unused at runtime	industry-presets.ts, one unrelated consumer found repo-wide	Segmentation the team already paid for isn't shaping onboarding depth, question count, or agent confidence language	Low: read fitScore in the chat's system-prompt builder to scale question depth / set expectations for outlier ICPs
Website scrape is single-page	brand-scout.ts	Caps enrichment quality at whatever fits on one homepage; misses services/about/coverage pages and embedded structured data most competitors' sites already publish	Medium: add a bounded 2–3 page crawl (homepage + linked Services/About) and a JSON-LD parse pass before falling back to the text model
Outlier ICPs missing option-catalog tiers	option-catalog-presets.ts — 0 of 4 outlier ICPs present	Tenants in 4 named industries get a visibly thinner starter kit, silently	Low: write the 4 missing entries, same pattern as the 13 core ICPs
Rate-tuning keyed on regex over template names	qualifying-tuning.ts (RUSH_PATTERN, MAINTENANCE_PATTERN)	Brittle contract between two independently-generated AI surfaces	Low-medium: tag templates with a structured role field (emergency, maintenance, standard) at generation time instead of matching on name text
3 of 5 mandatory baseline answers unused	qualifying-tuning.ts, schema.ts comments confirm by design	Tenant answers 3 questions that currently do nothing; erodes trust in the "we're personalizing this for you" promise if noticed	Medium: either wire to a real capacity signal (e.g., seed a different default schedule density, or size the initial catalog's assumed job volume) or drop them until a consumer exists
Minor: no UI label for 2 of 6 onboarding tools	onboarding-chat.tsx toolLabel()	Small polish gap in the flow's best moment	Trivial

The pattern across every row: NVC360 keeps building the collection half of adaptive personalization and shipping before building the application half. This happened once already and got caught (ICP research: 4→17 industries over the summer). The same shape of gap has simply moved one layer up the stack — from "we don't have the research" to "we have the research and the tenant's own answers, and still apply the same static bundle regardless."

5. What "best in the world" actually requires

Ranked by (impact ÷ effort), consistent with how prior NVC360 audits have been scoped:

Close the ICP-answer loop first. Add a second, deterministic-or-AI tuning pass at finish_onboarding that reads icpAnswers[] and turns them into concrete provisioning actions — new catalog rows, template variants, or capacity flags — the same way offersEmergencyPremium/offersMaintenancePlans already do. This is the highest-leverage, most on-brand fix: it makes the smartest part of the system (the self-designed questions) actually matter.

Feed fitScore/tier into the chat's own reasoning, so an outlier ICP with a known structural blocker gets a different tone and depth than a core, deeply-researched ICP — the metadata to do this already exists and is already populated for all 17 industries; it just isn't read.

Extend the website scrape past the homepage — a bounded crawl of linked Services/About pages plus a JSON-LD parse would raise extraction quality without materially increasing scrape time or cost, and it directly feeds the same downstream consumers (forms, templates, chat Part 1) that already exist.

Backfill the 4 missing option-catalog entries for the outlier ICPs — this is a data-entry task on the same pattern already proven for 13 industries, not new engineering.

Replace name-string matching with a structured template role field so rate-tuning and future personalization logic have something more durable to key off than regex against AI-generated names.

Either wire or retire the 3 unused baseline questions — asking a tenant something that provably does nothing is a small but real trust cost in a system whose entire pitch is "we configure this specifically for you."

None of these require new infrastructure or a new AI capability — every fix above reuses a pipeline, table, or tool call that already exists. That's the encouraging part of this audit: NVC360 isn't missing pieces, it's missing wiring between pieces it already built well.

Methodology

This is a direct source-code and production-database audit, not a survey of comparable products. Findings are grounded in:

Direct reads of industry-presets.ts, brand-scout.ts, onboarding.ts (API route + system prompt), qualifying-tuning.ts, company-provisioning.ts, template-scout.ts, form-scout.ts, notification-copy-scout.ts, schema.ts, onboarding-chat.tsx, signup-company.tsx, catalog-presets.ts, option-catalog-presets.ts.

One read-only production query (SELECT industry FROM icp_knowledge_base ORDER BY industry) confirming knowledge-base coverage.

Repo-wide grep for every claim of the form "X is never consumed" or "Y has 0 entries" — each was verified by search, not inferred from a single file.

Cross-reference against nvc360-icp-ai-automation-audit.report/content.md (28 July 2026), used only to establish what has changed since (ICP knowledge base 4→17 industries) and to confirm the current audit is not re-flagging something already fixed, except where explicitly noted as a recurring pattern.

No code was changed to produce this report. No customer data was read beyond aggregate/schema-level queries.

Text
Text
Heading 1
Heading 2
Heading 3
