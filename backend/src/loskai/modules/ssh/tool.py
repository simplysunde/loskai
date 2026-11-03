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
from pathlib import Path

import yaml

from .logic import PROGRAMS, SUDO_RULE, remove_sudo_rule

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
    "service": re.compile(r"^[A-Za-z0-9][A-Za-z0-9@._:\\-]{0,199}$"),
    "container": re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$"),
    "lxc": re.compile(r"^\d{1,9}$"),
    "vm": re.compile(r"^\d{1,9}$"),
    "session": re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_@+=,~-]{0,99}$"),
    "project": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"),
    # A setting's values: a person's name as git writes it on a commit, and an address.
    "git-name": re.compile(r"^(?=\S)[^\x00-\x1f\x7f<>]{1,100}(?<=\S)$"),
    "email": re.compile(r"^[^\s@<>\x00-\x1f\x7f]{1,64}@[^\s@<>\x00-\x1f\x7f]{1,190}$"),
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
    # Runs to the end without anyone at it: sudo's password is asked for in a dialog first,
    # and its terminal closes itself when it succeeds.
    automatic: bool = False


@dataclass(frozen=True)
class Setting:
    """A value on the machine the tool's card shows and sets — read and written with
    Loskai's key, the new value reaching `write` only as `$1`."""

    id: str
    label: str
    description: str
    value: str  # a kind in TARGETS: what it may be set to
    read: str  # prints the value; nothing (or failing) when it isn't set
    write: str  # sets it to "$1"


@dataclass(frozen=True)
class Tool:
    id: str
    name: str
    description: str
    requires: tuple[str, ...]  # programs from logic.PROGRAMS
    actions: dict[str, Action]
    settings: dict[str, Setting] = field(default_factory=dict)


def parse(tool_id: str, doc: object) -> Tool:
    """A tool file's YAML → a Tool, or ToolError naming every problem at once."""
    problems: list[str] = []
    if not _ID.match(tool_id):
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
        if not isinstance(action_id, str) or not _ID.match(action_id):
            problems.append(f"`{where}`: an action id is lowercase letters, digits and -")
            continue
        if not isinstance(raw, dict):
            problems.append(f"`{where}` must be a mapping")
            continue
        # `on:` would be YAML 1.1's `true`, hence `target`.
        extra = set(raw) - {"label", "description", "run", "target", "ask", "confirm", "session", "automatic"}
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
        automatic = raw.get("automatic", False)
        if not isinstance(automatic, bool):
            problems.append(f"`{where}.automatic` must be true or false")
        actions[action_id] = Action(
            id=action_id, label=str(raw.get("label", "")), description=str(raw.get("description", "")),
            run=run if isinstance(run, dict | str) else "", target=target, ask=ask, confirm=confirm,
            session=session, automatic=automatic is True,
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
        if not isinstance(setting_id, str) or not _ID.match(setting_id):
            problems.append(f"`{where}`: a setting id is lowercase letters, digits and -")
            continue
        if not isinstance(spec, dict):
            problems.append(f"`{where}` must be a mapping")
            continue
        extra = set(spec) - {"label", "description", "value", "read", "write"}
        if extra:
            problems.append(f"`{where}`: unknown keys: {', '.join(sorted(map(str, extra)))}")
        for key in ("label", "description", "read", "write"):
            if not isinstance(spec.get(key), str) or not spec[key].strip():
                problems.append(f"`{where}.{key}` is required")
        if spec.get("value") not in TARGETS:
            problems.append(f"`{where}.value` must be one of {', '.join(TARGETS)}")
        out[setting_id] = Setting(
            id=setting_id, label=str(spec.get("label", "")), description=str(spec.get("description", "")),
            value=str(spec.get("value", "")), read=str(spec.get("read", "")), write=str(spec.get("write", "")),
        )
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
             "ask": a.ask, "confirm": a.confirm, "session": a.session, "automatic": a.automatic,
             "run": a.run}
            for a in t.actions.values()
        ],
        "settings": [
            {"id": s.id, "label": s.label, "description": s.description, "value": s.value,
             "read": s.read, "write": s.write}
            for s in t.settings.values()
        ],
    }


# What a setting's read prints its id before, so one connection reads them all.
_SETTING_MARK = "#loskai-setting "


def read_settings_script(t: Tool) -> str:
    """One script reading each of the tool's settings, each after a line naming it."""
    return "; ".join(
        f"printf '%s\\n' {shlex.quote(_SETTING_MARK + s.id)}; ({s.read}) 2>/dev/null" for s in t.settings.values()
    )


def parse_settings(t: Tool, out: str) -> dict[str, str | None]:
    """`read_settings_script`'s output → each setting's value, None where nothing was printed."""
    values: dict[str, str | None] = dict.fromkeys(t.settings)
    current = None
    for line in out.splitlines():
        if line.startswith(_SETTING_MARK):
            current = line[len(_SETTING_MARK):].strip()
        elif current in values and values[current] is None and line.strip():
            values[current] = line.strip()
    return values


def write_setting_script(t: Tool, setting_id: str, value: str) -> str:
    """What sets one of the tool's settings: its `write`, the value as `$1` — checked against
    its kind first. Raises ToolError for no such setting, or a value it can't take."""
    s = t.settings.get(setting_id)
    if s is None:
        raise ToolError(f"{t.name} has no setting {setting_id!r}")
    if not TARGETS[s.value].match(value):
        raise ToolError(f"Not a valid {s.value.replace('-', ' ')}: {value!r}")
    return f"sh -c {shlex.quote(s.write)} loskai {shlex.quote(value)}"


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
            raise ToolError(f"System › Update isn't plain sudo commands for {manager}: {part.strip()!r}")
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


# Hands sudo the password read at the start (`$p`), so every `sudo` after it in the run finds
# its timestamp; a password that no longer works leaves them asking, as usual.
_SUDO_VALIDATE = "printf '%s\\n' \"$p\" | sudo -S -p '' -v 2>/dev/null; p="
# The first line the terminal is sent is sudo's password: read with echo off — the pty is
# opened without it — and echo back on for the rest.
_READ_PASSWORD = "IFS= read -r p; stty echo 2>/dev/null; "


def visible(
    script: str, target: str | None, session: str | None, projects: str | None = None,
    *, automatic: bool = False, password: bool = False,
) -> str:
    """The command a terminal runs for an action: `script` under `sh`, the target as `$1`;
    then it says how it ended and waits for Enter, so the output stays on screen — or, when
    `automatic`, ends at once if it succeeded. `sudo`
    is a plain call for root (Proxmox logs in as root, often without sudo), `~/.local/bin`
    is on the PATH, as the overview has it, and `$PROJECTS` is the machine's projects
    folder (`projects`, as stored; None: the default). Given a tmux `session`, it runs
    inside it — closing the tab leaves it running, and running the same action again
    attaches to it rather than starting a second.

    With `password`, the terminal's first line is sudo's password (`connect.prepare`
    checked it). It is never in a command line: read into a shell variable, and handed to
    `sudo -S -v` in the tty the run is in — a tmux pane is another tty, so there it goes
    through a FIFO in a folder of its own, read once and removed."""
    folder = PROJECTS if projects is None else projects
    body = (
        "PATH=$PATH:$HOME/.local/bin; PROJECTS=$HOME" + (f"/{shlex.quote(folder)}" if folder else "") + "; "
        'if [ "$(id -u)" = 0 ]; then sudo() { "$@"; }; fi; ' + script
    )
    job = f"sh -c {shlex.quote(body)} loskai" + (f" {shlex.quote(target)}" if target else "")
    if automatic:
        job += "; s=$?; [ $s = 0 ] && exit 0; printf '\\n[failed, exit %s] Enter closes this.\\n' $s; read _"
    else:
        job += "; s=$?; printf '\\n[done, exit %s] Enter closes this.\\n' $s; read _"
    if not password:
        if session:
            return f"tmux new-session -A -s {shlex.quote(session)} {shlex.quote(job)}"
        return job
    if not session:
        return _READ_PASSWORD + _SUDO_VALIDATE + "; " + job
    # The pane starts in the FIFO's folder, reads it, and goes home. A session already
    # running is attached to, as `-A` does, and the password not sent.
    inner = "IFS= read -r p < p; cd; " + _SUDO_VALIDATE + "; " + job
    name = shlex.quote(session)
    return (
        _READ_PASSWORD + 'd=$(mktemp -d) && mkfifo "$d/p" && '
        f'if tmux new-session -d -s {name} -c "$d" {shlex.quote(inner)} 2>/dev/null; '
        """then printf '%s\\n' "$p" > "$d/p"; fi; p=; rm -rf "$d"; """
        f"exec tmux attach-session -t ={name}"
    )


def session_name(t: Tool, action: Action, target: str | None) -> str | None:
    """The tmux session an action runs in, in characters tmux allows in a name: by default
    one per action and target; the action's own `session` (with the target) when it shares
    one; None when it is tmux itself."""
    if action.session is False:
        return None
    base = action.session if isinstance(action.session, str) else f"loskai-{t.id}-{action.id}"
    return re.sub(r"[^A-Za-z0-9_-]", "_", base + (f"-{target}" if target else ""))
