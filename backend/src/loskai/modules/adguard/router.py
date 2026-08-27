"""AdGuard module HTTP surface — status + reconcile.

The module health payload is served through the aggregate /api/health, not a route of
its own, and rewrites are written only by the assign flow and reconcile — never
directly over HTTP (see PLAN: the AdGuard module is read + push only)."""

import httpx
from fastapi import APIRouter, HTTPException

from ...shared import health as health_registry
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from . import service
from .client import AdGuardError, adguard, describe_error

# AdGuard reachable-but-failed / unreachable -> 502, not a bare 500.
_UNREACHABLE = (AdGuardError, httpx.HTTPError)

router = APIRouter(prefix="/api/adguard", tags=["adguard"])


async def _health_payload() -> dict:
    payload = await adguard.health()
    payload["answer_ip"] = settings_store.derive_caddy_host_ip()
    payload["url"] = settings_store.value("adguard_url")  # for the UI link-out
    return payload


# Register with the aggregate /api/health poller (import-time side effect).
health_registry.register("adguard", _health_payload)


async def _consistency() -> list[dict]:
    """DNS drift warnings for /api/health. Self-degrading: AdGuard unreachable -> []."""
    base = settings_store.value("base_domain")
    current_ip = settings_store.derive_caddy_host_ip()
    try:
        rewrites = await adguard.list_rewrites()
    except _UNREACHABLE:
        return []  # can't determine drift while AdGuard is down
    return service.consistency_warnings(
        instances_store.list_routed(), rewrites, base, current_ip
    )


health_registry.register_consistency(_consistency)


@router.get("/status")
async def status() -> dict:
    base = settings_store.value("base_domain")
    current_ip = settings_store.derive_caddy_host_ip()
    return await service.get_status(adguard, base, current_ip)


@router.post("/reconcile")
async def reconcile() -> dict:
    base = settings_store.value("base_domain")
    current_ip = settings_store.derive_caddy_host_ip()
    try:
        return await service.reconcile(adguard, base, current_ip)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))
