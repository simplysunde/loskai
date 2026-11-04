"""Global test isolation.

`config.settings` is a module-level singleton, and `config.py` now reads
`env_file=<repo-root>/.env` (for real `uv run` dev use — see config.py). Left alone,
every test would depend on whatever happens to be in the developer's local `.env` —
e.g. a real `LOSKAI_PASSWORD` there makes first-run-setup tests fail because the app no
longer thinks it's a fresh install. Reset every field to its no-`.env` value before each
test so the suite stays hermetic no matter what's on disk.

The two path defaults are then pointed at `tmp_path` rather than left at their clean
values, which since 2026-09-10 resolve to the repo's own `data/` and `stacks/` — real,
writable directories holding a developer's live admin password hash and instances. A
test that forgets its own `data_dir` fixture used to fail loudly (`/data` is unwritable);
without this it would instead read — and `POST /api/auth/setup` would overwrite — that
live state.
"""

import pytest

from loskai.config import Settings, settings
from loskai.modules.docker.client import docker_client
from loskai.shared import auth, follow


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch, tmp_path):
    clean = Settings(_env_file=None)
    for name in Settings.model_fields:
        monkeypatch.setattr(settings, name, getattr(clean, name))
    # Created, not just named: `stacks_dir_ok()` is false for a missing directory, and
    # the repo's `stacks/` exists, so a bare path would change what health checks see.
    for name in ("data_dir", "stacks_dir"):
        path = tmp_path / name.removesuffix("_dir")
        path.mkdir()
        monkeypatch.setattr(settings, name, str(path))


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
    """A new container route looks up its recipe's icon (recipes.recipe_icon), which asks
    Docker for the container's labels. No compose labels means no icon, so route tests
    never reach the developer's daemon; the icon tests set their own."""
    monkeypatch.setattr(docker_client, "labels_of", lambda container: {})


@pytest.fixture(autouse=True)
def _fresh_login_backoff(monkeypatch):
    """The wrong-password count lives in the process, so one test's failed logins would
    make a later test's login wait."""
    monkeypatch.setattr(auth, "_backoff", auth._Backoff())
