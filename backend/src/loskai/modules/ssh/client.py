"""SSH module I/O: Loskai's keys, its SSH config and known_hosts, all in `data/ssh/`, and
the connections to the machines.

The main private key is stored encrypted (OpenSSH format, bcrypt KDF) with a random key that
each account's slot seals with its password (`keys.py`), so a copy of `data/` never holds a
usable key. The status key is the one kept in the
clear — the machine limits it to listing what runs (`logic.status_line`). Nothing here
returns a private key: only public halves leave this module. Editing the files is
`logic.py`'s; this only reads and replaces them.
"""

import asyncio
import json
import os
from collections.abc import Callable
from pathlib import Path

import asyncssh

from ...config import settings as env
from ...shared import store
from . import logic

KEY_TYPE = "ssh-ed25519"
KEY_COMMENT = "loskai"
KDF_ROUNDS = 128  # bcrypt rounds encrypting the key — OpenSSH's and asyncssh's default


def ssh_dir() -> Path:
    return Path(env.data_dir) / "ssh"


def _private_path() -> Path:
    return ssh_dir() / "id_ed25519"


def _status_path() -> Path:
    return ssh_dir() / "status_ed25519"


def config_path() -> Path:
    return ssh_dir() / "config"


def _known_hosts_path() -> Path:
    return ssh_dir() / "known_hosts"


def public_key() -> str | None:
    """Loskai's public key (`ssh-ed25519 AAAA… loskai`), or None before one is made."""
    path = _private_path()
    if not path.exists():
        return None
    return logic.public_key_of(path.read_text(encoding="utf-8"), KEY_COMMENT)


def create_key(passphrase: str) -> str:
    """Generate a new key pair, replacing any old one, and return its public key. The
    private half is encrypted with `passphrase` before it touches the disk."""
    return store_key(asyncssh.generate_private_key(KEY_TYPE, comment=KEY_COMMENT), passphrase)


def store_key(key: asyncssh.SSHKey, passphrase: str) -> str:
    """Write `key` as the main key, encrypted with `passphrase`; returns its public key."""
    private = key.export_private_key("openssh", passphrase=passphrase, rounds=KDF_ROUNDS).decode()
    store.replace_private(_private_path(), private)
    return logic.public_key_of(private, KEY_COMMENT)


def load_key(passphrase: str) -> asyncssh.SSHKey:
    """The main private key, decrypted. Raises `asyncssh.KeyImportError` for a wrong
    passphrase, and FileNotFoundError before there is a key."""
    return asyncssh.import_private_key(_private_path().read_text(encoding="utf-8"), passphrase)


def status_key() -> asyncssh.SSHKey:
    """The status key, made on first use: a key made before it existed gets one then."""
    path = _status_path()
    if not path.exists():
        key = asyncssh.generate_private_key(KEY_TYPE, comment=logic.STATUS_COMMENT)
        store.replace_private(path, key.export_private_key("openssh").decode())
    return asyncssh.import_private_key(path.read_text(encoding="utf-8"))


def status_public_key() -> str:
    return status_key().export_public_key("openssh").decode().strip()


def read_known_hosts() -> str:
    path = _known_hosts_path()
    return path.read_text(encoding="utf-8") if path.exists() else ""


def update_known_hosts(mutate: Callable[[str], str]) -> str:
    return store.update_text(_known_hosts_path(), mutate)


def _log_path() -> Path:
    return ssh_dir() / "sessions.log"


LOG_KEEP = 1000  # entries kept when the log is trimmed


def append_log(entry: dict) -> None:
    """One JSON line per event, owner-only. Trimmed to the last `LOG_KEEP` once it is twice
    that, so it never grows without bound."""
    path = _log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    if path.stat().st_size > LOG_KEEP * 2 * 200:  # ~200 bytes a line
        store.update_text(path, lambda text: "\n".join(text.splitlines()[-LOG_KEEP:]) + "\n")


def read_log(limit: int, user: str | None = None) -> list[dict]:
    """The last `limit` entries, newest first — only `user`'s, given one."""
    path = _log_path()
    if not path.exists():
        return []
    out = []
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if user is None or entry.get("user") == user:
            out.append(entry)
            if len(out) == limit:
                break
    return out


def read_config() -> str:
    path = config_path()
    return path.read_text(encoding="utf-8") if path.exists() else ""


def update_config(mutate: Callable[[str], str]) -> str:
    return store.update_text(config_path(), mutate)


# --- Connections ---

TIMEOUT = 10  # seconds — to connect, and again to run a command

# The host key types to ask for, in OpenSSH's own order, so the fingerprint shown is the one
# `ssh` and `ssh-keygen -lf` show for the machine — not its RSA key, asyncssh's first pick.
HOST_KEY_ALGS = [
    "ssh-ed25519",
    "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
    "rsa-sha2-512", "rsa-sha2-256",
]


async def scan_host_key(host: str, port: int) -> asyncssh.SSHKey:
    """The machine's host key, without logging in or trusting it. Raises OSError (or a
    timeout) when nothing answers, ValueError when it isn't an SSH server."""
    key = await asyncio.wait_for(
        asyncssh.get_server_host_key(host, port, config=None, server_host_key_algs=HOST_KEY_ALGS),
        TIMEOUT,
    )
    if key is None:
        raise ValueError("no host key offered")
    return key


async def run(
    host: str,
    port: int,
    user: str,
    host_key: str,
    command: str,
    *,
    client_key: asyncssh.SSHKey | None = None,
    password: str | None = None,
    stdin: str | None = None,
) -> asyncssh.SSHCompletedProcess:
    """Log in with exactly one credential — a key or a password — run one command, and
    disconnect."""
    async with _connect(host, port, user, host_key, client_key, password) as conn:
        return await asyncio.wait_for(
            conn.run(command, input=stdin, check=False), TIMEOUT
        )


def _connect(
    host: str,
    port: int,
    user: str,
    host_key: str,
    client_key: asyncssh.SSHKey | None,
    password: str | None = None,
):
    """A connection trusting only `host_key`, with nothing from the container's own `~/.ssh`
    (its config, its keys, an agent)."""
    return asyncssh.connect(
        host,
        port=port,
        username=user,
        known_hosts=([asyncssh.import_public_key(host_key)], [], []),
        config=None,
        agent_path=None,
        client_keys=[client_key] if client_key else None,
        password=password,
        preferred_auth="publickey" if client_key else "keyboard-interactive,password",
        connect_timeout=TIMEOUT,
    )


async def open_shell(
    host: str, port: int, user: str, host_key: str, client_key: asyncssh.SSHKey, cols: int, rows: int,
    command: str | None = None,
    first_line: str | None = None,
) -> tuple[asyncssh.SSHClientConnection, asyncssh.SSHClientProcess]:
    """A login shell on a pty — or `command` on one — bytes in and out. Given `first_line`
    (sudo's password), the pty starts with echo off, so it never shows, and that line is
    sent before anything else; `command` turns echo back on once it has read it. The caller
    closes the connection, which hangs up the pty, so what runs ends with the browser's
    terminal (a tmux session excepted: it is made to outlive it)."""
    conn = await _connect(host, port, user, host_key, client_key)
    try:
        process = await conn.create_process(
            command, term_type="xterm-256color", term_size=(cols, rows),
            term_modes={asyncssh.PTY_ECHO: 0} if first_line is not None else None,
            encoding=None, stderr=asyncssh.STDOUT,
        )
        if first_line is not None:
            process.stdin.write((first_line + "\n").encode())
    except BaseException:
        conn.close()
        raise
    return conn, process
