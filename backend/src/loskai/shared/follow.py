"""A Docker route that follows its container.

A route stores its upstream, and a container's port can change underneath it — a compose
edit, a recipe's `PORT`, a re-up over SSH — leaving the route dialling the old one: a 502
with nothing in Loskai saying why. A route with `follow_container` is rewritten from the
live container instead. It is the move `assign._move_routes_on` makes when a
machine changes address, with Docker's event stream as the trigger.

The derivation is `logic.suggested_upstream` — the same function the route forms pre-fill
from, so what the form shows and what the follower writes cannot disagree. Everything here
is best-effort in the same way machine propagation is: the stored upstream is updated
first, so a Caddy push that fails is repaired by the next Sync rather than lost.

This is Loskai's only background task. It must never block startup, and Docker being
unreachable greys out nothing — it backs off and retries.
"""

import asyncio
import logging

import httpx

from ..modules.caddy import service as caddy_service
from ..modules.caddy.client import CaddyError, describe_error
from ..modules.docker.client import docker_client
from . import instances as instances_store
from . import settings as settings_store

logger = logging.getLogger(__name__)

RETRY_INITIAL = 2.0  # seconds; doubles per failed connect or catch-up, capped
RETRY_MAX = 60.0


def _listed(field: str) -> dict[str, str | None]:
    """`{container name: its <field>}` for every container, from one Docker listing. None
    where it can't be derived (no port, or several, and no label). Raises the Docker
    client's errors — callers decide what "unreachable" means to them."""
    rows = docker_client.list_containers(settings_store.caddy_admin_host(), settings_store.value("host_ip"))
    return {row["name"]: row[field] for row in rows}


def derived_upstreams() -> dict[str, str | None]:
    """`{container name: the upstream Caddy dials it at}` — what a route follows."""
    return _listed("suggested_upstream")


def derive_upstream(container: str) -> str | None:
    """The upstream one container is dialled at right now, or None."""
    return derived_upstreams().get(container)


def published_upstreams() -> dict[str, str | None]:
    """`{container name: where a browser reaches it}` — the Docker host and the published
    port, what a link follows. Not Caddy's form: that may be a Docker service name."""
    return _listed("published_upstream")


def derive_published(container: str) -> str | None:
    """Where a browser reaches one container right now, or None."""
    return published_upstreams().get(container)


async def reconcile(
    caddy_client, container: str, derived: dict[str, str | None] | None = None
) -> str | None:
    """Re-point the route following `container` at its live upstream. Returns the new
    upstream when it moved, else None. `derived` lets reconcile_all share one listing."""
    inst = instances_store.get_by_container(container)
    if inst is None or not instances_store.follows_container(inst):
        return None
    link = instances_store.is_link(inst)
    if derived is None:
        derived = await asyncio.to_thread(published_upstreams if link else derived_upstreams)
    upstream = derived.get(container)
    if not upstream:
        # Not derivable any more — say a label was removed and the ports are ambiguous now.
        # Leave the route as it is: an old address that may still work beats none.
        if container in derived:
            logger.warning(
                "route %s follows %s, whose port can no longer be determined — left at %s",
                inst.id, container, inst.upstream,
            )
        return None
    if upstream == inst.upstream:
        return None
    moved = instances_store.follow_upstream(inst.id, inst.upstream, upstream, inst.route_mode)
    if moved is None:
        return None  # edited while Docker was being asked — the edit wins
    logger.info("route %s follows %s: %s -> %s", inst.id, container, inst.upstream, upstream)
    if link:
        return upstream  # a link is only its record: nothing to push
    try:
        await caddy_service.upsert_route(caddy_client, moved, settings_store.value("base_domain"))
    except (httpx.HTTPError, CaddyError, ValueError) as exc:
        logger.warning(
            "route %s re-pointed in the store but not in Caddy (Sync repairs it): %s",
            inst.id, describe_error(exc),
        )
    return upstream


async def reconcile_all(caddy_client) -> list[str]:
    """Bring every following route up to date — at startup and after each reconnect, since
    a change made while Loskai or the daemon was down produced no event to react to."""
    following = [i for i in instances_store.list_instances() if instances_store.follows_container(i)]
    # One listing per kind of address, and only for a kind something follows: a route's is
    # how Caddy dials the container, a link's where a browser reaches it.
    routes = [i.container for i in following if not instances_store.is_link(i)]
    links = [i.container for i in following if instances_store.is_link(i)]
    moved: list[str] = []
    for containers, derive in ((routes, derived_upstreams), (links, published_upstreams)):
        if not containers:
            continue
        derived = await asyncio.to_thread(derive)
        for container in containers:
            if await reconcile(caddy_client, container, derived):
                moved.append(container)
    return moved


async def watch(caddy_client) -> None:
    """Follow Docker's container-start events for as long as Loskai runs.

    Subscribes *before* catching up, so a container that starts between the catch-up and
    the subscription is still seen. Any failure — the daemon restarting, the socket gone —
    drops back to a retry with backoff; only cancellation ends the loop."""
    delay = RETRY_INITIAL
    while True:
        stream = None
        try:
            stream = await asyncio.to_thread(docker_client.container_events)
            await reconcile_all(caddy_client)
            # Back to the first delay only once caught up: a catch-up that fails every
            # time backs off like a daemon that is gone.
            delay = RETRY_INITIAL
            while True:
                event = await asyncio.to_thread(next, stream, None)
                if event is None:
                    raise ConnectionError("Docker event stream ended")
                name = ((event.get("Actor") or {}).get("Attributes") or {}).get("name")
                if event.get("Action") == "start" and name:
                    await reconcile(caddy_client, name)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — anything at all means "retry", never "die"
            logger.warning(
                "not following containers (%s) — retrying in %.0fs", describe_error(exc), delay
            )
        finally:
            if stream is not None:
                # Releases a read still blocked in its thread — at shutdown, the only way out.
                await asyncio.to_thread(stream.close)
        await asyncio.sleep(delay)
        delay = min(delay * 2, RETRY_MAX)
