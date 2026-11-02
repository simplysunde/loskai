"""The instance list — Loskai's one persistent domain object.

A Docker container and an external LAN service are the same struct with a different
`type`. A *route* is not stored separately: it is simply an instance that has a
`subdomain`. Runtime container state (status/CPU/RAM) is never stored here — it is
read live from the Docker socket and joined at display time via `container`.
"""

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError, model_validator

from ..config import settings
from . import access, auth, icons, store

logger = logging.getLogger(__name__)


class Instance(BaseModel):
    id: str  # stable slug — also the Caddy @id
    name: str  # display name
    type: Literal["docker", "external"]
    kind: Literal["service", "machine"] = "service"  # what it *is*: a published service, or
    # an address other routes point at. Set from `route_mode` on assign; back-filled below
    # for records written before the field existed.
    subdomain: str | None = None  # null = tracked, no route assigned
    route_mode: Literal["proxy", "dns_only"] = "proxy"  # proxy = Caddy+AdGuard (default);
    # dns_only = AdGuard rewrite straight to `upstream`, no Caddy route, no TLS
    upstream: str | None = None  # host:port (proxy) or a bare IP (dns_only) — chosen at assign time
    upstream_tls: bool = False  # dial the upstream over HTTPS, cert unverified (e.g. Proxmox)
    scheme: Literal["https", "both", "http"] = "https"  # which port(s) Caddy serves this on.
    # Exists for clients that cannot hold a custom root CA — dumb devices, other containers
    # calling by name, scripts. Not a performance setting. Ignored when route_mode=dns_only.
    container: str | None = None  # container name/id (docker type only)
    origin: str | None = None  # built-in network service this routes ("adguard"/"gateway"/"caddy")
    # The upstream is derived from the live container (logic.suggested_upstream) and
    # rewritten when it starts on a different port — see shared/follow.py. Declared, never
    # inferred: False keeps a stored upstream exactly as set.
    follow_container: bool = False
    dns_answer: str | None = None  # Caddy IP last written to AdGuard for this name
    private: bool = False  # hide from the public dashboard (still fully managed)
    icon: str | None = None  # launcher icon filename in <data_dir>/icons (see shared/icons.py)
    # A machine's projects folder, relative to its SSH user's home ("" for home itself);
    # None for the default (modules/ssh/tool.py, `PROJECTS`).
    projects_folder: str | None = None


    @model_validator(mode="before")
    @classmethod
    def _derive_kind(cls, data: Any) -> Any:
        """Back-fill `kind` for records written before it existed, from the shape the code
        used to infer it from: an upstream with no port is an address, not a service. Runs
        only when the field is absent, so a stored `kind` always wins — this is a migration
        that needs no migration step, and the next write persists the answer."""
        if isinstance(data, dict) and not data.get("kind"):
            upstream = data.get("upstream") or ""
            data = {**data, "kind": "machine" if upstream and ":" not in upstream else "service"}
        return data


def _path() -> Path:
    return Path(settings.data_dir) / "instances.json"


def _records(raw: Any) -> list[Instance]:
    """Parse the stored array. Records that don't parse are logged and skipped.

    Unlike settings.json (which fails startup — see `settings.verify_readable`), this
    file carries display state only, so one hand-edited row must not take the app down.
    A *file*-level parse error still raises `store.CorruptStoreError`: an unreadable
    file is not an empty one, and returning [] would let the next write erase it.
    """
    if not isinstance(raw, list):
        raise store.CorruptStoreError(f"{_path()} must contain a JSON array")
    records: list[Instance] = []
    for item in raw:
        try:
            records.append(Instance(**item))
        except (ValidationError, TypeError) as exc:
            logger.warning(
                "skipping unreadable record in %s: %s (record: %r)", _path(), exc, item
            )
    return records


def list_instances() -> list[Instance]:
    return _records(store.read_json(_path(), []))


def _update(mutate: Callable[[list[Instance]], list[Instance]]) -> None:
    """The one write path for instances.json — read-modify-write under the store lock.
    Without it, an assign or reconcile on the event loop and a PATCH in the threadpool
    can each write back a list missing the other's record."""
    store.update_json(
        _path(), [], lambda raw: [i.model_dump() for i in mutate(_records(raw))]
    )


def get_instance(instance_id: str) -> Instance | None:
    return next((i for i in list_instances() if i.id == instance_id), None)


def get_by_container(container: str) -> Instance | None:
    """The instance linked to a container (one per container) — used to keep a container
    assign idempotent so it never creates a duplicate docker instance."""
    return next((i for i in list_instances() if i.container == container), None)


def get_by_origin(origin: str) -> Instance | None:
    """The instance routing a built-in network service (AdGuard/Gateway/Caddy) — the
    external-service analogue of `get_by_container`, so its assign stays idempotent."""
    return next((i for i in list_instances() if i.origin == origin), None)


def on_address(host: str) -> list[Instance]:
    """Every service whose upstream host is `host` — the routes on the machine at that
    address. Worked out from the upstream, never stored: a machine's only identity on the
    network is its address, so there is no link to keep in step with it."""
    return [
        i for i in list_instances()
        if not is_machine(i) and i.upstream and i.upstream.rpartition(":")[0] == host
    ]


def is_machine(instance: Instance) -> bool:
    """True if this instance is an *address* rather than a service — the thing routes sit
    on. Declared on the record now, not inferred from the upstream's shape."""
    return instance.kind == "machine"


def upsert_instance(instance: Instance) -> Instance:
    """Insert or replace by `id` — the one write path (create and edit converge here)."""

    def replace(instances: list[Instance]) -> list[Instance]:
        for idx, existing in enumerate(instances):
            if existing.id == instance.id:
                instances[idx] = instance
                return instances
        return [*instances, instance]

    _update(replace)
    return instance


def follow_upstream(instance_id: str, expected: str | None, upstream: str) -> Instance | None:
    """Re-point a following route's upstream — compare-and-set under the store lock.

    Writes only while the record is still a following proxied route *and* still holds
    `expected`. The follower reads, asks Docker (slow), then writes; an edit made in
    between — someone setting the address by hand, or unassigning the route — must win
    over a value derived from the state before it. Unassigning leaves `upstream` and
    `follow_container` as they were, so the route itself has to be checked too.
    Returns the updated record, or None when it no longer qualified."""
    updated: list[Instance] = []

    def repoint(instances: list[Instance]) -> list[Instance]:
        for idx, inst in enumerate(instances):
            if (
                inst.id == instance_id
                and inst.follow_container
                and inst.subdomain
                and inst.route_mode == "proxy"
                and inst.upstream == expected
            ):
                instances[idx] = inst.model_copy(update={"upstream": upstream})
                updated.append(instances[idx])
        return instances

    _update(repoint)
    return updated[0] if updated else None


def give_icon(instance_id: str, icon: str) -> Instance | None:
    """Set the icon of a record that has none, and nothing else — under the store lock, so a
    change made while the icon was looked up (the follower re-pointing it) is kept."""
    updated: list[Instance] = []

    def set_icon(instances: list[Instance]) -> list[Instance]:
        for idx, inst in enumerate(instances):
            if inst.id == instance_id and not inst.icon:
                instances[idx] = inst.model_copy(update={"icon": icon})
                updated.append(instances[idx])
        return instances

    _update(set_icon)
    return updated[0] if updated else None


def set_projects_folder(instance_id: str, folder: str | None) -> Instance | None:
    """Set a machine's projects folder, and nothing else — under the store lock."""
    updated: list[Instance] = []

    def apply(instances: list[Instance]) -> list[Instance]:
        for idx, inst in enumerate(instances):
            if inst.id == instance_id and is_machine(inst):
                instances[idx] = inst.model_copy(update={"projects_folder": folder})
                updated.append(instances[idx])
        return instances

    _update(apply)
    return updated[0] if updated else None


def delete_instance(instance_id: str) -> bool:
    deleted = False

    def remove(instances: list[Instance]) -> list[Instance]:
        nonlocal deleted
        remaining = [i for i in instances if i.id != instance_id]
        deleted = len(remaining) != len(instances)
        return remaining

    _update(remove)
    return deleted


def list_routed() -> list[Instance]:
    """The route table = exactly the instances that have a subdomain — mode-agnostic (both
    `proxy` and `dns_only` instances are "routed"; callers that only care about Caddy routes
    filter to `route_mode == "proxy"` themselves)."""
    return [i for i in list_instances() if i.subdomain]


router = APIRouter(prefix="/api", tags=["instances"])


class InstancePatch(BaseModel):
    private: bool | None = None
    name: str | None = None


@router.get("/instances/{instance_id}/icon")
def get_icon(instance_id: str):
    """The launcher icon. **Public** — the Dashboard is unauthenticated, so a card has to
    render its icon before anyone logs in (see `auth.PUBLIC_PATTERNS`). Serves only what a
    prior upload sniffed as PNG/JPEG/WebP, under that sniffed content type."""
    inst = get_instance(instance_id)
    if inst is None or not inst.icon:
        raise HTTPException(status_code=404, detail="no icon for this instance")
    try:
        path = icons.path_for(inst.icon)
    except icons.IconError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if not path.is_file():
        raise HTTPException(status_code=404, detail="icon file is missing")
    return FileResponse(path, media_type=icons.content_type(inst.icon))


@router.post("/instances/{instance_id}/icon")
async def put_icon(instance_id: str, request: Request) -> Instance:
    """Replace this instance's launcher icon. Admin-only (the middleware gates it).

    The image is the raw request body, not a multipart form: the bytes are sniffed either
    way (see `icons.sniff`), so a form part would add a dependency — `python-multipart` —
    to carry a filename and content type that are both ignored.

    Read with a cap rather than `await request.body()`, so an oversized upload is refused
    after one chunk instead of being buffered in full first."""
    inst = get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail=f"instance '{instance_id}' not found")

    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > icons.MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"image is larger than {icons.MAX_BYTES // 1024} KB",
            )
    try:
        filename = icons.save(instance_id, bytes(data))
    except icons.IconError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return upsert_instance(inst.model_copy(update={"icon": filename}))


@router.delete("/instances/{instance_id}/icon")
def delete_icon(instance_id: str) -> Instance:
    """Drop the icon; the card falls back to its generic glyph."""
    inst = get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail=f"instance '{instance_id}' not found")
    icons.remove_all(instance_id)
    return upsert_instance(inst.model_copy(update={"icon": None}))


@router.patch("/instances/{instance_id}")
def patch_instance(instance_id: str, body: InstancePatch) -> Instance:
    """Update mutable display fields (private flag, display name). Subdomain/upstream
    are changed through the assign flow, never here."""
    inst = get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail=f"instance '{instance_id}' not found")
    access.require_instance(auth.current_user(), inst.kind)
    updates: dict = {}
    if body.private is not None:
        updates["private"] = body.private
    if body.name is not None:
        updates["name"] = body.name
    return upsert_instance(inst.model_copy(update=updates))
