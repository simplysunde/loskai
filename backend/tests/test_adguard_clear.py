"""Tier-2: the explicit rewrite reset — the one path that deletes rewrites Loskai did not
write. What matters here is the blast radius (everything, deliberately), that the restore
is part of the same call, and that a run which could not restore refuses to delete at all.
"""

import httpx
import pytest

from loskai import config
from loskai.modules.adguard import service
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance

BASE = "example.no"
IP = "192.168.10.101"


def inst(id_, sub, **kw):
    return Instance(id=id_, name=id_, type="docker", subdomain=sub, **kw)


class FakeClient:
    """Mutates its own list, so `reconcile` sees what the clear actually did."""

    def __init__(self, existing, fail_deletes=()):
        self.existing = [dict(e) for e in existing]
        self.fail_deletes = set(fail_deletes)
        self.deleted: list[tuple[str, str]] = []
        self.added: list[tuple[str, str]] = []

    async def list_rewrites(self):
        return [dict(e) for e in self.existing]

    async def add_rewrite(self, domain, answer):
        self.added.append((domain, answer))
        self.existing.append({"domain": domain, "answer": answer, "enabled": True})

    async def delete_rewrite(self, domain, answer):
        if domain in self.fail_deletes:
            raise httpx.ConnectError("boom")
        self.deleted.append((domain, answer))
        self.existing = [
            e
            for e in self.existing
            if not (e["domain"] == domain and e["answer"] == answer)
        ]


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    return tmp_path


async def test_clears_hand_added_rewrites_too(data_dir):
    # The whole point: a foreign rewrite the orphan sweep would never touch is removed.
    instances_store.upsert_instance(inst("grafana", "grafana"))
    client = FakeClient(
        [
            {"domain": "grafana.example.no", "answer": IP},
            {"domain": "nas.old-domain.lan", "answer": "192.168.10.50"},
            {"domain": "printer.example.no", "answer": "10.0.0.9"},
        ]
    )

    result = await service.clear_and_restore(client, BASE, IP)

    assert sorted(result["cleared"]) == [
        "grafana.example.no",
        "nas.old-domain.lan",
        "printer.example.no",
    ]
    assert result["restored"] == ["grafana.example.no"]
    assert result["errors"] == []


async def test_restore_leaves_exactly_one_rewrite_per_routed_name(data_dir):
    # Duplicate safety: reconcile runs against an emptied list, so each name is added once.
    instances_store.upsert_instance(inst("grafana", "grafana", dns_answer=IP))
    instances_store.upsert_instance(
        inst("nas", "nas", route_mode="dns_only", upstream="192.168.10.50")
    )
    client = FakeClient(
        [
            {"domain": "grafana.example.no", "answer": IP},
            {"domain": "nas.example.no", "answer": "192.168.10.50"},
        ]
    )

    await service.clear_and_restore(client, BASE, IP)

    pairs = sorted((e["domain"], e["answer"]) for e in client.existing)
    assert pairs == [("grafana.example.no", IP), ("nas.example.no", "192.168.10.50")]
    assert client.added == [("grafana.example.no", IP), ("nas.example.no", "192.168.10.50")]


async def test_refuses_before_deleting_when_restore_would_fail(data_dir):
    # A proxy instance with no derivable answer IP: reconcile would raise *after* the
    # wipe, leaving the LAN with no rewrites at all. Nothing may be deleted.
    instances_store.upsert_instance(inst("grafana", "grafana"))
    client = FakeClient([{"domain": "grafana.example.no", "answer": IP}])

    with pytest.raises(ValueError):
        await service.clear_and_restore(client, BASE, None)

    assert client.deleted == []
    assert len(client.existing) == 1


async def test_refuses_when_base_domain_unset(data_dir):
    client = FakeClient([{"domain": "grafana.example.no", "answer": IP}])

    with pytest.raises(ValueError):
        await service.clear_and_restore(client, None, IP)

    assert client.deleted == []


async def test_failed_delete_is_reported_and_restore_still_runs(data_dir):
    instances_store.upsert_instance(inst("grafana", "grafana"))
    client = FakeClient(
        [
            {"domain": "grafana.example.no", "answer": IP},
            {"domain": "stubborn.example.no", "answer": "10.0.0.9"},
        ],
        fail_deletes={"stubborn.example.no"},
    )

    result = await service.clear_and_restore(client, BASE, IP)

    assert result["cleared"] == ["grafana.example.no"]
    assert [e["domain"] for e in result["errors"]] == ["stubborn.example.no"]
    assert result["restored"] == ["grafana.example.no"]  # ours is back regardless


# --- The list the dialog shows before confirming ---


def test_annotate_marks_managed_and_foreign_entries():
    routed = [
        inst("grafana", "grafana"),
        inst("nas", "nas", route_mode="dns_only", upstream="192.168.10.50"),
    ]
    rewrites = [
        {"domain": "grafana.example.no", "answer": IP},  # ours, proxy
        {"domain": "nas.example.no", "answer": "192.168.10.50"},  # ours, dns_only
        {"domain": "printer.example.no", "answer": "10.0.0.9"},  # hand-added
        {"domain": "nas.previous.lan", "answer": "192.168.10.50"},  # old base domain
    ]

    rows = service.annotate_rewrites(rewrites, routed, BASE, IP)

    assert [(r["domain"], r["managed"]) for r in rows] == [
        ("grafana.example.no", True),
        ("nas.example.no", True),
        ("printer.example.no", False),
        ("nas.previous.lan", False),
    ]


def test_annotate_same_domain_wrong_answer_is_not_managed():
    # A hand-added answer on one of our own names would NOT come back after a clear:
    # reconcile restores its own answer, not this one.
    rows = service.annotate_rewrites(
        [{"domain": "grafana.example.no", "answer": "10.0.0.9"}],
        [inst("grafana", "grafana")],
        BASE,
        IP,
    )

    assert rows[0]["managed"] is False


def test_annotate_without_base_domain_marks_nothing_managed():
    rows = service.annotate_rewrites(
        [{"domain": "grafana.example.no", "answer": IP}], [inst("grafana", "grafana")], None, IP
    )

    assert rows[0]["managed"] is False


async def test_list_rewrites_annotates_live_list(data_dir):
    instances_store.upsert_instance(inst("grafana", "grafana"))
    client = FakeClient(
        [
            {"domain": "grafana.example.no", "answer": IP},
            {"domain": "printer.example.no", "answer": "10.0.0.9"},
        ]
    )

    result = await service.list_rewrites(client, BASE, IP)

    assert result["rewrites"] == [
        {"domain": "grafana.example.no", "answer": IP, "managed": True},
        {"domain": "printer.example.no", "answer": "10.0.0.9", "managed": False},
    ]
