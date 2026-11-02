"""Loskai's SSH key behind key slots: each account unlocks it with its own password."""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.modules.ssh import client, keys, unlock

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
        yield c


def _login(name: str, password: str) -> TestClient:
    c = TestClient(app)
    assert c.post("/api/login", json={"username": name, "password": password}).status_code == 200
    return c


def _add(admin, name: str, tabs: list[str], role: str = "operator") -> TestClient:
    r = admin.post("/api/users", json={"username": name, "password": f"{name}-password", "role": role, "tabs": tabs})
    assert r.status_code == 200, r.text
    return _login(name, f"{name}-password")


def _unlock(c: TestClient, password: str):
    return c.post("/api/ssh/unlock", json={"password": password}, headers=ORIGIN)


def _unlocked(c: TestClient) -> bool:
    return c.get("/api/ssh").json()["key"]["unlocked_until"] is not None


def test_a_slot_opens_only_with_its_password():
    slot = keys.seal(b"k" * 32, "right password")

    assert keys.unseal(slot, "right password") == b"k" * 32
    assert keys.unseal(slot, "wrong password") is None


def test_an_unlock_is_the_user_s_own(admin):
    admin.post("/api/ssh/key", json={"password": ADMIN}, headers=ORIGIN)
    ola = _add(admin, "ola", ["machines"])  # made while the admin has it unlocked: a slot

    assert _unlocked(admin) and not _unlocked(ola)  # like sudo: each types their own
    assert _unlock(ola, "ola-password").status_code == 200
    assert _unlocked(ola)

    ola.post("/api/logout", headers=ORIGIN)
    assert _unlocked(admin)  # their logout locks only theirs


def test_an_account_made_while_locked_gets_its_slot_when_someone_else_unlocks(admin):
    admin.post("/api/ssh/key", json={"password": ADMIN}, headers=ORIGIN)
    admin.post("/api/logout", headers=ORIGIN)  # locks it
    admin2 = _login("admin", ADMIN)
    ola = _add(admin2, "ola", ["machines"])
    assert not keys.has_slot("ola")

    refused = _unlock(ola, "ola-password")
    assert refused.status_code == 409 and "can't unlock Loskai's key yet" in refused.json()["detail"]

    assert _unlock(admin2, ADMIN).status_code == 200
    assert _unlock(ola, "ola-password").status_code == 200 and keys.has_slot("ola")


def test_an_account_without_the_machines_tab_gets_no_slot(admin):
    admin.post("/api/ssh/key", json={"password": ADMIN}, headers=ORIGIN)
    _add(admin, "ola", ["docker"])

    assert not keys.has_slot("ola")


def test_a_changed_password_reseals_the_slot_and_a_reset_one_while_locked_drops_it(admin):
    admin.post("/api/ssh/key", json={"password": ADMIN}, headers=ORIGIN)
    ola = _add(admin, "ola", ["machines"])

    ola.post("/api/auth/password", json={"current": "ola-password", "new": "ola-new-password"}, headers=ORIGIN)
    assert keys.unseal(keys._slots()["ola"], "ola-new-password") is not None
    assert keys.unseal(keys._slots()["ola"], "ola-password") is None

    unlock.lock()
    admin.patch("/api/users/ola", json={"password": "reset-by-admin"}, headers=ORIGIN)
    assert not keys.has_slot("ola")  # the old password must not open the key


def test_a_new_key_keeps_every_other_slot(admin):
    admin.post("/api/ssh/key", json={"password": ADMIN}, headers=ORIGIN)
    _add(admin, "ola", ["machines"])
    first = client.public_key()

    admin.post("/api/ssh/key", json={"password": ADMIN, "replace": True}, headers=ORIGIN)

    assert client.public_key() != first
    key, _ = keys.open_for("ola", "ola-password", None)
    assert key.export_public_key("openssh").decode().strip() == client.public_key()


def test_a_key_from_before_accounts_moves_to_slots_at_its_first_unlock(admin):
    # Encrypted with the old admin password itself, and no slots yet.
    client.create_key(ADMIN)
    public = client.public_key()

    assert _unlock(admin, ADMIN).status_code == 200
    assert keys.has_slot("admin") and client.public_key() == public
    with pytest.raises(Exception):
        client.load_key(ADMIN)  # no longer the password itself
    unlock.lock()
    assert _unlock(admin, ADMIN).status_code == 200  # now through the slot
