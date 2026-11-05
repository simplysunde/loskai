"""Tier-2: the orphaned-instance cleanup endpoint — it must verify the container is
really gone before deleting, so a transient socket read can't purge a live route."""

import pytest
from fastapi import HTTPException

from loskai.modules.docker import router as docker_router
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance


def _link(container):
    # A docker instance with no route (subdomain cleared) — purge is a pure record delete.
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container=container)
    )


async def test_delete_orphan_removes_record_when_container_gone(monkeypatch):
    _link("grafana")
    monkeypatch.setattr(docker_router.docker_client, "container_names", lambda: {"other"})

    result = await docker_router.delete_orphan("grafana")

    assert result["deleted"] is True
    assert instances_store.get_instance("grafana") is None


async def test_delete_orphan_refuses_when_container_still_exists(monkeypatch):
    _link("grafana")
    monkeypatch.setattr(docker_router.docker_client, "container_names", lambda: {"grafana"})

    with pytest.raises(HTTPException) as exc:
        await docker_router.delete_orphan("grafana")

    assert exc.value.status_code == 409
    assert instances_store.get_instance("grafana") is not None  # untouched


async def test_delete_orphan_rejects_external_instance():
    instances_store.upsert_instance(Instance(id="nas", name="NAS", type="external"))
    with pytest.raises(HTTPException) as exc:
        await docker_router.delete_orphan("nas")
    assert exc.value.status_code == 409
