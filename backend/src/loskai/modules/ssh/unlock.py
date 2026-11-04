"""Who may use Loskai's main key right now: an unlock is a password check that lasts.

A session cookie alone never reaches a machine. Typing your password again unlocks the key
for you — like `sudo`, another user unlocks for themselves — for 15 minutes, or what
Settings › SSH says, and it ends sooner when you log out, your password changes (your
sessions' generation moves on) or you lose the Machines tab.
"""

import time

import asyncssh

from ...shared import settings as settings_store
from ...shared import users
from . import client

# Who holds an unlock: username → (until, the generation of their sessions then).
_holders: dict[str, tuple[float, int]] = {}


def unlock(username: str) -> float:
    """Let `username` use the key for as long as Settings › SSH says; returns when it locks.
    A change to the setting applies from the next unlock."""
    user = users.get(username)
    until = time.time() + settings_store.ssh_unlock_seconds()
    _holders[username] = (until, user.generation if user else -1)
    return until


def lock(username: str | None = None) -> None:
    """Lock it for `username`, or for everyone."""
    if username is None:
        _holders.clear()
    else:
        _holders.pop(username, None)


def _holds(username: str) -> bool:
    held = _holders.get(username)
    if held is None:
        return False
    user = users.get(username)
    if time.time() >= held[0] or user is None or user.generation != held[1] or not user.may("machines"):
        lock(username)
        return False
    return True


def unlocked_key(username: str | None) -> asyncssh.SSHKey | None:
    """The key while `username` holds an unlock, else None."""
    return client.load_key() if username and _holds(username) else None


def unlocked_until(username: str | None) -> float | None:
    return _holders[username][0] if username and _holds(username) else None
