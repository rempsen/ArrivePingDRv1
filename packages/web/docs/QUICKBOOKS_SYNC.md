# QuickBooks Sync

Mirrors a tenant's jobs into their own QuickBooks Online as the paperwork a
bookkeeper already expects, and brings payment status back:

| In ArrivePing | In the tenant's QuickBooks |
|---|---|
| Job assigned to (or accepted by) a technician / subtrade | **Purchase Order** to that technician's Vendor, one line per part of the tech pay, each line job-costed to the Customer and carrying the tenant's purchase tax code |
| Job completed, bill mode **ArrivePing creates the bill** | **Bill** linked to the PO (closes it) for the computed tech pay |
| Job completed, bill mode **Subcontractors send their own invoices** | nothing written; when the bookkeeper enters the subtrade's Bill against the PO it is adopted |
| Bill paid in QuickBooks (balance 0) | job shows **Subtrade paid** with the payment date (`bookings.vendor_bill_status`, `subtrade_paid_at`) |
| Job cancelled, technician declines or is released | the PO is deleted if nothing was billed on it; otherwise an issue asks a person |
| Job reassigned | the previous technician's PO is deleted the same way and a new one goes to the new vendor |

**Pricing the PO.** At assignment nothing has been paid yet, so the PO is
priced by the same tech-pay rules from what the job already knows (per-unit
line items, flat pay). The bill at completion carries the pay actually
accrued; bill line *n* is linked to PO line *n* (Intuit honours the link only
line by line), extra bill lines are unlinked, and a PO with lines the bill did
not cover is closed by the sync. A job that cannot be priced yet (hourly tech,
no line items) raises a `no_pay` issue and gets its PO when it completes.

Code: `src/services/quickbooks/` — `client.ts` (API, token refresh, error
classes), `resolve.ts` (vendor / customer / item links, tenant settings),
`mapping.ts` (job → PO / Bill, pure), `sync.ts` (outbound tasks, hooked from
`dispatch.fireEvent`), `pull.ts` (webhook + per-entity pull), `sweep.ts`
(30-minute change-data-capture backstop). Routes: `src/api/routes/quickbooks.ts`.
Tables: `qbo_links`, `qbo_issues` (migration `0034`).

## Switching a tenant on

1. **Control Hub → Features → QuickBooks sync** (`integrations.quickbooks`): on
   for the tenant. Off by default for customer tenants; on for internal ones.
2. The tenant's admin opens **Integrations → QuickBooks → Connect** and signs in
   to their Intuit account; ArrivePing stores the company (realm) id and the
   tokens, encrypted with `INTEGRATIONS_KEK`.
3. On the QuickBooks card → **Settings** they pick:
   - **Bill mode** — *ArrivePing creates the bill when the job completes* or
     *Subcontractors send their own invoices; we only track them*. Applies to
     jobs completed after the change.
   - **Purchase tax code** (BMD: GST only), **default item** for unmapped
     templates, optional **parent customer** for customers ArrivePing creates.
   - **Technicians → Vendors** and **Templates → Items** mappings. Unmapped
     technicians are matched by exact name, then created as Vendors. QuickBooks
     keeps one namespace for customers, vendors and employees, so a technician
     whose name is already a customer (the owner, say) is created as
     "Name (vendor)" and a resolved `name_in_use` issue says so; customers
     likewise get " (customer)". A customer the bookkeeper made inactive is
     reused and reactivated rather than duplicated.
   - **Shadow mode** (default on): everything is logged under *Issues* as
     "would create…" and nothing is written. Turn it off to go live.
   - **Sync jobs scheduled from** — fixed to the day QuickBooks was first
     connected. Jobs scheduled before it are the bookkeeper's history and are
     never sent (not on an event, not by the reconnect sweep). Move it if the
     tenant wants an earlier or later start.
4. **Issues** lists anything that needs a person: an ambiguous vendor name,
   a locked period, a cancelled or reassigned job that already has a bill, a
   bill removed in QuickBooks, a job that cannot be priced yet, a reconnect to
   a different QuickBooks company (`realm_changed`: every saved link is
   cleared, so check Mappings before going live). Resolve them there;
   **Sync now** on a job retries it. The same open issue is never raised twice.
5. **Reconnecting** (after a revoked token, or on purpose) re-queues the recent
   jobs that waited: never synced or failed, and completed with only a PO when
   ArrivePing writes the bill.

Per-tenant settings live in `integrations.config` (JSON):
`{ billMode, taxCodeId, defaultItemId, parentCustomerId, shadow, syncSince, reconnectNotifiedAt }`.

## Environment

| Variable | Purpose |
|---|---|
| `INTEGRATIONS_KEK` | 32 random bytes, base64. Encrypts OAuth tokens and app secrets at rest. Generate once: `openssl rand -base64 32`. |
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | Intuit app keys. The superadmin **Developer setup** page (`oauth_app_credentials`) overrides these without a restart. |
| `QUICKBOOKS_ENV` | `production` → `quickbooks.api.intuit.com`; anything else → the sandbox host. |
| `QUICKBOOKS_WEBHOOK_VERIFIER` | The Verifier Token from the Intuit portal's Webhooks page, for the environment whose keys are in use. |
| `APP_URL` | Used for the OAuth redirect URI and reconnect emails. |

Intuit portal for app `9bbffa40-a498-4e2c-8fd5-391bce3698fc`:
redirect URI `https://arriveping.com/api/integrations/oauth/callback/quickbooks`;
webhook endpoint `https://arriveping.com/api/integrations/quickbooks/webhook`
(entities Bill, BillPayment, PurchaseOrder, Vendor, Customer); scope
Accounting only.

## Phase 0 — sandbox smoke test (2026-10-28, Canada sandbox "Sandbox Company CA 48c6")

`bun run scripts/qbo-sandbox-smoke.ts` with the sandbox keys, a refresh token
from the OAuth Playground and the realm id in the environment.

```
PASS  connect + refresh-on-use — Sandbox Company CA 48c6 (CA)
PASS  (d) refreshed tokens persisted, sealed
PASS  tax codes readable — Exempt, GST/HST Adjustment, HST ON, Out of Scope, Zero-rated
PASS  service item available
PASS  vendor + customer create
PASS  exact-name vendor lookup
PASS  (a) PO with job-costed, tax-coded lines — total 810
PASS  PO lookup by DocNumber
PASS  (b) Bill linked to PO closes the PO — PO now Closed
PASS  bill carries the PO link (what pull.ts adopts by)
PASS  (c) BillPayment → Bill.Balance 0 — LinkedTxn [{"TxnType":"BillPaymentCheck"},{"TxnType":"PurchaseOrder"}]
PASS  CDC sees the changed bill
12/12 checks passed
```

Learned: Intuit links a payment to a bill as `BillPaymentCheck` /
`BillPaymentCreditCard`, not `BillPayment` (`pull.ts` matches the prefix).
Refresh tokens rotate about once a day, so every refresh response is stored.
A header-level `LinkedTxn` on a bill does **not** link it to the PO: the link
has to be on each line with the PO's own line id (`Line[].Id`, "1", "2", …).
A bill with fewer lines than the PO leaves it Open; a linked line with a
different amount, an extra unlinked line, a negative adjustment line and a
zero-amount linked line are all accepted; a sparse update with
`POStatus: "Closed"` closes a PO by hand. (Probed 2026-10-28, same sandbox.)
The script deactivates / deletes what it made unless `QBO_SMOKE_KEEP=1`.

## Operating notes

- **Webhook** deliveries are signed (HMAC-SHA256 over the raw body, header
  `intuit-signature`), deduplicated in `idempotency_keys`, and only queue a
  `qbo.pull` task. Intuit calls delivery best-effort; the **sweep** every 30
  minutes (`sweepQboChanges`, `server.ts`) pulls changed Bills since five
  minutes before the last sync, so a missed webhook costs at most half an hour.
- **Retries**: a QuickBooks 429/5xx re-queues the task at 1m, 5m, 30m, 2h, then
  raises `sync_failed`; an Intuit validation fault (6xxx) raises it at once.
- **Revoked connection**: the first failed refresh sets the integration to
  `needs_reconnect`, emails `company_settings.email` once, and the sweep skips
  the tenant until the Integrations page reconnects it. Jobs are never blocked.
- **Nothing is deleted in QuickBooks** except an open, un-billed PO when its
  job is cancelled.
- **Sample jobs** (`bookings.is_sample`) never sync.
- **More than one server**: a partial unique index on `scheduled_tasks`
  (`booking_id, kind` where pending and `kind LIKE 'qbo.%'`, migration `0035`)
  keeps it to one queued write per job and kind; if two instances still create
  the same PO or bill at once, the one that loses the `qbo_links` row deletes
  its copy.
- **Manual "Sync" on the Integrations card** goes through the QuickBooks
  client (refresh on use, tokens stay sealed); for other providers the
  refresh token is opened before the refresh and the rotation sealed.
- Limits: 500 requests/min and 10 concurrent per company; the sync makes a
  handful of calls per job.

## Intuit App Assessment questionnaire — answers for the technical sections

Use these as written; they describe what the code does.

**App information**
- How the app was built: in-house, TypeScript on Bun, calling the QuickBooks
  Online Accounting API v3 directly over HTTPS (no SDK, no third-party
  integration platform).
- Distribution: private / unlisted. Connected by ArrivePing customers from
  their own ArrivePing dashboard; not listed on the Intuit App Store.
- QuickBooks user types: company admins (the tenant's office) connect it.

**Authorization & authentication**
- Access tokens are refreshed only when they are within 60 seconds of expiry
  or after a 401, never on a timer; the refresh token returned by each refresh
  replaces the stored one (Intuit rotates it).
- The discovery document is not fetched at runtime; the OAuth 2.0 endpoints
  (`appcenter.intuit.com/connect/oauth2`,
  `oauth.platform.intuit.com/oauth2/v1/tokens/bearer`) are configured.
- Expired access token: refreshed and the call retried once. Expired or
  revoked refresh token (`invalid_grant`): the connection is marked
  *needs reconnect*, the customer is emailed once, and no further calls are
  made until they reconnect from the dashboard.
- CSRF: the `state` parameter is a random 128-bit value stored server-side
  with a 10-minute expiry and consumed once; a callback whose state is unknown
  or expired is rejected.
- Connect, disconnect and reconnect were tested in the sandbox (see Phase 0).
- The `realmId` from the redirect is stored with the connection and used in
  every API URL.

**API usage**
- Accounting API only. No Payments, no Payroll.
- QuickBooks Online versions: Plus and Advanced (purchase orders are required);
  Essentials and Simple Start are not supported and the connection page says so.
- Multicurrency: not used; transactions are in the company's home currency.
- Sales tax: purchase tax codes are read from the company and applied per line.
- Webhooks: yes — Bill, BillPayment, PurchaseOrder, Vendor, Customer; signature
  verified on every delivery. Change data capture is used as a backstop every
  30 minutes.
- Minor version pinned: 75.

**Error handling**
- Error handling tested in automated tests (throttle 429, 5xx, validation
  faults, revoked tokens).
- `intuit_tid` is captured from every error response and written to the log
  line and the issue record.
- Fault code, message and detail are logged (never tokens).

**Security**
- Client secret and all tokens are encrypted at rest (AES-256-GCM) with a key
  held only in the server environment; never logged, never sent to the browser.
- No known breaches. Dependencies are scanned in CI; the app runs behind HTTPS
  only; no WebSockets to Intuit; no CAPTCHA relevant.
- QuickBooks data is used only to create the customer's own purchase orders
  and bills and to read their payment status; it is not shared with third
  parties.
