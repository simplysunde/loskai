"""Loskai's main key, unlocked in memory for a while after a user types their password.

Not at login: a session cookie alone never reaches a machine, and after a restart nothing
does until someone types a password (architecture.md → Keeping the key safe). An unlock is
the user's who typed it — like `sudo`, another user must unlock for themselves — and ends
when their time is up or they log out (their sessions' generation moves on). The key and
its key-encryption key stay in memory while anyone holds an unlock, and are dropped when
no one does.
"""

import time

import asyncssh

from ...shared import settings as settings_store
from ...shared import users

_key: asyncssh.SSHKey | None = None
_kek: bytes | None = None
# Who holds an unlock: username → (until, the generation of their sessions then).
_holders: dict[str, tuple[float, int]] = {}


def unlock(key: asyncssh.SSHKey, kek: bytes, username: str) -> float:
    """Hold `key` for `username` for as long as Settings › SSH says (15 minutes unless
    changed); returns when it locks. A change to the setting applies from the next unlock."""
    global _key, _kek
    user = users.get(username)
    until = time.time() + settings_store.ssh_unlock_seconds()
    _key, _kek = key, kek
    _holders[username] = (until, user.generation if user else -1)
    return until


def lock(username: str | None = None) -> None:
    """Lock it for `username`, or for everyone."""
    global _key, _kek
    if username is None:
        _holders.clear()
    else:
        _holders.pop(username, None)
    if not _holders:
        _key, _kek = None, None


def _holds(username: str) -> bool:
    held = _holders.get(username)
    if held is None:
        return False
    user = users.get(username)
    if time.time() >= held[0] or user is None or user.generation != held[1]:
        lock(username)
        return False
    return True


def _prune() -> None:
    for name in list(_holders):
        _holds(name)


def unlocked_key(username: str | None) -> asyncssh.SSHKey | None:
    """The key while `username` holds an unlock, else None."""
    return _key if username and _holds(username) else None


def unlocked_until(username: str | None) -> float | None:
    return _holders[username][0] if username and _holds(username) else None


def kek_in_use() -> bytes | None:
    """The key-encryption key while anyone holds an unlock — to give another account a slot."""
    _prune()
    return _kek
