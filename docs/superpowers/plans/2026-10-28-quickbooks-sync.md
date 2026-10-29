# QuickBooks Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ArrivePing tenants can switch on a QuickBooks Online sync that mirrors assigned jobs as Purchase Orders, completed jobs as linked Bills (when the tenant's bill mode says so), and marks jobs "Subtrade paid" when QuickBooks records payment.

**Architecture:** A `services/quickbooks/` module behind the existing OAuth framework, task scheduler and feature switch. Outbound writes are durable scheduled tasks keyed per booking and kind; inbound changes arrive by signed webhook and a 30-minute change-data-capture sweep. External ids and SyncTokens live in `qbo_links`; anything needing a human goes to `qbo_issues`.

**Tech Stack:** Bun, Hono, drizzle-orm + Postgres (PGlite in tests), React admin pages, QuickBooks Online Accounting API v3 (`minorversion=75`), OAuth 2.0.

**Spec:** `blueprints/2026-10-28-arriveping-quickbooks.md` (AI Tool Expert store). Repo: `rempsen/ArrivePingDRv1`, base `origin/main` @ a9f8b84, all paths under `packages/web/src/` unless noted.

## Global Constraints

- Branch `feat/quickbooks-sync`; one PR; merging = approval; never push `main`.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NbP46AD6FSM3TXQFTLdn6c`.
- Checks after every task: `cd packages/web && bunx tsc -b --force --noEmit && bun run lint && bun test <task's test files>`.
- A QuickBooks failure never changes the outcome of a job status request (hooks are fire-and-forget via `scheduleTask`).
- No new npm dependencies; plain `fetch`. Tokens and secrets never logged.
- Sample jobs (`bookings.isSample`) and `deletedAt` jobs never sync.
- Feature key `integrations.quickbooks`, kind `entitlement`, group `Connections`, `kindDefaults: { customer: false, demo: false, test: false, internal: true }`.
- Tenant settings in `integrations.config` JSON: `{ billMode: "arriveping" | "subtrade", taxCodeId: string, defaultItemId: string, parentCustomerId: string, shadow: boolean }`; defaults `billMode:"arriveping"`, `shadow:true`.
- QBO DocNumber for a PO: `AP-` + first 8 chars of the booking id upper-cased (QBO limit 21 chars). `PrivateNote`: `ArrivePing job <bookingId>`.
- New booking columns: `vendor_bill_status text not null default 'none'` (`none|po_open|billed|paid|error`), `subtrade_paid_at timestamptz null`.
- New tables carry `company_id` with RLS as in `drizzle/0031_onboarding_chats.sql` L13-17; `oauth_states` is global and must be added to `GLOBAL_TABLES` in `api/database/tenant.ts`.

## Review Focus

1. The bookkeeper records the subtrade's Bill before ArrivePing does (or bill mode is `subtrade`): the sync must adopt the existing Bill linked to the PO, never create a second. → Task 9 test "adopts an existing Bill linked to the PO".
2. A job is completed, then the QuickBooks token is revoked, then payment is recorded: the job must still flip to paid on the next successful sweep after reconnect, with no duplicate PO. → Task 10 test "sweep after reconnect".
3. Two instances fire the `completed` hook at once (rolling deploy): exactly one Bill. → Task 8 test "enqueue is idempotent per booking and kind".
4. Period locked by the bookkeeper: a QBO 6000-series validation error must raise an issue and stop retrying, not retry forever. → Task 8 test "validation error raises an issue and marks the task failed".
5. Tenant switches the feature off mid-flight: queued tasks must no-op, nothing written. → Task 8 test "switch off drops queued work".

---

### Task 1: Secrets at rest (`lib/secretbox.ts`)

**Files:**
- Create: `lib/secretbox.ts`, `lib/__tests__/secretbox.test.ts`
- Modify: `api/routes/integrations.ts` (callback write, `credential-status`/`app-credentials` CRUD), `services/oauth.ts` (`loadDbCredentials`), `services/google-drive.ts` (token read)

**Interfaces:**
- Produces: `seal(plain: string): string` → `"enc:v1:" + base64(iv|tag|ct)` using AES-256-GCM with key from `INTEGRATIONS_KEK` (base64, 32 bytes); `open(value: string): string` returns plaintext for sealed values and returns legacy plaintext unchanged when the prefix is absent; `isSealed(value): boolean`. When `INTEGRATIONS_KEK` is unset, `seal` returns the input and logs one warning at boot.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests** — `seal/open round-trips`, `open passes legacy plaintext through`, `tampered ciphertext throws`, `seal without KEK returns plaintext`.
- [ ] **Step 2: Run** `bun test src/lib/__tests__/secretbox.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `lib/secretbox.ts`** with `node:crypto` `createCipheriv("aes-256-gcm")`.
- [ ] **Step 4: Wire it:** seal on every write of `integrations.accessToken/refreshToken` and `oauth_app_credentials.clientSecret`; open on every read (`oauth.ts loadDbCredentials`, `google-drive.ts`, and the new `quickbooks/client.ts`). Existing rows stay readable (legacy pass-through).
- [ ] **Step 5: Run checks** → PASS. **Commit:** `feat(integrations): encrypt OAuth tokens and app secrets at rest`.

### Task 2: OAuth hardening (realmId, DB-backed state)

**Files:**
- Modify: `services/oauth.ts` L7-10 keep; `api/routes/integrations.ts` L64-76 (state map), L200-236 (callback); `api/database/schema.ts` (+ `oauthStates` table); `api/database/tenant.ts` `GLOBAL_TABLES` (+ `"oauth_states"`); `drizzle/0034_quickbooks_sync.sql` (part 1)
- Test: `api/routes/__tests__/integrations-oauth.test.ts`

**Interfaces:**
- Produces: `oauth_states(id text pk, integration_id text, provider text, company_id text, expires_at timestamptz)`; `putState(integrationId, provider, companyId): Promise<string>`; `takeState(state): Promise<{integrationId, provider, companyId} | null>` (single-use, expired rows ignored, 10-minute TTL).
- Callback reads `realmId = c.req.query("realmId")` for `provider === "quickbooks"` and stores it in `integrations.externalAccountId`; `accountLabel` becomes the QBO CompanyName fetched from `GET /v3/company/{realmId}/companyinfo/{realmId}` (fallback "QuickBooks Company").

- [ ] **Step 1: Failing tests** — `callback stores realmId as externalAccountId`, `state is single-use`, `expired state is rejected`. Use a stubbed `exchangeCode` via `mock.module("../../services/oauth")`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the table, migration statements (global table: no RLS policy, like `oauth_app_credentials`), and the callback changes.
- [ ] **Step 4: Run checks** → PASS. **Commit:** `fix(oauth): persist OAuth state in the database and capture the QuickBooks realmId`.

### Task 3: Schema and migration for the sync

**Files:**
- Modify: `api/database/schema.ts` (+ `qboLinks`, `qboIssues`; bookings + 2 columns); `drizzle/0034_quickbooks_sync.sql` (complete); `shared/features.ts` (+ feature); `web/pages/admin/hub/features.tsx` only if the catalog is not read dynamically (check first).
- Test: `services/__tests__/quickbooks-schema.test.ts`

**Interfaces (produces):**
```ts
qboLinks: { id, companyId, kind: "vendor"|"customer"|"item"|"taxcode"|"purchase_order"|"bill",
            localId: string, qboId: string, syncToken: string, fingerprint: string,
            lastSyncedAt, createdAt }  // unique (company_id, kind, local_id); index (company_id, kind, qbo_id)
qboIssues: { id, companyId, bookingId: string|null, kind: string, message: string,
             detail: text JSON, status: "open"|"resolved", createdAt, resolvedAt }
bookings.vendorBillStatus: text default "none"; bookings.subtradePaidAt: timestamptz|null
FEATURES += { key: "integrations.quickbooks", label: "QuickBooks sync", description: "Mirror assigned jobs as purchase orders and subtrade bills in the company's QuickBooks, and mark jobs paid when QuickBooks pays them.", kind: "entitlement", group: "Connections", kindDefaults: { customer: false, demo: false, test: false, internal: true } }
```
- [ ] **Step 1: Failing test** — `ensureTables` creates both tables; insert into `qboLinks` twice with the same `(companyId, kind, localId)` rejects; `FEATURE_KEYS` includes `integrations.quickbooks`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** schema, migration (RLS as 0031 L13-17 for both tables; `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS …`), feature entry. Check `api/lib/__tests__/feature-gate.test.ts` still passes.
- [ ] **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): sync tables, booking vendor-bill columns and feature switch`.

### Task 4: QuickBooks client (`services/quickbooks/client.ts`)

**Files:**
- Create: `services/quickbooks/client.ts`, `services/quickbooks/entities.ts`, `services/__tests__/quickbooks-client.test.ts`

**Interfaces (produces):**
```ts
export class QboError extends Error { constructor(public status: number, public code: string, public detail: string, public tid: string, public retryable: boolean) }
export function _setQboFetch(f: typeof fetch | null): void   // tests
export async function qboFetch<T>(companyId: string, path: string, init?: { method?: "GET"|"POST"; body?: unknown; query?: Record<string,string> }): Promise<T>
export async function qboQuery<T>(companyId: string, sql: string): Promise<T[]>   // GET /query?query=…
export async function qboCdc(companyId: string, entities: string[], since: Date): Promise<CdcResponse>
export function qboBaseUrl(): string  // QUICKBOOKS_ENV=production → https://quickbooks.api.intuit.com, else https://sandbox-quickbooks.api.intuit.com
export async function loadConnection(companyId): Promise<{ integrationId, realmId, accessToken, refreshToken, expiresAt } | null>
```
Behaviour: adds `minorversion=75`; refreshes when `expiresAt - now < 60s` using `refreshTokens("quickbooks", …)` and persists the rotated refresh token sealed; on 401 refreshes once and retries; on `invalid_grant` sets `integrations.status = "needs_reconnect"` and throws `QboError(401,"needs_reconnect",…, retryable:false)`; 429 and 5xx → `retryable:true`; reads `intuit_tid` header into every error and into a `console.info("[qbo] tid=…")` line; 6xxx validation errors (`Fault.Error[0].code`) → `retryable:false`. `entities.ts` holds the minimal TS types for Vendor, Customer, Item, TaxCode, PurchaseOrder, Bill, BillPayment, CDC response and webhook payload.

- [ ] **Step 1: Failing tests** — `adds minorversion and bearer`, `refreshes an expiring token and seals the new refresh token`, `401 then success retries once`, `invalid_grant marks needs_reconnect`, `429 is retryable`, `validation 6240 is not retryable and carries tid`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): API client with refresh-on-use and error classification`.

### Task 5: Entity resolution (`services/quickbooks/resolve.ts`)

**Files:**
- Create: `services/quickbooks/resolve.ts`, `services/__tests__/quickbooks-resolve.test.ts`

**Interfaces (produces):**
```ts
export async function resolveVendor(companyId, rider: { id, userId, name, email }): Promise<{ qboId: string } | { issue: string }>
export async function resolveCustomer(companyId, job: { customerId, customerName, address }): Promise<{ qboId: string } | { issue: string }>
export async function resolveItem(companyId, templateId: string | null): Promise<{ qboId: string }>
export async function settings(companyId): Promise<QboSettings>  // parsed integrations.config with defaults
export async function setMapping(companyId, kind: "vendor"|"customer"|"item", localId, qboId): Promise<void>
```
Rules: vendor — `qbo_links` first; else `SELECT * FROM Vendor WHERE DisplayName = '<name>'` exact (escape `'`); one hit → link; zero → create Vendor `{DisplayName, PrimaryEmailAddr}` and link; many → issue `vendor_ambiguous`. Customer — link first; else exact `DisplayName` match; else create `{DisplayName: customerName + " - " + address, ParentRef: settings.parentCustomerId?, Job: true when parent set}` and raise issue `customer_created` (informational, auto-resolved). Item — link by `templateId`, else `settings.defaultItemId`, else issue `item_unmapped`.

- [ ] **Step 1: Failing tests** for each rule including the ambiguous case and the escape of `O'Brien`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): vendor, customer and item resolution with cached links`.

### Task 6: Pure mapping (`services/quickbooks/mapping.ts`)

**Files:**
- Create: `services/quickbooks/mapping.ts`, `services/__tests__/quickbooks-mapping.test.ts`

**Interfaces (produces):**
```ts
export interface PoInput { docNumber: string; vendorId: string; customerId: string|null; itemId: string; taxCodeId: string; privateNote: string; lines: { description: string; qty: number; unitCost: number; itemId?: string }[] }
export function buildPurchaseOrder(i: PoInput): PurchaseOrder
export function buildBill(i: PoInput & { poId: string; txnDate: string; dueDate: string }): Bill
export function linesFromBooking(b: Pick<Booking,"techPay"|"techPayBreakdown"|"lineItems"|"onSiteMinutes">, defaults: { itemId: string; itemByCatalogId: (id: string) => string|undefined }): PoInput["lines"]
export function fingerprint(x: unknown): string  // sha256 of stable JSON
```
Rules: each `techPayBreakdown` component becomes a line — unit lines keep their name/qty/unitCost and use the catalog-mapped item when one exists; hourly pay is one line `"On-site labour <h>h <m>m"` qty 1 amount = hourly pay; mileage and flat pay one line each; lines sum to `techPay` exactly (last line absorbs rounding). Every line: `DetailType: "ItemBasedExpenseLineDetail"`, `ItemRef`, `CustomerRef` when present, `TaxCodeRef: taxCodeId`, `BillableStatus: "NotBillable"`. Bill: `LinkedTxn: [{ TxnId: poId, TxnType: "PurchaseOrder" }]`, `TxnDate = finishedAt (YYYY-MM-DD, tenant timezone)`, `DueDate = TxnDate + 30 days`, `GlobalTaxCalculation: "TaxExcluded"`.

- [ ] **Step 1: Failing tests** with three fixtures: unit-pay flooring install (2 lines), hourly repair (1 line), mixed with rounding (`sum == techPay`). Snapshot-free: assert fields.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): pure PO and Bill mapping from tech pay`.

### Task 7: Sandbox smoke script (Phase 0)

**Files:**
- Create: `scripts/qbo-sandbox-smoke.ts`, `docs/QUICKBOOKS_SYNC.md` (setup + Phase-0 results section)

**Interfaces:** reads env `QBO_SMOKE_REALM`, `QBO_SMOKE_REFRESH_TOKEN` (from Intuit's OAuth Playground, sandbox), `QUICKBOOKS_CLIENT_ID/SECRET` (sandbox keys); uses Task 4/6 code; creates Vendor "AP Smoke Vendor", Customer "AP Smoke - 1 Test St", PO, linked Bill; polls PO status until `Closed`; prints a table of the four Phase-0 checks (webhook check is manual: prints the Bill id to pay in the sandbox UI and then re-reads `Balance`).

- [ ] **Step 1: Write the script** (no unit test; it is the test). Dan supplies the sandbox refresh token and realm.
- [ ] **Step 2: Run** `bun run scripts/qbo-sandbox-smoke.ts` → all four checks PASS; paste the output into `docs/QUICKBOOKS_SYNC.md`. If (b) fails, switch `buildBill` to no `LinkedTxn` and add `closePurchaseOrder()` (sparse update `POStatus: "Closed"`) before Task 8.
- [ ] **Step 3: Commit:** `chore(quickbooks): sandbox smoke script and setup doc`.

### Task 8: Outbound sync (`services/quickbooks/sync.ts`) and hooks

**Files:**
- Create: `services/quickbooks/sync.ts`, `services/quickbooks/index.ts`, `services/__tests__/quickbooks-sync.test.ts`
- Modify: `services/booking-status.ts` (after L140 `accrueTechPay`, and in the `assigned`/`cancelled` branches); `services/dispatch.ts fireEvent` only if assignment doesn't pass through `applyBookingStatus` (check `dispatch-assign.ts` L169; hook the accept path too); `server.ts` (import `services/quickbooks` so handlers register).

**Interfaces (produces):**
```ts
export async function enqueueQboSync(companyId: string, bookingId: string, kind: "po.create"|"bill.create"|"po.cancel"): Promise<void>
// task kinds: "qbo.po.create" | "qbo.bill.create" | "qbo.po.cancel"; runAt = now + 20s (coalesces rapid status flips)
export async function isQboActive(companyId): Promise<boolean>   // feature on AND integrations.status == "connected"
export async function syncBookingNow(companyId, bookingId): Promise<{ po?: string; bill?: string; issues: string[] }>  // admin "sync now"
```
Rules: `enqueueQboSync` no-ops unless `isQboActive`, booking not sample/deleted, and no pending task of the same kind for the booking (query `scheduled_tasks` by `bookingId`, `kind`, `status='pending'`). Handler `qbo.po.create`: resolve vendor/customer/item; look up existing PO by `DocNumber` in QBO (`SELECT * FROM PurchaseOrder WHERE DocNumber = 'AP-…'`) or `qbo_links`; create if absent; link; `vendorBillStatus='po_open'`; in shadow mode write the would-be payload to `qbo_issues` kind `shadow` and stop. Handler `qbo.bill.create`: if `billMode==="subtrade"` → no write, `vendorBillStatus` stays `po_open`; else find Bills linked to the PO (`SELECT * FROM Bill WHERE …` then filter `LinkedTxn`) → adopt or create; link; `vendorBillStatus='billed'`; write job timeline event `"Bill #<DocNumber> created in QuickBooks"` via `services/job-events`. Handler `qbo.po.cancel`: delete PO only when no Bill links it and `POStatus==='Open'`; otherwise raise issue `po_cancel_review`. Retry policy: on `retryable` errors re-schedule the same task at 1m, 5m, 30m, 2h (attempts 1–4) then issue `sync_failed` and `vendorBillStatus='error'`; on non-retryable, issue immediately. Hooks: `applyBookingStatus` enqueues `po.create` on `assigned` (and on accept when `assignStatus` flips to accepted — one of the two, whichever happens first; the idempotent lookup covers both), `bill.create` on `completed`, `po.cancel` on `cancelled`.

- [ ] **Step 1: Failing tests** (fetch stub records calls; feature override on; connection row seeded): `assigned creates one PO with GST tax code and customer ref`, `enqueue is idempotent per booking and kind`, `completed creates a Bill linked to the PO`, `bill mode subtrade writes nothing on completion`, `shadow mode writes nothing and records the payload`, `validation error raises an issue and marks the task failed`, `switch off drops queued work`, `sample job never enqueues`, `status change succeeds when QuickBooks returns 500`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): purchase orders on assignment and bills on completion`.

### Task 9: Inbound — webhook route and paid detection (`services/quickbooks/pull.ts`)

**Files:**
- Create: `services/quickbooks/pull.ts`, `api/routes/quickbooks.ts`, `api/routes/__tests__/quickbooks-webhook.test.ts`, `services/__tests__/quickbooks-pull.test.ts`
- Modify: `api/index.ts` (mount `/api/integrations/quickbooks/webhook` before auth and body parsing, as L211-214 does for Stripe); `shared/features.ts FEATURE_ROUTES` `except` list (+ the webhook path)

**Interfaces (produces):**
```ts
export function verifyIntuitSignature(rawBody: Uint8Array, header: string|undefined, verifier: string): boolean  // base64(HMAC-SHA256)
export async function handleWebhook(payload: WebhookPayload): Promise<void>  // per realm: find integration by externalAccountId; enqueue task "qbo.pull" with { entities: [{name, id, operation}] }
export async function pullEntity(companyId, name: "Bill"|"PurchaseOrder"|"Vendor"|"Customer", id: string): Promise<void>
export async function adoptBillForPo(companyId, bill: Bill): Promise<void>  // Bill with LinkedTxn PurchaseOrder whose PO is in qbo_links → link bill, vendorBillStatus='billed'
export async function applyBillBalance(companyId, bill: Bill): Promise<void>  // Balance == 0 && TotalAmt > 0 → vendorBillStatus='paid', subtradePaidAt = latest linked BillPayment TxnDate (or now), timeline event "Subtrade paid in QuickBooks"; Balance > 0 after paid → back to 'billed'
```
Webhook route: read raw body, verify with `QUICKBOOKS_WEBHOOK_VERIFIER`, 401 on mismatch, dedupe by `idempotency_keys` key `qbo:<realm>:<entity>:<id>:<lastUpdated>`, respond 200 within 3 s (enqueue only). Bill `Delete`/`Void` → `vendorBillStatus='po_open'`, issue `bill_removed`.

- [ ] **Step 1: Failing tests** — signature accept/reject on exact raw bytes; duplicate event enqueues once; `adopts an existing Bill linked to the PO`; `Bill balance 0 marks the job paid and writes the timeline event`; `bill mode subtrade: bookkeeper's Bill is adopted then paid`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): signed webhook, bill adoption and subtrade-paid detection`.

### Task 10: Change-data-capture sweep and reconnect

**Files:**
- Modify: `services/quickbooks/pull.ts` (+ `sweepQboChanges`), `server.ts` (register sweep every 30 min with `oncePerTick("qbo-sweep", …)`, first run 60 s after boot), `services/quickbooks/index.ts` (+ `notifyNeedsReconnect`)
- Test: `services/__tests__/quickbooks-sweep.test.ts`

**Interfaces (produces):** `sweepQboChanges(): Promise<void>` — for every company with the feature on and a connected integration: `qboCdc(companyId, ["Bill","PurchaseOrder"], since = integration.lastSyncAt - 5 min)`, apply `adoptBillForPo`/`applyBillBalance` to each Bill, update `lastSyncAt`. `notifyNeedsReconnect(companyId)` sends one email (existing `services/email` sender) to the company's owner the first time status flips to `needs_reconnect`.

- [ ] **Step 1: Failing tests** — `sweep marks a paid bill when the webhook was missed`; `sweep after reconnect` (status needs_reconnect → reconnected → sweep flips paid, no new PO); `reconnect email sent once`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** → PASS. **Commit:** `feat(quickbooks): change-data-capture sweep and reconnect notice`.

### Task 11: Tenant API and admin page

**Files:**
- Modify: `api/routes/quickbooks.ts` (+ authed routes), `web/pages/admin/integrations.tsx` (QuickBooks card), `web/pages/admin/jobs/*` job detail (badge), `shared/features.ts FEATURE_ROUTES` (+ `/api/integrations/quickbooks/*` → `integrations.quickbooks`)
- Test: `api/routes/__tests__/quickbooks-admin.test.ts`

**Interfaces (produces):**
```
GET  /api/integrations/quickbooks/status      → { connected, companyName, realmId, billMode, shadow, taxCodeId, defaultItemId, parentCustomerId, lastSyncAt, openIssues }
PUT  /api/integrations/quickbooks/settings    body { billMode?, shadow?, taxCodeId?, defaultItemId?, parentCustomerId? } (admin/owner only)
GET  /api/integrations/quickbooks/options     → { taxCodes[], items[], customers[] (top-level only) } read live from QBO, 10-minute cache
GET  /api/integrations/quickbooks/mappings    → { technicians: [{riderId,name,qboId,qboName}], templates: [{templateId,name,qboId,qboName}] }
PUT  /api/integrations/quickbooks/mappings    body { kind, localId, qboId }
GET  /api/integrations/quickbooks/issues      → open issues;  POST …/issues/:id/resolve
POST /api/integrations/quickbooks/jobs/:id/sync → syncBookingNow
```
Admin card: Connect/Reconnect/Disconnect (existing flow), status line, a **Bill mode** radio ("ArrivePing creates the bill when the job completes" / "Subcontractors send their own invoices; we only track them"), **Shadow mode** switch with copy "Log what would be sent without writing to QuickBooks", tax code / default item / parent customer selects from `/options`, mapping tables with search, issues list with Resolve, and per-job "Sync now". Job detail shows `vendorBillStatus` as a badge: PO open · Billed · Paid (with date) · Needs attention.

- [ ] **Step 1: Failing route tests** — settings round-trip, `billMode` validation (only two values), mappings write to `qbo_links`, feature gate returns 403 when off, non-admin cannot change settings.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** routes, then the page (follow the existing card style in `integrations.tsx`). **Step 4: Run checks** + open the page in Playwright (`scripts/` screenshot) and look at it. **Commit:** `feat(quickbooks): tenant settings, mappings and issues in the Integrations page`.

### Task 12: Mobile and docs

**Files:**
- Modify: `api/routes/me.ts GET /earnings` (+ `subtradePaidAt`, `vendorBillStatus` per job), `packages/mobile/app/(rider)/earnings.tsx` and `app/job/[id].tsx` (small "Paid in QuickBooks · <date>" line when present — shipped with the next app release; web badge from Task 11 is the pilot's visible signal), `docs/QUICKBOOKS_SYNC.md` (operations: enabling a tenant, shadow→live, issues, questionnaire answers), `INTEGRATIONS_SETUP.md` L14-17 (redirect URI, webhook URL, verifier env)
- Test: `packages/mobile` — `bun test lib/__tests__` unchanged; `api/routes/__tests__/me-earnings.test.ts` (+ one assertion)

- [ ] **Step 1: Failing test** — earnings payload carries `subtradePaidAt` for a paid job.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run checks** (web + mobile tsc/tests) → PASS. **Commit:** `feat(quickbooks): paid-in-QuickBooks on earnings and docs`.

### Task 13: Branch finish

- [ ] Run the full CI test command for web and mobile; `bunx tsc -b --force --noEmit`; `bun run lint`.
- [ ] Open PR `feat/quickbooks-sync` → `main` with: summary, the Phase-0 table, env vars to add (`INTEGRATIONS_KEK`, `QUICKBOOKS_CLIENT_ID/SECRET` or superadmin page, `QUICKBOOKS_WEBHOOK_VERIFIER`, `QUICKBOOKS_ENV`), migration note (`0034`), and the pilot runbook link. PR body ends with the Claude Code attribution and session link.
- [ ] Hand Dan the Intuit portal checklist (blueprint Phase 4) and the questionnaire answer draft from `docs/QUICKBOOKS_SYNC.md`.

---

## Self-review (done 2026-10-28)
- Spec coverage: PO/Bill/BillPayment (T6, T8, T9), tenant bill mode (T8, T11), job costing (T5), GST default (T11 settings; T6 lines), feature switch + Control Hub (T3; hub reads the catalog), shadow mode (T8, T11), encryption + realmId + state (T1, T2), webhook + sweep + reconnect (T9, T10), admin UI (T11), earnings signal (T12), Phase 0 (T7), go-live steps (T13, blueprint Phase 4). Customer-side invoicing deliberately out of scope.
- Type consistency: `vendorBillStatus` values and `QboSettings` fields match across T3/T5/T8/T9/T11; task kinds `qbo.po.create|qbo.bill.create|qbo.po.cancel|qbo.pull` used consistently.
- Open choice left to the implementer: whether to hook `po.create` on `assigned` or accept — both are covered by the DocNumber lookup, so pick `assigned` and also call it on accept.
