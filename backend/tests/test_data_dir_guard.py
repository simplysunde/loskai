"""Tier-2: startup refuses when an install's state is stranded at the old data path.

`data_dir` defaulted to `/opt/loskai` before 2026-09-05. An install that pulls the new
image without moving its volume points the app at a `/data` nothing is mounted on — so it
finds no `settings.json`, decides it is a fresh install, re-opens the **public** first-run
setup route, and writes the replacement state into the container's writable layer where
the next recreate discards it. Silent data loss and an unauthenticated setup screen at the
same time, which is why the guard refuses to boot rather than picking one.
"""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.shared import settings as settings_store


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    """A configured data dir and a legacy one, both isolated from the real filesystem."""
    configured = tmp_path / "data"
    legacy = tmp_path / "opt-loskai"
    configured.mkdir()
    legacy.mkdir()
    monkeypatch.setattr(config.settings, "data_dir", str(configured))
    monkeypatch.setattr(settings_store, "LEGACY_DATA_DIR", str(legacy))
    return configured, legacy


def test_stranded_state_refuses_startup_naming_both_paths(dirs):
    """The defect verbatim. Naming *both* directories is the point: the fix is a one-line
    move, and the operator can only make it if told which two are involved."""
    configured, legacy = dirs
    (legacy / "settings.json").write_text('{"admin_password_hash": "x"}')

    with pytest.raises(settings_store.StrandedStateError) as exc:
        settings_store.verify_data_dir()

    assert str(configured) in str(exc.value)
    assert str(legacy) in str(exc.value)


def test_fresh_install_starts(dirs):
    """Neither location has state — a genuinely new install, nothing to protect."""
    settings_store.verify_data_dir()  # must not raise


def test_migrated_install_starts(dirs):
    """State at the configured path is the migrated (or simply current) case. The old
    directory may still be lying around; once the move happened it is not our business."""
    configured, legacy = dirs
    (configured / "settings.json").write_text('{"admin_password_hash": "x"}')
    (legacy / "settings.json").write_text('{"admin_password_hash": "stale"}')

    settings_store.verify_data_dir()  # must not raise


def test_pinning_the_legacy_dir_is_a_configuration_not_a_stranding(dirs, monkeypatch):
    """`LOSKAI_DATA_DIR=/opt/loskai` is one of the two fixes the error message offers, so
    it must not itself trip the guard — otherwise the advice creates a boot loop."""
    _, legacy = dirs
    monkeypatch.setattr(config.settings, "data_dir", str(legacy))
    (legacy / "settings.json").write_text('{"admin_password_hash": "x"}')

    settings_store.verify_data_dir()  # must not raise


def test_guard_runs_before_the_password_seed(dirs, monkeypatch):
    """The ordering trap in `main.lifespan`. `auth.ensure_seeded()` writes settings.json
    when LOSKAI_PASSWORD is set — run it first and it creates state at the empty new path,
    which masks the stranded install permanently and silently. Starting the real app is
    the only way to pin the order.
    """
    configured, legacy = dirs
    (legacy / "settings.json").write_text('{"admin_password_hash": "x"}')
    monkeypatch.setattr(config.settings, "loskai_password", "would-be-seeded")

    with pytest.raises(settings_store.StrandedStateError):
        with TestClient(app):
            pass

    assert not (configured / "settings.json").exists()
