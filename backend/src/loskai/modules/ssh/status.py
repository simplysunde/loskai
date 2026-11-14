"""The status key's contract: its versions, the command each machine forces on it, and the
parsers of what that command answers — docs/reference/ssh-status.md. The command and the
parsers stay in one file because each section one writes, the other reads.

Pure, like `logic.py`: nothing here reaches a machine; `connect.py` asks and hands the
output over.
"""

import ipaddress
import re

from .logic import SUDO_RULE

# --- The status-only key ---
#
# A second key, used without anyone unlocking it, so each machine's running list works
# without a password. The machine limits it, not Loskai: `restrict` (no shell, pty, forwarding),
# `from=` the Docker host, and this forced command, which only reads. Whatever command the
# client asks for, this runs instead; the request only picks one of two fixed answers
# (`$SSH_ORIGINAL_COMMAND`, compared in a `case`, never run): `facts` — the machine's
# overview — or anything else, what runs there. Each list falls back to `sudo -n` (never
# prompts) where sudo allows it, and `!denied` marks one the user may not read. No double
# quotes or backslashes: it sits inside `command="…"`. docs/reference/ssh-status.md is the
# contract.
#
# The version line changes when what is installed must change. A machine with an older
# line still answers `running`, without what came later (ports v6, guest addresses v7);
# `facts` before v5 asks for a reinstall. v8 asks sudo without being logged, and lists a
# Proxmox host's guests once.
STATUS_LINE = 13
STATUS_VERSION = f"#loskai-status {STATUS_LINE}"
# The first line whose `facts` this Loskai reads (v6 to v8 and v10 changed nothing it
# reads), and the first with a `#listen` section where the machine has `ss`.
FACTS_SINCE = 5
# From v11, a project's row says which key git uses for it (`key`), and `#=keys` lists the
# user's SSH keys.
KEYS_SINCE = 11
# From v12, each project's remotes (and its submodules'), and which keys ssh offers for each
# SSH host they name — so a key's use through ~/.ssh/config is seen too.
REMOTES_SINCE = 12
# From v13, a key's row carries its public half too — to copy it, ready to paste.
PUBLIC_SINCE = 13
LISTEN_SINCE = 6


def line_version(head: str) -> int | None:
    """The version a status line's answer starts with (`#loskai-status 7` → 7) — None for
    output that isn't one this Loskai knows: another program's, or a newer line."""
    m = re.fullmatch(r"#loskai-status ([1-9][0-9]*)", head)
    return int(m.group(1)) if m and int(m.group(1)) <= STATUS_LINE else None

_DOCKER_PS = "docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'"
# Whether sudo may be used, asked so that sudo logs nothing: `sudo -n true` — any command
# sudo refuses — is logged as an incident, and may mail root, on every poll. `sudo -n -l`
# lists the user's rules without logging, but answers as soon as *one* rule needs no
# password (sudo's `listpw=any`), so whether a command is allowed (`sudo -n -l <command>`)
# says nothing of whether it needs a password: with Loskai's own rule for updates beside
# a password-protected `ALL`, every check said yes and every use was refused, and logged.
# So `S=1` only when the last rule for every command (`ALL`), as root, needs no password —
# sudo goes by the last rule that matches. A narrower rule leaves `S=0`: the lists are read
# as the user, and say what they couldn't read.
_SUDO = (
    "S=0; if [ $(id -u) != 0 ] && sudo -n -l 2>/dev/null "
    "| grep -E '^[[:space:]]+[(](ALL|root)([[:space:]]*:[^)]*)?[)][[:space:]]+([A-Z_]+:[[:space:]]*)*ALL$' | tail -n 1 "
    "| grep -q NOPASSWD; then S=1; fi; "
)


def _with_sudo(command: str) -> str:
    """`command` through `sudo -n`, only where sudo allows it — never a logged refusal."""
    return f"{{ [ $S = 1 ] && sudo -n -l {command} >/dev/null 2>&1 && sudo -n {command}; }}"


# A whole script as root, through sudo: allowed when `sh` is.
_SUDO_SH = "[ $S = 1 ] && sudo -n -l sh >/dev/null 2>&1"
# Each TCP listener (`ss -Htlnp`), and after it the systemd unit of each process behind it,
# `@<pid> <unit>` from its cgroup. Only root sees every process's sockets, so a user without
# `sudo -n` gets `!partial` first and only its own processes' pids. One script, run as root,
# through sudo, or as the user — no quotes inside, so `sh -c '…'` carries it; `set -f`, so a
# listener's `*:80` doesn't glob.
_LISTEN_LOOP = (
    "set -f; ss -Htlnp 2>/dev/null | while read -r l; do echo $l; "
    "for p in $(echo $l | grep -o pid=[0-9]* | cut -d= -f2); do "
    "echo @$p $(grep -o [^/]*[.]service /proc/$p/cgroup 2>/dev/null | tail -n1); done; done"
)
_LISTEN = (
    "if command -v ss >/dev/null; then echo '#listen'; "
    f"if [ $(id -u) = 0 ]; then sh -c '{_LISTEN_LOOP}'; "
    f"elif {_SUDO_SH}; then sudo -n sh -c '{_LISTEN_LOOP}'; "
    f"else echo '!partial'; sh -c '{_LISTEN_LOOP}'; fi; fi; "
)
# A Proxmox host's guests, as root: `pct list` and `qm list`, each run once — `qm list` is
# slow — then each running guest's addresses from those same lists, `<id> <address>…`: an
# LXC's from `lxc-info`, a VM's from its QEMU guest agent, capped at 3 s each and asked side
# by side, since an agent that is configured but not answering makes `qm` wait. The section
# markers and `!denied` arrive as `$1`–`$4`: no quotes inside, so `sh -c '…'` carries it.
# Each list is kept whole in a variable and printed line by line with IFS set to a newline
# (made without a backslash); `set -f`, so nothing in a line or the pattern globs.
_PVE_LOOP = (
    "set -f; O=$IFS; N=$(echo; echo x); N=${N%x}; IFS=$N; "
    "P=$(pct list 2>/dev/null) || P=$4; Q=$(qm list 2>/dev/null) || Q=$4; "
    "echo $1; for l in $P; do echo $l; done; "
    "echo $2; for l in $Q; do echo $l; done; "
    "echo $3; "
    "for l in $P; do echo $l; done | { IFS=$O; grep -w running | while read -r i rest; do "
    "echo $i $(lxc-info -n $i -iH </dev/null 2>/dev/null); done; }; "
    "for l in $Q; do echo $l; done | { IFS=$O; grep -w running | { while read -r i rest; do "
    "(echo $i $(timeout 3 qm guest cmd $i network-get-interfaces </dev/null 2>/dev/null "
    "| grep -oE [0-9]+[.][0-9]+[.][0-9]+[.][0-9]+)) & done; wait; }; }"
)
_PVE_ARGS = "sh '#pct' '#qm' '#addr' '!denied'"
# Without root or sudo for `sh`, the lists as the user (or a narrow rule for them), and no
# addresses — those need root.
_PVE = (
    "if command -v pct >/dev/null; then "
    f"if [ $(id -u) = 0 ]; then sh -c '{_PVE_LOOP}' {_PVE_ARGS}; "
    f"elif {_SUDO_SH}; then sudo -n sh -c '{_PVE_LOOP}' {_PVE_ARGS}; "
    "else echo '#pct'; pct list 2>/dev/null || "
    f"{_with_sudo('pct list')} 2>/dev/null || echo '!denied'; "
    f"echo '#qm'; qm list 2>/dev/null || {_with_sudo('qm list')} 2>/dev/null || echo '!denied'; "
    "fi; fi"
)
_RUNNING = (
    _SUDO
    + "if command -v docker >/dev/null; then echo '#docker'; "
    f"{_DOCKER_PS} 2>/dev/null || {_with_sudo(_DOCKER_PS)} 2>/dev/null || "
    "echo '!denied'; fi; "
    "echo '#systemd'; "
    "systemctl list-units --type=service --state=running --no-legend --plain --no-pager 2>/dev/null; "
    + _LISTEN
    + _PVE
)
# What every command Loskai runs on a machine starts with — the overview, an action, a
# tool's settings — so each finds the same programs: a forced command or `sh -c` gets
# sshd's PATH, not the login shell's, and per-user installs (Claude Code) go in
# `~/.local/bin`.
USER_PATH = "PATH=$PATH:$HOME/.local/bin; "
# The programs the overview reports — what a tool requires (tool.py).
PROGRAMS = ("tmux", "claude", "docker", "pct", "qm", "git", "sudo", "tailscale", "curl")
_FACTS = (
    USER_PATH +
    "echo '#=os'; cat /etc/os-release 2>/dev/null; "
    "echo '#=kernel'; uname -sr; "
    "echo '#=uptime'; cut -d' ' -f1 /proc/uptime; "
    "echo '#=memory'; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; "
    "echo '#=disks'; df -P -k 2>/dev/null; "
    # From the machine's own package lists, as they were last refreshed — nothing is fetched.
    "echo '#=updates'; "
    "if command -v apt-get >/dev/null; then "
    "echo apt $(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | grep -c '^Inst '); "
    "elif command -v dnf >/dev/null; then "
    "echo dnf $(dnf -C -q check-update 2>/dev/null | grep -c '^[[:alnum:]]'); "
    "elif command -v apk >/dev/null; then echo apk $(apk -u list 2>/dev/null | wc -l); "
    "elif command -v pacman >/dev/null; then echo pacman $(pacman -Qu 2>/dev/null | wc -l); fi; "
    f"echo '#=tools'; for c in {' '.join(PROGRAMS)}; do command -v $c >/dev/null 2>&1 && echo $c; done; "
    "echo '#=tmux'; "
    "tmux ls -F '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}' 2>/dev/null; "
    "if command -v tailscale >/dev/null; then echo '#=tailscale'; tailscale ip -4 2>/dev/null | head -n 1; "
    # The tailnet as this machine sees it, itself first — read-only, and no root needed.
    "echo '#=tailnet'; tailscale status 2>/dev/null | head -n 100; "
    # This machine on the tailnet: whether it is connected (its BackendState), the networks
    # it shares (`tailscale get`, which an older Tailscale lacks: none shown), and those the
    # tailnet has approved — its own `PrimaryRoutes`, the only ones with --peers=false.
    # Its status is asked once: one awk prints `state` and `approved` from it.
    "echo '#=tsself'; echo shared $(tailscale get advertise-routes 2>/dev/null | tr , ' '); "
    "tailscale status --json --peers=false 2>/dev/null | awk -v s=state -v r=approved -v e= "
    "'/BackendState/&&!b{b=1;v=$2;gsub(/[^A-Za-z]/,e,v)} /PrimaryRoutes/{on=1} "
    "on{while(match($0,/[0-9a-f.:]+[/][0-9]+/)){a=a OFS substr($0,RSTART,RLENGTH);$0=substr($0,RSTART+RLENGTH)}} "
    "on&&/null|[]]/{on=0} END{print s,v;print r a}'; fi; "
    # Whether Loskai's sudo rule is there: nothing printed where its folder can't be searched.
    f"echo '#=sudo'; if [ -x /etc/sudoers.d ]; then [ -e {SUDO_RULE} ] && echo on || echo off; fi; "
    # The git repos one and two folders into the home folder — a machine's projects folder
    # is `~` or one folder in it. A path with any other character is skipped, so nothing
    # below needs quoting. Each row is printed by `git log` itself (or `echo`, for a repo with
    # no commit yet): the subject comes last, never through the shell.
    "echo '#=projects'; for g in $HOME/*/.git $HOME/*/*/.git; do "
    "d=${g%/.git}; p=${d#$HOME/}; case $p in *[!A-Za-z0-9._/-]*) continue;; esac; [ -d $g ] || continue; "
    "b=$(git -C $d symbolic-ref --short -q HEAD 2>/dev/null); case $b in ''|*[!A-Za-z0-9._/-]*) b=-;; esac; "
    "w=0; git -C $d status --porcelain 2>/dev/null | grep -q . && w=1; "
    # The newest conversation Claude Code keeps for this folder, by its own naming.
    "k=$(ls -t $HOME/.claude/projects/$(echo $d | sed 's,[^A-Za-z0-9],-,g')/*.jsonl 2>/dev/null | head -n 1); "
    "t=$(stat -c %Y $k 2>/dev/null || echo 0); "
    # Commits not on its upstream yet, as of the last fetch; - without an upstream.
    "a=$(git -C $d rev-list --count @{u}..HEAD 2>/dev/null || echo -); "
    # The key git uses for it: its core.sshCommand's -i file, by name (Git's Own key sets
    # it); - for none — the machine's keys — and + for a command naming no file this way.
    # (A case, not a test: unquoted, an empty one would still pass `[ -n ]`.)
    "c=$(git -C $d config --local core.sshCommand 2>/dev/null); s=-; "
    "case $c in ?*) s=$(echo $c | sed -n 's,.* -i *,,p' | cut -d' ' -f1 | tr -dc A-Za-z0-9._/~-); "
    "s=${s##*/}; case $s in ''|*[!A-Za-z0-9._-]*) s=+;; esac;; esac; "
    "git -C $d log -1 --format=$p%x7c$b%x7c$w%x7c$t%x7c$a%x7c$s%x7c%ct%x7c%s 2>/dev/null "
    "|| echo $p'|'$b'|'$w'|'$t'|'$a'|'$s'|0|'; "
    "done | head -n 200; "
    # The user's SSH keys, by their public halves only — name, the public key itself (its
    # type and data: public, to paste into GitHub or Forgejo), then ssh-keygen's line: its
    # size, fingerprint, comment and type. A name with any other character is skipped.
    "echo '#=keys'; if command -v ssh-keygen >/dev/null; then for f in $HOME/.ssh/*.pub; do "
    "[ -f $f ] || continue; n=${f##*/}; n=${n%.pub}; case $n in [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) continue;; esac; "
    "echo $n'|'$(cut -d' ' -f1,2 $f | head -n 1)'|'$(ssh-keygen -lf $f 2>/dev/null | head -n 1); done | head -n 50; fi; "
    # Every remote of each project and of its submodules (their configs are under
    # .git/modules/<name>/): `path|module|url or pushurl|address`, any user:token@ taken out
    # of the address here, before it leaves the machine. Kept for the next section.
    "echo '#=remotes'; r=$(for g in $HOME/*/.git $HOME/*/*/.git; do "
    "d=${g%/.git}; p=${d#$HOME/}; case $p in *[!A-Za-z0-9._/-]*) continue;; esac; [ -d $g ] || continue; "
    "for c in $g/config $g/modules/*/config $g/modules/*/*/config $g/modules/*/*/*/config; do "
    "[ -f $c ] || continue; case $c in *[!A-Za-z0-9._/-]*) continue;; esac; m=${c#$g/}; m=${m#modules/}; m=${m%config}; m=${m%/}; "
    "git config -f $c --get-regexp '^remote[.].*[.](url|pushurl)$' 2>/dev/null | while read k u; do "
    "echo $p'|'$m'|'${k##*.}'|'$u; done; done; done | sed 's,//[^/@]*@,//,' | head -n 300); "
    "for l in $r; do echo $l; done; "
    # For each SSH host those name, the keys ssh offers it — asked of ssh itself (`ssh -G`
    # resolves aliases, Host *, Include and Match as a connection would), without connecting:
    # `host|hostname|identitiesonly|file…`.
    "echo '#=sshhosts'; if command -v ssh >/dev/null; then for l in $r; do u=${l##*|}; "
    "case $u in ssh://*) h=${u#ssh://}; h=${h#*@}; h=${h%%/*}; h=${h%%:*};; *://*) continue;; *@*:*) h=${u%%:*}; h=${h#*@};; *) continue;; esac; "
    "case $h in ''|*[!A-Za-z0-9._-]*) continue;; esac; echo $h; done | sort -u | head -n 30 | while read h; do "
    "ssh -G $h 2>/dev/null </dev/null | awk -v OFS='|' -v h=$h -v N=hostname -v O=identitiesonly -v I=identityfile "
    "'$1==N{n=$2} $1==O{o=$2} $1==I{f=f OFS $2} END{print h,n,o f}'; done; fi; "
    # The key files ~/.ssh/config names: one it names is kept out of Delete.
    "echo '#=sshconfig'; grep -i '^[[:space:]]*identityfile' $HOME/.ssh/config 2>/dev/null | awk '{print $2}' | head -n 50; "
    "true"
)
STATUS_COMMAND = (
    f"echo '{STATUS_VERSION}'; "
    f"case $SSH_ORIGINAL_COMMAND in facts) {_FACTS};; *) {_RUNNING};; esac"
)
STATUS_COMMENT = "loskai-status"


def status_line(public_key: str, from_ip: str | None) -> str:
    """The status key's `authorized_keys` line: limited to `STATUS_COMMAND` by the machine."""
    options = ["restrict"]
    if from_ip:
        options.append(f'from="{from_ip}"')
    options.append(f'command="{STATUS_COMMAND}"')
    return f"{','.join(options)} {public_key}"


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


# Base services whose port is still worth a route: Proxmox's web UI. Listed, not hidden —
# the running list offers a route only on what it lists — and their ports kept.
LISTEN_ALSO = {"pveproxy"}


def parse_running(output: str) -> dict:
    """The forced command's output → `{containers, services, hidden, guests, listening,
    denied}`.

    `containers` are `{name, image, status, ports}`, `ports` the TCP ports published on
    the machine's addresses; `services` the running systemd units that aren't the base
    system's (`hidden` counts those); `guests` the running Proxmox LXCs and VMs, `{id, name,
    kind, addresses}` (`addresses` their IPv4 ones off loopback and link-local; [] where
    unknown: a VM without the guest agent, no root, a line before v7); `listening` the services' TCP ports, `{service, port, host}` (`host` "" for
    every address — see `_listeners`), None from a line older than v6; `denied` the lists
    the user may not read (`docker`, `pct`, `qm`, and `listen` when only root may say which
    service holds a port), and `ss` when the machine has no `ss` to list ports with. Raises ValueError for output that isn't the status command's — a
    key line from another version, or a shell where the forced command should be."""
    lines = output.splitlines()
    head = lines[0].strip() if lines else ""
    version = line_version(head)
    if version is None:
        raise ValueError("not Loskai's status output")
    out: dict = {"containers": [], "services": [], "hidden": 0, "guests": [], "denied": []}
    listen: list[str] = []
    addresses: dict[str, list[str]] = {}
    section = None
    seen = set()
    for raw in lines[1:]:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            section = line[1:]
            seen.add(section)
            continue
        if line == "!denied" or (line == "!partial" and section == "listen"):
            out["denied"].append(section)
            continue
        if section == "docker":
            name, image, status, ports = (line.split("|", 3) + ["", "", ""])[:4]
            out["containers"].append(
                {"name": name, "image": image, "status": status, "ports": _published(ports)}
            )
        elif section == "listen":
            listen.append(line)
        elif section == "addr":
            guest_id, *found = line.split()
            addresses[guest_id] = [a for a in found if _guest_address(a)]
        elif section == "systemd":
            unit = line.split()[0]
            if not unit.endswith(".service"):
                continue
            name = unit.removesuffix(".service")
            if _base_service(name) and name not in LISTEN_ALSO:
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
    for guest in out["guests"]:
        guest["addresses"] = addresses.get(guest["id"], [])
    published = {p for c in out["containers"] for p in c["ports"]}
    out["listening"] = _listeners(listen, published) if version >= LISTEN_SINCE else None
    # v6 prints its `#listen` section only where `ss` exists: without it, an empty list
    # would read as "nothing listens".
    if version >= LISTEN_SINCE and "listen" not in seen:
        out["denied"].append("ss")
    return out


_PUBLISHED = re.compile(r"(?:(\[[^\]]*\]|[0-9.]+|::)?:)?(\d+)(?:-(\d+))?->[\d-]+/tcp")
# A published range wider than this (a media server's RTP ports) is listed by its first
# port only: nobody routes each of a thousand ports.
_RANGE_LISTED = 16


def _loopback(host: str) -> bool:
    """A bound address only this machine reaches, as `docker ps` and `ss` print it:
    `127.0.0.1`, `[::1]`, `[::ffff:127.0.0.1]`, or anything bound to the loopback device
    (`127.0.0.53%lo`, `*%lo`). Parsed, as the rest of Loskai decides loopback, not matched."""
    address, _, device = host.partition("%")
    if device == "lo":
        return True
    try:
        ip = ipaddress.ip_address(address.strip("[]"))
    except ValueError:
        return False  # `*`, or no address: every one
    mapped = ip.ipv4_mapped if isinstance(ip, ipaddress.IPv6Address) else None
    return (mapped or ip).is_loopback


def _published(ports: str) -> list[int]:
    """The host ports in `docker ps`'s Ports (`0.0.0.0:8096->8096/tcp, [::]:8096->…`) — TCP,
    and not on loopback, where nothing else on the network reaches them. A range is each of
    its ports, up to `_RANGE_LISTED`."""
    found: set[int] = set()
    for m in _PUBLISHED.finditer(ports):
        if _loopback(m.group(1) or ""):
            continue
        first = int(m.group(2))
        last = int(m.group(3) or first)
        found.update(range(first, last + 1) if last - first < _RANGE_LISTED else [first])
    return sorted(found)


def _listeners(lines: list[str], published: set[int]) -> list[dict]:
    """`ss -Htlnp` lines, each followed by `@<pid> <unit>` lines, → the ports a service listens
    on, `{service, port, host}`: `host` the one address it listens on, or "" for all of them
    (`0.0.0.0`, `[::]`, `*`, also bound to an interface: `0.0.0.0%eth0`). Left out: loopback, a listener with no unit (a process run by
    hand, or one only root may see), the base system's services but `LISTEN_ALSO`, and a
    port a container publishes — listed with the container (Docker's proxy holds it)."""
    found: dict[tuple[str, int, str], dict] = {}
    current: tuple[int, str] | None = None
    for line in lines:
        if line.startswith("@"):
            parts = line.split()
            unit = parts[1].removesuffix(".service") if len(parts) > 1 else ""
            if current is None or not unit or (_base_service(unit) and unit not in LISTEN_ALSO):
                continue
            port, host = current
            if port not in published:
                found.setdefault((unit, port, host), {"service": unit, "port": port, "host": host})
            continue
        fields = line.split()
        address, _, port = fields[3].rpartition(":") if len(fields) > 3 else ("", "", "")
        current = None
        if port.isdigit() and not _loopback(address):
            # `%eth0` binds to an interface, not an address: `0.0.0.0%eth0` is every address on it.
            host = address.split("%")[0].strip("[]")
            current = (int(port), "" if host in ("0.0.0.0", "::", "*", "") else host)
    return sorted(found.values(), key=lambda s: (s["service"], s["port"], s["host"]))


def _guest_address(text: str) -> bool:
    """An IPv4 address a guest may be named by: not loopback, not link-local."""
    try:
        address = ipaddress.IPv4Address(text)
    except ValueError:
        return False
    return not (address.is_loopback or address.is_link_local or address.is_unspecified)


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


# --- A machine's overview ---


class OldStatusLine(ValueError):
    """The machine answered with an older status line, which has no overview."""


# Filesystems that are not storage anyone asks about: kept out of the disks.
_PSEUDO_FS = ("tmpfs", "devtmpfs", "overlay", "efivarfs", "udev", "none", "shm", "squashfs")


def parse_facts(output: str) -> dict:
    """The forced command's `facts` answer → the machine's overview:
    `{os, os_id, os_like, kernel, uptime, memory, disks, updates, programs, tmux, tailscale,
    tailnet, tailscale_self, projects, ssh_keys, remotes, ssh_hosts, ssh_config_keys, sudo_rule,
    outdated}`.

    `os` is os-release's PRETTY_NAME; `os_id`/`os_like` its ID and ID_LIKE (which package
    manager, for tools); `uptime` seconds; `memory` `{total, available}` in bytes; `disks`
    `{mount, device, size, used}` in bytes, real storage only and one row per device;
    `updates` `{manager, count}` or None; `programs` the `PROGRAMS` present (the `#=tools` section); `tmux`
    `{name, created, attached, windows}`; `tailscale` its Tailscale IPv4 address, or None
    (not installed, or not connected); `tailnet` the devices `tailscale status` lists,
    `{ip, name, os, online, self, status}`, this machine first; `tailscale_self` this
    machine on the tailnet, `{state, shared, approved}` — `state` "on", "off", "login" (logged
    out), "approval" (waiting for the tailnet's admin) or None, and the networks it shares
    and those approved — None without Tailscale or from a line before v9; `projects` the git repos in
    the home folder, `{path, folder, name, branch, dirty, claude, ahead, committed,
    subject}` — `folder` relative to home ("" for home itself), `claude` and `committed`
    seconds since the epoch (0: never), `ahead` commits not on the upstream yet (None
    without one), `key` the SSH key git uses for it — None for the machine's, a key's name
    (its own, Git's Own key), "" for a `core.sshCommand` naming none; `ssh_keys` the user's
    keys in ~/.ssh, by their public halves, `{name, bits, fingerprint, comment, type, public}`
    — `public` its type and data, to paste (None before v13) — None from a line before v11; `remotes` each project's remotes and its submodules', `{path,
    module, kind, url}` — `module` "" for the project itself, `kind` "url" or "pushurl", no
    user or token in the address; `ssh_hosts` the keys ssh offers each SSH host those name,
    `{host: {hostname, identities_only, keys}}` — `keys` the names of those in ~/.ssh;
    `ssh_config_keys` the keys ~/.ssh/config names — the three None from a line before v12;
    `sudo_rule` "on" or "off" — Loskai's sudo rule, `SUDO_RULE` — or None
    where the machine won't say; `outdated` true on a line older than this Loskai's — still
    read, but a fix since (v10's quiet sudo) reaches it only when it is installed again.
    Raises `OldStatusLine` for a machine still on an older line, ValueError for anything else."""
    lines = output.splitlines()
    head = lines[0].strip() if lines else ""
    version = line_version(head)
    if version is None:
        raise ValueError("not Loskai's status output")
    if version < FACTS_SINCE:
        raise OldStatusLine(head)
    sections: dict[str, list[str]] = {}
    current: list[str] | None = None
    for raw in lines[1:]:
        if raw.startswith("#="):
            current = sections.setdefault(raw[2:].strip(), [])
        elif current is not None and raw.strip():
            current.append(raw.strip())

    release = dict(_release_line(line) for line in sections.get("os", []) if "=" in line)
    return {
        "os": release.get("PRETTY_NAME") or release.get("NAME"),
        "os_id": release.get("ID"),
        "os_like": release.get("ID_LIKE", "").split(),
        "kernel": next(iter(sections.get("kernel", [])), None),
        "uptime": _number(next(iter(sections.get("uptime", [])), None)),
        "memory": _memory(sections.get("memory", [])),
        "disks": _disks(sections.get("disks", [])),
        "updates": _updates(sections.get("updates", [])),
        "programs": [t for t in sections.get("tools", []) if t in PROGRAMS],
        "tmux": [s for s in map(_tmux_session, sections.get("tmux", [])) if s],
        "tailscale": next(iter(sections.get("tailscale", [])), None),
        "tailnet": _tailnet(sections.get("tailnet", [])),
        "tailscale_self": _tailscale_self(sections.get("tsself")),
        "projects": [p for p in (_project(line, version) for line in sections.get("projects", [])) if p],
        "ssh_keys": [k for k in (_ssh_key(line, version) for line in sections.get("keys", [])) if k]
        if version >= KEYS_SINCE else None,
        **_remotes(sections, version),
        "sudo_rule": next((v for v in sections.get("sudo", []) if v in ("on", "off")), None),
        "outdated": version != STATUS_LINE,
    }


def _release_line(line: str) -> tuple[str, str]:
    key, _, value = line.partition("=")
    return key, value.strip().strip('"').strip("'")


def _number(text: str | None) -> int | None:
    try:
        return int(float(text)) if text is not None else None
    except ValueError:
        return None


def _memory(lines: list[str]) -> dict | None:
    kb = {}
    for line in lines:
        key, _, rest = line.partition(":")
        value = _number(rest.split()[0] if rest.split() else None)
        if value is not None:
            kb[key] = value * 1024
    if "MemTotal" not in kb:
        return None
    return {"total": kb["MemTotal"], "available": kb.get("MemAvailable")}


def _disks(lines: list[str]) -> list[dict]:
    """`df -P -k` rows that are storage: a block device or the root, each device once —
    a btrfs or bind mount shows the same device again — never a loop device (snaps)."""
    out: list[dict] = []
    seen: set[str] = set()
    for line in lines[1:]:  # the header
        parts = line.split()
        if len(parts) < 6:
            continue
        device, size, used, mount = parts[0], parts[1], parts[2], " ".join(parts[5:])
        real = device.startswith("/dev/") and not device.startswith("/dev/loop")
        if device in _PSEUDO_FS or not (real or mount == "/") or device in seen:
            continue
        if _number(size) is None or _number(used) is None:
            continue
        seen.add(device)
        out.append({"mount": mount, "device": device, "size": int(size) * 1024, "used": int(used) * 1024})
    return out


def _updates(lines: list[str]) -> dict | None:
    for line in lines:
        manager, _, count = line.partition(" ")
        if manager and _number(count) is not None:
            return {"manager": manager, "count": _number(count)}
    return None


def _project(line: str, version: int) -> dict | None:
    # From v11 the key git uses for it comes before the commit time; the subject stays last.
    fields = 8 if version >= KEYS_SINCE else 7
    parts = line.split("|", fields - 1)
    if len(parts) != fields:
        return None
    key = parts.pop(5) if fields == 8 else "-"
    if not all(_number(n) is not None for n in (parts[2], parts[3], parts[5])):
        return None
    folder, _, name = parts[0].rpartition("/")
    return {
        "path": parts[0], "folder": folder, "name": name,
        "branch": None if parts[1] == "-" else parts[1],
        "dirty": parts[2] == "1",
        "claude": _number(parts[3]), "ahead": _number(parts[4]), "committed": _number(parts[5]),
        "subject": parts[6],
        "key": None if key == "-" else "" if key == "+" else key,
    }


# What the command lets through in a path or a module's name, and in an SSH host as a
# remote names it (an alias may hold `_`).
_SAFE = re.compile(r"^[A-Za-z0-9._/-]*$")
_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$")
# A key in ~/.ssh by its file's name — as the command lists them, and as Git's actions on
# a key take one (tool.TARGETS["key"]): never a path, never an option.
KEY_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def _key_name(path: str) -> str | None:
    """A key file as ssh names it (`~/.ssh/id_ed25519`, `/home/u/.ssh/x`, `%d/.ssh/x`) → its
    name, when it is in ~/.ssh — the only keys Keys lists."""
    folder, _, name = path.strip('"').rpartition("/")
    return name if folder.endswith(".ssh") and KEY_NAME.fullmatch(name) else None


def _remotes(sections: dict[str, list[str]], version: int) -> dict:
    if version < REMOTES_SINCE:
        return {"remotes": None, "ssh_hosts": None, "ssh_config_keys": None}
    remotes = []
    for line in sections.get("remotes", []):
        parts = line.split("|", 3)
        if len(parts) == 4 and _SAFE.fullmatch(parts[0]) and _SAFE.fullmatch(parts[1]) and parts[2] in ("url", "pushurl"):
            remotes.append({"path": parts[0], "module": parts[1], "kind": parts[2], "url": parts[3]})
    hosts = {}
    for line in sections.get("sshhosts", []):
        host, hostname, only, *files = line.split("|")
        if _HOST.fullmatch(host):
            hosts[host] = {"hostname": hostname or host, "identities_only": only == "yes",
                           "keys": [k for k in map(_key_name, files) if k]}
    return {"remotes": remotes, "ssh_hosts": hosts,
            "ssh_config_keys": sorted({k for k in map(_key_name, sections.get("sshconfig", [])) if k})}


_KEY_LINE = re.compile(r"^([A-Za-z0-9._-]+)\|(\d+) (SHA256:\S+) (.*?) ?\((\w+)\)$")
_PUBLIC = re.compile(r"^(?:ssh|ecdsa|sk)-[A-Za-z0-9@.-]+ [A-Za-z0-9+/]+=*$")


def _ssh_key(line: str, version: int) -> dict | None:
    """`name|<ssh-keygen -l line>` → `{name, bits, fingerprint, comment, type, public}`; from
    v13 `name|<type data>|<ssh-keygen -l line>`, `public` its key line (None before)."""
    public = None
    if version >= PUBLIC_SINCE:
        name, _, rest = line.partition("|")
        public, _, rest = rest.partition("|")
        line = f"{name}|{rest}"
        if not _PUBLIC.fullmatch(public):
            return None
    m = _KEY_LINE.match(line)
    if not m:
        return None
    return {"name": m.group(1), "bits": int(m.group(2)), "fingerprint": m.group(3),
            "comment": m.group(4), "type": m.group(5), "public": public}


_TAILNET_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$|^[0-9a-f:]+:[0-9a-f:]*$")


# Tailscale's BackendState, as the card says it. Starting and the others pass: None.
_TS_STATES = {"Running": "on", "Stopped": "off", "NeedsLogin": "login", "NeedsMachineAuth": "approval"}


def _tailscale_self(lines: list[str] | None) -> dict | None:
    """`state <BackendState>`, `shared <cidr>…` and `approved <cidr>…` → `{state, shared,
    approved}`. An exit node's `0.0.0.0/0` and `::/0` are not a network shared, so they are
    left out."""
    if lines is None:
        return None
    rows = {key: rest.split() for key, _, rest in (line.partition(" ") for line in lines)}
    return {
        "state": _TS_STATES.get(next(iter(rows.get("state", [])), "")),
        **{
            key: [r for r in rows.get(key, []) if "/" in r and r not in ("0.0.0.0/0", "::/0")]
            for key in ("shared", "approved")
        },
    }


def _tailnet(lines: list[str]) -> list[dict]:
    """`tailscale status` rows — `ip name user os status…` — this machine first. Its other
    lines (Logged out., # Health check:) aren't devices."""
    out = []
    for line in lines:
        parts = line.split(None, 4)
        if len(parts) < 4 or not _TAILNET_IP.match(parts[0]):
            continue
        status = parts[4].strip() if len(parts) > 4 else "-"
        out.append({
            "ip": parts[0], "name": parts[1], "os": parts[3],
            "online": not status.startswith("offline"), "self": not out, "status": status,
        })
    return out


def _tmux_session(line: str) -> dict | None:
    parts = line.split("|")
    if len(parts) != 4 or _number(parts[1]) is None:
        return None
    return {
        "name": parts[0],
        "created": _number(parts[1]),
        "attached": parts[2] not in ("", "0"),
        "windows": _number(parts[3]) or 0,
    }
