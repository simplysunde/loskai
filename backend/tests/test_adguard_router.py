"""Tier-2: Sync's AdGuard half, as the router answers it — an AdGuard that can't be reached
says so in words first, then the error — in the answer and the log."""

import httpx
import pytest
from fastapi import HTTPException

from loskai.modules.adguard import router, service


async def test_reconcile_says_adguard_cant_be_reached_and_logs_why(data_dir, monkeypatch, caplog):
    async def unreachable(*_a, **_k):
        raise httpx.ConnectError("[Errno 111] Connection refused")

    monkeypatch.setattr(service, "reconcile", unreachable)
    with caplog.at_level("WARNING"), pytest.raises(HTTPException) as refused:
        await router.reconcile()

    assert refused.value.status_code == 502
    assert refused.value.detail == "AdGuard can't be reached — [Errno 111] Connection refused"
    assert "AdGuard can't be reached — [Errno 111] Connection refused" in caplog.text
