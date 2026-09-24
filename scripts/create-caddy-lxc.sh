#!/usr/bin/env bash
#
# create-caddy-lxc.sh — provision the Caddy LXC (TLS reverse proxy) on a Proxmox host.
# Run FROM the Proxmox shell:  bash create-caddy-lxc.sh
#
# One of two Network-Services boxes (the other is create-adguard-lxc.sh). Split so Caddy —
# the component Loskai constantly reconfigures, and the one you'll rebuild during dev — can be
# torn down without taking LAN DNS (AdGuard) down with it.
#
# Caddy runs as root inside this single-purpose unprivileged LXC (the container is the security
# boundary), installed from the official Cloudsmith apt repo. It carries NO routes: Loskai
# pushes every route at runtime via the Admin API, and `caddy run --resume` restores them
# across restarts from Caddy's autosaved config.
#
# The container ID is auto-picked (next free VMID) and the IP comes from DHCP; assign a static
# lease/IP afterwards. Override anything via env, e.g. (point at a private forge for the
# Caddyfile fetch — see REPO_RAW_BASE below):
#   CTID=111 REPO_RAW_BASE=http://192.168.10.216:3000/sunde/Loskai/raw/branch/main \
#     bash create-caddy-lxc.sh
#
# TLS mode (default: internal CA — no domain or DNS token needed):
#   TLS_MODE=internal  → Caddy is its own CA (local_certs). LAN devices install the root once
#                        via the onboarding page at http://<lxc-ip>/.
#   TLS_MODE=acme      → public wildcard *.BASE_DOMAIN via DNS challenge; adds the matching
#                        caddy-dns plugin (via `caddy add-package`) and needs a provider token.
#
# Infrastructure scaffolding — read it before running. It cannot be tested outside a
# Proxmox host.

set -euo pipefail

# --- Proxmox autodetection ---
# Detect the host's bridge/storage/template instead of hardcoding vmbr0 / local-lvm / a pinned
# template (which goes stale). Every result falls back to a safe default and is still
# overridable via the matching env var below.

# The bridge the host itself uses (its default-route interface) — the LAN bridge on a normal
# single-NIC Proxmox box.
detect_bridge() {
	local dev
	dev="$(ip -o route show default 2>/dev/null | awk '{print $5; exit}')"
	case "$dev" in vmbr*) echo "$dev" ;; *) echo vmbr0 ;; esac
}

# First active storage supporting a content type ($1: rootdir = CT rootfs, vztmpl = templates);
# $2 is the fallback if none is found.
detect_storage() {
	local s
	s="$(pvesm status --content "$1" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
	echo "${s:-$2}"
}

# Newest debian-12-standard template: one already downloaded to $1, else the latest in the
# catalog, else a known-good pin.
detect_template() {
	local t
	t="$(pveam list "$1" 2>/dev/null | awk '{print $1}' | sed 's|.*/||' | grep '^debian-12-standard' | sort -V | tail -1)"
	[ -z "$t" ] && t="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep '^debian-12-standard' | sort -V | tail -1)"
	echo "${t:-debian-12-standard_12.7-1_amd64.tar.zst}"
}

# --- Configuration (override via environment) ---
CTID="${CTID:-$(pvesh get /cluster/nextid)}" # next free VMID unless overridden
CT_HOSTNAME="${CT_HOSTNAME:-caddy}"
CT_BRIDGE="${CT_BRIDGE:-$(detect_bridge)}"
CT_CORES="${CT_CORES:-2}"
CT_MEMORY="${CT_MEMORY:-512}"
CT_DISK="${CT_DISK:-4}"
CT_STORAGE="${CT_STORAGE:-$(detect_storage rootdir local-lvm)}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(detect_storage vztmpl local)}"
TEMPLATE="${TEMPLATE:-$(detect_template "$TEMPLATE_STORAGE")}"
# Only ACME mode needs your real domain (for the DNS-challenge wildcard cert). Internal mode
# uses a fixed *.localhost placeholder — the domain is a Loskai setting, never Caddy's.
BASE_DOMAIN="${BASE_DOMAIN:-example.no}"
# TLS mode: 'internal' (Caddy's own CA, the default) or 'acme' (public DNS-challenge wildcard).
TLS_MODE="${TLS_MODE:-internal}"
# ACME only — the caddy-dns plugin matching your domain's DNS provider (DuckDNS shown as default).
CADDY_DNS_PLUGIN="${CADDY_DNS_PLUGIN:-github.com/caddy-dns/duckdns}"
# Raw base URL of the Loskai repo. Internal mode fetches caddy/Caddyfile + the onboarding page
# from here, so this LXC and the co-located container share ONE config (no drift). Override for
# a private forge, e.g. REPO_RAW_BASE=http://192.168.10.216:3000/sunde/Loskai/raw/branch/main
REPO_RAW_BASE="${REPO_RAW_BASE:-https://raw.githubusercontent.com/sunde/Loskai/main}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# Wait for DHCP and return the container's first IPv4 (empty if it never comes up).
container_ip() {
	local ip=""
	for _ in $(seq 1 15); do
		ip="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')" || true
		[ -n "$ip" ] && { echo "$ip"; return 0; }
		sleep 2
	done
	echo ""
}

# --- Preflight / creation hardening (fail fast, tolerate transient hiccups) ---

# Abort with a clear message if the chosen bridge doesn't exist — a wrong CT_BRIDGE otherwise
# surfaces as a cryptic pct error only after the template download.
require_bridge() {
	ip link show dev "$CT_BRIDGE" &>/dev/null || {
		echo "Bridge '$CT_BRIDGE' not found. Set CT_BRIDGE= to an existing bridge (see 'ip link')." >&2
		exit 1
	}
}

# Abort early if a storage can't hold the content we intend to put on it.
require_storage_content() { # $1=storage  $2=content (rootdir|vztmpl)
	pvesm status --content "$2" 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$1" || {
		echo "Storage '$1' does not support '$2' content. Override the matching *_STORAGE=." >&2
		exit 1
	}
}

# Unprivileged containers need a root subuid/subgid mapping. Proxmox ships this by default, so
# this only adds the standard range on a host that has *no* root mapping at all — it never
# touches an existing one (guard on '^root:', not the exact line, so we can't add a 2nd range).
ensure_subid_maps() {
	grep -q '^root:' /etc/subuid || echo 'root:100000:65536' >>/etc/subuid
	grep -q '^root:' /etc/subgid || echo 'root:100000:65536' >>/etc/subgid
}

# Download a template, retrying a few times (transient mirror/network hiccups).
download_template() { # $1=storage  $2=template
	local attempt
	for attempt in 1 2 3; do
		pveam download "$1" "$2" && return 0
		echo "Template download attempt $attempt/3 failed; retrying..." >&2
		sleep $((attempt * 3))
	done
	echo "Failed to download template '$2' after 3 attempts." >&2
	exit 1
}

# Create the container, retrying with the next free VMID if the ID was claimed between
# selection and creation (a race on busy/clustered hosts). Updates the global CTID.
create_container() {
	local attempt out
	for attempt in 1 2 3; do
		if out="$(pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
			--hostname "$CT_HOSTNAME" \
			--cores "$CT_CORES" --memory "$CT_MEMORY" \
			--rootfs "$CT_STORAGE:$CT_DISK" \
			--net0 "name=eth0,bridge=$CT_BRIDGE,ip=dhcp" \
			--features nesting=1 \
			--unprivileged 1 \
			--onboot 1 2>&1)"; then
			return 0
		fi
		if grep -qiE 'already exists|already in use' <<<"$out"; then
			CTID="$(pvesh get /cluster/nextid)"
			echo "Container ID was already in use; retrying with $CTID" >&2
			continue
		fi
		echo "$out" >&2
		exit 1
	done
	echo "Could not create container after 3 attempts." >&2
	exit 1
}

# Wait for the container to reach 'running', then for its network, before running apt inside
# it. A blind sleep races DHCP/boot on slower hosts and makes apt fail intermittently.
wait_for_ready() {
	local i
	for i in $(seq 1 30); do
		pct status "$CTID" 2>/dev/null | grep -q 'status: running' && break
		sleep 1
	done
	[ -n "$(container_ip)" ] || echo "Warning: container has no IP yet; continuing." >&2
}

case "$TLS_MODE" in
	internal | acme) ;;
	*) echo "TLS_MODE must be 'internal' or 'acme' (got '$TLS_MODE')." >&2; exit 1 ;;
esac

if pct status "$CTID" &>/dev/null; then
	echo "Container $CTID already exists — aborting." >&2
	exit 1
fi

log "Using bridge=$CT_BRIDGE, ct-storage=$CT_STORAGE, template=$TEMPLATE_STORAGE:$TEMPLATE"

# --- Preflight: fail fast on a bad bridge/storage before creating anything ---
require_bridge
require_storage_content "$CT_STORAGE" rootdir
require_storage_content "$TEMPLATE_STORAGE" vztmpl
ensure_subid_maps

# --- Ensure the template is present ---
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
	log "Downloading template $TEMPLATE"
	pveam update
	download_template "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

# --- Create + start the container (DHCP; pin a static lease afterwards) ---
log "Creating LXC $CTID ($CT_HOSTNAME) on $CT_BRIDGE (DHCP)"
create_container

pct start "$CTID"
wait_for_ready # wait for 'running' + network before apt (replaces a blind sleep)

# --- Console autologin as root (matches the other LXCs on this host — pct console/enter
# should drop straight into a root shell, no login prompt). getty@tty1 covers `pct console`,
# container-getty@1 covers the pts fallback it sometimes lands on.
log "Enabling root autologin on the console"
pct exec "$CTID" -- mkdir -p /etc/systemd/system/getty@tty1.service.d /etc/systemd/system/container-getty@1.service.d
pct exec "$CTID" -- bash -c "cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf" <<'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
AUTOLOGIN
pct exec "$CTID" -- bash -c "cat > /etc/systemd/system/container-getty@1.service.d/autologin.conf" <<'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear pts/%I $TERM
AUTOLOGIN
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl restart getty@tty1 container-getty@1 2>/dev/null || true

# --- Install Caddy from the official Cloudsmith apt repo (stock; plugins added below) ---
log "Installing Caddy inside the container (TLS_MODE=$TLS_MODE)"
pct exec "$CTID" -- bash -euo pipefail -c "
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg unattended-upgrades
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		> /etc/apt/sources.list.d/caddy-stable.list
	apt-get update
	apt-get install -y caddy
	# The apt package ships a caddy user + default unit; we replace both below, so stop it now.
	systemctl stop caddy || true
"

# --- Enable unattended security upgrades (Debian's default origins = security only, so this
# patches the OS but never auto-bumps the Caddy package — avoids the acme plugin gotcha) ---
log "Enabling unattended-upgrades"
pct exec "$CTID" -- bash -c "cat > /etc/apt/apt.conf.d/20auto-upgrades" <<'AUTOUPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AUTOUPGRADES

# ACME mode needs the DNS-challenge plugin in the caddy binary. `caddy add-package` swaps in
# an official build that includes it — no xcaddy/Go toolchain required.
if [ "$TLS_MODE" = acme ]; then
	log "Adding caddy-dns plugin ($CADDY_DNS_PLUGIN) for ACME"
	pct exec "$CTID" -- caddy add-package "$CADDY_DNS_PLUGIN"
	pct exec "$CTID" -- systemctl stop caddy || true
fi

# --- Bootstrap Caddyfile (admin + TLS + onboarding, no routes) ---
log "Writing /etc/caddy/Caddyfile"
if [ "$TLS_MODE" = acme ]; then
	# Mirrors caddy/Caddyfile's behaviour for the public-cert path: a 404 for names with no
	# route (the block would otherwise be handler-less and answer an empty 200, which reads
	# as a broken service), and a :80 site so `scheme: "http"`/`"both"` routes have a server
	# to be pushed into — without one Caddy creates no port-80 listener at all. There is no
	# onboarding page here: ACME certs are publicly trusted, so there is nothing to install.
	pct exec "$CTID" -- bash -c "cat > /etc/caddy/Caddyfile" <<CADDYFILE
{
	admin 0.0.0.0:2019
}

*.{\$BASE_DOMAIN} {
	tls {
		dns duckdns {env.DUCKDNS_TOKEN}
	}
	header Content-Type "text/html; charset=utf-8"
	respond "<!doctype html><meta charset=utf-8><title>Not routed</title><p>Nothing is routed at this name." 404
}

# Plain-HTTP server. Caddy adds its own HTTP->HTTPS redirects here for every name it serves;
# Loskai pushes any \`scheme: "http"\` route at index 0, ahead of this catch-all.
:80 {
	respond "Nothing is routed at this name." 404
}
CADDYFILE
else
	# Internal mode reuses the SAME config as the co-located container: fetch caddy/Caddyfile
	# and the onboarding page from the repo (single source of truth, no inline duplicate). The
	# Caddyfile expects Caddy's data at /data/caddy and the page at /srv/setup — both satisfied
	# by XDG_DATA_HOME=/data in the systemd unit below and this mkdir. It uses *.{$BASE_DOMAIN},
	# fed the fixed 'localhost' placeholder (see UNIT_BASE_DOMAIN); local_certs signs every real
	# name Loskai pushes on demand regardless.
	log "Fetching Caddyfile + onboarding page from $REPO_RAW_BASE"
	pct exec "$CTID" -- mkdir -p /srv/setup
	pct exec "$CTID" -- bash -euo pipefail -c "
		curl -fsSL '$REPO_RAW_BASE/caddy/Caddyfile' -o /etc/caddy/Caddyfile
		curl -fsSL '$REPO_RAW_BASE/caddy/setup/index.html' -o /srv/setup/index.html
	"
fi

# --- systemd unit: run as root with --resume; XDG_DATA_HOME pins the data dir ---
# Root is fine here — the unprivileged LXC is the security boundary, and it drops the caddy
# user / CAP_NET_BIND_SERVICE ceremony. XDG_DATA_HOME pins Caddy's data dir to /data/caddy,
# matching the /data/caddy/pki path the fetched Caddyfile serves the root cert from.
pct exec "$CTID" -- bash -c "cat > /etc/systemd/system/caddy.service" <<'UNIT'
[Unit]
Description=Caddy
After=network.target

[Service]
Environment=XDG_DATA_HOME=/data
Environment=BASE_DOMAIN=__BASE_DOMAIN__
__TOKEN_LINE__
ExecStart=/usr/bin/caddy run --environ --resume --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

# Internal mode feeds a fixed *.localhost placeholder (domain is Loskai's, not Caddy's); ACME
# mode needs the real domain for its DNS-challenge wildcard.
if [ "$TLS_MODE" = acme ]; then UNIT_BASE_DOMAIN="$BASE_DOMAIN"; else UNIT_BASE_DOMAIN="localhost"; fi
pct exec "$CTID" -- sed -i "s/__BASE_DOMAIN__/$UNIT_BASE_DOMAIN/" /etc/systemd/system/caddy.service
if [ "$TLS_MODE" = acme ]; then
	# ACME needs the DNS-provider token in Caddy's environment (set to a placeholder here).
	pct exec "$CTID" -- sed -i "s|__TOKEN_LINE__|Environment=DUCKDNS_TOKEN=changeme|" /etc/systemd/system/caddy.service
else
	# Internal CA needs no token — drop the placeholder line.
	pct exec "$CTID" -- sed -i "/__TOKEN_LINE__/d" /etc/systemd/system/caddy.service
fi
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable --now caddy

CT_IP_ADDR="$(container_ip)"
: "${CT_IP_ADDR:=<container-ip>}" # fall back to a placeholder if DHCP didn't report in time

log "Done."
if [ "$TLS_MODE" = acme ]; then
	cat <<NEXT

Caddy is up on DHCP IP: ${CT_IP_ADDR}  (assign it a static lease/IP next).

Next steps (Caddy, TLS_MODE=acme):
  1. Set your real DNS token in the container:
       pct exec $CTID -- sed -i 's/DUCKDNS_TOKEN=changeme/DUCKDNS_TOKEN=<your-token>/' \\
         /etc/systemd/system/caddy.service
       pct exec $CTID -- systemctl daemon-reload && pct exec $CTID -- systemctl restart caddy
     (Swap CADDY_DNS_PLUGIN + the tls directive if your provider isn't DuckDNS.)
  2. Firewall Caddy's admin API: allow :2019 only from the Docker host (where Loskai runs).
  3. On the Docker host, point Loskai at CADDY_ADMIN_URL=http://${CT_IP_ADDR}:2019.
NEXT
else
	cat <<NEXT

Caddy is up on DHCP IP: ${CT_IP_ADDR}  (assign it a static lease/IP next).

Next steps (Caddy, TLS_MODE=internal — Caddy is its own CA):
  1. On each LAN device, open http://${CT_IP_ADDR}/ and follow the onboarding page to install
     the root certificate (or fetch it directly at http://${CT_IP_ADDR}/caddy-root.crt).
     One-time, per device — after that every name under your domain is trusted.
  2. Firewall Caddy's admin API: allow :2019 only from the Docker host (where Loskai runs).
  3. On the Docker host, point Loskai at CADDY_ADMIN_URL=http://${CT_IP_ADDR}:2019.
NEXT
fi
