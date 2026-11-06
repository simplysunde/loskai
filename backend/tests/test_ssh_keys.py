"""Unlocking Loskai's SSH key: each account with the Machines tab, with its own password."""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.modules.ssh import client, unlock

ADMIN = "correct horse battery"
ORIGIN = {"origin": "http://testserver"}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", None)
    unlock.lock()
    yield
    unlock.lock()


@pytest.fixture
def admin():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": ADMIN})
        c.post("/api/ssh/key", json={"password": ADMIN}, headers=ORIGIN)
        yield c


def _login(name: str, password: str) -> TestClient:
    c = TestClient(app)
    assert c.post("/api/login", json={"username": name, "password": password}).status_code == 200
    return c


def _add(admin, name: str, level: int) -> TestClient:
    r = admin.post("/api/users", json={"username": name, "password": f"{name}-password", "level": level})
    assert r.status_code == 200, r.text
    return _login(name, f"{name}-password")


def _unlock(c: TestClient, password: str):
    return c.post("/api/ssh/unlock", json={"password": password}, headers=ORIGIN)


def _unlocked(c: TestClient) -> bool:
    return c.get("/api/ssh").json()["key"]["unlocked_until"] is not None


def test_making_the_key_unlocks_it_for_whoever_made_it(admin):
    assert _unlocked(admin) and unlock.unlocked_key("admin") is not None


def test_an_unlock_is_the_user_s_own(admin):
    ola = _add(admin, "ola", 3)

    assert _unlocked(admin) and not _unlocked(ola)  # like sudo: each types their own
    assert _unlock(ola, "ola-wrong").status_code == 403
    assert _unlock(ola, "ola-password").status_code == 200
    assert _unlocked(ola)

    ola.post("/api/logout", headers=ORIGIN)
    assert _unlocked(admin)  # their logout locks only theirs


def test_anyone_with_machines_unlocks_with_no_one_else_unlocked(admin):
    admin.post("/api/logout", headers=ORIGIN)
    ola = _add(_login("admin", ADMIN), "ola", 3)

    assert _unlock(ola, "ola-password").status_code == 200


def test_a_new_password_or_losing_machines_ends_an_unlock(admin):
    ola = _add(admin, "ola", 3)
    _unlock(ola, "ola-password")

    admin.patch("/api/users/ola", json={"level": 2}, headers=ORIGIN)
    admin.patch("/api/users/ola", json={"level": 3}, headers=ORIGIN)
    assert unlock.unlocked_key("ola") is None  # given back, the level doesn't bring it back

    _unlock(ola, "ola-password")
    admin.patch("/api/users/ola", json={"password": "reset-by-admin"}, headers=ORIGIN)
    assert unlock.unlocked_key("ola") is None
    assert _unlocked(admin)


def test_an_account_made_again_under_a_name_doesn_t_get_its_unlock(admin):
    ola = _add(admin, "ola", 3)
    _unlock(ola, "ola-password")
    admin.delete("/api/users/ola", headers=ORIGIN)
    _add(admin, "ola", 3)

    assert unlock.unlocked_key("ola") is None


def test_an_admin_setting_their_own_password_in_users_stays_signed_in(admin):
    changed = admin.patch("/api/users/admin", json={"password": "a new admin password"}, headers=ORIGIN)

    assert changed.status_code == 200
    assert admin.get("/api/users").status_code == 200
    assert _unlock(admin, "a new admin password").status_code == 200


def test_a_refused_password_changes_nothing_else(admin):
    _add(admin, "ola", 3)

    refused = admin.patch("/api/users/ola", json={"level": 2, "password": "short"}, headers=ORIGIN)

    assert refused.status_code == 422
    assert next(u for u in admin.get("/api/users").json() if u["username"] == "ola")["level"] == 3


def test_a_new_key_replaces_the_old_and_stays_unlocked(admin):
    first = client.public_key()

    admin.post("/api/ssh/key", json={"password": ADMIN, "replace": True}, headers=ORIGIN)

    assert client.public_key() != first
    assert unlock.unlocked_key("admin").export_public_key("openssh").decode().strip() == client.public_key()


def test_a_key_from_before_phase_38_says_to_make_a_new_one(admin):
    import asyncssh

    old = asyncssh.generate_private_key("ssh-ed25519", comment="loskai")
    client._private_path().write_text(old.export_private_key("openssh", passphrase="sealed").decode())
    unlock.lock()

    refused = _unlock(admin, ADMIN)

    assert refused.status_code == 409 and "New key" in refused.json()["detail"]
    assert unlock.unlocked_key("admin") is None
