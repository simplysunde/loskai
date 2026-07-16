"""Tier-2: the /api/health endpoint through the *real* HTTP path (auth + response
validation). Guards against response-model regressions that direct-function-call unit
tests can't see — e.g. `consistency` being a list under a `dict[str, dict]` annotation."""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app

PASSWORD = "smoke-test-password"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))


def test_health_endpoint_serializes_with_consistency_list():
    with TestClient(app) as client:
        client.post("/api/auth/setup", json={"password": PASSWORD})
        client.post("/api/login", json={"password": PASSWORD})

        r = client.get("/api/health")

    assert r.status_code == 200, r.text
    body = r.json()
    # The regression: `consistency` is a list, which a `dict[str, dict]` response model
    # rejected with a 500 before the fix.
    assert isinstance(body["consistency"], list)
    for module in ("caddy", "adguard", "wireguard", "docker"):
        assert "status" in body[module]
