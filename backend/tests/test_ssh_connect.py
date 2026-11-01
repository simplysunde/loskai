"""Setting a machine up over SSH, through the HTTP routes, with the network faked at
`client.scan_host_key` / `client.run`: the host key is trusted before any password is sent,
the key must be unlocked, logout locks it, and the running list is cached."""

import asyncio
import json

import asyncssh
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from loskai import config
from loskai.main import app
from loskai.modules.ssh import client as ssh_client
from loskai.modules.ssh import connect, logic, unlock
from loskai.modules.ssh import tool as tool_module
from loskai.shared import assign as assign_module

PASSWORD = "correct horse battery"
HOST_KEY = asyncssh.generate_private_key("ssh-ed25519")
OTHER_KEY = asyncssh.generate_private_key("ssh-ed25519")
STATUS = "#loskai-status 2\n#docker\nweb|nginx|Up 1 hour\n#systemd\ncron.service loaded active running x\n"
FACTS = "#loskai-status 2\n#=os\nPRETTY_NAME=Debian 12\nID=debian\n#=kernel\nLinux 6.1\n#=tools\ntmux\n"


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
    state = {"host_key": HOST_KEY, "logins": [], "password": "machine-pw", "fail": None, "facts": FACTS}

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

    async def open_shell(host, port, user, host_key, client_key, cols, rows, command=None):
        opened.update(host=host, port=port, user=user, key=client_key, size=(cols, rows), command=command)
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
        auth.end_all_sessions()
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
    machine_net["facts"] = STATUS.replace("status 2", "status 1")

    view = api.get("/api/ssh/machines/nas/facts").json()

    assert view["ok"] is False and view["old"] is True and "install again" in view["error"]


def test_the_overview_needs_a_trusted_host_key(api, machine_net):
    assert api.get("/api/ssh/machines/nas/facts").status_code == 409


# --- Tools ---

APT_FACTS = "#loskai-status 2\n#=updates\napt 3\n#=tools\nsudo\n"


def _ready(api, machine_net, facts=APT_FACTS):
    _with_key(api)
    _trust(api)
    machine_net["facts"] = facts


def test_the_tools_are_listed_with_their_commands(api):
    tools = {t["id"]: t for t in api.get("/api/ssh/tools").json()}

    reboot = next(a for a in tools["system"]["actions"] if a["id"] == "reboot")
    assert reboot == {"id": "reboot", "label": "Reboot", "description": "Restart the machine.", "target": None,
                      "confirm": "Everything on it stops until it is back up.", "run": "sudo reboot"}
    assert tools["proxmox"]["installable"] == []


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


def test_an_action_needs_the_machine_s_overview(api, machine_net, shell):
    _ready(api, machine_net, STATUS.replace("status 2", "status 1"))

    code, reason = _closed_with(api, TERMINAL + "&tool=system&action=reboot")

    assert code == 4409 and reason.startswith("Its overview is needed first")
