"""Pure SSH logic: editing an OpenSSH config file in place, and the `authorized_keys` line.

The config is the record of how each machine is reached (architecture.md → Machines), so
it is edited the way a person would edit it: one entry's lines change, and every other
line — comments, blank lines, entries naming no machine, the spelling of a keyword — is
left exactly as it was. Nothing here touches a file; `client.py` reads and writes it.
"""

import base64
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
    Loskai."""
    return f'from="{from_ip}" {public_key}' if from_ip else public_key


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
