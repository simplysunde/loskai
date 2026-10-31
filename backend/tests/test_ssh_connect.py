"""Setting a machine up over SSH, through the HTTP routes, with the network faked at
`client.scan_host_key` / `client.run`: the host key is trusted before any password is sent,
the key must be unlocked, logout locks it, and the running list is cached."""

import asyncssh
import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.modules.ssh import client as ssh_client
from loskai.modules.ssh import connect, logic, unlock
from loskai.shared import assign as assign_module

PASSWORD = "correct horse battery"
HOST_KEY = asyncssh.generate_private_key("ssh-ed25519")
OTHER_KEY = asyncssh.generate_private_key("ssh-ed25519")
STATUS = "#loskai-status 1\n#docker\nweb|nginx|Up 1 hour\n#systemd\ncron.service loaded active running x\n"


class Done:
    def __init__(self, stdout="", exit_status=0, stderr=""):
        self.stdout, self.exit_status, self.stderr = stdout, exit_status, stderr


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(config.settings, "base_domain", "example.no")
    monkeypatch.setattr(config.settings, "host_ip", "192.168.10.216")

    async def no_route(_caddy, _id):
        return None

    monkeypatch.setattr(assign_module.caddy_service, "teardown_route", no_route)
    unlock.lock()
    connect._running.clear()


@pytest.fixture
def machine_net(monkeypatch):
    """The machine at 192.168.10.50: offers `state["host_key"]`, records every login."""
    state = {"host_key": HOST_KEY, "logins": [], "password": "machine-pw", "fail": None}

    async def scan(host, port):
        return state["host_key"]

    async def run(host, port, user, host_key, command, *, client_key=None, password=None, stdin=None):
        offered = " ".join(state["host_key"].export_public_key("openssh").decode().split()[:2])
        if host_key != offered:
            raise asyncssh.HostKeyNotVerifiable("changed")
        state["logins"].append({"user": user, "port": port, "command": command,
                                "password": password, "key": client_key, "stdin": stdin})
        if state["fail"]:
            raise state["fail"]
        if password is not None and password != state["password"]:
            raise asyncssh.PermissionDenied("no")
        if client_key is not None and client_key.get_comment() == "loskai-status":
            return Done(STATUS)
        return Done()

    monkeypatch.setattr(ssh_client, "scan_host_key", scan)
    monkeypatch.setattr(ssh_client, "run", run)
    return state


@pytest.fixture
def api():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"password": PASSWORD})
        c.post("/api/machines", json={
            "hostname": "nas", "address": "192.168.10.50", "ssh": {"user": "loskai", "port": 2222},
        })
        yield c


def _with_key(api):
    assert api.post("/api/ssh/key", json={"password": PASSWORD}).status_code == 200


def _trust(api):
    fp = api.post("/api/ssh/machines/nas/scan").json()["fingerprint"]
    assert api.post("/api/ssh/machines/nas/trust", json={"fingerprint": fp}).status_code == 200


# --- The host key ---


def test_a_new_machine_s_host_key_is_shown_then_trusted_by_id(api, machine_net):
    scanned = api.post("/api/ssh/machines/nas/scan").json()

    assert scanned == {"fingerprint": HOST_KEY.get_fingerprint(), "type": "ssh-ed25519", "state": "new"}
    api.post("/api/ssh/machines/nas/trust", json={"fingerprint": scanned["fingerprint"]})
    assert api.post("/api/ssh/machines/nas/scan").json()["state"] == "trusted"
    assert logic.known_key(ssh_client.read_known_hosts(), "nas")
    assert api.get("/api/ssh").json()["trusted"] == {"nas": True}


def test_a_changed_host_key_is_reported_and_only_the_shown_one_is_trusted(api, machine_net):
    _trust(api)
    machine_net["host_key"] = OTHER_KEY

    assert api.post("/api/ssh/machines/nas/scan").json()["state"] == "changed"
    # Trusting what was shown earlier, when the machine now answers with another: refused.
    r = api.post("/api/ssh/machines/nas/trust", json={"fingerprint": HOST_KEY.get_fingerprint()})
    assert r.status_code == 409


def test_a_machine_without_an_ssh_user_can_t_be_set_up(api, machine_net):
    api.post("/api/machines", json={"hostname": "pve", "address": "192.168.10.10"})

    assert api.post("/api/ssh/machines/pve/scan").status_code == 409
    assert api.post("/api/ssh/machines/ghost/scan").status_code == 404


# --- Install it for me ---


def test_no_password_is_sent_before_the_host_key_is_trusted(api, machine_net):
    _with_key(api)

    r = api.post("/api/ssh/machines/nas/install", json={"password": "machine-pw"})

    assert r.status_code == 409
    assert machine_net["logins"] == []


def test_install_needs_the_key_unlocked_before_the_machine_password_is_used(api, machine_net):
    _with_key(api)
    _trust(api)
    unlock.lock()

    r = api.post("/api/ssh/machines/nas/install", json={"password": "machine-pw"})

    assert r.status_code == 423
    assert machine_net["logins"] == []


def test_install_adds_both_lines_with_the_password_then_proves_both_keys(api, machine_net):
    _with_key(api)
    _trust(api)

    r = api.post("/api/ssh/machines/nas/install", json={"password": "machine-pw"})

    assert r.status_code == 200, r.text
    assert r.json()["key"] is True
    assert r.json()["running"]["containers"] == [{"name": "web", "image": "nginx", "status": "Up 1 hour"}]
    first, second, third = machine_net["logins"]
    assert first["password"] == "machine-pw" and first["command"] == logic.INSTALL_SCRIPT
    assert first["user"] == "loskai" and first["port"] == 2222
    main, status = first["stdin"].splitlines()
    assert main.startswith('from="192.168.10.216" ssh-ed25519 ') and main.endswith(" loskai")
    assert status.startswith('restrict,from="192.168.10.216",command="') and status.endswith(" loskai-status")
    # Then the keys, not the password.
    assert second["password"] is None and second["key"].get_comment() == "loskai"
    assert third["password"] is None and third["key"].get_comment() == "loskai-status"
    assert "machine-pw" not in r.text


def test_a_wrong_machine_password_says_so_without_echoing_it(api, machine_net):
    _with_key(api)
    _trust(api)

    r = api.post("/api/ssh/machines/nas/install", json={"password": "nope-pw"})

    assert r.status_code == 502
    assert r.json()["detail"] == "loskai@192.168.10.50 refused the password"


def test_an_unreachable_machine_says_where_it_looked(api, machine_net):
    _with_key(api)
    _trust(api)
    machine_net["fail"] = OSError("connection refused")

    r = api.post("/api/ssh/machines/nas/test")

    assert r.status_code == 502 and r.json()["detail"] == "Can't reach 192.168.10.50:2222"


# --- The unlock ---


def test_a_new_key_starts_unlocked_and_logout_locks_it(api, machine_net):
    _with_key(api)
    assert api.get("/api/ssh").json()["key"]["unlocked_until"] is not None

    api.post("/api/logout")
    api.post("/api/login", json={"password": PASSWORD})

    assert api.get("/api/ssh").json()["key"]["unlocked_until"] is None
    assert unlock.unlocked_key() is None


def test_unlock_takes_the_admin_password(api, machine_net):
    _with_key(api)
    unlock.lock()

    assert api.post("/api/ssh/unlock", json={"password": "wrong"}).status_code == 403
    r = api.post("/api/ssh/unlock", json={"password": PASSWORD})

    assert r.status_code == 200 and r.json()["unlocked_until"] is not None


def test_the_key_view_offers_both_lines(api, machine_net):
    _with_key(api)

    lines = api.get("/api/ssh").json()["key"]["lines"]

    assert lines[0].endswith(" loskai") and lines[1].endswith(" loskai-status")
    assert "PRIVATE KEY" not in api.get("/api/ssh").text


def test_the_status_key_is_owner_only_and_new_key_leaves_it(api, machine_net):
    import os

    _with_key(api)
    status_before = api.get("/api/ssh").json()["key"]["lines"][1]
    api.post("/api/ssh/key", json={"password": PASSWORD, "replace": True})

    assert api.get("/api/ssh").json()["key"]["lines"][1] == status_before
    path = config.settings.data_dir + "/ssh/status_ed25519"
    assert os.stat(path).st_mode & 0o777 == 0o600


# --- What runs ---


def test_running_asks_each_set_up_machine_once_per_ttl(api, machine_net):
    _with_key(api)
    _trust(api)

    first = api.get("/api/ssh/running").json()
    second = api.get("/api/ssh/running").json()

    assert first["nas"]["ok"] and first["nas"]["containers"][0]["name"] == "web"
    assert first["nas"]["hidden"] == 1
    assert second == first
    assert len(machine_net["logins"]) == 1  # the cache answered the second time
    assert machine_net["logins"][0]["key"].get_comment() == "loskai-status"


def test_running_works_while_the_key_is_locked(api, machine_net):
    # The point of the status key: no admin password needed, even after a restart.
    _with_key(api)
    _trust(api)
    unlock.lock()

    assert api.get("/api/ssh/running").json()["nas"]["ok"] is True


def test_a_machine_without_the_status_line_says_to_install_again(api, machine_net):
    _with_key(api)
    _trust(api)
    machine_net["fail"] = asyncssh.PermissionDenied("no")

    view = api.get("/api/ssh/running").json()["nas"]

    assert view["ok"] is False and "install again" in view["error"]


def test_deleting_a_machine_forgets_its_host_key(api, machine_net):
    _trust(api)

    api.delete("/api/instances/nas")

    assert logic.known_key(ssh_client.read_known_hosts(), "nas") is None
