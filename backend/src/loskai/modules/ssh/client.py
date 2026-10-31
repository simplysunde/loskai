"""SSH module I/O: Loskai's keys, its SSH config and known_hosts, all in `data/ssh/`, and
the connections to the machines.

The main private key is stored encrypted with the admin password (OpenSSH format, bcrypt
KDF), so a copy of `data/` never holds a usable key. The status key is the one kept in the
clear — the machine limits it to listing what runs (`logic.status_line`). Nothing here
returns a private key: only public halves leave this module. Editing the files is
`logic.py`'s; this only reads and replaces them.
"""

import asyncio
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


def create_key(password: str) -> str:
    """Generate a new key pair, replacing any old one, and return its public key. The
    private half is encrypted with `password` before it touches the disk."""
    key = asyncssh.generate_private_key(KEY_TYPE, comment=KEY_COMMENT)
    private = key.export_private_key("openssh", passphrase=password, rounds=KDF_ROUNDS).decode()
    store.replace_private(_private_path(), private)
    return logic.public_key_of(private, KEY_COMMENT)


def load_key(password: str) -> asyncssh.SSHKey:
    """The main private key, decrypted. Raises `asyncssh.KeyImportError` for a wrong
    password, and FileNotFoundError before there is a key."""
    return asyncssh.import_private_key(_private_path().read_text(encoding="utf-8"), password)


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
    disconnect. Only `host_key` is trusted; nothing from the container's own `~/.ssh` (its
    config, its keys, an agent) is used."""
    trusted = asyncssh.import_public_key(host_key)
    options = {
        "port": port,
        "username": user,
        "known_hosts": ([trusted], [], []),
        "config": None,
        "agent_path": None,
        "client_keys": [client_key] if client_key else None,
        "password": password,
        "preferred_auth": "publickey" if client_key else "keyboard-interactive,password",
        "connect_timeout": TIMEOUT,
    }
    async with asyncssh.connect(host, **options) as conn:
        return await asyncio.wait_for(
            conn.run(command, input=stdin, check=False), TIMEOUT
        )
