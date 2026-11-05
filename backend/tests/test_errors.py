"""A refusal's status is decided where it is raised (`shared/errors.py`), and one handler
answers with it — so "not found" is a 404 and a bad request a 400, whichever route it is."""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app

PASSWORD = "correct horse battery"
ORIGIN = {"origin": "http://testserver"}


@pytest.fixture
def admin(monkeypatch):
    monkeypatch.setattr(config.settings, "loskai_password", None)
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        yield c


def test_a_missing_stack_is_404_on_every_route(admin):
    assert admin.get("/api/docker/stacks/nope").json() == {"detail": "stack 'nope' not found"}
    assert admin.get("/api/docker/stacks/nope").status_code == 404
    assert admin.delete("/api/docker/stacks/nope", headers=ORIGIN).status_code == 404
    assert admin.post("/api/docker/stacks/nope/action", json={"action": "up"}, headers=ORIGIN).status_code == 404


def test_a_bad_request_is_400_even_where_missing_is_404(admin):
    # Delete once answered 404 to any refusal, a bad name included.
    r = admin.delete("/api/docker/stacks/bad name", headers=ORIGIN)
    assert r.status_code == 400 and "name" in r.json()["detail"]
    assert admin.get("/api/docker/stacks/bad name").status_code == 400


def test_a_missing_recipe_is_404(admin):
    assert admin.get("/api/recipes/nope/icon").status_code == 404
