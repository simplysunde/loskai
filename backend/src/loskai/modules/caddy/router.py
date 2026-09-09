"""Caddy module HTTP surface — read + push only (never assigns a route itself)."""

import httpx
from fastapi import APIRouter, HTTPException

from ...shared import health as health_registry
from ...shared import settings as settings_store
from . import service
from .client import CaddyError, caddy, describe_error

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


@router.get("/root-certificate")
async def root_certificate() -> dict:
    """The internal CA's root, for a LAN device to install once. **Public** — see
    `shared/auth.PUBLIC_ROUTES`.

    Unauthenticated on purpose: this is a public certificate, handed to every device that
    wants to trust `*.BASE_DOMAIN`, and the page offering it has to be reachable by
    someone who is not a Loskai admin. It contains no key material, and the settings key
    `certificate_tab` governs where the page is *advertised*, not who may fetch this.
    """
    try:
        ca = await caddy.local_ca()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Caddy has no internal CA — this deployment isn't using `tls internal`, "
                    "so there is no root to install (public certs are trusted already)"
                ),
            )
        raise HTTPException(status_code=502, detail=describe_error(exc))
    except (httpx.HTTPError, CaddyError) as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))

    cert = service.root_certificate(ca)
    if cert is None:
        raise HTTPException(
            status_code=409,
            detail="Caddy's internal CA returned no root certificate yet",
        )
    return cert
