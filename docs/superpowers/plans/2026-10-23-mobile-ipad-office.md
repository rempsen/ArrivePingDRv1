# iPad Office Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ArrivePing app's office mode a real dispatch tool on iPad — split view everywhere, a tap-to-place timeline board, a week capacity view, a live map and a full work-order editor — without changing the phone or technician screens.

**Architecture:** One `useLayout()` decision (`wide`) switches each office tab between the existing phone screen and a `SplitScreen` (list | detail). Detail screens become components so the route and the pane share them. New views (board, week, map, edit) are built on the board query, the dispatch stream and `useDispatchActions` that already exist; every piece of logic that can be pure lives in an RN-free `lib/*.ts` module with bun tests.

**Tech Stack:** Expo 54 / expo-router 6 / RN 0.81 / React 19, @tanstack/react-query 5, expo-device, react-native-maps (phase D only), bun test, oxlint.

**Spec:** `docs/superpowers/specs/2026-10-23-mobile-ipad-office-design.md`

## Global Constraints

- Nothing under `app/(rider)` or `app/job` changes. Office layouts on a phone render exactly as before this plan.
- RN-free modules only in `packages/mobile/lib/*.ts` that bun tests import (no `react-native`, `expo-*` imports).
- CI: `bunx oxlint --deny-warnings` (react-hooks/exhaustive-deps, jsx-a11y: no `autoFocus`), `bunx tsc -b`, `bun test` in `packages/mobile`; frozen `NO_TECHS` / `NO_JOBS` style constants for `?? []` defaults in hooks.
- Permissions gate the UI (`can(...)` from `useAccess()`); the server is the authority.
- Office mode never calls `/riders/me` and never mounts the location heartbeat.
- Commits end with the Claude attribution lines; PRs target `main`; Dan merges.
- Copy: "technician"/"job" nouns come from `board.workerNoun` / `board.jobNoun` where the phone screens already do that.

## Review Focus

1. iPad in narrow Split View (width < 768) must get the phone layout, not a squashed two-pane one — `isWideLayout` test with width 507 and tablet → false (Task A1).
2. Rotating an iPad with a job selected keeps the selection and re-lays out; a selected id that disappears from the list (job cancelled elsewhere) must clear to the empty pane, not crash — `SplitScreen` renders `empty` when `detail` is null (Task A2) and Jobs clears `selectedId` when the board no longer has it (Task A5).
3. Tap-to-place on a tech who is on time off, or on a cancelled/completed job, must not arm or place — reducer tests (Task B2).
4. The 409 on edit save with `forceable: false` (e.g. validation) must show the message and not offer "Save anyway" — `classifyResponse` already distinguishes; edit-screen test on `buildPatch` + manual check (Task E3).
5. The map with zero techs and zero jobs must still render with a sane region (office or continent) — `fitRegion([])` test (Task D1).

---

## Phase A — foundation + split view (`feat/mobile-ipad-1-split`)

### Task A1: Layout decision

**Files:**
- Create: `packages/mobile/lib/layout.ts`, `packages/mobile/lib/use-layout.ts`
- Test: `packages/mobile/lib/__tests__/layout.test.ts`

**Interfaces:**
- Produces: `isWideLayout(width: number, deviceType: "phone" | "tablet" | "unknown"): boolean`; `WIDE_MIN = 768`; `LIST_PANE_W = 380`.
- Produces: `useLayout(): { wide: boolean; width: number; height: number; landscape: boolean }`.

- [ ] Test: `isWideLayout(1024,"tablet")` true; `(507,"tablet")` false; `(1024,"phone")` false; `(800,"unknown")` false.
- [ ] Implement `layout.ts`; `use-layout.ts` reads `useWindowDimensions()` and `Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone"` (`expo-device` is already a dependency).
- [ ] Run `bun test lib/__tests__/layout.test.ts` → pass. Commit `feat(mobile): layout decision for iPad office screens`.

### Task A2: SplitScreen

**Files:**
- Create: `packages/mobile/components/office/split-screen.tsx`

**Interfaces:**
- Produces: `<SplitScreen list: ReactNode; detail: ReactNode | null; empty: ReactNode />` — wide: row with list pane `LIST_PANE_W`, `borderRightWidth: 1, borderRightColor: C.border`, detail `flex: 1` showing `detail ?? empty`; narrow: returns `list` only. Reads `useLayout()` itself.
- Produces: `<EmptyPane icon text sub />` helper (centered, `C.muted`).

- [ ] Implement; no test (pure layout). Commit.

### Task A3: JobDetail + ThreadView as components

**Files:**
- Create: `packages/mobile/components/office/job-detail.tsx`, `packages/mobile/components/office/thread-view.tsx`
- Modify: `packages/mobile/app/office/job/[id].tsx`, `packages/mobile/app/office/thread/[techId].tsx` → thin wrappers

**Interfaces:**
- Produces: `<JobDetail id: string; assign?: boolean; embedded?: boolean />` — the whole body of today's job screen. `embedded` hides the back button and the SafeAreaView top edge (the pane sits under the tab header already).
- Produces: `<ThreadView techId: string; embedded?: boolean />` — likewise; mark-read runs on mount and when `techId` changes (not only on route focus) so selection in the pane acks reads.

- [ ] Move code; routes become `export default function Screen(){ const {id, assign} = useLocalSearchParams(); return <JobDetail id={id} assign={assign==="1"} /> }` (and the thread equivalent).
- [ ] `bunx tsc -b` passes; behaviour on phone unchanged. Commit `refactor(mobile): job and thread screens as reusable office components`.

### Task A4: TechDetail

**Files:**
- Create: `packages/mobile/components/office/tech-detail.tsx`
- Modify: `packages/mobile/lib/board.ts` — add `jobsForTech(jobs, techId)` (sorted by `scheduledAt`, excluding cancelled).
- Test: `packages/mobile/lib/__tests__/board.test.ts` (extend)

**Interfaces:**
- Produces: `<TechDetail techId: string; onMessage(techId): void />` — avatar, status chip + free-at, call/SMS/map buttons (reuse `openMap`, `statusColor` from `tech-row.tsx`), "Message" button, "Today" list of `JobRow`s from `jobsForTech`.

- [ ] Test `jobsForTech` ordering and exclusion. Implement. Commit.

### Task A5: Jobs, Team, Messages in split view

**Files:**
- Modify: `packages/mobile/app/(office)/jobs.tsx`, `team.tsx`, `messages.tsx`

- [ ] Jobs: `const { wide } = useLayout(); const [selectedId, setSelectedId] = useState<string|null>(null)`; row `onPress` → wide ? `setSelectedId(job.id)` : `router.push(...)`; Assign button → wide ? `setSelected + assignFlag` : push with `assign=1`. Wrap in `<SplitScreen list={…} detail={selectedId ? <JobDetail id={selectedId} embedded assign={assignFlag}/> : null} empty={<EmptyPane … "Pick a job" />} />`. Clear `selectedId` in an effect when `board.data` no longer contains it. Selected `JobRow` gets `selected` prop (brand left border) — add the prop to `job-row.tsx`.
- [ ] Team: same pattern with `TechDetail`; `onMessage` → `router.push({ pathname: "/(office)/messages", params: { techId } })`.
- [ ] Messages: `selectedTechId` initialised from the `techId` param when present; detail `<ThreadView techId embedded />`; `TechRow`/inbox row `selected` highlight.
- [ ] oxlint + tsc. Commit `feat(mobile): split view for Jobs, Team and Messages on iPad`.

### Task A6: Today two-column

**Files:**
- Modify: `packages/mobile/app/(office)/index.tsx`

- [ ] When `wide && width >= 1000`: left column (tiles, Needs attention), right column (Next up, crew summary — `tallies` chips + first 8 techs as `TechRow` without actions). Otherwise today's single column. Commit.

### Task A7: iPad orientation

**Files:**
- Modify: `packages/mobile/app.json`

- [ ] Add `ios.infoPlist["UISupportedInterfaceOrientations~ipad"] = ["UIInterfaceOrientationPortrait","UIInterfaceOrientationPortraitUpsideDown","UIInterfaceOrientationLandscapeLeft","UIInterfaceOrientationLandscapeRight"]`. Leave `orientation: "portrait"`. Note in `MOBILE_TECH_APP.md` that a new EAS build is required. Commit.

### Task A8: PR

- [ ] `bun test`, `bunx tsc -b`, `bunx oxlint --deny-warnings`; push; `gh api` PR to `main` with the plain summary. Dan merges.

---

## Phase B — timeline board (`feat/mobile-ipad-2-board`)

### Task B1: Timeline maths

**Files:**
- Create: `packages/mobile/lib/timeline.ts` (port of `packages/web/src/shared/schedule-layout.ts` minus the geo/slot-suggestion part)
- Test: `packages/mobile/lib/__tests__/timeline.test.ts`

**Interfaces:**
- Produces: `Span`, `Range`, `DEFAULT_RANGE`, `DAY_CAPACITY_MINS`, `HOUR_W = 120`, `timelineRange`, `packLanes`, `snapMinutes`, `clampStart`, `pct`, `durationOf`, `bookedMinutes`, `jobMinutes(iso, tz)` (via `partsIn` from `when.ts`), `minuteAtX(x, range)`, `spansFor(jobs, tz, day)`.

- [ ] Tests ported from the web (`timelineRange` widening, `packLanes` conflict, `snapMinutes(37)=30`, `clampStart`), plus `minuteAtX(240, DEFAULT_RANGE) = 9*60`. Implement. Commit.

### Task B2: Placement reducer

**Files:**
- Create: `packages/mobile/lib/board-place.ts`; Test: `__tests__/board-place.test.ts`

**Interfaces:**
- Produces: `type PlaceState = {kind:"idle"} | {kind:"armed", jobId} | {kind:"confirm", jobId, techId, startMin}`; `placeReducer(state, action)` with actions `arm{jobId}`, `tapCell{techId,startMin}`, `cancel`, `done`; `canArm(job)` false for terminal statuses; `canPlace(tech, dayOff: boolean)` false when off.
- Produces: `placementRequest(job, techId, startMin, dayKey, tz) → {kind:"assign", riderId, scheduledAt, expectRiderId} | {kind:"schedule", scheduledAt}`.

- [ ] Tests for each transition, `canArm`, `placementRequest` (same tech → schedule; other tech or unassigned → assign). Implement. Commit.

### Task B3: Board screen

**Files:**
- Create: `packages/mobile/app/(office)/board.tsx`, `packages/mobile/components/office/timeline.tsx` (grid), `components/office/queue-column.tsx`, `components/office/place-banner.tsx`
- Modify: `packages/mobile/app/(office)/_layout.tsx` (tab, `href` gate), `lib/use-board.ts` (`useBoard(day, enabled, days = 1)`)

- [ ] Implement per spec 3.2; placement calls `assign` / `schedule` from `useDispatchActions`, reusing the force / forceBusy confirm flow from `assign-sheet.tsx` (extract `confirmRefusal(fail) → Promise<overrides|null>` into `lib/use-dispatch-actions.ts` if not already shared).
- [ ] tsc, oxlint. Commit `feat(mobile): dispatch timeline board on iPad`. PR.

---

## Phase C — week capacity (`feat/mobile-ipad-3-week`)

### Task C1: `weekCells`

- [ ] `lib/timeline.ts`: `weekCells(board: {techs, jobs, timeOff, tz, day}) → Map<techId, WeekCell[7]>` where `WeekCell = {day, bookedMin, count, off}`; test with a two-tech fixture. Commit.

### Task C2: Week view

- [ ] `components/office/week-grid.tsx`; Day | Week segment in `board.tsx`; `useBoard(mondayOf(day), true, 7)`; cell tap → `setDay(cell.day); setView("day")`. Unassigned row from `jobs.filter(!riderId)` grouped by `dayKey`. Commit. PR.

---

## Phase D — live map (`feat/mobile-ipad-4-map`)

### Task D1: Pins maths

- [ ] `lib/map-pins.ts`: `pinColor(job)`, `visibleTechs(techs, showOffline)`, `fitRegion(points: {lat,lng}[], fallback) → Region` (padding 20 %, min delta 0.02; `[]` → fallback; fallback `null` → `{lat 45, lng -100, delta 40}`). Tests. Commit.

### Task D2: Dependency

- [ ] `bunx expo install react-native-maps`; `app.json` plugin entry; `MOBILE_TECH_APP.md`: new build required. Commit.

### Task D3: Map segment

- [ ] `components/office/live-map.tsx` (`MapView` with `provider` default/Apple, custom `Marker` children); `team.tsx` List | Map segment; selection overlay (iPad card / phone `Sheet`) with Open / Assign (`/office/job/[id]?assign=1`). Commit. PR.

---

## Phase E — work-order edit (`feat/mobile-ipad-5-edit`)

### Task E1: Edit model

- [ ] `lib/line-items.ts`: `LineItem`, `sumLineItems`, `lineTotal(li)` (port). Tests.
- [ ] `lib/edit-job.ts`: `EditDraft`, `draftFromBooking(b)`, `validateEdit(d)` (title ≤ 200, phone optional, qty > 0, price ≥ 0, required custom fields filled), `buildPatch(d, original)` (changed keys only; `fieldData` whole; `lineItems` with recomputed `cost/price`), `OFFICE_STATUSES = ["pending","confirmed","completed","cancelled"]`. Tests for each. Commit.

### Task E2: Custom field inputs

- [ ] `components/office/field-inputs.tsx`: `<CustomFieldInput def value onChange />` by type. Commit.

### Task E3: Edit screen

- [ ] `app/office/job/[id]/edit.tsx` per spec 3.5, reusing `ClientSheet`, `ServiceSheet`, `AddressSheet`, `DateTimeSheet`, `Field`; save → `PATCH /bookings/:id` via `classifyResponse`; `forceable` 409 → "Save anyway"; status → `POST /bookings/:id/status` after; invalidate `["booking", id]` + board; `router.back()`. "Edit" button in `JobDetail` gated on `work_orders:edit`. Register route in `app/_layout.tsx`. Commit. PR.
