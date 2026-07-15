"""Tier-1: label auto-discovery — create/update/unchanged/skip, best-effort."""

import pytest

from loskai import config
from loskai.modules.docker import discovery
from loskai.modules.docker.client import DOCKER_ERRORS
from loskai.modules.docker.discovery import discover_labeled
from loskai.shared import instances as instances_store


class FakeCaddy:
    async def delete_route(self, route_id):
        pass

    async def push_route(self, route):
        pass


class FakeAdGuard:
    def base_url(self):
        return None  # AdGuard unconfigured -> its step is skipped

    async def add_rewrite(self, d, a):
        pass

    async def delete_rewrite(self, d, a):
        pass


def _labeled(name, labels, ports):
    return lambda label: [{"name": name, "labels": labels, "ports": ports}]


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "base_domain", "lvh.me")
    monkeypatch.setattr(config.settings, "caddy_host_ip", None)
    # Docker (co-located) mode -> upstream derives from the container name + port.
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://caddy:2019")


async def test_creates_instance_for_labeled_container(env, monkeypatch):
    monkeypatch.setattr(
        discovery.docker_client, "running_with_label",
        _labeled("grafana", {"loskai.subdomain": "grafana"}, {"3000/tcp": None}),
    )
    results = await discover_labeled(FakeCaddy(), FakeAdGuard())

    assert results[0]["status"] == "created"
    inst = instances_store.get_instance("grafana")
    assert inst.type == "docker" and inst.container == "grafana"
    assert inst.subdomain == "grafana" and inst.upstream == "grafana:3000"


async def test_idempotent_second_run_is_unchanged(env, monkeypatch):
    monkeypatch.setattr(
        discovery.docker_client, "running_with_label",
        _labeled("grafana", {"loskai.subdomain": "grafana"}, {"3000/tcp": None}),
    )
    await discover_labeled(FakeCaddy(), FakeAdGuard())
    results = await discover_labeled(FakeCaddy(), FakeAdGuard())
    assert results[0]["status"] == "unchanged"


async def test_updates_when_label_changes(env, monkeypatch):
    monkeypatch.setattr(
        discovery.docker_client, "running_with_label",
        _labeled("grafana", {"loskai.subdomain": "grafana"}, {"3000/tcp": None}),
    )
    await discover_labeled(FakeCaddy(), FakeAdGuard())
    # subdomain changed in the label
    monkeypatch.setattr(
        discovery.docker_client, "running_with_label",
        _labeled("grafana", {"loskai.subdomain": "graf"}, {"3000/tcp": None}),
    )
    results = await discover_labeled(FakeCaddy(), FakeAdGuard())
    assert results[0]["status"] == "updated"
    inst = instances_store.get_instance("grafana")  # id kept, subdomain updated
    assert inst.subdomain == "graf"


async def test_skips_when_no_upstream_derivable(env, monkeypatch):
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://192.168.10.101:2019")  # lan mode
    monkeypatch.setattr(
        discovery.docker_client, "running_with_label",
        _labeled("grafana", {"loskai.subdomain": "grafana"}, {"3000/tcp": [{"HostPort": "3000"}]}),
    )
    results = await discover_labeled(FakeCaddy(), FakeAdGuard())
    assert results[0]["status"] == "skipped"


async def test_docker_down_returns_empty(env, monkeypatch):
    def boom(label):
        raise DOCKER_ERRORS[0]("cannot connect")

    monkeypatch.setattr(discovery.docker_client, "running_with_label", boom)
    assert await discover_labeled(FakeCaddy(), FakeAdGuard()) == []
