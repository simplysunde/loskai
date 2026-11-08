[Docs](../README.md) › [Guides](../README.md#guides)

# Deployment topologies and port ownership

**Read this when** you are unsure where AdGuard, Caddy and Loskai should run — **before**
installing.

Loskai's three components — **AdGuard** (LAN DNS), **Caddy** (TLS + routing) and **Loskai**
itself — can be arranged across machines in several ways. This page is the reference for
choosing between them: what each layout costs in **port ownership**, which admin channels it
leaves exposed on the LAN, and which ones are shipping today.

For the env vars, volumes and cold start of whichever layout you pick, see
[deployment.md](deployment.md).

## Which one should I run?

Two layouts are recommended, and which one depends on what hardware you already have:

- **Running Proxmox? Use [A — split LXC](#a--split-lxc-composeyml)**, the three-way split.
  AdGuard and Caddy each get their own container, giving the widest fault isolation and zero
  port contention. This is the layout the install guide walks through.
- **No Proxmox? Use [B — split DNS](#b--split-dns-adguard-separate-caddy--loskai-together)**,
  the two-way split. AdGuard runs on any small always-on box — a Raspberry Pi is ideal, and so
  is an old mini-PC or NAS — while Caddy and Loskai run together in Docker on your main host.
  This is the friendliest setup to actually operate: the Pi does one job and never needs
  touching, and everything you *do* touch is one `docker compose` command away.

**[C — all-in-Docker](#c--all-in-docker-composecolocatedyml) is the supported alternative**,
and the right pick when a second box genuinely isn't an option: it needs no extra hardware and
keeps Caddy's admin API off the LAN. But it is the one layout that asks for **extra
configuration before it will start** — AdGuard's `53` fights the host resolver and you have to
free that port by hand. Its other costs are real too: DNS shares a fault domain with everything
else on the Docker host, and a managed stack must publish a host port to be routable, since
Compose keeps it off Caddy's network. If you can add one small always-on box, B removes all
three.

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
no DNS rewrite: the Routing tab's Caddy row shows no address, and a new route warns that its
DNS rewrite was skipped.

## The comparison

| | A: split LXC | B: split DNS | C: all-in-Docker |
|---|---|---|---|
| **Verdict** | **recommended — with Proxmox** | **recommended — otherwise** | supported alternative |
| Status | shipping (`compose.yml`) | shipping (`compose.caddy-loskai.yml`) | shipping (`compose.colocated.yml`) |
| Boxes needed | 3 (2 LXCs + Docker host) | 2 (small DNS box + Docker host) | 1 |
| `53` | own box, clean | own box, clean | **fights `systemd-resolved`** |
| `80`/`443` | own box | Docker host | Docker host |
| `2019` | **LAN-exposed, needs a firewall rule** | internal | internal |
| `3000` | LAN-exposed | own box | published for first-run |
| `8080` | Docker host | Docker host | Docker host |
| stack ports | **every routed service must publish** | *can stay unpublished* | must publish |
| Restart blast radius | one component | one container | one container |

One further arrangement is documented but **not supported**: all three merged into **one
container**. Why it isn't built is in
[Considered and not supported](#considered-and-not-supported).

Three things follow from that table.

**Merging processes does not solve the port problem.** Collapsing the three components into
one container eliminates contention *between* them — but they never contended in the first
place. The only genuinely contested port is `53` against the host's resolver, and that is a
host-vs-container conflict. It survives the merge untouched. This is the core reason the
single-container arrangement was rejected rather than built.

**A's one real cost is `2019` on the LAN.** In split-LXC, Caddy's admin API is reachable
from the LAN and protected only by a firewall rule maintained outside the app. Every layout
where Caddy shares a host with Loskai keeps it off the wire entirely.

**B is the only layout where routing a service doesn't consume a host port.** With Caddy on
the Docker host it can share a Docker network with the containers it proxies, so an
unpublished container is still routable. In A, Caddy is off-box and can *only* dial
`host_ip:published_port`, which forces every routed service to publish one. C could do the
same, but ships without the shared network configured.

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

### B — Split DNS: AdGuard separate, Caddy + Loskai together

> **Recommended if you don't run Proxmox.** Shipping today as `compose.caddy-loskai.yml`;
> [install.md](install.md#no-proxmox-install-layout-b--split-dns) walks it through.

AdGuard on its own small always-on box — a Raspberry Pi is the natural fit, as is a mini-PC,
an old thin client, or a NAS that can run one container. Caddy and Loskai run as containers on
the Docker host.

This is the most user-friendly arrangement in practice, and the reason is operational rather
than architectural: the DNS box does exactly one job, gets configured once, and never needs to
be touched again — while everything you *do* iterate on lives behind a single
`docker compose pull && docker compose up -d` on the main host. It keeps the property the two-LXC split was
protecting (DNS in its own fault domain) without asking for a hypervisor.

- **Win:** the `53` vs `systemd-resolved` fight leaves the Docker host entirely, because
  AdGuard owns its box. Nothing has to be freed by hand before the stack starts.
- **Win:** `2019` stays internal to the compose network. No firewall rule to get wrong.
- **Win:** the only layout where routing a service can *free* a host port instead of
  consuming one, because Caddy can reach unpublished containers over the shared
  [`loskai-edge` network](#routing-a-container-without-publishing-a-port).
- **Cost:** Caddy's availability is coupled to the Docker host — but not to DNS, which was the
  real concern behind the split.
- **Cost:** one more physical device than C. That device can be very small, and it is the
  only thing B asks for that C doesn't.

`CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so `CADDY_HOST_IP` **must** be set
explicitly — see [deployment.md](deployment.md#environment-variables).

### C — All-in-Docker (`compose.colocated.yml`)

> **The supported alternative.** Shipping today, and the layout to choose when one box is all
> you have — at the cost of being the only one that needs host configuration before it will
> start.

All three as containers on one host.

`CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so `CADDY_HOST_IP` **must** be set
explicitly — see [deployment.md](deployment.md#environment-variables).

- **Win:** `2019` never leaves the Docker network.
- **Cost:** AdGuard's `53` fights `systemd-resolved` on most Linux hosts, and **this one is
  work you have to do before the stack comes up** — disable or reconfigure `systemd-resolved`,
  or bind AdGuard's `53` to a specific host IP. Caddy owns `80`/`443` on the host, and
  AdGuard's `3000` is published for first-run setup, a common collision.
- **Cost:** DNS shares a fault domain with everything else on the Docker host — the exact
  coupling the two-LXC split was introduced to avoid.
- **Caveat:** a `name:port` upstream works only for containers in Caddy's own compose
  project, so a managed stack must publish a host port unless you attach it to a shared
  network. Loskai detects which applies per container — see
  [Docker service names are not automatically resolvable](#docker-service-names-are-not-automatically-resolvable).

One device is the whole difference between C and B: on every other axis B dominates — C's sole
advantage over A (internal `2019`) is one B also has, without C's `53` cost or its shared DNS
fault domain. Which is why C stays supported rather than recommended.

## Considered and not supported

One arrangement comes up often enough to be worth recording — with the reasoning for why it
isn't built, so the question doesn't have to be re-litigated. Nothing in the repo ships it.

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

**Rejected 2026-09-02.** Packaging convenience is a real want, but **C** already answers "one
box, nothing else set up" while keeping the three components independently restartable. If
you want everything on one machine, run C.

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
works if it shares a network with Caddy** — which is what layout B's `loskai-edge` network is
for. When a route still 502s, the decisive test is in
[troubleshooting.md](troubleshooting.md#502-bad-gateway) — `curl` the upstream from where Caddy
actually runs.

## Routing a container without publishing a port

`compose.caddy-loskai.yml` declares a shared network called **`loskai-edge`** and attaches
Caddy to it. Any stack that joins the same network is reachable from Caddy by service name,
so it never has to publish a host port — the property that makes layout B the only one where
routing a service can free a port instead of consuming one.

Add two stanzas to the stack you want to route:

```yaml
services:
  grafana:
    image: grafana/grafana
    networks:
      - default # keep this — see below
      - loskai-edge
    # no `ports:` needed — Caddy reaches it over loskai-edge

networks:
  loskai-edge:
    external: true # created by the Loskai stack, not by this one
```

Then route it as usual from **Routing > Add route**; the upstream pre-fills as
`grafana:3000`.

Four things to know:

- **Keep `default` in the service's list.** Adding a `networks:` key opts the service out of
  the implicit attachment to its own project network — omit `default` and it loses its
  siblings (a database in the same stack stops resolving).
- **`external: true` means "already exists".** The network is created by the Loskai stack, so
  bring that up first; a stack declaring it external fails to start if it doesn't exist yet.
  `docker network create loskai-edge` also works if you'd rather create it by hand.
- **The port still has to be discoverable.** Loskai pre-fills the container port from its
  `loskai.port` label first, then a single published binding, then a single exposed one. A container that exposes several
  and publishes none leaves the upstream blank — type `name:port` yourself.
- **Nothing here is exclusive to layout B** — the mechanism is a shared Docker network, so it
  works in all-in-Docker too if you add the network to `compose.colocated.yml` and attach
  Caddy. B is where it ships configured.
