#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  ArrivePing — one-command iOS → TestFlight helper
#  For non-technical use. Run:  npm run ship:ios   (from packages/mobile)
#
#  What it does, in order:
#    1. Checks you have the tools + the API key file
#    2. Makes sure you're logged in to Expo
#    3. Builds the iOS app on Expo's servers
#    4. Submits the finished build to TestFlight
#  It explains every step in plain English and stops with clear instructions
#  if anything is missing — it will NOT leave you guessing.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# pretty output
B="\033[1m"; G="\033[1;32m"; Y="\033[1;33m"; R="\033[1;31m"; C="\033[1;36m"; N="\033[0m"
say()  { printf "${C}▶ %s${N}\n" "$1"; }
ok()   { printf "${G}✔ %s${N}\n" "$1"; }
warn() { printf "${Y}! %s${N}\n" "$1"; }
die()  { printf "\n${R}✘ %s${N}\n" "$1"; exit 1; }
line() { printf "${B}────────────────────────────────────────────────────────${N}\n"; }

# always run from this script's project folder
cd "$(dirname "$0")/.."

line
printf "${B}  Shipping ${C}ArrivePing${B} to TestFlight${N}\n"
line
echo

# pick a runner: prefer npx, fall back to a global eas
if command -v eas >/dev/null 2>&1; then EAS="eas"; else EAS="npx --yes eas-cli"; fi

# ── Step 1: prerequisites ───────────────────────────────────────────────────
say "Step 1 of 4 — Checking everything is ready…"

command -v node >/dev/null 2>&1 || die "Node.js isn't installed. Install it from https://nodejs.org (LTS), then run this again."
ok "Node.js found ($(node -v))"

if [ ! -d node_modules ]; then
  warn "Dependencies aren't installed yet — installing now (one-time, ~2 min)…"
  (command -v bun >/dev/null 2>&1 && bun install) || npm install
fi
ok "Project dependencies installed"

if [ ! -f keys/AuthKey.p8 ]; then
  die "The App Store Connect key is missing.
      Expected file:  packages/mobile/keys/AuthKey.p8

      How to fix (non-technical):
        • This is a small security file from Apple that lets the upload happen.
        • Get the file 'AuthKey.p8' onto this computer and put it in the
          'keys' folder inside 'packages/mobile'.
        • If you don't have it, in App Store Connect go to:
          Users and Access → Integrations → App Store Connect API,
          create a new key (role: App Manager), download the .p8,
          and ask your dev to update eas.json with the new Key ID/Issuer ID.
      Then run this command again."
fi
ok "App Store Connect key found (keys/AuthKey.p8)"
echo

# ── Step 2: Expo login ──────────────────────────────────────────────────────
say "Step 2 of 4 — Making sure you're signed in to Expo…"
if $EAS whoami >/dev/null 2>&1; then
  ok "Signed in to Expo as: $($EAS whoami 2>/dev/null)"
else
  warn "You're not signed in. A login prompt will appear next."
  warn "Use the Expo account that's connected to this app."
  $EAS login || die "Login failed. Run 'npx eas-cli login' on its own, then try again."
  ok "Signed in to Expo"
fi
echo

# ── Step 3: build ───────────────────────────────────────────────────────────
say "Step 3 of 4 — Building the iOS app on Expo's servers…"
echo "    • This takes about 10–20 minutes. You can leave it running."
echo "    • If asked about signing, choose: ${B}Let EAS handle it${N}, then sign"
echo "      in with your ${B}Apple Developer${N} Apple ID when prompted."
echo
$EAS build --platform ios --profile production || die "The build didn't finish.
      Scroll up to read the error, or open https://expo.dev → your project →
      Builds to see the logs. Common cause: Apple sign-in/credentials.
      Fix it, then run 'npm run ship:ios' again (it will skip what's done)."
ok "Build finished — a .ipa was produced"
echo

# ── Step 4: submit ──────────────────────────────────────────────────────────
say "Step 4 of 4 — Sending the build to TestFlight…"
$EAS submit --platform ios --latest --profile production || die "The upload didn't complete.
      Scroll up for the reason. Most common: the keys/AuthKey.p8 doesn't match
      the Key ID/Issuer ID in eas.json. Then run 'npm run submit:ios' to retry
      just the upload (no need to rebuild)."
ok "Submitted to App Store Connect"
echo

# ── Done ────────────────────────────────────────────────────────────────────
line
printf "${G}  🎉 Done! Now finish on Apple's side:${N}\n"
line
cat <<'EOF'

  1) Go to  https://appstoreconnect.apple.com
       → Apps → ArrivePing → TestFlight tab.
     Your build appears as "Processing" for ~5–15 minutes. Wait for it.

  2) If you see "Missing Compliance", click it and answer the encryption
     question (a standard HTTPS app is normally exempt — pick the
     "uses standard encryption / exempt" option).

  3) TestFlight → Internal Testing → add a tester:
       IMPORTANT — use the SAME Apple ID that is signed into the
       TestFlight app on your iPhone. (This was the earlier mix-up.)

  4) On your iPhone, open the TestFlight app (signed in with that Apple ID).
     ArrivePing will appear → tap Install. That's it. 🚀

EOF
