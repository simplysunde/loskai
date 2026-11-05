"""The Assign URL action — the one place modules coordinate.

Assigning or clearing a subdomain spans the instance store, Caddy, and AdGuard. The
Caddy and AdGuard modules themselves are read + push only; this is the only cross-module
writer.

Order (see docs/project/architecture.md, Routing):
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

import asyncio
import logging
import re
from ipaddress import ip_address
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..modules.adguard.client import AdGuardError, adguard
from ..modules.adguard.service import target_answer
from ..modules.caddy import service as caddy_service
from ..modules.caddy.client import CaddyError, caddy, describe_error
from ..modules.docker import recipes
from ..modules.docker.client import docker_client
from ..modules.ssh import connect as ssh_connect
from ..modules.ssh import machines as ssh_machines
from . import access, auth, follow
from .errors import LoskaiError
from . import instances as instances_store
from . import settings as settings_store
from .instances import Instance
from .users import User

logger = logging.getLogger(__name__)

# A single DNS label: lowercase letters, digits, hyphens; not leading/trailing hyphen.
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


class AssignError(LoskaiError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail, status_code)


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


def move_upstream(upstream: str, new_host: str) -> str:
    """Swap the host half of a `host:port` upstream, keeping the port. Pure — this is the
    whole of what "the machine's address changed" means for a route on it."""
    _, _, port = upstream.rpartition(":")
    return f"{new_host}:{port}"


def validate_container(container: str) -> None:
    """A `container` link must name a container that exists. The link is by *name* (what
    the picker sends), and the orphan sweep matches the same way — so a name that matches
    nothing produced a working route the Routing tab then reported as orphaned, with the
    same row reading `synced`/`up`. Found in the 2026-09-16 smoke.

    Docker being unreachable is not a rejection: it means we cannot tell, and route
    creation must not start depending on the Docker socket."""
    try:
        names = docker_client.container_names()
    except Exception as exc:  # noqa: BLE001 — any docker/transport failure means "unknown"
        logger.warning("container '%s' not verified: %s", container, exc)
        return
    if container not in names:
        raise AssignError(404, f"no container named '{container}'")


def address_taken(address: str, exclude_id: str) -> Instance | None:
    """The other machine already at this address, if any. A route's machine is the one at
    its upstream's address, so two machines on one address would make that ambiguous."""
    return next(
        (
            i for i in instances_store.list_instances()
            if instances_store.is_machine(i) and i.upstream == address and i.id != exclude_id
        ),
        None,
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
    origin: str | None = None,
    upstream_tls: bool = False,
    scheme: Literal["https", "both", "http"] = "https",
    route_mode: Literal["proxy", "dns_only"] = "proxy",
    follow_container: bool = False,
    acting: User | None = None,
) -> dict:
    """`acting` is the account asking (the endpoints pass it): a record this changes must be
    on its tab — a machine the Machines tab's, a route Routing's — whichever way it was found."""
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
    if existing is not None and acting is not None:
        access.require_instance(acting, existing.kind)

    target_id = existing.id if existing else prefix
    if subdomain_taken(prefix, exclude_id=target_id):
        raise AssignError(409, f"subdomain '{prefix}' is already assigned")

    if route_mode == "dns_only" and (other := address_taken(upstream, exclude_id=target_id)):
        raise AssignError(409, f"{upstream} is already the machine '{other.name}'")

    created_new = existing is None
    if existing:
        prev: Instance | None = existing.model_copy(deep=True)
        inst = existing.model_copy(
            update={
                "subdomain": prefix, "upstream": upstream, "upstream_tls": upstream_tls,
                "route_mode": route_mode, "scheme": scheme,
                "follow_container": follow_container,
                # Re-pointing a machine at a port turns it into a service, and vice versa.
                "kind": "machine" if route_mode == "dns_only" else "service",
                # A machine is called by its hostname: one name, the one it has on the LAN.
                **({"name": prefix} if route_mode == "dns_only" else {}),
            }
        )
    else:
        if instances_store.get_instance(prefix) is not None:
            raise AssignError(409, f"instance id '{prefix}' already exists")
        prev = None
        # A container gets a `docker` instance linked by name; everything else is `external`
        # (a built-in network service carries its `origin` marker, a bare LAN target none).
        inst = Instance(
            id=prefix, name=prefix if route_mode == "dns_only" else name or prefix,
            type="docker" if container else "external",
            container=container, origin=origin,
            subdomain=prefix, upstream=upstream,
            upstream_tls=upstream_tls, route_mode=route_mode, scheme=scheme,
            kind="machine" if route_mode == "dns_only" else "service",
            follow_container=follow_container,
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
            await _tear_down_route(caddy_client, inst, prev)
    except (httpx.HTTPError, CaddyError, ValueError) as exc:
        if created_new:
            instances_store.delete_instance(inst.id)
        else:
            instances_store.upsert_instance(prev)  # type: ignore[arg-type]
        raise AssignError(502, f"Caddy step failed: {describe_error(exc)}")

    # A new record for a recipe stack's container gets the recipe's icon, as an install
    # would have given it. Only a new one: an existing record keeps its icon, or none if
    # it was removed by hand. Best-effort: the route is already live, so nothing here may
    # fail it.
    if created_new and inst.container:
        try:
            iconed = await asyncio.to_thread(recipes.recipe_icon, inst)
        except Exception:
            logger.exception("recipe icon for '%s' not applied", inst.container)
            iconed = inst
        if iconed.icon:
            inst = instances_store.give_icon(inst.id, iconed.icon) or inst

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

    # Step 3 — a machine that moved takes the routes on it along: one edit, every route to
    # that address follows. Best-effort per route — a push that fails leaves the stored
    # upstream correct, so the next Sync repairs it.
    moved, move_failures = await _move_routes_on(caddy_client, inst, prev, base_domain)
    if move_failures:
        warning = (warning + " " if warning else "") + (
            f"{len(move_failures)} route(s) hosted here kept the old address in Caddy "
            "until the next Sync."
        )

    return {
        "caddy": "ok" if inst.route_mode == "proxy" else "skipped",
        "adguard": adguard_status,
        "url": _display_url(inst, domain),
        "instance_id": inst.id,
        "moved": moved,
        "warning": warning,
    }


def _display_url(instance: Instance, domain: str) -> str:
    """What to show and link after an assign. `dns_only` has no scheme at all (the name
    resolves straight to a machine), and an `http` route has no certificate — calling it
    https would hand back a URL that cannot connect."""
    if instance.route_mode != "proxy":
        return domain
    return f"http://{domain}" if instance.scheme == "http" else f"https://{domain}"


async def _tear_down_route(caddy_client, inst: Instance, prev: Instance | None) -> None:  # noqa: D401
    """Remove any Caddy route for an instance that is now `dns_only`.

    Required only when this assign is *converting* one that had a proxy route: leaving that
    behind would keep Caddy answering a name the instance no longer proxies, so a failure
    there must abort and roll back. In every other case there is nothing to tear down, and
    naming a machine must not depend on Caddy at all — it has no route, and before this the
    unconditional delete made `POST /api/machines` fail with `502` whenever Caddy was down
    or simply unconfigured."""
    converting = bool(prev and prev.route_mode == "proxy" and prev.subdomain)
    try:
        await caddy_service.teardown_route(caddy_client, inst.id)  # 404-safe, both ids
    except (httpx.HTTPError, CaddyError) as exc:
        if converting:
            raise
        logger.debug(
            "no route teardown for %s (%s) — none expected", inst.id, describe_error(exc)
        )


async def _move_routes_on(
    caddy_client, machine: Instance, prev: Instance | None, base_domain: str | None
) -> tuple[list[str], list[str]]:
    """Rewrite the host half of every route on `machine`'s old address and re-push it.

    Only runs when this assign actually moved a machine's address, so a no-op assign
    re-pushes nothing. A route following its container is left alone: its address is the
    container's, and the follower would only write it back. Returns the ids updated and the
    ids whose Caddy push failed (their stored upstream is already the new one, which is
    what makes Sync a working repair rather than a second guess)."""
    if not prev or not instances_store.is_machine(machine) or not instances_store.is_machine(prev):
        return [], []
    old_host, new_host = prev.upstream, machine.upstream
    if not old_host or not new_host or old_host == new_host:
        return [], []

    updated: list[str] = []
    failed: list[str] = []
    for dep in instances_store.on_address(old_host):
        if dep.follow_container:
            continue
        moved = dep.model_copy(update={"upstream": move_upstream(dep.upstream, new_host)})
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
# the uniqueness check, the rollback, AdGuard's exact-pair cleanup, moving a machine's routes
# — and those shared parts are the ones where a divergence between two copies would hurt
# most. So the split is at the call site, not in the flow: these say which verb is meant.


async def assign_route(caddy_client, adguard_client, **kwargs) -> dict:
    """Publish a service at a name: Caddy route (required) + DNS rewrite answering Caddy."""
    return await assign(caddy_client, adguard_client, route_mode="proxy", **kwargs)


async def name_machine(caddy_client, adguard_client, **kwargs) -> dict:
    """Give a LAN machine a name: a DNS rewrite straight to its own address, no Caddy, no
    TLS. Routes on its address are listed under it, and move with it."""
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

    # Step 1 — Caddy delete (required). Roll back on failure. Both ids: a `scheme: "both"`
    # instance has a plain-HTTP twin, and leaving it would keep serving the name on :80.
    try:
        await caddy_service.teardown_route(caddy_client, inst.id)  # ignores 404
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
    machine = instances_store.is_machine(inst)
    removal = None
    if machine:
        # Where its key is, read before its name goes; a locked key stops it here, unchanged.
        try:
            removal = ssh_machines.prepare_removal(inst)
        except ssh_connect.SshError as exc:
            raise AssignError(exc.status_code, exc.detail)
    if inst.subdomain:
        await unassign(caddy_client, adguard_client, inst.id, base_domain=base_domain)
    # Only once nothing can stop the delete — Caddy's step is required, and can fail — does
    # Loskai's key come off the machine; best-effort, so a machine gone is still deleted.
    warning = await ssh_machines.remove_keys(inst, removal)
    # Routes on a deleted machine's address keep it: nothing links them, so nothing to undo.
    instances_store.delete_instance(inst.id)
    if instances_store.is_machine(inst):
        await asyncio.to_thread(ssh_machines.forget_machine, inst)
    return {"deleted": True, "instance_id": inst.id, "warning": warning}


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


# Two request models, because the two things being asked for are not the same shape. A
# machine is an address with a name; a service is a name pointing at a host:port, possibly
# over TLS, possibly on a machine's address. Fields that mean nothing for one are absent from
# it rather than ignored — a `upstream_tls` on a machine used to be silently dropped.
#
# They converge on one `assign()` below: the orchestration (dedup, uniqueness, Step 0/1/2
# with its rollback, AdGuard's exact-pair cleanup, moving a machine's routes) is identical, and
# that is the part where two copies would drift into a real bug.


class MachineSsh(BaseModel):
    """How Loskai logs in to a machine — written to its SSH config entry, not stored here."""

    user: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,31}$")
    port: int = Field(default=22, ge=1, le=65535)


class MachineCreate(BaseModel):
    """Name a LAN machine. `hostname` is its name too, and may be dotted (`rack1.vm3`) — no
    wildcard cert has to cover it — and `address` is a bare IP, since DNS resolves names to addresses, not ports.
    `ssh` sets (an object) or removes (null) its SSH config entry; left out, the entry only
    follows a rename or a move."""

    hostname: str
    address: str
    instance_id: str | None = None
    ssh: MachineSsh | None = None


class RouteCreate(BaseModel):
    """Publish a service at a name, through Caddy."""

    prefix: str
    upstream: str
    upstream_tls: bool = False
    # One enum, not two booleans: two checkboxes admit an invalid both-off state.
    scheme: Literal["https", "both", "http"] = "https"
    container: str | None = None
    origin: str | None = None
    name: str | None = None
    instance_id: str | None = None
    # The upstream is derived from the live container and kept in step with it (see
    # shared/follow.py) — the server works it out; any `upstream` sent alongside is ignored.
    follow_container: bool = False


async def _followed_upstream(body: "RouteCreate") -> str:
    """The upstream a following route gets: the container's, asked of Docker now.

    The one place route creation depends on the Docker socket, deliberately — everywhere
    else an unreachable daemon means "unknown" and the route goes ahead (validate_container).
    A following route's address *is* Docker's answer, so without one there is no route to
    make: 503, not a guess."""
    container = body.container
    if not container and body.instance_id:
        existing = instances_store.get_instance(body.instance_id)
        container = existing.container if existing else None
    if not container:
        raise AssignError(400, "only a container's route can follow its container")
    try:
        upstream = await asyncio.to_thread(follow.derive_upstream, container)
    except Exception as exc:  # noqa: BLE001 — any docker/transport failure
        raise AssignError(
            503, f"can't ask Docker for '{container}'s address ({describe_error(exc)}) — "
            "set it by hand, or retry"
        )
    if not upstream:
        raise AssignError(
            400, f"'{container}'s port can't be determined — set the address by hand, or "
            "give the container a loskai.port label"
        )
    return upstream


def _context() -> tuple[str | None, str | None]:
    return settings_store.value("base_domain"), settings_store.derive_caddy_host_ip()


@router.post("/machines")
async def post_machine(body: MachineCreate) -> dict:
    """Create or re-point a machine (`instance_id` to edit one). No Caddy route, no TLS."""
    base, current_ip = _context()
    prev = instances_store.get_instance(body.instance_id) if body.instance_id else None
    if prev is not None:  # before its SSH entry is read, below
        access.require_instance(auth.current_user(), prev.kind)
    if refusal := ssh_machines.rename_refusal(prev, body.hostname):
        raise HTTPException(status_code=409, detail=refusal)
    # Removing its SSH connection takes off what Loskai put on the machine, as deleting it
    # does: where that is, read now — a locked key stops it here, unchanged — and taken off
    # once the save has gone through.
    removal = None
    if prev is not None and "ssh" in body.model_fields_set and body.ssh is None:
        removal = ssh_machines.prepare_removal(prev)
    result = await name_machine(
        caddy, adguard,
        prefix=body.hostname, upstream=body.address,
        instance_id=body.instance_id,
        base_domain=base, current_ip=current_ip, acting=auth.current_user(),
    )
    inst = instances_store.get_instance(result["instance_id"])
    if inst is not None:
        ssh = body.ssh if "ssh" in body.model_fields_set else ssh_machines.KEEP
        warnings = [result["warning"]]
        if ssh is None and prev is not None:
            warnings.append(await ssh_machines.remove_keys(prev, removal))
            await asyncio.to_thread(ssh_machines.forget_trust, prev)
        warnings.append(await asyncio.to_thread(ssh_machines.follow_machine, prev, inst, ssh))
        result["warning"] = " ".join(w for w in warnings if w) or None
    return result


@router.post("/routes")
async def post_route(body: RouteCreate) -> dict:
    """Create or re-point a proxied service (`instance_id` to edit one)."""
    base, current_ip = _context()
    if body.container:
        validate_container(body.container)
    upstream = await _followed_upstream(body) if body.follow_container else body.upstream
    return await assign_route(
        caddy, adguard,
        prefix=body.prefix, upstream=upstream,
        instance_id=body.instance_id, name=body.name, container=body.container,
        origin=body.origin, upstream_tls=body.upstream_tls,
        scheme=body.scheme, base_domain=base, current_ip=current_ip,
        follow_container=body.follow_container, acting=auth.current_user(),
    )


@router.delete("/assign/{instance_id}")
async def delete_assign(instance_id: str) -> dict:
    if (inst := instances_store.get_instance(instance_id)) is not None:
        access.require_instance(auth.current_user(), inst.kind)
    base = settings_store.value("base_domain")
    return await unassign(caddy, adguard, instance_id, base_domain=base)


# Full instance deletion is a cross-module action (route + rewrite cleanup), so it lives
# here rather than in shared/instances.py (which must not import the module clients).
@router.delete("/instances/{instance_id}")
async def delete_instance_route(instance_id: str) -> dict:
    if (inst := instances_store.get_instance(instance_id)) is not None:
        access.require_instance(auth.current_user(), inst.kind)
    base = settings_store.value("base_domain")
    return await delete_instance(caddy, adguard, instance_id, base_domain=base)
