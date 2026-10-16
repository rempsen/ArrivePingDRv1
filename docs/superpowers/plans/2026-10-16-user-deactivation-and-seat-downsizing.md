# User Deactivation and Seat Downsizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant admin reversibly deactivate users, and when lowering their paid seat count below the active driver count, choose exactly which drivers come off, reassigning their open jobs first.

**Architecture:** One service module (`services/user-access.ts`) owns the state transitions and guards; thin Hono routes on `/api/team` and `/api/billing` expose them; the Billing tab gains a picker modal and the Technicians/Internal Team pages gain Deactivate/Reactivate controls. Seat counting is tightened to field staff only. No new tables: `memberships.status='disabled'`, `riders.approval='suspended'` and a new `memberships.deactivated_at` column.

**Tech Stack:** Bun, Hono, Drizzle (Postgres; libsql `:memory:` in tests), React + TanStack Query, Tailwind, Stripe (stubbed in tests).

**Spec:** `docs/superpowers/specs/2026-10-16-user-deactivation-and-seat-downsizing-design.md`

## Global Constraints

- Open-job statuses: `OPEN_STATUSES` from `src/shared/job-status.ts` (`pending`, `confirmed`, `assigned`, `accepted`, `enroute`, `arrived`, `in_progress`).
- Seat-counting user = membership `role === "rider"` AND membership `status === "active"` AND rider `approval === "active"`. Office staff (`superadmin|admin|manager|dispatcher|project_manager`) never count.
- Guards: not yourself; not the last active admin-tier member; admin-tier target needs superadmin actor (`isAdminRole`, `isSuperadmin` from `lib/permissions`).
- Seats never go below 1. Stripe quantity updates use `proration_behavior: "none"` (as `setSeats` does today).
- All mutations write `audit()` entries and call `queueCompanySync(companyId)`.
- Copy: "Deactivate", "Reactivate", "Deactivated (n)". Never "suspend" or "disable" in UI text.
- Every new route is tenant-scoped through `tx(c)` / `tdb(companyId)`; cross-tenant ids return 404.

## Review Focus

1. A rider whose jobs were reassigned to a user that is *also* being deactivated in the same downsize request → the request must be rejected (400) before any write. (Task 2 test `rejects reassignment to a user in the deactivate list`.)
2. Downsize with `seats` that does not equal `activeDrivers − deactivate.length` (client out of date) → 409 `{ code: "stale" }`, nothing written. (Task 2.)
3. Reactivating a user whose membership row was deleted (removed from company) → 404, not a silent insert. (Task 2.)
4. Deactivating an office-staff user who has an auto-materialised rider profile with open jobs → still blocked until reassigned, even though they are not a seat. (Task 2 test `office staff with open jobs is blocked`.)
5. Picker list for a tenant with zero field staff → `GET /billing/seat-candidates` returns `[]` and the Billing UI never shows the picker button (excessActive is 0). (Task 3 and Task 4.)

---

### Task 1: Schema + migration

**Files:**
- Modify: `packages/web/src/api/database/schema.ts` (memberships table, after `acceptedAt`)
- Create: `packages/web/drizzle/0015_user_deactivation.sql` (generated)
- Modify: `packages/web/drizzle/meta/_journal.json`, `packages/web/drizzle/meta/0015_snapshot.json` (generated)

**Interfaces:**
- Produces: `schema.memberships.deactivatedAt: timestamp | null`

- [ ] **Step 1: Add the column**

In `memberships`, after `acceptedAt`:
```ts
// Set while status === "disabled" by an admin's Deactivate; cleared on Reactivate.
deactivatedAt: timestamp("deactivated_at", { mode: "date", withTimezone: true }),
```

- [ ] **Step 2: Generate the migration**

Run: `cd packages/web && bunx drizzle-kit generate --name user_deactivation`
Expected: creates `drizzle/0015_user_deactivation.sql` containing `ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;` and updates `drizzle/meta`.

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && bunx tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/database/schema.ts packages/web/drizzle
git commit -m "db: memberships.deactivated_at for reversible user deactivation"
```

---

### Task 2: `services/user-access.ts` — state transitions, guards, downsize transaction

**Files:**
- Create: `packages/web/src/services/user-access.ts`
- Modify: `packages/web/src/services/billing-subscription.ts:188-194` (`driverSeatCount` → field staff only)
- Test: `packages/web/src/services/__tests__/user-access.test.ts`

**Interfaces:**
- Consumes: `tdb(companyId)` from `api/database/tenant`; `OPEN_STATUSES` from `shared/job-status`; `isAdminRole`, `isSuperadmin` from `api/lib/permissions`; `setSeats`, `driverSeatCount` from `services/billing-subscription`; `audit` from `api/lib/audit`; `queueCompanySync` from `services/hubspot-sync`; `monthlyPrice` from `web/site/config`.
- Produces:
```ts
export class AccessError extends Error { constructor(public status: 400|403|404|409, public code: string, message: string) }
export type Actor = { id: string; role?: string; name?: string };
export type OpenJob = { id: string; title: string; scheduledAt: string; status: string };
export async function openJobsFor(companyId: string, userId: string): Promise<OpenJob[]>;
export type SeatCandidate = { userId: string; riderId: string; name: string; email: string; staffType: "driver"|"technician"; lastActiveAt: string | null; openJobs: number };
export async function seatCandidates(companyId: string): Promise<SeatCandidate[]>; // field staff only, lastActiveAt asc nulls first
export type ReassignTarget = string | null; // userId to move jobs to, or null = unassign
export async function deactivateUser(companyId: string, actor: Actor, userId: string, opts: { reassignTo?: ReassignTarget }): Promise<{ deactivatedAt: Date }>;
export async function reactivateUser(companyId: string, actor: Actor, userId: string, opts: { addSeat?: boolean }): Promise<{ seats: number }>;
export async function downsize(companyId: string, actor: Actor, input: { seats: number; deactivate: string[]; reassign: Record<string, ReassignTarget> }): Promise<{ seats: number; deactivated: string[] }>;
```
- `reactivateUser` throws `AccessError(409, "seat_required", …)` with `meta: { seatsNeeded: 1, monthlyDelta }` when the user is field staff, `activeFieldStaff >= billingSeats` and `addSeat` is not true. `monthlyDelta = monthlyPrice(seats+1).total − monthlyPrice(seats).total`.
- `riders.locationUpdatedAt` is `lastActiveAt`.

- [ ] **Step 1: Write the failing tests**

`user-access.test.ts` follows `billing-subscription.test.ts` (in-memory DB, Stripe stub via `mock.module("../stripe", …)` with `stripeEnabled: false` so `setSeats` only writes `billingSeats`). Seed company `ua-co` with `billingSeats: 10`, actor admin `ua-admin`, a second admin `ua-admin2`, field staff users `ua-r1..ua-r3` each with membership `{role:"rider", status:"active"}` and rider `{approval:"active"}`, office user `ua-disp` (`role:"dispatcher"`) with an auto rider profile, bookings: `ua-r1` has 2 open (`assigned`, `enroute`) + 1 `completed`; `ua-r2` has 0; `ua-disp` has 1 `confirmed`.

Tests (names are the assertions):
- `openJobsFor returns only OPEN_STATUSES jobs` → length 2 for `ua-r1`, 0 for `ua-r2`.
- `seatCandidates lists field staff only, least recently active first` → ids `[ua-r2, ua-r1, ua-r3]` given `locationUpdatedAt` null / −3d / −1d; `ua-disp` absent; `openJobs` 2 for `ua-r1`.
- `driverSeatCount excludes office staff` → 3 (not 4).
- `deactivateUser blocks when open jobs and no reassignTo` → throws `AccessError` 409 `has_open_jobs`.
- `deactivateUser with reassignTo moves open jobs and flips state` → bookings `riderId` = rider of `ua-r3`, completed job untouched; membership `status:"disabled"`, `deactivatedAt` set; rider `approval:"suspended"`; audit row `team.deactivate`.
- `deactivateUser with reassignTo null unassigns` → open bookings `riderId` null, status unchanged.
- `deactivateUser refuses self` → 400 `self`.
- `deactivateUser refuses last admin` → with `ua-admin2` disabled first, deactivating `ua-admin2`… (actor `ua-admin` deactivating `ua-admin2` while `ua-admin` remains active is allowed; deactivating the only remaining active admin throws 400 `last_admin`).
- `office staff with open jobs is blocked` → `ua-disp` throws 409 `has_open_jobs`.
- `reactivateUser restores state` → status `active`, `deactivatedAt` null, approval `active`.
- `reactivateUser needs a seat when at capacity` → set `billingSeats: 2`, two active field staff, reactivate third → 409 `seat_required` with `seatsNeeded 1`, `monthlyDelta 30`; with `addSeat:true` → `billingSeats` 3.
- `reactivateUser 404 for unknown membership`.
- `downsize is atomic` → `{seats: 1, deactivate:[ua-r1, ua-r2], reassign:{ua-r1: ua-r3}}` → both disabled, jobs moved, `billingSeats` 1; then with a reassign target that is itself in `deactivate` → 400 `reassign_target_deactivated`, no rows changed.
- `downsize rejects stale seats` → `seats: 5` with 3 active and 2 to deactivate → 409 `stale`.
- `rejects reassignment to a user in the deactivate list` (covered above; keep as its own `it`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && bun test src/services/__tests__/user-access.test.ts`
Expected: FAIL, module `../user-access` not found.

- [ ] **Step 3: Implement `user-access.ts`**

Decisions the signatures leave open: do all writes inside one `tdb(companyId).transaction(async (tx) => …)` using `tx.update(schema.memberships)…` with explicit `companyId` predicates (the executor inside `transaction` is raw drizzle; AND `eq(table.companyId, companyId)` yourself). Run `setSeats` *after* the transaction commits. Validate everything (guards, open jobs, reassign targets active field staff not in the deactivate list, `seats === activeFieldStaff − deactivate.length`) before the transaction. Open-job lookup: bookings where `riderId = rider.id` and `inArray(status, OPEN_STATUSES)` and `deletedAt is null` if the column exists (check `bookings` for the soft-delete column name; use it).

- [ ] **Step 4: Tighten `driverSeatCount`**

Join `riders` to `memberships` on `userId` + `companyId`; count where `riders.approval = 'active'` AND `memberships.role = 'rider'` AND `memberships.status = 'active'`. Update the doc comment.

- [ ] **Step 5: Run tests**

Run: `cd packages/web && bun test src/services/__tests__/user-access.test.ts src/services/__tests__/billing-subscription.test.ts`
Expected: PASS (if a billing-subscription test asserted the old count, update its seed so office staff are not counted).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/services/user-access.ts packages/web/src/services/billing-subscription.ts packages/web/src/services/__tests__/user-access.test.ts
git commit -m "services: reversible user deactivation, seat candidates and atomic downsize"
```

---

### Task 3: Routes

**Files:**
- Modify: `packages/web/src/api/routes/team.ts` (after `resend-invite`, before `delete`)
- Modify: `packages/web/src/api/routes/billing.ts`
- Modify: `packages/web/src/services/billing-subscription.ts` (`BillingSummary` + `billingSummary`)
- Test: `packages/web/src/api/routes/__tests__/user-access-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces (all admin-only via `requirePermission("techs:edit")` on team, `requireAdmin` on billing):
  - `GET /api/team/:id/open-jobs` → `{ count: number; jobs: OpenJob[] }`
  - `POST /api/team/:id/deactivate` body `{ reassignTo?: string | null }` → `200 { ok: true, deactivatedAt }`; `AccessError` → its status with `{ code, message, meta? }`
  - `POST /api/team/:id/reactivate` body `{ addSeat?: boolean }` → `200 { ok: true, seats }`; 409 `{ code: "seat_required", message, meta: { seatsNeeded, monthlyDelta } }`
  - `GET /api/billing/seat-candidates` → `{ candidates: SeatCandidate[] }`
  - `POST /api/billing/downsize` body `{ seats: int ≥1, deactivate: string[] (1..500), reassign: Record<string, string|null> }` → `200 { ok: true, seats, deactivated }`
  - `BillingSummary.excessActive: number` (= `max(0, activeDrivers − seats)`) and `BillingSummary.nextInvoiceAt` already exists.
- `capture()` events: `team.deactivated`, `team.reactivated`, `billing.downsized`.

- [ ] **Step 1: Write the failing route tests** (harness copied from `billing-integration.test.ts`: real routes mounted, header-driven auth shim, `mock.module("../../../services/stripe", …)` with `stripeEnabled: false`)
  - `open-jobs returns count and jobs for own tenant, 404 for another tenant's user`
  - `deactivate without reassign returns 409 has_open_jobs; with reassignTo returns 200`
  - `reactivate returns 409 seat_required then 200 with addSeat`
  - `seat-candidates lists field staff`
  - `downsize 200 happy path; 409 stale; 400 reassign_target_deactivated`
  - `non-admin gets 403 on every new route`

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/web && bun test src/api/routes/__tests__/user-access-routes.test.ts`
Expected: FAIL (404 Not Found on the new paths).

- [ ] **Step 3: Implement routes**

Map `AccessError` → `c.json({ code, message, meta }, status)` in a small local `handle()` helper in each file. `excessActive` is computed in `billingSummary` from the values it already has.

- [ ] **Step 4: Run route tests + typecheck + lint**

Run: `cd packages/web && bun test src/api/routes/__tests__/user-access-routes.test.ts && bunx tsc --noEmit -p . && bun run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/routes/team.ts packages/web/src/api/routes/billing.ts packages/web/src/services/billing-subscription.ts packages/web/src/api/routes/__tests__/user-access-routes.test.ts
git commit -m "api: deactivate/reactivate/open-jobs on team; seat-candidates and downsize on billing"
```

---

### Task 4: Billing tab — downsizing picker

**Files:**
- Create: `packages/web/src/web/components/downsize-picker.tsx`
- Modify: `packages/web/src/web/pages/admin/billing-settings.tsx:81-99, 186-241`

**Interfaces:**
- Consumes: `GET /api/billing/seat-candidates`, `POST /api/billing/downsize`, `Summary.excessActive`, `Summary.nextInvoiceAt`, `priceFor(seats)` already in the file, `useWorkerNoun()`.
- Produces: `<DownsizePicker open targetSeats activeDrivers nextInvoiceAt onClose onDone />`.

- [ ] **Step 1: Add `excessActive` to the `Summary` type and compute `needed = Math.max(0, s.activeDrivers − shownSeats)` next to `seatsDirty`.**

- [ ] **Step 2: Replace the Save button + amber warning block**

When `needed > 0`: render a brand button **"Choose {needed} {noun} to deactivate"** that opens `DownsizePicker`; keep plain **Save** when `needed === 0`. Remove the "your bill will use that number" warning (the picker is the path now).

- [ ] **Step 3: Build `DownsizePicker`**

Modal (`DialogPanel`). Loads candidates; rows with checkbox, name, staff type, "Last active {relative}" or "Never", open-jobs badge. Selected row with `openJobs > 0` shows a select: **Reassign all to…** (other candidates not selected, plus any active field staff) and **Unassign (back to the board)**. Header counter "{selected} of {needed} selected". Confirm button disabled until `selected === needed` and every selected has a reassignment chosen or `openJobs === 0`. Confirm copy (exact): *"Deactivate {names} now. Your plan becomes {targetSeats} {noun}: {money(total)}/month from your next bill{nextInvoiceAt ? ` on ${date}` : ""}. Nothing is charged before then."* On confirm → `POST /api/billing/downsize`; on 409 `stale` show "Your team changed since this opened — refresh and try again." and reload candidates; on success invalidate `["billing","summary"]` and `["team"]`, `["riders"]`, close.

- [ ] **Step 4: Manual check**

Run: `cd packages/web && bun run dev` (or the repo's dev script); in Settings → Billing with seats below active count, confirm the button text, counter, disabled-until-complete behaviour and the confirm copy.

- [ ] **Step 5: Typecheck + lint, commit**

```bash
git add packages/web/src/web/components/downsize-picker.tsx packages/web/src/web/pages/admin/billing-settings.tsx
git commit -m "billing: choose which users to deactivate when lowering seats"
```

---

### Task 5: Technicians and Internal Team pages — Deactivate / Reactivate

**Files:**
- Create: `packages/web/src/web/components/deactivate-dialog.tsx`
- Modify: `packages/web/src/web/pages/admin/riders.tsx` (card actions ~line 225; list grouping ~line 215; ConfirmModal area ~line 424)
- Modify: `packages/web/src/web/pages/admin/team-tabs.tsx` (card actions ~line 236; list ~line 204)
- Modify: `packages/web/src/api/routes/riders.ts:192-250` (expose `deactivatedAt` and `userId` on each rider row — `userId` already present) and `team.ts` roster (`deactivatedAt`)

**Interfaces:**
- Consumes: `GET /api/team/:id/open-jobs`, `POST /api/team/:id/deactivate`, `POST /api/team/:id/reactivate`.
- Produces: `<DeactivateDialog userId name onClose onDone />` (loads open jobs; if any, shows the same Reassign/Unassign select; confirm → deactivate) and `<ReactivateDialog userId name onClose onDone />` (calls reactivate; on 409 `seat_required` shows *"Reactivating {name} needs 1 more {noun}, {money(monthlyDelta)}/month from your next bill. Add a {noun} and reactivate?"* with a confirm that retries with `addSeat: true`).

- [ ] **Step 1: Roster payloads carry `deactivatedAt` and `membershipStatus`** (riders already has `membershipStatus`; add `deactivatedAt` from the membership in both `GET /riders` and `GET /team`).

- [ ] **Step 2: riders.tsx** — add a **Deactivate** icon button (UserMinus) beside Remove for non-office-staff active riders; filter the main grid to `membershipStatus !== "disabled"`; render a collapsed **"Deactivated ({n})"** section at the bottom listing disabled riders with "Deactivated {fmtDateShort(deactivatedAt)}" and a **Reactivate** button.

- [ ] **Step 3: team-tabs.tsx** — same Deactivate/Reactivate controls and collapsed group for internal employees (billing never changes here; `ReactivateDialog` will simply never see 409 for office staff).

- [ ] **Step 4: Manual check** — deactivate a tech with open jobs (blocked until reassigned), confirm they disappear from the active grid and appear in the Deactivated group, sign in as them → no company offered; reactivate at seat capacity → prompt; reactivate below capacity → no prompt.

- [ ] **Step 5: Typecheck + lint, commit**

```bash
git add packages/web/src/web/components/deactivate-dialog.tsx packages/web/src/web/pages/admin/riders.tsx packages/web/src/web/pages/admin/team-tabs.tsx packages/web/src/api/routes/riders.ts packages/web/src/api/routes/team.ts
git commit -m "team: deactivate and reactivate users from Technicians and Internal Team"
```

---

### Task 6: Full verification and PR

- [ ] Run: `cd packages/web && bunx tsc -b --force --noEmit && bun run lint && bun test src/shared/__tests__ src/api/lib/__tests__ src/api/routes/__tests__ src/services/__tests__ && bun run build` — all green.
- [ ] Run CI's drift check locally: `bunx drizzle-kit generate --name ci_drift_check` must report no changes (then delete any generated file).
- [ ] Open PR to `main` titled "feat: reversible user deactivation and seat downsizing", body summarising the spec decisions and the `driverSeatCount` tightening; address Codex findings; report to Dan when green.
