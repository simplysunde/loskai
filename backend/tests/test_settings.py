"""Tier-1: settings priority chain (env > stored > unset) + answer-IP derivation."""

import pytest

from loskai import config
from loskai.shared import settings as s


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    # Clear env-layer values so each test controls them explicitly.
    for key in s.CONFIGURABLE_KEYS:
        monkeypatch.setattr(config.settings, key, None)


def test_unset_when_nothing_configured():
    assert s.resolve("base_domain") == (None, "unset")


def test_stored_value_used_when_no_env():
    s.update({"base_domain": "stored.example"})
    assert s.resolve("base_domain") == ("stored.example", "stored")


def test_env_wins_over_stored(monkeypatch):
    s.update({"base_domain": "stored.example"})
    monkeypatch.setattr(config.settings, "base_domain", "env.example")
    assert s.resolve("base_domain") == ("env.example", "env")


def test_update_ignores_env_sourced_keys(monkeypatch):
    monkeypatch.setattr(config.settings, "base_domain", "env.example")
    s.update({"base_domain": "trying-to-override"})
    # Env still wins and nothing stored leaked through.
    assert s.resolve("base_domain") == ("env.example", "env")


def test_update_removes_key_when_blank():
    s.update({"adguard_url": "http://a:3000"})
    assert s.value("adguard_url") == "http://a:3000"
    s.update({"adguard_url": ""})
    assert s.resolve("adguard_url") == (None, "unset")


def test_view_excludes_admin_hash_and_marks_secret():
    s.set_admin_password_hash("$argon2id$whatever")
    view = s.get_view()
    assert "admin_password_hash" not in view
    assert view["adguard_password"]["secret"] is True
    assert view["stacks_dir"]["source"] == "env"


def test_derive_caddy_host_ip_from_ip_admin_url(monkeypatch):
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://192.168.10.101:2019")
    assert s.derive_caddy_host_ip() == "192.168.10.101"


def test_derive_caddy_host_ip_hostname_needs_explicit(monkeypatch):
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://caddy:2019")
    assert s.derive_caddy_host_ip() is None
    monkeypatch.setattr(config.settings, "caddy_host_ip", "192.168.10.100")
    assert s.derive_caddy_host_ip() == "192.168.10.100"
