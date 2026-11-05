"""`compose.override.yml` — the user's file, merged over a recipe's `compose.yml`, which an
update never touches. Loskai writes into it only the folders added in the install wizard or
the stack form (bind mounts in long syntax) and the recipe options switched on; whatever
else it holds is kept as it is. Pure: text in, text out.
"""

import json

import yaml

from ...shared.errors import LoskaiError


class OverrideError(LoskaiError):
    """An option can't be switched in the file as it stands — the user edits it as text."""


# Heads every override Loskai writes: the file is the user's, and an update never touches it.
OVERRIDE_HEADER = "# Your folders and changes, merged over compose.yml. Edit them on the stack in Loskai.\n"


def bind_volume(source: str, target: str, read_only: bool) -> dict:
    """One folder as an override volume. Long syntax with `create_host_path: false`: a
    mistyped folder fails the deploy with "bind source path does not exist", where the
    short form has Docker create an empty, root-owned folder and mount that — a library
    that installs fine and stays empty. `$` is doubled because Compose interpolates the
    override like any other file."""
    return {
        "type": "bind",
        "source": source.replace("$", "$$"),
        "target": target.replace("$", "$$"),
        "read_only": read_only,
        "bind": {"create_host_path": False},
    }


def render_override(service: str, pairs: list[tuple[str, str]], read_only: bool) -> str:
    """The compose.override.yml holding the folders added at install. Compose merges it
    into compose.yml by itself, so the recipe's own file is never rewritten."""
    volumes = [bind_volume(source, target, read_only) for source, target in pairs]
    return OVERRIDE_HEADER + yaml.safe_dump({"services": {service: {"volumes": volumes}}}, sort_keys=False)


def _canon(value: object) -> str:
    """One form to compare an option's line with the file's: `1900` and `"1900"` are one
    port, and a device reservation is a mapping."""
    return json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else str(value)


def _has(have: object, want: object) -> bool:
    if isinstance(want, dict):
        return isinstance(have, dict) and all(k in have and _has(have[k], v) for k, v in want.items())
    if isinstance(want, list):
        return isinstance(have, list) and {_canon(w) for w in want} <= {_canon(h) for h in have}
    return have is not None and _canon(have) == _canon(want)


def _add(have: object, want: object, where: str) -> object:
    """`want` merged into `have`: a list gains the items it lacks, a mapping each key, and a
    value already set to something else is refused rather than overwritten."""
    if isinstance(want, dict):
        if have is None:
            have = {}
        if not isinstance(have, dict):
            raise OverrideError(f"compose.override.yml: {where} isn't a mapping — use Edit as text")
        for key, value in want.items():
            have[key] = _add(have.get(key), value, f"{where}.{key}")
        return have
    if isinstance(want, list):
        if have is None:
            have = []
        if not isinstance(have, list):
            raise OverrideError(f"compose.override.yml: {where} isn't a list — use Edit as text")
        known = {_canon(h) for h in have}
        return have + [w for w in want if _canon(w) not in known]
    if have is not None and _canon(have) != _canon(want):
        raise OverrideError(f"compose.override.yml: {where} is already {have} — use Edit as text")
    return want


def _remove(have: object, want: object) -> object:
    """`have` without what `want` added; None when nothing is left of it."""
    if isinstance(want, dict) and isinstance(have, dict):
        for key, value in want.items():
            if key in have:
                rest = _remove(have[key], value)
                if rest is None:
                    del have[key]
                else:
                    have[key] = rest
        return have or None
    if isinstance(want, list) and isinstance(have, list):
        drop = {_canon(w) for w in want}
        return [h for h in have if _canon(h) not in drop] or None
    return None if have is not None and _canon(have) == _canon(want) else have


def option_on(override_text: str, option: dict) -> bool:
    """An option is on when the override has every line it adds — read from the file, so a
    hand edit or an older pasted snippet shows as it is."""
    doc = yaml.safe_load(override_text) if override_text.strip() else None
    services = doc.get("services") if isinstance(doc, dict) else None
    svc = services.get(option["service"]) if isinstance(services, dict) else None
    return isinstance(svc, dict) and _has(svc, option["set"])


def set_options(override_text: str, options: list[dict], on: dict[str, bool]) -> str:
    """The override with these options switched: on adds the lines an option lists, off
    removes exactly those, and nothing else changes. "" when nothing is left."""
    doc = yaml.safe_load(override_text) if override_text.strip() else None
    doc = doc if isinstance(doc, dict) else {}
    services = doc.get("services") if isinstance(doc.get("services"), dict) else {}
    for option in options:
        if option["id"] not in on:
            continue
        name = option["service"]
        svc = services.get(name)
        if svc is None:  # absent, or `jellyfin:` with nothing under it
            svc = {}
        if not isinstance(svc, dict):
            raise OverrideError(f"compose.override.yml: '{name}' isn't a mapping — use Edit as text")
        for key, want in option["set"].items():
            if on[option["id"]]:
                svc[key] = _add(svc.get(key), want, f"{name}'s '{key}'")
            else:
                rest = _remove(svc.get(key), want)
                if rest is None:
                    svc.pop(key, None)
                else:
                    svc[key] = rest
        if svc:
            services[name] = svc
        else:
            services.pop(name, None)
    if services:
        doc["services"] = services
    else:
        doc.pop("services", None)
    return OVERRIDE_HEADER + yaml.safe_dump(doc, sort_keys=False) if doc else ""


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


def build_override(text: str, folders: list[dict]) -> str | None:
    """The override with its folders replaced by these — everything the form can't show
    is kept. None when nothing is left, so the file goes."""
    doc = yaml.safe_load(text) if text.strip() else None
    doc = doc if isinstance(doc, dict) else {}
    services = doc.get("services") if isinstance(doc.get("services"), dict) else {}
    for f in folders:
        # `jellyfin:` with nothing under it loads as None: an empty service, not "other".
        if services.get(f["service"]) is None:
            services[f["service"]] = {}
    for name in list(services):
        svc = services[name]
        if not isinstance(svc, dict):
            continue
        ours = [
            bind_volume(f["source"].strip(), f["target"].strip(), not f["writable"])
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
    return OVERRIDE_HEADER + yaml.safe_dump(doc, sort_keys=False)
