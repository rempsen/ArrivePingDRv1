# ArrivePing iOS — App Store release

ArrivePing has been live on the App Store since 2026-10-28
(https://apps.apple.com/ca/app/arriveping/id6776464675). Releases go to the
App Store by default; TestFlight-only builds are still available on request.

One page for the whole path: config → build → App Store review → live.
Everything builds on Expo's servers (EAS); nothing needs Xcode locally.

## What's configured

| Item | Value |
|---|---|
| App name | **ArrivePing** |
| Bundle ID (permanent) | `com.nvc360.uberize` (+ `com.nvc360.uberize.LiveActivity`) |
| Apple Team | `86S82A9ZPS` · App Store Connect app id `6776464675` |
| Marketing version | `app.json → expo.version` (**1.0.8** is the next release; 1.0.7 was withdrawn in its favour, 1.0.5 is live); build number auto-increments on EAS (`appVersionSource: remote`) |
| Runtime version | `policy: appVersion`: follows `expo.version`, so an over-the-air update only reaches binaries of the same version |
| Update channel | production builds use EAS Update channel `production` (from 1.0.6 on; the 1.0.5 binary has none) |
| iPad | supported (`supportsTablet: true`, all orientations, Split View allowed) |
| Background modes | `location`, `remote-notification`; APNs entitlement `production` |
| Permissions | location always/when-in-use, camera, photo library, microphone (voice notes), Face ID — strings in `app.json` |
| Encryption | `ITSAppUsesNonExemptEncryption: false` (standard HTTPS only) |
| Deep-link schemes | `arriveping://` (and legacy `homeserve://`) |
| Account deletion | Profile → **Delete my account** → `DELETE /api/me` (App Store 5.1.1(v)) |
| Legal / support URLs | https://arriveping.com/privacy · /terms · /support |

`eas.json` profiles: `development` (dev client), `preview` (internal), `production`
(store build + submit; expects the ASC API key at `keys/AuthKey.p8`).

## Release to the App Store

**Easiest:** Admin dashboard (superadmin) → **Release iOS app** → write the
"What's New" text → **Release to App Store**. That triggers
`.github/workflows/ship-ios.yml` (target `app-store`), which:

1. **Preflight** (seconds): stops at once if `expo.version` isn't newer than
   the live version, or another version is already with Apple.
2. Builds on EAS and uploads the build to App Store Connect.
3. Waits for Apple to process the build (usually 5–30 minutes).
4. Puts it on the App Store version (creates it, or reuses an open draft),
   sets "What's New", and **submits it for review** with **release
   automatically after approval**. Customers get it once Apple approves
   (typically within a day or two).

The App Store side (`scripts/asc/release.ts`) talks to the App Store Connect
API with the same key EAS uses. Screenshots, description, App Review notes and
privacy labels carry over from the live version; change them in App Store
Connect only when they need to change.

**TestFlight only** (testers, no review): the dashboard's **TestFlight only**
button, or run the workflow with `target: testflight`. Every App Store build
also shows up in TestFlight first, so testers can try it while it's in review.

**From a laptop** (TestFlight upload only; finish in App Store Connect):

```
cd packages/mobile
npm run ship:ios        # checks tools + key, logs in to Expo, builds, submits
```

Needs `keys/AuthKey.p8` (App Store Connect → Users and Access → Integrations →
API keys; role App Manager). If you create a new key, update `ascApiKeyId` /
`ascApiKeyIssuerId` in `eas.json` **and** `ASC_KEY_ID` / `ASC_ISSUER_ID` in the
workflow.

## Before every store submission

1. Bump `expo.version` in `app.json` (patch for fixes: 1.0.6 → 1.0.7). The
   runtime version follows it automatically. The workflow refuses a version
   that isn't newer than the live one.
2. Smoke-test on a phone **and an iPad** (a TestFlight-only build when the
   change is risky): sign in, tap
   the big **Sign in** button on Jobs (red → green, On the clock), open a job, Live Activity appears, photo + signature, go
   offline, Profile → legal links open, Delete my account shows its confirm
   sheet (cancel it).
3. Only when something changed (new screens, new permissions): update
   screenshots (6.9" iPhone **and** 13" iPad), description, privacy labels or
   the **App Review notes** (demo tenant + technician login, how to start a
   shift to see background location, that accounts are provisioned by the
   employer, and how to find Delete my account) in App Store Connect before
   releasing. Everything else carries over.
4. Release from the dashboard. To hold a release for a launch date instead,
   switch that version to **Manually release this version** in App Store
   Connect while it's in review.

## Gotchas

- **Background "Always" location** is what reviewers look at hardest. The
  permission strings and the review notes must say the same thing: location is
  shared only while On the clock, for live customer ETAs.
- **Production push tokens** only work on TestFlight/App Store builds, never in
  Expo Go.
- **iPad:** because Split View is allowed, the app must handle every
  orientation. Screens use the `WIDE`/`FORM` width caps from `lib/theme.ts` so
  content stays readable on a 13" screen — keep using them on new screens.
- **Android** mirrors iOS (`com.nvc360.uberize`): see
  [PLAY_STORE_RELEASE.md](./PLAY_STORE_RELEASE.md) and the **Ship Android app** workflow.
- **Brand icon (approved Oct 14, 2026).** `assets/icon-source.png` is the
  approved 2048² "AP" master (navy, white letters, blue signal). `icon.png`
  (App Store + default Home Screen, opaque), `icon-dark.png` / `icon-tinted.png`
  (iOS 18+ appearances), `adaptive-icon.png` (Android, mark inside the safe
  zone), `splash-icon.png`, the Live Activity images in `assets/liveActivity/`
  and the sign-in wordmark all come from the approved package in Google Drive
  (ArrivePing › Digital Assets). Regenerate from there, never from old art.
