"""WireGuard module HTTP surface — a single reachability status endpoint."""

from urllib.parse import urlparse

from fastapi import APIRouter

from ...shared import health as health_registry
from ...shared import settings as settings_store
from .client import wireguard

router = APIRouter(prefix="/api/wireguard", tags=["wireguard"])


def _dns_hint() -> str | None:
    """The AdGuard server IP remote peers should use for DNS (so names resolve through
    AdGuard). Derived from ADGUARD_URL's host; None → the card shows generic guidance."""
    adguard_url = settings_store.value("adguard_url")
    return urlparse(adguard_url).hostname if adguard_url else None


async def _health_payload() -> dict:
    payload = await wireguard.health()
    payload["dns_hint"] = _dns_hint()
    return payload


# Register with the aggregate /api/health poller (import-time side effect).
health_registry.register("wireguard", _health_payload)


@router.get("/status")
async def status() -> dict:
    return await _health_payload()
