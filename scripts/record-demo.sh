#!/usr/bin/env bash
#
# record-demo.sh — build a made-up homelab, set it up through Loskai, record what Loskai
# does in it, and write the animations the README and the guide show to docs/images/.
#
#   bash scripts/record-demo.sh        (make demo)
#
# Nothing real is in it. The homelab has its own Docker daemon (Docker-in-Docker), so this
# host's containers never show, and its own LAN, $DEMO_SUBNET.0/24:
#
#   .2   AdGuard Home — the DNS box
#   .20  the Docker host — Loskai, its Caddy (compose.caddy-loskai.yml, as an install runs
#        it, on the images built from this checkout) and the apps Loskai installs
#   .30  homeassistant — a machine with a name and nothing else
#   .50  nas — a Debian machine with SSH, set up by Loskai
#
# Every app comes from the recipes, installed through Loskai. demo/setup.mjs does the setup
# through Loskai's API; demo/record.mjs records each flow. Both run in Playwright's image,
# and ffmpeg in its own, so this needs only Docker. The first run downloads the images
# (Immich's are large) into a volume, loskai-demo-docker; later runs reuse it.
# docs/contributing/demo.md says how to change a flow or add one.
#
#   DEMO_RECIPES=../loskai-recipes   install from a folder of recipes instead of the
#                                    default source — for recipes not pushed yet
#   DEMO_APPS="immich jellyfin …"    the recipes set up before recording (default below)
#   ONLY=routing                     only the flows whose name matches this regex
#   KEEP=1                           leave the homelab running afterwards, to look around:
#                                    http://$DEMO_SUBNET.20:8080, user admin, the password
#                                    printed at the end; KEEP=0 to clear it away again
#   DEMO_SUBNET=192.168.50           the made-up LAN; it must not be one this host routes

set -euo pipefail

cd "$(dirname "$0")/.."

SUB="${DEMO_SUBNET:-192.168.50}"
APPS="${DEMO_APPS:-immich jellyfin bambuddy}"
W="$PWD/.demo"
NET=loskai-demo
DIND=loskai-demo-docker
# The image and the npm package must be the same Playwright version (as in check-phone.sh).
PLAYWRIGHT=1.63.0
FFMPEG=lscr.io/linuxserver/ffmpeg:9.0.2
TAG=ghcr.io/simplysunde

die() { echo "record-demo: $*" >&2; exit 1; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

down() {
  docker exec "$DIND" sh -c 'docker ps -aq | xargs -r docker rm -f; docker volume prune -af; docker network prune -f' >/dev/null 2>&1 || true
  docker rm -fv "$DIND" loskai-demo-adguard loskai-demo-nas >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  # What the apps wrote is root's or theirs; a container removes it as root.
  if [ -d "$W" ]; then
    docker run --rm -q -v "$W:/w" debian:stable-slim find /w -mindepth 1 -delete
    rmdir "$W"
  fi
}

if [ "${KEEP:-}" = 0 ]; then
  down
  echo "The demo homelab is gone."
  exit 0
fi

command -v docker >/dev/null || die "needs Docker"
if ! docker network inspect "$NET" >/dev/null 2>&1 && ip route | grep -q "^$SUB\."; then
  die "this host already routes $SUB.0/24 — pick another: DEMO_SUBNET=192.168.77"
fi
case " $APPS " in *" immich "*)
  avail=$(awk '/MemAvailable/ {print int($2 / 1048576)}' /proc/meminfo)
  [ "$avail" -ge 5 ] || echo "record-demo: ${avail} GB of memory free — Immich wants about 4 GB more than the rest; leave it out with DEMO_APPS=\"jellyfin bambuddy\" if this stalls" >&2
esac

down
trap '[ "${KEEP:-}" = 1 ] || down' EXIT

rand() { head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
LOSKAI_PASSWORD=$(rand)
ADGUARD_PASSWORD=$(rand)
MACHINE_PASSWORD=$(rand)

log "Building Loskai and its Caddy from this checkout, and the demo's machine"
docker build -q -t "$TAG/loskai:demo" . >/dev/null
docker build -q -t "$TAG/loskai-caddy:demo" caddy >/dev/null
docker build -q -t loskai-demo-machine demo/machine >/dev/null

log "Starting the LAN: the Docker host, AdGuard, the NAS"
docker network create --subnet "$SUB.0/24" --gateway "$SUB.1" "$NET" >/dev/null
mkdir -p "$W"
# Its image has no /etc/localtime, which a real host has and recipes mount (Immich, Forgejo):
# missing, the daemon makes it a folder and the container won't start.
docker run -d -q --name "$DIND" --hostname docker --privileged --network "$NET" --ip "$SUB.20" \
  -e DOCKER_TLS_CERTDIR= -v loskai-demo-docker:/var/lib/docker -v "$W:$W" \
  -v /etc/localtime:/etc/localtime:ro docker:29.9.3-dind >/dev/null
docker run -d -q --name loskai-demo-adguard --network "$NET" --ip "$SUB.2" adguard/adguardhome:v0.107.80 >/dev/null
docker run -d -q --name loskai-demo-nas --hostname nas --network "$NET" --ip "$SUB.50" \
  --cap-add SYS_ADMIN -v /srv/storage -e MACHINE_PASSWORD="$MACHINE_PASSWORD" loskai-demo-machine >/dev/null

wait_for() { # what, then a command that succeeds once it is ready
  local what=$1; shift
  for _ in $(seq 90); do "$@" >/dev/null 2>&1 && return; sleep 2; done
  die "$what didn't come up"
}
wait_for "AdGuard's setup page" curl -fsS "http://$SUB.2:3000/control/install/get_addresses"
curl -fsS -o /dev/null -H 'Content-Type: application/json' -d "{\"web\":{\"ip\":\"0.0.0.0\",\"port\":3000},\"dns\":{\"ip\":\"0.0.0.0\",\"port\":53},\"username\":\"admin\",\"password\":\"$ADGUARD_PASSWORD\"}" \
  "http://$SUB.2:3000/control/install/configure" || die "AdGuard refused its setup"

wait_for "the demo's Docker daemon" docker exec "$DIND" docker info
# The volume is a cache of images only. The last run's containers come back with the daemon
# — the old Loskai with its old password — so they, their volumes and networks go first,
# and only then are the folders made.
docker exec "$DIND" sh -c 'docker ps -aq | xargs -r docker rm -f; docker volume prune -af; docker network prune -f' >/dev/null
docker run --rm -q -v "$W:/w" debian:stable-slim find /w -mindepth 1 -delete
mkdir -p "$W/loskai/data/recipes" "$W/loskai/stacks" "$W/out"
docker save "$TAG/loskai:demo" "$TAG/loskai-caddy:demo" | docker exec -i "$DIND" docker load -q >/dev/null
# Inside, they carry the tag an install runs, so the Docker tab shows what a user's would.
for image in loskai loskai-caddy; do
  docker exec "$DIND" sh -c "docker tag $TAG/$image:demo $TAG/$image:latest && docker rmi $TAG/$image:demo" >/dev/null
done

log "Installing Loskai on the Docker host (layout B, as the install guide does)"
cp compose.caddy-loskai.yml "$W/loskai/compose.yml"
cat > "$W/loskai/.env" <<EOF
LOSKAI_PASSWORD=$LOSKAI_PASSWORD
BASE_DOMAIN=home.lan
ADGUARD_URL=http://$SUB.2:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=$ADGUARD_PASSWORD
CADDY_HOST_IP=$SUB.20
HOST_IP=$SUB.20
STACKS_DIR=$W/loskai/stacks
EOF
if [ -n "${DEMO_RECIPES:-}" ]; then
  for r in "$DEMO_RECIPES"/*/; do [ -f "$r/recipe.yml" ] && cp -r "$r" "$W/loskai/data/recipes/"; done
fi
docker exec -w "$W/loskai" "$DIND" docker compose up -d --quiet-pull
wait_for "Loskai" curl -fsS "http://$SUB.20:8080/api/auth/status"

log "Setting the homelab up through Loskai, then recording"
status=0
docker run --rm -q --network "$NET" --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e LOSKAI_URL="http://$SUB.20:8080" -e LOSKAI_PASSWORD="$LOSKAI_PASSWORD" \
  -e MACHINE_PASSWORD="$MACHINE_PASSWORD" -e SUB="$SUB" \
  -e APPS="$APPS" -e LOCAL_RECIPES="${DEMO_RECIPES:+1}" -e ONLY \
  -v "$PWD/demo:/demo:ro" -v "$W/out:/out" \
  "mcr.microsoft.com/playwright:v$PLAYWRIGHT-noble" \
  sh -c "cd /tmp && npm init -y >/dev/null \
    && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent --no-audit --no-fund playwright@$PLAYWRIGHT \
    && cp /demo/setup.mjs /demo/record.mjs . && node setup.mjs && node record.mjs" || status=$?
if [ "$status" != 0 ]; then
  KEEP=1 # left up to look at, with the failed step's screenshot
  die "recording failed — the homelab is left up: http://$SUB.20:8080, admin / $LOSKAI_PASSWORD; KEEP=0 make demo clears it away"
fi

log "Converting the recordings"
bash demo/convert.sh "$W/out" docs/images "$FFMPEG"

if [ "${KEEP:-}" = 1 ]; then
  echo "The homelab is still up: http://$SUB.20:8080 — admin / $LOSKAI_PASSWORD. KEEP=0 make demo clears it away."
fi
