"""A recipe's manifest: the rules a `recipe.yml` is checked against, and the install answers
checked against it — docs/reference/recipe-schema.md is the contract.

Pure: nothing here reads a folder or runs anything. `recipes.py` reads the manifests,
`install.py` uses the answers, and `check_recipes.py` is the same check as a CLI.
"""

import re
from pathlib import PurePosixPath

from ...shared.errors import LoskaiError
from . import dotenv

VALID_TYPES = {"pull"}
# An `env` entry's `type`: what the wizard asks for, and how the answer is checked.
# `path` is a host folder mounted into the container (see path_problem).
ENV_TYPES = {"text", "path"}
# An option's id: what `options` in a stack's form and an install name it by.
_OPTION_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
# A host and a path: `https://login.example.com` alone would also match
# `https://login.example.com.elsewhere.net`.
_LOG_LINK_RE = re.compile(r"https://[A-Za-z0-9.-]+(:[0-9]+)?/\S*")
# What an option may add to a service: lists that extend it, and `deploy` for a GPU
# reservation — never anything that replaces what the recipe set up.
OPTION_KEYS = ("devices", "group_add", "environment", "cap_add", "ports", "deploy")


class RecipeError(LoskaiError):
    pass


def validate_manifest(data: object) -> list[str]:
    """Return a list of reasons the manifest is invalid (empty = valid)."""
    if not isinstance(data, dict):
        return ["recipe.yml is not a mapping"]
    errors: list[str] = []
    if not data.get("name"):
        errors.append("missing 'name'")
    elif not isinstance(data["name"], str):
        # YAML reads `name: 2048` as a number; quoted, it is text.
        errors.append("'name' must be text — quote it")
    rtype = data.get("type")
    if rtype not in VALID_TYPES:
        errors.append(f"'type' must be one of {sorted(VALID_TYPES)}")
    if "service" in data and not isinstance(data.get("service"), str):
        errors.append("'service' must be a compose service name")
    if "log_link" in data and not (
        isinstance(data["log_link"], str) and _LOG_LINK_RE.fullmatch(data["log_link"])
    ):
        errors.append("'log_link' must be an https:// address with a path, like https://login.example.com/")
    if "directories" in data:
        # Removed 2026-10-04: Loskai made them *inside its own container*, so any path
        # outside the stacks folder became a folder no one would ever see. Docker creates a
        # missing bind folder on the host itself.
        errors.append("'directories' is no longer supported — declare a `type: path` env entry")
    if "mounts" in data:
        errors.extend(_mounts_problems(data["mounts"]))
    if "options" in data:
        errors.extend(_options_problems(data["options"]))
    for i, entry in enumerate(data.get("env") or []):
        if not isinstance(entry, dict) or not entry.get("key") or not entry.get("label"):
            errors.append(f"env[{i}] needs 'key' and 'label'")
            continue
        if not dotenv.KEY_RE.fullmatch(str(entry["key"])):
            errors.append(f"env[{i}] key '{entry['key']}' is not a valid variable name")
        etype = entry.get("type", "text")
        if etype not in ENV_TYPES:
            errors.append(f"env[{i}] type must be one of {sorted(ENV_TYPES)}")
        elif etype == "path" and entry.get("default"):
            problem = path_problem(str(entry["default"]))
            if problem:
                errors.append(f"env[{i}] default: {problem}")
    return errors


def _mounts_problems(mounts: object) -> list[str]:
    """`mounts`: a group of folders the user picks at install — however many they have —
    each mounted at `target/<its name>` in the published service. Deliberately one group,
    one service, one read_only for all: past that it is a volume editor."""
    if not isinstance(mounts, dict):
        return ["'mounts' must be a mapping with 'label' and 'target'"]
    errors: list[str] = []
    if not isinstance(mounts.get("label"), str) or not mounts["label"]:
        errors.append("mounts needs a 'label'")
    target = mounts.get("target")
    if not isinstance(target, str) or not target.startswith("/") or not target.strip("/") or ":" in target:
        errors.append("mounts 'target' must be an absolute container path, like /media")
    if not isinstance(mounts.get("read_only", True), bool):
        errors.append("mounts 'read_only' must be true or false")
    return errors


def _options_problems(options: object) -> list[str]:
    """`options`: features the user switches on — a GPU, a USB device, an extra port. Each is
    a fragment of Compose for one service, added to the override when on and removed when
    off. Only keys that add to a service without replacing what the recipe set up."""
    if not isinstance(options, list):
        return ["'options' must be a list"]
    errors: list[str] = []
    seen: set[str] = set()
    for i, opt in enumerate(options):
        if not isinstance(opt, dict):
            errors.append(f"options[{i}] must be a mapping")
            continue
        oid = opt.get("id")
        if not isinstance(oid, str) or not _OPTION_ID_RE.fullmatch(oid):
            errors.append(f"options[{i}] needs an 'id' of lowercase letters, digits, - and _")
        elif oid in seen:
            errors.append(f"options[{i}] id '{oid}' is used twice")
        else:
            seen.add(oid)
        if not isinstance(opt.get("label"), str) or not opt["label"]:
            errors.append(f"options[{i}] needs a 'label'")
        if "help" in opt and not isinstance(opt["help"], str):
            errors.append(f"options[{i}] 'help' must be text")
        if "service" in opt and not isinstance(opt["service"], str):
            errors.append(f"options[{i}] 'service' must be a compose service name")
        fragment = opt.get("set")
        if not isinstance(fragment, dict) or not fragment:
            errors.append(f"options[{i}] needs 'set': the Compose keys it adds")
            continue
        for key, values in fragment.items():
            if key not in OPTION_KEYS:
                errors.append(f"options[{i}] can't set '{key}' — only {', '.join(OPTION_KEYS)}")
            elif key == "deploy":
                # A GPU reservation (NVIDIA): `resources.reservations.devices`, a mapping.
                if not isinstance(values, dict) or not values:
                    errors.append(f"options[{i}] 'deploy' must be a mapping, like resources: reservations: …")
            elif (
                not isinstance(values, list)
                or not values
                or not all(isinstance(v, (str, int)) and not isinstance(v, bool) for v in values)
            ):
                errors.append(f"options[{i}] '{key}' must be a list, like - /dev/dri:/dev/dri")
    return errors


def path_problem(value: str) -> str | None:
    """Why a host path can't be mounted as written, or None.

    Checked because each of these *installs*: Compose accepts all three and does something
    other than intended. `~` expands inside the Loskai container, where compose runs as
    root — `/root`, not your home. A bare name (`data`) is a named volume to Compose, not
    a folder. A `:` splits the `source:target` spec in two."""
    v = value.strip()
    if v.startswith("~"):
        return "'~' would be the Loskai container's home (/root), not yours — write the full path"
    if ":" in v:
        return "a path can't contain ':' — it would split the volume spec"
    if v and not v.startswith(("/", "./", "../")):
        return f"start a relative path with ./ — a bare '{v}' is a Docker volume, not a folder"
    return None


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
        if given is None:
            given = entry.get("default")  # a bare `default:` is None too, not "None"
        value = "" if given is None else str(given)
        if entry.get("type") == "path":
            # Always required: an empty source makes `:/data`, which Compose rejects —
            # after the stack folder has been made.
            value = value.strip()
            if not value:
                raise RecipeError(f"'{entry['label']}' is required — the folder to mount")
            problem = path_problem(value)
            if problem:
                raise RecipeError(f"'{entry['label']}': {problem}")
        values[str(entry["key"])] = value
    return values


def resolve_mounts(spec: dict | None, folders: list) -> list[tuple[str, str]]:
    """(host folder, container path) for each folder the user added: each lands at
    `target/<its own name>`, so `/srv/media/anime` becomes `/media/anime`."""
    if not isinstance(folders, list):
        raise RecipeError("'mounts' must be a list of folders")
    if not folders:
        return []
    if spec is None:
        raise RecipeError("this recipe takes no extra folders")
    pairs: list[tuple[str, str]] = []
    landed: dict[str, str] = {}
    for raw in folders:
        source = str(raw).strip()
        problem = "a folder is empty" if not source else path_problem(source)
        if problem:
            raise RecipeError(f"'{spec['label']}': {problem}")
        name = PurePosixPath(source.rstrip("/")).name
        if name in ("", ".", ".."):
            raise RecipeError(f"'{spec['label']}': '{source}' has no folder name to mount it under")
        target = f"{spec['target'].rstrip('/')}/{name}"
        if target in landed:
            raise RecipeError(
                f"'{landed[target]}' and '{source}' would both land at {target} — "
                "rename one, or mount their parent"
            )
        landed[target] = source
        pairs.append((source, target))
    return pairs


def resolve_options(spec: list[dict], chosen: list) -> dict[str, bool]:
    """The options switched on at install, by id. An id the recipe doesn't have is refused."""
    if not isinstance(chosen, list):
        raise RecipeError("'options' must be a list of option ids")
    known = {o["id"] for o in spec}
    unknown = sorted({str(c) for c in chosen} - known)
    if unknown:
        raise RecipeError(f"this recipe has no option {', '.join(unknown)}")
    return {str(c): True for c in chosen}
