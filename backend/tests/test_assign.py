"""Tier-1: the cross-module assign — validation, uniqueness, and the Step 0/1/2
orchestration (Caddy required + rollback, AdGuard best-effort) via fake clients."""

import pytest

from loskai import config
from loskai.shared import assign
from loskai.shared import instances as instances_store
from loskai.shared.assign import AssignError
from loskai.shared.instances import Instance

BASE = "example.no"
IP = "192.168.10.101"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))


class FakeCaddy:
    def __init__(self, fail=False):
        self.fail = fail
        self.pushed: list[str] = []
        self.deleted: list[str] = []

    async def delete_route(self, route_id):
        if self.fail:
            import httpx

            raise httpx.ConnectError("caddy down")
        self.deleted.append(route_id)

    async def push_route(self, route):
        if self.fail:
            import httpx

            raise httpx.ConnectError("caddy down")
        self.pushed.append(route["@id"])


class FakeAdGuard:
    def __init__(self, configured=True, fail=False):
        self._configured = configured
        self.fail = fail
        self.added: list[tuple[str, str]] = []
        self.deleted: list[tuple[str, str]] = []

    def base_url(self):
        return "http://adguard" if self._configured else None

    async def add_rewrite(self, domain, answer):
        if self.fail:
            import httpx

            raise httpx.ConnectError("adguard down")
        self.added.append((domain, answer))

    async def delete_rewrite(self, domain, answer):
        self.deleted.append((domain, answer))


# --- Validation / uniqueness ---


def test_validate_prefix_rejects_bad_labels():
    for bad in ["", "Grafana", "has.dot", "-lead", "trail-", "under_score"]:
        with pytest.raises(AssignError):
            assign.validate_prefix(bad)


def test_validate_prefix_accepts_labels():
    assign.validate_prefix("grafana")
    assign.validate_prefix("uptime-kuma")


def test_validate_upstream_accepts_host_port():
    assign.validate_upstream("192.168.10.100:3000")
    assign.validate_upstream("grafana:3000")


def test_validate_upstream_rejects_scheme_path_and_bad_port():
    for bad in [
        "https://192.168.10.202:8006/",  # scheme + path (the Proxmox footgun)
        "http://grafana:3000",  # scheme
        "grafana:3000/app",  # path
        "192.168.10.100",  # no port
        "grafana:",  # empty port
        "grafana:99999",  # port out of range
        "grafana:abc",  # non-numeric port
        "has space:80",  # whitespace
        "",  # empty
    ]:
        with pytest.raises(AssignError):
            assign.validate_upstream(bad)


async def test_assign_rejects_url_upstream():
    with pytest.raises(AssignError) as exc:
        await assign.assign(
            FakeCaddy(), FakeAdGuard(), prefix="proxmox",
            upstream="https://192.168.10.202:8006/", base_domain=BASE, current_ip=IP,
        )
    assert exc.value.status_code == 422


async def test_assign_rejects_duplicate_subdomain():
    instances_store.upsert_instance(
        Instance(id="other", name="Other", type="external", subdomain="grafana")
    )
    with pytest.raises(AssignError) as exc:
        await assign.assign(
            FakeCaddy(), FakeAdGuard(), prefix="grafana", upstream="1.2.3.4:80",
            base_domain=BASE, current_ip=IP,
        )
    assert exc.value.status_code == 409


# --- Happy path (new external instance) ---


async def test_assign_sets_upstream_tls():
    caddy = FakeCaddy()
    await assign.assign(
        caddy, FakeAdGuard(), prefix="proxmox", upstream="192.168.10.202:8006",
        base_domain=BASE, current_ip=IP, upstream_tls=True,
    )
    inst = instances_store.get_instance("proxmox")
    assert inst.upstream_tls is True


async def test_assign_with_container_creates_docker_instance():
    result = await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="grafana", upstream="192.168.10.100:3000",
        base_domain=BASE, current_ip=IP, container="grafana",
    )
    assert result["caddy"] == "ok"
    inst = instances_store.get_instance("grafana")
    assert inst.type == "docker" and inst.container == "grafana"


async def test_container_assign_is_idempotent_no_duplicate():
    # Assign a URL to a container, then change it — must reuse the same instance.
    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="graf", upstream="graf:3000",
        base_domain=BASE, current_ip=IP, container="grafana",
    )
    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="dashboards", upstream="graf:3000",
        base_domain=BASE, current_ip=IP, container="grafana",
    )
    docker_instances = [i for i in instances_store.list_instances() if i.container == "grafana"]
    assert len(docker_instances) == 1  # no duplicate
    assert docker_instances[0].subdomain == "dashboards"  # URL changed on the same instance


async def test_assign_with_origin_creates_external_and_is_idempotent():
    # A built-in network service (AdGuard) routes as an external instance keyed by origin;
    # re-assigning it changes the URL on the same instance (no duplicate).
    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="adguard", upstream="adguard:3000",
        base_domain=BASE, current_ip=IP, origin="adguard", name="AdGuard",
    )
    inst = instances_store.get_by_origin("adguard")
    assert inst is not None and inst.type == "external" and inst.subdomain == "adguard"

    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="dns", upstream="adguard:3000",
        base_domain=BASE, current_ip=IP, origin="adguard", name="AdGuard",
    )
    linked = [i for i in instances_store.list_instances() if i.origin == "adguard"]
    assert len(linked) == 1 and linked[0].subdomain == "dns"


async def test_assign_creates_external_routes_and_rewrites():
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.assign(
        caddy, ag, prefix="nas", upstream="192.168.10.50:5000",
        base_domain=BASE, current_ip=IP, name="NAS",
    )
    assert result == {
        "caddy": "ok", "adguard": "ok",
        "url": "https://nas.example.no", "instance_id": "nas", "warning": None,
    }
    assert caddy.pushed == ["nas"]
    assert ag.added == [("nas.example.no", IP)]
    inst = instances_store.get_instance("nas")
    assert inst.type == "external" and inst.subdomain == "nas"
    assert inst.upstream == "192.168.10.50:5000" and inst.dns_answer == IP


# --- Caddy required: rollback ---


async def test_caddy_failure_rolls_back_new_instance():
    caddy = FakeCaddy(fail=True)
    with pytest.raises(AssignError) as exc:
        await assign.assign(
            caddy, FakeAdGuard(), prefix="nas", upstream="192.168.10.50:5000",
            base_domain=BASE, current_ip=IP,
        )
    assert exc.value.status_code == 502
    # The instance created in Step 0 was rolled back.
    assert instances_store.get_instance("nas") is None


async def test_caddy_failure_restores_existing_instance():
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container="grafana")
    )
    with pytest.raises(AssignError):
        await assign.assign(
            FakeCaddy(fail=True), FakeAdGuard(), instance_id="grafana",
            prefix="graf", upstream="192.168.10.100:3000", base_domain=BASE, current_ip=IP,
        )
    restored = instances_store.get_instance("grafana")
    assert restored.subdomain is None and restored.upstream is None


# --- AdGuard best-effort ---


async def test_adguard_failure_still_succeeds_with_warning():
    result = await assign.assign(
        FakeCaddy(), FakeAdGuard(fail=True), prefix="nas", upstream="192.168.10.50:5000",
        base_domain=BASE, current_ip=IP,
    )
    assert result["caddy"] == "ok" and result["adguard"] == "error"
    assert "won't resolve" in result["warning"]
    # Route persisted even though the rewrite failed; dns_answer not claimed.
    assert instances_store.get_instance("nas").dns_answer is None


async def test_adguard_skipped_when_unconfigured():
    result = await assign.assign(
        FakeCaddy(), FakeAdGuard(configured=False), prefix="nas",
        upstream="192.168.10.50:5000", base_domain=BASE, current_ip=IP,
    )
    assert result["adguard"] == "skipped"


async def test_no_answer_ip_skips_dns():
    result = await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="nas", upstream="192.168.10.50:5000",
        base_domain=BASE, current_ip=None,
    )
    assert result["adguard"] == "skipped"
    assert "CADDY_HOST_IP" in result["warning"]


# --- Unassign (the mirror) ---


async def test_unassign_clears_and_deletes():
    instances_store.upsert_instance(
        Instance(id="nas", name="NAS", type="external", subdomain="nas",
                 upstream="192.168.10.50:5000", dns_answer=IP)
    )
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.unassign(caddy, ag, "nas", base_domain=BASE)

    assert result["cleared"] is True and result["adguard"] == "ok"
    assert caddy.deleted == ["nas"]
    assert ag.deleted == [("nas.example.no", IP)]  # exact-pair delete
    inst = instances_store.get_instance("nas")
    assert inst.subdomain is None and inst.dns_answer is None  # instance survives


async def test_delete_external_instance_removes_route_and_record():
    instances_store.upsert_instance(
        Instance(id="nas", name="NAS", type="external", subdomain="nas",
                 upstream="192.168.10.50:5000", dns_answer=IP)
    )
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.delete_instance(caddy, ag, "nas", base_domain=BASE)

    assert result["deleted"] is True
    assert caddy.deleted == ["nas"]  # route removed
    assert ag.deleted == [("nas.example.no", IP)]  # rewrite removed
    assert instances_store.get_instance("nas") is None  # record gone


async def test_delete_unrouted_external_instance():
    instances_store.upsert_instance(Instance(id="old", name="Old", type="external"))
    result = await assign.delete_instance(FakeCaddy(), FakeAdGuard(), "old", base_domain=BASE)
    assert result["deleted"] is True
    assert instances_store.get_instance("old") is None


async def test_delete_docker_instance_removes_record():
    # A docker instance can now be deleted like any other — the route/record go, the
    # container is untouched (it just becomes unrouted, re-routable via Add route).
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container="grafana", subdomain="graf")
    )
    result = await assign.delete_instance(FakeCaddy(), FakeAdGuard(), "grafana", base_domain=BASE)
    assert result["deleted"] is True
    assert instances_store.get_instance("grafana") is None  # gone


async def test_unassign_caddy_failure_rolls_back():
    instances_store.upsert_instance(
        Instance(id="nas", name="NAS", type="external", subdomain="nas", dns_answer=IP)
    )
    with pytest.raises(AssignError):
        await assign.unassign(FakeCaddy(fail=True), FakeAdGuard(), "nas", base_domain=BASE)
    assert instances_store.get_instance("nas").subdomain == "nas"  # restored
