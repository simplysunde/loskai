"""SSH module routes — Loskai's keys, the config file saying how each machine is reached,
and setting a machine up: trusting its host key, installing the keys, testing them, and
what runs there.

Making, replacing or unlocking the key asks for your password again (`unlock.py`);
nothing here ever returns a private key. A machine's own password (Install it for me) is
used for one connection and kept nowhere.
"""

import asyncio
import contextlib
import json
import time
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, WebSocket
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ...shared import auth
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from ...shared import store
from ...shared import terminal
from ...shared.errors import LoskaiError
from . import client, connect, logic, tool, unlock

router = APIRouter(prefix="/api/ssh", tags=["ssh"])


def _key_view() -> dict | None:
    public = client.public_key()
    if public is None:
        return None
    # The Docker host's addresses are where Loskai's connections come from, so they are what
    # the key is limited to. Unset, the line has no `from=` and the Machines tab says so.
    from_patterns = connect.from_addresses()
    me = auth.current_user()
    until = unlock.unlocked_until(me.username if me else None)
    return {
        "public_key": public,
        "fingerprint": logic.fingerprint_of(public),
        # Both lines a machine gets — the main key's, then the status key's.
        "lines": connect.authorized_keys_lines(),
        "from": from_patterns,
        "unlocked_until": datetime.fromtimestamp(until, UTC).isoformat() if until else None,
        # False: an admin switched off asking for the password — it is never locked.
        "asks_password": settings_store.ssh_asks_password(),
    }


def _known() -> dict[str, bool]:
    """Which machines (by id) have a trusted host key."""
    return dict.fromkeys(logic.known_keys(client.read_known_hosts()), True)


@router.get("")
def ssh_status() -> dict:
    """Loskai's key (null before one is made), each `Host` in the config, which machines
    have a trusted host key, how each machine with an SSH user is reached
    (`connect.target_of`), and each machine's projects folder."""
    hosts = logic.hosts(client.read_config())
    machines = [i for i in instances_store.list_instances() if instances_store.is_machine(i)]
    return {
        "key": _key_view(),
        "hosts": hosts,
        "trusted": _known(),
        "targets": {i.id: t.shown() for i in machines if (t := connect.target_of(i, hosts))},
        "projects": {i.id: tool.show_projects_folder(i.projects_folder) for i in machines},
    }


class KeyRequest(BaseModel):
    password: str
    replace: bool = False


@router.post("/key")
def create_key(body: KeyRequest, request: Request) -> dict | None:
    """Make Loskai's key, or replace it (`replace`). The admin's password is checked — with
    the login backoff — and, just typed, unlocks the new key for them, as Unlock does."""
    if client.public_key() is not None and not body.replace:
        raise HTTPException(status_code=409, detail="Loskai already has a key — use New key to replace it")
    me = auth.check_password(body.password, request, wrong_status=403, asked_for="new SSH key")
    client.create_key()
    unlock.unlock(me.username)
    return _key_view()


class PasswordRequest(BaseModel):
    password: str


@router.post("/unlock")
def unlock_key(body: PasswordRequest, request: Request) -> dict | None:
    """Unlock the key with your own password (checked with the login backoff), for as long
    as Settings › SSH says — for you; logging out locks it again."""
    if client.public_key() is None:
        raise HTTPException(status_code=409, detail="Loskai has no key yet")
    me = auth.check_password(body.password, request, wrong_status=403, asked_for="SSH unlock")
    unlock.unlock(me.username)
    return _key_view()


# --- Setting a machine up ---


@router.post("/machines/{machine_id}/scan")
async def scan(machine_id: str) -> dict:
    """The machine's host key now — `new`, `trusted` or `changed` — to show before trusting."""
    return await connect.scan(machine_id)


class TrustRequest(BaseModel):
    fingerprint: str


@router.post("/machines/{machine_id}/trust")
async def trust(machine_id: str, body: TrustRequest) -> dict:
    """Trust the host key the person was shown (`409` if the machine now offers another)."""
    return await connect.trust(machine_id, body.fingerprint)


@router.post("/machines/{machine_id}/install")
async def install(machine_id: str, body: PasswordRequest, request: Request) -> dict:
    """Install it for me: the machine's password, used once to add Loskai's lines, then a
    test with the keys. Needs a trusted host key (`409`) and the key unlocked (`423`)."""
    try:
        result = await connect.install(machine_id, body.password)
    except connect.SshError as exc:
        connect.log("install", machine_id, auth.peer(request), ok=False, error=exc.detail)
        raise
    connect.log("install", machine_id, auth.peer(request), ok=True)
    return result


@router.post("/machines/{machine_id}/test")
async def test(machine_id: str) -> dict:
    """Log in with the key, and read what runs with the status key."""
    return await connect.test(machine_id)


@router.get("/machines/{machine_id}/facts")
async def facts(machine_id: str) -> dict:
    """The machine's overview — OS, memory, disks, updates, tools, tmux sessions — read with
    the status key, from a short cache (`connect.FACTS_TTL`)."""
    return await connect.facts(machine_id)


@router.get("/tools")
def tools() -> list[dict]:
    """Every tool in the image, with its actions and their commands."""
    return [tool.view(t) for t in tool.load().values()]


class ProjectsRequest(BaseModel):
    folder: str | None = None


@router.put("/machines/{machine_id}/projects")
def set_projects(machine_id: str, body: ProjectsRequest) -> dict:
    """Set a machine's projects folder — `~` or one folder in it; null or empty for the
    default, `~/projects`. Its tools' actions find it as `$PROJECTS`."""
    folder = tool.parse_projects_folder(body.folder) if body.folder and body.folder.strip() else None
    if folder == tool.DEFAULT_PROJECTS_FOLDER:
        folder = None
    if instances_store.set_projects_folder(machine_id, folder) is None:
        raise HTTPException(404, f"No machine '{machine_id}'")
    return {"folder": tool.show_projects_folder(folder)}


class RunRequest(BaseModel):
    tool: str | None = None
    action: str | None = None
    target: str | None = None
    install: bool = False
    sudo: Literal["allow", "remove"] | None = None
    password: str | None = None


async def _plan(machine_id: str, r: RunRequest, password: bool = False) -> tuple[str, dict, bool]:
    """A tool's action, an install or the sudo rule — what the terminal runs for them."""
    if r.tool:
        return await connect.plan(machine_id, r.tool, r.action, r.target, r.install, password)
    if r.sudo:
        return await connect.plan_sudo(machine_id, r.sudo == "allow", password)
    raise connect.SshError("Name a tool's action, an install, or the sudo rule", 422)


@router.post("/machines/{machine_id}/run")
async def prepare_run(machine_id: str, body: RunRequest) -> dict:
    """Before a run's terminal opens: whether it is automatic, and whether sudo needs a
    password for it (`connect.prepare`). Given the `password`, sudo checks it, and the
    answer carries the `ticket` the terminal takes — once, within a minute."""
    _, details, automatic = await _plan(machine_id, body)
    return await connect.prepare(machine_id, details, automatic, body.password)


@router.get("/machines/{machine_id}/tools/{tool_id}/settings")
async def tool_settings(machine_id: str, tool_id: str) -> dict:
    """A tool's settings as the machine has them now (`{ values, targets }`: the machine's,
    and each project's), read with the main key."""
    return await connect.read_settings(machine_id, tool_id)


class SettingRequest(BaseModel):
    value: str  # empty: take it off, where the setting can be
    target: str | None = None  # the project, for a project's setting


@router.put("/machines/{machine_id}/tools/{tool_id}/settings/{setting_id}")
async def set_tool_setting(machine_id: str, tool_id: str, setting_id: str, body: SettingRequest, request: Request) -> dict:
    """Set one of a tool's settings on the machine; `{ values, targets }` read back after."""
    return await connect.write_setting(
        machine_id, tool_id, setting_id, body.value.strip(), auth.peer(request), body.target,
    )


@router.get("/log")
def session_log(limit: int = 200, machine: str | None = None) -> list[dict]:
    """The SSH log, newest first: terminals opened, closed and refused, runs and installs —
    one machine's, given one (its dialog) — an admin's, as every log is (access.py)."""
    return client.read_log(max(1, min(limit, store.LOG_KEEP)), machine)


@router.websocket("/machines/{machine_id}/terminal")
async def machine_terminal(
    websocket: WebSocket, machine_id: str, cols: int = 80, rows: int = 24,
    tool: str | None = None, action: str | None = None, target: str | None = None,
    install: bool = False, sudo: Literal["allow", "remove"] | None = None, sudo_password: bool = False,
):
    """A shell on the machine — or, given `tool` and `action` (and `target` for a row's
    action) or `install` (what the tool lacks), that command, worked out by `connect.plan`
    from the tool file; or `sudo` — putting on or taking off the rule that lets System's
    update run without a password (`connect.plan_sudo`). The request only names it; with
    `sudo_password`, the socket's first message is the `ticket` from `POST …/run`
    (`_ticket`), which brings sudo's password, sent as the run's first line. Like the container
    terminal it sits outside the HTTP middleware, so it checks the session and the `Origin`
    itself (closing `1008`), and closes when the session ends. It also needs the key
    unlocked: closed `4423` while it is locked, `4409` before the host key is trusted or
    when the action can't run here, `4404` no such machine, tool or action, `4502` when
    the machine refuses; the close reason says which in words."""
    cookie = await terminal.accept(websocket, "machines")
    if cookie is None:
        return
    peer = auth.peer(websocket)
    command, details, password = None, None, None
    try:
        if sudo_password and not (tool or sudo):
            raise connect.SshError("A password is only for a tool's action", 422)
        ticket = await _ticket(websocket) if sudo_password else None
        if tool or sudo:
            asked = RunRequest(tool=tool, action=action, target=target, install=install, sudo=sudo)
            command, details, _ = await _plan(machine_id, asked, sudo_password)
        if ticket:
            password = connect.take_password(ticket, machine_id, details)
        ssh_target, conn, process = await connect.open_terminal(
            machine_id, terminal.clamp(cols), terminal.clamp(rows), command, password
        )
    except LoskaiError as exc:  # SshError, or a tool's ToolError
        asked = {"tool": tool, "action": "install" if install else action} if tool else {"sudo": sudo} if sudo else {}
        connect.log("refused", machine_id, peer, error=exc.detail, **asked)
        # A close reason is at most 123 bytes. The browser may have gone already.
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=4000 + exc.status_code, reason=exc.detail.encode()[:120].decode(errors="ignore"))
        return
    started = time.monotonic()
    if details:
        details.pop("covered", None)
        # That sudo's password came with it — never the password.
        connect.log(details.pop("event"), machine_id, peer, **details, **({"sudo_password": True} if password else {}))
    else:
        connect.log("open", machine_id, peer, target=f"{ssh_target.user}@{ssh_target.host}:{ssh_target.port}")

    async def write(data: bytes) -> None:
        process.stdin.write(data)

    async def resize(rows: int, cols: int) -> None:
        process.change_terminal_size(cols, rows)

    try:
        await terminal.relay(websocket, cookie, "machines", lambda: process.stdout.read(4096), write, resize)
    finally:
        # Closing the connection hangs up the pty, so the shell ends with the terminal.
        conn.close()
        connect.log("close", machine_id, peer, seconds=round(time.monotonic() - started))
        if details is not None:
            connect.after_action(machine_id)
        with contextlib.suppress(RuntimeError):  # the browser closed it first
            await websocket.close()


# How long a terminal waits for its ticket, which the page sends the moment the socket opens.
TICKET_WAIT = 10  # seconds


async def _ticket(websocket: WebSocket) -> str:
    """The ticket for sudo's password: the socket's first message, `{"type": "ticket",
    "ticket": …}` — never in the URL, which uvicorn's access log keeps."""
    try:
        msg = await asyncio.wait_for(websocket.receive(), TICKET_WAIT)
        sent = json.loads(msg.get("text") or "")
    except (TimeoutError, ValueError):
        sent = None
    if isinstance(sent, dict) and sent.get("type") == "ticket" and isinstance(sent.get("ticket"), str):
        return sent["ticket"]
    raise connect.SshError("The password's ticket didn't come first — run it again", 422)


@router.get("/running")
async def running() -> dict:
    """What runs on each set-up machine, by id — from a short cache (`connect.RUNNING_TTL`)."""
    return await connect.running()


@router.get("/config")
def export_config() -> PlainTextResponse:
    """The SSH config, for the `ssh` on your own computer. It names no key, so your own
    keys are used."""
    return PlainTextResponse(
        client.read_config(),
        headers={"Content-Disposition": 'attachment; filename="loskai-ssh-config"'},
    )
