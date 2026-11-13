"""Recipe engine — declarative install manifests, validated but never executed.

Sources are merged into one list: every enabled git repo (in priority order) and then the
local dir in the state volume, which is always scanned last and cannot be disabled. The
first source to define a recipe id wins; a later copy is flagged, not dropped. See
docs/reference/recipe-schema.md — the contract recipes are authored against.

The manifest's rules are `manifest.py`'s, the install `install.py`'s; here are the
sources, the scan and merge (filesystem), and the sync (git).
"""

import hashlib
import logging
import re
import subprocess
from pathlib import Path

import yaml

from ...config import settings
from ...shared import icons
from ...shared import settings as settings_store
from . import logic
from .manifest import RecipeError, validate_manifest

logger = logging.getLogger(__name__)

SOURCE_LOCAL = "local"
_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]")
GIT_TIMEOUT = 120


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


def source_labels(sources: list[dict]) -> dict[str, str]:
    """url -> label for every configured source. A short label two sources share (two
    forks both called `loskai-recipes`), or one that reads as the local dir, falls back to
    the URL itself — recipe counts and shadow notes are keyed by label."""
    short = {s["url"]: source_label(s["url"], s.get("name")) for s in sources}
    taken = [*short.values(), SOURCE_LOCAL]
    return {
        url: label if taken.count(label) == 1 else url.split("://", 1)[-1].rstrip("/").removesuffix(".git")
        for url, label in short.items()
    }


def _cache_root() -> Path:
    return Path(settings.data_dir) / "recipes-cache"


def repo_cache(url: str) -> Path:
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
    compose = recipe_compose(folder)
    if compose is None:
        errors.append("compose.yml missing")
    elif logic.sets_project_name(compose.read_text(encoding="utf-8")):
        # The project is named after the recipe folder: that is what the install reads its
        # container back by, and what the Stacks tab's own compose runs would disagree with.
        errors.append("compose.yml sets a top-level 'name:' — remove it; the recipe folder names the project")
    # Optional. Checked by the same rules as an uploaded icon, and PNG only — it ends up
    # served publicly from Loskai's own origin, like any launcher icon.
    icon = folder / ICON_FILE
    if icon.is_file():
        try:
            if icons.sniff(icon.read_bytes())[0] != "png":
                errors.append(f"{ICON_FILE} is not a PNG")
        except icons.IconError as exc:
            errors.append(f"{ICON_FILE}: {exc}")
    mounts = None
    if not errors and "mounts" in data:
        service, problem = _mount_service(compose.read_text(encoding="utf-8"), data.get("service"))
        if problem:
            errors.append(problem)
        mounts = {
            "label": data["mounts"]["label"],
            "target": data["mounts"]["target"],
            "read_only": data["mounts"].get("read_only", True),
            "service": service,
        }
    options = []
    # Only once the manifest is valid: each option's service is read from compose.yml.
    for i, opt in enumerate((data.get("options") or []) if not errors else []):
        service, problem = _mount_service(
            compose.read_text(encoding="utf-8"), opt.get("service") or data.get("service"), f"options[{i}]"
        )
        if problem:
            errors.append(problem)
        options.append({
            "id": opt["id"], "label": opt["label"], "help": opt.get("help"), "service": service,
            "set": opt["set"],
        })
    if errors:
        raise RecipeError("; ".join(errors))
    instructions = folder / "instructions.md"
    return {
        "id": folder.name,
        "name": data["name"],
        "type": data["type"],
        "description": data.get("description"),
        "env": data.get("env") or [],
        "suggested_subdomain": data.get("suggested_subdomain"),
        # Which compose service is the published one, when the recipe runs several
        # (logic.primary_container). Optional — one service needs no declaration.
        "service": data.get("service"),
        # Where a link the app logs after install points (a login): the wizard's last step
        # shows the newest one under it from the container's logs.
        "log_link": data.get("log_link"),
        "mounts": mounts,
        "options": options,
        "icon": icon.is_file(),
        "instructions": instructions.read_text(encoding="utf-8") if instructions.is_file() else "",
        "source": source,
        "source_url": source_url,
        "path": str(folder),
    }


def recipe_compose(folder: Path) -> Path | None:
    """A recipe folder's compose file — `compose.yml`, or `compose.yaml`."""
    return next((folder / n for n in ("compose.yml", "compose.yaml") if (folder / n).is_file()), None)
ICON_FILE = "icon.png"


def icon_path(recipe_id: str) -> Path:
    """The recipe's icon file, for the wizard's thumbnail. RecipeError when it has none."""
    recipe = get_recipe(recipe_id)
    if not recipe["icon"]:
        raise RecipeError(f"recipe '{recipe_id}' has no icon", 404)
    return Path(recipe["path"]) / ICON_FILE


def _mount_service(compose_text: str, declared: str | None, what: str = "'mounts'") -> tuple[str | None, str | None]:
    """The service a recipe's `mounts` (or an option) go into — its `service`, or its only one."""
    services = logic.declared_services(compose_text)
    if declared:
        if declared in services:
            return declared, None
        return None, f"'service: {declared}' is not a service in compose.yml"
    if len(services) == 1:
        return next(iter(services)), None
    return None, f"{what} needs 'service' to say which compose service it is for"


def _scan(base: Path, source: str, source_url: str | None) -> tuple[dict[str, dict], list[dict]]:
    valid: dict[str, dict] = {}
    invalid: list[dict] = []
    if not base.is_dir():
        return valid, invalid
    # A synced source is a git clone, so `.git` sits beside the recipes.
    for folder in sorted(p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")):
        try:
            valid[folder.name] = _load_folder(folder, source, source_url)
        except RecipeError as exc:
            invalid.append({"id": folder.name, "source": source, "error": str(exc)})
    return valid, invalid


def merged_recipes() -> dict:
    """Scan every enabled source in priority order, then the local dir.

    First source to define a recipe id wins; a later copy is flagged in `shadowed` (with
    both the source it came from and the one that beat it), never silently dropped. The
    local dir goes last deliberately: it is where in-progress manifests live, and a
    maintained repo staying authoritative is what makes "give the variant a distinct
    name" the right advice.

    Recipes carry their folder `path` here; `list_recipes` drops it for the API.
    """
    labels = source_labels(settings_store.recipe_sources()[0])
    scans = [(labels[s["url"]], s["url"], repo_cache(s["url"])) for s in enabled_sources()]
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


def _source_status(source: dict, label: str, counts: dict[str, int]) -> dict:
    """One source as the UI shows it: what it is, and whether it has ever synced."""
    cache = repo_cache(source["url"])
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
    merged = merged_recipes()
    recipes = sorted(merged["recipes"].values(), key=lambda r: r["name"].lower())
    counts: dict[str, int] = {}
    for recipe in recipes:
        counts[recipe["source"]] = counts.get(recipe["source"], 0) + 1
    sources, sources_source = settings_store.recipe_sources()
    labels = source_labels(sources)
    return {
        "recipes": [{k: v for k, v in r.items() if k != "path"} for r in recipes],
        "invalid": merged["invalid"],
        "shadowed": merged["shadowed"],
        # So the wizard's empty state can tell "no sources configured" apart from
        # "configured but never synced" — two very different things to tell the user.
        "sources": [_source_status(s, labels[s["url"]], counts) for s in sources],
        "sources_source": sources_source,
        "local_count": counts.get(SOURCE_LOCAL, 0),
    }


def get_recipe(recipe_id: str) -> dict:
    recipe = merged_recipes()["recipes"].get(recipe_id)
    if recipe is None:
        raise RecipeError(f"recipe '{recipe_id}' not found", 404)
    return recipe


def _sync_one(url: str) -> str:
    cache = repo_cache(url)
    try:
        if (cache / ".git").is_dir():
            # The cache is a mirror, so it follows the source even when its history was
            # rewritten — a pull would refuse a force-push and stop syncing for good. FETCH_HEAD,
            # not a tracking branch: an older cache may have no fetch refspec to make one. Only
            # the tip, as the clone took: the new head's history would otherwise come with it.
            proc = subprocess.run(
                ["git", "-C", str(cache), "fetch", "--depth", "1", "origin", "HEAD"],
                capture_output=True, text=True, timeout=GIT_TIMEOUT,
            )
            if proc.returncode == 0:
                proc = subprocess.run(
                    ["git", "-C", str(cache), "reset", "--hard", "FETCH_HEAD"],
                    capture_output=True, text=True, timeout=GIT_TIMEOUT,
                )
        else:
            cache.parent.mkdir(parents=True, exist_ok=True)
            proc = subprocess.run(
                ["git", "clone", "--depth", "1", url, str(cache)],
                capture_output=True, text=True, timeout=GIT_TIMEOUT,
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

    labels = source_labels(settings_store.recipe_sources()[0])
    results: list[dict] = []
    for source in targets:
        label = labels[source["url"]]
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


def source_commit(url: str | None) -> str | None:
    """The commit a git source's cache is at; None for the local folder or a cache git
    can't read."""
    if url is None:
        return None
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_cache(url)), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=GIT_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None
