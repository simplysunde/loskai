#!/usr/bin/env bash
#
# create-lxc101.sh — provision the Network Services LXC (AdGuard Home + Caddy) on a
# Proxmox host. Run FROM the Proxmox shell:  bash create-lxc101.sh
#
# Idempotent-ish: it refuses if the container ID already exists. Everything is
# configurable via the env vars below, e.g.:
#   CTID=101 CT_IP=192.168.10.101/24 CT_GW=192.168.10.1 BASE_DOMAIN=example.no \
#     bash create-lxc101.sh
#
# This is infrastructure scaffolding — read it before running. It cannot be tested
# outside a Proxmox host.

set -euo pipefail

# --- Configuration (override via environment) ---
CTID="${CTID:-101}"
CT_HOSTNAME="${CT_HOSTNAME:-network-services}"
CT_IP="${CT_IP:-192.168.10.101/24}"
CT_GW="${CT_GW:-192.168.10.1}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_MEMORY="${CT_MEMORY:-1024}"
CT_DISK="${CT_DISK:-8}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
BASE_DOMAIN="${BASE_DOMAIN:-example.no}"
# The caddy-dns plugin matching your domain's DNS provider (DuckDNS shown as default).
CADDY_DNS_PLUGIN="${CADDY_DNS_PLUGIN:-github.com/caddy-dns/duckdns}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

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

# --- Create + start the container ---
log "Creating LXC $CTID ($CT_HOSTNAME) at $CT_IP"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
	--hostname "$CT_HOSTNAME" \
	--cores 2 --memory "$CT_MEMORY" \
	--rootfs "$CT_STORAGE:$CT_DISK" \
	--net0 "name=eth0,bridge=$CT_BRIDGE,ip=$CT_IP,gw=$CT_GW" \
	--features nesting=1 \
	--unprivileged 1 \
	--onboot 1

pct start "$CTID"
sleep 5 # let the network come up

# --- Provision inside the container ---
log "Installing AdGuard Home + Caddy inside the container"
ARCH="$(pct exec "$CTID" -- dpkg --print-architecture)"

pct exec "$CTID" -- bash -euo pipefail -c "
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y curl ca-certificates

	# AdGuard Home — official installer (installs + enables the systemd service).
	curl -s -S -L https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/master/scripts/install.sh | sh -s -- -v

	# Caddy — official custom build with the DNS-challenge plugin (no xcaddy/Go needed).
	curl -fsSL -o /usr/bin/caddy \
		'https://caddyserver.com/api/download?os=linux&arch=${ARCH}&p=${CADDY_DNS_PLUGIN//\//%2F}'
	chmod +x /usr/bin/caddy
	useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy || true
	mkdir -p /etc/caddy /var/lib/caddy
	chown -R caddy:caddy /var/lib/caddy
"

# --- Drop the bootstrap Caddyfile (admin + wildcard cert only, no routes) ---
log "Writing /etc/caddy/Caddyfile"
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

# --- systemd unit for Caddy (run --resume restores routes from the autosave) ---
pct exec "$CTID" -- bash -c "cat > /etc/systemd/system/caddy.service" <<'UNIT'
[Unit]
Description=Caddy
After=network.target

[Service]
User=caddy
Group=caddy
Environment=BASE_DOMAIN=__BASE_DOMAIN__
Environment=DUCKDNS_TOKEN=changeme
ExecStart=/usr/bin/caddy run --environ --resume --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

pct exec "$CTID" -- sed -i "s/__BASE_DOMAIN__/$BASE_DOMAIN/" /etc/systemd/system/caddy.service
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable --now caddy

log "Done."
cat <<NEXT

Next steps:
  1. Set your real DNS token in the container:
       pct exec $CTID -- sed -i 's/DUCKDNS_TOKEN=changeme/DUCKDNS_TOKEN=<your-token>/' \\
         /etc/systemd/system/caddy.service
       pct exec $CTID -- systemctl daemon-reload && pct exec $CTID -- systemctl restart caddy
     (Swap the caddy-dns plugin + tls directive if your provider isn't DuckDNS.)
  2. Open AdGuard setup at http://${CT_IP%%/*}:3000 and finish first-time config.
  3. Firewall Caddy's admin API: allow :2019 only from the Docker host.
  4. On the Docker host, point Loskai at CADDY_ADMIN_URL=http://${CT_IP%%/*}:2019
     and ADGUARD_URL=http://${CT_IP%%/*}:3000, then bring up compose.yml.
NEXT
