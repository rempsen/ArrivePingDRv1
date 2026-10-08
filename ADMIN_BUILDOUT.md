# NVC360 Admin Build-Out

Company default: **NVC 360**, 423 Main Street, Winnipeg, Manitoba, Canada (was Toronto).

## Decisions
- Address autocomplete: **Google Places** (GOOGLE_MAPS_API_KEY) + map populate
- File uploads: **local server storage** (`/uploads`, served static)
- Custom fields builder on: Clients, Technicians, Work orders — field types incl. notes, file upload, checkbox, value, **signature**, **payment**
- Features: Company Settings, Tag management, Reviews moderation, Customer notes/timeline, Tech availability/shifts/time-off, Service zones (map polygons), Payouts/earnings, Audit log

## Schema additions
- [ ] `companySettings` (singleton: name, address, lat/lng, timezone, currency, taxRate, logo, brandColor, phone, email)
- [ ] `tags` (id, label, color, scope: client|tech|both)
- [ ] `entityTags` (tagId, entityType, entityId) — join
- [ ] `customFields` (id, entity: client|tech|work_order, label, type, options, required, order, section)
- [ ] `customFieldValues` (fieldId, entityType, entityId, value)
- [ ] `attachments` (id, entityType, entityId, filename, url, mime, size, label, uploadedBy)
- [ ] `riders` extend: licensePlate, licenseNumber, address, notes
- [ ] `techShifts` (riderId, dayOfWeek/date, start, end, type: shift|timeoff)
- [ ] `serviceZones` (id, name, color, polygon JSON, active)
- [ ] `payouts` (id, riderId, periodStart, periodEnd, jobsCount, gross, fee, net, status)
- [ ] `auditLog` (id, actorId, actorName, action, entityType, entityId, meta, createdAt)
- [ ] `signatures` (booking field data) — store as attachment/dataURL
- [ ] `user` extend? store client address/notes via customFields + a `clientProfile`? Use attachments+customFields generically.

## Backend routes
- [ ] `settings.ts` GET/PUT company settings
- [ ] `tags.ts` CRUD + assign/unassign
- [ ] `custom-fields.ts` CRUD defs + values
- [ ] `uploads.ts` POST multipart -> local, GET list per entity, DELETE
- [ ] `zones.ts` CRUD
- [ ] `shifts.ts` CRUD per tech
- [ ] `payouts.ts` list/generate
- [ ] `audit.ts` list (+ helper to write)
- [ ] `geo.ts` proxy Google Places autocomplete + details + geocode (keep key server-side)
- [ ] extend riders create/update for plate, license, address, notes

## Frontend
- [ ] Settings page (company info, branding, tax, timezone)
- [ ] new nav: Settings, Tags, Zones, Payouts, Audit Log
- [ ] AddressAutocomplete component (Google Places via server proxy) + mini map
- [ ] Custom Fields manager (per entity) + dynamic renderer
- [ ] Tag picker component
- [ ] Tech detail: plate, license, tags, attachments, shifts/time-off
- [ ] Client detail: notes timeline, tags, custom fields, attachments
- [ ] Reviews moderation page
- [ ] FileUpload + Signature pad + Payment field components
- [ ] Seed company defaults to Winnipeg

## Verify
- [ ] tsc clean, build, smoke

## PROGRESS LOG
- [x] Schema: companySettings, tags, entityTags, customFields, customFieldValues, attachments, techShifts, serviceZones, payouts, auditLog. riders extended (plate/license/address/notes). PUSHED.
- [x] Backend routes: settings, tags, custom-fields, uploads(local), geo(google proxy), zones, shifts, payouts, audit. riders PATCH+create extended. Wired in index.ts. Static /uploads in server.ts. tsc EXIT 0.
- [x] Frontend pages: settings, tags, payouts, audit, zones (Leaflet polygon draw + surge), services. All routed in pages/admin/index.tsx + nav links live.
- [x] Components: address-autocomplete, mini-map, tag-picker, attachment-manager, custom-fields, signature-pad, tech-shifts.
- [x] Tech detail drawer (riders.tsx): profile (plate/license/address/skill/notes) + Tags + CustomFields tabs, Shifts tab (add/list/delete shift & time-off), Files tab. Create form extended w/ plate/license/address/notes.
- [x] Client detail drawer (users.tsx): Profile (custom fields + tags), Job history (filtered bookings), Files tabs.
- [x] VERIFIED: tsc EXIT 0, build EXIT 0, server restarted on :4200. All API endpoints 200 (zones/tags/payouts/audit/settings/shifts/custom-fields). Zone create→list→delete round-trip OK. SPA routes 200.
- [x] Reviews moderation: schema extended (hidden/featured/reply) + PUSHED. routes/reviews.ts (list/public/patch/delete) wired in api/index.ts. reviews.tsx page (filter by rating/visibility/featured, hide/feature/reply/delete) routed + nav link. Endpoints 200, SPA route 200, build+tsc EXIT 0.
- [ ] REMAINING (optional, low priority): dashboard quick-action drill-downs (zero buttons today).

## Notifications + Tech Onboarding module (in progress)
- [x] Schema: notificationRules, webhookEndpoints, notificationDeliveries, techInvites; rider.approval; booking.assignStatus/acceptedAt/declineReason
- [x] services/dispatch.ts — central fireEvent() engine (in-app/email/sms/webhook + delivery log + seedNotificationRules)
- [x] routes/notif-config.ts — rules matrix CRUD, webhooks, deliveries, test-fire
- [x] routes/invites.ts — invite CRUD + public lookup/accept (invite-only tech onboarding)
- [x] bookings.ts refactored: created/assigned/accepted/declined/enroute/arrived/started/completed/cancelled -> fireEvent; accept/decline endpoints
- [x] Schema pushed, backend tsc EXIT 0
- [x] admin/notifications.tsx (rules matrix, webhooks, invites, delivery log)
- [x] Wire /admin/notifications route + nav
- [x] Public /join/:token page (invite accept) — verified end-to-end
- [x] Tech app: accept/decline UI on offered jobs; public tech signup removed (invite-only)
- [x] tsc EXIT0 + build EXIT0 + restart + smoke (invite accept, enroute SMS sent w/ Twilio SID, deliveries logged)

## Live Traffic ETA (Google Routes API + TripEngine)
- Replaced in October 2026: Distance Matrix and Directions are Legacy and unavailable to new Google Cloud projects. `GET /api/geo/eta` and `/api/geo/config` were unused and are gone.
- `services/routing.ts` calls Routes API `computeRoutes` (TRAFFIC_AWARE), falling back to OSRM, then a haversine estimate. Key: `GOOGLE_MAPS_API_KEY_NEW`, else `GOOGLE_MAPS_API_KEY`.
- `services/trip-engine.ts` keeps one route per booking. The ping handler and both tracking pages project the tech onto it (ETA = traffic duration × remaining share), and only re-call Google on trip start, a new destination, 4 min + moved, or 2 consecutive fixes >150 m off route. About 7 calls per 25-minute drive, down from about 210, and one ETA everywhere.
- `POST /api/tracking/:bookingId/ping` writes `bookings.etaMins` / `etaDistanceKm` from the engine while the job is assigned/accepted/enroute, and drops the trip otherwise.
- **Bug fixed:** ping handler previously overwrote `bookings.lat/lng` (the JOB destination) with the tech's live coords, corrupting the destination. Live location now lives only on `riders.lat/lng` + `trackingPings`; booking lat/lng stays the destination.
- Public track page (`/t/:token`) already polls `/api/track/:token` every 5s and renders `~{etaMins} min away`; now reflects real traffic ETA. Enroute SMS `{{eta}}` var also picks up the updated value.
- Verified: `provider:"google"` 38min/28.4km direct call; ping→etaMins=36 written + destination preserved.

## Customer ↔ Driver texting + Technician photos (added)
- **Two-way SMS messaging**: Public tracking page message thread now forwards real SMS.
  - Customer message → texts the assigned tech's phone (Twilio) with a link back to the thread (`routes/track.ts` POST /:token/messages).
  - Tech/dispatch reply (`routes/messages.ts`) → in-app notification + texts the customer (`bookings.customerPhone`) with the live thread link.
  - All sends use `services/sms.ts` `sendSms` + `trackingUrl`; no-ops gracefully when Twilio unset.
- **Technician headshots**: new `riders.photoUrl` column.
  - Upload/remove endpoints: `POST /api/riders/:id/photo` (multipart `file`, max 8MB, jpeg/png/webp) and `DELETE /api/riders/:id/photo`. Stored under `/uploads/`.
  - Admin UI: hover-to-upload camera overlay on the tech drawer avatar (`PhotoUploader` in `admin/riders.tsx`), with remove (x) button.
  - Reusable `<TechAvatar>` component (photo with initials fallback) used on: public track page, riders list + drawer, fleet panels, fleet map marker (CSS bg image), bookings assign list, scheduler columns.
  - `photoUrl` surfaced via `/api/track/:token`, `/api/fleet`, `/api/riders`.
