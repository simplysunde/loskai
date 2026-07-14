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
    monkeypatch.setattr(stacks.docker_client, "compose_projects", dict)
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
    monkeypatch.setattr(stacks.docker_client, "compose_projects", lambda: {"web": {"app"}})

    by_name = {s["name"]: s for s in stacks.list_stacks()}
    assert by_name["web"]["status"] == "up"
    assert by_name["db"]["status"] == "down"
    assert by_name["web"]["services"] == ["app"]


def test_list_stacks_status_unknown_when_daemon_down(stacks_dir, monkeypatch):
    _make_stack(stacks_dir, "web")

    def boom():
        raise stacks.DOCKER_ERRORS[0]("down")

    monkeypatch.setattr(stacks.docker_client, "compose_projects", boom)
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
    monkeypatch.setattr(stacks, "_run_compose", lambda d, *a: {"ok": True, "output": "up"})
    stacks.create_stack("new", COMPOSE, "SECRET=x\n")
    assert (stacks_dir / "new" / "compose.yml").read_text() == COMPOSE
    assert (stacks_dir / "new" / ".env").read_text() == "SECRET=x\n"


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


def test_delete_stack_removes_dir(stacks_dir, monkeypatch):
    _make_stack(stacks_dir, "web")
    monkeypatch.setattr(stacks, "_run_compose", lambda d, *a: {"ok": True, "output": ""})
    stacks.delete_stack("web")
    assert not (stacks_dir / "web").exists()


def test_name_validation_blocks_traversal(stacks_dir):
    for bad in ["../etc", "a/b", ".."]:
        with pytest.raises(StackError):
            stacks.get_stack(bad)
