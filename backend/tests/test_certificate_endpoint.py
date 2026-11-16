"""Tier-2: GET /api/caddy/root-certificate through the real HTTP path.

Two things this pins that a unit test can't: the route really is **public** (it is the
one cert surface a not-yet-trusting, not-logged-in device has to reach), and the "no
internal CA" case is a 409 rather than an upstream failure — an ACME deployment has
nothing to hand out, which is a normal state, not a broken Caddy.
"""

import httpx
from fastapi.testclient import TestClient

from loskai.main import app
from loskai.modules.caddy import router as caddy_router
from loskai.modules.caddy.client import CaddyError

ROOT_PEM = "-----BEGIN CERTIFICATE-----\nMIIBozCCAUmg\n-----END CERTIFICATE-----"


class FakeCaddy:
    """Stands in for the client singleton — the router's own error mapping is what's
    under test, so the HTTP layer is replaced rather than mocked."""

    def __init__(self, result):
        self._result = result

    async def local_ca(self) -> dict:
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


def _serve(monkeypatch, result):
    monkeypatch.setattr(caddy_router, "caddy", FakeCaddy(result))


def test_root_certificate_needs_no_session(monkeypatch):
    """The whole point: a device that doesn't trust the cert yet, and has no admin
    password, still gets the root. Never gate this behind the session middleware."""
    _serve(monkeypatch, {"root_certificate": ROOT_PEM, "root_common_name": "Caddy Local"})

    with TestClient(app) as client:
        client.post("/api/auth/setup", json={"username": "admin", "password": "smoke-test-password"})
        r = client.get("/api/caddy/root-certificate")  # no login

    assert r.status_code == 200, r.text
    assert r.json()["pem"].startswith("-----BEGIN CERTIFICATE-----")
    assert r.json()["filename"] == "caddy-root.crt"


def test_no_internal_ca_is_409_not_502(monkeypatch):
    """Caddy 404s `/pki/ca/local` when it isn't running an internal CA (public ACME).
    That's a deployment choice, so the page can say 'nothing to install' instead of
    reporting Caddy as broken."""
    request = httpx.Request("GET", "http://caddy.test:2019/pki/ca/local")
    response = httpx.Response(404, request=request)
    _serve(monkeypatch, httpx.HTTPStatusError("404", request=request, response=response))

    with TestClient(app) as client:
        r = client.get("/api/caddy/root-certificate")

    assert r.status_code == 409
    assert "internal CA" in r.json()["detail"]


def test_unreachable_caddy_is_502(monkeypatch):
    _serve(monkeypatch, CaddyError("caddy_admin_url is not configured"))

    with TestClient(app) as client:
        r = client.get("/api/caddy/root-certificate")

    assert r.status_code == 502
    assert "caddy_admin_url" in r.json()["detail"]


def test_dashboard_advertises_the_certificate_tab():
    """The shell decides whether to show the nav link before anyone logs in, so the mode
    rides on the one public payload it already reads."""
    from loskai.shared import settings as settings_store

    with TestClient(app) as client:
        without_caddy = client.get("/api/dashboard").json()
        settings_store.update({"caddy_admin_url": "http://caddy:2019"})
        body = client.get("/api/dashboard").json()

    assert without_caddy["certificate_tab"] == "hidden"  # no Caddy, no certificate to hand out
    assert body["certificate_tab"] == "public"  # the default once there is one


def test_dashboard_carries_the_look_to_anyone():
    """The login page and the public Dashboard wear the look too, so it rides on the one
    public payload, readable before anyone logs in."""
    from loskai.shared import settings as settings_store

    with TestClient(app) as client:
        assert client.get("/api/dashboard").json()["ui_look"] == "simplysunde"
        settings_store.update({"ui_look": "legacy"})
        assert client.get("/api/dashboard").json()["ui_look"] == "legacy"
