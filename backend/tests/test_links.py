"""Links (Phase 45): a name and an address the Dashboard opens directly — no Caddy, no
AdGuard. A link is a record with `route_mode: "direct"` and no subdomain, so everything that
reads routes leaves it alone by construction; these tests hold that, and the ways a link
and a route turn into each other.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.modules.caddy import service as caddy_service
from loskai.shared import assign as assign_module
from loskai.shared import follow
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance

PASSWORD = "smoke-test-password"


@pytest.fixture(autouse=True)
def base_domain(monkeypatch):
    monkeypatch.setattr(config.settings, "base_domain", "example.no")


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        c.post("/api/login", json={"username": "admin", "password": PASSWORD})
        yield c


@pytest.fixture
def no_caddy_no_adguard(monkeypatch):
    """Any call into Caddy's or AdGuard's write path fails the test: a link has neither."""

    async def touched(*_a, **_k):
        raise AssertionError("a link must not touch Caddy or AdGuard")

    monkeypatch.setattr(assign_module.caddy_service, "upsert_route", touched)
    monkeypatch.setattr(assign_module.caddy_service, "teardown_route", touched)
    monkeypatch.setattr(assign_module.adguard, "add_rewrite", touched)
    monkeypatch.setattr(assign_module.adguard, "delete_rewrite", touched)


def _stored(instance_id):
    return instances_store.get_instance(instance_id)


# --- Making and editing one ---


def test_a_link_is_a_record_with_no_route(client, no_caddy_no_adguard):
    r = client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})

    assert r.status_code == 200, r.text
    assert r.json()["url"] == "http://192.168.10.220:8096"
    assert r.json()["link"] is True
    inst = _stored("jellyfin")
    assert (inst.route_mode, inst.subdomain, inst.kind, inst.name) == ("direct", None, "service", "Jellyfin")
    assert inst not in instances_store.list_routed()


def test_a_link_over_https_opens_with_https(client, no_caddy_no_adguard):
    r = client.post("/api/links", json={"name": "Proxmox", "upstream": "192.168.10.10:8006", "upstream_tls": True})

    assert r.json()["url"] == "https://192.168.10.10:8006"


@pytest.mark.parametrize("body", [
    {"name": "  ", "upstream": "192.168.10.220:8096"},
    {"name": "x" * 81, "upstream": "192.168.10.220:8096"},
    {"name": "J", "upstream": "http://192.168.10.220:8096"},
    {"name": "J", "upstream": "192.168.10.220"},
])
def test_a_link_needs_a_name_and_a_host_and_port(client, no_caddy_no_adguard, body):
    assert client.post("/api/links", json=body).status_code == 422


def test_two_links_with_one_name_get_their_own_ids(client, no_caddy_no_adguard):
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})
    r = client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.221:8096"})

    assert r.json()["instance_id"] == "jellyfin-2"


def test_editing_a_link_keeps_its_id(client, no_caddy_no_adguard):
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})
    r = client.post("/api/links", json={
        "name": "TV", "upstream": "192.168.10.221:8920", "upstream_tls": True, "instance_id": "jellyfin",
    })

    assert r.status_code == 200, r.text
    inst = _stored("jellyfin")
    assert (inst.name, inst.upstream, inst.upstream_tls) == ("TV", "192.168.10.221:8920", True)


def test_a_recipe_install_s_record_becomes_the_link(client, no_caddy_no_adguard, monkeypatch):
    """One record per container: a link to it takes the install's record, as a route does."""
    monkeypatch.setattr(assign_module.docker_client, "container_names", lambda: {"jellyfin-jellyfin-1"})
    instances_store.upsert_instance(
        Instance(id="jellyfin", name="Jellyfin", type="docker", container="jellyfin-jellyfin-1")
    )

    r = client.post("/api/links", json={
        "name": "Jellyfin", "upstream": "192.168.10.220:8096", "container": "jellyfin-jellyfin-1",
    })

    assert r.json()["instance_id"] == "jellyfin"
    assert [i.id for i in instances_store.list_instances()] == ["jellyfin"]
    assert _stored("jellyfin").route_mode == "direct"


def test_a_routed_record_is_not_turned_into_a_link(client):
    instances_store.upsert_instance(Instance(
        id="grafana", name="Grafana", type="external", subdomain="grafana", upstream="192.168.10.50:3000",
    ))

    r = client.post("/api/links", json={"name": "Grafana", "upstream": "192.168.10.50:3000", "instance_id": "grafana"})

    assert r.status_code == 409
    assert "remove its route first" in r.json()["detail"]
    assert _stored("grafana").route_mode == "proxy"


def test_a_machine_is_not_turned_into_a_link(client):
    client.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.50"})

    r = client.post("/api/links", json={"name": "NAS", "upstream": "192.168.10.50:5000", "instance_id": "nas"})

    assert r.status_code == 409
    assert _stored("nas").kind == "machine"


def test_deleting_a_link_needs_no_caddy(client):
    # Caddy isn't configured in the tests at all: a link's delete has no route to tear down.
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})

    assert client.delete("/api/instances/jellyfin").status_code == 200
    assert _stored("jellyfin") is None


# --- Where it shows ---


def test_the_dashboard_and_the_launcher_list_links(client, no_caddy_no_adguard):
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})
    client.post("/api/links", json={"name": "Router", "upstream": "192.168.10.1:80"})
    client.patch("/api/instances/router", json={"private": True})

    dashboard = client.get("/api/dashboard").json()["services"]
    launcher = client.get("/api/launcher").json()["services"]

    assert dashboard == [{"id": "jellyfin", "name": "Jellyfin", "url": "http://192.168.10.220:8096", "icon": None}]
    assert {(s["id"], s["url"], s["private"]) for s in launcher} == {
        ("jellyfin", "http://192.168.10.220:8096", False),
        ("router", "http://192.168.10.1:80", True),
    }


def test_route_rows_carry_where_each_opens(client, no_caddy_no_adguard):
    instances_store.upsert_instance(Instance(
        id="grafana", name="Grafana", type="external", subdomain="grafana", upstream="192.168.10.50:3000",
    ))
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})

    rows = {r["id"]: r for r in client.get("/api/caddy/routes").json()}

    assert rows["grafana"]["url"] == "https://grafana.example.no"
    assert rows["jellyfin"]["url"] == "http://192.168.10.220:8096"
    assert (rows["jellyfin"]["routed"], rows["jellyfin"]["synced"], rows["jellyfin"]["fqdn"]) == (False, None, None)


def test_sync_pushes_routes_and_leaves_links_alone():
    instances_store.upsert_instance(Instance(
        id="grafana", name="Grafana", type="external", subdomain="grafana", upstream="192.168.10.50:3000",
    ))
    instances_store.upsert_instance(Instance(
        id="jellyfin", name="Jellyfin", type="external", route_mode="direct", upstream="192.168.10.220:8096",
    ))
    pushed = []

    class FakeCaddy:
        async def delete_route(self, rid):
            pass

        async def push_route(self, route, http=False):
            pushed.append(route["@id"])

    results = asyncio.run(caddy_service.push_all(FakeCaddy(), "example.no"))

    assert [r["id"] for r in results] == ["grafana"]
    assert pushed == ["grafana"]


# --- Link and route, one into the other ---


def test_assign_a_url_makes_a_link_a_route(client, monkeypatch):
    pushed = []

    async def caddy_ok(_client, inst, _base):
        pushed.append(inst.id)

    monkeypatch.setattr(assign_module.caddy_service, "upsert_route", caddy_ok)
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})

    r = client.post("/api/routes", json={"prefix": "tv", "upstream": "192.168.10.220:8096", "instance_id": "jellyfin"})

    assert r.status_code == 200, r.text
    inst = _stored("jellyfin")
    assert (inst.route_mode, inst.subdomain, inst.name) == ("proxy", "tv", "Jellyfin")
    assert pushed == ["jellyfin"]
    assert client.get("/api/dashboard").json()["services"][0]["url"] == "https://tv.example.no"


def test_a_new_route_named_like_a_link_says_how(client, no_caddy_no_adguard):
    client.post("/api/links", json={"name": "Jellyfin", "upstream": "192.168.10.220:8096"})

    r = client.post("/api/routes", json={"prefix": "jellyfin", "upstream": "192.168.10.220:8096"})

    assert r.status_code == 409
    assert "Assign a URL" in r.json()["detail"]


def test_a_machine_that_moves_takes_its_links_along(client):
    client.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.50"})
    client.post("/api/links", json={"name": "NAS UI", "upstream": "192.168.10.50:5000"})

    r = client.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.60", "instance_id": "nas"})

    assert r.status_code == 200, r.text
    assert r.json()["moved"] == ["nas-ui"]
    assert _stored("nas-ui").upstream == "192.168.10.60:5000"


# --- Following its container ---


@pytest.fixture
def docker(monkeypatch):
    """Docker knows one container: Caddy dials it by its service name, a browser at the
    Docker host's published port."""
    monkeypatch.setattr(assign_module.docker_client, "container_names", lambda: {"whoami-whoami-1"})
    monkeypatch.setattr(follow, "derived_upstreams", lambda: {"whoami-whoami-1": "whoami:80"})
    monkeypatch.setattr(follow, "published_upstreams", lambda: {"whoami-whoami-1": "192.168.10.220:8081"})


def test_a_following_link_takes_the_browser_s_address(client, no_caddy_no_adguard, docker):
    r = client.post("/api/links", json={
        "name": "Whoami", "upstream": "", "container": "whoami-whoami-1", "follow_container": True,
    })

    assert r.status_code == 200, r.text
    assert _stored("whoami").upstream == "192.168.10.220:8081"  # never Caddy's `whoami:80`


def test_editing_a_record_can_t_move_it_to_another_container(client, no_caddy_no_adguard, monkeypatch):
    """By id, the request's container must be the record's: it was ignored while a following
    record took the other container's address, which the follower then wrote back."""
    monkeypatch.setattr(assign_module.docker_client, "container_names", lambda: {"a-1", "b-1"})
    monkeypatch.setattr(follow, "published_upstreams", lambda: {"a-1": "192.168.10.220:8081", "b-1": "192.168.10.220:8082"})
    monkeypatch.setattr(follow, "derived_upstreams", lambda: {"a-1": "a:80", "b-1": "b:80"})
    instances_store.upsert_instance(Instance(
        id="a", name="A", type="docker", container="a-1", upstream="192.168.10.220:8081",
        route_mode="direct", follow_container=True,
    ))

    for path, extra in (("/api/links", {"name": "A"}), ("/api/routes", {"prefix": "a"})):
        r = client.post(path, json={**extra, "upstream": "", "instance_id": "a", "container": "b-1",
                                    "follow_container": True})
        assert r.status_code == 409, r.text
        assert "container 'a-1'" in r.json()["detail"]
    assert _stored("a").upstream == "192.168.10.220:8081" and _stored("a").container == "a-1"

    # Its own container, as the page sends it when it sends one: edited as before.
    r = client.post("/api/links", json={"name": "A2", "upstream": "", "instance_id": "a", "container": "a-1",
                                        "follow_container": True})
    assert r.status_code == 200, r.text
    assert _stored("a").name == "A2"


def test_a_link_without_a_published_port_cannot_follow(client, no_caddy_no_adguard, monkeypatch):
    monkeypatch.setattr(assign_module.docker_client, "container_names", lambda: {"whoami-whoami-1"})
    monkeypatch.setattr(follow, "published_upstreams", lambda: {"whoami-whoami-1": None})

    r = client.post("/api/links", json={
        "name": "Whoami", "upstream": "", "container": "whoami-whoami-1", "follow_container": True,
    })

    assert r.status_code == 400
    assert _stored("whoami") is None


def test_the_follower_moves_a_link_without_pushing_anything(no_caddy_no_adguard, docker):
    instances_store.upsert_instance(Instance(
        id="whoami", name="Whoami", type="docker", container="whoami-whoami-1",
        route_mode="direct", upstream="192.168.10.220:8080", follow_container=True,
    ))

    moved = asyncio.run(follow.reconcile_all(caddy_client=None))

    assert moved == ["whoami-whoami-1"]
    assert _stored("whoami").upstream == "192.168.10.220:8081"


def test_the_follower_writes_nothing_once_a_link_became_a_route(docker):
    """Derived for a link, written to a record that is a route by then: refused, since a
    route's address may be Caddy's form, not the browser's."""
    instances_store.upsert_instance(Instance(
        id="whoami", name="Whoami", type="docker", container="whoami-whoami-1",
        subdomain="whoami", upstream="192.168.10.220:8080", follow_container=True,
    ))

    assert instances_store.follow_upstream("whoami", "192.168.10.220:8080", "192.168.10.220:8081", "direct") is None
    assert _stored("whoami").upstream == "192.168.10.220:8080"
