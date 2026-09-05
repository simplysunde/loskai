"""Global test isolation.

`config.settings` is a module-level singleton, and `config.py` now reads
`env_file=<repo-root>/.env` (for real `uv run` dev use — see config.py). Left alone,
every test would depend on whatever happens to be in the developer's local `.env` —
e.g. a real `LOSKAI_PASSWORD` there makes first-run-setup tests fail because the app no
longer thinks it's a fresh install. Reset every field to its no-`.env` value before each
test so the suite stays hermetic no matter what's on disk.
"""

import pytest

from loskai.config import Settings, settings


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch, tmp_path):
    clean = Settings(_env_file=None)
    for name in Settings.model_fields:
        monkeypatch.setattr(settings, name, getattr(clean, name))
    # Same hermeticity argument, for a path rather than a setting: `verify_data_dir` runs
    # in the app lifespan and consults the pre-/data location on disk, so a developer who
    # happens to have a real /opt/loskai would fail every test that starts the app. Point
    # it at a directory that cannot exist; the guard's own tests override this.
    monkeypatch.setattr(
        "loskai.shared.settings.LEGACY_DATA_DIR", str(tmp_path / "no-legacy-dir")
    )
