"""Pure SSH logic: editing an OpenSSH config file in place, and the `authorized_keys` line.

The config is the record of how each machine is reached (architecture.md → Machines), so
it is edited the way a person would edit it: one entry's lines change, and every other
line — comments, blank lines, entries naming no machine, the spelling of a keyword — is
left exactly as it was. Nothing here touches a file; `client.py` reads and writes it.
"""

import base64
import hashlib
import re
import struct

# `Keyword value` or `Keyword=value`, as ssh_config(5) allows. Keywords are case-insensitive.
_LINE = re.compile(r"^(\s*)([A-Za-z][A-Za-z0-9]*)(\s*=\s*|\s+)(.*?)\s*$")
_BLOCK_START = {"host", "match"}
_WILDCARD = re.compile(r"[*?!]")

DEFAULT_PORT = 22
DEFAULT_INDENT = "    "


def _keyword(line: str) -> str | None:
    if line.lstrip().startswith("#"):
        return None
    m = _LINE.match(line)
    return m.group(2).lower() if m else None


def _patterns(line: str) -> list[str]:
    m = _LINE.match(line)
    return m.group(4).split() if m else []


def _blocks(lines: list[str]) -> list[tuple[int, int]]:
    """(start, end) of every `Host`/`Match` block. `end` is one past its last option line, so
    blank lines and comments after it belong to whatever follows — usually a comment that
    introduces the next entry."""
    starts = [i for i, line in enumerate(lines) if _keyword(line) in _BLOCK_START]
    out = []
    for n, start in enumerate(starts):
        stop = starts[n + 1] if n + 1 < len(starts) else len(lines)
        end = start + 1
        for i in range(start + 1, stop):
            if _keyword(lines[i]) is not None:
                end = i + 1
        out.append((start, end))
    return out


def _find(lines: list[str], alias: str) -> tuple[int, int] | None:
    for start, end in _blocks(lines):
        if _keyword(lines[start]) == "host" and alias in _patterns(lines[start]):
            return start, end
    return None


def _split(text: str) -> list[str]:
    return text.splitlines()


def _join(lines: list[str]) -> str:
    return "\n".join(lines) + "\n" if lines else ""


def hosts(text: str) -> dict[str, dict[str, str | int]]:
    """Each plain `Host` alias (no wildcards) → its `hostname`, `user` and `port`. A key the
    entry doesn't set is absent, except `port`, which is ssh's default when unset."""
    lines = _split(text)
    out: dict[str, dict[str, str | int]] = {}
    for start, end in _blocks(lines):
        if _keyword(lines[start]) != "host":
            continue
        options: dict[str, str | int] = {"port": DEFAULT_PORT}
        for line in lines[start + 1 : end]:
            key = _keyword(line)
            if key in ("hostname", "user", "port"):
                value = _LINE.match(line).group(4)  # type: ignore[union-attr]
                options[key] = int(value) if key == "port" and value.isdigit() else value
        for alias in _patterns(lines[start]):
            if not _WILDCARD.search(alias) and alias not in out:  # ssh: the first entry wins
                out[alias] = dict(options)
    return out


def set_host(text: str, alias: str, options: dict[str, str | None]) -> str:
    """Set options (`{"HostName": …, "User": …, "Port": …}`) on `alias`'s entry, adding the
    entry if there is none. A value of None removes that option. Lines are changed where they
    are: an existing option keeps its place, its indentation and its keyword's spelling."""
    lines = _split(text)
    found = _find(lines, alias)
    if found is None:
        wanted = [(k, v) for k, v in options.items() if v is not None]
        if not wanted:
            return text
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(f"Host {alias}")
        lines.extend(f"{DEFAULT_INDENT}{k} {v}" for k, v in wanted)
        return _join(lines)

    start, end = found
    body = lines[start + 1 : end]
    indent = next(
        (_LINE.match(line).group(1) for line in body if _keyword(line)),  # type: ignore[union-attr]
        DEFAULT_INDENT,
    )
    for key, value in options.items():
        at = next((i for i, line in enumerate(body) if _keyword(line) == key.lower()), None)
        if at is None:
            if value is not None:
                body.append(f"{indent}{key} {value}")
        elif value is None:
            del body[at]
        else:
            m = _LINE.match(body[at])
            body[at] = f"{m.group(1)}{m.group(2)}{m.group(3)}{value}"  # type: ignore[union-attr]
    return _join(lines[: start + 1] + body + lines[end:])


def rename_host(text: str, old: str, new: str) -> str:
    """Rename one alias on its `Host` line; the entry and its other aliases stay."""
    lines = _split(text)
    found = _find(lines, old)
    if found is None:
        return text
    start = found[0]
    m = _LINE.match(lines[start])
    patterns = " ".join(new if p == old else p for p in m.group(4).split())  # type: ignore[union-attr]
    lines[start] = f"{m.group(1)}{m.group(2)}{m.group(3)}{patterns}"  # type: ignore[union-attr]
    return _join(lines)


def remove_host(text: str, alias: str) -> str:
    """Remove `alias`'s entry. One that also names other aliases only loses this one."""
    lines = _split(text)
    found = _find(lines, alias)
    if found is None:
        return text
    start, end = found
    others = [p for p in _patterns(lines[start]) if p != alias]
    if others:
        m = _LINE.match(lines[start])
        lines[start] = f"{m.group(1)}{m.group(2)}{m.group(3)}{' '.join(others)}"  # type: ignore[union-attr]
        return _join(lines)
    del lines[start:end]
    # Don't leave two blank lines where the entry was, or one at the very top.
    if start < len(lines) and not lines[start].strip() and (start == 0 or not lines[start - 1].strip()):
        del lines[start]
    while lines and not lines[-1].strip():
        lines.pop()
    return _join(lines)


def machine_options(address: str, user: str, port: int) -> dict[str, str | None]:
    """What Loskai writes for a machine. Port 22 is ssh's default, so it is left out — and
    removed if set — rather than spelled out."""
    return {"HostName": address, "User": user, "Port": None if port == DEFAULT_PORT else str(port)}


def authorized_keys_line(public_key: str, from_ip: str | None) -> str:
    """The line a machine's `authorized_keys` gets. `from=` makes the key work only from the
    Docker host: a copy of it is useless anywhere else, and the machine enforces that, not
    Loskai. `from_ip` is an OpenSSH pattern list — one address, or several and subnets,
    comma-separated (the Docker host itself also needs Loskai's own networks)."""
    return f'from="{from_ip}" {public_key}' if from_ip else public_key


def fingerprint_of(public_key: str) -> str:
    """`SHA256:…` of a public key line, as `ssh-keygen -lf` prints it, so the key Loskai
    shows can be found in a machine's `authorized_keys`."""
    blob = base64.b64decode(public_key.split()[1])
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def public_key_of(private_key: str, comment: str) -> str:
    """The public key of an OpenSSH private key file — encrypted or not, because the format
    keeps the public half in the clear ahead of the encrypted part. So Loskai keeps one file,
    and the public key it shows can never belong to a different private key."""
    body = "".join(line for line in private_key.splitlines() if not line.startswith("-----"))
    data = base64.b64decode(body)
    magic = b"openssh-key-v1\0"
    if not data.startswith(magic):
        raise ValueError("not an OpenSSH private key")
    pos = len(magic)

    def string() -> bytes:
        nonlocal pos
        (n,) = struct.unpack(">I", data[pos : pos + 4])
        pos += 4 + n
        return data[pos - n : pos]

    string(), string(), string()  # cipher, KDF, KDF options
    pos += 4  # number of keys: always 1
    blob = string()
    (type_len,) = struct.unpack(">I", blob[:4])
    key_type = blob[4 : 4 + type_len].decode()
    return f"{key_type} {base64.b64encode(blob).decode()} {comment}"


# --- The status-only key ---
#
# A second key, kept unencrypted so each machine's running list works without the admin
# password. The machine limits it, not Loskai: `restrict` (no shell, pty, forwarding),
# `from=` the Docker host, and this forced command, which only lists what runs. Each list
# falls back to `sudo -n` (never prompts), and `!denied` marks one the user may not read.
# No double quotes or backslashes: it sits inside `command="…"`.
STATUS_VERSION = "#loskai-status 1"
STATUS_COMMAND = (
    f"echo '{STATUS_VERSION}'; "
    "if command -v docker >/dev/null; then echo '#docker'; "
    "docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null || "
    "sudo -n docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null || "
    "echo '!denied'; fi; "
    "echo '#systemd'; "
    "systemctl list-units --type=service --state=running --no-legend --plain --no-pager 2>/dev/null; "
    "if command -v pct >/dev/null; then echo '#pct'; "
    "pct list 2>/dev/null || sudo -n pct list 2>/dev/null || echo '!denied'; "
    "echo '#qm'; qm list 2>/dev/null || sudo -n qm list 2>/dev/null || echo '!denied'; fi"
)
STATUS_COMMENT = "loskai-status"


def status_line(public_key: str, from_ip: str | None) -> str:
    """The status key's `authorized_keys` line: limited to `STATUS_COMMAND` by the machine."""
    options = ["restrict"]
    if from_ip:
        options.append(f'from="{from_ip}"')
    options.append(f'command="{STATUS_COMMAND}"')
    return f"{','.join(options)} {public_key}"


# Adds Loskai's lines to `authorized_keys`, replacing any it added before (they end in its
# key comments), so a reinstall after "New key" or a new Docker host IP leaves no stale
# line. The lines arrive on stdin; the file is rebuilt beside itself and renamed over it,
# so a failure halfway leaves the old file whole.
INSTALL_SCRIPT = (
    "set -e; umask 077; mkdir -p ~/.ssh; f=~/.ssh/authorized_keys; touch \"$f\"; "
    "t=\"$f.loskai-new\"; "
    "{ grep -v -e ' loskai$' -e ' loskai-status$' \"$f\" || [ $? -eq 1 ]; cat; } > \"$t\"; "
    "mv \"$t\" \"$f\""
)


# --- known_hosts, keyed by machine id ---
#
# OpenSSH's format with the machine's *id* where a host name would go: the id never changes,
# so a rename or a move keeps the trusted key, and a changed key is still refused.


def known_key(text: str, machine_id: str) -> str | None:
    """The trusted host key (`<type> <base64>`) for a machine, or None."""
    for line in _split(text):
        parts = line.split()
        if len(parts) >= 3 and parts[0] == machine_id:
            return f"{parts[1]} {parts[2]}"
    return None


def set_known(text: str, machine_id: str, key: str) -> str:
    return _join([*_drop_known(text, machine_id), f"{machine_id} {key}"])


def forget_known(text: str, machine_id: str) -> str:
    return _join(_drop_known(text, machine_id))


def _drop_known(text: str, machine_id: str) -> list[str]:
    return [line for line in _split(text) if line.split()[:1] != [machine_id]]


# --- What runs on a machine ---

# Services every install runs and nobody asks about — counted as hidden, not listed. Exact
# names, then prefixes (`getty@tty1`, `systemd-journald`, Proxmox's `pve*`).
BASE_SERVICES = {
    "accounts-daemon", "apparmor", "atd", "chrony", "chronyd", "containerd", "cron", "crond",
    "dbus", "dbus-broker", "irqbalance", "iscsid", "ksmtuned", "lvm2-lvmetad", "lxcfs",
    "multipathd", "networkd-dispatcher", "ntp", "ntpsec", "polkit", "postfix", "qemu-guest-agent",
    "rpcbind", "rrdcached", "rsyslog", "smartmontools", "smartd", "snapd", "ssh", "sshd",
    "spiceproxy", "corosync", "udisks2", "unattended-upgrades", "upower", "watchdog-mux",
    "zfs-zed", "open-iscsi", "ModemManager", "NetworkManager", "wpa_supplicant", "avahi-daemon",
}
BASE_PREFIXES = ("systemd-", "getty@", "serial-getty@", "user@", "pve", "lxc", "zfs-")


def _base_service(name: str) -> bool:
    return name in BASE_SERVICES or name.startswith(BASE_PREFIXES)


def parse_running(output: str) -> dict:
    """The forced command's output → `{containers, services, hidden, guests, denied}`.

    `containers` are `{name, image, status}`; `services` the running systemd units that
    aren't the base system's (`hidden` counts those); `guests` the running Proxmox LXCs and
    VMs, `{id, name, kind}`; `denied` the lists the user may not read (`docker`, `pct`, `qm`).
    Raises ValueError for output that isn't the status command's — a key line from another
    version, or a shell where the forced command should be."""
    lines = output.splitlines()
    if not lines or lines[0].strip() != STATUS_VERSION:
        raise ValueError("not Loskai's status output")
    out: dict = {"containers": [], "services": [], "hidden": 0, "guests": [], "denied": []}
    section = None
    for raw in lines[1:]:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            section = line[1:]
            continue
        if line == "!denied":
            out["denied"].append(section)
            continue
        if section == "docker":
            name, _, rest = line.partition("|")
            image, _, status = rest.partition("|")
            out["containers"].append({"name": name, "image": image, "status": status})
        elif section == "systemd":
            unit = line.split()[0]
            if not unit.endswith(".service"):
                continue
            name = unit.removesuffix(".service")
            if _base_service(name):
                out["hidden"] += 1
            else:
                out["services"].append(name)
        elif section in ("pct", "qm"):
            guest = _guest(line, section)
            if guest:
                out["guests"].append(guest)
    out["containers"].sort(key=lambda c: c["name"])
    out["services"].sort()
    out["guests"].sort(key=lambda g: int(g["id"]))
    return out


def _guest(line: str, section: str) -> dict | None:
    """A running guest from `pct list` (`VMID Status [Lock] Name`) or `qm list` (`VMID NAME
    STATUS …`); headers and stopped guests give None."""
    parts = line.split()
    if not parts or not parts[0].isdigit():
        return None
    if section == "pct":
        if len(parts) < 3 or parts[1] != "running":
            return None
        return {"id": parts[0], "name": parts[-1], "kind": "lxc"}
    if len(parts) < 3 or parts[2] != "running":
        return None
    return {"id": parts[0], "name": parts[1], "kind": "vm"}
