"""Tier-2: the two creation endpoints through the real HTTP path.

`POST /api/machines` and `POST /api/routes` replaced one `POST /api/assign` that carried a
`route_mode` flag. What matters here is that each rejects what belongs to the other — the
validation is per-model now, not per-branch — and that neither is reachable unauthenticated.
"""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app

PASSWORD = "smoke-test-password"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "base_domain", "example.no")


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"password": PASSWORD})
        c.post("/api/login", json={"password": PASSWORD})
        yield c


def test_both_creation_endpoints_require_a_session():
    with TestClient(app) as anon:
        anon.post("/api/auth/setup", json={"password": PASSWORD})
        anon.cookies.clear()  # setup signs you in; this is the logged-out case
        machine = anon.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.50"})
        route = anon.post("/api/routes", json={"prefix": "g", "upstream": "192.168.10.50:80"})

    assert machine.status_code == 401
    assert route.status_code == 401


def test_the_old_combined_endpoint_is_gone(client):
    # One verb per endpoint — no third door that takes a route_mode flag.
    r = client.post(
        "/api/assign",
        json={"prefix": "nas", "upstream": "192.168.10.50", "route_mode": "dns_only"},
    )

    assert r.status_code == 404


def test_a_machine_rejects_a_port_in_its_address(client):
    r = client.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.50:5000"})

    assert r.status_code == 422, r.text


def test_a_machine_accepts_a_dotted_hostname(client):
    # No wildcard cert has to cover it, so the single-label rule does not apply. And this
    # runs with no `caddy_admin_url` configured at all: naming a machine involves no route,
    # so it must not depend on Caddy being reachable (it answered 502 until Phase 21e).
    r = client.post("/api/machines", json={"hostname": "rack1.vm3", "address": "192.168.10.55"})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["caddy"] == "skipped"
    assert body["url"] == "rack1.vm3.example.no"  # no scheme — nothing proxies it

def test_a_route_rejects_a_dotted_prefix(client):
    # Every proxied name has to sit under the one *.BASE_DOMAIN certificate.
    r = client.post("/api/routes", json={"prefix": "rack1.vm3", "upstream": "192.168.10.55:80"})

    assert r.status_code == 422, r.text


def test_a_route_rejects_an_address_with_no_port(client):
    r = client.post("/api/routes", json={"prefix": "grafana", "upstream": "192.168.10.55"})

    assert r.status_code == 422, r.text


def test_the_machine_model_has_no_tls_or_route_mode_to_send(client):
    # Fields that mean nothing for a machine are absent from its model rather than ignored.
    from loskai.shared.assign import MachineCreate, RouteCreate

    assert set(MachineCreate.model_fields) == {"hostname", "address", "name", "instance_id"}
    assert "upstream_tls" in RouteCreate.model_fields
    assert "route_mode" not in RouteCreate.model_fields


def test_a_route_naming_a_container_that_does_not_exist_is_rejected(client, monkeypatch):
    # The 2026-09-16 smoke: the link is by container *name*, and a name matching nothing
    # produced a working route that the Routing tab then listed as an orphan, while the
    # same row read synced/up. It fails as a success, which is the shape worth catching.
    from loskai.shared import assign as assign_module

    monkeypatch.setattr(
        assign_module.docker_client, "container_names", lambda: {"grafana", "sonarr"}
    )

    r = client.post(
        "/api/routes",
        json={"prefix": "ghost", "upstream": "192.168.10.50:80", "container": "not-a-container"},
    )

    assert r.status_code == 404
    assert "not-a-container" in r.json()["detail"]


def test_a_route_is_still_created_when_docker_cannot_be_asked(client, monkeypatch):
    # Docker being unreachable means "unknown", not "invalid" — creating a route must not
    # start depending on the Docker socket.
    from loskai.shared import assign as assign_module

    def unreachable():
        raise RuntimeError("docker socket unavailable")

    monkeypatch.setattr(assign_module.docker_client, "container_names", unreachable)

    r = client.post(
        "/api/routes",
        json={"prefix": "ghost", "upstream": "192.168.10.50:80", "container": "unverifiable"},
    )

    # Gets past the link check and on to Caddy, which is what "not rejected" looks like here.
    assert r.status_code == 502
    assert "Caddy step failed" in r.json()["detail"]
