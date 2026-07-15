"""Container label auto-discovery.

A container opts into routing with a `loskai.subdomain=<prefix>` label (plus an optional
`loskai.upstream` / `loskai.port` / `loskai.tls`). On startup — and on demand via
`POST /api/docker/discover` — Loskai scans running containers for that label and
creates/updates their docker instances + routes through the normal assign flow.

Idempotent (a container already in sync is left alone) and best-effort (a down Docker or
Caddy, or a bad label, is reported per-container and never raises).
"""

from ...shared import assign as assign_mod
from ...shared import instances as instances_store
from ...shared import settings as settings_store
from ..caddy import service as caddy_service
from . import logic
from .client import DOCKER_ERRORS, docker_client

LABEL_SUBDOMAIN = "loskai.subdomain"


def _instance_for_container(name: str):
    return next(
        (i for i in instances_store.list_instances() if i.container == name), None
    )


async def discover_labeled(caddy_client, adguard_client) -> list[dict]:
    base_domain = settings_store.value("base_domain")
    current_ip = settings_store.derive_caddy_host_ip()
    mode = caddy_service.caddy_mode(settings_store.value("caddy_admin_url"))

    try:
        candidates = docker_client.running_with_label(LABEL_SUBDOMAIN)
    except DOCKER_ERRORS:
        return []  # Docker unreachable — nothing to discover

    results: list[dict] = []
    for c in candidates:
        name, labels, ports = c["name"], c["labels"], c["ports"]
        subdomain = labels.get(LABEL_SUBDOMAIN)
        if not subdomain:
            continue
        upstream = logic.derive_upstream(name, labels, ports, mode)
        tls = logic.parse_bool(labels.get("loskai.tls"))
        if not upstream:
            results.append({
                "container": name, "status": "skipped",
                "detail": "no upstream — add loskai.upstream=host:port",
            })
            continue

        existing = _instance_for_container(name)
        if (
            existing
            and existing.subdomain == subdomain
            and existing.upstream == upstream
            and existing.upstream_tls == tls
        ):
            results.append({"container": name, "subdomain": subdomain, "status": "unchanged"})
            continue

        try:
            await assign_mod.assign(
                caddy_client, adguard_client,
                prefix=subdomain, upstream=upstream,
                instance_id=existing.id if existing else None,
                container=None if existing else name,
                upstream_tls=tls, base_domain=base_domain, current_ip=current_ip,
            )
            results.append({
                "container": name, "subdomain": subdomain,
                "status": "updated" if existing else "created",
            })
        except assign_mod.AssignError as exc:
            results.append({"container": name, "status": "error", "detail": exc.detail})
    return results
