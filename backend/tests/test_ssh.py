"""Loskai's SSH key and config through the real HTTP path: the key is encrypted with the
admin password and never leaves, and the config follows the machines while every line it
doesn't own stays as written."""

import os

import asyncssh
import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.shared import assign as assign_module
from loskai.shared import auth
from loskai.shared import instances as instances_store

PASSWORD = "correct horse battery"
HAND_WRITTEN = "# mine\nHost laptop\n    HostName 192.168.10.5\n"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(config.settings, "base_domain", "example.no")
    monkeypatch.setattr(config.settings, "host_ip", "192.168.10.216")

    async def no_route(_caddy, _id):
        return None

    monkeypatch.setattr(assign_module.caddy_service, "teardown_route", no_route)


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"password": PASSWORD})
        yield c


@pytest.fixture
def ssh_dir():
    return config.settings.data_dir + "/ssh"


def _config(ssh_dir) -> str:
    with open(ssh_dir + "/config") as f:
        return f.read()


def _write_config(ssh_dir, text):
    os.makedirs(ssh_dir, exist_ok=True)
    with open(ssh_dir + "/config", "w") as f:
        f.write(text)


# --- The key ---


def test_no_key_until_one_is_made(client):
    assert client.get("/api/ssh").json() == {"key": None, "hosts": {}, "trusted": {}}


def test_the_key_is_encrypted_with_the_admin_password_and_never_returned(client, ssh_dir):
    r = client.post("/api/ssh/key", json={"password": PASSWORD})

    assert r.status_code == 200, r.text
    view = r.json()
    assert view["public_key"].startswith("ssh-ed25519 ") and view["public_key"].endswith(" loskai")
    assert view["authorized_keys"] == f'from="192.168.10.216" {view["public_key"]}'
    with open(ssh_dir + "/id_ed25519") as f:
        private = f.read()
    with pytest.raises(asyncssh.KeyImportError):
        asyncssh.import_private_key(private)  # useless without the password
    key = asyncssh.import_private_key(private, passphrase=PASSWORD)
    assert key.export_public_key("openssh").decode().strip() == view["public_key"]
    for answer in (r, client.get("/api/ssh"), client.get("/api/ssh/config")):
        assert "PRIVATE KEY" not in answer.text


def test_the_key_file_is_owner_only(client, ssh_dir):
    client.post("/api/ssh/key", json={"password": PASSWORD})

    assert os.stat(ssh_dir + "/id_ed25519").st_mode & 0o777 == 0o600


def test_a_wrong_password_makes_no_key_and_does_not_sign_you_out(client, ssh_dir):
    r = client.post("/api/ssh/key", json={"password": "wrong"})

    assert r.status_code == 403  # a 401 would send the page to /login
    assert not os.path.exists(ssh_dir + "/id_ed25519")


def test_guessing_through_the_key_endpoint_meets_the_login_backoff(client):
    for _ in range(auth.FREE_FAILURES + 1):
        client.post("/api/ssh/key", json={"password": "wrong"})

    assert client.post("/api/ssh/key", json={"password": PASSWORD}).status_code == 429
    assert client.post("/api/login", json={"password": PASSWORD}).status_code == 429  # one count


def test_an_existing_key_is_only_replaced_when_asked(client):
    first = client.post("/api/ssh/key", json={"password": PASSWORD}).json()["public_key"]

    again = client.post("/api/ssh/key", json={"password": PASSWORD})
    replaced = client.post("/api/ssh/key", json={"password": PASSWORD, "replace": True})

    assert again.status_code == 409
    assert replaced.status_code == 200
    assert replaced.json()["public_key"] != first
    assert client.get("/api/ssh").json()["key"]["public_key"] == replaced.json()["public_key"]


def test_without_the_docker_host_s_ip_the_line_has_no_from(client, monkeypatch):
    monkeypatch.setattr(config.settings, "host_ip", None)

    view = client.post("/api/ssh/key", json={"password": PASSWORD}).json()

    assert view["from"] is None
    assert view["authorized_keys"] == view["public_key"]


def test_ssh_needs_a_session():
    with TestClient(app) as anon:
        anon.post("/api/auth/setup", json={"password": PASSWORD})
        anon.cookies.clear()

        assert anon.get("/api/ssh").status_code == 401
        assert anon.get("/api/ssh/config").status_code == 401
        assert anon.post("/api/ssh/key", json={"password": PASSWORD}).status_code == 401


# --- The config follows the machines ---


def _machine(client, **body):
    r = client.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.50", **body})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_machine_with_ssh_gets_an_entry_after_the_hand_written_ones(client, ssh_dir):
    _write_config(ssh_dir, HAND_WRITTEN)

    _machine(client, ssh={"user": "admin", "port": 2222})

    assert _config(ssh_dir) == HAND_WRITTEN + "\nHost nas\n    HostName 192.168.10.50\n    User admin\n    Port 2222\n"
    assert client.get("/api/ssh").json()["hosts"]["nas"] == {
        "hostname": "192.168.10.50", "user": "admin", "port": 2222,
    }


def test_a_machine_without_ssh_gets_no_entry(client, ssh_dir):
    _machine(client)

    assert not os.path.exists(ssh_dir + "/config")


def test_moving_and_renaming_a_machine_carries_to_its_entry(client, ssh_dir):
    _write_config(ssh_dir, HAND_WRITTEN)
    _machine(client, ssh={"user": "admin", "port": 22})

    # The form left SSH out: the user stays, the address and the name follow.
    _machine(client, hostname="storage", address="192.168.10.51", instance_id="nas")

    assert _config(ssh_dir) == HAND_WRITTEN + "\nHost storage\n    HostName 192.168.10.51\n    User admin\n"


def test_clearing_ssh_removes_only_that_entry(client, ssh_dir):
    _write_config(ssh_dir, HAND_WRITTEN)
    _machine(client, ssh={"user": "admin", "port": 22})

    _machine(client, instance_id="nas", ssh=None)

    assert _config(ssh_dir) == HAND_WRITTEN


def test_deleting_a_machine_removes_its_entry(client, ssh_dir):
    _write_config(ssh_dir, HAND_WRITTEN)
    _machine(client, ssh={"user": "admin", "port": 22})

    assert client.delete("/api/instances/nas").status_code == 200

    assert _config(ssh_dir) == HAND_WRITTEN


def test_a_bad_ssh_user_is_refused_before_anything_is_saved(client, ssh_dir):
    r = client.post(
        "/api/machines",
        json={"hostname": "nas", "address": "192.168.10.50", "ssh": {"user": "a b", "port": 22}},
    )

    assert r.status_code == 422
    assert instances_store.get_instance("nas") is None
    assert not os.path.exists(ssh_dir + "/config")


def test_the_export_is_the_config_as_it_is(client, ssh_dir):
    _write_config(ssh_dir, HAND_WRITTEN)
    _machine(client, ssh={"user": "admin", "port": 22})

    r = client.get("/api/ssh/config")

    assert r.text == _config(ssh_dir)
    assert "IdentityFile" not in r.text  # your own ssh uses your own keys
    assert r.headers["content-disposition"] == 'attachment; filename="loskai-ssh-config"'
