"""Tier-1: how the two flat files fail when hand-edited badly.

They fail differently on purpose (Phase 15 F5): `settings.json` stops startup, because a
silent fall back to `{}` reads as "no admin password set" and re-opens the public
first-run setup route. `instances.json` carries display state only, so a single bad
record is skipped and logged instead.
"""

import json

import pytest

from loskai.shared import instances as instances_store
from loskai.shared import settings as settings_store
from loskai.shared.store import CorruptStoreError


# --- settings.json: fail loudly ---


def test_absent_settings_file_is_fine():
    settings_store.verify_readable()  # a fresh install has no settings.json yet


def test_corrupt_settings_file_refuses_to_boot(data_dir):
    (data_dir / "settings.json").write_text('{"base_domain": "example.no"')
    with pytest.raises(CorruptStoreError) as excinfo:
        settings_store.verify_readable()
    # The operator is told *which* file to fix.
    assert "settings.json" in str(excinfo.value)


def test_corrupt_settings_file_never_reads_as_an_empty_dict(data_dir):
    """Read as `{}`, a cut-off file would quietly unset every stored setting."""
    (data_dir / "settings.json").write_text('{"base_domain": "home.lan", "adguard_url": "http://')
    with pytest.raises(CorruptStoreError):
        settings_store.resolve("base_domain")


def test_settings_file_must_hold_an_object(data_dir):
    (data_dir / "settings.json").write_text("[]")
    with pytest.raises(CorruptStoreError):
        settings_store.verify_readable()


# --- instances.json: degrade per record ---


def test_bad_instance_record_is_skipped_not_fatal(data_dir, caplog):
    (data_dir / "instances.json").write_text(
        json.dumps(
            [
                {"id": "good", "name": "Good", "type": "docker"},
                {"id": "bad", "name": "Bad", "type": "nonsense"},
                {"id": "also-good", "name": "Also good", "type": "external"},
            ]
        )
    )

    kept = instances_store.list_instances()

    assert [i.id for i in kept] == ["good", "also-good"]
    assert "bad" in caplog.text  # skipped, but never silently


def test_corrupt_instances_file_raises_rather_than_reading_as_empty(data_dir):
    """A file-level parse error is not an empty list: returning [] would let the next
    upsert write a fresh file over every route the user had."""
    (data_dir / "instances.json").write_text('[{"id": "grafana"')
    with pytest.raises(CorruptStoreError):
        instances_store.list_instances()


def test_instances_file_must_hold_an_array(data_dir):
    (data_dir / "instances.json").write_text("{}")
    with pytest.raises(CorruptStoreError):
        instances_store.list_instances()
