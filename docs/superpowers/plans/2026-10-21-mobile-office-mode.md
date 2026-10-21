# Mobile Office Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office users (superadmin, admin, manager, dispatcher, project_manager) get their own tabs in the ArrivePing Expo app: a live status board, jobs with assign/reschedule, quick work-order creation, and dispatcher messaging. Technician screens are untouched.

**Architecture:** A new `(office)` expo-router tab group beside `(rider)`, chosen at boot by `resolveMode()`. All data comes from existing office endpoints (`/dispatch/*`, `/bookings/admin`, `/messages/dispatch/*`, `/directory`, `/services`, `/geo/*`, `/me/access`, `/me/companies`) through the typed Hono client; the dispatch SSE stream invalidates react-query caches. Permissions from `/me/access` gate controls; the server enforces them.

**Tech Stack:** Expo 54, expo-router 6, React Native 0.81, @tanstack/react-query 5, react-native-sse, phosphor-react-native, expo-secure-store, bun test.

**Spec:** `docs/superpowers/specs/2026-10-21-mobile-office-mode-design.md`

## Global Constraints

- Technician flow (`app/(rider)/**`, `app/job/[id].tsx`) is not modified except where a shared helper is extracted.
- Office mode never calls `GET /riders/me` (it self-creates a rider record) and never mounts `useLocationHeartbeat`.
- Dark theme tokens from `lib/theme.ts` (`C`, `R`, `S`, `WIDE`) only; no new colour or radius literals.
- No new npm packages.
- Every mutation surfaces the server's `message` on failure; 409 `forceable` gets a confirm sheet.
- Typecheck (`bun run typecheck` in `packages/mobile`) and `bun test packages/mobile/lib/__tests__` must pass before each PR.
- One PR per phase, stacked; Dan merges.

## Review Focus

1. A dual-role user whose membership has `staffType` but who last used office mode must land in office mode, and switching to field mode must start the rider layout without a sign-out. Test in `app-mode.test.ts`.
2. A dispatcher without `work_orders:create` sees no "New job" button but every list still renders. Test in `use-permissions.test.ts` (`can()` with and without `*`).
3. Board tallies ignore techs with `status: "offline"` for Available and count `break` as Busy; late jobs appear once even when also unassigned. Test in `board-tallies.test.ts`.
4. "ASAP" in New job rounds up to the next 15-minute mark in the company's time and never produces a past time. Test in `new-job-payload.test.ts`.
5. The dispatch stream must close on background and reopen on foreground without duplicate subscriptions; polling takes over after two failed connections. Covered by a reducer test in `dispatch-stream.test.ts` (connection state machine only; no sockets).

---

## Phase 1 — Shell, mode and status board (PR 1)

### Task 1: App mode resolver

**Files:**
- Create: `packages/mobile/lib/app-mode.ts`
- Test: `packages/mobile/lib/__tests__/app-mode.test.ts`

**Interfaces:**
- Produces: `type AppMode = "field" | "office"`; `OFFICE_ROLES: ReadonlySet<string>`; `isOfficeRole(role: string | null | undefined): boolean`; `resolveMode(input: { role: string; staffType: string | null | undefined; saved: AppMode | null }): { mode: AppMode; canSwitch: boolean }`; `getSavedMode(): AppMode | null`; `setSavedMode(m: AppMode): void` (SecureStore key `app_mode`, same sync pattern as `lib/active-company.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { resolveMode } from "../app-mode";
test("rider only → field, no switch", () => {
  expect(resolveMode({ role: "rider", staffType: "technician", saved: null })).toEqual({ mode: "field", canSwitch: false });
});
test("dispatcher only → office, no switch", () => {
  expect(resolveMode({ role: "dispatcher", staffType: null, saved: "field" })).toEqual({ mode: "office", canSwitch: false });
});
test("dual role defaults to office, honours saved", () => {
  expect(resolveMode({ role: "admin", staffType: "technician", saved: null })).toEqual({ mode: "office", canSwitch: true });
  expect(resolveMode({ role: "admin", staffType: "driver", saved: "field" })).toEqual({ mode: "field", canSwitch: true });
});
test("superadmin and project_manager are office", () => {
  expect(resolveMode({ role: "superadmin", staffType: null, saved: null }).mode).toBe("office");
  expect(resolveMode({ role: "project_manager", staffType: null, saved: null }).mode).toBe("office");
});
```

- [ ] **Step 2: Run** `cd packages/mobile && bun test lib/__tests__/app-mode.test.ts` → FAIL (module not found)
- [ ] **Step 3: Implement** `lib/app-mode.ts` per the interface. `OFFICE_ROLES = new Set(["superadmin","admin","manager","dispatcher","project_manager"])`.
- [ ] **Step 4: Run** the test → PASS
- [ ] **Step 5: Commit** `feat(mobile): app mode resolver`

### Task 2: Permissions hook

**Files:**
- Create: `packages/mobile/lib/use-permissions.ts`
- Test: `packages/mobile/lib/__tests__/use-permissions.test.ts`

**Interfaces:**
- Produces: `type Access = { role: string; admin: boolean; superadmin: boolean; office: boolean; permissions: string[] }`; `makeCan(perms: readonly string[]): (key: string) => boolean` (true when `perms` contains `"*"` or `key`; `"<module>:view"` is also satisfied by any other action on that module); `ACCESS_KEY = ["me","access"]`; `useAccess(): { data?: Access; isLoading: boolean; can: (key: string) => boolean }` querying `api.me.access.$get()`.

- [ ] **Step 1: Test** `makeCan(["*"])("anything")` true; `makeCan(["work_orders:edit"])("work_orders:view")` true; `makeCan(["work_orders:edit"])("work_orders:create")` false; `makeCan([])("techs:view")` false.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** (`makeCan` pure; `useAccess` wraps `useQuery` with `staleTime: 60_000`).
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(mobile): permissions hook`

### Task 3: Board query and tallies

**Files:**
- Create: `packages/mobile/lib/use-board.ts`
- Test: `packages/mobile/lib/__tests__/board-tallies.test.ts`

**Interfaces:**
- Consumes: `Board`, `BoardTech`, `BoardJob` types imported from `@template/web` (export them from `packages/web/src/services/dispatch-board.ts` via the package's type entry if not already reachable; otherwise redeclare minimal local types `OfficeTech`, `OfficeJob` with the fields used).
- Produces: `boardKey(day: string) => ["board", day]`; `useBoard(day: string)` → `useQuery` of `api.dispatch.board.$get({ query: { day, days: "1" } })`, `refetchInterval` 30 s when the stream is down (reads `streamHealthy` from Task 4), `staleTime` 10 s; `tallies(techs: BoardTech[]): { enroute: number; onsite: number; available: number; busy: number; offline: number }` (busy = `busy` + `break`); `needsAttention(jobs: BoardJob[]): BoardJob[]` (late first, then unassigned, de-duplicated, sorted by `scheduledAt`); `todayKey(tz: string): string` (YYYY-MM-DD in `tz` via `Intl.DateTimeFormat`).

- [ ] **Step 1: Test** tallies from a fixture of six techs; `needsAttention` de-dupes a late+unassigned job; `todayKey("America/Winnipeg")` matches `/^\d{4}-\d{2}-\d{2}$/`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(mobile): board query and tallies`

### Task 4: Dispatch stream hook

**Files:**
- Create: `packages/mobile/lib/use-dispatch-stream.ts`
- Test: `packages/mobile/lib/__tests__/dispatch-stream.test.ts`

**Interfaces:**
- Produces: `streamReducer(state, action)` with `state: { status: "idle"|"open"|"down"; failures: number }`, actions `open | error | close | reset`; `down` once `failures >= 2`; `useDispatchStream(day: string, enabled: boolean)` opens `EventSource` on `${API}/api/dispatch/stream` (same header pattern as `lib/live-messages.ts`), listens for `patch` events (`{ techs?: string[]; jobs?: string[]; everything?: boolean }` — confirm the exact event name and payload in `packages/web/src/api/routes/dispatch.ts` lines 150–220 before coding) and calls `queryClient.invalidateQueries({ queryKey: boardKey(day) })`; closes when `AppState` is not `active` and reopens on `active`; exports `useStreamHealthy()` via a tiny module-level store.

- [ ] **Step 1: Test** the reducer: two errors → `down`; `open` resets failures; `reset` → idle.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS; `bun run typecheck` clean
- [ ] **Step 5: Commit** `feat(mobile): dispatch stream hook`

### Task 5: Boot routing and office layout

**Files:**
- Modify: `packages/mobile/app/index.tsx` (role gate), `packages/mobile/app/pick-company.tsx` (route by mode after company chosen), `packages/mobile/app/_layout.tsx` (register `(office)` and `office/*` screens)
- Create: `packages/mobile/app/(office)/_layout.tsx`, `packages/mobile/app/(office)/index.tsx`, `packages/mobile/app/(office)/jobs.tsx` (placeholder list, finished in Phase 2), `packages/mobile/app/(office)/messages.tsx` (placeholder, Phase 4), `packages/mobile/app/(office)/team.tsx`, `packages/mobile/app/office/profile.tsx`
- Create: `packages/mobile/components/office/status-tiles.tsx`, `packages/mobile/components/office/tech-row.tsx`, `packages/mobile/components/office/job-row.tsx`, `packages/mobile/components/office/header.tsx`

**Interfaces:**
- Consumes: Tasks 1–4.
- `index.tsx`: admit `isOfficeRole(role) || role === "rider"`.
- `pick-company.tsx`: after selecting a company, read its membership `{ role, staffType }`, call `resolveMode({ role, staffType, saved: getSavedMode() })`, `router.replace(mode === "office" ? "/(office)" : seen ? "/(rider)" : "/onboarding")`.
- `(office)/_layout.tsx`: `Tabs` with Today (`House`), Jobs (`ClipboardText`), Messages (`ChatCircleDots`), Team (`UsersThree`); header right avatar → `/office/profile`; mounts `usePushNotifications()`, `useDispatchStream(today, true)`; hides Jobs when `!can("work_orders:view") && !can("scheduler:view")`, Team when `!can("techs:view")`. Does NOT mount `useLocationHeartbeat` or `useCoach`.
- `(office)/index.tsx`: `StatusTiles` (4 tiles + off-shift line), "Needs attention" (`JobRow` with Assign/Message buttons, actions wired in Phase 2; disabled until then), "Next up" (5 rows). Pull to refresh.
- `(office)/team.tsx`: sections by status order enroute, onsite, available, busy, break, offline; `TechRow` shows avatar (`Avatar`), name, `StatusBadge`, last-seen age, current job title, `freeAt`; actions `tel:`, `sms:`, open Maps (`maps://?q=lat,lng` on iOS, `geo:` on Android via `Linking`), Message (routes to Phase 4 thread; hidden until then).
- `office/profile.tsx`: company switcher (reuse the block from `(rider)/profile.tsx` — extract `components/company-switcher.tsx` if it is not already a component), mode switch button when `canSwitch` (`setSavedMode("field")` then `router.replace("/(rider)")`), sign out (reuse `clearToken` flow).
- `components/office/header.tsx`: company name + avatar button; iPad-safe via `WIDE`.

- [ ] **Step 1: Implement** files above; no unit tests for screens (manual pass).
- [ ] **Step 2: Run** `bun run typecheck` → clean; `bun test lib/__tests__` → pass
- [ ] **Step 3: Manual** Expo Go: sign in as admin (demo tenant) → lands on Today with tiles; Team lists techs; switch company; dual-role switch to field and back.
- [ ] **Step 4: Commit** `feat(mobile): office mode shell with Today and Team`
- [ ] **Step 5: Open PR 1** against main: "Mobile office mode (1/4): shell, Today, Team"

## Phase 2 — Jobs, job detail, assign and reschedule (PR 2, stacked on PR 1)

### Task 6: Jobs list with day picker

**Files:**
- Modify: `packages/mobile/app/(office)/jobs.tsx`
- Create: `packages/mobile/components/office/day-strip.tsx`
- Create: `packages/mobile/lib/use-day-load.ts`

**Interfaces:**
- `useDayLoad(from: string)` → `api.dispatch.load.$get({ query: { from, days: "8" } })`; returns `Record<day, number>` of job counts (confirm the `loadDayLoad` shape in `services/dispatch-board.ts`).
- `DayStrip({ day, onChange, counts })`: horizontal 8-day strip from yesterday; today highlighted.
- `jobs.tsx`: segment control Unassigned | Scheduled | In progress | Done over `useBoard(day)`; filter by `assignStatus`/`status` using `shared/job-status.ts` constants from `@template/web`; search box filters client-side on customer, address, title; FAB "New job" visible when `can("work_orders:create")` → `/office/new-job` (Phase 3; until then the FAB is hidden).

- [ ] **Step 1: Implement**
- [ ] **Step 2: Typecheck + tests pass**
- [ ] **Step 3: Commit** `feat(mobile): office jobs list`

### Task 7: Job detail with assign, reschedule, undo

**Files:**
- Create: `packages/mobile/app/office/job/[id].tsx`, `packages/mobile/components/office/assign-sheet.tsx`, `packages/mobile/components/office/datetime-sheet.tsx`, `packages/mobile/components/office/undo-toast.tsx`, `packages/mobile/lib/use-dispatch-actions.ts`
- Test: `packages/mobile/lib/__tests__/dispatch-actions.test.ts`

**Interfaces:**
- `useDispatchActions(day)` → `{ assign(bookingId, riderId, opts?: { force?: boolean; forceBusy?: boolean; expectRiderId?: string | null }), schedule(bookingId, scheduledAtIso, opts?: { force?: boolean }), undo(token) }`; each returns `{ ok: true; job; undo? } | { ok: false; status: number; message: string; forceable?: boolean; reason?: string }` and invalidates `boardKey(day)` and `["booking", id]` on success. Pure helper `classifyFailure(res: Response, body: unknown)` tested.
- `AssignSheet({ bookingId, currentRiderId, onDone })`: fetches `api.dispatch.candidates.$get({ query: { jobs: bookingId } })`, lists `DispatchCandidate` joined with board techs (name, photo, status) ordered by `score`, shows `reason`, `best` badge; tapping calls `assign`; on `forceable` shows `Alert.alert(reason, …, [Cancel, "Assign anyway"])` → `force: true`.
- `DatetimeSheet({ value, onPick })`: date (next 14 days chips) + time (15-min list) — no native picker dependency; "ASAP" chip.
- `UndoToast`: module-level `showUndo({ label, token, onUndo })` rendered once in `(office)/_layout.tsx`; 10 s auto-dismiss.
- `office/job/[id].tsx`: `api.bookings[":id"].$get`; header, customer card (call), address card (Maps), service card, tech card (status, Message → Phase 4), status timeline from `booking.history` if present, Notes/Staff notes; action bar by permission: Assign/Reassign (`work_orders:edit`), Reschedule (`scheduler:edit`), Cancel (`work_orders:edit`, `PATCH /bookings/:id {status:"cancelled"}` — confirm the exact status value in `shared/job-status.ts`), Open in web (`Linking.openURL(webUrl("/admin/scheduler?job=" + id))` using `lib/office-nav.ts` `webUrl(path)` = `extra.webUrl ?? apiUrl` + path).

- [ ] **Step 1: Test** `classifyFailure` for 409 forceable, 409 plain, 404, 500.
- [ ] **Step 2: Run** → FAIL; implement; → PASS
- [ ] **Step 3: Wire** Today's "Needs attention" Assign button to `AssignSheet`.
- [ ] **Step 4: Typecheck; manual** assign, force path, undo, reschedule on demo tenant.
- [ ] **Step 5: Commit** `feat(mobile): office job detail with assign, reschedule, undo`; **open PR 2** (base: PR 1 branch)

## Phase 3 — Quick create (PR 3)

### Task 8: New job payload builder

**Files:**
- Create: `packages/mobile/lib/new-job-payload.ts`
- Test: `packages/mobile/lib/__tests__/new-job-payload.test.ts`

**Interfaces:**
- `type NewJobDraft = { client: { id: string } | { name: string; email: string; phone?: string } | null; serviceId: string | null; title: string; priority: "low"|"normal"|"high"|"urgent"|""; notes: string; address: string; lat: number | null; lng: number | null; when: { kind: "asap" } | { kind: "at"; iso: string }; riderId: string | null }`
- `asapTime(now: Date): string` → ISO rounded up to the next 15 min.
- `buildAdminBooking(draft: NewJobDraft, now: Date): { ok: true; body: BookingAdminCreateInput } | { ok: false; errors: Partial<Record<keyof NewJobDraft, string>> }` where `BookingAdminCreateInput` is the inferred input of `BookingAdminCreate` exported from `@template/web` (add `export type` in `api/routes/bookings.ts` if missing).

- [ ] **Step 1: Test** ASAP rounding (10:07 → 10:15; 10:15 → 10:15; 10:59 → 11:00); missing client → error; existing vs new client body shapes; `riderId` null omitted.
- [ ] **Step 2–4:** FAIL → implement → PASS
- [ ] **Step 5: Commit** `feat(mobile): new job payload builder`

### Task 9: New job screen

**Files:**
- Create: `packages/mobile/app/office/new-job.tsx`, `packages/mobile/components/office/client-picker.tsx`, `packages/mobile/components/office/service-picker.tsx`, `packages/mobile/components/office/address-field.tsx`, `packages/mobile/components/office/tech-picker.tsx`

**Interfaces:**
- `ClientPicker({ value, onChange })`: debounced `api.directory.$get({ query: { q, kind: "customer", pageSize: "20" } })`; rows name + phone + property; "Add new client" expands name/email/phone.
- `ServicePicker({ value, onChange })`: `api.services.$get()` grouped by `category`; selecting sets `title` default and `priority` default when the draft's are empty (field names from the `services` schema).
- `AddressField({ value, onChange })`: debounced `api.geo.autocomplete.$get({ query: { q, sessionToken } })` → predictions; pick → `api.geo.details.$get({ query: { placeId, sessionToken, description } })` → `{ lat, lng, address }`.
- `TechPicker({ day, onChange })`: lists `useBoard(day).techs` ordered available → freeAt asc → busy → offline; row shows status and `freeAt`; "Offer later" option sets `riderId: null`.
- `new-job.tsx`: four cards; Submit calls `buildAdminBooking`; on errors highlights fields; `api.bookings.admin.$post({ json })`; 409 forceable → Alert → retry with `force: true`; success → `router.replace("/office/job/" + id)` and `showUndo` when a tech was chosen (use the `undo` token if `/bookings/admin` returns one; otherwise skip the toast).

- [ ] **Step 1: Implement**; wire the Jobs FAB.
- [ ] **Step 2: Typecheck; manual** create with existing client + ASAP + tech; new client + scheduled + offer later; conflict path.
- [ ] **Step 3: Commit** `feat(mobile): office quick create`; **open PR 3**

## Phase 4 — Messages and office push (PR 4)

### Task 10: Threads, thread view, broadcast

**Files:**
- Modify: `packages/mobile/app/(office)/messages.tsx`
- Create: `packages/mobile/app/office/thread/[techId].tsx`, `packages/mobile/components/office/broadcast-sheet.tsx`
- Extract: message bubble + composer from `app/(rider)/messages.tsx` into `components/message-thread.tsx` (props: `messages`, `mine: (m) => boolean`, `onSend(body)`), used by both rider and office screens without changing rider behaviour.

**Interfaces:**
- `messages.tsx`: `api.messages.dispatch.threads.$get()`; row = tech status dot, name, last message, relative time, unread badge; live via `useLiveMessageSignal("/api/messages/inbox/stream", refetch)`; Broadcast button → `BroadcastSheet` (`target.type` all | available).
- `thread/[techId].tsx`: `api.messages.dispatch[":techId"].$get()`; mark-read on focus; send `POST /dispatch/:techId`; live via the inbox stream signal.
- Wire "Message" actions in Team, Today and Job detail to `/office/thread/<techId>`.

- [ ] **Step 1: Implement**; typecheck; rider messages screen still renders (manual).
- [ ] **Step 2: Commit** `feat(mobile): dispatcher messaging`

### Task 11: Office push routing

**Files:**
- Modify: `packages/mobile/lib/push.ts` (tap handling for `job` and `thread` payloads when in office mode)
- Modify (backend, only if verification shows a gap): `packages/web/src/services/dispatch.ts` so `office` recipients get the push channel for events new-unassigned, running-late, tech-message.

- [ ] **Step 1: Verify** in `services/dispatch.ts` which channels `office` recipients receive; record the finding in the PR.
- [ ] **Step 2: Implement** the gap if any (smallest change; keep quiet hours and channel switches).
- [ ] **Step 3: Implement** tap routing: payload `{ type: "job", id }` → `/office/job/id`; `{ type: "thread", techId }` → `/office/thread/techId`; rider payloads unchanged.
- [ ] **Step 4: Typecheck both packages; `bun test` for web touched tests; commit** `feat: office push events and deep links`; **open PR 4**

## Phase 5 — Polish and release notes (folded into PR 4)

- [ ] iPad: every office screen's scroll container spreads `WIDE`.
- [ ] Office coach: three coach marks (Today tiles, Jobs FAB, Messages) using `components/coach-tour.tsx` with a separate storage key `coach:office:<userId>`.
- [ ] Update `MOBILE_TECH_APP.md` with the office screens and routes.
- [ ] TestFlight notes drafted in the PR description.

## Follow-on (not in this plan)
Android EAS profile + Play listing; iPad split view; full work-order edit; shift toggling and invites from mobile.
