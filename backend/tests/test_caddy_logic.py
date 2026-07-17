"""Tier-1: Caddy pure logic — FQDN, route JSON, mode, Caddyfile render."""

import pytest

from loskai.modules.caddy import service
from loskai.shared.instances import Instance


def test_assemble_fqdn():
    assert service.assemble_fqdn("grafana", "example.no") == "grafana.example.no"


def test_caddy_mode():
    assert service.caddy_mode("http://192.168.10.101:2019") == "lan"
    assert service.caddy_mode("http://caddy:2019") == "docker"
    assert service.caddy_mode(None) is None


def test_build_route_matches_contract():
    inst = Instance(
        id="grafana", name="Grafana", type="docker",
        subdomain="grafana", upstream="192.168.10.100:3000",
    )
    route = service.build_route(inst, "example.no")
    assert route["@id"] == "grafana"
    assert route["match"] == [{"host": ["grafana.example.no"]}]
    dial = route["handle"][0]["routes"][0]["handle"][0]["upstreams"][0]["dial"]
    assert dial == "192.168.10.100:3000"


def test_build_route_https_upstream_adds_tls_transport():
    inst = Instance(
        id="proxmox", name="Proxmox", type="external",
        subdomain="proxmox", upstream="192.168.10.202:8006", upstream_tls=True,
    )
    proxy = service.build_route(inst, "example.no")["handle"][0]["routes"][0]["handle"][0]
    assert proxy["transport"] == {"protocol": "http", "tls": {"insecure_skip_verify": True}}


def test_build_route_plain_upstream_has_no_transport():
    inst = Instance(
        id="grafana", name="Grafana", type="docker",
        subdomain="grafana", upstream="192.168.10.100:3000",
    )
    proxy = service.build_route(inst, "example.no")["handle"][0]["routes"][0]["handle"][0]
    assert "transport" not in proxy


def test_build_route_requires_subdomain_and_upstream():
    with pytest.raises(ValueError):
        service.build_route(Instance(id="x", name="X", type="docker"), "example.no")
    with pytest.raises(ValueError):
        service.build_route(
            Instance(id="x", name="X", type="docker", subdomain="x"), "example.no"
        )




# --- select_server_name (routing-server discovery, robust to a :80 setup server) ---


def test_select_server_prefers_https_listener():
    servers = {
        "srv0": {"listen": [":80"], "routes": [{"@id": "x"}]},  # the :80 cert-setup site
        "srv1": {"listen": [":443"]},                            # the routing server
    }
    assert service.select_server_name(servers) == "srv1"


def test_select_server_https_wins_even_if_second():
    servers = {"setup": {"listen": [":80"]}, "https": {"listen": ["0.0.0.0:443"]}}
    assert service.select_server_name(servers) == "https"


def test_select_server_falls_back_to_one_with_routes():
    servers = {"a": {"listen": [":80"]}, "b": {"listen": [":8080"], "routes": [1]}}
    assert service.select_server_name(servers) == "b"


def test_select_server_falls_back_to_first():
    servers = {"only": {"listen": [":8080"]}}
    assert service.select_server_name(servers) == "only"


def test_select_server_raises_when_empty():
    with pytest.raises(service.CaddyError):
        service.select_server_name({})
