"""Who may call each API route — the one place it is said.

Each account has a level (`users.py`), and each level adds to the ones below: 1 Routing,
2 Docker, 3 Machines, 4 Settings (an admin). Every route below names the level it needs, or
`ANY` (any signed-in account). A route that matches nothing here is admin-only, and
`tests/test_access.py` fails until every route has a line: a new endpoint is never
reachable below admin by accident.

A record's own level depends on what it is — a machine is Machines', a route Routing's — so
the routes that change one also call `require_instance`: by id, and the create endpoints on
the record they find (`assign.assign`'s `acting`).
"""

import re

from fastapi import HTTPException

from .users import ADMIN, DOCKER, LEVEL_NAMES, MACHINES, ROUTING, TAB_LEVEL, User

ANY = 0  # below every level: any signed-in account

# (methods, path, level): the first line that matches decides. "*" is every method.
RULES: list[tuple[str, re.Pattern, int]] = [
    (method, re.compile(path), need)
    for method, path, need in [
        # Every signed-in account: the shell around every tab, and its own password.
        ("GET", r"^/api/health$", ANY),
        ("GET", r"^/api/settings$", ANY),  # secrets left out unless admin (settings.get_view)
        ("GET", r"^/api/launcher$", ANY),
        ("POST", r"^/api/auth/password$", ANY),
        # Admin: Settings, the accounts, the logs, the backup, Loskai's own key, the AdGuard reset.
        ("*", r"^/api/settings$", ADMIN),
        ("*", r"^/api/users(/[^/]+)?$", ADMIN),
        ("GET", r"^/api/auth/logins$", ADMIN),
        ("GET", r"^/api/export$", ADMIN),
        ("POST", r"^/api/adguard/rewrites/clear$", ADMIN),
        ("POST", r"^/api/ssh/key$", ADMIN),
        ("GET", r"^/api/ssh/log$", ADMIN),
        # Routing. Its page lists containers (a route's source) and clears orphaned routes.
        ("GET", r"^/api/docker/containers$", ROUTING),
        ("*", r"^/api/docker/orphans(/[^/]+)?$", ROUTING),
        ("GET", r"^/api/caddy/routes$", ROUTING),
        ("GET", r"^/api/adguard/(status|rewrites)$", ROUTING),
        ("POST", r"^/api/(caddy/push|adguard/reconcile|routes)$", ROUTING),
        ("DELETE", r"^/api/assign/[^/]+$", ROUTING),
        ("*", r"^/api/instances/[^/]+/icon$", ROUTING),  # and require_instance
        ("*", r"^/api/instances/[^/]+$", ROUTING),  # and require_instance
        # Docker.
        ("*", r"^/api/docker/.*$", DOCKER),
        # Machines.
        ("POST", r"^/api/machines$", MACHINES),
        ("*", r"^/api/ssh(/.*)?$", MACHINES),
    ]
]


def rule_for(method: str, path: str) -> int | None:
    """The level `method path` needs — None when no line says, which means admin-only."""
    for m, pattern, need in RULES:
        if (m == "*" or m == method) and pattern.match(path):
            return need
    return None


def allows(user: User, need: int | None) -> bool:
    return user.level >= (ADMIN if need is None else need)


def refusal(need: int | None) -> str:
    """Why an account was refused, in words."""
    if need is None or need == ADMIN:
        return "Only an admin can do that"
    return f"That needs level {need}, {LEVEL_NAMES[need]}"


def require_tab(user: User | None, tab: str) -> None:
    """For a check a route makes itself — a terminal WebSocket, a record's own level."""
    if user is None or not user.may(tab):
        raise HTTPException(status_code=403, detail=refusal(TAB_LEVEL[tab]))


def require_instance(user: User | None, kind: str | None) -> None:
    """A record changed by id: a machine is the Machines level's, anything else Routing's."""
    require_tab(user, "machines" if kind == "machine" else "routing")
