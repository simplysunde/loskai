"""Password hash/verify, session sign/verify, first-run seeding, and the Origin check."""

import pytest
from docker.errors import DockerException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from loskai import config
from loskai.main import app
from loskai.modules.docker.client import docker_client
from loskai.shared import auth
from loskai.shared import settings as s


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "loskai_password", None)


def test_password_hash_roundtrip():
    hashed = auth.hash_password("correct horse battery")
    assert hashed != "correct horse battery"  # never plaintext
    assert auth.verify_password(hashed, "correct horse battery")
    assert not auth.verify_password(hashed, "wrong")


def test_session_sign_and_verify():
    token = auth.make_session()
    assert auth.valid_session(token)
    assert not auth.valid_session("tampered")
    assert not auth.valid_session(None)


def test_the_session_secret_is_owner_only(tmp_path):
    # Whoever can read it can sign an admin session.
    auth.make_session()
    assert (tmp_path / "session_secret").stat().st_mode & 0o777 == 0o600


def test_ensure_seeded_sets_hash_from_env(monkeypatch):
    assert not auth.password_set()
    monkeypatch.setattr(config.settings, "loskai_password", "seeded-password")
    auth.ensure_seeded()
    assert auth.password_set()
    assert auth.verify_password(s.admin_password_hash(), "seeded-password")


def test_ensure_seeded_is_idempotent(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", "first")
    auth.ensure_seeded()
    first_hash = s.admin_password_hash()
    # Env change after a hash exists must not re-seed.
    monkeypatch.setattr(config.settings, "loskai_password", "second")
    auth.ensure_seeded()
    assert s.admin_password_hash() == first_hash


# --- The Origin check, through the real HTTP path ---

PASSWORD = "correct horse battery"
SIBLING = {"origin": "https://jellyfin.example.no"}  # another app under the same domain


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"password": PASSWORD})
        yield c


def test_a_sibling_page_cannot_change_anything_with_the_cookie(client, tmp_path):
    # The cookie rides along — same site — so only the Origin tells this apart.
    r = client.post("/api/routes", json={"prefix": "x", "upstream": "1.2.3.4:80"}, headers=SIBLING)

    assert r.status_code == 403
    assert not (tmp_path / "instances.json").exists()


def test_the_login_flow_is_checked_too(client):
    assert client.post("/api/login", json={"password": PASSWORD}, headers=SIBLING).status_code == 403
    assert client.post("/api/logout", headers=SIBLING).status_code == 403


def test_own_pages_and_non_browser_clients_pass(client):
    own = client.post("/api/login", json={"password": PASSWORD}, headers={"origin": "http://testserver"})
    bare = client.post("/api/login", json={"password": PASSWORD})  # curl sends no Origin

    assert own.status_code == 200
    assert bare.status_code == 200


def test_reads_are_not_origin_checked(client):
    # A cross-origin page can't read the answer anyway; that is the browser's job.
    assert client.get("/api/auth/status", headers=SIBLING).status_code == 200


def test_a_sibling_page_cannot_open_the_terminal(client, monkeypatch):
    opened = []
    monkeypatch.setattr(docker_client, "exec_create", lambda *a: opened.append(a))

    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect("/api/docker/containers/abc/exec", headers=SIBLING):
            pass

    assert closed.value.code == 1008
    assert opened == []


def test_loskai_s_own_page_opens_the_terminal(client, monkeypatch):
    def refuse(*_):
        raise DockerException("no daemon here")

    monkeypatch.setattr(docker_client, "exec_create", refuse)

    with client.websocket_connect(
        "/api/docker/containers/abc/exec", headers={"origin": "http://testserver"}
    ) as ws:
        # Past the gate: the shell itself is what failed.
        assert ws.receive_text().startswith("exec failed")


# --- Log out ---


def test_log_out_ends_the_session_not_just_the_cookie(client):
    client.post("/api/login", json={"password": PASSWORD})
    stolen = client.cookies.get(auth.SESSION_COOKIE)

    client.post("/api/logout")

    assert not auth.valid_session(stolen)
    client.cookies.set(auth.SESSION_COOKIE, stolen)
    assert client.get("/api/launcher").status_code == 401


def test_log_out_ends_every_session(client):
    with TestClient(app) as phone:
        phone.post("/api/login", json={"password": PASSWORD})
        client.post("/api/login", json={"password": PASSWORD})

        client.post("/api/logout")

        assert phone.get("/api/launcher").status_code == 401


def test_a_signed_out_logout_ends_nothing(client):
    client.post("/api/login", json={"password": PASSWORD})
    session = client.cookies.get(auth.SESSION_COOKIE)

    with TestClient(app) as stranger:
        stranger.post("/api/logout")

    assert auth.valid_session(session)
