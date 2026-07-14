"""Tier-2-ish: DockerClient with docker-py mocked — join + stats wiring, health."""

from types import SimpleNamespace

import pytest
from docker.errors import DockerException

from loskai import config
from loskai.modules.docker import client as client_mod
from loskai.modules.docker.client import DockerClient
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance


class FakeContainer:
    def __init__(self, name, running=True):
        self.id = name + "0123456789ab"
        self.name = name
        self.status = "running" if running else "exited"
        self.image = SimpleNamespace(tags=[f"{name}/img:latest"])
        self.attrs = {
            "Image": "sha256:deadbeef",
            "State": {"Status": self.status, "StartedAt": "2024-01-01T12:00:00Z"},
            "NetworkSettings": {"Ports": {"80/tcp": [{"HostPort": "8080"}]}},
        }

    def stats(self, stream=False):
        return {
            "cpu_stats": {"cpu_usage": {"total_usage": 200}, "system_cpu_usage": 2000, "online_cpus": 1},
            "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000},
            "memory_stats": {"usage": 100, "limit": 1000, "stats": {"inactive_file": 0}},
        }


class FakeDocker:
    def __init__(self, containers, ping_ok=True):
        self._containers = containers
        self._ping_ok = ping_ok
        self.containers = SimpleNamespace(list=lambda all=True: self._containers)

    def ping(self):
        if not self._ping_ok:
            raise DockerException("cannot connect")
        return True


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))


def _use(monkeypatch, fake):
    monkeypatch.setattr(client_mod.docker, "from_env", lambda: fake)


def test_health_healthy(monkeypatch):
    _use(monkeypatch, FakeDocker([]))
    assert DockerClient().health() == {"status": "healthy"}


def test_health_unreachable(monkeypatch):
    _use(monkeypatch, FakeDocker([], ping_ok=False))
    result = DockerClient().health()
    assert result["status"] == "unreachable"


def test_list_containers_joins_instance_and_computes_stats(monkeypatch, data_dir):
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container="grafana", subdomain="graf")
    )
    _use(monkeypatch, FakeDocker([FakeContainer("grafana")]))

    rows = DockerClient().list_containers()
    row = rows[0]
    assert row["name"] == "grafana"
    assert row["image"] == "grafana/img:latest"
    assert row["subdomain"] == "graf"  # joined from the instance
    assert row["ports"] == ["8080->80/tcp"]
    assert row["cpu"] == 10.0  # cpu_delta 100 / system_delta 1000 * 1 cpu * 100
    assert row["mem"]["percent"] == 10.0


def test_stats_skipped_for_stopped_container(monkeypatch, data_dir):
    _use(monkeypatch, FakeDocker([FakeContainer("db", running=False)]))
    row = DockerClient().list_containers()[0]
    assert row["status"] == "exited"
    assert row["cpu"] is None and row["uptime"] is None
