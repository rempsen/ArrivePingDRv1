BMD Punch List ↔ ArrivePing Integration

Status: built and verified live against the running ArrivePing dev server. Not yet wired up on the Lovable side — that's what this doc gets you through.

How it works

One ArrivePing Job per hotel project. The first deficiency assigned on a project auto-creates the Job; every later deficiency on the same project reuses it.

One ArrivePing Technician per trade. The first deficiency assigned to "Acme Painting Co" auto-creates a technician for them; every later deficiency for that trade reuses the same technician. No manual setup per trade, ever — works for any hotel project you add later without touching ArrivePing.

Deficiencies are line items on the project's Job, not separate jobs.

Two sync-back paths, both wired, use either or both:

Poll (GET /api/punchlist/changes) — the reliable source of truth, a few minutes' delay, never misses a row.

Push (best-effort webhook) — near-real-time, fires the moment a technician updates something in ArrivePing. Falls back to the poll if it fails.

What's live right now

Built on ArrivePing (this repo), migration applied, and smoke-tested end-to-end against the running dev server:

POST /api/punchlist/assign → auto-created project "Hyatt Centric 325 Broadway" (1 Job), auto-created 2 technicians for "Acme Painting Co" and "Bright Electric LLC", created 2 deficiencies.

PATCH a deficiency to done with notes + sign-off from the ArrivePing side → showed up correctly in a poll.

Resending the same deficiency id didn't create a duplicate (idempotency confirmed).

Test data has been cleaned out of the BMD Materials tenant — it's ready for real traffic.

Your API key (BMD Materials tenant, scopes punchlist:write, punchlist:read, workorders:read, techs:read):

nvc_81ebbce35a5d45436b6dd67e0a61db9c5ae36fb0e19494b8

This is shown once and not recoverable from the ArrivePing UI — save it now (e.g. straight into Lovable Cloud → Secrets, see below). It can be revoked and re-issued from ArrivePing's admin → API Keys if it ever leaks.

Base URL to call:

https://arriveping.com

Confirmed live and reachable — re-ran the full assign → poll → cleanup smoke test directly against this URL right after publishing, worked end to end. This is the URL to put in ARRIVEPING_BASE_URL below.

Note: arriveping.com and uberize.ai currently share the same underlying database and are both still sandbox/test environments — there's no separate "real" production yet. Fine to wire this integration up against it now; just know a future cutover to a genuinely separate production DB would mean re-pointing ARRIVEPING_BASE_URL again at that point.

The 3 pieces to paste into Lovable

All three live in edge-functions/ next to this doc, full literal code, ready to hand to Lovable:

File	Trigger	Does
assign-deficiency/index.ts	Database Webhook on your deficiencies table (Insert/Update)	Pushes a new assignment into ArrivePing
sync-punchlist-status/index.ts	Schedule, every 5 min	Pulls status/notes/photos/sign-off back from ArrivePing
punchlist-webhook-receiver/index.ts	Optional — ArrivePing calls it directly	Near-real-time push instead of waiting on the poll

Each file has a COLUMNS block at the top — that's the only thing to edit, mapping to your real Lovable table/column names. I guessed at deficiencies, projects, floor, location, area, material, issue_type, assessment, assigned_to, due_date, description, photos from the screenshots we reviewed — please check these against your actual schema before deploying, a mismatch there is the only likely failure point.

Setup steps

Secrets — Lovable Cloud → Cloud tab → Secrets:

ARRIVEPING_BASE_URL — the real base URL (see warning above)

ARRIVEPING_API_KEY — the nvc_... key above

PUNCHLIST_WEBHOOK_SECRET — only if using the optional push receiver; any random string

Deploy the 3 functions — paste each file's code into Lovable and ask it to deploy an edge function with that name and content, or push via the Supabase CLI if you manage this project that way.

One-time SQL (SQL editor, for the poller's cursor):

create table if not exists punchlist_sync_cursor (
  id int primary key default 1,
  since timestamptz not null default now(),
  constraint one_row check (id = 1)
);
insert into punchlist_sync_cursor (id, since) values (1, now())
  on conflict (id) do nothing;

Wire the trigger for assign-deficiency — Cloud tab → Database → Webhooks → new hook on your deficiencies table, events Insert + Update, pointed at the assign-deficiency function. (sql/deficiency-trigger.sql has a raw-SQL alternative if you'd rather not use the UI.)

Schedule sync-punchlist-status every 5 minutes — Cloud tab's scheduled-functions panel if your project has one, otherwise run sql/schedule-sync.sql (uses pg_cron — works everywhere).

(Optional) Register the push webhook — deploy punchlist-webhook-receiver, then in ArrivePing: Settings → Notifications → Webhooks → add an endpoint with that function's URL, the same PUNCHLIST_WEBHOOK_SECRET, subscribed to event punchlist.deficiency_updated. This UI already exists in ArrivePing, no backend work needed.

The API contract, if you want to call it directly

POST /api/punchlist/assign — Authorization: Bearer nvc_..., scope punchlist:write

{
  "project": { "externalId": "proj_123", "name": "Hyatt Centric 325 Broadway", "address": "325 Broadway, New York, NY" },
  "trade": { "externalId": "trade_456", "name": "Acme Painting Co", "contactEmail": "jobs@acme.com", "contactPhone": "+15551234567" },
  "deficiency": {
    "externalId": "def_789",
    "floor": "4", "location": "Room 412", "area": "Bathroom", "material": "Drywall",
    "issueType": "Paint peeling", "assessment": "must_fix",
    "description": "Paint peeling near shower ceiling seam",
    "dueDate": "2026-10-05", "photos": ["https://.../before1.jpg"],
    "updatedAt": "2026-09-25T06:00:00.000Z"
  }
}

externalId fields are yours — ArrivePing upserts on them, so resending is always safe.

trade.externalId is optional; if omitted, the trade is de-duplicated by a slug of trade.name instead (fine as long as you spell the trade name consistently).

deficiency.updatedAt protects you from a stale resend clobbering newer ArrivePing-side work — always send your own "last updated" timestamp here.

GET /api/punchlist/changes?since=<ISO8601>&limit=500 — Authorization: Bearer nvc_..., scope punchlist:read

{
  "changes": [
    { "externalId": "def_789", "projectExternalId": "proj_123", "status": "done",
      "technicianNotes": "Repainted seam, sanded first.", "photosAfter": ["https://.../after1.jpg"],
      "completedAt": "2026-09-25T06:17:33.641Z", "signOffName": "Mike (Acme Painting)",
      "signOffAt": "2026-09-25T06:17:33.641Z", "updatedAt": "2026-09-25T06:17:33.641Z" }
  ],
  "count": 1, "serverTime": "2026-09-25T06:17:39.562Z", "hasMore": false
}

Always store serverTime as your next since — not the last change's own updatedAt — so nothing committing mid-request gets skipped.

hasMore: true means keep paging with since = the serverTime you just got, before saving the cursor.

Push webhook payload (what punchlist-webhook-receiver gets), same shape as one row of changes plus event: "punchlist.deficiency_updated" and an X-Webhook-Secret header.

Open questions before this is fully production-ready

Production base URL — see the warning above. This is the one blocking item.

dueDate format — I'm parsing whatever you send with new Date(...). If your Lovable date picker sends something other than an ISO date/datetime string, tell me and I'll adjust the parser.

Trade "technician" logins — right now, auto-provisioned trades get a synthetic ArrivePing login they never see or use (a placeholder password nobody knows) — good enough to hold the assignment, but they can't log into ArrivePing's tech app unless someone later invites them properly. Fine to leave as-is, or say if you want real invites sent automatically.

Column names — double-check the COLUMNS block in each Edge Function against your real Lovable schema (table names, especially assigned_to, project_id, photos).

Ping me once you've got the production URL and I'll do a final live test against it before you turn this on for real projects.

Text
Text
Heading 1
Heading 2
Heading 3
