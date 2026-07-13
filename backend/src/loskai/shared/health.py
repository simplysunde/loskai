"""Aggregate health — GET /api/health.

Each module registers its own async health check as it is built (Phases 3–5, 8);
until then a module reports `unconfigured`. A single module going unreachable never
affects the others. Docker additionally carries `stacks_dir_ok` so the UI can tell a
broken compose mount apart from a genuinely empty Stack Manager.
"""

import os
from typing import Awaitable, Callable, Literal

from fastapi import APIRouter

from ..config import settings as env

HealthStatus = Literal["healthy", "degraded", "unreachable", "unconfigured"]

MODULES = ["caddy", "adguard", "wireguard", "docker"]

# Module name -> async checker returning at least {"status": HealthStatus}.
# Populated by each module's router as it is built.
_checkers: dict[str, Callable[[], Awaitable[dict]]] = {}


def register(name: str, checker: Callable[[], Awaitable[dict]]) -> None:
    _checkers[name] = checker


router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for name in MODULES:
        checker = _checkers.get(name)
        if checker is not None:
            result[name] = await checker()
        else:
            result[name] = {
                "status": "unconfigured",
                "detail": "health check wired in a later phase",
            }
    # Cheap and honest even before the Docker module exists.
    result["docker"]["stacks_dir_ok"] = os.path.isdir(env.stacks_dir)
    return result
