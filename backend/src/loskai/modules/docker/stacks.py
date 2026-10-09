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
from . import logic
from .client import DOCKER_ERRORS, docker_client

_COMPOSE_NAMES = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]
# Compose merges an override beside the compose file on its own. The install wizard writes
# this one for the folders added at install (recipes.render_override).
OVERRIDE_NAME = "compose.override.yml"
_OVERRIDE_NAMES = [OVERRIDE_NAME, "compose.override.yaml", "docker-compose.override.yml", "docker-compose.override.yaml"]
# What a stack *is*, as opposed to the data it keeps — what Delete removes by default.
_CONFIG_NAMES = {*_COMPOSE_NAMES, *_OVERRIDE_NAMES, ".env"}
_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_ACTIONS = {"up", "down", "restart", "pull"}
_COMPOSE_TIMEOUT = 300  # seconds


class StackError(Exception):
    pass


def stacks_dir() -> Path:
    return Path(settings.stacks_dir)


def stacks_dir_ok() -> bool:
    """The one check that the compose mount actually stuck (dir exists in-container)."""
    return stacks_dir().is_dir()


def _validate_name(name: str) -> None:
    if not _NAME_RE.match(name) or "/" in name or ".." in name:
        raise StackError(f"invalid stack name: {name!r}")


def _compose_file(directory: Path) -> Path | None:
    for candidate in _COMPOSE_NAMES:
        p = directory / candidate
        if p.is_file():
            return p
    return None


def _stack_dir(name: str) -> Path:
    _validate_name(name)
    return stacks_dir() / name


def list_stacks() -> list[dict]:
    """Every subdir with a compose file + its up/down/partial status. Empty list (not an
    error) when the dir is present but has none — distinct from a broken mount."""
    base = stacks_dir()
    if not base.is_dir():
        return []
    try:
        projects = docker_client.compose_projects()
    except DOCKER_ERRORS:
        projects = None  # daemon down — status unknown, still list the stacks

    stacks: list[dict] = []
    for directory in sorted(p for p in base.iterdir() if p.is_dir()):
        compose = _compose_file(directory)
        if compose is None:
            continue
        declared = logic.declared_services(compose.read_text(encoding="utf-8"))
        if projects is None:
            status = "unknown"
        else:
            status = logic.compute_stack_status(declared, projects.get(directory.name, set()))
        stacks.append({
            "name": directory.name,
            "services": sorted(declared),
            "status": status,
            "data": stack_data(directory),
        })
    return stacks


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
    directory = _stack_dir(name)
    if _compose_file(directory) is not None:
        raise StackError(f"stack '{name}' already exists")
    reused = directory.is_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory, reused


def get_stack(name: str) -> dict:
    directory = _stack_dir(name)
    compose = _compose_file(directory)
    if compose is None:
        raise StackError(f"stack '{name}' not found")
    env_file = directory / ".env"
    override = next((directory / n for n in _OVERRIDE_NAMES if (directory / n).is_file()), None)
    declared = logic.declared_services(compose.read_text(encoding="utf-8"))
    try:
        projects = docker_client.compose_projects()
        status = logic.compute_stack_status(declared, projects.get(name, set()))
    except DOCKER_ERRORS:
        status = "unknown"
    return {
        "name": name,
        "status": status,
        "services": sorted(declared),
        "compose": compose.read_text(encoding="utf-8"),
        "compose_file": compose.name,
        "env": env_file.read_text(encoding="utf-8") if env_file.is_file() else "",
        # Shown read-only: Compose merges it in, so a stack that has one isn't described by
        # compose.yml alone.
        "override": override.read_text(encoding="utf-8") if override else None,
        "override_file": override.name if override else None,
    }


def _run_compose(directory: Path, *args: str) -> dict:
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
    directory = _stack_dir(name)
    if _compose_file(directory) is None:
        raise StackError(f"stack '{name}' not found")
    if action == "up":
        return _run_compose(directory, "up", "-d")
    if action == "pull":
        pulled = _run_compose(directory, "pull")
        if not pulled["ok"]:
            return pulled
        up = _run_compose(directory, "up", "-d")
        return {"ok": up["ok"], "output": pulled["output"] + "\n" + up["output"]}
    return _run_compose(directory, action)  # down | restart


def create_stack(name: str, compose_content: str, env_content: str = "") -> dict:
    """The raw path: write a finished compose.yml + .env and `up`."""
    if not stacks_dir_ok():
        raise StackError("stacks directory not found — check the compose mount")
    directory, _ = claim_dir(name)
    (directory / "compose.yml").write_text(compose_content, encoding="utf-8")
    if env_content:
        store.write_private(directory / ".env", env_content)
    return _run_compose(directory, "up", "-d")


def update_stack_file(name: str, file: str, content: str) -> None:
    if file not in ("compose.yml", ".env"):
        raise StackError("only compose.yml or .env may be edited")
    directory = _stack_dir(name)
    if not directory.is_dir():
        raise StackError(f"stack '{name}' not found")
    if file == ".env":
        store.write_private(directory / file, content)
    else:
        (directory / file).write_text(content, encoding="utf-8")


def delete_stack(name: str, delete_data: bool = False) -> dict:
    """`down`, then remove the stack — but not its data unless asked.

    Recipes keep their data beside the compose file (`./data`), so removing the folder
    would take a service's database with it. By default only the compose file, any
    override and `.env` go: the stack leaves the list, the data stays, and installing it again picks the
    folder back up (claim_dir). A folder left with nothing in it is removed.
    `down` never takes `-v`, so named volumes survive either way."""
    directory = _stack_dir(name)
    if not directory.is_dir():
        raise StackError(f"stack '{name}' not found")
    result = {"ok": True, "output": ""}
    if _compose_file(directory) is not None:
        result = _run_compose(directory, "down")
    if delete_data:
        shutil.rmtree(directory)
        return {**result, "kept": []}
    for n in _CONFIG_NAMES:
        (directory / n).unlink(missing_ok=True)
    kept = stack_data(directory)
    if not kept:
        directory.rmdir()
    return {**result, "kept": kept}
