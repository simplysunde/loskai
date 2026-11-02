"""Who may call what: an admin everything, an operator only its tabs (shared/access.py)."""

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


def _operator(admin, name: str, tabs: list[str]) -> TestClient:
    r = admin.post("/api/users", json={"username": name, "password": f"{name}-password", "role": "operator", "tabs": tabs})
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


# --- An operator, limited to its tabs ---


def test_an_operator_uses_its_tab_and_is_refused_the_others(admin):
    docker = _operator(admin, "ola", ["docker"])

    assert docker.get("/api/docker/volumes").status_code != 403
    refused = docker.get("/api/caddy/routes")
    assert refused.status_code == 403 and refused.json()["detail"] == "Your account doesn't have the Routing or Machines tab"
    # Routes are Routing's, even from the install wizard's last step.
    assert docker.post("/api/routes", json={"prefix": "x", "upstream": "1.2.3.4:80"}, headers=ORIGIN).status_code == 403
    assert docker.get("/api/ssh").status_code == 403


def test_settings_users_and_the_backup_are_the_admin_s(admin):
    op = _operator(admin, "ola", ["docker", "routing", "machines"])

    for method, path in [("PUT", "/api/settings"), ("GET", "/api/users"), ("GET", "/api/export"),
                         ("POST", "/api/ssh/key"), ("POST", "/api/adguard/rewrites/clear")]:
        r = op.request(method, path, json={}, headers=ORIGIN)
        assert r.status_code == 403 and r.json()["detail"] == "Only an admin can do that", (method, path)


def test_every_account_reads_settings_but_only_an_admin_sees_secrets(admin):
    admin.put("/api/settings", json={"adguard_password": "hunter22"}, headers=ORIGIN)
    op = _operator(admin, "ola", ["routing"])

    assert op.get("/api/settings").json()["adguard_password"]["value"] is None
    assert admin.get("/api/settings").json()["adguard_password"]["value"] == "hunter22"


def test_a_record_s_own_tab_decides_who_deletes_or_renames_it(admin):
    instances_store.upsert_instance(Instance(id="nas", name="nas", type="external", kind="machine", upstream="10.0.0.5"))
    instances_store.upsert_instance(Instance(id="web", name="web", type="external", kind="service", upstream="10.0.0.5:80"))
    routing = _operator(admin, "ola", ["routing"])

    assert routing.patch("/api/instances/nas", json={"name": "x"}, headers=ORIGIN).status_code == 403
    assert routing.delete("/api/instances/nas", headers=ORIGIN).status_code == 403
    assert instances_store.get_instance("nas") is not None
    assert routing.patch("/api/instances/web", json={"private": True}, headers=ORIGIN).status_code == 200


def test_a_terminal_needs_its_tab(admin):
    machines = _operator(admin, "ola", ["machines"])

    with pytest.raises(WebSocketDisconnect) as closed:
        with machines.websocket_connect("/api/docker/containers/abc/exec", headers=ORIGIN):
            pass
    assert closed.value.code == 1008


def test_an_operator_changes_its_own_password(admin):
    op = _operator(admin, "ola", ["docker"])

    r = op.post("/api/auth/password", json={"current": "ola-password", "new": "a new password"}, headers=ORIGIN)

    assert r.status_code == 200 and users.verify("ola", "a new password") is not None


# --- The accounts, managed by an admin ---


def test_new_tabs_apply_on_the_next_request_and_a_reset_password_ends_sessions(admin):
    op = _operator(admin, "ola", ["docker"])
    assert op.get("/api/caddy/routes").status_code == 403

    admin.patch("/api/users/ola", json={"tabs": ["docker", "routing"]}, headers=ORIGIN)
    assert op.get("/api/caddy/routes").status_code == 200

    admin.patch("/api/users/ola", json={"password": "set-by-admin"}, headers=ORIGIN)
    assert op.get("/api/caddy/routes").status_code == 401


def test_the_last_admin_can_t_be_removed_or_demoted(admin):
    assert admin.delete("/api/users/admin", headers=ORIGIN).status_code == 409
    assert admin.patch("/api/users/admin", json={"role": "operator", "tabs": ["docker"]}, headers=ORIGIN).status_code == 409

    admin.post("/api/users", json={"username": "second", "password": "second-password", "role": "admin"}, headers=ORIGIN)
    assert admin.delete("/api/users/admin", headers=ORIGIN).status_code == 200


def test_an_account_is_checked_before_it_is_made(admin):
    def add(**body):
        return admin.post("/api/users", json={"username": "ola", "password": "ola-password", "role": "operator", **body}, headers=ORIGIN)

    assert add(tabs=[]).json()["detail"] == "An operator needs at least one tab"
    assert add(tabs=["settings"]).status_code == 422
    assert add(role="root", tabs=["docker"]).status_code == 422
    assert add(tabs=["docker"]).status_code == 200
    assert add(tabs=["docker"]).status_code == 409  # taken
    assert [u["username"] for u in admin.get("/api/users").json()] == ["admin", "ola"]
    assert "hash" not in admin.get("/api/users").json()[1]


def test_a_removed_account_s_sessions_end(admin):
    op = _operator(admin, "ola", ["docker"])

    admin.delete("/api/users/ola", headers=ORIGIN)

    assert op.get("/api/docker/volumes").status_code == 401
