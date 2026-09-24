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

    A coarse, deployment-wide summary for `/api/caddy/status`. It **does not decide any
    upstream**: Phase 16 Stage A replaced that with per-container network detection
    (`modules/docker/logic.upstream_mode`), because this answer diverges from "can Caddy
    resolve this container's name?" exactly where it matters. The frontend still uses it as
    the hint fallback for route sources that have no container — Network service and
    External."""
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


ROOT_CERT_FILENAME = "caddy-root.crt"


def root_certificate(ca: dict) -> dict | None:
    """The downloadable root out of a `GET /pki/ca/local` body, or None if there is none.

    Only the **root** is handed out, never the intermediate: the intermediate is what
    Caddy signs leaves with, and a device that trusts the root already accepts it — so
    offering both would only be a second file to install in the wrong place.

    The PEM markers are checked here because this file goes straight into a system trust
    store. A truncated or empty body has to surface as an error; installed as-is it fails
    later, at the browser, as an untrusted cert that the user has already "fixed".
    """
    pem = (ca.get("root_certificate") or "").strip()
    if not (
        pem.startswith("-----BEGIN CERTIFICATE-----")
        and pem.endswith("-----END CERTIFICATE-----")
    ):
        return None
    return {
        "pem": pem + "\n",
        "common_name": ca.get("root_common_name") or ca.get("name") or "",
        "filename": ROOT_CERT_FILENAME,
    }


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


def select_http_server_name(servers: dict) -> str | None:
    """The plain-HTTP server (`:80`), or None if this Caddy has none.

    A *second* selector rather than loosening `select_server_name`: that one must keep
    excluding `:80`, since a reverse-proxy route pushed into the cert-setup site would be
    served without TLS by accident. Here the `:80` server is exactly what we want — and only
    for instances whose scheme explicitly asks for it."""
    if not servers:
        return None
    routing = select_server_name(servers)
    for name, cfg in servers.items():
        if name == routing:
            continue
        listen = (cfg or {}).get("listen") or []
        if any(_listen_port(addr) == "80" for addr in listen):
            return name
    return None


def http_route_id(instance_id: str) -> str:
    """The `@id` of an instance's plain-HTTP route. `scheme: "both"` means two Caddy routes
    for one instance, and they live in different servers, so they need distinct ids."""
    return f"{instance_id}-http"


def wants_https(instance: Instance) -> bool:
    return instance.scheme in ("https", "both")


def wants_http(instance: Instance) -> bool:
    return instance.scheme in ("http", "both")


def expected_route_ids(instance: Instance) -> list[str]:
    """Every Caddy `@id` this instance should have. Empty for `dns_only` — no Caddy at all.
    What `synced` compares against: `both` is only in sync when *both* are present."""
    if instance.route_mode != "proxy" or not instance.subdomain:
        return []
    ids = []
    if wants_https(instance):
        ids.append(instance.id)
    if wants_http(instance):
        ids.append(http_route_id(instance.id))
    return ids


def build_route(
    instance: Instance, base_domain: str, route_id: str | None = None
) -> dict:
    """The Caddy route JSON for an instance (see docs/reference/caddy-api.md §2). Flat, keyed by
    @id = instance id, matching one specific host.

    `route_id` overrides the key for the plain-HTTP twin (`<id>-http`), which is otherwise
    the same object: the handler does not change, only which server it is pushed into."""
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
        "@id": route_id or instance.id,
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
        # Both servers: a `scheme: "both"` instance is only in sync when its route is in
        # each, and an `http` one must be absent from `:443` entirely.
        live = await client.list_live_routes()
        live += await client.list_live_http_routes()
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
            expected = expected_route_ids(inst)
            synced = bool(expected) and all(rid in live_ids for rid in expected)
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
            "scheme": inst.scheme,
            "machine": inst.machine,
            "kind": inst.kind,
                "routed": routed,
                "synced": synced,
                "upstream_healthy": upstream_healthy,
            }
        )
    return rows


async def upsert_route(client: CaddyClient, instance: Instance, base_domain: str) -> None:
    """Delete-then-add — the single convergent path (docs/reference/caddy-api.md §4). Idempotent
    by @id, so re-pushing never duplicates.

    Scheme-aware since Phase 12b: `https` (default) lives only in the `:443` server, `http`
    only in the `:80` one, `both` in each. The route *not* wanted is deleted every time, so
    changing an existing route's scheme converges without a separate migration — and for
    `http` that deletion is load-bearing: absence from the `:443` server is what stops Caddy
    trying to issue a certificate for the name."""
    http_id = http_route_id(instance.id)

    if wants_https(instance):
        await client.delete_route(instance.id)  # ignores 404
        await client.push_route(build_route(instance, base_domain))
    else:
        await client.delete_route(instance.id)

    if wants_http(instance):
        await client.delete_route(http_id)
        await client.push_http_route(build_route(instance, base_domain, route_id=http_id))
    else:
        await client.delete_route(http_id)


async def teardown_route(client: CaddyClient, instance_id: str) -> None:
    """Remove both of an instance's possible routes. `DELETE /id/<id>` is server-agnostic,
    so tearing down the plain-HTTP twin needs the extra id, not extra plumbing — and it is
    unconditional because the stored scheme may already have been changed."""
    await client.delete_route(instance_id)
    await client.delete_route(http_route_id(instance_id))


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
