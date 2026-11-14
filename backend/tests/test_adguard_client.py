"""Tier-2: AdGuard client contract — exact-pair delete body, Basic Auth, parsing."""

import base64
import json

import httpx

from loskai.modules.adguard.client import AdGuardClient

BASE_URL = "http://adguard.test:3000"


def _client() -> AdGuardClient:
    return AdGuardClient(base_url=BASE_URL, user="admin", password="secret")


async def test_health_running(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url=f"{BASE_URL}/control/status",
        json={"running": True, "version": "v0.107"},
    )
    result = await _client().health()
    assert result["status"] == "healthy"
    assert result["version"] == "v0.107"


async def test_health_not_running_is_degraded(httpx_mock):
    httpx_mock.add_response(
        method="GET", url=f"{BASE_URL}/control/status", json={"running": False}
    )
    assert (await _client().health())["status"] == "degraded"


async def test_list_rewrites_parsed(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url=f"{BASE_URL}/control/rewrite/list",
        json=[{"domain": "grafana.example.no", "answer": "192.168.10.101"}],
    )
    rewrites = await _client().list_rewrites()
    assert rewrites[0]["domain"] == "grafana.example.no"


async def test_add_rewrite_sends_domain_and_answer(httpx_mock):
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/control/rewrite/add")
    await _client().add_rewrite("grafana.example.no", "192.168.10.101")
    body = json.loads(httpx_mock.get_requests()[0].read())
    assert body == {"domain": "grafana.example.no", "answer": "192.168.10.101"}


async def test_delete_posts_exact_pair(httpx_mock):
    # AdGuard deletes via POST to /rewrite/delete with the whole entry (no delete-by-domain).
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/control/rewrite/delete")
    await _client().delete_rewrite("grafana.example.no", "192.168.10.101")
    sent = httpx_mock.get_requests()[0]
    assert sent.url.path == "/control/rewrite/delete"
    assert json.loads(sent.read()) == {
        "domain": "grafana.example.no",
        "answer": "192.168.10.101",
    }


async def test_basic_auth_header_sent(httpx_mock):
    httpx_mock.add_response(method="GET", url=f"{BASE_URL}/control/rewrite/list", json=[])
    await _client().list_rewrites()
    auth = httpx_mock.get_requests()[0].headers["Authorization"]
    assert auth == "Basic " + base64.b64encode(b"admin:secret").decode()


async def test_health_unreachable(httpx_mock):
    httpx_mock.add_exception(
        httpx.ConnectError("refused"), method="GET", url=f"{BASE_URL}/control/status"
    )
    assert (await _client().health())["status"] == "unreachable"


def test_health_unconfigured_without_base():
    import asyncio

    from loskai import config

    config.settings.adguard_url = None
    assert asyncio.run(AdGuardClient().health()) == {"status": "unconfigured"}
