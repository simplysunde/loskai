"""Tier-2: Caddy client contract — request shapes + designed edges, HTTP mocked.

Mocks the Admin API responses from docs/reference/caddy-api.md and asserts the *requests* the
client builds. Never tests httpx itself.
"""

import json

import httpx
import pytest

from loskai.modules.caddy.client import CaddyClient, CaddyError

BASE = "http://caddy.test:2019"


def _client() -> CaddyClient:
    return CaddyClient(base_url=BASE)


async def test_server_name_discovered_not_hardcoded(httpx_mock):
    httpx_mock.add_response(
        method="GET", url=f"{BASE}/config/apps/http/servers", json={"srv0": {}}
    )
    assert await _client().server_name() == "srv0"


async def test_push_route_puts_to_discovered_server_with_id(httpx_mock):
    client = _client()
    client._server_name = "srv0"  # skip discovery for an isolated assertion
    httpx_mock.add_response(
        method="PUT", url=f"{BASE}/config/apps/http/servers/srv0/routes/0"
    )
    route = {"@id": "grafana", "match": [{"host": ["grafana.example.no"]}]}
    await client.push_route(route)

    sent = httpx_mock.get_requests()[0]
    assert sent.method == "PUT"
    assert json.loads(sent.read())["@id"] == "grafana"


async def test_push_route_inserts_at_head_not_appends(httpx_mock):
    """The bootstrap Caddyfile's wildcard `*.{$BASE_DOMAIN}` block is a terminal,
    handler-less route sitting first in the array, so an appended route is shadowed and
    Caddy answers its empty 200 instead of proxying (found by the 2026-09-05 live smoke).
    Index 0 is the whole fix — pin the path, not just the verb."""
    client = _client()
    client._server_name = "srv0"
    httpx_mock.add_response(
        method="PUT", url=f"{BASE}/config/apps/http/servers/srv0/routes/0"
    )
    await client.push_route({"@id": "grafana"})

    assert httpx_mock.get_requests()[0].url.path.endswith("/routes/0")


async def test_local_ca_reads_the_internal_authority(httpx_mock):
    """`/pki/ca/local` is the only cert-material call. Pin the path — the CA id is
    Caddy's, not ours, and `local` is what `tls internal` issues from."""
    httpx_mock.add_response(
        method="GET",
        url=f"{BASE}/pki/ca/local",
        json={"id": "local", "root_certificate": "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----"},
    )
    ca = await _client().local_ca()

    assert httpx_mock.get_requests()[0].url.path == "/pki/ca/local"
    assert ca["id"] == "local"


async def test_delete_route_ignores_404(httpx_mock):
    httpx_mock.add_response(method="DELETE", url=f"{BASE}/id/grafana", status_code=404)
    await _client().delete_route("grafana")  # must not raise


async def test_delete_route_raises_on_500(httpx_mock):
    httpx_mock.add_response(method="DELETE", url=f"{BASE}/id/grafana", status_code=500)
    with pytest.raises(httpx.HTTPStatusError):
        await _client().delete_route("grafana")


async def test_health_healthy(httpx_mock):
    httpx_mock.add_response(
        method="GET", url=f"{BASE}/config/apps/http/servers", json={"srv0": {}}
    )
    result = await _client().health()
    assert result == {"status": "healthy", "server": "srv0"}


async def test_health_unreachable(httpx_mock):
    httpx_mock.add_exception(
        httpx.ConnectError("connection refused"),
        method="GET",
        url=f"{BASE}/config/apps/http/servers",
    )
    result = await _client().health()
    assert result["status"] == "unreachable"


def test_health_unconfigured_without_base():
    # No explicit base and no setting -> unconfigured, no HTTP attempted.
    import asyncio

    from loskai import config

    config.settings.caddy_admin_url = None
    assert asyncio.run(CaddyClient().health()) == {"status": "unconfigured"}


async def test_http_server_is_discovered_separately_from_the_routing_one(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url=f"{BASE}/config/apps/http/servers",
        json={"srv0": {"listen": [":443"]}, "srv1": {"listen": [":80"]}},
    )
    client = _client()

    assert await client.http_server_name() == "srv1"


async def test_push_http_route_inserts_at_head_of_the_80_server(httpx_mock):
    """Index 0 again, for two reasons this time: the `:80` server's cert-setup site ends in
    a catch-all `handle` (an appended route is never reached), and Caddy's automatic
    HTTP→HTTPS redirect routes live there and would otherwise win over a plain-HTTP route."""
    client = _client()
    client._http_server_name = "srv1"
    httpx_mock.add_response(
        method="PUT", url=f"{BASE}/config/apps/http/servers/srv1/routes/0"
    )

    await client.push_route({"@id": "tv-http"}, http=True)

    sent = httpx_mock.get_requests()[-1]
    assert sent.method == "PUT"
    assert str(sent.url).endswith("/servers/srv1/routes/0")
    assert json.loads(sent.read())["@id"] == "tv-http"


async def test_push_http_route_without_an_80_server_raises(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url=f"{BASE}/config/apps/http/servers",
        json={"srv0": {"listen": [":443"]}},
    )
    client = _client()

    with pytest.raises(CaddyError):
        await client.push_route({"@id": "tv-http"}, http=True)
