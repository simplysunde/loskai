"""Loskai's main key, unlocked in memory for a while after the admin password is typed.

Not at login: a session cookie alone never reaches a machine, and after a restart nothing
does until someone types the password (architecture.md → Keeping the key safe). Ending the
sessions — logout — locks it too: the unlock remembers which sessions it belongs to.
"""

import time

import asyncssh

from ...shared import auth
from ...shared import settings as settings_store

_key: asyncssh.SSHKey | None = None
_until = 0.0  # time.time() it locks at
_epoch: str | None = None


def unlock(key: asyncssh.SSHKey) -> float:
    """Hold `key` for as long as Settings › SSH says (15 minutes unless changed); returns
    when it locks. A change to the setting applies from the next unlock."""
    global _key, _until, _epoch
    _key, _until, _epoch = key, time.time() + settings_store.ssh_unlock_seconds(), auth.session_epoch()
    return _until


def lock() -> None:
    global _key, _until, _epoch
    _key, _until, _epoch = None, 0.0, None


def unlocked_key() -> asyncssh.SSHKey | None:
    """The key while it is unlocked, else None (and it is forgotten)."""
    if _key is None:
        return None
    if time.time() >= _until or _epoch != auth.session_epoch():
        lock()
        return None
    return _key


def unlocked_until() -> float | None:
    return _until if unlocked_key() is not None else None
