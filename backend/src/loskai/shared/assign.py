"""The Assign URL action — the one place modules coordinate.

Assigning or clearing a subdomain spans the instance store, Caddy, and AdGuard. The
Caddy and AdGuard modules themselves are read + push only; this is the only cross-module
writer.

Order (see PLAN, "The Assign URL Action"):
  Step 0 — persist intent on the instance (durable record).
  Step 1 — Caddy route (REQUIRED for `route_mode: "proxy"`). On failure: roll back and abort.
           For `route_mode: "dns_only"` this instead tears down any stale Caddy route
           (idempotent) — no route is ever pushed for a dns_only instance.
  Step 2 — AdGuard rewrite (BEST EFFORT). Answer is the shared Caddy LAN IP for `proxy`,
           or the instance's own `upstream` IP for `dns_only` (see `adguard.service.target_answer`).
           On failure: warn, never fail the assign.

`assign` / `unassign` take the two clients as arguments so they can be driven with fakes
in tests; the router passes the process singletons.
"""

import logging
import re
from ipaddress import ip_address
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..modules.adguard.client import AdGuardError, adguard
from ..modules.adguard.service import target_answer
from ..modules.caddy import service as caddy_service
from ..modules.caddy.client import CaddyError, caddy, describe_error
from . import instances as instances_store
from . import settings as settings_store
from .instances import Instance

logger = logging.getLogger(__name__)

# A single DNS label: lowercase letters, digits, hyphens; not leading/trailing hyphen.
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


class AssignError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def validate_prefix(prefix: str, route_mode: Literal["proxy", "dns_only"] = "proxy") -> None:
    """`proxy` stays a single DNS label (keeps every name under the one `*.BASE_DOMAIN`
    wildcard cert). `dns_only` has no cert involved, so dot-separated multi-label names
    are allowed — each label still has to be a valid DNS label on its own."""
    if not prefix:
        raise AssignError(422, "prefix is required")
    if route_mode == "dns_only":
        labels = prefix.split(".")
        if len(prefix) > 253 or not all(_LABEL.match(label) for label in labels):
            raise AssignError(
                422,
                "Each dot-separated label must be lowercase letters, digits, hyphens",
            )
        return
    if len(prefix) > 63 or not _LABEL.match(prefix):
        raise AssignError(
            422,
            "Subdomain must be a single DNS label (lowercase letters, digits, hyphens)",
        )


def validate_upstream(upstream: str, route_mode: Literal["proxy", "dns_only"] = "proxy") -> None:
    """`proxy`: the upstream goes verbatim into Caddy's `dial`, which wants a bare
    host:port — a scheme or path produces a malformed, non-connecting route. `dns_only`:
    the upstream IS the AdGuard answer, so it must be a bare IPv4 address — no port, no
    scheme (IPv6 is out of scope for now, same as `settings.py`'s `caddy_host_ip`/`host_ip`)."""
    if not upstream:
        raise AssignError(422, "upstream is required")
    if route_mode == "dns_only":
        if ":" in upstream:
            raise AssignError(422, "DNS-only target must be a bare IPv4 address — no port")
        try:
            ip_address(upstream)
        except ValueError:
            raise AssignError(422, f"DNS-only target must be a valid IP address: {upstream!r}")
        return
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


def relink_upstream(upstream: str, new_host: str) -> str:
    """Swap the host half of a `host:port` upstream, keeping the port. Pure — this is the
    whole of what "the machine's address changed" means for a linked route."""
    _, _, port = upstream.rpartition(":")
    return f"{new_host}:{port}"


def validate_machine(machine_id: str, target_id: str) -> Instance:
    """The machine a route is being linked to must exist, be an address rather than a
    service, and not be the route itself. Raises `AssignError` — a bad link is a client
    error, not something to store and discover later."""
    if machine_id == target_id:
        raise AssignError(422, "an instance cannot be its own machine")
    machine = instances_store.get_instance(machine_id)
    if machine is None:
        raise AssignError(404, f"machine '{machine_id}' not found")
    if not instances_store.is_machine(machine):
        raise AssignError(
            422, f"'{machine_id}' is a service, not a machine — its upstream has a port"
        )
    return machine


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
    origin: str | None = None,
    machine: str | None = None,
    upstream_tls: bool = False,
    route_mode: Literal["proxy", "dns_only"] = "proxy",
) -> dict:
    validate_prefix(prefix, route_mode)
    if not base_domain:
        raise AssignError(400, "base_domain is not set — configure it in Settings")
    upstream = upstream.strip()
    validate_upstream(upstream, route_mode)

    existing = instances_store.get_instance(instance_id) if instance_id else None
    if instance_id and existing is None:
        raise AssignError(404, f"instance '{instance_id}' not found")

    # No duplicates: assigning a container (or a built-in network service) targets its
    # existing instance — change its URL — rather than creating a second one. Keyed by the
    # container name or the `origin` service marker, whichever the assign carries.
    if existing is None and container:
        existing = instances_store.get_by_container(container)
    if existing is None and origin:
        existing = instances_store.get_by_origin(origin)

    target_id = existing.id if existing else prefix
    if subdomain_taken(prefix, exclude_id=target_id):
        raise AssignError(409, f"subdomain '{prefix}' is already assigned")

    if machine:
        validate_machine(machine, target_id)

    created_new = existing is None
    if existing:
        prev: Instance | None = existing.model_copy(deep=True)
        inst = existing.model_copy(
            update={
                "subdomain": prefix, "upstream": upstream, "upstream_tls": upstream_tls,
                "route_mode": route_mode, "machine": machine,
                # Re-pointing a machine at a port turns it into a service, and vice versa.
                "kind": "machine" if route_mode == "dns_only" else "service",
            }
        )
    else:
        if instances_store.get_instance(prefix) is not None:
            raise AssignError(409, f"instance id '{prefix}' already exists")
        prev = None
        # A container gets a `docker` instance linked by name; everything else is `external`
        # (a built-in network service carries its `origin` marker, a bare LAN target none).
        inst = Instance(
            id=prefix, name=name or prefix,
            type="docker" if container else "external",
            container=container, origin=origin, machine=machine,
            subdomain=prefix, upstream=upstream,
            upstream_tls=upstream_tls, route_mode=route_mode,
            kind="machine" if route_mode == "dns_only" else "service",
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

    # Step 1 — Caddy (required for proxy). Roll back on failure.
    try:
        if inst.route_mode == "proxy":
            await caddy_service.upsert_route(caddy_client, inst, base_domain)
        else:
            # dns_only: no Caddy route should exist. Tear down any stale one from a prior
            # proxy assignment (idempotent — delete_route already ignores 404).
            await caddy_client.delete_route(inst.id)
    except (httpx.HTTPError, CaddyError, ValueError) as exc:
        if created_new:
            instances_store.delete_instance(inst.id)
        else:
            instances_store.upsert_instance(prev)  # type: ignore[arg-type]
        raise AssignError(502, f"Caddy step failed: {describe_error(exc)}")

    # Step 2 — AdGuard rewrite (best effort). Answer is the shared Caddy IP for proxy,
    # or the instance's own upstream IP for dns_only.
    answer = target_answer(inst, current_ip)
    adguard_status = "skipped"
    warning: str | None = None
    if not answer:
        warning = "No Caddy answer IP (set CADDY_HOST_IP in Docker mode) — DNS rewrite skipped."
    elif adguard_client.base_url() is None:
        warning = "AdGuard is not configured — DNS rewrite skipped."
    else:
        try:
            # The old (domain, answer) pair is orphaned — and must be cleaned up before
            # adding the new one — whenever either half is about to change: a rename
            # (domain differs) or a mode switch / IP change (same domain, new answer).
            # Rewrites are keyed by the pair, not an @id, so leaving the old one behind
            # means two answers for the same domain until the next Sync.
            if old_domain and old_answer and (old_domain != domain or old_answer != answer):
                try:
                    await adguard_client.delete_rewrite(old_domain, old_answer)
                except (httpx.HTTPError, AdGuardError) as exc:
                    # Best effort: the assign still succeeds, but the stale pair may
                    # linger until the next Sync, so leave a trace for whoever finds it.
                    logger.warning(
                        "stale rewrite %s -> %s not deleted: %s",
                        old_domain, old_answer, describe_error(exc),
                    )
            await adguard_client.add_rewrite(domain, answer)
            inst = inst.model_copy(update={"dns_answer": answer})
            instances_store.upsert_instance(inst)
            adguard_status = "ok"
        except (httpx.HTTPError, AdGuardError) as exc:
            adguard_status = "error"
            logger.warning(
                "rewrite %s -> %s failed, route kept: %s", domain, answer, describe_error(exc)
            )
            warning = (
                f"Route created, but the DNS rewrite failed — {describe_error(exc)}. "
                "The name won't resolve on the LAN until it's added; retry when AdGuard is reachable."
            )

    # Step 3 — carry the change to anything hosted here. This is what the `machine` link
    # buys: one edit, every route to that address follows. Best-effort per route — a push
    # that fails leaves the stored upstream correct, so the next Sync repairs it.
    relinked, relink_failures = await _propagate_to_dependents(
        caddy_client, inst, prev, base_domain
    )
    if relink_failures:
        warning = (warning + " " if warning else "") + (
            f"{len(relink_failures)} route(s) hosted here kept the old address in Caddy "
            "until the next Sync."
        )

    return {
        "caddy": "ok" if inst.route_mode == "proxy" else "skipped",
        "adguard": adguard_status,
        "url": f"https://{domain}" if inst.route_mode == "proxy" else domain,
        "instance_id": inst.id,
        "relinked": relinked,
        "warning": warning,
    }


async def _propagate_to_dependents(
    caddy_client, machine: Instance, prev: Instance | None, base_domain: str | None
) -> tuple[list[str], list[str]]:
    """Rewrite the host half of every route hosted on `machine` and re-push it.

    Only runs when this assign actually moved a machine's address: the link exists so an
    IP is entered once, and a no-op assign must not re-push half the estate. Returns the
    ids updated and the ids whose Caddy push failed (their stored upstream is already the
    new one, which is what makes Sync a working repair rather than a second guess)."""
    if not prev or not instances_store.is_machine(machine):
        return [], []
    old_host, new_host = prev.upstream, machine.upstream
    if not new_host or old_host == new_host:
        return [], []

    updated: list[str] = []
    failed: list[str] = []
    for dep in instances_store.list_by_machine(machine.id):
        if not dep.upstream:
            continue
        moved = dep.model_copy(
            update={"upstream": relink_upstream(dep.upstream, new_host)}
        )
        instances_store.upsert_instance(moved)
        updated.append(moved.id)
        if moved.route_mode != "proxy" or not moved.subdomain:
            continue
        try:
            await caddy_service.upsert_route(caddy_client, moved, base_domain)
        except (httpx.HTTPError, CaddyError, ValueError) as exc:
            failed.append(moved.id)
            logger.warning(
                "route %s not re-pushed after %s moved to %s: %s",
                moved.id, machine.id, new_host, describe_error(exc),
            )
    return updated, failed


# --- Named entry points ---
#
# One orchestration, two verbs. The body below is ~80% shared — dedup by container/origin,
# the uniqueness check, the rollback, AdGuard's exact-pair cleanup, the machine propagation
# — and those shared parts are the ones where a divergence between two copies would hurt
# most. So the split is at the call site, not in the flow: these say which verb is meant.


async def assign_route(caddy_client, adguard_client, **kwargs) -> dict:
    """Publish a service at a name: Caddy route (required) + DNS rewrite answering Caddy."""
    return await assign(caddy_client, adguard_client, route_mode="proxy", **kwargs)


async def name_machine(caddy_client, adguard_client, **kwargs) -> dict:
    """Give a LAN machine a name: a DNS rewrite straight to its own address, no Caddy, no
    TLS. What routes then link to via `machine`."""
    return await assign(caddy_client, adguard_client, route_mode="dns_only", **kwargs)


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
        except (httpx.HTTPError, AdGuardError) as exc:
            adguard_status = "error"
            logger.warning(
                "rewrite %s -> %s not deleted on unassign: %s",
                old_domain, old_answer, describe_error(exc),
            )

    return {"caddy": "ok", "adguard": adguard_status, "cleared": True, "instance_id": inst.id}


async def purge_instance(
    caddy_client, adguard_client, inst: Instance, *, base_domain: str | None
) -> dict:
    """Clear any route + rewrite for `inst` and drop its record. The caller owns the
    policy of *which* instances may be purged (external delete; orphan cleanup) — this
    just does the cross-module teardown."""
    if inst.subdomain:
        await unassign(caddy_client, adguard_client, inst.id, base_domain=base_domain)
    # Anything hosted here keeps working on the address it already has — it just stops
    # following this machine. Refusing the delete would be the other option; Loskai's
    # standing preference is to do the thing and say what happened (Phase 18's walk-back
    # of the boot guard), and nothing here is unrecoverable: re-point the route to relink.
    unlinked = [dep.id for dep in instances_store.list_by_machine(inst.id)]
    for dep_id in unlinked:
        dep = instances_store.get_instance(dep_id)
        if dep:
            instances_store.upsert_instance(dep.model_copy(update={"machine": None}))
    instances_store.delete_instance(inst.id)
    return {"deleted": True, "instance_id": inst.id, "unlinked": unlinked}


async def delete_instance(
    caddy_client, adguard_client, instance_id: str, *, base_domain: str | None
) -> dict:
    """Fully delete any instance — clear its route + rewrite (if any) and drop the record.
    Type-agnostic: deleting a docker instance removes the route but leaves the container
    untouched (it just becomes an unrouted container again, re-routable via Add route).
    Since containers no longer auto-create instances, a deleted docker record won't reappear."""
    inst = instances_store.get_instance(instance_id)
    if inst is None:
        raise AssignError(404, f"instance '{instance_id}' not found")
    return await purge_instance(caddy_client, adguard_client, inst, base_domain=base_domain)


# --- Router ---

router = APIRouter(prefix="/api", tags=["assign"])


class AssignBody(BaseModel):
    prefix: str
    upstream: str
    instance_id: str | None = None
    name: str | None = None
    container: str | None = None
    origin: str | None = None
    machine: str | None = None
    upstream_tls: bool = False
    route_mode: Literal["proxy", "dns_only"] = "proxy"


@router.post("/assign")
async def post_assign(body: AssignBody) -> dict:
    base = settings_store.value("base_domain")
    current_ip = settings_store.derive_caddy_host_ip()
    try:
        return await assign(
            caddy, adguard,
            prefix=body.prefix, upstream=body.upstream,
            instance_id=body.instance_id, name=body.name, container=body.container,
            origin=body.origin, machine=body.machine,
            upstream_tls=body.upstream_tls,
            route_mode=body.route_mode,
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


# Full instance deletion is a cross-module action (route + rewrite cleanup), so it lives
# here rather than in shared/instances.py (which must not import the module clients).
@router.delete("/instances/{instance_id}")
async def delete_instance_route(instance_id: str) -> dict:
    base = settings_store.value("base_domain")
    try:
        return await delete_instance(caddy, adguard, instance_id, base_domain=base)
    except AssignError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
