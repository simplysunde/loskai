"""Who may use Loskai's main key right now: an unlock is a password check that lasts.

A session cookie alone never reaches a machine. Typing your password again unlocks the key
for you — like `sudo`, another user unlocks for themselves — for 15 minutes, or what
Settings › SSH says, and it ends sooner when you log out, your password changes (your
sessions' generation moves on) or you lose the Machines tab.

An admin can switch the asking off (`ssh_ask_password`): then the Machines tab is enough.

Who holds an unlock is kept in a file beside the key, so a restart of Loskai — a deploy, or
every save under `make live` — doesn't lock it. The file holds no secret: names, times and
generations. Whoever could write it could read the key itself.
"""

import time
from pathlib import Path

import asyncssh

from ...shared import settings as settings_store
from ...shared import store, users
from . import client


def _path() -> Path:
    # Who holds an unlock: username → [until, the generation of their sessions then].
    return client.ssh_dir() / "unlocks.json"


def _holders() -> dict[str, list]:
    """Who holds an unlock. A file that doesn't parse holds none: the next unlock rewrites it."""
    try:
        held = store.read_json(_path(), {})
    except store.CorruptStoreError:
        return {}
    return held if isinstance(held, dict) else {}


def unlock(username: str) -> float:
    """Let `username` use the key for as long as Settings › SSH says; returns when it locks.
    A change to the setting applies from the next unlock."""
    user = users.get(username)
    until = time.time() + settings_store.ssh_unlock_seconds()
    entry = [until, user.generation if user else -1]
    try:
        store.update_json(_path(), {}, lambda held: {**(held if isinstance(held, dict) else {}), username: entry})
    except store.CorruptStoreError:
        store.write_json(_path(), {username: entry})
    return until


def lock(username: str | None = None) -> None:
    """Lock it for `username`, or for everyone."""
    if username is None:
        if _path().exists():
            store.write_json(_path(), {})
    elif username in _holders():
        store.update_json(_path(), {}, lambda held: {k: v for k, v in held.items() if k != username})


def _until(username: str) -> float | None:
    """When `username`'s unlock ends, read once — None while they hold none (expired, or
    their sessions or level changed since, which locks it)."""
    held = _holders().get(username)
    if not isinstance(held, list) or len(held) != 2:
        return None
    user = users.get(username)
    if time.time() >= held[0] or user is None or user.generation != held[1] or not user.may("machines"):
        lock(username)
        return None
    return held[0]


def _holds(username: str) -> bool:
    if not settings_store.ssh_asks_password():
        # Switched off by an admin: the Machines tab is enough.
        user = users.get(username)
        return user is not None and user.may("machines")
    return _until(username) is not None


def unlocked_key(username: str | None) -> asyncssh.SSHKey | None:
    """The key while `username` holds an unlock, else None."""
    return client.load_key() if username and _holds(username) else None


def unlocked_until(username: str | None) -> float | None:
    """When `username`'s unlock ends — None while locked, or while nothing is asked."""
    if not username or not settings_store.ssh_asks_password():
        return None
    return _until(username)
