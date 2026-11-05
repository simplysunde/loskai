"""WireGuard reachability probe — the whole module. No auth, no API, no state.

Loskai does not manage WireGuard; full management stays in wg-easy / wg-dashboard.
This is a pure status card: is the dashboard reachable? **Any HTTP response counts as
reachable** — an auth-protected dashboard returning 401/403 is still up; only a
connection failure or timeout means unreachable.
"""

import httpx

from ...shared import settings as settings_store
from ...shared.errors import describe_error

_TIMEOUT = 5.0


class WireGuardClient:
    def __init__(self, base_url: str | None = None) -> None:
        self._explicit_url = base_url

    def url(self) -> str | None:
        return self._explicit_url or settings_store.value("wireguard_dashboard_url")

    async def health(self) -> dict:
        url = self.url()
        if not url:
            return {"status": "unconfigured", "reachable": False, "url": None}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
                # No raise_for_status: a 401/403 is a response, so it's reachable.
                await c.get(url)
        except httpx.HTTPError as exc:
            return {
                "status": "unreachable",
                "reachable": False,
                "url": url,
                "detail": describe_error(exc),
            }
        return {"status": "healthy", "reachable": True, "url": url}


wireguard = WireGuardClient()
