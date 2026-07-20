#!/usr/bin/env bash
#
# create-adguard-lxc.sh — provision the AdGuard Home LXC (LAN DNS) on a Proxmox host.
# Run FROM the Proxmox shell:  bash create-adguard-lxc.sh
#
# One of two Network-Services boxes (the other is create-caddy-lxc.sh). They're deliberately
# split: AdGuard is the LAN's DNS resolver, so rebuilding or restarting Caddy — the component
# Loskai constantly reconfigures — must never take name resolution down with it.
#
# The container ID is auto-picked (next free VMID) and the IP comes from DHCP; assign a static
# lease/IP afterwards. Override anything via env, e.g.:
#   CTID=110 CT_BRIDGE=vmbr0 bash create-adguard-lxc.sh
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
CT_HOSTNAME="${CT_HOSTNAME:-adguard}"
CT_BRIDGE="${CT_BRIDGE:-$(detect_bridge)}"
CT_MEMORY="${CT_MEMORY:-512}"
CT_DISK="${CT_DISK:-4}"
CT_STORAGE="${CT_STORAGE:-$(detect_storage rootdir local-lvm)}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(detect_storage vztmpl local)}"
TEMPLATE="${TEMPLATE:-$(detect_template "$TEMPLATE_STORAGE")}"

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

if pct status "$CTID" &>/dev/null; then
	echo "Container $CTID already exists — aborting." >&2
	exit 1
fi

log "Using bridge=$CT_BRIDGE, ct-storage=$CT_STORAGE, template=$TEMPLATE_STORAGE:$TEMPLATE"

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
	--cores 1 --memory "$CT_MEMORY" \
	--rootfs "$CT_STORAGE:$CT_DISK" \
	--net0 "name=eth0,bridge=$CT_BRIDGE,ip=dhcp" \
	--features nesting=1 \
	--unprivileged 1 \
	--onboot 1

pct start "$CTID"
sleep 5 # let the network (DHCP) come up before apt

# --- Install AdGuard Home (official installer — runs as root, enables the service) ---
log "Installing AdGuard Home inside the container"
pct exec "$CTID" -- bash -euo pipefail -c "
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y curl ca-certificates unattended-upgrades
	curl -s -S -L https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/master/scripts/install.sh | sh -s -- -v
"

# --- Enable unattended security upgrades (Debian's default origins = security only, so this
# patches the OS but never touches AdGuard, which self-updates from its own UI) ---
log "Enabling unattended-upgrades"
pct exec "$CTID" -- bash -c "cat > /etc/apt/apt.conf.d/20auto-upgrades" <<'AUTOUPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AUTOUPGRADES

CT_IP_ADDR="$(container_ip)"
: "${CT_IP_ADDR:=<container-ip>}" # fall back to a placeholder if DHCP didn't report in time

log "Done."
cat <<NEXT

AdGuard is up on DHCP IP: ${CT_IP_ADDR}  (assign it a static lease/IP next).

Next steps (AdGuard):
  1. Open AdGuard setup at http://${CT_IP_ADDR}:3000 and finish first-time config
     (set the admin user/password; enable the DNS server on :53).
  2. Firewall the REST API: allow :3000 only from the Docker host (where Loskai runs).
  3. Point your LAN's DHCP DNS at this box so devices resolve through AdGuard.
  4. On the Docker host, set Loskai's ADGUARD_URL=http://${CT_IP_ADDR}:3000
     (plus ADGUARD_USER / ADGUARD_PASSWORD).
NEXT
