"""Caddy module HTTP surface — read + push only (never assigns a route itself)."""

from fastapi import APIRouter, HTTPException, Response

from ...shared import health as health_registry
from ...shared import settings as settings_store
from . import service
from .client import CaddyError, caddy

router = APIRouter(prefix="/api/caddy", tags=["caddy"])


async def _health_payload() -> dict:
    payload = await caddy.health()
    payload["mode"] = service.caddy_mode(settings_store.value("caddy_admin_url"))
    return payload


# Register with the aggregate /api/health poller (import-time side effect).
health_registry.register("caddy", _health_payload)


@router.get("/routes")
async def routes() -> list[dict]:
    base = settings_store.value("base_domain")
    return await service.list_with_sync(caddy, base)


@router.post("/push")
async def push() -> dict:
    base = settings_store.value("base_domain")
    try:
        results = await service.push_all(caddy, base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"pushed": results}


@router.get("/caddyfile")
def caddyfile() -> Response:
    from ...shared import instances as instances_store

    base = settings_store.value("base_domain")
    try:
        text = service.render_caddyfile(instances_store.list_instances(), base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return Response(content=text, media_type="text/plain")


@router.get("/health")
async def health() -> dict:
    return await _health_payload()


@router.get("/upstreams")
async def upstreams() -> list[dict]:
    try:
        return await caddy.upstreams()
    except CaddyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
