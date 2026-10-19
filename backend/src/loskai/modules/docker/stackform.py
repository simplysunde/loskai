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
from . import logic, recipes, stacks
from .recipes import RecipeError
from .stacks import StackError

_VAR_RE = re.compile(r"\$\$|\$\{([A-Za-z_]\w*)(?:(:?[-?+])([^}]*))?\}|\$([A-Za-z_]\w*)")
_ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_UNESCAPE = {"n": "\n", "r": "\r", "t": "\t"}
# The headers Loskai writes — not the user's comments. The first is from before Phase 31.
_OWN_HEADERS = {
    "# Folders added in Loskai's install wizard. Reinstall to change them.",
    recipes.OVERRIDE_HEADER.strip(),
}


# --- Pure: .env ---


def _env_value(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"') and len(raw) > 1:
        return re.sub(r"\\(.)", lambda m: _UNESCAPE.get(m[1], m[1]), raw[1:-1])
    if raw.startswith("'") and raw.endswith("'") and len(raw) > 1:
        return raw[1:-1]
    return re.split(r"\s+#", raw, maxsplit=1)[0].strip()


def parse_env(text: str) -> dict[str, str]:
    """`.env` text → values, as Compose reads them."""
    values: dict[str, str] = {}
    for line in text.splitlines():
        m = _ENV_LINE_RE.match(line)
        if m and not line.lstrip().startswith("#"):
            values[m[1]] = _env_value(m[2])
    return values


def set_env(text: str, changes: dict[str, str]) -> str:
    """Apply changed values to `.env` text: a changed key's line is rewritten in place, a
    new one appended, a cleared one removed — so the default applies again. Every other
    line, comments included, stays as written."""
    lines: list[str] = []
    done: set[str] = set()
    for line in text.splitlines():
        m = _ENV_LINE_RE.match(line)
        key = m[1] if m and not line.lstrip().startswith("#") else None
        if key in changes:
            if key not in done and changes[key] != "":
                lines.append(recipes.render_env({key: changes[key]}).rstrip("\n"))
            done.add(key)
            continue
        lines.append(line)
    lines += [recipes.render_env({k: v}).rstrip("\n") for k, v in changes.items() if k not in done and v != ""]
    return "\n".join(lines) + "\n" if lines else ""


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


def _folder(entry: object) -> dict | None:
    """One override volume as a form row, or None when the form can't show it: a named
    volume, tmpfs, or a bind with options besides read-only."""
    if isinstance(entry, str):
        parts = entry.split(":")
        if len(parts) not in (2, 3):
            return None
        source, target, mode = parts[0], parts[1], parts[2] if len(parts) == 3 else ""
        if set(mode.split(",")) - {"", "ro", "rw"}:
            return None
        writable = "ro" not in mode.split(",")
    elif isinstance(entry, dict):
        if set(entry) - {"type", "source", "target", "read_only", "bind"} or entry.get("type", "bind") != "bind":
            return None
        bind = entry.get("bind") or {}
        if not isinstance(bind, dict) or set(bind) - {"create_host_path"}:
            return None
        source, target, writable = entry.get("source"), entry.get("target"), not entry.get("read_only", False)
        if not isinstance(source, str) or not isinstance(target, str):
            return None
    else:
        return None
    if not source.startswith(("/", "./", "../")):
        return None
    return {"source": source.replace("$$", "$"), "target": target.replace("$$", "$"), "writable": bool(writable)}


def parse_override(text: str) -> tuple[list[dict], bool]:
    """The override's folders as rows, and whether it sets anything else — which the form
    leaves alone and says is there."""
    doc = yaml.safe_load(text) if text.strip() else None
    if not isinstance(doc, dict):
        return [], bool(text.strip()) and doc is not None
    other = set(doc) - {"services"}
    folders: list[dict] = []
    services = doc.get("services") or {}
    if not isinstance(services, dict):
        return [], True
    for name, svc in services.items():
        if not isinstance(svc, dict):
            other.add(name)
            continue
        if set(svc) - {"volumes"}:
            other.add(name)
        for entry in svc.get("volumes") or []:
            row = _folder(entry)
            if row is None:
                other.add(name)
            else:
                folders.append({"service": name, **row})
    return folders, bool(other)


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


def build_override(text: str, folders: list[dict]) -> str | None:
    """The override with its folders replaced by these — everything the form can't show
    is kept. None when nothing is left, so the file goes."""
    doc = yaml.safe_load(text) if text.strip() else None
    doc = doc if isinstance(doc, dict) else {}
    services = doc.get("services") if isinstance(doc.get("services"), dict) else {}
    for f in folders:
        services.setdefault(f["service"], {})
    for name in list(services):
        svc = services[name]
        if not isinstance(svc, dict):
            continue
        ours = [
            recipes.bind_volume(f["source"].strip(), f["target"].strip(), not f["writable"])
            for f in folders if f["service"] == name
        ]
        kept = [e for e in svc.get("volumes") or [] if _folder(e) is None]
        svc["volumes"] = ours + kept
        if not svc["volumes"]:
            del svc["volumes"]
        if not svc:
            del services[name]
    if services:
        doc["services"] = services
    else:
        doc.pop("services", None)
    if not doc:
        return None
    return recipes.OVERRIDE_HEADER + yaml.safe_dump(doc, sort_keys=False)


# --- I/O ---


def _recipe(directory) -> dict | None:
    """The recipe a stack came from — by its record, or by its name — for its labels."""
    record = recipes.read_record(directory)
    rid = record["recipe"] if record else directory.name
    try:
        return recipes._merged()["recipes"].get(rid)
    except (OSError, RecipeError):
        return None


def get_form(name: str) -> dict:
    directory = stacks._stack_dir(name)
    compose = stacks._compose_file(directory)
    if compose is None:
        raise StackError(f"stack '{name}' not found")
    try:
        doc = yaml.safe_load(compose.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        raise StackError(f"{compose.name} doesn't load — use Edit as text")
    env_file = directory / ".env"
    env = parse_env(env_file.read_text(encoding="utf-8") if env_file.is_file() else "")
    recipe = _recipe(directory)
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

    override = stacks._override_file(directory)
    override_text = override.read_text(encoding="utf-8") if override else ""
    try:
        folders, other = parse_override(override_text)
    except yaml.YAMLError:
        raise StackError(f"{override.name} doesn't load — use Edit as text")
    return {
        "settings": settings,
        "folders": folders,
        "override_other": other,
        # Saving folders rewrites the file through YAML, which drops comments: said first.
        "override_comments": any(
            line.lstrip().startswith("#") and line.strip() not in _OWN_HEADERS
            for line in override_text.splitlines()
        ),
        "services": sorted(logic.declared_services(compose.read_text(encoding="utf-8"))),
        "app": app_summary(doc, env),
        "recipe": {"id": recipe["id"], "name": recipe["name"], "icon": recipe["icon"]} if recipe else None,
    }


def save_form(
    name: str, settings: dict[str, str] | None, folders: list[dict] | None, preview: bool = False
) -> dict | None:
    """Write what the form changed: `settings` are the changed values only, `folders` the
    whole list when it changed — a row left blank is skipped. Everything is checked before
    anything is written. `preview` writes nothing and returns the `.env` and override the
    save would leave, for the text view to open with."""
    directory = stacks._stack_dir(name)
    compose = stacks._compose_file(directory)
    if compose is None:
        raise StackError(f"stack '{name}' not found")
    override = stacks._override_file(directory)
    override_text = override.read_text(encoding="utf-8") if override else ""
    env_file = directory / ".env"
    env_text = env_file.read_text(encoding="utf-8") if env_file.is_file() else ""

    new_override = override_text or None
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
        problem = folders_problem(rows, logic.declared_services(compose.read_text(encoding="utf-8")))
        if problem:
            raise StackError(problem)
        new_override = build_override(override_text, rows)
    new_env = env_text
    if settings:
        bad = [k for k in settings if not _KEY_RE.match(str(k))]
        if bad:
            raise StackError(f"not a variable name: {', '.join(bad)}")
        questions = {str(q["key"]): q for q in ((_recipe(directory) or {}).get("env") or [])}
        for key, value in settings.items():
            if questions.get(key, {}).get("type") == "path" and str(value).strip():
                problem = recipes.path_problem(str(value))
                if problem:
                    raise StackError(f"{questions[key]['label']}: {problem}")
        new_env = set_env(env_text, {str(k): str(v) for k, v in settings.items()})

    if preview:
        return {"env": new_env, "override": new_override or ""}
    if new_env != env_text:
        store.write_private(env_file, new_env)
    if folders is not None:
        target = override or directory / stacks.OVERRIDE_NAME
        if new_override is None:
            target.unlink(missing_ok=True)
        else:
            target.write_text(new_override, encoding="utf-8")
    return None
