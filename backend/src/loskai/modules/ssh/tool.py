"""Tools — what a machine's dialog can do, as data.

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
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import yaml

from ...shared.errors import LoskaiError
from .logic import SUDO_RULE, remove_sudo_rule
from .status import KEY_NAME, KEY_PART, PROGRAMS, USER_PATH

DIR = Path(__file__).parent / "tools"

# The package managers the overview recognises (`status._FACTS`' updates section), and how
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
    # Piped to sudo, not sh: the installer calls sudo itself, and a command that says sudo is
    # one whose password the dialog asks for first (connect.prepare).
    "tailscale": {"script": "curl -fsSL https://tailscale.com/install.sh | sudo sh"},
    "claude": {"script": "curl -fsSL https://claude.ai/install.sh | bash"},
}

# A machine's projects folder: `~` or one folder in it — as deep as the overview looks for
# projects (`status._FACTS`). Stored relative to home; an action finds it as `$PROJECTS`.
DEFAULT_PROJECTS_FOLDER = "projects"
_PROJECTS_FOLDER = re.compile(r"^~(/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?/?$")

# What an action can be on — a row of the Running list or of a tool's card, or a name typed
# for it — and what that must look like: a systemd unit, a container name, a Proxmox guest
# id, a tmux session, a project folder. Checked before it is passed.
TARGETS = {
    "service": re.compile(r"^[A-Za-z0-9][A-Za-z0-9@._:\\-]{0,199}$"),
    "container": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$"),
    "lxc": re.compile(r"^\d{1,9}$"),
    "vm": re.compile(r"^\d{1,9}$"),
    "session": re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_@+=,~-]{0,99}$"),
    "project": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"),
    # A git remote to clone: https://, http://, ssh:// or git:// with a user and a host that
    # each start with a letter or digit (never an option to ssh, whatever git's version), or
    # scp-like `user@host:path`. No other transport — `ext::` would run a command.
    "repo": re.compile(
        r"^(?=.{1,300}$)(?:"
        r"(?:https?|ssh|git)://(?:[A-Za-z0-9][A-Za-z0-9._~%-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?/[A-Za-z0-9._~%/+@-]+"
        r"|[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9._~][A-Za-z0-9._~/+-]*"
        r")$"
    ),
    # A git host to reach over SSH (Git's Test key): a name, an address or an ssh alias (which
    # may hold `_`), and a port when its SSH isn't on 22 — never an option to ssh.
    "host": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,252}(?::\d{1,5})?$"),
    # A key in the SSH user's ~/.ssh, as the overview lists them (Git's Keys).
    "key": KEY_NAME,
    # One key, and a host to try it on — `<key>@<host>[:port]`: a key's own Test in Keys,
    # its row's field the host. The two halves held to the `key` and `host` kinds.
    "key-host": re.compile("^" + KEY_PART + r"@[A-Za-z0-9][A-Za-z0-9._-]{0,252}(?::\d{1,5})?$"),
    # One key, and what it is for — `<key>@account`, `@login`, `@for:<host>` or
    # `@deploy:<project>`: a key's Label in Keys. The parts held to the `key`, `host` and
    # `project` kinds.
    "key-label": re.compile(
        "^" + KEY_PART + r"@(?:account|login|for:[A-Za-z0-9][A-Za-z0-9._-]{0,252}"
        r"|deploy:[A-Za-z0-9][A-Za-z0-9._-]{0,99})$"
    ),
    # A setting's values: a person's name as git writes it on a commit, and an address.
    "git-name": re.compile(r"^(?=\S)[^\x00-\x1f\x7f<>]{1,100}(?<=\S)$"),
    "email": re.compile(r"^[^\s@<>\x00-\x1f\x7f]{1,64}@[^\s@<>\x00-\x1f\x7f]{1,190}$"),
}

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
# The rows a setting can be a value of: those `read_settings_script` can list on the machine.
SETTING_TARGETS = ("project",)


class ToolError(LoskaiError, ValueError):
    """A tool file that isn't valid, or an action that can't run as asked — 422 for a value
    it can't take, 404 for no such action or setting, 409 for one that can't run here."""

    status_code = 422


# What an action's `when` may be: its row's shared session running, or not. And what it is
# the rest of the time: hidden, or there but greyed out (`OTHERWISE`).
WHEN = ("running", "stopped")
OTHERWISE = ("hidden", "disabled")
# Where an action is offered: on its tool's card (or its row); in the settings dialog — the
# card's, or a row's for an action on one — for one set up once and rarely run again (a
# project's own key); or in Keys, beside the list of the user's SSH keys (`key` rows, never
# on the card) — Git's New account key and Test key.
PLACES = ("card", "settings", "keys")


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
    # Runs to the end without anyone at it: sudo's password is asked for in a dialog first,
    # and its terminal closes itself when it succeeds.
    automatic: bool = False
    # On a row only while its shared session is running, or only while it isn't (`WHEN`):
    # Claude's Attach and Stop, its Start. What it shows is the page's; the command copes.
    when: str | None = None
    # The rest of the time: hidden (Start and Stop, sharing one place), or greyed (Attach).
    otherwise: str = "hidden"
    # `PLACES`: on the card or its row; in a settings dialog — the row's, for a kind of row
    # that has settings (`SETTING_TARGETS`); or in Keys, for one on no row.
    place: str = "card"


@dataclass(frozen=True)
class Setting:
    """A value on the machine the tool's card shows and sets — read and written with
    Loskai's key, the new value reaching `write` only as `$1`. One with a `target` is a
    value of each of those rows instead (a project's own commit name): the row is `$1` in
    all three commands, and the value `$2`."""

    id: str
    label: str
    description: str
    value: str  # a kind in TARGETS: what it may be set to
    read: str  # prints the value; nothing (or failing) when it isn't set
    write: str  # sets it to "$1" ("$2" with a target)
    unset: str | None = None  # takes it off — set to nothing; None: it can't be
    target: str | None = None  # `SETTING_TARGETS`: a value of each row of it, not the machine's
    overrides: str | None = None  # the machine's setting this one replaces where it is set


@dataclass(frozen=True)
class Tool:
    id: str
    name: str
    description: str
    requires: tuple[str, ...]  # programs from status.PROGRAMS
    actions: dict[str, Action]
    settings: dict[str, Setting] = field(default_factory=dict)


def parse(tool_id: str, doc: object) -> Tool:
    """A tool file's YAML → a Tool, or ToolError naming every problem at once."""
    problems: list[str] = []
    if not _ID.fullmatch(tool_id):
        problems.append(f"the file name {tool_id!r} must be lowercase letters, digits and -")
    if not isinstance(doc, dict):
        raise ToolError(f"{tool_id}: not a YAML mapping")
    unknown = set(doc) - {"name", "description", "requires", "actions", "settings"}
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

    settings, problems_settings = _settings(doc.get("settings"))
    problems += problems_settings
    actions: dict[str, Action] = {}
    raw_actions = doc.get("actions")
    if raw_actions is None and settings:
        raw_actions = {}
    elif not isinstance(raw_actions, dict) or not raw_actions:
        problems.append("`actions` must map at least one action id to its action, unless it has `settings`")
        raw_actions = {}
    for action_id, raw in raw_actions.items():
        where = f"actions.{action_id}"
        if not isinstance(action_id, str) or not _ID.fullmatch(action_id):
            problems.append(f"`{where}`: an action id is lowercase letters, digits and -")
            continue
        if not isinstance(raw, dict):
            problems.append(f"`{where}` must be a mapping")
            continue
        # `on:` would be YAML 1.1's `true`, hence `target`.
        extra = set(raw) - {
            "label", "description", "run", "target", "ask", "confirm", "session", "automatic", "when", "otherwise", "place"}
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
        if session is not None and session is not False and not (isinstance(session, str) and _ID.fullmatch(session)):
            problems.append(f"`{where}.session` must be false, or a name of lowercase letters, digits and -")
        confirm = raw.get("confirm")
        if confirm is not None and (not isinstance(confirm, str) or not confirm.strip()):
            problems.append(f"`{where}.confirm` must be a sentence")
        automatic = raw.get("automatic", False)
        if not isinstance(automatic, bool):
            problems.append(f"`{where}.automatic` must be true or false")
        when = raw.get("when")
        if when is not None and when not in WHEN:
            problems.append(f"`{where}.when` must be one of {', '.join(WHEN)}")
        otherwise = raw.get("otherwise", "hidden")
        if otherwise not in OTHERWISE:
            problems.append(f"`{where}.otherwise` must be one of {', '.join(OTHERWISE)}")
        elif "otherwise" in raw and when is None:
            problems.append(f"`{where}.otherwise` needs a `when`")
        place = raw.get("place", "card")
        if place not in PLACES:
            problems.append(f"`{where}.place` must be one of {', '.join(PLACES)}")
        elif place == "settings" and target is not None and target not in SETTING_TARGETS:
            problems.append(f"`{where}.place`: only a {', '.join(SETTING_TARGETS)} has a settings dialog")
        elif place == "keys" and target is not None:
            problems.append(f"`{where}.place`: a key's own actions are on its row in Keys")
        actions[action_id] = Action(
            id=action_id, label=str(raw.get("label", "")), description=str(raw.get("description", "")),
            run=run if isinstance(run, dict | str) else "", target=target, ask=ask, confirm=confirm,
            session=session, automatic=automatic is True, when=when if when in WHEN else None,
            otherwise=otherwise if otherwise in OTHERWISE else "hidden",
            place=place if place in PLACES else "card",
        )
    # A row's session is running when an action of its kind shares one (`claim_sessions`):
    # without one, `when` could never be told.
    for action in actions.values():
        if action.when and not any(
            isinstance(a.session, str) and a.target == action.target for a in actions.values()
        ):
            problems.append(
                f"`actions.{action.id}.when`: needs a `target` whose rows share a `session` — "
                "an action of that target with `session: <name>`"
            )

    if problems:
        raise ToolError(f"{tool_id}: " + "; ".join(problems))
    return Tool(
        id=tool_id, name=doc["name"], description=doc["description"],
        requires=tuple(requires), actions=actions, settings=settings,
    )


def _settings(raw: object) -> tuple[dict[str, Setting], list[str]]:
    if raw is None:
        return {}, []
    if not isinstance(raw, dict) or not raw:
        return {}, ["`settings` must map at least one setting id to its setting"]
    problems: list[str] = []
    out: dict[str, Setting] = {}
    for setting_id, spec in raw.items():
        where = f"settings.{setting_id}"
        if not isinstance(setting_id, str) or not _ID.fullmatch(setting_id):
            problems.append(f"`{where}`: a setting id is lowercase letters, digits and -")
            continue
        if not isinstance(spec, dict):
            problems.append(f"`{where}` must be a mapping")
            continue
        extra = set(spec) - {"label", "description", "value", "read", "write", "unset", "target", "overrides"}
        if extra:
            problems.append(f"`{where}`: unknown keys: {', '.join(sorted(map(str, extra)))}")
        for key in ("label", "description", "read", "write"):
            if not isinstance(spec.get(key), str) or not spec[key].strip():
                problems.append(f"`{where}.{key}` is required")
        if spec.get("value") not in TARGETS:
            problems.append(f"`{where}.value` must be one of {', '.join(TARGETS)}")
        if "unset" in spec and (not isinstance(spec["unset"], str) or not spec["unset"].strip()):
            problems.append(f"`{where}.unset` must be a command")
        if "target" in spec and spec["target"] not in SETTING_TARGETS:
            problems.append(f"`{where}.target` must be one of {', '.join(SETTING_TARGETS)}")
        if "overrides" in spec and "target" not in spec:
            problems.append(f"`{where}.overrides` is only for a setting with a `target`")
        out[setting_id] = Setting(
            id=setting_id, label=str(spec.get("label", "")), description=str(spec.get("description", "")),
            value=str(spec.get("value", "")), read=str(spec.get("read", "")), write=str(spec.get("write", "")),
            unset=spec.get("unset"), target=spec.get("target"),
            overrides=str(spec["overrides"]) if "overrides" in spec else None,
        )
    for s in out.values():
        o = out.get(s.overrides or "")
        if s.overrides is not None and (o is None or o.target is not None or o.value != s.value):
            problems.append(f"`settings.{s.id}.overrides` must name a setting of the machine's that takes a {s.value}")
    return out, problems


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


# The order the tools come in — their cards on a machine, the Tools menu: these first, the
# rest by id after them. Decided here only; the page keeps the order it is sent.
ORDER = ("git", "claude", "tailscale", "tmux")


def load(directory: Path | None = None) -> dict[str, Tool]:
    """Every tool file in `directory` (default `DIR`), by id (the file name), in `ORDER`.
    Raises ToolError for the first that isn't valid — they ship in the image, and the test
    suite loads them all."""
    return _read(directory or DIR)


# Once per folder: the files never change while Loskai runs, and every plan, settings read
# and tool list asks for them (`make dev` restarts on an edited one).
@cache
def _read(directory: Path) -> dict[str, Tool]:
    return {
        path.stem: parse(path.stem, yaml.safe_load(path.read_text(encoding="utf-8")))
        for path in sorted(directory.glob("*.yml"), key=lambda p: (_order_rank(p.stem), p.stem))
    }


def _order_rank(tool_id: str) -> int:
    return ORDER.index(tool_id) if tool_id in ORDER else len(ORDER)


def view(tool: Tool) -> dict:
    """A tool as the page shows it — the commands included, so what runs can be read.
    `installable`: the programs it requires that Loskai can install."""
    return {
        "id": tool.id, "name": tool.name, "description": tool.description,
        "requires": list(tool.requires),
        "installable": [p for p in tool.requires if p in INSTALLERS],
        "actions": [
            {"id": a.id, "label": a.label, "description": a.description, "target": a.target,
             "ask": a.ask, "confirm": a.confirm, "session": a.session, "automatic": a.automatic,
             "when": a.when, "otherwise": a.otherwise, "place": a.place, "run": a.run}
            for a in tool.actions.values()
        ],
        "settings": [
            {"id": s.id, "label": s.label, "description": s.description, "value": s.value,
             "read": s.read, "write": s.write, "unset": s.unset, "target": s.target, "overrides": s.overrides}
            for s in tool.settings.values()
        ],
    }


# What a setting's read prints its id before (and, for a row's, the row), so one connection
# reads them all.
_SETTING_MARK = "#loskai-setting "


def _projects_env(projects_folder: str | None) -> str:
    """`$PROJECTS` set, and exported, to the machine's projects folder (`projects_folder`, as stored;
    None: the default) — the one place it is worked out, for an action's run and a setting's."""
    folder = DEFAULT_PROJECTS_FOLDER if projects_folder is None else projects_folder
    return "PROJECTS=$HOME" + (f"/{shlex.quote(folder)}" if folder else "") + "; export PROJECTS; "


def read_settings_script(tool: Tool, projects_folder: str | None = None) -> str:
    """One script reading each of the tool's settings, each after a line naming it — a
    project's for every git repo in the projects folder, after a line naming both. A folder
    whose name a project can't have is skipped, so a name never needs quoting or breaks a line."""
    machine = [
        f"printf '%s\\n' {shlex.quote(_SETTING_MARK + s.id)}; ({s.read}) 2>/dev/null"
        for s in tool.settings.values() if s.target is None
    ]
    rows = [
        f"printf '%s\\n' \"{_SETTING_MARK}{s.id} $n\"; sh -c {shlex.quote(s.read)} loskai \"$n\" 2>/dev/null"
        for s in tool.settings.values() if s.target == "project"
    ]
    if rows:
        machine.append(
            _projects_env(projects_folder) + 'for g in "$PROJECTS"/*/.git; do d=${g%/.git}; n=${d##*/}; '
            "case $n in [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) continue;; esac; [ -d \"$g\" ] || continue; "
            + "; ".join(rows) + "; done"
        )
    return "; ".join(machine)


def parse_settings(tool: Tool, out: str) -> dict:
    """`read_settings_script`'s output → `{values, targets}`: the machine's settings by id,
    and each row's by kind and row (`{"project": {"site": {"project-name": …}}}`) — None
    where nothing was printed."""
    values: dict[str, str | None] = {s.id: None for s in tool.settings.values() if s.target is None}
    targets: dict[str, dict[str, dict[str, str | None]]] = {
        s.target: {} for s in tool.settings.values() if s.target
    }
    slot: tuple[dict, str] | None = None
    for line in out.splitlines():
        if line.startswith(_SETTING_MARK):
            setting_id, _, row = line[len(_SETTING_MARK):].strip().partition(" ")
            s = tool.settings.get(setting_id)
            slot = None
            if s and s.target is None and not row:
                slot = (values, s.id)
            elif s and s.target and TARGETS[s.target].fullmatch(row):
                slot = (targets[s.target].setdefault(row, {o.id: None for o in tool.settings.values()
                                                          if o.target == s.target}), s.id)
        elif slot and slot[0][slot[1]] is None and line.strip():
            slot[0][slot[1]] = line.strip()
    return {"values": values, "targets": targets}


def write_setting_script(
    tool: Tool, setting_id: str, value: str, target_name: str | None = None, projects_folder: str | None = None,
) -> str:
    """What sets one of the tool's settings: its `write`, the value as `$1` — checked against
    its kind first — or, for a row's, the row as `$1` and the value as `$2`. Nothing, for a
    setting that can be taken off, runs its `unset`. Raises ToolError for no such setting,
    a row it isn't for, or a value it can't take."""
    s = tool.settings.get(setting_id)
    if s is None:
        raise ToolError(f"{tool.name} has no setting {setting_id!r}", 404)
    check_target(s.target, target_name)
    if not value and s.unset:
        command, args = s.unset, []
    elif TARGETS[s.value].fullmatch(value):
        command, args = s.write, [value]
    else:
        raise ToolError(f"Not a valid {s.value.replace('-', ' ')}: {value!r}")
    args = ([target_name] if target_name else []) + args
    script = f"sh -c {shlex.quote(command)} loskai" + "".join(f" {shlex.quote(a)}" for a in args)
    return _projects_env(projects_folder) + script if s.target else script


def parse_projects_folder(text: str) -> str:
    """A projects folder as typed — `~`, `~/code` — to how it is stored: relative to home."""
    if not _PROJECTS_FOLDER.fullmatch(text.strip()):
        raise ToolError("A projects folder is ~ or one folder in it, such as ~/projects")
    return text.strip().removeprefix("~").strip("/")


def show_projects_folder(folder: str | None) -> str:
    """A stored projects folder (None: the default) as it is shown: `~/projects`, `~`."""
    folder = DEFAULT_PROJECTS_FOLDER if folder is None else folder
    return f"~/{folder}" if folder else "~"


# --- What runs ---


def missing(tool: Tool, programs: set[str]) -> list[str]:
    """The programs `tool` requires that a machine with `programs` lacks — none: it applies."""
    return [p for p in tool.requires if p not in programs]


def action_script(tool: Tool, action_id: str, manager: str | None) -> str:
    """The shell an action runs on a machine with `manager`."""
    action = tool.actions.get(action_id)
    if action is None:
        raise ToolError(f"{tool.name} has no action {action_id!r}", 404)
    if isinstance(action.run, str):
        return action.run
    if manager not in action.run:
        raise ToolError(f"{tool.name} › {action.label} has no command for {manager or 'this machine'}'s package manager", 409)
    return action.run[manager]


# One `sudo <program> <args>` of System's update: a program name and plain arguments — none
# of the characters sudoers would read as syntax.
_SUDO_STEP = re.compile(r"^sudo ([a-z][a-z0-9-]*)((?: [A-Za-z0-9._/-]+)*)$")


# The one action the sudo rule lets run without a password.
RULE_ACTION = ("system", "update")


def update_commands(manager: str | None) -> list[str]:
    """System's update on a machine with `manager`, as the commands it runs under sudo
    (`apt-get update`, `apt-get -y dist-upgrade`) — what the sudo rule allows, read from the
    tool file so the rule and the button can't disagree. ToolError when it isn't plain
    `sudo` steps joined by `&&`."""
    tool_id, action_id = RULE_ACTION
    script = action_script(load()[tool_id], action_id, manager)
    steps = []
    for part in script.split("&&"):
        m = _SUDO_STEP.match(part.strip())
        if not m:
            raise ToolError(f"System › Update isn't plain sudo commands for {manager}: {part.strip()!r}", 409)
        steps.append(m.group(1) + m.group(2))
    return steps


def allow_script(manager: str | None) -> str:
    """Puts the sudo rule (`SUDO_RULE`) on a machine with `manager`, in its terminal, with
    the user's password — given in the dialog before it (`connect.prepare`), or else typed
    at sudo's prompt. The rule
    names the user and each command by its full path as sudo finds it; `visudo` checks it
    before it is put in place, so a rule sudo can't read changes nothing. Then it checks
    that sudo reads it — a sudo that ignores `/etc/sudoers.d` says so."""
    steps = [*update_commands(manager), f"rm -f {SUDO_RULE}"]
    programs = sorted({step.split()[0] for step in steps} | {"visudo"})
    allowed = ", ".join(
        f"$(command -v {program}) {rest}".rstrip() for program, _, rest in (step.partition(" ") for step in steps)
    )
    # As root, its argument the user: no single quote in it, as it sits in sh -c '…'. The
    # rule is written beside the real one under a name with a dot, which sudo skips.
    as_root = (
        "set -e; u=$1; "
        f"for c in {' '.join(programs)}; do command -v $c >/dev/null || {{ echo No $c on this machine.; exit 1; }}; done; "
        f"t=$(mktemp {SUDO_RULE}.XXXXXX); "
        f'{{ echo "# Loskai: $u may update this machine without a password. Loskai removes this file."; '
        f'echo "$u ALL=(root) NOPASSWD: {allowed}"; }} > $t; '
        "chmod 0440 $t; "
        f"if visudo -cf $t >/dev/null; then mv $t {SUDO_RULE}; "
        "else rm -f $t; echo visudo refused the rule, so nothing changed.; exit 1; fi"
    )
    return (
        'if [ "$(id -u)" = 0 ]; then echo Logged in as root: nothing asks for a password.; exit 0; fi; '
        f"sudo sh -c '{as_root}' sh \"$(id -un)\" || exit 1; "
        # Forget the password just typed, so the check below sees only the rule.
        "sudo -k; "
        f"if sudo -n -l {steps[0]} >/dev/null 2>&1; then echo Done: Update no longer asks for a password.; "
        f"else echo The rule is in {SUDO_RULE}, but sudo here does not read that folder.; exit 1; fi"
    )


# Takes the sudo rule off, in the machine's terminal — no password: the rule allows it.
REMOVE_RULE_SCRIPT = (
    remove_sudo_rule(f"echo Could not take it off. As root: rm -f {SUDO_RULE}; exit 1")
    + "; echo Taken off: Update asks for a password again."
)


def to_install(tool: Tool, programs: set[str]) -> list[str]:
    """What adding `tool` installs on a machine with `programs`: what it lacks, and curl first
    when a script will need it."""
    lacking = missing(tool, programs)
    if not lacking:
        raise ToolError(f"{tool.name} has everything it needs here", 409)
    cannot = [p for p in lacking if p not in INSTALLERS]
    if cannot:
        raise ToolError(f"{tool.name} needs {', '.join(cannot)} — it can't be installed from here", 409)
    if any("script" in INSTALLERS[p] for p in lacking) and "curl" not in programs and "curl" not in lacking:
        lacking = ["curl", *lacking]
    return lacking


def install_script(tool: Tool, programs: set[str], manager: str | None) -> str:
    """The shell that installs what `tool` lacks on a machine with `programs` and `manager`:
    every package in one command, then each official installer."""
    packages, scripts = [], []
    for program in to_install(tool, programs):
        how = INSTALLERS[program]
        if "script" in how:
            scripts.append(how["script"])
        elif manager in how["packages"]:
            packages.append(how["packages"][manager])
        else:
            raise ToolError(f"No {program} package for {manager or 'this machine'}'s package manager", 409)
    steps = ([f"{PACKAGE_INSTALL[manager]} {' '.join(map(shlex.quote, packages))}"] if packages else []) + scripts
    return " && ".join(steps)


def check_target(kind: str | None, target_name: str | None) -> None:
    """`target_name` must be what an action on (or asking for) `kind` takes — nothing, for the
    machine."""
    if kind is None:
        if target_name:
            raise ToolError("This action is for the machine, not one thing on it", 409)
        return
    if not target_name or not TARGETS[kind].fullmatch(target_name):
        raise ToolError(f"Not a {kind}: {target_name!r}", 409)


# Hands sudo the password read at the start (`$p`), so every `sudo` after it in the run finds
# its timestamp; a password that no longer works leaves them asking, as usual.
_SUDO_VALIDATE = "printf '%s\\n' \"$p\" | sudo -S -p '' -v 2>/dev/null; p="
# The first line the terminal is sent is sudo's password: read with echo off — the pty is
# opened without it — and echo back on for the rest.
_READ_PASSWORD = "IFS= read -r p; stty echo 2>/dev/null; "
# How long a run's tmux pane waits for the password. It is sent the moment the session
# starts, so only a connection cut off in between leaves the pane waiting — and a pane left
# blocked on the read would be what the next run of that action attaches to: a blank terminal.
PASSWORD_WAIT = 30  # seconds


def _last_lines(session: str) -> tuple[str, str]:
    """For an automatic run in tmux: the pane's last lines, kept when it succeeds — `(saved,
    shown)`. tmux clears its screen as it exits, and a run that succeeded exits without
    waiting, so the terminal would be left blank. `saved` goes in the pane before it exits
    (its trailing blank rows dropped); `shown`, after tmux in the terminal's own shell,
    takes tmux's `[exited]` line back and prints them. Kept in the user's own `~/.cache`,
    where no other user can put a file in the way."""
    last = f'"$HOME/.cache/loskai/{session}.last"'
    saved = (
        f"mkdir -p \"$HOME/.cache/loskai\" && tmux capture-pane -pJ -S -50 "
        f"| awk 'NF{{for(;n>0;n--)print \"\";print;next}}{{n++}}' | tail -n 20 > {last}; "
    )
    shown = f"; if [ -s {last} ]; then printf '\\033[1A\\033[K'; cat {last}; fi; rm -f {last}"
    return saved, shown


def _pane_reads_password() -> str:
    """The pane's start: it reads the password from the FIFO in its folder, then removes
    the folder and goes home — or, sent nothing within `PASSWORD_WAIT`, removes it and
    ends, and its session with it."""
    return (
        f'd=$PWD; (sleep {PASSWORD_WAIT}; rm -rf "$d"; kill $$) </dev/null >/dev/null 2>&1 & k=$!; '
        'IFS= read -r p < p; kill $k; cd; rm -rf "$d"; '
    )


def terminal_command(
    script: str, target_name: str | None, session: str | None, projects_folder: str | None = None,
    *, automatic: bool = False, password: bool = False,
) -> str:
    """The command a terminal runs for an action: `script` under `sh`, the target as `$1`;
    then it says how it ended and waits for Enter, so the output stays on screen — or, when
    `automatic`, ends at once if it succeeded. `sudo`
    is a plain call for root (Proxmox logs in as root, often without sudo), `~/.local/bin`
    is on the PATH, as the overview has it, and `$PROJECTS` is the machine's projects
    folder (`projects_folder`, as stored; None: the default). Given a tmux `session`, it runs
    inside it — closing the tab leaves it running, and running the same action again
    attaches to it rather than starting a second.

    With `password`, the terminal's first line is sudo's password (`connect.prepare`
    checked it). It is never in a command line: read into a shell variable, and handed to
    `sudo -S -v` in the tty the run is in — a tmux pane is another tty, so there it goes
    through a FIFO in a folder of its own, read once and removed; a pane sent nothing ends (`PASSWORD_WAIT`)."""
    saved, shown = _last_lines(session) if automatic and session else ("", "")
    body = USER_PATH + _projects_env(projects_folder) + 'if [ "$(id -u)" = 0 ]; then sudo() { "$@"; }; fi; ' + script
    job = f"sh -c {shlex.quote(body)} loskai" + (f" {shlex.quote(target_name)}" if target_name else "")
    if automatic:
        job += f"; s=$?; [ $s = 0 ] && {{ {saved}exit 0; }}; printf '\\n[failed, exit %s] Enter closes this.\\n' $s; read _"
    else:
        job += "; s=$?; printf '\\n[done, exit %s] Enter closes this.\\n' $s; read _"
    if not password:
        if session:
            return f"tmux new-session -A -s {shlex.quote(session)} {shlex.quote(job)}" + shown
        return job
    if not session:
        return _READ_PASSWORD + _SUDO_VALIDATE + "; " + job
    # The pane starts in the FIFO's folder (`_pane_reads_password`). A session already
    # running is attached to, as `-A` does, and the password not sent.
    inner = _pane_reads_password() + _SUDO_VALIDATE + "; " + job
    name = shlex.quote(session)
    return (
        _READ_PASSWORD + 'd=$(mktemp -d) && mkfifo "$d/p" && '
        f'if tmux new-session -d -s {name} -c "$d" {shlex.quote(inner)} 2>/dev/null; '
        """then printf '%s\\n' "$p" > "$d/p"; fi; p=; rm -rf "$d"; """
        + (f"tmux attach-session -t ={name}" + shown if shown else f"exec tmux attach-session -t ={name}")
    )


def session_name(tool: Tool, action: Action, target_name: str | None) -> str | None:
    """The tmux session an action runs in, in characters tmux allows in a name: by default
    one per action and target; the action's own `session` (with the target) when it shares
    one; None when it is tmux itself."""
    if action.session is False:
        return None
    base = action.session if isinstance(action.session, str) else f"loskai-{tool.id}-{action.id}"
    return _tmux_name(base + (f"-{target_name}" if target_name else ""))


def _tmux_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)


def claim_sessions(facts: dict, tools: dict[str, Tool]) -> dict:
    """The overview with what its tmux sessions are, so the page never names one: each
    session's `tool`, the one whose shared `session` it is (`claude-site` is Claude Code's),
    else None; and `live`, by tool and kind, the rows whose shared session is running —
    `{"claude": {"project": ["site"]}}`."""
    sessions = facts.get("tmux") or []
    names = {s["name"] for s in sessions}
    rows = {"project": [p["name"] for p in facts.get("projects") or []],
            "session": [s["name"] for s in sessions]}
    shared = [(tool, a) for tool in tools.values() for a in tool.actions.values() if isinstance(a.session, str)]
    live: dict[str, dict[str, list[str]]] = {}
    for tool, a in shared:
        running = [r for r in rows.get(a.target or "", []) if session_name(tool, a, r) in names]
        if running:
            kinds = live.setdefault(tool.id, {})
            kinds[a.target] = sorted(set(kinds.get(a.target, [])) | set(running))

    def owner(name: str) -> str | None:
        return next((tool.id for tool, a in shared if name.startswith(_tmux_name(a.session) + "-")), None)

    return {**facts, "tmux": [{**s, "tool": owner(s["name"])} for s in sessions], "live": live}
