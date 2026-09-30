ArrivePing / NVC360 — Database, Security & Multi-Tenancy Structural Audit

Date: September 27, 2026 Scope: Database schema/architecture, tenant data isolation, customer & end-user data security, and infrastructure redundancy/hardening for downtime and data-loss prevention. Method: Direct source-code review of /home/user/nvc360-v4 (the live ArrivePing/NVC360 codebase) — every claim below cites the exact file and line reviewed. This is a static/structural review, not a penetration test; nothing was exploited against a live environment.

Bottom line

The tenant-isolation architecture is deliberately and unusually well designed — it's a fail-closed system with a single enforcement point (tdb()), not tenant checks scattered ad hoc through 60+ routes. Of the ~30 places that bypass that single enforcement point, all but one are legitimate, narrowly-scoped exceptions. One is a real cross-tenant data leak, and there is one real bug that can sever a shared technician's login at every company they work for. Neither requires deep access to exploit; both are one-line-of-code fixes.

The bigger risk in this system isn't the application code — it's that the database has no backup owner. Turso was provisioned on Dan's behalf with no dashboard, no account, and no rotatable credential in his control. That is the finding that should move first.

Area	Verdict
Tenant data isolation (app layer)	Strong, with 1 confirmed leak + 1 confirmed cross-tenant bug (both below)
Authentication & session security	Solid, with 1 config-level gap worth closing (CORS/origin trust)
API-key / MCP / integration auth	Strong — hashed at rest, scoped, expiring, tenant-bound
Permissions / RBAC	Strong — clean per-company overlay, fail-safe defaults
Payment & webhook security	Strong — signature-verified, idempotent, fails closed in production
Database schema hygiene	Strong — every tenant-owned table carries companyId; superadmin delete cascade is comprehensive
Redundancy / backup / disaster recovery	Gap — needs an owner, not just an audit finding
Monitoring / alerting	Built and working, contingent on config that should be verified in production
1. How tenant isolation actually works

Every tenant-owned table (bookings, invoices, messages, riders, payouts, reviews, payment_ledger, etc. — confirmed all 45+ business tables in packages/web/src/api/database/schema.ts) carries a company_id column. Access to them is not supposed to happen through the raw database client — it happens through a single facade:

packages/web/src/api/database/tenant.ts — tdb(companyId) returns a scoped client. Every select, insert, update, delete it makes is automatically WHERE company_id = <this tenant>, with three specific protections worth calling out:

Fail-closed schema check: if a table isn't on the small GLOBAL_TABLES allow-list (role_permissions, idempotency_keys, companies, oauth_app_credentials, plus better-auth's own user/session/account/verification) and doesn't have a companyId column, the facade throws rather than silently running unscoped. A schema change that forgets to wire in tenant scoping breaks the build loudly instead of leaking data quietly.

Insert auto-stamping: every insert through the facade gets companyId stamped on automatically — a route can't forget to set it.

Update strips reassignment: if an update payload tries to change companyId, the facade deletes that key before writing. A tenant cannot re-parent a row into another tenant's account even if a bug tried to let them.

This is enforced again at the request layer in packages/web/src/api/middleware/auth.ts:

The acting tenant is resolved from an X-Company-Id header, but that header is never trusted blindly — a regular user may only switch into a company where they hold an active row in memberships; only superadmin can cross into arbitrary tenants. The code's own comment names the exact scenario this closes: "a technician at Acme reading Bolt's jobs by editing a header."

tenantId(c) throws tenant_unresolved if no company was resolved — again, fail-closed, not fail-open.

A person's role/permissions are overlaid per company from their membership row, so the same login is legitimately a technician at one company and a manager at another, and each request sees the correct one.

This "resolve once, enforce everywhere" design is the right architecture for this problem. Most of the audit below is verifying that nothing routes around it.

2. Where the raw (unscoped) database client is still used — and whether that's safe

21 route files touch the raw db client directly instead of the tenant-scoped facade. I read every call site. The overwhelming majority are legitimate:

Global-by-design tables — companies, oauth_app_credentials, role_permissions, idempotency_keys are correctly outside tenant scoping (platform-level, superadmin-owned, or cross-tenant-safe by nature, e.g. Stripe webhook dedup keys).

Looking up user by an id that was already tenant-filtered upstream — e.g. bookings.ts:827, calendar.ts, export.ts, payouts.ts: these pull name/phone/email off the shared identity table using a customerId or riderId that came from a bookings/riders row already fetched through tx(c). Since the id itself was already tenant-scoped, this can't leak another tenant's record — it's reading the identity attached to a row you already legitimately have.

Looking up user by email for dedup/invite checks — team.ts, invites.ts, riders.ts: email is globally unique by design (one human, one login, one password — see the memberships table's own doc comment), so an unscoped email lookup is correct, not a leak.

job-search.ts explicitly ANDs companyId into every id-based lookup rather than trusting an id alone — e.g. and(eq(bookings.id, id), eq(bookings.companyId, tenantId(c))). This is the right pattern and it's applied consistently there.

mcp.ts (the AI-agent/API-key surface) resolves the acting tenant from the API key (resolveApiKey → tdb(key.companyId)) and ANDs companyId into every raw query it makes. Verified safe.

Finding A — Confirmed cross-tenant leak (Medium severity)

packages/web/src/api/routes/public-forms.ts, submitWorkOrder() (~line 795–828).

This is the handler behind PIN-gated, unauthenticated "employee work order" intake forms (intakeForms.formType === "work_order") — access is a shared PIN, not a login. When the submitted body includes a customerId directly (rather than name/email for find-or-create), the handler does:

let customerId: string = body.customerId ?? "";
...
const [cu] = await db.select().from(schema.user).where(eq(schema.user.id, customerId));

No companyId or isMember() check is applied to customerId before using it. Contrast this with the email-based path two lines above it, which correctly calls findCompanyUserByEmail(email, companyId) — a helper that explicitly checks isMember() (packages/web/src/api/lib/memberships.ts:123-128) before returning a match. And contrast it with job-search.ts's own stated rule: "id alone is never trusted."

Impact: anyone who has (or guesses) a valid user.id and access to any tenant's work-order form URL + shared PIN can attach that identity to a real, priced booking and invoice created under a different tenant — pulling that person's name, phone, and address across the tenant boundary into a company they have no relationship with. It also means one tenant's employee can accidentally (or deliberately) attach any known customer id company-wide, not just from their own client list, since the current company's client list isn't what's being checked.

Likelihood is not high — user.id is a UUID, not sequential or publicly enumerable, so this needs a leaked/logged id to exploit in practice. But it is a real gap in a system that otherwise treats "never trust an id without a company check" as a hard rule everywhere else, and it's a straightforward fix.

Recommended fix: before line 828, require await isMember(customerId, companyId) (same helper admin.ts and team.ts already use) and 404 if it fails — mirroring the email path immediately above it.

Finding B — Confirmed defect: technician delete can sever access at other companies (Medium severity, data-integrity not confidentiality)

packages/web/src/api/routes/riders.ts, DELETE /:id (~line 407-429).

The system explicitly supports one technician working for multiple companies (see the memberships table's design comment: "a technician working for both Acme HVAC and Bolt Plumbing is ONE user row and TWO membership rows... Bolt can remove them without touching their Acme access or their login"). admin.ts's equivalent user-delete path (~line 485-513) honors that correctly: it counts memberships and, if the person belongs to more than one company, only detaches the membership for the acting company — explicitly to avoid this exact scenario, per its own comment: "If they also work for another company, deleting the user row would wipe them from that company's records too."

riders.ts's delete path does not do this. It unconditionally runs:

await t.delete(schema.riders, eq(schema.riders.id, id));
await db.delete(schema.user).where(eq(schema.user.id, r.userId));

This hard-deletes the shared user row with no membership-count check. Because memberships.userId cascades on delete of user, deleting a rider at Company A silently destroys that person's login — and their membership/access — at every other company they work for, with no warning to either company.

Recommended fix: apply the exact same memberships count check admin.ts already has, calling detachMembership instead of db.delete(schema.user) when the person belongs to more than one company.

Everything else read and verified clean

admin.ts — user edit/delete/reset-password: every action is preceded by isMember(); admin-tier edits require superadmin; password reset explicitly blocked for shared multi-company logins; delete correctly handles the multi-membership case (the pattern riders.ts should copy).

team.ts — invite flow uses attachMembership(status:"invited") rather than mutating an existing account directly; identity fields on a shared login are only editable by the person's home company; resend-invite deliberately returns 404 (not 403) for a non-member to avoid confirming cross-tenant account existence.

superadmin.ts company-delete cascade — explicitly scopes deletes by companyId across ~25 dependent tables. Cross-checked against the full schema inventory built for this audit: coverage is complete for every tenant-owned table that references a company via foreign keys reachable from that cascade.

job-search.ts, messages.ts, reviews.ts, onboarding.ts, payments.ts, payments-webhook.ts, notifications.ts, invites.ts, option-selections.ts, punchlist.ts, calendar.ts, export.ts, payouts.ts — all raw-db call sites read individually; all are either global-table access or id-already-scoped lookups as described above.

3. Authentication, sessions, and API access

packages/web/src/api/auth.ts (better-auth): email/password with a 1-hour-expiring reset token, delivered through the branded email pipeline (never leaks the raw session secret). companyId is a session field but explicitly input: false — a user cannot set their own tenant by manipulating the signup payload.

API keys (packages/web/src/api/middleware/auth.ts): keys are SHA-256 hashed before storage (raw secret shown once, never recoverable — confirmed no plaintext key column), prefixed by type (nvc_ secret vs nvcpub_ public — and the code explicitly guards against a public key being used on the secret-key surface, since nvcpub_ also starts with nvc_), scoped (workorders:read, wildcards, write-implies-read), tenant-bound (companyId baked into the key row), and both expiry and revocation are checked on every use.

Permissions/RBAC (packages/web/src/api/lib/permissions.ts): clean <module>:<action> model, per-company role overlay, and a specific guard worth calling out — superadmin can only ever be granted to an email on the SUPERADMIN_EMAIL_DOMAINS allow-list (defaults to nvc360.com), enforced in team.ts. A tenant customer's email can never be elevated into the cross-tenant role.

One config-level gap: auth.ts's trustedOrigins function reflects back any request's Origin header as trusted (return ["mobile://", "homeserve://", ...(origin ? [origin] : ["*"])]) — it doesn't check the origin against an allow-list, it just echoes whatever was sent. Combined with CORS_ORIGINS defaulting to * when unset (confirmed: the sandbox .env has no CORS_ORIGINS set, and api/index.ts comments its own * default as "dev only"), this means the effective origin trust boundary for cookie-based auth is only as tight as whatever CORS_ORIGINS is set to in the actual production deployment. I could not verify the production environment's value from this sandbox — this needs to be confirmed set to the real allowed domain list (arriveping.com, uberize.ai, etc.) in production, not left at the wildcard default.

4. Payments

packages/web/src/api/routes/payments-webhook.ts: Stripe webhook signature verification explicitly fails closed in production — if STRIPE_WEBHOOK_SECRET or the signature header is missing while NODE_ENV=production, the request is rejected before any processing, with the unsigned-parse fallback path commented NEVER reached in prod. Idempotency is enforced via the idempotency_keys table keyed on the Stripe event id, so retried webhook deliveries can't double-process a charge. This matches a fix already shipped in this codebase (f72aed8, "stripe webhook retries were being swallowed by the idempotency guard") — the money-handling path has had real production hardening, not just design intent.

The sandbox .env has no STRIPE_WEBHOOK_SECRET set, which is expected for local dev — the code's own fail-closed check means this is a non-issue as long as production has the secret set, which should be confirmed as part of deployment verification, not assumed.

5. Database schema hygiene

I read the full 1,540-line schema. Every one of the 45+ tenant-owned tables (bookings, riders, invoices, payment_ledger, messages, reviews, payouts, properties, job_events, scheduled_tasks, maintenance_plans, punch-list integration tables, etc.) declares a company_id column with an index. This matters structurally, not just cosmetically: because tenant.ts's facade throws on any non-global table missing that column, a missing column is a build/runtime failure, not a silent leak — the schema and the enforcement code are self-consistent by construction, which is a materially safer design than "we remembered to scope every query."

Notable design details:

Money movement has an append-only ledger (payment_ledger) separate from the mutable invoices row — the right pattern for an auditable financial trail.

Public-facing tokens (bookings.publicToken, properties.publicToken) are opaque random strings, not sequential ids, and bookings.tokenExpiresAt explicitly caps how long a tracking link resolves — a deliberate PII-exposure control on links sent over SMS/email.

intake_submissions.ipHash stores a hash of the submitter's IP, not the raw IP — a small but correct data-minimization choice.

6. Monitoring & alerting

packages/web/src/api/lib/alerts.ts is a genuinely well-built system, not a stub: per-tenant sliding-window error-burst detection (so one tenant's bad integration token doesn't drown out — or get drowned out by — everyone else's healthy traffic), Redis-backed counting when REDIS_URL is set (atomic, correct across multiple server nodes) with an in-memory fallback for single-node, debounced via a cooldown so on-call isn't spammed, and explicitly exception-safe — alerting failures are logged and never propagate into the request path. api/index.ts's global error handler feeds this on every 5xx and never leaks a stack trace to the client, returning a sanitized envelope with a request id and Sentry event id instead.

This is contingent on configuration the sandbox doesn't have set (ALERT_EMAIL, ALERT_WEBHOOK_URL are both empty here) — alertsEnabled() returns false with no channel configured, meaning the code path exists but nothing fires until it's pointed somewhere. Recommend confirming these are set in production so tenant-impacting error bursts actually reach someone.

7. Redundancy, backup, and downtime — the structural gap

This is the finding that matters most for "what happens if something goes wrong," and it's not a code problem — it's an ownership problem:

The production database is Turso (DATABASE_URL=libsql://..., confirmed from the deployment config). Dan does not currently have his own Turso account, dashboard access, or a rotatable database credential — the database was provisioned by the hosting platform on his behalf. That means there is currently no self-service way to: verify a backup/point-in-time-recovery policy is active, test a restore, or rotate the database credential if it were ever exposed.

Redis (used for realtime pub/sub, rate limiting, and the per-tenant alert counters above) is explicitly optional in this codebase — the app runs correctly single-node without it, and gracefully degrades to in-memory state if REDIS_URL is unset or Redis is unreachable. That's a reasonable design choice for availability (a Redis outage doesn't take the app down), but it also means rate limits and alert-burst counters reset silently on failover to memory — worth knowing rather than assuming.

Sentry error monitoring exists on both web and mobile per prior work in this codebase, and the alerting system above is real and working — but both depend on configuration/ownership questions (who receives ALERT_EMAIL, who's on call, is Sentry alerting anyone or just collecting) that are organizational, not something I can verify from source code.

This is the headline recommendation of this audit: get Turso account ownership, a documented backup/PITR policy, and a tested restore procedure under Dan's control before treating anything else here as the priority. The application-layer tenant isolation is genuinely strong; the thing standing between a bad day and a very bad week is who owns the database's safety net.

8. Recommendations, prioritized

Fix Finding A (public-forms.ts submitWorkOrder) — add an isMember(customerId, companyId) check before trusting a client-supplied customerId. One function, small diff, closes a real cross-tenant leak.

Fix Finding B (riders.ts DELETE /:id) — copy the multi-membership check already proven in admin.ts's user-delete path before hard-deleting the user row.

Get Turso backup/PITR under direct ownership — an account, a documented recovery point objective, and one tested restore. This is the biggest single risk in the "downtime and data loss" part of the brief and it's entirely outside the application code.

Confirm production CORS_ORIGINS is set to the real allowed domain list, not left at the wildcard dev default — and consider tightening auth.ts's trustedOrigins to a real allow-list rather than echoing any incoming Origin header.

Confirm ALERT_EMAIL/ALERT_WEBHOOK_URL are set in production so the (already well-built) per-tenant error-burst alerting actually reaches someone.

Confirm STRIPE_WEBHOOK_SECRET is set in production — the code already fails closed if it's missing, so this is a verification step, not a code change.

What this audit did not cover

This was a source-code structural review, not a live penetration test or infrastructure audit. Not covered: actual Turso backup configuration (no dashboard access to check it directly — see §7), Redis Cloud persistence settings, mobile app (packages/mobile) local storage/biometric posture, load-testing or actual downtime history, and any social-engineering/operational-security surface (who has production credentials, offboarding process, etc.).

Text
Text
Heading 1
Heading 2
Heading 3
