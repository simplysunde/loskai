"""Tier-2: the two creation endpoints through the real HTTP path.

`POST /api/machines` and `POST /api/routes` replaced one `POST /api/assign` that carried a
`route_mode` flag. What matters here is that each rejects what belongs to the other — the
validation is per-model now, not per-branch — and that neither is reachable unauthenticated.
"""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from conftest import PASSWORD



@pytest.fixture(autouse=True)
def base_domain(monkeypatch):
    monkeypatch.setattr(config.settings, "base_domain", "example.no")


@pytest.fixture
def client(admin):
    return admin


def test_the_machine_and_route_endpoints_require_a_session():
    with TestClient(app) as anon:
        anon.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
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
    # It has no certificate, so the single-label rule does not apply. And this
    # runs with no `caddy_admin_url` configured at all: naming a machine involves no route,
    # so it must not depend on Caddy being reachable (it answered 502 until Phase 21e).
    r = client.post("/api/machines", json={"hostname": "rack1.vm3", "address": "192.168.10.55"})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["caddy"] == "skipped"
    assert body["url"] == "rack1.vm3.example.no"  # no scheme — nothing proxies it

def test_a_route_rejects_a_dotted_prefix(client):
    # A proxied name stays one label (architecture.md, Decisions).
    r = client.post("/api/routes", json={"prefix": "rack1.vm3", "upstream": "192.168.10.55:80"})

    assert r.status_code == 422, r.text


def test_a_route_rejects_an_address_with_no_port(client):
    r = client.post("/api/routes", json={"prefix": "grafana", "upstream": "192.168.10.55"})

    assert r.status_code == 422, r.text


def test_the_machine_model_has_no_tls_or_route_mode_to_send(client):
    # Fields that mean nothing for a machine are absent from its model rather than ignored.
    from loskai.shared.assign import MachineCreate, RouteCreate

    assert set(MachineCreate.model_fields) == {"hostname", "address", "instance_id", "ssh"}  # its name is its hostname
    assert "ssh" not in RouteCreate.model_fields  # a service is reached through its route
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


# --- A route that follows its container (Phase 29) ---


@pytest.fixture
def follow_env(monkeypatch):
    """Caddy accepts every push; Docker knows one container and what it's dialled at."""
    from loskai.shared import assign as assign_module
    from loskai.shared import follow

    pushed = []

    async def caddy_ok(_client, inst, _base):
        pushed.append((inst.id, inst.upstream))

    monkeypatch.setattr(assign_module.caddy_service, "upsert_route", caddy_ok)
    monkeypatch.setattr(assign_module.docker_client, "container_names", lambda: {"whoami-whoami-1"})
    monkeypatch.setattr(
        follow, "derive_upstream",
        lambda c: {"whoami-whoami-1": "192.168.10.220:8081"}.get(c),
    )
    return pushed


def _stored(instance_id):
    from loskai.shared import instances as instances_store

    return instances_store.get_instance(instance_id)


def test_a_following_route_takes_its_address_from_the_container(client, follow_env):
    """The server is the authority: whatever upstream the client sends is ignored."""
    r = client.post("/api/routes", json={
        "prefix": "whoami", "upstream": "10.9.9.9:1", "container": "whoami-whoami-1",
        "follow_container": True,
    })

    assert r.status_code == 200, r.text
    inst = _stored("whoami")
    assert inst.follow_container is True
    assert inst.upstream == "192.168.10.220:8081"
    assert follow_env == [("whoami", "192.168.10.220:8081")]


def test_a_container_route_sets_its_own_address_unless_it_asks_to_follow(client, follow_env):
    r = client.post("/api/routes", json={
        "prefix": "whoami", "upstream": "192.168.10.220:9000", "container": "whoami-whoami-1",
    })

    assert r.status_code == 200, r.text
    assert _stored("whoami").follow_container is False
    assert _stored("whoami").upstream == "192.168.10.220:9000"


def test_editing_a_route_can_turn_following_on_without_naming_the_container(client, follow_env):
    """The row's form posts `instance_id`, not `container` — the record supplies it."""
    client.post("/api/routes", json={
        "prefix": "whoami", "upstream": "192.168.10.220:9000", "container": "whoami-whoami-1",
    })

    r = client.post("/api/routes", json={
        "prefix": "whoami", "upstream": "", "instance_id": "whoami", "follow_container": True,
    })

    assert r.status_code == 200, r.text
    assert _stored("whoami").upstream == "192.168.10.220:8081"
    assert _stored("whoami").follow_container is True


def test_only_a_container_route_can_follow(client, follow_env):
    r = client.post("/api/routes", json={
        "prefix": "nas", "upstream": "192.168.10.50:5000", "follow_container": True,
    })

    assert r.status_code == 400
    assert "only a container" in r.json()["detail"]


def test_a_port_docker_cannot_name_cannot_be_followed(client, follow_env, monkeypatch):
    from loskai.shared import follow

    monkeypatch.setattr(follow, "derive_upstream", lambda c: None)

    r = client.post("/api/routes", json={
        "prefix": "whoami", "upstream": "", "container": "whoami-whoami-1",
        "follow_container": True,
    })

    assert r.status_code == 400
    assert "loskai.port" in r.json()["detail"]  # says how to fix it, not just that it failed
    assert _stored("whoami") is None


def test_following_needs_docker_where_a_plain_route_does_not(client, follow_env, monkeypatch):
    """The one deliberate exception to "route creation must not depend on the Docker
    socket": a following route's address *is* Docker's answer."""
    from loskai.shared import follow

    def unreachable(_c):
        raise RuntimeError("docker socket unavailable")

    monkeypatch.setattr(follow, "derive_upstream", unreachable)

    r = client.post("/api/routes", json={
        "prefix": "whoami", "upstream": "", "container": "whoami-whoami-1",
        "follow_container": True,
    })

    assert r.status_code == 503
    assert _stored("whoami") is None
