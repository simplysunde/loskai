"""The Assign URL action — the one place modules coordinate.

Assigning or clearing a subdomain spans the instance store, Caddy, and AdGuard. The
Caddy and AdGuard modules themselves are read + push only; this is the only cross-module
writer. It also keeps a machine's SSH config entry and keys in step when the machine is
renamed, moved or deleted (`modules/ssh/machines.py`).

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
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..modules.adguard.client import AdGuardError, adguard
from ..modules.adguard.service import target_answer
from ..modules.caddy import service as caddy_service
from ..modules.caddy.client import CaddyError, caddy, describe_error
from ..modules.docker import install
from ..modules.docker.client import docker_client
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
    pass


def validate_prefix(prefix: str, route_mode: Literal["proxy", "dns_only"] = "proxy") -> None:
    """`proxy` stays a single DNS label — a rule from when every name shared one
    `*.BASE_DOMAIN` wildcard cert, which covers one label (architecture.md, Decisions).
    `dns_only` never had one, so dot-separated multi-label names are allowed — each label
    still has to be a valid DNS label on its own."""
    if not prefix:
        raise AssignError("prefix is required", 422)
    if route_mode == "dns_only":
        labels = prefix.split(".")
        if len(prefix) > 253 or not all(_LABEL.fullmatch(label) for label in labels):
            raise AssignError(
                "Each dot-separated label must be lowercase letters, digits, hyphens",
                422,
            )
        return
    if len(prefix) > 63 or not _LABEL.fullmatch(prefix):
        raise AssignError(
            "Subdomain must be a single DNS label (lowercase letters, digits, hyphens)",
            422,
        )


def validate_upstream(upstream: str, route_mode: Literal["proxy", "dns_only"] = "proxy") -> None:
    """`proxy`: the upstream goes verbatim into Caddy's `dial`, which wants a bare
    host:port — a scheme or path produces a malformed, non-connecting route. `dns_only`:
    the upstream IS the AdGuard answer, so it must be a bare IPv4 address — no port, no
    scheme (IPv6 is out of scope for now, same as `settings.py`'s `caddy_host_ip`/`host_ip`)."""
    if not upstream:
        raise AssignError("upstream is required", 422)
    if route_mode == "dns_only":
        if ":" in upstream:
            raise AssignError("DNS-only target must be a bare IPv4 address — no port", 422)
        try:
            ip_address(upstream)
        except ValueError:
            raise AssignError(f"DNS-only target must be a valid IP address: {upstream!r}", 422)
        return
    if "://" in upstream or "/" in upstream or any(c.isspace() for c in upstream):
        raise AssignError(
            "upstream must be host:port — no scheme or path (e.g. 192.168.10.100:3000 or grafana:3000)",
            422,
        )
    host, sep, port = upstream.rpartition(":")
    if not sep or not host:
        raise AssignError("upstream must include a port, e.g. grafana:3000", 422)
    if not port.isdigit() or not (1 <= int(port) <= 65535):
        raise AssignError(f"invalid port in upstream: {port!r}", 422)


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
        raise AssignError(f"no container named '{container}'", 404)


def same_container(instance_id: str | None, container: str) -> None:
    """Editing a record by id never moves it to another container. The page never asks; a
    request that did would have its container ignored while a following record took the new
    one's address — until the follower wrote the old one's back."""
    existing = instances_store.get_instance(instance_id) if instance_id else None
    if existing is not None and existing.container != container:
        held = f"the container '{existing.container}'" if existing.container else "no container"
        raise AssignError(f"'{existing.name}' is on {held} — editing it can't change that", 409)


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
    instances_store.require_base(base_domain)
    upstream = upstream.strip()
    validate_upstream(upstream, route_mode)

    existing = instances_store.require(instance_id) if instance_id else None

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
        raise AssignError(f"subdomain '{prefix}' is already assigned", 409)

    if route_mode == "dns_only" and (other := address_taken(upstream, exclude_id=target_id)):
        raise AssignError(f"{upstream} is already the machine '{other.name}'", 409)

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
        if (clash := instances_store.get_instance(prefix)) is not None:
            if instances_store.is_link(clash):
                raise AssignError(
                    f"'{prefix}' is the link '{clash.name}' — give it this name with "
                    "Assign a URL on its row", 409
                )
            raise AssignError(f"instance id '{prefix}' already exists", 409)
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
        instances_store.fqdn(prev.subdomain, base_domain)
        if prev and prev.subdomain
        else None
    )
    old_answer = prev.dns_answer if prev else None
    domain = instances_store.fqdn(prefix, base_domain)

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
        raise AssignError(f"Caddy step failed: {describe_error(exc)}", 502)

    if created_new:
        inst = await _recipe_icon(inst)

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
            # Only when it isn't there already: AdGuard keeps a second copy of a pair, and a
            # save that changes neither half — a machine's dialog saves each field — would
            # add one each time, and a delete would then leave one behind.
            if not any(
                r.get("domain") == domain and r.get("answer") == answer
                for r in await adguard_client.list_rewrites()
            ):
                await adguard_client.add_rewrite(domain, answer)
            # Only the answer: a change made while AdGuard answered (the follower, the
            # private toggle, an icon) is kept.
            inst = instances_store.update_fields(inst.id, dns_answer=answer) or inst
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
        # dns_only has no scheme at all: the name resolves straight to the machine.
        "url": instances_store.open_url(inst, base_domain) or domain,
        "instance_id": inst.id,
        "moved": moved,
        "warning": warning,
    }


async def _recipe_icon(inst: Instance) -> Instance:
    """A new record for a recipe stack's container gets the recipe's icon, as an install
    would have given it. Only a new one: an existing record keeps its icon, or none if it
    was removed by hand. Best-effort: the record is already saved, so nothing here may fail
    it."""
    if not inst.container:
        return inst
    try:
        iconed = await asyncio.to_thread(install.recipe_icon, inst)
    except Exception:
        logger.exception("recipe icon for '%s' not applied", inst.container)
        return inst
    if iconed.icon:
        return instances_store.give_icon(inst.id, iconed.icon) or inst
    return inst


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
        # Only its upstream, and only while it is still on the old address: an earlier
        # route's push was awaited, and a change made meanwhile is kept.
        moved = instances_store.update_fields(
            dep.id, lambda i, was=dep.upstream: i.upstream == was, upstream=move_upstream(dep.upstream, new_host)
        )
        if moved is None:
            continue
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


async def save_machine(
    caddy_client, adguard_client, *, hostname: str, address: str, instance_id: str | None,
    ssh, base_domain: str | None, current_ip: str | None, acting: User | None,
) -> dict:
    """Name a machine, or re-point one, and keep its SSH entry in step: `ssh` is its login
    (`ssh_machines.follow_machine`), None to remove its SSH connection, or `KEEP`.

    Removing the connection takes off what Loskai put on the machine, as deleting it does:
    where that is, read first — a locked key stops it here, unchanged — and taken off only
    once the save has gone through. A new SSH user does the same for the old one's
    (`prepare_user_change`) — its sudo rule is that user's — and a locked key stops it too."""
    prev = instances_store.get_instance(instance_id) if instance_id else None
    if prev is not None:  # before its SSH entry is read, below
        access.require_instance(acting, prev.kind)
    if refusal := ssh_machines.rename_refusal(prev, hostname):
        raise AssignError(refusal, 409)
    removal = ssh_machines.prepare_removal(prev) if prev is not None and ssh is None else None
    user_change = ssh_machines.prepare_user_change(prev, ssh) if prev is not None else None
    result = await name_machine(
        caddy_client, adguard_client,
        prefix=hostname, upstream=address, instance_id=instance_id,
        base_domain=base_domain, current_ip=current_ip, acting=acting,
    )
    inst = instances_store.get_instance(result["instance_id"])
    if inst is not None:
        warnings = [result["warning"]]
        if ssh is None and prev is not None:
            warnings.append(await ssh_machines.remove_keys(prev, removal))
            await asyncio.to_thread(ssh_machines.forget_trust, prev)
        if user_change is not None:
            warnings.append(await ssh_machines.remove_keys(prev, user_change, user_changed=True))
        warnings.append(await asyncio.to_thread(ssh_machines.follow_machine, prev, inst, ssh))
        result["warning"] = " ".join(w for w in warnings if w) or None
    return result


# --- Links ---
#
# A link is a name and an address the Dashboard opens directly: `route_mode: "direct"` and no
# subdomain, so no Caddy route, no DNS rewrite — and nothing that reads routes ever sees it.
# Its own verb rather than a mode of `assign()`, which is the Caddy-then-AdGuard
# orchestration: a link has neither step, and branches there would be where two paths drift.

_LINK_ID = re.compile(r"[^a-z0-9]+")
LINK_NAME_MAX = 80


def link_id(name: str) -> str:
    """A new link's id: its name as a slug, numbered past any id already taken. The id is
    also what an `Assign a URL` later offers as the prefix, so it reads like one."""
    base = _LINK_ID.sub("-", name.lower()).strip("-")[:60].strip("-") or "link"
    taken = {i.id for i in instances_store.list_instances()}
    candidate, n = base, 2
    while candidate in taken:
        candidate, n = f"{base}-{n}", n + 1
    return candidate


async def make_link(
    *,
    name: str,
    upstream: str,
    upstream_tls: bool = False,
    container: str | None = None,
    instance_id: str | None = None,
    follow_container: bool = False,
    acting: User | None = None,
) -> dict:
    """Create or edit a link. An existing record — by id, or the one linked to the container
    — becomes the link: a recipe install's unrouted record, or a link being edited. A routed
    one is refused, not torn down: that is `unassign`'s job, with its required Caddy step."""
    name = name.strip()
    if not name:
        raise AssignError("a link needs a name", 422)
    if len(name) > LINK_NAME_MAX:
        raise AssignError(f"a link's name is at most {LINK_NAME_MAX} characters", 422)
    upstream = upstream.strip()
    validate_upstream(upstream)

    existing = instances_store.require(instance_id) if instance_id else None
    if existing is None and container:
        existing = instances_store.get_by_container(container)
    if existing is not None:
        if acting is not None:
            access.require_instance(acting, existing.kind)
        if instances_store.is_machine(existing):
            raise AssignError(f"'{existing.name}' is a machine — a link is to a service on one", 409)
        if existing.subdomain:
            raise AssignError(
                f"'{existing.name}' is routed at {existing.subdomain} — remove its route first",
                409,
            )
        inst = existing.model_copy(update={
            "name": name, "upstream": upstream, "upstream_tls": upstream_tls,
            "route_mode": "direct", "kind": "service", "follow_container": follow_container,
            "dns_answer": None,
        })
    else:
        inst = Instance(
            id=link_id(name), name=name,
            type="docker" if container else "external", container=container,
            upstream=upstream, upstream_tls=upstream_tls, route_mode="direct",
            kind="service", follow_container=follow_container,
        )
    instances_store.upsert_instance(inst)
    if existing is None:
        inst = await _recipe_icon(inst)
    return {
        "caddy": "skipped",
        "adguard": "skipped",
        "url": instances_store.open_url(inst, None),
        "instance_id": inst.id,
        "moved": [],
        "warning": None,
        "link": True,
    }


async def unassign(
    caddy_client, adguard_client, instance_id: str, *, base_domain: str | None
) -> dict:
    inst = instances_store.require(instance_id)
    if not inst.subdomain:
        return {"caddy": "ok", "adguard": "skipped", "cleared": False}

    prev = inst.model_copy(deep=True)
    old_domain = (
        instances_store.fqdn(inst.subdomain, base_domain) if base_domain else None
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
        raise AssignError(f"Caddy route delete failed: {describe_error(exc)}", 502)

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
        removal = ssh_machines.prepare_removal(inst)
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
    inst = instances_store.require(instance_id)
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
    """Name a LAN machine. `hostname` is its name too, and may be dotted (`rack1.vm3`) —
    it has no certificate — and `address` is a bare IP, since DNS resolves names to addresses, not ports.
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


async def _followed_upstream(
    container: str | None, instance_id: str | None, *, link: bool = False
) -> str:
    """The upstream a following route or link gets: the container's, asked of Docker now —
    for a route how Caddy dials it, for a link where a browser reaches it.

    The one place creating either depends on the Docker socket, deliberately — everywhere
    else an unreachable daemon means "unknown" and it goes ahead (validate_container). A
    following record's address *is* Docker's answer, so without one there is nothing to
    make: 503, not a guess. The container comes from the request, or from the record when
    editing by `instance_id`."""
    what = "link" if link else "route"
    if not container and instance_id:
        existing = instances_store.get_instance(instance_id)
        container = existing.container if existing else None
    if not container:
        raise AssignError(f"only a container's {what} can follow its container", 400)
    try:
        upstream = await asyncio.to_thread(
            follow.derive_published if link else follow.derive_upstream, container
        )
    except Exception as exc:  # noqa: BLE001 — any docker/transport failure
        raise AssignError(
            f"can't ask Docker for '{container}'s address ({describe_error(exc)}) — "
            "set it by hand, or retry", 503
        )
    if not upstream:
        raise AssignError(
            f"'{container}' has no single published port on a known address — set the "
            "address by hand, publish one port, or set the Docker host's LAN IP in Settings"
            if link else
            f"'{container}'s port can't be determined — set the address by hand, or "
            "give the container a loskai.port label",
            400,
        )
    return upstream


class LinkCreate(BaseModel):
    """A link: a name and an address the Dashboard opens directly — no Caddy, no AdGuard."""

    name: str
    upstream: str
    upstream_tls: bool = False
    container: str | None = None
    instance_id: str | None = None
    # As for a route, but the address followed is where a browser reaches the container: the
    # Docker host and its published port (follow.published_upstreams).
    follow_container: bool = False


@router.post("/machines")
async def post_machine(body: MachineCreate) -> dict:
    """Create or re-point a machine (`instance_id` to edit one). No Caddy route, no TLS."""
    base, current_ip = settings_store.dns_context()
    return await save_machine(
        caddy, adguard,
        hostname=body.hostname, address=body.address, instance_id=body.instance_id,
        ssh=body.ssh if "ssh" in body.model_fields_set else ssh_machines.KEEP,
        base_domain=base, current_ip=current_ip, acting=auth.current_user(),
    )


@router.post("/routes")
async def post_route(body: RouteCreate) -> dict:
    """Create or re-point a proxied service (`instance_id` to edit one)."""
    base, current_ip = settings_store.dns_context()
    if body.container:
        validate_container(body.container)
        same_container(body.instance_id, body.container)
    upstream = (
        await _followed_upstream(body.container, body.instance_id)
        if body.follow_container else body.upstream
    )
    return await assign_route(
        caddy, adguard,
        prefix=body.prefix, upstream=upstream,
        instance_id=body.instance_id, name=body.name, container=body.container,
        origin=body.origin, upstream_tls=body.upstream_tls,
        scheme=body.scheme, base_domain=base, current_ip=current_ip,
        follow_container=body.follow_container, acting=auth.current_user(),
    )


@router.post("/links")
async def post_link(body: LinkCreate) -> dict:
    """Create or edit a link (`instance_id` to edit one). No Caddy route, no DNS rewrite."""
    if body.container:
        validate_container(body.container)
        same_container(body.instance_id, body.container)
    upstream = (
        await _followed_upstream(body.container, body.instance_id, link=True)
        if body.follow_container else body.upstream
    )
    return await make_link(
        name=body.name, upstream=upstream, upstream_tls=body.upstream_tls,
        container=body.container, instance_id=body.instance_id,
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
