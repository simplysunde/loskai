#!/usr/bin/env bash
#
# check-phone.sh — screenshot every page and the main dialogs of a running Loskai at phone
# widths, and report text that overlaps, sticks out past the screen, is cut off or is
# squeezed into a sliver.
#
#   LOSKAI_USER=admin LOSKAI_PASSWORD=… bash scripts/check-phone.sh [URL]
#
# URL defaults to http://127.0.0.1:8080 — `make live`, or a deployed Loskai. It opens pages
# and dialogs, never confirms or saves anything, so it is safe against a real one; its logins
# show in the sign-in log.
# Needs Docker: Playwright and its browser run in Playwright's own image, so nothing is
# installed here. Screenshots and contact sheets go to .phone-shots/ (git-ignored).
#
#   WIDTHS="412 360"   the widths to check (add 1280 to see the desktop beside them)
#   ONLY=machine-      only the steps whose name matches this regex
#   DEBUG=1            the whole error when a step can't be opened
#   BUSY=0             real data only — by default a machine's overview, what runs on it
#                      and Check for updates are made-up, crowded data
#
# Exits non-zero when something was found. The detector can't see everything — a table
# wider than its box scrolls instead of spilling — so look over the sheets too.
# docs/contributing/phone-layout.md has the patterns that fix what it finds.

set -euo pipefail

cd "$(dirname "$0")/.."

: "${LOSKAI_USER:?set LOSKAI_USER (and LOSKAI_PASSWORD) to an account to log in with}"
: "${LOSKAI_PASSWORD:?set LOSKAI_PASSWORD}"
export LOSKAI_URL="${1:-http://127.0.0.1:8080}"

# The image and the npm package must be the same Playwright version.
PLAYWRIGHT=1.63.0
out="$PWD/.phone-shots"
mkdir -p "$out"
rm -f "$out"/*.png

# As the calling user, so the screenshots are theirs; on the host's network, to reach a
# Loskai on 127.0.0.1.
status=0
docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e LOSKAI_URL -e LOSKAI_USER -e LOSKAI_PASSWORD -e WIDTHS -e HEIGHT -e ONLY -e BUSY -e DEBUG \
  -v "$PWD/scripts/check-phone.mjs:/check/check-phone.mjs:ro" -v "$out:/out" \
  "mcr.microsoft.com/playwright:v$PLAYWRIGHT-noble" \
  sh -c "cd /tmp && npm init -y >/dev/null \
    && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent --no-audit --no-fund playwright@$PLAYWRIGHT \
    && cp /check/check-phone.mjs . && node check-phone.mjs" || status=$?

echo "Screenshots and contact sheets: $out"
exit $status
