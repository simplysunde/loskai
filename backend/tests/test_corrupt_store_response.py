"""Tier-2: a corrupt store file reaches the operator as `{"detail": ...}`, not a blank 500.

The Phase 15 F5 follow-up (found by the 2026-08-31 smoke test): `CorruptStoreError` names
the path it was raised with, but nothing caught it, so the message only ever reached the
server log. The operator whose file is broken saw a dead public dashboard and no reason
why. `main.py` now registers a handler; these pin the shape it returns.
"""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app

PASSWORD = "smoke-test-password"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    return tmp_path


def test_corrupt_instances_names_the_path_on_the_public_dashboard(data_dir):
    """The defect verbatim: /api/dashboard is public, unauthenticated, and the launcher
    every user lands on. It must say which file is broken."""
    (data_dir / "instances.json").write_text('[{"id": "grafana"')

    with TestClient(app) as client:
        r = client.get("/api/dashboard")

    assert r.status_code == 500
    detail = r.json()["detail"]
    assert "instances.json" in detail  # *which* file — the whole point of the error


def test_corrupt_instances_names_the_path_on_an_authed_route(data_dir):
    """Not dashboard-specific: the handler is registered app-wide, so the routes behind
    login (here /api/export) surface the same message rather than an empty body."""
    (data_dir / "instances.json").write_text('[{"id": "grafana"')

    with TestClient(app) as client:
        client.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        client.post("/api/login", json={"username": "admin", "password": PASSWORD})

        r = client.get("/api/export")

    assert r.status_code == 500
    assert "instances.json" in r.json()["detail"]


def test_handler_does_not_swallow_the_error_from_the_log(data_dir, caplog):
    """Handling the exception stops uvicorn printing the traceback, so main.py logs it
    explicitly. Losing the server-side record would trade one blind spot for another."""
    (data_dir / "instances.json").write_text('[{"id": "grafana"')

    with TestClient(app) as client:
        client.get("/api/dashboard")

    assert "instances.json" in caplog.text


def test_healthy_store_is_untouched(data_dir):
    """The handler must not change the happy path — /api/dashboard still answers 200."""
    with TestClient(app) as client:
        r = client.get("/api/dashboard")

    assert r.status_code == 200
