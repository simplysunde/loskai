"""Recipe engine — declarative install manifests, validated but never executed.

Sources are merged into one list: every enabled git repo (in priority order) and then the
local dir in the state volume, which is always scanned last and cannot be disabled. The
first source to define a recipe id wins; a later copy is flagged, not dropped. See
docs/reference/recipe-schema.md — the contract recipes are authored against.

Validation + the merge are pure/filesystem (unit-tested). Sync (git) and install
(compose subprocess) are I/O.
"""

import hashlib
import logging
import re
import subprocess
from pathlib import Path

import yaml

from ...config import settings
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from ...shared.instances import Instance
from . import logic, stacks
from .client import DOCKER_ERRORS, describe_error, docker_client

logger = logging.getLogger(__name__)

VALID_TYPES = {"pull", "git_build", "registry_pull"}
SOURCE_LOCAL = "local"
_VAR_RE = re.compile(r"\$\{(\w+)\}")
# A .env key Compose can read back as one: shell-identifier shape. Anything else (`=`, a
# space, a newline) would split or merge lines in the generated file.
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]")
# Compose derives a project name from the directory it runs in, lowercased and stripped
# of anything outside this set. Mirrored here so container discovery asks the daemon for
# the label Compose actually wrote.
_PROJECT_RE = re.compile(r"[^a-z0-9_-]")
_GIT_TIMEOUT = 120


class RecipeError(Exception):
    pass


# --- Pure validation + rendering (unit-tested) ---


def validate_manifest(data: object) -> list[str]:
    """Return a list of reasons the manifest is invalid (empty = valid)."""
    if not isinstance(data, dict):
        return ["recipe.yml is not a mapping"]
    errors: list[str] = []
    if not data.get("name"):
        errors.append("missing 'name'")
    rtype = data.get("type")
    if rtype not in VALID_TYPES:
        errors.append(f"'type' must be one of {sorted(VALID_TYPES)}")
    if rtype == "git_build" and not data.get("git_repo"):
        errors.append("type 'git_build' requires 'git_repo'")
    if "service" in data and not isinstance(data.get("service"), str):
        errors.append("'service' must be a compose service name")
    for i, entry in enumerate(data.get("env") or []):
        if not isinstance(entry, dict) or not entry.get("key") or not entry.get("label"):
            errors.append(f"env[{i}] needs 'key' and 'label'")
        elif not _ENV_KEY_RE.match(str(entry["key"])):
            errors.append(f"env[{i}] key '{entry['key']}' is not a valid variable name")
    return errors


def resolve_answers(env_spec: list[dict], answers: dict) -> dict[str, str]:
    """The values one install writes: every key the manifest declares, in manifest order —
    the caller's answer where given, else the manifest default, else empty.

    The server owns this, not the form. The wizard happens to send every key pre-filled,
    but an API caller that omits one used to get a *blank* variable — a `${PORT}` that
    publishes on a random host port, silently. An explicit empty answer is kept: clearing
    a pre-filled field is a choice. An undeclared key is refused rather than written,
    since a `.env` line is not just a variable to Compose — `COMPOSE_PROJECT_NAME` in it
    re-points the project, and with it the container this install links to.
    """
    declared = [str(e["key"]) for e in env_spec]
    unknown = sorted(set(answers) - set(declared))
    if unknown:
        raise RecipeError(
            f"not declared by this recipe: {', '.join(unknown)} — "
            f"it asks for {', '.join(declared) or 'nothing'}"
        )
    values: dict[str, str] = {}
    for entry in env_spec:
        given = answers.get(entry["key"])
        values[str(entry["key"])] = str(given if given is not None else entry.get("default", ""))
    return values


def _env_escape(value: str) -> str:
    # Backslash first, or the escapes added after it would be doubled.
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("$", "\\$")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def render_env(values: dict[str, str]) -> str:
    r"""Install values -> .env text, every value double-quoted and escaped so Compose reads
    back exactly what was typed.

    Written verbatim, Compose interpolates `$` (`pa$word1` arrives as `pa`), reads ` #` as
    a comment (`correct horse #battery` arrives as `correct horse`), and a newline starts
    a new `KEY=` line. All of these *succeed* — `up` exits 0 and the app simply has a
    different password. Single quotes would fix the first two but cannot hold a `'`.
    Double quotes with `\\`, `\"`, `\$`, `\n` and `\r` escaped round-trip all of it,
    checked against `docker compose config` and a real container's environment on
    2026-10-03.
    """
    return "".join(f'{k}="{_env_escape(v)}"\n' for k, v in values.items())


def expand_vars(text: str, values: dict[str, str]) -> str:
    """Substitute ${VAR} from the install values (used for the `directories` paths Loskai
    mkdir-s before compose runs). Unknown vars are left as-is."""
    return _VAR_RE.sub(lambda m: values.get(m.group(1), m.group(0)), text)


def source_slug(url: str) -> str:
    """Cache directory name for one repo: a readable tail plus a hash of the whole URL.

    The hash is what makes it safe — two repos on different hosts routinely end in the
    same path segment, and sharing a cache would have one silently overwrite the other.
    """
    tail = _SLUG_RE.sub("-", url.rstrip("/").rsplit("/", 1)[-1]).removesuffix(".git")
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
    return f"{tail[:40] or 'repo'}-{digest}"


def source_label(url: str, name: str | None = None) -> str:
    """Short display name for a source: its own `name`, else the URL's last segment."""
    if name:
        return name
    return url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git") or url


def project_name(recipe_id: str) -> str:
    """The compose project name `docker compose` will use for an installed recipe."""
    return _PROJECT_RE.sub("", recipe_id.lower())


# --- Source scanning + merge (filesystem) ---


def _cache_root() -> Path:
    return Path(settings.data_dir) / "recipes-cache"


def _repo_cache(url: str) -> Path:
    return _cache_root() / source_slug(url)


def _local_dir() -> Path:
    return Path(settings.data_dir) / "recipes"


def enabled_sources() -> list[dict]:
    """The configured git sources that are switched on, in priority order."""
    sources, _ = settings_store.recipe_sources()
    return [s for s in sources if s.get("enabled", True)]


def _load_folder(folder: Path, source: str, source_url: str | None) -> dict:
    manifest = folder / "recipe.yml"
    if not manifest.is_file():
        raise RecipeError("recipe.yml missing")
    try:
        data = yaml.safe_load(manifest.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise RecipeError(f"invalid YAML: {exc}")
    errors = validate_manifest(data)
    if not any((folder / n).is_file() for n in ("compose.yml", "compose.yaml")):
        errors.append("compose.yml missing")
    if errors:
        raise RecipeError("; ".join(errors))
    instructions = folder / "instructions.md"
    return {
        "id": folder.name,
        "name": data["name"],
        "type": data["type"],
        "description": data.get("description"),
        "env": data.get("env") or [],
        "directories": data.get("directories") or [],
        "suggested_subdomain": data.get("suggested_subdomain"),
        "git_repo": data.get("git_repo"),
        # Which compose service is the published one, when the recipe runs several
        # (logic.primary_container). Optional — one service needs no declaration.
        "service": data.get("service"),
        "instructions": instructions.read_text(encoding="utf-8") if instructions.is_file() else "",
        "source": source,
        "source_url": source_url,
        "path": str(folder),
    }


def _scan(base: Path, source: str, source_url: str | None) -> tuple[dict[str, dict], list[dict]]:
    valid: dict[str, dict] = {}
    invalid: list[dict] = []
    if not base.is_dir():
        return valid, invalid
    for folder in sorted(p for p in base.iterdir() if p.is_dir()):
        try:
            valid[folder.name] = _load_folder(folder, source, source_url)
        except RecipeError as exc:
            invalid.append({"id": folder.name, "source": source, "error": str(exc)})
    return valid, invalid


def _merged() -> dict:
    """Scan every enabled source in priority order, then the local dir.

    First source to define a recipe id wins; a later copy is flagged in `shadowed` (with
    both the source it came from and the one that beat it), never silently dropped. The
    local dir goes last deliberately: it is where in-progress manifests live, and a
    maintained repo staying authoritative is what makes "give the variant a distinct
    name" the right advice.

    Recipes carry their folder `path` here; `list_recipes` drops it for the API.
    """
    scans = [(source_label(s["url"], s.get("name")), s["url"], _repo_cache(s["url"])) for s in enabled_sources()]
    scans.append((SOURCE_LOCAL, None, _local_dir()))

    merged: dict[str, dict] = {}
    invalid: list[dict] = []
    shadowed: list[dict] = []
    for label, url, base in scans:
        valid, bad = _scan(base, label, url)
        invalid.extend(bad)
        for rid, recipe in valid.items():
            if rid in merged:
                shadowed.append({"id": rid, "source": label, "shadowed_by": merged[rid]["source"]})
            else:
                merged[rid] = recipe
    return {"recipes": merged, "invalid": invalid, "shadowed": shadowed}


def _source_status(source: dict, counts: dict[str, int]) -> dict:
    """One source as the UI shows it: what it is, and whether it has ever synced."""
    cache = _repo_cache(source["url"])
    label = source_label(source["url"], source.get("name"))
    synced = (cache / ".git").is_dir()
    return {
        "url": source["url"],
        "label": label,
        "enabled": bool(source.get("enabled", True)),
        "builtin": bool(source.get("builtin")),
        "synced": synced,
        "last_synced": int(cache.stat().st_mtime) if synced else None,
        "count": counts.get(label, 0),
    }


def list_recipes() -> dict:
    """The merged recipe list, plus what was skipped, shadowed, and scanned."""
    merged = _merged()
    recipes = sorted(merged["recipes"].values(), key=lambda r: r["name"].lower())
    counts: dict[str, int] = {}
    for recipe in recipes:
        counts[recipe["source"]] = counts.get(recipe["source"], 0) + 1
    sources, sources_source = settings_store.recipe_sources()
    return {
        "recipes": [{k: v for k, v in r.items() if k != "path"} for r in recipes],
        "invalid": merged["invalid"],
        "shadowed": merged["shadowed"],
        # So the wizard's empty state can tell "no sources configured" apart from
        # "configured but never synced" — two very different things to tell the user.
        "sources": [_source_status(s, counts) for s in sources],
        "sources_source": sources_source,
        "local_count": counts.get(SOURCE_LOCAL, 0),
    }


def get_recipe(recipe_id: str) -> dict:
    recipe = _merged()["recipes"].get(recipe_id)
    if recipe is None:
        raise RecipeError(f"recipe '{recipe_id}' not found")
    return recipe


# --- Sync (git I/O) ---


def _sync_one(url: str) -> str:
    cache = _repo_cache(url)
    try:
        if (cache / ".git").is_dir():
            proc = subprocess.run(
                ["git", "-C", str(cache), "pull", "--ff-only"],
                capture_output=True, text=True, timeout=_GIT_TIMEOUT,
            )
        else:
            cache.parent.mkdir(parents=True, exist_ok=True)
            proc = subprocess.run(
                ["git", "clone", "--depth", "1", url, str(cache)],
                capture_output=True, text=True, timeout=_GIT_TIMEOUT,
            )
    except FileNotFoundError:
        raise RecipeError("git not found in the container")
    except subprocess.TimeoutExpired:
        raise RecipeError("git sync timed out")
    if proc.returncode != 0:
        raise RecipeError((proc.stderr or proc.stdout).strip() or "git sync failed")
    return (proc.stdout + proc.stderr).strip()


def sync_recipes(url: str | None = None) -> dict:
    """Clone/pull each enabled repo into its own cache. No auth (public repos). Explicit
    only — never background-polled.

    One repo failing never stops the others: each gets its own result and keeps whatever
    it last synced, so an unreachable source costs you that source's recipes and nothing
    else. `url` syncs just that source.
    """
    targets = enabled_sources()
    if url is not None:
        targets = [s for s in targets if s["url"] == url]
        if not targets:
            raise RecipeError(f"'{url}' is not an enabled recipe source")
    if not targets:
        raise RecipeError("no recipe sources are enabled — add one in Settings > General")

    results: list[dict] = []
    for source in targets:
        label = source_label(source["url"], source.get("name"))
        try:
            results.append({"url": source["url"], "label": label, "ok": True, "output": _sync_one(source["url"])})
        except RecipeError as exc:
            logger.warning("recipe source %s failed to sync: %s", source["url"], exc)
            results.append({"url": source["url"], "label": label, "ok": False, "output": str(exc)})
    return {
        "ok": all(r["ok"] for r in results),
        "results": results,
        "output": "\n\n".join(f"{r['label']}: {r['output']}" for r in results),
    }


# --- Install (compose I/O) ---


def install_recipe(recipe_id: str, answers: dict[str, str]) -> dict:
    """Create the stack dir, write compose.yml + a generated .env, run the type's
    command, and register a docker instance. Never executes recipe-supplied code."""
    if not stacks.stacks_dir_ok():
        raise RecipeError("stacks directory not found — check the compose mount")
    recipe = get_recipe(recipe_id)
    # Before any side effect: an undeclared key fails here, not after the mkdir.
    values = resolve_answers(recipe["env"], answers)
    folder = Path(recipe["path"])
    compose_src = next((folder / n for n in ("compose.yml", "compose.yaml") if (folder / n).is_file()), None)
    if compose_src is None:
        raise RecipeError("recipe compose.yml missing")

    target = stacks.stacks_dir() / recipe_id
    if target.exists():
        raise RecipeError(f"a stack named '{recipe_id}' already exists")

    # Pre-create any declared directories (with ${VAR} expanded from the install values).
    for raw in recipe["directories"]:
        Path(expand_vars(str(raw), values)).mkdir(parents=True, exist_ok=True)

    if recipe["type"] == "git_build":
        _git_clone(recipe["git_repo"], target)
    else:
        target.mkdir(parents=True)

    (target / "compose.yml").write_text(compose_src.read_text(encoding="utf-8"), encoding="utf-8")
    (target / ".env").write_text(render_env(values), encoding="utf-8")

    build = recipe["type"] == "git_build"
    result = _compose_up(target, build=build)
    if not result["ok"]:
        # Nothing came up, so there is nothing to register. An instance whose `container`
        # names no container joins to nothing — it would show as a permanently orphaned
        # row rather than a failed install.
        return {"ok": False, "output": result["output"], "instance_id": None, "container": None}

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
            "warning": (
                f"'{recipe['name']}' is up, but its container could not be identified — "
                "route it from the Routing tab's Add route picker."
            ),
        }

    instances_store.upsert_instance(
        Instance(id=recipe_id, name=recipe["name"], type="docker", container=container)
    )
    return {"ok": True, "output": result["output"], "instance_id": recipe_id, "container": container}


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


def _git_clone(repo: str, target: Path) -> None:
    try:
        proc = subprocess.run(
            ["git", "clone", "--depth", "1", repo, str(target)],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise RecipeError(f"git clone failed: {exc}")
    if proc.returncode != 0:
        raise RecipeError((proc.stderr or proc.stdout).strip() or "git clone failed")


def _compose_up(directory: Path, build: bool) -> dict:
    args = ["up", "-d", "--build"] if build else ["up", "-d"]
    return stacks._run_compose(directory, *args)
