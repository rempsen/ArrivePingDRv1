NVC360 Agentic Onboarding — Remediation Plan for Review

For Dan. 30 September 2026. Companion to the gap analysis delivered above. Each item below is scoped independently — approve them individually, in any order, or all at once. Nothing here has been built yet.

Ordered by (impact ÷ effort), same lens used on prior NVC360 punch lists.

Action 1 — Wire the ICP-specific Q&A into provisioning

Fixes: the highest-leverage gap — the agent's own bespoke questions currently do nothing after they're answered.

Proposed build: at finish_onboarding, add one more deterministic step after today's applyQualifyingTuning(). It reads qualifyingProfile.icpAnswers[] and runs a second, tightly-scoped AI call whose only job is to translate each Q&A pair into one of a fixed set of provisioning actions already available as tools: add/adjust a catalog item, add/adjust an option tier, tag a template's capacity assumption, or (if truly nothing applies) no-op. Reuses existing tools (add_catalog_item, template editing) — no new write surface, just a new caller.

Example: sports facility answers "6 courts, prime time 5–9pm weeknights" → seeds an option-tier row for prime-time vs. off-peak court rental instead of leaving that answer as inert text.

Effort: Medium (1 new service file, reuses existing tool calls, needs test coverage across a few ICPs to check it doesn't over-apply). Risk: Low — gated the same way applyQualifyingTuning already is (idempotent, runs once). Approve? ☐ Yes ☐ No ☐ Later

Action 2 — Feed fitScore / tier into the onboarding chat's own reasoning

Fixes: rich segmentation data that's computed for all 17 ICPs and read by nothing.

Proposed build: pass fitScore, tier, and any outlier-blocker note into the onboarding chat's system prompt builder. For a low-fit or outlier ICP, the agent should say so plainly ("this industry is newer for us, so I'll ask a couple extra questions to get your setup right") rather than presenting the same confident tone as a mature, deeply-researched ICP. Also usable to lengthen/shorten the qualifying round — a mature ICP with rich icp_knowledge_base content may need fewer clarifying questions than an outlier one.

Effort: Low — prompt-only change plus one query already available in the onboarding route. Risk: Low. Worth a quick review of tone copy before shipping so it reads as honest, not apologetic. Approve? ☐ Yes ☐ No ☐ Later

Action 3 — Extend the website scrape past the homepage

Fixes: the extraction ceiling — one page in, no matter what the business's site structure looks like.

Proposed build: two additions to brand-scout.ts:

A bounded crawl (homepage + up to 2 linked pages matching /services, /about, /coverage, /areas, or their nav-link text) — same 15s-per-fetch timeout pattern already used, capped total scrape time so it can't stall signup.

A JSON-LD/schema.org parse pass on every fetched page, checked before falling back to the text-model inference for hours/address/services — free, more reliable data where it exists.

Effort: Medium — new fetch/parse logic, needs testing against a sample of real contractor sites to confirm the crawl heuristic finds the right pages often enough to be worth it. Risk: Low-medium — must keep the same graceful-degradation pattern (Promise.allSettled + warnings[]) so a slow secondary page never blocks or lengthens signup noticeably. Approve? ☐ Yes ☐ No ☐ Later

Action 4 — Backfill option-catalog tiers for the 4 outlier ICPs

Fixes: silent, thinner starter kit for property-management-maintenance, equipment-rental, restoration, sports-organization.

Proposed build: pure content work — write the missing option-catalog-presets.ts entries for these 4 industries, same good/better/best pattern already used for the 13 core ICPs. No code changes, no schema changes.

Effort: Low — content authoring only, same pattern proven 13 times already. Risk: Negligible. Approve? ☐ Yes ☐ No ☐ Later

Action 5 — Replace regex template-matching with a structured template role tag

Fixes: the brittle RUSH_PATTERN/MAINTENANCE_PATTERN string-matching contract between two independently AI-generated surfaces.

Proposed build: add a role field to templates (standard | emergency | maintenance | other, extensible) set at generation time by template-scout.ts, so qualifying-tuning.ts matches on that field instead of parsing template names. Removes the failure mode where an AI-renamed template silently falls through the regex.

Effort: Low-medium — one schema field, one write-time change, one read-time change; existing templates would need a one-time backfill pass (can infer role from the current regex as a migration step, then stop relying on it going forward). Risk: Low. This is a durability improvement, not a behavior change — output should be identical on day one, more reliable going forward. Approve? ☐ Yes ☐ No ☐ Later

Action 6 — Decide the fate of the 3 unused baseline questions

Fixes: tenants currently answer technicianCount, vehicleCount, jobsPerDay and nothing happens with the answers — a trust cost in a system whose pitch is personalization.

Two real options, not a build:

6a. Wire them to something now. Smallest useful hook: use jobsPerDay to bias the volume assumption baked into the starter catalog/option tiers (e.g., a 40-job/day tenant gets a denser default schedule template than a 4-job/day one). Medium effort, needs a design decision on what "denser" means per ICP.

6b. Drop them from onboarding until a consumer exists, and re-add when a capacity-planning feature is actually built. Zero engineering effort, immediately removes the "asked for nothing" feeling, shortens the qualifying conversation by 3 questions.

Recommendation: 6b now, revisit 6a if/when a scheduling-capacity feature is actually on the roadmap — no sense asking questions to serve a feature with no ship date. Approve? ☐ 6a — wire now ☐ 6b — drop for now ☐ Leave as-is

Action 7 — Label the last 2 onboarding tool calls in the chat UI

Fixes: save_qualifying_baseline and save_icp_qualifying_answer show as raw tool names instead of a friendly pill, unlike the other 4 tools.

Proposed build: one-line addition to toolLabel()'s switch in onboarding-chat.tsx — e.g. "✓ Noted your answer" / "✓ Saved setup detail."

Effort: Trivial. Risk: None. Approve? ☐ Yes ☐ No

Suggested sequencing if approving multiple

Action 7 (trivial, ship immediately regardless of anything else)

Action 4 (pure content, no risk, closes a visible tenant-facing gap fast)

Action 6 — decide 6a vs 6b before touching anything else that depends on qualifying data

Action 2 (low effort, immediate personalization lift, no dependencies)

Action 1 (the big one — do this once Action 6 is decided, since it's the same code path)

Action 5 (do alongside or right after Action 1, since it touches the same tuning file)

Action 3 (independent of everything else — schedule whenever there's room for the testing pass against real contractor sites)

Next step: mark up the ☐ boxes above (or just tell me which numbers to greenlight) and I'll scope and build in that order. Nothing here touches production data or existing tenants — all of it is additive to the provisioning/onboarding pipeline.

Text
Text
Heading 1
Heading 2
Heading 3
