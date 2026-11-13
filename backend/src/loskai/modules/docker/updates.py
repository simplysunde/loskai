"""Check for updates: which installed recipes the recipe has moved on from, and applying one.

Each file in an installed stack has one owner. `compose.yml` is the recipe's — an update
replaces it. `.env` holds the answers — an update only adds a line for a question it didn't
have. `compose.override.yml` is the user's — an update never touches it, and is refused if
the new compose.yml won't load with it.

Pure helpers first, then the filesystem and git I/O, as in recipes.py.
"""

import difflib
import os
import re
import subprocess
from pathlib import Path

import yaml

from ...shared import store
from . import dotenv, recipes, stacks
from .recipes import RecipeError
from .stacks import StackError

_TRAILER_RE = re.compile(r"^[A-Za-z][\w-]*: \S")
_NEXT_NAME = ".compose.next.yml"
_UPDATABLE = {"available", "edited", "untracked"}


# --- Pure ---


def status(installed: str, offered: str, recorded: str | None) -> str:
    """Where an installed compose.yml stands against its recipe's.

    current — nothing new from the recipe. available — the recipe changed and the file is
    as installed. edited — the recipe changed, and so did the file, by hand. untracked —
    installed before records were kept, and it differs. A hand edit with the recipe
    unchanged is current: the difference is the user's own, not an update."""
    if installed == offered:
        return "current"
    if recorded is None:
        return "untracked"
    if recipes.fingerprint(offered) == recorded:
        return "current"
    return "available" if recipes.fingerprint(installed) == recorded else "edited"


def compose_diff(installed: str, offered: str) -> str:
    def lines(text: str) -> list[str]:
        return (text if text.endswith("\n") or not text else text + "\n").splitlines(keepends=True)

    return "".join(difflib.unified_diff(lines(installed), lines(offered), "installed", "recipe"))


def image_changes(installed: str, offered: str) -> list[dict]:
    """Per service, the image before and after — the headline of most updates."""
    def images(text: str) -> dict[str, str]:
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError:
            return {}
        services = doc.get("services") if isinstance(doc, dict) else None
        if not isinstance(services, dict):
            return {}
        return {n: str(s["image"]) for n, s in services.items() if isinstance(s, dict) and s.get("image")}

    before, after = images(installed), images(offered)
    return [
        {"service": s, "from": before.get(s), "to": after.get(s)}
        for s in sorted(before.keys() | after.keys())
        if before.get(s) != after.get(s)
    ]


def new_questions(env_spec: list[dict], env_text: str) -> tuple[dict[str, str], list[str]]:
    """The recipe's questions the .env has no line for: the defaults to add, and the keys
    with no default — which an update can't answer, so it is refused."""
    have = set(dotenv.parse_env(env_text))
    defaults: dict[str, str] = {}
    unanswered: list[str] = []
    for entry in env_spec:
        key = str(entry["key"])
        if key in have:
            continue
        if entry.get("default") is None:
            unanswered.append(key)
        else:
            defaults[key] = str(entry["default"])
    return defaults, unanswered


def strip_trailers(body: str) -> str:
    """A commit body without its closing `Key: value` trailers — sign-offs and the like
    say nothing about what changed."""
    paragraphs = body.strip().split("\n\n")
    if paragraphs and all(_TRAILER_RE.match(line) for line in paragraphs[-1].splitlines()):
        paragraphs.pop()
    return "\n\n".join(paragraphs).strip()


def parse_log(output: str) -> list[dict]:
    """`git log --format=%H%x1f%as%x1f%s%x1f%b%x1e` → newest first."""
    commits = []
    for record in output.split("\x1e"):
        fields = record.strip("\n").split("\x1f")
        if len(fields) == 4:
            sha, date, subject, body = fields
            commits.append({"commit": sha[:7], "date": date, "subject": subject, "body": strip_trailers(body)})
    return commits


# --- I/O ---


def _offered(recipe: dict) -> str:
    folder = Path(recipe["path"])
    path = recipes.recipe_compose(folder)
    return path.read_text(encoding="utf-8")


def _commits_since(recipe: dict, since: str | None) -> list[dict]:
    """The recipe folder's commits since the install. Empty for the local folder, an
    install with no record, or a commit the cache no longer has."""
    if not since or recipe["source_url"] is None:
        return []
    cache = recipes.repo_cache(recipe["source_url"])
    try:
        folder = Path(recipe["path"]).relative_to(cache)
        proc = subprocess.run(
            ["git", "-C", str(cache), "log", "--format=%H%x1f%as%x1f%s%x1f%b%x1e", f"{since}..HEAD", "--", str(folder)],
            capture_output=True, text=True, timeout=recipes.GIT_TIMEOUT,
        )
    except (ValueError, FileNotFoundError, subprocess.TimeoutExpired):
        return []
    return parse_log(proc.stdout) if proc.returncode == 0 else []


def _entry(directory: Path, compose: Path, record: dict | None, recipe: dict) -> dict:
    installed = compose.read_text(encoding="utf-8")
    offered = _offered(recipe)
    defaults, unanswered = new_questions(recipe["env"], stacks.env_text(directory))
    state = status(installed, offered, record["compose"] if record else None)
    reason = None
    if recipe["type"] == "git_build":
        reason = "this recipe builds from source — reinstall it to update"
    elif unanswered:
        reason = f"the new version asks for {', '.join(unanswered)} — reinstall to answer"
    changed = state != "current"
    return {
        "stack": directory.name,
        "recipe": recipe["id"],
        "name": recipe["name"],
        "icon": recipe["icon"],
        "source": recipe["source"],
        "status": state,
        "updatable": state in _UPDATABLE and reason is None,
        "reason": reason if changed else None,
        "images": image_changes(installed, offered) if changed else [],
        "diff": compose_diff(installed, offered) if changed else "",
        "commits": _commits_since(recipe, record.get("commit") if record else None) if changed else [],
        "new_env": sorted(defaults) if changed else [],
    }


def _installed() -> list[tuple[Path, Path, dict | None, dict | None, str]]:
    """Each stack that came from a recipe — by its record, or for one from before records,
    by a name some recipe has: (folder, compose file, record, recipe or None, recipe id)."""
    catalog = recipes.merged_recipes()["recipes"]
    found = []
    base = stacks.stacks_dir()
    for directory in sorted(p for p in base.iterdir() if p.is_dir()) if base.is_dir() else []:
        compose = stacks.compose_path(directory)
        if compose is None:
            continue
        record, rid = recipes.installed_as(directory)
        if record or rid in catalog:
            found.append((directory, compose, record, catalog.get(rid), rid))
    return found


def list_updates() -> list[dict]:
    """Every installed recipe and whether it can be updated. Reads the caches as they are:
    the dialog syncs first (`POST /recipes/refresh`), as every sync is explicit."""
    out = []
    for directory, compose, record, recipe, rid in _installed():
        if recipe is None:
            out.append({
                "stack": directory.name, "recipe": rid, "name": rid, "icon": False, "source": None,
                "status": "gone", "updatable": False, "reason": "no enabled source has this recipe any more",
                "images": [], "diff": "", "commits": [], "new_env": [],
            })
        else:
            out.append(_entry(directory, compose, record, recipe))
    return out


def apply_update(name: str) -> dict:
    """Replace the stack's compose.yml with its recipe's, then pull + up.

    Checked first with `docker compose config` against the stack's own override and .env,
    so an update the user's files can't run with is refused before anything is written."""
    for directory, compose, record, recipe, _ in _installed():
        if directory.name == name:
            break
    else:
        raise StackError(f"stack '{name}' was not installed from a recipe")
    if recipe is None:
        raise RecipeError("no enabled source has this recipe any more")
    entry = _entry(directory, compose, record, recipe)
    if not entry["updatable"]:
        raise RecipeError(entry["reason"] or "already up to date")

    offered = _offered(recipe)
    candidate = directory / _NEXT_NAME
    candidate.write_text(offered, encoding="utf-8")
    override = stacks.override_path(directory)
    files = ["-f", _NEXT_NAME] + (["-f", override.name] if override else [])
    checked = stacks.run_compose(directory, *files, "config", "--quiet")
    if not checked["ok"]:
        candidate.unlink(missing_ok=True)
        raise RecipeError(f"the new version doesn't load with this stack's files: {checked['output']}")
    os.replace(candidate, compose)

    text = stacks.env_text(directory)
    defaults, _ = new_questions(recipe["env"], text)
    if defaults:
        store.write_private(directory / ".env", text + ("" if not text or text.endswith("\n") else "\n") + dotenv.render_env(defaults))
    recipes.write_record(directory, recipe, offered)
    return stacks.stack_action(name, "pull")
