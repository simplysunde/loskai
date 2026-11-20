#!/usr/bin/env bash
#
# deploy.sh — pull the latest source and (re)build + deploy this checkout on the Docker host.
# Run FROM the repo root on the Docker host:  bash scripts/deploy.sh
#
# For running a checkout's code — what is on main, released or not. An install from the
# released images needs none of this: `docker compose pull && docker compose up -d`. Here the
# working tree is the build context (compose.build.yml), and the images are tagged like the
# released ones, so `docker compose pull` would put those back; `--build` makes sure the new
# code is what runs.
#
# Defaults to compose.yml (Proxmox, or Loskai standalone). Override for either other setup via env:
#   COMPOSE_FILE=compose.caddy-loskai.yml bash scripts/deploy.sh   # Loskai + Caddy
#   COMPOSE_FILE=compose.colocated.yml    bash scripts/deploy.sh   # All-in-one

set -euo pipefail

# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

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

compose=(docker compose -f "$COMPOSE_FILE" -f compose.build.yml)

# The layouts that run Caddy here run the image caddy/Dockerfile builds; build it under the
# name the layout pulls, as compose.build.yml does for Loskai's.
caddy_image="$("${compose[@]}" config --images | grep '/loskai-caddy:' || true)"
if [ -n "$caddy_image" ]; then
	log "Building $caddy_image"
	docker build -t "$caddy_image" caddy
fi

log "Building + deploying ($COMPOSE_FILE)"
# --remove-orphans: after `make dev`, its Vite container still holds :8080.
"${compose[@]}" up -d --build --remove-orphans

log "Done — Loskai is up on :8080"
"${compose[@]}" ps
