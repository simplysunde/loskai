"""Reaching a machine over SSH: trusting its host key, installing Loskai's keys on it,
testing them, and reading what runs there.

A machine is reached as its SSH config entry says (`Host` = its hostname: `HostName`,
`User`, `Port`), and only ever with the host key trusted for its id. The order is the
safety: a host key is shown and trusted before any password is sent, so a password only
goes to the machine whose fingerprint was accepted.
"""

import asyncio
import logging
import secrets
import shlex
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import asyncssh

from ...shared import auth
from ...shared.errors import LoskaiError
from ...shared import instances as instances_store
from ..docker.client import docker_client
from ...shared import settings as settings_store
from . import client, logic, tool, unlock

logger = logging.getLogger(__name__)

RUNNING_TTL = 30  # seconds a running list is reused — the Machines tab asks every 30 s
FACTS_TTL = 60  # seconds an overview is reused — only a machine's own page asks

_running: dict[str, tuple[float, dict]] = {}
_facts: dict[str, tuple[float, dict]] = {}


def _drop_cached(machine_id: str) -> None:
    _running.pop(machine_id, None)
    _facts.pop(machine_id, None)


class SshError(LoskaiError):
    pass


@dataclass
class Target:
    id: str
    host: str
    port: int
    user: str


def target(machine_id: str) -> Target:
    """The machine and how its SSH config entry says to reach it."""
    inst = instances_store.get_instance(machine_id)
    if inst is None or not instances_store.is_machine(inst):
        raise SshError(f"no machine '{machine_id}'", 404)
    entry = logic.hosts(client.read_config()).get(inst.subdomain or "")
    if not entry or not entry.get("user"):
        raise SshError(f"'{inst.name}' has no SSH user — set one in its form", 409)
    return Target(
        id=inst.id,
        host=str(entry.get("hostname") or inst.upstream),
        port=int(entry["port"]),
        user=str(entry["user"]),
    )


def _trusted(t: Target) -> str:
    key = logic.known_key(client.read_known_hosts(), t.id)
    if key is None:
        raise SshError("Trust the machine's host key first", 409)
    return key


def _main_key() -> asyncssh.SSHKey:
    me = auth.current_user()
    key = unlock.unlocked_key(me.username if me else None)
    if key is None:
        # 423, not 401 or 403: the page asks for the password and stays signed in. Each
        # user unlocks it for themselves, like sudo.
        raise SshError("Loskai's key is locked — enter your password", 423)
    return key


async def _run(
    t: Target, command: str, host_key: str | None = None, *,
    password: str | None = None, stdin: str | None = None,
) -> asyncssh.SSHCompletedProcess:
    """`command` on the machine, trusting only its trusted host key, logged in with the
    machine's `password` when given, else the main key (locked: 423). Not getting there is a
    502, in words."""
    host_key = host_key or _trusted(t)
    key = None if password else _main_key()
    try:
        return await client.run(
            t.host, t.port, t.user, host_key, command, client_key=key, password=password, stdin=stdin
        )
    except Exception as exc:  # noqa: BLE001 — any failure to get there is the same answer
        raise SshError(_describe(exc, t, "password" if password else "key"), 502)


def _describe(exc: BaseException, t: Target, credential: str) -> str:
    """What went wrong, in words — never the exception text of a password login, which
    asyncssh doesn't put the password in, but there is no reason to find out."""
    if isinstance(exc, asyncssh.HostKeyNotVerifiable):
        return f"{t.host}'s host key has changed — trust it again only if you know why"
    if isinstance(exc, asyncssh.PermissionDenied):
        return f"{t.user}@{t.host} refused the {credential}"
    if isinstance(exc, (OSError, TimeoutError, asyncio.TimeoutError)):
        return f"Can't reach {t.host}:{t.port}"
    if isinstance(exc, asyncssh.Error):
        return f"SSH to {t.host} failed: {exc.reason}"
    # Not the machine's doing — Loskai's own (2026-10-31: no local user name in the
    # container). The page gets the short answer; the log gets the cause.
    logger.warning("SSH to %s failed", t.host, exc_info=exc)
    return f"SSH to {t.host} failed — see Loskai's log"


# --- The host key ---


async def scan(machine_id: str) -> dict:
    """The machine's host key as it answers now, and how that compares with the trusted one:
    `new` (none trusted yet), `trusted`, or `changed`."""
    t = target(machine_id)
    try:
        key = await client.scan_host_key(t.host, t.port)
    except Exception as exc:  # noqa: BLE001 — any failure to reach it is the same answer
        raise SshError(_describe(exc, t, "connection"), 502)
    offered = key.export_public_key("openssh").decode().split()
    known = logic.known_key(client.read_known_hosts(), t.id)
    state = "new" if known is None else ("trusted" if known.split() == offered[:2] else "changed")
    # The lines this machine gets, for "I'll add it myself" — null before Loskai has a key.
    machine_lines = await asyncio.to_thread(lines, t) if client.public_key() else None
    return {"fingerprint": key.get_fingerprint(), "type": offered[0], "state": state, "lines": machine_lines}


async def trust(machine_id: str, fingerprint: str) -> dict:
    """Trust the host key the machine answers with — only if it is the one that was shown
    (`fingerprint`), so what is trusted is what the person looked at."""
    t = target(machine_id)
    try:
        key = await client.scan_host_key(t.host, t.port)
    except Exception as exc:  # noqa: BLE001
        raise SshError(_describe(exc, t, "connection"), 502)
    if key.get_fingerprint() != fingerprint:
        raise SshError("The machine answered with a different host key than the one shown", 409)
    line = " ".join(key.export_public_key("openssh").decode().split()[:2])
    client.update_known_hosts(lambda text: logic.set_known(text, t.id, line))
    _drop_cached(t.id)
    return {"fingerprint": fingerprint, "state": "trusted"}


def forget(machine_id: str) -> None:
    """A deleted machine's host key, running list and overview go with it."""
    client.update_known_hosts(lambda text: logic.forget_known(text, machine_id))
    _drop_cached(machine_id)


# --- Installing and testing Loskai's keys ---


def from_addresses(t: Target | None = None) -> str | None:
    """Where Loskai's connections to `t` come from, for the lines' `from=`: the Docker host's
    address, and its Tailscale address when set — a machine reached over Tailscale sees that
    one. Both on every machine, so a machine needs no telling which way it is reached. To the
    Docker host itself, which Docker doesn't translate, connections arrive from Loskai's
    container on its own networks, so their subnets are added. None without `host_ip`: the
    lines then have no `from=` (the Tailscale address alone would lock out every LAN machine)."""
    host_ip = settings_store.value("host_ip")
    if not host_ip:
        return None
    tailnet_ip = settings_store.value("host_tailscale_ip")
    addresses = [host_ip, *([tailnet_ip] if tailnet_ip else [])]
    if t is None or t.host not in addresses:
        return ",".join(addresses)
    try:
        subnets = docker_client.own_subnets()
    except Exception as exc:  # noqa: BLE001 — Docker unreachable: the plain line, as before
        logger.warning("Loskai's own networks not read for %s's from=: %s", t.host, exc)
        subnets = []
    return ",".join([*addresses, *subnets])


def lines(t: Target | None = None) -> list[str]:
    """Loskai's two `authorized_keys` lines — the main key's, then the status key's — for
    machine `t`, or as most machines get them. Asks Docker for `t` = the Docker host, so
    call it off the event loop then."""
    public = client.public_key()
    if public is None:
        raise SshError("Loskai has no key yet", 409)
    from_ip = from_addresses(t)
    return [
        logic.authorized_keys_line(public, from_ip),
        logic.status_line(client.status_public_key(), from_ip),
    ]


async def install(machine_id: str, password: str) -> dict:
    """Log in once with the machine's password, put Loskai's lines in `authorized_keys`
    (replacing any it put there before), then prove both keys work. The password is used
    for that one connection and kept nowhere."""
    t = target(machine_id)
    _main_key()  # locked → ask for your password before the machine's is used
    result = await _run(
        t, logic.INSTALL_SCRIPT,
        password=password, stdin="\n".join(await asyncio.to_thread(lines, t)) + "\n",
    )
    if result.exit_status != 0:
        detail = str(result.stderr or "").strip().splitlines()[-1:] or ["no error output"]
        raise SshError(f"Adding Loskai's key on {t.host} failed: {detail[0]}", 502)
    return await test(machine_id)


def removal(machine_id: str) -> tuple[Target, str] | None:
    """Where Loskai's lines would be taken off a machine about to be deleted — its target and
    trusted host key, read now, before the delete clears its name — or None when it has none
    to take: no SSH user, a host key never trusted, or no key made yet. SshError 423 while
    the key is locked, so the page asks for your password before anything changes."""
    try:
        t = target(machine_id)
        host_key = _trusted(t)
    except SshError:
        return None
    if client.public_key() is None:
        return None
    _main_key()
    return t, host_key


async def uninstall(t: Target, host_key: str) -> bool:
    """Take what Loskai put on the machine off it, with the main key: its sudo rule, then its
    lines in `authorized_keys`. True when the sudo rule stayed (the lines are gone either
    way). Raises SshError: 423 the key locked meanwhile, 502 the machine can't be reached or
    refused."""
    result = await _run(t, logic.UNINSTALL_SCRIPT, host_key)
    if result.exit_status != 0:
        detail = str(result.stderr or "").strip().splitlines()[-1:] or ["no error output"]
        raise SshError(f"Removing Loskai's key on {t.host} failed: {detail[0]}", 502)
    return "!sudo-rule" in str(result.stdout or "").splitlines()


async def test(machine_id: str) -> dict:
    """Log in with the main key, then read what runs with the status key."""
    t = target(machine_id)
    host_key = _trusted(t)
    result = await _run(t, "true", host_key)
    if result.exit_status != 0:
        raise SshError(f"Logged in to {t.host}, but a command there failed", 502)
    # A (re)install may have put a newer status line there: the overview is asked again.
    _facts.pop(t.id, None)
    return {"key": True, "running": await _read_running(t, host_key)}


# --- The terminal ---


async def open_terminal(
    machine_id: str, cols: int, rows: int, command: str | None = None, password: str | None = None,
):
    """A shell on the machine — or a tool's `command` (see `plan`) — with the main key,
    which must be unlocked, so a terminal is only opened within the unlock time of the
    user's password. Given sudo's `password`, it is the first line the command reads
    (`tool.visible`). Returns the target, connection and process; the caller closes the
    connection."""
    t = target(machine_id)
    host_key = _trusted(t)
    key = _main_key()
    try:
        conn, process = await asyncio.wait_for(
            client.open_shell(t.host, t.port, t.user, host_key, key, cols, rows, command, password), client.TIMEOUT
        )
    except Exception as exc:  # noqa: BLE001
        raise SshError(_describe(exc, t, "key"), 502)
    return t, conn, process


def log(event: str, machine_id: str, peer: str | None, **details) -> None:
    """Record an SSH event — a terminal opened, closed or refused, an install — and who did
    it, for the log the app shows. Sessions, not keystrokes: what is typed can be a password at a sudo prompt.
    Best-effort: a log that can't be written never stops the session."""
    entry = {"at": datetime.now(UTC).isoformat(), "event": event, "machine": machine_id, "from": peer}
    # Who: the account acting, where there is one (a request or a terminal of theirs).
    if (me := auth.current_user()) is not None:
        entry["user"] = me.username
    entry.update(details)
    try:
        client.append_log(entry)
    except OSError as exc:
        logger.warning("SSH log not written: %s", exc)


# --- What runs there ---


async def _ask_status(t: Target, host_key: str, command: str, parse) -> dict:
    """What the status key's forced command answers to `command`, parsed — always a view:
    `ok` false with `error` (and `old` for a status line older than this Loskai, so the page
    offers the reinstall) when it can't be read. Stamped `checked`."""
    try:
        result = await client.run(t.host, t.port, t.user, host_key, command, client_key=client.status_key())
        view = {"ok": True, **parse(str(result.stdout or ""))}
    except logic.OldStatusLine:
        view = {"ok": False, "old": True, "error": "Its status line is older than this Loskai — install again"}
    except ValueError:
        view = {"ok": False, "error": "The status key's line on the machine is missing or out of date — install again"}
    except asyncssh.PermissionDenied:
        view = {"ok": False, "error": "The machine doesn't accept the status key — install again"}
    except Exception as exc:  # noqa: BLE001
        view = {"ok": False, "error": _describe(exc, t, "status key")}
    view["checked"] = time.time()
    return view


async def _read_running(t: Target, host_key: str) -> dict:
    view = await _ask_status(t, host_key, "running", logic.parse_running)
    _running[t.id] = (time.monotonic(), view)
    return view


async def running() -> dict[str, dict]:
    """What runs on every machine that is set up — an SSH user and a trusted host key — by
    machine id. Reused for `RUNNING_TTL`, so however many tabs ask, each machine is asked
    at most that often; the rest are asked at once, in parallel."""
    known = client.read_known_hosts()
    out: dict[str, dict] = {}
    stale: list[tuple[Target, str]] = []
    for inst in instances_store.list_instances():
        if not instances_store.is_machine(inst):
            continue
        try:
            t = target(inst.id)
        except SshError:
            continue
        host_key = logic.known_key(known, t.id)
        if host_key is None:
            continue
        cached = _running.get(t.id)
        if cached and time.monotonic() - cached[0] < RUNNING_TTL:
            out[t.id] = cached[1]
        else:
            stale.append((t, host_key))
    for (t, _), view in zip(
        stale, await asyncio.gather(*(_read_running(t, k) for t, k in stale)), strict=True
    ):
        out[t.id] = view
    return out


# --- The machine's overview ---


async def facts(machine_id: str) -> dict:
    """The machine's overview, read with the status key (`logic.parse_facts`), reused for
    `FACTS_TTL`. Always a view, never an error once the machine is set up: `ok` false with
    `error` — and `old` when its status line is older than this Loskai, so the page offers the
    reinstall."""
    t = target(machine_id)
    host_key = _trusted(t)
    cached = _facts.get(t.id)
    if cached and time.monotonic() - cached[0] < FACTS_TTL:
        return cached[1]
    view = await _ask_status(t, host_key, "facts", logic.parse_facts)
    _facts[t.id] = (time.monotonic(), view)
    return view


async def _overview(machine_id: str) -> dict:
    """The machine's overview, which a tool's command is worked out from — or 409."""
    f = await facts(machine_id)
    if not f.get("ok"):
        raise SshError(f"Its overview is needed first: {f.get('error')}", 409)
    return f


def _tool(tool_id: str) -> tool.Tool:
    found = tool.load().get(tool_id)
    if found is None:
        raise SshError(f"No tool {tool_id!r}", 404)
    return found


# --- Tools ---


async def plan(
    machine_id: str, tool_id: str, action_id: str | None, target_name: str | None, install: bool,
    password: bool = False,
) -> tuple[str, dict, bool]:
    """What a terminal runs for a tool's action — or to install what the tool lacks — on
    this machine, what the log says about it, and whether it is automatic (`Action.automatic`;
    an install is). The command comes from the tool file and the machine's overview (its
    package manager, its programs), never from the request; with `password` it reads
    sudo's first (`tool.visible`). Raises SshError: 404 no such tool or action, 409 it can't
    run here as asked."""
    t = _tool(tool_id)
    target(machine_id)  # an SSH user, or 409
    inst = instances_store.get_instance(machine_id)
    f = await _overview(machine_id)
    manager = (f.get("updates") or {}).get("manager")
    programs = set(f.get("programs") or [])
    try:
        if install:
            script = tool.install_script(t, programs, manager)
            # Never in tmux: it may be tmux that is missing.
            return tool.visible(script, None, None, automatic=True, password=password), {
                "event": "add-tool", "tool": t.id, "programs": tool.to_install(t, programs), "command": script,
            }, True
        lacking = tool.missing(t, programs)
        if lacking:
            raise SshError(f"{t.name} needs {', '.join(lacking)} — add it first", 409)
        action = t.actions.get(action_id or "")
        if action is None:
            raise SshError(f"{t.name} has no action {action_id!r}", 404)
        tool.check_target(action.target or action.ask, target_name)
        script = tool.action_script(t, action.id, manager)
    except tool.ToolError as exc:
        raise SshError(str(exc), 409)
    session = tool.session_name(t, action, target_name) if "tmux" in programs else None
    command = tool.visible(
        script, target_name, session, inst.projects_folder if inst else None,
        automatic=action.automatic, password=password,
    )
    details = {
        "event": "action", "tool": t.id, "action": action.id, "target": target_name,
        "command": script, "tmux": session,
    }
    # The sudo rule lets this one run without a password — once it is on the machine.
    if (t.id, action.id) == tool.RULE_ACTION and f.get("sudo_rule") == "on":
        details["covered"] = True
    return command, details, action.automatic


async def plan_sudo(machine_id: str, allow: bool, password: bool = False) -> tuple[str, dict, bool]:
    """What a terminal runs to put the sudo rule on (`allow`) — for System's update on this
    machine's package manager — or to take it off, and what the log says; always automatic.
    Raises SshError 409 before the overview says which package manager it has."""
    target(machine_id)  # an SSH user, or 409
    if allow:
        f = await _overview(machine_id)
        try:
            script = tool.allow_script((f.get("updates") or {}).get("manager"))
        except tool.ToolError as exc:
            raise SshError(str(exc), 409)
    else:
        script = tool.REMOVE_RULE_SCRIPT
    command = tool.visible(script, None, None, automatic=True, password=password)
    # Taking the rule off is the rule's own last line: it needs no password.
    details = {"event": "sudo-rule", "allow": allow, "command": script}
    if not allow:
        details["covered"] = True
    return command, details, True


# --- sudo's password, for an automatic run ---

PASSWORD_TTL = 60  # seconds a checked password waits for its terminal

# ticket → (username, machine id, the run it was given for, password, expiry). In memory only,
# taken once.
_passwords: dict[str, tuple[str | None, str, str, str, float]] = {}


def _run_of(details: dict) -> str:
    """The run a password was given for — what the log says of it, which names the tool,
    action, target and command — so a ticket can't be spent on another."""
    return repr(sorted((k, repr(v)) for k, v in details.items() if k != "covered"))


async def prepare(machine_id: str, details: dict, automatic: bool, password: str | None) -> dict:
    """Whether a run asks for sudo's password before its terminal opens — only an automatic
    one, and only when sudo would: not for root, a command without `sudo`, one the sudo rule
    covers, or a user sudo lets in without a password (`sudo -n true`). Given the
    `password`, sudo checks it (`sudo -S -v`, over a connection of its own) and it is held
    for the terminal under a one-time ticket, for this user and machine, for
    `PASSWORD_TTL`. It is never logged, stored, or put in a command line.
    Raises SshError 422 when sudo refuses it, 409 when the user may not use sudo there."""
    no = {"automatic": automatic, "needs_password": False, "ticket": None}
    if not automatic:
        return no
    t = target(machine_id)
    if t.user == "root" or "sudo" not in details["command"] or details.get("covered"):
        return no
    result = await _run(
        t, "sudo -n true" if password is None else "sudo -S -p '' -v",
        stdin=None if password is None else password + "\n",
    )
    said = str(result.stderr or "")
    if result.exit_status == 127:
        raise SshError("sudo isn't installed on it — log in as root, or install sudo", 409)
    if "not in the sudoers" in said or "may not run sudo" in said:
        raise SshError(f"{t.user} may not use sudo there", 409)
    if result.exit_status == 0 and password is None:
        return no
    if password is None:
        return {**no, "needs_password": True, "user": t.user}
    if result.exit_status != 0:
        raise SshError(f"sudo didn't accept that password for {t.user}", 422)
    me = auth.current_user()
    now = time.monotonic()
    ticket = secrets.token_urlsafe(24)
    _passwords[ticket] = (me.username if me else None, machine_id, _run_of(details), password, now + PASSWORD_TTL)
    # Gone when its minute is up, taken or not — a dialog closed before its terminal opened
    # leaves nothing behind.
    asyncio.get_running_loop().call_later(PASSWORD_TTL, _passwords.pop, ticket, None)
    return {**no, "needs_password": True, "user": t.user, "ticket": ticket}


def take_password(ticket: str, machine_id: str, details: dict) -> str:
    """The password held under `ticket` — once, for the user who gave it, on that machine, for
    the run it was given for (`details`, as `plan` describes it). Raises SshError 409 when it
    is gone or isn't for this."""
    held = _passwords.pop(ticket, None)
    me = auth.current_user()
    if (
        held is None
        or held[4] < time.monotonic()
        or held[:3] != (me.username if me else None, machine_id, _run_of(details))
    ):
        raise SshError("That password is no longer held — run it again", 409)
    return held[3]


# --- A tool's settings ---


async def _tool_here(machine_id: str, tool_id: str) -> tool.Tool:
    """The tool, applying on this machine — it has every program it requires."""
    t = _tool(tool_id)
    f = await _overview(machine_id)
    lacking = tool.missing(t, set(f.get("programs") or []))
    if lacking:
        raise SshError(f"{t.name} needs {', '.join(lacking)} — add it first", 409)
    return t


async def read_settings(machine_id: str, tool_id: str) -> dict[str, str | None]:
    """A tool's settings as the machine has them now, by id — None where unset. Read with
    the main key, so the key must be unlocked (423)."""
    t = target(machine_id)
    found = await _tool_here(machine_id, tool_id)
    result = await _run(t, f"sh -c {shlex.quote(logic.USER_PATH + tool.read_settings_script(found))}")
    return tool.parse_settings(found, str(result.stdout or ""))


async def write_setting(
    machine_id: str, tool_id: str, setting_id: str, value: str, peer: str | None = None,
) -> dict[str, str | None]:
    """Set one of a tool's settings on the machine, then read them all back — the effect,
    not the exit code. Logged, with the value. Raises SshError 404/422 for no such setting
    or a value it can't take, 502 when the machine says no."""
    t = target(machine_id)
    found = await _tool_here(machine_id, tool_id)
    try:
        script = tool.write_setting_script(found, setting_id, value)
    except tool.ToolError as exc:
        raise SshError(str(exc), 404 if setting_id not in found.settings else 422)
    result = await _run(t, f"sh -c {shlex.quote(logic.USER_PATH + script)}")
    log("setting", machine_id, peer, tool=found.id, setting=setting_id, value=value, ok=result.exit_status == 0)
    if result.exit_status != 0:
        said = str(result.stderr or result.stdout or "").strip().splitlines()
        raise SshError(f"The machine said: {said[0] if said else f'exit {result.exit_status}'}", 502)
    return await read_settings(machine_id, tool_id)


def after_action(machine_id: str) -> None:
    """An action or an install may have changed what runs and what the machine has."""
    _drop_cached(machine_id)
