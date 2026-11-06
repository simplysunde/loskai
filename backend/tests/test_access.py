"""Who may call what: each level what it adds and everything below (shared/access.py)."""

import json
import pathlib
import re

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from loskai import config
from loskai.main import app
from loskai.shared import access, auth, users
from loskai.shared import instances as instances_store
from loskai.shared.instances import Instance

ADMIN_PASSWORD = "correct horse battery"
ORIGIN = {"origin": "http://testserver"}


@pytest.fixture(autouse=True)
def no_env_password(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", None)


@pytest.fixture
def admin():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": ADMIN_PASSWORD})
        yield c


def _operator(admin, name: str, level: int) -> TestClient:
    r = admin.post("/api/users", json={"username": name, "password": f"{name}-password", "level": level})
    assert r.status_code == 200, r.text
    c = TestClient(app)
    assert c.post("/api/login", json={"username": name, "password": f"{name}-password"}).status_code == 200
    return c


# --- The table covers every route ---


def _routes() -> list[tuple[str, str]]:
    """Every HTTP route in the code, read from its decorator and its router's prefix."""
    found = []
    for f in pathlib.Path(config.__file__).parent.rglob("*.py"):
        text = f.read_text()
        prefix = re.search(r'APIRouter\(prefix="([^"]*)"', text)
        for m in re.finditer(r'@router\.(get|post|put|patch|delete)\(\s*"([^"]*)"', text):
            path = (prefix.group(1) if prefix else "") + m.group(2)
            found.append((m.group(1).upper(), re.sub(r"\{[^}]+\}", "x", path)))
    return found


def test_every_route_says_who_may_call_it():
    # A route with no line would be admin-only by default — safe, but a decision nobody
    # made. Public routes need no line: no account is involved.
    routes = _routes()
    assert len(routes) > 60
    unlisted = [
        (m, p) for m, p in routes
        if (m, p) not in auth.PUBLIC_ROUTES
        and not any(m == verb and pattern.match(p) for verb, pattern in auth.PUBLIC_PATTERNS)
        and access.rule_for(m, p) is None
    ]
    assert unlisted == []


# --- Each level, and the ones below it ---


def test_a_level_uses_what_it_adds_and_everything_below_and_nothing_above(admin):
    docker = _operator(admin, "ola", users.DOCKER)
    routing = _operator(admin, "kari", users.ROUTING)

    assert docker.get("/api/docker/volumes").status_code != 403
    assert docker.get("/api/caddy/routes").status_code == 200  # Routing comes with it
    refused = docker.get("/api/ssh")
    assert refused.status_code == 403 and refused.json()["detail"] == "That needs level 3, Machines"
    assert routing.get("/api/caddy/routes").status_code == 200
    assert routing.get("/api/docker/volumes").json()["detail"] == "That needs level 2, Docker"


def test_settings_users_and_the_backup_are_the_admin_s(admin):
    op = _operator(admin, "ola", users.MACHINES)

    for method, path in [("PUT", "/api/settings"), ("GET", "/api/users"), ("GET", "/api/export"),
                         ("POST", "/api/ssh/key"), ("POST", "/api/adguard/rewrites/clear")]:
        r = op.request(method, path, json={}, headers=ORIGIN)
        assert r.status_code == 403 and r.json()["detail"] == "Only an admin can do that", (method, path)


def test_every_account_reads_settings_but_only_an_admin_sees_secrets(admin):
    admin.put("/api/settings", json={"adguard_password": "hunter22"}, headers=ORIGIN)
    op = _operator(admin, "ola", users.ROUTING)

    assert op.get("/api/settings").json()["adguard_password"]["value"] is None
    assert admin.get("/api/settings").json()["adguard_password"]["value"] == "hunter22"


def test_a_record_s_own_level_decides_who_deletes_or_renames_it(admin):
    instances_store.upsert_instance(Instance(id="nas", name="nas", type="external", kind="machine", upstream="10.0.0.5"))
    instances_store.upsert_instance(Instance(id="web", name="web", type="external", kind="service", upstream="10.0.0.5:80"))
    routing = _operator(admin, "ola", users.ROUTING)

    assert routing.patch("/api/instances/nas", json={"name": "x"}, headers=ORIGIN).status_code == 403
    assert routing.delete("/api/instances/nas", headers=ORIGIN).status_code == 403
    assert instances_store.get_instance("nas") is not None
    assert routing.patch("/api/instances/web", json={"private": True}, headers=ORIGIN).status_code == 200
    # Its icon too: Routing can't change a machine's; Machines changes both.
    machines = _operator(admin, "kari", users.MACHINES)
    assert routing.delete("/api/instances/nas/icon", headers=ORIGIN).status_code == 403
    assert routing.post("/api/instances/nas/icon", content=b"x", headers=ORIGIN).status_code == 403
    assert machines.delete("/api/instances/web/icon", headers=ORIGIN).status_code == 200
    assert machines.delete("/api/instances/nas/icon", headers=ORIGIN).status_code == 200


def test_the_create_endpoints_change_only_a_record_at_the_caller_s_level(admin):
    admin.put("/api/settings", json={"base_domain": "home.lan"}, headers=ORIGIN)
    nas = Instance(id="nas", name="nas", type="external", kind="machine", upstream="10.0.0.5", subdomain="nas", origin="gateway")
    web = Instance(id="web", name="web", type="external", kind="service", upstream="10.0.0.6:80", subdomain="web")
    instances_store.upsert_instance(nas)
    instances_store.upsert_instance(web)
    routing = _operator(admin, "ola", users.ROUTING)

    # A machine can't be turned into a route from Routing — however the record is found.
    assert routing.post("/api/routes", json={"prefix": "nas", "upstream": "10.0.0.5:80", "instance_id": "nas"}, headers=ORIGIN).status_code == 403
    assert routing.post("/api/routes", json={"prefix": "gw", "upstream": "10.0.0.5:80", "origin": "gateway"}, headers=ORIGIN).status_code == 403
    assert routing.delete("/api/assign/nas", headers=ORIGIN).status_code == 403

    assert instances_store.get_instance("nas") == nas
    assert instances_store.get_instance("web") == web


def test_an_operator_reads_only_its_own_entries_in_the_ssh_log(admin):
    from loskai.modules.ssh import client as ssh_client

    machines = _operator(admin, "ola", users.MACHINES)
    path = ssh_client._log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(
        json.dumps({"at": "2026-11-04T10:00:00", "event": "open", "machine": "nas", "from": None, "user": who}) + "\n"
        for who in ["admin", "ola", "admin"]
    ))

    assert [e["user"] for e in admin.get("/api/ssh/log").json()] == ["admin", "ola", "admin"]
    assert [e["user"] for e in machines.get("/api/ssh/log").json()] == ["ola"]


def test_a_terminal_needs_its_level(admin):
    routing = _operator(admin, "ola", users.ROUTING)
    docker = _operator(admin, "kari", users.DOCKER)

    for c, path in [(routing, "/api/docker/containers/abc/exec"), (docker, "/api/ssh/machines/nas/terminal")]:
        with pytest.raises(WebSocketDisconnect) as closed:
            with c.websocket_connect(path, headers=ORIGIN):
                pass
        assert closed.value.code == 1008, path


def test_an_operator_changes_its_own_password(admin):
    op = _operator(admin, "ola", users.ROUTING)

    r = op.post("/api/auth/password", json={"current": "ola-password", "new": "a new password"}, headers=ORIGIN)

    assert r.status_code == 200 and users.verify("ola", "a new password") is not None


# --- The accounts, managed by an admin ---


def test_a_new_level_applies_on_the_next_request_and_a_reset_password_ends_sessions(admin):
    op = _operator(admin, "ola", users.DOCKER)
    assert op.get("/api/ssh").status_code == 403

    admin.patch("/api/users/ola", json={"level": users.MACHINES}, headers=ORIGIN)
    assert op.get("/api/ssh").status_code == 200

    admin.patch("/api/users/ola", json={"password": "set-by-admin"}, headers=ORIGIN)
    assert op.get("/api/ssh").status_code == 401


def test_the_last_admin_can_t_be_removed_or_demoted(admin):
    assert admin.delete("/api/users/admin", headers=ORIGIN).status_code == 409
    assert admin.patch("/api/users/admin", json={"level": users.MACHINES}, headers=ORIGIN).status_code == 409

    admin.post("/api/users", json={"username": "second", "password": "second-password", "level": users.ADMIN}, headers=ORIGIN)
    assert admin.delete("/api/users/admin", headers=ORIGIN).status_code == 200


def test_an_account_is_checked_before_it_is_made(admin):
    def add(**body):
        return admin.post("/api/users", json={"username": "ola", "password": "ola-password", **body}, headers=ORIGIN)

    assert add(level=0).json()["detail"] == "A level is 1 to 4"
    assert add(level=5).status_code == 422
    assert add(level="docker").status_code == 422
    assert add().status_code == 422
    assert add(level=2).status_code == 200
    assert add(level=2).status_code == 409  # taken
    assert [u["username"] for u in admin.get("/api/users").json()] == ["admin", "ola"]
    ola = admin.get("/api/users").json()[1]
    assert "hash" not in ola and ola["tabs"] == ["routing", "docker"]


def test_a_removed_account_s_sessions_end(admin):
    op = _operator(admin, "ola", users.DOCKER)

    admin.delete("/api/users/ola", headers=ORIGIN)

    assert op.get("/api/docker/volumes").status_code == 401


def test_a_removed_account_s_sessions_stay_ended_when_the_name_is_used_again(admin):
    """The cookie names the account and its generation; a new account under the same name
    must not take up the old one's sessions — here as an admin."""
    op = _operator(admin, "ola", users.DOCKER)
    admin.delete("/api/users/ola", headers=ORIGIN)
    r = admin.post("/api/users", json={"username": "ola", "password": "ola-password-2", "level": users.ADMIN}, headers=ORIGIN)
    assert r.status_code == 200, r.text

    assert op.get("/api/docker/volumes").status_code == 401
    assert op.get("/api/users").status_code == 401
