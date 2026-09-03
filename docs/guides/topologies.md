# Deployment topologies and port ownership

Loskai's three components — **AdGuard** (LAN DNS), **Caddy** (TLS + routing) and **Loskai**
itself — can be arranged across machines in several ways. This page is the reference for
choosing between them: what each layout costs in **port ownership**, which admin channels it
leaves exposed on the LAN, and which ones are shipping today.

For the env vars, volumes and cold start of whichever layout you pick, see
[deployment.md](deployment.md).

## Which one should I run?

Two layouts are recommended, and which one depends on what hardware you already have:

- **Running Proxmox? Use [A — split LXC](#a--split-lxc-composeyml).** AdGuard and Caddy each
  get their own container, giving the widest fault isolation and zero port contention. This is
  the layout the install guide walks through.
- **No Proxmox? Use [C — split DNS](#c--split-dns-adguard-separate-caddy--loskai-together).**
  AdGuard runs on any small always-on box — a Raspberry Pi is ideal, and so is an old
  mini-PC or NAS — while Caddy and Loskai run together in Docker on your main host. This is
  the friendliest setup to actually operate: the Pi does one job and never needs touching, and
  everything you *do* touch is one `docker compose` command away.

**[B — all-in-Docker](#b--all-in-docker-composecolocatedyml) is the supported alternative**,
and the right pick when a second box genuinely isn't an option: it needs no extra hardware,
ships today, and keeps Caddy's admin API off the LAN. Its caveats are real and worth reading
before you commit — AdGuard's `53` fights the host resolver, DNS shares a fault domain with
everything else on the Docker host, and `name:port` upstreams don't resolve for managed
stacks. If you can add one small always-on box, C removes the first two of those.

A fourth arrangement — merging all three components into a single container — was considered
and **rejected**; see [Considered and not supported](#considered-and-not-supported).

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

**A loopback or wildcard `CADDY_ADMIN_URL` cannot supply the answer IP.** `http://127.0.0.1:2019`
parses as an IP, so it would otherwise derive `127.0.0.1` as the DNS-rewrite answer and every
client would resolve the routed service to *its own* loopback; `0.0.0.0` is a bind wildcard and
names no host at all. Loskai refuses both from either source, so wherever Caddy is addressed
that way you must set `CADDY_HOST_IP` to the host's LAN IP — until you do, routed services get
no DNS rewrite and the Routing tab reports the answer IP as unconfigured.

## The comparison

| | A: split LXC | B: all-in-Docker | C: split DNS |
|---|---|---|---|
| **Verdict** | **recommended — with Proxmox** | supported alternative | **recommended — otherwise** |
| Status | shipping (`compose.yml`) | shipping (`compose.colocated.yml`) | planned |
| Boxes needed | 3 (2 LXCs + Docker host) | 1 | 2 (small DNS box + Docker host) |
| `53` | own box, clean | **fights `systemd-resolved`** | own box, clean |
| `80`/`443` | own box | Docker host | Docker host |
| `2019` | **LAN-exposed, needs a firewall rule** | internal | internal |
| `3000` | LAN-exposed | published for first-run | own box |
| `8080` | Docker host | Docker host | Docker host |
| stack ports | **every routed service must publish** | must publish | *can stay unpublished* |
| Restart blast radius | one component | one container | one container |

Two further arrangements are documented but **not supported** — all three as native services
on **one LXC**, and all three merged into **one container**. Both, and why neither is built,
are in [Considered and not supported](#considered-and-not-supported).

Three things follow from that table.

**Merging processes does not solve the port problem.** Collapsing the three components into
one container eliminates contention *between* them — but they never contended in the first
place. The only genuinely contested port is `53` against the host's resolver, and that is a
host-vs-container conflict. It survives the merge untouched. This is the core reason the
single-container arrangement was rejected rather than built.

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

> **The supported alternative.** Shipping today, and the layout to choose when one box is all
> you have. If you can add a second, C costs one small device and removes two of the three
> caveats below.

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
- **Cost:** one more physical device than B. That device can be very small, and it is the
  only thing C asks for that B doesn't.

That one device is the whole difference: on every other axis C dominates B — B's sole
advantage over A (internal `2019`) is one C also has, without B's `53` cost or its shared
DNS fault domain. Which is why B stays supported rather than recommended.

## Considered and not supported

Two arrangements come up often enough to be worth recording — with the reasoning for why
neither is built, so the question doesn't have to be re-litigated. Nothing in the repo ships
either one.

### Merging all three into one container

AdGuard, Caddy and Loskai under a supervisor in a single image. One network namespace, so
`2019`, `3000` and `8080` are all pure-loopback and never published — the strongest isolation
of the admin channels of anything here. **That is the whole of its advantage**, and it does
not outweigh:

- It does **not** fix the `53` conflict, which is the only port that actually bites — see
  [The comparison](#the-comparison).
- It reverses the fault-domain split deliberately: a Caddy misconfig or restart takes LAN
  DNS down with it, and no component can be updated without restarting the other two.
- Loskai holds the Docker socket (root-equivalent). In one container that puts DNS, TLS and
  root-equivalent host access in a single blast radius.
- The shipped image is single-process by design (`CMD` is `uvicorn`). This needs s6-overlay
  or similar, and that cost lands on the one image everyone else runs.

**Rejected 2026-09-02.** Packaging convenience is a real want, but **B** already answers "one
box, nothing else set up" while keeping the three components independently restartable. If
you want everything on one machine, run B.

### All-in-one LXC

AdGuard, Caddy and Loskai as three **native systemd services on a single Proxmox LXC** — no
Docker involved in running Loskai itself.

It is not in the comparison table because it isn't a peer of A–C: it has the merged
arrangement's shape (one box, one namespace) built with **A**'s mechanism (native services on
an LXC). On ports alone it is the best-behaved arrangement here:

- One network namespace, on a box dedicated to these three services — so `2019` and `3000`
  stay on loopback and never reach the LAN, and `53`, `80`, `443` and `8080` have nothing to
  compete with.
- **No `systemd-resolved` fight.** A stock Debian LXC doesn't run it, which is why neither
  [`create-adguard-lxc.sh`](../../scripts/create-adguard-lxc.sh) nor
  [`create-caddy-lxc.sh`](../../scripts/create-caddy-lxc.sh) has to free `:53`, while the
  Docker layouts both do.
- Caddy restarts don't touch a separate DNS box — but only because there isn't one. The
  fault domain is shared, exactly as in the merged container above.

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
supported** — nothing in the repo builds it. If you want everything on one box, prefer **B**,
which keeps the Docker socket local and ships today; if you want native LXC services, prefer **A**, where
Loskai sits on the Docker host where its socket is.

## Docker service names are not automatically resolvable

**Compose isolates every project.** Each stack gets its own `<project>_default` network, so a
containerised Caddy resolves the names in **its own** compose project and nowhere else — never
a stack Loskai manages, which is a separate project. A `name:port` upstream for such a
container does not resolve, and the route returns 502.

**Loskai now detects this per container** rather than guessing per deployment. It finds Caddy's
container from `CADDY_ADMIN_URL`'s hostname (matching the container name, the compose service
label, or a network alias) and compares its networks with the target's:

- **Sharing a network** → the upstream is pre-filled as `name:port`, which Docker's embedded
  DNS resolves.
- **Not sharing one** → `<host_ip>:<published_port>`, which works from anywhere.
- **Caddy not found here** — an IP `CADDY_ADMIN_URL`, or a hostname pointing off-box — is
  treated as "not reachable by name", so the published port is used. That is correct for
  layout A, where Caddy is on its own LXC.

`network_mode: host` never counts as shared: host networking has no embedded DNS, so a name
would not resolve there even though both sides report the same "network".

The practical consequence is that **routing a container without publishing a host port only
works if it shares a network with Caddy** — which is what layout C's `loskai-edge` network is
for. When a route still 502s, the decisive test is in
[troubleshooting.md](troubleshooting.md#502-bad-gateway) — `curl` the upstream from where Caddy
actually runs.
