"""Tier-1: Caddy pure logic — FQDN, route JSON, mode, Caddyfile render."""

import pytest

from loskai import config
from loskai.modules.caddy import service
from loskai.modules.caddy.client import CaddyError
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance

BASE = "example.no"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))


def test_assemble_fqdn():
    assert service.assemble_fqdn("grafana", "example.no") == "grafana.example.no"


def test_caddy_mode():
    assert service.caddy_mode("http://192.168.10.101:2019") == "lan"
    assert service.caddy_mode("http://caddy:2019") == "docker"
    assert service.caddy_mode(None) is None
    # Loopback is an IP, so it reads as `lan` — correct for what this now is, a coarse
    # display summary for /api/caddy/status. It no longer decides any upstream: that is
    # per-container in docker.logic.upstream_mode, and a loopback CADDY_ADMIN_URL is
    # separately refused as a DNS answer (shared.settings._usable_answer_ip).
    assert service.caddy_mode("http://127.0.0.1:2019") == "lan"
    assert service.caddy_mode("http://[::1]:2019") == "lan"
    assert service.caddy_mode("http://localhost:2019") == "docker"  # a hostname, not an IP


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


# --- list_with_sync / push_all: dns_only instances are excluded from the Caddy projection ---


class FakeClient:
    """Two servers, because Caddy has two: `live_ids` are in the `:443` routing server and
    `http_live_ids` in the `:80` one. `has_http_server=False` models a Caddy with no `:80`
    site at all, where a plain-HTTP route has nowhere to go."""

    def __init__(self, live_ids=(), fails_map=None, http_live_ids=(), has_http_server=True):
        self._live_ids = set(live_ids)
        self._fails_map = fails_map or {}
        self._http_live_ids = set(http_live_ids)
        self._has_http_server = has_http_server
        self.pushed: list[str] = []
        self.http_pushed: list[str] = []
        self.deleted: list[str] = []

    async def list_live_routes(self):
        return [{"@id": i} for i in self._live_ids]

    async def list_live_http_routes(self):
        return [{"@id": i} for i in self._http_live_ids]

    async def upstreams(self):
        return [{"address": addr, "fails": fails} for addr, fails in self._fails_map.items()]

    async def delete_route(self, route_id):
        self.deleted.append(route_id)

    async def push_route(self, route):
        self.pushed.append(route["@id"])

    async def push_http_route(self, route):
        if not self._has_http_server:
            raise CaddyError("Caddy has no :80 server — a plain-HTTP route has nowhere to go")
        self.http_pushed.append(route["@id"])


async def test_list_with_sync_dns_only_row_is_na_for_route_and_live():
    instances_store.upsert_instance(
        Instance(id="vm1", name="vm1", type="external", subdomain="vm1",
                 upstream="192.168.10.55", route_mode="dns_only")
    )
    rows = await service.list_with_sync(FakeClient(live_ids=[], fails_map={}), BASE)
    row = rows[0]
    assert row["route_mode"] == "dns_only"
    assert row["routed"] is True  # has a subdomain
    assert row["fqdn"] == "vm1.example.no"
    assert row["synced"] is None  # N/A — no Caddy route exists to be synced
    assert row["upstream_healthy"] is None  # N/A — Caddy never proxies this upstream


async def test_list_with_sync_proxy_row_unaffected():
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker",
                 subdomain="grafana", upstream="192.168.10.100:3000")
    )
    rows = await service.list_with_sync(
        FakeClient(live_ids=["grafana"], fails_map={"192.168.10.100:3000": 0}), BASE
    )
    row = rows[0]
    assert row["route_mode"] == "proxy"
    assert row["synced"] is True
    assert row["upstream_healthy"] is True


async def test_push_all_skips_dns_only_instances():
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker",
                 subdomain="grafana", upstream="192.168.10.100:3000")
    )
    instances_store.upsert_instance(
        Instance(id="vm1", name="vm1", type="external", subdomain="vm1",
                 upstream="192.168.10.55", route_mode="dns_only")
    )
    client = FakeClient()
    results = await service.push_all(client, BASE)

    assert client.pushed == ["grafana"]  # only the proxy instance is pushed
    assert [r["id"] for r in results] == ["grafana"]  # dns_only isn't even reported


# --- Root certificate (pure) ---

ROOT_PEM = "-----BEGIN CERTIFICATE-----\nMIIBozCCAUmg\n-----END CERTIFICATE-----"


def test_root_certificate_hands_out_the_root_not_the_intermediate():
    """A device installs the *root* as a trust anchor; the intermediate is what Caddy
    signs leaves with and needs no separate install."""
    cert = service.root_certificate(
        {
            "root_certificate": ROOT_PEM,
            "intermediate_certificate": "-----BEGIN CERTIFICATE-----\nINTERMEDIATE\n-----END CERTIFICATE-----",
            "root_common_name": "Caddy Local Authority - 2026 ECC Root",
        }
    )

    assert cert is not None
    assert "INTERMEDIATE" not in cert["pem"]
    assert cert["pem"].startswith("-----BEGIN CERTIFICATE-----")
    assert cert["pem"].endswith("-----END CERTIFICATE-----\n")  # trailing newline: it's a file
    assert cert["common_name"] == "Caddy Local Authority - 2026 ECC Root"
    assert cert["filename"] == "caddy-root.crt"


def test_root_certificate_none_when_ca_has_no_root():
    """An ACME deployment has no internal CA — the router turns this into a 409, not a
    download of an empty file."""
    assert service.root_certificate({}) is None
    assert service.root_certificate({"root_certificate": ""}) is None


def test_root_certificate_rejects_a_truncated_pem():
    """The file is fed straight into a system trust store. A body missing its END marker
    must fail here — installed as-is it fails later, at the browser, after the user
    believes they've already fixed the warning."""
    assert service.root_certificate({"root_certificate": "-----BEGIN CERTIFICATE-----\nMIIBo"}) is None


# --- Per-route scheme (Phase 12b) ---


def svc(id_, scheme="https", **kw):
    return Instance(
        id=id_, name=id_, type="external", subdomain=id_,
        upstream="192.168.10.50:80", scheme=scheme, **kw
    )


def test_select_http_server_picks_the_80_site_not_the_routing_one():
    servers = {
        "srv0": {"listen": [":443"], "routes": []},
        "srv1": {"listen": [":80"], "routes": []},
    }

    assert service.select_server_name(servers) == "srv0"
    assert service.select_http_server_name(servers) == "srv1"


def test_no_http_server_is_none_not_a_fallback():
    # Falling back to the routing server would serve a "plain HTTP" route over TLS.
    servers = {"srv0": {"listen": [":443"], "routes": []}}

    assert service.select_http_server_name(servers) is None


def test_the_http_twin_is_the_same_route_under_a_different_id():
    inst = svc("grafana", scheme="both")

    https_route = service.build_route(inst, BASE)
    http_route = service.build_route(inst, BASE, route_id=service.http_route_id("grafana"))

    assert https_route["@id"] == "grafana"
    assert http_route["@id"] == "grafana-http"
    assert http_route["match"] == https_route["match"]
    assert http_route["handle"] == https_route["handle"]


def test_expected_ids_per_scheme():
    assert service.expected_route_ids(svc("a", scheme="https")) == ["a"]
    assert service.expected_route_ids(svc("a", scheme="http")) == ["a-http"]
    assert service.expected_route_ids(svc("a", scheme="both")) == ["a", "a-http"]
    # dns_only has no Caddy route of any kind.
    assert service.expected_route_ids(svc("a", route_mode="dns_only")) == []


async def test_https_pushes_only_to_443_and_clears_any_http_twin():
    client = FakeClient()

    await service.upsert_route(client, svc("grafana", scheme="https"), BASE)

    assert client.pushed == ["grafana"]
    assert client.http_pushed == []
    assert "grafana-http" in client.deleted  # a previous `both`/`http` twin is removed


async def test_http_only_never_lands_in_the_443_server():
    # Absence there is what stops Caddy trying to issue a certificate for the name.
    client = FakeClient()

    await service.upsert_route(client, svc("tv", scheme="http"), BASE)

    assert client.pushed == []
    assert client.http_pushed == ["tv-http"]
    assert "tv" in client.deleted


async def test_both_pushes_one_route_into_each_server():
    client = FakeClient()

    await service.upsert_route(client, svc("printer", scheme="both"), BASE)

    assert client.pushed == ["printer"]
    assert client.http_pushed == ["printer-http"]


async def test_switching_scheme_converges_without_a_migration():
    client = FakeClient()
    await service.upsert_route(client, svc("x", scheme="both"), BASE)
    client.pushed.clear(); client.http_pushed.clear(); client.deleted.clear()

    await service.upsert_route(client, svc("x", scheme="https"), BASE)

    assert client.pushed == ["x"]
    assert client.http_pushed == []
    assert "x-http" in client.deleted  # the twin it no longer wants


async def test_plain_http_without_an_80_server_fails_loudly():
    client = FakeClient(has_http_server=False)

    with pytest.raises(CaddyError):
        await service.upsert_route(client, svc("tv", scheme="http"), BASE)


async def test_both_is_synced_only_when_both_routes_are_live(data_dir):
    instances_store.upsert_instance(svc("printer", scheme="both"))

    half = await service.list_with_sync(FakeClient(live_ids=["printer"]), BASE)
    full = await service.list_with_sync(
        FakeClient(live_ids=["printer"], http_live_ids=["printer-http"]), BASE
    )

    assert half[0]["synced"] is False  # the :80 half is missing
    assert full[0]["synced"] is True


async def test_an_http_only_row_syncs_on_its_own_id(data_dir):
    instances_store.upsert_instance(svc("tv", scheme="http"))

    rows = await service.list_with_sync(
        FakeClient(live_ids=[], http_live_ids=["tv-http"]), BASE
    )

    assert rows[0]["synced"] is True
    assert rows[0]["scheme"] == "http"
