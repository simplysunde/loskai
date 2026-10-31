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
        self.http_pushed: list[str] = []
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

    async def push_http_route(self, route):
        # The `:80` server — a `scheme` of "http" or "both" pushes here as well.
        if self.fail:
            import httpx

            raise httpx.ConnectError("caddy down")
        self.http_pushed.append(route["@id"])


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


async def test_a_new_container_route_gets_its_recipes_icon(monkeypatch):
    monkeypatch.setattr(
        assign.recipes, "recipe_icon", lambda inst: inst.model_copy(update={"icon": "grafana.png"})
    )
    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="grafana", upstream="192.168.10.100:3000",
        base_domain=BASE, current_ip=IP, container="grafana-app-1",
    )
    assert instances_store.get_instance("grafana").icon == "grafana.png"


async def test_a_failed_icon_lookup_never_fails_the_route(monkeypatch):
    # The route is already in Caddy by then: it must still get its DNS rewrite.
    def broken(inst):
        raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")

    monkeypatch.setattr(assign.recipes, "recipe_icon", broken)
    adguard = FakeAdGuard()
    result = await assign.assign(
        FakeCaddy(), adguard, prefix="grafana", upstream="192.168.10.100:3000",
        base_domain=BASE, current_ip=IP, container="grafana-app-1",
    )
    assert result["caddy"] == "ok"
    assert adguard.added == [(f"grafana.{BASE}", IP)]
    assert instances_store.get_instance("grafana").icon is None


async def test_the_icon_keeps_a_change_made_while_it_was_looked_up(monkeypatch):
    # The follower re-points the route meanwhile; writing the icon mustn't undo that.
    def slow(inst):
        instances_store.follow_upstream(inst.id, inst.upstream, "192.168.10.100:3001")
        return inst.model_copy(update={"icon": "grafana.png"})

    monkeypatch.setattr(assign.recipes, "recipe_icon", slow)
    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="grafana", upstream="192.168.10.100:3000",
        base_domain=BASE, current_ip=IP, container="grafana-app-1", follow_container=True,
    )
    inst = instances_store.get_instance("grafana")
    assert inst.icon == "grafana.png" and inst.upstream == "192.168.10.100:3001"


async def test_an_existing_record_keeps_no_icon_once_removed(monkeypatch):
    # The user removed the icon; changing the route's URL mustn't bring it back.
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container="grafana-app-1", subdomain="grafana")
    )
    monkeypatch.setattr(
        assign.recipes, "recipe_icon", lambda inst: inst.model_copy(update={"icon": "grafana.png"})
    )
    await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="dashboards", upstream="192.168.10.100:3000",
        base_domain=BASE, current_ip=IP, container="grafana-app-1",
    )
    assert instances_store.get_instance("grafana").icon is None


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
        "url": "https://nas.example.no", "instance_id": "nas", "moved": [], "warning": None,
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
    # Both ids: a scheme:"both" instance has a plain-HTTP twin, and the teardown is
    # unconditional because the stored scheme may have changed since it was pushed.
    assert caddy.deleted == ["nas", "nas-http"]
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
    assert caddy.deleted == ["nas", "nas-http"]  # both possible routes removed
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


# --- DNS-only mode: no Caddy, AdGuard answer = the instance's own IP ---


def test_validate_prefix_dns_only_allows_multi_label():
    assign.validate_prefix("rack1.vm3", route_mode="dns_only")
    assign.validate_prefix("vm1", route_mode="dns_only")
    with pytest.raises(AssignError):
        assign.validate_prefix("Has.Upper", route_mode="dns_only")


def test_validate_upstream_dns_only_requires_bare_ip():
    assign.validate_upstream("192.168.10.55", route_mode="dns_only")
    for bad in ["192.168.10.55:22", "not-an-ip", "192.168.10.55/24", ""]:
        with pytest.raises(AssignError):
            assign.validate_upstream(bad, route_mode="dns_only")


async def test_assign_dns_only_skips_caddy():
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.assign(
        caddy, ag, prefix="vm1", upstream="192.168.10.55",
        base_domain=BASE, current_ip=IP, route_mode="dns_only",
    )
    assert result["caddy"] == "skipped"
    assert result["url"] == "vm1.example.no"  # no https:// — no TLS involved
    assert caddy.pushed == []  # no Caddy route ever pushed


async def test_assign_dns_only_writes_own_ip_as_adguard_answer():
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.assign(
        caddy, ag, prefix="vm1", upstream="192.168.10.55",
        base_domain=BASE, current_ip=IP, route_mode="dns_only",
    )
    assert result["adguard"] == "ok"
    assert ag.added == [("vm1.example.no", "192.168.10.55")]  # own IP, not the shared current_ip
    inst = instances_store.get_instance("vm1")
    assert inst.dns_answer == "192.168.10.55"


async def test_assign_dns_only_allows_multi_label_prefix():
    result = await assign.assign(
        FakeCaddy(), FakeAdGuard(), prefix="rack1.vm3", upstream="192.168.10.60",
        base_domain=BASE, current_ip=IP, route_mode="dns_only",
    )
    assert result["url"] == "rack1.vm3.example.no"


async def test_assign_proxy_still_rejects_multi_label_and_bare_ip():
    with pytest.raises(AssignError):
        await assign.assign(
            FakeCaddy(), FakeAdGuard(), prefix="rack1.vm3", upstream="192.168.10.60:80",
            base_domain=BASE, current_ip=IP,
        )
    with pytest.raises(AssignError):
        await assign.assign(
            FakeCaddy(), FakeAdGuard(), prefix="vm1", upstream="192.168.10.55",
            base_domain=BASE, current_ip=IP,
        )


async def test_unassign_dns_only_deletes_own_answer():
    instances_store.upsert_instance(
        Instance(id="vm1", name="vm1", type="external", subdomain="vm1",
                 upstream="192.168.10.55", route_mode="dns_only", dns_answer="192.168.10.55")
    )
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.unassign(caddy, ag, "vm1", base_domain=BASE)

    assert result["cleared"] is True
    assert caddy.deleted == ["vm1", "vm1-http"]  # harmless no-op deletes, 404-safe
    assert ag.deleted == [("vm1.example.no", "192.168.10.55")]


async def test_mode_switch_proxy_to_dns_only_tears_down_caddy_route():
    instances_store.upsert_instance(
        Instance(id="box", name="box", type="external", subdomain="box",
                 upstream="192.168.10.70:80", route_mode="proxy", dns_answer=IP)
    )
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.assign(
        caddy, ag, instance_id="box", prefix="box", upstream="192.168.10.70",
        base_domain=BASE, current_ip=IP, route_mode="dns_only",
    )
    assert result["caddy"] == "skipped"
    assert caddy.deleted == ["box", "box-http"]  # stale proxy routes torn down
    assert caddy.pushed == []
    assert ag.added == [("box.example.no", "192.168.10.70")]  # now answers with its own IP
    # The old rewrite (same domain, shared Caddy IP) must be cleaned up too, or AdGuard
    # ends up with two answers for "box.example.no" — the bug this test now guards against.
    assert ag.deleted == [("box.example.no", IP)]
    inst = instances_store.get_instance("box")
    assert inst.route_mode == "dns_only" and inst.dns_answer == "192.168.10.70"


async def test_mode_switch_dns_only_to_proxy_creates_caddy_route():
    instances_store.upsert_instance(
        Instance(id="box", name="box", type="external", subdomain="box",
                 upstream="192.168.10.70", route_mode="dns_only", dns_answer="192.168.10.70")
    )
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.assign(
        caddy, ag, instance_id="box", prefix="box", upstream="192.168.10.70:8080",
        base_domain=BASE, current_ip=IP, route_mode="proxy",
    )
    assert result["caddy"] == "ok"
    assert caddy.pushed == ["box"]
    assert ag.added == [("box.example.no", IP)]  # now answers with the shared Caddy IP
    # The old rewrite (same domain, the instance's own IP) must be cleaned up too.
    assert ag.deleted == [("box.example.no", "192.168.10.70")]
    inst = instances_store.get_instance("box")
    assert inst.route_mode == "proxy" and inst.dns_answer == IP


async def test_dns_only_reassign_to_new_ip_cleans_up_old_rewrite():
    # Same bug class, no mode switch involved: repointing a dns_only instance to a new
    # IP, same subdomain, must delete the stale (domain, old-IP) rewrite too.
    instances_store.upsert_instance(
        Instance(id="vm1", name="vm1", type="external", subdomain="vm1",
                 upstream="192.168.10.55", route_mode="dns_only", dns_answer="192.168.10.55")
    )
    caddy, ag = FakeCaddy(), FakeAdGuard()
    result = await assign.assign(
        caddy, ag, instance_id="vm1", prefix="vm1", upstream="192.168.10.60",
        base_domain=BASE, current_ip=IP, route_mode="dns_only",
    )
    assert result["adguard"] == "ok"
    assert ag.added == [("vm1.example.no", "192.168.10.60")]
    assert ag.deleted == [("vm1.example.no", "192.168.10.55")]
    assert instances_store.get_instance("vm1").dns_answer == "192.168.10.60"


# --- Machines as upstreams (Phase 21b) ---


async def name_machine(caddy, ag, prefix="nas", ip="192.168.10.50", *, edit=False):
    """Name a machine, or move one — an edit passes `instance_id`, exactly as the Routing
    table's Change URL does."""
    return await assign.assign(
        caddy, ag, prefix=prefix, upstream=ip, base_domain=BASE, current_ip=IP,
        route_mode="dns_only", name=prefix,
        instance_id=prefix if edit else None,
    )


def test_move_upstream_keeps_the_port():
    assert assign.move_upstream("192.168.10.50:3000", "192.168.10.60") == "192.168.10.60:3000"


async def route(caddy, ag, prefix, upstream, **kw):
    return await assign.assign(
        caddy, ag, prefix=prefix, upstream=upstream, base_domain=BASE, current_ip=IP, **kw
    )


async def test_moving_a_machine_moves_every_route_on_its_address():
    # A route is on a machine by its address alone — nothing was linked, and both move.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    for svc, port in [("plex", "32400"), ("files", "5000")]:
        await route(caddy, ag, svc, f"192.168.10.50:{port}")

    result = await name_machine(caddy, ag, ip="192.168.10.60", edit=True)  # the NAS moves

    assert sorted(result["moved"]) == ["files", "plex"]
    assert instances_store.get_instance("plex").upstream == "192.168.10.60:32400"
    assert instances_store.get_instance("files").upstream == "192.168.10.60:5000"
    # ...and Caddy was told, not just the store.
    assert sorted(caddy.pushed[-2:]) == ["files", "plex"]


async def test_routes_on_other_addresses_are_left_alone_when_a_machine_moves():
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    await route(caddy, ag, "elsewhere", "192.168.10.99:8080")
    await route(caddy, ag, "shorter", "192.168.10.5:8080")  # a prefix of the address, not it

    result = await name_machine(caddy, ag, ip="192.168.10.60", edit=True)

    assert result["moved"] == []
    assert instances_store.get_instance("elsewhere").upstream == "192.168.10.99:8080"
    assert instances_store.get_instance("shorter").upstream == "192.168.10.5:8080"


async def test_a_route_following_its_container_stays_with_the_container():
    # Its address is the container's: the follower would only write the old one back.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    await route(caddy, ag, "whoami", "192.168.10.50:8081", follow_container=True)

    result = await name_machine(caddy, ag, ip="192.168.10.60", edit=True)

    assert result["moved"] == []
    assert instances_store.get_instance("whoami").upstream == "192.168.10.50:8081"


async def test_a_machine_assign_that_changes_nothing_repushes_nothing():
    # A no-op edit must not re-push half the estate.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    await route(caddy, ag, "plex", "192.168.10.50:32400")
    before = list(caddy.pushed)

    result = await name_machine(caddy, ag, edit=True)  # same IP again

    assert result["moved"] == []
    assert caddy.pushed == before


class PickyCaddy(FakeCaddy):
    """Fails the push for named routes only — so a machine's own assign still succeeds
    and the *dependent* re-push is what breaks."""

    def __init__(self, fail_ids):
        super().__init__()
        self.fail_ids = set(fail_ids)

    async def push_route(self, route):
        if route["@id"] in self.fail_ids:
            import httpx

            raise httpx.ConnectError("caddy down")
        await super().push_route(route)


async def test_a_failed_repush_warns_but_keeps_the_store_correct():
    # Sync repairs Caddy from the store, so the store must already hold the new address.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    await route(caddy, ag, "plex", "192.168.10.50:32400")
    caddy = PickyCaddy({"plex"})

    result = await name_machine(caddy, ag, ip="192.168.10.60", edit=True)

    assert result["moved"] == ["plex"]
    assert "next Sync" in result["warning"]
    assert instances_store.get_instance("plex").upstream == "192.168.10.60:32400"


async def test_two_machines_cannot_share_an_address():
    # A route's machine is the one at its address, so a second one there would be ambiguous.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)

    with pytest.raises(AssignError) as exc:
        await name_machine(caddy, ag, prefix="other")

    assert exc.value.status_code == 409
    assert instances_store.get_instance("other") is None
    await name_machine(caddy, ag, edit=True)  # the machine itself may keep its address


async def test_deleting_a_machine_leaves_the_routes_on_its_address_as_they_are():
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    await route(caddy, ag, "plex", "192.168.10.50:32400")

    result = await assign.delete_instance(caddy, ag, "nas", base_domain=BASE)

    assert result == {"deleted": True, "instance_id": "nas"}
    assert instances_store.get_instance("plex").upstream == "192.168.10.50:32400"


async def test_a_rename_alone_moves_nothing():
    # Nothing to carry: the routes hold an IP, and the IP did not move.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await name_machine(caddy, ag)
    await route(caddy, ag, "plex", "192.168.10.50:32400")

    result = await assign.assign(
        caddy, ag, prefix="storage", upstream="192.168.10.50", base_domain=BASE,
        current_ip=IP, route_mode="dns_only", instance_id="nas",
    )

    assert result["moved"] == []
    assert instances_store.get_instance("plex").upstream == "192.168.10.50:32400"


async def test_a_stored_machine_link_from_before_is_read_and_dropped(monkeypatch):
    # Records written while routes linked to machines carry `machine`; it means nothing now,
    # so they load as they are and the next write leaves it out.
    from loskai.shared import store

    path = instances_store._path()
    store.write_json(path, [{
        "id": "plex", "name": "plex", "type": "external", "subdomain": "plex",
        "upstream": "192.168.10.50:32400", "machine": "nas",
    }])

    plex = instances_store.get_instance("plex")
    instances_store.upsert_instance(plex)

    assert plex.upstream == "192.168.10.50:32400"
    assert "machine" not in store.read_json(path, [])[0]


# --- The two verbs (thin wrappers over one orchestration) ---


async def test_name_machine_wrapper_makes_a_machine():
    caddy, ag = FakeCaddy(), FakeAdGuard()

    result = await assign.name_machine(
        caddy, ag, prefix="nas", upstream="192.168.10.50", base_domain=BASE, current_ip=IP,
    )

    assert result["caddy"] == "skipped"  # no reverse proxy involved
    assert instances_store.is_machine(instances_store.get_instance("nas"))


async def test_assign_route_wrapper_publishes_a_service():
    caddy, ag = FakeCaddy(), FakeAdGuard()

    result = await assign.assign_route(
        caddy, ag, prefix="grafana", upstream="192.168.10.50:3000",
        base_domain=BASE, current_ip=IP,
    )

    assert result["caddy"] == "ok"
    assert caddy.pushed == ["grafana"]
    assert result["url"] == "https://grafana.example.no"


async def test_the_verb_decides_the_kind():
    caddy, ag = FakeCaddy(), FakeAdGuard()

    await assign.name_machine(
        caddy, ag, prefix="nas", upstream="192.168.10.50", base_domain=BASE, current_ip=IP,
    )
    await assign.assign_route(
        caddy, ag, prefix="grafana", upstream="192.168.10.50:3000",
        base_domain=BASE, current_ip=IP,
    )

    assert instances_store.get_instance("nas").kind == "machine"
    assert instances_store.get_instance("grafana").kind == "service"


async def test_re_pointing_a_machine_at_a_port_makes_it_a_service():
    # `kind` is not frozen at creation: it follows what the instance was last assigned as.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await assign.name_machine(
        caddy, ag, prefix="nas", upstream="192.168.10.50", base_domain=BASE, current_ip=IP,
    )

    await assign.assign_route(
        caddy, ag, prefix="nas", upstream="192.168.10.50:5000", base_domain=BASE,
        current_ip=IP, instance_id="nas",
    )

    nas = instances_store.get_instance("nas")
    assert nas.kind == "service"
    assert not instances_store.is_machine(nas)


# --- Naming a machine must not depend on Caddy (Phase 21e follow-up) ---


async def test_naming_a_machine_works_with_caddy_down():
    # A machine has no route, so there is nothing for Caddy to do. The teardown call used
    # to run unconditionally and take the whole operation down with it.
    caddy, ag = FakeCaddy(fail=True), FakeAdGuard()

    result = await assign.name_machine(
        caddy, ag, prefix="nas", upstream="192.168.10.50", base_domain=BASE, current_ip=IP,
    )

    assert result["caddy"] == "skipped"
    assert instances_store.get_instance("nas").kind == "machine"


async def test_converting_a_proxy_route_to_a_machine_still_needs_caddy():
    # The other half: this one *has* a route, and leaving it behind would keep Caddy
    # answering a name the instance no longer proxies. That must fail loudly and roll back.
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await assign.assign_route(
        caddy, ag, prefix="grafana", upstream="192.168.10.50:3000",
        base_domain=BASE, current_ip=IP,
    )
    caddy.fail = True

    with pytest.raises(AssignError) as exc:
        await assign.name_machine(
            caddy, ag, prefix="grafana", upstream="192.168.10.50", base_domain=BASE,
            current_ip=IP, instance_id="grafana",
        )

    assert exc.value.status_code == 502
    # Rolled back: still the proxied service it was.
    assert instances_store.get_instance("grafana").route_mode == "proxy"


async def test_converting_tears_the_route_down_when_caddy_is_up():
    caddy, ag = FakeCaddy(), FakeAdGuard()
    await assign.assign_route(
        caddy, ag, prefix="grafana", upstream="192.168.10.50:3000",
        base_domain=BASE, current_ip=IP,
    )

    await assign.name_machine(
        caddy, ag, prefix="grafana", upstream="192.168.10.50", base_domain=BASE,
        current_ip=IP, instance_id="grafana",
    )

    assert caddy.deleted[-2:] == ["grafana", "grafana-http"]
    assert instances_store.get_instance("grafana").kind == "machine"


async def test_an_http_route_reports_an_http_url():
    # A card or banner linking https:// to a name with no certificate cannot connect.
    caddy, ag = FakeCaddy(), FakeAdGuard()

    result = await assign.assign_route(
        caddy, ag, prefix="tv", upstream="192.168.10.50:8080",
        base_domain=BASE, current_ip=IP, scheme="http",
    )

    assert result["url"] == "http://tv.example.no"


async def test_https_and_both_still_report_https():
    caddy, ag = FakeCaddy(), FakeAdGuard()

    both = await assign.assign_route(
        caddy, ag, prefix="printer", upstream="192.168.10.50:80",
        base_domain=BASE, current_ip=IP, scheme="both",
    )
    plain = await assign.assign_route(
        caddy, ag, prefix="grafana", upstream="192.168.10.50:3000",
        base_domain=BASE, current_ip=IP,
    )

    assert both["url"] == "https://printer.example.no"
    assert plain["url"] == "https://grafana.example.no"
