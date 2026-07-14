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


def subdomain_for(container_name: str, instances: list) -> str | None:
    """The assigned subdomain for a container, joined via the instance's `container`."""
    for inst in instances:
        if inst.container == container_name and inst.subdomain:
            return inst.subdomain
    return None
