"""The recipe sources: the scan and the merge across them, the source list, and the sync."""

import subprocess

import pytest

from loskai import config
from loskai.modules.docker import manifest, recipes
from loskai.shared import settings as settings_store

from conftest import make_recipe


# --- Sources + merge (filesystem) ---


def _cache(data_dir, url):
    """Where a given source's clone lands — tests write recipes straight into it."""
    return data_dir / "recipes-cache" / recipes.source_slug(url)


REPO_A = "https://git.example/sunde/recipes-a.git"
REPO_B = "https://git.example/sunde/recipes-b.git"


def _use_sources(*urls, enabled=True):
    settings_store.update(
        {"recipes_repos": [{"url": u, "enabled": enabled} for u in urls]}
    )


def test_unset_seeds_the_builtin_default_source(data_dir):
    """A fresh install has one source: the built-in default, flagged as such. `unset`
    means "not configured yet" here, never "no sources" — see recipe_sources."""
    sources, source = settings_store.recipe_sources()
    assert source == "unset"
    assert [(s["url"], s["builtin"]) for s in sources] == [
        (config.DEFAULT_RECIPES_REPO, True)
    ]


def test_stored_empty_list_means_no_sources(data_dir):
    """Deleting every source has to stick, rather than re-seeding the default."""
    settings_store.update({"recipes_repos": []})
    assert settings_store.recipe_sources() == ([], "stored")
    assert recipes.enabled_sources() == []


def test_list_recipes_merges_sources_in_priority_order(data_dir):
    _use_sources(REPO_A, REPO_B)
    make_recipe(_cache(data_dir, REPO_A), "grafana", "Grafana (A)")
    make_recipe(_cache(data_dir, REPO_B), "grafana", "Grafana (B)")
    make_recipe(_cache(data_dir, REPO_B), "jelly", "Jellyfin")
    make_recipe(data_dir / "recipes", "grafana", "Grafana (local)")

    result = recipes.list_recipes()
    by_id = {r["id"]: r for r in result["recipes"]}
    assert by_id["grafana"]["name"] == "Grafana (A)"  # first source wins
    assert by_id["grafana"]["source"] == "recipes-a"
    assert by_id["jelly"]["source"] == "recipes-b"
    # Both losers are flagged, and each says who beat it.
    assert {"id": "grafana", "source": "recipes-b", "shadowed_by": "recipes-a"} in result["shadowed"]
    assert {"id": "grafana", "source": "local", "shadowed_by": "recipes-a"} in result["shadowed"]


def test_local_dir_is_scanned_last_and_cannot_be_disabled(data_dir):
    settings_store.update({"recipes_repos": []})
    make_recipe(data_dir / "recipes", "jelly", "Jellyfin")
    result = recipes.list_recipes()
    assert [r["source"] for r in result["recipes"]] == ["local"]
    assert result["local_count"] == 1


def test_a_name_that_isnt_text_is_refused_not_a_broken_list(data_dir):
    """YAML reads `name: 2048` as a number. Let through, it reached the list's sort by
    name and took every recipe with it."""
    settings_store.update({"recipes_repos": []})
    make_recipe(data_dir / "recipes", "game", "2048")
    make_recipe(data_dir / "recipes", "jelly", "Jellyfin")
    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["jelly"]
    assert any(i["id"] == "game" and "name" in i["error"] for i in result["invalid"])


def test_disabled_source_is_not_scanned(data_dir):
    settings_store.update(
        {"recipes_repos": [{"url": REPO_A, "enabled": False}, {"url": REPO_B, "enabled": True}]}
    )
    make_recipe(_cache(data_dir, REPO_A), "grafana", "Grafana (A)")
    make_recipe(_cache(data_dir, REPO_B), "jelly", "Jellyfin")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["jelly"]
    # It still appears in the source list, switched off — the UI needs to render the row.
    assert [(s["label"], s["enabled"]) for s in result["sources"]] == [
        ("recipes-a", False),
        ("recipes-b", True),
    ]


def test_same_tail_on_different_hosts_gets_its_own_cache():
    """Two repos whose last path segment matches must not share a clone directory."""
    a = recipes.source_slug("https://git.example/one/recipes.git")
    b = recipes.source_slug("https://github.com/two/recipes.git")
    assert a != b
    assert a.startswith("recipes-") and b.startswith("recipes-")


def test_sources_sharing_a_tail_are_counted_and_named_apart(data_dir):
    """Two forks called `recipes` on different hosts used to share one label — each row
    showed the combined count, and a shadow note read "recipes copy hidden by recipes"."""
    one, two = "https://git.example/one/recipes.git", "https://github.com/two/recipes.git"
    _use_sources(one, two)
    make_recipe(_cache(data_dir, one), "grafana", "Grafana")
    make_recipe(_cache(data_dir, two), "grafana", "Grafana")
    make_recipe(_cache(data_dir, two), "jelly", "Jellyfin")

    result = recipes.list_recipes()
    assert [(s["label"], s["count"]) for s in result["sources"]] == [
        ("git.example/one/recipes", 1),
        ("github.com/two/recipes", 1),
    ]
    assert result["shadowed"] == [
        {"id": "grafana", "source": "github.com/two/recipes", "shadowed_by": "git.example/one/recipes"}
    ]


def test_list_recipes_flags_invalid(data_dir):
    # compose.yml missing -> invalid, but doesn't break the rest.
    make_recipe(data_dir / "recipes", "broken", "Broken", compose=False)
    make_recipe(data_dir / "recipes", "ok", "OK")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["ok"]
    assert any(i["id"] == "broken" and "compose.yml missing" in i["error"] for i in result["invalid"])


def test_a_compose_file_that_names_its_project_is_refused(data_dir):
    """Compose labels the containers with that name, not the recipe id, so the install
    found no container to link and a reinstall was refused as someone else's route."""
    folder = make_recipe(data_dir / "recipes", "whoami", "Whoami")
    (folder / "compose.yml").write_text("name: other\nservices:\n  app:\n    image: x\n")
    result = recipes.list_recipes()
    assert result["recipes"] == []
    assert any("top-level 'name:'" in i["error"] for i in result["invalid"])


def test_hidden_folders_are_not_recipes(data_dir):
    """A synced source is a git clone: its `.git` used to be reported as a broken recipe."""
    (data_dir / "recipes" / ".git").mkdir(parents=True)
    make_recipe(data_dir / "recipes", "ok", "OK")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["ok"]
    assert result["invalid"] == []


def test_list_recipes_empty_when_no_sources(data_dir):
    assert recipes.list_recipes()["recipes"] == []


def test_instructions_are_loaded_for_the_wizard(data_dir):
    folder = make_recipe(data_dir / "recipes", "grafana", "Grafana")
    (folder / "instructions.md").write_text("# Grafana\nLog in with admin/admin.\n")
    recipe = recipes.get_recipe("grafana")
    assert "Log in with admin/admin." in recipe["instructions"]


def test_the_log_link_reaches_the_wizard(data_dir):
    make_recipe(data_dir / "recipes", "tailscale", "Tailscale", "log_link: https://login.tailscale.com/\n")
    assert recipes.get_recipe("tailscale")["log_link"] == "https://login.tailscale.com/"
    make_recipe(data_dir / "recipes", "grafana", "Grafana")
    assert recipes.get_recipe("grafana")["log_link"] is None


# --- Source validation (the one list-shaped setting) ---


@pytest.mark.parametrize(
    "value,expected",
    [
        ("not-a-list", "must be a list"),
        ([{"enabled": True}], "needs a 'url'"),
        ([{"url": "git@git.example:sunde/recipes.git"}], "http:// or https://"),
        ([{"url": "/data/recipes"}], "http:// or https://"),
        ([{"url": REPO_A}, {"url": REPO_A}], "Duplicate"),
        ([[REPO_A]], "object with a 'url'"),
    ],
)
def test_rejected_source_lists(data_dir, value, expected):
    with pytest.raises(ValueError, match=expected):
        settings_store.update({"recipes_repos": value})
    assert "recipes_repos" not in settings_store._read_stored()


def test_too_many_sources_rejected(data_dir):
    many = [{"url": f"https://git.example/r{i}.git"} for i in range(settings_store.MAX_RECIPE_SOURCES + 1)]
    with pytest.raises(ValueError, match="At most"):
        settings_store.update({"recipes_repos": many})


# --- Sync (one repo failing never stops the others) ---


def test_sync_reports_each_source_separately(data_dir, monkeypatch):
    _use_sources(REPO_A, REPO_B)

    def fake_sync(url):
        if url == REPO_A:
            raise manifest.RecipeError("could not resolve host")
        return "Already up to date."

    monkeypatch.setattr(recipes, "_sync_one", fake_sync)
    result = recipes.sync_recipes()
    assert result["ok"] is False  # one failed
    assert [(r["label"], r["ok"]) for r in result["results"]] == [
        ("recipes-a", False),
        ("recipes-b", True),
    ]
    assert "could not resolve host" in result["output"]


def test_sync_follows_a_rewritten_history(data_dir, tmp_path):
    def git(*args, cwd=None):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    origin = tmp_path / "origin.git"
    work = tmp_path / "work"
    git("init", "--bare", "-b", "main", str(origin))
    git("clone", str(origin), str(work))
    git("config", "user.email", "t@example.invalid", cwd=work)
    git("config", "user.name", "t", cwd=work)
    for n in ("one", "two"):
        (work / "a.txt").write_text(f"{n}\n")
        git("add", ".", cwd=work)
        git("commit", "-m", n, cwd=work)
    git("push", "origin", "main", cwd=work)
    url = origin.as_uri()
    recipes._sync_one(url)
    # A cache seen live had no fetch refspec, so no remote-tracking branch to reset to.
    git("config", "--unset-all", "remote.origin.fetch", cwd=recipes.repo_cache(url))

    (work / "a.txt").write_text("rewritten\n")
    git("commit", "-a", "--amend", "-m", "rewritten", cwd=work)
    git("push", "--force", "origin", "main", cwd=work)
    recipes._sync_one(url)
    cache = recipes.repo_cache(url)
    assert (cache / "a.txt").read_text() == "rewritten\n"
    # Still only the tip, as the clone took: not the rewritten head's whole history.
    count = subprocess.run(["git", "-C", str(cache), "rev-list", "--count", "HEAD"], capture_output=True, text=True)
    assert count.stdout.strip() == "1"


def test_sync_can_target_one_source(data_dir, monkeypatch):
    _use_sources(REPO_A, REPO_B)
    monkeypatch.setattr(recipes, "_sync_one", lambda url: "cloned")
    assert [r["url"] for r in recipes.sync_recipes(REPO_B)["results"]] == [REPO_B]


def test_sync_refuses_a_disabled_or_unknown_source(data_dir, monkeypatch):
    _use_sources(REPO_A)
    monkeypatch.setattr(recipes, "_sync_one", lambda url: "cloned")
    with pytest.raises(manifest.RecipeError, match="not an enabled recipe source"):
        recipes.sync_recipes(REPO_B)


def test_sync_with_no_sources_says_so(data_dir):
    settings_store.update({"recipes_repos": []})
    with pytest.raises(manifest.RecipeError, match="no recipe sources"):
        recipes.sync_recipes()
