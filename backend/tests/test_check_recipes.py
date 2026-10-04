"""The authoring check: the wizard's own validator, run over folders from the command line."""

import pytest

from loskai.modules.docker import check_recipes


@pytest.fixture
def repo(tmp_path):
    # conftest's autouse fixtures put data/ and stacks/ in tmp_path itself.
    (tmp_path / "repo").mkdir()
    return tmp_path / "repo"


def _recipe(base, name, manifest="name: X\ntype: pull\n", compose=True):
    folder = base / name
    folder.mkdir(parents=True)
    (folder / "recipe.yml").write_text(manifest)
    if compose:
        (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n")
    return folder


def test_a_repo_is_scanned_like_a_sync_would(repo, capsys):
    _recipe(repo, "good")
    _recipe(repo, "broken", compose=False)
    (repo / ".git").mkdir()

    assert check_recipes.main([str(repo)]) == 1
    out = capsys.readouterr().out
    assert "ok    good" in out
    assert "FAIL  broken: compose.yml missing" in out
    assert ".git" not in out


def test_one_recipe_folder_is_checked_on_its_own(repo, capsys):
    folder = _recipe(repo, "jellyfin", "name: J\ntype: pull\nmounts:\n  label: M\n  target: /\n")

    assert check_recipes.main([str(folder)]) == 1
    assert "absolute container path" in capsys.readouterr().out


def test_all_valid_exits_zero(repo, capsys):
    _recipe(repo, "good")
    assert check_recipes.main([str(repo)]) == 0
    assert "1 valid, 0 would be skipped" in capsys.readouterr().out


def test_nothing_to_check_is_a_failure(repo, capsys):
    """An empty result is far more likely a wrong path than a repo with no recipes."""
    assert check_recipes.main([str(repo)]) == 1
    assert "no recipes found" in capsys.readouterr().out
