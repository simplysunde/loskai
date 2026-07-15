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


def test_render_caddyfile_https_upstream():
    inst = Instance(
        id="proxmox", name="Proxmox", type="external",
        subdomain="proxmox", upstream="192.168.10.202:8006", upstream_tls=True,
    )
    out = service.render_caddyfile([inst], "example.no")
    assert "transport http {" in out
    assert "tls_insecure_skip_verify" in out


def test_build_route_requires_subdomain_and_upstream():
    with pytest.raises(ValueError):
        service.build_route(Instance(id="x", name="X", type="docker"), "example.no")
    with pytest.raises(ValueError):
        service.build_route(
            Instance(id="x", name="X", type="docker", subdomain="x"), "example.no"
        )


def test_render_caddyfile():
    instances = [
        Instance(id="grafana", name="Grafana", type="docker",
                 subdomain="grafana", upstream="192.168.10.100:3000"),
        Instance(id="nas", name="NAS", type="external",
                 subdomain="nas", upstream="192.168.10.50:5000"),
        Instance(id="tracked", name="Tracked", type="docker"),  # no subdomain -> skipped
    ]
    out = service.render_caddyfile(instances, "example.no")
    assert "admin 0.0.0.0:2019" in out
    assert "*.example.no {" in out
    assert "grafana.example.no {" in out
    assert "\treverse_proxy 192.168.10.100:3000" in out
    assert "nas.example.no {" in out
    assert "tracked" not in out  # untracked/unrouted instance omitted


def test_render_caddyfile_requires_base_domain():
    with pytest.raises(ValueError):
        service.render_caddyfile([], "")
