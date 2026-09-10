#!/usr/bin/env bash
#
# deploy.sh — pull the latest source and (re)build + deploy Loskai on the Docker host.
# Run FROM the repo root on the Docker host:  bash scripts/deploy.sh
#
# The easy deploy path (no registry, no CI): the working tree IS the build context.
# `docker compose up -d` reuses the existing `loskai:latest` image and would silently
# skip your new code, so this script always passes `--build` — that's the whole point.
#
# Defaults to compose.yml (split LXC). Override for either other layout via env:
#   COMPOSE_FILE=compose.caddy-loskai.yml bash scripts/deploy.sh   # split DNS
#   COMPOSE_FILE=compose.colocated.yml    bash scripts/deploy.sh   # all-in-Docker

set -euo pipefail

# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ ! -f .env ]; then
	echo ".env not found — copy .env.example to .env and fill it in first." >&2
	exit 1
fi

log "Pulling latest source"
git pull --ff-only

# The state volume moved from ./loskai-settings:/opt/loskai to ./data:/data on 2026-09-05.
# The pull above is what swaps the compose file, so this is the moment it bites. Loskai's
# own startup guard cannot see this case — the new compose does not mount the old path, so
# from inside the container there is nothing to find, and it would come up as a *fresh
# install* with the public first-run setup open and every route missing. Nothing is
# destroyed (the old directory is untouched and the new one is mounted), but the fix
# should happen before the surprise, not after it.
if [ -f loskai-settings/settings.json ] && [ ! -f data/settings.json ]; then
	cat >&2 <<-'MIGRATE'
		Loskai's state directory moved: ./loskai-settings -> ./data (mounted at /data).
		Your existing state is still in ./loskai-settings and has not been touched.

		Move it, then re-run this script:

		    mv loskai-settings/* data/ && rmdir loskai-settings

		Or keep the old location by changing LOSKAI_DATA_DIR to /opt/loskai and
		restoring the ./loskai-settings:/opt/loskai mount — both in your compose file.
	MIGRATE
	exit 1
fi

log "Building + deploying ($COMPOSE_FILE)"
docker compose -f "$COMPOSE_FILE" up -d --build

log "Done — Loskai is up on :8080"
docker compose -f "$COMPOSE_FILE" ps
