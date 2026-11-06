"""Loskai's accounts — `data/users.json`, owner-only, beside `settings.json`.

Each account has a **level**, and each level adds to the ones below: 1 Routing, 2 Docker,
3 Machines, 4 Settings — an admin, who does everything, the accounts and the logs included.
`access.py` says which level each route needs. Each account has an
argon2 hash and a `generation`: a session carries the generation it was issued under, so
bumping it (logout, a new password, the account removed) ends every session of that user on
every device, and no one else's. There is always at least one admin.

A file that exists but doesn't parse aborts startup (`verify_readable`), as `settings.json`
does: reading it as empty would re-open the public first-run setup on a configured install.
"""

import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from ..config import settings as env
from . import settings as settings_store
from . import store
from .errors import LoskaiError

ROUTING, DOCKER, MACHINES, ADMIN = 1, 2, 3, 4
LEVEL_NAMES = {ROUTING: "Routing", DOCKER: "Docker", MACHINES: "Machines", ADMIN: "Settings"}
# The tab each level adds, as the pages and the terminals name them.
TAB_LEVEL = {"routing": ROUTING, "docker": DOCKER, "machines": MACHINES}
USERNAME = re.compile(r"^[a-z][a-z0-9_.-]{0,31}$")
MIN_PASSWORD_LEN = 8

_ph = PasswordHasher()
# Checked against when the username is unknown, so a wrong name costs what a wrong password
# does and the timing doesn't say which names exist.
_DUMMY_HASH = _ph.hash("loskai-no-such-user")


class UserError(LoskaiError, ValueError):
    """A change the accounts can't take."""


@dataclass
class User:
    username: str
    level: int
    hash: str = ""
    generation: int = 0
    created: float = 0.0

    @property
    def admin(self) -> bool:
        return self.level == ADMIN

    def may(self, tab: str) -> bool:
        """Whether this user may use `tab`: at its level or above."""
        return self.level >= TAB_LEVEL[tab]

    def view(self) -> dict[str, Any]:
        """What the API shows of an account: never its hash. `tabs` follow from the level,
        so the pages needn't know which level adds which."""
        return {"username": self.username, "level": self.level, "tabs": [t for t in TAB_LEVEL if self.may(t)],
                "created": self.created}


def _path() -> Path:
    return Path(env.data_dir) / "users.json"


def _level(raw: dict) -> int:
    """An account's level as saved — or, saved before levels, from its role and tabs: an
    operator gets its highest tab's, so it loses nothing it had."""
    if "level" not in raw:
        if raw.get("role") == "admin":
            return ADMIN
        return max((TAB_LEVEL[t] for t in raw.get("tabs", []) if t in TAB_LEVEL), default=ROUTING)
    if raw["level"] not in LEVEL_NAMES:
        raise store.CorruptStoreError(f"{_path()}: {raw.get('username')!r} has no level 1–4")
    return raw["level"]


def _parse(raw: Any) -> list[User]:
    if not isinstance(raw, dict) or not isinstance(raw.get("users"), list):
        raise store.CorruptStoreError(f"{_path()} must hold an object with a 'users' list")
    return [
        User(**{k: v for k, v in u.items() if k in User.__dataclass_fields__ and k != "level"}, level=_level(u))
        for u in raw["users"]
    ]


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
    if not USERNAME.fullmatch(username):
        raise UserError("A username: lowercase letters, digits, _ . - and starting with a letter", 422)


def check_password_rule(password: str) -> None:
    if len(password) < MIN_PASSWORD_LEN:
        raise UserError(f"A password needs at least {MIN_PASSWORD_LEN} characters", 422)


def check_level(level: int) -> None:
    if level not in LEVEL_NAMES:
        raise UserError(f"A level is 1 to {ADMIN}", 422)


def create(username: str, password: str, level: int, *, hashed: str | None = None, first: bool = False) -> User:
    """A new account. `hashed` takes an existing hash instead of a password (the migration).
    `first`: only as the first account — checked under the store lock, so two first-run
    setups at once can't both make an admin."""
    check_username(username)
    check_level(level)
    if hashed is None:
        check_password_rule(password)
        hashed = _ph.hash(password)
    now = time.time()
    # Not 0: a session names the account and its generation, so an account made again under
    # a removed one's name would take up its sessions. Starting at the creation time, in
    # milliseconds, no earlier account of that name can have carried the same number.
    user = User(username, level, hashed, int(now * 1000), now)

    def add(users: list[User]) -> list[User]:
        if first and users:
            raise UserError("Loskai is already set up", 409)
        if any(u.username == username for u in users):
            raise UserError(f"There is already a user {username!r}", 409)
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
        raise UserError(f"No user {username!r}", 404)

    _update(apply)
    return found[0]


def _admins_besides(users: list[User], username: str) -> int:
    return sum(1 for u in users if u.admin and u.username != username)


def set_level(username: str, level: int) -> User:
    """A new level. The last admin can't stop being one."""
    check_level(level)

    def change(u: User, users: list[User]) -> None:
        if u.admin and level != ADMIN and _admins_besides(users, username) == 0:
            raise UserError("Loskai needs an admin — make another one first", 409)
        u.level = level

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
            raise UserError(f"No user {username!r}", 404)
        if target.admin and _admins_besides(users, username) == 0:
            raise UserError("Loskai needs an admin — this is the last one", 409)
        return [u for u in users if u.username != username]

    _update(remove)


def verify(username: str, password: str) -> User | None:
    """The account if the password is its own, else None — the same work either way. A hash
    that isn't one (empty, or edited by hand) is a wrong password, not a crash: it is
    counted like any other."""
    user = get(username)
    try:
        _ph.verify(user.hash if user else _DUMMY_HASH, password)
    except (Argon2Error, InvalidHashError):  # InvalidHashError is a ValueError, not an Argon2Error
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
        create("admin", "", ADMIN, hashed=legacy)
        settings_store.drop_admin_password_hash()
    elif env.loskai_password:
        # Lowercased, as login lowercases what is typed. A name that still isn't one stops
        # startup, saying which variable: skipping it would open first-run setup to anyone.
        name = (env.loskai_username or "admin").strip().lower()
        if not USERNAME.fullmatch(name):
            raise RuntimeError(
                f"LOSKAI_USERNAME={env.loskai_username!r} isn't a username: lowercase letters, "
                "digits, _ . - and starting with a letter"
            )
        # The password hashed as given: the env is the operator's choice, and refusing it
        # would stop startup.
        create(name, "", ADMIN, hashed=_ph.hash(env.loskai_password))


# --- Routes: the accounts, for an admin (access.py) ---

router = APIRouter(prefix="/api", tags=["users"])


class NewUser(BaseModel):
    username: str
    password: str
    level: int


class UserChange(BaseModel):
    level: int | None = None
    password: str | None = None  # an admin setting someone's password


@router.get("/users")
def list_users() -> list[dict]:
    return [u.view() for u in all_users()]


@router.post("/users")
def add_user(body: NewUser) -> dict:
    return create(body.username.strip().lower(), body.password, body.level).view()


@router.patch("/users/{username}")
def change_user(username: str, body: UserChange, request: Request, response: Response) -> dict:
    """A new level, takes effect on that user's next request; a new password ends
    their sessions — an admin's own goes on, with a fresh cookie, as Change password's does.
    The password is checked first, so a refused one changes nothing."""
    from . import auth  # auth reads accounts

    user = get(username)
    if user is None:
        raise UserError(f"No user {username!r}", 404)
    if body.password is not None:
        check_password_rule(body.password)
    if body.level is not None:
        user = set_level(username, body.level)
    if body.password is not None:
        user = set_password(username, body.password)
    if not user.may("machines"):
        # Ended now, not when it is next used: given the level back, they unlock again.
        from ..modules.ssh import unlock  # the SSH module reads accounts too

        unlock.lock(username)
    me = auth.current_user()
    if body.password is not None and me is not None and me.username == username:
        auth.set_cookie(request, response, user)
    return user.view()


@router.delete("/users/{username}")
def remove_user(username: str) -> dict:
    delete(username)
    from ..modules.ssh import unlock  # the SSH module reads accounts too

    # Its unlock goes now, as its sessions do.
    unlock.lock(username)
    return {"deleted": username}
