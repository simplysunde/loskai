"""Tier-1/2: launcher icons — the one binary thing Loskai stores, and the one public
endpoint that serves user-supplied bytes back from Loskai's own origin. The validation is
therefore by *magic bytes*, not by filename or a caller-declared content type.
"""

import pytest

from loskai import config
from loskai.shared import icons
from loskai.shared import instances as store

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.fixture(autouse=True)
def base_domain(monkeypatch):
    monkeypatch.setattr(config.settings, "base_domain", "example.no")


@pytest.fixture
def client(admin):
    store.upsert_instance(
        store.Instance(id="grafana", name="Grafana", type="external",
                       subdomain="grafana", upstream="192.168.10.50:3000")
    )
    return admin


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


def test_a_change_made_while_an_icon_uploads_is_kept(client, monkeypatch):
    """The upload awaits the body between reading the record and writing it: a re-point
    by the follower meanwhile must survive, as it does for a recipe's icon (`give_icon`)."""
    save = icons.save

    def save_while_repointed(instance_id, data):
        store.upsert_instance(store.get_instance(instance_id).model_copy(update={"upstream": "192.168.10.50:3001"}))
        return save(instance_id, data)

    monkeypatch.setattr(icons, "save", save_while_repointed)
    assert client.post("/api/instances/grafana/icon", content=PNG).status_code == 200

    stored = store.get_instance("grafana")
    assert (stored.icon, stored.upstream) == ("grafana.png", "192.168.10.50:3001")


def test_an_icon_for_a_record_deleted_while_it_uploaded_is_not_kept(client, data_dir, monkeypatch):
    save = icons.save

    def save_while_deleted(instance_id, data):
        store.delete_instance(instance_id)
        return save(instance_id, data)

    monkeypatch.setattr(icons, "save", save_while_deleted)
    assert client.post("/api/instances/grafana/icon", content=PNG).status_code == 404
    assert store.get_instance("grafana") is None
    assert list((data_dir / "icons").iterdir()) == []


def test_renaming_changes_only_the_name(client):
    assert client.patch("/api/instances/grafana", json={"name": "Graphs"}).status_code == 200
    stored = store.get_instance("grafana")
    assert (stored.name, stored.private, stored.upstream) == ("Graphs", False, "192.168.10.50:3000")


def test_a_machine_is_renamed_by_its_hostname_only(client):
    store.upsert_instance(store.Instance(id="nas", name="nas", type="external", kind="machine",
                                         subdomain="nas", route_mode="dns_only", upstream="192.168.10.60"))

    r = client.patch("/api/instances/nas", json={"name": "NAS box"})

    assert r.status_code == 409 and "hostname" in r.json()["detail"]
    assert store.get_instance("nas").name == "nas"
    assert client.patch("/api/instances/nas", json={"private": True}).status_code == 200
