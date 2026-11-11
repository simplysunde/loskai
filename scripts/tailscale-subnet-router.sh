#!/usr/bin/env bash
#
# tailscale-subnet-router.sh — share this machine's network with your tailnet, so your
# devices reach the homelab (Loskai's names, Caddy's routes) from anywhere Tailscale runs.
# Run it ON the box that should do it — a VM, an LXC, a Raspberry Pi — as root:
#
#   curl -fsSL $BASE/scripts/tailscale-subnet-router.sh | bash
#
# It installs Tailscale (with Tailscale's own install script), finds the network on the
# default route, and shares it. Safe to run again: a box already logged in only has what it
# shares and its name changed. Without an auth key, Tailscale prints a login link to open.
# Override on the `bash` side of the pipe:
#
#   TS_ROUTES=192.168.10.0/24   the network to share (default: the default route's)
#   TS_HOSTNAME=home-lan       its name on the tailnet (default: this machine's hostname)
#   TS_AUTHKEY=tskey-…         log in with a key instead of the link
#
# Docker hosts can run the same as a container instead: the `tailscale` recipe. Both, and
# the two settings in Tailscale's admin console: docs/guides/tailscale.md.

set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run it as root (… | sudo bash)"
command -v systemctl >/dev/null || die "needs systemd — Debian, Ubuntu, Raspberry Pi OS and the like"
command -v curl >/dev/null || die "needs curl (apt install curl)"

# The network to share: the one on the default route's interface, as the kernel names it
# (192.168.10.0/24 for an address in 192.168.10.x/24).
dev="$(ip -o route show default 2>/dev/null | awk '{print $5; exit}')"
lan=""
[ -n "$dev" ] && lan="$(ip -o -4 route show dev "$dev" proto kernel scope link | awk '{print $1; exit}')"
ROUTES="${TS_ROUTES:-$lan}"
[ -n "$ROUTES" ] || die "couldn't find this machine's network — give it: TS_ROUTES=192.168.10.0/24"
NAME="${TS_HOSTNAME:-$(hostname)}"

if ! command -v tailscale >/dev/null; then
	say "Installing Tailscale"
	curl -fsSL https://tailscale.com/install.sh | sh
fi

# Forwarding needs a TUN device. A Proxmox LXC has none unless the host gives it one; without
# it, tailscaled runs in userspace networking — it still forwards to the network, more
# slowly. A box given one later gets kernel mode back on the next run.
defaults=/etc/default/tailscaled
touch "$defaults"
grep -q '^FLAGS=' "$defaults" || echo 'FLAGS=""' >>"$defaults"
if [ -c /dev/net/tun ]; then
	if grep -q 'userspace-networking' "$defaults"; then
		sed -i 's/ *--tun=userspace-networking//' "$defaults"
		systemctl restart tailscaled
	fi
	say "Turning on IP forwarding"
	printf 'net.ipv4.ip_forward = 1\nnet.ipv6.conf.all.forwarding = 1\n' >/etc/sysctl.d/99-tailscale.conf
	sysctl -p /etc/sysctl.d/99-tailscale.conf >/dev/null ||
		echo "  couldn't set it here — Tailscale will warn if forwarding is off"
else
	say "No /dev/net/tun — using userspace networking"
	echo "  On Proxmox, for kernel mode: pct set <CTID> -dev0 /dev/net/tun, restart the LXC, run this again."
	if ! grep -q 'userspace-networking' "$defaults"; then
		sed -i 's/^FLAGS="\(.*\)"/FLAGS="\1 --tun=userspace-networking"/' "$defaults"
		systemctl restart tailscaled
	fi
fi
systemctl enable --now tailscaled >/dev/null 2>&1 || true

# A restarted tailscaled takes a moment to answer; until it does, a box that is logged in
# would look like one that isn't.
for _ in $(seq 1 20); do
	tailscale status --json >/dev/null 2>&1 && break
	sleep 0.5
done
if tailscale status --json 2>/dev/null | grep -q '"BackendState": "Running"'; then
	say "Already logged in — sharing $ROUTES as $NAME"
	tailscale set --advertise-routes="$ROUTES" --hostname="$NAME"
else
	say "Logging in — sharing $ROUTES as $NAME"
	tailscale up --advertise-routes="$ROUTES" --hostname="$NAME" ${TS_AUTHKEY:+--auth-key="$TS_AUTHKEY"}
fi

say "Done. Two settings in Tailscale's admin console (login.tailscale.com/admin):"
echo "  1. Machines › $NAME's ⋯ menu › Edit route settings — approve $ROUTES."
echo "  2. DNS › Add nameserver — your AdGuard's address, restricted to your base domain"
echo "     (Split DNS), so your devices ask AdGuard for Loskai's names."
