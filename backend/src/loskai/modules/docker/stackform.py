"""The stack editor's form: a stack's files read as fields, and the fields written back.

Three parts, one per file. Settings are the `.env` — one field per variable the stack
uses, labelled by its recipe's question where it has one. Folders are the bind mounts in
`compose.override.yml`. The app is `compose.yml` as values only — read-only, because it
is the recipe's and Check for updates replaces it.

The form changes only what it shows: an unchanged `.env` line stays as written, and an
override's other keys and the mounts it can't show are kept. Pure helpers first, then
the filesystem I/O.
"""

import re

import yaml

from ...shared import store
from . import dotenv, logic, override, recipes, stacks
from .stacks import StackError

_VAR_RE = re.compile(r"\$\$|\$\{([A-Za-z_]\w*)(?:(:?[-?+])([^}]*))?\}|\$([A-Za-z_]\w*)")
# The headers Loskai writes — not the user's comments. The first is from before Phase 31.
_OWN_HEADERS = {
    "# Folders added in Loskai's install wizard. Reinstall to change them.",
    override.OVERRIDE_HEADER.strip(),
}


# --- Pure: compose.yml ---


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def referenced(doc: object) -> dict[str, str | None]:
    """The variables a loaded compose file reads, in order, each with the default it gives
    (`${PORT:-8096}` → 8096). Read from the loaded YAML, so a `${X}` in a comment is not one."""
    found: dict[str, str | None] = {}
    for s in _strings(doc):
        for m in _VAR_RE.finditer(s):
            name = m[1] or m[4]
            if not name:
                continue
            default = m[3] if m[2] in (":-", "-") else None
            if found.get(name) is None:
                found[name] = default
    return found


def interpolate(text: str, values: dict[str, str]) -> str:
    """Compose's `${VAR}` substitution, enough to show a value as it will be."""
    def sub(m: re.Match) -> str:
        if m[0] == "$$":
            return "$"
        name, op, arg = m[1] or m[4], m[2], m[3]
        value = values.get(name)
        if op in (":-", "-"):
            unset = value is None or (op == ":-" and value == "")
            return arg if unset else value
        if op in (":+", "+"):
            set_ = value is not None and (op == "+" or value != "")
            return arg if set_ else ""
        return value or ""

    return _VAR_RE.sub(sub, text)


def _arrow(spec: str) -> str:
    """`8096:8096` → `8096 → 8096`, `./config:/config:ro` → `./config → /config (read-only)`."""
    suffix = ""
    if re.search(r":(ro|rw|z|Z)(,[a-zA-Z]+)*$", spec):
        spec, _, mode = spec.rpartition(":")
        suffix = " (read-only)" if "ro" in mode.split(",") else ""
    host, sep, inner = spec.rpartition(":")
    return f"{host} → {inner}{suffix}" if sep else spec + suffix


def app_summary(doc: object, values: dict[str, str]) -> list[dict]:
    """Per service, what compose.yml runs: image, ports and folders, interpolated."""
    services = doc.get("services") if isinstance(doc, dict) else None
    out = []
    for name, svc in (services or {}).items():
        svc = svc if isinstance(svc, dict) else {}

        def show(v) -> str:
            if isinstance(v, dict):
                host = v.get("published") or v.get("source") or ""
                inner = v.get("target") or ""
                return interpolate(f"{host} → {inner}" if host else str(inner), values)
            return interpolate(_arrow(str(v)), values)

        out.append({
            "service": name,
            "image": interpolate(str(svc["image"]), values) if svc.get("image") else ("built from source" if svc.get("build") else None),
            "network": svc.get("network_mode"),
            "ports": [show(p) for p in svc.get("ports") or []],
            "volumes": [show(v) for v in svc.get("volumes") or []],
        })
    return out


# --- Pure: compose.override.yml ---


def folders_problem(folders: list[dict], services: set[str]) -> str | None:
    seen: set[tuple[str, str]] = set()
    for f in folders:
        source, target = f["source"].strip(), f["target"].strip()
        if f["service"] not in services:
            return f"'{f['service']}' is not a service in this stack"
        if not source:
            return "a folder has no host path"
        problem = recipes.path_problem(source)
        if problem:
            return f"{source}: {problem}"
        if not target.startswith("/") or ":" in target:
            return f"{source}: the path inside the container must start with /, like /media"
        if (f["service"], target) in seen:
            return f"two folders land at {target}"
        seen.add((f["service"], target))
    return None


# --- I/O ---


def _base(base: object) -> tuple[str, str] | None:
    """Unsaved `.env` and override text from the text view, or None for the files on disk."""
    if base is None:
        return None
    if not isinstance(base, dict) or not isinstance(base.get("env"), str) or not isinstance(base.get("override"), str):
        raise StackError("base needs env and override as text")
    return base["env"], base["override"]


def _options(recipe: dict | None, declared: set[str]) -> list[dict]:
    """The recipe's options this stack can take. A stack named like a recipe but written by
    hand may not have the option's service, and switching it on would add one to the override."""
    return [o for o in (recipe or {}).get("options") or [] if o["service"] in declared]


def _disk(directory) -> tuple[str, str]:
    env_file = directory / ".env"
    override_file = stacks.override_path(directory)
    return (
        env_file.read_text(encoding="utf-8") if env_file.is_file() else "",
        override_file.read_text(encoding="utf-8") if override_file else "",
    )


def get_form(name: str, base: dict | None = None) -> dict:
    """The stack as fields — from its files, or from `base`: the text view's unsaved `.env`
    and override, so switching back to the form keeps what was typed there."""
    directory = stacks.stack_path(name)
    compose = stacks.compose_path(directory)
    if compose is None:
        raise StackError(f"stack '{name}' not found", 404)
    compose_text = compose.read_text(encoding="utf-8")
    try:
        doc = yaml.safe_load(compose_text)
    except yaml.YAMLError:
        raise StackError(f"{compose.name} doesn't load — use Edit as text")
    env_text, override_text = _base(base) or _disk(directory)
    problem = override_text.strip() and logic.yaml_problem(override_text)
    if problem:
        raise StackError(f"compose.override.yml {problem}")
    env = dotenv.parse_env(env_text)
    recipe = recipes.stack_recipe(directory)
    questions = {str(q["key"]): q for q in (recipe["env"] if recipe else [])}

    variables = referenced(doc)
    settings = []
    for key in dict.fromkeys([*questions, *variables, *env]):
        q = questions.get(key, {})
        default = q.get("default")
        if default is None:
            default = variables.get(key)
        settings.append({
            "key": key,
            "label": q.get("label"),
            "value": env.get(key, ""),
            "default": None if default is None else str(default),
        })

    declared = logic.declared_services(compose_text)
    options = _options(recipe, declared)
    # An option's own lines aren't "something else" in the override: read the rest with
    # every option off. One the form can't switch (not a list) leaves it as it is.
    try:
        rest = override.set_options(override_text, options, {o["id"]: False for o in options})
    except override.OverrideError:
        rest = override_text
    folders, _ = override.parse_override(override_text)
    _, other = override.parse_override(rest)
    return {
        "settings": settings,
        "folders": folders,
        "override_other": other,
        # Saving folders rewrites the file through YAML, which drops comments: said first.
        "override_comments": any(
            line.lstrip().startswith("#") and line.strip() not in _OWN_HEADERS
            for line in override_text.splitlines()
        ),
        "services": sorted(declared),
        "app": app_summary(doc, env),
        "options": [
            {"id": o["id"], "label": o["label"], "help": o["help"], "on": override.option_on(override_text, o)}
            for o in options
        ],
        "recipe": {"id": recipe["id"], "name": recipe["name"], "icon": recipe["icon"]} if recipe else None,
    }


def save_form(
    name: str,
    settings: dict[str, str] | None,
    folders: list[dict] | None,
    preview: bool = False,
    base: dict | None = None,
    options: dict[str, bool] | None = None,
) -> dict | None:
    """Write what the form changed: `settings` are the changed values only, `folders` the
    whole list when it changed — a row left blank is skipped — `options` the switches that
    changed, by id; all applied to the files on disk,
    or to `base`, the text view's unsaved `.env` and override. Everything is checked before
    anything is written. `preview` writes nothing and returns the `.env` and override the
    save would leave, for the text view to open with."""
    directory = stacks.stack_path(name)
    compose = stacks.compose_path(directory)
    if compose is None:
        raise StackError(f"stack '{name}' not found", 404)
    disk_env, disk_override = _disk(directory)
    env_text, override_text = _base(base) or (disk_env, disk_override)
    declared = logic.declared_services(compose.read_text(encoding="utf-8"))
    # Looked up once: it scans every recipe source.
    recipe = recipes.stack_recipe(directory) if options or settings else None

    new_override = override_text
    if folders is not None:
        rows = []
        for f in folders:
            if not isinstance(f, dict):
                raise StackError("each folder needs service, source, target and writable")
            row = {
                "service": str(f.get("service", "")),
                "source": str(f.get("source", "")),
                "target": str(f.get("target", "")),
                "writable": bool(f.get("writable", True)),
            }
            if row["source"].strip() or row["target"].strip():
                rows.append(row)
        problem = folders_problem(rows, declared)
        if problem:
            raise StackError(problem)
        try:
            new_override = override.build_override(override_text, rows) or ""
        except yaml.YAMLError:
            raise StackError(f"compose.override.yml {logic.yaml_problem(override_text)}")
    elif new_override.strip():
        problem = logic.yaml_problem(new_override)
        if problem:
            raise StackError(f"compose.override.yml {problem}")
    if options:
        spec = _options(recipe, declared)
        unknown = sorted(set(options) - {o["id"] for o in spec})
        if unknown:
            raise StackError(f"this stack has no option {', '.join(unknown)}")
        try:
            new_override = override.set_options(new_override, spec, {k: bool(v) for k, v in options.items()})
        except yaml.YAMLError:
            raise StackError(f"compose.override.yml {logic.yaml_problem(new_override)}")
    new_env = env_text
    if settings:
        bad = [k for k in settings if not dotenv.KEY_RE.fullmatch(str(k))]
        if bad:
            raise StackError(f"not a variable name: {', '.join(bad)}")
        questions = {str(q["key"]): q for q in ((recipe or {}).get("env") or [])}
        for key, value in settings.items():
            if questions.get(key, {}).get("type") == "path" and str(value).strip():
                problem = recipes.path_problem(str(value))
                if problem:
                    raise StackError(f"{questions[key]['label']}: {problem}")
        new_env = dotenv.set_env(env_text, {str(k): str(v) for k, v in settings.items()})

    if preview:
        return {"env": new_env, "override": new_override}
    if new_env != disk_env:
        store.write_private(directory / ".env", new_env)
    if new_override != disk_override:
        target = stacks.override_path(directory) or directory / stacks.OVERRIDE_NAME
        if new_override.strip():
            target.write_text(new_override, encoding="utf-8")
        else:
            target.unlink(missing_ok=True)
    return None
