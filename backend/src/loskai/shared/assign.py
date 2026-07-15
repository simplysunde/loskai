"""The Assign URL action — the one place modules coordinate.

Assigning or clearing a subdomain spans the instance store, Caddy, and AdGuard. The
Caddy and AdGuard modules themselves are read + push only; this is the only cross-module
writer.

Order (see PLAN, "The Assign URL Action"):
  Step 0 — persist intent on the instance (durable record).
  Step 1 — Caddy route (REQUIRED). On failure: roll back and abort.
  Step 2 — AdGuard rewrite (BEST EFFORT). On failure: warn, never fail the assign.

`assign` / `unassign` take the two clients as arguments so they can be driven with fakes
in tests; the router passes the process singletons.
"""

import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..modules.adguard.client import AdGuardError, adguard
from ..modules.caddy import service as caddy_service
from ..modules.caddy.client import CaddyError, caddy, describe_error
from . import instances as instances_store
from . import settings as settings_store
from .instances import Instance

# A single DNS label: lowercase letters, digits, hyphens; not leading/trailing hyphen.
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


class AssignError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def validate_prefix(prefix: str) -> None:
    if not prefix or len(prefix) > 63 or not _LABEL.match(prefix):
        raise AssignError(
            422,
            "Subdomain must be a single DNS label (lowercase letters, digits, hyphens)",
        )


def validate_upstream(upstream: str) -> None:
    """The upstream goes verbatim into Caddy's `dial`, which wants a bare host:port — a
    scheme or path produces a malformed, non-connecting route. Reject those early."""
    if not upstream:
        raise AssignError(422, "upstream is required")
    if "://" in upstream or "/" in upstream or any(c.isspace() for c in upstream):
        raise AssignError(
            422,
            "upstream must be host:port — no scheme or path (e.g. 192.168.10.100:3000 or grafana:3000)",
        )
    host, sep, port = upstream.rpartition(":")
    if not sep or not host:
        raise AssignError(422, "upstream must include a port, e.g. grafana:3000")
    if not port.isdigit() or not (1 <= int(port) <= 65535):
        raise AssignError(422, f"invalid port in upstream: {port!r}")


def subdomain_taken(prefix: str, exclude_id: str) -> bool:
    return any(
        i.subdomain == prefix and i.id != exclude_id
        for i in instances_store.list_instances()
    )


async def assign(
    caddy_client,
    adguard_client,
    *,
    prefix: str,
    upstream: str,
    base_domain: str | None,
    current_ip: str | None,
    instance_id: str | None = None,
    name: str | None = None,
    container: str | None = None,
) -> dict:
    validate_prefix(prefix)
    if not base_domain:
        raise AssignError(400, "base_domain is not set — configure it in Settings")
    upstream = upstream.strip()
    validate_upstream(upstream)

    existing = instances_store.get_instance(instance_id) if instance_id else None
    if instance_id and existing is None:
        raise AssignError(404, f"instance '{instance_id}' not found")

    target_id = existing.id if existing else prefix
    if subdomain_taken(prefix, exclude_id=target_id):
        raise AssignError(409, f"subdomain '{prefix}' is already assigned")

    created_new = existing is None
    if existing:
        prev: Instance | None = existing.model_copy(deep=True)
        inst = existing.model_copy(update={"subdomain": prefix, "upstream": upstream})
    else:
        if instances_store.get_instance(prefix) is not None:
            raise AssignError(409, f"instance id '{prefix}' already exists")
        prev = None
        # A container gets a `docker` instance linked by name; a bare LAN target is `external`.
        inst = Instance(
            id=prefix, name=name or prefix,
            type="docker" if container else "external",
            container=container, subdomain=prefix, upstream=upstream,
        )

    old_domain = (
        caddy_service.assemble_fqdn(prev.subdomain, base_domain)
        if prev and prev.subdomain
        else None
    )
    old_answer = prev.dns_answer if prev else None
    domain = caddy_service.assemble_fqdn(prefix, base_domain)

    # Step 0 — persist intent.
    instances_store.upsert_instance(inst)

    # Step 1 — Caddy route (required). Roll back on failure.
    try:
        await caddy_service.upsert_route(caddy_client, inst, base_domain)
    except (httpx.HTTPError, CaddyError, ValueError) as exc:
        if created_new:
            instances_store.delete_instance(inst.id)
        else:
            instances_store.upsert_instance(prev)  # type: ignore[arg-type]
        raise AssignError(502, f"Caddy route failed: {describe_error(exc)}")

    # Step 2 — AdGuard rewrite (best effort).
    adguard_status = "skipped"
    warning: str | None = None
    if not current_ip:
        warning = "No Caddy answer IP (set CADDY_HOST_IP in Docker mode) — DNS rewrite skipped."
    elif adguard_client.base_url() is None:
        warning = "AdGuard is not configured — DNS rewrite skipped."
    else:
        try:
            # On a rename the old-domain rewrite is orphaned (keyed by domain, not @id).
            if old_domain and old_domain != domain and old_answer:
                try:
                    await adguard_client.delete_rewrite(old_domain, old_answer)
                except (httpx.HTTPError, AdGuardError):
                    pass
            await adguard_client.add_rewrite(domain, current_ip)
            inst = inst.model_copy(update={"dns_answer": current_ip})
            instances_store.upsert_instance(inst)
            adguard_status = "ok"
        except (httpx.HTTPError, AdGuardError) as exc:
            adguard_status = "error"
            warning = (
                f"Route created, but the DNS rewrite failed — {describe_error(exc)}. "
                "The name won't resolve on the LAN until it's added; retry when AdGuard is reachable."
            )

    return {
        "caddy": "ok",
        "adguard": adguard_status,
        "url": f"https://{domain}",
        "instance_id": inst.id,
        "warning": warning,
    }


async def unassign(
    caddy_client, adguard_client, instance_id: str, *, base_domain: str | None
) -> dict:
    inst = instances_store.get_instance(instance_id)
    if inst is None:
        raise AssignError(404, f"instance '{instance_id}' not found")
    if not inst.subdomain:
        return {"caddy": "ok", "adguard": "skipped", "cleared": False}

    prev = inst.model_copy(deep=True)
    old_domain = (
        caddy_service.assemble_fqdn(inst.subdomain, base_domain) if base_domain else None
    )
    old_answer = inst.dns_answer

    # Clear intent + save.
    instances_store.upsert_instance(
        inst.model_copy(update={"subdomain": None, "dns_answer": None})
    )

    # Step 1 — Caddy delete (required). Roll back on failure.
    try:
        await caddy_client.delete_route(inst.id)  # ignores 404
    except (httpx.HTTPError, CaddyError) as exc:
        instances_store.upsert_instance(prev)
        raise AssignError(502, f"Caddy route delete failed: {describe_error(exc)}")

    # Step 2 — AdGuard delete (best effort, exact pair).
    adguard_status = "skipped"
    if old_domain and old_answer and adguard_client.base_url() is not None:
        try:
            await adguard_client.delete_rewrite(old_domain, old_answer)
            adguard_status = "ok"
        except (httpx.HTTPError, AdGuardError):
            adguard_status = "error"

    return {"caddy": "ok", "adguard": adguard_status, "cleared": True, "instance_id": inst.id}


# --- Router ---

router = APIRouter(prefix="/api", tags=["assign"])


class AssignBody(BaseModel):
    prefix: str
    upstream: str
    instance_id: str | None = None
    name: str | None = None
    container: str | None = None


@router.post("/assign")
async def post_assign(body: AssignBody) -> dict:
    base = settings_store.value("base_domain")
    current_ip = settings_store.derive_caddy_host_ip()
    try:
        return await assign(
            caddy, adguard,
            prefix=body.prefix, upstream=body.upstream,
            instance_id=body.instance_id, name=body.name, container=body.container,
            base_domain=base, current_ip=current_ip,
        )
    except AssignError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.delete("/assign/{instance_id}")
async def delete_assign(instance_id: str) -> dict:
    base = settings_store.value("base_domain")
    try:
        return await unassign(caddy, adguard, instance_id, base_domain=base)
    except AssignError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
