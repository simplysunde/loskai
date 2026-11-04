"""Who may call each API route — the one place it is said.

An admin may call everything. An operator may call what belongs to the tabs it was given
(`users.TABS`): every route below names `ANY` (any signed-in account), `ADMIN`, or the tabs
whose pages use it — any one of them is enough. A route that matches nothing here is
admin-only, and `tests/test_access.py` fails until every route has a line: a new endpoint
is never reachable by an operator by accident.

Routes are Routing's: the install wizard's route step and a machine's Add route need the
Routing tab too. A record's own tab depends on what it is — a machine is Machines', a route
Routing's — so the routes that change one also call `require_instance`: by id, and the
create endpoints on the record they find (`assign.assign`'s `acting`).
"""

import re

from fastapi import HTTPException

from .users import User

ANY = "any"
ADMIN = "admin"
Need = str | tuple[str, ...]

# (methods, path, who): the first line that matches decides. "*" is every method.
RULES: list[tuple[str, re.Pattern, Need]] = [
    (method, re.compile(path), need)
    for method, path, need in [
        # Every signed-in account: the shell around every tab, and its own password.
        ("GET", r"^/api/health$", ANY),
        ("GET", r"^/api/settings$", ANY),  # secrets left out unless admin (settings.get_view)
        ("GET", r"^/api/launcher$", ANY),
        ("POST", r"^/api/auth/password$", ANY),
        # Admin: Settings, the accounts, the backup, Loskai's own key, the AdGuard reset.
        ("*", r"^/api/settings$", ADMIN),
        ("*", r"^/api/users(/[^/]+)?$", ADMIN),
        ("GET", r"^/api/export$", ADMIN),
        ("POST", r"^/api/adguard/rewrites/clear$", ADMIN),
        ("POST", r"^/api/ssh/key$", ADMIN),
        # Routing. Its page lists containers (a route's source) and clears orphaned routes.
        ("GET", r"^/api/docker/containers$", ("docker", "routing")),
        ("*", r"^/api/docker/orphans(/[^/]+)?$", ("routing",)),
        ("GET", r"^/api/caddy/routes$", ("routing", "machines")),
        ("GET", r"^/api/adguard/(status|rewrites)$", ("routing", "machines")),
        ("POST", r"^/api/(caddy/push|adguard/reconcile|routes)$", ("routing",)),
        ("DELETE", r"^/api/assign/[^/]+$", ("routing",)),
        ("*", r"^/api/instances/[^/]+/icon$", ("routing",)),
        ("*", r"^/api/instances/[^/]+$", ("routing", "machines")),  # and require_instance
        # Docker.
        ("*", r"^/api/docker/.*$", ("docker",)),
        # Machines.
        ("POST", r"^/api/machines$", ("machines",)),
        ("*", r"^/api/ssh(/.*)?$", ("machines",)),
    ]
]

TAB_NAMES = {"docker": "Docker", "routing": "Routing", "machines": "Machines"}


def rule_for(method: str, path: str) -> Need | None:
    """Who may call `method path` — None when no line says, which means admin-only."""
    for m, pattern, need in RULES:
        if (m == "*" or m == method) and pattern.match(path):
            return need
    return None


def allows(user: User, need: Need | None) -> bool:
    if user.admin:
        return True
    if need is None or need == ADMIN:
        return False
    if need == ANY:
        return True
    return any(user.may(tab) for tab in need)


def refusal(need: Need | None) -> str:
    """Why an operator was refused, in words."""
    if need is None or need == ADMIN:
        return "Only an admin can do that"
    names = " or ".join(TAB_NAMES[t] for t in need if isinstance(need, tuple))
    return f"Your account doesn't have the {names} tab"


def require_tab(user: User | None, tab: str) -> None:
    """For a check a route makes itself — a terminal WebSocket, a record's own tab."""
    if user is None or not user.may(tab):
        raise HTTPException(status_code=403, detail=refusal((tab,)))


def require_instance(user: User | None, kind: str | None) -> None:
    """A record changed by id: a machine is the Machines tab's, anything else Routing's."""
    require_tab(user, "machines" if kind == "machine" else "routing")
