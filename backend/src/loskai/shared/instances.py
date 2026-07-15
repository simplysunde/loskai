"""The instance list — Loskai's one persistent domain object.

A Docker container and an external LAN service are the same struct with a different
`type`. A *route* is not stored separately: it is simply an instance that has a
`subdomain`. Runtime container state (status/CPU/RAM) is never stored here — it is
read live from the Docker socket and joined at display time via `container`.
"""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings
from . import store


class Instance(BaseModel):
    id: str  # stable slug — also the Caddy @id
    name: str  # display name
    type: Literal["docker", "external"]
    subdomain: str | None = None  # null = tracked, no route assigned
    upstream: str | None = None  # host:port — chosen at assign time
    upstream_tls: bool = False  # dial the upstream over HTTPS, cert unverified (e.g. Proxmox)
    container: str | None = None  # container name/id (docker type only)
    dns_answer: str | None = None  # Caddy IP last written to AdGuard for this name
    private: bool = False  # hide from the public dashboard (still fully managed)


def _path() -> Path:
    return Path(settings.data_dir) / "instances.json"


def list_instances() -> list[Instance]:
    return [Instance(**item) for item in store.read_json(_path(), [])]


def _save(instances: list[Instance]) -> None:
    store.write_json(_path(), [i.model_dump() for i in instances])


def get_instance(instance_id: str) -> Instance | None:
    return next((i for i in list_instances() if i.id == instance_id), None)


def upsert_instance(instance: Instance) -> Instance:
    """Insert or replace by `id` — the one write path (create and edit converge here)."""
    instances = list_instances()
    for idx, existing in enumerate(instances):
        if existing.id == instance.id:
            instances[idx] = instance
            break
    else:
        instances.append(instance)
    _save(instances)
    return instance


def delete_instance(instance_id: str) -> bool:
    instances = list_instances()
    remaining = [i for i in instances if i.id != instance_id]
    if len(remaining) == len(instances):
        return False
    _save(remaining)
    return True


def list_routed() -> list[Instance]:
    """The route table = exactly the instances that have a subdomain."""
    return [i for i in list_instances() if i.subdomain]


router = APIRouter(prefix="/api", tags=["instances"])


@router.get("/instances")
def get_instances() -> list[Instance]:
    return list_instances()


class InstancePatch(BaseModel):
    private: bool | None = None
    name: str | None = None


@router.patch("/instances/{instance_id}")
def patch_instance(instance_id: str, body: InstancePatch) -> Instance:
    """Update mutable display fields (private flag, display name). Subdomain/upstream
    are changed through the assign flow, never here."""
    inst = get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail=f"instance '{instance_id}' not found")
    updates: dict = {}
    if body.private is not None:
        updates["private"] = body.private
    if body.name is not None:
        updates["name"] = body.name
    return upsert_instance(inst.model_copy(update=updates))
