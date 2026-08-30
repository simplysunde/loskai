# Deployment topologies and port ownership

Loskai's three components — **AdGuard** (LAN DNS), **Caddy** (TLS + routing) and **Loskai**
itself — can be arranged across machines in several ways. This page is the reference for
choosing between them: what each layout costs in **port ownership**, which admin channels it
leaves exposed on the LAN, and which ones are shipping today.

For the env vars, volumes and cold start of whichever layout you pick, see
[deployment.md](deployment.md).

## The framing: contention is only at the host-published layer

Container-to-container traffic and LXC-to-LXC traffic never compete for ports — each
namespace has its own full 65k range. A port is only *contested* when two things want to
publish it on the **same host**, or when a container wants a port the **host itself**
already owns.

So the question a topology actually answers is: how many services share one port namespace,
and which ports are *forced* to become LAN-visible?

### The ports in play

| Port | Owner | Must be reachable from the LAN? |
|---|---|---|
| `53` tcp+udp | AdGuard | **Yes** — every LAN client resolves against it |
| `80` | Caddy | **Yes** — certificate-onboarding page |
| `443` | Caddy | **Yes** — all routed traffic |
| `2019` | Caddy admin API | **No** — only Loskai ever calls it |
| `3000` | AdGuard UI/API | **No** — Loskai, plus first-run admin |
| `8080` | Loskai | **Yes** — the launcher, and cold-start access |
| varies | managed stack containers | Depends on the layout — see below |

`2019` is the one to watch: it is an unauthenticated, full-config-write channel into Caddy.
Any layout that keeps it off the wire removes a firewall rule you would otherwise have to
maintain by hand.

## The comparison

| Port | A: split LXC | B: all-in-Docker | C: split DNS | D: single container |
|---|---|---|---|---|
| `53` | own box, clean | **fights `systemd-resolved`** | own box, clean | **fights `systemd-resolved`** |
| `80`/`443` | own box | Docker host | Docker host | Docker host |
| `2019` | **LAN-exposed, needs a firewall rule** | internal | internal | internal |
| `3000` | LAN-exposed | published for first-run | own box | internal |
| `8080` | Docker host | Docker host | Docker host | Docker host |
| stack ports | **every routed service must publish** | must publish | *can stay unpublished* | must publish |
| Status | **shipping** (`compose.yml`) | **shipping** (`compose.colocated.yml`) | planned | planned |

Three things follow from that table.

**Merging processes does not solve the port problem.** Layout D eliminates contention
*between* the three components — but they never contended in the first place. The only
genuinely contested port is `53` against the host's resolver, and that is a host-vs-container
conflict. It survives the merge untouched.

**A's one real cost is `2019` on the LAN.** In split-LXC, Caddy's admin API is reachable
from the LAN and protected only by a firewall rule maintained outside the app. Every layout
where Caddy shares a host with Loskai keeps it off the wire entirely.

**C is the only layout where routing a service doesn't consume a host port.** With Caddy on
the Docker host it can share a Docker network with the containers it proxies, so an
unpublished container is still routable. In A, Caddy is off-box and can *only* dial
`host_ip:published_port`, which forces every routed service to publish one.

## The layouts

### A — Split LXC (`compose.yml`, preferred)

AdGuard and Caddy native on two separate LXCs; Loskai in Docker on the Docker host.

Three network namespaces, so **zero** port contention — each box has its own full range.
`CADDY_ADMIN_URL` is a LAN IP, so the DNS-rewrite answer IP derives from it automatically and
no `CADDY_HOST_IP` is needed.

The two LXCs are separate on purpose: AdGuard *is* the LAN's resolver, while Caddy is the
component Loskai reconfigures at runtime. Sharing a fault domain means a Caddy misconfig or
rebuild takes name resolution down LAN-wide.

- **Cost:** `2019` and `3000` sit on the LAN; firewall `2019` to the Loskai host.
- **Cost:** every routed container must publish a host port, crowding the Docker host's port
  namespace and ruling out internal-only services behind a route.
- **Widest fault isolation** of any layout. Recommended wherever Proxmox is available.

### B — All-in-Docker (`compose.colocated.yml`)

All three as containers on one host, for setups without Proxmox.

`CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so `CADDY_HOST_IP` **must** be set
explicitly — see [deployment.md](deployment.md#environment-variables).

- **Win:** `2019` never leaves the Docker network.
- **Cost:** AdGuard's `53` fights `systemd-resolved` on most Linux hosts (disable/reconfigure
  it, or bind AdGuard's `53` to a specific host IP). Caddy owns `80`/`443` on the host.
  AdGuard's `3000` is published for first-run setup, a common collision.
- **Caveat:** see [Docker service names are not automatically resolvable](#docker-service-names-are-not-automatically-resolvable)
  — B's `name:port` upstreams only work for containers in Caddy's own compose project.

### C — Split DNS: AdGuard separate, Caddy + Loskai together (planned)

AdGuard on its own box (LXC, VM or bare metal); Caddy and Loskai as containers on the Docker
host.

This keeps the property the two-LXC split was actually protecting — DNS in its own fault
domain — while collapsing the two components that talk to each other constantly onto one
host.

- **Win:** the `53` vs `systemd-resolved` fight leaves the Docker host entirely.
- **Win:** `2019` stays internal to the compose network. No firewall rule to get wrong.
- **Win:** the only layout where routing a service can *free* a host port instead of
  consuming one, because Caddy can reach unpublished containers over a shared network.
- **Cost:** Caddy's availability is now coupled to the Docker host — but not to DNS, which
  was the real concern behind the split.

Strictly better than B on every axis: B's sole advantage over A (internal `2019`) is one C
also has, without B's `53` cost.

### D — Single container: AdGuard + Caddy + Loskai in one image (planned)

One network namespace, so `2019`, `3000` and `8080` are all pure-loopback and never
published — the strongest isolation of the admin channels.

Support it as a **convenience tier** for a single-box trial, not as a recommendation:

- It does **not** fix the `53` conflict, which is the only port that actually bites.
- It reverses the fault-domain split deliberately: a Caddy misconfig or restart takes LAN
  DNS down with it.
- Loskai holds the Docker socket (root-equivalent). In one container that puts DNS, TLS and
  root-equivalent host access in a single blast radius.
- No independent upgrades — AdGuard cannot be updated without restarting Caddy and Loskai.
- The image is single-process today (`CMD` is `uvicorn`); this layout needs a supervisor.

**`CADDY_ADMIN_URL` must not be left to derive the answer IP here.** A loopback admin URL
(`http://127.0.0.1:2019`) parses as an IP, so the answer IP derives to `127.0.0.1` and every
AdGuard rewrite resolves the service to the *client's own* loopback. Set `CADDY_HOST_IP` to
the host's LAN IP explicitly.

## Docker service names are not automatically resolvable

Loskai pre-fills a route's upstream based on the detected topology: a LAN `IP:port` when
`CADDY_ADMIN_URL`'s host is an IP, a Docker `name:port` when it is a hostname.

That heuristic answers *"is Caddy addressed by IP?"* as a proxy for *"can Caddy resolve this
container's name?"* — and the two diverge whenever Caddy is a container sitting alongside
managed stacks:

- Docker Compose puts each project on its own `<project>_default` network.
- Caddy can therefore resolve only the containers in **its own** compose project.
- Every stack Loskai manages is a **separate** project, so `name:port` does not resolve for
  exactly the containers you are most likely to route.

Until this is fixed (see `TODO.md` Phase 16), in layouts B and C use the Docker host's LAN IP
plus the container's **published** host port, or attach Caddy and the target to a shared
Docker network yourself. The decisive test is in
[troubleshooting.md](troubleshooting.md#502-bad-gateway) — `curl` the upstream from where
Caddy actually runs.
