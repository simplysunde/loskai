"""Tier-1: the AdGuard reconcile — (domain, answer) diffing, dns_answer orphan
migration, manual-conflict detection. The trickiest logic in the app, covered thoroughly.
"""

import pytest

from loskai.modules.adguard import service
from loskai.shared import instances as instances_store
from loskai.shared.errors import LoskaiError
from loskai.shared.instances import Instance

BASE = "example.no"
IP = "192.168.10.101"


def inst(id_, sub, dns_answer=None):
    return Instance(id=id_, name=id_, type="docker", subdomain=sub, dns_answer=dns_answer)


def rw(domain, answer):
    return {"domain": domain, "answer": answer, "enabled": True}


def test_add_when_missing():
    plan = service.plan_reconcile([inst("grafana", "grafana")], [], BASE, IP)
    assert plan.adds == [("grafana.example.no", IP)]
    assert plan.deletes == []
    assert plan.conflicts == []


def test_in_sync_when_present():
    existing = [rw("grafana.example.no", IP)]
    plan = service.plan_reconcile([inst("grafana", "grafana", IP)], existing, BASE, IP)
    assert plan.adds == []
    assert plan.in_sync == ["grafana"]


def test_orphan_migration_on_ip_change():
    # Caddy IP moved .101 -> .102; the instance recorded the old answer.
    old = "192.168.10.101"
    new = "192.168.10.102"
    existing = [rw("grafana.example.no", old)]
    plan = service.plan_reconcile(
        [inst("grafana", "grafana", dns_answer=old)], existing, BASE, new
    )
    assert plan.adds == [("grafana.example.no", new)]
    assert plan.deletes == [("grafana.example.no", old)]  # our stale pair removed
    assert plan.conflicts == []


def test_manual_conflict_is_reported_not_deleted():
    # A hand-added answer we never wrote (dns_answer is None).
    existing = [rw("grafana.example.no", "10.0.0.9")]
    plan = service.plan_reconcile([inst("grafana", "grafana")], existing, BASE, IP)
    assert plan.adds == [("grafana.example.no", IP)]  # still ensure ours exists
    assert plan.deletes == []  # never delete a foreign answer
    assert plan.conflicts == [
        {"id": "grafana", "domain": "grafana.example.no", "answers": ["10.0.0.9"]}
    ]


def test_stale_answer_is_not_a_conflict():
    # An entry equal to our stored dns_answer is our stale pair, not a manual conflict.
    old = "192.168.10.50"
    existing = [rw("grafana.example.no", old), rw("grafana.example.no", IP)]
    plan = service.plan_reconcile(
        [inst("grafana", "grafana", dns_answer=old)], existing, BASE, IP
    )
    assert plan.adds == []  # current already present
    assert plan.deletes == [("grafana.example.no", old)]
    assert plan.conflicts == []


def test_unrouted_instance_is_skipped():
    plan = service.plan_reconcile([inst("x", None)], [], BASE, IP)
    assert plan.adds == [] and plan.deletes == [] and plan.in_sync == []


def test_dns_status_rows():
    existing = [rw("a.example.no", IP), rw("b.example.no", "10.0.0.5")]
    rows = service.dns_status_rows(
        [inst("a", "a"), inst("b", "b"), inst("c", "c")], existing, BASE, IP
    )
    by_id = {r["id"]: r for r in rows}
    assert by_id["a"]["present"] is True and by_id["a"]["conflict"] is False
    assert by_id["b"]["present"] is False and by_id["b"]["conflict"] is True
    assert by_id["c"]["present"] is False and by_id["c"]["conflict"] is False


def test_dns_status_unknown_when_adguard_down():
    rows = service.dns_status_rows([inst("a", "a")], None, BASE, IP)
    assert rows[0]["present"] is None


def test_dns_status_unknown_without_answer_ip():
    rows = service.dns_status_rows([inst("a", "a")], [], BASE, None)
    assert rows[0]["present"] is None


def dns_only(id_, sub, upstream, dns_answer=None):
    return Instance(id=id_, name=id_, type="external", subdomain=sub,
                     upstream=upstream, route_mode="dns_only", dns_answer=dns_answer)


def test_plan_reconcile_mixed_batch_targets_per_instance_answer():
    # A proxy instance targets the shared answer_ip; a dns_only instance targets its own IP.
    routed = [inst("grafana", "grafana"), dns_only("vm1", "vm1", "192.168.10.55")]
    plan = service.plan_reconcile(routed, [], BASE, IP)
    assert set(plan.adds) == {("grafana.example.no", IP), ("vm1.example.no", "192.168.10.55")}


def test_dns_status_rows_dns_only_independent_of_current_ip():
    # A dns_only row can report present/missing even with no answer_ip configured at all.
    existing = [rw("vm1.example.no", "192.168.10.55")]
    rows = service.dns_status_rows([dns_only("vm1", "vm1", "192.168.10.55")], existing, BASE, None)
    assert rows[0]["present"] is True
    assert rows[0]["target"] == "192.168.10.55"


# --- Orchestration (executor) with a fake client ---


class FakeClient:
    def __init__(self, existing):
        self.existing = list(existing)
        self.added: list[tuple[str, str]] = []
        self.deleted: list[tuple[str, str]] = []

    async def list_rewrites(self):
        return self.existing

    async def add_rewrite(self, domain, answer):
        self.added.append((domain, answer))

    async def delete_rewrite(self, domain, answer):
        self.deleted.append((domain, answer))


async def test_reconcile_adds_and_persists_dns_answer(data_dir):
    instances_store.upsert_instance(inst("grafana", "grafana"))
    client = FakeClient(existing=[])

    result = await service.reconcile(client, BASE, IP)

    assert client.added == [("grafana.example.no", IP)]
    assert result["added"] == ["grafana.example.no"]
    # dns_answer is recorded so a later IP change can migrate the orphan.
    assert instances_store.get_instance("grafana").dns_answer == IP


async def test_reconcile_migrates_orphan_on_ip_change(data_dir):
    old, new = "192.168.10.101", "192.168.10.102"
    instances_store.upsert_instance(inst("grafana", "grafana", dns_answer=old))
    client = FakeClient(existing=[rw("grafana.example.no", old)])

    result = await service.reconcile(client, BASE, new)

    assert client.added == [("grafana.example.no", new)]
    assert client.deleted == [("grafana.example.no", old)]
    assert result["deleted"] == ["grafana.example.no"]
    assert instances_store.get_instance("grafana").dns_answer == new


async def test_reconcile_requires_answer_ip_for_proxy_instance(data_dir):
    # answer_ip is only required when a `proxy` instance is actually routed.
    instances_store.upsert_instance(inst("grafana", "grafana"))
    with pytest.raises(LoskaiError, match="CADDY_HOST_IP"):
        await service.reconcile(FakeClient([]), BASE, None)


async def test_reconcile_persists_dns_answer_per_mode_in_mixed_run(data_dir):
    instances_store.upsert_instance(inst("grafana", "grafana"))
    instances_store.upsert_instance(
        Instance(id="vm1", name="vm1", type="external", subdomain="vm1",
                 upstream="192.168.10.55", route_mode="dns_only")
    )
    client = FakeClient(existing=[])

    await service.reconcile(client, BASE, IP)

    assert instances_store.get_instance("grafana").dns_answer == IP
    assert instances_store.get_instance("vm1").dns_answer == "192.168.10.55"


async def test_reconcile_no_answer_ip_needed_when_dns_only_only(data_dir):
    # A LAN made entirely of dns_only instances needs no CADDY_HOST_IP at all.
    instances_store.upsert_instance(
        Instance(id="vm1", name="vm1", type="external", subdomain="vm1",
                 upstream="192.168.10.55", route_mode="dns_only")
    )
    client = FakeClient(existing=[])

    result = await service.reconcile(client, BASE, None)

    assert client.added == [("vm1.example.no", "192.168.10.55")]
    assert result["added"] == ["vm1.example.no"]
    assert instances_store.get_instance("vm1").dns_answer == "192.168.10.55"


# --- consistency_warnings (the /api/health drift check) ---


def test_consistency_missing_rewrite():
    warns = service.consistency_warnings([inst("grafana", "grafana")], [], BASE, IP)
    assert len(warns) == 1
    assert warns[0]["kind"] == "dns_missing"
    assert warns[0]["id"] == "grafana"


def test_consistency_says_whether_it_is_a_machine():
    # The sidebar flags Routing for a service and Machines for a machine — each its own.
    nas = Instance(id="nas", name="nas", type="external", kind="machine", subdomain="nas",
                   upstream="192.168.10.50", route_mode="dns_only")
    warns = service.consistency_warnings([inst("grafana", "grafana"), nas], [], BASE, IP)
    assert {w["id"]: w["machine"] for w in warns} == {"grafana": False, "nas": True}


def test_consistency_conflict_on_foreign_answer():
    existing = [rw("grafana.example.no", IP), rw("grafana.example.no", "10.9.9.9")]
    warns = service.consistency_warnings([inst("grafana", "grafana", IP)], existing, BASE, IP)
    kinds = {w["kind"] for w in warns}
    assert kinds == {"dns_conflict"}


def test_consistency_silent_when_in_sync():
    existing = [rw("grafana.example.no", IP)]
    warns = service.consistency_warnings([inst("grafana", "grafana", IP)], existing, BASE, IP)
    assert warns == []


def test_consistency_undeterminable_when_adguard_down():
    # rewrites None (AdGuard unreachable) -> no warnings, never cries wolf.
    warns = service.consistency_warnings([inst("grafana", "grafana")], None, BASE, IP)
    assert warns == []


# --- orphan sweep (reclaim Loskai's own leftover rewrites) ---


def test_sweep_orphan_pointing_at_caddy_ip():
    # A rewrite in Loskai's namespace, at the Caddy IP, owned by no routed instance.
    existing = [rw("ghost.example.no", IP)]
    plan = service.plan_reconcile([], existing, BASE, IP)
    assert plan.sweeps == [("ghost.example.no", IP)]


def test_sweep_skips_routed_domain():
    existing = [rw("grafana.example.no", IP)]
    plan = service.plan_reconcile([inst("grafana", "grafana", IP)], existing, BASE, IP)
    assert plan.sweeps == []  # a live route owns it


def test_sweep_skips_foreign_answer():
    # Hand-added rewrite pointing somewhere other than the Caddy IP — never swept.
    existing = [rw("ghost.example.no", "10.0.0.9")]
    plan = service.plan_reconcile([], existing, BASE, IP)
    assert plan.sweeps == []


def test_sweep_skips_domain_outside_base():
    existing = [rw("nas.local", IP)]
    plan = service.plan_reconcile([], existing, BASE, IP)
    assert plan.sweeps == []  # wrong suffix — not Loskai's base domain at all


def test_sweep_matches_multi_label_domain():
    # dns_only names can be multi-label; the sweep must still catch their orphans.
    existing = [rw("deep.sub.example.no", IP)]
    plan = service.plan_reconcile([], existing, BASE, IP)
    assert plan.sweeps == [("deep.sub.example.no", IP)]


def test_sweep_matches_dns_only_instances_own_answer():
    # A dns_only instance's own IP (not the shared answer_ip) is also a known Loskai
    # answer, so an orphan pointing at it gets swept even with no shared answer_ip.
    routed = [dns_only("vm1", "vm1", "192.168.10.55", dns_answer="192.168.10.55")]
    existing = [rw("old-vm1.example.no", "192.168.10.55")]  # renamed away, delete failed
    plan = service.plan_reconcile(routed, existing, BASE, None)
    assert plan.sweeps == [("old-vm1.example.no", "192.168.10.55")]


def test_is_loskai_domain():
    assert service.is_loskai_domain("grafana.example.no", BASE)
    assert not service.is_loskai_domain("example.no", BASE)
    assert service.is_loskai_domain("a.b.example.no", BASE)  # dns_only multi-label names
    assert not service.is_loskai_domain("grafana.other.no", BASE)
