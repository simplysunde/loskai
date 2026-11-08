[Docs](../README.md) › [Contributing](../README.md#contributing)

# Authoring a `create-<service>-lxc.sh` script

**Read this when** you are adding a `create-<service>-lxc.sh` script.

A reference for writing new Proxmox LXC provisioning scripts in the style of
[`scripts/create-adguard-lxc.sh`](../../scripts/create-adguard-lxc.sh) and
[`scripts/create-caddy-lxc.sh`](../../scripts/create-caddy-lxc.sh). Use it when a service
should run **natively in its own LXC** rather than as a Docker container (LAN DNS, a TLS
proxy, a VPN endpoint — anything you want isolated from the Docker host or surviving a
Docker rebuild).

These scripts are self-contained: they run from the **Proxmox shell** (piped straight from
the repo via `curl … | bash`) and provision one container end-to-end. They cannot be tested
off a Proxmox host — so the rules below exist to keep them safe to run blind.

---

## The safety invariants (do not break these)

The whole design keeps a failed run from ever harming the Proxmox host. Every new script
must preserve all of them:

1. **Read-and-validate first, create last.** All the `pvesh`/`pvesm`/`pveam list`/`ip`/`pct
   status` calls are read-only. The preflight checks abort *before* anything is created. The
   host writes come after them: the `/etc/subuid`+`/etc/subgid` guard (invariant 4), then —
   only if the template is missing — `pveam update` and `pveam download`, then `pct create`.
2. **Everything app-specific runs inside `pct exec "$CTID" -- …`** — i.e. inside the
   container. `apt`, `curl`, `systemctl`, installers: all in the CT, never on the host.
3. **No host-level `apt`/upgrade, `systemctl`, `reboot`/`shutdown`, or networking changes.**
   (The community-scripts `build.func` does host `apt upgrade` + reboot prompts — deliberately
   not adopted.)
4. **No `pct destroy`/`stop`/`set` on existing guests, no `qm`, no disk formatting, no `rm`
   on host paths.** The only host-config write is the idempotent `/etc/subuid`+`/etc/subgid`
   guard, and it only acts when root has *no* mapping at all.
5. **`set -euo pipefail`** at the top, so any unhandled failure aborts rather than limping on.
6. **Unprivileged container** (`--unprivileged 1`) with `nesting=1`; the container is the
   security boundary.

A failed run leaves at worst a half-created container, removable with `pct destroy <CTID>`.

---

## Anatomy

Both scripts follow the same section order. Copy it verbatim; only the marked parts change
per service.

| Section | Purpose | Per-service? |
|---|---|---|
| Header comment | What/why, run instructions, env overrides | ✎ edit |
| `set -euo pipefail` | Fail-fast | fixed |
| Autodetection helpers | `detect_bridge` / `detect_storage` / `detect_template` | fixed |
| Configuration | `CTID`, `CT_*`, `TEMPLATE*`, + service vars | ✎ extend |
| `log()` + `container_ip()` | Teal logger; DHCP IP waiter | fixed |
| Hardening helpers | `require_*`, `ensure_subid_maps`, `download_template`, `create_container`, `wait_for_ready` | fixed |
| Preflight | exists-check → `require_bridge` → `require_storage_content` → `ensure_subid_maps` | fixed |
| Template ensure | `pveam update` + download if missing (with retry) | fixed |
| Create + start | `create_container` → `pct start` → `wait_for_ready` | fixed |
| Console autologin | root autologin on `getty@tty1` and `container-getty@1`, so `pct console` opens a shell | fixed |
| **Install** | `pct exec` block that installs + configures the service | ✎ **write this** |
| Post-config | systemd unit, config files, unattended-upgrades | ✎ edit |
| `container_ip` + "Next steps" | Report the DHCP IP and manual follow-ups | ✎ edit |

---

## The shared library (copy verbatim)

Everything from `set -euo pipefail` through `wait_for_ready` is **identical** across scripts —
paste it in unchanged. Cores are parameterised as `CT_CORES` so `create_container` stays
common.

```bash
set -euo pipefail

# --- Proxmox autodetection ---
detect_bridge() {
	local dev
	dev="$(ip -o route show default 2>/dev/null | awk '{print $5; exit}')"
	case "$dev" in vmbr*) echo "$dev" ;; *) echo vmbr0 ;; esac
}
detect_storage() { # $1=content (rootdir|vztmpl)  $2=fallback
	local s
	s="$(pvesm status --content "$1" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
	echo "${s:-$2}"
}
detect_template() { # $1=template storage
	local t
	t="$(pveam list "$1" 2>/dev/null | awk '{print $1}' | sed 's|.*/||' | grep '^debian-12-standard' | sort -V | tail -1)"
	[ -z "$t" ] && t="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep '^debian-12-standard' | sort -V | tail -1)"
	echo "${t:-debian-12-standard_12.7-1_amd64.tar.zst}"
}

# --- Configuration (override via environment) ---   ✎ set CT_HOSTNAME + CT_CORES per service
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
CT_HOSTNAME="${CT_HOSTNAME:-myservice}"
CT_BRIDGE="${CT_BRIDGE:-$(detect_bridge)}"
CT_CORES="${CT_CORES:-1}"
CT_MEMORY="${CT_MEMORY:-512}"
CT_DISK="${CT_DISK:-4}"
CT_STORAGE="${CT_STORAGE:-$(detect_storage rootdir local-lvm)}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(detect_storage vztmpl local)}"
TEMPLATE="${TEMPLATE:-$(detect_template "$TEMPLATE_STORAGE")}"
# ✎ add service-specific vars here (ports, REPO_RAW_BASE, tokens, …)

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

container_ip() {
	local ip=""
	for _ in $(seq 1 15); do
		ip="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')" || true
		[ -n "$ip" ] && { echo "$ip"; return 0; }
		sleep 2
	done
	echo ""
}

# --- Preflight / creation hardening ---
require_bridge() {
	ip link show dev "$CT_BRIDGE" &>/dev/null || {
		echo "Bridge '$CT_BRIDGE' not found. Set CT_BRIDGE= to an existing bridge (see 'ip link')." >&2
		exit 1
	}
}
require_storage_content() { # $1=storage  $2=content
	pvesm status --content "$2" 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$1" || {
		echo "Storage '$1' does not support '$2' content. Override the matching *_STORAGE=." >&2
		exit 1
	}
}
ensure_subid_maps() {
	grep -q '^root:' /etc/subuid || echo 'root:100000:65536' >>/etc/subuid
	grep -q '^root:' /etc/subgid || echo 'root:100000:65536' >>/etc/subgid
}
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
wait_for_ready() {
	local i
	for i in $(seq 1 30); do
		pct status "$CTID" 2>/dev/null | grep -q 'status: running' && break
		sleep 1
	done
	[ -n "$(container_ip)" ] || echo "Warning: container has no IP yet; continuing." >&2
}

# --- Preflight, then create ---
if pct status "$CTID" &>/dev/null; then
	echo "Container $CTID already exists — aborting." >&2
	exit 1
fi
log "Using bridge=$CT_BRIDGE, ct-storage=$CT_STORAGE, template=$TEMPLATE_STORAGE:$TEMPLATE"
require_bridge
require_storage_content "$CT_STORAGE" rootdir
require_storage_content "$TEMPLATE_STORAGE" vztmpl
ensure_subid_maps

if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
	log "Downloading template $TEMPLATE"
	pveam update
	download_template "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

log "Creating LXC $CTID ($CT_HOSTNAME) on $CT_BRIDGE (DHCP)"
create_container
pct start "$CTID"
wait_for_ready
```

---

## The part you write: the install block

After `wait_for_ready`, everything runs **inside the container** via `pct exec`. This is the
only genuinely service-specific code. Conventions:

- Wrap the install in a single `pct exec "$CTID" -- bash -euo pipefail -c "…"` so it fails
  loudly. Set `export DEBIAN_FRONTEND=noninteractive` first.
- Install from the service's **official apt repo or installer**, not hand-rolled binaries.
- Add **unattended security upgrades** (`unattended-upgrades`) via
  `/etc/apt/apt.conf.d/20auto-upgrades` so the OS gets patched but the app doesn't auto-bump.
- If the service needs config from the repo, `curl` it from `REPO_RAW_BASE` (see the Caddy
  script) — one source of truth, no inline duplicate.
- Prefer a **custom systemd unit** you control over the packaged one when you need specific
  flags (see Caddy's `--resume` unit).

```bash
log "Installing MyService inside the container"
pct exec "$CTID" -- bash -euo pipefail -c "
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y curl ca-certificates unattended-upgrades
	# ... official install steps for the service ...
"

log "Enabling unattended-upgrades"
pct exec "$CTID" -- bash -c "cat > /etc/apt/apt.conf.d/20auto-upgrades" <<'AUTOUPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AUTOUPGRADES
```

### The "Next steps" footer

End with the DHCP IP and the **manual** follow-ups (first-run setup, firewalling the API to
the Docker host, pinning a static IP, and the `LOSKAI_*`/service env var to set):

```bash
CT_IP_ADDR="$(container_ip)"
: "${CT_IP_ADDR:=<container-ip>}"

log "Done."
cat <<NEXT

MyService is up on DHCP IP: ${CT_IP_ADDR}  (assign it a static lease/IP next).

Next steps (MyService):
  1. ...finish first-time setup...
  2. Firewall its API: allow :<port> only from the Docker host (where Loskai runs).
  3. On the Docker host, set Loskai's MYSERVICE_URL=http://${CT_IP_ADDR}:<port>.
NEXT
```

---

## Authoring checklist

- [ ] Copied the shared library verbatim (`set -euo pipefail` … `wait_for_ready`).
- [ ] Set `CT_HOSTNAME`, `CT_CORES`, and any `CT_MEMORY`/`CT_DISK` the service needs.
- [ ] Added service vars (ports, tokens, `REPO_RAW_BASE`) with `${VAR:-default}` overrides.
- [ ] All install/config runs inside `pct exec` — nothing app-specific on the host.
- [ ] No host `apt`/`systemctl`/`reboot`/networking; no `pct destroy`/`qm`.
- [ ] Unattended-upgrades enabled.
- [ ] "Next steps" footer reports the IP + firewall + the Loskai env var.
- [ ] Header comment documents purpose, run command, and env overrides.
- [ ] `bash -n scripts/create-<service>-lxc.sh` passes.
- [ ] Added to [`docs/guides/install.md`](../guides/install.md) if it's part of the standard setup.

---

## Testing

You can't run these off a Proxmox host, so verify what you can locally and rely on structure
for the rest:

- **`bash -n`** for syntax.
- **Unit-test the awk/sed/grep pipelines** against sample `pvesm status` / `pveam list` /
  `ip route` output (see how earlier commits validated `detect_*` and the collision grep).
- **Pre-flight the fetch chain** if the script pulls files: `curl` the raw URLs from the
  forge to confirm they resolve anonymously.
- On the host, the first `==> Using bridge=…` line prints the autodetected picks **before**
  anything is created — eyeball it, Ctrl-C if wrong. A failed run is removable with
  `pct destroy <CTID>`.

For the provisioning side (Proxmox templates, `pct`, storage semantics), see the two existing
scripts as the canonical examples.
