"""AdGuard Home REST client — thin HTTP I/O only (see docs/reference/adguard-api.md).

Loskai touches exactly one feature area — DNS rewrites — plus a status probe. All
reconcile decision logic lives in `service.py`; this file only talks to `/control`.
Auth is per-request HTTP Basic (no session flow).
"""

import httpx

from ...shared import settings as settings_store
from ...shared.errors import describe_error

_TIMEOUT = 5.0


class AdGuardError(Exception):
    """AdGuard reachable but responded in a way we can't use."""


class AdGuardClient:
    def __init__(
        self,
        base_url: str | None = None,
        user: str | None = None,
        password: str | None = None,
    ) -> None:
        self._explicit_base = base_url
        self._explicit_user = user
        self._explicit_password = password

    def base_url(self) -> str | None:
        return self._explicit_base or settings_store.value("adguard_url")

    def _auth(self) -> tuple[str, str] | None:
        user = self._explicit_user or settings_store.value("adguard_user")
        if not user:
            return None
        password = self._explicit_password or settings_store.value("adguard_password") or ""
        return (user, password)

    def _client(self) -> httpx.AsyncClient:
        base = self.base_url()
        if not base:
            raise AdGuardError("adguard_url is not configured")
        return httpx.AsyncClient(base_url=base, auth=self._auth(), timeout=_TIMEOUT)

    async def list_rewrites(self) -> list[dict]:
        async with self._client() as c:
            r = await c.get("/control/rewrite/list")
            r.raise_for_status()
            return r.json() or []

    async def add_rewrite(self, domain: str, answer: str) -> None:
        async with self._client() as c:
            r = await c.post(
                "/control/rewrite/add", json={"domain": domain, "answer": answer}
            )
            r.raise_for_status()

    async def delete_rewrite(self, domain: str, answer: str) -> None:
        """POST /control/rewrite/delete with the whole (domain, answer) entry — AdGuard
        has no delete-by-domain, and the exact pair is what protects hand-added entries."""
        async with self._client() as c:
            r = await c.post(
                "/control/rewrite/delete", json={"domain": domain, "answer": answer}
            )
            r.raise_for_status()

    async def health(self) -> dict:
        """GET /control/status — a 200 with running:true is the reachable signal."""
        if not self.base_url():
            return {"status": "unconfigured"}
        try:
            async with self._client() as c:
                r = await c.get("/control/status")
                r.raise_for_status()
                status = r.json() or {}
        except (httpx.HTTPError, AdGuardError) as exc:
            return {"status": "unreachable", "detail": describe_error(exc)}
        running = status.get("running", True)
        return {
            "status": "healthy" if running else "degraded",
            "running": running,
            "version": status.get("version"),
        }


# Process-wide singleton used by the router.
adguard = AdGuardClient()
