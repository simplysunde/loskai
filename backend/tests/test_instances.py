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


def test_dashboard_card_links_an_http_route_over_http(tmp_path, monkeypatch):
    # The public dashboard is the one surface a non-admin uses; an unreachable https link
    # there is the most visible way to get this wrong.
    from loskai.shared import dashboard

    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "base_domain", "example.no")
    inst.upsert_instance(
        inst.Instance(id="tv", name="tv", type="external", subdomain="tv",
                      upstream="192.168.10.50:8080", scheme="http")
    )
    inst.upsert_instance(
        inst.Instance(id="app", name="app", type="external", subdomain="app",
                      upstream="192.168.10.50:80")
    )

    cards = {c["name"]: c["url"] for c in dashboard.dashboard()["services"]}

    assert cards["tv"] == "http://tv.example.no"
    assert cards["app"] == "https://app.example.no"


def test_machines_are_not_dashboard_cards(tmp_path, monkeypatch):
    # A machine is an address. The port its UI lives on — :8006 for Proxmox, none at all for
    # a box you only SSH to — is not in the record, so a card for one links to a dead port.
    from loskai.shared import dashboard

    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "base_domain", "example.no")
    inst.upsert_instance(
        inst.Instance(id="proxmox", name="Proxmox", type="external", kind="machine",
                      subdomain="proxmox", upstream="192.168.10.177", route_mode="dns_only")
    )
    inst.upsert_instance(
        inst.Instance(id="grafana", name="Grafana", type="external",
                      subdomain="grafana", upstream="192.168.10.50:3000")
    )

    names = [c["name"] for c in dashboard.dashboard()["services"]]

    assert names == ["Grafana"]


def test_a_route_onto_a_machine_is_still_a_card(tmp_path, monkeypatch):
    # The documented way to put Proxmox on the dashboard: a second name, routed at its port
    # and linked to the machine, so it follows the machine if the host moves.
    from loskai.shared import dashboard

    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "base_domain", "example.no")
    inst.upsert_instance(
        inst.Instance(id="proxmox", name="Proxmox", type="external", kind="machine",
                      subdomain="proxmox", upstream="192.168.10.177", route_mode="dns_only")
    )
    inst.upsert_instance(
        inst.Instance(id="pve", name="Proxmox UI", type="external", subdomain="pve",
                      upstream="192.168.10.177:8006", machine="proxmox", upstream_tls=True)
    )

    cards = {c["name"]: c["url"] for c in dashboard.dashboard()["services"]}

    assert cards == {"Proxmox UI": "https://pve.example.no"}
