NVC360: Responding to Joel's Architecture Review

A sequenced plan to transact all seven of Joel's items, plus the Postgres decision he asked us to analyze.

Prepared for Dan Rosenblat and Joel Tetrault (VP Software) · August 21, 2026 Basis: repo nvc360-v4 @ main / 68f1c9b, live production headers on uberize.ai, and the 76-page Technical Architecture Specification Joel reviewed.

How I scoped this

Stating these as decisions so you can correct what's wrong rather than answer questions one at a time:

Audience: both of you. Dan gets plain-English framing and a clear order of operations; Joel gets the specifics and the reasoning he'd want to audit.

In scope: Joel's seven takeaways, his two questions, and his two proposals — turned into eight workstreams with owner, effort, and a definition of done. Plus a full Turso-vs-Postgres analysis, because he explicitly asked for one.

Out of scope: actually building any of it. Nothing in the repo has been touched. This is the approve-then-execute gate.

Depth: decision-ready brief. One diagram (dependency order). No code written.

Estimates are engineering-days for one competent engineer who knows this stack, excluding review and approval latency.

Executive summary

Joel's read is correct on all seven counts, and he was right not to assign priority — priority isn't obvious from the list, but it is obvious from the dependencies. Three things to lead with:

There is no Dockerfile in the repo. No container image definition, no fly.toml, no compose file, no Terraform. Four of Joel's seven items (CI/CD, staging, IaC, and his short-term "prove it moves off Runable" proposal) all sit downstream of a container image existing. This is item zero and it's roughly a day of work.

Item 2 has a definite answer, and it isn't AWS. Our object storage is Tigris (t3.storage.dev), not Amazon S3. "S3" in our environment variables is a wire protocol, not an AWS account. AWS appears exactly once — as the region Turso happens to host our database in. NVC360 does not control an AWS account today. Nothing is "platformed on AWS."

Yes to Postgres — but last, not first. The single strongest reason to be on Turso (database-per-tenant isolation) is a feature we are not using. Postgres also fixes a real latent defect: money is stored in floating-point columns. But a database migration is the riskiest work on this list, and you do not rehearse a database migration without a staging environment. So staging first, Postgres after.

Total sequence: about 6–8 weeks of engineering to land items 0 through 5 and 8, with the Postgres migration (items 6–7) as a separate 3–4 week project after staging exists.

The one factual correction to Joel's list

Joel, item 2: "We use an S3_BUCKET, but it's unclear how much is platformed on AWS."

Here's the full picture, verified from live production headers and environment configuration:

Layer	What's actually running it	Is it AWS?
CDN / DNS / TLS	Cloudflare (server: cloudflare)	No
Edge proxy	Fly.io Anycast (fly-request-id, via: 1.1 fly.io)	No
Compute	Runable-managed container, our own Bun server	No (fronted by Google)
Object storage	Tigris — S3_ENDPOINT=https://t3.storage.dev	No — S3-wire-compatible, Fly.io's storage partner
Database	Turso (libSQL), hosted in AWS us-east-2	Turso's AWS account, not ours

Two takeaways:

Nothing is on an AWS account we own or can log into. The exposure Joel was probing for doesn't exist yet.

The S3 protocol compatibility is an asset, not a liability. Because the code talks to storage through Bun.S3Client using the standard S3 API, moving from Tigris to real Amazon S3 is a credential-and-endpoint swap with zero application code change. That's a genuine point in AWS's favour when we pick a provider.

One constraint to carry forward: do not reintroduce the AWS SDK on the server. It was tried; it pulled ~570 modules / 1.4 MB and OOM'd the deploy bundler. Bun.S3Client exists specifically because of that. If we move to S3, we keep the Bun client and just repoint it.

The blocker nobody has named yet

I searched the whole repo:

find . -maxdepth 3 \( -name "Dockerfile*" -o -name "fly.toml" -o -name "*.tf" \
   -o -name "docker-compose*" \) -not -path "*/node_modules/*"
→  (no results)

ls .github/workflows/
→  ci.yml          # 2,123 bytes — the only workflow

There is no portable, reproducible definition of how to run this application. Today "how NVC360 runs in production" lives inside Runable's build pipeline and the environment variables typed into Runable's UI. That is the actual vendor lock-in — not the code, which is plain Bun and moves anywhere.

This is why the plan starts where it does. A Dockerfile is:

the artifact CI/CD deploys (item 3),

the thing staging runs (item 4),

what Terraform points at (item 6),

and the fastest possible proof of Joel's short-term proposal — if docker run works locally and on one cloud host, the "can we leave Runable easily?" question is answered empirically instead of argued.

Good news: this is genuinely easy here. One Bun process, listens on $PORT, stateless, no native build steps beyond what Bun handles. Realistically a 1-day task including a docker-compose.yml that also gives every developer a local Postgres to test against later.

Joel's two questions

"Do you have login credentials for Turso?" — Dan, this one's yours. I can see the connection string in the environment (libsql://c416dd9b-…-runable.aws-us-east-2.turso.io), which means we have database access. What I can't tell is whether anyone at NVC360 has the Turso account login — the dashboard where you'd rotate tokens, add a staging database, view backups, or export data. That distinction matters a lot: the connection string is a tenant of that account, and if the account belongs to Runable rather than to NVC360, we don't control our own backups. Please check whether you have a Turso account login, and if not, we should treat "get NVC360-owned Turso ownership or a verified export" as a blocking prerequisite to anything database-related.

"Do we have a shared Claude Code account or anything like that?" — Also yours, Dan. I have no visibility into billing or seat management. If the answer is no, Joel is asking for a tool budget so he can actually work at speed in this codebase; that's a small spend with a large multiplier and I'd say yes.

Nothing else in this plan is blocked on these two answers except provider selection, which touches the Turso question.

Why the order matters




Read it as: solid arrows are hard dependencies, dashed are strong preferences. The two yellow boxes are decisions only Dan and Joel can make. The pink box is where the risk concentrates.

The three non-obvious sequencing calls:

Staging comes before CI/CD, not after. A deploy pipeline with nowhere safe to deploy to is a pipeline you can only test in production.

Staging comes before Postgres. Migrating 45 tables and a live production dataset without a rehearsal environment is the single highest-risk thing we could do. Staging is the rehearsal environment.

The background sweep work comes after the Postgres decision. If we land on Postgres, pg-boss gives us a durable, multi-instance-safe job queue essentially for free, using the database we already have. If we stay on Turso, we need Redis (which we already run) or an external scheduler — a different and more custom design. Doing this work first means possibly doing it twice.

The eight workstreams
0. Containerize the application

Addresses: prerequisite for items 3, 4, 6 and Joel's short-term proposal What: A multi-stage Dockerfile (Bun base image → install with --frozen-lockfile → build web → slim runtime layer), a .dockerignore, and a docker-compose.yml for local dev with a Postgres service alongside. Why: Nothing can be deployed anywhere until an image exists. Also makes onboarding a new engineer a one-command operation. Effort: 1 day · Owner: Joel (good first task — it teaches the whole build) Done when: docker build succeeds in CI, and docker run with production-shaped env vars serves a working app locally including SSE and file upload.

1. Pick a cloud provider and open the account

Addresses: Joel's short-term proposal What: Decide AWS vs Azure vs GCP. Open an NVC360-owned account, enable billing alerts, create IAM roles for humans and CI separately. Why: Every subsequent item needs a target. This is a business decision, not a technical one — all three can run this app. My recommendation: AWS. Not on general merit, on two specific facts about this codebase: (a) storage already speaks the S3 protocol, so Tigris → S3 is a credential swap with zero code change; (b) AWS RDS Postgres is the least surprising managed Postgres available, which matters if item 6 lands. ECS Fargate or App Runner will happily run our single stateless container. Counterweight: if Joel is materially faster in Azure or GCP, take that — velocity beats a marginal integration advantage, and there is no third-party lock-in here beyond the S3 protocol, which all three support. Effort: 1 day of setup, plus decision time · Owner: Dan (decision) + Joel (recommendation, setup) Done when: Joel has admin access to an NVC360-owned cloud account with a spend alert configured.

2. Stand up staging

Addresses: Joel item 4, and doubles as his portability proof What: The container running on the chosen provider, its own database, its own storage bucket, its own Stripe/Twilio/Resend test credentials, on a staging. subdomain behind auth. Seeded with anonymized or synthetic data — not a copy of production customer data. Why: Two payoffs in one. It's the environment we've never had, and standing it up is the empirical answer to "does this code move off Runable easily?" Effort: 3–5 days · Owner: Joel Done when: a QA pass runs end-to-end on staging — create a company, create a work order, dispatch, driver check-in, invoice — with zero calls to production services. Note this also fixes a documented hazard: today local development points at the production Turso database. That ends here.

3. Infrastructure as Code

Addresses: Joel item 6 What: Terraform for the whole staging footprint: network, container service, database, bucket, DNS, secrets, IAM. Remote state in the cloud account, not on a laptop. Then re-derive production from the same modules with different variables. Why: Staging that was clicked into existence can't be reliably reproduced, and "reproduce production" is the actual disaster-recovery plan. Sequencing note: don't try to Terraform it before you've built it by hand once. Click it, learn the shape, then codify — this is normal and faster. Effort: 4–6 days · Owner: Joel Done when: terraform destroy && terraform apply rebuilds staging from scratch and the QA pass still passes.

4. Add CD to the existing CI

Addresses: Joel item 3 What: Our CI is genuinely decent already — .github/workflows/ci.yml does typecheck, oxlint --deny-warnings, four test suites, and a clever migration-drift check that regenerates Drizzle migrations and fails if they differ from what's committed. All of it is CI. There is no CD step. Add: build and push the image on merge to main, auto-deploy to staging, run migrations as a gated pre-deploy step, smoke-test, then a manual-approval promote to production. Plus a documented rollback. Why: Deployment today is a human asking Runable. That's not repeatable, not audited, and not something two engineers can do concurrently. Effort: 3–4 days · Owner: Joel Done when: merging to main puts the change on staging with no human action, and promoting to production is one approved button press with a tested rollback path.

5. Secrets and configuration management

Addresses: cross-cutting; unblocks 2, 3, 4 What: Move production configuration out of the Runable UI into the provider's secret manager, referenced by Terraform and injected by the deploy. While we're in there, close three known gaps: STRIPE_WEBHOOK_SECRET is unset in production (webhooks are currently unverified), Twilio uses an account SID + auth token instead of a scoped API key, and the repo's .env has drifted from production (NODE_ENV=development, a test-mode Autumn key). Why: Config living only in a vendor's web form is the same lock-in problem as the missing Dockerfile, and the unverified Stripe webhook is a live security issue, not a tidiness issue. Effort: 2–3 days · Owner: Joel + Dan (Dan holds several of these vendor accounts) Done when: every environment's config comes from one source of truth, secrets are rotatable without a redeploy, and Stripe webhook signatures are verified in production.

6. Database: Turso → Postgres

Addresses: Joel item 7. Full analysis in the next section — recommendation is yes, and schedule it after staging exists. Effort: 15–20 days · Owner: Joel, with a defined cutover window

7. Externalize the background sweeps

Addresses: Joel item 5 What: Six recurring setInterval loops run inside the web process — presence (2 min), scheduler (60 s), automation (60 s), delay watch (60 s), email domain poll (2 min), DB ping (60 s) — plus a 4-minute self-ping to /api/ready to stay warm. They're wrapped in oncePerTick(name, fn) and the scheduler's claim logic is race-safe, so this is correct today at exactly one instance. At N instances it becomes N copies of every loop. Why it's not urgent: Joel framed it as "as we scale," which is exactly right. It's a scaling ceiling, not a present bug. But it's a hard ceiling — it means we currently cannot run two app instances, which means no rolling deploys and no horizontal scaling. What: move the sweeps to a separate worker process from the same image (different entrypoint), with a durable queue. On Postgres, pg-boss gives us this with no new infrastructure. Keep the self-ping in the web process only. Effort: 5–8 days · Owner: Joel Done when: two web instances run concurrently with no duplicated side effects, verified by a scheduler-fired notification appearing exactly once.

8. Monitoring and alerting

Addresses: documented gap, not on Joel's list — adding it because CI/CD without monitoring means we deploy faster into a system we can't see What: Uptime checks on /api/ready, error tracking on the server (the mobile app already has Sentry — extend the same account), a dashboard for latency and error rate, and alerts routed somewhere a human reads. Effort: 2–3 days · Owner: Joel Done when: we learn about an outage from an alert rather than from a customer.

Recommended phasing
Phase	Weeks	Contents	Outcome you can point at
A — Prove portability	1–2	Items 0, 1, 5 (partial)	The app runs in a container on a cloud account we own. Runable lock-in disproved.
B — Build the safety net	2–4	Items 2, 5 (complete), 8	A real staging environment, secrets managed, and we can see production.
C — Make it repeatable	4–6	Items 3, 4	Infrastructure is code; merges deploy themselves; rollback is tested.
D — Database	7–10	Item 6	Postgres in production, rehearsed twice on staging first.
E — Scale headroom	11–12	Item 7	Multi-instance capable. Rolling deploys. No single-instance ceiling.

Phases A and B are where nearly all the risk reduction lives. If budget or Joel's time gets constrained, cut from the back, not the front.

The Postgres analysis

Joel asked for "an analysis here and decide." Here it is, and the recommendation is migrate to Postgres, scheduled in Phase D.

The argument that actually settles it

Joel wrote that Turso "theoretically has good multi-tenant isolation features" but he's unsure we're using them properly. He's right to be unsure, and the answer is clean: we are not using them at all.

Our multi-tenancy is a single database, a company_id column on every one of the 45 tables, and a tdb(companyId) wrapper in src/api/database/tenant.ts that scopes queries. That is a perfectly respectable pattern — and it is a pattern that runs identically on Postgres, MySQL, or anything else with a WHERE clause. Turso's distinguishing feature is cheap database-per-tenant isolation. We built around it instead.

So the strongest technical reason to stay on Turso is a feature we've never switched on. Everything after this point is upside.

Reasons to move that aren't preference

Money is stored in floating point. This is the one I'd raise even if Joel had never mentioned Postgres. SQLite has no decimal type, so Drizzle's real is what we got: bookings.price, subtotal, tax_amount, total, tech_pay, payRatePerHour. Floating-point arithmetic on currency produces rounding drift — the kind that makes an invoice total disagree with the sum of its line items by a cent, and makes a monthly revenue report disagree with the sum of its invoices. We already have a documented symptom in this family: the dashboard and the Reports page compute revenue differently (NEXT_PRIORITIES.md, item 5). Postgres numeric makes the whole class of bug impossible. This is a correctness fix disguised as a migration.

JSON in text columns. line_items, price_breakdown, field_data, checklist_state, perms, conditions, actionConfig are all JSON serialized into text. Today we cannot query inside them — every filter or report over that data has to load rows and parse in application code. Postgres jsonb makes them indexable and queryable.

Row-level security as a second tenancy layer. Our tenant isolation is enforced entirely in application code, and HARDENING_BLOCKERS.md still lists the multi-tenancy enforcement pass as in progress. Postgres RLS lets the database refuse cross-tenant reads even when application code has a bug. For a multi-tenant SaaS holding customer addresses and payment records, defense in depth here is worth real money.

PostGIS for zones. Service zones and geofencing currently use hand-rolled haversine math in src/shared/geo-distance.ts and zone-utils.ts. It works, and PostGIS does point-in-polygon and radius queries natively, indexed, and correctly at edge cases.

Real transactions, mature tooling, bigger hiring pool. And Joel — the person who has to operate this — is more comfortable in Postgres. That's not a soft factor. The VP of Software's operational fluency with the production database is a legitimate engineering input.

Honest cost of the migration

Nobody should approve this thinking it's a config change.

Work	Scale
sqliteTable → pgTable across the schema	45 tables, 1,398 lines in schema.ts
Timestamps: epoch integers → timestamptz	Every date column, plus every read that assumes epoch ints
Booleans: integer 0/1 → native boolean	Widespread
Money: real → numeric	~15 columns, plus every calculation touching them
Migration history re-baselined	14 committed migrations discarded; new 0000 baseline
drizzle.config.ts dialect and every raw SQL statement	We use raw SQL deliberately (Turso batch bug) — each needs review
Data transfer + cutover	Export, transform, load, verify, with a downtime window or dual-write

Drizzle makes this tractable, not free. 15–20 engineering days, and it touches the schema every single feature depends on.

Why it goes in Phase D and not now

Three reasons. It needs staging to rehearse in — running this cold against production would be reckless. It needs monitoring in place to detect a subtly-wrong migration before customers do. And it needs the Turso account-ownership question answered, because a clean verified export is the first step and we don't currently know who owns that dashboard.

The alternative, stated fairly

Stay on Turso, fix the money columns by moving to integer cents (store 12345 for $123.45), and spend the saved three weeks on product. This is a defensible choice and I'd support it if Joel weren't the one operating the database — but he is, and the JSONB, RLS, and PostGIS wins compound over the next two years. Recommendation stands: migrate, in Phase D.

Open decisions gating kickoff

Nothing in Phase A starts until these are settled. Four items:

Cloud provider — AWS, Azure, or GCP. My recommendation is AWS for the S3-protocol continuity and RDS; Joel's velocity overrides that if he's faster elsewhere. Owner: Dan, on Joel's recommendation.

Budget appetite. Staging plus managed Postgres plus monitoring is real recurring spend — order of a few hundred dollars a month at our size, dominated by the database and the always-on staging container. Staging can be scheduled down outside business hours to cut that meaningfully. Owner: Dan.

Who executes. This plan is written assuming Joel does the work, since it's exactly a VP of Software's first-90-days mandate. If he'd rather direct and have us execute against his review, say so and we'll re-cut the ownership column. Owner: Joel.

Turso account ownership and the Claude Code seats — his two questions above. Owner: Dan.

What I'd start on today, pending your go-ahead

The Dockerfile and docker-compose.yml. It's a day, it's independent of the provider decision, it makes the "can we leave Runable?" question answerable this week, and it's the prerequisite for four of Joel's seven items. Nothing else on this list is both that cheap and that unblocking.

Methodology and limitations

Every claim about the codebase in this document was verified directly against the repo at main / 68f1c9b or against live production HTTP headers on uberize.ai, not recalled. The infrastructure gaps (no Dockerfile, no IaC, no CD step, one workflow file) were confirmed by filesystem search, reproduced above. Deployment topology was established from response headers on 2026-08-19.

Three limitations worth naming:

Cost figures are order-of-magnitude, not quotes. They depend on the provider decision and on instance sizing we haven't done.

Effort estimates assume Joel's stack familiarity. The Postgres range in particular widens if raw-SQL review turns up more Turso-specific behaviour than the batch bug we already know about.

I cannot see billing, vendor account ownership, or seat management for Turso, Runable, Stripe, Twilio, or Anthropic. Anything requiring an account login is assigned to Dan for that reason, not by preference.

Text
Text
Heading 1
Heading 2
Heading 3
