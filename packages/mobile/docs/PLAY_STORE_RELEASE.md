# ArrivePing Android — Google Play release

One page for the whole Android path: build → first upload → app setup in the
Play Console → testing → production → automated uploads. Everything builds
on Expo's servers (EAS); nothing needs Android Studio.

## What's configured

| Item | Value |
|---|---|
| App name | **ArrivePing** |
| Package name (permanent) | `com.nvc360.uberize`, same as the iOS bundle ID. Play never lets it change. |
| Version | `app.json → expo.version`, shared with iOS. `versionCode` auto-increments on EAS (`appVersionSource: remote`); the first Android build is versionCode 1. |
| Target SDK | Android 16 (API 36), from Expo SDK 54. That's what Play requires for new apps and updates since 2026-08-31. |
| Signing | Play App Signing. Google holds the app-signing key; EAS holds the **upload key**, which the first EAS build creates. |
| Build output | Android App Bundle (`.aab`), `production` profile, update channel `production` |
| Permissions | Location (fine, coarse, background) and a location foreground service while on the clock; camera (job photos); microphone (voice notes); notifications; calendar (writes jobs to the phone's calendar) |
| Blocked permissions | `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO`: the photo library opens Android's system photo picker, which needs no permission, so Play's photo/video permission declaration doesn't apply. `FOREGROUND_SERVICE_MEDIA_PLAYBACK` is blocked because the app never plays audio in the background. |
| Background-location disclosure | `lib/location-disclosure.ts`: Play's required in-app notice, shown before the location prompts (Android only) |
| Push notifications | **Need Firebase first.** Until then, Android gets no push. See step 9. |
| Privacy policy | https://arriveping.com/privacy (covers background location) |
| Account deletion | In the app: Profile → Delete my account. On the web: https://arriveping.com/support/delete-your-account |
| Support | support@nvc360.com · https://arriveping.com/support |

## Build the app bundle

GitHub → **Actions** → **Ship Android app** → **Run workflow**:

- `target: build-only` (the default) builds the `.aab` and stops. It takes about 15–25 minutes. The run's **Summary** has the download link and the EAS build page.
- `target: internal` builds the bundle and uploads it to the Internal testing track. This needs step 8 done first.

From a laptop instead: `cd packages/mobile && bunx eas-cli build --platform android --profile production`.

---

## First release: step by step

Steps 1–5 are one-time setup. Google requires the **first** bundle to be uploaded by hand in the Play Console (step 4); every later upload can come from the workflow.

### 1. Create the app

1. Go to https://play.google.com/console → **Home** → **Create app**.
2. App name: **ArrivePing**. Default language: English (pick the same one as the App Store listing).
3. App or game: **App**. Free or paid: **Free**. This can't be changed to paid later. Subscriptions are billed on the web, not through Google Play.
4. Tick the declarations (Developer Program Policies, US export laws) → **Create app**.

Check the account type while you're here: **Settings → Developer account → Account details**. It matters in step 6.

### 2. App content (Policy → App content)

Work down the list. Each section saves on its own.

| Section | Answer |
|---|---|
| **Privacy policy** | `https://arriveping.com/privacy` |
| **App access** | "All or some functionality is restricted". Add instructions plus a reviewer login: a technician account in a **demo company whose customers are fake** (example.test emails, no real phone numbers), so a reviewer can go On the clock without anyone real being texted or emailed. Say: "Sign in, tap On the clock, allow location 'All the time'. Open a job to see photos and voice notes." |
| **Ads** | No ads |
| **Content rating** | Start the questionnaire with category **All other app types**. No violence, sexual content, language, drugs or gambling. Users interact with each other (office ↔ technician messages and photos): **Yes**. Shares the user's location with other users: **Yes**. The expected result is Everyone / PEGI 3 with the "Users Interact" and "Shares Location" notes. |
| **Target audience and content** | **18 and over** only. Not designed to appeal to children. |
| **News app** | No |
| **Data safety** | See the table below. |
| **Government app** | No |
| **Financial features** | None |
| **Health** | None |
| **Advertising ID** | No (the app doesn't use it) |

**Data safety** answers:

- Collects or shares required user data: **Yes**. Encrypted in transit: **Yes**.
- Account creation: **Username and password**. Delete-account URL: `https://arriveping.com/support/delete-your-account`. Users can also ask for data deletion without deleting the account (privacy@nvc360.com): **Yes**.

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Location → Precise and Approximate | Yes | **Yes**: the customer sees the technician on the way to their job | Optional (permission) | App functionality |
| Personal info → Name, Email, Phone number | Yes | No | Required | App functionality, Account management |
| Photos and videos → Photos | Yes | No | Optional | App functionality |
| Audio → Voice or sound recordings | Yes | No | Optional | App functionality |
| Messages → Other in-app messages | Yes | No | Optional | App functionality |
| App info and performance → Crash logs, Diagnostics | Yes (Sentry) | No | Required | Analytics, App functionality |
| Device or other IDs | Yes (push token) | No | Required | App functionality |

The phone's calendar is **not** collected. The app writes jobs into it, and nothing from the calendar leaves the phone. Service providers (hosting, Sentry, email/SMS delivery) don't count as "sharing" in Play's terms.

### 3. Store listing (Grow users → Store presence → Main store listing)

- **Short description** (80 characters max): `Live arrival times, dispatch and job tools for field service technicians.`
- **Full description**: use the App Store text, and keep a sentence like this in it (Play checks that the listing matches the background-location use): *"While you're on the clock, ArrivePing shares your location with your dispatcher and gives the customer you're travelling to a live arrival time, even when the app is closed or not in use."*
- **App icon**: 512 × 512 PNG, at most 1 MB. Use `store/google-play/icon-512.png`.
- **Feature graphic**: 1024 × 500 PNG or JPG, no transparency. Use `store/google-play/feature-graphic-1024x500.png` (the wordmark on the app's navy), or swap in a designed one later.
- **Phone screenshots**: 2–8, portrait 9:16, each side 1080–3840 px recommended. Take them on an Android phone from the internal-testing build, not the iPhone app. Tablet screenshots are optional.
- **Category**: Business. Contact email: support@nvc360.com. Website: https://arriveping.com.

### 4. First upload, to Internal testing (no Google review)

1. **Test and release → Testing → Internal testing → Testers** tab → **Create email list** (e.g. "NVC360 team"). Add the Google accounts of everyone testing (up to 100) → **Save**. Copy the **opt-in link**.
2. **Releases** tab → **Create new release**.
3. **App signing**: accept **Use Google-generated key** (Play App Signing). The bundle you upload is signed with the EAS upload key, which Google then registers.
4. **Upload** the `.aab` from the workflow run's Summary.
5. The release name fills in as `1 (1.0.8)`. Add short release notes → **Next** → **Save and publish**, or **Start rollout to Internal testing**.
6. Testers open the opt-in link **on their Android phone** → **Accept invite** → **Download it on Google Play**. The first release can take an hour to appear; later ones take minutes.

### 5. Permission declarations (appear after the first upload)

These appear under **App content** once the uploaded bundle includes the permissions. Both forms ask for a short video. One recording covers both:

**Video** (about 30 seconds, recorded on an Android phone, uploaded to YouTube as *Unlisted*):

1. Open ArrivePing, signed in as a technician, and tap **On the clock**.
2. ArrivePing's notice appears ("Share your location while on the clock …") → **Continue**.
3. Android's prompt → allow location → in the next screen choose **Allow all the time**.
4. Go back to the app, then press Home or lock the phone. Show the "ArrivePing is sharing your location" notification.
5. Show the technician's pin moving on the dispatch map (arriveping.com) or the customer tracking page, while the app stays in the background.

**Location permissions → background location**

- Feature: *Live location for dispatch and customer arrival times while the technician is on the clock.*
- Why background is needed: *Technicians drive between jobs with the phone locked or another app open (navigation). Dispatch needs their position to assign the nearest job, and customers get a live arrival time. Sharing starts only when the technician goes On the clock and stops when they go off the clock or sign out. A persistent notification shows while it runs.*

**Foreground service permissions → Location**

- Use case: **Background location updates for user-initiated location sharing or navigation/ride tracking**.
- Description: *While a technician is on the clock, a foreground service keeps sending their location to dispatch and the customer they're travelling to.*
- If deferred or interrupted: *Dispatch sees a stale position and customers get a wrong arrival time.*

Google reviews these with your first closed or production release. Background location reviews can take longer than a normal review.

### 6. Production access: depends on the account type

- **Organization account**: go straight to step 7.
- **Personal account created after 13 Nov 2023**: Google first requires a **closed test with at least 12 testers, each opted in continuously for 14 days**.
  1. **Testing → Closed testing → Create track** (or use "Alpha").
  2. Add testers with an email list or Google Group. Testers who leave before the 14 days are up don't count.
  3. Promote the internal release to it (**Promote release → Closed testing**) → roll out. Closed releases are reviewed by Google.
  4. After 14 days: **Dashboard → Apply for production** and answer the three short sections.

### 7. Release to production

1. **Production → Countries / regions** → add Canada and the United States (or wherever the iOS app is offered).
2. **Create new release** → **Add from library** (pick the tested bundle), or use **Promote release → Production** from Internal or Closed testing.
3. Add release notes. Choose a staged rollout (e.g. 20%) or 100%.
4. **Publishing overview** → **Send changes for review**. Optional: turn on **Managed publishing** there to pick the exact go-live moment after approval.
5. The first review usually takes a few days, sometimes up to a week or more for new apps. Later updates are usually faster.

### 8. Automated uploads (service account, one time)

This lets the **Ship Android app** workflow upload builds to Internal testing itself.

1. https://console.cloud.google.com → pick or create a project → **APIs & Services → Library** → enable **Google Play Android Developer API**.
2. **IAM & Admin → Service accounts → Create service account** (e.g. `play-publisher`). It needs no Cloud roles. **Done** → open it → **Keys → Add key → Create new key → JSON**. This downloads a `.json` file.
3. Play Console → **Users and permissions → Invite new users** → paste the service account's email. On **App permissions**, add ArrivePing and allow **Release to testing tracks** and **View app information**. Add **Release to production** only if the workflow should ever do that; it doesn't today. → **Invite user**.
4. GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**: name `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Paste the whole JSON file as the value (base64 of it also works).
5. Run **Ship Android app** with `target: internal`. The workflow builds, uploads to Internal testing and rolls it out to testers. Production stays a step you take in the Play Console (step 7).

If the upload fails with *"Only releases with status draft may be created on draft app"*, Play still treats the app as a draft (setup unfinished). Run it with `playStatus: draft`, then roll the draft out in the Console.

### 9. Push notifications on Android (Firebase, one time)

Android delivers push through Firebase Cloud Messaging. Without it, the app works, but technicians get no job-offer or message notifications.

1. https://console.firebase.google.com → **Add project** (e.g. "ArrivePing"; Google Analytics not needed).
2. **Add app → Android**. Package name `com.nvc360.uberize`, nickname "ArrivePing" → **Register app** → **Download google-services.json** → skip the remaining SDK steps.
3. Send `google-services.json` to Claude to commit. It goes in `packages/mobile/` and gets wired into `app.json` (`android.googleServicesFile`). The file isn't a secret. **A new build is needed after this.**
4. Firebase → **Project settings → Service accounts → Generate new private key**. This downloads a second, *different* JSON.
5. Upload it to Expo: https://expo.dev → project **nvc360v4** → **Credentials** → **Android** → `com.nvc360.uberize` → **FCM V1 service account key** → **Add / Upload**. The server needs no change; it already sends through Expo's push service.

## Later releases

1. Bump `expo.version` in `app.json` (shared with iOS) when there's a new release.
2. **Ship Android app** → `target: internal` (or `build-only` and upload by hand).
3. Test on the internal track → Play Console → **Promote release → Production** → **Send changes for review**.

Over-the-air updates (EAS Update, channel `production`) reach Android binaries of the same `expo.version`, the same as on iOS.
