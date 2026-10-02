"""Tier-1: recipe validation, .env/var rendering, the multi-source merge, and the
container the install links its instance to."""

import pytest

from loskai import config
from loskai.modules.docker import logic, recipes
from loskai.shared import instances as instances_store
from loskai.shared import settings as settings_store


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


# --- Sources + merge (filesystem) ---


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
    _make_recipe(_cache(data_dir, REPO_A), "grafana", "Grafana (A)")
    _make_recipe(_cache(data_dir, REPO_B), "grafana", "Grafana (B)")
    _make_recipe(_cache(data_dir, REPO_B), "jelly", "Jellyfin")
    _make_recipe(data_dir / "recipes", "grafana", "Grafana (local)")

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
    _make_recipe(data_dir / "recipes", "jelly", "Jellyfin")
    result = recipes.list_recipes()
    assert [r["source"] for r in result["recipes"]] == ["local"]
    assert result["local_count"] == 1


def test_disabled_source_is_not_scanned(data_dir):
    settings_store.update(
        {"recipes_repos": [{"url": REPO_A, "enabled": False}, {"url": REPO_B, "enabled": True}]}
    )
    _make_recipe(_cache(data_dir, REPO_A), "grafana", "Grafana (A)")
    _make_recipe(_cache(data_dir, REPO_B), "jelly", "Jellyfin")

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


def test_list_recipes_flags_invalid(data_dir):
    # compose.yml missing -> invalid, but doesn't break the rest.
    _make_recipe(data_dir / "recipes", "broken", "Broken", compose=False)
    _make_recipe(data_dir / "recipes", "ok", "OK")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["ok"]
    assert any(i["id"] == "broken" and "compose.yml missing" in i["error"] for i in result["invalid"])


def test_list_recipes_empty_when_no_sources(data_dir):
    assert recipes.list_recipes()["recipes"] == []


def test_instructions_are_loaded_for_the_wizard(data_dir):
    folder = _make_recipe(data_dir / "recipes", "grafana", "Grafana")
    (folder / "instructions.md").write_text("# Grafana\nLog in with admin/admin.\n")
    recipe = recipes.get_recipe("grafana")
    assert "Log in with admin/admin." in recipe["instructions"]


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
            raise recipes.RecipeError("could not resolve host")
        return "Already up to date."

    monkeypatch.setattr(recipes, "_sync_one", fake_sync)
    result = recipes.sync_recipes()
    assert result["ok"] is False  # one failed
    assert [(r["label"], r["ok"]) for r in result["results"]] == [
        ("recipes-a", False),
        ("recipes-b", True),
    ]
    assert "could not resolve host" in result["output"]


def test_sync_can_target_one_source(data_dir, monkeypatch):
    _use_sources(REPO_A, REPO_B)
    monkeypatch.setattr(recipes, "_sync_one", lambda url: "cloned")
    assert [r["url"] for r in recipes.sync_recipes(REPO_B)["results"]] == [REPO_B]


def test_sync_refuses_a_disabled_or_unknown_source(data_dir, monkeypatch):
    _use_sources(REPO_A)
    monkeypatch.setattr(recipes, "_sync_one", lambda url: "cloned")
    with pytest.raises(recipes.RecipeError, match="not an enabled recipe source"):
        recipes.sync_recipes(REPO_B)


def test_sync_with_no_sources_says_so(data_dir):
    settings_store.update({"recipes_repos": []})
    with pytest.raises(recipes.RecipeError, match="no recipe sources"):
        recipes.sync_recipes()


# --- Which container an installed recipe links to (pure) ---


def _c(service, name, published=False):
    return {"service": service, "name": name, "ports": {"80/tcp": [{"HostPort": "8080"}] if published else None}}


def test_primary_container_single_service():
    assert logic.primary_container([_c("app", "grafana-app-1")]) == "grafana-app-1"


def test_primary_container_prefers_the_declared_service():
    containers = [_c("app", "immich-app-1"), _c("db", "immich-db-1")]
    assert logic.primary_container(containers, "db") == "immich-db-1"


def test_primary_container_ignores_a_declared_service_that_is_not_there():
    containers = [_c("app", "immich-app-1", published=True), _c("db", "immich-db-1")]
    assert logic.primary_container(containers, "web") == "immich-app-1"


def test_primary_container_prefers_the_published_service():
    containers = [_c("db", "immich-db-1"), _c("web", "immich-web-1", published=True)]
    assert logic.primary_container(containers) == "immich-web-1"


def test_primary_container_falls_back_to_a_stable_order():
    containers = [_c("web", "app-web-1", published=True), _c("api", "app-api-1", published=True)]
    assert logic.primary_container(containers) == "app-api-1"


def test_primary_container_none_when_nothing_came_up():
    assert logic.primary_container([]) is None


# --- Install (the instance links to the real container name) ---


@pytest.fixture
def installable(data_dir, monkeypatch):
    """A local recipe plus a stubbed compose run — the install path without a daemon."""
    _make_recipe(data_dir / "recipes", "grafana", "Grafana")
    monkeypatch.setattr(recipes, "_compose_up", lambda d, build: {"ok": True, "output": "Started"})
    return data_dir


def _fake_project(monkeypatch, containers):
    monkeypatch.setattr(
        recipes.docker_client, "containers_in_project", lambda project: containers
    )


def test_install_links_the_instance_to_the_compose_container(installable, monkeypatch):
    """Compose names the container `<project>-<service>-1`, so the recipe id is not it —
    and the instance join in logic.py matches on the name."""
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    result = recipes.install_recipe("grafana", {"PORT": "3000"})

    assert result["ok"] and result["container"] == "grafana-app-1"
    instance = instances_store.get_instance("grafana")
    assert instance.container == "grafana-app-1"
    # The join the Docker tab and the Routing table actually use.
    assert logic.orphaned_instances([instance], {"grafana-app-1"}) == []


def test_install_writes_the_generated_env(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    recipes.install_recipe("grafana", {"PORT": "3000", "PW": "s3cret"})
    stack = recipes.stacks.stacks_dir() / "grafana"
    assert (stack / ".env").read_text() == "PORT=3000\nPW=s3cret\n"
    assert "image: x" in (stack / "compose.yml").read_text()


def test_failed_compose_registers_no_instance(installable, monkeypatch):
    monkeypatch.setattr(recipes, "_compose_up", lambda d, build: {"ok": False, "output": "boom"})
    _fake_project(monkeypatch, [])
    result = recipes.install_recipe("grafana", {})
    assert result["ok"] is False and result["instance_id"] is None
    assert instances_store.get_instance("grafana") is None


def test_unidentifiable_container_warns_instead_of_guessing(installable, monkeypatch):
    """No container to name means no instance: a wrong `container` would sit in the list
    as a second, permanently orphaned record beside the one the Routing tab creates."""
    _fake_project(monkeypatch, [])
    result = recipes.install_recipe("grafana", {})
    assert result["ok"] is True and result["instance_id"] is None
    assert "could not be identified" in result["warning"]
    assert instances_store.get_instance("grafana") is None


def test_install_survives_a_daemon_that_went_away(installable, monkeypatch):
    def boom(project):
        raise OSError("socket gone")

    monkeypatch.setattr(recipes.docker_client, "containers_in_project", boom)
    result = recipes.install_recipe("grafana", {})
    assert result["ok"] is True and result["warning"]


def test_install_refuses_a_duplicate_stack(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    recipes.install_recipe("grafana", {})
    with pytest.raises(recipes.RecipeError, match="already exists"):
        recipes.install_recipe("grafana", {})
