"""Tier-1: recipe validation, .env/var rendering, and the two-source merge."""

import pytest

from loskai import config
from loskai.modules.docker import recipes


# --- Pure validation ---


def test_valid_pull_manifest():
    assert recipes.validate_manifest({"name": "Grafana", "type": "pull"}) == []


def test_missing_name_and_bad_type():
    errors = recipes.validate_manifest({"type": "nope"})
    assert any("name" in e for e in errors)
    assert any("type" in e for e in errors)


def test_git_build_requires_repo():
    errors = recipes.validate_manifest({"name": "X", "type": "git_build"})
    assert any("git_repo" in e for e in errors)
    assert recipes.validate_manifest(
        {"name": "X", "type": "git_build", "git_repo": "https://x"}
    ) == []


def test_env_entry_needs_key_and_label():
    errors = recipes.validate_manifest(
        {"name": "X", "type": "pull", "env": [{"key": "PORT"}]}
    )
    assert any("env[0]" in e for e in errors)


def test_render_env():
    assert recipes.render_env({"PORT": "3000", "PW": "secret"}) == "PORT=3000\nPW=secret\n"


def test_expand_vars():
    assert recipes.expand_vars("/data/${APP}", {"APP": "grafana"}) == "/data/grafana"
    assert recipes.expand_vars("/data/${MISSING}", {}) == "/data/${MISSING}"


# --- Merge (filesystem) ---


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "data_dir", str(tmp_path))
    return tmp_path


def _make_recipe(base, name, display, extra_manifest="", compose=True):
    folder = base / name
    folder.mkdir(parents=True)
    manifest = f"name: {display}\ntype: pull\n{extra_manifest}"
    (folder / "recipe.yml").write_text(manifest)
    if compose:
        (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n")
    return folder


def test_list_recipes_merges_and_repo_wins(data_dir):
    _make_recipe(data_dir / "recipes-cache", "grafana", "Grafana (repo)")
    _make_recipe(data_dir / "recipes", "grafana", "Grafana (local)")
    _make_recipe(data_dir / "recipes", "jelly", "Jellyfin")

    result = recipes.list_recipes()
    by_id = {r["id"]: r for r in result["recipes"]}
    assert by_id["grafana"]["name"] == "Grafana (repo)"  # repo wins
    assert by_id["grafana"]["source"] == "repo"
    assert by_id["jelly"]["source"] == "local"
    assert {"id": "grafana", "shadowed_by": "repo"} in result["shadowed"]


def test_list_recipes_flags_invalid(data_dir):
    # compose.yml missing -> invalid, but doesn't break the rest.
    _make_recipe(data_dir / "recipes", "broken", "Broken", compose=False)
    _make_recipe(data_dir / "recipes", "ok", "OK")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["ok"]
    assert any(i["id"] == "broken" and "compose.yml missing" in i["error"] for i in result["invalid"])


def test_list_recipes_empty_when_no_sources(data_dir):
    assert recipes.list_recipes()["recipes"] == []
