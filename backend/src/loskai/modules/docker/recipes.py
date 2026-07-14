"""Recipe engine — declarative install manifests, validated but never executed.

Two sources merged into one list: the synced public repo cache (canonical) and a local
dir in the settings volume. On a name clash the repo wins; the shadowed local copy is
flagged, not dropped. See docs/recipe-schema.md — the contract recipes are authored
against.

Validation + the merge are pure/filesystem (unit-tested). Sync (git) and install
(compose subprocess) are I/O.
"""

import re
import subprocess
from pathlib import Path

import yaml

from ...config import settings
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from ...shared.instances import Instance
from . import stacks

VALID_TYPES = {"pull", "git_build", "registry_pull"}
_VAR_RE = re.compile(r"\$\{(\w+)\}")
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
    for i, entry in enumerate(data.get("env") or []):
        if not isinstance(entry, dict) or not entry.get("key") or not entry.get("label"):
            errors.append(f"env[{i}] needs 'key' and 'label'")
    return errors


def render_env(answers: dict[str, str]) -> str:
    """Wizard answers -> .env text. Values are written verbatim (compose does the
    ${VAR} substitution)."""
    return "".join(f"{k}={v}\n" for k, v in answers.items())


def expand_vars(text: str, answers: dict[str, str]) -> str:
    """Substitute ${VAR} from answers (used for the `directories` paths Loskai mkdir-s
    before compose runs). Unknown vars are left as-is."""
    return _VAR_RE.sub(lambda m: answers.get(m.group(1), m.group(0)), text)


# --- Source scanning + merge (filesystem) ---


def _repo_cache() -> Path:
    return Path(settings.data_dir) / "recipes-cache"


def _local_dir() -> Path:
    return Path(settings.data_dir) / "recipes"


def _load_folder(folder: Path, source: str) -> dict:
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
        "instructions": instructions.read_text(encoding="utf-8") if instructions.is_file() else "",
        "source": source,
    }


def _scan(base: Path, source: str) -> tuple[dict[str, dict], list[dict]]:
    valid: dict[str, dict] = {}
    invalid: list[dict] = []
    if not base.is_dir():
        return valid, invalid
    for folder in sorted(p for p in base.iterdir() if p.is_dir()):
        try:
            valid[folder.name] = _load_folder(folder, source)
        except RecipeError as exc:
            invalid.append({"id": folder.name, "source": source, "error": str(exc)})
    return valid, invalid


def list_recipes() -> dict:
    """Merged recipe list. Repo wins on a name clash; the shadowed local copy is flagged
    (`shadowed: true`), never silently dropped."""
    repo, repo_bad = _scan(_repo_cache(), "repo")
    local, local_bad = _scan(_local_dir(), "local")

    merged: dict[str, dict] = dict(local)
    shadowed: list[dict] = []
    for rid, recipe in repo.items():
        if rid in local:
            shadowed.append({"id": rid, "shadowed_by": "repo"})
        merged[rid] = recipe  # repo wins

    return {
        "recipes": sorted(merged.values(), key=lambda r: r["name"].lower()),
        "invalid": repo_bad + local_bad,
        "shadowed": shadowed,
    }


def get_recipe(recipe_id: str) -> dict:
    for recipe in list_recipes()["recipes"]:
        if recipe["id"] == recipe_id:
            return recipe
    raise RecipeError(f"recipe '{recipe_id}' not found")


def _recipe_folder(recipe_id: str, source: str) -> Path:
    base = _repo_cache() if source == "repo" else _local_dir()
    return base / recipe_id


# --- Sync (git I/O) ---


def sync_recipes() -> dict:
    """Clone/pull the public recipes repo into the settings-volume cache. No auth
    (public). Explicit only — never background-polled. Falls back to the last cache."""
    url = settings_store.value("recipes_repo_url")
    if not url:
        raise RecipeError("recipes_repo_url is not set")
    cache = _repo_cache()
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
    return {"ok": True, "output": (proc.stdout + proc.stderr).strip()}


# --- Install (compose I/O) ---


def install_recipe(recipe_id: str, answers: dict[str, str]) -> dict:
    """Create the stack dir, write compose.yml + a generated .env, run the type's
    command, and register a docker instance. Never executes recipe-supplied code."""
    if not stacks.stacks_dir_ok():
        raise RecipeError("stacks directory not found — check the compose mount")
    recipe = get_recipe(recipe_id)
    folder = _recipe_folder(recipe_id, recipe["source"])
    compose_src = next((folder / n for n in ("compose.yml", "compose.yaml") if (folder / n).is_file()), None)
    if compose_src is None:
        raise RecipeError("recipe compose.yml missing")

    target = stacks.stacks_dir() / recipe_id
    if target.exists():
        raise RecipeError(f"a stack named '{recipe_id}' already exists")

    # Pre-create any declared directories (with ${VAR} expanded from the answers).
    for raw in recipe["directories"]:
        Path(expand_vars(str(raw), answers)).mkdir(parents=True, exist_ok=True)

    if recipe["type"] == "git_build":
        _git_clone(recipe["git_repo"], target)
    else:
        target.mkdir(parents=True)

    (target / "compose.yml").write_text(compose_src.read_text(encoding="utf-8"), encoding="utf-8")
    (target / ".env").write_text(render_env(answers), encoding="utf-8")

    build = recipe["type"] == "git_build"
    result = _compose_up(target, build=build)

    instances_store.upsert_instance(
        Instance(id=recipe_id, name=recipe["name"], type="docker", container=recipe_id)
    )
    return {"ok": result["ok"], "output": result["output"], "instance_id": recipe_id}


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
