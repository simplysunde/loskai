"""SSH module routes — Loskai's keys, the config file saying how each machine is reached,
and setting a machine up: trusting its host key, installing the keys, testing them, and
what runs there.

Making, replacing or unlocking the key asks for the admin password, which encrypts it;
nothing here ever returns a private key. A machine's own password (Install it for me) is
used for one connection and kept nowhere.
"""

import asyncio
import contextlib
import json
import time
from datetime import UTC, datetime
from typing import Literal

import asyncssh
from fastapi import APIRouter, HTTPException, Request, WebSocket
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ...shared import auth
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from . import client, connect, logic, tool, unlock

router = APIRouter(prefix="/api/ssh", tags=["ssh"])


def _peer(conn: Request | WebSocket) -> str | None:
    """Who is asking, for the log: the first `X-Forwarded-For` hop behind Caddy, else the
    socket's peer. Display only — nothing is decided by it."""
    forwarded = conn.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return conn.client.host if conn.client else None


def _key_view() -> dict | None:
    public = client.public_key()
    if public is None:
        return None
    # The Docker host's address is where Loskai's connections come from, so it is what the
    # key is limited to. Unset, the line has no `from=` and the Machines tab says so.
    from_ip = settings_store.value("host_ip")
    until = unlock.unlocked_until()
    return {
        "public_key": public,
        "fingerprint": logic.fingerprint_of(public),
        "authorized_keys": logic.authorized_keys_line(public, from_ip),
        # Both lines a machine gets — the main key's, then the status key's.
        "lines": connect.lines(),
        "from": from_ip,
        "unlocked_until": datetime.fromtimestamp(until, UTC).isoformat() if until else None,
    }


def _known() -> dict[str, bool]:
    """Which machines (by id) have a trusted host key."""
    return {
        line.split()[0]: True for line in client.read_known_hosts().splitlines() if line.strip()
    }


@router.get("")
def ssh_status() -> dict:
    """Loskai's key (null before one is made), each `Host` in the config, which machines
    have a trusted host key, and each machine's projects folder."""
    return {
        "key": _key_view(),
        "hosts": logic.hosts(client.read_config()),
        "trusted": _known(),
        "projects": {
            i.id: tool.show_folder(i.projects_folder)
            for i in instances_store.list_instances() if instances_store.is_machine(i)
        },
    }


class KeyRequest(BaseModel):
    password: str
    replace: bool = False


@router.post("/key")
def create_key(body: KeyRequest) -> dict | None:
    """Make Loskai's key, or replace it (`replace`). The admin password is checked — with the
    login backoff — and encrypts the new key."""
    if client.public_key() is not None and not body.replace:
        raise HTTPException(status_code=409, detail="Loskai already has a key — use New key to replace it")
    auth.check_password(body.password, wrong_status=403)
    client.create_key(body.password)
    # The password was just typed, so the new key starts unlocked, as after Unlock.
    unlock.unlock(client.load_key(body.password))
    return _key_view()


class PasswordRequest(BaseModel):
    password: str


@router.post("/unlock")
def unlock_key(body: PasswordRequest) -> dict | None:
    """Unlock the key for `unlock.UNLOCK_SECONDS` with the admin password (checked with the
    login backoff). Logging out locks it again."""
    if client.public_key() is None:
        raise HTTPException(status_code=409, detail="Loskai has no key yet")
    auth.check_password(body.password, wrong_status=403)
    try:
        key = client.load_key(body.password)
    except asyncssh.KeyImportError:
        # The admin password was reset since the key was made — only New key helps now.
        raise HTTPException(
            status_code=409, detail="The key was made with an earlier password — make a New key"
        )
    unlock.unlock(key)
    return _key_view()


# --- Setting a machine up ---


async def _call(action):
    try:
        return await action
    except connect.SshError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/machines/{machine_id}/scan")
async def scan(machine_id: str) -> dict:
    """The machine's host key now — `new`, `trusted` or `changed` — to show before trusting."""
    return await _call(connect.scan(machine_id))


class TrustRequest(BaseModel):
    fingerprint: str


@router.post("/machines/{machine_id}/trust")
async def trust(machine_id: str, body: TrustRequest) -> dict:
    """Trust the host key the person was shown (`409` if the machine now offers another)."""
    return await _call(connect.trust(machine_id, body.fingerprint))


@router.post("/machines/{machine_id}/install")
async def install(machine_id: str, body: PasswordRequest, request: Request) -> dict:
    """Install it for me: the machine's password, used once to add Loskai's lines, then a
    test with the keys. Needs a trusted host key (`409`) and the key unlocked (`423`)."""
    try:
        result = await _call(connect.install(machine_id, body.password))
    except HTTPException as exc:
        connect.log("install", machine_id, _peer(request), ok=False, error=exc.detail)
        raise
    connect.log("install", machine_id, _peer(request), ok=True)
    return result


@router.post("/machines/{machine_id}/test")
async def test(machine_id: str) -> dict:
    """Log in with the key, and read what runs with the status key."""
    return await _call(connect.test(machine_id))


@router.get("/machines/{machine_id}/facts")
async def facts(machine_id: str) -> dict:
    """The machine's overview — OS, memory, disks, updates, tools, tmux sessions — read with
    the status key, from a short cache (`connect.FACTS_TTL`)."""
    return await _call(connect.facts(machine_id))


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
    try:
        folder = tool.parse_folder(body.folder) if body.folder and body.folder.strip() else None
    except tool.ToolError as exc:
        raise HTTPException(422, str(exc))
    if folder == tool.PROJECTS:
        folder = None
    if instances_store.set_projects_folder(machine_id, folder) is None:
        raise HTTPException(404, f"No machine '{machine_id}'")
    return {"folder": tool.show_folder(folder)}


@router.get("/log")
def session_log(limit: int = 200) -> list[dict]:
    """The SSH log, newest first: terminals opened, closed and refused, and installs."""
    return client.read_log(max(1, min(limit, client.LOG_KEEP)))


@router.websocket("/machines/{machine_id}/terminal")
async def terminal(
    websocket: WebSocket, machine_id: str, cols: int = 80, rows: int = 24,
    tool: str | None = None, action: str | None = None, target: str | None = None,
    install: bool = False, sudo: Literal["allow", "remove"] | None = None,
):
    """A shell on the machine — or, given `tool` and `action` (and `target` for a row's
    action) or `install` (what the tool lacks), that command, worked out by `connect.plan`
    from the tool file; or `sudo` — putting on or taking off the rule that lets System's
    update run without a password (`connect.plan_sudo`). The request only names it. Like the container
    terminal it sits outside the HTTP middleware, so it checks the session and the `Origin`
    itself (closing `1008`), and closes when the session ends. It also needs the key
    unlocked: closed `4423` while it is locked, `4409` before the host key is trusted or
    when the action can't run here, `4404` no such machine, tool or action, `4502` when
    the machine refuses; the close reason says which in words."""
    cookie = websocket.cookies.get(auth.SESSION_COOKIE)
    if not (auth.same_origin(websocket.headers) and auth.valid_session(cookie)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    peer = _peer(websocket)
    command, details = None, None
    try:
        if tool:
            command, details = await connect.plan(machine_id, tool, action, target, install)
        elif sudo:
            command, details = await connect.plan_sudo(machine_id, sudo == "allow")
        t, conn, process = await connect.open_terminal(
            machine_id, max(1, min(cols, 1000)), max(1, min(rows, 1000)), command
        )
    except connect.SshError as exc:
        asked = {"tool": tool, "action": "install" if install else action} if tool else {"sudo": sudo} if sudo else {}
        connect.log("refused", machine_id, peer, error=exc.detail, **asked)
        # A close reason is at most 123 bytes.
        await websocket.close(code=4000 + exc.status_code, reason=exc.detail.encode()[:120].decode(errors="ignore"))
        return
    started = time.monotonic()
    if details:
        connect.log(details.pop("event"), machine_id, peer, **details)
    else:
        connect.log("open", machine_id, peer, target=f"{t.user}@{t.host}:{t.port}")

    async def to_client():
        while True:
            data = await process.stdout.read(4096)
            if not data:
                break
            await websocket.send_bytes(data)

    async def to_machine():
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:  # keystrokes and pastes -> the shell
                process.stdin.write(msg["bytes"])
            elif msg.get("text") is not None:  # control frames (resize)
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if ctrl.get("type") == "resize":
                    process.change_terminal_size(int(ctrl["cols"]), int(ctrl["rows"]))

    tasks = {
        asyncio.create_task(to_client()),
        asyncio.create_task(to_machine()),
        asyncio.create_task(auth.session_ended(cookie)),
    }
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        # Closing the connection hangs up the pty, so the shell ends with the terminal.
        conn.close()
        connect.log("close", machine_id, peer, seconds=round(time.monotonic() - started))
        if details is not None:
            connect.after_action(machine_id)
        with contextlib.suppress(RuntimeError):  # the browser closed it first
            await websocket.close()


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
