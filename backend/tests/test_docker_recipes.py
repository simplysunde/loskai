"""Tier-1: recipe validation, .env/var rendering, the multi-source merge, and the
container the install links its instance to."""

import subprocess

import pytest

from loskai import config
from loskai.modules.docker import dotenv, logic, override, recipes
from loskai.shared import instances as instances_store
from loskai.shared import settings as settings_store


# --- Pure validation ---


def test_valid_pull_manifest():
    assert recipes.validate_manifest({"name": "Grafana", "type": "pull"}) == []


def test_name_must_be_text():
    assert any("name" in e for e in recipes.validate_manifest({"name": 2048, "type": "pull"}))


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


@pytest.mark.parametrize("value", ["https://login.example.com/", "https://login.example.com:8443/a/"])
def test_a_log_link_is_a_host_and_a_path(value):
    assert recipes.validate_manifest({"name": "X", "type": "pull", "log_link": value}) == []


@pytest.mark.parametrize("value", ["https://login.example.com", "http://login.example.com/", "login", 3])
def test_a_log_link_without_https_or_a_path_is_refused(value):
    # Without the path, the prefix would also match login.example.com.elsewhere.net.
    errors = recipes.validate_manifest({"name": "X", "type": "pull", "log_link": value})
    assert any("log_link" in e for e in errors)


def test_env_entry_needs_key_and_label():
    errors = recipes.validate_manifest(
        {"name": "X", "type": "pull", "env": [{"key": "PORT"}]}
    )
    assert any("env[0]" in e for e in errors)


def test_render_env_quotes_every_value():
    assert dotenv.render_env({"PORT": "3000", "PW": "secret"}) == 'PORT="3000"\nPW="secret"\n'


# Each of these arrived at the container altered when written verbatim — and the install
# still *succeeded*. Encodings checked against `docker compose config` and a real
# container's environment on 2026-10-03 (see render_env).
@pytest.mark.parametrize(
    "value,encoded",
    [
        ("pa$word1", r'"pa\$word1"'),  # verbatim: interpolated, arrived as "pa"
        ("correct horse #battery", '"correct horse #battery"'),  # verbatim: cut at " #"
        ("it's", '"it\'s"'),  # the case single quotes cannot hold
        ('say "hi"', r'"say \"hi\""'),
        ("back\\slash", r'"back\\slash"'),
        ("a\\$b", r'"a\\\$b"'),  # backslash escaped first, or "\$" would decode to "$"
        ("x\nCOMPOSE_PROJECT_NAME=hijacked", r'"x\nCOMPOSE_PROJECT_NAME=hijacked"'),
        ("a\rb", r'"a\rb"'),
        ("", '""'),
    ],
)
def test_render_env_escapes_what_compose_would_rewrite(value, encoded):
    assert dotenv.render_env({"V": value}) == f"V={encoded}\n"


def test_a_newline_in_a_value_stays_on_one_line():
    """Verbatim, a newline started a second KEY= line — and COMPOSE_PROJECT_NAME in a .env
    re-points the project, and with it the container the install links to."""
    rendered = dotenv.render_env({"V": "x\nCOMPOSE_PROJECT_NAME=hijacked"})
    assert rendered.count("\n") == 1 and not rendered.startswith("COMPOSE")


# --- Answers: the server owns the value set, not the form ---


SPEC = [
    {"key": "PORT", "label": "Host port", "default": "8081"},
    {"key": "PW", "label": "Password", "secret": True},
]


def test_missing_answers_take_the_manifest_default():
    """Found live: an API install with `{}` wrote no PORT, and compose published on a
    random host port. The wizard sends defaults pre-filled; an API caller need not."""
    assert recipes.resolve_answers(SPEC, {}) == {"PORT": "8081", "PW": ""}


def test_an_explicit_empty_answer_is_kept():
    """Clearing a pre-filled field is a choice, not a request for the default."""
    assert recipes.resolve_answers(SPEC, {"PORT": ""})["PORT"] == ""


def test_none_counts_as_missing():
    assert recipes.resolve_answers(SPEC, {"PORT": None})["PORT"] == "8081"


def test_a_bare_default_is_empty_not_none():
    """`default:` with no value parses as None, which used to be written as the text "None"."""
    spec = [{"key": "PW", "label": "Password", "default": None}]
    assert recipes.resolve_answers(spec, {}) == {"PW": ""}


def test_answers_are_written_in_manifest_order_as_strings():
    assert list(recipes.resolve_answers(SPEC, {"PW": "x", "PORT": 9000}).items()) == [
        ("PORT", "9000"),
        ("PW", "x"),
    ]


def test_an_undeclared_answer_is_refused():
    with pytest.raises(recipes.RecipeError, match="not declared by this recipe: COMPOSE_PROJECT_NAME"):
        recipes.resolve_answers(SPEC, {"COMPOSE_PROJECT_NAME": "hijacked"})


@pytest.mark.parametrize("key", ["MY VAR", "A=B", "1PORT", "PORT\nX"])
def test_env_key_must_be_a_variable_name(key):
    errors = recipes.validate_manifest(
        {"name": "X", "type": "pull", "env": [{"key": key, "label": "L"}]}
    )
    assert any("not a valid variable name" in e for e in errors)


# --- type: path — the host folders a recipe mounts ---


@pytest.mark.parametrize("value", ["./data", "./library/photos", "../shared", "/srv/media", "/mnt/nas share"])
def test_a_mountable_path_has_no_problem(value):
    assert recipes.path_problem(value) is None


@pytest.mark.parametrize(
    "value,why",
    [
        ("~/media", "/root"),  # compose runs as root inside Loskai's container
        ("~", "/root"),
        ("data", "Docker volume"),  # a bare name is a named volume, not a folder
        ("/srv/a:b", "split the volume spec"),
    ],
)
def test_paths_compose_would_mount_somewhere_else(value, why):
    assert why in recipes.path_problem(value)


PATH_SPEC = [
    {"key": "CONFIG", "label": "Config folder", "type": "path", "default": "./config"},
    {"key": "MEDIA", "label": "Media library", "type": "path"},
]


def test_a_path_answer_is_checked_on_the_server():
    with pytest.raises(recipes.RecipeError, match="Media library.*Docker volume"):
        recipes.resolve_answers(PATH_SPEC, {"MEDIA": "movies"})
    with pytest.raises(recipes.RecipeError, match="/root"):
        recipes.resolve_answers(PATH_SPEC, {"MEDIA": "~/movies"})


def test_a_path_is_required_even_when_cleared():
    """An empty source makes `:/media`, which compose rejects after the folder is made."""
    with pytest.raises(recipes.RecipeError, match="'Media library' is required"):
        recipes.resolve_answers(PATH_SPEC, {})
    with pytest.raises(recipes.RecipeError, match="'Config folder' is required"):
        recipes.resolve_answers(PATH_SPEC, {"CONFIG": "  ", "MEDIA": "/srv/media"})


def test_path_answers_are_trimmed_and_passed_through():
    assert recipes.resolve_answers(PATH_SPEC, {"MEDIA": " /srv/media "}) == {
        "CONFIG": "./config", "MEDIA": "/srv/media",
    }


def test_a_manifest_path_default_is_checked_too():
    errors = recipes.validate_manifest({"name": "X", "type": "pull", "env": [
        {"key": "D", "label": "Data", "type": "path", "default": "~/data"},
    ]})
    assert any("env[0] default" in e and "/root" in e for e in errors)


def test_an_unknown_env_type_is_rejected():
    errors = recipes.validate_manifest({"name": "X", "type": "pull", "env": [
        {"key": "D", "label": "Data", "type": "folder"},
    ]})
    assert any("type must be one of" in e for e in errors)


def test_directories_is_gone_and_says_what_replaces_it():
    errors = recipes.validate_manifest({"name": "X", "type": "pull", "directories": ["/srv/x"]})
    assert any("type: path" in e for e in errors)


# --- Sources + merge (filesystem) ---


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


def test_a_name_that_isnt_text_is_refused_not_a_broken_list(data_dir):
    """YAML reads `name: 2048` as a number. Let through, it reached the list's sort by
    name and took every recipe with it."""
    settings_store.update({"recipes_repos": []})
    _make_recipe(data_dir / "recipes", "game", "2048")
    _make_recipe(data_dir / "recipes", "jelly", "Jellyfin")
    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["jelly"]
    assert any(i["id"] == "game" and "name" in i["error"] for i in result["invalid"])


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


def test_sources_sharing_a_tail_are_counted_and_named_apart(data_dir):
    """Two forks called `recipes` on different hosts used to share one label — each row
    showed the combined count, and a shadow note read "recipes copy hidden by recipes"."""
    one, two = "https://git.example/one/recipes.git", "https://github.com/two/recipes.git"
    _use_sources(one, two)
    _make_recipe(_cache(data_dir, one), "grafana", "Grafana")
    _make_recipe(_cache(data_dir, two), "grafana", "Grafana")
    _make_recipe(_cache(data_dir, two), "jelly", "Jellyfin")

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
    _make_recipe(data_dir / "recipes", "broken", "Broken", compose=False)
    _make_recipe(data_dir / "recipes", "ok", "OK")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["ok"]
    assert any(i["id"] == "broken" and "compose.yml missing" in i["error"] for i in result["invalid"])


def test_a_compose_file_that_names_its_project_is_refused(data_dir):
    """Compose labels the containers with that name, not the recipe id, so the install
    found no container to link and a reinstall was refused as someone else's route."""
    folder = _make_recipe(data_dir / "recipes", "whoami", "Whoami")
    (folder / "compose.yml").write_text("name: other\nservices:\n  app:\n    image: x\n")
    result = recipes.list_recipes()
    assert result["recipes"] == []
    assert any("top-level 'name:'" in i["error"] for i in result["invalid"])


def test_hidden_folders_are_not_recipes(data_dir):
    """A synced source is a git clone: its `.git` used to be reported as a broken recipe."""
    (data_dir / "recipes" / ".git").mkdir(parents=True)
    _make_recipe(data_dir / "recipes", "ok", "OK")

    result = recipes.list_recipes()
    assert [r["id"] for r in result["recipes"]] == ["ok"]
    assert result["invalid"] == []


def test_list_recipes_empty_when_no_sources(data_dir):
    assert recipes.list_recipes()["recipes"] == []


def test_instructions_are_loaded_for_the_wizard(data_dir):
    folder = _make_recipe(data_dir / "recipes", "grafana", "Grafana")
    (folder / "instructions.md").write_text("# Grafana\nLog in with admin/admin.\n")
    recipe = recipes.get_recipe("grafana")
    assert "Log in with admin/admin." in recipe["instructions"]


def test_the_log_link_reaches_the_wizard(data_dir):
    _make_recipe(data_dir / "recipes", "tailscale", "Tailscale", "log_link: https://login.tailscale.com/\n")
    assert recipes.get_recipe("tailscale")["log_link"] == "https://login.tailscale.com/"
    _make_recipe(data_dir / "recipes", "grafana", "Grafana")
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
    _make_recipe(
        data_dir / "recipes",
        "grafana",
        "Grafana",
        'env:\n  - key: PORT\n    label: Host port\n    default: "3000"\n'
        "  - key: PW\n    label: Admin password\n    secret: true\n",
    )
    monkeypatch.setattr(recipes, "_compose_up", lambda d, build: {"ok": True, "output": "Started"})
    # The reinstall check asks Docker which containers exist; never the real daemon here.
    monkeypatch.setattr(recipes.docker_client, "container_names", lambda: set())
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
    recipes.install_recipe("grafana", {"PORT": "3000", "PW": "pa$word1"})
    stack = recipes.stacks.stacks_dir() / "grafana"
    assert (stack / ".env").read_text() == 'PORT="3000"\nPW="pa\\$word1"\n'
    assert (stack / ".env").stat().st_mode & 0o777 == 0o600  # only its owner reads the password
    assert "image: x" in (stack / "compose.yml").read_text()


def test_install_fills_defaults_for_missing_answers(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    recipes.install_recipe("grafana", {})
    env = (recipes.stacks.stacks_dir() / "grafana" / ".env").read_text()
    assert env == 'PORT="3000"\nPW=""\n'


def test_install_refuses_an_undeclared_answer_before_touching_disk(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    with pytest.raises(recipes.RecipeError, match="not declared"):
        recipes.install_recipe("grafana", {"COMPOSE_PROJECT_NAME": "hijacked"})
    assert not (recipes.stacks.stacks_dir() / "grafana").exists()


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
    with pytest.raises(recipes.stacks.StackError, match="already exists"):
        recipes.install_recipe("grafana", {})


# --- Reinstalling: the folder's data and the route record both survive ---


def test_install_reuses_the_folder_a_kept_delete_left(installable, monkeypatch):
    """Delete keeps a stack's data by default; installing it again picks the folder up."""
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    leftover = recipes.stacks.stacks_dir() / "grafana" / "data"
    leftover.mkdir(parents=True)
    (leftover / "grafana.db").write_text("dashboards")

    result = recipes.install_recipe("grafana", {})

    assert result["ok"] and result["reused_data"] is True
    assert (leftover / "grafana.db").read_text() == "dashboards"
    assert (recipes.stacks.stacks_dir() / "grafana" / "compose.yml").is_file()


def test_a_fresh_install_reports_no_reused_data(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    assert recipes.install_recipe("grafana", {})["reused_data"] is False


def test_git_build_needs_an_empty_folder(data_dir, monkeypatch):
    _make_recipe(data_dir / "recipes", "app", "App", 'git_repo: "https://x"\n')
    # _make_recipe writes type: pull; make this one a git_build.
    manifest = data_dir / "recipes" / "app" / "recipe.yml"
    manifest.write_text(manifest.read_text().replace("type: pull", "type: git_build"))
    (recipes.stacks.stacks_dir() / "app" / "data").mkdir(parents=True)
    monkeypatch.setattr(recipes.docker_client, "container_names", lambda: set())

    with pytest.raises(recipes.RecipeError, match="clones into an empty one"):
        recipes.install_recipe("app", {})


def test_reinstall_keeps_the_route_record(installable, monkeypatch):
    """The open Phase 28 bug: a reinstall replaced the record wholesale, wiping its route
    fields while Caddy kept serving the route."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="My dashboards", type="docker", container="grafana-old-1",
        subdomain="graf", upstream="192.168.10.220:3000", private=True, icon="grafana.png",
        follow_container=True,
    ))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    recipes.install_recipe("grafana", {})

    inst = instances_store.get_instance("grafana")
    assert inst.container == "grafana-app-1"  # re-pointed at what exists now
    assert (inst.name, inst.subdomain, inst.upstream) == ("My dashboards", "graf", "192.168.10.220:3000")
    assert inst.private and inst.icon == "grafana.png" and inst.follow_container


def test_a_change_made_during_a_reinstall_s_up_is_kept(installable, monkeypatch):
    """`up` can take minutes; the follower re-points the route, or the user edits it."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="Grafana", type="docker", container="grafana-old-1",
        subdomain="graf", upstream="192.168.10.220:3000", follow_container=True,
    ))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    def up(directory, build):
        instances_store.update_fields("grafana", upstream="192.168.10.220:3001", private=True)
        return {"ok": True, "output": "Started"}

    monkeypatch.setattr(recipes, "_compose_up", up)
    recipes.install_recipe("grafana", {})

    inst = instances_store.get_instance("grafana")
    assert inst.container == "grafana-app-1"
    assert inst.upstream == "192.168.10.220:3001" and inst.private


def test_a_reinstalled_record_with_no_icon_gets_the_recipe_s(installable, monkeypatch):
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(id="grafana", name="Grafana", type="docker", container="grafana-old-1"))
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    recipes.install_recipe("grafana", {})

    assert instances_store.get_instance("grafana").icon


def test_an_id_that_names_an_external_route_is_refused(installable, monkeypatch):
    """A route's id is its prefix — a hand-made route at the recipe's name is not ours."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="grafana", type="external", subdomain="grafana",
        upstream="192.168.10.60:3000",
    ))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    with pytest.raises(recipes.RecipeError, match="already the name of a route"):
        recipes.install_recipe("grafana", {})
    assert not (recipes.stacks.stacks_dir() / "grafana").exists()  # refused before any side effect
    assert instances_store.get_instance("grafana").type == "external"


def test_an_id_linked_to_another_running_container_is_refused(installable, monkeypatch):
    """A route to a hand-run container named for the same app — still running — is not
    this recipe's earlier install."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="grafana", type="docker", container="grafana", subdomain="grafana",
    ))
    monkeypatch.setattr(recipes.docker_client, "container_names", lambda: {"grafana"})
    _fake_project(monkeypatch, [])

    with pytest.raises(recipes.RecipeError, match="route to container 'grafana'"):
        recipes.install_recipe("grafana", {})
    assert instances_store.get_instance("grafana").container == "grafana"


# --- mounts: the folders the user adds at install, however many they have ---

MEDIA = "mounts:\n  label: Media folders\n  target: /media\n"


@pytest.mark.parametrize(
    "mounts,problem",
    [
        ("folders", "must be a mapping"),
        ({"target": "/media"}, "needs a 'label'"),
        ({"label": "Media"}, "absolute container path"),
        ({"label": "Media", "target": "media"}, "absolute container path"),
        ({"label": "Media", "target": "/"}, "absolute container path"),
        ({"label": "Media", "target": "/a:b"}, "absolute container path"),
        ({"label": "Media", "target": "/media", "read_only": "yes"}, "true or false"),
    ],
)
def test_mounts_block_is_validated(mounts, problem):
    errors = recipes.validate_manifest({"name": "X", "type": "pull", "mounts": mounts})
    assert any(problem in e for e in errors), errors


def test_mounts_go_into_the_only_service_read_only_by_default(data_dir):
    _make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", MEDIA)
    mounts = recipes.get_recipe("jellyfin")["mounts"]
    assert mounts == {"label": "Media folders", "target": "/media", "read_only": True, "service": "app"}


def test_mounts_in_a_multi_service_recipe_need_its_service(data_dir):
    folder = _make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", MEDIA)
    (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n  db:\n    image: y\n")
    result = recipes.list_recipes()
    assert any("needs 'service'" in i["error"] for i in result["invalid"])


def test_mounts_service_must_be_in_the_compose_file(data_dir):
    _make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", MEDIA + "service: web\n")
    result = recipes.list_recipes()
    assert any("'service: web' is not a service" in i["error"] for i in result["invalid"])


MEDIA_SPEC = {"label": "Media folders", "target": "/media", "read_only": True, "service": "app"}


def test_each_folder_lands_under_the_target_by_its_own_name():
    folders = ["/srv/scloud/media/anime", "/srv/scloud/media/movies/", "./music"]
    assert recipes.resolve_mounts(MEDIA_SPEC, folders) == [
        ("/srv/scloud/media/anime", "/media/anime"),
        ("/srv/scloud/media/movies/", "/media/movies"),
        ("./music", "/media/music"),
    ]


def test_two_folders_with_one_name_are_refused():
    with pytest.raises(recipes.RecipeError, match="would both land at /media/anime"):
        recipes.resolve_mounts(MEDIA_SPEC, ["/disk1/anime", "/disk2/anime"])


@pytest.mark.parametrize(
    "folder,reason",
    [
        ("~/anime", "container's home"),
        ("anime", "is a Docker volume"),
        ("", "a folder is empty"),
        ("/", "no folder name"),
    ],
)
def test_a_bad_folder_is_refused_with_the_reason(folder, reason):
    with pytest.raises(recipes.RecipeError, match=reason):
        recipes.resolve_mounts(MEDIA_SPEC, [folder])


def test_folders_for_a_recipe_without_mounts_are_refused():
    with pytest.raises(recipes.RecipeError, match="takes no extra folders"):
        recipes.resolve_mounts(None, ["/srv/media"])
    assert recipes.resolve_mounts(None, []) == []


def test_override_is_long_syntax_that_never_creates_a_folder():
    """The short form has Docker create a mistyped folder, empty and root-owned, and the
    install succeeds with an empty library. `create_host_path: false` fails it instead."""
    import yaml

    text = override.render_override("app", [("/srv/my$stuff", "/media/my$stuff")], True)
    volume = yaml.safe_load(text)["services"]["app"]["volumes"][0]
    assert volume == {
        "type": "bind",
        # Compose interpolates the override too: `$$` is a literal `$`.
        "source": "/srv/my$$stuff",
        "target": "/media/my$$stuff",
        "read_only": True,
        "bind": {"create_host_path": False},
    }


@pytest.fixture
def jellyfin(installable, monkeypatch):
    _make_recipe(installable / "recipes", "jellyfin", "Jellyfin", MEDIA)
    _fake_project(monkeypatch, [_c("app", "jellyfin-app-1")])
    return recipes.stacks.stacks_dir() / "jellyfin"


def test_install_writes_the_folders_into_an_override(jellyfin):
    import yaml

    recipes.install_recipe("jellyfin", {}, ["/srv/media/anime", "/srv/media/music"])

    volumes = yaml.safe_load((jellyfin / "compose.override.yml").read_text())["services"]["app"]["volumes"]
    assert [(v["source"], v["target"]) for v in volumes] == [
        ("/srv/media/anime", "/media/anime"),
        ("/srv/media/music", "/media/music"),
    ]
    # The recipe's own compose file is copied untouched.
    assert (jellyfin / "compose.yml").read_text() == "services:\n  app:\n    image: x\n"


def test_install_without_folders_writes_no_override(jellyfin):
    recipes.install_recipe("jellyfin", {})
    assert not (jellyfin / "compose.override.yml").exists()


def test_a_bad_folder_fails_before_touching_disk(jellyfin):
    with pytest.raises(recipes.RecipeError, match="is a Docker volume"):
        recipes.install_recipe("jellyfin", {}, ["anime"])
    assert not jellyfin.exists()


# --- options: features switched on in the form or the wizard ---

GPU = (
    "options:\n  - id: hwaccel\n    label: Hardware transcoding\n    help: Needs /dev/dri\n"
    "    set:\n      devices:\n        - /dev/dri:/dev/dri\n"
)
HWACCEL = {
    "id": "hwaccel", "label": "Hardware transcoding", "help": "Needs /dev/dri", "service": "app",
    "set": {"devices": ["/dev/dri:/dev/dri"]},
}


@pytest.mark.parametrize(
    "options,problem",
    [
        ("gpu", "must be a list"),
        ([{"label": "GPU", "set": {"devices": ["/dev/dri"]}}], "needs an 'id'"),
        ([{"id": "GPU!", "label": "GPU", "set": {"devices": ["/dev/dri"]}}], "needs an 'id'"),
        ([{"id": "gpu", "set": {"devices": ["/dev/dri"]}}], "needs a 'label'"),
        ([{"id": "gpu", "label": "GPU"}], "needs 'set'"),
        ([{"id": "gpu", "label": "GPU", "set": {"image": ["evil"]}}], "can't set 'image'"),
        ([{"id": "gpu", "label": "GPU", "set": {"volumes": ["/:/host"]}}], "can't set 'volumes'"),
        ([{"id": "gpu", "label": "GPU", "set": {"devices": "/dev/dri"}}], "must be a list"),
        (
            [{"id": "gpu", "label": "A", "set": {"devices": ["/a"]}}, {"id": "gpu", "label": "B", "set": {"devices": ["/b"]}}],
            "used twice",
        ),
    ],
)
def test_options_are_validated(options, problem):
    errors = recipes.validate_manifest({"name": "X", "type": "pull", "options": options})
    assert any(problem in e for e in errors), errors


def test_an_option_goes_into_the_only_service(data_dir):
    _make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", GPU)
    assert recipes.get_recipe("jellyfin")["options"] == [HWACCEL]


def test_an_option_in_a_multi_service_recipe_needs_its_service(data_dir):
    folder = _make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", GPU)
    (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n  db:\n    image: y\n")
    assert any("options[0] needs 'service'" in i["error"] for i in recipes.list_recipes()["invalid"])


def test_switching_an_option_adds_and_removes_exactly_its_lines():
    import yaml

    base = "services:\n  app:\n    devices:\n      - /dev/ttyUSB0:/dev/ttyUSB0\n"
    on = override.set_options(base, [HWACCEL], {"hwaccel": True})
    assert yaml.safe_load(on)["services"]["app"]["devices"] == ["/dev/ttyUSB0:/dev/ttyUSB0", "/dev/dri:/dev/dri"]
    assert override.option_on(on, HWACCEL) and not override.option_on(base, HWACCEL)
    # On twice is still once.
    assert override.set_options(on, [HWACCEL], {"hwaccel": True}) == on
    off = override.set_options(on, [HWACCEL], {"hwaccel": False})
    assert yaml.safe_load(off)["services"]["app"]["devices"] == ["/dev/ttyUSB0:/dev/ttyUSB0"]
    # Off with nothing else left: no override at all.
    assert override.set_options(override.set_options("", [HWACCEL], {"hwaccel": True}), [HWACCEL], {"hwaccel": False}) == ""


def test_an_option_for_an_empty_service_entry_is_added():
    on = override.set_options("services:\n  app:\n", [HWACCEL], {"hwaccel": True})
    assert override.option_on(on, HWACCEL)


@pytest.mark.parametrize("entry", ["[]", '""'])
def test_an_option_never_replaces_a_service_entry_that_isnt_a_mapping(entry):
    with pytest.raises(override.OverrideError, match="isn't a mapping"):
        override.set_options(f"services:\n  app: {entry}\n", [HWACCEL], {"hwaccel": True})


def test_a_hand_pasted_snippet_reads_as_on():
    pasted = "services:\n  app:\n    devices:\n    - /dev/dri:/dev/dri\n"
    assert override.option_on(pasted, HWACCEL)


def test_an_override_the_option_cant_switch_is_said():
    weird = "services:\n  app:\n    devices: /dev/dri\n"
    with pytest.raises(override.OverrideError, match="isn't a list"):
        override.set_options(weird, [HWACCEL], {"hwaccel": True})


NVIDIA = {
    "id": "nvidia", "label": "NVIDIA", "help": None, "service": "app",
    "set": {"deploy": {"resources": {"reservations": {"devices": [
        {"driver": "nvidia", "count": "all", "capabilities": ["gpu"]}
    ]}}}},
}


def test_a_gpu_reservation_is_added_and_removed_inside_what_is_there():
    import yaml

    base = "services:\n  app:\n    deploy:\n      resources:\n        limits:\n          memory: 4g\n"
    on = override.set_options(base, [NVIDIA], {"nvidia": True})
    deploy = yaml.safe_load(on)["services"]["app"]["deploy"]
    assert deploy["resources"]["limits"] == {"memory": "4g"}
    assert deploy["resources"]["reservations"]["devices"][0]["driver"] == "nvidia"
    assert override.option_on(on, NVIDIA)
    off = override.set_options(on, [NVIDIA], {"nvidia": False})
    assert yaml.safe_load(off)["services"]["app"]["deploy"] == {"resources": {"limits": {"memory": "4g"}}}
    assert override.set_options(override.set_options("", [NVIDIA], {"nvidia": True}), [NVIDIA], {"nvidia": False}) == ""


def test_an_option_never_overwrites_a_value_set_otherwise():
    clash = {**NVIDIA, "set": {"deploy": {"replicas": 1}}}
    with pytest.raises(override.OverrideError, match="is already 3"):
        override.set_options("services:\n  app:\n    deploy:\n      replicas: 3\n", [clash], {"nvidia": True})


def test_a_port_reads_the_same_as_a_number_or_text():
    dlna = {"id": "dlna", "label": "DLNA", "help": None, "service": "app", "set": {"ports": ["1900:1900/udp", 7359]}}
    assert override.option_on("services:\n  app:\n    ports:\n    - 1900:1900/udp\n    - '7359'\n", dlna)


def test_deploy_must_be_a_mapping():
    errors = recipes.validate_manifest(
        {"name": "X", "type": "pull", "options": [{"id": "gpu", "label": "GPU", "set": {"deploy": ["nvidia"]}}]}
    )
    assert any("'deploy' must be a mapping" in e for e in errors), errors


@pytest.fixture
def gpu_recipe(installable, monkeypatch):
    _make_recipe(installable / "recipes", "jellyfin", "Jellyfin", MEDIA + GPU)
    _fake_project(monkeypatch, [_c("app", "jellyfin-app-1")])
    return recipes.stacks.stacks_dir() / "jellyfin"


def test_install_writes_the_chosen_options_beside_the_folders(gpu_recipe):
    import yaml

    recipes.install_recipe("jellyfin", {}, ["/srv/media/anime"], ["hwaccel"])
    svc = yaml.safe_load((gpu_recipe / "compose.override.yml").read_text())["services"]["app"]
    assert svc["devices"] == ["/dev/dri:/dev/dri"]
    assert [v["target"] for v in svc["volumes"]] == ["/media/anime"]


def test_install_with_an_option_and_no_folders_still_writes_it(gpu_recipe):
    recipes.install_recipe("jellyfin", {}, [], ["hwaccel"])
    assert override.option_on((gpu_recipe / "compose.override.yml").read_text(), HWACCEL)


def test_an_unknown_option_fails_before_touching_disk(gpu_recipe):
    with pytest.raises(recipes.RecipeError, match="no option nvidia"):
        recipes.install_recipe("jellyfin", {}, [], ["nvidia"])
    assert not gpu_recipe.exists()


# --- Icon: an optional icon.png, applied to the route record at install ---

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_a_recipe_with_an_icon_says_so(installable):
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)

    listed = {r["id"]: r for r in recipes.list_recipes()["recipes"]}
    assert listed["grafana"]["icon"] is True
    assert recipes.icon_path("grafana").read_bytes() == PNG


def test_a_recipe_without_an_icon_has_none(installable):
    assert recipes.get_recipe("grafana")["icon"] is False
    with pytest.raises(recipes.RecipeError):
        recipes.icon_path("grafana")


@pytest.mark.parametrize(
    "data,reason",
    [
        (b"\xff\xd8\xff" + b"\x00" * 32, "not a PNG"),  # a JPEG named .png
        (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "unsupported image"),
        (PNG + b"\x00" * (512 * 1024), "larger than"),
    ],
)
def test_a_bad_icon_skips_the_recipe_with_the_reason(installable, data, reason):
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(data)

    skipped = {r["id"]: r["error"] for r in recipes.list_recipes()["invalid"]}
    assert reason in skipped["grafana"]


def test_install_gives_the_route_the_recipe_icon(installable, monkeypatch):
    from loskai.shared import icons

    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    recipes.install_recipe("grafana", {})

    inst = instances_store.get_instance("grafana")
    assert inst.icon == "grafana.png"
    assert icons.path_for(inst.icon).read_bytes() == PNG


def _routed(container="grafana-app-1"):
    from loskai.shared.instances import Instance

    return Instance(id="graf", name="graf", type="docker", container=container)


def _ran_in(monkeypatch, folder, project="grafana"):
    """The labels compose gives a container it started from `folder`."""
    labels = {"com.docker.compose.project": project, "com.docker.compose.project.working_dir": str(folder)}
    monkeypatch.setattr(recipes.docker_client, "labels_of", lambda name: labels)


def test_a_new_route_for_an_installed_recipe_gets_its_icon(installable, monkeypatch):
    """The install's record was deleted (its route removed), so a route added later makes a
    new one — which should get the icon the install gave."""
    from loskai.shared import icons

    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    recipes.install_recipe("grafana", {})
    instances_store.delete_instance("grafana")
    _ran_in(monkeypatch, recipes.stacks.stacks_dir() / "grafana")

    inst = recipes.recipe_icon(_routed())
    assert inst.icon == "graf.png"
    assert icons.path_for(inst.icon).read_bytes() == PNG


def _moved_in(installable, name="grafana"):
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    stack = recipes.stacks.stacks_dir() / name
    stack.mkdir(parents=True)
    (stack / "compose.yml").write_text("services: {}\n")
    return stack


def test_a_stack_moved_in_by_hand_gets_its_recipes_icon_by_name(installable, monkeypatch):
    _ran_in(monkeypatch, _moved_in(installable))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    assert recipes.recipe_icon(_routed()).icon == "graf.png"


def test_the_stack_is_found_by_its_folder_not_its_project_name(installable, monkeypatch):
    """Compose lowercases the folder name and drops a dot to make the project name."""
    stack = _moved_in(installable, "Graf.Ana")
    (stack / recipes.stacks.RECORD_NAME).write_text('{"recipe": "grafana"}')
    _ran_in(monkeypatch, stack, project="grafana")
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    assert recipes.recipe_icon(_routed()).icon == "graf.png"


def test_only_the_recipes_own_container_gets_its_icon(installable, monkeypatch):
    _ran_in(monkeypatch, _moved_in(installable))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1", published=True), _c("db", "grafana-db-1")])
    assert recipes.recipe_icon(_routed("grafana-app-1")).icon == "graf.png"
    assert recipes.recipe_icon(_routed("grafana-db-1")).icon is None


@pytest.mark.parametrize(
    "labels_of",
    [
        # Run from a same-named folder outside the stacks folder.
        lambda name: {"com.docker.compose.project": "grafana", "com.docker.compose.project.working_dir": "/home/me/grafana"},
        lambda name: {},  # started without compose
        lambda name: (_ for _ in ()).throw(OSError("no socket")),  # Docker unreachable
    ],
)
def test_no_icon_for_a_container_outside_a_recipe_stack(installable, monkeypatch, labels_of):
    _moved_in(installable)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    monkeypatch.setattr(recipes.docker_client, "labels_of", labels_of)
    assert recipes.recipe_icon(_routed()).icon is None


def test_reinstall_never_replaces_an_icon_chosen_by_hand(installable, monkeypatch):
    from loskai.shared import icons
    from loskai.shared.instances import Instance

    mine = b"\x89PNG\r\n\x1a\n" + b"\x01" * 64
    icons.save("grafana", mine)
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container="grafana-old-1", icon="grafana.png")
    )
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    recipes.install_recipe("grafana", {})

    assert icons.path_for(instances_store.get_instance("grafana").icon).read_bytes() == mine
