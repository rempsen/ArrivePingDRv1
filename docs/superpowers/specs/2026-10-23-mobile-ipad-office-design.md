# ArrivePing mobile — iPad office mode

**Date:** 2026-10-23
**Status:** Approved by Dan (chat, 2026-10-23 08:02 PT) — build in five phases
**Builds on:** `2026-10-21-mobile-office-mode-design.md` (phone office mode, shipped in PRs #131, #132, #136)

## 1. Intent

Office mode on the phone gives a dispatcher the essentials between calls. On an iPad the same person sits at a desk, a truck seat or a kitchen counter with a screen big enough to run the day from: see the whole crew's day at once, move work around, watch the map, fix a work order properly. This phase makes the iPad that tool without turning it into the web console.

### What Dan asked for (2026-10-23)
- Extended functionality for managers, dispatchers and admins on iPad.
- Scope: **dispatch timeline board**, **live map**, **full work-order edit**, **week capacity view** — all four.
- Layout: **split view everywhere** (list left, detail right). Phone untouched.
- Orientation: **landscape and portrait on iPad**; phone stays portrait.

### Assumed (correct me)
- Same dark theme, `components/ui.tsx` kit and `components/office/*` pieces as the phone screens.
- No new paid services. Apple Maps needs no key. Build cost only.
- Technicians' screens are untouched; nothing here mounts for a `field`-mode user.

## 2. What exists today (verified in code, 2026-10-23)

| Area | State | Consequence |
|---|---|---|
| Office screens | `app/(office)/{index,jobs,messages,team}.tsx`, `app/office/{job/[id],thread/[techId],new-job,profile}.tsx`; `WIDE` caps content at 760 pt centred | iPad shows a phone column with margins; detail screens push over the list |
| Orientation | `app.json` `orientation: "portrait"`, `supportsTablet: true` | iPad is portrait-locked |
| Board data | `useBoard(day)` → `GET /dispatch/board?day=`; stream keeps it live; `useDayLoad(from, days)` → `/dispatch/load` | Board already carries `tz`, `timeOff[]`, techs with `lat/lng/freeAt`, jobs with `lat/lng/durationMins/assignStatus`; `days=` up to 7 is accepted |
| Actions | `useDispatchActions()` → assign / schedule / undo / cancel with force, forceBusy, Undo tokens | Timeline and map reuse these as-is |
| Layout maths | `packages/web/src/shared/schedule-layout.ts` — pure functions (range, lanes, snap, clamp, pct, duration, booked minutes) | Copy into `packages/mobile/lib/timeline.ts`; the mobile package can't import the web package's source (only `AppType` is exported) |
| Work-order write | `PATCH /bookings/:id` (`BookingPatch`): title, priority, customerId, serviceId, address, lat/lng, customerPhone, customerEmail, scheduledAt, notes, staffNotes, fieldData, lineItems, riderId, `force` | Full edit needs no backend change. `POST /bookings/:id/status` changes status |
| Custom fields | `fieldData._customFields: [{id,type,label,required,options?}]`, values at `fieldData[id]`; internal `__*` keys are stripped on read and preserved on write by the API | Edit screen round-trips `fieldData` whole, as the web modal does |
| Line items | `shared/catalog.ts` `LineItem {itemId, kind, name, sku, unit, qty, unitCost, unitPrice, taxable, cost, price}`; `sumLineItems` | Copy the two types and `sumLineItems` into `lib/line-items.ts` |
| Maps | None in the app; tech screens deep-link to Apple/Google Maps | New native module; new EAS build |
| Gestures | No `react-native-gesture-handler` / `reanimated` in `package.json` | Drag-and-drop would add two native deps; use tap-to-place |

## 3. Design

### 3.1 Layout model

`lib/layout.ts` (RN-free): `isWideLayout(width: number, deviceType: "phone" | "tablet" | "unknown"): boolean` → true when `deviceType === "tablet"` and `width >= 768`. A tablet in narrow Split View (iPadOS multitasking) falls back to the phone layout, which already works.

`lib/use-layout.ts`: `useLayout()` → `{ wide, width, height, landscape }` from `useWindowDimensions()` and `expo-device` `deviceType`.

`components/office/split-screen.tsx`: `<SplitScreen list={...} detail={...} empty={...} />`. Wide: list pane 380 pt with a right border, detail fills the rest; `detail` null shows `empty`. Narrow: renders `list` only (the existing screens, unchanged). Lists keep a `selectedId` so the open row is highlighted.

Detail screens become components so both the route and the pane can render them:
- `components/office/job-detail.tsx` `<JobDetail id onClose? embedded />` — everything `app/office/job/[id].tsx` does today; the route becomes a thin wrapper.
- `components/office/thread-view.tsx` `<ThreadView techId embedded />` — likewise for `app/office/thread/[techId].tsx`.
- `components/office/tech-detail.tsx` `<TechDetail techId />` — new: status, free-at, phone/SMS/map/message actions, today's jobs for that tech (from the board). On phone the Team tab keeps its row actions and does not navigate.

Wide-mode adoption:
- **Jobs**: list left (day strip, search, buckets as today); `JobDetail` right. The `assign=1` param still opens the Assign sheet.
- **Team**: list left; `TechDetail` right; "Message" in the detail opens the thread in the Messages tab (`router.push` with `techId`).
- **Messages**: inbox left; `ThreadView` right; mark-read on selection (same focus rule).
- **Today**: two columns — left: tiles + Needs attention; right: Next up + a compact crew list (status chips). Column split 1:1; below 1000 pt wide the right column stacks under the left.
- New job, profile, and sheets stay full-screen modals/bottom sheets on both.

Navigation on wide: tapping a list row sets `selectedId` (no route push). Push notifications and deep links (`/office/job/:id`, `/office/thread/:techId`) still resolve to the full-screen routes on both devices — simplest, always correct. A `?select=` param is **not** added; the full-screen route is fine for a notification tap.

Orientation: `app.json` `ios.infoPlist.UISupportedInterfaceOrientations~ipad` lists all four orientations; `orientation` stays `"portrait"` so iPhone is unchanged. Plist-only; no runtime module. `expo-screen-orientation` is not added.

### 3.2 Dispatch timeline board (Board tab, iPad only)

Tab `board` in `(office)/_layout.tsx`, `href: null` unless `wide && (can("scheduler:view") || can("work_orders:view"))`. Icon: `CalendarBlank`.

Screen `app/(office)/board.tsx`: header with `DayStrip` (shared with Jobs) and a Day/Week segment (Week is phase C). Body is a horizontally scrolling grid:
- Left gutter 160 pt: tech avatar, name, status chip, booked minutes / 8h (`bookedMinutes`).
- Hour columns across the visible range (`timelineRange(spans)`, default 7 AM–7 PM; 120 pt per hour; a "now" line in brand colour when the day is today).
- Each tech row 72 pt; jobs as blocks positioned by `pct(startMin)` / `pct(endMin)`; lanes from `packLanes` (two lanes when overlapping, conflict border in red); block shows time, client, service; colour by assign state (`none` grey outline, `offered` amber, `accepted` brand, in-flight statuses green, completed muted).
- A tech with `timeOff` on the day: row hatched, label "Off".
- Right column 300 pt "Unassigned": the day's jobs with `riderId == null`, sorted by time, plus a count badge.

**Tap-to-place.** `lib/board-place.ts` (RN-free) reducer: `idle → armed{jobId, from: "queue"|"row"} → placing{techId, startMin} → idle`. Tap a block or queue row: it arms (block gets a brand outline; a banner reads "Tap a time on a technician's row for *Client* — Cancel"). Tap a row cell: `startMin = clampStart(snapMinutes(minuteAt(x)), durationOf(job), range)`; a confirm card shows "Move *Client* to *Tech*, 2:15 PM?" with Place / Cancel. Place calls:
- `assign(jobId, techId, { scheduledAt, expectRiderId })` when the tech changes or the job was unassigned;
- `schedule(jobId, scheduledAt)` when only the time changes;
with the existing force / forceBusy refusal handling and the Undo toast. Tapping the block of an armed job opens `JobDetail` as a modal sheet (iPad) instead of re-arming; a long-press on any block opens it directly.

Live: the board query the stream already invalidates. Day selection shares `boardKey(company, day)` with Jobs.

### 3.3 Week capacity (Board tab → Week)

`useBoard(mondayOf(day), …, days = 7)` — extend `useBoard` with an optional `days` argument and include it in the key. Grid: tech rows × 7 day columns. Cell = booked minutes bar against `DAY_CAPACITY_MINS` (8 h), job count, red when > 100 %, hatched on `timeOff`. Top row: unassigned count per day. Tap a cell → Day view on that day (and that tech scrolled into view). `lib/timeline.ts` gets `weekCells(board) → Map<techId, Array<{day, bookedMin, jobs, off}>>`, tested.

### 3.4 Live map (Team tab → Map segment, phone and iPad)

Dependency: `react-native-maps` (Apple Maps provider on iOS; config plugin in `app.json`). Dark map via `userInterfaceStyle`. Android later: Google Maps key in `app.json` — out of scope.

`components/office/live-map.tsx` `<LiveMap techs jobs office onPickTech onPickJob selected />`:
- Tech markers: avatar initial in a circle coloured by `statusColor(status)`; offline techs hidden unless toggled; positions from the board (`lat/lng`), which the stream's `locations` event already refreshes.
- Job pins: today's open jobs with coordinates; colour by `assignStatus` (none red, offered amber, accepted brand); completed/cancelled hidden.
- Initial region fits all markers (fallback: `board.office`, then a continent-level view); "Fit" button re-fits.
- `lib/map-pins.ts` (RN-free): `pinColor(job)`, `fitRegion(points) → {latitude, longitude, latitudeDelta, longitudeDelta}`, `visibleTechs(techs, showOffline)`, tested.

The Team tab header gets a List | Map segment. With Map selected the map fills the screen on both devices. Selection: iPad — a 380 pt card overlaid on the right shows `TechDetail` / `JobDetail`; phone — a bottom `Sheet` with the summary and Open / Assign buttons. Deselect by tapping the map.

### 3.5 Full work-order edit (phone and iPad)

Route `app/office/job/[id]/edit.tsx`, entered from `JobDetail` "Edit" (shown when `can("work_orders:edit")`). Form sections:
1. Job: title, priority (chips), status (chips limited to `pending`, `confirmed`, `completed`, `cancelled`; the field statuses — en route, on site — stay with the technician's clock), service (ServiceSheet), client (ClientSheet; changing the client replaces address/phone as in New job), address (AddressSheet), phone, time (DateTimeSheet).
2. Notes: customer notes, staff notes.
3. Fields: each `_customFields` entry by type — text/number inputs, select (chips), checkbox, date (DateTimeSheet day-only), `file` and `instructions` read-only.
4. Line items: rows with name, qty, unit price, line total; qty/price editable; remove; "Add line" (free-text name + qty + price → `kind: "custom"`, `itemId: ""`); totals via `sumLineItems`. Rate model and tech pay are not shown.

`lib/edit-job.ts` (RN-free): `draftFromBooking(b) → EditDraft`, `validateEdit(draft) → errors`, `buildPatch(draft, original) → BookingPatch` (only changed keys; `fieldData` always sent whole when any field changed; `lineItems` recomputed with `cost`/`price`), `applyLineEdit`, tested. Save: `PATCH /bookings/:id`; 409 with `forceable` → "Save anyway" (`force: true`); status change goes through `POST /bookings/:id/status` after the patch succeeds. Success invalidates `["booking", id]` and the board.

### 3.6 Permissions
Unchanged from phase one: Board/Week need `scheduler:view` or `work_orders:view`; placing needs `work_orders:edit` (the queue and blocks don't arm without it); Map needs `techs:view`; Edit needs `work_orders:edit`. The server enforces all of it regardless.

### 3.7 Testing
- Unit (bun, RN-free): `layout` (`isWideLayout`), `timeline` (range, lanes, snap, clamp, weekCells), `board-place` reducer, `map-pins`, `edit-job` (draft/validate/patch/line totals).
- Typecheck, oxlint `--deny-warnings`, web suite unchanged.
- Device: TestFlight on an iPad (landscape + portrait, Split View narrow) and an iPhone (no change) against the demo tenant, as dispatcher and as a view-only manager.

## 4. Phases and PRs

| Phase | Branch | Delivers |
|---|---|---|
| A | `feat/mobile-ipad-1-split` | layout hook, SplitScreen, JobDetail/ThreadView/TechDetail components, Jobs/Team/Messages/Today wide layouts, iPad orientation |
| B | `feat/mobile-ipad-2-board` | Board tab, timeline, queue, tap-to-place |
| C | `feat/mobile-ipad-3-week` | Week segment |
| D | `feat/mobile-ipad-4-map` | react-native-maps, Map segment, pins, selection |
| E | `feat/mobile-ipad-5-edit` | Edit screen |

Each PR targets `main` and is merged by Dan. D and E are independent of B/C. D and the plist change in A each need a fresh EAS build to test on device.

## 5. Risks
- **`react-native-maps` on the old architecture / Expo 54**: supported (the Expo docs still list it); if the config plugin fights the dev client, the fallback is `expo-maps` (needs new arch — not an option now) or MapLibre RN. Decide at phase D with a local build.
- **Timeline width**: 12 h × 120 pt = 1440 pt inside a horizontal ScrollView with a sticky gutter; two nested scroll views on RN need `nestedScrollEnabled` and a fixed row height. Rows virtualise with `FlatList` once a crew exceeds ~30.
- **Tap-to-place precision**: 15-min snap at 120 pt/h is 30 pt per step — comfortable for a finger.
- **Status edits**: office-set status transitions are limited (3.5) so the edit screen can't put a job into a field state the tech's clock doesn't know about.
- **Line items with catalog assemblies**: edit qty/price only; the child breakdown is kept as-is on the item.
