"""Tools — what a machine's page can do, as data.

A tool is one YAML file in `tools/`, shipped in the image: a name, the programs it requires,
and its actions — each a label and the shell it runs on the machine. A tool applies to a
machine that has every program it requires, as its overview found them; nothing is
enabled or stored. One whose missing programs Loskai can install (`INSTALLERS`) is offered
to add. Like a recipe a tool is validated, never executed by Loskai: an action's command
comes from the file, never from the browser, which only names a tool, an action and, for an
action on a row of the Running list, its target. The target reaches the command as `$1`, an
argument, so no value can change what runs. docs/reference/tool-schema.md is the format.

Everything here is pure; `connect.py` decides which machine and runs it.
"""

import re
import shlex
from dataclasses import dataclass
from pathlib import Path

import yaml

from .logic import PROGRAMS

DIR = Path(__file__).parent / "tools"

# The package managers the overview recognises (`logic._FACTS`' updates section), and how
# each installs packages.
MANAGERS = ("apt", "dnf", "apk", "pacman")
PACKAGE_INSTALL = {
    "apt": "sudo apt-get update && sudo apt-get install -y",
    "dnf": "sudo dnf install -y",
    "apk": "sudo apk add",
    "pacman": "sudo pacman -S --noconfirm",
}

# How to get each program a tool may require — the one place it is said. A program that
# isn't here (Proxmox's `pct`) can't be installed from Loskai, so a tool requiring it only
# applies where it already is.
INSTALLERS: dict[str, dict] = {
    "tmux": {"packages": {"apt": "tmux", "dnf": "tmux", "apk": "tmux", "pacman": "tmux"}},
    "git": {"packages": {"apt": "git", "dnf": "git", "apk": "git", "pacman": "git"}},
    # Every script is fetched with curl, so a machine without it gets it first.
    "curl": {"packages": {"apt": "curl", "dnf": "curl", "apk": "curl", "pacman": "curl"}},
    "tailscale": {"script": "curl -fsSL https://tailscale.com/install.sh | sh"},
    "claude": {"script": "curl -fsSL https://claude.ai/install.sh | bash"},
}

# A machine's projects folder: `~` or one folder in it — as deep as the overview looks for
# projects (`logic._FACTS`). Stored relative to home; an action finds it as `$PROJECTS`.
PROJECTS = "projects"
_FOLDER = re.compile(r"^~(/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?/?$")

# What an action can be on — a row of the Running list or of a tool's card, or a name typed
# for it — and what that must look like: a systemd unit, a container name, a Proxmox guest
# id, a tmux session, a project folder. Checked before it is passed.
TARGETS = {
    "service": re.compile(r"^[A-Za-z0-9@._:\\-]{1,200}$"),
    "container": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$"),
    "lxc": re.compile(r"^\d{1,9}$"),
    "vm": re.compile(r"^\d{1,9}$"),
    "session": re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_@+=,~-]{0,99}$"),
    "project": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"),
}

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


class ToolError(ValueError):
    """A tool file that isn't valid, or an action that can't run as asked."""


@dataclass(frozen=True)
class Action:
    id: str
    label: str
    description: str
    run: str | dict[str, str]  # one command, or one per package manager
    target: str | None = None  # None: the machine; else a kind of row in TARGETS
    ask: str | None = None  # a kind in TARGETS: a name typed on the page, passed like a target
    confirm: str | None = None  # asked before it runs, when it is hard to undo
    # The tmux session it runs in: None for Loskai's own (`session_name`), a name to share
    # one between actions (with `-<target>`), False for none — an action that is tmux itself.
    session: str | bool | None = None


@dataclass(frozen=True)
class Tool:
    id: str
    name: str
    description: str
    requires: tuple[str, ...]  # programs from logic.PROGRAMS
    actions: dict[str, Action]


def parse(tool_id: str, doc: object) -> Tool:
    """A tool file's YAML → a Tool, or ToolError naming every problem at once."""
    problems: list[str] = []
    if not _ID.match(tool_id):
        problems.append(f"the file name {tool_id!r} must be lowercase letters, digits and -")
    if not isinstance(doc, dict):
        raise ToolError(f"{tool_id}: not a YAML mapping")
    unknown = set(doc) - {"name", "description", "requires", "actions"}
    if unknown:
        problems.append(f"unknown keys: {', '.join(sorted(map(str, unknown)))}")
    for key in ("name", "description"):
        if not isinstance(doc.get(key), str) or not doc[key].strip():
            problems.append(f"`{key}` is required")

    requires = doc.get("requires") or []
    if not isinstance(requires, list) or not all(isinstance(t, str) for t in requires):
        problems.append("`requires` must be a list of programs")
        requires = []
    for program in requires:
        if program not in PROGRAMS:
            problems.append(f"`requires`: {program!r} isn't a program the overview detects ({', '.join(PROGRAMS)})")

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
        extra = set(raw) - {"label", "description", "run", "target", "ask", "confirm", "session"}
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
        ask = raw.get("ask")
        if ask is not None and ask not in TARGETS:
            problems.append(f"`{where}.ask` must be one of {', '.join(TARGETS)}")
        if ask is not None and target is not None:
            problems.append(f"`{where}`: give `target` or `ask`, not both")
        session = raw.get("session")
        if session is not None and session is not False and not (isinstance(session, str) and _ID.match(session)):
            problems.append(f"`{where}.session` must be false, or a name of lowercase letters, digits and -")
        confirm = raw.get("confirm")
        if confirm is not None and (not isinstance(confirm, str) or not confirm.strip()):
            problems.append(f"`{where}.confirm` must be a sentence")
        actions[action_id] = Action(
            id=action_id, label=str(raw.get("label", "")), description=str(raw.get("description", "")),
            run=run if isinstance(run, dict | str) else "", target=target, ask=ask, confirm=confirm,
            session=session,
        )

    if problems:
        raise ToolError(f"{tool_id}: " + "; ".join(problems))
    return Tool(
        id=tool_id, name=doc["name"], description=doc["description"],
        requires=tuple(requires), actions=actions,
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


def load(directory: Path | None = None) -> dict[str, Tool]:
    """Every tool file in `directory` (default `DIR`), by id (the file name). Raises
    ToolError for the first that isn't valid — they ship in the image, and the test suite
    loads them all."""
    return {
        path.stem: parse(path.stem, yaml.safe_load(path.read_text(encoding="utf-8")))
        for path in sorted((directory or DIR).glob("*.yml"))
    }


def view(t: Tool) -> dict:
    """A tool as the page shows it — the commands included, so what runs can be read.
    `installable`: the programs it requires that Loskai can install."""
    return {
        "id": t.id, "name": t.name, "description": t.description,
        "requires": list(t.requires),
        "installable": [p for p in t.requires if p in INSTALLERS],
        "actions": [
            {"id": a.id, "label": a.label, "description": a.description, "target": a.target,
             "ask": a.ask, "confirm": a.confirm, "session": a.session, "run": a.run}
            for a in t.actions.values()
        ],
    }


def parse_folder(text: str) -> str:
    """A projects folder as typed — `~`, `~/code` — to how it is stored: relative to home."""
    if not _FOLDER.match(text.strip()):
        raise ToolError("A projects folder is ~ or one folder in it, such as ~/projects")
    return text.strip().removeprefix("~").strip("/")


def show_folder(folder: str | None) -> str:
    """A stored projects folder (None: the default) as it is shown: `~/projects`, `~`."""
    folder = PROJECTS if folder is None else folder
    return f"~/{folder}" if folder else "~"


# --- What runs ---


def missing(t: Tool, programs: set[str]) -> list[str]:
    """The programs `t` requires that a machine with `programs` lacks — none: it applies."""
    return [p for p in t.requires if p not in programs]


def action_script(t: Tool, action_id: str, manager: str | None) -> str:
    """The shell an action runs on a machine with `manager`."""
    action = t.actions.get(action_id)
    if action is None:
        raise ToolError(f"{t.name} has no action {action_id!r}")
    if isinstance(action.run, str):
        return action.run
    if manager not in action.run:
        raise ToolError(f"{t.name} › {action.label} has no command for {manager or 'this machine'}'s package manager")
    return action.run[manager]


def to_install(t: Tool, programs: set[str]) -> list[str]:
    """What adding `t` installs on a machine with `programs`: what it lacks, and curl first
    when a script will need it."""
    lacking = missing(t, programs)
    if not lacking:
        raise ToolError(f"{t.name} has everything it needs here")
    cannot = [p for p in lacking if p not in INSTALLERS]
    if cannot:
        raise ToolError(f"{t.name} needs {', '.join(cannot)} — it can't be installed from here")
    if any("script" in INSTALLERS[p] for p in lacking) and "curl" not in programs and "curl" not in lacking:
        lacking = ["curl", *lacking]
    return lacking


def install_script(t: Tool, programs: set[str], manager: str | None) -> str:
    """The shell that installs what `t` lacks on a machine with `programs` and `manager`:
    every package in one command, then each official installer."""
    packages, scripts = [], []
    for program in to_install(t, programs):
        how = INSTALLERS[program]
        if "script" in how:
            scripts.append(how["script"])
        elif manager in how["packages"]:
            packages.append(how["packages"][manager])
        else:
            raise ToolError(f"No {program} package for {manager or 'this machine'}'s package manager")
    steps = ([f"{PACKAGE_INSTALL[manager]} {' '.join(map(shlex.quote, packages))}"] if packages else []) + scripts
    return " && ".join(steps)


def check_target(kind: str | None, target: str | None) -> None:
    """`target` must be what an action on (or asking for) `kind` takes — nothing, for the
    machine."""
    if kind is None:
        if target:
            raise ToolError("This action is for the machine, not one thing on it")
        return
    if not target or not TARGETS[kind].match(target):
        raise ToolError(f"Not a {kind}: {target!r}")


def visible(script: str, target: str | None, session: str | None, projects: str | None = None) -> str:
    """The command a terminal runs for an action: `script` under `sh`, the target as `$1`;
    then it says how it ended and waits for Enter, so the output stays on screen. `sudo`
    is a plain call for root (Proxmox logs in as root, often without sudo), `~/.local/bin`
    is on the PATH, as the overview has it, and `$PROJECTS` is the machine's projects
    folder (`projects`, as stored; None: the default). Given a tmux `session`, it runs
    inside it — closing the tab leaves it running, and running the same action again
    attaches to it rather than starting a second."""
    folder = PROJECTS if projects is None else projects
    body = (
        "PATH=$PATH:$HOME/.local/bin; PROJECTS=$HOME" + (f"/{shlex.quote(folder)}" if folder else "") + "; "
        'if [ "$(id -u)" = 0 ]; then sudo() { "$@"; }; fi; ' + script
    )
    job = f"sh -c {shlex.quote(body)} loskai" + (f" {shlex.quote(target)}" if target else "")
    job += "; s=$?; printf '\\n[done, exit %s] Enter closes this.\\n' $s; read _"
    if session:
        return f"tmux new-session -A -s {shlex.quote(session)} {shlex.quote(job)}"
    return job


def session_name(t: Tool, action: Action, target: str | None) -> str | None:
    """The tmux session an action runs in, in characters tmux allows in a name: by default
    one per action and target; the action's own `session` (with the target) when it shares
    one; None when it is tmux itself."""
    if action.session is False:
        return None
    base = action.session if isinstance(action.session, str) else f"loskai-{t.id}-{action.id}"
    return re.sub(r"[^A-Za-z0-9_-]", "_", base + (f"-{target}" if target else ""))
