"""Tier-1/2: launcher icons — the one binary thing Loskai stores, and the one public
endpoint that serves user-supplied bytes back from Loskai's own origin. The validation is
therefore by *magic bytes*, not by filename or a caller-declared content type.
"""

import pytest
from fastapi.testclient import TestClient

from loskai import config
from loskai.main import app
from loskai.shared import icons
from loskai.shared import instances as store

PASSWORD = "smoke-test-password"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    monkeypatch.setattr(config.settings, "base_domain", "example.no")
    return tmp_path


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        c.post("/api/login", json={"username": "admin", "password": PASSWORD})
        store.upsert_instance(
            store.Instance(id="grafana", name="Grafana", type="external",
                           subdomain="grafana", upstream="192.168.10.50:3000")
        )
        yield c


# --- sniffing ---


def test_supported_formats_are_recognised_by_their_bytes():
    assert icons.sniff(PNG) == ("png", "image/png")
    assert icons.sniff(JPEG) == ("jpg", "image/jpeg")
    assert icons.sniff(WEBP) == ("webp", "image/webp")


def test_svg_is_refused():
    # Served from Loskai's own origin, so an SVG is a script-injection vector.
    with pytest.raises(icons.IconError):
        icons.sniff(SVG)


def test_a_riff_container_that_is_not_webp_is_refused():
    with pytest.raises(icons.IconError):
        icons.sniff(b"RIFF" + b"\x00\x00\x00\x00" + b"AVI " + b"\x00" * 32)


def test_oversized_and_empty_are_refused():
    with pytest.raises(icons.IconError):
        icons.sniff(PNG + b"\x00" * icons.MAX_BYTES)
    with pytest.raises(icons.IconError):
        icons.sniff(b"")


def test_a_stored_filename_cannot_escape_the_icons_directory():
    # The filename comes from instances.json, which a human can edit by hand.
    with pytest.raises(icons.IconError):
        icons.path_for("../../etc/passwd")


def test_saving_replaces_a_previous_icon_of_another_format(data_dir):
    icons.save("grafana", PNG)
    icons.save("grafana", JPEG)

    stored = sorted(p.name for p in (data_dir / "icons").iterdir())
    assert stored == ["grafana.jpg"]


# --- the HTTP surface ---


def test_upload_serve_and_delete(client):
    up = client.post("/api/instances/grafana/icon", content=PNG)
    assert up.status_code == 200, up.text
    assert up.json()["icon"] == "grafana.png"

    got = client.get("/api/instances/grafana/icon")
    assert got.status_code == 200
    assert got.headers["content-type"] == "image/png"
    assert got.content == PNG

    gone = client.delete("/api/instances/grafana/icon")
    assert gone.status_code == 200 and gone.json()["icon"] is None
    assert client.get("/api/instances/grafana/icon").status_code == 404


def test_an_unsupported_image_is_rejected_with_a_reason(client):
    r = client.post("/api/instances/grafana/icon", content=SVG)

    assert r.status_code == 422
    assert "SVG" in r.json()["detail"]


def test_an_oversized_upload_is_refused_before_it_is_stored(client):
    r = client.post("/api/instances/grafana/icon", content=PNG + b"\x00" * icons.MAX_BYTES)

    assert r.status_code == 413
    assert store.get_instance("grafana").icon is None


def test_serving_an_icon_needs_no_session_but_uploading_does(client):
    client.post("/api/instances/grafana/icon", content=PNG)
    client.cookies.clear()  # the logged-out case

    assert client.get("/api/instances/grafana/icon").status_code == 200
    assert client.post("/api/instances/grafana/icon", content=JPEG).status_code == 401
    assert client.delete("/api/instances/grafana/icon").status_code == 401


# --- the launcher endpoint (private routes, for a desktop client) ---


def test_the_launcher_needs_a_session_and_the_dashboard_does_not(client):
    client.cookies.clear()

    assert client.get("/api/dashboard").status_code == 200
    assert client.get("/api/launcher").status_code == 401


def test_the_launcher_lists_private_routes_and_the_dashboard_hides_them(client):
    store.upsert_instance(
        store.Instance(id="secret", name="Secret", type="external", subdomain="secret",
                       upstream="192.168.10.50:9000", private=True)
    )

    public = [c["name"] for c in client.get("/api/dashboard").json()["services"]]
    private = {c["name"]: c["private"] for c in client.get("/api/launcher").json()["services"]}

    assert public == ["Grafana"]
    assert private == {"Grafana": False, "Secret": True}


def test_neither_lists_machines(client):
    store.upsert_instance(
        store.Instance(id="nas", name="NAS", type="external", kind="machine",
                       subdomain="nas", upstream="192.168.10.50", route_mode="dns_only")
    )

    assert [c["name"] for c in client.get("/api/dashboard").json()["services"]] == ["Grafana"]
    assert [c["name"] for c in client.get("/api/launcher").json()["services"]] == ["Grafana"]


def test_cards_carry_a_stable_id_and_an_icon_url_only_when_one_exists(client):
    before = client.get("/api/dashboard").json()["services"][0]
    assert before == {
        "id": "grafana",
        "name": "Grafana",
        "url": "https://grafana.example.no",
        "icon": None,
    }

    client.post("/api/instances/grafana/icon", content=PNG)

    after = client.get("/api/dashboard").json()["services"][0]
    assert after["icon"] == "/api/instances/grafana/icon"
