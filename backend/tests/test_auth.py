"""Password hash/verify, session sign/verify, first-run seeding, and the Origin check."""

import asyncio
import json
import socket

import pytest
from docker.errors import DockerException
from fastapi.testclient import TestClient
from itsdangerous import URLSafeTimedSerializer
from starlette.websockets import WebSocketDisconnect

from loskai import config
from loskai.main import app
from loskai.modules.docker.client import docker_client
from loskai.shared import auth, store, users
from loskai.shared import settings as s


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "loskai_password", None)


def _admin(password="correct horse battery"):
    return users.create("admin", password, users.ADMIN)


def test_an_account_s_password_is_checked_against_its_hash():
    _admin()

    assert users.verify("admin", "correct horse battery").username == "admin"
    assert users.verify("admin", "wrong") is None
    assert users.verify("nobody", "correct horse battery") is None
    assert "correct horse battery" not in (store.read_json(config.settings.data_dir + "/users.json", {}).__str__())


def test_a_session_names_its_account():
    user = _admin()
    token = auth.make_session(user)

    assert auth.session_user(token).username == "admin"
    assert auth.session_user("tampered") is None
    assert auth.session_user(None) is None


def test_the_session_secret_and_the_accounts_are_owner_only(tmp_path):
    # Whoever can read the secret can sign a session; the accounts hold the hashes.
    auth.make_session(_admin())
    assert (tmp_path / "session_secret").stat().st_mode & 0o777 == 0o600
    assert (tmp_path / "users.json").stat().st_mode & 0o777 == 0o600


def test_an_empty_secret_is_never_signed_with(tmp_path):
    # itsdangerous signs with an empty key, so a cookie anyone can make would pass.
    _admin()
    (tmp_path / "session_secret").write_text("")
    forged = URLSafeTimedSerializer("", salt=auth._SESSION_SALT).dumps({"u": "admin", "g": 0})

    assert auth.session_user(forged) is None
    assert (tmp_path / "session_secret").read_text().strip()


def test_a_session_ends_when_idle_for_longer_than_settings_say(monkeypatch):
    token = auth.make_session(_admin())
    monkeypatch.setattr(s, "session_idle_seconds", lambda: -1)

    assert auth.session_user(token) is None


def test_ensure_seeded_makes_the_first_admin_from_env(monkeypatch):
    assert not users.any_users()
    monkeypatch.setattr(config.settings, "loskai_password", "seeded-password")
    monkeypatch.setattr(config.settings, "loskai_username", "sunde")
    users.ensure_seeded()

    assert users.verify("sunde", "seeded-password").admin


def test_the_seeded_username_is_lowercased_and_one_that_can_t_be_a_name_stops_startup(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", "seeded-password")
    monkeypatch.setattr(config.settings, "loskai_username", "Bad Name")
    with pytest.raises(RuntimeError, match="LOSKAI_USERNAME='Bad Name'"):
        users.ensure_seeded()
    assert not users.any_users()  # and first-run setup isn't what it falls back to

    monkeypatch.setattr(config.settings, "loskai_username", "Sunde")
    users.ensure_seeded()
    assert users.verify("sunde", "seeded-password") is not None


def test_two_first_run_setups_at_once_make_one_admin(monkeypatch):
    # Both pass the early check before either has written — the race, made certain.
    monkeypatch.setattr(users, "any_users", lambda: False)
    with TestClient(app) as owner, TestClient(app) as stranger:
        assert owner.post("/api/auth/setup", json={"username": "admin", "password": "owner-password"}).status_code == 200
        late = stranger.post("/api/auth/setup", json={"username": "x", "password": "stranger-password"})

    assert late.status_code == 409
    assert [u.username for u in users.all_users()] == ["admin"]


def test_ensure_seeded_is_idempotent(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", "first-password")
    users.ensure_seeded()
    # An env change after an account exists must not re-seed.
    monkeypatch.setattr(config.settings, "loskai_password", "second-password")
    users.ensure_seeded()

    assert users.verify("admin", "first-password") is not None
    assert len(users.all_users()) == 1


def test_an_install_from_before_accounts_keeps_its_password_as_the_admin(tmp_path):
    # Its one password, hashed in settings.json, becomes the account `admin`; the key goes.
    from argon2 import PasswordHasher

    store.write_json(tmp_path / "settings.json", {"admin_password_hash": PasswordHasher().hash("old-password"), "base_domain": "x.no"})
    users.ensure_seeded()

    assert users.verify("admin", "old-password").admin
    stored = store.read_json(tmp_path / "settings.json", {})
    assert "admin_password_hash" not in stored and stored["base_domain"] == "x.no"


def test_accounts_saved_with_tabs_get_a_level_and_none_loses_access(tmp_path):
    (tmp_path / "users.json").write_text(json.dumps({"users": [
        {"username": "admin", "role": "admin", "tabs": [], "hash": "x"},
        {"username": "ola", "role": "operator", "tabs": ["docker"], "hash": "x"},
        {"username": "kari", "role": "operator", "tabs": ["routing", "machines"], "hash": "x"},
    ]}))

    assert [(u.username, u.level) for u in users.all_users()] == [("admin", 4), ("ola", 2), ("kari", 3)]
    users.end_sessions("ola")  # any write saves the levels
    saved = json.loads((tmp_path / "users.json").read_text())["users"]
    assert [u["level"] for u in saved] == [4, 2, 3] and "tabs" not in saved[1] and "role" not in saved[1]


def test_a_level_that_isn_t_one_stops_startup(tmp_path):
    (tmp_path / "users.json").write_text(json.dumps({"users": [{"username": "admin", "level": 9, "hash": "x"}]}))

    with pytest.raises(store.CorruptStoreError):
        users.verify_readable()


def test_an_unreadable_users_file_stops_startup(tmp_path):
    # Read as empty, it would re-open the public first-run setup.
    (tmp_path / "users.json").write_text("{not json")
    with pytest.raises(store.CorruptStoreError):
        users.verify_readable()


# --- The Origin check, through the real HTTP path ---

PASSWORD = "correct horse battery"
SIBLING = {"origin": "https://jellyfin.example.no"}  # another app under the same domain


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        yield c


def test_a_sibling_page_cannot_change_anything_with_the_cookie(client, tmp_path):
    # The cookie rides along — same site — so only the Origin tells this apart.
    r = client.post("/api/routes", json={"prefix": "x", "upstream": "1.2.3.4:80"}, headers=SIBLING)

    assert r.status_code == 403
    assert not (tmp_path / "instances.json").exists()


def test_the_login_flow_is_checked_too(client):
    assert client.post("/api/login", json={"username": "admin", "password": PASSWORD}, headers=SIBLING).status_code == 403
    assert client.post("/api/logout", headers=SIBLING).status_code == 403


def test_own_pages_and_non_browser_clients_pass(client):
    own = client.post("/api/login", json={"username": "admin", "password": PASSWORD}, headers={"origin": "http://testserver"})
    bare = client.post("/api/login", json={"username": "admin", "password": PASSWORD})  # curl sends no Origin

    assert own.status_code == 200
    assert bare.status_code == 200


def test_behind_a_proxy_that_rewrites_host_the_forwarded_host_counts(client):
    proxied = {"host": "loskai:8080", "x-forwarded-host": "loskai.example.no"}

    own = client.post("/api/login", json={"username": "admin", "password": PASSWORD}, headers={**proxied, "origin": "https://loskai.example.no"})
    other = client.post("/api/login", json={"username": "admin", "password": PASSWORD}, headers={**proxied, **SIBLING})

    assert own.status_code == 200
    assert other.status_code == 403


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
    client.post("/api/login", json={"username": "admin", "password": PASSWORD})
    stolen = client.cookies.get(auth.SESSION_COOKIE)

    client.post("/api/logout")

    assert auth.session_user(stolen) is None
    client.cookies.set(auth.SESSION_COOKIE, stolen)
    assert client.get("/api/launcher").status_code == 401


def test_log_out_ends_your_sessions_on_every_device_and_no_one_else_s(client):
    users.create("ola", "ola-password", users.DOCKER)
    with TestClient(app) as phone, TestClient(app) as colleague:
        phone.post("/api/login", json={"username": "admin", "password": PASSWORD})
        colleague.post("/api/login", json={"username": "ola", "password": "ola-password"})
        client.post("/api/login", json={"username": "admin", "password": PASSWORD})

        client.post("/api/logout")

        assert phone.get("/api/launcher").status_code == 401
        assert colleague.get("/api/launcher").status_code == 200


def test_a_signed_out_logout_ends_nothing(client):
    client.post("/api/login", json={"username": "admin", "password": PASSWORD})
    session = client.cookies.get(auth.SESSION_COOKIE)

    with TestClient(app) as stranger:
        stranger.post("/api/logout")

    assert auth.session_user(session) is not None



class _Exec:
    """A stand-in for docker-py's exec socket: one end of a socket pair, silent."""

    def __init__(self) -> None:
        self._sock, self.peer = socket.socketpair()


def test_log_out_closes_an_open_terminal(client, monkeypatch):
    monkeypatch.setattr(auth, "SESSION_RECHECK", 0.05)
    shell = _Exec()
    monkeypatch.setattr(docker_client, "exec_create", lambda *a: "exec-id")
    monkeypatch.setattr(docker_client, "exec_start", lambda exec_id: shell)
    client.post("/api/login", json={"username": "admin", "password": PASSWORD})

    with client.websocket_connect("/api/docker/containers/abc/exec") as ws:
        shell.peer.sendall(b"$ ")
        assert ws.receive_bytes() == b"$ "  # the shell is open
        client.post("/api/logout")

        with pytest.raises(WebSocketDisconnect):
            ws.receive_bytes()
    assert shell._sock.fileno() == -1  # and the exec socket closed with it


def _ends_within(token, seconds, tab="machines") -> bool:
    async def run():
        try:
            await asyncio.wait_for(auth.session_ended(token, tab), seconds)
            return True
        except TimeoutError:
            return False

    return asyncio.run(run())


def test_a_terminal_outlasts_its_cookie_s_idle_time(monkeypatch):
    # It lives in an open page, which keeps its session; the cookie it was opened with is
    # never renewed, the browser's is.
    monkeypatch.setattr(auth, "SESSION_RECHECK", 0.05)
    monkeypatch.setattr(s, "session_idle_seconds", lambda: 1)
    token = auth.make_session(_admin())

    assert not _ends_within(token, 2.5)


def test_a_terminal_ends_when_its_level_is_lowered(monkeypatch):
    monkeypatch.setattr(auth, "SESSION_RECHECK", 0.05)
    _admin()
    ola = users.create("ola", "ola-password", users.MACHINES)
    token = auth.make_session(ola)

    assert not _ends_within(token, 0.3)
    users.set_level("ola", users.DOCKER)

    assert _ends_within(token, 0.3)
    assert not _ends_within(token, 0.3, tab="docker")


# --- Login backoff ---


def _wrong(client):
    return client.post("/api/login", json={"username": "admin", "password": "wrong password"})


def test_wrong_passwords_beyond_the_free_ones_cost_a_wait(client):
    for _ in range(auth.FREE_FAILURES):
        assert _wrong(client).status_code == 401
    assert _wrong(client).status_code == 401  # this one starts the wait

    refused = client.post("/api/login", json={"username": "admin", "password": PASSWORD})

    assert refused.status_code == 429  # the right password too: no guess is checked
    assert refused.headers["Retry-After"] == "2"
    assert "Try again in 2 s" in refused.json()["detail"]


def test_the_wait_doubles_and_is_capped(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: now[0])
    backoff = auth._Backoff()
    waits = []
    for _ in range(auth.FREE_FAILURES + 8):
        backoff.failed("admin")
        waits.append(round(backoff.wait_left("admin")))

    assert waits[: auth.FREE_FAILURES] == [-1000] * auth.FREE_FAILURES  # never set
    assert waits[auth.FREE_FAILURES :] == [2, 4, 8, 16, 32, 60, 60, 60]


def test_a_right_password_after_the_wait_clears_the_count(client, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: now[0])
    for _ in range(auth.FREE_FAILURES + 1):
        _wrong(client)
    now[0] += 2

    assert client.post("/api/login", json={"username": "admin", "password": PASSWORD}).status_code == 200
    for _ in range(auth.FREE_FAILURES):
        assert _wrong(client).status_code == 401  # free again


# --- Sign-in log ---


def test_sign_ins_and_wrong_passwords_are_logged_never_the_password(client, tmp_path):
    _wrong(client)
    client.post("/api/login", json={"username": "Nobody", "password": "guess-123"})
    client.post("/api/login", json={"username": "admin", "password": PASSWORD})

    log = client.get("/api/auth/logins").json()

    assert [(e["user"], e["ok"]) for e in log] == [("admin", True), ("nobody", False), ("admin", False)]
    assert log[1]["from"] == "testclient"
    text = (tmp_path / "logins.log").read_text()
    assert "wrong password" not in text and "guess-123" not in text and PASSWORD not in text
    assert (tmp_path / "logins.log").stat().st_mode & 0o777 == 0o600


def test_a_login_turned_away_during_a_wait_is_not_logged(client, tmp_path):
    for _ in range(auth.FREE_FAILURES + 1):
        _wrong(client)

    assert _wrong(client).status_code == 429
    assert len((tmp_path / "logins.log").read_text().splitlines()) == auth.FREE_FAILURES + 1


def test_the_client_caddy_forwarded_for_is_logged_and_no_one_else_s_claim(client, monkeypatch):
    monkeypatch.setattr(config.settings, "caddy_admin_url", "http://10.0.0.1:2019")
    with TestClient(app, client=("10.0.0.1", 50000)) as caddy, TestClient(app, client=("10.0.0.66", 50000)) as lan:
        caddy.post("/api/login", json={"username": "admin", "password": "wrong"}, headers={"x-forwarded-for": "10.0.0.9"})
        lan.post("/api/login", json={"username": "admin", "password": "wrong"}, headers={"x-forwarded-for": "10.0.0.5"})

    assert [e["from"] for e in client.get("/api/auth/logins").json()] == ["10.0.0.66", "10.0.0.9"]


def test_made_up_names_can_t_push_the_real_entries_out(client, tmp_path):
    _wrong(client)
    for i in range(50):  # each a new name, so none ever waits
        assert client.post("/api/login", json={"username": f"x{i}", "password": "guess-123"}).status_code == 401

    log = client.get("/api/auth/logins").json()

    assert [e["user"] for e in log][-1] == "admin"
    assert len(log) == 1 + auth.FREE_FAILURES


def test_only_an_admin_reads_the_sign_in_log(client):
    users.create("ola", "ola-password", users.MACHINES)
    with TestClient(app) as ola:
        ola.post("/api/login", json={"username": "ola", "password": "ola-password"})

        assert ola.get("/api/auth/logins").status_code == 403


# --- The Secure flag ---


def _cookie_header(response) -> str:
    return response.headers["set-cookie"].lower()


def test_a_login_through_caddy_s_https_gets_a_secure_cookie(client):
    r = client.post("/api/login", json={"username": "admin", "password": PASSWORD}, headers={"x-forwarded-proto": "https"})

    assert "; secure" in _cookie_header(r)
    assert "httponly" in _cookie_header(r)


def test_a_login_over_plain_http_gets_one_that_works_there(client):
    r = client.post("/api/login", json={"username": "admin", "password": PASSWORD})

    assert "; secure" not in _cookie_header(r)


def test_first_run_setup_follows_the_same_rule(tmp_path):
    with TestClient(app) as c:
        r = c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD}, headers={"x-forwarded-proto": "https"})

    assert "; secure" in _cookie_header(r)


def test_a_login_during_another_s_check_is_turned_away_not_queued(client):
    auth._backoff.lock.acquire()  # a password check in progress
    try:
        r = client.post("/api/login", json={"username": "admin", "password": PASSWORD})
    finally:
        auth._backoff.lock.release()

    assert r.status_code == 429
    assert r.headers["Retry-After"] == "1"
    assert client.post("/api/login", json={"username": "admin", "password": PASSWORD}).status_code == 200


def test_failures_long_ago_are_forgotten(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: now[0])
    backoff = auth._Backoff()
    for _ in range(auth.FREE_FAILURES + 15):  # a guesser, then silence
        backoff.failed("admin")
    now[0] += auth.QUIET_RESET + 1

    backoff.failed("admin")  # the admin's typo

    assert backoff.wait_left("admin") <= 0


def test_another_account_signing_in_doesn_t_clear_the_count_on_the_admin(client):
    """Each wrong guess at the admin's password counts against the admin; an operator's own
    right password once reset that, making every guess free."""
    r = client.post("/api/users", json={"username": "ola", "password": "ola-password", "level": 2})
    assert r.status_code == 200, r.text
    for _ in range(auth.FREE_FAILURES + 1):
        assert _wrong(client).status_code == 401

    with TestClient(app) as ola:
        assert ola.post("/api/login", json={"username": "ola", "password": "ola-password"}).status_code == 200

    assert _wrong(client).status_code == 429  # still waiting


def _shell(path: str, stdin: str = ""):
    import shutil
    import subprocess

    from loskai.modules.docker.router import SHELL_COMMAND

    return subprocess.run(
        [shutil.which("sh"), "-c", SHELL_COMMAND], input=stdin, capture_output=True,
        text=True, env={"PATH": path}, timeout=10,
    )


def test_the_container_terminal_runs_bash_with_its_stderr(tmp_path):
    # bash writes its prompt, its completions and every error message to stderr; sending
    # that to /dev/null left a shell with none of them.
    fake = tmp_path / "bash"
    fake.write_text("#!/bin/sh\necho bash-ran\necho bash-stderr >&2\n")
    fake.chmod(0o755)

    done = _shell(f"{tmp_path}:/usr/bin:/bin")

    assert done.stdout == "bash-ran\n"
    assert done.stderr == "bash-stderr\n"


def test_without_bash_the_container_terminal_falls_back_to_sh(tmp_path):
    # An image with no bash (alpine, busybox): sh, not a terminal that closes at once.
    import shutil

    (tmp_path / "sh").symlink_to(shutil.which("sh"))

    done = _shell(str(tmp_path), "echo fell-back-to-sh\n")

    assert done.stdout == "fell-back-to-sh\n"


# --- Accounts: setup, a session renewed while used, your own password ---


def test_first_run_setup_creates_the_admin_account_once(tmp_path):
    with TestClient(app) as c:
        assert c.get("/api/auth/status").json() == {"authed": False, "needs_setup": True, "user": None}
        bad = c.post("/api/auth/setup", json={"username": "Not OK", "password": PASSWORD})
        short = c.post("/api/auth/setup", json={"username": "sunde", "password": "short"})
        r = c.post("/api/auth/setup", json={"username": "Sunde", "password": PASSWORD})
        again = c.post("/api/auth/setup", json={"username": "evil", "password": PASSWORD})

        assert bad.status_code == 422 and short.status_code == 422
        assert r.status_code == 200 and r.json()["user"]["username"] == "sunde"  # lowercased
        assert again.status_code == 409 and users.get("evil") is None
        status = c.get("/api/auth/status").json()
        assert status["authed"] and status["user"]["level"] == users.ADMIN and not status["needs_setup"]


def test_a_wrong_username_is_refused_like_a_wrong_password(client):
    r = client.post("/api/login", json={"username": "nobody", "password": PASSWORD})

    assert r.status_code == 401 and r.json()["detail"] == "Wrong username or password"


def test_a_session_in_use_is_renewed_and_one_just_issued_is_not(client, monkeypatch):
    client.post("/api/login", json={"username": "admin", "password": PASSWORD})
    assert "set-cookie" not in client.get("/api/launcher").headers  # fresh: nothing to renew

    monkeypatch.setattr(auth, "RENEW_AFTER", -1)
    renewed = client.get("/api/launcher")

    assert renewed.headers["set-cookie"].startswith(auth.SESSION_COOKIE + "=")


def test_the_page_and_its_files_never_read_or_renew_the_session(client, monkeypatch):
    """Only /api/ needs the session: a page load fetches dozens of files with the cookie
    attached, and each would read three files and could carry a fresh Set-Cookie."""
    client.post("/api/login", json={"username": "admin", "password": PASSWORD})
    monkeypatch.setattr(auth, "RENEW_AFTER", -1)
    reads = []
    read = auth._read_session
    monkeypatch.setattr(auth, "_read_session", lambda token: reads.append(token) or read(token))

    for path in ("/", "/machines/nas", "/assets/index.js"):
        assert "set-cookie" not in client.get(path).headers
    assert reads == []
    assert client.get("/api/launcher").headers["set-cookie"].startswith(auth.SESSION_COOKIE + "=")


def test_changing_your_password_ends_your_other_sessions_and_keeps_this_one(client):
    with TestClient(app) as phone:
        phone.post("/api/login", json={"username": "admin", "password": PASSWORD})
        client.post("/api/login", json={"username": "admin", "password": PASSWORD})

        wrong = client.post("/api/auth/password", json={"current": "nope", "new": "a new password"})
        short = client.post("/api/auth/password", json={"current": PASSWORD, "new": "short"})
        r = client.post("/api/auth/password", json={"current": PASSWORD, "new": "a new password"})

        assert wrong.status_code == 403 and short.status_code == 422 and r.status_code == 200
        assert client.get("/api/launcher").status_code == 200
        assert phone.get("/api/launcher").status_code == 401
        assert users.verify("admin", "a new password") is not None


def test_an_account_whose_hash_is_broken_is_a_wrong_password_and_counted(client):
    """users.json is hand-editable: an empty or mangled hash must answer 401, not 500, and
    count toward the wait like any wrong password."""
    store.update_json(users._path(), {"users": []}, lambda raw: {
        "users": [{**u, "hash": "not-a-hash"} if u["username"] == "admin" else u for u in raw["users"]]
    })
    for _ in range(auth.FREE_FAILURES + 1):
        assert client.post("/api/login", json={"username": "admin", "password": PASSWORD}).status_code == 401

    assert client.post("/api/login", json={"username": "admin", "password": PASSWORD}).status_code == 429


def test_a_username_ending_in_a_newline_is_refused():
    from loskai.shared import users

    users.check_username("bob")
    with pytest.raises(users.UserError):
        users.check_username("bob\n")
