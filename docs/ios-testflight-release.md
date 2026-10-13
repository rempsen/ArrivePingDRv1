# Shipping ArrivePing to TestFlight

This is the repeatable process Dan uses to push a new iOS build. It must be
run from a real computer (Dan's own laptop) — **not** from inside a Runable
sandbox/chat. Runable's own iOS build tooling is a separate, generic path and
does not carry our real Apple Developer credentials (bundle id
`com.nvc360.uberize`, team `86S82A9ZPS`, App Store Connect key) — using it
caused a failed submission before. This script is the one that actually
matches our setup, and it's now committed to the repo so it's there on any
machine that clones it.

## One-time setup (on Dan's machine)

1. Install [Node.js](https://nodejs.org) (LTS) and [Bun](https://bun.sh).
2. Clone the repo: `git clone git@github.com:rempsen/ArrivePingDRv1.git`
3. Get `AuthKey.p8` (the App Store Connect API key, key id `6Y6Z8B2F66`) onto
   that machine and place it at `packages/mobile/keys/AuthKey.p8`. This file
   itself is **never** committed (it's gitignored on purpose — it's a real
   Apple private key) — copy it over securely (AirDrop, encrypted USB, a
   password manager's secure note, etc.), never by email or chat.
4. Have the Apple ID / password for the Apple Developer account on hand —
   `eas build` prompts for Apple sign-in on first run per machine.

## Every time you want to ship a build

```bash
cd ArrivePingDRv1
git pull origin main          # always ship what's actually on main
cd packages/mobile
bash scripts/ship-ios.sh      # (same as the paused "ship:ios" npm script)
```

The script walks through 4 steps on its own and tells you in plain English
if anything is missing: checks `keys/AuthKey.p8` is there, confirms Expo
login, builds on Expo's servers (~10–20 min), then submits straight to
TestFlight. It ends by printing exactly what to do in App Store Connect
(wait for "Processing", answer the encryption/compliance question, add the
right Apple ID as an Internal Tester) and on the phone (open TestFlight
signed in with that same Apple ID → Install).

## Why the npm scripts are named `_paused_ship:ios` etc.

That prefix is a deliberate safety guard so nothing automated — in this repo
or in Runable's own tooling — can accidentally kick off a real App Store
submission by discovering a script literally named `build:ios`. Run the
file directly (`bash scripts/ship-ios.sh`) instead of renaming it back.

## Versioning

`eas.json`'s production profile has `autoIncrement: true` and
`appVersionSource: "remote"` — EAS bumps the build number itself on every
run. You don't need to hand-edit `app.json`'s version/build number before
shipping.

## Option B — the "Push to TestFlight" button in the admin dashboard

Superadmins (NVC360 staff) also get a one-click version of this inside the
app itself: **Admin → Push to TestFlight** (sidebar, superadmin-only, next
to Companies). Click the button, watch the log stream in the page, done —
no laptop, no terminal.

This runs the headless twin of the script above,
`packages/mobile/scripts/ship-ios-ci.sh`, as a background process on the
production web server (`packages/web/src/api/routes/mobile-release.ts`,
`GET /api/mobile-release/status`, `POST /api/mobile-release/start`). It
needs two production secrets that **do not exist yet** and must be added
through the "NVCV4 August 2026" chat's secrets form, then published:

- `EXPO_TOKEN` — a non-interactive Expo access token. Create one at
  expo.dev → account → Settings → Access Tokens (role: can create builds
  for this project).
- `IOS_ASC_KEY_P8_BASE64` — the same `AuthKey.p8` App Store Connect key,
  base64-encoded (`base64 -i AuthKey.p8 | pbcopy` on a Mac). The server
  decodes it to `packages/mobile/keys/AuthKey.p8` the first time the button
  is used; the raw `.p8` itself is still never committed.

Trade-off vs. Option A: the signing key now also lives on the production
server (bigger attack surface — that server is internet-facing) instead of
staying only on Dan's own machine. Both paths exist on purpose: use whichever
is more convenient at the time; neither is Runable's own generic one-click
iOS publish, which this project does not use.
