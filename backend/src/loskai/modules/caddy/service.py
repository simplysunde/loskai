"""Caddy module logic — pure builders + read/push orchestration.

The Caddy module is **read + push only**: it never assigns or clears a subdomain (that
is `shared/assign.py`, Phase 6). It owns the projection "instances with a subdomain and
`route_mode: "proxy"` → Caddy routes" and a display-only sync comparison that never
auto-corrects. `route_mode: "dns_only"` instances have a subdomain but are excluded from
this projection entirely — they resolve via AdGuard alone, never through Caddy.
"""

from ipaddress import ip_address
from urllib.parse import urlparse

import httpx

from ...shared import instances as instances_store
from ...shared.instances import Instance
from .client import CaddyClient, CaddyError, describe_error


# --- Pure builders (no I/O — unit-tested directly) ---


def assemble_fqdn(subdomain: str, base_domain: str) -> str:
    return f"{subdomain}.{base_domain}"


def caddy_mode(admin_url: str | None) -> str | None:
    """`lan` if the admin URL host is an IP, `docker` if a hostname, None if unset.
    Drives the frontend's upstream-input hint."""
    if not admin_url:
        return None
    host = urlparse(admin_url).hostname
    if not host:
        return None
    try:
        ip_address(host)
    except ValueError:
        return "docker"
    return "lan"


def _listen_port(addr: str) -> str:
    """Port of a Caddy listen address (':443', '0.0.0.0:443', '[::]:443')."""
    return addr.rsplit(":", 1)[-1]


def select_server_name(servers: dict) -> str:
    """Pick the server Loskai pushes routes into. Prefer one listening on the HTTPS port
    (`:443`) — that's the routing server; a static `:80` cert-setup site is a *separate*
    Caddy server we must never push reverse-proxy routes into. Fall back to a server that
    already carries routes, then to the first key. Raises if there are none.

    This replaces a blind `next(iter(servers))`, which broke once a second server existed."""
    if not servers:
        raise CaddyError("Caddy has no HTTP servers configured")
    for name, cfg in servers.items():
        listen = (cfg or {}).get("listen") or []
        if any(_listen_port(addr) == "443" for addr in listen):
            return name
    for name, cfg in servers.items():
        if (cfg or {}).get("routes"):
            return name
    return next(iter(servers))


def build_route(instance: Instance, base_domain: str) -> dict:
    """The Caddy route JSON for an instance (see docs/reference/caddy-api.md §2). Flat, keyed by
    @id = instance id, matching one specific host."""
    if not instance.subdomain:
        raise ValueError(f"instance {instance.id} has no subdomain")
    if not instance.upstream:
        raise ValueError(f"instance {instance.id} has no upstream")
    host = assemble_fqdn(instance.subdomain, base_domain)
    proxy: dict = {
        "handler": "reverse_proxy",
        "upstreams": [{"dial": instance.upstream}],
    }
    if instance.upstream_tls:
        # Dial the backend over HTTPS; skip cert verification for LAN/self-signed backends.
        proxy["transport"] = {"protocol": "http", "tls": {"insecure_skip_verify": True}}
    return {
        "@id": instance.id,
        "match": [{"host": [host]}],
        "handle": [
            {
                "handler": "subroute",
                "routes": [{"handle": [proxy]}],
            }
        ],
    }


# --- Orchestration (I/O via the client, logic here) ---


async def list_with_sync(client: CaddyClient, base_domain: str | None) -> list[dict]:
    """Every instance (routed or not) annotated with `routed` + synced (@id present in
    Caddy) + live upstream status. The routing view manages all instances, so unrouted
    ones appear here too (with null route fields). A `route_mode: "dns_only"` instance is
    `routed` (it has a subdomain) but `synced`/`upstream_healthy` stay null — it has no
    Caddy route at all, so neither concept applies. Read-only — never auto-corrects."""
    instances = instances_store.list_instances()

    live_ids: set[str] | None
    try:
        live = await client.list_live_routes()
        live_ids = {r["@id"] for r in live if r.get("@id")}
    except (httpx.HTTPError, CaddyError):
        live_ids = None  # Caddy unreachable — sync status is unknown, not "missing"

    upstream_fails: dict[str, int] | None
    try:
        ups = await client.upstreams()
        upstream_fails = {u["address"]: u.get("fails", 0) for u in ups if u.get("address")}
    except (httpx.HTTPError, CaddyError):
        upstream_fails = None

    rows: list[dict] = []
    for inst in instances:
        routed = inst.subdomain is not None
        is_proxy = routed and inst.route_mode == "proxy"
        fqdn = assemble_fqdn(inst.subdomain, base_domain) if routed and base_domain else None
        if not is_proxy or live_ids is None:
            synced = None
        else:
            synced = inst.id in live_ids
        if not is_proxy or upstream_fails is None or inst.upstream is None:
            upstream_healthy = None
        else:
            upstream_healthy = inst.upstream in upstream_fails and upstream_fails[inst.upstream] == 0
        rows.append(
            {
                "id": inst.id,
                "name": inst.name,
                "type": inst.type,
                "subdomain": inst.subdomain,
                "route_mode": inst.route_mode,
                "fqdn": fqdn,
                "upstream": inst.upstream,
                "upstream_tls": inst.upstream_tls,
                "private": inst.private,
                "container": inst.container,
                "origin": inst.origin,
                "routed": routed,
                "synced": synced,
                "upstream_healthy": upstream_healthy,
            }
        )
    return rows


async def upsert_route(client: CaddyClient, instance: Instance, base_domain: str) -> None:
    """Delete-then-add — the single convergent path (docs/reference/caddy-api.md §4). Idempotent
    by @id, so re-pushing never duplicates."""
    await client.delete_route(instance.id)  # ignores 404
    await client.push_route(build_route(instance, base_domain))


async def push_all(client: CaddyClient, base_domain: str | None) -> list[dict]:
    """Rebuild every route from the instance list (recovery backstop). Only touches
    routes whose @id matches an instance — human-added routes are left alone. Skips
    `dns_only` instances entirely — they have no Caddy route to push."""
    if not base_domain:
        raise ValueError("base_domain is not set")
    results: list[dict] = []
    for inst in instances_store.list_routed():
        if inst.route_mode != "proxy":
            continue
        try:
            await upsert_route(client, inst, base_domain)
            results.append({"id": inst.id, "status": "ok"})
        except (httpx.HTTPError, CaddyError, ValueError) as exc:
            results.append({"id": inst.id, "status": "error", "detail": describe_error(exc)})
    return results
