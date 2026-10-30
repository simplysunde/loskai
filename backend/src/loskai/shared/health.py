"""Aggregate health — GET /api/health.

Each module's router registers its own async health check at import; a module with no
registered checker reports `unconfigured`. A single module going unreachable never
affects the others. Docker additionally carries `stacks_dir_ok` so the UI can tell a
broken compose mount apart from a genuinely empty Stack Manager.
"""

import asyncio
import logging
import os
from typing import Awaitable, Callable, Literal

from fastapi import APIRouter

from ..config import settings as env

logger = logging.getLogger(__name__)

HealthStatus = Literal["healthy", "degraded", "unreachable", "unconfigured"]

MODULES = ["caddy", "adguard", "wireguard", "docker"]

# Module name -> async checker returning at least {"status": HealthStatus}.
# Populated by each module's router at import time.
_checkers: dict[str, Callable[[], Awaitable[dict]]] = {}

# Optional cross-module consistency check (registered by the AdGuard router). Kept as a
# hook so this shared module never imports a module — it must be self-degrading (return
# [] rather than raise when it can't determine drift).
_consistency: Callable[[], Awaitable[list[dict]]] | None = None


def register(name: str, checker: Callable[[], Awaitable[dict]]) -> None:
    _checkers[name] = checker


def register_consistency(checker: Callable[[], Awaitable[list[dict]]]) -> None:
    global _consistency
    _consistency = checker


router = APIRouter(prefix="/api", tags=["health"])


async def _probe(name: str) -> dict:
    """One module's status, never raising — a module that blows up reports itself
    unreachable instead of 500ing the whole endpoint and greying out all four cards."""
    checker = _checkers.get(name)
    if checker is None:
        # Defensive: main.py imports every module router, so every name in MODULES has a
        # checker by the time a request lands here.
        return {"status": "unconfigured", "detail": "no health check registered"}
    try:
        return await checker()
    except Exception as exc:  # containment is the point — any error, not a known set
        logger.warning("%s health check raised: %s", name, exc, exc_info=True)
        # Same fallback message shape the module clients use (str() of an httpx
        # ConnectError is empty).
        return {"status": "unreachable", "detail": str(exc) or exc.__class__.__name__}


async def _drift() -> list[dict]:
    """Cross-module drift, never raising — the hook is documented as self-degrading, and
    a raising one must not take the four module statuses down with it."""
    if _consistency is None:
        return []
    try:
        return await _consistency()
    except Exception as exc:  # containment is the point — any error, not a known set
        logger.warning("consistency check raised: %s", exc, exc_info=True)
        return []


@router.get("/health")
async def health() -> dict:
    # Polled concurrently: four sequential awaits mean one slow service delays every
    # other module's status.
    payloads = await asyncio.gather(*(_probe(name) for name in MODULES))
    # Values are heterogeneous: a status dict per module, plus a `consistency` list — so
    # the response type stays a bare dict (a stricter `dict[str, dict]` rejects the list).
    result: dict = dict(zip(MODULES, payloads))
    result["docker"]["stacks_dir_ok"] = os.path.isdir(env.stacks_dir)
    result["consistency"] = await _drift()
    return result
