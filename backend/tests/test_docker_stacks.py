"""Tier-1: stack manager filesystem logic (docker/compose I/O mocked out)."""

import pytest

from loskai import config
from loskai.modules.docker import stacks
from loskai.modules.docker.stacks import StackError

COMPOSE = "services:\n  app:\n    image: nginx\n"


@pytest.fixture
def stacks_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "stacks_dir", str(tmp_path))
    # Default: no compose I/O (daemon absent) -> status unknown.
    monkeypatch.setattr(stacks.docker_client, "compose_dirs", dict)
    return tmp_path


def _make_stack(base, name, compose=COMPOSE, env=None):
    d = base / name
    d.mkdir()
    (d / "compose.yml").write_text(compose)
    if env is not None:
        (d / ".env").write_text(env)
    return d


def test_stacks_dir_ok(stacks_dir, monkeypatch):
    assert stacks.stacks_dir_ok() is True
    monkeypatch.setattr(config.settings, "stacks_dir", str(stacks_dir / "nope"))
    assert stacks.stacks_dir_ok() is False


def test_list_stacks_empty(stacks_dir):
    assert stacks.list_stacks() == []


def test_list_stacks_computes_status(stacks_dir, monkeypatch):
    _make_stack(stacks_dir, "web", "services:\n  app:\n    image: nginx\n")
    _make_stack(stacks_dir, "db", "services:\n  db:\n    image: postgres\n")
    monkeypatch.setattr(
        stacks.docker_client, "compose_dirs",
        lambda: {str(stacks_dir / "web"): {"project": "web", "running": {"app"}}},
    )

    by_name = {s["name"]: s for s in stacks.list_stacks()}
    assert by_name["web"]["status"] == "up"
    assert by_name["db"]["status"] == "down"
    assert by_name["web"]["services"] == ["app"]
    assert by_name["web"]["project"] == "web"
    assert by_name["db"]["project"] is None


def test_a_stack_is_matched_by_its_folder_not_its_name(stacks_dir, monkeypatch):
    """Compose lowercases the folder's name and drops its dots: `My.App`'s project is
    `myapp`, and a same-named project run from somewhere else is not this stack."""
    _make_stack(stacks_dir, "My.App")
    _make_stack(stacks_dir, "web")
    monkeypatch.setattr(stacks.docker_client, "compose_dirs", lambda: {
        str(stacks_dir / "My.App"): {"project": "myapp", "running": {"app"}},
        "/home/me/web": {"project": "web", "running": {"app"}},
    })

    by_name = {s["name"]: s for s in stacks.list_stacks()}
    assert (by_name["My.App"]["status"], by_name["My.App"]["project"]) == ("up", "myapp")
    assert (by_name["web"]["status"], by_name["web"]["project"]) == ("down", None)
    assert stacks.get_stack("My.App")["status"] == "up"


def test_list_stacks_status_unknown_when_daemon_down(stacks_dir, monkeypatch):
    _make_stack(stacks_dir, "web")

    def boom():
        raise stacks.DOCKER_ERRORS[0]("down")

    monkeypatch.setattr(stacks.docker_client, "compose_dirs", boom)
    assert stacks.list_stacks()[0]["status"] == "unknown"


def test_list_ignores_dirs_without_compose(stacks_dir):
    (stacks_dir / "not-a-stack").mkdir()
    assert stacks.list_stacks() == []


def test_get_stack_reads_files(stacks_dir):
    _make_stack(stacks_dir, "web", COMPOSE, env="PORT=8080\n")
    got = stacks.get_stack("web")
    assert got["compose"] == COMPOSE
    assert got["env"] == "PORT=8080\n"
    assert got["services"] == ["app"]


def test_get_missing_stack_raises(stacks_dir):
    with pytest.raises(StackError):
        stacks.get_stack("ghost")


def test_create_stack_writes_files(stacks_dir, monkeypatch):
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": "up"})
    stacks.create_stack("new", COMPOSE, "SECRET=x\n")
    assert (stacks_dir / "new" / "compose.yml").read_text() == COMPOSE
    assert (stacks_dir / "new" / ".env").read_text() == "SECRET=x\n"
    assert (stacks_dir / "new" / ".env").stat().st_mode & 0o777 == 0o600  # it holds passwords


def test_create_refuses_when_dir_missing(stacks_dir, monkeypatch):
    monkeypatch.setattr(config.settings, "stacks_dir", str(stacks_dir / "unmounted"))
    with pytest.raises(StackError, match="stacks directory not found"):
        stacks.create_stack("x", COMPOSE)


def test_update_stack_file_guards_filename(stacks_dir):
    _make_stack(stacks_dir, "web")
    with pytest.raises(StackError):
        stacks.update_stack_file("web", "evil.sh", "rm -rf /")
    stacks.update_stack_file("web", ".env", "K=V\n")
    assert (stacks_dir / "web" / ".env").read_text() == "K=V\n"


def test_saving_an_env_makes_it_owner_only(stacks_dir):
    # A .env written by an older Loskai, or by hand, was world-readable; saving it fixes that.
    d = _make_stack(stacks_dir, "web", env="PW=old\n")
    (d / ".env").chmod(0o644)
    stacks.update_stack_file("web", ".env", "PW=new\n")
    assert (d / ".env").stat().st_mode & 0o777 == 0o600


def test_the_override_can_be_edited(stacks_dir):
    d = _make_stack(stacks_dir, "media")
    ov = "services:\n  app:\n    volumes:\n      - /srv/films:/media/films\n"
    stacks.update_stack_file("media", "compose.override.yml", ov)
    assert (d / "compose.override.yml").read_text() == ov
    assert stacks.get_stack("media")["override"] == ov


def test_emptying_the_override_removes_it(stacks_dir):
    d = _make_stack(stacks_dir, "media")
    (d / "compose.override.yml").write_text("services: {}\n")
    stacks.update_stack_file("media", "compose.override.yml", "  \n")
    assert not (d / "compose.override.yml").exists()
    stacks.update_stack_file("media", "compose.override.yml", "")  # none there: still fine


def test_edits_go_to_the_files_the_stack_already_has(stacks_dir):
    # A migrated stack keeps docker-compose.yml; a second compose.yml beside it would
    # quietly become the one Compose reads.
    d = stacks_dir / "old"
    d.mkdir()
    (d / "docker-compose.yml").write_text(COMPOSE)
    (d / "docker-compose.override.yml").write_text("services: {}\n")
    stacks.update_stack_file("old", "compose.yml", COMPOSE + "# edited\n")
    stacks.update_stack_file("old", "compose.override.yml", "services: {app: {}}\n")
    assert sorted(p.name for p in d.iterdir()) == ["docker-compose.override.yml", "docker-compose.yml"]
    assert (d / "docker-compose.yml").read_text().endswith("# edited\n")


def test_yaml_that_wont_load_is_refused_with_its_line_and_nothing_written(stacks_dir):
    d = _make_stack(stacks_dir, "web")
    with pytest.raises(StackError, match=r"^compose\.yml line 3: indented with a tab"):
        stacks.update_stack_file("web", "compose.yml", "services:\n  app:\n\timage: x\n")
    with pytest.raises(StackError, match=r"^compose\.override\.yml line 2: mapping values"):
        stacks.update_stack_file("web", "compose.override.yml", "services:\n  app: image: x\n")
    assert (d / "compose.yml").read_text() == COMPOSE
    assert not (d / "compose.override.yml").exists()


def test_create_refuses_yaml_that_wont_load(stacks_dir, monkeypatch):
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": "up"})
    with pytest.raises(StackError, match="compose.yml line"):
        stacks.create_stack("new", "services:\n\tapp:\n")
    assert not (stacks_dir / "new").exists()


def test_delete_stack_removes_dir(stacks_dir, monkeypatch):
    _make_stack(stacks_dir, "web")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})
    stacks.delete_stack("web")
    assert not (stacks_dir / "web").exists()


def _with_data(base, name):
    d = _make_stack(base, name, env="PORT=1\n")
    (d / "data").mkdir()
    (d / "data" / "app.db").write_text("rows")
    return d


def test_delete_keeps_the_data_by_default(stacks_dir, monkeypatch):
    """Recipes keep data beside the compose file; Delete must not take it with it."""
    d = _with_data(stacks_dir, "web")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})

    result = stacks.delete_stack("web")

    assert result["kept"] == ["data/"]
    assert (d / "data" / "app.db").read_text() == "rows"
    assert not (d / "compose.yml").exists() and not (d / ".env").exists()
    # No compose file, so no longer a stack — the data just waits in its folder.
    assert stacks.list_stacks() == []


def test_delete_removes_the_override_but_keeps_the_data(stacks_dir, monkeypatch):
    """The override is config (the folders added at install), not data — and a kept one
    would come back to mount the old folders on the next install."""
    d = _with_data(stacks_dir, "web")
    (d / "compose.override.yml").write_text("services: {}\n")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})

    assert stacks.delete_stack("web")["kept"] == ["data/"]
    assert not (d / "compose.override.yml").exists()


def test_get_stack_shows_the_override(stacks_dir):
    d = _make_stack(stacks_dir, "web", COMPOSE)
    assert stacks.get_stack("web")["override"] is None
    (d / "compose.override.yml").write_text("services: {}\n")
    got = stacks.get_stack("web")
    assert got["override"] == "services: {}\n" and got["override_file"] == "compose.override.yml"


def test_delete_with_data_removes_the_folder(stacks_dir, monkeypatch):
    _with_data(stacks_dir, "web")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})

    assert stacks.delete_stack("web", delete_data=True)["kept"] == []
    assert not (stacks_dir / "web").exists()


def test_data_loskai_cannot_delete_is_removed_through_the_daemon(stacks_dir, monkeypatch):
    # A database writes its files as its own user; Loskai, not root, can't remove them.
    d = _with_data(stacks_dir, "web")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})
    real_rmtree = stacks.shutil.rmtree

    def denied(path):
        raise PermissionError(13, "Permission denied")

    def clear(path):
        cleared.append(path)
        for child in d.iterdir():
            real_rmtree(child) if child.is_dir() else child.unlink()

    cleared = []
    monkeypatch.setattr(stacks.shutil, "rmtree", denied)
    monkeypatch.setattr(stacks.docker_client, "clear_folder", clear)

    assert stacks.delete_stack("web", delete_data=True)["kept"] == []
    assert cleared == [str(d)]
    assert not d.exists()


def test_delete_always_stops_the_stack_first(stacks_dir, monkeypatch):
    _with_data(stacks_dir, "web")
    ran = []
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: ran.append(a) or {"ok": True, "output": ""})

    stacks.delete_stack("web")

    assert ran == [("down",)]  # never `down -v`: named volumes survive too


def test_the_stack_list_says_what_else_a_folder_holds(stacks_dir):
    _with_data(stacks_dir, "web")
    _make_stack(stacks_dir, "bare")

    assert {s["name"]: s["data"] for s in stacks.list_stacks()} == {"bare": [], "web": ["data/"]}


def test_a_file_beside_the_compose_file_is_named_without_a_slash(stacks_dir):
    d = _with_data(stacks_dir, "web")
    (d / "compose.yml.bak").write_text("old")

    assert stacks.list_stacks()[0]["data"] == ["compose.yml.bak", "data/"]


def test_a_new_stack_takes_over_a_folder_delete_left(stacks_dir, monkeypatch):
    d = _with_data(stacks_dir, "web")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})
    stacks.delete_stack("web")

    stacks.create_stack("web", COMPOSE)

    assert (d / "data" / "app.db").read_text() == "rows"
    assert (d / "compose.yml").read_text() == COMPOSE


def test_a_live_stack_is_never_taken_over(stacks_dir, monkeypatch):
    _make_stack(stacks_dir, "web")
    monkeypatch.setattr(stacks, "run_compose", lambda d, *a: {"ok": True, "output": ""})

    with pytest.raises(StackError, match="already exists"):
        stacks.create_stack("web", COMPOSE)


def test_name_validation_blocks_traversal(stacks_dir):
    for bad in ["../etc", "a/b", ".."]:
        with pytest.raises(StackError):
            stacks.get_stack(bad)
