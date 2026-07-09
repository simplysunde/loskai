# FlytDokk — Project Plan

## Vision

A single Docker container that acts as the control plane for your entire homelab.

> **FlytDokk** — from Norwegian *flyt* (flow) and *dokk* (dock).
> *Deploy, route, done.*
It has four independent modules — Docker, Caddy, AdGuard, and WireGuard — each of
which works on its own. You can use just the Docker manager without touching AdGuard.
You can manage Caddy routes without the Docker manager open. Nothing depends on
another module being healthy to function.

### The core idea — name any service on your LAN

FlytDokk + Caddy + AdGuard together let you assign a clean, memorable HTTPS name
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

Any service on your LAN gets a clean HTTPS name. You manage this in one place —
FlytDokk configures both Caddy and AdGuard in a single action.

You configure this in one place — FlytDokk's Assign URL form — and it sets up
both the Caddy route and the AdGuard DNS rewrite automatically.

---

## Infrastructure (What Already Exists / Will Exist)

```
Proxmox Host
│
├── LXC 101 — Network Services                 192.168.10.101
│   Runs: AdGuard Home (DNS) + Caddy (reverse proxy)  ← preferred setup
│   Ports: :53 (DNS), :3000 (AdGuard UI + API)
│          :80/:443 (Caddy), :2019 (Caddy Admin API — firewalled to LXC 103 only)
│
├── LXC 102 — WireGuard                        192.168.10.102
│   Runs: WireGuard + wg-easy or wg-dashboard
│   Ports: :51820/udp (WireGuard), :51821 (dashboard)
│
└── LXC 103 (or VM) — Docker Host              192.168.10.100
    Runs: Docker Engine
    └── flytdokk      ← the thing we are building
    └── your app containers  ← grafana, nextcloud, etc.
```

---

## Application Overview

The FlytDokk is one Docker image that serves a web UI.
Internally it is split into four modules. Each module has:

- Its own backend service class (isolated API client)
- Its own frontend section/page
- Its own health check
- Graceful degradation if the external service is unreachable

```
┌──────────────────────────────────────────────────────────────────┐
│                      FlytDokk                            │
│                    (single Docker image)                        │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐     │
│  │    MODULE 1    │  │    MODULE 2    │  │    MODULE 3    │     │
│  │    Docker      │  │     Caddy      │  │   AdGuard      │     │
│  │    Manager     │  │    Routing     │  │     DNS        │     │
│  └────────────────┘  └────────────────┘  └────────────────┘     │
│                                                                  │
│  ┌────────────────┐                                              │
│  │    MODULE 4    │                                              │
│  │   WireGuard    │                                              │
│  │   (lightweight)│                                              │
│  └────────────────┘                                              │
│                                                                  │
│  Each module:                                                    │
│  ✓ Works independently                                          │
│  ✓ Shows degraded state if service unreachable                  │
│  ✓ Never blocks other modules from loading                      │
└──────────────────────────────────────────────────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
  Docker Socket       Caddy :2019      AdGuard :3000
  (same host)       (LXC 101 LAN)    (LXC 101 LAN)
```

---

## Core Data Model — Instances

FlytDokk's one persistent domain object is the **instance**: a named service it knows
about. A Docker container and an external LAN service are just two `type`s of the same
structure, so they live in a single list that the Docker Manager and the Caddy routing
view both read.

```jsonc
{
  "id":        "grafana",        // stable slug — also the Caddy @id
  "name":      "Grafana",        // display name
  "type":      "docker",         // "docker" | "external"
  "subdomain": "grafana",        // route prefix (null = tracked, no route assigned)
  "upstream":  "192.168.10.100:3000",  // host:port — chosen at assign time
  "container": "grafana"         // container name/id (docker type only; null for external)
}
```

- **Docker instance** — backed by a real container; `container` links it to live data.
- **External ("dummy") instance** — Proxmox, a NAS, any `IP:port`. No `container`,
  just an `upstream`.
- An instance may exist **without** a subdomain (tracked but not exposed). The route
  table is exactly the subset of instances that *have* a subdomain.

**What is stored vs. live:**
- The instance list holds only **intent** — subdomain, upstream, and external targets.
  It is a flat JSON file, `/opt/flytdokk/instances.json`, in the settings volume
  (same pattern as `settings.json`; no database).
- **Runtime state** (container status, CPU, RAM, ports) is never stored — it is read
  live from the Docker socket and **joined in at display time** via `container`. This
  keeps the store from ever drifting out of sync with reality.

**How instances are created:**
- **Automatically** — on container discovery, a `flytdokk.subdomain=<prefix>` label
  auto-creates / updates a docker instance (see Phase 9 label auto-discovery).
- **Manually** — added through the UI, either a docker instance or an external one.
- **Seeded** — on first run, if `ADGUARD_URL` is set to a valid target and no AdGuard
  instance exists yet, one is created: an `external` instance pointing at that IP:port,
  defaulting to the `adguard` subdomain so its route is created out of the box (replacing
  the old hand-written Caddyfile route). Seeding is **create-if-absent, once** — after that
  the AdGuard instance is a completely ordinary `external` instance: rename its subdomain,
  edit its upstream, or delete it, and the change sticks (it is never re-asserted on later
  boots). FlytDokk's own UI needs no seeding: it is a normal container on the Docker host,
  discovered as a plain `docker` instance like any other — no special-casing.

Both paths write to the same list, and Caddy routes + the Caddyfile export are both
rendered from it. Because FlytDokk and AdGuard are ordinary instances, they carry no
reserved status — the normal subdomain-uniqueness rule prevents collisions.

### How the instance list connects the modules

The instance list is the shared spine the modules read from and write to. It is local
state (a JSON file), always available — so touching it never introduces a cross-module
runtime dependency. The graceful-degradation guarantees (each module still works when an
*external* service is down) are unchanged.

| Module | Relationship to the instance list |
|---|---|
| **Docker Manager** | Surfaces each container as a `docker` instance (live data joined via `container`); creating a service or assigning a URL writes an instance |
| **Caddy Routing** | Reads instances that have a `subdomain` and pushes them as routes; owns that projection. External instances need no container at all |
| **AdGuard DNS** | For each instance-with-subdomain, best-effort creates the matching DNS rewrite; reads rewrites back from AdGuard to show which instances are in sync |
| **WireGuard** | None — a standalone status card, not part of the instance model |

```
                       ┌───────────────────────┐
                       │     instances.json     │   ← the shared spine
                       │  (id, type, subdomain, │
                       │   upstream, container) │
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
its instance record by `container`, so a container's assigned subdomain shows inline and
"Assign URL" here writes the same instance the Caddy module routes from.

### Features

**Container Overview**
- Live list of all containers — name, image, status, uptime, CPU%, RAM usage
- Start / stop / restart per container
- Remove container (with confirmation)
- View live logs (streaming, last N lines)
- View container environment variables (read-only)
- Assigned URL shown inline if one exists (from the container's instance `subdomain`)
- "Assign URL" action on any container — creates/updates its `docker` instance and routes it

**Stack Manager**

A browser front-end over `docker compose` — the same thing as SSH-ing in and running
compose by hand, minus the SSH. It runs the real `docker compose` CLI against the host
daemon; it invents no new deployment method.

- **One directory, one variable.** FlytDokk watches exactly one directory, `STACKS_DIR`
  (default `/opt/stacks`). Every immediate subdirectory with a `compose.yml` is a stack.
  There is no separate "manual" vs "managed" location — a stack is *managed* purely by
  virtue of living in `STACKS_DIR`.
- **The filesystem is the only source of truth.** FlytDokk keeps no database of stacks.
  Editing a file in the browser and editing it over SSH touch the same file — the two are
  fully interchangeable, and FlytDokk never locks or "owns" a stack. SSH stays a
  first-class equal, never a hidden lock-in.
- View all stacks with current status (up / down / partial), computed by matching the
  `com.docker.compose.project` label on running containers against the declared services.
- Stack-level start / stop / restart / pull-and-update (`docker compose pull` + `up -d`)
- Create a stack manually (write/paste a `compose.yml` in the browser) — the freeform
  counterpart to the recipe-driven Install Wizard
- Edit `compose.yml` and `.env` in-browser, then re-`up` to apply
- Delete a stack (`down` + remove the directory, with confirmation)

> **Same-path mount (important).** `STACKS_DIR` must be bind-mounted at the **same path**
> inside the container as on the host (`${STACKS_DIR}:${STACKS_DIR}`), not remapped to a
> different path. FlytDokk's compose CLI resolves bind-mount paths and hands them to the
> host daemon, so the in-container path must equal the host path or volumes get created in
> the wrong place. See the compose file below.

**Personal Install Wizard**
- A curated list of personal install recipes — not a generic community template store.
  These are your own tested setups for services you actually run.
- Each recipe is opinionated and complete: it knows the directory structure,
  the exact `compose.yml`, and which `.env` vars need to be filled in.
- Wizard steps per recipe:
  1. Show what will be created (directory, compose, env vars)
  2. Fill in required values (data path, passwords, ports — with your preferred defaults)
  3. Optionally assign a subdomain (records it on the new `docker` instance, then calls
     the Caddy + AdGuard modules)
  4. Confirm → creates directory, writes `compose.yml` + `.env`, runs the install steps,
     and registers the service as a `docker` instance
- Recipes are defined in code — add new ones by writing a recipe file, not via UI

**Recipe types — three patterns supported:**

1. **Pull** — standard pre-built public image, just `docker compose up -d`
   - Used for: Grafana, Jellyfin, Nextcloud, Vaultwarden, Gitea, Uptime Kuma, etc.

2. **Git + build** — clones a repo then builds the image locally
   - Recipe specifies a `git_repo` URL, runs `git clone` then `docker compose up -d --build`
   - Used for: services that require source customisation or have no pre-built image

3. **Private registry pull** — pulls from your self-hosted Gitea container registry
   - Image is already built and pushed to Gitea (`gitea.yourdomain/user/app:latest`)
   - Recipe pulls like any other image — no build step at install time
   - Recommended pattern for your own personal apps: build once, push to Gitea, deploy anywhere

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

Two views over one host, at two granularities:
- **Container Overview** — *every* running container (live, from the socket), whatever
  started it. Runtime control + logs + terminal.
- **Stack Manager** — only the compose projects in `STACKS_DIR` (the ones with editable
  files). A stack container shows in both views; a bare `docker run` container shows only
  in Container Overview (nothing to edit — it has no compose file).

| ✅ Can do | ❌ Can't do (by design) |
|---|---|
| List all running containers with live stats | Manage containers on **other hosts** (single host, for now) |
| Start / stop / restart / remove any container | Edit config of a container with **no compose file** |
| Stream logs, open a browser terminal, quick commands | Be a full Portainer (no network / volume / image-management UI) |
| Discover, start/stop/restart, and **pull-update** stacks | See stacks **outside** `STACKS_DIR` |
| Create a stack (wizard *or* manual browser compose) | Do anything without the **socket mounted** |
| Edit `compose.yml` / `.env`, delete a stack | Build/manage arbitrary images (only recipe builds + pull) |
| Host CPU / RAM / disk; assign a URL to a container | |

Everything is compose-based: even a single-container app is a one-service `compose.yml`,
so there are no special cases. Recovery/escape hatch is always plain SSH + `docker compose`.

### Independence
- Requires only: Docker socket mounted at `/var/run/docker.sock` (read-write)
- Must run on the same host as Docker Engine
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
GET  /api/docker/recipes                   list available install recipes
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

### Features

**Route List**
- Every instance that has a subdomain, in a clean table (this is the route table)
- Each row: subdomain → upstream (host:port), synced + live status, delete
- **Synced status** — FlytDokk fetches Caddy's live routes (`GET …/routes`) and checks each
  instance's `@id` against them. Present = synced; missing = not pushed (offer "Push all").
  This is a **read-only comparison for display only** — it never auto-corrects, so it can't
  reintroduce a drift/reconcile loop.
- **Live status** — upstream reachability, from Caddy's `/reverse_proxy/upstreams`
- "Push all to Caddy" button — rebuilds every route from the instance list (recovery
  after Caddy lost its config)

**Assign URL**
- Input: subdomain **prefix only** (e.g. `grafana`) — a single DNS label
  (lowercase letters, digits, hyphens; must be unique)
- Domain suffix auto-filled from the global `BASE_DOMAIN` setting (e.g. `example.no`)
- UI shows the assembled FQDN live as you type: `grafana` → `grafana.example.no`
- Single-label only — keeps every name under the one `*.BASE_DOMAIN` wildcard cert
  (`app.team.example.no` would need a separate `*.team.example.no` cert, which the
  wildcard does not cover)
- Upstream: any `host:port` reachable from LXC 101 — LAN IP + exposed port
  - Docker container: `192.168.10.100:3000`  (port must be exposed on the host)
  - LAN device:       `192.168.10.50:5000`
  - Proxmox:          `192.168.10.10:8006`
  - FlytDokk itself:  `192.168.10.100:8080`
- One click (`POST /api/assign`) → Caddy route created (required), HTTPS live immediately;
  the AdGuard DNS rewrite is written best-effort in the same call (skipped with a warning
  if AdGuard is unhealthy — the wildcard rewrite already covers the name)

**Certificate Status**
- Current wildcard cert expiry date
- Days remaining, with warning at 30 days
- Cert issuer info
- ⚠️ Verify first: cert metadata is NOT in Caddy's `/config`. Confirm the Admin API
  exposes cert expiry (it may not) before building this — otherwise drop the feature.

**Raw Config View**
- Read-only view of the current Caddy JSON config
- Useful for debugging

**Caddyfile Export**
- Generates a complete, runnable Caddyfile from the instance list (every instance
  that has a subdomain)
- Rendered from FlytDokk's own model, NOT from Caddy's JSON — Caddy adapts
  Caddyfile → JSON but has no JSON → Caddyfile converter
- Includes the wildcard TLS block + `admin` block (templated from `BASE_DOMAIN`),
  so the output is directly usable — e.g. to bootstrap the co-located / all-in-one setups
- Available as a file download or copy-to-clipboard

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

| `CADDY_ADMIN_URL` value | Mode | Upstream format |
|---|---|---|
| `http://caddy:2019` | Docker network (co-located) | Container names work: `grafana:3000` |
| `http://192.168.10.101:2019` | LAN IP (preferred/external) | LAN IP required: `192.168.10.100:3000` |

The backend client is identical in both cases — it just hits whatever URL is configured.
On startup, config.py logs which mode is active.

The frontend reads the resolved mode from `GET /api/caddy/health` and adjusts the
upstream input hint in the Assign URL modal accordingly:
- Docker mode → "e.g. grafana:3000"
- LAN mode → "e.g. 192.168.10.100:3000"

### How Routes Are Stored — derived from the instance list

Routes are not stored as their own thing. A route is simply an **instance** (see
[Core Data Model](#core-data-model--instances)) that has a `subdomain` assigned. The
Caddy live config is a **projection** of "every instance with a subdomain" — FlytDokk
pushes those to Caddy via the Admin API by `id` (= Caddy `@id`). The exact endpoints are
documented in [`docs/caddy-api.md`](../docs/caddy-api.md).

- **Flat sibling routes.** Each route is an independent top-level entry in the server's
  `routes` array, matching a single specific host (`grafana.example.no`) and keyed by
  `@id`. No nesting under a wildcard site block — the wildcard exists only for the cert.
  Specific hosts are disjoint, so append order never matters.
- A route exists when an instance has a subdomain; it's gone when the subdomain is
  cleared or the instance is deleted. There is no enable/disable state — routes are binary.
- **Route identity:** the instance `id` is used verbatim as Caddy's `@id`. Add is
  `POST …/routes`, delete is `DELETE /id/<id>`, and **editing an existing route is just
  delete-then-add** (not `PATCH`) — one code path that always converges, and re-pushing
  never creates duplicates.
- **Persistence is automatic.** Caddy autosaves its full config to disk after *every* API
  change and runs with `caddy run --resume`, so it restores that autosave on start. A
  normal LXC / Proxmox reboot or Caddy restart brings every route back with **no action
  from FlytDokk**.
- **Backstop:** the instance list (`instances.json`) is the durable record. "Push all to
  Caddy" re-creates every route from it — but only needed in the rare case where Caddy's
  autosave itself is gone (fresh Caddy, wiped data dir), not on a normal reboot.
- **Ownership rule:** FlytDokk manages every route whose `@id` matches an instance — which
  now includes its own UI and AdGuard, since both are ordinary instances. The bootstrap
  Caddyfile defines **no** routes of its own; any route a human adds directly to Caddy
  without a matching instance `@id` is simply left alone by the per-route push.

### API Surface (internal)

The Caddy module is **read + push only**. Assigning or clearing a subdomain is a
cross-module action and lives at `POST` / `DELETE /api/assign` (see
[The "Assign URL" Action](#the-assign-url-action--cross-module-coordination)) — the Caddy
module never writes a single route on its own.

```
GET  /api/caddy/routes           list instances that have a subdomain (the route table)
POST /api/caddy/push             re-push all routes from the instance list to Caddy
GET  /api/caddy/caddyfile        export complete runnable Caddyfile (text/plain)
GET  /api/caddy/health           caddy status + mode (`docker` | `lan`) + cert info (if available)
GET  /api/caddy/upstreams        upstream health from caddy
```

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

---

## Module 3 — AdGuard DNS

### Purpose
Lightweight companion to AdGuard — not a replacement for its UI. AdGuard already
has a fully featured web UI; this module only covers what's relevant to FlytDokk:
confirming the wildcard rewrite is in place, staying in sync with the routed
instances (those with a `subdomain`), and linking out to AdGuard for everything else.

### Features

**Link out (most important)**
- Prominent button to open the full AdGuard UI in a new tab
- AdGuard's own UI handles query logs, stats, blocklists, upstream config, etc.

**Health & Wildcard Check**
- Is AdGuard reachable?
- Is the wildcard rewrite (`*.example.no → 192.168.10.100`) in place?
  Shown prominently — warning if missing, since everything depends on it

**Rewrite List**
- List existing DNS rewrites so you can see which routed instances are in sync
- Delete a rewrite if needed
- Rewrites are primarily created automatically via the Assign URL action —
  manual add is available but not the main flow

**Sync with the instance list**
- AdGuard is its own source of truth for rewrites — FlytDokk reads them straight from
  AdGuard and shows which instances have a matching rewrite
- "Push all to Caddy" also best-effort re-adds any missing rewrites for instances that
  have a subdomain
- Because the wildcard `*.example.no` already covers every subdomain, a missing
  per-name rewrite is cosmetic; this sync is best-effort and never blocks a route

### Independence
- Requires only: AdGuard API reachable at `ADGUARD_URL`
- If AdGuard LXC is down: module shows "AdGuard unreachable" + link to open UI,
  all other modules unaffected
- When assigning URLs via Caddy module: AdGuard is called as a side effect,
  Caddy route is still created even if this call fails

### API Surface (internal)
```
GET  /api/adguard/health         reachable + wildcard rewrite present
GET  /api/adguard/rewrites       list DNS rewrites
POST /api/adguard/rewrites       add rewrite (used by assign URL flow)
DEL  /api/adguard/rewrites       delete rewrite
```

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
- Shows online / unreachable status

**DNS reminder (static)**
- A static reminder card showing the correct DNS value to set in wg-dashboard:
  `192.168.10.101` (AdGuard) + `1.1.1.1` (fallback)
- Not fetched from the API — just a persistent reminder since this is
  the most common misconfiguration

### What It Does NOT Do
- No API authentication — no password, no token
- No peer list, no handshake times (use wg-dashboard for that)
- No peer creation / deletion / key management
- Not part of the instance model — it stores nothing and reads nothing from
  `instances.json`; it is a pure status card standing on its own

### Independence
- Requires only: `WIREGUARD_DASHBOARD_URL` env var (optional)
- If not configured or unreachable: shows static DNS reminder + greyed-out link
- No credentials needed, nothing to break

### API Surface (internal)
```
GET  /api/wireguard/status       is dashboard reachable? returns { reachable: bool, url: str }
```

---

## The "Assign URL" Action — Cross-Module Coordination

This is the one place where modules coordinate. When a user assigns a URL
(from either the Docker Manager or the Caddy module), this happens:

```
User: enters prefix "grafana" → upstream 192.168.10.100:3000
      (FlytDokk assembles grafana + BASE_DOMAIN = grafana.example.no)

Step 0 — Persist intent (REQUIRED)
  Set subdomain="grafana" + upstream on the instance and save instances.json
  → The instance list is the durable record; Caddy and AdGuard are pushed from it

Step 1 — Caddy route (REQUIRED)
  POST http://192.168.10.101:2019/config/apps/http/servers/<server>/routes  (@id = instance id)
  → <server> is discovered at startup (GET .../servers), not hardcoded to srv0
  → If this fails: abort, roll back the subdomain, show error

Step 2 — AdGuard rewrite (BEST EFFORT)
  POST http://192.168.10.101:3000/control/rewrite/add
  → If this fails: route was still created in Caddy
  → Show warning: "Route created, DNS rewrite failed — add manually in AdGuard"
  → Because the wildcard *.example.no already covers all subdomains,
    this failure rarely matters in practice

Result shown to user:
  ✅ Caddy route created
  ✅ AdGuard rewrite created   (or ⚠️ AdGuard unreachable — wildcard covers this)
  🔗 https://grafana.example.no
```

**Clearing a URL** (`DELETE /api/assign/:id`, from the route list's delete or the Docker
Manager) is the exact mirror: clear the instance's `subdomain` and save, delete the Caddy
route (`DELETE /id/<id>`, required), then best-effort remove the AdGuard rewrite. The
instance itself survives — it just no longer has a route.

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
backend/src/flytdokk/
├── main.py                  FastAPI app, registers routers, serves static files last
├── config.py                pydantic-settings: validates all env vars on startup
├── modules/
│   ├── caddy/
│   │   ├── client.py        httpx wrapper for Caddy Admin API
│   │   └── router.py        FastAPI APIRouter
│   ├── adguard/
│   │   ├── client.py        httpx wrapper for AdGuard REST API
│   │   └── router.py
│   ├── wireguard/
│   │   ├── client.py        simple reachability check
│   │   └── router.py
│   └── docker/              Phase 8
│       ├── client.py        docker-py wrapper
│       ├── stacks.py        directory-based stack manager
│       ├── recipes/         personal install recipes (one file per service)
│       ├── quick_commands.py  image-name → preset terminal commands map
│       └── router.py
└── shared/
    ├── health.py            GET /api/health — polls all module clients
    ├── assign.py            POST/DELETE /api/assign — assign & clear a subdomain;
    │                        Caddy required, AdGuard best-effort, both directions
    ├── instances.py        read/write instances.json — the instance list (route intent)
    └── settings.py          read/write settings.json, merge with env vars, priority chain
```

### Frontend — React + TypeScript + Vite
- Tailwind CSS for styling
- React Query for data fetching + caching
- Recharts for CPU/RAM graphs (Docker module, Phase 8)
- Lucide React for icons
- Module pages are fully independent routes — `/caddy`, `/adguard`, `/wireguard`, `/docker`

```
frontend/src/
├── main.tsx
├── App.tsx                  React Router setup
├── pages/
│   ├── Caddy.tsx
│   ├── AdGuard.tsx
│   ├── WireGuard.tsx
│   ├── Settings.tsx
│   └── Docker.tsx           Phase 8
├── components/
│   ├── shared/
│   │   ├── StatusBadge.tsx
│   │   ├── ModuleStatus.tsx  degraded/unreachable banner per module
│   │   └── ConfirmDialog.tsx
│   ├── caddy/
│   │   ├── RouteList.tsx        instances that have a subdomain, + "Push all to Caddy"
│   │   ├── AssignModal.tsx
│   │   ├── CaddyfileExport.tsx  download / copy-to-clipboard Caddyfile
│   │   └── CertStatus.tsx
│   ├── adguard/
│   │   ├── AdGuardStatus.tsx
│   │   ├── WildcardCheck.tsx
│   │   └── RewriteList.tsx
│   ├── wireguard/
│   │   └── WireGuardCard.tsx
│   └── docker/              Phase 8
│       ├── ContainerList.tsx
│       ├── LogViewer.tsx
│       ├── Terminal.tsx         xterm.js browser terminal (WebSocket exec)
│       ├── QuickCommands.tsx    preset command buttons above the terminal
│       ├── StackList.tsx
│       ├── StackEditor.tsx
│       ├── InstallWizard.tsx
│       └── StatsBar.tsx
└── lib/
    ├── api.ts               fetch wrapper
    └── useHealth.ts         React Query hook, polls /api/health every 30s
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
CMD ["uv", "run", "uvicorn", "flytdokk.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## Docker Compose (LXC 103 — Docker Host)

Caddy is not a Docker container in the preferred setup — it runs natively on LXC 101.
Only FlytDokk and your app containers run here.

```yaml
services:

  flytdokk:
    image: ghcr.io/youruser/flytdokk:latest
    # build: .                 # use this during development
    container_name: flytdokk
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      # Same path inside and out — the compose CLI hands bind paths to the host daemon,
      # so in-container path must equal host path or stack volumes land in the wrong place
      - ${STACKS_DIR:-/opt/stacks}:${STACKS_DIR:-/opt/stacks}
      - ./flytdokk-settings:/opt/flytdokk   # persists settings.json + instances.json
    environment:
      # Caddy — LXC 101 over LAN (port 2019 firewalled to this host only)
      - CADDY_ADMIN_URL=http://192.168.10.101:2019

      # AdGuard — LXC 101 over LAN
      - ADGUARD_URL=http://192.168.10.101:3000
      - ADGUARD_USER=${ADGUARD_USER}
      - ADGUARD_PASSWORD=${ADGUARD_PASSWORD}

      # WireGuard dashboard — LXC 102 over LAN (optional, no auth required)
      - WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821

      # General (optional — can be set in UI settings page instead)
      - BASE_DOMAIN=${BASE_DOMAIN}          # e.g. example.no
      - PORT=8080
      # Note: the ACME/DNS-challenge token (DuckDNS, Cloudflare, …) lives on LXC 101
      # in Caddy's environment — FlytDokk never needs it
    restart: unless-stopped
```

---

## Caddy Setup (runs natively on LXC 101)

### HTTPS and the wildcard cert — out of scope for the app

FlytDokk only needs to know the `BASE_DOMAIN` string (e.g. `example.no`). *How* the
wildcard `*.BASE_DOMAIN` cert is obtained is a one-time LXC 101 infrastructure step and
has no impact on FlytDokk's application code — Caddy's Admin API works identically
regardless of the cert method.

The ACME DNS challenge provider depends on your domain:
- `example.no` and other real domains → your registrar's DNS or Cloudflare, etc.
- a free `*.duckdns.org` name → the DuckDNS plugin

Either way Caddy must be built with the matching `caddy-dns` plugin (via xcaddy) and
given that provider's API token in its own environment on LXC 101. The LXC helper script
(`scripts/create-lxc101.sh`, Phase 7) handles the xcaddy build and Caddyfile. During
development, a plain HTTP Caddyfile is sufficient.

### Install (for reference — handled by the Phase 7 LXC script)
```bash
# Build Caddy with your DNS provider's plugin via xcaddy (DuckDNS shown as one example)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-xcaddy-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-xcaddy.list
apt update && apt install xcaddy
xcaddy build --with github.com/caddy-dns/duckdns --output /usr/bin/caddy   # swap plugin for your provider
```

Caddy is run as a systemd service with **`caddy run --resume`**. Because Caddy autosaves
its full config to disk after every Admin API change, `--resume` restores every route on
restart with no action from FlytDokk — this is the normal reboot path. "Push all to Caddy"
(rebuilding routes from `instances.json`) is only the rare-case backstop for when that
autosave is gone (fresh Caddy, wiped data dir). See [`docs/caddy-api.md`](../docs/caddy-api.md).

### Caddyfile (bootstrap only — all routes come from FlytDokk via the Admin API)

The bootstrap Caddyfile defines **no routes at all** — only the admin endpoint and the
wildcard cert. The wildcard site block exists solely to obtain the `*.BASE_DOMAIN` cert; it
has no handlers, so it is not a routing catch-all. Every route, including FlytDokk's own UI
and AdGuard, is a specific-host route pushed at runtime from the instance list — they are
all flat siblings reusing this one cert.

```caddyfile
{
    admin 0.0.0.0:2019          # firewalled — only the Docker host (192.168.10.100) can reach this
}

# Obtain the wildcard *.BASE_DOMAIN cert once, via DNS challenge. No handlers → cert only.
*.{$BASE_DOMAIN} {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}   # swap provider + token to match your domain
    }
}

# No routes here. FlytDokk pushes every specific-host route (flytdokk, adguard,
# grafana, …) at runtime via the Admin API, each reusing the wildcard cert above.
```

> **Cold-start recovery.** On a brand-new Caddy with an empty autosave, no routes exist yet,
> so `flytdokk.{$BASE_DOMAIN}` doesn't resolve. Reach FlytDokk directly at
> `http://192.168.10.100:8080` and click **"Push all to Caddy"** — that seeds every route,
> including its own. After that, autosave + `--resume` keep them across restarts.

---

## Alternative Setups

The preferred setup runs Caddy natively on LXC 101 alongside AdGuard. Two simpler
alternatives exist and will have their own install instructions:

- **Co-located** — Caddy runs as a Docker container on LXC 103 alongside FlytDokk
- **All-in-one** — AdGuard, Caddy, and FlytDokk all on the same LXC

---

## Settings & Configuration

All service connection settings can be configured in two ways — both are optional:

### Priority chain (highest to lowest)
1. **Environment variable** — set in `.env` or compose file, read on startup, takes precedence
2. **UI settings page** — configured in FlytDokk's settings page, persisted to `settings.json`
3. **Unset** — module shows "not configured" and links to the settings page

This means you can skip the `.env` entirely and configure everything through the app
on first run. Or use env vars to pre-populate. Both work.

### Configurable settings

| Setting | Env var | Description |
|---|---|---|
| Caddy Admin URL | `CADDY_ADMIN_URL` | `http://192.168.10.101:2019` (LAN) or `http://caddy:2019` (Docker) |
| AdGuard URL | `ADGUARD_URL` | `http://192.168.10.101:3000` |
| AdGuard username | `ADGUARD_USER` | Basic auth username |
| AdGuard password | `ADGUARD_PASSWORD` | Basic auth password |
| WireGuard dashboard URL | `WIREGUARD_DASHBOARD_URL` | Optional |
| Stacks directory | `STACKS_DIR` | Host path for Docker stacks, e.g. `/opt/stacks` |
| Base domain | `BASE_DOMAIN` | Your domain, e.g. `example.no` — service prefixes are appended to this |

The ACME/DNS-challenge token (DuckDNS, Cloudflare, …) is used by Caddy directly on
LXC 101 — FlytDokk never needs it. In the co-located alternative (Caddy as Docker
container), it would be passed to the Caddy container, not to FlytDokk. **No env var
is required by FlytDokk itself** — everything can be configured via the settings page
on first run.

### Settings persistence

Settings are stored in `/opt/flytdokk/settings.json` inside the container,
backed by a mounted volume (the same volume also holds `instances.json`). Env-var-set
values are shown as read-only in the UI with a "set via environment" indicator — they
cannot be overridden from the UI.

```yaml
# docker-compose.yml (settings volume)
volumes:
  - ./flytdokk-settings:/opt/flytdokk
```

### settings.json shape
```json
{
  "caddy_admin_url": "http://192.168.10.101:2019",
  "adguard_url": "http://192.168.10.101:3000",
  "adguard_user": "admin",
  "adguard_password": "...",
  "wireguard_dashboard_url": "http://192.168.10.102:51821",
  "stacks_dir": "/opt/stacks",
  "base_domain": "example.no"
}
```

### Backend API
```
GET  /api/settings        returns all settings with source: "env" | "stored" | "unset"
PUT  /api/settings        update stored settings (env-sourced values ignored)
```

### .env.example (all optional — configure here or in the UI settings page)
```bash
# The ACME/DNS-challenge token is set on LXC 101 (Caddy's environment), not here

BASE_DOMAIN=example.no
CADDY_ADMIN_URL=http://192.168.10.101:2019
ADGUARD_URL=http://192.168.10.101:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=changeme
WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821
STACKS_DIR=/opt/stacks
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
| Caddy crashes | HTTPS stops | Caddy runs as a systemd service on LXC 101 — auto-restarts with `--resume`, restoring all routes from its autosave with no action needed; "Push all to Caddy" rebuilds from `instances.json` only if the autosave itself is lost |
| FlytDokk container crashes | Can't manage; all services keep running | `restart: unless-stopped`; Caddy + AdGuard are unaffected |
| Docker host reboots | Brief outage on LXC 103 | `restart: unless-stopped` on all containers |
| WireGuard LXC down | Remote access lost; LAN still works | Separate LXC isolates blast radius |

**Core property:** FlytDokk is never in the data path.
Caddy routes traffic. AdGuard resolves DNS. FlytDokk only configures them.
If FlytDokk is down, all services keep running exactly as before.

---

## Security Notes

- **Caddy Admin API** — port 2019 on LXC 101 must be firewalled so only
  LXC 103 (192.168.10.100) can reach it. Never expose it to the wider network.
- **Docker socket** — mounted read-write (required for container management).
  FlytDokk should be the only container with socket access.
- **AdGuard API** — port 3000 on LXC 101. Consider a Proxmox firewall rule so
  only LXC 103's IP can reach it.
- **Manager UI** — protect with Caddy `basicauth`. Only reachable via
  `flytdokk.example.no` over HTTPS, accessible only through WireGuard or locally.
- **Secrets** — all in `.env`, never committed. Passed as environment variables
  to containers.

---

## Future Ideas

- **Uptime monitoring** — ping each upstream and record response time history
- **Notification module** — alert on container crash, cert expiry, AdGuard outage
- **Multi-host** — lightweight read-only agent on a second Docker host,
  aggregated into the same dashboard
- **Tailscale module** — if WireGuard is ever replaced, swap in Tailscale
  MagicDNS management as Module 4
