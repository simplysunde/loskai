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
    def __init__(self, name, running=True, networks=None, service=None):
        self.id = name + "0123456789ab"
        self.name = name
        self.status = "running" if running else "exited"
        self.image = SimpleNamespace(tags=[f"{name}/img:latest"])
        self.labels = {"com.docker.compose.service": name if service is None else service}
        # `networks` maps network name -> the aliases the container answers to there, which
        # is how Compose exposes a service name for a `<project>-<service>-1` container.
        self.attrs = {
            "Image": "sha256:deadbeef",
            "State": {"Status": self.status, "StartedAt": "2024-01-01T12:00:00Z"},
            "NetworkSettings": {
                "Ports": {"80/tcp": [{"HostPort": "8080"}]},
                "Networks": {n: {"Aliases": a} for n, a in (networks or {}).items()},
            },
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
        self.list_calls = 0
        self.containers = SimpleNamespace(list=self._list)

    def _list(self, all=True):
        self.list_calls += 1
        return self._containers

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
    # No caddy_host, so Caddy is not identifiable and the name form is never guessed. The
    # published port binds to no concrete IP and host_ip is unset, so there is nothing to
    # pre-fill — the user types it. See test_upstream_* below for the decided cases.
    assert row["upstream_mode"] == "lan"
    assert row["suggested_upstream"] is None
    assert row["cpu"] == 10.0  # cpu_delta 100 / system_delta 1000 * 1 cpu * 100
    assert row["mem"]["percent"] == 10.0


def test_stats_skipped_for_stopped_container(monkeypatch, data_dir):
    _use(monkeypatch, FakeDocker([FakeContainer("db", running=False)]))
    row = DockerClient().list_containers()[0]
    assert row["status"] == "exited"
    assert row["cpu"] is None and row["uptime"] is None


# --- Which upstream form each container gets (Phase 16 Stage A) ---


def test_upstream_uses_the_name_form_only_on_a_shared_network(monkeypatch, data_dir):
    """The core fix: one deployment, two containers, two different correct answers."""
    fake = FakeDocker([
        FakeContainer("caddy", networks={"loskai_default": []}),
        FakeContainer("grafana", networks={"loskai_default": []}),
        FakeContainer("sonarr", networks={"media_default": []}),  # a managed stack
    ])
    _use(monkeypatch, fake)

    rows = {r["name"]: r for r in DockerClient().list_containers(caddy_host="caddy")}

    assert rows["grafana"]["suggested_upstream"] == "grafana:80"
    assert rows["grafana"]["upstream_mode"] == "docker"
    # The 502 this phase exists to stop: Caddy cannot resolve a name in another project.
    assert rows["sonarr"]["upstream_mode"] == "lan"
    assert rows["sonarr"]["suggested_upstream"] != "sonarr:80"


def test_caddy_is_matched_by_network_alias_not_just_container_name(monkeypatch, data_dir):
    """compose.colocated.yml pins `container_name: caddy`, which hides this: a stack that
    omits it gets `<project>-caddy-1`, and `caddy` survives only as an alias. Matching on
    the name alone would miss it and fall back to `lan` for everything."""
    fake = FakeDocker([
        FakeContainer("edge-caddy-1", service="caddy", networks={"edge_default": ["caddy"]}),
        FakeContainer("grafana", networks={"edge_default": []}),
    ])
    _use(monkeypatch, fake)

    rows = {r["name"]: r for r in DockerClient().list_containers(caddy_host="caddy")}
    assert rows["grafana"]["upstream_mode"] == "docker"


def test_host_networking_never_yields_the_name_form(monkeypatch, data_dir):
    """D2: both report {"host"}, which a plain intersection would call shared — but host
    networking has no embedded DNS, so `name:port` would not resolve."""
    fake = FakeDocker([
        FakeContainer("caddy", networks={"host": []}),
        FakeContainer("grafana", networks={"host": []}),
    ])
    _use(monkeypatch, fake)

    rows = {r["name"]: r for r in DockerClient().list_containers(caddy_host="caddy")}
    assert rows["grafana"]["upstream_mode"] == "lan"


def test_a_host_networked_recipe_install_still_prefills_host_and_prefix(monkeypatch, data_dir):
    """Bambuddy, as installed: host networking (Docker reports no ports), and an unrouted
    instance the install linked by container name. The port is unknowable; the host and
    the prefix are not."""
    instances_store.upsert_instance(
        Instance(id="bambuddy", name="Bambuddy", type="docker", container="bambuddy-bambuddy-1")
    )
    bambuddy = FakeContainer("bambuddy-bambuddy-1", networks={"host": []}, service="bambuddy")
    bambuddy.attrs["NetworkSettings"]["Ports"] = {}
    _use(monkeypatch, FakeDocker([bambuddy]))

    row = DockerClient().list_containers(host_ip="192.168.10.220")[0]
    assert row["upstream_mode"] == "lan"
    assert row["suggested_upstream"] is None
    assert row["suggested_host"] == "192.168.10.220"
    assert row["instance_id"] == "bambuddy"
    assert row["subdomain"] is None  # linked, not routed


def test_unmatched_caddy_host_falls_back_to_lan(monkeypatch, data_dir):
    """An IP admin URL (layout A) or a hostname pointing off-box matches nothing here."""
    fake = FakeDocker([FakeContainer("grafana", networks={"media_default": []})])
    _use(monkeypatch, fake)

    row = DockerClient().list_containers(caddy_host="192.168.10.101")[0]
    assert row["upstream_mode"] == "lan"


def test_caddy_is_resolved_once_per_request_not_per_container(monkeypatch, data_dir):
    """Caddy is found in the container list already fetched, so adding containers must not
    add Docker API calls."""
    fake = FakeDocker([
        FakeContainer("caddy", networks={"loskai_default": []}),
        *[FakeContainer(f"app{i}", networks={"loskai_default": []}) for i in range(5)],
    ])
    _use(monkeypatch, fake)

    DockerClient().list_containers(caddy_host="caddy")
    assert fake.list_calls == 1
