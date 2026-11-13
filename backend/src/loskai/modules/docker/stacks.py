"""Directory-based stack manager — a browser front-end over `docker compose`.

The filesystem is the only source of truth: Loskai watches one directory (`STACKS_DIR`)
and every immediate subdir with a compose file is a stack. It keeps no database and never
locks a stack — editing in the browser and over SSH touch the same file.

Filesystem logic (scan/read/write) is testable against `tmp_path`; the `docker compose`
calls are subprocess I/O.
"""

import re
import shutil
import subprocess
from pathlib import Path

from ...config import settings
from ...shared import store
from ...shared.errors import LoskaiError
from . import logic
from .client import DOCKER_ERRORS, describe_error, docker_client

_COMPOSE_NAMES = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]
# Compose merges an override beside the compose file on its own. The install wizard writes
# this one for the folders added at install (recipes.render_override).
OVERRIDE_NAME = "compose.override.yml"
_OVERRIDE_NAMES = [OVERRIDE_NAME, "compose.override.yaml", "docker-compose.override.yml", "docker-compose.override.yaml"]
# Which recipe a stack was installed from, and what its compose.yml was then (install.py).
RECORD_NAME = ".loskai-recipe.json"
# What a stack *is*, as opposed to the data it keeps — what Delete removes by default.
_CONFIG_NAMES = {*_COMPOSE_NAMES, *_OVERRIDE_NAMES, ".env", RECORD_NAME}
_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_ACTIONS = {"up", "down", "restart", "pull"}
_COMPOSE_TIMEOUT = 300  # seconds


class StackError(LoskaiError):
    pass


def stacks_dir() -> Path:
    return Path(settings.stacks_dir)


def stacks_dir_ok() -> bool:
    """The one check that the compose mount actually stuck (dir exists in-container)."""
    return stacks_dir().is_dir()


def _validate_name(name: str) -> None:
    if not _NAME_RE.fullmatch(name) or "/" in name or ".." in name:
        raise StackError(f"invalid stack name: {name!r}")


def compose_path(directory: Path) -> Path | None:
    for candidate in _COMPOSE_NAMES:
        p = directory / candidate
        if p.is_file():
            return p
    return None


def override_path(directory: Path) -> Path | None:
    return next((directory / n for n in _OVERRIDE_NAMES if (directory / n).is_file()), None)


def env_text(directory: Path) -> str:
    """A stack's `.env` as written — "" when it has none."""
    env = directory / ".env"
    return env.read_text(encoding="utf-8") if env.is_file() else ""


def stack_path(name: str) -> Path:
    _validate_name(name)
    return stacks_dir() / name


def require_stack(name: str) -> tuple[Path, Path]:
    """A stack's folder and its compose file — or a 404: no compose file, no stack."""
    directory = stack_path(name)
    compose = compose_path(directory)
    if compose is None:
        raise StackError(f"stack '{name}' not found", 404)
    return directory, compose


def list_stacks() -> list[dict]:
    """Every subdir with a compose file + its up/down/partial status. Empty list (not an
    error) when the dir is present but has none — distinct from a broken mount."""
    base = stacks_dir()
    if not base.is_dir():
        return []
    compose = _compose_state()

    stacks: list[dict] = []
    for directory in sorted(p for p in base.iterdir() if p.is_dir()):
        compose_file = compose_path(directory)
        if compose_file is None:
            continue
        declared = logic.declared_services(compose_file.read_text(encoding="utf-8"))
        stacks.append({
            "name": directory.name,
            "services": sorted(declared),
            "status": _status(declared, directory, compose),
            "data": stack_data(directory),
        })
    return stacks


def stack_of(compose_dir: str | None) -> str | None:
    """The stack a container belongs to: the one whose folder compose ran it from (its
    `working_dir` label) — never matched by name, which compose lowercases and strips, and
    which a project started elsewhere can share. None for a container no stack started."""
    if not compose_dir:
        return None
    folder = Path(compose_dir).resolve()
    if folder.parent != stacks_dir().resolve() or compose_path(folder) is None:
        return None
    return folder.name


def _compose_state() -> dict[Path, dict] | None:
    """`client.compose_dirs`, keyed by resolved folder; None while the daemon is down."""
    try:
        found = docker_client.compose_dirs()
    except DOCKER_ERRORS:
        return None
    return {Path(folder).resolve(): entry for folder, entry in found.items()}


def _status(declared: set[str], directory: Path, compose: dict[Path, dict] | None) -> str:
    """A stack's up/down status, from the containers run from its folder — unknown while the
    daemon is down."""
    if compose is None:
        return "unknown"
    entry = compose.get(directory.resolve())
    return logic.compute_stack_status(declared, entry["running"] if entry else set())


def stack_data(directory: Path) -> list[str]:
    """What a stack folder holds besides its compose file and `.env` — its data, by the
    recipes' convention of keeping `./data` beside the compose file. Names only, folders
    marked with a trailing `/`: sizing a media library to label a checkbox would take
    minutes."""
    return sorted(
        p.name + ("/" if p.is_dir() else "")
        for p in directory.iterdir()
        if p.name not in _CONFIG_NAMES
    )


def claim_dir(name: str) -> tuple[Path, bool]:
    """The folder a new stack goes in, and whether it already held data.

    A folder with a compose file is a live stack: refused. One without is what Delete
    leaves when it keeps the data — taken over, which is how installing the same thing
    again gets its data back."""
    directory = stack_path(name)
    if compose_path(directory) is not None:
        raise StackError(f"stack '{name}' already exists")
    reused = directory.is_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory, reused


def get_stack(name: str) -> dict:
    directory, compose = require_stack(name)
    override = override_path(directory)
    declared = logic.declared_services(compose.read_text(encoding="utf-8"))
    return {
        "name": name,
        "status": _status(declared, directory, _compose_state()),
        "services": sorted(declared),
        "compose": compose.read_text(encoding="utf-8"),
        "compose_file": compose.name,
        "env": env_text(directory),
        # Compose merges it in, so a stack that has one isn't described by compose.yml alone.
        "override": override.read_text(encoding="utf-8") if override else None,
        "override_file": override.name if override else None,
    }


def run_compose(directory: Path, *args: str) -> dict:
    try:
        proc = subprocess.run(
            ["docker", "compose", *args],
            cwd=directory, capture_output=True, text=True, timeout=_COMPOSE_TIMEOUT,
        )
    except FileNotFoundError:
        raise StackError("docker CLI not found in the container")
    except subprocess.TimeoutExpired:
        raise StackError("docker compose timed out")
    output = (proc.stdout + proc.stderr).strip()
    return {"ok": proc.returncode == 0, "output": output}


def stack_action(name: str, action: str) -> dict:
    if action not in _ACTIONS:
        raise StackError(f"unknown action: {action}")
    directory, _ = require_stack(name)
    if action == "up":
        return run_compose(directory, "up", "-d")
    if action == "pull":
        pulled = run_compose(directory, "pull")
        if not pulled["ok"]:
            return pulled
        up = run_compose(directory, "up", "-d")
        return {"ok": up["ok"], "output": pulled["output"] + "\n" + up["output"]}
    return run_compose(directory, action)  # down | restart


def create_stack(name: str, compose_content: str, env_content: str = "") -> dict:
    """The raw path: write a finished compose.yml + .env and `up`."""
    if not stacks_dir_ok():
        raise StackError("stacks directory not found — check the compose mount")
    problem = logic.yaml_problem(compose_content)
    if problem:
        raise StackError(f"compose.yml {problem}")
    directory, _ = claim_dir(name)
    (directory / "compose.yml").write_text(compose_content, encoding="utf-8")
    if env_content:
        store.write_private(directory / ".env", env_content)
    return run_compose(directory, "up", "-d")


def update_stack_file(name: str, file: str, content: str) -> None:
    """Save one file from the stack editor. `compose.yml` and `compose.override.yml` mean
    the stack's own, whatever it is called on disk — writing a second compose file beside a
    `docker-compose.yml` would quietly change which one Compose reads. YAML that won't load
    is refused before anything is written. An emptied override is removed, as an install
    with no folders does."""
    if file not in ("compose.yml", OVERRIDE_NAME, ".env"):
        raise StackError("only compose.yml, compose.override.yml or .env may be edited")
    directory = stack_path(name)
    if not directory.is_dir():
        raise StackError(f"stack '{name}' not found", 404)
    if file == ".env":
        store.write_private(directory / file, content)
        return
    existing = compose_path(directory) if file == "compose.yml" else override_path(directory)
    target = existing or directory / file
    if file == OVERRIDE_NAME and not content.strip():
        target.unlink(missing_ok=True)
        return
    problem = logic.yaml_problem(content)
    if problem:
        raise StackError(f"{target.name} {problem}")
    target.write_text(content, encoding="utf-8")


def delete_stack(name: str, delete_data: bool = False) -> dict:
    """`down`, then remove the stack — but not its data unless asked.

    Recipes keep their data beside the compose file (`./data`), so removing the folder
    would take a service's database with it. By default only the compose file, any
    override, `.env` and the install record go: the stack leaves the list, the data stays, and installing it again picks the
    folder back up (claim_dir). A folder left with nothing in it is removed.
    `down` never takes `-v`, so named volumes survive either way."""
    directory = stack_path(name)
    if not directory.is_dir():
        raise StackError(f"stack '{name}' not found", 404)
    result = {"ok": True, "output": ""}
    if compose_path(directory) is not None:
        result = run_compose(directory, "down")
    if delete_data:
        try:
            shutil.rmtree(directory)
        except PermissionError:
            # Files the app wrote as its own user, which Loskai's user can't remove.
            try:
                docker_client.clear_folder(str(directory))
            except DOCKER_ERRORS as exc:
                raise StackError(f"could not delete the data: {describe_error(exc)}")
            directory.rmdir()
        return {**result, "kept": []}
    for n in _CONFIG_NAMES:
        (directory / n).unlink(missing_ok=True)
    kept = stack_data(directory)
    if not kept:
        directory.rmdir()
    return {**result, "kept": kept}
