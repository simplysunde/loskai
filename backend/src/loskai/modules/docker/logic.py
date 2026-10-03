"""Pure Docker helpers — no docker-py, no I/O, so they're unit-tested directly.

Stats math (CPU%/memory), attribute extraction, the container↔instance join, and stack
status all live here; `client.py` does the socket I/O and calls these.
"""

from datetime import datetime, timezone

import yaml


def compute_cpu_percent(stats: dict) -> float | None:
    """The standard Docker CPU% from a single stats sample (which carries precpu)."""
    try:
        cpu = stats["cpu_stats"]
        pre = stats["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        system_delta = cpu["system_cpu_usage"] - pre.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus") or len(cpu["cpu_usage"].get("percpu_usage") or [1])
    except (KeyError, TypeError):
        return None
    if system_delta <= 0 or cpu_delta < 0:
        return 0.0
    return round((cpu_delta / system_delta) * online * 100.0, 1)


def compute_memory(stats: dict) -> dict:
    """Used/limit bytes + percent, matching the docker CLI (usage minus inactive cache)."""
    mem = stats.get("memory_stats") or {}
    usage = mem.get("usage")
    limit = mem.get("limit")
    if usage is None or not limit:
        return {"used": None, "limit": limit, "percent": None}
    inactive = (mem.get("stats") or {}).get("inactive_file", 0)
    used = max(usage - inactive, 0)
    return {"used": used, "limit": limit, "percent": round(used / limit * 100.0, 1)}


def parse_docker_time(value: str | None) -> datetime | None:
    """Parse Docker's RFC3339 timestamps, tolerating nanosecond precision."""
    if not value or value.startswith("0001-01-01"):
        return None
    text = value.replace("Z", "+00:00")
    # Trim fractional seconds to microseconds (datetime can't do nanoseconds).
    if "." in text:
        head, _, tail = text.partition(".")
        frac = ""
        for ch in tail:
            if ch.isdigit():
                frac += ch
            else:
                tail = tail[len(frac):]
                break
        text = f"{head}.{frac[:6]}{tail}"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def uptime_seconds(started_at: str | None, now: datetime | None = None) -> int | None:
    start = parse_docker_time(started_at)
    if start is None:
        return None
    now = now or datetime.now(timezone.utc)
    return max(int((now - start).total_seconds()), 0)


def image_name(container_attrs: dict, image_tags: list[str] | None) -> str:
    if image_tags:
        return image_tags[0]
    image_id = (container_attrs.get("Image") or "")
    return image_id[:19] if image_id else "<none>"


def format_ports(attrs: dict) -> list[str]:
    """"host->container/proto" strings from a container's NetworkSettings.Ports."""
    ports = (attrs.get("NetworkSettings") or {}).get("Ports") or {}
    out: list[str] = []
    for container_port, bindings in sorted(ports.items()):
        if not bindings:
            continue
        for b in bindings:
            host = b.get("HostPort")
            if host:
                out.append(f"{host}->{container_port}")
    return out


def compute_stack_status(declared: set[str], running: set[str]) -> str:
    """up = every declared service running, down = none, partial = some."""
    if not running:
        return "down"
    return "up" if declared and running >= declared else "partial"


def declared_services(compose_text: str) -> set[str]:
    """Service names declared in a compose file. Empty set on unparseable YAML —
    a broken compose file shouldn't crash the stack list."""
    try:
        doc = yaml.safe_load(compose_text)
    except yaml.YAMLError:
        return set()
    if not isinstance(doc, dict):
        return set()
    services = doc.get("services")
    return set(services) if isinstance(services, dict) else set()


def suggested_container_port(ports: dict | None) -> str | None:
    """The container-side port to route to, best-effort. Prefers the single *published*
    binding (e.g. AdGuard exposes many ports but publishes only 3000); falls back to a
    single exposed port. None when it's ambiguous (0 or several). `ports` is docker-py's
    NetworkSettings.Ports, e.g. {"3000/tcp": [{"HostPort": "3000"}], "53/tcp": None}."""
    p = ports or {}
    published = [spec for spec, bindings in p.items() if bindings]
    if len(published) == 1:
        return published[0].split("/")[0]
    if len(p) == 1:
        return next(iter(p)).split("/")[0]
    return None


def published_host_binding(ports: dict | None) -> tuple[str | None, str] | None:
    """The single published host binding as `(host_ip, host_port)`, or None when there
    isn't exactly one published port. `host_ip` is the concrete bind address when the port
    was published to a specific IP, else None (a `0.0.0.0`/`::`/empty HostIp means
    "all interfaces" — no single LAN IP to infer). `ports` is docker-py's
    NetworkSettings.Ports, e.g. {"8096/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8096"}]}."""
    p = ports or {}
    published = [bindings for bindings in p.values() if bindings]
    if len(published) != 1:
        return None
    binding = published[0][0]  # first binding of the sole published port (IPv4 entry)
    host_port = binding.get("HostPort")
    if not host_port:
        return None
    host_ip = binding.get("HostIp")
    if host_ip in (None, "", "0.0.0.0", "::"):
        host_ip = None
    return host_ip, host_port


# Networks that carry no embedded DNS, so sharing one proves nothing about name resolution.
# `host` puts a container in the host's own namespace; `none` disables networking outright.
NON_RESOLVING_NETWORKS = frozenset({"host", "none"})


def container_networks(attrs: dict | None) -> set[str]:
    """Network names a container is attached to, from docker-py's NetworkSettings."""
    return set(((attrs or {}).get("NetworkSettings") or {}).get("Networks") or {})


def network_aliases(attrs: dict | None) -> set[str]:
    """Every DNS alias the container answers to on any of its networks. Compose puts the
    service name here, which is what a `<project>-<service>-1` container is reachable as."""
    nets = ((attrs or {}).get("NetworkSettings") or {}).get("Networks") or {}
    out: set[str] = set()
    for cfg in nets.values():
        out.update((cfg or {}).get("Aliases") or [])
    return out


def matches_hostname(
    hostname: str | None, name: str, service: str | None, attrs: dict | None
) -> bool:
    """Whether this container is the one a hostname addresses — used to find Caddy from
    `CADDY_ADMIN_URL`.

    Three keys, because the container name alone is not enough. `compose.colocated.yml`
    pins `container_name: caddy`, but a stack that omits it gets `<project>-caddy-1` and
    `caddy` survives only as a network alias — which is precisely the layout Stage B is
    for. The compose service label is checked too, since that is what the alias is derived
    from and it is already read for the upstream form.
    """
    if not hostname:
        return False
    h = hostname.lower()
    if name.lower() == h or (service or "").lower() == h:
        return True
    return h in {a.lower() for a in network_aliases(attrs)}


def shares_docker_network(
    caddy_networks: set[str] | None, container_networks: set[str] | None
) -> bool:
    """Whether Caddy can dial this container by name — i.e. they share a network Docker's
    embedded DNS actually serves.

    `host` and `none` are subtracted rather than intersected. Two containers on
    `network_mode: host` both report `{"host"}`, and a plain intersection would read that as
    "shared" — but host networking has no embedded DNS, so `name:port` would not resolve.
    Those containers are still reachable at the host's published port, which is what the
    `lan` form gives.

    An unknown Caddy (`None`) shares nothing: it is not a container this daemon can see.
    """
    if caddy_networks is None:
        return False
    return bool(
        (caddy_networks - NON_RESOLVING_NETWORKS)
        & ((container_networks or set()) - NON_RESOLVING_NETWORKS)
    )


def upstream_mode(
    caddy_networks: set[str] | None, container_networks: set[str] | None
) -> str:
    """How Caddy has to dial one container: `docker` (by name) or `lan` (published port).

    This is the Phase 16 Stage A fix. It replaces `caddy_mode`, which answered "is
    CADDY_ADMIN_URL's host an IP?" — a *per-deployment* answer to a *per-container*
    question. The two diverge whenever Caddy is a container beside managed stacks: Compose
    isolates every project on its own `<project>_default`, so Caddy resolves names in its
    own project and nowhere else, and a `name:port` pre-filled for a managed stack 502s.

    An unresolvable Caddy falls to `lan`, never to the name form. It means Caddy is not a
    container this daemon can see — an external LXC, or a hostname pointing off-box — and in
    every one of those cases the published host port is the reachable answer.
    """
    return "docker" if shares_docker_network(caddy_networks, container_networks) else "lan"


def suggested_host(
    container_name: str,
    service: str | None,
    ports: dict | None,
    mode: str | None = None,
    host_ip: str | None = None,
) -> str | None:
    """The host half of an upstream — which is known far more often than the port.

    `lan`: the concrete IP a port was published to, else the configured `host_ip`. That is
    the Docker host itself, so it holds even when no single port can be named: a
    host-networked container publishes nothing at all, and several published ports are
    ambiguous, but either way Caddy dials the same host. `docker`: the service name (else
    the container name), which Docker DNS resolves on the shared network.

    None only in `lan` mode with no `host_ip` configured — a bridged Loskai cannot detect
    its own host's LAN IP.
    """
    if mode == "lan":
        binding = published_host_binding(ports)
        return (binding[0] if binding else None) or host_ip
    return service or container_name


def suggested_upstream(
    container_name: str,
    service: str | None,
    ports: dict | None,
    mode: str | None = None,
    host_ip: str | None = None,
) -> str | None:
    """A reachable upstream to pre-fill the assign form, best-effort: `suggested_host` plus
    the port, or None when either half is unknown — the form then pre-fills the host alone.

    In `docker` mode (Caddy shares the Docker network) this is `<service-or-name>:<port>` —
    the name resolves to the container's network IP via Docker DNS (robust across restarts).

    In `lan` mode Caddy runs on its own LXC and *cannot* resolve container names, so it needs
    the Docker host's LAN IP + the *published host port*: `<host_ip>:<host_port>`.

    `mode` unset falls back to the docker-name form (co-located default)."""
    host = suggested_host(container_name, service, ports, mode, host_ip)
    if mode == "lan":
        binding = published_host_binding(ports)
        port = binding[1] if binding else None
    else:
        port = suggested_container_port(ports)
    return f"{host}:{port}" if host and port else None


def primary_container(containers: list[dict], declared: str | None = None) -> str | None:
    """Which container of a freshly installed compose project the instance joins to.

    The join everywhere else in this module matches on the *container name*, and Compose
    names containers `<project>-<service>-1` unless the compose file pins
    `container_name` — so an installed recipe's instance can only link up if it is told
    the real name. A recipe is also often several services (app + database) and only one
    of them is the thing being published.

    Order: the manifest's `service` if it names one that exists, then the only service
    when there is one, then the service publishing ports (a database usually publishes
    none), then alphabetically — a stable answer beats whatever the daemon listed first.

    `containers` is `[{"service", "name", "ports"}]` from `client.containers_in_project`.
    None when the project has no containers at all.
    """
    if not containers:
        return None
    by_service = {c["service"]: c for c in containers}
    if declared and declared in by_service:
        return by_service[declared]["name"]
    if len(containers) == 1:
        return containers[0]["name"]
    published = [c for c in containers if any((c.get("ports") or {}).values())]
    if len(published) == 1:
        return published[0]["name"]
    pool = published or containers
    return min(pool, key=lambda c: c["service"])["name"]


def linked_instance_id(container_name: str, instances: list) -> str | None:
    """The id of the instance linked to this container, routed or not. A recipe install
    creates one before any route exists, named for the recipe — a better route prefix than
    the generated `<project>-<service>-1`."""
    for inst in instances:
        if inst.container == container_name:
            return inst.id
    return None


def subdomain_for(container_name: str, instances: list) -> str | None:
    """The assigned subdomain for a container, joined via the instance's `container`."""
    for inst in instances:
        if inst.container == container_name and inst.subdomain:
            return inst.subdomain
    return None


def scheme_for(container_name: str, instances: list) -> str | None:
    """The routed container's scheme, so the Docker tab links it over the protocol it is
    actually served on — an `http` route has no certificate, and an https link to it cannot
    connect. None when the container has no route."""
    for inst in instances:
        if inst.container == container_name and inst.subdomain:
            return inst.scheme
    return None


def orphaned_instances(instances: list, live_container_names: set[str]) -> list:
    """Docker-backed instances whose linked container is gone (removed, not just
    stopped — a stopped container still appears in the host list). These point at an
    upstream that no longer exists and are safe to clean up."""
    return [
        inst
        for inst in instances
        if inst.type == "docker" and inst.container and inst.container not in live_container_names
    ]
