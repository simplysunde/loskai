"""Reaching a machine over SSH: trusting its host key, installing Loskai's keys on it,
testing them, and reading what runs there.

A machine is reached as its SSH config entry says (`Host` = its hostname: `HostName`,
`User`, `Port`), and only ever with the host key trusted for its id. The order is the
safety: a host key is shown and trusted before any password is sent, so a password only
goes to the machine whose fingerprint was accepted.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import asyncssh

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


class SshError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


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
        raise SshError(404, f"no machine '{machine_id}'")
    entry = logic.hosts(client.read_config()).get(inst.subdomain or "")
    if not entry or not entry.get("user"):
        raise SshError(409, f"'{inst.name}' has no SSH user — set one in its form")
    return Target(
        id=inst.id,
        host=str(entry.get("hostname") or inst.upstream),
        port=int(entry["port"]),
        user=str(entry["user"]),
    )


def _trusted(t: Target) -> str:
    key = logic.known_key(client.read_known_hosts(), t.id)
    if key is None:
        raise SshError(409, "Trust the machine's host key first")
    return key


def _main_key() -> asyncssh.SSHKey:
    key = unlock.unlocked_key()
    if key is None:
        # 423, not 401 or 403: the page asks for the admin password and stays signed in.
        raise SshError(423, "Loskai's key is locked — enter the admin password")
    return key


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
        raise SshError(502, _describe(exc, t, "connection"))
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
        raise SshError(502, _describe(exc, t, "connection"))
    if key.get_fingerprint() != fingerprint:
        raise SshError(409, "The machine answered with a different host key than the one shown")
    line = " ".join(key.export_public_key("openssh").decode().split()[:2])
    client.update_known_hosts(lambda text: logic.set_known(text, t.id, line))
    _drop_cached(t.id)
    return {"fingerprint": fingerprint, "state": "trusted"}


def forget(machine_id: str) -> None:
    """A deleted machine's host key, running list and overview go with it."""
    client.update_known_hosts(lambda text: logic.forget_known(text, machine_id))
    _drop_cached(machine_id)


# --- Installing and testing Loskai's keys ---


def _from(t: Target | None) -> str | None:
    """Where Loskai's connections to `t` come from, for the lines' `from=`: the Docker host's
    address — except to the Docker host itself, which Docker doesn't translate, so those
    arrive from Loskai's container on its own networks, and their subnets are added."""
    host_ip = settings_store.value("host_ip")
    if not host_ip or t is None or t.host != host_ip:
        return host_ip
    try:
        subnets = docker_client.own_subnets()
    except Exception as exc:  # noqa: BLE001 — Docker unreachable: the plain line, as before
        logger.warning("Loskai's own networks not read for %s's from=: %s", t.host, exc)
        subnets = []
    return ",".join([host_ip, *subnets])


def lines(t: Target | None = None) -> list[str]:
    """Loskai's two `authorized_keys` lines — the main key's, then the status key's — for
    machine `t`, or as most machines get them. Asks Docker for `t` = the Docker host, so
    call it off the event loop then."""
    public = client.public_key()
    if public is None:
        raise SshError(409, "Loskai has no key yet")
    from_ip = _from(t)
    return [
        logic.authorized_keys_line(public, from_ip),
        logic.status_line(client.status_public_key(), from_ip),
    ]


async def install(machine_id: str, password: str) -> dict:
    """Log in once with the machine's password, put Loskai's lines in `authorized_keys`
    (replacing any it put there before), then prove both keys work. The password is used
    for that one connection and kept nowhere."""
    t = target(machine_id)
    host_key = _trusted(t)
    _main_key()  # locked → ask for the admin password before the machine's is used
    try:
        result = await client.run(
            t.host, t.port, t.user, host_key, logic.INSTALL_SCRIPT,
            password=password, stdin="\n".join(await asyncio.to_thread(lines, t)) + "\n",
        )
    except Exception as exc:  # noqa: BLE001
        raise SshError(502, _describe(exc, t, "password"))
    if result.exit_status != 0:
        detail = str(result.stderr or "").strip().splitlines()[-1:] or ["no error output"]
        raise SshError(502, f"Adding Loskai's key on {t.host} failed: {detail[0]}")
    return await test(machine_id)


async def test(machine_id: str) -> dict:
    """Log in with the main key, then read what runs with the status key."""
    t = target(machine_id)
    host_key = _trusted(t)
    key = _main_key()
    try:
        result = await client.run(t.host, t.port, t.user, host_key, "true", client_key=key)
    except Exception as exc:  # noqa: BLE001
        raise SshError(502, _describe(exc, t, "key"))
    if result.exit_status != 0:
        raise SshError(502, f"Logged in to {t.host}, but a command there failed")
    # A (re)install may have put a newer status line there: the overview is asked again.
    _facts.pop(t.id, None)
    return {"key": True, "running": await _read_running(t, host_key)}


# --- The terminal ---


async def open_terminal(machine_id: str, cols: int, rows: int, command: str | None = None):
    """A shell on the machine — or a tool's `command` (see `plan`) — with the main key,
    which must be unlocked, so a terminal is only opened within 15 minutes of the admin
    password. Returns the target, connection and process; the caller closes the connection."""
    t = target(machine_id)
    host_key = _trusted(t)
    key = _main_key()
    try:
        conn, process = await asyncio.wait_for(
            client.open_shell(t.host, t.port, t.user, host_key, key, cols, rows, command), client.TIMEOUT
        )
    except Exception as exc:  # noqa: BLE001
        raise SshError(502, _describe(exc, t, "key"))
    return t, conn, process


def log(event: str, machine_id: str, peer: str | None, **details) -> None:
    """Record an SSH event — a terminal opened, closed or refused, an install — for the log
    the app shows. Sessions, not keystrokes: what is typed can be a password at a sudo prompt.
    Best-effort: a log that can't be written never stops the session."""
    entry = {"at": datetime.now(UTC).isoformat(), "event": event, "machine": machine_id, "from": peer}
    entry.update(details)
    try:
        client.append_log(entry)
    except OSError as exc:
        logger.warning("SSH log not written: %s", exc)


# --- What runs there ---


async def _read_running(t: Target, host_key: str) -> dict:
    try:
        result = await client.run(
            t.host, t.port, t.user, host_key, "running", client_key=client.status_key()
        )
        view = {"ok": True, **logic.parse_running(str(result.stdout or ""))}
    except ValueError:
        view = {"ok": False, "error": "The status key's line on the machine is missing or out of date — install again"}
    except asyncssh.PermissionDenied:
        view = {"ok": False, "error": "The machine doesn't accept the status key — install again"}
    except Exception as exc:  # noqa: BLE001
        view = {"ok": False, "error": _describe(exc, t, "status key")}
    view["checked"] = time.time()
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
    try:
        result = await client.run(
            t.host, t.port, t.user, host_key, "facts", client_key=client.status_key()
        )
        view = {"ok": True, **logic.parse_facts(str(result.stdout or ""))}
    except logic.OldStatusLine:
        view = {"ok": False, "old": True, "error": "Its status line is older than this Loskai — install again"}
    except ValueError:
        view = {"ok": False, "error": "The status key's line on the machine is missing or out of date — install again"}
    except asyncssh.PermissionDenied:
        view = {"ok": False, "error": "The machine doesn't accept the status key — install again"}
    except Exception as exc:  # noqa: BLE001
        view = {"ok": False, "error": _describe(exc, t, "status key")}
    view["checked"] = time.time()
    _facts[t.id] = (time.monotonic(), view)
    return view


# --- Tools ---


async def plan(
    machine_id: str, tool_id: str, action_id: str | None, target_name: str | None, install: bool
) -> tuple[str, dict]:
    """What a terminal runs for a tool's action — or to install what the tool lacks — on
    this machine, and what the log says about it. The command comes from the tool file
    and the machine's overview (its package manager, its programs), never from the request.
    Raises SshError: 404 no such tool or action, 409 it can't run here as asked."""
    t = tool.load().get(tool_id)
    if t is None:
        raise SshError(404, f"No tool {tool_id!r}")
    target(machine_id)  # an SSH user, or 409
    f = await facts(machine_id)
    if not f.get("ok"):
        raise SshError(409, f"Its overview is needed first: {f.get('error')}")
    manager = (f.get("updates") or {}).get("manager")
    programs = set(f.get("programs") or [])
    try:
        if install:
            script = tool.install_script(t, programs, manager)
            # Never in tmux: it may be tmux that is missing.
            return tool.visible(script, None, None), {
                "event": "add-tool", "tool": t.id, "programs": tool.to_install(t, programs), "command": script,
            }
        lacking = tool.missing(t, programs)
        if lacking:
            raise SshError(409, f"{t.name} needs {', '.join(lacking)} — add it first")
        action = t.actions.get(action_id or "")
        if action is None:
            raise SshError(404, f"{t.name} has no action {action_id!r}")
        tool.check_target(action.target or action.ask, target_name)
        script = tool.action_script(t, action.id, manager)
    except tool.ToolError as exc:
        raise SshError(409, str(exc))
    session = tool.session_name(t, action, target_name) if "tmux" in programs else None
    return tool.visible(script, target_name, session), {
        "event": "action", "tool": t.id, "action": action.id, "target": target_name,
        "command": script, "tmux": session,
    }


def after_action(machine_id: str) -> None:
    """An action or an install may have changed what runs and what the machine has."""
    _drop_cached(machine_id)
