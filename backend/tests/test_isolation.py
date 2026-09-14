"""Tier-1: the suite's own guard rails (see conftest.py)."""

from pathlib import Path

from loskai import config


def test_suite_never_points_at_the_developers_real_state(tmp_path):
    """conftest's autouse fixture redirects both path settings at a tmp dir. Left at
    their defaults they resolve to the repo's own data/ and stacks/, so a test that
    forgets its own `data_dir` fixture reads — and via setup/settings writes, clobbers —
    a real admin password hash and instance list. Both used to be unwritable (`/data`),
    which made that mistake fail loudly; this is the replacement guard. Deliberately in a
    file that sets no paths of its own, which is the case being protected."""
    for key in ("data_dir", "stacks_dir"):
        actual = Path(getattr(config.settings, key))
        assert actual == tmp_path / key.removesuffix("_dir")
        assert actual.is_dir()
        assert str(actual) != config.Settings.model_fields[key].default
