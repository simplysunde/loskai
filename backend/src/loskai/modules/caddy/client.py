"""Caddy Admin API client — thin HTTP I/O only.

Every method does nothing but talk to the API in `docs/reference/caddy-api.md`; all decision
logic (route JSON, mode, sync join) lives in `service.py`. This is
the hard I/O seam that keeps that logic testable without a network.
"""

import httpx

from ...shared import settings as settings_store
from ...shared.errors import describe_error

_TIMEOUT = 5.0


class CaddyError(Exception):
    """Caddy reachable but responded in a way we can't use (e.g. no HTTP server)."""


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

    async def _servers(self) -> dict:
        async with self._client() as c:
            r = await c.get("/config/apps/http/servers")
            r.raise_for_status()
            return r.json() or {}

    def _discover(self, servers: dict) -> None:
        """Both server keys from one listing — never hardcode srv0 (`service.select_*`)."""
        from . import service  # lazy: service imports this module (avoid an import cycle)

        self._http_server_name = service.select_http_server_name(servers) or ""  # "" = none
        self._server_name = service.select_server_name(servers) if servers else None

    async def server_name(self) -> str:
        """The routing server's key, cached — never the static :80 cert-setup server.
        Raises when Caddy has no servers at all."""
        if not self._server_name:
            self._discover(await self._servers())
            if not self._server_name:
                raise CaddyError("Caddy has no HTTP servers configured")
        return self._server_name

    async def http_server_name(self) -> str | None:
        """The `:80` server's key, or None if this Caddy has none. Cached like the routing
        server's."""
        if self._http_server_name is None:
            self._discover(await self._servers())
        return self._http_server_name or None

    async def list_live_routes(self, http: bool = False) -> list[dict]:
        """The routes in the routing server — or, `http`, the `:80` one: `[]` when there is
        no such server, since a deployment without one simply cannot serve `scheme:
        "http"`, which `upsert_route` rejects."""
        server = await (self.http_server_name() if http else self.server_name())
        if not server:
            return []
        async with self._client() as c:
            r = await c.get(f"/config/apps/http/servers/{server}/routes")
            r.raise_for_status()
            return r.json() or []

    async def push_route(self, route: dict, http: bool = False) -> None:
        """Insert a route object (built by service.build_route) at the **head** of the
        routing server's routes array — or, `http`, the `:80` server's.

        Not an append. The bootstrap Caddyfile's `*.{$BASE_DOMAIN}` block — which issues the
        wildcard cert and answers names nothing is routed at — compiles to a route with
        `"terminal": true`, and the Caddyfile adapter puts it first. It matches every name
        Loskai routes, so an appended route is never reached: Caddy answers the block's
        "Nothing is routed" page instead of proxying (an empty 200, when the block had no
        handlers). That fails as a *success*, which is why unit and
        contract tests never saw it and the 2026-09-05 live smoke did. The `:80` server
        needs the head for one more reason: its cert-setup site ends in a catch-all
        `handle`, and Caddy's automatic HTTP→HTTPS redirect routes live there too and
        would otherwise win over a plain-HTTP route.

        `PUT .../routes/0` inserts ahead of it (and is a plain insert on an empty array).
        Ordering among Loskai's own routes stays irrelevant — those match single specific
        hosts and really are disjoint from each other.
        """
        server = await (self.http_server_name() if http else self.server_name())
        if not server:
            raise CaddyError("Caddy has no :80 server — a plain-HTTP route has nowhere to go")
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
            servers = await self._servers()
        except (httpx.HTTPError, CaddyError) as exc:
            return {"status": "unreachable", "detail": describe_error(exc)}
        if not servers:
            return {"status": "degraded", "detail": "no HTTP servers configured"}
        self._discover(servers)
        return {"status": "healthy", "server": self._server_name}


# Process-wide singleton so the discovered server name is cached across requests.
caddy = CaddyClient()
