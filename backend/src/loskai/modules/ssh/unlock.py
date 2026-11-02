"""Loskai's main key, unlocked in memory for a while after the admin password is typed.

Not at login: a session cookie alone never reaches a machine, and after a restart nothing
does until someone types the password (architecture.md → Keeping the key safe). The unlock
belongs to the user who typed it: their logging out — which ends their sessions — locks it.
"""

import time

import asyncssh

from ...shared import settings as settings_store
from ...shared import users

_key: asyncssh.SSHKey | None = None
_until = 0.0  # time.time() it locks at
_by: tuple[str, int] | None = None  # who unlocked it: username and session generation


def unlock(key: asyncssh.SSHKey, username: str) -> float:
    """Hold `key` for `username` for as long as Settings › SSH says (15 minutes unless
    changed); returns when it locks. A change to the setting applies from the next unlock."""
    global _key, _until, _by
    user = users.get(username)
    _key, _until = key, time.time() + settings_store.ssh_unlock_seconds()
    _by = (username, user.generation if user else -1)
    return _until


def lock() -> None:
    global _key, _until, _by
    _key, _until, _by = None, 0.0, None


def unlocked_key() -> asyncssh.SSHKey | None:
    """The key while it is unlocked, else None (and it is forgotten): it locks when its time
    is up, or when the user who unlocked it logs out (their sessions' generation moves on)."""
    if _key is None or _by is None:
        return None
    user = users.get(_by[0])
    if time.time() >= _until or user is None or user.generation != _by[1]:
        lock()
        return None
    return _key


def unlocked_until() -> float | None:
    return _until if unlocked_key() is not None else None
