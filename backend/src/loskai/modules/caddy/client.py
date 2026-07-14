"""Caddy Admin API client — thin HTTP I/O only.

Every method does nothing but talk to the API in `docs/caddy-api.md`; all decision
logic (route JSON, mode, Caddyfile render, sync join) lives in `service.py`. This is
the hard I/O seam that keeps that logic testable without a network.
"""

import httpx

from ...shared import settings as settings_store

_TIMEOUT = 5.0


class CaddyError(Exception):
    """Caddy reachable but responded in a way we can't use (e.g. no HTTP server)."""


def describe_error(exc: Exception) -> str:
    """Human-readable message — some httpx errors (ConnectError) stringify empty."""
    return str(exc) or exc.__class__.__name__


class CaddyClient:
    def __init__(self, base_url: str | None = None) -> None:
        # base_url None -> resolve from settings at call time (may change via the UI).
        self._explicit_base = base_url
        self._server_name: str | None = None

    def base_url(self) -> str | None:
        return self._explicit_base or settings_store.value("caddy_admin_url")

    def _client(self) -> httpx.AsyncClient:
        base = self.base_url()
        if not base:
            raise CaddyError("caddy_admin_url is not configured")
        return httpx.AsyncClient(base_url=base, timeout=_TIMEOUT)

    async def server_name(self) -> str:
        """Discover (and cache) the single HTTP server key — never hardcode srv0."""
        if self._server_name:
            return self._server_name
        async with self._client() as c:
            r = await c.get("/config/apps/http/servers")
            r.raise_for_status()
            servers = r.json() or {}
        if not servers:
            raise CaddyError("Caddy has no HTTP servers configured")
        self._server_name = next(iter(servers))
        return self._server_name

    async def list_live_routes(self) -> list[dict]:
        server = await self.server_name()
        async with self._client() as c:
            r = await c.get(f"/config/apps/http/servers/{server}/routes")
            r.raise_for_status()
            return r.json() or []

    async def push_route(self, route: dict) -> None:
        """POST a route object (built by service.build_route) — appends by @id."""
        server = await self.server_name()
        async with self._client() as c:
            r = await c.post(f"/config/apps/http/servers/{server}/routes", json=route)
            r.raise_for_status()

    async def delete_route(self, route_id: str) -> None:
        """DELETE /id/<id>. A 404 is ignored — the route may not be pushed yet."""
        async with self._client() as c:
            r = await c.delete(f"/id/{route_id}")
            if r.status_code == 404:
                return
            r.raise_for_status()

    async def upstreams(self) -> list[dict]:
        async with self._client() as c:
            r = await c.get("/reverse_proxy/upstreams")
            r.raise_for_status()
            return r.json() or []

    async def health(self) -> dict:
        """Reachability + refresh the cached server name. Never raises."""
        if not self.base_url():
            return {"status": "unconfigured"}
        try:
            async with self._client() as c:
                r = await c.get("/config/apps/http/servers")
                r.raise_for_status()
                servers = r.json() or {}
        except (httpx.HTTPError, CaddyError) as exc:
            return {"status": "unreachable", "detail": describe_error(exc)}
        if not servers:
            return {"status": "degraded", "detail": "no HTTP servers configured"}
        self._server_name = next(iter(servers))
        return {"status": "healthy", "server": self._server_name}


# Process-wide singleton so the discovered server name is cached across requests.
caddy = CaddyClient()
