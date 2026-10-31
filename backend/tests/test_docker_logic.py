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


def test_suggested_host_is_known_when_the_port_is_not():
    """The case that left the Assign form empty: Bambuddy runs with host networking, so
    Docker reports no ports at all — but Caddy still dials the Docker host, whose IP is
    configured. The host half is known; only the port is left to type."""
    assert logic.suggested_upstream("bambuddy-bambuddy-1", "bambuddy", {}, "lan", "192.168.10.50") is None
    assert logic.suggested_host("bambuddy-bambuddy-1", "bambuddy", {}, "lan", "192.168.10.50") == (
        "192.168.10.50"
    )
    # Several published ports: ambiguous port, same host.
    two = {"80/tcp": [{"HostPort": "80"}], "443/tcp": [{"HostPort": "443"}]}
    assert logic.suggested_host("web", None, two, "lan", "192.168.10.50") == "192.168.10.50"


def test_suggested_host_follows_the_same_rules_as_the_full_upstream():
    # A concrete bind IP wins over the configured host_ip, as for suggested_upstream.
    concrete = {"8006/tcp": [{"HostIp": "192.168.10.9", "HostPort": "8006"}]}
    assert logic.suggested_host("pve", None, concrete, "lan", "192.168.10.50") == "192.168.10.9"
    # docker mode: the service name, else the container name — never an IP.
    assert logic.suggested_host("app-web-1", "web", {}, "docker", "192.168.10.50") == "web"
    assert logic.suggested_host("myapp", None, {}) == "myapp"
    # The one unknowable case: lan mode with no host_ip configured.
    assert logic.suggested_host("jellyfin", "jellyfin", {}, "lan", None) is None


def test_a_full_suggestion_is_always_the_host_plus_a_port():
    """suggested_upstream is built from suggested_host, so the two cannot disagree."""
    cases = [
        ("jellyfin", "jellyfin", {"8096/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8096"}]}, "lan", "192.168.10.50"),
        ("pve", None, {"8006/tcp": [{"HostIp": "192.168.10.9", "HostPort": "8006"}]}, "lan", None),
        ("adguard", "adguard", {"3000/tcp": [{"HostPort": "3000"}]}, "docker", None),
    ]
    for args in cases:
        full = logic.suggested_upstream(*args)
        assert full and full.rsplit(":", 1)[0] == logic.suggested_host(*args)


# --- loskai.port: the port Docker can't see, or can't choose ---

LABEL = {"loskai.port": "8000"}


def test_host_networking_with_a_port_label_is_fully_dialable():
    """Bambuddy with its label: nothing published, but the label names the port, and in
    the host's own namespace a container port is a host port."""
    assert logic.suggested_upstream(
        "bambuddy-bambuddy-1", "bambuddy", {}, "lan", "192.168.10.220", LABEL, host_network=True
    ) == "192.168.10.220:8000"


def test_a_label_resolves_to_its_published_host_port_in_lan_mode():
    """The label is the container-side port; off-box, Caddy dials what it's published as."""
    ports = {"80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8081"}]}
    assert logic.suggested_upstream(
        "web", None, ports, "lan", "192.168.10.50", {"loskai.port": "80"}
    ) == "192.168.10.50:8081"


def test_a_label_picks_one_port_out_of_several():
    ports = {
        "80/tcp": [{"HostPort": "8080"}],
        "443/tcp": [{"HostPort": "8443"}],
        "9000/tcp": [{"HostPort": "9000"}],
    }
    # Without it: ambiguous.
    assert logic.suggested_upstream("app", None, ports, "lan", "192.168.10.50") is None
    assert logic.suggested_upstream(
        "app", None, ports, "lan", "192.168.10.50", {"loskai.port": "9000"}
    ) == "192.168.10.50:9000"


def test_a_label_naming_an_unpublished_port_is_not_dialable_off_box():
    ports = {"80/tcp": [{"HostPort": "8081"}], "3000/tcp": None}
    labels = {"loskai.port": "3000"}
    assert logic.suggested_upstream("app", None, ports, "lan", "192.168.10.50", labels) is None
    # The host is still known.
    assert logic.suggested_host("app", None, ports, "lan", "192.168.10.50", labels) == "192.168.10.50"


def test_on_a_shared_network_the_label_is_the_port_by_name():
    exposed = {"3000/tcp": None, "3002/tcp": None, "8000/tcp": None}
    assert logic.suggested_upstream("x", "bambuddy", exposed, "docker") is None  # ambiguous
    assert logic.suggested_upstream("x", "bambuddy", exposed, "docker", None, LABEL) == "bambuddy:8000"


def test_an_invalid_label_is_ignored_not_trusted():
    ports = {"80/tcp": [{"HostPort": "8081"}]}
    for bad in ("", "abc", "0", "70000", "80/tcp", "-1"):
        assert logic.label_port({"loskai.port": bad}) is None
        # Falls back to the unlabelled answer.
        assert logic.suggested_upstream(
            "web", None, ports, "lan", "192.168.10.50", {"loskai.port": bad}
        ) == "192.168.10.50:8081"


def test_linked_instance_id_finds_an_unrouted_link():
    """A recipe install links an instance before any route exists; its id is the recipe's,
    a better prefix than the generated container name."""
    instances = [
        Instance(id="bambuddy", name="Bambuddy", type="docker", container="bambuddy-bambuddy-1"),
        Instance(id="graf", name="G", type="docker", container="grafana", subdomain="graf"),
    ]
    assert logic.linked_instance_id("bambuddy-bambuddy-1", instances) == "bambuddy"
    assert logic.linked_instance_id("grafana", instances) == "graf"
    assert logic.linked_instance_id("stray", instances) is None


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


# --- Per-container upstream mode (Phase 16 Stage A) ---
#
# The defect this replaces: caddy_mode answered "is CADDY_ADMIN_URL's host an IP?" once per
# deployment, so in the co-located layout every container got name:port — including managed
# stacks, which Compose isolates on their own <project>_default where Caddy cannot resolve
# them. The route then 502s.


def test_shares_network_only_when_a_resolving_network_is_common():
    # Caddy's own compose project — resolvable by name.
    assert logic.shares_docker_network({"loskai_default"}, {"loskai_default"}) is True
    # A managed stack on its own project network — the case that 502s today.
    assert logic.shares_docker_network({"loskai_default"}, {"media_default"}) is False
    # A stack deliberately joined to the shared edge network (Phase 16 Stage B).
    assert logic.shares_docker_network(
        {"loskai_default", "loskai-edge"}, {"media_default", "loskai-edge"}
    ) is True


def test_host_networking_is_never_treated_as_shared():
    """D2: two containers on network_mode: host both report {"host"}, so a plain
    intersection would call that shared — but host networking has no embedded DNS, so
    name:port would not resolve. They are reachable at the published host port instead."""
    assert logic.shares_docker_network({"host"}, {"host"}) is False
    assert logic.shares_docker_network({"host"}, {"media_default"}) is False
    assert logic.shares_docker_network({"loskai_default"}, {"host"}) is False
    # `none` (no networking at all) is excluded on the same grounds.
    assert logic.shares_docker_network({"none"}, {"none"}) is False


def test_unknown_caddy_shares_nothing():
    """Caddy isn't a container this daemon can see — an external LXC, or a hostname
    pointing off-box. Either way there is no shared network to find."""
    assert logic.shares_docker_network(None, {"media_default"}) is False
    assert logic.shares_docker_network({"loskai_default"}, None) is False


def test_upstream_mode_is_per_container():
    """One deployment, two containers, two different correct answers — which is precisely
    what a single deployment-wide `mode` could not express."""
    caddy = {"loskai_default"}
    assert logic.upstream_mode(caddy, {"loskai_default"}) == "docker"
    assert logic.upstream_mode(caddy, {"media_default"}) == "lan"


def test_unknown_caddy_falls_back_to_lan_not_the_name_form():
    """The fallback direction matters: guessing name:port for an unreachable Caddy is the
    exact failure being fixed, while the published host port works from anywhere."""
    assert logic.upstream_mode(None, {"media_default"}) == "lan"


def test_upstream_mode_feeds_suggested_upstream_end_to_end():
    ports = {"3000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3000"}]}
    shared = logic.upstream_mode({"edge"}, {"edge"})
    assert logic.suggested_upstream("stack-grafana-1", "grafana", ports, shared) == "grafana:3000"
    isolated = logic.upstream_mode({"loskai_default"}, {"media_default"})
    assert logic.suggested_upstream(
        "stack-grafana-1", "grafana", ports, isolated, "192.168.10.50"
    ) == "192.168.10.50:3000"


# --- Volumes ---

ANON = "a" * 64


def test_volume_rows_join_each_volume_to_the_containers_mounting_it():
    volumes = [
        {"Name": "immich_pgdata", "Driver": "local", "UsageData": {"Size": 1200, "RefCount": 1},
         "Labels": {"com.docker.compose.project": "immich"}},
        {"Name": "old_cache", "Driver": "local", "UsageData": {"Size": 340, "RefCount": 0}},
    ]
    containers = [
        {"name": "immich-db", "mounts": [
            {"Type": "volume", "Name": "immich_pgdata", "Destination": "/var/lib/postgresql"},
            # A bind mount names no volume, whatever its source looks like.
            {"Type": "bind", "Source": "/srv/old_cache", "Destination": "/cache"},
        ]},
        {"name": "immich-server", "mounts": None},
    ]
    rows = logic.volume_rows(volumes, containers)
    assert [r["name"] for r in rows] == ["immich_pgdata", "old_cache"]
    assert rows[0] == {
        "name": "immich_pgdata", "driver": "local", "size": 1200, "project": "immich",
        "anonymous": False, "used_by": ["immich-db"],
    }
    assert rows[1]["used_by"] == []  # unused: nothing mounts it
    assert rows[1]["project"] is None


def test_volume_rows_size_unknown_is_none_not_minus_one():
    # Docker reports -1 for a size it hasn't computed; a 0-byte volume is a real 0.
    rows = logic.volume_rows(
        [{"Name": "a", "UsageData": {"Size": -1}}, {"Name": "b", "UsageData": {"Size": 0}},
         {"Name": "c"}],
        [],
    )
    assert [r["size"] for r in rows] == [None, 0, None]


def test_volume_rows_flag_anonymous_volumes():
    rows = logic.volume_rows(
        [{"Name": ANON}, {"Name": "named", "Labels": {"com.docker.volume.anonymous": ""}},
         {"Name": "data"}],
        [],
    )
    assert {r["name"]: r["anonymous"] for r in rows} == {ANON: True, "named": True, "data": False}


def test_is_self_matches_dockers_default_hostname_only():
    cid = "3f2a9c1b7e4d" + "0" * 52
    assert logic.is_self(cid, "3f2a9c1b7e4d")
    assert not logic.is_self(cid, "aaaaaaaaaaaa")
    # A bare-metal host, or a container given its own hostname, never matches — even one
    # that happens to prefix the id.
    assert not logic.is_self(cid, "3f2a")
    assert not logic.is_self("devbox" + cid, "devbox")


def test_yaml_problem_names_the_line():
    assert logic.yaml_problem("services:\n  app:\n    image: nginx\n") is None
    assert logic.yaml_problem("services:\n\tapp: {}\n") == "line 2: indented with a tab — YAML needs spaces"
    assert logic.yaml_problem("a: 1\nb: [\n").startswith("line 3: ")
    assert logic.yaml_problem("") == "is empty"
    assert logic.yaml_problem("- a\n- b\n") == "must start with a key, like services:"


def test_a_tab_inside_a_value_is_not_blamed():
    # Only a tab in the indentation is illegal; one in a quoted value is fine.
    assert logic.yaml_problem('a: "x\ty"\n') is None


def test_network_subnets_are_read_from_each_network_s_address_and_prefix():
    attrs = {"NetworkSettings": {"Networks": {
        "loskai_default": {"IPAddress": "172.18.0.2", "IPPrefixLen": 16},
        "loskai-edge": {"IPAddress": "172.20.0.5", "IPPrefixLen": 24},
        "host": {"IPAddress": "", "IPPrefixLen": 0},
    }}}

    assert logic.network_subnets(attrs) == ["172.18.0.0/16", "172.20.0.0/24"]
    assert logic.network_subnets({}) == []
