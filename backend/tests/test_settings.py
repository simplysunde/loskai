"""Tier-1: settings priority chain (env > stored > unset) + answer-IP derivation."""

import pathlib
import re

import pytest

from loskai import config
from loskai.shared import settings as s


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    # Clear env-layer values so each test controls them explicitly.
    # Stored-only keys have no attribute to clear (see STORED_ONLY_KEYS), and
    # monkeypatch refuses to set one that doesn't exist.
    for key in set(s.CONFIGURABLE_KEYS) - s.STORED_ONLY_KEYS:
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
    # An install from before accounts still has its hash here until startup moves it.
    s._update_stored(lambda stored: {**stored, "admin_password_hash": "$argon2id$whatever"})
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


# --- The answer IP is always something a client can connect to (Phase 16 Stage C) ---
#
# AdGuard hands the answer to every LAN client. 127.0.0.1 resolves the service to whichever
# machine asked; 0.0.0.0 is a bind wildcard and names no host. Both surface as a refused
# connection, never as a DNS error.


@pytest.mark.parametrize(
    "admin_url",
    ["http://127.0.0.1:2019", "http://[::1]:2019", "http://0.0.0.0:2019"],
)
def test_derive_drops_an_unusable_answer_from_the_admin_url(monkeypatch, admin_url, caplog):
    monkeypatch.setattr(config.settings, "caddy_admin_url", admin_url)
    assert s.derive_caddy_host_ip() is None
    assert "answer IP" in caplog.text  # dropped, but never silently


@pytest.mark.parametrize("addr", ["127.0.0.1", "0.0.0.0"])
def test_derive_drops_an_unusable_explicit_env_value(monkeypatch, addr):
    """CADDY_HOST_IP from the environment never passes through `_validate`, so the guard
    has to sit in the derivation too — this is the only path that catches it."""
    monkeypatch.setattr(config.settings, "caddy_host_ip", addr)
    assert s.derive_caddy_host_ip() is None


def test_derive_prefers_an_explicit_lan_ip_over_a_loopback_admin_url(monkeypatch):
    """The documented recovery: a loopback admin URL is fine as long as CADDY_HOST_IP
    names an address other machines can reach."""
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://127.0.0.1:2019")
    monkeypatch.setattr(config.settings, "caddy_host_ip", "192.168.10.100")
    assert s.derive_caddy_host_ip() == "192.168.10.100"


def test_derive_still_returns_a_real_lan_ip(monkeypatch):
    """Regression guard: the loopback check must not reject ordinary private addresses."""
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://10.0.0.5:2019")
    assert s.derive_caddy_host_ip() == "10.0.0.5"


# --- caddy_host_ip / caddy_setup_url validation (update() raises ValueError → 422) ---


def test_caddy_host_ip_rejects_scheme():
    with pytest.raises(ValueError):
        s.update({"caddy_host_ip": "http://192.168.10.100"})


def test_caddy_host_ip_rejects_port():
    with pytest.raises(ValueError):
        s.update({"caddy_host_ip": "192.168.10.100:80"})


def test_caddy_host_ip_accepts_bare_ip():
    s.update({"caddy_host_ip": "192.168.10.100"})
    assert s.value("caddy_host_ip") == "192.168.10.100"


@pytest.mark.parametrize("addr", ["127.0.0.1", "127.0.1.9", "::1"])
def test_caddy_host_ip_rejects_loopback(addr):
    """A bare IP, so the existing check passes it — but unusable as a rewrite answer."""
    with pytest.raises(ValueError) as excinfo:
        s.update({"caddy_host_ip": addr})
    assert "loopback" in str(excinfo.value)


@pytest.mark.parametrize("addr", ["0.0.0.0", "::"])
def test_caddy_host_ip_rejects_the_unspecified_address(addr):
    """Same shape as loopback: parses as a bare IP, reaches nothing. The message has to
    say something different, though — 'loopback' would not describe 0.0.0.0."""
    with pytest.raises(ValueError) as excinfo:
        s.update({"caddy_host_ip": addr})
    assert "any interface" in str(excinfo.value)


def test_rejected_loopback_is_not_written(monkeypatch):
    """`_validate` runs before the store is touched, so a rejected value must not
    clobber a working one."""
    s.update({"caddy_host_ip": "192.168.10.100"})
    with pytest.raises(ValueError):
        s.update({"caddy_host_ip": "127.0.0.1"})
    assert s.value("caddy_host_ip") == "192.168.10.100"


def test_host_ip_rejects_scheme_or_port():
    with pytest.raises(ValueError):
        s.update({"host_ip": "http://192.168.10.50"})
    with pytest.raises(ValueError):
        s.update({"host_ip": "192.168.10.50:8080"})


def test_host_ip_accepts_bare_ip():
    s.update({"host_ip": "192.168.10.50"})
    assert s.value("host_ip") == "192.168.10.50"


def test_host_tailscale_ip_is_a_bare_ip():
    # It goes into every machine's from=, where anything else breaks the line.
    for bad in ("100.1.2.3,10.0.0.1", "100.1.2.3:22", "codebox"):
        with pytest.raises(ValueError):
            s.update({"host_tailscale_ip": bad})
    s.update({"host_tailscale_ip": "100.100.10.20"})
    assert s.value("host_tailscale_ip") == "100.100.10.20"


# Keys the Settings model deliberately keeps out of CONFIGURABLE_KEYS: they drive the
# compose file or the process itself, so the UI must never write them (see config.py).
ENV_ONLY_KEYS = {"stacks_dir", "loskai_password", "loskai_username", "data_dir", "static_dir"}


def test_a_value_is_stored_without_the_spaces_around_it_except_a_password():
    s.update({"host_tailscale_ip": " 100.100.10.20\n", "host_ip": "192.168.10.220 ",
              "base_domain": "  ", "adguard_password": " pass word "})

    assert s.resolve("host_tailscale_ip") == ("100.100.10.20", "stored")
    assert s.resolve("host_ip") == ("192.168.10.220", "stored")
    assert s.resolve("base_domain") == (None, "unset")  # only spaces: unset, like ""
    assert s.resolve("adguard_password") == (" pass word ", "stored")


def test_configurable_keys_match_the_env_model():
    """Settings keys are enumerated in three places — config.Settings, CONFIGURABLE_KEYS,
    and the frontend *_FIELDS arrays. Forgetting the middle one silently makes a key
    env-only and unwritable from the UI, with no failing test and a symptom that looks
    like a frontend bug. Adding a genuinely env-only key means updating ENV_ONLY_KEYS
    here — a deliberate act, which is the point. A key with no env layer at all goes in
    STORED_ONLY_KEYS instead, which is equally deliberate."""
    from_env = set(s.CONFIGURABLE_KEYS) - s.STORED_ONLY_KEYS
    assert from_env | ENV_ONLY_KEYS == set(config.Settings.model_fields)


def test_stored_only_keys_have_no_env_attribute():
    """The other half of the pairing: a stored-only key must not quietly acquire an env
    layer later, because `_resolve` would start preferring it with nothing to say so."""
    for key in s.STORED_ONLY_KEYS:
        assert key in s.CONFIGURABLE_KEYS
        assert not hasattr(config.settings, key)


def test_configurable_keys_are_unique():
    assert len(s.CONFIGURABLE_KEYS) == len(set(s.CONFIGURABLE_KEYS))


def test_path_defaults_are_repo_anchored_not_container_paths():
    """Both env-only path defaults resolve beside the repo, so running the backend
    directly needs no configuration. The container is told its own paths explicitly by
    every compose file; reverting either default to a bare in-container path (`/data`,
    `/opt/loskai`) brings back a startup `PermissionError` for anyone running outside
    Docker — which is how both of these read before 2026-09-05 and 2026-09-10."""
    defaults = config.Settings.model_fields
    for key in ("data_dir", "stacks_dir"):
        assert defaults[key].default == str(config._REPO_ROOT / key.removesuffix("_dir"))


# --- Certificate tab visibility ---


def test_certificate_tab_defaults_to_public():
    """Internal CA is the default TLS mode, so the page is useful out of the box."""
    assert s.certificate_tab() == "public"


def test_certificate_tab_stored_value_is_used():
    s.update({"certificate_tab": "hidden"})
    assert s.certificate_tab() == "hidden"


def test_certificate_tab_rejects_an_unknown_mode():
    with pytest.raises(ValueError, match="Certificate tab must be one of"):
        s.update({"certificate_tab": "sometimes"})


def test_certificate_tab_falls_back_when_env_is_a_typo(monkeypatch):
    """The env layer never passes through `_validate`, so a bad CERTIFICATE_TAB must
    degrade to the default rather than silently hiding the page."""
    monkeypatch.setattr(config.settings, "certificate_tab", "publik")
    assert s.certificate_tab() == "public"


def test_the_ssh_unlock_lasts_15_minutes_unless_set():
    assert s.ssh_unlock_seconds() == 15 * 60
    s.update({"ssh_unlock_minutes": "180"})
    assert s.ssh_unlock_seconds() == 3 * 3600


def test_the_ssh_unlock_takes_only_its_choices(monkeypatch):
    with pytest.raises(ValueError, match="minutes"):
        s.update({"ssh_unlock_minutes": "99999"})
    # The env layer isn't validated: a value not among the choices means the default.
    monkeypatch.setattr(config.settings, "ssh_unlock_minutes", "forever")
    assert s.ssh_unlock_seconds() == 15 * 60


def test_a_session_lasts_two_idle_hours_unless_set():
    assert s.session_idle_seconds() == 2 * 3600
    s.update({"session_idle_minutes": "480"})
    assert s.session_idle_seconds() == 8 * 3600
    with pytest.raises(ValueError, match="minutes"):
        s.update({"session_idle_minutes": "5"})


def test_the_settings_pages_offer_exactly_the_choices_the_backend_allows():
    # A choice the page offers and the backend refuses would fail with a 422 on save.
    ts = (pathlib.Path(__file__).parents[2] / "frontend/src/lib/settings.ts").read_text()

    def offered(name: str) -> set[str]:
        block = re.search(rf"export const {name} = \[(.*?)\];", ts, re.S)
        return set(re.findall(r'value: "(\d+)"', block.group(1)))

    assert offered("SESSION_IDLE_CHOICES") == set(s.SESSION_IDLE_CHOICES)
    assert offered("SSH_UNLOCK_CHOICES") == set(s.SSH_UNLOCK_CHOICES)
