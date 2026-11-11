"""Docker module HTTP + WebSocket surface.

Container control, log streaming (SSE), the interactive exec terminal (WebSocket),
stacks, recipes, and host stats. The exec WebSocket authenticates itself — Starlette's
BaseHTTPMiddleware doesn't cover WS connections, and this is a root shell.
"""

import asyncio
import contextlib
import logging
import socket

from docker.errors import APIError, NotFound
from fastapi import APIRouter, Body, HTTPException, WebSocket
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from ...shared import assign as assign_mod
from ...shared import health as health_registry
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from ...shared import terminal
from ..adguard.client import adguard
from ..caddy.client import caddy
from . import logic
from . import recipes as recipes_mod
from . import stackform as stackform_mod
from . import stacks as stacks_mod
from . import updates as updates_mod
from .client import DOCKER_ERRORS, describe_error, docker_client
from .quick_commands import quick_commands_for

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
    # actually share (logic.upstream_mode).
    rows = _docker_call(docker_client.list_containers, settings_store.caddy_host(), settings_store.value("host_ip"))
    rows = [{**row, "stack": stacks_mod.stack_of(row.get("compose_dir"))} for row in rows]
    base = settings_store.value("base_domain")
    return logic.link_instances(
        rows, instances_store.list_instances(), lambda inst: instances_store.open_url(inst, base)
    )


@router.get("/containers/stats")
def container_stats() -> dict[str, dict]:
    # Apart from the list because it is the slow half (~2s): the Docker tab renders the
    # list at once and fills these in, and the pages that only need the list never wait.
    return _docker_call(docker_client.container_stats)


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
    return await assign_mod.purge_instance(caddy, adguard, inst, base_domain=base)


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


# bash where the image has it, else sh — chosen before `exec`, never by hiding a failed one.
# The old `exec /bin/bash 2>/dev/null || exec /bin/sh` sent bash's stderr to /dev/null, so
# bash wasn't interactive (no prompt, no Tab completion, no error messages), and busybox's sh
# exits when `exec` fails, so the fallback never ran.
SHELL_COMMAND = "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"


@router.websocket("/containers/{container_id}/exec")
async def exec_terminal(websocket: WebSocket, container_id: str):
    """A shell in the container — a root shell, so `terminal.accept` gates it."""
    cookie = await terminal.accept(websocket, "docker")
    if cookie is None:
        return
    try:
        exec_id = await asyncio.to_thread(
            docker_client.exec_create,
            container_id,
            ["/bin/sh", "-c", SHELL_COMMAND],
        )
        sock = await asyncio.to_thread(docker_client.exec_start, exec_id)
    except DOCKER_ERRORS as exc:
        await websocket.send_text(f"exec failed: {describe_error(exc)}")
        await websocket.close()
        return

    raw = sock._sock
    raw.settimeout(None)
    try:
        await terminal.relay(
            websocket, cookie, "docker",
            read=lambda: asyncio.to_thread(raw.recv, 4096),
            write=lambda data: asyncio.to_thread(raw.sendall, data),
            resize=lambda rows, cols: asyncio.to_thread(docker_client.exec_resize, exec_id, rows, cols),
        )
    finally:
        # shutdown, not just close: a recv blocked in its thread holds the socket open past
        # close(), and the thread with it. shutdown wakes it.
        with contextlib.suppress(OSError):  # the peer closed it first
            raw.shutdown(socket.SHUT_RDWR)
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
    return stacks_mod.create_stack(name, compose, payload.get("env", ""))


@router.get("/stacks/{name}")
def get_stack(name: str) -> dict:
    return stacks_mod.get_stack(name)


@router.post("/stacks/{name}/action")
def stack_action(name: str, payload: dict = Body(...)) -> dict:
    action = payload.get("action", "")
    return stacks_mod.stack_action(name, action)


@router.put("/stacks/{name}/file")
def update_stack_file(name: str, payload: dict = Body(...)) -> dict:
    stacks_mod.update_stack_file(name, payload.get("file", ""), payload.get("content", ""))
    return {"ok": True}


@router.get("/stacks/{name}/form")
def get_stack_form(name: str) -> dict:
    """The stack's files as fields: settings (.env), folders (the override), the app."""
    return stackform_mod.get_form(name)


@router.post("/stacks/{name}/form")
def read_stack_form(name: str, payload: dict = Body(...)) -> dict:
    """The form for unsaved `{env, override}` text — the text view switching back."""
    return stackform_mod.get_form(name, payload)


@router.put("/stacks/{name}/form")
def save_stack_form(name: str, payload: dict = Body(...)) -> dict:
    """`settings`: the changed values; `folders`: the whole list; `options`: the switches that
    changed. Any may be left out.
    `base` is the text view's unsaved `{env, override}` to apply them to instead of the files.
    `preview: true` writes nothing and returns `{env, override}` as the save would leave them."""
    settings_in, folders, options = payload.get("settings"), payload.get("folders"), payload.get("options")
    if settings_in is not None and not isinstance(settings_in, dict):
        raise HTTPException(status_code=422, detail="settings must be an object")
    if folders is not None and not isinstance(folders, list):
        raise HTTPException(status_code=422, detail="folders must be a list")
    if options is not None and not isinstance(options, dict):
        raise HTTPException(status_code=422, detail="options must be an object of id: true|false")
    preview = stackform_mod.save_form(
        name, settings_in, folders, bool(payload.get("preview")), payload.get("base"), options
    )
    return preview or {"ok": True}


@router.post("/stacks/{name}/update-from-recipe")
def update_from_recipe(name: str) -> dict:
    """Replace the stack's compose.yml with its recipe's; the override is never touched."""
    return updates_mod.apply_update(name)


@router.delete("/stacks/{name}")
def delete_stack(name: str, delete_data: bool = False) -> dict:
    """Keeps the folder's data unless `?delete_data=true`."""
    return stacks_mod.delete_stack(name, delete_data)


# --- Recipes ---


@router.get("/recipes")
def recipes() -> dict:
    return recipes_mod.list_recipes()


@router.post("/recipes/refresh")
def refresh_recipes(payload: dict = Body(default={})) -> dict:
    """Sync every enabled recipe source, or just the one named by `url`."""
    return recipes_mod.sync_recipes(payload.get("url"))


@router.get("/recipes/updates")
def recipe_updates() -> list[dict]:
    """Installed recipes and whether each can be updated. Reads the caches as synced."""
    return updates_mod.list_updates()


@router.get("/recipes/{recipe_id}/icon")
def recipe_icon(recipe_id: str) -> FileResponse:
    """The recipe's icon.png, for the wizard's thumbnail. Checked as an image when the
    recipe was loaded, so this only serves it."""
    return FileResponse(recipes_mod.icon_path(recipe_id), media_type="image/png")


@router.post("/recipes/{recipe_id}/install")
def install_recipe(recipe_id: str, payload: dict = Body(default={})) -> dict:
    return recipes_mod.install_recipe(
        recipe_id, payload.get("answers", {}), payload.get("mounts") or [], payload.get("options") or []
    )


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
