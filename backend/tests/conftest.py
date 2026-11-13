"""Global test isolation.

`config.settings` is a module-level singleton, and `config.py` now reads
`env_file=<repo-root>/.env` (for real `uv run` dev use — see config.py). Left alone,
every test would depend on whatever happens to be in the developer's local `.env` —
e.g. a real `LOSKAI_PASSWORD` there makes first-run-setup tests fail because the app no
longer thinks it's a fresh install. Reset every field to its default before each test so
the suite stays hermetic no matter what's on disk or in the environment.

The two path defaults are then pointed at `tmp_path` rather than left at their clean
values, which since 2026-09-10 resolve to the repo's own `data/` and `stacks/` — real,
writable directories holding a developer's live admin password hash and instances. A
test that forgets its own `data_dir` fixture used to fail loudly (`/data` is unwritable);
without this it would instead read — and `POST /api/auth/setup` would overwrite — that
live state.
"""

from pathlib import Path

import pytest

from fastapi.testclient import TestClient

from loskai.config import Settings, settings
from loskai.main import app
from loskai.modules.docker.client import docker_client
from loskai.shared import auth, follow

# The first admin's password, and the Origin a change needs — for a test that types the
# password again (an unlock, a second login) or sends a header itself: `from conftest import`.
PASSWORD = "correct horse battery"
ORIGIN = {"origin": "http://testserver"}


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch, tmp_path):
    # Each field's own default — not `Settings(_env_file=None)`, which still reads the
    # environment, so an exported LOSKAI_PASSWORD or BASE_DOMAIN changed what tests saw.
    clean = Settings.model_construct()
    for name in Settings.model_fields:
        monkeypatch.setattr(settings, name, getattr(clean, name))
    # Created, not just named: `stacks_dir_ok()` is false for a missing directory, and
    # the repo's `stacks/` exists, so a bare path would change what health checks see.
    for name in ("data_dir", "stacks_dir"):
        path = tmp_path / name.removesuffix("_dir")
        path.mkdir()
        monkeypatch.setattr(settings, name, str(path))


def make_recipe(base, name, display, extra_manifest="", compose=True):
    """A recipe folder under `base`: its `recipe.yml`, and a one-service compose file."""
    folder = base / name
    folder.mkdir(parents=True)
    manifest = f"name: {display}\ntype: pull\n{extra_manifest}"
    (folder / "recipe.yml").write_text(manifest)
    if compose:
        (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n")
    return folder


@pytest.fixture
def admin():
    """A client signed in as the first admin, `admin` — as first-run setup leaves you."""
    with TestClient(app) as c:
        assert c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD}).status_code == 200
        yield c


@pytest.fixture
def data_dir() -> Path:
    """This test's data directory (`_isolated_settings` made it) — for a test that reads or
    writes the files in it."""
    return Path(settings.data_dir)


@pytest.fixture(autouse=True)
def _no_follower(monkeypatch):
    """The app's lifespan starts the container follower (shared/follow.py), and every
    `with TestClient(app)` runs the lifespan. Left alone it would open Docker's event
    stream against whatever daemon the developer's machine has. Tests of the follower
    itself call its functions directly."""

    async def idle(_caddy_client) -> None:
        return None

    monkeypatch.setattr(follow, "watch", idle)


@pytest.fixture(autouse=True)
def _no_docker_labels(monkeypatch):
    """A new container route looks up its recipe's icon (install.recipe_icon), which asks
    Docker for the container's labels. No compose labels means no icon, so route tests
    never reach the developer's daemon; the icon tests set their own."""
    monkeypatch.setattr(docker_client, "labels_of", lambda container: {})


@pytest.fixture(autouse=True)
def _fresh_login_backoff(monkeypatch):
    """The wrong-password count lives in the process, so one test's failed logins would
    make a later test's login wait."""
    monkeypatch.setattr(auth, "_backoff", auth._Backoff())
    monkeypatch.setattr(auth, "_made_up", [])
