NVC360 Web / Admin Platform — Expert Code Review

Grade: 6.4 / 10

Reviewer stance: 15 years shipping production SaaS admin platforms. Graded the way I'd grade a product about to be sold to paying field-service companies, not the way I'd grade a prototype.

Scope: packages/web — 53,342 lines, 44 API route files, 29 admin pages, 34 services.

Method: static analysis of the whole codebase plus live probes against the running server on :4200. Every defect below was reproduced, not inferred.

Audience: Dan Rosenblat and the developer who will implement the fixes. The Developer hand-off section at the end lists exact files and line numbers.

Executive summary

The architecture is sound and the multi-tenancy layer is genuinely better than most commercial SaaS I've audited. That good work is undermined by two systemic problems that are not visible in normal testing and will surface as customer complaints:

Roughly 130 of 161 write operations in the admin UI can fail and still look like they succeeded. The modal closes, the list refreshes, and the change was never saved. This will be reported as "NVC360 randomly forgets things" — the hardest class of complaint to debug and the fastest way to lose a tenant.

The busiest endpoint in the product does not scale. GET /api/bookings fetches every row with no pagination and issues up to 4 sequential remote queries per booking. Measured at 822 ms for 14 work orders. A tenant with 2,000 will time out.

Neither is a hard fix. Three fixes totalling about 2.5 days close the entire risk class and move the grade to roughly 8.0. Nothing here requires re-architecting anything.

Key findings

Security and tenancy: 8.5/10. I actively tried to break tenant isolation and could not. Fail-closed design, validated superadmin switching, mass-assignment probe rejected.

Error handling: 3.0/10. The single highest-value fix in the codebase, and it's one shared function.

Input validation: 3.5/10. Zero schema validation. I created a live service with an empty name, a negative price and a negative duration — the API returned 201 Created.

The correct patterns already exist in your own codebase. job-search.ts already does batched, paginated queries properly. The fix for finding 2 is copying a pattern you already wrote.

Scorecard




#	Criterion	Score	One-line verdict
1	Security & access control	8.5	Best part of the codebase. Fail-closed tenancy, real permission catalog.
2	Error handling & user feedback	3.0	~130 of 161 mutations can fail silently and look successful. Critical.
3	Data layer & scalability	4.0	Textbook N+1 on the busiest endpoint, zero pagination.
4	Input validation	3.5	No schema validation anywhere. I created a service with a negative price.
5	Observability	5.5	Excellent backend logging with PII scrubbing. Frontend is completely blind.
6	Accessibility	5.0	Good icon labelling, but no dialog semantics and no focus management.
7	UI/UX polish	7.5	Genuinely good. Consistent, dark, dense, well-considered empty states.
8	Test coverage	4.5	14 test files for 53k lines, all backend. Right things tested, far too few.
9	Code quality & consistency	7.0	Readable, well-commented, honest about its own tradeoffs. Some giant files.
10	Performance (frontend)	7.0	Sensible code splitting and lazy routes. Payloads are the problem, not JS.
Critical findings
1. A rejected save is indistinguishable from a successful one — 3.0/10

This is the finding that matters most, and it is systemic rather than a one-off bug.

The admin pages call the API like this, 79 times:

mutationFn: async (id) => (await api.services[":id"].$delete({ param: { id } })).json()

The Hono client does not throw on a non-2xx response. So a 400/403/500 resolves normally, React Query treats it as a success, onSuccess fires, invalidateQueries runs and the modal closes. The user believes their change saved.

Reproduced live:

server said: 400 Bad Request
did .json() throw?            false
payload handed to react-query: {"message":"name required"}
=> mutationFn resolved normally, so react-query fires onSuccess




Counts: 161 useMutation calls, 30 onError handlers. Roughly 130 mutations have no failure path at all. Of the ones that do surface something, the mechanism is alert() — there is no toast system in the app (12 native confirm()/alert() call sites, zero toast infrastructure).

Why this is severity-one for this product specifically: dispatchers work fast under pressure. A silently dropped work-order edit or a silently failed technician assignment doesn't look like a bug — it looks like the platform lost data.

2. N+1 queries against a remote database, with no pagination — 4.0/10

GET /api/bookings (the endpoint behind Work Orders, Scheduler and the dashboard) does this:

rows = await t.select(schema.bookings, isNull(schema.bookings.deletedAt));  // ALL rows, no limit
const enriched = await Promise.all(rows.map(enrich));

And enrich() issues up to 4 sequential queries per booking — service, rider, rider's user, customer.

Measured live: 822 ms and 44 KB for 14 bookings. That's ~50 round trips to a remote Turso instance for a near-empty database.




The projection above is a linear extrapolation from the measured per-booking cost — it assumes the per-row cost holds, which is the optimistic case (it typically degrades further under connection contention). Even optimistically, the endpoint crosses a 30-second gateway timeout somewhere around 500 work orders in a single tenant. That is not a hypothetical scale; that's one busy contractor after a few months.

Notably, job-search.ts already solves this correctly — batched inArray lookups, real pagination, count(*) for totals. The good pattern exists in the codebase; the busiest endpoint just doesn't use it.

3. No input validation anywhere on the API — 3.5/10

0 uses of zValidator. 93 raw await c.req.json() calls. Bodies are read and written straight to the database.

Reproduced live — POST /api/services:

sent:    { name: "", category: "", basePrice: -99999, durationMins: -5, description: 50,000 chars }
result:  201 Created
stored:  name="" basePrice=-99999 durationMins=-5 descLen=50000

A service with no name, a negative price and a negative duration is now in the catalog. Negative prices flow into lineItemsPrice/subtotal/total and into technician pay calculations. There is careful pricing logic in shared/pricing.ts with real unit tests, and it is being fed unvalidated garbage.

Related, same root cause: PUT /api/zones/:id with an id that doesn't exist returns 500, not 404 — confirmed live. It destructures const [zone] = await tx(c).update(...) and then reads zone.polygon without a null check.

Credit where due: the error envelope is clean — {"error":{"code":"internal"},"requestId":"..."} with no stack trace or SQL leaked.

Notable findings
4. The frontend is invisible in production — 5.5/10

The backend logging is genuinely good: structured JSON lines, request-id correlation, a regex-based PII/secret scrubber that masks emails and strips tokens, and a single captureException choke point ready for a SENTRY_DSN.

The frontend has none of it. No Sentry, no window.onerror, no unhandledrejection handler. There is exactly one root-level ErrorBoundary in app.tsx, which means any render crash white-screens the entire admin platform rather than one panel — and you will never find out it happened. The driver app already got Sentry during its review; the web app was left behind.

5. Accessibility: labelled but not navigable — 5.0/10

Better than expected in one dimension: 398 aria-label attributes against 395 buttons, so icon-only controls are mostly labelled. The Modal component locks body scroll, handles Escape, and even gives the backdrop aria-label="Close dialog".

But app-wide: 0 role="dialog", 0 aria-modal, no focus trap, no focus restore on close. A screen reader announces a modal as an unlabelled div; a keyboard user tabs straight through it into the page behind. Also only 52 <label> elements for 293 <input> elements — most fields rely on placeholder text, which disappears on focus and isn't read as a name.

6. Test coverage is thin, but aimed well — 4.5/10

14 test files for 53k lines. What's covered is exactly what I'd pick first — tenant isolation, API-key isolation, permissions, pricing, tax, money rounding, the geofenced clock. That's good instinct.

What's missing: every one of the 29 admin pages, and 43 of 44 route files. There is no test that would have caught the silent-mutation-failure bug, because there are no frontend tests at all.

7. Some files are too big to reason about — 7.0/10

work-order-modal.tsx is 1,667 lines. notifications.tsx 1,372. bookings.tsx 1,112. scheduler.tsx 1,067. These are the files that get edited most often and they're the hardest to edit safely.

The code itself reads well — the comments are unusually honest (the z-[1050] comment in modal.tsx explains why the stacking order is what it is, the MAX_SERVICE_RADIUS_KM comment explains a real trust boundary). That quality of commenting is rare and worth preserving.

What's genuinely strong

Security and multi-tenancy (8.5) — I tried to break this and couldn't.

tenantId() throws if a tenant-scoped handler is reached without a company — fail closed, not fail open.

Superadmin cross-tenant switching via X-Company-Id validates against a cached allow-list from the companies registry, so probing arbitrary values falls back to the user's home company.

requirePermission() resolves per-person overrides on top of role defaults against a real permission catalog — not a boolean isAdmin flag.

Writes explicitly delete set.companyId so a payload can't move a record between tenants. My mass-assignment probe (id, createdAt, rating injection) was rejected.

Redis-backed rate limiting with a separate stricter limiter on auth.

Dedicated isolation tests exist and pass.

For a multi-tenant SaaS this is the layer that has to be right, and it is.

UI/UX (7.5) — 74 loader/skeleton usages and 102 distinct empty-state strings means someone actually thought about the in-between states, which is the thing most teams skip. Copy like "All caught up — every active job is scheduled and assigned" is the right register. The useWorkerNoun()/useCustomerNoun() hooks mean tenants who call them "drivers" or "crews" see their own vocabulary throughout.

Frontend performance (7.0) — Lazy-loaded admin routes, heavy libraries isolated into their own chunks (leaflet → vendor-maps, recharts/d3 → vendor-charts, pdf-lib → vendor-pdf), and — correctly — React deliberately not hand-split, with a comment explaining the production TDZ crash that taught that lesson. Largest chunk is 657 KB raw / 208 KB gzipped, which is fine.

Recommended fix order

Ranked by damage-prevented per hour of work.




#	Fix	Impact	Effort
1	Throw on non-2xx in one shared API wrapper + add a toast system; wire every mutation's failure path	Eliminates the silent-data-loss class outright	~1 day
2	Paginate GET /api/bookings and batch enrich() with inArray (copy the job-search.ts pattern)	Turns a future outage into a non-event	~0.5 day
3	Add zod validation to write endpoints, starting with money/duration fields; fix the unchecked destructures that 500	Stops bad data at the door	~1 day
4	Sentry on the web app + unhandledrejection; add per-route error boundaries so one panel crashing doesn't white-screen the platform	You find out about bugs before customers call	~0.5 day
5	Replace the 12 confirm()/alert() sites with real dialog/toast components	Removes the last "unfinished" tell in the UI	~0.5 day
6	Modal a11y: role="dialog", aria-modal, focus trap + restore; associate labels with inputs	Keyboard and screen-reader usability	~0.5 day
7	Frontend tests for the flows that touch money and dispatch; split the four 1,000+ line files	Makes the next change safe	~2 days

Fixes 1–3 are the ones that change the product's risk profile. They're about 2.5 days and would move the overall score to roughly 8.0.

Developer hand-off

Exact targets, so whoever picks this up doesn't have to re-find any of it.

Fix 1 — silent mutation failures
What	Where
Add throw-on-non-2xx wrapper	packages/web/src/web/lib/api.ts
Call sites to migrate	79 (await api.x).json() occurrences across src/web/pages/admin/
Toast system	Does not exist — needs creating

Wrap once at the client layer rather than touching 79 call sites individually; a wrapper that checks res.ok and throws an error carrying status + parsed body means every existing useMutation starts failing correctly for free. Then add onError where the message needs to be specific.

Fix 2 — bookings endpoint
What	Where
N+1 source	packages/web/src/api/routes/bookings.ts, enrich() at ~line 86
Unpaginated select	same file, GET / at ~line 135
Pattern to copy	packages/web/src/api/routes/job-search.ts — batched inArray, pagination, count(*)
Fix 3 — validation
What	Where
Unvalidated POST/PUT (start here — money fields)	packages/web/src/api/routes/services.ts
Unchecked destructure → 500	packages/web/src/api/routes/zones.ts ~line 34
Remaining surface	93 raw c.req.json() calls across 44 route files
Fixes 4–6
What	Where
Root-only error boundary; needs per-route + Sentry	packages/web/src/web/app.tsx
Modal needs role="dialog", aria-modal, focus trap/restore	packages/web/src/web/components/modal.tsx
confirm()/alert() sites (12)	admin/job-report.tsx:46, admin/options-catalog.tsx:90,106,232, admin/settings.tsx:54, admin/bookings.tsx:446,795, admin/services.tsx:79, admin/catalog.tsx:205, admin/scheduler.tsx:124, admin/intake-forms.tsx:320
Fix 7 — files to split

work-order-modal.tsx (1,667) · admin/notifications.tsx (1,372) · admin/bookings.tsx (1,112) · admin/scheduler.tsx (1,067)

Repo gotchas the contractor must know

These will waste a day each if not known up front.

tsc --noEmit is not a reliable check in this repo. The root tsconfig uses project references with files: [], and several route files (messages.ts, tags.ts, team.ts, zones.ts, uploads.ts, track.ts) carry a long-standing Hono method-chain "No overload matches this call" false positive that is pre-existing and unrelated to any change. Real verification is booting the server and hitting the endpoint.

The server serves packages/web/dist. Any frontend change requires bunx vite build in packages/web before it appears.

Never run db:push against the remote Turso DB — there is a batch bug. Use db:generate → commit → db:migrate.

Leaflet maps must use fadeAnimation: false, or cached tiles render invisible.

fireEvent() on a seeded booking sends a real SMS. Use throwaway bookings with rider_id NULL.

Verification-script template: packages/web/verify-phase5.ts (61 checks) — model any fix verifier on it.

Methodology & honest caveats

Method: whole-codebase static analysis (rg counts across all 44 route files and 29 admin pages) combined with live probes issued against the running dev server on :4200. Findings 1, 2, 3 and the zones 500 were each reproduced with a real request and real recorded output. Security claims were tested by attempting the attack, not by reading the code.

Caveats, stated rather than buried:

The mobile/responsive pass was not completed. The headless browser tooling wedged partway through the audit. Earlier in the session I successfully rendered /admin/scheduler and the assign modal from real screenshots, so the desktop UI assessment is grounded — but the responsive assessment is not verified and is excluded from the UI/UX score rather than guessed at.

The 3.0 on error handling is a judgement about a pattern, evidenced by the 161-vs-30 count and one reproduced case. I did not click through all 161 mutations individually.

The N+1 scaling curve is an extrapolation, not a load test. It is anchored on one real measurement (822 ms / 14 bookings) and assumes per-row cost holds linearly.

Scores are calibrated against commercial SaaS admin platforms, not internal tools. Against the latter this codebase grades noticeably higher.

Text
Text
Heading 1
Heading 2
Heading 3
