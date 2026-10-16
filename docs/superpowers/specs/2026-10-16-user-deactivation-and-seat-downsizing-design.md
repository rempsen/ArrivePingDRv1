# User deactivation and seat downsizing

Approved by Dan on 2026-10-16 (decisions: access ends immediately; open jobs must be reassigned first; reactivating past the paid seat count prompts to add a seat; controls live on both Billing and Users; no notification to the deactivated user).

## Problem

Billing is one Stripe graduated price whose quantity is the seat count, re-synced before each invoice as `max(billingSeats, active drivers)`. The Billing tab lets a tenant lower `billingSeats` below the active driver count, but nothing lets them choose *which* drivers come off, and there is no reversible "off" state: the Users page offers only permanent delete. A tenant with 10 drivers who wants to pay for 8 gets a warning and keeps paying for 10.

## Design

### 1. Deactivated state (reversible)

- A deactivated user keeps all history (jobs, time entries, photos, messages) but cannot sign in to this company and does not count as a seat.
- Representation: `memberships.status = 'disabled'` (auth already excludes it from `loadMemberships`), `riders.approval = 'suspended'` (billing's `driverSeatCount` already counts only `active`), and a new `memberships.deactivated_at` timestamp.
- Reactivate reverses all three. Delete remains the existing destructive action.
- Guards: cannot deactivate yourself; cannot deactivate the last active admin; admin-tier accounts require a superadmin (existing rule); cannot deactivate a user who still has open jobs unless the same request reassigns or unassigns them.
- Open jobs = bookings with `riderId` of this user's rider and status in `OPEN_STATUSES` (`pending`, `confirmed`, `assigned`, `accepted`, `enroute`, `arrived`, `in_progress`).

### 2. Billing → downsizing picker

- When the chosen seat count is below the active driver count, the Save button becomes **Choose N users to deactivate** (N = active − chosen) and opens a picker.
- Picker lists seat-counting users only (memberships with role `rider`, status `active`, rider approval `active`), least-recently-active first (`riders.lastSeenAt` ascending, nulls first). Each row: name, staff type, last active, open-jobs badge.
- Tick users until N are selected. A selected user with open jobs shows an inline control: **Reassign all to…** (another active driver) or **Unassign** (back to the board). Confirm is disabled until N are selected and every selected user has zero remaining open jobs after the chosen reassignments.
- Confirm copy reads back the outcome: who is deactivated, the new seat count, the new monthly total and the next invoice date; "nothing is charged before then".
- One request (`POST /api/admin/billing/downsize`) performs reassignments, deactivations and `setSeats` in a single transaction; Stripe quantity update happens after the transaction commits (as `setSeats` does today). Any failure leaves everything unchanged.

### 3. Users page

- Per-user menu: **Deactivate** (with the same open-jobs step when needed) and, for deactivated users, **Reactivate**.
- Deactivated users are shown in a collapsed "Deactivated (n)" group at the bottom of the list, with deactivated date.
- Reactivating a seat-counting user when active drivers ≥ paid seats prompts: "Reactivating X needs 1 more user, $Y/month from your next bill. Add a user and reactivate?" One confirm does both (`reactivate` with `addSeat: true`).
- Dispatch/admin users are not seats: deactivating or reactivating them never changes billing and they never appear in the Billing picker.

### 4. API

Under the existing admin team routes:

- `GET /team/:id/open-jobs` → `{ count, jobs: [{ id, title, scheduledAt, status }] }`
- `POST /team/:id/deactivate` body `{ reassignTo?: userId | null }` (`null` = unassign; omitted = must have zero open jobs) → `{ ok, deactivatedAt }`
- `POST /team/:id/reactivate` body `{ addSeat?: boolean }` → `{ ok, seats }`; returns 409 `{ code: "seat_required", seatsNeeded, monthlyDelta }` when a seat is needed and `addSeat` is not set.

Under billing:

- `POST /billing/downsize` body `{ seats, deactivate: [userId], reassign: { [userId]: userId | null } }` → `{ seats, deactivated: [userId] }`.
- `GET /billing` summary gains `excessActive` (= max(0, activeDrivers − seats)) and `seatCandidates` is served by `GET /billing/seat-candidates` (the picker list) to keep the summary light.

All actions write audit log entries (`team.deactivate`, `team.reactivate`, `billing.downsize`) and call `queueCompanySync` so HubSpot's driver count follows.

### 5. Data

Migration `0015_user_deactivation`: `ALTER TABLE memberships ADD COLUMN deactivated_at timestamptz`. No other schema change; the states already exist.

### 6. Testing

- Unit: open-jobs detection, guard rules (self, last admin, admin-tier), seat-needed calculation on reactivate, downsize transaction rollback on failure.
- Route tests in the repo's existing mock style for the three team routes and `downsize`.
- Manual: Billing stepper → picker → confirm; Users page deactivate with open jobs → reassign → confirm; reactivate with and without seat prompt; deactivated user attempts sign-in and sees no company.

## Out of scope

Scheduled (end-of-period) deactivation; notifying deactivated users; changes to the delete flow; proration.
