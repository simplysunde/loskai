"""Tier-1: the config export snapshot — instances always present, AdGuard rewrites
best-effort (null + warning when unreachable, never raising)."""

import httpx
import pytest

from loskai import config
from loskai.shared import export
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))


async def test_export_includes_instances_and_rewrites(monkeypatch):
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="external",
                 subdomain="grafana", upstream="10.0.0.5:3000")
    )
    rewrites = [{"domain": "grafana.example.no", "answer": "192.168.10.101"}]

    async def fake_list():
        return rewrites

    monkeypatch.setattr(export.adguard, "list_rewrites", fake_list)

    snap = await export.export_snapshot()

    assert snap["schema_version"] == export.SCHEMA_VERSION
    assert snap["warning"] is None
    assert snap["adguard_rewrites"] == rewrites
    assert [i["id"] for i in snap["instances"]] == ["grafana"]


async def test_export_degrades_when_adguard_unreachable(monkeypatch):
    async def fake_list():
        raise httpx.ConnectError("adguard down")

    monkeypatch.setattr(export.adguard, "list_rewrites", fake_list)

    snap = await export.export_snapshot()

    assert snap["adguard_rewrites"] is None
    assert snap["warning"] and "AdGuard" in snap["warning"]
    assert snap["instances"] == []
