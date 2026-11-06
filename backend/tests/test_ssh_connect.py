"""Setting a machine up over SSH, through the HTTP routes, with the network faked at
`client.scan_host_key` / `client.run`: the host key is trusted before any password is sent,
the key must be unlocked, logout locks it, and the running list is cached."""

import asyncio
import json
import shlex
import time

import asyncssh
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from loskai import config
from loskai.main import app
from loskai.modules.ssh import client as ssh_client
from loskai.shared import instances as instances_store
from loskai.shared import users as users_module
from loskai.modules.ssh import connect, logic, unlock
from loskai.modules.ssh import tool as tool_module
from loskai.shared import assign as assign_module

PASSWORD = "correct horse battery"
HOST_KEY = asyncssh.generate_private_key("ssh-ed25519")
OTHER_KEY = asyncssh.generate_private_key("ssh-ed25519")
STATUS = "#loskai-status 5\n#docker\nweb|nginx|Up 1 hour\n#systemd\ncron.service loaded active running x\n"
FACTS = "#loskai-status 5\n#=os\nPRETTY_NAME=Debian 12\nID=debian\n#=kernel\nLinux 6.1\n#=tools\ntmux\n"


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
    connect._facts.clear()


@pytest.fixture
def machine_net(monkeypatch):
    """The machine at 192.168.10.50: offers `state["host_key"]`, records every login."""
    state = {"host_key": HOST_KEY, "logins": [], "password": "machine-pw", "fail": None, "facts": FACTS,
             "sudo": "password", "sudo_password": "sudo-pw"}

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
            # The forced command runs whatever is asked; the request only picks the answer.
            return Done(state["facts"] if command == "facts" else STATUS)
        if command == logic.UNINSTALL_SCRIPT:
            return Done(state.get("uninstall_out", ""))
        # A tool's settings: read back as the machine has them; a write is recorded.
        if "#loskai-setting" in command:
            return Done(state.get("settings_out", ""))
        if "git config --global" in command:
            state.setdefault("writes", []).append(command)
            return Done(exit_status=state.get("write_status", 0), stderr="error: could not lock config file\n")
        # sudo as the machine has it: "password" asks for `sudo_password`, "nopasswd" doesn't
        # ask, "none" — the user isn't in sudoers.
        if command == "sudo -n true":
            return Done(exit_status=0 if state["sudo"] == "nopasswd" else 1, stderr="sudo: a password is required\n")
        if command == "sudo -S -p '' -v":
            if state["sudo"] == "none":
                return Done(exit_status=1, stderr="loskai is not in the sudoers file.\n")
            return Done(exit_status=0 if stdin == state["sudo_password"] + "\n" else 1, stderr="Sorry, try again.\n")
        return Done()

    monkeypatch.setattr(ssh_client, "scan_host_key", scan)
    monkeypatch.setattr(ssh_client, "run", run)
    return state


@pytest.fixture
def api():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
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

    assert scanned == {
        "fingerprint": HOST_KEY.get_fingerprint(), "type": "ssh-ed25519", "state": "new",
        "lines": None,  # no key yet
    }
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
    api.post("/api/login", json={"username": "admin", "password": PASSWORD})

    assert api.get("/api/ssh").json()["key"]["unlocked_until"] is None
    assert unlock.unlocked_key("admin") is None


def test_unlock_takes_the_admin_password(api, machine_net):
    _with_key(api)
    unlock.lock()

    assert api.post("/api/ssh/unlock", json={"password": "wrong"}).status_code == 403
    r = api.post("/api/ssh/unlock", json={"password": PASSWORD})

    assert r.status_code == 200 and r.json()["unlocked_until"] is not None


def test_an_unlock_lasts_as_long_as_settings_say(api, machine_net):
    from datetime import datetime

    _with_key(api)
    unlock.lock()
    assert api.put("/api/settings", json={"ssh_unlock_minutes": "180"}, headers=ORIGIN).status_code == 200

    until = api.post("/api/ssh/unlock", json={"password": PASSWORD}).json()["unlocked_until"]

    left = datetime.fromisoformat(until).timestamp() - time.time()
    assert 3 * 3600 - 60 < left <= 3 * 3600


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


def test_deleting_a_set_up_machine_takes_loskai_s_lines_off_it_first(api, machine_net):
    _with_key(api)
    _trust(api)

    assert api.delete("/api/instances/nas").json()["warning"] is None

    last = machine_net["logins"][-1]
    assert last["command"] == logic.UNINSTALL_SCRIPT and last["key"].get_comment() == "loskai"
    assert api.get("/api/ssh/log").json()[0] | {"at": None} == {
        "at": None, "event": "uninstall", "machine": "nas", "from": None, "ok": True,
        "user": "admin",  # who deleted it
    }


def test_a_delete_that_fails_at_caddy_leaves_loskai_s_key_on_the_machine(api, machine_net, monkeypatch):
    # Found live: the key came off first, then Caddy's required step failed — the machine
    # stayed in Loskai without its key. The key now comes off only once nothing can stop it.
    from loskai.shared import assign

    _with_key(api)
    _trust(api)

    async def caddy_down(*args, **kwargs):
        raise assign.AssignError("Caddy route delete failed", 502)

    monkeypatch.setattr(assign, "unassign", caddy_down)

    assert api.delete("/api/instances/nas").status_code == 502
    assert all(login["command"] != logic.UNINSTALL_SCRIPT for login in machine_net["logins"])
    assert instances_store.get_instance("nas") is not None


def test_a_locked_key_stops_the_delete_until_it_is_unlocked(api, machine_net):
    _with_key(api)
    _trust(api)
    unlock.lock()

    r = api.delete("/api/instances/nas")

    assert r.status_code == 423
    # Nothing happened: still a machine, still trusted, nothing run on it.
    assert instances_store.get_instance("nas") is not None
    assert logic.known_key(ssh_client.read_known_hosts(), "nas") is not None
    assert all(login["command"] != logic.UNINSTALL_SCRIPT for login in machine_net["logins"])


def test_a_machine_that_can_t_be_reached_is_deleted_with_a_warning(api, machine_net):
    _with_key(api)
    _trust(api)
    machine_net["fail"] = OSError("No route to host")

    r = api.delete("/api/instances/nas")

    warning = r.json()["warning"]
    assert r.status_code == 200 and warning.startswith("Loskai's key and any sudo rule it added are still on the machine")
    assert "authorized_keys by hand" in warning and "rm -f /etc/sudoers.d/loskai" in warning  # what to do
    assert logic.known_key(ssh_client.read_known_hosts(), "nas") is None


def test_deleting_a_machine_forgets_its_host_key(api, machine_net):
    _trust(api)

    api.delete("/api/instances/nas")

    assert logic.known_key(ssh_client.read_known_hosts(), "nas") is None


# --- The terminal ---


class FakeShell:
    """A pty shell that greets, then echoes whatever arrives — so a test can see its
    keystrokes reach the machine — and records resizes and its own hang-up."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()
        self.queue.put_nowait(b"welcome\r\n")
        self.sizes: list[tuple[int, int]] = []
        self.closed = False
        self.stdout = self
        self.stdin = self

    async def read(self, _n):
        return await self.queue.get()

    def write(self, data):
        self.queue.put_nowait(b"got:" + data)

    def change_terminal_size(self, cols, rows):
        self.sizes.append((cols, rows))

    def close(self):  # the connection: closing it hangs the pty up
        self.closed = True


@pytest.fixture
def shell(monkeypatch, machine_net):
    opened: dict = {}

    async def open_shell(host, port, user, host_key, client_key, cols, rows, command=None, first_line=None):
        opened.update(host=host, port=port, user=user, key=client_key, size=(cols, rows), command=command,
                      first_line=first_line)
        opened["shell"] = FakeShell()
        return opened["shell"], opened["shell"]

    monkeypatch.setattr(ssh_client, "open_shell", open_shell)
    return opened


ORIGIN = {"origin": "http://testserver"}
TERMINAL = "/api/ssh/machines/nas/terminal?cols=120&rows=40"


def _closed_with(api, url=TERMINAL, headers=ORIGIN):
    with api.websocket_connect(url, headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_bytes()
    return exc.value.code, exc.value.reason


def test_the_terminal_is_a_shell_on_the_machine_with_the_main_key(api, shell):
    _with_key(api)
    _trust(api)

    with api.websocket_connect(TERMINAL, headers=ORIGIN) as ws:
        assert ws.receive_bytes() == b"welcome\r\n"
        ws.send_bytes(b"ech\t")  # Tab goes to the machine's shell, which completes
        assert ws.receive_bytes() == b"got:ech\t"
        ws.send_text(json.dumps({"type": "resize", "cols": 100, "rows": 30}))
        ws.send_bytes(b"x")
        assert ws.receive_bytes() == b"got:x"

    assert shell["user"] == "loskai" and shell["port"] == 2222 and shell["size"] == (120, 40)
    assert shell["key"].get_comment() == "loskai"
    assert shell["shell"].sizes == [(100, 30)]
    assert shell["shell"].closed  # the browser's terminal closed, so the shell is hung up


def test_a_malformed_resize_is_ignored_and_the_terminal_goes_on(api, shell):
    _with_key(api)
    _trust(api)

    with api.websocket_connect(TERMINAL, headers=ORIGIN) as ws:
        assert ws.receive_bytes() == b"welcome\r\n"
        for bad in ({"type": "resize", "rows": None}, {"type": "resize", "cols": "wide", "rows": 30}, {"type": "resize"}):
            ws.send_text(json.dumps(bad))
        ws.send_text(json.dumps({"type": "resize", "rows": -1, "cols": 10**12}))  # clamped
        ws.send_bytes(b"x")
        assert ws.receive_bytes() == b"got:x"

    assert shell["shell"].sizes == [(1000, 1)]


def test_a_resize_the_shell_refuses_doesn_t_end_the_terminal(api, shell, monkeypatch):
    def refuse(self, cols, rows):
        raise OverflowError("size out of range")

    monkeypatch.setattr(FakeShell, "change_terminal_size", refuse)
    _with_key(api)
    _trust(api)

    with api.websocket_connect(TERMINAL, headers=ORIGIN) as ws:
        assert ws.receive_bytes() == b"welcome\r\n"
        ws.send_text(json.dumps({"type": "resize", "rows": 30, "cols": 100}))
        ws.send_bytes(b"x")
        assert ws.receive_bytes() == b"got:x"


def test_a_sibling_page_can_t_open_a_terminal(api, shell):
    _with_key(api)
    _trust(api)

    with pytest.raises(WebSocketDisconnect) as exc:
        with api.websocket_connect(TERMINAL, headers={"origin": "https://evil.example.no"}):
            pass

    assert exc.value.code == 1008
    assert "shell" not in shell


def test_a_locked_key_opens_no_terminal_and_says_why(api, shell):
    _with_key(api)
    _trust(api)
    unlock.lock()

    code, reason = _closed_with(api)

    assert code == 4423 and "locked" in reason
    assert "shell" not in shell


def test_an_untrusted_machine_opens_no_terminal(api, shell):
    _with_key(api)

    assert _closed_with(api)[0] == 4409


def test_logging_out_closes_an_open_terminal(api, shell, monkeypatch):
    from loskai.shared import auth

    monkeypatch.setattr(auth, "SESSION_RECHECK", 0.05)
    _with_key(api)
    _trust(api)

    with api.websocket_connect(TERMINAL, headers=ORIGIN) as ws:
        ws.receive_bytes()
        users_module.end_sessions("admin")
        with pytest.raises(WebSocketDisconnect):
            ws.receive_bytes()
            ws.receive_bytes()

    assert shell["shell"].closed


def test_the_log_records_sessions_and_installs_but_not_what_is_typed(api, shell):
    _with_key(api)
    _trust(api)
    api.post("/api/ssh/machines/nas/install", json={"password": "machine-pw"})
    with api.websocket_connect(TERMINAL, headers=ORIGIN) as ws:
        ws.receive_bytes()
        ws.send_bytes(b"sudo -S true\nmy-sudo-pw\n")
        ws.receive_bytes()
    unlock.lock()
    _closed_with(api)

    log = api.get("/api/ssh/log").json()

    assert [e["event"] for e in log] == ["refused", "close", "open", "install"]  # newest first
    assert log[2]["target"] == "loskai@192.168.10.50:2222" and log[2]["machine"] == "nas"
    assert log[3]["ok"] is True
    assert "locked" in log[0]["error"]
    text = (config.settings.data_dir + "/ssh/sessions.log")
    with open(text) as f:
        raw = f.read()
    assert "my-sudo-pw" not in raw and "machine-pw" not in raw


def test_an_error_of_loskai_s_own_is_logged_with_its_cause(api, machine_net, monkeypatch, caplog):
    # 2026-10-31: in the container the app's uid had no user name, asyncssh raised a
    # ValueError, and the page said only "SSH to … failed".
    async def no_user(host, port):
        raise ValueError("Unknown local username: set one of LOGNAME, USER, LNAME, or USERNAME")

    monkeypatch.setattr(ssh_client, "scan_host_key", no_user)

    r = api.post("/api/ssh/machines/nas/scan")

    assert r.status_code == 502
    assert r.json()["detail"] == "SSH to 192.168.10.50 failed — see Loskai's log"
    assert "Unknown local username" in caplog.text


# --- from= for the Docker host itself ---


def test_the_docker_host_s_lines_also_allow_loskai_s_own_networks(api, machine_net, monkeypatch):
    # Docker doesn't translate a container's connection to its own host: sshd there sees
    # Loskai's container address (172.18.0.2, live 2026-10-31), not the host's LAN IP.
    from loskai.modules.docker.client import docker_client

    monkeypatch.setattr(docker_client, "own_subnets", lambda: ["172.18.0.0/16"])
    api.post("/api/machines", json={
        "hostname": "codebox", "address": "192.168.10.216", "ssh": {"user": "vm", "port": 22},
    })
    _with_key(api)

    host_lines = api.post("/api/ssh/machines/codebox/scan").json()["lines"]
    other_lines = api.post("/api/ssh/machines/nas/scan").json()["lines"]

    assert host_lines[0].startswith('from="192.168.10.216,172.18.0.0/16" ssh-ed25519 ')
    assert host_lines[1].startswith('restrict,from="192.168.10.216,172.18.0.0/16",command=')
    # Every other machine sees the host's LAN IP, so its lines stay that narrow.
    assert other_lines[0].startswith('from="192.168.10.216" ssh-ed25519 ')

    fp = api.post("/api/ssh/machines/codebox/scan").json()["fingerprint"]
    api.post("/api/ssh/machines/codebox/trust", json={"fingerprint": fp})
    api.post("/api/ssh/machines/codebox/install", json={"password": "machine-pw"})
    installed = machine_net["logins"][0]["stdin"]
    assert installed.startswith('from="192.168.10.216,172.18.0.0/16" ')


def test_without_docker_the_docker_host_gets_the_plain_line(api, machine_net, monkeypatch):
    from loskai.modules.docker.client import docker_client

    def unreachable():
        raise OSError("no socket")

    monkeypatch.setattr(docker_client, "own_subnets", unreachable)
    api.post("/api/machines", json={
        "hostname": "codebox", "address": "192.168.10.216", "ssh": {"user": "vm", "port": 22},
    })
    _with_key(api)

    assert api.post("/api/ssh/machines/codebox/scan").json()["lines"][0].startswith(
        'from="192.168.10.216" ssh-ed25519 '
    )


# --- The overview ---


def test_the_overview_is_read_with_the_status_key_and_cached(api, machine_net):
    _with_key(api)
    _trust(api)
    unlock.lock()  # no admin password needed, like the running list

    first = api.get("/api/ssh/machines/nas/facts").json()
    second = api.get("/api/ssh/machines/nas/facts").json()

    assert first["ok"] and first["os"] == "Debian 12" and first["programs"] == ["tmux"]
    assert second == first
    asked = [x for x in machine_net["logins"] if x["command"] == "facts"]
    assert len(asked) == 1 and asked[0]["key"].get_comment() == "loskai-status"


def test_a_machine_on_the_older_status_line_is_asked_to_reinstall(api, machine_net):
    _with_key(api)
    _trust(api)
    machine_net["facts"] = STATUS.replace("status 5", "status 4")

    view = api.get("/api/ssh/machines/nas/facts").json()

    assert view["ok"] is False and view["old"] is True and "install again" in view["error"]


def test_the_overview_needs_a_trusted_host_key(api, machine_net):
    assert api.get("/api/ssh/machines/nas/facts").status_code == 409


# --- Tools ---

APT_FACTS = "#loskai-status 5\n#=updates\napt 3\n#=tools\nsudo\n"


def _ready(api, machine_net, facts=APT_FACTS):
    _with_key(api)
    _trust(api)
    machine_net["facts"] = facts


def test_the_tools_are_listed_with_their_commands(api):
    tools = {t["id"]: t for t in api.get("/api/ssh/tools").json()}

    reboot = next(a for a in tools["system"]["actions"] if a["id"] == "reboot")
    assert reboot == {"id": "reboot", "label": "Reboot", "description": "Restart the machine.", "target": None,
                      "ask": None, "confirm": "Everything on it stops until it is back up.", "session": None,
                      "automatic": True, "run": "sudo reboot"}
    assert tools["proxmox"]["installable"] == []
    assert tools["tailscale"]["installable"] == ["tailscale"]


def test_an_action_runs_its_tool_s_command_in_the_terminal_and_is_logged(api, machine_net, shell):
    _ready(api, machine_net)

    with api.websocket_connect(TERMINAL + "&tool=system&action=update", headers=ORIGIN) as ws:
        assert ws.receive_bytes() == b"welcome\r\n"

    # The machine's package manager picked the command; no tmux there, so it runs plainly.
    assert "sudo apt-get update && sudo apt-get -y dist-upgrade" in shell["command"]
    assert not shell["command"].startswith("tmux")
    entry = api.get("/api/ssh/log").json()[1]
    assert entry["event"] == "action" and entry["tool"] == "system" and entry["action"] == "update"
    assert entry["command"] == "sudo apt-get update && sudo apt-get -y dist-upgrade"


def test_with_tmux_an_action_runs_in_its_own_session(api, machine_net, shell):
    _ready(api, machine_net, APT_FACTS + "tmux\n")

    with api.websocket_connect(TERMINAL + "&tool=services&action=restart-service&target=nginx", headers=ORIGIN) as ws:
        ws.receive_bytes()

    assert shell["command"].startswith("tmux new-session -A -s loskai-services-restart-service-nginx ")
    assert "loskai nginx" in shell["command"]  # the target, as $1


@pytest.mark.parametrize(("query", "code", "reason"), [
    ("&tool=services&action=restart-service&target=a%20b", 4409, "Not a service"),
    ("&tool=services&action=restart-service", 4409, "Not a service"),
    ("&tool=services&action=format", 4404, "no action"),
    ("&tool=nope&action=x", 4404, "No tool"),
    ("&tool=proxmox&action=reboot-lxc&target=101", 4409, "needs pct, qm"),
    ("&tool=proxmox&install=true", 4409, "can't be installed from here"),
    ("&tool=system&install=true", 4409, "has everything"),
])
def test_an_action_that_can_t_run_here_is_refused_before_anything_runs(api, machine_net, shell, query, code, reason):
    _ready(api, machine_net)

    got_code, got_reason = _closed_with(api, TERMINAL + query)

    assert got_code == code and reason in got_reason
    assert "command" not in shell  # nothing was opened


def test_adding_a_tool_installs_what_it_lacks_with_the_machine_s_package_manager(api, machine_net, shell, monkeypatch, tmp_path):
    (tmp_path / "multiplex.yml").write_text(
        "name: Multiplex\ndescription: d\nrequires: [tmux, git]\n"
        "actions: {ls: {label: List, description: d, run: tmux ls}}\n"
    )
    monkeypatch.setattr(tool_module, "DIR", tmp_path)
    _ready(api, machine_net, APT_FACTS + "git\n")

    assert _closed_with(api, TERMINAL + "&tool=multiplex&action=ls")[1].startswith("Multiplex needs tmux")
    with api.websocket_connect(TERMINAL + "&tool=multiplex&install=true", headers=ORIGIN) as ws:
        ws.receive_bytes()

    assert "sudo apt-get update && sudo apt-get install -y tmux" in shell["command"]
    assert not shell["command"].startswith("tmux")  # never in tmux: it may be what is missing
    entry = api.get("/api/ssh/log").json()[1]
    assert entry["event"] == "add-tool" and entry["programs"] == ["tmux"]


def test_a_typed_name_reaches_the_command_as_1_and_tmux_itself_is_not_wrapped_in_tmux(api, machine_net, shell):
    _ready(api, machine_net, APT_FACTS + "tmux\n")

    with api.websocket_connect(TERMINAL + "&tool=tmux&action=new&target=work", headers=ORIGIN) as ws:
        ws.receive_bytes()

    assert shell["command"].startswith("sh -c ")
    assert 'tmux new-session -A -s "$1"' in shell["command"] and shell["command"].endswith("read _")
    assert " loskai work;" in shell["command"]
    assert _closed_with(api, TERMINAL + "&tool=tmux&action=new&target=a%3Bid") == (4409, "Not a session: 'a;id'")


def test_a_machine_s_projects_folder_is_set_on_its_page_and_kept_through_an_edit(api):
    assert api.get("/api/ssh").json()["projects"] == {"nas": "~/projects"}
    assert api.put("/api/ssh/machines/nas/projects", json={"folder": "~/code"}).json() == {"folder": "~/code"}
    api.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.51", "instance_id": "nas"})

    assert api.get("/api/ssh").json()["projects"] == {"nas": "~/code"}
    assert api.put("/api/ssh/machines/nas/projects", json={"folder": "/srv"}).status_code == 422
    assert api.put("/api/ssh/machines/ghost/projects", json={"folder": "~"}).status_code == 404
    assert api.put("/api/ssh/machines/nas/projects", json={"folder": None}).json() == {"folder": "~/projects"}


def test_a_project_action_runs_in_its_claude_session_in_the_machine_s_folder(api, machine_net, shell):
    _ready(api, machine_net, APT_FACTS + "tmux\nclaude\ngit\n")
    api.put("/api/ssh/machines/nas/projects", json={"folder": "~/code"})

    with api.websocket_connect(TERMINAL + "&tool=claude&action=open&target=site", headers=ORIGIN) as ws:
        ws.receive_bytes()

    assert shell["command"].startswith("tmux new-session -A -s claude-site ")
    assert "PROJECTS=$HOME/code;" in shell["command"] and "claude --remote-control" in shell["command"]
    assert _closed_with(api, TERMINAL + "&tool=claude&action=new&target=..")[1] == "Not a project: '..'"


def test_an_action_needs_the_machine_s_overview(api, machine_net, shell):
    _ready(api, machine_net, STATUS.replace("status 5", "status 4"))

    code, reason = _closed_with(api, TERMINAL + "&tool=system&action=reboot")

    assert code == 4409 and reason.startswith("Its overview is needed first")


# --- Updates without a password ---


def test_the_sudo_rule_goes_on_in_the_terminal_for_the_machine_s_package_manager(api, machine_net, shell):
    _ready(api, machine_net)

    with api.websocket_connect(TERMINAL + "&sudo=allow", headers=ORIGIN) as ws:
        ws.receive_bytes()

    # The user types the password at sudo's prompt there; Loskai only wrote the script.
    assert shell["command"] == tool_module.visible(tool_module.allow_script("apt"), None, None, automatic=True)
    entry = api.get("/api/ssh/log").json()[1]
    assert entry["event"] == "sudo-rule" and entry["allow"] is True


def test_the_sudo_rule_comes_off_in_the_terminal(api, machine_net, shell):
    _ready(api, machine_net)

    with api.websocket_connect(TERMINAL + "&sudo=remove", headers=ORIGIN) as ws:
        ws.receive_bytes()

    assert shell["command"] == tool_module.visible(tool_module.REMOVE_RULE_SCRIPT, None, None, automatic=True)


def test_the_sudo_rule_needs_the_overview_to_know_the_package_manager(api, machine_net):
    _ready(api, machine_net, FACTS.replace("status 5", "status 4"))

    with pytest.raises(WebSocketDisconnect) as closed:
        with api.websocket_connect(TERMINAL + "&sudo=allow", headers=ORIGIN) as ws:
            ws.receive_bytes()
    assert closed.value.code == 4409


def test_a_sudo_rule_that_stays_on_a_deleted_machine_is_said(api, machine_net):
    _with_key(api)
    _trust(api)
    machine_net["uninstall_out"] = "!sudo-rule\n"

    r = api.delete("/api/instances/nas")

    assert r.status_code == 200 and "its sudo rule stayed" in r.json()["warning"]
    assert "rm -f /etc/sudoers.d/loskai" in r.json()["warning"]


# --- sudo's password, asked for before an automatic run ---


def _prepare(api, password=None, **run):
    body = {"tool": "system", "action": "update", **run, **({"password": password} if password else {})}
    return api.post("/api/ssh/machines/nas/run", json=body, headers=ORIGIN)


def test_an_automatic_run_asks_for_sudo_s_password_only_when_sudo_would(api, machine_net):
    _ready(api, machine_net, APT_FACTS + "tmux\n")

    assert _prepare(api).json() == {"automatic": True, "needs_password": True, "user": "loskai", "ticket": None}
    machine_net["sudo"] = "nopasswd"
    assert _prepare(api).json()["needs_password"] is False
    # Not automatic: the terminal is the place for it, as before.
    machine_net["logins"].clear()
    assert _prepare(api, tool="tmux", action="new", target="work").json() == {
        "automatic": False, "needs_password": False, "ticket": None}
    assert not [x for x in machine_net["logins"] if x["command"].startswith("sudo")]



def test_adding_tailscale_asks_for_sudo_s_password_first(api, machine_net):
    # Its installer calls sudo itself; the command has to say so, or the dialog never asks
    # and the run stops at sudo's prompt in a terminal meant to need no one.
    _ready(api, machine_net, APT_FACTS + "curl\n")

    asked = _prepare(api, tool="tailscale", action=None, install=True).json()

    assert asked["automatic"] is True and asked["needs_password"] is True

def test_no_password_is_asked_for_root_or_what_the_sudo_rule_covers(api, machine_net):
    _ready(api, machine_net, APT_FACTS + "#=sudo\non\n")
    assert _prepare(api).json()["needs_password"] is False  # Update, with the rule on
    assert _prepare(api, action="reboot").json()["needs_password"] is True
    assert _prepare(api, sudo="remove", tool=None, action=None).json()["needs_password"] is False

    api.post("/api/machines", json={"hostname": "nas", "address": "192.168.10.50", "instance_id": "nas",
                                    "ssh": {"user": "root", "port": 2222}})
    assert _prepare(api, action="reboot").json()["needs_password"] is False


def test_a_wrong_password_is_said_before_the_terminal_and_a_user_without_sudo_too(api, machine_net):
    _ready(api, machine_net)

    r = _prepare(api, password="wrong")
    assert r.status_code == 422 and r.json()["detail"] == "sudo didn't accept that password for loskai"
    machine_net["sudo"] = "none"
    r = _prepare(api, password="sudo-pw")
    assert r.status_code == 409 and r.json()["detail"] == "loskai may not use sudo there"


def test_the_password_goes_to_the_terminal_once_as_its_first_line_and_never_into_the_log(api, machine_net, shell):
    _ready(api, machine_net)
    ticket = _prepare(api, password="sudo-pw").json()["ticket"]
    url = TERMINAL + f"&tool=system&action=update&ticket={ticket}"

    with api.websocket_connect(url, headers=ORIGIN) as ws:
        ws.receive_bytes()

    assert shell["first_line"] == "sudo-pw"
    assert shell["command"].startswith("IFS= read -r p; stty echo") and "sudo-pw" not in shell["command"]
    entry = api.get("/api/ssh/log").json()[1]
    assert entry["event"] == "action" and entry["sudo_password"] is True
    assert "sudo-pw" not in ssh_client._log_path().read_text()
    assert "sudo-pw" not in json.dumps(api.get("/api/ssh/log").json())
    # Taken once.
    assert _closed_with(api, url) == (4409, "That password is no longer held — run it again")


def test_a_ticket_is_only_for_its_machine_and_its_user(api, machine_net, shell):
    _ready(api, machine_net)
    ticket = _prepare(api, password="sudo-pw").json()["ticket"]

    assert _closed_with(api, TERMINAL.replace("/nas/", "/pve/") + f"&tool=system&action=update&ticket={ticket}")[0] in (4404, 4409)
    assert _closed_with(api, TERMINAL + f"&ticket={ticket}") == (4422, "A password is only for a tool's action")


def test_a_ticket_never_taken_is_gone_when_its_time_is_up(api, machine_net, monkeypatch):
    """Closing the dialog before the terminal opens must not leave sudo's password in memory."""
    _ready(api, machine_net)
    monkeypatch.setattr(connect, "PASSWORD_TTL", 0.05)
    monkeypatch.setattr(connect, "_passwords", {})  # other tests' tickets still have their minute

    assert _prepare(api, password="sudo-pw").json()["ticket"]
    assert len(connect._passwords) == 1
    time.sleep(0.3)

    assert connect._passwords == {}


def test_a_ticket_is_only_for_the_run_it_was_given_for(api, machine_net, shell):
    """The password was typed for Update; a terminal opened for another action with that
    ticket gets nothing — sudo's password goes only where the dialog said."""
    _ready(api, machine_net)
    ticket = _prepare(api, password="sudo-pw").json()["ticket"]

    assert _closed_with(api, TERMINAL + f"&tool=system&action=reboot&ticket={ticket}") == (
        4409, "That password is no longer held — run it again")
    assert "first_line" not in shell


# --- A tool's settings ---

GIT_FACTS = APT_FACTS + "git\n"
SETTINGS = "/api/ssh/machines/nas/tools/git/settings"


def test_git_s_name_and_email_are_read_from_the_machine_with_the_main_key(api, machine_net):
    _ready(api, machine_net, GIT_FACTS)
    machine_net["settings_out"] = "#loskai-setting name\nOla Nordmann\n#loskai-setting email\n"

    assert api.get(SETTINGS).json() == {"values": {"name": "Ola Nordmann", "email": None}}
    read = machine_net["logins"][-1]
    assert read["key"].get_comment() == "loskai" and read["command"].startswith("sh -c ")
    # The overview finds programs in ~/.local/bin, so the settings it offers look there too.
    assert read["command"].startswith("sh -c " + shlex.quote(logic.USER_PATH)[:-1])


def test_setting_one_writes_it_as_1_then_reads_them_back_and_logs_it(api, machine_net):
    _ready(api, machine_net, GIT_FACTS)
    machine_net["settings_out"] = "#loskai-setting name\n#loskai-setting email\nola@example.no\n"

    r = api.put(SETTINGS + "/email", json={"value": " ola@example.no "}, headers=ORIGIN)

    assert r.status_code == 200 and r.json()["values"]["email"] == "ola@example.no"
    assert machine_net["writes"] == ["sh -c " + shlex.quote(
        logic.USER_PATH + "sh -c 'git config --global user.email \"$1\"' loskai ola@example.no")]
    entry = api.get("/api/ssh/log").json()[0]
    assert entry["event"] == "setting" and entry["value"] == "ola@example.no" and entry["ok"] is True


def test_a_setting_is_refused_before_anything_runs_when_it_can_t_be_set(api, machine_net):
    _ready(api, machine_net, GIT_FACTS)

    assert api.put(SETTINGS + "/email", json={"value": "not an address"}, headers=ORIGIN).status_code == 422
    assert api.put(SETTINGS + "/colour", json={"value": "x"}, headers=ORIGIN).status_code == 404
    assert "writes" not in machine_net
    machine_net["write_status"] = 255
    r = api.put(SETTINGS + "/name", json={"value": "Ola"}, headers=ORIGIN)
    assert r.status_code == 502 and r.json()["detail"] == "The machine said: error: could not lock config file"


def test_git_s_settings_need_git_and_the_key(api, machine_net):
    _ready(api, machine_net)  # no git there
    assert api.get(SETTINGS).json()["detail"] == "Git needs git — add it first"

    api.post("/api/logout", headers=ORIGIN)
    api.post("/api/login", json={"username": "admin", "password": PASSWORD})
    connect._drop_cached("nas")
    machine_net["facts"] = GIT_FACTS
    assert api.get(SETTINGS).status_code == 423  # the key locked with the logout


# --- Removing a machine's SSH connection ---


def _remove_ssh(api):
    return api.post("/api/machines", json={
        "hostname": "nas", "address": "192.168.10.50", "instance_id": "nas", "ssh": None,
    })


def test_removing_the_ssh_connection_takes_loskai_s_things_off_the_machine(api, machine_net):
    _with_key(api)
    _trust(api)

    r = _remove_ssh(api)

    # Nothing about the machine's own things: AdGuard isn't configured here, that's all.
    assert r.status_code == 200 and "machine" not in (r.json()["warning"] or "")
    assert machine_net["logins"][-1]["command"] == logic.UNINSTALL_SCRIPT
    # Its entry and its trusted host key go; the machine stays.
    assert "nas" not in logic.hosts(ssh_client.read_config())
    assert logic.known_key(ssh_client.read_known_hosts(), "nas") is None
    assert instances_store.get_instance("nas") is not None


def test_a_locked_key_stops_removing_the_ssh_connection(api, machine_net):
    _with_key(api)
    _trust(api)
    unlock.lock()

    assert _remove_ssh(api).status_code == 423
    assert "nas" in logic.hosts(ssh_client.read_config())
    assert all(login["command"] != logic.UNINSTALL_SCRIPT for login in machine_net["logins"])


def test_a_connection_never_set_up_is_removed_without_reaching_the_machine(api, machine_net):
    assert _remove_ssh(api).status_code == 200
    assert "nas" not in logic.hosts(ssh_client.read_config())
    assert machine_net["logins"] == []


def test_a_machine_that_can_t_be_reached_loses_its_ssh_connection_with_a_warning(api, machine_net):
    _with_key(api)
    _trust(api)
    machine_net["fail"] = OSError("No route to host")

    r = _remove_ssh(api)

    assert r.status_code == 200 and "still on the machine" in r.json()["warning"]
    assert "nas" not in logic.hosts(ssh_client.read_config())
