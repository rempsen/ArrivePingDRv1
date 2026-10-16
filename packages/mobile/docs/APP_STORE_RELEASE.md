# ArrivePing iOS — TestFlight and App Store release

One page for the whole path: config → build → TestFlight → App Store review.
Everything builds on Expo's servers (EAS); nothing needs Xcode locally.

## What's configured

| Item | Value |
|---|---|
| App name | **ArrivePing** |
| Bundle ID (permanent) | `com.nvc360.uberize` (+ `com.nvc360.uberize.LiveActivity`) |
| Apple Team | `86S82A9ZPS` · App Store Connect app id `6776464675` |
| Marketing version | `app.json → expo.version` (**1.0.2**); build number auto-increments on EAS (`appVersionSource: remote`) |
| iPad | supported (`supportsTablet: true`, all orientations, Split View allowed) |
| Background modes | `location`, `remote-notification`; APNs entitlement `production` |
| Permissions | location always/when-in-use, camera, photo library, microphone (voice notes), Face ID — strings in `app.json` |
| Encryption | `ITSAppUsesNonExemptEncryption: false` (standard HTTPS only) |
| Deep-link schemes | `arriveping://` (and legacy `homeserve://`) |
| Account deletion | Profile → **Delete my account** → `DELETE /api/me` (App Store 5.1.1(v)) |
| Legal / support URLs | https://arriveping.com/privacy · /terms · /support |

`eas.json` profiles: `development` (dev client), `preview` (internal), `production`
(store build + submit; expects the ASC API key at `keys/AuthKey.p8`).

## Ship a build to TestFlight

**Easiest:** Admin dashboard (superadmin) → **Push to TestFlight**. That triggers
`.github/workflows/ship-ios.yml`, which builds on EAS and submits to App Store
Connect using the `EXPO_TOKEN` and `IOS_ASC_KEY_P8_BASE64` repository secrets.
Progress shows in the dashboard and under GitHub → Actions → "Ship iOS to TestFlight".

**From a laptop instead:**

```
cd packages/mobile
npm run ship:ios        # checks tools + key, logs in to Expo, builds, submits
# or the two halves:
npm run build:ios
npm run submit:ios
```

Needs `keys/AuthKey.p8` (App Store Connect → Users and Access → Integrations →
API keys; role App Manager). If you create a new key, update `ascApiKeyId` /
`ascApiKeyIssuerId` in `eas.json`.

After the upload: App Store Connect → ArrivePing → **TestFlight**. "Processing"
takes 5–15 minutes. Internal testers (your team) need no review; the Apple ID
you invite must be the one signed in to the TestFlight app on the phone.

## Before every store submission

1. Bump `expo.version` **and** `expo.runtimeVersion` together in `app.json`
   (they must match so OTA updates only reach builds that can run them).
2. Ship to TestFlight and smoke-test on a phone **and an iPad**: sign in, go
   On the clock, open a job, Live Activity appears, photo + signature, go
   offline, Profile → legal links open, Delete my account shows its confirm
   sheet (cancel it).
3. In App Store Connect → App Store tab → the version: select the build, check
   screenshots (6.9" iPhone **and** 13" iPad), description, keywords, support
   URL (`https://arriveping.com/support`), privacy policy URL, privacy
   nutrition labels, age rating, and the **App Review notes** (demo tenant +
   technician login, how to start a shift to see background location, that
   accounts are provisioned by the employer, and how to find Delete my account).
4. Choose **Manually release this version**, then Submit for Review.

## Gotchas

- **Background "Always" location** is what reviewers look at hardest. The
  permission strings and the review notes must say the same thing: location is
  shared only while On the clock, for live customer ETAs.
- **Production push tokens** only work on TestFlight/App Store builds, never in
  Expo Go.
- **iPad:** because Split View is allowed, the app must handle every
  orientation. Screens use the `WIDE`/`FORM` width caps from `lib/theme.ts` so
  content stays readable on a 13" screen — keep using them on new screens.
- **Android** mirrors iOS (`com.nvc360.uberize`): `eas build --platform android
  --profile production` when a Play Store track is wanted.
- The icon source is `assets/icon-source.png` (2048², with alpha) if the
  1024² store icon ever needs regenerating.
