"""Docker Engine client — docker-py I/O over the mounted socket.

Thin wrapper: it fetches raw data and calls `logic` for all computation (stats math,
joins). Requires the socket mounted at /var/run/docker.sock.
"""

import logging
from collections.abc import Iterator

import docker
from docker.errors import DockerException
from requests.exceptions import RequestException

from ...shared import instances as instances_store
from . import logic

# docker-py surfaces a down daemon as either a DockerException or a raw requests/OS error;
# callers catch this tuple to degrade gracefully instead of 500ing.
DOCKER_ERRORS = (DockerException, RequestException, OSError)

logger = logging.getLogger(__name__)


def describe_error(exc: Exception) -> str:
    return str(exc) or exc.__class__.__name__


class DockerClient:
    def __init__(self) -> None:
        self._client: docker.DockerClient | None = None

    def _get(self) -> docker.DockerClient:
        if self._client is None:
            self._client = docker.from_env()
        return self._client

    @property
    def api(self):
        """Low-level API client (used for the interactive exec socket)."""
        return self._get().api

    def health(self) -> dict:
        try:
            self._get().ping()
        except DOCKER_ERRORS as exc:
            self._client = None  # force a reconnect next time
            return {"status": "unreachable", "detail": describe_error(exc)}
        return {"status": "healthy"}

    def list_containers(
        self,
        with_stats: bool = True,
        caddy_host: str | None = None,
        host_ip: str | None = None,
    ) -> list[dict]:
        client = self._get()
        instances = instances_store.list_instances()
        containers = client.containers.list(all=True)
        # Find Caddy in the list we already have — one API call for the whole request, not
        # a lookup per container. `caddy_host` is CADDY_ADMIN_URL's hostname; None when
        # Caddy is addressed by IP (it is off-box, so there is nothing here to match).
        caddy_nets = self._caddy_networks(containers, caddy_host)
        out: list[dict] = []
        for c in containers:
            attrs = c.attrs
            state = attrs.get("State", {})
            running = c.status == "running"
            labels = c.labels or {}
            upstream_mode = logic.upstream_mode(caddy_nets, logic.container_networks(attrs))
            service = labels.get("com.docker.compose.service")
            ports = (attrs.get("NetworkSettings") or {}).get("Ports")
            host_network = "host" in logic.container_networks(attrs)
            summary = {
                "id": c.id[:12],
                "name": c.name,
                "image": logic.image_name(attrs, c.image.tags if c.image else []),
                "status": c.status,
                "uptime": logic.uptime_seconds(state.get("StartedAt")) if running else None,
                "ports": logic.format_ports(attrs),
                "subdomain": logic.subdomain_for(c.name, instances),
                "instance_id": logic.linked_instance_id(c.name, instances),
                "scheme": logic.scheme_for(c.name, instances),
                # How Caddy has to dial *this* container, decided from the networks the
                # two actually share — not from a deployment-wide guess. See
                # logic.upstream_mode; the frontend uses it for the upstream hint copy.
                "upstream_mode": upstream_mode,
                "suggested_upstream": logic.suggested_upstream(
                    c.name, service, ports, upstream_mode, host_ip, labels, host_network
                ),
                # The half that is known even when the port is not — the form pre-fills
                # `<host>:` and leaves only the port to type.
                "suggested_host": logic.suggested_host(
                    c.name, service, ports, upstream_mode, host_ip, labels, host_network
                ),
                "cpu": None,
                "mem": None,
            }
            if with_stats and running:
                try:
                    stats = c.stats(stream=False)
                    summary["cpu"] = logic.compute_cpu_percent(stats)
                    summary["mem"] = logic.compute_memory(stats)
                except DOCKER_ERRORS as exc:
                    # Debug, not warning: a container exiting mid-poll trips this on a
                    # loop over every container, and the row still renders (cpu/mem null).
                    logger.debug("stats unavailable for %s: %s", c.name, exc)
            out.append(summary)
        return out

    @staticmethod
    def _caddy_networks(containers: list, caddy_host: str | None) -> set[str] | None:
        """Caddy's attached networks, or None when no container answers to `caddy_host`.

        None is the honest answer for layout A (Caddy on its own LXC) and for any hostname
        pointing off-box — logic.upstream_mode reads it as "not reachable by name".
        """
        if not caddy_host:
            return None
        for c in containers:
            service = (c.labels or {}).get("com.docker.compose.service")
            if logic.matches_hostname(caddy_host, c.name, service, c.attrs):
                return logic.container_networks(c.attrs)
        return None

    def container_names(self) -> set[str]:
        """Every container name present on the host (running or stopped). A name absent
        here means the container was removed — used to flag orphaned instances."""
        return {c.name for c in self._get().containers.list(all=True)}

    def start(self, container_id: str) -> None:
        self._get().containers.get(container_id).start()

    def stop(self, container_id: str) -> None:
        self._get().containers.get(container_id).stop()

    def restart(self, container_id: str) -> None:
        self._get().containers.get(container_id).restart()

    def remove(self, container_id: str) -> None:
        self._get().containers.get(container_id).remove(force=True)

    def stream_logs(self, container_id: str, tail: int = 200) -> Iterator[str]:
        container = self._get().containers.get(container_id)
        for chunk in container.logs(stream=True, follow=True, tail=tail):
            yield chunk.decode("utf-8", errors="replace")

    def compose_projects(self) -> dict[str, set[str]]:
        """Running compose project -> set of running service names, from the
        com.docker.compose.* labels. Used to compute each stack's up/down status."""
        result: dict[str, set[str]] = {}
        for c in self._get().containers.list():  # running only
            labels = c.labels or {}
            project = labels.get("com.docker.compose.project")
            service = labels.get("com.docker.compose.service")
            if project and service:
                result.setdefault(project, set()).add(service)
        return result

    def containers_in_project(self, project: str) -> list[dict]:
        """`[{"service", "name", "ports"}]` for one compose project, running or not.

        `compose_projects` answers "which services are up" for the stack list; this
        answers "what is this project's container actually called", which is what an
        installed recipe's instance has to link to (logic.primary_container).
        """
        containers = self._get().containers.list(
            all=True, filters={"label": f"com.docker.compose.project={project}"}
        )
        out: list[dict] = []
        for c in containers:
            service = (c.labels or {}).get("com.docker.compose.service")
            if not service:
                continue
            out.append({
                "service": service,
                "name": c.name,
                "ports": (c.attrs.get("NetworkSettings") or {}).get("Ports") or {},
            })
        return out

    def image_of(self, container_id: str) -> str:
        c = self._get().containers.get(container_id)
        return logic.image_name(c.attrs, c.image.tags if c.image else [])

    def host_stats(self) -> dict:
        client = self._get()
        info = client.info()
        try:
            df = client.df()
        except DOCKER_ERRORS:
            df = {}
        images = df.get("Images") or []
        volumes = df.get("Volumes") or []
        layers = sum(i.get("Size", 0) for i in images)
        return {
            "containers": info.get("Containers"),
            "containers_running": info.get("ContainersRunning"),
            "images": info.get("Images"),
            "ncpu": info.get("NCPU"),
            "mem_total": info.get("MemTotal"),
            "disk_images_bytes": layers,
            "disk_volumes_bytes": sum((v.get("UsageData") or {}).get("Size", 0) for v in volumes),
            "docker_version": info.get("ServerVersion"),
        }

    # --- Interactive exec (driven by the WebSocket handler in the router) ---

    def exec_create(self, container_id: str, cmd: list[str]) -> str:
        return self.api.exec_create(
            container_id, cmd, stdin=True, stdout=True, stderr=True, tty=True
        )["Id"]

    def exec_start(self, exec_id: str):
        # socket=True returns a raw, bidirectional socket for streaming.
        return self.api.exec_start(exec_id, socket=True, tty=True)

    def exec_resize(self, exec_id: str, rows: int, cols: int) -> None:
        self.api.exec_resize(exec_id, height=rows, width=cols)


docker_client = DockerClient()
