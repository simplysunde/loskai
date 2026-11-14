"""Installing a recipe: the stack folder, its `.env` and override, the compose run, the
instance it registers, and the record (`.loskai-recipe.json`) that says which recipe a
stack came from — what Check for updates and a route's icon read back.

Never runs anything the recipe supplies: the compose file is copied, the answers are
checked (`manifest.py`) and written quoted.
"""

import hashlib
import json
import logging
import re
from pathlib import Path

from ...shared import icons
from ...shared import instances as instances_store
from ...shared import store
from ...shared.instances import Instance
from . import dotenv, logic, override, stacks
from .client import DOCKER_ERRORS, describe_error, docker_client
from .manifest import RecipeError, resolve_answers, resolve_mounts, resolve_options
from .recipes import ICON_FILE, get_recipe, merged_recipes, recipe_compose, source_commit

logger = logging.getLogger(__name__)

# Compose derives a project name from the directory it runs in, lowercased and stripped
# of anything outside this set. Mirrored here so container discovery asks the daemon for
# the label Compose actually wrote.
_PROJECT_RE = re.compile(r"[^a-z0-9_-]")


def project_name(recipe_id: str) -> str:
    """The compose project name `docker compose` will use for an installed recipe."""
    return _PROJECT_RE.sub("", recipe_id.lower())


def install_recipe(
    recipe_id: str, answers: dict[str, str], mounts: list | None = None, options: list | None = None
) -> dict:
    """Create the stack dir, write compose.yml + a generated .env (+ an override holding
    the folders added at install and the options switched on), run the type's command,
    and register a docker instance. Never executes recipe-supplied code."""
    if not stacks.stacks_dir_ok():
        raise RecipeError("stacks directory not found — check the compose mount")
    recipe = get_recipe(recipe_id)
    # Before any side effect: an undeclared key fails here, not after the mkdir.
    values = resolve_answers(recipe["env"], answers)
    pairs = resolve_mounts(recipe["mounts"], mounts or [])
    chosen = resolve_options(recipe["options"], options or [])
    folder = Path(recipe["path"])
    compose_src = recipe_compose(folder)
    if compose_src is None:
        raise RecipeError("recipe compose.yml missing")

    # Also before any side effect: whose record this install will register under its id.
    slot = _instance_slot(recipe_id)

    stack_dir, reused = stacks.claim_dir(recipe_id)

    compose_text = compose_src.read_text(encoding="utf-8")
    (stack_dir / "compose.yml").write_text(compose_text, encoding="utf-8")
    write_record(stack_dir, recipe, compose_text)
    store.write_private(stack_dir / ".env", dotenv.render_env(values))
    override_file = stack_dir / stacks.OVERRIDE_NAME
    spec = recipe["mounts"]
    override_text = override.render_override(spec["service"], pairs, spec["read_only"]) if pairs else ""
    override_text = override.set_options(override_text, recipe["options"], chosen)
    if override_text:
        override_file.write_text(override_text, encoding="utf-8")
    else:
        override_file.unlink(missing_ok=True)

    result = stacks.run_compose(stack_dir, "up", "-d")
    if not result["ok"]:
        # Nothing came up, so there is nothing to register. An instance whose `container`
        # names no container joins to nothing — it would show as a permanently orphaned
        # row rather than a failed install.
        return {
            "ok": False, "output": result["output"], "instance_id": None, "container": None,
            "reused_data": reused,
        }

    container = _discover_container(recipe_id, recipe.get("service"))
    if container is None:
        # Installed, but we can't say which container is the published one. Registering a
        # link to a guessed name is worse than registering nothing: the Routing tab's
        # Container source lists the container itself and creates the instance correctly,
        # whereas a wrong `container` would sit there as a second, dead record.
        return {
            "ok": True,
            "output": result["output"],
            "instance_id": None,
            "container": None,
            "reused_data": reused,
            "warning": (
                f"'{recipe['name']}' is up, but its container could not be identified — "
                "route it from the Routing tab's Add route picker."
            ),
        }

    # A reinstall keeps the earlier record — its route, icon, private flag, following —
    # and only re-points it at the container that now exists. Replacing it wholesale used
    # to wipe the route fields while Caddy kept serving the route; writing back the copy
    # read before `up`, to lose what changed during it (the follower, a hand edit).
    record = instances_store.update_fields(recipe_id, container=container) if slot else None
    if record is None:
        record = Instance(id=recipe_id, name=recipe["name"], type="docker", container=container)
        instances_store.upsert_instance(with_icon(record, recipe))
    else:
        iconed = with_icon(record, recipe)
        if iconed.icon != record.icon:
            instances_store.give_icon(recipe_id, iconed.icon)
    return {
        "ok": True, "output": result["output"], "instance_id": recipe_id, "container": container,
        "reused_data": reused,
    }


def with_icon(record: Instance, recipe: dict) -> Instance:
    """The recipe's icon as the record's launcher icon — only where there is none yet, so an
    icon chosen by hand survives a reinstall. Best-effort: an icon never fails an install or
    a route."""
    if not recipe["icon"] or record.icon:
        return record
    try:
        filename = icons.save(record.id, (Path(recipe["path"]) / ICON_FILE).read_bytes())
    except (OSError, icons.IconError) as exc:
        logger.warning("recipe %s: icon not applied: %s", recipe["id"], exc)
        return record
    return record.model_copy(update={"icon": filename})


def installed_as(directory: Path) -> tuple[dict | None, str]:
    """A stack's install record, and the id of the recipe it came from — the record's, or
    for a stack from before records (or moved in by hand), its folder's name."""
    record = read_record(directory)
    return record, record["recipe"] if record else directory.name


def stack_recipe(directory: Path) -> dict | None:
    """The recipe a stack came from (`installed_as`). None when no source has it."""
    _, rid = installed_as(directory)
    try:
        return merged_recipes()["recipes"].get(rid)
    except (OSError, RecipeError):
        return None


def with_recipe_icon(record: Instance) -> Instance:
    """A new route record for a container in a recipe's stack, given the recipe's icon as
    the install would have — for a route deleted and added again, or a stack the wizard
    didn't install. The stack is the one compose ran it from (`stacks.stack_of`). As at
    install, only the recipe's primary container gets it, never a database beside it."""
    try:
        labels = docker_client.labels_of(record.container) if record.container else {}
        stack = stacks.stack_of(labels.get("com.docker.compose.project.working_dir"))
        if stack is None:
            return record
        recipe = stack_recipe(stacks.stacks_dir() / stack)
        if recipe is None:
            return record
        containers = docker_client.containers_in_project(labels["com.docker.compose.project"])
    except DOCKER_ERRORS:
        return record
    if logic.primary_container(containers, recipe.get("service")) != record.container:
        return record
    return with_icon(record, recipe)


def fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_record(stack_dir: Path, recipe: dict, compose_text: str) -> None:
    """Remember which recipe a stack came from and the compose.yml it was given — what
    Check for updates compares against, to tell the recipe moving on from a hand edit."""
    record = {
        "recipe": recipe["id"],
        "source": recipe["source_url"],
        "commit": source_commit(recipe["source_url"]),
        "compose": fingerprint(compose_text),
    }
    (stack_dir / stacks.RECORD_NAME).write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")


def read_record(stack_dir: Path) -> dict | None:
    try:
        record = json.loads((stack_dir / stacks.RECORD_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) and record.get("recipe") else None


def _instance_slot(recipe_id: str) -> Instance | None:
    """The record an install of `recipe_id` registers under: an earlier install's, to keep,
    or None for a fresh one.

    A route's instance id is its prefix, so the id can belong to something that isn't
    this recipe at all — an external route, or a route to another container that is still
    running. Those are refused rather than overwritten. A docker record whose container is
    gone (deleted with its stack), or belongs to this recipe's own project, is the earlier
    install's."""
    existing = instances_store.get_instance(recipe_id)
    if existing is None:
        return None
    if existing.type != "docker":
        raise RecipeError(
            f"'{recipe_id}' is already the name of a route to {existing.upstream or 'something else'} "
            "— rename or remove it under Routing first"
        )
    if existing.container:
        try:
            alive = existing.container in docker_client.container_names()
            ours = {c["name"] for c in docker_client.containers_in_project(project_name(recipe_id))}
        except DOCKER_ERRORS:
            alive, ours = False, set()  # can't tell — and the install needs Docker anyway
        if alive and existing.container not in ours:
            raise RecipeError(
                f"'{recipe_id}' is already the name of the route to container "
                f"'{existing.container}' — rename or remove it under Routing first"
            )
    return existing


def _discover_container(recipe_id: str, declared: str | None) -> str | None:
    """The real container name to link the new instance to.

    Compose names containers `<project>-<service>-1` unless the compose file pins
    `container_name`, so the recipe id is not it — and the instance join matches on the
    name. Asking the daemon is the only way to know; a daemon that has gone away returns
    None rather than failing an otherwise successful install.
    """
    try:
        containers = docker_client.containers_in_project(project_name(recipe_id))
    except DOCKER_ERRORS as exc:
        logger.warning("could not read containers for '%s': %s", recipe_id, describe_error(exc))
        return None
    return logic.primary_container(containers, declared)
