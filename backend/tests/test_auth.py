"""Password hash/verify, session sign/verify, first-run seeding, and the Origin check."""

import socket

import pytest
from docker.errors import DockerException
from fastapi.testclient import TestClient
from itsdangerous import URLSafeTimedSerializer
from starlette.websockets import WebSocketDisconnect

from loskai import config
from loskai.main import app
from loskai.modules.docker import router as docker_router
from loskai.modules.docker.client import docker_client
from loskai.shared import auth, store
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


def test_an_empty_secret_is_never_signed_with(tmp_path):
    # itsdangerous signs with an empty key, so a cookie anyone can make would pass.
    (tmp_path / "session_secret").write_text("")
    forged = URLSafeTimedSerializer("", salt=auth._SESSION_SALT).dumps({"authed": True})

    assert not auth.valid_session(forged)
    assert (tmp_path / "session_secret").read_text().strip()


def test_a_failed_rotation_keeps_the_old_secret(tmp_path, monkeypatch):
    session = auth.make_session()

    def fail(_fd):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(store.os, "fsync", fail)
    with pytest.raises(OSError):
        auth.end_all_sessions()

    assert auth.valid_session(session)
    assert not list(tmp_path.glob("*.tmp"))
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



class _Exec:
    """A stand-in for docker-py's exec socket: one end of a socket pair, silent."""

    def __init__(self) -> None:
        self._sock, self.peer = socket.socketpair()


def test_log_out_closes_an_open_terminal(client, monkeypatch):
    monkeypatch.setattr(docker_router, "SESSION_RECHECK", 0.05)
    shell = _Exec()
    monkeypatch.setattr(docker_client, "exec_create", lambda *a: "exec-id")
    monkeypatch.setattr(docker_client, "exec_start", lambda exec_id: shell)
    client.post("/api/login", json={"password": PASSWORD})

    with client.websocket_connect("/api/docker/containers/abc/exec") as ws:
        shell.peer.sendall(b"$ ")
        assert ws.receive_bytes() == b"$ "  # the shell is open
        client.post("/api/logout")

        with pytest.raises(WebSocketDisconnect):
            ws.receive_bytes()
    assert shell._sock.fileno() == -1  # and the exec socket closed with it


# --- Login backoff ---


def _wrong(client):
    return client.post("/api/login", json={"password": "wrong password"})


def test_wrong_passwords_beyond_the_free_ones_cost_a_wait(client):
    for _ in range(auth.FREE_FAILURES):
        assert _wrong(client).status_code == 401
    assert _wrong(client).status_code == 401  # this one starts the wait

    refused = client.post("/api/login", json={"password": PASSWORD})

    assert refused.status_code == 429  # the right password too: no guess is checked
    assert refused.headers["Retry-After"] == "2"
    assert "Try again in 2 s" in refused.json()["detail"]


def test_the_wait_doubles_and_is_capped(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: now[0])
    backoff = auth._Backoff()
    waits = []
    for _ in range(auth.FREE_FAILURES + 8):
        backoff.failed()
        waits.append(round(backoff.wait_left()))

    assert waits[: auth.FREE_FAILURES] == [-1000] * auth.FREE_FAILURES  # never set
    assert waits[auth.FREE_FAILURES :] == [2, 4, 8, 16, 32, 60, 60, 60]


def test_a_right_password_after_the_wait_clears_the_count(client, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: now[0])
    for _ in range(auth.FREE_FAILURES + 1):
        _wrong(client)
    now[0] += 2

    assert client.post("/api/login", json={"password": PASSWORD}).status_code == 200
    for _ in range(auth.FREE_FAILURES):
        assert _wrong(client).status_code == 401  # free again


# --- The Secure flag ---


def _cookie_header(response) -> str:
    return response.headers["set-cookie"].lower()


def test_a_login_through_caddy_s_https_gets_a_secure_cookie(client):
    r = client.post("/api/login", json={"password": PASSWORD}, headers={"x-forwarded-proto": "https"})

    assert "; secure" in _cookie_header(r)
    assert "httponly" in _cookie_header(r)


def test_a_login_over_plain_http_gets_one_that_works_there(client):
    r = client.post("/api/login", json={"password": PASSWORD})

    assert "; secure" not in _cookie_header(r)


def test_first_run_setup_follows_the_same_rule(tmp_path):
    with TestClient(app) as c:
        r = c.post("/api/auth/setup", json={"password": PASSWORD}, headers={"x-forwarded-proto": "https"})

    assert "; secure" in _cookie_header(r)


def test_a_login_during_another_s_check_is_turned_away_not_queued(client):
    auth._backoff.lock.acquire()  # a password check in progress
    try:
        r = client.post("/api/login", json={"password": PASSWORD})
    finally:
        auth._backoff.lock.release()

    assert r.status_code == 429
    assert r.headers["Retry-After"] == "1"
    assert client.post("/api/login", json={"password": PASSWORD}).status_code == 200
