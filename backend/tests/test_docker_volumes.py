"""The volume delete endpoint: it never forces, so Docker's own "in use" refusal is what
protects a volume a container (even a stopped one) still mounts."""

from types import SimpleNamespace

import pytest
from docker.errors import APIError, NotFound
from fastapi import HTTPException

from loskai.modules.docker import router as docker_router
from loskai.modules.docker.client import DockerClient


def test_an_unused_volume_is_removed(monkeypatch):
    removed = []
    monkeypatch.setattr(docker_router.docker_client, "remove_volume", removed.append)

    assert docker_router.remove_volume("old_data") == {"ok": True}
    assert removed == ["old_data"]


def test_a_volume_in_use_is_refused_not_forced(monkeypatch):
    def in_use(name):
        raise APIError("volume is in use", response=SimpleNamespace(status_code=409))

    monkeypatch.setattr(docker_router.docker_client, "remove_volume", in_use)

    with pytest.raises(HTTPException) as exc:
        docker_router.remove_volume("immich_pgdata")
    assert exc.value.status_code == 409


def test_a_missing_volume_is_404(monkeypatch):
    def gone(name):
        raise NotFound("no such volume")

    monkeypatch.setattr(docker_router.docker_client, "remove_volume", gone)

    with pytest.raises(HTTPException) as exc:
        docker_router.remove_volume("gone")
    assert exc.value.status_code == 404


def test_the_client_never_forces(monkeypatch):
    calls = []
    volume = SimpleNamespace(remove=lambda **kw: calls.append(kw))
    fake = SimpleNamespace(volumes=SimpleNamespace(get=lambda name: volume))
    client = DockerClient()
    monkeypatch.setattr(client, "_get", lambda: fake)

    client.remove_volume("old_data")
    assert calls == [{}]
