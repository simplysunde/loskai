"""Docker module HTTP + WebSocket surface.

Container control, log streaming (SSE), the interactive exec terminal (WebSocket),
stacks, recipes, and host stats. The exec WebSocket authenticates itself — Starlette's
BaseHTTPMiddleware doesn't cover WS connections, and this is a root shell.
"""

import asyncio
import json
import logging
from urllib.parse import urlparse

from docker.errors import APIError, NotFound
from fastapi import APIRouter, Body, HTTPException, WebSocket
from sse_starlette.sse import EventSourceResponse

from ...shared import assign as assign_mod
from ...shared import auth
from ...shared import health as health_registry
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from ..adguard.client import adguard
from ..caddy.client import caddy
from . import logic
from . import recipes as recipes_mod
from . import stacks as stacks_mod
from .client import DOCKER_ERRORS, describe_error, docker_client
from .quick_commands import quick_commands_for
from .recipes import RecipeError
from .stacks import StackError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/docker", tags=["docker"])


async def _health_payload() -> dict:
    # docker_client.health() is a blocking ping — keep it off the event loop.
    return await asyncio.to_thread(docker_client.health)


health_registry.register("docker", _health_payload)


def _docker_call(fn, *args):
    """Run a docker-py call, mapping NotFound -> 404 and a down daemon -> 502."""
    try:
        return fn(*args)
    except NotFound:
        raise HTTPException(status_code=404, detail="container not found")
    except DOCKER_ERRORS as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))


# --- Containers ---


@router.get("/containers")
def containers() -> list[dict]:
    # The pre-filled upstream is decided per container, from the networks it and Caddy
    # actually share (logic.upstream_mode). CADDY_ADMIN_URL's hostname is how Caddy's
    # container is found; an IP host matches nothing, which is correct — Caddy is off-box.
    caddy_host = urlparse(settings_store.value("caddy_admin_url") or "").hostname
    host_ip = settings_store.value("host_ip")
    return _docker_call(docker_client.list_containers, True, caddy_host, host_ip)


@router.post("/containers/{container_id}/start")
def start(container_id: str) -> dict:
    _docker_call(docker_client.start, container_id)
    return {"ok": True}


@router.post("/containers/{container_id}/stop")
def stop(container_id: str) -> dict:
    _docker_call(docker_client.stop, container_id)
    return {"ok": True}


@router.post("/containers/{container_id}/restart")
def restart(container_id: str) -> dict:
    _docker_call(docker_client.restart, container_id)
    return {"ok": True}


@router.delete("/containers/{container_id}")
def remove(container_id: str) -> dict:
    _docker_call(docker_client.remove, container_id)
    return {"ok": True}


# --- Orphaned routes (a docker instance whose container was removed) ---


@router.get("/orphans")
def orphans() -> list[dict]:
    """Docker instances whose linked container no longer exists. `[]` if the daemon is
    down — an unreachable socket must not make live instances look orphaned."""
    try:
        live = docker_client.container_names()
    except DOCKER_ERRORS:
        return []
    return [
        {"id": i.id, "name": i.name, "container": i.container, "subdomain": i.subdomain}
        for i in logic.orphaned_instances(instances_store.list_instances(), live)
    ]


@router.delete("/orphans/{instance_id}")
async def delete_orphan(instance_id: str) -> dict:
    """Clean up an orphaned docker instance: verify its container is really gone, then
    tear down its route + rewrite and drop the record."""
    inst = instances_store.get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    if inst.type != "docker" or not inst.container:
        raise HTTPException(status_code=409, detail="not a container-backed instance")
    live = _docker_call(docker_client.container_names)
    if inst.container in live:
        raise HTTPException(
            status_code=409, detail="container still exists — remove its route instead"
        )
    base = settings_store.value("base_domain")
    try:
        return await assign_mod.purge_instance(caddy, adguard, inst, base_domain=base)
    except assign_mod.AssignError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/containers/{container_id}/quick-commands")
def quick_commands(container_id: str) -> list[dict]:
    image = _docker_call(docker_client.image_of, container_id)
    return quick_commands_for(image)


@router.get("/containers/{container_id}/logs")
async def logs(container_id: str, tail: int = 200):
    """SSE stream of container logs. The blocking docker-py generator is pumped from a
    thread into an async queue."""
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def produce():
        try:
            for line in docker_client.stream_logs(container_id, tail=tail):
                loop.call_soon_threadsafe(queue.put_nowait, line)
        except Exception as exc:  # surface the failure as a final event
            loop.call_soon_threadsafe(queue.put_nowait, f"[log stream ended: {describe_error(exc)}]")
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    async def events():
        loop.run_in_executor(None, produce)  # pump the blocking generator in a thread
        while True:
            line = await queue.get()
            if line is None:
                break
            yield {"data": line.rstrip("\n")}

    return EventSourceResponse(events())


@router.websocket("/containers/{container_id}/exec")
async def exec_terminal(websocket: WebSocket, container_id: str):
    # WS bypasses the HTTP auth middleware — gate it here (this is a root shell).
    if not auth.valid_session(websocket.cookies.get(auth.SESSION_COOKIE)):
        await websocket.close(code=1008)  # policy violation
        return
    await websocket.accept()

    try:
        exec_id = await asyncio.to_thread(
            docker_client.exec_create,
            container_id,
            ["/bin/sh", "-c", "exec /bin/bash 2>/dev/null || exec /bin/sh"],
        )
        sock = await asyncio.to_thread(docker_client.exec_start, exec_id)
    except DOCKER_ERRORS as exc:
        await websocket.send_text(f"exec failed: {describe_error(exc)}")
        await websocket.close()
        return

    raw = sock._sock
    raw.settimeout(None)

    async def to_client():
        while True:
            data = await asyncio.to_thread(raw.recv, 4096)
            if not data:
                break
            await websocket.send_bytes(data)

    async def to_container():
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:  # keystrokes -> stdin
                await asyncio.to_thread(raw.sendall, msg["bytes"])
            elif msg.get("text") is not None:  # control frames (resize)
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if ctrl.get("type") == "resize":
                    await asyncio.to_thread(
                        docker_client.exec_resize, exec_id, ctrl["rows"], ctrl["cols"]
                    )

    out = asyncio.create_task(to_client())
    inp = asyncio.create_task(to_container())
    try:
        await asyncio.wait({out, inp}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        out.cancel()
        inp.cancel()
        try:
            raw.close()
        except OSError as exc:
            # The peer usually closed first — teardown detail, not an operator problem.
            logger.debug("exec socket close failed: %s", exc)
        await websocket.close()


# --- Stacks ---


@router.get("/stacks")
def list_stacks() -> list[dict]:
    return stacks_mod.list_stacks()


@router.post("/stacks")
def create_stack(payload: dict = Body(...)) -> dict:
    name = payload.get("name")
    compose = payload.get("compose")
    if not name or not compose:
        raise HTTPException(status_code=422, detail="name and compose are required")
    try:
        return stacks_mod.create_stack(name, compose, payload.get("env", ""))
    except StackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/stacks/{name}")
def get_stack(name: str) -> dict:
    try:
        return stacks_mod.get_stack(name)
    except StackError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/stacks/{name}/action")
def stack_action(name: str, payload: dict = Body(...)) -> dict:
    action = payload.get("action", "")
    try:
        return stacks_mod.stack_action(name, action)
    except StackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/stacks/{name}/file")
def update_stack_file(name: str, payload: dict = Body(...)) -> dict:
    try:
        stacks_mod.update_stack_file(name, payload.get("file", ""), payload.get("content", ""))
    except StackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True}


@router.delete("/stacks/{name}")
def delete_stack(name: str, delete_data: bool = False) -> dict:
    """Keeps the folder's data unless `?delete_data=true`."""
    try:
        return stacks_mod.delete_stack(name, delete_data)
    except StackError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# --- Recipes ---


@router.get("/recipes")
def recipes() -> dict:
    return recipes_mod.list_recipes()


@router.post("/recipes/refresh")
def refresh_recipes(payload: dict = Body(default={})) -> dict:
    """Sync every enabled recipe source, or just the one named by `url`."""
    try:
        return recipes_mod.sync_recipes(payload.get("url"))
    except RecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/recipes/{recipe_id}/install")
def install_recipe(recipe_id: str, payload: dict = Body(default={})) -> dict:
    try:
        return recipes_mod.install_recipe(
            recipe_id, payload.get("answers", {}), payload.get("mounts") or []
        )
    except RecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- Volumes ---


@router.get("/volumes")
def volumes() -> list[dict]:
    return _docker_call(docker_client.list_volumes)


@router.delete("/volumes/{name}")
def remove_volume(name: str) -> dict:
    """Delete a named volume, and its data with it. Only one nothing mounts: Docker answers
    409 for one in use, and that is passed on rather than forced — the list the request
    came from can be stale, and a container created since then must keep its data."""
    try:
        docker_client.remove_volume(name)
    except NotFound:
        raise HTTPException(status_code=404, detail="volume not found")
    except APIError as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail="volume is in use by a container")
        raise HTTPException(status_code=502, detail=describe_error(exc))
    except DOCKER_ERRORS as exc:
        raise HTTPException(status_code=502, detail=describe_error(exc))
    return {"ok": True}


# --- Host stats ---


@router.get("/stats")
def stats() -> dict:
    return _docker_call(docker_client.host_stats)
