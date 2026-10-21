# ArrivePing mobile: Office mode for dispatchers, managers and superadmins

**Status:** Proposed — awaiting Dan's review
**Date:** 2026-10-21
**Tier:** Build spec (architectural)
**Deciders:** Dan Rosenblat
**Repo:** rempsen/ArrivePingDRv1 — `packages/mobile` (Expo 54, expo-router 6, RN 0.81), API in `packages/web` (Hono)

## 1. Intent

Give office users (superadmin, admin, manager, dispatcher, project_manager) their own experience in the ArrivePing app: a lightweight, mobile-first version of the web console, so a dispatcher at a 3–5 technician shop can run the day from a phone. The technician/driver experience is untouched.

**Success looks like:** from a phone, an office user can (1) see who is on route, on site, available, busy or off; (2) create a work order in under a minute, pick a client, and assign it to an available tech or schedule it for one to accept later; (3) message any tech or broadcast to all; (4) handle a late or unassigned job without opening a laptop.

### Stated (Dan, 2026-10-21)
- Driver/tech build stays as is.
- Office roles get distinct utilities, menus and functionality.
- Quick-create work order: client, service, address, time window, priority, notes, assign. Pricing, custom fields and forms stay on the web.
- One office mode, permission-gated. Superadmin adds company switching.
- A person with both a rider record and an office role gets a mode switch.
- iOS phone first; iPad and Android follow.
- Phone and iPad are both in use by dispatchers.

### Assumed (correct me)
- Native screens in the existing Expo app, not a WebView.
- Same dark ArrivePing theme and `components/ui.tsx` kit as the tech screens.
- Office users share the company switcher, biometric lock and push plumbing already in the app.
- No new paid tools. Cost of this work is build time only.

## 2. What exists today (verified in code, 2026-10-21)

| Area | State | Consequence |
|---|---|---|
| App boot (`app/index.tsx`) | Admits only `rider` and `admin`; everyone goes to the `(rider)` tabs | Managers and dispatchers cannot sign in; admins land in the tech UI |
| Backend guards | `requireAdmin = requireOffice` (admin, manager, dispatcher, project_manager, superadmin) | Dispatch board, load, candidates, assign, schedule, undo, SSE stream and dispatcher↔tech messaging already serve every office role |
| Permissions | `api/lib/permissions.ts`, `GET /api/me/access` returns resolved keys (`work_orders:create`, `scheduler:edit`, …; `*` for admin) | Mobile can gate actions with the same keys the web uses |
| Work order create | `POST /api/bookings/admin` (`BookingAdminCreate`): existing client or name+email, service, scheduledAt, address, priority, notes, optional `riderId`, `force` | Quick create needs no new endpoint |
| Dispatch | `GET /api/dispatch/board?day=` returns `techs[]` with `status` (offline/available/enroute/onsite/break/busy), `freeAt`, `currentJobId`, and `jobs[]` with `assignStatus`, `late`, `riderId` | Dashboard counts and job lists derive from one call |
| Assignment | `POST /api/dispatch/assign` and `/schedule` return `{ job, undo }`; 409 with `forceable` on conflicts; `GET /dispatch/candidates?jobs=` ranks techs | Assign flow with Undo is API-complete |
| Messaging | `GET /api/messages/dispatch/threads`, `/dispatch/:techId`, `POST /dispatch/:techId`, `/broadcast`, `/direct/unread` | Dispatcher inbox is API-complete |
| Clients, services, address | `GET /api/directory` (search/sort), `GET /api/services`, `GET /api/geo/autocomplete|details|geocode` | Pickers are API-complete |
| Realtime | `react-native-sse` already a dependency; `lib/live-messages.ts` subscribes to message events | Reuse for the dispatch stream |
| Release | `eas.json` has iOS production/preview/development; no Android profile; `ship:ios` script | Android is a follow-on with its own EAS profile and Play listing |

Net: this is mostly app work. The one backend gap is role-aware push registration and the office-side notification events (unassigned job, late job, tech message), covered in §6.

## 3. ADR: how to deliver office mode

### Options

**A. Native screens in the existing Expo app (recommended)**
New `(office)` route group beside `(rider)`, sharing auth, company switcher, theme, push, SSE and the typed Hono client.

| Dimension | Assessment |
|---|---|
| Complexity | Medium–high: ~8 screens, 1 wizard, 2 hooks |
| Cost | Build time only; no new subscriptions |
| UX quality | Native, mobile-first, matches the tech app |
| Store risk | None; adds real functionality |
| Maintenance | A second dispatch UI to keep in step with the web's API, but the API is already shared |

**B. WebView of the responsive web console inside the app**
| Dimension | Assessment |
|---|---|
| Complexity | Low to ship, high to make good |
| Cost | Build time only |
| UX quality | Poor: Map v2 and the scheduler are drag-and-drop desktop surfaces; cookie/session bridging; no native push routing |
| Store risk | Apple guideline 4.2 (minimum functionality) and a "website in a box" feel |
| Maintenance | Low |

**C. Point office users at the installable web app (PWA already exists)**
| Dimension | Assessment |
|---|---|
| Complexity | None |
| Cost | None |
| UX quality | Same desktop surfaces on a phone; iOS PWA push and background behaviour are weaker |
| Store risk | Does not meet the goal: no improvement to the App Store / Play Store product |

### Decision
**A**, with one escape hatch: any office task not built natively (full work-order edit, reports, settings, automation) opens the web console in the system browser at the matching URL, with the current company preselected. That keeps phase 1 small without dead ends.

### Rejected
- B: fast but would ship a worse experience than the PWA Dan already has.
- C: does not address the request.

## 4. System design

### 4.1 Roles, modes and routing

```
sign-in ─► index.tsx (session + biometric gate)
            │
            ▼
       pick-company (unchanged; auto-skips for single-company users)
            │
            ▼
     resolveMode(membership role, rider record, saved preference)
            ├─ "field"  ─► /(rider)   (unchanged)
            └─ "office" ─► /(office)
```

- `lib/app-mode.ts`: `resolveMode()` returns `"field" | "office"`. Office roles: `superadmin, admin, manager, dispatcher, project_manager`. A user who is both (office role plus a rider record at this company) gets the saved preference (SecureStore `app_mode`), defaulting to office. Rider-only users never see office; office-only users never see field.
- The mode switch lives in Profile for dual-role users only, labelled "Switch to field mode" / "Switch to office mode". Switching to field mode runs the existing rider layout, including shift tracking.
- Company switch stays in Profile (both modes). Superadmin sees every company they can open, the same list the web shows.
- `app/index.tsx` admits office roles; customers remain blocked.

### 4.2 Office navigation (4 tabs + header menu)

| Tab | Screen | Purpose | Gated by |
|---|---|---|---|
| Today | `(office)/index.tsx` | Status tiles, needs-attention list, next up | `work_orders:view` or `scheduler:view` |
| Jobs | `(office)/jobs.tsx` | Segmented list (Unassigned · Scheduled · In progress · Done), search, "New job" FAB | `work_orders:view`; FAB on `work_orders:create` |
| Messages | `(office)/messages.tsx` | Tech threads with unread counts, broadcast | office role (same as web) |
| Team | `(office)/team.tsx` | Techs by status with last-seen, current job, call/text/message | `techs:view` |

Header avatar opens Profile (company, mode, notifications, sign out). Tabs whose view permission is missing are hidden; the Today tab always shows at least the team status so the app is never empty.

### 4.3 Screens

**Today**
- Four tiles from `board.techs[].status`: On route (`enroute`), On site (`onsite`), Available, Busy/Break; Off shift shown as a count under the tiles. Tap a tile → Team filtered to that status.
- "Needs attention": `jobs[].late === true` and `assignStatus` unassigned for today, each with Assign and Message actions inline.
- "Next up": the next 5 scheduled jobs with tech name and ETA.
- Pull to refresh; live via the dispatch stream (§4.5).

**Jobs**
- `GET /dispatch/board?day=<today>&days=1` for today; a day picker (yesterday … +7) for the rest; 7-day load counts from `GET /dispatch/load` as small badges on the picker.
- Row: time, customer, service, address line, tech chip (or "Unassigned"), late badge.
- Search filters client-side on the loaded day (customer, address, title). Full search stays on the web.

**Job detail** `office/job/[id].tsx`
- Customer, phone (tap to call), address (tap for Maps), service, duration, priority, notes and staff notes, status timeline, assigned tech with status.
- Actions by permission: **Assign / Reassign** (candidates sheet), **Reschedule** (date-time sheet → `/dispatch/schedule`), **Message tech**, **Cancel** (`work_orders:edit`), **Open in web** (full edit).
- Conflicts: a 409 with `forceable: true` shows a confirm sheet with the server's reason ("Sam is on a job until 2:40 PM"); confirm re-sends with `force: true`.
- Every assign/schedule success shows a 10-second Undo toast backed by the returned `undo` token → `/dispatch/undo`.

**New job** `office/new-job.tsx` (one screen, four stacked cards; no multi-step wizard)
1. **Client**: search `GET /directory?q=` as they type; "Add new" expands name + email + phone (server find-or-creates).
2. **What**: service from `GET /services` (grouped by category); title and priority (default from service); notes.
3. **Where & when**: address with `GET /geo/autocomplete` → `details`; client's last address prefilled when known; date-time picker with "ASAP" (now, rounded up to 15 min) and "Schedule" (date + time) choices.
4. **Who**: after the above are set, `GET /dispatch/candidates` is not callable (job doesn't exist yet), so the sheet lists `board.techs` for that day sorted available → free-soonest → busy, with status and `freeAt`. Choices: a tech (sends `riderId`), or **Offer later** (no `riderId`; the job lands Unassigned and the existing automation/offer flow applies).
Submit → `POST /bookings/admin`; 409 forceable → confirm sheet; success → job detail with Undo toast when a tech was chosen.

**Messages** `(office)/messages.tsx` and `office/thread/[techId].tsx`
- Threads from `GET /messages/dispatch/threads` sorted unread-first; row shows tech status dot, last message, time.
- Thread view reuses the tech app's message bubbles and composer; sends `POST /messages/dispatch/:techId`; marks read on open.
- Broadcast sheet (`POST /messages/broadcast`): to everyone on shift or a chosen set.
- Live via `lib/live-messages.ts` (already subscribed to message events) plus the unread poll it uses today.

**Team** `(office)/team.tsx`
- Sections by status; each row: avatar, name, status, last location age ("2 min ago" / "stale"), current job and `freeAt`, open-job count. Actions: call, text (SMS), message in app, see on map (Apple/Google Maps at their last lat/lng).
- Read-only in phase 1 (no shift toggling or invites from mobile).

**Profile** (office)
- Company switch, mode switch (dual-role only), notification toggles for the three office events, sign out. Reuse `(rider)/profile.tsx` pieces; no headshot or availability toggle.

### 4.4 Data flow

```
┌──────────────┐   GET /dispatch/board?day     ┌─────────────────────┐
│ (office) tabs│◄──────────────────────────────│ Hono API (web pkg)  │
│  react-query │   GET /messages/dispatch/*    │ loadBoard, dispatch │
│  cache       │◄──────────────────────────────│ services, messages  │
│              │   POST assign/schedule/undo   │                     │
│              │──────────────────────────────►│  ┌───────────────┐  │
│              │   POST /bookings/admin        │  │ Postgres      │  │
│              │──────────────────────────────►│  │ (Supabase)    │  │
│              │                               │  └───────────────┘  │
│  useDispatch │   SSE /dispatch/stream        │                     │
│  Stream ─────│◄══════════════════════════════│ per-tenant fan-out  │
└──────────────┘  {techs, jobs, locations|all} └─────────────────────┘
```

- System of record: the API. The app holds only react-query caches and two SecureStore values (`active_company_id`, `app_mode`).
- `lib/use-dispatch-stream.ts`: opens the SSE stream while the office tabs are mounted and the app is foregrounded; on an event with job or tech ids it invalidates `["board", day]`; on `everything` it refetches. Closes on background; on resume refetches once and reopens. Falls back to 30-second polling if the stream fails twice.
- All office queries carry `X-Company-Id` through the existing header callback, so company switching needs no new code.

### 4.5 Permissions and safety

- `GET /me/access` loads once per company into `usePermissions()`; `can("work_orders:create")` gates FABs and action buttons. The server enforces every action regardless, so a stale cache can only hide a button, never grant one.
- Customer data shown in office mode is the same set the web shows to that role; nothing new is exposed.
- No HubSpot or analytics event carries tenant customer data (standing rule).
- Phone numbers are launched via `tel:`/`sms:` links; the app never stores them.

### 4.6 Notifications (backend gap)

- `services/dispatch.ts` already has a `Recipient = "client" | "tech" | "office"` and `officeUsers(companyId)`, so office-targeted events exist. `lib/push.ts` registers any signed-in user's device. Gap to verify in phase 4: that office recipients receive the push channel (not only in-app/email) and that the three events below are wired as office events.
- Office events to deliver as push: new unassigned work order, job running late, message from a tech. Tapping opens the job or thread (extend the existing `router.push` handling in `push.ts`, which currently only knows rider routes).
- Quiet hours and channel switches from Notifications settings apply unchanged.

### 4.7 Failure handling

| Case | Behaviour |
|---|---|
| Offline | Existing `OfflineBanner`; lists show cached data with a stale timestamp; create/assign buttons disabled |
| 409 forceable | Confirm sheet with the server's reason; retry with `force` |
| 409 not forceable / 404 | Toast with the server message; refetch board |
| Assign raced by someone else (`expectRiderId` mismatch) | Toast "Already assigned to X", refetch |
| Stream drops | Reconnect with backoff; poll after two failures |
| Permission 403 | Toast "Your role can't do that"; hide the control after refetching `/me/access` |

### 4.8 iPad and Android

- Phase 1 layouts use a max content width (720 pt) centred on wide screens so iPad is usable without a split view. Split view (Jobs list + detail) is a follow-on.
- Android follow-on: add `android` blocks to `eas.json` profiles, Play listing, test `expo-location` foreground behaviour for office users (no background tracking in office mode), and `expo-notifications` channel setup.

### 4.9 Testing

- Unit (bun test, `packages/mobile/lib/__tests__`): `resolveMode()` cases (rider-only, office-only, dual with/without preference); dashboard tally from a board fixture; candidate ordering for the Who sheet; quick-create payload builder (ASAP rounding, new vs existing client).
- Typecheck: `bun run typecheck` in `packages/mobile`.
- Manual on Expo Go / TestFlight with the demo tenant: each flow in §4.3 as a dispatcher, a manager with reduced permissions, an admin, and a dual-role user.
- Web regression: none expected; backend changes limited to push recipients.

## 5. Scaffolding

```
packages/mobile/
  app/
    index.tsx                      # admit office roles, route by resolveMode()
    (office)/
      _layout.tsx                  # tabs: Today, Jobs, Messages, Team; header avatar
      index.tsx                    # Today
      jobs.tsx
      messages.tsx
      team.tsx
    office/
      job/[id].tsx
      new-job.tsx
      thread/[techId].tsx
      profile.tsx
  components/
    office/
      status-tiles.tsx
      job-row.tsx
      tech-row.tsx
      assign-sheet.tsx             # candidates/techs list + force confirm
      datetime-sheet.tsx           # ASAP / schedule picker
      client-picker.tsx
      service-picker.tsx
      address-field.tsx            # geo autocomplete
      undo-toast.tsx
  lib/
    app-mode.ts                    # resolveMode, get/setMode
    use-permissions.ts             # /me/access cache + can()
    use-board.ts                   # board + load queries, tallies
    use-dispatch-stream.ts         # SSE → invalidation
    office-nav.ts                  # open-in-web URL builder
    __tests__/app-mode.test.ts, board-tallies.test.ts, new-job-payload.test.ts
packages/web/src/
  services/notify-office.ts (or extend dispatch.ts fireEvent recipients)
  api/routes/me.ts                 # (if needed) expose rider-record flag for dual-role detection
```

No new packages. Existing: expo-router, @tanstack/react-query, react-native-sse, phosphor-react-native, expo-secure-store.

## 6. Phases

1. **Shell and mode** — admit office roles, `resolveMode`, `(office)` tabs with Today and Team, permissions hook, dispatch stream. Ships a usable status board.
2. **Jobs** — Jobs list, job detail, assign/reassign with Undo, reschedule, open-in-web.
3. **Quick create** — New job screen with client, service, address, when, who.
4. **Messages** — threads, thread view, broadcast; office push events and deep links.
5. **Polish and release** — iPad-safe widths, coach marks for office mode, TestFlight pass, App Store notes.
6. **Follow-on** — Android EAS profile and Play listing; iPad split view; full work-order edit.

Each phase is independently shippable to TestFlight. PRs need Dan's approval to merge, as always.

## 7. Risks and open questions

- **Dual-role detection**: `GET /riders/me` self-creates a rider record for any caller (riders.ts ~113), so office mode must never call it. Use the membership's `staffType` from `GET /me/companies` (already returned) as the "works in the field here" signal; verify that office users who also run calls have it set, and add it to the create-employee flow on the web if not.
- **Background location**: office mode must never start the rider location heartbeat. `(office)/_layout.tsx` does not mount `useLocationHeartbeat`; switching modes must stop it.
- **Office push delivery**: the `office` recipient class exists; confirm push (not just in-app) reaches it for the three events, otherwise phase 4 adds that channel.
- **Board size**: `BOARD_JOB_LIMIT` truncation exists; the app shows the `truncated` flag as "showing first N".
- Not asked, assumed no: shift toggling, invites, or tech editing from mobile in this round.

## 8. Cost

$0 in new tools or subscriptions. Apple developer and EAS plans are already in place. Android adds a one-time Play Console fee (US$25) when that follow-on starts.

## 9. Evidence

- Code verified 2026-10-21 in `rempsen/ArrivePingDRv1` main (6826917): routes, guards, schemas and the mobile app listed in §2 (Personally tested: read, not executed).
- Knowledge store (159 entries, 8,660 notes): searched "expo react native dispatch mobile app" and "field service dispatch app". No entries or workflows bear on this decision; the stack is already chosen and no new tool is needed. No upserts.
