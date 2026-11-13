"""Tier-1: Check for updates — where an installed compose.yml stands against its recipe's,
what an update would change, and that applying one replaces only the recipe's file."""

import subprocess

import pytest

from loskai.modules.docker import install, recipes, stacks, updates
from loskai.modules.docker.manifest import RecipeError
from loskai.shared import settings as settings_store

V1 = "services:\n  app:\n    image: grafana/grafana:11.0\n"
V2 = "services:\n  app:\n    image: grafana/grafana:12.0\n"
ENV_SPEC = 'env:\n  - key: PORT\n    label: Host port\n    default: "3000"\n'


# --- Pure ---


def test_status_tells_the_recipe_moving_on_from_a_hand_edit():
    installed = install.fingerprint(V1)
    assert updates.status(V1, V1, installed) == "current"
    assert updates.status(V1, V2, installed) == "available"
    edited = V1 + "    restart: always\n"
    assert updates.status(edited, V2, installed) == "edited"
    # The recipe hasn't moved: the difference is the user's own, not an update.
    assert updates.status(edited, V1, installed) == "current"
    # Installed before records were kept.
    assert updates.status(V1, V2, None) == "untracked"
    assert updates.status(V1, V1, None) == "current"


def test_image_changes_are_the_headline():
    assert updates.image_changes(V1, V2) == [
        {"service": "app", "from": "grafana/grafana:11.0", "to": "grafana/grafana:12.0"}
    ]
    assert updates.image_changes(V1, V1 + "    restart: always\n") == []
    added = V2 + "  db:\n    image: postgres:16\n"
    assert {"service": "db", "from": None, "to": "postgres:16"} in updates.image_changes(V1, added)


def test_the_diff_shows_both_sides():
    diff = updates.compose_diff(V1, V2)
    assert "-    image: grafana/grafana:11.0\n" in diff
    assert "+    image: grafana/grafana:12.0\n" in diff


def test_new_questions_are_only_those_the_env_has_no_line_for():
    spec = [
        {"key": "PORT", "label": "Port", "default": "3000"},
        {"key": "TZ", "label": "Time zone", "default": "Europe/Oslo"},
        {"key": "TOKEN", "label": "API token"},
    ]
    defaults, unanswered = updates.new_questions(spec, 'PORT="8080"\n')
    assert defaults == {"TZ": "Europe/Oslo"}
    assert unanswered == ["TOKEN"]


def test_a_commit_body_loses_its_trailers_but_keeps_the_rest():
    body = "12.2 fixes two migrations.\n\nCo-Authored-By: A <a@b>\nSigned-off-by: B <b@c>\n"
    assert updates.strip_trailers(body) == "12.2 fixes two migrations."
    assert updates.strip_trailers("Note: read this first.\n\nMore.") == "Note: read this first.\n\nMore."
    log = "abcdef1234\x1f2026-10-18\x1fJellyfin 12.2\x1fWhy.\n\nCo-Authored-By: A <a@b>\n\x1e\n"
    assert updates.parse_log(log) == [
        {"commit": "abcdef1", "date": "2026-10-18", "subject": "Jellyfin 12.2", "body": "Why."}
    ]


# --- Installed stacks ---


@pytest.fixture
def installed(tmp_path, monkeypatch):
    """A local recipe, installed — compose runs stubbed and recorded."""
    data = tmp_path / "data"
    folder = data / "recipes" / "grafana"
    folder.mkdir(parents=True)
    (folder / "recipe.yml").write_text(f"name: Grafana\ntype: pull\n{ENV_SPEC}")
    (folder / "compose.yml").write_text(V1)
    runs = []

    def run(directory, *args):
        runs.append(args)
        return {"ok": True, "output": " ".join(args)}

    monkeypatch.setattr(stacks, "run_compose", run)
    monkeypatch.setattr(install.docker_client, "container_names", lambda: set())
    monkeypatch.setattr(install.docker_client, "containers_in_project", lambda project: [])
    install.install_recipe("grafana", {"PORT": "8080"})
    return {"recipe": folder, "stack": stacks.stacks_dir() / "grafana", "runs": runs}


def test_install_records_the_recipe_and_its_compose(installed):
    record = install.read_record(installed["stack"])
    assert record == {"recipe": "grafana", "source": None, "commit": None, "compose": install.fingerprint(V1)}


def test_a_recipe_unchanged_since_install_is_current(installed):
    [entry] = updates.list_updates()
    assert (entry["stack"], entry["status"], entry["updatable"], entry["diff"]) == ("grafana", "current", False, "")


def test_a_recipe_that_moved_on_offers_its_update(installed):
    (installed["recipe"] / "compose.yml").write_text(V2)
    [entry] = updates.list_updates()
    assert entry["status"] == "available" and entry["updatable"]
    assert entry["images"] == [{"service": "app", "from": "grafana/grafana:11.0", "to": "grafana/grafana:12.0"}]
    assert "+    image: grafana/grafana:12.0" in entry["diff"]


def test_a_hand_edit_is_said_before_it_is_replaced(installed):
    (installed["recipe"] / "compose.yml").write_text(V2)
    (installed["stack"] / "compose.yml").write_text(V1 + "    restart: always\n")
    [entry] = updates.list_updates()
    assert entry["status"] == "edited" and entry["updatable"]


def test_a_stack_from_before_records_is_found_by_its_name(installed):
    (installed["stack"] / stacks.RECORD_NAME).unlink()
    (installed["recipe"] / "compose.yml").write_text(V2)
    [entry] = updates.list_updates()
    assert entry["status"] == "untracked" and entry["updatable"]


def test_a_stack_no_recipe_names_is_not_listed(installed):
    other = stacks.stacks_dir() / "mine"
    other.mkdir()
    (other / "compose.yml").write_text(V1)
    assert [e["stack"] for e in updates.list_updates()] == ["grafana"]


def test_a_recipe_no_source_has_any_more_is_gone(installed):
    for f in installed["recipe"].iterdir():
        f.unlink()
    installed["recipe"].rmdir()
    [entry] = updates.list_updates()
    assert entry["status"] == "gone" and not entry["updatable"]


def test_an_update_replaces_only_the_recipes_file(installed):
    stack = installed["stack"]
    override = "services:\n  app:\n    volumes:\n      - /srv/x:/x\n"
    (stack / "compose.override.yml").write_text(override)
    (installed["recipe"] / "recipe.yml").write_text(
        f"name: Grafana\ntype: pull\n{ENV_SPEC}  - key: TZ\n    label: Time zone\n    default: Europe/Oslo\n"
    )
    (installed["recipe"] / "compose.yml").write_text(V2)
    installed["runs"].clear()

    updates.apply_update("grafana")

    assert (stack / "compose.yml").read_text() == V2
    assert (stack / "compose.override.yml").read_text() == override
    # The answer given at install stays exactly as written; the new question gets its default.
    assert (stack / ".env").read_text() == 'PORT="8080"\nTZ="Europe/Oslo"\n'
    assert (stack / ".env").stat().st_mode & 0o777 == 0o600
    assert install.read_record(stack)["compose"] == install.fingerprint(V2)
    assert not (stack / ".compose.next.yml").exists()
    # Checked with the user's override before anything was written, then pulled and upped.
    assert installed["runs"][0] == ("-f", ".compose.next.yml", "-f", "compose.override.yml", "config", "--quiet")
    assert installed["runs"][1:] == [("pull",), ("up", "-d")]
    [entry] = updates.list_updates()
    assert entry["status"] == "current"


def test_an_update_the_users_files_cant_run_with_writes_nothing(installed, monkeypatch):
    (installed["recipe"] / "compose.yml").write_text(V2)
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": False, "output": "service 'app' has no image"})
    with pytest.raises(RecipeError, match="doesn't load with this stack's files: service 'app'"):
        updates.apply_update("grafana")
    assert (installed["stack"] / "compose.yml").read_text() == V1
    assert not (installed["stack"] / ".compose.next.yml").exists()


def test_a_new_question_without_a_default_needs_a_reinstall(installed):
    (installed["recipe"] / "recipe.yml").write_text(
        f"name: Grafana\ntype: pull\n{ENV_SPEC}  - key: TOKEN\n    label: API token\n"
    )
    (installed["recipe"] / "compose.yml").write_text(V2)
    [entry] = updates.list_updates()
    assert not entry["updatable"] and "asks for TOKEN" in entry["reason"]
    with pytest.raises(RecipeError, match="asks for TOKEN"):
        updates.apply_update("grafana")


def test_nothing_to_update_is_refused(installed):
    with pytest.raises(RecipeError, match="already up to date"):
        updates.apply_update("grafana")


# --- A git source: the commits since the install ---


def _git(cwd, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(cwd), *args],
        check=True, capture_output=True,
    )


def test_a_git_sources_commits_since_the_install_are_listed(tmp_path, monkeypatch):
    url = "https://git.example/recipes.git"
    settings_store.update({"recipes_repos": [{"url": url, "enabled": True}]})
    cache = tmp_path / "data" / "recipes-cache" / recipes.source_slug(url)
    (cache / "grafana").mkdir(parents=True)
    (cache / "grafana" / "recipe.yml").write_text("name: Grafana\ntype: pull\n")
    (cache / "grafana" / "compose.yml").write_text(V1)
    (cache / "other").mkdir()
    (cache / "other" / "recipe.yml").write_text("name: Other\ntype: pull\n")
    (cache / "other" / "compose.yml").write_text(V1)
    _git(cache, "init", "-q")
    _git(cache, "add", ".")
    _git(cache, "commit", "-qm", "First")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})
    monkeypatch.setattr(install.docker_client, "container_names", lambda: set())
    monkeypatch.setattr(install.docker_client, "containers_in_project", lambda project: [])
    install.install_recipe("grafana", {})

    (cache / "grafana" / "compose.yml").write_text(V2)
    _git(cache, "commit", "-qam", "Grafana 12.0\n\nDashboards migrate on first start.\n\nCo-Authored-By: A <a@b>")
    (cache / "other" / "compose.yml").write_text(V2)
    _git(cache, "commit", "-qam", "Other 12.0")  # another recipe's change: not this one's

    [entry] = updates.list_updates()
    assert [(c["subject"], c["body"]) for c in entry["commits"]] == [("Grafana 12.0", "Dashboards migrate on first start.")]
