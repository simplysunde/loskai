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
# lease/IP afterwards. Override anything via env, e.g.:
#   CTID=111 BASE_DOMAIN=example.no bash create-caddy-lxc.sh
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

# --- Configuration (override via environment) ---
CTID="${CTID:-$(pvesh get /cluster/nextid)}" # next free VMID unless overridden
CT_HOSTNAME="${CT_HOSTNAME:-caddy}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_MEMORY="${CT_MEMORY:-512}"
CT_DISK="${CT_DISK:-4}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
BASE_DOMAIN="${BASE_DOMAIN:-example.no}"
# TLS mode: 'internal' (Caddy's own CA, the default) or 'acme' (public DNS-challenge wildcard).
TLS_MODE="${TLS_MODE:-internal}"
# ACME only — the caddy-dns plugin matching your domain's DNS provider (DuckDNS shown as default).
CADDY_DNS_PLUGIN="${CADDY_DNS_PLUGIN:-github.com/caddy-dns/duckdns}"

# Caddy stores its PKI + autosaved config here (pinned via XDG_DATA_HOME in the systemd unit
# below, so the onboarding page's /caddy-root.crt path is deterministic).
CADDY_DATA_DIR="/var/lib/caddy/caddy"

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

case "$TLS_MODE" in
	internal | acme) ;;
	*) echo "TLS_MODE must be 'internal' or 'acme' (got '$TLS_MODE')." >&2; exit 1 ;;
esac

if pct status "$CTID" &>/dev/null; then
	echo "Container $CTID already exists — aborting." >&2
	exit 1
fi

# --- Ensure the template is present ---
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
	log "Downloading template $TEMPLATE"
	pveam update
	pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

# --- Create + start the container (DHCP; pin a static lease afterwards) ---
log "Creating LXC $CTID ($CT_HOSTNAME) on $CT_BRIDGE (DHCP)"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
	--hostname "$CT_HOSTNAME" \
	--cores 2 --memory "$CT_MEMORY" \
	--rootfs "$CT_STORAGE:$CT_DISK" \
	--net0 "name=eth0,bridge=$CT_BRIDGE,ip=dhcp" \
	--features nesting=1 \
	--unprivileged 1 \
	--onboot 1

pct start "$CTID"
sleep 5 # let the network come up

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
	pct exec "$CTID" -- bash -c "cat > /etc/caddy/Caddyfile" <<CADDYFILE
{
	admin 0.0.0.0:2019
}

*.{\$BASE_DOMAIN} {
	tls {
		dns duckdns {env.DUCKDNS_TOKEN}
	}
}
CADDYFILE
else
	pct exec "$CTID" -- mkdir -p /srv/setup
	pct exec "$CTID" -- bash -c "cat > /etc/caddy/Caddyfile" <<CADDYFILE
{
	admin 0.0.0.0:2019
	local_certs
}

# Internal cert per *.\$BASE_DOMAIN name on demand. No handlers -> cert only.
*.{\$BASE_DOMAIN} {
	tls internal
}

# Certificate-onboarding page on :80 (plain HTTP, reachable by IP before the root is trusted).
:80 {
	handle /caddy-root.crt {
		root * ${CADDY_DATA_DIR}/pki/authorities/local
		rewrite * /root.crt
		header Content-Type application/x-x509-ca-cert
		file_server
	}
	handle {
		root * /srv/setup
		file_server
	}
}
CADDYFILE

	# Minimal onboarding page. The full auto-detecting page lives at caddy/setup/index.html in
	# the repo — copy it into the container's /srv/setup to replace this placeholder.
	pct exec "$CTID" -- bash -c "cat > /srv/setup/index.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<title>Install the local CA</title>
<h1>Trust this network's certificate</h1>
<p><a href="/caddy-root.crt">Download the root certificate</a>, then install it as a trusted
authority for identifying websites. After that, every <code>*.$BASE_DOMAIN</code> name on this
LAN is trusted in your browser. One-time, per device.</p>
HTML
fi

# --- systemd unit: run as root with --resume; XDG_DATA_HOME pins the data dir ---
# Root is fine here — the unprivileged LXC is the security boundary, and it drops the caddy
# user / CAP_NET_BIND_SERVICE ceremony. XDG_DATA_HOME pins Caddy's data dir to $CADDY_DATA_DIR,
# matching the onboarding PKI path above.
pct exec "$CTID" -- bash -c "cat > /etc/systemd/system/caddy.service" <<'UNIT'
[Unit]
Description=Caddy
After=network.target

[Service]
Environment=XDG_DATA_HOME=/var/lib/caddy
Environment=BASE_DOMAIN=__BASE_DOMAIN__
__TOKEN_LINE__
ExecStart=/usr/bin/caddy run --environ --resume --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

pct exec "$CTID" -- sed -i "s/__BASE_DOMAIN__/$BASE_DOMAIN/" /etc/systemd/system/caddy.service
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
  1. On each LAN device, open http://${CT_IP_ADDR}/ and install the root certificate
     (or fetch it directly at http://${CT_IP_ADDR}/caddy-root.crt). One-time, per device.
     The richer auto-detecting page lives at caddy/setup/index.html in the repo — copy it
     into the container's /srv/setup to replace the minimal placeholder.
  2. Firewall Caddy's admin API: allow :2019 only from the Docker host (where Loskai runs).
  3. On the Docker host, point Loskai at CADDY_ADMIN_URL=http://${CT_IP_ADDR}:2019.
NEXT
fi
