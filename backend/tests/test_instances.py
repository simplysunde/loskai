"""Tier-1: instance store CRUD + the routed-subset projection."""

import pytest

from loskai import config
from loskai.shared import instances as inst


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))


def test_empty_by_default():
    assert inst.list_instances() == []


def test_upsert_inserts_then_replaces():
    inst.upsert_instance(inst.Instance(id="grafana", name="Grafana", type="docker"))
    assert inst.get_instance("grafana").name == "Grafana"

    # Same id -> replace, not duplicate.
    inst.upsert_instance(
        inst.Instance(id="grafana", name="Graf", type="docker", subdomain="graf")
    )
    all_instances = inst.list_instances()
    assert len(all_instances) == 1
    assert all_instances[0].subdomain == "graf"


def test_list_routed_is_subdomain_subset():
    inst.upsert_instance(inst.Instance(id="a", name="A", type="docker", subdomain="a"))
    inst.upsert_instance(inst.Instance(id="b", name="B", type="docker"))  # no route
    routed = inst.list_routed()
    assert [i.id for i in routed] == ["a"]


def test_delete():
    inst.upsert_instance(inst.Instance(id="x", name="X", type="external"))
    assert inst.delete_instance("x") is True
    assert inst.delete_instance("x") is False
    assert inst.list_instances() == []


# --- `kind`: declared, not inferred (Phase 21d) ---


def test_kind_is_backfilled_for_records_written_before_the_field():
    # The rule the code used to infer at every call site, applied once at parse time.
    machine = inst.Instance(id="nas", name="nas", type="external", upstream="192.168.10.50")
    service = inst.Instance(id="g", name="g", type="docker", upstream="192.168.10.50:3000")

    assert machine.kind == "machine"
    assert service.kind == "service"


def test_a_stored_kind_always_wins_over_the_shape():
    # Once written, the record decides — the shape is only a fallback for old rows.
    odd = inst.Instance(
        id="x", name="x", type="external", upstream="192.168.10.50", kind="service"
    )

    assert odd.kind == "service"


def test_an_instance_with_no_upstream_is_a_service():
    assert inst.Instance(id="x", name="x", type="external").kind == "service"
