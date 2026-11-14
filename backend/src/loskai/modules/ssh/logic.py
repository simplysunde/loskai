"""Pure SSH logic: editing an OpenSSH config file in place, and the `authorized_keys` line.

The config is the record of how each machine is reached (architecture.md → Machines), so
it is edited the way a person would edit it: one entry's lines change, and every other
line — comments, blank lines, entries naming no machine, the spelling of a keyword — is
left exactly as it was. Nothing here touches a file; `client.py` reads and writes it.
"""

import base64
import hashlib
import re

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


def rename_collides(text: str, old: str, new: str) -> bool:
    """Whether renaming `old` to `new` would leave two entries for `new`: both have one, and
    not the same. ssh takes the first, so the renamed entry could be the one it ignores."""
    lines = _split(text)
    a, b = _find(lines, old), _find(lines, new)
    return a is not None and b is not None and a != b


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


def authorized_keys_line(public_key: str, from_patterns: str | None) -> str:
    """The line a machine's `authorized_keys` gets. `from=` makes the key work only from the
    Docker host: a copy of it is useless anywhere else, and the machine enforces that, not
    Loskai. `from_patterns` is an OpenSSH pattern list — one address, or several and subnets,
    comma-separated (the Docker host itself also needs Loskai's own networks)."""
    return f'from="{from_patterns}" {public_key}' if from_patterns else public_key


def fingerprint_of(public_key: str) -> str:
    """`SHA256:…` of a public key line, as `ssh-keygen -lf` prints it, so the key Loskai
    shows can be found in a machine's `authorized_keys`."""
    blob = base64.b64decode(public_key.split()[1])
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


# Updates without a password: a sudo rule Loskai may put on a machine (tool.allow_script),
# letting its user run exactly System's update commands — and this file's removal — with no
# password. The machine's sudo enforces it; Loskai holds no password. It comes off with the
# machine or its SSH connection (UNINSTALL_SCRIPT).
SUDO_RULE = "/etc/sudoers.d/loskai"


def remove_sudo_rule(on_fail: str) -> str:
    """Shell that takes the sudo rule off — as root, or through the rule itself, which
    allows exactly this — running `on_fail` when it is there and won't go. No rule (or a
    sudo that asks for a password and no rule to read): nothing to do."""
    return (
        f'if [ "$(id -u)" = 0 ]; then rm -f {SUDO_RULE}; '
        f"elif ! sudo -n rm -f {SUDO_RULE} 2>/dev/null && [ -e {SUDO_RULE} ]; then {on_fail}; fi"
    )

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

# Takes off what Loskai put on a machine, when the machine or its SSH connection goes: its sudo
# rule first, while its key still gets in (`!sudo-rule` when it stays), then its lines in
# `authorized_keys` — the same lines, the same way, and nothing else.
UNINSTALL_SCRIPT = (
    remove_sudo_rule("echo '!sudo-rule'") + "; "
    "set -e; umask 077; f=~/.ssh/authorized_keys; [ -f \"$f\" ] || exit 0; "
    "t=\"$f.loskai-new\"; "
    "{ grep -v -e ' loskai$' -e ' loskai-status$' \"$f\" || [ $? -eq 1 ]; } > \"$t\"; "
    "mv \"$t\" \"$f\""
)


# --- known_hosts, keyed by machine id ---
#
# OpenSSH's format with the machine's *id* where a host name would go: the id never changes,
# so a rename or a move keeps the trusted key, and a changed key is still refused.


def known_keys(text: str) -> dict[str, str]:
    """Each machine's trusted host key (`<type> <base64>`), by machine id."""
    return {parts[0]: f"{parts[1]} {parts[2]}" for parts in (line.split() for line in _split(text)) if len(parts) >= 3}


def known_key(text: str, machine_id: str) -> str | None:
    """The trusted host key (`<type> <base64>`) for a machine, or None."""
    return known_keys(text).get(machine_id)


def set_known(text: str, machine_id: str, key: str) -> str:
    return _join([*_drop_known(text, machine_id), f"{machine_id} {key}"])


def forget_known(text: str, machine_id: str) -> str:
    return _join(_drop_known(text, machine_id))


def _drop_known(text: str, machine_id: str) -> list[str]:
    return [line for line in _split(text) if line.split()[:1] != [machine_id]]
