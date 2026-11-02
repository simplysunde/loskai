"""Loskai's accounts — `data/users.json`, owner-only, beside `settings.json`.

An **admin** does everything; an **operator** is given tabs (`TABS`) and may do everything in
those and nothing else — `access.py` says which route belongs to which. Each account has an
argon2 hash and a `generation`: a session carries the generation it was issued under, so
bumping it (logout, a new password, the account removed) ends every session of that user on
every device, and no one else's. There is always at least one admin.

A file that exists but doesn't parse aborts startup (`verify_readable`), as `settings.json`
does: reading it as empty would re-open the public first-run setup on a configured install.
"""

import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error

from ..config import settings as env
from . import settings as settings_store
from . import store

ROLES = ("admin", "operator")
# The tabs an operator can be given, as the API's access table names them.
TABS = ("docker", "routing", "machines")
USERNAME = re.compile(r"^[a-z][a-z0-9_.-]{0,31}$")
MIN_PASSWORD_LEN = 8

_ph = PasswordHasher()
# Checked against when the username is unknown, so a wrong name costs what a wrong password
# does and the timing doesn't say which names exist.
_DUMMY_HASH = _ph.hash("loskai-no-such-user")


class UserError(ValueError):
    """A change the accounts can't take; `status` is the HTTP answer."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


@dataclass
class User:
    username: str
    role: str
    tabs: list[str] = field(default_factory=list)
    hash: str = ""
    generation: int = 0
    created: float = 0.0

    @property
    def admin(self) -> bool:
        return self.role == "admin"

    def may(self, tab: str) -> bool:
        """Whether this user may use `tab` — every tab, for an admin."""
        return self.admin or tab in self.tabs

    def view(self) -> dict[str, Any]:
        """What the API shows of an account: never its hash."""
        return {"username": self.username, "role": self.role, "tabs": self.tabs if not self.admin else list(TABS),
                "created": self.created}


def _path() -> Path:
    return Path(env.data_dir) / "users.json"


def _parse(raw: Any) -> list[User]:
    if not isinstance(raw, dict) or not isinstance(raw.get("users"), list):
        raise store.CorruptStoreError(f"{_path()} must hold an object with a 'users' list")
    return [User(**{k: v for k, v in u.items() if k in User.__dataclass_fields__}) for u in raw["users"]]


def _dump(users: list[User]) -> dict[str, Any]:
    return {"users": [u.__dict__ for u in users]}


def verify_readable() -> None:
    """Fail at startup when users.json exists but doesn't parse — see the module docstring."""
    _parse(store.read_json(_path(), {"users": []}))


def all_users() -> list[User]:
    return _parse(store.read_json(_path(), {"users": []}))


def get(username: str) -> User | None:
    return next((u for u in all_users() if u.username == username), None)


def any_users() -> bool:
    return bool(all_users())


def _update(mutate) -> list[User]:
    """Read → change → write under the store lock. `mutate` gets the list and returns it."""
    return _parse(store.update_json(_path(), {"users": []}, lambda raw: _dump(mutate(_parse(raw)))))


def check_username(username: str) -> None:
    if not USERNAME.match(username):
        raise UserError(422, "A username: lowercase letters, digits, _ . - and starting with a letter")


def check_password_rule(password: str) -> None:
    if len(password) < MIN_PASSWORD_LEN:
        raise UserError(422, f"A password needs at least {MIN_PASSWORD_LEN} characters")


def _check_tabs(role: str, tabs: list[str]) -> list[str]:
    if role not in ROLES:
        raise UserError(422, f"A role is one of {', '.join(ROLES)}")
    unknown = [t for t in tabs if t not in TABS]
    if unknown:
        raise UserError(422, f"No tab {unknown[0]!r} — the tabs are {', '.join(TABS)}")
    if role == "admin":
        return []
    if not tabs:
        raise UserError(422, "An operator needs at least one tab")
    return [t for t in TABS if t in tabs]


def create(username: str, password: str, role: str, tabs: list[str] | None = None, *, hashed: str | None = None) -> User:
    """A new account. `hashed` takes an existing hash instead of a password (the migration)."""
    check_username(username)
    if hashed is None:
        check_password_rule(password)
        hashed = _ph.hash(password)
    user = User(username, role, _check_tabs(role, tabs or []), hashed, 0, time.time())

    def add(users: list[User]) -> list[User]:
        if any(u.username == username for u in users):
            raise UserError(409, f"There is already a user {username!r}")
        return [*users, user]

    _update(add)
    return user


def _change(username: str, change) -> User:
    found: list[User] = []

    def apply(users: list[User]) -> list[User]:
        for u in users:
            if u.username == username:
                change(u, users)
                found.append(u)
                return users
        raise UserError(404, f"No user {username!r}")

    _update(apply)
    return found[0]


def _admins_besides(users: list[User], username: str) -> int:
    return sum(1 for u in users if u.admin and u.username != username)


def set_role(username: str, role: str, tabs: list[str]) -> User:
    """A new role and tabs. The last admin can't stop being one."""
    clean = _check_tabs(role, tabs)

    def change(u: User, users: list[User]) -> None:
        if u.admin and role != "admin" and _admins_besides(users, username) == 0:
            raise UserError(409, "Loskai needs an admin — make another one first")
        u.role, u.tabs = role, clean

    return _change(username, change)


def set_password(username: str, password: str) -> User:
    """A new password; every session of that user ends."""
    check_password_rule(password)
    hashed = _ph.hash(password)

    def change(u: User, _users: list[User]) -> None:
        u.hash, u.generation = hashed, u.generation + 1

    return _change(username, change)


def end_sessions(username: str) -> None:
    """Every session of `username` ends — logout, on every device."""
    def change(u: User, _users: list[User]) -> None:
        u.generation += 1

    _change(username, change)


def delete(username: str) -> None:
    """Remove an account — never the last admin. Its sessions end with it."""
    def remove(users: list[User]) -> list[User]:
        target = next((u for u in users if u.username == username), None)
        if target is None:
            raise UserError(404, f"No user {username!r}")
        if target.admin and _admins_besides(users, username) == 0:
            raise UserError(409, "Loskai needs an admin — this is the last one")
        return [u for u in users if u.username != username]

    _update(remove)


def verify(username: str, password: str) -> User | None:
    """The account if the password is its own, else None — the same work either way."""
    user = get(username)
    try:
        _ph.verify(user.hash if user else _DUMMY_HASH, password)
    except Argon2Error:
        return None
    return user


def ensure_seeded() -> None:
    """At startup: an install from before accounts gets its password as the account `admin`
    (the settings key then goes); a fresh one with `LOSKAI_PASSWORD` gets its first admin,
    named `LOSKAI_USERNAME` (default `admin`). Otherwise first-run setup makes it."""
    if any_users():
        return
    legacy = settings_store.admin_password_hash()
    if legacy:
        create("admin", "", "admin", hashed=legacy)
        settings_store.drop_admin_password_hash()
    elif env.loskai_password:
        # Hashed as given: the env is the operator's choice, and refusing it would stop startup.
        create(env.loskai_username or "admin", "", "admin", hashed=_ph.hash(env.loskai_password))
