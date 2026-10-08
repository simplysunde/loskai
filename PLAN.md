# Loskai — Project Plan

## Vision

A single Docker container that acts as the control plane for your entire homelab.

> **Loskai** — from Norwegian *los* (the harbor pilot who steers ships safely to berth)
> and *kai* (quay/dock, where containers are loaded).
> *Safe passage for your Docker deployments.*
It has four independent modules — Docker, Caddy, AdGuard, and WireGuard — each of
which works on its own. You can use just the Docker manager without touching AdGuard.
You can manage Caddy routes without the Docker manager open. Nothing depends on
another module being healthy to function.

### The core idea — name any service on your LAN

Loskai + Caddy + AdGuard together let you assign a clean, memorable HTTPS name
to **any service on your network** — not just Docker containers.

```
Browser
  │  types https://grafana.yourdomain
  ▼
AdGuard (DNS)
  │  resolves yourdomain → your server IP
  ▼
Caddy (reverse proxy)
  │  matches grafana.yourdomain → routes to the right service
  ▼
Your service (any IP:port on the LAN)
```

Any service on your LAN gets a clean HTTPS name. You configure it in one place —
the Routing tab's **Add route** picker — and it sets up both the Caddy route and the
AdGuard DNS rewrite in a single action.

---

## Infrastructure (What Already Exists / Will Exist)

```
Proxmox Host
│
├── LXC — AdGuard Home (DNS)          ← Network Services
│   Ports: :53 (DNS), :3000 (web UI + REST API)
│
├── LXC — Caddy (reverse proxy)       ← Network Services
│   Ports: :80/:443 (HTTP/HTTPS), :2019 (Admin API — firewalled to the Docker host only)
│
├── LXC — WireGuard
│   Runs: WireGuard + wg-easy or wg-dashboard
│   Ports: :51820/udp (WireGuard), :51821 (dashboard)
│
└── LXC (or VM) — Docker Host
    Runs: Docker Engine
    └── loskai      ← the thing we are building
    └── your app containers  ← grafana, nextcloud, etc.
```

AdGuard and Caddy are **separate LXCs** (not one box): rebuilding or restarting Caddy — the
component Loskai constantly reconfigures — must never take LAN DNS down with it. The
provisioning scripts (`scripts/create-adguard-lxc.sh`, `scripts/create-caddy-lxc.sh`)
auto-pick the container ID and come up on DHCP; you assign static leases afterwards. The IPs
shown elsewhere in this doc are illustrative examples.

---

## Application Overview

The Loskai is one Docker image that serves a web UI.
Internally it is split into four modules. Each module has:

- Its own backend service class (isolated API client)
- Its own frontend section/page
- Its own health check
- Graceful degradation if the external service is unreachable

```
┌──────────────────────────────────────────────────────────────────┐
│                             Loskai                             │
│                      (single Docker image)                       │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐      │
│  │    MODULE 1    │  │    MODULE 2    │  │    MODULE 3    │      │
│  │    Docker      │  │     Caddy      │  │   AdGuard      │      │
│  │    Manager     │  │    Routing     │  │     DNS        │      │
│  └────────────────┘  └────────────────┘  └────────────────┘      │
│                                                                  │
│  ┌────────────────┐                                              │
│  │    MODULE 4    │                                              │
│  │   WireGuard    │                                              │
│  │   (lightweight)│                                              │
│  └────────────────┘                                              │
│                                                                  │
│  Each module:                                                    │
│  ✓ Works independently                                           │
│  ✓ Shows degraded state if service unreachable                   │
│  ✓ Never blocks other modules from loading                       │
└──────────────────────────────────────────────────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
  Docker Socket       Caddy :2019      AdGuard :3000
  (same host)       (Caddy LXC LAN)  (AdGuard LXC LAN)
```

---

## Core Data Model — Instances

Loskai's one persistent domain object is the **instance**: a named service it knows
about. A Docker container and an external LAN service are just two `type`s of the same
structure, so they live in a single list that the Docker Manager and the Caddy routing
view both read.

```jsonc
{
  "id":        "grafana",        // stable slug — also the Caddy @id
  "name":      "Grafana",        // display name
  "type":      "docker",         // "docker" | "external"
  "kind":      "service",        // "service" (published at a URL) | "machine" (an address other
                                 //   routes point at). Set from the verb used to assign it;
                                 //   back-filled from the upstream's shape for records written
                                 //   before the field, so there is no migration step
  "subdomain": "grafana",        // route prefix (null = tracked, no route assigned)
  "route_mode": "proxy",         // "proxy" (default, Caddy+AdGuard) | "dns_only" (AdGuard only —
                                 //   see "DNS-only routing" below)
  "upstream":  "192.168.10.100:3000",  // host:port (proxy) or a bare IP (dns_only) — chosen at assign time
  "upstream_tls": false,         // true = dial the upstream over HTTPS, cert unverified (e.g. Proxmox)
  "scheme":    "https",          // "https" (default) | "both" | "http" — which port(s) Caddy serves
                                 //   this on. For clients that cannot hold a custom root CA; "http"
                                 //   is kept out of the :443 server so no cert is ever issued for it
  "machine":   null,             // id of the machine instance owning this upstream's HOST half —
                                 //   a dependency, not an idempotency key. Moving that machine
                                 //   rewrites this upstream and re-pushes the route
  "icon":      null,             // launcher icon filename in <data_dir>/icons; served publicly at
                                 //   /api/instances/<id>/icon (the Dashboard is unauthenticated)
  "container": "grafana",        // container name/id — links a docker instance to live data
  "origin":    null,             // "adguard"|"gateway"|"caddy" — links an external instance to a
                                 //   built-in Network service; null for a plain LAN target
  "dns_answer": "192.168.10.101", // Caddy IP last written to AdGuard for this name
                                 //   (null = no rewrite pushed; used to clean up on IP change)
  "private":   false             // true = hide from the public dashboard (still fully managed)
}
```

- **Docker instance** — backed by a real container; `container` links it to live data.
- **External instance** — Proxmox, a NAS, any `IP:port`, or a built-in Network service.
  No `container`, just an `upstream`; a Network service also carries an `origin` marker so
  its panel can recognise its own route.
- **`container` and `origin` are the idempotency keys** — re-routing the same container or
  Network service edits its existing instance instead of creating a duplicate (mirrors of
  each other: `get_by_container` / `get_by_origin`).
- An instance may exist **without** a subdomain (tracked but not exposed). A *route* is
  exactly an instance that *has* a subdomain; the routing view lists **all** instances
  (routed or not) and lets you assign/clear routes per row.
- **Deletion is uniform.** Clearing a route (unassign) keeps the instance; deleting
  (`DELETE /api/instances/{id}` → route + rewrite + record) removes it. Any type can be
  deleted — a deleted **docker** instance leaves the container untouched (it becomes an
  unrouted container, re-routable from the Add route picker). Since containers no longer
  auto-create instances, the record won't silently reappear.

**What is stored vs. live:**
- The instance list holds only **intent** — subdomain, upstream, and external targets.
  It is a flat JSON file, `/data/instances.json`, in the state volume
  (same pattern as `settings.json`; no database).
- **Runtime state** (container status, CPU, RAM, ports) is never stored — it is read
  live from the Docker socket and **joined in at display time** via `container`. This
  keeps the store from ever drifting out of sync with reality.

**How routes are created — one surface.** All route creation happens in the **Add route**
picker — opened on the Routing tab, or from a machine's row on the Machines tab preset to
that machine; it is the same component either way (the Docker tab only *displays* routed
state). The picker chooses a source, which pre-fills the subdomain + upstream:
- **External** — a LAN target by address. The upstream is entered as **host + port on one
  row** (both route forms share this). The host is **Machine or Address** (Phase 30):
  Machine selects one of the **machines** already named (instances declared
  `kind: "machine"`), so a proxy route borrows a machine's address and only needs its port;
  Address is a combobox — type any address, or pick the Docker host or a picked container's
  own host. The machine list is deliberately *not* filtered by whether a machine is routed —
  unlike the two sources below, you are reusing an address, not routing the thing itself.
  The picked machine fills the host only, never the prefix or the port: the route is a service *on*
  that machine, and prefilling its name would collide with the name it already answers to.
  Picking one also **links** the route to it (`machine` on the instance — a dependency, not
  an idempotency key like `container`/`origin`): the machine's address is then entered in
  exactly one place. Moving it rewrites every dependent's upstream host and re-pushes those
  routes in the same assign; deleting it unlinks them instead of refusing, since they keep a
  working address and nothing here is unrecoverable. Machines are named on their own
  **Machines** tab (Phase 30), each listed with the routes hosted on it — a second *verb*
  with its own form, not a second route-creation surface.
- **Container** — an *unrouted* Docker container → a `docker` instance linked by `container`,
  pre-filled with a suggested subdomain (the linked instance's id — a recipe's own name — else
  the container name) **and a reachable upstream** — `<service>:<port>` from the Docker socket
  when Caddy shares the network, `<host_ip>:<published port>` otherwise. When the port can't be
  determined the host half still is, and the form fills `<host>:`. A `loskai.port` label names
  the port Docker can't see (host networking) or can't choose (several published).
  **By default the route then follows its container** (`follow_container` — Phase 29): the
  upstream is derived from the live container, not typed, and when the container starts on a
  different port — re-upped from the Stack Manager or over SSH — the route is rewritten and
  re-pushed. It is the container counterpart of the `machine` link, triggered by Docker's event
  stream (`shared/follow.py`, Loskai's only background task), with a catch-up at startup for
  changes made while Loskai was down. "Set by hand" turns it off for one route.
- **Network service** — a built-in service (AdGuard / WireGuard / Caddy cert page) → an `external`
  instance carrying an `origin` marker, pre-filled from the service's configured URL.
- **External** — any bare `IP:port` LAN target (Proxmox, a NAS) → a plain `external` instance.

Routed containers/services **drop out of the picker** (they're managed as rows). Re-routing a
container or service is **idempotent** — it edits that instance via `container`/`origin`, never
a duplicate; a *second* route to one service is a separate `external` instance. Editing an
existing route is per-row ("Change URL"). Everything writes to the same list, from which Caddy
routes are pushed. Loskai and AdGuard are ordinary instances with no
reserved status — the subdomain-uniqueness rule prevents collisions.

### DNS-only routing — decoupling AdGuard from Caddy

Not every named thing on the LAN is an HTTP(S) service. Giving a raw machine or VM a clean
hostname (`vm1.example.no` for SSH, RDP, or some arbitrary port) doesn't need a reverse
proxy — Caddy's `reverse_proxy` is HTTP(S)-shaped (one hostname → one backend port), while
host-level naming is protocol-agnostic. Rather than build a second, parallel surface for
this (a dedicated tab, or just pointing people at AdGuard's own UI), it is a second
**`route_mode`** on the same instance: `"proxy"` (default) is everything above; `"dns_only"`
skips Caddy entirely.

- **No Caddy route is pushed or expected** for a `dns_only` instance — `push_all`,
  `list_with_sync`'s synced column, and the routing table's Route column all
  treat it as not-applicable, not "missing."
- **`upstream` *is* the AdGuard answer.** A `dns_only` instance's `upstream` is a bare IPv4
  address (not `host:port` — there's no dial, no port to speak of), and that address is
  exactly what AdGuard resolves the name to. No separate answer-IP field is needed.
- **No single-label constraint.** The single-DNS-label rule on `proxy` subdomains exists
  only to keep every name under the one `*.BASE_DOMAIN` wildcard cert — irrelevant with no
  TLS/Caddy involved, so `dns_only` prefixes may be dot-separated (`rack1.vm3`).
- **The orphan sweep is widened accordingly**: it matches a leftover rewrite against either
  the shared Caddy IP or any currently-routed instance's own `dns_answer`, so `dns_only`
  leftovers get cleaned up the same way proxy ones do. This is a deliberate, slightly wider
  blast radius than the old single-IP-only sweep — see [docs/reference/adguard-api.md](docs/reference/adguard-api.md).
- **v1 scope**: the Routing UI only offers the dns_only toggle for `external`-type
  instances (a container's own IP is rarely the point — this is a frontend-only
  restriction, not a backend one) and only accepts bare IPv4 (no IPv6 yet).

### How the instance list connects the modules

The instance list is the shared spine the modules read from and write to. It is local
state (a JSON file), always available — so touching it never introduces a cross-module
runtime dependency. The graceful-degradation guarantees (each module still works when an
*external* service is down) are unchanged.

| Module | Relationship to the instance list |
|---|---|
| **Docker Manager** | Surfaces each container as a `docker` instance (live data joined via `container`); a routed container shows its FQDN inline. Routing itself is created in the Routing tab, not here |
| **Caddy Routing** | The route-creation surface (the **Add route** picker; AdGuard's pill has a one-click shortcut to the same request). Reads instances that have a `subdomain` and pushes them as routes; owns that projection. External instances need no container at all |
| **AdGuard DNS** | For each instance-with-subdomain, best-effort creates the matching DNS rewrite; reads rewrites back from AdGuard to show which instances are in sync |
| **WireGuard** | None — a standalone status card, not part of the instance model |

```
                       ┌───────────────────────┐
                       │     instances.json    │   ← the shared spine
                       │(id, type, subdomain,  │
                       │upstream, container, …)│
                       └───────────┬───────────┘
              writes /             │            reads (subdomain set)
              joins live           │                    │
        ┌─────────────────┐        │        ┌───────────┴───────────┐
        │  Docker Manager │────────┘        │     Caddy Routing     │──► push routes
        │  (containers)   │                 │  (route = projection) │
        └─────────────────┘                 └───────────┬───────────┘
                                                         │ best-effort
                                                         ▼
                                              ┌────────────────────┐
                                              │    AdGuard DNS     │──► rewrite per name
                                              └────────────────────┘
        WireGuard: standalone status card — does not touch instances
```

---

## Module 1 — Docker Manager

### Purpose
Two distinct functions: manage running containers on the Docker host, and provide
a personal install wizard for spinning up new services using your own curated,
tested recipes. This module works entirely via the Docker socket and has zero
dependency on Caddy, AdGuard, or WireGuard.

Each container surfaces as a `docker` **instance** (see
[Core Data Model](#core-data-model--instances)): the live container data is joined to
its instance record by `container`, so a routed container's FQDN shows inline (as a link).
Routing a container is done from the Routing tab's **Add route** picker (Container source),
not here — this module is container management only.

### Features

**Container Overview**
- Live list of all containers — name, image, status, uptime, CPU%, RAM usage
- Start / stop / restart per container
- Remove container (with confirmation)
- View live logs (streaming, last N lines)
- View container environment variables (read-only)
- Routed URL shown inline (as an `https://<sub>.<domain>` link) when the container is routed —
  joined from its instance `subdomain`. Routing is created in the Routing tab's **Add route**
  picker (Container source), which lists unrouted containers

**Stack Manager**

A browser front-end over `docker compose` — the same thing as SSH-ing in and running
compose by hand, minus the SSH. It runs the real `docker compose` CLI against the host
daemon; it invents no new deployment method.

- **One directory, one variable.** Loskai watches exactly one directory, `STACKS_DIR`
  (default `./stacks`, beside the compose file). Every immediate subdirectory with a
  `compose.yml` is a stack.
  There is no separate "manual" vs "managed" location — a stack is *managed* purely by
  virtue of living in `STACKS_DIR`.
- **The filesystem is the only source of truth.** Loskai keeps no database of stacks.
  Editing a file in the browser and editing it over SSH touch the same file — the two are
  fully interchangeable, and Loskai never locks or "owns" a stack. SSH stays a
  first-class equal, never a hidden lock-in.
- View all stacks with current status (up / down / partial), computed by matching the
  `com.docker.compose.project` label on running containers against the declared services.
- Stack-level start / stop / restart / pull-and-update (`docker compose pull` + `up -d`)
- Create a stack manually — the **raw path**, freeform counterpart to the recipe wizard:
  paste/upload a finished `compose.yml` + `.env` and run `up`, no manifest and no wizard
  prompts. For a one-off or a stack you already have. Bind-mount source directories are
  auto-created by Docker on `up`, so no directory step is needed
- Edit `compose.yml` and `.env` in-browser, then re-`up` to apply
- Delete a stack — `down`, then remove `compose.yml` and `.env`. **The rest of the folder is
  kept unless you tick "Also delete its data"**: recipes keep a service's data beside its
  compose file (`./data`), so removing the folder would take the database with it. A kept
  folder is no longer a stack (no compose file); creating or installing the same name again
  takes it over, data and all

> **Same-path mount (important).** `STACKS_DIR` must be bind-mounted at the **same path**
> inside the container as on the host (`${STACKS_DIR}:${STACKS_DIR}`), not remapped to a
> different path. Loskai's compose CLI resolves bind-mount paths and hands them to the
> host daemon, so the in-container path must equal the host path or volumes get created in
> the wrong place. See the compose file below.
>
> The consequence of that rule is the default: `${PWD}/stacks`, because Compose exposes no
> interpolation variable for the project directory. **Compose must therefore be run from
> the project directory** — `scripts/deploy.sh` `cd`s there. Invoked elsewhere, stacks
> point at `<cwd>/stacks` and the Stack Manager shows an empty list rather than an error,
> since Docker creates the directory. Setting `STACKS_DIR` to an absolute path pins it.
> This affects `STACKS_DIR` only: `./data` is resolved against the project directory by
> Compose, so state is correct from anywhere.

**Personal Install Wizard**
- A curated set of personal install recipes — not a generic community template store.
  These are your own tested setups for services you actually run.
- **Recipes are never baked into the image** — they come from two kinds of source, scanned
  the same way and merged into one list:
  - **Git repos you own** — as many as you like (`recipes_repos`, managed in Settings >
    General). Loskai syncs each (a plain `git clone`/`pull` — public, so no auth) into its
    own cache in the state volume. Adding or fixing a service is a push to a repo, no Loskai
    rebuild. If a repo is unreachable, its last-synced cache still renders and the other
    sources are unaffected — each reports separately. Sync is explicit: a "Refresh recipes"
    action, or one row's own sync; no background polling.
  - **A local directory** in the state volume (`/data/recipes/`) — recipes added by hand,
    for private or in-progress manifests, always available with no network. No new mount: it
    lives in the same `./data` volume as `settings.json`, so a folder dropped into
    `data/recipes/` on the host is picked up with no container access.
  - **Every source is a row with a toggle; one built-in default is seeded** so a fresh
    install has somewhere to sync from, and it is switchable-off and removable like any
    other row. The local directory is not a row — it is always scanned, has no URL, and
    cannot be disabled. Which is why a stored *empty* list is a real value: deleting every
    git source has to persist rather than re-seed the default.
  - **Priority is list order, local last.** The first source to define a recipe id wins; a
    later copy is **flagged** (naming both the copy that lost and the source that beat it)
    so it is never silently hidden. To test a variant of an existing recipe locally, give
    it a distinct name so it does not collide.
  - **No env var.** Sources are the one configurable value with no environment layer
    (`STORED_ONLY_KEYS`): the editor covers everything a variable could say, and nothing
    about recipe sources is needed before the UI is reachable — which is the test for
    belonging in the env layer at all. So the panel is never read-only.
- **A recipe is declarative data, never executable code.** Loskai validates each recipe
  against a fixed schema and drives it with its own engine — it never runs recipe-supplied
  code. A malformed recipe fails validation and is skipped; it can't push Loskai outside
  its three known install paths.
- The `recipe.yml` schema is documented in [docs/reference/recipe-schema.md](docs/reference/recipe-schema.md) —
  the contract to author against (by hand or with an AI coder); there is no authoring UI.
- **One folder per recipe** (same shape in either source):
  - `recipe.yml` — the manifest: `type`, display name, the `.env` question schema (`env:` —
    each entry has `key`, `label`, `default`, optional `secret` flag), the `directories` to
    create, a `suggested_subdomain`, plus any type-specific field (e.g. `git_repo` for
    `git_build`).
  - `compose.yml` — a real, standalone compose file using native `${VAR}` interpolation.
    Directly `docker compose up`-testable and SSH-editable — **not** embedded in the manifest
    (it is itself YAML; keeping it a separate file preserves tooling and the SSH-equal rule).
  - `instructions.md` — the guided walk-through text shown in the wizard.
- **The `.env` is generated, never stored in the repo.** It carries per-install values and
  secrets (passwords), so it is written into the stack directory at install time from your
  wizard answers — never committed. `docker compose` then substitutes `${VAR}` from it
  automatically, so there is no templating engine and the compose file stays a genuine
  compose file. (The only substitution Loskai does itself is the `directories` paths, since
  it runs the `mkdir` before compose does.)
- Wizard steps per recipe:
  1. Show what will be created (stack directory, compose, declared directories, the env
     vars it will ask for, which source it came from) plus the recipe's `instructions.md`
  2. Fill in required values (data path, passwords, ports — with the recipe's defaults),
     the form rendered from the manifest's `env:` schema
  3. **Route it, from the last step** (Phase 30 — until then, deliberately no assign step:
     a second surface that creates routes is what the Add route consolidation removed). The
     risks that consolidation guarded against are met another way: the step posts the same
     `/api/routes` with `container`, the idempotency key, so it edits the install's own
     record rather than making a second; it pre-fills through `containerPrefill`, the one
     helper every route form uses; and it asks only for the prefix (the manifest's
     `suggested_subdomain`), following the container. Anything more particular — a scheme,
     a machine, a port Docker can't name — sends you to the Routing tab
  4. Confirm → creates the directories, writes `compose.yml` + the generated `.env`, runs the
     `type`'s install command, and registers the service as a `docker` instance — linked to
     the container name the daemon actually created (`<project>-<service>-1`, read back from
     the compose project label; the manifest's optional `service:` picks the published one
     of a multi-service recipe). A failed `up`, or a container that can't be identified,
     registers **no** instance and says so: a guessed link would sit in the list as a
     second, dead record beside the one the Routing tab creates correctly

**Recipe types — the manifest's `type:` field, three patterns supported:**

1. **Pull** — standard pre-built public image, just `docker compose up -d`
   - Used for: Grafana, Jellyfin, Nextcloud, Vaultwarden, Gitea, Uptime Kuma, etc.

2. **Git + build** — clones a repo then builds the image locally
   - Recipe specifies a `git_repo` URL, runs `git clone` then `docker compose up -d --build`
   - Used for: services that require source customisation or have no pre-built image

3. **Private registry pull** — pulls from your self-hosted Gitea container registry
   - Image is already built and pushed to Gitea (`gitea.yourdomain/user/app:latest`)
   - Recipe pulls like any other image — no build step at install time
   - Recommended pattern for your own personal apps: build once, push to Gitea, deploy anywhere
   - **Registry auth is a host precondition**: run `docker login <gitea-registry>` once on
     the Docker host and the daemon caches it, so the pull is identical to a public one.
     Loskai stores no registry credential — same principle as the ACME token living with
     Caddy, not here

**Interactive Terminal**
- Open a shell session inside any running container directly in the browser
- Uses WebSocket for bidirectional streaming + xterm.js for terminal rendering
- Equivalent to `docker exec -it <container> /bin/sh`
- Falls back to `/bin/bash` if available, otherwise `/bin/sh`
- **Quick commands** — clickable buttons above the terminal that send preset commands,
  lowering the barrier for beginners who don't know what to type
  - Generic (every container): view logs, list processes, show env vars, disk usage, list files
  - Image-specific (detected from image name):
    - `redis` → "Redis CLI" (`redis-cli`)
    - `postgres` → "psql" (`psql -U postgres`)
    - `mariadb` / `mysql` → "MySQL shell" (`mysql -u root -p`)
    - `nginx` → "Test config" (`nginx -t`), "Reload" (`nginx -s reload`)
  - Clicking a button sends the command into the terminal — full terminal still available for anything else

**Monitoring**
- Per-container CPU + RAM graph (last 1h)
- Aggregate host stats: total CPU, RAM, disk usage
- Container event log: started, stopped, crashed, restarted

### Scope — what it can and can't do

One view of the host, organised by stack (Phase 30 — before it, two tabs):
- **Containers** — *every* container (live, from the socket), nested under the stack that
  started it by its `com.docker.compose.project` label. A stack in `STACKS_DIR` (editable
  files) carries its status, route links and actions on its header row (start and stop are
  one toggle); below the stacks, under **Other containers**, a compose project from
  elsewhere is listed but not managed — its header gets the same toggle, as plain docker
  start/stop on each container (there is no compose file here to `up`), a **?** naming the
  folder it was started from (`compose_dir`), and Remove, which removes its containers and
  leaves its files — and a bare `docker run` container sits under **Standalone** (nothing to
  edit — it has no compose file), each with its controls on its own row. Runtime control + logs +
  terminal per container. **Loskai's own container is shown apart, with logs only** — no
  stop or remove for the container serving the page (marked `self` by the backend).
- **Volumes** — named volumes, read-only: size, stack, and which containers mount each, so
  one nothing uses is visible. Bind mounts (the recipes' `./data`) are folders, not volumes.

| ✅ Can do | ❌ Can't do (by design) |
|---|---|
| List all running containers with live stats | Manage containers on **other hosts** (single host, for now) |
| Start / stop / restart / remove any container | Edit config of a container with **no compose file** |
| Stream logs, open a browser terminal, quick commands | Be a full Portainer (no network / image management; volumes are listed, never removed) |
| Discover, start/stop/restart, and **pull-update** stacks | See stacks **outside** `STACKS_DIR` |
| Create a stack (wizard *or* manual browser compose) | Do anything without the **socket mounted** |
| Edit `compose.yml` / `.env`, delete a stack | Build/manage arbitrary images (only recipe builds + pull) |
| Host CPU / RAM / disk; assign a URL to a container | |

Everything is compose-based: even a single-container app is a one-service `compose.yml`,
so there are no special cases. Recovery/escape hatch is always plain SSH + `docker compose`.

### Independence
- Requires only: Docker socket mounted at `/var/run/docker.sock` (read-write)
- Must run on the same host as Docker Engine
- One startup check that `STACKS_DIR` exists inside the container (the compose mount took):
  if not, `/api/health` reports it and stack writes are refused with a clear message,
  rather than the wizard writing into an unmounted path the host can't see. Container
  Overview still works — this only gates the Stack Manager
- Reads/writes the shared instance list (local JSON — always available, never a failure point)
- If Caddy is down: Docker module works fully, URL assignment step skipped with warning
- If AdGuard is down: Docker module works fully

### API Surface (internal, consumed by frontend)
```
GET  /api/docker/containers                list all containers + stats
POST /api/docker/containers/:id/start
POST /api/docker/containers/:id/stop
POST /api/docker/containers/:id/restart
DEL  /api/docker/containers/:id
GET  /api/docker/containers/:id/logs       stream logs (SSE)
WS   /api/docker/containers/:id/exec       interactive terminal (WebSocket)
GET  /api/docker/stacks                    list discovered stacks
GET  /api/docker/stacks/:name              stack detail + file contents
POST /api/docker/stacks/:name/action       up / down / restart / pull
PUT  /api/docker/stacks/:name/file         update compose.yml or .env
DEL  /api/docker/stacks/:name
GET  /api/docker/recipes                   list available install recipes (from the synced repo)
POST /api/docker/recipes/refresh           re-sync recipes from the repo
POST /api/docker/recipes/:name/install     run install wizard for a recipe
GET  /api/docker/stats                     host-level resource summary
```

---

## Module 2 — Caddy Routing

### Purpose
Manage all reverse proxy routes. A route is just an **instance** with a `subdomain`
(see [Core Data Model](#core-data-model--instances)) — this module reads the instance
list and pushes those to Caddy via the Admin API. It can route any instance, whether
backed by a container or an external LAN target, so it has zero runtime dependency on
AdGuard, WireGuard, or the Docker module (external instances need no Docker at all).
An instance with `route_mode: "dns_only"` (see [DNS-only routing](#dns-only-routing--decoupling-adguard-from-caddy))
is excluded from this module's projection entirely — it has a subdomain but no Caddy
route, so it never appears in `push_all` or the live-sync check.

### Features

**Route List**
- Every instance in a clean table — routed rows show route/DNS status, unrouted rows offer
  "Change URL". Per-row actions: remove-route (keep the instance) for any routed row; delete
  (route + record) for any instance — a deleted docker instance leaves its container alone
- Each row: subdomain → upstream (host:port, optionally HTTPS), synced + DNS status
- **Synced status** — Loskai fetches Caddy's live routes (`GET …/routes`) and checks each
  instance's `@id` against them. Present = synced; missing = not pushed (offer "Sync").
  This is a **read-only comparison for display only** — it never auto-corrects, so it can't
  reintroduce a drift/reconcile loop.
- "Sync" button — re-pushes every Caddy route from the instance list **and** reconciles
  AdGuard rewrites (adds missing, migrates stale, sweeps orphaned); the one-click recovery
  + refresh action

**Add route** (the route-creation surface — a source picker over one assign form)
- Source selector `[ Container | Network service | External ]` — pick an *unrouted* container
  or built-in service (pre-fills subdomain + upstream), or enter an external target by hand.
  Routed items are filtered out. Submitting posts `container` / `origin` / neither to
  `/api/routes`. Naming a machine is a **separate modal and endpoint** (`/api/machines`) —
  different shape, different verb — on the Machines tab.
- Input: subdomain **prefix only** (e.g. `grafana`) — a single DNS label
  (lowercase letters, digits, hyphens; must be unique)
- Domain suffix auto-filled from the global `BASE_DOMAIN` setting (e.g. `example.no`)
- UI shows the assembled FQDN live as you type: `grafana` → `grafana.example.no`
- Single-label only — keeps every name under the one `*.BASE_DOMAIN` wildcard cert
  (`app.team.example.no` would need a separate `*.team.example.no` cert, which the
  wildcard does not cover)
- Upstream: any `host:port` reachable from the Caddy LXC — LAN IP + exposed port (a bare
  `host:port`, no scheme/path; validated on assign). A "Backend speaks HTTPS" toggle sets
  `upstream_tls` for TLS-only backends (see below)
  - Docker container: `192.168.10.100:3000`  (port must be exposed on the host)
  - LAN device:       `192.168.10.50:5000`
  - Proxmox:          `192.168.10.10:8006`  (tick "Backend speaks HTTPS" — it's TLS-only)
  - Loskai itself:  `192.168.10.100:8080`
- One click (`POST /api/routes`) → Caddy route created (required), HTTPS live immediately;
  the AdGuard DNS rewrite is written best-effort in the same call (skipped with a warning
  if AdGuard is unhealthy — the name won't resolve on the LAN until the rewrite is added,
  so retry when AdGuard is back)

> **Certificate Status is deferred** — out of current scope. With the default internal CA,
> Caddy's PKI endpoints *do* expose the `local` CA's expiry, and Caddy auto-renews anyway, so
> this is low-urgency. When revisited it will be implemented as a TLS probe (method-independent,
> so it also covers a future public-ACME cert), not via the Admin API — see [Future Ideas](#future-ideas).

**Raw Config View**
- Read-only view of the current Caddy JSON config
- Useful for debugging

> **Caddyfile export was removed** — it duplicated the JSON config export (`GET /api/export`,
> instances + rewrites) and the Sync backstop, and the bootstrap Caddyfile now ships as a
> ready-made file in the repo for the Docker / LXC install path. Loskai no longer renders a
> Caddyfile from the instance list.

### Independence
- Requires only: Caddy Admin API reachable at `CADDY_ADMIN_URL` (default: `http://192.168.10.101:2019`) + the local instance list
- If AdGuard is down: routes can still be created/deleted, DNS rewrite step is
  skipped with a warning shown to the user
- If the Docker module / socket is down: routing works fully — external instances are
  unaffected, and a container instance's stored `upstream` is still valid (only live
  status/stats can't be shown)
- If WireGuard is down: no effect whatsoever

### Co-located vs External Mode

`CADDY_ADMIN_URL` determines the mode — no other config needed:

| `CADDY_ADMIN_URL` value | Mode | What it means |
|---|---|---|
| `http://caddy:2019` | Docker network (co-located) | Caddy is a container on this host; its admin API never reaches the LAN |
| `http://192.168.10.101:2019` | LAN IP (preferred/external) | Caddy is off-box, on its own LXC |

The backend client is identical in both cases — it just hits whatever URL is configured.

**The mode does not decide the upstream format** — it used to, and that was a *per-deployment*
answer to a *per-container* question (Phase 16 Stage A). Compose isolates every project, so a
co-located Caddy resolves names in its own project and nowhere else; `grafana:3000` pre-filled
for a managed stack 502s. The form is now derived per container from whether Caddy and the
target actually share a network Docker's embedded DNS serves (`logic.upstream_mode`): sharing
one gives `name:port`, otherwise `<host_ip>:<published-port>`. `caddy_mode` survives only as
`/api/caddy/status`'s display summary and as the fallback for route sources that have no
container at all.

The table above is the *deployment* summary, surfaced as `caddy.mode`. It is **not** how a
route's upstream is chosen: since Phase 16 Stage A that is decided **per container**, by
asking whether Caddy's container and the target share a Docker network
(`modules/docker/logic.upstream_mode`). The two answers diverge whenever Caddy is a container
beside managed stacks — Compose isolates every project — which is what made the old
mode-driven hint suggest names that could not resolve.

The Add route form therefore takes its hint from the picked container's own `upstream_mode`:
- shares a network with Caddy → "e.g. grafana:3000"
- does not → "e.g. 192.168.10.100:3000"

`caddy.mode` remains the fallback for the sources that have no container (Network service,
External).

### How Routes Are Stored — derived from the instance list

Routes are not stored as their own thing. A route is simply an **instance** (see
[Core Data Model](#core-data-model--instances)) that has a `subdomain` assigned. The
Caddy live config is a **projection** of "every instance with a subdomain" — Loskai
pushes those to Caddy via the Admin API by `id` (= Caddy `@id`). The exact endpoints are
documented in [`docs/reference/caddy-api.md`](docs/reference/caddy-api.md).

- **Flat sibling routes.** Each route is an independent top-level entry in the server's
  `routes` array, matching a single specific host (`grafana.example.no`) and keyed by
  `@id`. No nesting under a wildcard site block — the wildcard exists only for the cert.
  Loskai's routes are disjoint from each other, so their relative order never matters —
  but they must all sit **ahead of** that wildcard block, which the Caddyfile compiles to a
  handler-less `terminal` route matching every name under `BASE_DOMAIN`. Behind it a route
  is dead and Caddy answers an empty `200`, so pushes insert at the head.
- A route exists when an instance has a subdomain; it's gone when the subdomain is
  cleared or the instance is deleted. There is no enable/disable state — routes are binary.
- **Route identity:** the instance `id` is used verbatim as Caddy's `@id`. Add is
  `PUT …/routes/0`, delete is `DELETE /id/<id>`, and **editing an existing route is just
  delete-then-add** (not `PATCH`) — one code path that always converges, and re-pushing
  never creates duplicates.
- **Persistence is automatic.** Caddy autosaves its full config to disk after *every* API
  change and runs with `caddy run --resume`, so it restores that autosave on start. A
  normal LXC / Proxmox reboot or Caddy restart brings every route back with **no action
  from Loskai**.
- **Backstop:** the instance list (`instances.json`) is the durable record. "Sync"
  re-creates every route from it — but only needed in the rare case where Caddy's
  autosave itself is gone (fresh Caddy, wiped data dir), not on a normal reboot.
- **Ownership rule:** Loskai manages every route whose `@id` matches an instance — which
  now includes its own UI and AdGuard, since both are ordinary instances. The bootstrap
  Caddyfile defines **no** routes of its own; any route a human adds directly to Caddy
  without a matching instance `@id` is simply left alone by the per-route push.

### API Surface (internal)

The Caddy module is **read + push only**. Assigning or clearing a subdomain is a
cross-module action and lives at `POST` / `DELETE /api/assign` (see
[The Assign Action](#the-assign-action--cross-module-coordination)) — the Caddy
module never writes a single route on its own.

```
GET  /api/caddy/routes           list instances that have a subdomain (the route table)
POST /api/caddy/push             re-push all routes from the instance list to Caddy
```
Status + mode arrive in the aggregate `GET /api/health` as `caddy`; upstream liveness is
joined into `/api/caddy/routes`. Neither has a route of its own (Phase 15 F16 removed the
two that nothing called).

### Caddy Route JSON (what gets sent to Caddy Admin API)
```json
{
  "@id": "grafana",
  "match": [{ "host": ["grafana.example.no"] }],
  "handle": [{
    "handler": "subroute",
    "routes": [{
      "handle": [{
        "handler": "reverse_proxy",
        "upstreams": [{ "dial": "192.168.10.100:3000" }]
      }]
    }]
  }]
}
```

When the instance has `upstream_tls: true` (an HTTPS-only backend like Proxmox), the
`reverse_proxy` handler also carries
`"transport": { "protocol": "http", "tls": { "insecure_skip_verify": true } }` — dial the
upstream over TLS, cert unverified. The `dial` stays a bare `host:port`.

---

## Module 3 — AdGuard DNS

### Purpose
Lightweight companion to AdGuard — not a replacement for its UI. It only covers what's
relevant to Loskai: keeping DNS rewrites in sync with the routed instances (those with a
`subdomain`) and linking out to AdGuard for everything else.

### Model
One explicit rewrite per routed instance (`grafana.example.no → <caddy-ip>`), no
`*.BASE_DOMAIN` catch-all — an unassigned name just falls through to public DNS. The
answer depends on the instance's `route_mode`: for `proxy` (the default) it's the shared
Caddy LAN IP (derived from `CADDY_ADMIN_URL`; `CADDY_HOST_IP` fallback when that's a
hostname), the same for every proxy rewrite; for `dns_only` it's that instance's own
`upstream` IP instead — see [DNS-only routing](#dns-only-routing--decoupling-adguard-from-caddy).
Every write is a single add or exact-pair
delete (the API has no bulk op), so **no automatic path touches a manually-added rewrite**
— a hand-added entry on the same domain is surfaced as a conflict, not overwritten. The
one way a foreign rewrite is ever removed is the explicit reset in Settings › Network,
which wipes the whole list and reconciles Loskai's own back (see
[docs/reference/adguard-api.md](docs/reference/adguard-api.md) — Ownership). Each
instance records the answer Loskai last wrote for it (`dns_answer`), so if the Caddy IP
ever changes a re-push deletes each instance's old entry and re-adds the new one — cleaning
its own orphans while leaving anything it never set alone. Rationale and edge cases are in
[docs/reference/adguard-api.md](docs/reference/adguard-api.md). (Unrelated to Caddy's wildcard TLS cert, which
stays.)

### Features

**Link out (most important)**
- Prominent button to open the full AdGuard UI in a new tab
- AdGuard's own UI handles query logs, stats, blocklists, upstream config, etc.

**Health Check**
- Is AdGuard reachable? (`GET /control/status`)

**Rewrite List**
- List existing DNS rewrites so you can see which routed instances are in sync
- Delete a rewrite if needed
- Rewrites are primarily created automatically via the assign action —
  manual add is available but not the main flow

**Sync with the instance list**
- AdGuard is its own source of truth for rewrites — Loskai reads them straight from
  AdGuard and shows which instances have a matching rewrite (read-only comparison, never
  auto-corrected)
- "Sync" best-effort re-adds any missing rewrites for instances that have a subdomain, and
  sweeps orphaned `<label>.<base>` rewrites at the Caddy IP that no live route owns
- Each per-name rewrite is load-bearing — a missing one means that name won't resolve on
  the LAN until it's added; the AdGuard step still never blocks a Caddy route

### Independence
- Requires only: AdGuard API reachable at `ADGUARD_URL`
- If AdGuard LXC is down: module shows "AdGuard unreachable" + link to open UI,
  all other modules unaffected
- When assigning URLs via Caddy module: AdGuard is called as a side effect,
  Caddy route is still created even if this call fails

### API Surface (internal)
```
GET  /api/adguard/status         per-instance DNS status (the routing table's DNS column)
POST /api/adguard/reconcile      ensure/migrate/sweep rewrites (the DNS half of Sync)
```
Reachability arrives in the aggregate `GET /api/health` as `adguard`. The rewrite calls
themselves (`list`/`add`/`delete` by exact `{domain, answer}` pair — no ID exists) stay in
`client.py`, driven by assign and reconcile; Phase 15 F16 removed the HTTP handlers that
exposed them directly, since nothing called them and every rewrite must go through the
assign flow's ordering.

---

## Module 4 — WireGuard (Lightweight)

### Purpose
A minimal status card — not a WireGuard manager and not an API client.
No authentication required. Full management stays in wg-easy or wg-dashboard.
The most important feature is the link out.

### Features

**Link out (most important)**
- Prominent button to open wg-dashboard in a new tab
- `WIREGUARD_DASHBOARD_URL` is the only config needed

**Reachability check**
- Is the wg-dashboard reachable? (simple HTTP ping, no auth)
- **Any HTTP response counts as reachable** — an auth-protected dashboard returning
  `401`/`403` is still up; only a connection failure/timeout means unreachable
- Shows online / unreachable status

**DNS reminder**
- A reminder card showing the correct DNS value to set in wg-dashboard so remote peers
  resolve names through AdGuard: the **host of `ADGUARD_URL`** (e.g. `192.168.10.101`)
  + `1.1.1.1` (fallback)
- Derived from config, not hardcoded — if `ADGUARD_URL` is unset, the card shows generic
  guidance ("set your AdGuard server's IP") instead of a placeholder number
- Not fetched from the wg API — just a persistent reminder since this is
  the most common misconfiguration

### What It Does NOT Do
- No API authentication — no password, no token
- No peer list, no handshake times (use wg-dashboard for that)
- No peer creation / deletion / key management
- Not part of the instance model — it stores nothing and reads nothing from
  `instances.json`; it is a pure status card standing on its own

### Independence
- Requires only: `WIREGUARD_DASHBOARD_URL` env var (optional)
- If not configured or unreachable: shows the DNS reminder + greyed-out link
- No credentials needed, nothing to break

### API Surface (internal)

None. `{ status, reachable, url, dns_hint }` arrives in the aggregate `GET /api/health` as
`wireguard` — the module registers a health checker and nothing else (Phase 15 F16 removed
the duplicate `GET /api/wireguard/status`, which no caller used).

---

## The Assign Action — Cross-Module Coordination

This is the one place where modules coordinate. When a user adds a route (via the Routing
tab's **Add route** picker, `POST /api/routes`), this happens — the flow is identical whether
the source was a container, a Network service, or an external target:

```
User: enters prefix "grafana" → upstream 192.168.10.100:3000
      (Loskai assembles grafana + BASE_DOMAIN = grafana.example.no)

Step 0 — Persist intent (REQUIRED)
  Set subdomain="grafana" + upstream on the instance and save instances.json
  → The instance list is the durable record; Caddy and AdGuard are pushed from it

Step 1 — Caddy route (REQUIRED)
  POST http://192.168.10.101:2019/config/apps/http/servers/<server>/routes  (@id = instance id)
  → <server> is discovered at startup (GET .../servers), not hardcoded to srv0
  → If this fails: abort, roll back the subdomain, show error

Step 2 — AdGuard rewrite (BEST EFFORT)
  POST http://192.168.10.101:3000/control/rewrite/add
  body: { "domain": "grafana.example.no", "answer": "<caddy-ip>" }
  → answer = Caddy LAN IP (host of CADDY_ADMIN_URL), same for every rewrite
  → If this fails: route was still created in Caddy, but the name won't
    resolve on the LAN until the rewrite is added — surface that clearly
  → Show warning: "Route created, DNS rewrite failed — add manually in
    AdGuard or retry when it's reachable"

Result shown to user:
  ✅ Caddy route created
  ✅ AdGuard rewrite created   (or ⚠️ AdGuard unreachable — name won't resolve until added)
  🔗 https://grafana.example.no
```

**Clearing a URL** (`DELETE /api/assign/:id`, from the route list's delete or the Docker
Manager) is the exact mirror: clear the instance's `subdomain` and save, delete the Caddy
route (`DELETE /id/<id>`, required), then best-effort remove the AdGuard rewrite. The
instance itself survives — it just no longer has a route. To remove the instance entirely,
`DELETE /api/instances/{id}` (any type — see Core Data Model), which runs this same
clear-route step first and then drops the record.

**`route_mode: "dns_only"` variant.** Stored the same way, but created through its own
endpoint `POST /api/machines` since Phase 21e (this paragraph's "same endpoint, one extra
field" was true until then)
(`"route_mode": "dns_only"`), and Step 1 inverts: instead of pushing a route, Loskai
deletes any Caddy route that might exist for that `@id` (idempotent — a no-op the first
time, and what tears down a stale route on a proxy→dns_only mode switch). Step 2's answer
is the instance's own `upstream` IP, not the shared Caddy IP. Result: `caddy: "skipped"`,
`adguard: "ok"`, and a bare-hostname `url` (no `https://` — there's no TLS). Clearing works
identically (the Caddy delete is still called, still harmless when nothing was ever pushed).

---

## Tech Stack

### Backend — Python + FastAPI + uv
- Async, fast, excellent for API services
- httpx for async HTTP calls to Caddy and AdGuard
- docker-py for Docker socket management
- pydantic-settings for env var validation
- sse-starlette for SSE log streaming
- No database — persistent state is two flat JSON files (`settings.json`, `instances.json`)

```
backend/src/loskai/
├── main.py                  FastAPI app, registers routers, serves static files last
├── config.py                pydantic-settings: validates all env vars on startup
├── modules/                 each: client.py does I/O, service.py/logic.py decides — the seam
│   ├── caddy/
│   │   ├── client.py        httpx wrapper for Caddy Admin API
│   │   ├── service.py       pure route/Caddyfile builders + sync comparison; read + push only
│   │   └── router.py        FastAPI APIRouter
│   ├── adguard/
│   │   ├── client.py        httpx wrapper for AdGuard REST API
│   │   ├── service.py       pure rewrite projection + reconcile/consistency comparison
│   │   └── router.py
│   ├── wireguard/
│   │   ├── client.py        simple reachability check
│   │   └── router.py        no routes of its own — registers a health checker + the peer DNS hint
│   └── docker/              Phase 8
│       ├── client.py        docker-py wrapper
│       ├── logic.py         pure: port/upstream derivation, per-container upstream_mode, joins
│       ├── stacks.py        directory-based stack manager
│       ├── recipes.py       recipe engine: multi-source sync + validate + install (recipes live in external repos)
│       ├── quick_commands.py  image-name → preset terminal commands map
│       └── router.py
└── shared/
    ├── store.py             atomic JSON read/write + the lock — the only I/O seam for the
    │                        flat store; every writer goes through update_json
    ├── health.py            GET /api/health — polls all module clients
    ├── auth.py              login + session middleware — gates every /api/* except
    │                        the public endpoints (see Security & Access)
    ├── dashboard.py         GET /api/dashboard — public: non-private routed services
    │                        (id, name, url, icon) + certificate_tab. Machines excluded:
    │                        an address has no port to link to. Also GET /api/launcher,
    │                        the same list *including private*, behind the session
    ├── icons.py             launcher icons in <data_dir>/icons — the only binary state.
    │                        Format sniffed by magic bytes (PNG/JPEG/WebP, no SVG), since
    │                        these are served back from Loskai's own origin
    ├── assign.py            POST /api/routes + POST /api/machines — the two creation
    │                        verbs over one orchestration; DELETE /api/assign/{id} clears
    │                        a subdomain. Caddy required, AdGuard best-effort
    ├── export.py            GET /api/export — the backup bundle (settings + instances)
    ├── instances.py         read/write instances.json — the instance list (route intent)
    └── settings.py          read/write settings.json, merge with env vars, priority chain
```

### Frontend — React + TypeScript + Vite
- Tailwind CSS for styling
- React Query for data fetching + caching
- Recharts for CPU/RAM graphs (Docker module, Phase 8)
- Lucide React for icons

**Layout & design philosophy** (Lutris-inspired): a **persistent left sidebar** shell +
a main "library" content area, with contextual action buttons per item.

- **Sidebar**: `Dashboard · Docker · Routing · Settings`. Always visible; the Dashboard
  is the first item, and clicking an admin item when not logged in prompts the security
  screen. (The sidebar being visible is UX only — the API is the real gate.)
- **Routing tab merges Caddy + AdGuard into one view.** An assign writes both a Caddy route
  and an AdGuard rewrite for one service, so the view is **one row per routed service** showing
  FQDN, upstream, route-sync status, and DNS-rewrite status inline, with per-row actions —
  instead of two tabs to cross-reference. (The *backends* stay independent modules; only the
  frontend unifies them.)
- **Settings is a Forgejo-style category page**, not one flat form: a nested sidebar
  (`General · Network · Security`) over real child routes, so a category is deep-linkable.
  **General** = app-wide knobs + backup; **Network** = how Loskai reaches AdGuard, Caddy, and
  WireGuard; **Security** = reserved for the admin password (no change-password endpoint yet).
- **Configuration and live status are split by kind, not by service.** Settings > Network is
  **fields-only** (auto-saving on blur); the health + link-out for **AdGuard** and **Caddy**
  lives in the **Routing tab**, because Routing is what actually pushes their state — a status
  pill belongs next to the thing it gates. AdGuard's pill also routes AdGuard in one click
  (as the picker's Network source, `origin: "adguard"`) and, once routed, links to the name
  rather than the address. **WireGuard is the exception**: Loskai never writes
  to it, so it has no presence in Routing and keeps a plain link-out beside its config field.
  (This replaced a standalone Network tab, which had bundled all three concerns per service.)
  **Docker tab** = containers + stacks + wizard; a routed container shows its FQDN as a link.
- **Route creation is centralised in the Routing tab.** Its **Add route** picker chooses a
  source — an unrouted **Container**, a built-in **Network service**, or a new **External**
  target — pre-fills the prefix + upstream, and creates the instance (linked by `container` /
  `origin` / neither). The Docker tab *displays* routed state but never creates routes, so a
  service can't be double-routed from competing surfaces.
- **Hybrid card/table aesthetic**: card grid for the Dashboard and service launchers (library
  feel); dense tables where live stats must be scannable (container/stack lists, the routing
  table).
- Routes: `/` (Dashboard) · `/login` · `/docker` · `/routing` · `/settings` (+ its nested
  `/settings/network` · `/settings/security`).

```
frontend/src/
├── main.tsx
├── App.tsx                  React Router: public Dashboard + Login, gated admin tabs
├── pages/
│   ├── Dashboard.tsx        public landing — grid of service cards (launcher)
│   ├── Login.tsx            the security screen — single-password form
│   ├── Docker.tsx           ─┐ admin tabs — behind the session gate (Phase 8)
│   ├── Routing.tsx           │ unified Caddy + AdGuard: one row per service
│   ├── Machines.tsx         ─┘ named LAN addresses, each with the routes hosted on it
│   └── settings/            nested category routes under /settings
│       ├── SettingsLayout.tsx  category sidebar + <Outlet/>; owns the page header
│       ├── General.tsx         app-wide settings + backup export
│       ├── Network.tsx         AdGuard / Caddy / WireGuard config fields only
│       └── Security.tsx        stub — no change-password endpoint yet
├── components/
│   ├── shared/
│   │   ├── StatusBadge.tsx
│   │   ├── ModuleStatus.tsx  degraded/unreachable banner per module
│   │   ├── RequireAuth.tsx   wrapper that redirects to /login without a session
│   │   ├── ServiceCard.tsx   one dashboard card (name, uploaded icon or glyph, link-out)
│   │   ├── Modal.tsx         generic shell for the larger dialogs (logs, terminal, wizard)
│   │   ├── InlineSettingsFields.tsx auto-saving per-field editor (both Settings pages)
│   │   └── ConfirmDialog.tsx
│   ├── routing/            unified Caddy + AdGuard view
│   │   ├── ServiceTable.tsx    one row per routed service: FQDN, upstream,
│   │   │                       route-sync + DNS-rewrite status, per-row actions,
│   │   │                       private toggle; "Sync" for recovery
│   │   ├── InfraStatusPill.tsx AdGuard/Caddy health + link-out; falls back to a
│   │   │                       "Configure" link into /settings/network when unset
│   │   ├── AddRouteModal.tsx   source picker (container/network/external) → POST /api/routes
│   │   ├── AddMachineModal.tsx hostname + bare address form → POST /api/machines
│   │   ├── SchemeSelect.tsx    https / both / http, per route
│   │   ├── MachineTable.tsx    each machine, its hosted routes beneath (Machines tab)
│   │   └── AssignModal.tsx     prefix + upstream form (per-row "Change URL")
│   ├── settings/
│   │   └── PeerDnsReminder.tsx WireGuard peer-DNS guidance
│   └── docker/              Phase 8
│       ├── StackGroups.tsx      containers nested under their stack (groupByStack.ts)
│       ├── VolumeList.tsx       named volumes: size, stack, used by
│       ├── LogViewer.tsx
│       ├── Terminal.tsx         xterm.js browser terminal (WebSocket exec)
│       ├── QuickCommands.tsx    preset command buttons above the terminal
│       ├── StackEditor.tsx
│       ├── InstallWizard.tsx
│       └── StatsBar.tsx
└── lib/
    ├── api.ts               fetch wrapper (+ raw-body upload for launcher icons)
    ├── useHealth.ts         React Query hook, polls /api/health every 30s
    ├── useDashboard.ts      the one public payload — cards + certificate_tab
    ├── useScrollLock.ts     freezes the page behind any open overlay, ref-counted
    └── validation.ts        prefix/upstream/address rules shared by the route forms
```

### Single Docker Image
The Vite build output is served as static files by FastAPI.
One image, one container, one port.

```dockerfile
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build            # → /app/dist

FROM python:3.12-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y docker.io docker-compose-plugin git && rm -rf /var/lib/apt/lists/*
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/src ./src
COPY --from=frontend /app/dist ./static
EXPOSE 8080
CMD ["uv", "run", "uvicorn", "loskai.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## Docker Compose (Docker Host)

Caddy is not a Docker container in the preferred setup — it runs natively on its own LXC
(with AdGuard on a separate one). Only Loskai and your app containers run here.

```yaml
services:

  loskai:
    image: ghcr.io/youruser/loskai:latest
    # build: .                 # use this during development
    container_name: loskai
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      # Same path inside and out — the compose CLI hands bind paths to the host daemon,
      # so in-container path must equal host path or stack volumes land in the wrong place
      - ${STACKS_DIR:-${PWD}/stacks}:${STACKS_DIR:-${PWD}/stacks}
      - ./data:/data   # persists settings.json + instances.json + recipes/
    environment:
      # Caddy — its own LXC over LAN (port 2019 firewalled to this host only)
      - CADDY_ADMIN_URL=http://192.168.10.101:2019

      # AdGuard — its own LXC over LAN
      - ADGUARD_URL=http://192.168.10.102:3000
      - ADGUARD_USER=${ADGUARD_USER}
      - ADGUARD_PASSWORD=${ADGUARD_PASSWORD}

      # WireGuard dashboard — its own LXC over LAN (optional, no auth required)
      - WIREGUARD_DASHBOARD_URL=http://192.168.10.103:51821

      # General (optional — can be set in UI settings page instead)
      - BASE_DOMAIN=${BASE_DOMAIN}          # e.g. example.no
      - LOSKAI_PASSWORD=${LOSKAI_PASSWORD}   # guards the admin UI (or set at first run)
      # Must equal the bind mount above so Loskai scans the same path that's mounted
      - STACKS_DIR=${STACKS_DIR:-${PWD}/stacks}
      # Note: any ACME/DNS-challenge token lives on the Caddy LXC in Caddy's environment
      # — Loskai never needs it (and the default internal-CA mode needs no token at all)
    restart: unless-stopped
```

---

## Caddy Setup (runs natively on its own LXC)

### TLS and certificates — out of scope for the app

Loskai only needs to know the `BASE_DOMAIN` string (e.g. `example.no`). *How* Caddy
obtains a cert for each `*.BASE_DOMAIN` name is a one-time Caddy-host concern with no
impact on Loskai's application code — Caddy's Admin API works identically regardless of
the cert method, and Loskai handles zero certificate material either way.

**Default — Caddy's internal CA.** Caddy runs with `local_certs` and signs every
`*.BASE_DOMAIN` name with its own root: no real domain, no ACME/DNS token, no external
dependency. LAN devices install that root **once** via the certificate-onboarding page
(plain-HTTP on `:80` — see [`docs/guides/certificate-setup.md`](docs/guides/certificate-setup.md)); after
that every current and future `*.BASE_DOMAIN` name is trusted. This is the mode Loskai
targets today, in **both dev and production** — stock Caddy is enough, no xcaddy build needed.

> **Future — public ACME certs.** Swapping to publicly-trusted certs (Let's Encrypt /
> ZeroSSL via a DNS challenge) is a possible later option: it drops the one-time root
> install but adds a real domain, an xcaddy build with the matching `caddy-dns` plugin, and
> a DNS-provider token in Caddy's environment on the Caddy LXC. The provider depends on the domain
> (whoever hosts the zone, so long as a [caddy-dns
> module](https://github.com/orgs/caddy-dns/repositories) exists for them; a registrar with no
> API is reached by delegating a subdomain or CNAME-ing `_acme-challenge` to acme-dns). Because Loskai is cert-agnostic, adopting it is a Caddyfile change only, with no
> application-code impact. Deferred until/unless it is pursued.

### Install (for reference — handled by the Phase 7 Caddy LXC script, `create-caddy-lxc.sh`)

The default internal-CA mode needs only **stock Caddy** (`local_certs` is built in) — no
xcaddy, no plugins. The xcaddy build below is required **only** for the future public-ACME
path, to bake in the matching `caddy-dns` plugin:

```bash
# Build Caddy with your DNS provider's plugin via xcaddy (cloudflare shown as an example)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-xcaddy-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-xcaddy.list
apt update && apt install xcaddy
xcaddy build --with github.com/caddy-dns/cloudflare --output /usr/bin/caddy   # swap for your provider
```

Caddy is run as a systemd service with **`caddy run --resume`**. Because Caddy autosaves
its full config to disk after every Admin API change, `--resume` restores every route on
restart with no action from Loskai — this is the normal reboot path. "Sync"
(rebuilding routes from `instances.json`) is only the rare-case backstop for when that
autosave is gone (fresh Caddy, wiped data dir). See [`docs/reference/caddy-api.md`](docs/reference/caddy-api.md).

### Caddyfile (bootstrap only — all routes come from Loskai via the Admin API)

The bootstrap Caddyfile defines **no routes at all** — only the admin endpoint, the TLS
setup, and the certificate-onboarding page. Every route, including Loskai's own UI and
AdGuard, is a specific-host route pushed at runtime from the instance list — all flat
siblings reusing the same internal cert.

```caddyfile
{
    admin 0.0.0.0:2019          # firewalled — only the Docker host (192.168.10.100) can reach this
    local_certs                 # Caddy is its own CA — no real domain or ACME/DNS token needed
}

# Issue an internal cert per *.BASE_DOMAIN name on demand. No handlers → cert only.
*.{$BASE_DOMAIN} {
    tls internal
}

# Certificate-onboarding page on :80 — lets a LAN device install the internal root once,
# reachable by IP before that root is trusted. Full block in docs/guides/certificate-setup.md.
:80 {
    handle /caddy-root.crt {
        root * /data/caddy/pki/authorities/local
        rewrite * /root.crt
        header Content-Type application/x-x509-ca-cert
        file_server
    }
    handle { root * /srv/setup; file_server }
}

# No routes here. Loskai pushes every specific-host route (loskai, adguard,
# grafana, …) at runtime via the Admin API, each reusing the internal cert above.
```

> **Future (public ACME).** To use publicly-trusted certs instead, drop `local_certs` and
> the onboarding `:80` block and obtain a wildcard via DNS challenge (needs the xcaddy build
> above + the provider token in Caddy's env):
> ```caddyfile
> *.{$BASE_DOMAIN} {
>     tls { dns <provider> {env.DNS_TOKEN} }   # the caddy-dns module for your DNS host
> }
> ```

> **Cold-start recovery.** On a brand-new Caddy with an empty autosave, no routes exist yet,
> so `loskai.{$BASE_DOMAIN}` doesn't resolve. Reach Loskai directly at
> `http://192.168.10.100:8080` and click **"Sync"** — that seeds every route,
> including its own. After that, autosave + `--resume` keep them across restarts.

---

## Alternative Setups

The preferred setup runs Caddy and AdGuard as two separate native LXCs (layout **A**, the
three-way split). Two alternatives exist, differing in how many machines they use and which
ports end up contested: **B** split DNS (the two-way split — AdGuard on its own small box,
Caddy + Loskai together in Docker), and **C** all-in-Docker (one box).

**A and B are recommended** — A wherever Proxmox is available, B everywhere else. **C is the
supported alternative** for a single box, and the only layout that needs the host reconfigured
before it starts (`53` vs the host resolver); that and DNS sharing the Docker host's fault
domain are stated at the point of choice.

A fourth layout — all three components merged into **one container** — was specified and then
**rejected** (2026-09-02): it fixes no port conflict, since the only contested port is `53`
against the host resolver and that survives the merge, while collapsing DNS, TLS and the
root-equivalent Docker socket into one blast radius and forcing a supervisor onto the
otherwise single-process image.

The full comparison — which ports each layout contests, which admin channels it leaves on the
LAN, and the reasoning behind that recommendation — is
[docs/guides/topologies.md](docs/guides/topologies.md), which also records the merged container
above as the one considered-and-rejected arrangement. That page is the single source of truth
for topology; this section
deliberately carries only the summary, because the same port table previously lived here, in
`deployment.md` and in `topologies.md`, and the copies drifted.

---

## Settings & Configuration

All service connection settings can be configured in two ways — both are optional:

### Priority chain (highest to lowest)
1. **Environment variable** — set in `.env` or compose file, read on startup, takes precedence
2. **UI settings page** — configured in Loskai's settings page, persisted to `settings.json`
3. **Unset** — module shows "not configured" and links to the settings page

This means you can skip the `.env` entirely and configure the service connections
through the app on first run. Or use env vars to pre-populate. Both work. (The one
exception is `STACKS_DIR` — it drives the compose bind mount, so it lives in the compose
file only and is shown read-only in the UI; see the table below.)

### Configurable settings

| Setting | Env var | Description |
|---|---|---|
| Caddy Admin URL | `CADDY_ADMIN_URL` | `http://192.168.10.101:2019` (LAN) or `http://caddy:2019` (Docker) |
| AdGuard URL | `ADGUARD_URL` | `http://192.168.10.101:3000` |
| AdGuard username | `ADGUARD_USER` | Basic auth username |
| AdGuard password | `ADGUARD_PASSWORD` | Basic auth password |
| WireGuard dashboard URL | `WIREGUARD_DASHBOARD_URL` | Optional |
| Stacks directory | `STACKS_DIR` | Host path for Docker stacks; defaults to `./stacks` beside the compose file. **Set in the compose file, not the UI** — it drives the same-path bind mount, so the container only sees the directory mounted at launch. Shown read-only on the settings page; changing where stacks live means editing the compose mount and restarting. If it points somewhere unmounted, the Stack Manager simply shows no stacks — that empty list is the signal, no extra validation |
| Base domain | `BASE_DOMAIN` | Your domain, e.g. `example.no` — service prefixes are appended to this |
| Recipe sources | — (no env var) | Optional. Git repos the install wizard syncs recipes from, each cached in the state volume. A list of toggleable rows in Settings > General only (stored as `recipes_repos`, seeded with `config.DEFAULT_RECIPES_REPO`) — see `STORED_ONLY_KEYS` for why this one has no environment layer |
| Loskai admin password | `LOSKAI_PASSWORD` | Guards the admin UI. Set via env or at first run; stored **hashed** (argon2/bcrypt), never returned by the API. Until one is set, the admin tier is locked and first run prompts to create it |
| Caddy LAN IP | `CADDY_HOST_IP` | Optional. The IP that DNS rewrites resolve names to (where Caddy listens on `:443`). Derived from `CADDY_ADMIN_URL`'s host when that is an IP; only needed when the admin URL is a hostname (Docker co-located mode, `http://caddy:2019`) |
| Docker host LAN IP | `HOST_IP` | Optional. This Docker host's LAN IP. Wherever Caddy can't reach a container by name — always in split-LXC, and per container in the two layouts where Caddy is a container here — a route needs `<host_ip>:<published-port>`; set once and Loskai auto-fills that upstream when routing a container, since a bridged container can't detect its own host's IP. Same address as `CADDY_HOST_IP` whenever Caddy runs on this host |

Any ACME/DNS-challenge credential, should you add one, is used by Caddy directly on the
Caddy LXC — Loskai never needs it (and the default internal-CA mode needs none). In the
co-located alternative (Caddy as Docker
container), it would be passed to the Caddy container, not to Loskai. **No env var
is required by Loskai itself** — everything can be configured via the settings page
on first run.

### Settings persistence

Settings are stored in `/data/settings.json` inside the container,
backed by a mounted volume (the same volume also holds `instances.json`). Env-var-set
values are shown as read-only in the UI with a "set via environment" indicator — they
cannot be overridden from the UI.

```yaml
# compose.yml (state volume)
volumes:
  - ./data:/data
```

### settings.json shape
```jsonc
{
  "caddy_admin_url": "http://192.168.10.101:2019",
  "adguard_url": "http://192.168.10.102:3000",
  "adguard_user": "admin",
  "adguard_password": "...",
  "wireguard_dashboard_url": "http://192.168.10.103:51821",
  "base_domain": "example.no",
  "caddy_host_ip": "192.168.10.101",
  // The one list-shaped setting: git sources in priority order, each independently
  // enabled. An empty list means "no git sources" and is never re-seeded.
  "recipes_repos": [
    { "url": "https://github.com/you/loskai-recipes", "enabled": true },
    { "url": "https://github.com/you/more-recipes", "enabled": false }
  ],
  "admin_password_hash": "$argon2id$..."   // set at first run; never returned by GET /api/settings
}
```

### Backend API
```
GET  /api/settings        returns all settings with source: "env" | "stored" | "unset"
PUT  /api/settings        update stored settings (env-sourced values ignored)
```

### .env.example (all optional — configure here or in the UI settings page)
```bash
# Any ACME/DNS-challenge token is set on the Caddy LXC (Caddy's environment), not here

BASE_DOMAIN=example.no
LOSKAI_PASSWORD=changeme     # guards the admin UI; or set it at first run
CADDY_ADMIN_URL=http://192.168.10.101:2019
ADGUARD_URL=http://192.168.10.101:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=changeme
WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821
#STACKS_DIR=/srv/stacks   # optional — defaults to ./stacks
# CADDY_HOST_IP=192.168.10.101   # only if CADDY_ADMIN_URL is a hostname (Docker co-located mode)
# HOST_IP=192.168.10.100         # this Docker host's LAN IP, for auto-filled container-route upstreams in split-LXC mode
```

Different deployment setups are supported via different compose files.
The application code is identical — only the environment variables differ.

---

## Graceful Degradation — Module States

Each module independently reports one of three states to the frontend:

| State | Meaning | UI Behaviour |
|---|---|---|
| `healthy` | External service reachable + responding | Normal UI |
| `degraded` | Service reachable but returning errors | Warning banner, features disabled |
| `unreachable` | No connection to external service | Grey module card, error message, rest of app unaffected |

Health is polled every 30 seconds per module. A single module going unreachable
never causes a reload, error page, or impact on other modules.

```
Example: AdGuard LXC goes down

Docker module:    healthy   — unaffected
Caddy module:     healthy   — unaffected, routes still created (without DNS step)
AdGuard module:   unreachable — shows "AdGuard at 192.168.10.101 is unreachable"
WireGuard module: healthy   — unaffected
```

---

## Implementation Phases

See `TODO.md` for the full phased task list. PLAN.md is the architecture reference;
TODO.md is the authoritative source for what to build and in what order.

---

## Resilience Summary

| Failure | Impact | Mitigation |
|---|---|---|
| AdGuard LXC down | DNS stops resolving | `1.1.1.1` fallback configured manually in wg-dashboard peer DNS; AdGuard module shows unreachable |
| Caddy crashes | HTTPS stops | Caddy runs as a systemd service on its own LXC — auto-restarts with `--resume`, restoring all routes from its autosave with no action needed; "Sync" rebuilds from `instances.json` only if the autosave itself is lost |
| Loskai container crashes | Can't manage; all services keep running | `restart: unless-stopped`; Caddy + AdGuard are unaffected |
| Docker host reboots | Loskai and every managed container restart; under layout A, DNS and HTTPS stay up throughout (Caddy and AdGuard are on their own boxes) | `restart: unless-stopped` on all containers |
| WireGuard LXC down | Remote access lost; LAN still works | Separate LXC isolates blast radius |

**Core property:** Loskai is never in the data path.
Caddy routes traffic. AdGuard resolves DNS. Loskai only configures them.
If Loskai is down, all services keep running exactly as before.

---

## Security & Access

Loskai is the highest-privilege service in the homelab — it holds the Docker socket
(root-equivalent on the host), the Caddy Admin API, and AdGuard credentials. Its own access
model is therefore a first-class concern, not a polish-phase afterthought.

### Two tiers, one in-app gate

The UI is split in two, so authentication lives **inside Loskai** (not a blanket Caddy
`basicauth`, which would also lock the public dashboard):

- **Public tier — the Dashboard and the Certificate page.** The launcher: a grid of cards
  for the non-private routed services (name, icon, link to `https://prefix.{BASE_DOMAIN}`).
  **Machines are not services** and never appear: an address has no port to link to — put a
  machine's UI on the dashboard by routing it under a second name, which is also the only
  way to have both a proxied name and a directly-certified one (see
  [backend-certificates.md](docs/guides/backend-certificates.md)).
  Each card can carry an uploaded **icon** (`GET /api/instances/{id}/icon`, public because
  the wall is). **`GET /api/launcher`** is the same list *including private* services, behind
  the session — for a desktop launcher building shortcuts; `private` means "not on the public
  wall", not "secret".
  No login. Served by `GET /api/dashboard`, which exposes *only* launcher data — never
  container detail, module state, or anything sensitive. Alongside it, `/certificate`
  hands out Caddy's internal root CA (`GET /api/caddy/root-certificate`) so a LAN device
  can trust `*.{BASE_DOMAIN}`. That one is public by necessity: the device that needs it
  has no admin password and cannot yet trust the HTTPS route it would log in over. It
  carries no key material — a root CA is meant to be installed by every device.
- **Admin tier — everything else.** The module tabs (Docker, Caddy, AdGuard, WireGuard) and
  Settings, plus every action. Behind the login.

### The gate is server-side, on the API

Hiding admin *pages* in the frontend is not security — the boundary is enforced in the
backend. **Every `/api/*` route requires a valid session except `GET /api/dashboard` and
`GET /api/caddy/root-certificate`.** This
is non-negotiable for endpoints like `WS /api/docker/containers/{id}/exec`, which is a root
shell into a container: a hidden React route would still leave it one WebSocket away from
anyone on the LAN. `shared/auth.py` is middleware that rejects unauthenticated `/api/*`
calls; the frontend `RequireAuth` wrapper is only UX (redirect to `/login`), never the
actual guard.

### Single-password auth (no accounts)

- **One admin password** — no users, no roles. A `POST /api/login` verifies it and issues a
  signed, `HttpOnly`, `SameSite` session cookie; `POST /api/logout` clears it.
- The password is set via `LOSKAI_PASSWORD` (env) or at first run, and stored **hashed**
  (argon2/bcrypt) — never plaintext. Unlike the AdGuard password (which Loskai must replay
  verbatim to AdGuard), Loskai's own password only needs verifying, so it is only ever
  stored as a hash.
- **Known tradeoff (deliberate):** the public dashboard reveals that the non-private services
  exist and lets anyone on the LAN/WireGuard click through to them (each service keeps its own
  auth). The `private` per-instance flag hides a service from the dashboard; Loskai being
  LAN-only (remote access via WireGuard) is the outer boundary.

### Infrastructure boundaries

- **Caddy Admin API** — port 2019 on the Caddy LXC must be firewalled so only the Docker
  host can reach it. Never expose it to the wider network.
- **Docker socket** — mounted read-write (required for container management). Loskai should
  be the only container with socket access.
- **AdGuard API** — port 3000 on the AdGuard LXC. A Proxmox firewall rule so only the Docker
  host's IP can reach it.
- **Reachability** — Loskai is only served on the LAN via `loskai.{BASE_DOMAIN}` over
  HTTPS; remote access is through WireGuard, never a public port.
- **Secrets** — service credentials and `LOSKAI_PASSWORD` live in `.env` (or the settings
  page), never committed. Loskai's own password is stored only as a hash.

---

## Testing & CI

Loskai is glue and logic around systems it should not touch in a test (a live Caddy,
AdGuard, the Docker daemon). The strategy follows one line:

> **Test the logic Loskai owns. Mock the systems it talks to. Verify the irreversible
> side effects with a disposable rig or by hand. Never test `httpx`/`docker-py` themselves.**

This only works because of the **`client.py` (I/O) vs logic (pure functions) seam** the
modules already keep — decision logic that never does I/O directly is testable without a
network. That seam is a testability requirement, held strictly everywhere.

- **Tier 1 — unit tests (`pytest`), the payoff.** Pure logic, fast, no network: the instance
  store and settings priority chain (against a `tmp_path`), FQDN assembly, the Caddy route
  builder + Caddyfile render, **the AdGuard reconcile logic** (`(domain, answer)` diffing,
  `dns_answer` orphan migration, manual-conflict detection — the trickiest code in the app),
  answer-IP derivation, recipe-manifest validation, and auth (hash/verify, session sign).
- **Tier 2 — client contract tests (`pytest-httpx`).** Mock the Caddy/AdGuard HTTP responses
  using the shapes from `docs/*-api.md`; assert the *request* Loskai builds and that it
  *parses* responses right, including the designed edges (delete-by-exact-pair, 404-ignored,
  `401`=reachable). These guard the API contracts against drift.
- **Tier 3 — disposable integration rig.** `compose.test.yml` spins up throwaway Caddy
  + AdGuard containers (a slim variant of the co-located stack) with Caddy `tls internal` (no
  ACME/DNS token — tests exercise the *APIs*, not browser TLS), ephemeral volumes, seeded and
  torn down per run. A few tests push a real route/rewrite and assert it lands. The Docker/
  `compose` side is too host-bound to rig — covered by a documented manual smoke checklist.
- **Frontend** — `Vitest` + React Testing Library on logic-bearing components only
  (`AssignModal` validation, the auth redirect, dashboard rendering). No Playwright/E2E.
- **CI — Forgejo Actions** (GitHub-Actions-compatible). `.forgejo/workflows/ci.yml` runs
  `pytest` + `vitest` on every push and marks the commit pass/fail; a one-time `act_runner`
  registered on the Forgejo instance executes it. Portable to GitHub unchanged.

The all-in-Docker **co-located deployment** (`compose.colocated.yml`: Loskai + Caddy
+ AdGuard as containers) doubles as the basis for the Tier-3 rig — and is itself a real
alternative to the Proxmox/LXC topology for anyone not running Proxmox.

---

## Future Ideas

- **Uptime monitoring** — ping each upstream and record response time history
- **Certificate Status** — surface each cert's expiry, issuer, and days remaining. With the
  default internal CA the `local` CA's expiry is readable from Caddy's PKI endpoints; a future
  public-ACME cert is not. To cover both uniformly, implement it as a **TLS probe**: open a
  TLS connection to a routed name (e.g. `loskai.{BASE_DOMAIN}:443`), read the served
  certificate's `notAfter` and issuer via Python's `ssl`. Host-independent, no Admin API
  dependency, reflects the live cert. Deferred until the core modules are done and functional.
- **Notification module** — alert on container crash, cert expiry, AdGuard outage
- **Multi-host** — lightweight read-only agent on a second Docker host,
  aggregated into the same dashboard
- **Tailscale module** — if WireGuard is ever replaced, swap in Tailscale
  MagicDNS management as Module 4
