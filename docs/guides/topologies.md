# Deployment topologies and port ownership

Loskai's three components — **AdGuard** (LAN DNS), **Caddy** (TLS + routing) and **Loskai**
itself — can be arranged across machines in several ways. This page is the reference for
choosing between them: what each layout costs in **port ownership**, which admin channels it
leaves exposed on the LAN, and which ones are shipping today.

For the env vars, volumes and cold start of whichever layout you pick, see
[deployment.md](deployment.md).

## Which one should I run?

Two layouts are worth recommending, and which one depends on what hardware you already have:

- **Running Proxmox? Use [A — split LXC](#a--split-lxc-composeyml).** AdGuard and Caddy each
  get their own container, giving the widest fault isolation and zero port contention. This is
  the layout the install guide walks through.
- **No Proxmox? Use [C — split DNS](#c--split-dns-adguard-separate-caddy--loskai-together).**
  AdGuard runs on any small always-on box — a Raspberry Pi is ideal, and so is an old
  mini-PC or NAS — while Caddy and Loskai run together in Docker on your main host. This is
  the friendliest setup to actually operate: the Pi does one job and never needs touching, and
  everything you *do* touch is one `docker compose` command away.

The other two are supported but not recommended, and the table below shows why.
[B — all-in-Docker](#b--all-in-docker-composecolocatedyml) puts AdGuard on the Docker host,
where its `53` fights the host resolver, and gains nothing over C for the trouble.
[D — single container](#d--single-container-adguard--caddy--loskai-in-one-image) is a
packaging convenience that fixes no port conflict and gives up independent restarts.

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

| | A: split LXC | B: all-in-Docker | C: split DNS | D: single container |
|---|---|---|---|---|
| **Recommended** | **yes — with Proxmox** | no | **yes — the default otherwise** | no |
| Status | shipping (`compose.yml`) | shipping (`compose.colocated.yml`) | planned | planned |
| Boxes needed | 3 (2 LXCs + Docker host) | 1 | 2 (small DNS box + Docker host) | 1 |
| `53` | own box, clean | **fights `systemd-resolved`** | own box, clean | **fights `systemd-resolved`** |
| `80`/`443` | own box | Docker host | Docker host | Docker host |
| `2019` | **LAN-exposed, needs a firewall rule** | internal | internal | internal |
| `3000` | LAN-exposed | published for first-run | own box | internal |
| `8080` | Docker host | Docker host | Docker host | Docker host |
| stack ports | **every routed service must publish** | must publish | *can stay unpublished* | must publish |
| Restart blast radius | one component | one container | one container | **all three** |

A fifth arrangement — all three as native services on **one LXC** — is a variant rather than a
peer of these four; see [A variant: all-in-one LXC](#a-variant-all-in-one-lxc).

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

### A — Split LXC (`compose.yml`)

> **Recommended if you run Proxmox.** Shipping today; this is what
> [install.md](install.md) walks through.

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
- **Widest fault isolation** of any layout, and the cheapest to add boxes to — an LXC costs
  nothing but disk.

### B — All-in-Docker (`compose.colocated.yml`)

> **Supported, but not recommended.** Shipping today. Prefer C: it costs one small extra box
> and removes this layout's only real problem.

All three as containers on one host.

`CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so `CADDY_HOST_IP` **must** be set
explicitly — see [deployment.md](deployment.md#environment-variables).

- **Win:** `2019` never leaves the Docker network.
- **Cost:** AdGuard's `53` fights `systemd-resolved` on most Linux hosts (disable/reconfigure
  it, or bind AdGuard's `53` to a specific host IP). Caddy owns `80`/`443` on the host.
  AdGuard's `3000` is published for first-run setup, a common collision.
- **Cost:** DNS shares a fault domain with everything else on the Docker host — the exact
  coupling the two-LXC split was introduced to avoid.
- **Caveat:** see [Docker service names are not automatically resolvable](#docker-service-names-are-not-automatically-resolvable)
  — `name:port` upstreams only work for containers in Caddy's own compose project.

### C — Split DNS: AdGuard separate, Caddy + Loskai together

> **Recommended if you don't run Proxmox.** Planned — see `TODO.md` Phase 16.

AdGuard on its own small always-on box — a Raspberry Pi is the natural fit, as is a mini-PC,
an old thin client, or a NAS that can run one container. Caddy and Loskai run as containers on
the Docker host.

This is the most user-friendly arrangement in practice, and the reason is operational rather
than architectural: the DNS box does exactly one job, gets configured once, and never needs to
be touched again — while everything you *do* iterate on lives behind a single
`docker compose up -d --build` on the main host. It keeps the property the two-LXC split was
protecting (DNS in its own fault domain) without asking for a hypervisor.

- **Win:** the `53` vs `systemd-resolved` fight leaves the Docker host entirely, because
  AdGuard owns its box.
- **Win:** `2019` stays internal to the compose network. No firewall rule to get wrong.
- **Win:** the only layout where routing a service can *free* a host port instead of
  consuming one, because Caddy can reach unpublished containers over a shared network.
- **Cost:** Caddy's availability is coupled to the Docker host — but not to DNS, which was the
  real concern behind the split.
- **Cost:** one more physical device than B or D. That device can be very small.

Strictly better than B on every axis: B's sole advantage over A (internal `2019`) is one C
also has, without B's `53` cost.

### D — Single container: AdGuard + Caddy + Loskai in one image

> **Supported, but not recommended.** Planned — see `TODO.md` Phase 16. Reach for it to try
> Loskai on one box with nothing else set up, not to run it long-term.

One network namespace, so `2019`, `3000` and `8080` are all pure-loopback and never
published — the strongest isolation of the admin channels. That is the whole of its
advantage, and it does not outweigh:

- It does **not** fix the `53` conflict, which is the only port that actually bites.
- It reverses the fault-domain split deliberately: a Caddy misconfig or restart takes LAN
  DNS down with it, and no component can be updated without restarting the other two.
- Loskai holds the Docker socket (root-equivalent). In one container that puts DNS, TLS and
  root-equivalent host access in a single blast radius.
- The image is single-process today (`CMD` is `uvicorn`); this layout needs a supervisor.

**`CADDY_ADMIN_URL` must not be left to derive the answer IP here.** A loopback admin URL
(`http://127.0.0.1:2019`) parses as an IP, so the answer IP derives to `127.0.0.1` and every
AdGuard rewrite resolves the service to the *client's own* loopback. Set `CADDY_HOST_IP` to
the host's LAN IP explicitly.

## A variant: all-in-one LXC

AdGuard, Caddy and Loskai as three **native systemd services on a single Proxmox LXC** — no
Docker involved in running Loskai itself.

It is not in the comparison table because it isn't a peer of A–D: it has **D**'s shape (one
box, one namespace) built with **A**'s mechanism (native services on an LXC). On ports alone
it is the best-behaved arrangement here:

- One network namespace, on a box dedicated to these three services — so `2019` and `3000`
  stay on loopback and never reach the LAN, and `53`, `80`, `443` and `8080` have nothing to
  compete with.
- **No `systemd-resolved` fight.** A stock Debian LXC doesn't run it, which is why neither
  [`create-adguard-lxc.sh`](../../scripts/create-adguard-lxc.sh) nor
  [`create-caddy-lxc.sh`](../../scripts/create-caddy-lxc.sh) has to free `:53`, while the
  Docker layouts both do.
- Caddy restarts don't touch a separate DNS box — but only because there isn't one. The
  fault domain is shared, exactly as in D.

**The catch is the Docker module, and it is decisive.** Loskai's Docker client calls
`docker.from_env()` (`modules/docker/client.py:34`), which defaults to the local
`/var/run/docker.sock`. On its own LXC, Loskai is not on the Docker host, so the Docker tab,
the Stack Manager and the install wizard have no daemon to reach. Making them work means:

- `DOCKER_HOST=tcp://<docker-host>:2375` — publishing a **root-equivalent, unauthenticated**
  Docker API onto the LAN. The TLS port (`2376`) needs client certificates, and Loskai has no
  setting for them.
- `STACKS_DIR` present at an **identical path on both machines**, because `docker compose`
  hands bind paths to the daemon that executes them — which would now be a *remote* daemon
  resolving against a different filesystem. See
  [deployment.md](deployment.md#stacks_dir--why-the-same-path-on-both-sides).

So this variant runs the routing half of Loskai (Caddy + AdGuard + assign) perfectly well and
gives up the Docker half, unless you accept exposing the Docker API. **It is documented, not
supported** — nothing in the repo builds it. If you want everything on one box, prefer **D**,
which keeps the Docker socket local; if you want native LXC services, prefer **A**, where
Loskai sits on the Docker host where its socket is.

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
