# ArrivePing Map v2 (dispatch map) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Map screen (`/admin/fleet`) with a MapLibre 6 dispatch map where an unassigned job is assigned by dragging it onto a technician (pin, team-strip face or open card), with clash checks, Undo, live updates, and desktop, iPad and phone layouts, installable from the browser. It ships behind a "Map v2" switch.

**Architecture:** There are four server pieces, and each runs a fixed number of queries:
- a board snapshot;
- batched candidates;
- assign/undo, wrapping the existing `assignJob` guards;
- an SSE stream on the existing realtime bus.

The page is a self-contained feature folder. It holds an imperative MapLibre controller (markers, job layer, camera padding), a framework-free pointer drag engine that hit-tests map pins via `map.project()` plus DOM drop targets, and React panels. Pure rules (qualification, fit/clash, drag geometry) live in `src/shared/` so the server, the client and the unit tests all use one copy.

**Tech Stack:**
- Bun, Hono 4, drizzle.
- Postgres (PGlite in tests).
- React 19, TanStack Query 5, Tailwind 4.
- MapLibre GL JS 6.14 (npm alias `maplibre-gl-6`).
- Motion 12.
- Python Playwright for e2e.

**Spec:** `blueprints/2026-10-17-arriveping-map.md` in the AI Tool Expert store, approved by Dan on 2026-10-17. Dan's answers:
- Devices: desktop, iPad and phone.
- Install from the browser.
- A drop assigns at once, with Undo, and stops only on a clash.
- Keep the dark map.
- A job keeps its set date and time. A job whose time has passed is the technician's next stop.

## Global Constraints

- **Tenancy:** every read and write goes through `tdb(companyId)` or the global `db` for `companies`. The company always comes from `tenantId(c)`, never from the request body or query.
- **Permissions:** dispatching stays an office action, so every `/api/dispatch/*` route uses `requireAdmin`.
- **Assignment:** an assignment stays an *offer* (`assignStatus = "offered"`); the technician accepts it. Dropping a job never changes `scheduledAt`.
- **No migration.** There are no new tables or columns. "Map v2" defaults to on for `companies.is_internal = true`, and each person can override it in localStorage (`arriveping.mapV2` = `"1"` or `"0"`). The URL `?map=v2` or `?map=classic` forces one for that visit.
- **WebGL2:** Map v2 needs it. Without it, the classic map renders.
- **MapLibre versions:** MapLibre 6 comes in only through the alias `maplibre-gl-6` and its own Vite chunk `vendor-maplibre6`. The Leaflet maps and `maplibre-gl@4.7` stay untouched.
- **Credits:** they are shown, never hidden:
  - "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" on the map;
  - plus "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" on satellite.
- **Interaction numbers:**
  - mouse pick-up after 4 px of movement;
  - touch pick-up after a 250 ms hold, with movement over 8 px before then cancelling as a scroll;
  - magnet radius 56 px (72 px when the drag is by touch);
  - edge pan within 32 px of the map edge after 300 ms;
  - Undo toast for 6 s, paused on hover or focus;
  - camera fit 400 ms, glide 800 ms;
  - a location is stale after 10 min;
  - level of detail: dots below zoom 9, avatars from 9 to 12, avatars with names from 13.
- **Copy:**
  - "Offered to {name} · Undo";
  - "Release to assign to {first name}";
  - clash card: "{sentence} Assign anyway?" with **Assign anyway** and **Cancel**;
  - hint: "Drag a job onto a technician to assign".
  - Use the tenant's `workerNoun` and `jobNoun` wherever the UI says technician or job.
- **Look:**
  - existing tokens: ink `#070b12`, ink-2 `#0c1220`, brand `#0ea5e9`;
  - radius 10 px for controls, 14 px for containers, full for pills and avatars;
  - Inter, with tabular figures for numbers;
  - no emoji.
- **Motion and accessibility:**
  - every animation has a `prefers-reduced-motion` alternative;
  - keyboard assign works everywhere drag does;
  - one polite live region announces assignments;
  - touch targets are at least 44 px on coarse pointers.
- **Checks before every push:**
  - `TZ=UTC bun run test` (log to a file);
  - `bunx tsc -b --force --noEmit`;
  - `bun run lint`;
  - `bun run build`;
  - CI green on the pushed commit.

## Review Focus

1. **A technician with no location, or a job with no coordinates.** No marker, no magnet, and no NaN maths. The technician is still a drop target in the team strip, and their travel time reads "—".
2. **A stale board during a drop.** The job was already assigned, or the technician accepted it, between the snapshot and the drop. The server's 409 rolls the optimistic move back with the server's sentence. Undo after the technician accepted says so and changes nothing.
3. **Stream loss.** Tab asleep, proxy timeout or deploy restart. The client reconnects with backoff, fetches `/board` again once, and the 30 s safety poll keeps the map fresh in the meantime. No duplicate streams after a switch of company.
4. **Big tenants.** 200 technicians and 2,000+ jobs: the board is capped at 3,000 jobs with `truncated: true`, the queue stays scrollable, and markers stay under 1 ms of work per frame while panning.
5. **Text and timezones.** A company in another timezone, or a job title or address in any script, renders correctly. "Today" is the company's day, not the browser's. Every string is set through text nodes or `textContent`, never `innerHTML`.

---

## File Structure

```
packages/web/
  tools/dispatch-demo.ts                      dev-only: in-memory Postgres + seed + server (never shipped)
  src/shared/qualify.ts                       one "qualified" rule (+ __tests__/qualify.test.ts)
  src/shared/dispatch-fit.ts                  fit + clash classification, pure (+ test)
  src/shared/drag-geometry.ts                 magnet / edge-pan / hit maths, pure (+ test)
  src/services/realtime.ts                    + dispatch channel: publishDispatch / subscribeDispatch
  src/services/dispatch-board.ts              board snapshot (4 queries)
  src/services/dispatch-candidates.ts         batched candidates (≤5 queries for ≤20 jobs)
  src/services/dispatch-assign.ts             assign wrapper + signed undo token + undoAssign
  src/api/routes/dispatch.ts                  /api/dispatch/{settings,board,candidates,assign,undo,stream}
  src/services/__tests__/dispatch-*.test.ts, src/api/routes/__tests__/dispatch-routes.test.ts
  src/web/features/dispatch/
    dispatch-route.tsx                        switch: v2 vs classic (lazy)
    dispatch-page.tsx                         layout by width; selection + URL state; shortcuts
    dispatch.css                              markers, glass, ghost, motion (+ reduced motion)
    data/{types.ts,api.ts,stream.ts,use-board.ts,use-candidates.ts}
    map/{dispatch-map.tsx,map-controller.ts,style.ts,tech-markers.ts,job-layer.ts,assign-line.ts}
    drag/{drag-engine.ts,use-drag.ts}
    assign/{use-assign.ts,clash-card.tsx,undo-toast.tsx,announcer.tsx}
    panels/{toolbar.tsx,queue-panel.tsx,job-card.tsx,team-strip.tsx,tech-inspector.tsx,job-inspector.tsx,assign-menu.tsx,command-palette.tsx,bottom-sheet.tsx,first-run-hint.tsx}
    pwa/{pwa.ts}
  public/admin/{manifest.webmanifest,sw.js,icons/*.png}
  e2e/dispatch-map.e2e.py
```

Modified:
- `src/api/index.ts`: register the route.
- `src/services/dispatch.ts`: publish on `fireEvent`.
- `src/services/presence.ts`, `src/services/booking-status.ts`: publish when a technician's status changes.
- `src/api/routes/tracking.ts`, `src/api/routes/riders.ts`: publish locations.
- `src/api/routes/bookings.ts`: publish on create, patch, schedule and archive.
- `src/services/demo-refresh.ts`, `src/services/sample-day.ts`: publish moved technicians.
- `src/services/ai-dispatch.ts`: the scorer uses `qualifies()`.
- `src/web/pages/admin/scheduler.tsx`: the highlight uses `qualifies()`.
- `src/web/pages/admin/index.tsx`: the `/admin/fleet` route goes to `dispatch-route`.
- `src/web/pages/admin/fleet.tsx`: adds a "Try the new map" pill only.
- `src/web/components/dispatch-messenger.tsx`: an `arriveping:messenger` open event, and the launcher gets the class `ap-messenger-launcher`.
- `src/web/pages/admin/shell.tsx`: PWA registration.
- `src/site-server.ts`: `sw.js` is served `no-cache`.
- `vite.config.ts`: the `vendor-maplibre6` chunk.
- `package.json` and `bun.lock`: the alias.

---

### Task 1: Spike, demo harness and the MapLibre 6 alias

**Files:**
- Create: `packages/web/tools/dispatch-demo.ts`.
- Modify: `packages/web/package.json`, `bun.lock` and `packages/web/vite.config.ts`.

**Interfaces:**
- Produces:
  - `bun run tools/dispatch-demo.ts [--size small|large] [--port 4300]`;
  - prints `DEMO_EMAIL` and `DEMO_PASSWORD`;
  - company `demo-dispatch`: internal, with timezone `America/Winnipeg`.

- [ ] Add `"maplibre-gl-6": "npm:maplibre-gl@6.14.0"` and run `bun install`. In `manualChunks`, return `"vendor-maplibre6"` for any id containing `maplibre-gl-6`. That check goes before the generic maplibre rule.
- [ ] The harness:
  - `DATABASE_URL=":memory:"`, and creates every table (the ensureTable pattern from `sample-day.test.ts`);
  - seeds the company, settings and an admin through `auth.api.signUpEmail` (then role, `companyId` and membership);
  - seeds 8 services across HVAC, Plumbing, Electrical, Appliance and General;
  - seeds technicians around Winnipeg (49.8951, -97.1384) with mixed skills and statuses: one stale, one offline and one on time off today;
  - seeds jobs: unassigned (overdue, today, upcoming), assigned, in progress, and one assigned job that overlaps another;
  - `small` is 12 technicians and 40 jobs; `large` is 200 and 2,000;
  - serves `/api` with `app.fetch` and everything else with `serveSite`;
  - every 5 s it moves 3 working technicians and calls `publishDispatch` (once Task 4 exists).
- [ ] **Spike:**
  - `bun run build`, start the harness, and open `/admin/fleet?map=v2` in headless Chromium (`--use-angle=swiftshader --enable-unsafe-swiftshader`);
  - check `getContext('webgl2')`, that MapLibre 6 renders the ink style, and synthetic pointer drag by mouse and touch (CDP `Input.dispatchTouchEvent`);
  - record the fps for pan and drag with 200 technicians and 2,000 jobs;
  - write the findings into the plan's Spike notes.
- [ ] Commit: `chore(dispatch): MapLibre 6 alias, own chunk, local demo harness`.

### Task 2: One qualification rule

**Files:**
- Create: `src/shared/qualify.ts`, `src/shared/__tests__/qualify.test.ts`.
- Modify: `src/services/ai-dispatch.ts` (in `scoreCandidates`), `src/web/pages/admin/scheduler.tsx` (the skill highlight).

**Interfaces:**
- Produces:
  - `parseSkills(v: string | string[] | null | undefined): string[]`;
  - `qualifies(tech: {skills?: string|string[]|null; skillClass?: string|null}, job: {requiredSkillClass?: string|null; requiredSkills?: string|string[]|null; serviceCategory?: string|null}): Qualification`;
  - `Qualification = {qualified: boolean; missing: string[]; matched: string[]; basis: "required"|"category"|"none"}`.

**Rule:**
- Comparisons ignore case and surrounding spaces.
- The technician's set is their skills, plus `skillClass` unless it is empty or "general".
- **Required:** the job's `requiredSkillClass` (unless it is empty or "general") plus `requiredSkills`. If anything is required, every item must be in the technician's set, and the basis is "required".
- **Category fallback:** if nothing is required, the job's category is not generic ("", "general", "other", "misc", "miscellaneous") and the technician's set is not empty, then the category or its first word must be in the set, and the basis is "category".
- **Otherwise:** qualified, with basis "none".

- [ ] Write the tests:
  - class match;
  - class missing → `missing: ["HVAC"]`;
  - tags all required;
  - category "HVAC Repair" vs skills "hvac,electrical" → qualified;
  - category "Plumbing" vs "HVAC" → missing `["Plumbing"]`;
  - a technician with no skills and class General → qualified, basis none;
  - generic category → none;
  - `requiredSkills` as an array or as CSV with spaces and duplicates.
- [ ] Implement; the tests pass.
- [ ] Scorer:
  - `skillMatch = q.qualified && q.basis !== "none"`;
  - `+30` when not qualified, `+10` when the basis is "none" (an unknown);
  - `RankInput.job` gains optional `requiredSkillClass` and `requiredSkills`, passed by `/api/ai/suggest-tech`.
- [ ] Scheduler highlight: `qualifies(rider, job).qualified` replaces the `requiredSkillClass` equality.
- [ ] Run the full tests, tsc and lint. Commit: `feat(dispatch): one shared "qualified" rule`.

### Task 3: Fit, clash and drag geometry (pure)

**Files:**
- Create: `src/shared/dispatch-fit.ts`, `src/shared/drag-geometry.ts`, and a test for each.

**Interfaces:**
- **Fit:**
  - `type Fit = "ready" | "busy" | "unqualified" | "offline"`;
  - `type ClashKind = "offline" | "unqualified" | "timeoff" | "overlap" | "busy"`;
  - `classifyFit(input: {name: string; status: string; qualification: Qualification; overlap: string|null; timeoff: string|null; inField: boolean; freeAt: number|null; jobStart: number; now: number; tz: string; noun: string}): {fit: Fit; clash: {kind: ClashKind; message: string} | null}`.
  - Clash precedence: offline > unqualified > timeoff > overlap > busy.
  - Busy means `inField && freeAt && max(jobStart, now) < freeAt`. Message: "{name} is on a job until {clockLabel(freeAt)}."
  - Unqualified message: "{name} isn't set up for {missing joined with ' and '}."
  - Offline message: "{name} is offline right now."
  - Timeoff and overlap use the messages passed in (from `shared/availability.ts`).
  - Fit is offline, unqualified or busy accordingly; with no clash it is ready.
- **Geometry:**
  - `nearestWithin(p: Pt, targets: {id: string; x: number; y: number}[], radius: number): {id: string; d: number} | null`;
  - `edgePan(p: Pt, rect: Rect, edge = 32, maxSpeed = 18): {dx: number; dy: number}`: speed scales linearly with how deep the point is inside the edge band, zero outside it;
  - `pointInRect(p, rect)`.

- [ ] Write the tests, covering every precedence pair, the boundary radius (`d === radius` counts), and corners producing a diagonal pan.
- [ ] Implement; the tests pass. Commit: `feat(dispatch): fit/clash rules and drag geometry`.

### Task 4: Realtime dispatch channel and publishers

**Files:**
- Modify: `src/services/realtime.ts` (add `"dispatch"` to the `TrackEvent.type` union).
- Modify the publishers:
  - `tracking.ts`: after the rider location update;
  - `riders.ts`: location and status;
  - `presence.ts`: when the status changes;
  - `booking-status.ts`: technician status;
  - `dispatch.ts`: in `fireEvent` after `logJobEvent`, before the sample-day return;
  - `bookings.ts`: create, PATCH, schedule and archive;
  - `demo-refresh.ts`, `sample-day.ts`: moved technicians.
- Test: `src/services/__tests__/dispatch-realtime.test.ts`.

**Interfaces:**
- `type DispatchSignal = {kind: "location"; techId: string; lat: number; lng: number; at: number} | {kind: "tech"; techId: string} | {kind: "job"; jobId: string}`.
- `publishDispatch(companyId: string, s: DispatchSignal): Promise<void>`: fire-and-forget safe, never throws.
- `subscribeDispatch(companyId: string, fn: (s: DispatchSignal) => void): () => void`.
- Channel: `dispatch:<companyId>`.

- [ ] Write the tests: a subscriber gets its own company's signals and never another company's; unsubscribing stops delivery; a thrown subscriber doesn't block others.
- [ ] Implement, then add the publish calls as `void publishDispatch(...)`.
- [ ] Run the tests, then commit: `feat(dispatch): live dispatch channel on the realtime bus`.

### Task 5: Board snapshot

**Files:**
- Create: `src/services/dispatch-board.ts`, and the test `src/services/__tests__/dispatch-board.test.ts`.

**Interfaces:**
- `loadBoard(companyId: string, opts: {day?: string; now?: Date}): Promise<Board>`.
- `Board = {day: string; tz: string; workerNoun: string; jobNoun: string; office: {lat: number; lng: number} | null; mapV2Default: boolean; truncated: boolean; generatedAt: string; techs: BoardTech[]; jobs: BoardJob[]}`.
- `BoardTech = {id, userId, name, phone, photoUrl, color, vehicle, status, skills: string[], skillClass, lat: number|null, lng: number|null, locationAt: string|null, stale: boolean, openJobs: number, freeAt: string|null, currentJobId: string|null, nextJobIds: string[]}`. `nextJobIds` holds at most 3, sorted by `scheduledAt`, and leaves out the current job.
- `BoardJob = {id, title, service: string, category: string, durationMins: number, status, assignStatus, priority, lat: number|null, lng: number|null, address, scheduledAt: string, riderId: string|null, customerName: string, requiredSkillClass: string, requiredSkills: string[], late: boolean, isSample: boolean}`.
- Exactly 4 reads:
  1. riders ⨝ user, excluding approval "suspended";
  2. bookings ⨝ services ⨝ customer (an aliased user);
  3. `companySettings` (tz, nouns);
  4. `companies` (office, `isInternal`).
- **Jobs filter:** not archived, and any of:
  - `scheduledAt` falls in the company's day;
  - unassigned and not terminal;
  - in flight.
- Ordered by `scheduledAt`, limited to 3,001; anything past 3,000 sets `truncated: true`.
- **Derived:**
  - `freeAt`: the same remaining-minutes model as `techWorkload`;
  - `stale`: `locationAt` older than 10 minutes and the technician not in the field;
  - jobs at the default coordinates (43.6532, -79.3832) with no address geocode count as "no location" (`lat`/`lng` null) only when the company's office is elsewhere. The old fleet map pinned these in Toronto.

- [ ] Write the tests:
  - shape;
  - another company's riders and jobs never appear;
  - the day window in America/Winnipeg vs UTC;
  - unassigned jobs from other days are included;
  - completed jobs from other days are excluded;
  - `truncated` at 3,001;
  - the number of database round trips is identical for 5 and 50 technicians (spy on `$client.query` and `$client.transaction`).
- [ ] Implement; the tests pass. Commit: `feat(dispatch): board snapshot in four queries`.

### Task 6: Batched candidates

**Files:**
- Create: `src/services/dispatch-candidates.ts`, and the test `dispatch-candidates.test.ts`.

**Interfaces:**
- `loadCandidates(companyId: string, jobIds: string[], now?: Date): Promise<Record<string, DispatchCandidate[]>>`. It takes at most 20 ids; unknown ids are omitted.
- `DispatchCandidate = {techId, fit: Fit, clash: {kind, message} | null, qualified: boolean, missing: string[], distanceKm: number|null, etaMins: number|null, openJobs: number, freeAt: string|null, score: number, best: boolean, reason: string}`.
- The order is ready first, then busy, unqualified and offline, each by score. `best` goes to the first ready candidate.
- `reason` follows these patterns:
  - "Closest qualified · free now";
  - "Qualified · 6 min away";
  - "Free now";
  - "Free at 2:30 PM";
  - "Missing Plumbing";
  - "Offline".
- At most 5 reads, whatever the number of jobs or technicians:
  - jobs ⨝ services;
  - riders ⨝ user;
  - live and nearby bookings ⨝ services: assigned, not terminal, not archived, and either in flight or within ±25 h of any requested job;
  - time off within ±48 h;
  - settings.
- The score uses `scoreCandidates`. Overlap and time-off come from `findOverlappingJob` and `findTimeOff`, with the messages from `overlapMessage` and `timeOffMessage`.

- [ ] Write the tests:
  - ready, busy, unqualified, offline;
  - overlap and time-off messages;
  - batch results equal single results;
  - another company's technicians never appear;
  - the query count doesn't grow with the number of jobs.
- [ ] Implement; the tests pass. Commit: `feat(dispatch): batched candidates with fit and clash`.

### Task 7: Assign and Undo

**Files:**
- Create: `src/services/dispatch-assign.ts`, and the test `dispatch-assign.test.ts`.

**Interfaces:**
- `dispatchAssign(companyId, {bookingId, riderId, force?: boolean, by: string}): Promise<{ok: true; job: BoardJob; undo: string | null} | {ok: false; status: 404 | 409; message: string; forceable: boolean; reason?: string}>`. It wraps `assignJob` and reads `prev` first. `undo` is non-null only when `prev.riderId` was null.
- Token: `base64url(JSON {v:1, c, b, r, s: prevStatus, a: prevAssignStatus, exp})` + "." + base64url(HMAC-SHA256). The key comes from `BETTER_AUTH_SECRET`, falling back to a per-process random key. `exp` is now + 10 min.
- `undoAssign(companyId, token, by: string): Promise<{ok: true; job: BoardJob} | {ok: false; status: 400|404|409|410; message: string}>`.
  - **400** for a bad signature; **404** for another company's token; **410** when expired (message "Too late to undo — open the job to change it.").
  - **Compare-and-set** where id = b, riderId = r, assignStatus = 'offered', status = 'assigned' and not archived. It sets `riderId` null, the previous status and assignStatus, clears `assignedAt` and `acceptedAt`, clears the automation stamp, then `reconcileRiderStatus` and an internal note (`logJobEvent` `note_added`, "Assignment undone by {by}").
  - **409** when nothing matched; if the job is now accepted, the message is "{name} already accepted this job — open it to change the assignment."
  - The technician gets no notification (Phase 2 can add a "withdrawn" push).

- [ ] Write the tests:
  - assign returns a token; undo restores pending vs confirmed exactly;
  - undo after accept → 409;
  - a tampered token → 400; an expired token → 410; another company → 404;
  - reassigning a job that already had a technician returns `undo: null`;
  - a forceable 409 passes through for an overlap.
- [ ] Implement; the tests pass. Commit: `feat(dispatch): assign with a signed one-step Undo`.

### Task 8: Dispatch routes

**Files:**
- Create: `src/api/routes/dispatch.ts`, and the test `src/api/routes/__tests__/dispatch-routes.test.ts`.
- Modify: `src/api/index.ts` (`.route("/dispatch", dispatchRoutes)`).

**Interfaces** (every route uses `requireAdmin`):
- `GET /api/dispatch/settings` → `{mapV2Default: boolean}`.
- `GET /api/dispatch/board?day=YYYY-MM-DD` → `Board`.
- `GET /api/dispatch/candidates?jobs=a,b` → `{candidates: Record<string, DispatchCandidate[]>}`. At most 20 ids, validated with zod.
- `POST /api/dispatch/assign {bookingId, riderId, force?}` → 200 `{job, undo}` | 404 | 409 `{message, forceable, reason?}`.
- `POST /api/dispatch/undo {token}` → 200 `{job}` | 400 | 404 | 409 | 410.
- `GET /api/dispatch/stream` → SSE. It sends `ready` at once, then:
  - `locations` (a JSON array, the newest per technician, coalesced every 1 s);
  - `changed` (`{techs: string[], jobs: string[]}`, coalesced);
  - `ping` every 20 s.
- Loop pattern as in `messages.ts` `/inbox/stream`.

- [ ] Write the tests:
  - a technician role → 403 on every route;
  - board and candidates through HTTP;
  - assign then undo through HTTP;
  - the stream emits `ready`, then a `locations` frame after `publishDispatch` (read the body stream with a 3 s budget).
- [ ] Implement; the tests pass. Commit: `feat(dispatch): /api/dispatch routes and live stream`.

### Task 9: Web data layer

**Files:**
- Create in `src/web/features/dispatch/data/`: `types.ts` (re-export the server types), `api.ts`, `stream.ts`, `use-board.ts`, `use-candidates.ts`.

**Interfaces:**
- `fetchBoard(day?)`, `fetchCandidates(ids)`, `postAssign(...)`, `postUndo(token)`, `fetchSettings()`, all using `apiHeaders()`.
- `openDispatchStream(handlers: {onReady; onLocations(list); onChanged(ids); onError}): () => void`. It is a fetch-based SSE reader (so the Authorization and X-Company-Id headers apply) with backoff 1, 2, 4, 8, 16, 30 s, and it resets after a `ready`.
- `useBoard(day): {board, isLoading, error, connected, patchJob, patchTech, refetch}`:
  - query key `["dispatch-board", companyKey, day]`;
  - `refetchInterval` 30 s;
  - `locations` patch technicians in place;
  - `changed` debounces a refetch by 400 ms;
  - a reconnect refetches once.
- `useCandidates(jobIds)`: key `["dispatch-candidates", ids]`; `staleTime` 15 s; invalidated on `changed`.

- [ ] Typecheck and build. Commit: `feat(dispatch): web data layer with live stream`.

### Task 10: Map core

**Files:**
- Create in `map/`: `style.ts`, `map-controller.ts`, `dispatch-map.tsx`, `tech-markers.ts`, `job-layer.ts`, `assign-line.ts`; and `dispatch.css`.

**Interfaces:**
- `createMapController(container: HTMLElement, opts: {mode: "ink"|"satellite"; center; zoom}): MapController` with:
  - `map`;
  - `setPadding(p)`, `fitTo(points, {duration})`, `project(lng, lat): {x, y}`, `containerRect()`;
  - `setMode(mode)`;
  - `onCamera(fn)`;
  - `destroy()`.
- `TechMarkers`:
  - `sync(techs: BoardTech[], selectedId)`;
  - `setDrag(fit: Record<techId, {fit, best: boolean, chip: string}> | null)`;
  - `setTarget(techId|null)`;
  - `screenPoints(): {id, x, y}[]` (visible, non-offline, with a location);
  - `onClick(fn)`, `onHover(fn)`.
  - It uses DOM markers at zoom ≥ 9 and a GeoJSON circle layer `techs-dots` below 9. A location change glides over 800 ms with requestAnimationFrame (and jumps under reduced motion).
- `JobLayer`:
  - `sync(jobs: BoardJob[], visibleIds: Set<string>)`;
  - `setSelected(id|null)`, `setHover(id|null)`, `pulse(id|null)`;
  - `onClick(fn)`.
  - A clustered GeoJSON source with `promoteId: "id"`, `clusterProperties.unassigned`, and the layers `job-clusters`, `job-cluster-count`, `job-pins`, `job-pins-ring`, `job-pulse`.
- `style.ts`: `inkStyle()` (the vendored JSON) and `satelliteStyle()` (Esri imagery dimmed by `raster-brightness-max` 0.8, a 25% ink background tint, and dark reference labels), plus `ATTRIBUTION` strings.
- Interaction:
  - no rotate or pitch;
  - double-click a pin to zoom to 16;
  - a cluster click calls `getClusterExpansionZoom` and eases;
  - camera padding follows the open panels.

- [ ] Build. Then a headless check on the demo (Task 1): markers count equals technicians with a location; dots below zoom 9; credits text visible; satellite toggles.
- [ ] Commit: `feat(dispatch): MapLibre 6 map core with live markers and clustered jobs`.

### Task 11: Page, panels and selection

**Files:**
- Create: `dispatch-page.tsx`, plus in `panels/`: `toolbar.tsx`, `queue-panel.tsx`, `job-card.tsx`, `team-strip.tsx`, `tech-inspector.tsx`, `job-inspector.tsx`, `assign-menu.tsx`, `command-palette.tsx`, `first-run-hint.tsx`.

**Interfaces:**
- Selection is `{kind: "tech"|"job"; id} | null`, mirrored to `?tech=` or `?job=` with `history.replaceState`. Back and Forward re-read it.
- Layout is chosen by the page's measured width:
  - `wide` (1280 px and up): a floating queue on the left, 320 px; the inspector on the right, 360 px; the strip at the bottom.
  - `medium` (768 to 1279 px): the queue collapses to a pill; the inspector is a 320 px card; the strip stays.
  - `narrow` (under 768 px): the bottom sheet (Task 13).
- Height is the viewport minus the page's own top offset, measured, so the sample-day banner and the phone header fit.
- **Shortcuts:**
  - `/` or ⌘K opens the command palette;
  - `F` fits everyone;
  - `S` toggles satellite;
  - `Esc` clears the selection or cancels a drag;
  - `A` on a focused job card opens Assign to…;
  - `?` shows the shortcuts.
- **Hover peek** (pointer `hover: hover` only): a compact card after 120 ms that never takes clicks (`pointer-events: none`).
- **Inspectors:**
  - Technician: status line; skills; now; today's timeline (the board's jobs for the technician); Call, Text, Message and Center. Message fires `arriveping:messenger`; Text uses POST `/api/fleet/:techId/sms`.
  - Job: candidates (ranked) with one-click Assign; Open work order (`WorkOrderModal`); Directions; Copy address; Unassign when offered (PATCH `riderId ""`).
- **First-run hint:** shown once (localStorage `arriveping.mapV2.hint`) when there is at least one unassigned job and one ready technician: a 3 s ghost glide, captioned "Drag a job onto a technician to assign".

- [ ] Build, then take a desktop screenshot on the demo. Commit: `feat(dispatch): Map v2 page, queue, inspectors, team strip, command palette`.

### Task 12: Drag-to-assign

**Files:**
- Create: `drag/drag-engine.ts`, `drag/use-drag.ts`, and in `assign/`: `use-assign.ts`, `clash-card.tsx`, `undo-toast.tsx`, `announcer.tsx`.

**Interfaces:**
- `createDragEngine(opts: {getMapTargets(): {id,x,y}[]; mapRect(): DOMRect; panBy(dx,dy): void; onStart(jobId, pointerType); onTarget(t: {techId, via: "map"|"strip"|"inspector"} | null); onDrop(jobId, t|null, at: {x,y}); onCancel(jobId)}): {attach(el: HTMLElement, jobId: string): () => void; cancel(): void; isDragging(): boolean}`.
- **Pointer rules:**
  - Mouse needs `button === 0` and 4 px; a pen counts as a mouse.
  - Touch holds 250 ms, and movement over 8 px before that is a scroll. During a drag, a non-passive `touchmove` listener calls `preventDefault`, and `contextmenu` is suppressed.
  - Listeners live on `document`, because the source may re-render.
  - `-webkit-user-select: none`; on cards, `touch-action: pan-y` and `-webkit-touch-callout: none`.
- **Targets:**
  - DOM targets are `[data-drop-tech]` under the pointer (`elementsFromPoint`, with the ghost set to `pointer-events: none`), and they win over map targets.
  - Map targets use `nearestWithin` at 56 or 72 px. Releasing over the queue cancels.
- **Ghost:** a fixed `translate3d` card. With a magnet it springs to the marker (Motion `animate`, spring stiffness 500 and damping 32); on drop it shrinks into the avatar; on cancel it springs back to its source.
- **`useAssign`:**
  - `assign(job, tech, cand|null, {force})`;
  - a pre-clash from the candidate shows `ClashCard` anchored to the drop point;
  - optimistic `patchJob`, then POST;
  - on 200: the undo toast and an announcement ("Assigned {job} to {tech}. Undo available.");
  - on a forceable 409: roll back and show `ClashCard` with the server message;
  - on any other error: roll back and show a toast with the message;
  - `undo(token)`: optimistic revert, then POST; on 409 or 410, show a toast and refetch.
- **Keyboard:** `assign-menu.tsx` is a listbox of candidates (arrows, Enter, Esc), opened by `A` or Enter on a focused card, or by the Assign button.

- [ ] Write the unit tests already covered by Task 3's geometry. Then run e2e by mouse in Task 16.
- [ ] Commit: `feat(dispatch): drag a job onto a technician to assign, with clash check and Undo`.

### Task 13: iPad and phone

**Files:**
- Create: `panels/bottom-sheet.tsx`.
- Modify: `dispatch-page.tsx` (the `narrow` and `medium` layouts).

**Interfaces:**
- `BottomSheet({detent, onDetent, peek: ReactNode, children})`: detents peek 112 px, half 50%, full = height − 72 px.
  - Dragging the grabber or header uses Motion drag with velocity snapping; there are keyboard buttons for each detent; `aria-expanded`; the map stays interactive above the sheet.
- On phone:
  - the sheet lists [Jobs | Team];
  - tapping an item swaps to its inspector inside a `document.startViewTransition` (when supported, skipped under reduced motion) and moves focus to its heading;
  - a long-press drag from a sheet card drops the sheet to peek;
  - the messenger launcher is hidden and opened from the toolbar.

- [ ] Take screenshots at 1024×1366 (touch) and 390×844 (touch). Commit: `feat(dispatch): iPad and phone layouts with a bottom sheet`.

### Task 14: Installable app

**Files:**
- Create: `public/admin/manifest.webmanifest`, `public/admin/sw.js`, `public/admin/icons/{icon-192.png,icon-512.png,maskable-512.png}`, `features/dispatch/pwa/pwa.ts`.
- Modify: `shell.tsx` (call `initPwa()` in production), `site-server.ts` (`/admin/sw.js` → `no-cache`).

**Interfaces:**
- The manifest:
  - `id` "/admin/fleet", `start_url` "/admin/fleet", `scope` "/admin/";
  - `display` "standalone", with `display_override` ["window-controls-overlay", "standalone"];
  - `theme_color` and `background_color` "#070b12";
  - shortcuts: Map, Jobs (`/admin/work-orders`), Scheduler.
- `sw.js`:
  - `/api/` is never handled;
  - same-origin `/assets/` is cache-first (`ap-assets-v1`, capped at 300);
  - navigations in scope are network-first, keeping the last good shell (`ap-shell-v1`) and falling back to an inline offline page;
  - tiles from `tiles.openfreemap.org` are stale-while-revalidate (`ap-tiles-v1`, capped at 1,000);
  - activation deletes other `ap-*` caches.
- `initPwa()`: injects `<link rel="manifest">` while the admin is mounted and registers `/admin/sw.js` with scope `/admin/`. It exports:
  - `canInstall()` and `promptInstall()` (from `beforeinstallprompt`);
  - `installHint()` (the Safari text);
  - `setBadge(n)` (`setAppBadge` / `clearAppBadge` when present).

- [ ] Write a headless check on the production build: the manifest is valid, the SW reaches "activated", reload offline shows the shell or the offline page, and `/api` isn't cached. Commit: `feat(admin): installable app — manifest, service worker, badge`.

### Task 15: The switch

**Files:**
- Create: `features/dispatch/dispatch-route.tsx`.
- Modify: `pages/admin/index.tsx`, `pages/admin/fleet.tsx` (the pill), `components/dispatch-messenger.tsx` (the event and class).

**Interfaces:**
- `useMapV2(): {on: boolean; ready: boolean; set(on: boolean): void}`.
- Precedence: the URL param, then localStorage, then `GET /api/dispatch/settings`, with WebGL2 required.
- The classic page shows "Try the new map" when WebGL2 is available. v2 has "Classic map" in its menu.

- [ ] Write e2e: an internal company lands on v2; `?map=classic` shows classic; the toggle persists across reloads. Commit: `feat(dispatch): Map v2 switch, on for our own companies`.

### Task 16: Proof

**Files:**
- Create: `e2e/dispatch-map.e2e.py`.

- [ ] **e2e against `tools/dispatch-demo.ts`**, with screenshots in `/tmp/dispatch-shots`.
  - **Desktop 1440×900:**
    - the map renders and the queue count equals the unassigned jobs;
    - a mouse drag onto the ready technician shows "Offered to …"; Undo puts the job back in the queue within 1 s;
    - a drag onto an unqualified technician shows the clash card, Cancel restores the job, and Assign anyway assigns it;
    - keyboard assign (Tab to a card, A, ArrowDown, Enter);
    - the credits are visible.
  - **iPad 1024×1366** (`has_touch`): a long-press drag by touch through CDP.
  - **Phone 390×844:** sheet detents; assign from the job sheet; no sideways scroll.
  - **Live:** a `publishDispatch` location moves the marker within 2 s.
  - **Install:** the manifest link is present and the SW is activated.
- [ ] **Performance:** with `--size large`, measure fps while panning, zooming and dragging (a requestAnimationFrame counter) in headless Chromium, and report it as relative only (software GL).
- [ ] **Reviews:**
  - an accessibility review (design:accessibility-review) and a UX-copy pass on every string;
  - a fresh reviewer agent on the whole diff.
  - Fix what they find.
- [ ] Run the full checks, push to main, and watch CI until it's green. Update the blueprint's §9–10 and the store log. Report to Dan.

## Spike notes

Run on 2026-10-17 in headless Chromium, in a 2-core container with software GL (SwiftShader).

- **WebGL2 is available headless.** MapLibre 6.14 draws the vendored ink style, and the OpenFreeMap tiles load through the agent proxy. Pass the proxy to Chromium as flags (`--proxy-server=…`, `--proxy-bypass-list=localhost;127.0.0.1`), not through Playwright's `proxy` option: that option routes localhost through the proxy as well.
- **MapLibre 6 has no default export.** Use `import * as maplibregl from "maplibre-gl-6"`.
- **The worker URL must be set.** Its default is a sibling of `import.meta.url`, which doesn't exist once the library is bundled into a hashed chunk. Call `setWorkerUrl()` with the worker file imported via `?url`.
- **No custom attribution for the ink map.** The vendored style's source already carries "OpenFreeMap © OpenMapTiles Data from OpenStreetMap", and adding it again showed it twice.
- **A missing sprite image.** The ink style asks for `wood-pattern`, which the sprite doesn't have. Answer `styleimagemissing` with a transparent 1×1 image.
- **Frame rate (software GL only, so relative):**

  | Run | Result |
  |---|---|
  | Panning the map alone | 14.2 fps |
  | Panning with 200 DOM avatars and 2,000 clustered jobs | 11.9 fps (−16%) |
  | Projecting all 200 avatars every frame | 48 fps |

  Drawing the map, not the pins, is the cost. Avatars stay as DOM markers from zoom 9; below that they become a dot layer. Real figures for a GPU need Dan's Mac and iPad.
- **Pointer model, checked in Chromium:**
  - Mouse: picks up after 4 px.
  - Touch, holding 250 ms: picks up, and a non-passive `touchmove` `preventDefault` keeps the page from scrolling.
  - Touch, moving before 250 ms: scrolls, then `pointercancel`.

  iOS Safari is checked on a real device.
