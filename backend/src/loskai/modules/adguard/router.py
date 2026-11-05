"""AdGuard module HTTP surface — status + reconcile.

The module health payload is served through the aggregate /api/health, not a route of
its own, and rewrites are written only by the assign flow and reconcile — never
directly over HTTP (see docs/project/architecture.md: the AdGuard module is read + push only). The one exception
is the explicit reset, /rewrites/clear, which deletes every rewrite (hand-added ones
included) and reconciles Loskai's own back; it writes nothing of its own choosing."""

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
    base, current_ip = settings_store.dns_context()
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
    base, current_ip = settings_store.dns_context()
    return await service.get_status(adguard, base, current_ip)


@router.get("/rewrites")
async def rewrites() -> dict:
    """Every rewrite AdGuard holds, each flagged `managed` (Loskai would write it back).
    Read-only; it backs the clear dialog's list of what is about to be removed."""
    base, current_ip = settings_store.dns_context()
    try:
        return await service.list_rewrites(adguard, base, current_ip)
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))


@router.post("/rewrites/clear")
async def clear_rewrites() -> dict:
    """Wipe every rewrite AdGuard holds, then reconcile Loskai's back in. Destructive and
    user-initiated only — see `service.clear_and_restore`."""
    base, current_ip = settings_store.dns_context()
    try:
        return await service.clear_and_restore(adguard, base, current_ip)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))


@router.post("/reconcile")
async def reconcile() -> dict:
    base, current_ip = settings_store.dns_context()
    try:
        return await service.reconcile(adguard, base, current_ip)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))
