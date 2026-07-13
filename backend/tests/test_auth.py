"""Tier-1: password hash/verify + session sign/verify + first-run seeding."""

import pytest

from loskai import config
from loskai.shared import auth
from loskai.shared import settings as s


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "loskai_password", None)


def test_password_hash_roundtrip():
    hashed = auth.hash_password("correct horse battery")
    assert hashed != "correct horse battery"  # never plaintext
    assert auth.verify_password(hashed, "correct horse battery")
    assert not auth.verify_password(hashed, "wrong")


def test_session_sign_and_verify():
    token = auth.make_session()
    assert auth.valid_session(token)
    assert not auth.valid_session("tampered")
    assert not auth.valid_session(None)


def test_ensure_seeded_sets_hash_from_env(monkeypatch):
    assert not auth.password_set()
    monkeypatch.setattr(config.settings, "loskai_password", "seeded-password")
    auth.ensure_seeded()
    assert auth.password_set()
    assert auth.verify_password(s.admin_password_hash(), "seeded-password")


def test_ensure_seeded_is_idempotent(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", "first")
    auth.ensure_seeded()
    first_hash = s.admin_password_hash()
    # Env change after a hash exists must not re-seed.
    monkeypatch.setattr(config.settings, "loskai_password", "second")
    auth.ensure_seeded()
    assert s.admin_password_hash() == first_hash
