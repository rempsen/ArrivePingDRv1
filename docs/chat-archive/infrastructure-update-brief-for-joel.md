NVC360 / uberize.ai — Infrastructure Update Brief

For: Joel Tetrault, VP of Software From: Runable (engineering agent), at Dan's direction Date: Friday, August 21, 2026 Companion to: NVC360 Technical Architecture Specification (76 pp). This brief does not repeat it — it records what changed since you wrote your seven takeaways, and what needs your call.

Executive summary

Your seven takeaways drove eight commits of infrastructure work. Five are now built and verified, one is deliberately deferred, and one — "should we just go to Postgres?" — got a much stronger answer than expected: yes, and for a reason nobody had identified. NVC360 does not own the Turso account its production database lives in. It was provisioned by the hosting platform on the company's behalf, so there is no dashboard, no self-service backup, and no rotatable credential.

The app itself is in good shape. CI now proves it: typecheck, lint, unit tests, migration-drift check, container image build, and a container boot test all pass on commit b604ba3. No application code was modified at any point in this work — every commit is infrastructure.

What needs you: six decisions listed in §7, of which the Postgres migration (15–20 days) and whether to spend ~$25/month turning staging on are the two that matter this week.

1. Status board
#	Your takeaway	Status	Evidence
1	Deploying is "ask Runable to do it"	Fixed	deploy-staging.yml, OIDC, no stored keys
2	Unclear how much is platformed on AWS	Answered — you were mis-sold	Storage is Tigris, not AWS S3. AWS footprint was zero until yesterday (§2.2)
3	We need CI/CD	Built & green	CI run #72, both jobs pass (§3)
4	We need a staging environment	Built, not switched on	Terraform applied; compute gated off (§7.2)
5	Background tasks won't scale	Confirmed, deferred on purpose	7 timers in server.ts + 2 modules (§2.5)
6	We need IaC	Done	Terraform, remote state, 14 resources
7	Should we just go to Postgres?	Yes — stronger case than you had	Ownership gap + a real money-column defect (§4, §5)

Two claims in this brief are explicitly unverified, and are flagged where they appear: whether the $100 of AWS credits survived the paid-account upgrade (§6), and whether a full export of the Turso data is obtainable (§4).

2. The seven takeaways, answered
2.1 Deploys — "ask Runable to do it"

Production still deploys that way, and that is unchanged. What now exists alongside it is a real pipeline for staging: push → CI verifies → image built and pushed to ECR → new ECS task definition → rolling deploy with an automatic rollback circuit breaker → smoke test against /api/ready and a check that the SPA shell actually renders. That last assertion exists because an API-only box will happily return 200 while serving a blank page.

Authentication uses GitHub OIDC: no AWS keys are stored in the repo. The trust policy accepts only this repository on refs/heads/main, so forks and pull requests cannot deploy.

2.2 "We use an S3_BUCKET, but it's unclear how much is platformed on AWS"

This is the one place I'd push back on the premise. "S3" here is a wire protocol, not a vendor. Object storage is Tigris (S3_ENDPOINT=https://t3.storage.dev). Before yesterday, NVC360 controlled no AWS account at all; AWS appeared only as the region Turso happens to host in.

That is good news twice over. Nothing was quietly accumulating on an unmanaged AWS bill, and because Tigris speaks the S3 protocol, moving to real AWS S3 is a credential swap with zero code change — the staging environment is configured to do exactly that, which doubles as a portability proof.

One constraint to inherit: never reintroduce the AWS SDK server-side. It pulls ~570 modules / 1.4 MB and OOM'd the deploy bundler. Bun.S3Client is used deliberately.




2.3 CI/CD

Both halves exist now. Two findings worth your attention:

CI was only wired to main and pull requests. A pushed feature branch built nothing — so any branch you work on would have been unverified until merge. Now infra/**, feat/**, fix/**, chore/** build on push, with the existing concurrency group cancelling superseded runs so this doesn't multiply Actions minutes.

Typecheck is split deliberately. packages/web is blocking. Mobile and desktop are non-blocking, because the root tsconfig uses project references with files: [] and several Hono route files carry a long-standing "No overload matches this call" method-chain false positive. Treat a green mobile typecheck as a bonus, not a gate, until that's untangled.

2.4 Staging

Built and applied in AWS account 293174400261 (us-east-2). Everything except compute is live; the container service is gated behind a Terraform flag that defaults to off, so a fresh terraform apply costs almost nothing.




2.5 Background tasks won't scale

Agreed, and worse than the takeaway implies. server.ts alone registers seven setInterval sweeps, with more in services/scheduler.ts and services/retention.ts. They are wrapped in an oncePerTick guard because setInterval does not wait for the previous run to finish.

The consequence to internalise before touching any scaling knob: desired_count = 1 is a correctness constraint, not a cost choice. A second instance double-fires the scheduler, the automations and the delay watcher. It is documented at every enforcement point in the Terraform for exactly that reason.

This work is deliberately sequenced after the Postgres decision, because if we land on Postgres, pg-boss gives us a real job queue with leader election essentially for free. Building a queue abstraction now and discarding it in six weeks is waste.

2.6 IaC

Terraform 1.13.3, state in a versioned, encrypted, access-blocked S3 bucket with native S3 locking (no DynamoDB table needed any more). Fourteen resources under management. Two deliberate cost decisions, both documented in code:

Default VPC, no NAT gateway. A NAT gateway is ~$32/month — more than everything else here combined. Isolation comes from security groups instead: the task accepts traffic only from the load balancer, the database only from the task.

One JSON secret, not thirty. Secrets Manager bills per secret per month; ~19 config keys are injected individually out of a single JSON secret using ECS's <arn>:KEY:: syntax.

2.7 "Should we just go to Postgres?"

Yes. See §4 and §5 — the case changed character this week.

3. What was built, and what is actually verified

Eight commits on infra/phase-a-container, pushed and building green:

Commit	What
4a2beda	Production container image, local compose stack, CI image job
21bdac0	Staging Terraform; closed a .gitignore hole (.env was covered, .env.aws was not)
99cf11a	Fargate + ALB rebuild, CD workflow, .env.example (which didn't exist despite compose telling people to copy it)
81ac81f	CD switched to GitHub OIDC
af07f96	Staging Postgres switched on
562c2c0	Ignore the Terraform plugin cache and state files
255184d	Run CI on feature branches
b604ba3	Let workspace manifests through the Docker build context

Verified by CI run #72 (commit b604ba3, 6m15s): typecheck (web), lint, unit tests, migration-drift check, container image build, and a boot smoke test confirming the container starts and binds its port. The image build matters disproportionately — Docker could not be installed in the sandbox this work was done in, so CI is the only thing that could prove the Dockerfile was correct. It wasn't, twice, before it was.

Honest account of the failures, since you'll see them in the history:

The first push was rejected outright — an 845 MB Terraform provider binary had been committed by accident. History rewritten, ignore rules added. The stripped file was checked for credentials first; it held only a pointer to where state lives.

Run #71 failed the image build: the Dockerfile copies packages/{mobile,desktop}/package.json because Bun validates every workspace manifest against bun.lock, while .dockerignore excluded those directories wholesale. Two infrastructure files contradicting each other.

Both were mistakes in new infrastructure, not in the app. The app's own checks passed on the first attempt.

Not verified, deliberately: the deploy pipeline itself has never run end to end, because no image has been pushed to ECR and no service exists to deploy to. It is written and syntactically valid; it is not proven.

4. The Turso finding — the most important thing in this brief

Fact. Dan confirms NVC360 never signed up for Turso. The database was provisioned by the hosting platform on the company's behalf.

What that means concretely. No dashboard login. No self-service backup or point-in-time restore that NVC360 controls. No credential anyone at NVC360 can rotate — including after an employee leaves. No way to grant you access. The connection string in the environment is the entire extent of the company's control over its own production data.

Analysis. This converts the Postgres question from a technical preference into a business-continuity item. The migration was already justifiable on the merits below; it is now the remedy for a single point of failure that sits outside the company's control and cannot be mitigated by anything in the codebase.

Recommended first action, ahead of any migration work: prove a full export can be obtained on demand, using the connection string already in hand. If it can, the ownership gap is an operational annoyance and the migration can proceed on a sane schedule. If it can't, this jumps the queue ahead of everything else in this document. This has not been tested yet — it needs about an hour and Dan's go-ahead.

A related note for your first week: local development points at production Turso. That hazard is precisely what staging exists to end, and it should end the day staging runs.

5. The money-column defect

packages/web/src/api/database/schema.ts is 1,398 lines, 51 tables, and uses Drizzle's real type in 46 columns. Some of those are legitimately floating point (lat, lng, rating). Several are money: basePrice, payRatePerHour, and the pricing columns behind quotes, line items and payouts.

Money in binary floating point does not sum reliably. This is a plausible — not yet proven — explanation for a symptom already on record: dashboard revenue and the Reports page disagreeing. Postgres numeric fixes the class of bug outright. SQLite has no exact decimal type, so this cannot be cleanly fixed where the data currently lives.

Alongside it, Postgres brings JSONB, row-level security (relevant to the multi-tenancy hardening pass still in progress), and PostGIS for the service-zone geometry currently hand-rolled.

Cost of the migration: 15–20 engineering days across 51 tables and 14 forward-only migrations. The one Turso feature that would have justified staying — database-per-tenant isolation — is unused. The app runs a single database with company_id scoping via tdb(companyId).

Sequencing recommendation: after staging is live, not before. You do not rehearse a 51-table migration in production, and until this week there was nowhere else to rehearse it.

6. Cost
Phase	Monthly	Notes
Today (nothing running)	~$1–2	ECR, S3 uploads, 2 secrets, logs. RDS free-tier.
Staging switched on	~$26	+ ALB ~$16, + Fargate 0.25 vCPU/0.5 GB ~$9
After August 2027	~$42	+ RDS ~$15 when the 12-month free tier ends

Three things to know:

The budget will be breached by that last row. The cost guard is set at $40/month with alerts to dan@nvc360.com at 50% and 90% actual and 100% forecast. Raise it or revisit the footprint before August 2027.

There is no longer a hard spend limit. Moving to the paid account removed it — AWS's documented behaviour on activation. Budgets email; they do not stop spend.

Unverified: whether the $100 of credits (expiring Feb 21, 2027) survived the upgrade. AWS's documentation doesn't address it and I could not confirm it either way. Worth one glance at the Billing console.

App Runner was reconsidered and rejected. It would save the ~$16/month ALB, and the organisation policy that previously blocked it is gone. But App Runner injects whole secrets only — it cannot pull individual keys out of one JSON secret. Nineteen keys would mean nineteen secrets at $0.40 each (~$7.60/month), plus an application change to read a config blob. Roughly half the saving for real added complexity. Fargate stays.

7. Open decisions — your call

Each has a recommendation, so you're agreeing or overruling rather than starting cold.

7.1 Postgres migration: go, and when? Recommend: go, starting after staging is live and green. 15–20 days. Non-negotiable prerequisite: the export test in §4.

7.2 Turn staging compute on? (~$25/month) Recommend: yes, once you've reviewed the branch — it's the only way to exercise the deploy pipeline end to end. It's one Terraform flag (create_service = true) plus a first image push.

7.3 How should the branch land — PR review or straight merge? Recommend: pull request, with you as reviewer. Nothing on it touches application code, and you should see the infrastructure you're inheriting before it becomes main.

7.4 Background jobs: pg-boss, or keep in-process sweeps? Recommend: decide after 7.1. If Postgres lands, pg-boss is nearly free and gives leader election, which is what actually unblocks running more than one instance.

7.5 HTTPS and a hostname for staging Staging is HTTP-only today. Recommend: an ACM certificate and staging.nvc360.com before any real data goes near it. Terraform takes the cert ARN as a variable already.

7.6 The remaining long-lived AWS key An IAM user (nvc360-agent, AdministratorAccess) exists for Terraform and agent work. CI no longer needs it. Recommend: rotate on a schedule, or move humans to IAM Identity Center and cut it back to what Terraform actually needs.

Smaller calls: populate the staging config secret (placeholder today); set STRIPE_WEBHOOK_SECRET in production — webhooks are currently unverified; stand up uptime monitoring, of which there is none.

8. Known defects carried forward

Unchanged by this work, from §23 of the specification. None were introduced here; none are fixed here.

Item	Risk
STRIPE_WEBHOOK_SECRET unset in production	Webhooks unverified — spoofable payment events
Twilio uses account SID + auth token, not a scoped API key	Blast radius on leak is the whole Twilio account
Multi-tenancy enforcement pass in progress (HARDENING_BLOCKERS.md)	Cross-tenant exposure until complete; RLS in Postgres would backstop it
Assign/reschedule missing from the audit log	Dispatch changes aren't attributable
No uptime monitoring	Outages are discovered by customers
Forward-only migrations, no down-migrations	A bad migration is recovered from backup, not rolled back
Appendix A — AWS inventory (account 293174400261, us-east-2)

Organisation o-6bve4kb61f, management account 759046793211. Eight tagged resources; no ECS cluster exists, so no compute is running.

RDS nvc360-staging-postgres — Postgres 16.13, db.t4g.micro, 20 GB gp3, encrypted, not publicly accessible, 7-day backups, available

ECR nvc360-staging-web with lifecycle policy

S3 nvc360-staging-uploads-293174400261 — encrypted, versioned, CORS, noncurrent expiry

S3 nvc360-tfstate-293174400261 — Terraform state, versioned, native locking

Secrets Manager nvc360-staging/app-config (placeholder), nvc360-staging/postgres-url (live)

CloudWatch Logs /nvc360/nvc360-staging/app, 14-day retention

IAM nvc360-staging-github-deploy (OIDC), GitHub OIDC provider

Budgets nvc360-monthly-cost-guard, $40/month

Appendix B — Day-one access checklist for Joel

No credentials in this document. Dan grants each:

System	Notes
GitHub rempsen/NVC360V4-5823-0110	Admin, so he can manage Actions variables and branch protection
AWS account 293174400261	Prefer IAM Identity Center over a static key
Runable platform	Where production environment variables actually live — the repo .env is the dev copy and has drifted
Sentry, Redis Cloud, Tigris, Stripe, Twilio, Resend	Standard dashboards
Apple Developer (team 86S82A9ZPS) + Expo/EAS	Membership renewed; mid-migration from personal to corporate account, documentation being submitted — expect signing churn on iOS builds until it completes
Turso	Cannot be granted. See §4.
Appendix C — Method and limitations

Claims here come from three sources: direct API calls against the live AWS account and GitHub Actions; reads of the repository at commit b604ba3; and AWS's own documentation for behavioural claims about App Runner, spend limits and organisation policies. Where a claim rests on a single source or none, it is marked unverified in place.

Limitations. Docker could not be installed in the working sandbox, so container behaviour is known only through CI. The deploy workflow has never executed against a live service. The Turso export capability is untested. Credit survival after the account upgrade is unconfirmed. Cost figures are AWS list prices for us-east-2 and exclude credits and tax.

[^1]: AWS App Runner, Referencing environment variables — secrets are referenced whole, by ARN. https://docs.aws.amazon.com/apprunner/latest/dg/env-variable.html (accessed 2026-08-21; saved in sources/) [^2]: AWS Organizations — activating advanced features removes any spend limit and cannot be reversed. (accessed 2026-08-21; saved in sources/)

Text
Text
Heading 1
Heading 2
Heading 3
