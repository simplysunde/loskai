"""Tier-1: Docker pure logic — stats math, parsing, stack status, joins, quick-commands."""

from datetime import datetime, timezone

from loskai.modules.docker import logic
from loskai.modules.docker.quick_commands import quick_commands_for
from loskai.shared.instances import Instance


def test_compute_cpu_percent():
    stats = {
        "cpu_stats": {
            "cpu_usage": {"total_usage": 200},
            "system_cpu_usage": 2000,
            "online_cpus": 2,
        },
        "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000},
    }
    # cpu_delta=100, system_delta=1000, online=2 -> 100/1000*2*100 = 20.0
    assert logic.compute_cpu_percent(stats) == 20.0


def test_compute_cpu_percent_missing_data():
    assert logic.compute_cpu_percent({}) is None


def test_compute_memory():
    stats = {"memory_stats": {"usage": 200, "limit": 1000, "stats": {"inactive_file": 50}}}
    mem = logic.compute_memory(stats)
    assert mem == {"used": 150, "limit": 1000, "percent": 15.0}


def test_compute_memory_missing():
    assert logic.compute_memory({})["percent"] is None


def test_parse_docker_time_nanoseconds():
    dt = logic.parse_docker_time("2024-01-01T12:00:00.123456789Z")
    assert dt is not None and dt.year == 2024 and dt.microsecond == 123456


def test_parse_docker_time_zero_value():
    assert logic.parse_docker_time("0001-01-01T00:00:00Z") is None


def test_uptime_seconds():
    now = datetime(2024, 1, 1, 12, 0, 30, tzinfo=timezone.utc)
    assert logic.uptime_seconds("2024-01-01T12:00:00Z", now=now) == 30


def test_format_ports():
    attrs = {"NetworkSettings": {"Ports": {"80/tcp": [{"HostPort": "8080"}], "53/udp": None}}}
    assert logic.format_ports(attrs) == ["8080->80/tcp"]


def test_image_name_prefers_tag():
    assert logic.image_name({"Image": "sha256:abc"}, ["grafana/grafana:latest"]) == "grafana/grafana:latest"
    assert logic.image_name({"Image": "sha256:abcdef0123456789xyz"}, []) == "sha256:abcdef012345"


def test_compute_stack_status():
    assert logic.compute_stack_status({"a", "b"}, set()) == "down"
    assert logic.compute_stack_status({"a", "b"}, {"a", "b"}) == "up"
    assert logic.compute_stack_status({"a", "b"}, {"a"}) == "partial"


def test_subdomain_for():
    instances = [
        Instance(id="grafana", name="G", type="docker", container="grafana", subdomain="graf"),
        Instance(id="x", name="X", type="docker", container="other"),
    ]
    assert logic.subdomain_for("grafana", instances) == "graf"
    assert logic.subdomain_for("missing", instances) is None


def test_suggested_container_port_prefers_single_published():
    # AdGuard: many exposed, only 3000 published -> 3000.
    ports = {"3000/tcp": [{"HostPort": "3000"}], "53/tcp": None, "53/udp": None, "80/tcp": None}
    assert logic.suggested_container_port(ports) == "3000"


def test_suggested_container_port_single_exposed_fallback():
    assert logic.suggested_container_port({"8080/tcp": None}) == "8080"


def test_suggested_container_port_ambiguous():
    ports = {"3000/tcp": [{"HostPort": "3000"}], "9000/tcp": [{"HostPort": "9000"}]}
    assert logic.suggested_container_port(ports) is None


def test_suggested_upstream_uses_service_name():
    ports = {"3000/tcp": [{"HostPort": "3000"}], "53/tcp": None}
    assert logic.suggested_upstream("loskai-dev-adguard", "adguard", ports) == "adguard:3000"
    # No compose service -> container name.
    assert logic.suggested_upstream("myapp", None, {"8080/tcp": None}) == "myapp:8080"
    assert logic.suggested_upstream("x", "x", {}) is None
    # Explicit docker mode matches the default.
    assert logic.suggested_upstream("myapp", None, {"8080/tcp": None}, "docker") == "myapp:8080"


def test_suggested_upstream_lan_mode_uses_host_ip_and_published_port():
    # Split-LXC: Caddy dials the Docker host's LAN IP + the *published host* port, never the
    # container name (which would 502).
    ports = {"8096/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8096"}]}
    assert logic.suggested_upstream("jellyfin", "jellyfin", ports, "lan", "192.168.10.50") == (
        "192.168.10.50:8096"
    )
    # A concrete published bind IP wins over the configured host_ip (no setting needed).
    concrete = {"8006/tcp": [{"HostIp": "192.168.10.9", "HostPort": "8006"}]}
    assert logic.suggested_upstream("pve", None, concrete, "lan", None) == "192.168.10.9:8006"
    # No host_ip and only 0.0.0.0 bindings -> can't infer a LAN IP -> blank for the user.
    assert logic.suggested_upstream("jellyfin", "jellyfin", ports, "lan", None) is None
    # Ambiguous (several published ports) -> None even with a host_ip.
    two = {"80/tcp": [{"HostPort": "80"}], "443/tcp": [{"HostPort": "443"}]}
    assert logic.suggested_upstream("web", None, two, "lan", "192.168.10.50") is None


def test_published_host_binding():
    assert logic.published_host_binding({"8096/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8096"}]}) == (
        None,
        "8096",
    )
    assert logic.published_host_binding(
        {"8006/tcp": [{"HostIp": "192.168.10.9", "HostPort": "8006"}]}
    ) == ("192.168.10.9", "8006")
    assert logic.published_host_binding({"53/tcp": None}) is None  # nothing published
    assert logic.published_host_binding(None) is None


def test_quick_commands_generic_and_specific():
    generic = quick_commands_for("alpine")
    assert {c["label"] for c in generic} == {"List processes", "Env vars", "Disk usage", "List files"}

    pg = quick_commands_for("postgres:16")
    assert any(c["command"] == "psql -U postgres" for c in pg)

    nginx = quick_commands_for("library/nginx:latest")
    labels = [c["label"] for c in nginx]
    assert "Test config" in labels and "Reload" in labels


def test_orphaned_instances_flags_missing_container():
    instances = [
        Instance(id="grafana", name="G", type="docker", container="grafana", subdomain="graf"),
        Instance(id="dead", name="D", type="docker", container="removed", subdomain="dead"),
        Instance(id="nas", name="N", type="external", subdomain="nas"),
    ]
    orphans = logic.orphaned_instances(instances, {"grafana", "other"})
    assert [i.id for i in orphans] == ["dead"]


def test_orphaned_instances_ignores_external_and_containerless():
    instances = [
        Instance(id="nas", name="N", type="external", subdomain="nas"),
        Instance(id="bare", name="B", type="docker"),  # no container linked
    ]
    assert logic.orphaned_instances(instances, set()) == []
