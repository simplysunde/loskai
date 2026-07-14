"""Tier-2: WireGuard reachability — any HTTP response = reachable, only conn-fail = down."""

import httpx

from loskai.modules.wireguard.client import WireGuardClient

URL = "http://192.168.10.102:51821"


async def test_200_is_reachable(httpx_mock):
    httpx_mock.add_response(url=URL, status_code=200)
    result = await WireGuardClient(base_url=URL).health()
    assert result == {"status": "healthy", "reachable": True, "url": URL}


async def test_401_is_still_reachable(httpx_mock):
    # An auth-protected dashboard returning 401 is up — the key behavior.
    httpx_mock.add_response(url=URL, status_code=401)
    result = await WireGuardClient(base_url=URL).health()
    assert result["reachable"] is True
    assert result["status"] == "healthy"


async def test_connection_failure_is_unreachable(httpx_mock):
    httpx_mock.add_exception(httpx.ConnectError("refused"), url=URL)
    result = await WireGuardClient(base_url=URL).health()
    assert result["reachable"] is False
    assert result["status"] == "unreachable"


def test_unconfigured_without_url():
    import asyncio

    from loskai import config

    config.settings.wireguard_dashboard_url = None
    result = asyncio.run(WireGuardClient().health())
    assert result == {"status": "unconfigured", "reachable": False, "url": None}
