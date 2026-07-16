"""Config export — a plain JSON snapshot for backup / portability.

The instance list is Loskai's own state; the AdGuard rewrites are pulled live and are
best-effort (AdGuard unreachable -> `rewrites: null` + a warning, never a failure),
matching the module-degradation rule. This is read-only: it never writes anywhere.
"""

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter

from ..modules.adguard.client import AdGuardError, adguard, describe_error
from . import instances
from . import settings as settings_store

router = APIRouter(prefix="/api", tags=["export"])

SCHEMA_VERSION = 1


@router.get("/export")
async def export_snapshot() -> dict:
    """A snapshot of the instance list + AdGuard rewrites for backup."""
    warning: str | None = None
    try:
        rewrites: list[dict] | None = await adguard.list_rewrites()
    except (AdGuardError, httpx.HTTPError) as exc:
        rewrites = None  # unreachable -> null, not an error
        warning = f"AdGuard rewrites unavailable: {describe_error(exc)}"

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_domain": settings_store.value("base_domain"),
        "instances": [i.model_dump() for i in instances.list_instances()],
        "adguard_rewrites": rewrites,
        "warning": warning,
    }
