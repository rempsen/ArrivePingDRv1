#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  ArrivePing — headless iOS → TestFlight release.
#
#  This is the non-interactive twin of ship-ios.sh. The admin dashboard's
#  "Push to TestFlight" button does NOT call this file directly — it
#  triggers .github/workflows/ship-ios.yml, which runs the same steps on
#  GitHub's own runner. This script is kept as a manually-runnable headless
#  fallback (e.g. from any other CI, or by hand on a machine that already
#  has EXPO_TOKEN and the key decoded).
#
#  It never prompts. It expects:
#   - EXPO_TOKEN set in the environment (non-interactive Expo auth), and
#   - keys/AuthKey.p8 already on disk (the caller is responsible for writing
#     it there, e.g. decoding it from a secret before calling this script).
#
#  Exits non-zero on any failure. Caller is responsible for capturing output.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

echo "────────────────────────────────────────────────────────"
echo "  Shipping ArrivePing to TestFlight (headless)"
echo "────────────────────────────────────────────────────────"

if command -v eas >/dev/null 2>&1; then EAS="eas"; else EAS="bunx --yes eas-cli"; fi

[ -n "${EXPO_TOKEN:-}" ] || { echo "✘ EXPO_TOKEN is not set."; exit 1; }
[ -f keys/AuthKey.p8 ] || { echo "✘ keys/AuthKey.p8 is missing."; exit 1; }

if [ ! -d node_modules ]; then
  echo "▶ Installing dependencies…"
  (command -v bun >/dev/null 2>&1 && bun install) || npm install
fi
echo "✔ Dependencies installed"

echo "▶ Checking Expo auth…"
$EAS whoami
echo "✔ Signed in to Expo"

echo "▶ Building the iOS app on Expo's servers (10–20 min)…"
# --json: the finished build on stdout, so the submit below sends exactly this
# build rather than whichever is newest (another run's, if two overlap).
$EAS build --platform ios --profile production --non-interactive --json > build.json
# Parsed with node (eas-cli already needs it), so jq isn't another prerequisite.
BUILD_ID="$(node -e 'const b=JSON.parse(require("fs").readFileSync("build.json","utf8"));process.stdout.write((Array.isArray(b)?b[0]:b)?.id||"")')"
[ -n "$BUILD_ID" ] || { echo "✘ Couldn't read the build id from eas-cli."; cat build.json; exit 1; }
echo "✔ Build finished"

echo "▶ Submitting the build to TestFlight…"
$EAS submit --platform ios --id "$BUILD_ID" --profile production --non-interactive
echo "✔ Submitted to App Store Connect"

echo "DONE — check appstoreconnect.apple.com → ArrivePing → TestFlight"
