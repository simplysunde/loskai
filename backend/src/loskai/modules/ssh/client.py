"""SSH module I/O: Loskai's key and its SSH config file, both in `data/ssh/`.

The private key is stored encrypted with the admin password (OpenSSH format, bcrypt KDF),
so a copy of `data/` never holds a usable key. Nothing here returns it: the public half is
all that leaves this module. Editing the config is `logic.py`'s; this only reads and
replaces the file.
"""

from collections.abc import Callable
from pathlib import Path

import asyncssh

from ...config import settings as env
from ...shared import store
from . import logic

KEY_TYPE = "ssh-ed25519"
KEY_COMMENT = "loskai"


def ssh_dir() -> Path:
    return Path(env.data_dir) / "ssh"


def _private_path() -> Path:
    return ssh_dir() / "id_ed25519"


def config_path() -> Path:
    return ssh_dir() / "config"


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
    private = key.export_private_key("openssh", passphrase=password).decode()
    store.replace_private(_private_path(), private)
    return logic.public_key_of(private, KEY_COMMENT)


def read_config() -> str:
    path = config_path()
    return path.read_text(encoding="utf-8") if path.exists() else ""


def update_config(mutate: Callable[[str], str]) -> str:
    return store.update_text(config_path(), mutate)
