"""Tier-1: concurrent writes to the flat store.

Every writer rewrites the whole file, and they span both execution contexts FastAPI uses
— sync handlers in the threadpool (`PUT /api/settings`, `PATCH /api/instances`) and async
ones on the event loop (assign, reconcile) — so two overlapping read-modify-write cycles
used to silently discard one side's change. `store.update_json` serialises them; these
tests fail deterministically if that lock goes away.
"""

import threading
import time

import pytest

from loskai import config
from loskai.shared import instances as instances_store
from loskai.shared import settings as settings_store
from loskai.shared import store


@pytest.fixture(autouse=True)
def no_env_settings(monkeypatch):
    # Stored-only keys have no attribute to clear (see STORED_ONLY_KEYS), and
    # monkeypatch refuses to set one that doesn't exist.
    for key in set(settings_store.CONFIGURABLE_KEYS) - settings_store.STORED_ONLY_KEYS:
        monkeypatch.setattr(config.settings, key, None)


@pytest.fixture
def slow_write(monkeypatch):
    """Widen the read -> write window, so these tests pass because the writes are
    serialised rather than because the machine was fast."""
    real = store.write_json

    def slow(path, data):
        time.sleep(0.05)
        real(path, data)

    monkeypatch.setattr(store, "write_json", slow)


def run_concurrently(*fns):
    threads = [threading.Thread(target=fn) for fn in fns]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)
    assert not any(t.is_alive() for t in threads), "a writer never finished — deadlock?"


def test_concurrent_settings_saves_keep_both_keys(slow_write):
    # Two fields committing on blur at once: each used to write back a dict read before
    # the other's save landed, so one value silently reverted in the UI.
    run_concurrently(
        lambda: settings_store.update({"base_domain": "example.no"}),
        lambda: settings_store.update({"host_ip": "192.168.10.50"}),
    )
    assert settings_store.value("base_domain") == "example.no"
    assert settings_store.value("host_ip") == "192.168.10.50"


def test_concurrent_instance_writes_keep_both_records(slow_write):
    # The costly one: a dropped instance leaves its Caddy route and DNS rewrite live but
    # unmanageable, since instances.json is the spine both are rebuilt from.
    run_concurrently(
        lambda: instances_store.upsert_instance(instances_store.Instance(id="a", name="A", type="docker")),
        lambda: instances_store.upsert_instance(instances_store.Instance(id="b", name="B", type="external")),
    )
    assert sorted(i.id for i in instances_store.list_instances()) == ["a", "b"]


def test_delete_racing_an_upsert_leaves_the_survivor(slow_write):
    instances_store.upsert_instance(instances_store.Instance(id="old", name="Old", type="external"))
    # Serialised, either order ends the same way: "old" is gone and "new" is kept.
    run_concurrently(
        lambda: instances_store.delete_instance("old"),
        lambda: instances_store.upsert_instance(instances_store.Instance(id="new", name="New", type="docker")),
    )
    assert [i.id for i in instances_store.list_instances()] == ["new"]
