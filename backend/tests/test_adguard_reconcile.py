"""Tier-1: the AdGuard reconcile — (domain, answer) diffing, dns_answer orphan
migration, manual-conflict detection. The trickiest logic in the app, covered thoroughly.
"""

import pytest

from loskai import config
from loskai.modules.adguard import service
from loskai.shared import instances as instances_store
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


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    return tmp_path


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


async def test_reconcile_requires_answer_ip(data_dir):
    with pytest.raises(ValueError):
        await service.reconcile(FakeClient([]), BASE, None)


# --- consistency_warnings (the /api/health drift check) ---


def test_consistency_missing_rewrite():
    warns = service.consistency_warnings([inst("grafana", "grafana")], [], BASE, IP)
    assert len(warns) == 1
    assert warns[0]["kind"] == "dns_missing"
    assert warns[0]["id"] == "grafana"


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
