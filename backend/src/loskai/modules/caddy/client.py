"""Caddy Admin API client — thin HTTP I/O only.

Every method does nothing but talk to the API in `docs/reference/caddy-api.md`; all decision
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
        self._http_server_name: str | None = None

    def base_url(self) -> str | None:
        return self._explicit_base or settings_store.value("caddy_admin_url")

    def _client(self) -> httpx.AsyncClient:
        base = self.base_url()
        if not base:
            raise CaddyError("caddy_admin_url is not configured")
        return httpx.AsyncClient(base_url=base, timeout=_TIMEOUT)

    async def server_name(self) -> str:
        """Discover (and cache) the routing server key — never hardcode srv0, and never
        the static :80 cert-setup server (see service.select_server_name)."""
        if self._server_name:
            return self._server_name
        async with self._client() as c:
            r = await c.get("/config/apps/http/servers")
            r.raise_for_status()
            servers = r.json() or {}
        from . import service  # lazy: service imports this module (avoid an import cycle)

        self._server_name = service.select_server_name(servers)
        return self._server_name

    async def http_server_name(self) -> str | None:
        """The `:80` server's key, or None if this Caddy has none. Cached like the routing
        server, and discovered the same way — never hardcoded."""
        if self._http_server_name is not None:
            return self._http_server_name or None
        async with self._client() as c:
            r = await c.get("/config/apps/http/servers")
            r.raise_for_status()
            servers = r.json() or {}
        from . import service

        found = service.select_http_server_name(servers)
        self._http_server_name = found or ""  # "" caches "looked, found none"
        return found

    async def list_live_http_routes(self) -> list[dict]:
        """Routes in the `:80` server. `[]` when there is no such server — a deployment
        without one simply cannot serve `scheme: "http"`, which `upsert_route` rejects."""
        server = await self.http_server_name()
        if not server:
            return []
        async with self._client() as c:
            r = await c.get(f"/config/apps/http/servers/{server}/routes")
            r.raise_for_status()
            return r.json() or []

    async def push_http_route(self, route: dict) -> None:
        """Insert into the **`:80`** server, at the head, for the same reason as `:443` and
        one more: that server's cert-setup site ends in a catch-all `handle`, so an appended
        route is never reached, and Caddy's automatic HTTP→HTTPS redirect routes live there
        too and would otherwise win over a plain-HTTP route."""
        server = await self.http_server_name()
        if not server:
            raise CaddyError(
                "Caddy has no :80 server — a plain-HTTP route has nowhere to go"
            )
        async with self._client() as c:
            r = await c.put(f"/config/apps/http/servers/{server}/routes/0", json=route)
            r.raise_for_status()

    async def list_live_routes(self) -> list[dict]:
        server = await self.server_name()
        async with self._client() as c:
            r = await c.get(f"/config/apps/http/servers/{server}/routes")
            r.raise_for_status()
            return r.json() or []

    async def push_route(self, route: dict) -> None:
        """Insert a route object (built by service.build_route) at the **head** of the
        server's routes array.

        Not an append. The bootstrap Caddyfile's `*.{$BASE_DOMAIN}` block — which exists
        only to make Caddy issue the wildcard cert — compiles to a handler-less route with
        `"terminal": true`, and the Caddyfile adapter puts it first. It matches every name
        Loskai routes, so an appended route is never reached: Caddy answers the wildcard's
        empty 200 instead of proxying. That fails as a *success*, which is why unit and
        contract tests never saw it and the 2026-09-05 live smoke did.

        `PUT .../routes/0` inserts ahead of it (and is a plain insert on an empty array).
        Ordering among Loskai's own routes stays irrelevant — those match single specific
        hosts and really are disjoint from each other.
        """
        server = await self.server_name()
        async with self._client() as c:
            r = await c.put(f"/config/apps/http/servers/{server}/routes/0", json=route)
            r.raise_for_status()

    async def delete_route(self, route_id: str) -> None:
        """DELETE /id/<id>. A 404 is ignored — the route may not be pushed yet."""
        async with self._client() as c:
            r = await c.delete(f"/id/{route_id}")
            if r.status_code == 404:
                return
            r.raise_for_status()

    async def local_ca(self) -> dict:
        """`GET /pki/ca/local` — Caddy's internal certificate authority (the one
        `local_certs` / `tls internal` issues from).

        The only cert-material call Loskai makes, and it is deliberately narrow: the
        response carries the CA's **public** root and intermediate PEMs, never a key. A
        404 means this Caddy has no internal CA at all — a public-ACME deployment — which
        the router turns into a 409 rather than an upstream error.
        """
        async with self._client() as c:
            r = await c.get("/pki/ca/local")
            r.raise_for_status()
            return r.json() or {}

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
        from . import service  # lazy: avoid an import cycle (service imports this module)

        self._server_name = service.select_server_name(servers)
        return {"status": "healthy", "server": self._server_name}


# Process-wide singleton so the discovered server name is cached across requests.
caddy = CaddyClient()
