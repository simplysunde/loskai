"""AdGuard module HTTP surface — health, rewrites (list/add/delete), status, reconcile."""

import httpx
from fastapi import APIRouter, Body, HTTPException

from ...shared import health as health_registry
from ...shared import settings as settings_store
from . import service
from .client import AdGuardError, adguard, describe_error

# AdGuard reachable-but-failed / unreachable -> 502, not a bare 500.
_UNREACHABLE = (AdGuardError, httpx.HTTPError)

router = APIRouter(prefix="/api/adguard", tags=["adguard"])


async def _health_payload() -> dict:
    payload = await adguard.health()
    payload["answer_ip"] = settings_store.derive_caddy_host_ip()
    return payload


# Register with the aggregate /api/health poller (import-time side effect).
health_registry.register("adguard", _health_payload)


@router.get("/health")
async def health() -> dict:
    return await _health_payload()


@router.get("/rewrites")
async def rewrites() -> list[dict]:
    try:
        return await adguard.list_rewrites()
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))


@router.post("/rewrites")
async def add_rewrite(payload: dict = Body(...)) -> dict:
    domain, answer = payload.get("domain"), payload.get("answer")
    if not domain or not answer:
        raise HTTPException(status_code=422, detail="domain and answer are required")
    try:
        await adguard.add_rewrite(domain, answer)
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))
    return {"status": "ok"}


@router.delete("/rewrites")
async def delete_rewrite(payload: dict = Body(...)) -> dict:
    domain, answer = payload.get("domain"), payload.get("answer")
    if not domain or not answer:
        raise HTTPException(status_code=422, detail="domain and answer are required")
    try:
        await adguard.delete_rewrite(domain, answer)
    except _UNREACHABLE as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))
    return {"status": "ok"}


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
