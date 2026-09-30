NVC360 — What to Upgrade Next

For Dan Rosenblat and Joel Tetrault. 25 August 2026. Ranked by the lens Dan approved: irreversible data loss first, then work that unblocks Joel, then correctness, then cost and convenience.

Executive summary

The Turso export test passed. A complete, restorable copy of the production database is obtainable using only the connection string already in the environment — 56 tables, 90 indexes, 2,973 rows, in 8 seconds. It restored into a fresh database with zero row-count mismatches and a clean integrity check. The single largest unknown hanging over this project is now closed, and closed favourably.

That result demotes the Turso ownership gap from an emergency to a managed risk, and it promotes something more mundane: NVC360 still has no backups. Not because backups are impossible — we just proved they aren't — but because nobody is taking them. That is now the top of the list.

The test also surfaced three things nobody was looking for:

Stripe webhooks are being rejected in production right now. STRIPE_WEBHOOK_SECRET is not set, and the handler refuses unsigned webhooks in production by design. Invoices are not flipping to paid on their own. This is a live money defect, and it is the one item I would promote above the approved ranking.

A backup driven off the application's schema file would silently omit every user login. Five live tables — including user, account and session — are managed by better-auth, not by schema.ts. Restore from a schema-driven export and the data comes back with nobody able to sign in.

The money-column defect is broader than reported but is not yet corrupting anything. 25 money-like columns across 10 tables are stored as floats, not the 46-column figure I gave earlier. And of 17 live bookings, zero have inexact cent values. That contradicts my own earlier claim — see §7.

The ranked list




#	Item	Why here	Risk if deferred
1	Automate the nightly export	Zero backups exist today	Total, permanent data loss
2	Quarterly restore drill	An untested backup is a rumour	Discovering the backup is broken during an incident
3	STRIPE_WEBHOOK_SECRET	Live revenue defect, happening now	Invoices stay unpaid; manual reconciliation forever
4	Merge infra/phase-a-container	Nothing infrastructural exists until merged	Joel builds against a codebase missing the work
5	Exercise CD end-to-end once	Built, corrected, never actually run	First real deploy fails at the worst moment
6	Staging compute + real app-config	Joel has nowhere to test	Every change tested in production
7	Money columns → integer cents	Latent, will bite at volume	Silent revenue drift as data grows
8	Orphaned row + FK enforcement	One real violation found	Slow accumulation of unreferenced data
9	Known defects from §23 of the spec	Already catalogued, still open	Known bugs stay known and shipped
10	Turso → Postgres	Fixes ownership, floats and FKs at once	Ongoing dependence on a database nobody owns
11	Externalize background sweeps	Blocks running more than one instance	Cannot scale past one container
12	ACM cert + staging.nvc360.com	Needed before real data enters staging	Plaintext staging, awkward URLs
13	Uptime monitoring	Customers report outages before we do	Silent downtime
14	Retire the nvc360-agent key	OIDC now works end to end	A long-lived key nobody needs
1–2. Backups — the top of the list, and now trivially achievable

The export ran read-only against production, walked sqlite_master for the schema, paged every table, and wrote a 1.75 MB SQL dump. Restoring it into a brand-new SQLite database produced 56 tables, 90 indexes, 2,973 rows, integrity_check: ok, and not one row-count mismatch.

So the honest position on Turso has changed. NVC360 still does not own the account, still has no dashboard, and still cannot rotate the credential. But the fear underneath all of that — if the platform disappears, the data disappears — is no longer true. The data is portable today.

What is missing is a schedule. The script exists on a sandbox that is not permanent, and it has run exactly once, by hand. Turning that into a nightly job writing to the S3 bucket that already exists in the AWS account is small work, and it is the single highest-value thing left on this list.

Two design points that matter more than they look:

Drive the export from sqlite_master, never from schema.ts. The application declares 51 tables. Production has 56. The extras are user (25 rows), account (22), session (748), verification (0) and __drizzle_migrations (14) — better-auth's tables, created through its Drizzle adapter but never declared in the app's schema file. Any backup written by iterating the application's own table list would omit all of them, and the restore would come back complete except that no human being could log in. The script I ran reads the live catalogue, so it caught them.

A backup nobody has restored is not a backup. Hence item 2. The restore path is already written and proven once; running it quarterly against the real dump costs almost nothing and is the only way to know it still works.

3. Stripe webhooks are failing in production — the recommended exception

Under Dan's ranking this is a correctness item and would sit at #7. I am putting it at #3 and recommending it be done alongside the backups, because it is losing money quietly, today.

The evidence is in the code, not inferred:

// packages/web/src/api/routes/payments-webhook.ts
if (isProd && (!STRIPE_WEBHOOK_SECRET || !sig)) {
  log.error("stripe webhook rejected: signature required in production", ...);
  return c.json({ error: "webhook signature required" }, 400);
}

STRIPE_WEBHOOK_SECRET is absent from the environment file entirely. In production, every incoming Stripe webhook is therefore rejected with a 400 before it is read. The application already knows this and says so out loud in a second file:

// practice (STRIPE_WEBHOOK_SECRET isn't set, so invoices rarely flip to — packages/web/src/api/routes/admin.ts:173

The practical consequence: customers pay, Stripe fires the confirmation, NVC360 refuses it, and the invoice sits unpaid until someone marks it by hand. The fix is to create a webhook signing secret in the Stripe dashboard and add it to the Runable Secrets panel — the same panel Joel was shown. No code change.

I have not verified the live behaviour against production Stripe traffic — this is read from the code and the environment, not from a failed webhook log. Confirm in the Stripe dashboard's webhook delivery view before treating the scale of it as settled.

4–6. Unblocking Joel

These are sequential and each one gates the next.

Merge the branch. Eight commits of container, Terraform, CI and CD work sit unmerged on infra/phase-a-container. Joel reviewed a zip of the application, which by definition did not contain any of it. Until it merges, the infrastructure exists in a place his tooling won't see.

Then run CD once, deliberately. The pipeline has never executed against AWS. It was built, then its deploy role was found to be trusting the wrong repository, then that was corrected and applied — but corrected-and-applied is not the same as observed-working. Run it once on purpose, watch it fail or pass, before anyone depends on it.

Then give Joel a staging environment. This needs create_service = true plus a real app-config secret — the one in AWS currently holds a placeholder. Both are spend and both need Dan's explicit approval first. Until this exists, there is nowhere to test anything except production, which is also where local development currently points.

7. The money columns — with a correction to my own earlier reporting

In the update brief I said 46 real() columns, several of them money, and offered this as the plausible cause of the dashboard-versus-Reports revenue disagreement. The data does not support the second half of that.

What is true: 25 money-like columns across 10 tables are stored as binary floats. The worst concentration is bookings — price, subtotal, tax_amount, tax_rate_pct, total, tech_pay, line_items_cost, line_items_price — with invoices (amount, tax, total, amount_refunded) close behind. The earlier figure of 46 counted every real() column including genuinely-float values like lat, lng and rating; 25 is the money-specific count.

What is not true: that it is corrupting revenue today. I checked all 17 live bookings for values that are not exact cents. Zero. SUM(total) over those rows is 15,329.56, clean. At this data volume, with these values, float storage has not yet produced an error.

That changes the urgency, not the conclusion. Binary floats cannot represent most decimal cents exactly; the errors appear as values accumulate and as sums grow. Fixing it is correct, and fixing it now is much cheaper than fixing it across a large table later. But it is not an active fire, and the revenue-disagreement bug needs a different investigation — I owe you that correction.

The natural home for this fix is the Postgres migration, where the target type (numeric) exists natively. Doing it inside SQLite first would mean converting to integer cents and touching every read and write path, then migrating anyway.

8–9. Data integrity and the known-defect backlog

PRAGMA foreign_key_check on the restored copy returned exactly one violation: a row in messages — a dispatch note reading "Hey, can you take the next job?" — pointing at a rider_id that does not exist in riders. One orphan out of 42 messages against 6 riders. Trivial in itself; notable because SQLite does not enforce foreign keys unless explicitly told to, so nothing stopped it and nothing will stop the next one. Postgres enforces by default, which folds this into item 10.

The §23 defect list from the architecture specification is already written up and unchanged; it stays here as a placeholder so it doesn't fall off the board.

10–14. Strategic and housekeeping

Postgres. Every argument from the brief still holds — ownership, rotatable credentials, real numeric types, enforced foreign keys, and a database Joel can actually be granted access to. One argument is now weaker and one is stronger. Weaker: the "we cannot get our data out" emergency is resolved. Stronger: at 2,973 rows and 1.75 MB, the data-movement half of this migration is close to free. The cost is the code — 51 declared tables and the query layer — not the data. Database-per-tenant, the one Turso feature that would justify staying, remains unused.

Background sweeps. Seven setInterval timers in server.ts plus the scheduler and retention services are why desired_count is pinned at 1. Until they move out of the web process, the platform cannot run two containers — that is a hard ceiling on availability, not just scale. pg-boss is the natural answer and it wants Postgres, so it queues behind item 10.

TLS, monitoring, key retirement. Item 12 before real data enters staging. Item 13 because right now a customer would notice an outage before we would. Item 14 is cleanup: the long-lived nvc360-agent access key predates OIDC and no longer needs to exist.

What I would do this week

Schedule the export to S3 and restore it once to prove the loop. (items 1–2)

Set STRIPE_WEBHOOK_SECRET in the Runable Secrets panel. (item 3)

Open the PR with Joel as reviewer and merge it. (item 4)

Those three are cheap, and each removes a category of risk rather than a single bug. Items 5 and 6 need your approval on spend before I touch them.

Method and limitations

The export test ran against production Turso using the credentials already in /home/user/nvc360-v4/.env, issuing SELECT statements and sqlite_master reads only — no writes. All subsequent analysis ran against the restored local copy, not production. Scripts and row counts are in /home/user/turso-export-test/; the dump itself is deliberately not included in this report folder because it contains live customer data.

Ranking reflects the lens Dan approved on 25 August 2026 and is a judgement call, not a computed result. Reasonable people would move items 3 and 7.

Not verified, and deliberately not claimed: the real-world scale of the Stripe webhook failure (read from code and config, not from Stripe's delivery logs); whether the $100 AWS credits survived the paid-account upgrade; and whether the one-off export script behaves the same under a much larger database than today's 2,973 rows.

Text
Text
Heading 1
Heading 2
Heading 3
