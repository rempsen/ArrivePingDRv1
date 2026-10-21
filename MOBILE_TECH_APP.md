# ArrivePing Mobile App (Expo) — technician and office modes

Dark NVC brand theme (ink bg, cyan/sky brand, emerald live). Expo Go for review/testing.

## Backend additions (packages/web)
- `POST /riders/me/photo` — tech uploads own headshot (multipart `file`). Self-serve version of admin `/riders/:id/photo`.
- `POST /bookings/:id/photos` — upload a job photo (multipart `file`, optional `caption`). Lists via `GET /bookings/:id/photos`.

## Office mode (added 2026-10-21)
Superadmin, admin, manager, dispatcher and project_manager sign in to the same
app and land in `app/(office)` after the company pick; `lib/app-mode.ts`
decides field vs office per company (membership `staffType` marks a dual-role
owner, who gets a switch in Profile). Office mode never calls `/riders/me`
and never mounts the location heartbeat.

- `(office)/index.tsx` Today — status tiles, needs attention (late / unassigned), next up, live via `GET /dispatch/stream` (`lib/use-dispatch-stream.ts`; polls when the stream is down).
- `(office)/jobs.tsx` — one day at a time (`GET /dispatch/board`, `GET /dispatch/load` for the day strip), Unassigned / Scheduled / In progress / Done, search, + New job.
- `office/job/[id].tsx` — detail; Assign/Reassign (`GET /dispatch/candidates` → `POST /dispatch/assign`, forceable 409 → "Assign anyway"), Reschedule (`POST /dispatch/schedule`), Cancel (`POST /bookings/:id/cancel`), Undo (`POST /dispatch/undo`) via `components/office/undo-toast.tsx`.
- `office/new-job.tsx` — quick create → `POST /bookings/admin` (`lib/new-job.ts` builds the body; pickers in `components/office/pickers.tsx` use `/directory`, `/services`, `/geo/*`).
- `(office)/messages.tsx` + `office/thread/[techId].tsx` — dispatcher inbox (`/messages/dispatch/threads`, `/dispatch/:techId`, mark-read on focus, `/broadcast`), live via `/messages/inbox/stream`.
- `(office)/team.tsx` — techs by status, call / text / map / message.
- `office/profile.tsx` — company switch, field-mode switch, Face ID lock, sign out.
- Permissions: `GET /me/access` → `lib/use-access.ts` `can()`; tabs/buttons hide, server enforces.
- Push: `lib/push-route.ts` routes taps by mode (`tech_message` → thread, `bookingId` → office job). Backend: `officeUsersAt()` (api/lib/memberships.ts) now notifies managers/dispatchers too, and a tech's message pushes office devices.
- Tests: `bun test packages/mobile/lib/__tests__` (pure modules only; react-native can't load under bun).

## Screens (packages/mobile/app)
- `index.tsx` — boot: route to sign-in, then the company pick, then (rider) or (office) by role.
- `sign-in.tsx` — email/password login (invite-based, same accounts as web).
- `(rider)/_layout.tsx` — tab nav: Jobs, Earnings, Profile.
- `(rider)/index.tsx` — Today's jobs list (assigned/offered), accept/decline inline.
- `(rider)/earnings.tsx` — completed jobs + payout summary.
- `(rider)/profile.tsx` — profile, headshot upload, availability toggle, sign out.
- `job/[id].tsx` — job detail: customer, address, tasks/checklist, status flow
  (enroute/arrived/start/complete), Navigate button, live location while enroute,
  messaging, capture photos.

## Reused API
- `GET /bookings` (rider sees assigned), `GET /bookings/:id`
- `POST /bookings/:id/accept` | `/decline` | `/status`
- `POST /tracking/:bookingId/ping` (live location)
- `GET/POST /messages/:bookingId`
- `GET /riders/me`, `PATCH /riders/me` (status/location)
- `GET /payouts`

## Testing
`bun run dev:mobile` -> QR -> Expo Go on tester phones. App points at live API via app.json extra.apiUrl.

## BUILD COMPLETE (resumed session)
All screens built & verified:
- sign-in.tsx (email/pw, NVC dark, logo)
- (rider)/_layout.tsx (Jobs/Earnings/Profile tabs, phosphor icons)
- (rider)/index.tsx (offers w/ accept/decline, in-progress, up-next)
- (rider)/earnings.tsx (week hero, stats grid, payouts, completed jobs)
- (rider)/profile.tsx (headshot upload, availability toggle, sign out)
- job/[id].tsx (status flow, Navigate deep-link, live location ping while enroute, photo capture, messaging, checklist, fields)

### Fixed
- expo-location was wrong major (^56 -> 19.0.8), expo-secure-store (^56 -> 15.0.8), vector-icons/router/linking aligned to SDK54 via `expo install`.
- Cast manual-json RPC calls (accept/decline/status/messages) with `as any` (routes have no zValidator).

### Expo Go access
- Metro runs on **port 4300** (tmux session `metro`) to match platform proxy `EXPO_PACKAGER_PROXY_URL`.
- Public manifest URL: https://07f7x7sy6bwhugp1bgvuj-preview-4300.runable.site/
- Expo Go URL: **exp://07f7x7sy6bwhugp1bgvuj-preview-4300.runable.site**
- QR: /home/user/homeserve/expo-go-qr.png
- Verified: manifest 200 over public proxy; full iOS bundle builds (17.9MB, HTTP 200), contains app screens.
- Restart metro: `tmux kill-session -t metro; tmux new-session -d -s metro "cd /home/user/homeserve/packages/mobile && EXPO_NO_TELEMETRY=1 bunx expo start --port 4300 > /tmp/metro.log 2>&1"`

### Test creds (rider role)
- demotech@nvc360.app / tech1234  (rider id 138e0343-0b1b-4876-9892-a0d8dbe597d0)
- Seeded: 1 offered HVAC job (40 Mountbatten Ave) + 1 accepted active HVAC job (123 Test St)
- Admin: admin@nvc360.app / admin123

---

## Admin Notifications — Configuration build-out (added)
Backend (`notif-config.ts` + `dispatch.ts` + `email.ts`):
- `GET /notif-config/events/:event` — full per-event detail (3 recipient rows + meta + default copy + template vars)
- `POST /notif-config/preview` — interpolate {{vars}} against sample data
- `GET/PATCH /notif-config/channels` — global channel config (new `notificationChannels` table, id="default")
- `channelAllowed()` gate wired into fireEvent: master switches + quiet hours suppress in-app/email/sms/webhook
- Email sender identity (from name/address, reply-to, footer) flows from channel config into sendEmail()
- New exports in dispatch: TEMPLATE_VARS, defaultTemplateFor(), interpolateSample()

UI (`admin/notifications.tsx`):
- New **Channels** tab: master switches, email sender, SMS sender, quiet hours (window + affected channels)
- **Event drawer** (Edit button per rule row): per-recipient channel toggles + template editor with {{var}} insert chips, live Preview (sample data), Use-default reset, Save copy
- Schema pushed, tsc clean, web rebuilt + server restarted on :4200. All endpoints verified via curl + browser.
