"""Plugins — what a machine's page can do, as data.

A plugin is one YAML file in `plugins/`, shipped in the image: a name, the tools it needs
and how to install them, and its actions — each a label and the shell it runs on the
machine. Like a recipe it is validated, never executed by Loskai: an action's command comes
from the file, never from the browser, which only names a plugin, an action and, for an
action on a row of the Running list, its target. The target reaches the command as `$1`, an
argument, so no value can change what runs. docs/reference/plugin-schema.md is the format.

Everything here is pure; `connect.py` decides which machine and runs it.
"""

import re
import shlex
from dataclasses import dataclass
from pathlib import Path

import yaml

from .logic import FACT_TOOLS

DIR = Path(__file__).parent / "plugins"

# The package managers the overview recognises (`logic._FACTS`' updates section), and how
# each installs a package — for a required tool named by its package.
MANAGERS = ("apt", "dnf", "apk", "pacman")
INSTALL = {
    "apt": "sudo apt-get update && sudo apt-get install -y",
    "dnf": "sudo dnf install -y",
    "apk": "sudo apk add",
    "pacman": "sudo pacman -S --noconfirm",
}

# What an action can be on — a row of the Running list — and what its target must look
# like: a systemd unit, a container name, a Proxmox guest id. Checked before it is passed.
TARGETS = {
    "service": re.compile(r"^[A-Za-z0-9@._:\\-]{1,200}$"),
    "container": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$"),
    "lxc": re.compile(r"^\d{1,9}$"),
    "vm": re.compile(r"^\d{1,9}$"),
}

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


class PluginError(ValueError):
    """A plugin file that isn't valid, or an action that can't run as asked."""


@dataclass(frozen=True)
class Action:
    id: str
    label: str
    description: str
    run: str | dict[str, str]  # one command, or one per package manager
    target: str | None = None  # None: the machine; else a kind of row in TARGETS
    confirm: str | None = None  # asked before it runs, when it is hard to undo


@dataclass(frozen=True)
class Plugin:
    id: str
    name: str
    description: str
    requires: tuple[str, ...]  # tools from logic.FACT_TOOLS
    install: dict[str, dict]  # tool → {"packages": {manager: package}} or {"script": "…"}
    actions: dict[str, Action]


def parse(plugin_id: str, doc: object) -> Plugin:
    """A plugin file's YAML → a Plugin, or PluginError naming every problem at once."""
    problems: list[str] = []
    if not _ID.match(plugin_id):
        problems.append(f"the file name {plugin_id!r} must be lowercase letters, digits and -")
    if not isinstance(doc, dict):
        raise PluginError(f"{plugin_id}: not a YAML mapping")
    unknown = set(doc) - {"name", "description", "requires", "install", "actions"}
    if unknown:
        problems.append(f"unknown keys: {', '.join(sorted(map(str, unknown)))}")
    for key in ("name", "description"):
        if not isinstance(doc.get(key), str) or not doc[key].strip():
            problems.append(f"`{key}` is required")

    requires = doc.get("requires") or []
    if not isinstance(requires, list) or not all(isinstance(t, str) for t in requires):
        problems.append("`requires` must be a list of tool names")
        requires = []
    for tool in requires:
        if tool not in FACT_TOOLS:
            problems.append(f"`requires`: {tool!r} isn't a tool the overview detects ({', '.join(FACT_TOOLS)})")

    install = doc.get("install") or {}
    if not isinstance(install, dict):
        problems.append("`install` must map a tool to how to install it")
        install = {}
    for tool, how in install.items():
        if tool not in requires:
            problems.append(f"`install.{tool}`: not in `requires`")
        if not isinstance(how, dict) or len(set(how) & {"packages", "script"}) != 1 or set(how) - {"packages", "script"}:
            problems.append(f"`install.{tool}`: give exactly one of `packages` or `script`")
        elif "packages" in how:
            problems += _by_manager(f"install.{tool}.packages", how["packages"])
        elif not isinstance(how["script"], str) or not how["script"].strip():
            problems.append(f"`install.{tool}.script` must be a command")

    actions: dict[str, Action] = {}
    raw_actions = doc.get("actions")
    if not isinstance(raw_actions, dict) or not raw_actions:
        problems.append("`actions` must map at least one action id to its action")
        raw_actions = {}
    for action_id, raw in raw_actions.items():
        where = f"actions.{action_id}"
        if not isinstance(action_id, str) or not _ID.match(action_id):
            problems.append(f"`{where}`: an action id is lowercase letters, digits and -")
            continue
        if not isinstance(raw, dict):
            problems.append(f"`{where}` must be a mapping")
            continue
        # `on:` would be YAML 1.1's `true`, hence `target`.
        extra = set(raw) - {"label", "description", "run", "target", "confirm"}
        if extra:
            problems.append(f"`{where}`: unknown keys: {', '.join(sorted(map(str, extra)))}")
        for key in ("label", "description"):
            if not isinstance(raw.get(key), str) or not raw[key].strip():
                problems.append(f"`{where}.{key}` is required")
        run = raw.get("run")
        if isinstance(run, dict):
            problems += _by_manager(f"{where}.run", run)
        elif not isinstance(run, str) or not run.strip():
            problems.append(f"`{where}.run` must be a command, or one per package manager")
        target = raw.get("target")
        if target is not None and target not in TARGETS:
            problems.append(f"`{where}.target` must be one of {', '.join(TARGETS)}")
        confirm = raw.get("confirm")
        if confirm is not None and (not isinstance(confirm, str) or not confirm.strip()):
            problems.append(f"`{where}.confirm` must be a sentence")
        actions[action_id] = Action(
            id=action_id, label=str(raw.get("label", "")), description=str(raw.get("description", "")),
            run=run if isinstance(run, dict | str) else "", target=target, confirm=confirm,
        )

    if problems:
        raise PluginError(f"{plugin_id}: " + "; ".join(problems))
    return Plugin(
        id=plugin_id, name=doc["name"], description=doc["description"],
        requires=tuple(requires), install=install, actions=actions,
    )


def _by_manager(where: str, value: object) -> list[str]:
    if not isinstance(value, dict) or not value:
        return [f"`{where}` must map package managers to a value"]
    out = []
    for manager, text in value.items():
        if manager not in MANAGERS:
            out.append(f"`{where}`: {manager!r} isn't a package manager ({', '.join(MANAGERS)})")
        if not isinstance(text, str) or not text.strip():
            out.append(f"`{where}.{manager}` must be text")
    return out


def load(directory: Path = DIR) -> dict[str, Plugin]:
    """Every plugin file in `directory`, by id (the file name). Raises PluginError for the
    first that isn't valid — they ship in the image, and the test suite loads them all."""
    return {
        path.stem: parse(path.stem, yaml.safe_load(path.read_text(encoding="utf-8")))
        for path in sorted(directory.glob("*.yml"))
    }


def view(p: Plugin) -> dict:
    """A plugin as the page shows it — the commands included, so what runs can be read."""
    return {
        "id": p.id, "name": p.name, "description": p.description,
        "requires": list(p.requires),
        "install": {tool: how for tool, how in p.install.items()},
        "actions": [
            {"id": a.id, "label": a.label, "description": a.description, "target": a.target,
             "confirm": a.confirm, "run": a.run}
            for a in p.actions.values()
        ],
    }


# --- What runs ---


def action_script(p: Plugin, action_id: str, manager: str | None) -> str:
    """The shell an action runs on a machine with `manager`."""
    action = p.actions.get(action_id)
    if action is None:
        raise PluginError(f"{p.name} has no action {action_id!r}")
    if isinstance(action.run, str):
        return action.run
    if manager not in action.run:
        raise PluginError(f"{p.name} › {action.label} has no command for {manager or 'this machine'}'s package manager")
    return action.run[manager]


def install_script(p: Plugin, tool: str, manager: str | None) -> str:
    """The shell that installs a tool the plugin requires."""
    how = p.install.get(tool)
    if how is None:
        raise PluginError(f"{p.name} can't install {tool} — it has to be there already")
    if "script" in how:
        return how["script"]
    package = how["packages"].get(manager)
    if package is None:
        raise PluginError(f"{p.name} has no {tool} package for {manager or 'this machine'}'s package manager")
    return f"{INSTALL[manager]} {shlex.quote(package)}"


def check_target(kind: str | None, target: str | None) -> None:
    """`target` must be what an action on `kind` takes — nothing, for the machine."""
    if kind is None:
        if target:
            raise PluginError("This action is for the machine, not one thing on it")
        return
    if not target or not TARGETS[kind].match(target):
        raise PluginError(f"Not a {kind}: {target!r}")


def visible(script: str, target: str | None, session: str | None) -> str:
    """The command a terminal runs for an action: `script` under `sh`, the target as `$1`;
    then it says how it ended and waits for Enter, so the output stays on screen. `sudo`
    is a plain call for root (Proxmox logs in as root, often without sudo). Given a tmux
    `session`, it runs inside it — closing the tab leaves it running, and running the same
    action again attaches to it rather than starting a second."""
    body = 'if [ "$(id -u)" = 0 ]; then sudo() { "$@"; }; fi; ' + script
    job = f"sh -c {shlex.quote(body)} loskai" + (f" {shlex.quote(target)}" if target else "")
    job += "; s=$?; printf '\\n[done, exit %s] Enter closes this.\\n' $s; read _"
    if session:
        return f"tmux new-session -A -s {shlex.quote(session)} {shlex.quote(job)}"
    return job


def session_name(plugin_id: str, action_id: str, target: str | None) -> str:
    """One tmux session per action and target, in characters tmux allows in a name."""
    name = f"loskai-{plugin_id}-{action_id}" + (f"-{target}" if target else "")
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)
