# Integrations — OAuth App Registration Guide

Tenants now connect with **one click → authorize on the provider's site**. No API keys are ever entered by tenants.

As the platform owner (superadmin `dan@nvc360.com`), you register each tool **once** in **Integrations → Developer setup**. Paste the Client ID + Secret, hit **Save & enable** — it goes live instantly (no restart). The provider's card flips from "Coming soon" to a blue **Connect** button for every tenant.

For each provider below: create an OAuth app, add the **Redirect URI**, copy the **Client ID / Secret** into the Developer setup form.

> Base domain used in redirect URIs: `https://nvc360fourdraft.runable.site`
> (If your live domain differs, the redirect URI shown in the Developer setup form is always authoritative — copy it from there.)

---

## QuickBooks (Accounting)
App `9bbffa40-a498-4e2c-8fd5-391bce3698fc` ("Accounting app for NVC360") at https://developer.intuit.com.
1. **Keys and credentials** → Development (sandbox) or Production keys.
2. **Redirect URI:** `https://arriveping.com/api/integrations/oauth/callback/quickbooks`
3. **Webhooks** → endpoint `https://arriveping.com/api/integrations/quickbooks/webhook`, entities Bill, BillPayment, PurchaseOrder, Vendor, Customer; copy the **Verifier Token** into `QUICKBOOKS_WEBHOOK_VERIFIER`.
4. Copy **Client ID** + **Client Secret** → paste in Developer setup. Set `QUICKBOOKS_ENV=production` when the production keys are in use.
5. Production keys need Intuit's App Assessment (the portal's **Compliance** page); the answers are in `packages/web/docs/QUICKBOOKS_SYNC.md`.
See `packages/web/docs/QUICKBOOKS_SYNC.md` for what the sync does and how a tenant is switched on.

## Google — Gmail, Calendar, Drive (one app covers all three)
All three use the **GOOGLE** app. Register once; scopes are requested per integration.
1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → Enable APIs**: Gmail API, Google Calendar API, Google Drive API.
3. **OAuth consent screen**: External, add your support email + scopes, add yourself as a test user (or publish).
4. **Credentials → Create Credentials → OAuth client ID → Web application.**
5. **Authorized redirect URIs** (add all three):
   - `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/gmail`
   - `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/google_calendar`
   - `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/google_drive`
6. Copy the **Client ID / Secret** → paste it for **each** of Gmail, Google Calendar, Google Drive in Developer setup (same keys for all three).

## Microsoft — Outlook, Microsoft 365, OneDrive (one app covers all three)
All use the **MICROSOFT** app (Azure AD).
1. https://entra.microsoft.com → **App registrations → New registration**.
2. Supported account types: *Accounts in any org directory and personal Microsoft accounts*.
3. **Redirect URI** (Web) — add all three:
   - `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/outlook`
   - `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/office365`
   - `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/onedrive`
4. **Certificates & secrets → New client secret** → copy the **Value** (this is the Client Secret).
5. Application (client) ID = **Client ID**.
6. **API permissions**: add delegated Microsoft Graph scopes — `Mail.Send`, `User.Read`, `Calendars.ReadWrite`, `Files.ReadWrite`, `offline_access`.
7. Paste the Client ID / Secret for Outlook, Microsoft 365, OneDrive in Developer setup (same keys).

## Dropbox (File Storage)
1. https://www.dropbox.com/developers/apps → **Create app** → Scoped access → Full Dropbox.
2. **Redirect URI:** `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/dropbox`
3. Permissions tab: enable `files.content.write`, `files.content.read`, `account_info.read`.
4. Copy **App key** (= Client ID) + **App secret** (= Client Secret).

## CompanyCam (Photos)
1. https://app.companycam.com → Settings → Integrations / Developer (or contact CompanyCam for OAuth app access).
2. **Redirect URI:** `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/companycam`
3. Copy **Client ID** + **Client Secret**.

## Xero (Accounting)
1. https://developer.xero.com/app/manage → **New app** → Web app.
2. **Redirect URI:** `https://nvc360fourdraft.runable.site/api/integrations/oauth/callback/xero`
3. Copy **Client ID** + generate a **Client Secret**.

---

### How it works under the hood
- Credentials are stored in the global `oauth_app_credentials` table (superadmin-only). DB-first, with env-var fallback (`<PREFIX>_CLIENT_ID/_SECRET`) if you'd rather set them server-side.
- Tenants only ever see whether a provider is **available**; they never see keys.
- Connect opens the provider's authorize page in a popup → tokens are exchanged & stored per company → refresh handled on **Sync**.
