"""Loskai's main key, unlocked in memory for a while after the admin password is typed.

Not at login: a session cookie alone never reaches a machine, and after a restart nothing
does until someone types the password (architecture.md → Keeping the key safe). Ending the
sessions — logout — locks it too: the unlock remembers which sessions it belongs to.
"""

import time

import asyncssh

from ...shared import auth

UNLOCK_SECONDS = 15 * 60

_key: asyncssh.SSHKey | None = None
_until = 0.0  # time.time() it locks at
_epoch: str | None = None


def unlock(key: asyncssh.SSHKey) -> float:
    """Hold `key` for `UNLOCK_SECONDS`; returns when it locks."""
    global _key, _until, _epoch
    _key, _until, _epoch = key, time.time() + UNLOCK_SECONDS, auth.session_epoch()
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
