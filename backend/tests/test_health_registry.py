"""Tier-1: the health aggregate's containment.

A module going wrong may only grey out its own card. The registry is module-global and
populated at import by every module router, so each test installs its own checkers.
"""

import asyncio

import pytest

from loskai.shared import health


@pytest.fixture(autouse=True)
def isolated_registry(monkeypatch):
    monkeypatch.setattr(health, "_checkers", {})
    monkeypatch.setattr(health, "_consistency", None)


async def _healthy() -> dict:
    return {"status": "healthy"}


async def test_one_raising_module_does_not_sink_the_others():
    async def boom() -> dict:
        raise RuntimeError("adguard exploded")

    for name in ("caddy", "wireguard", "docker"):
        health.register(name, _healthy)
    health.register("adguard", boom)

    result = await health.health()

    assert result["adguard"]["status"] == "unreachable"
    assert "adguard exploded" in result["adguard"]["detail"]
    for name in ("caddy", "wireguard", "docker"):
        assert result[name]["status"] == "healthy"


async def test_empty_error_message_still_names_the_exception():
    # httpx.ConnectError and friends stringify empty — a bare "" detail is useless.
    async def boom() -> dict:
        raise TimeoutError()

    health.register("caddy", boom)
    result = await health.health()
    assert result["caddy"] == {"status": "unreachable", "detail": "TimeoutError"}


async def test_unregistered_module_reports_unconfigured():
    result = await health.health()
    assert result["caddy"] == {"status": "unconfigured", "detail": "no health check registered"}
    assert result["docker"]["status"] == "unconfigured"  # + stacks_dir_ok


async def test_raising_consistency_hook_still_returns_module_statuses():
    async def boom() -> list[dict]:
        raise RuntimeError("drift check exploded")

    health.register("caddy", _healthy)
    health.register_consistency(boom)

    result = await health.health()

    assert result["consistency"] == []
    assert result["caddy"]["status"] == "healthy"


async def test_modules_are_polled_concurrently():
    """Each checker waits for the other to start, so four sequential awaits deadlock —
    one slow service must not delay every other module's status."""
    caddy_started = asyncio.Event()
    adguard_started = asyncio.Event()

    async def caddy() -> dict:
        caddy_started.set()
        await adguard_started.wait()
        return {"status": "healthy"}

    async def adguard() -> dict:
        adguard_started.set()
        await caddy_started.wait()
        return {"status": "healthy"}

    health.register("caddy", caddy)
    health.register("adguard", adguard)

    result = await asyncio.wait_for(health.health(), timeout=5)

    assert result["caddy"]["status"] == "healthy"
    assert result["adguard"]["status"] == "healthy"
