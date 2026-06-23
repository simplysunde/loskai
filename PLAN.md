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
You type: proxmox.yourdomain.duckdns.org
You get:  HTTPS reverse proxy → 192.168.10.10:8006    (your Proxmox host)

You type: nas.yourdomain.duckdns.org
You get:  HTTPS reverse proxy → 192.168.10.50:5000    (your NAS)

You type: grafana.yourdomain.duckdns.org
You get:  HTTPS reverse proxy → grafana:3000          (Docker container)
```

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
  (same host)        (same host)      (192.168.10.101)
```

---

## Module 1 — Docker Manager

### Purpose
Two distinct functions: manage running containers on the Docker host, and provide
a personal install wizard for spinning up new services using your own curated,
tested recipes. This module works entirely via the Docker socket and has zero
dependency on Caddy, AdGuard, or WireGuard.

### Features

**Container Overview**
- Live list of all containers — name, image, status, uptime, CPU%, RAM usage
- Start / stop / restart per container
- Remove container (with confirmation)
- View live logs (streaming, last N lines)
- View container environment variables (read-only)
- Assigned URL shown inline if one exists (pulled from Caddy module)

**Stack Manager**
- Discovers stacks by scanning `STACKS_DIR` — each subdirectory with a `compose.yml`
  is a managed stack. The host directory is the source of truth, not FlytDokk.
- View all stacks with current status (up / down / partial)
- Stack-level start / stop / restart / pull latest images
- Edit `compose.yml` and `.env` in-browser
- `STACKS_DIR` is a configurable env var (e.g. `/opt/stacks`), mounted into the container

**Personal Install Wizard**
- A curated list of personal install recipes — not a generic community template store.
  These are your own tested setups for services you actually run.
- Each recipe is opinionated and complete: it knows the directory structure,
  the exact `compose.yml`, and which `.env` vars need to be filled in.
- Wizard steps per recipe:
  1. Show what will be created (directory, compose, env vars)
  2. Fill in required values (data path, passwords, ports — with your preferred defaults)
  3. Optionally assign a subdomain (calls Caddy + AdGuard modules)
  4. Confirm → creates directory, writes `compose.yml` + `.env`, runs `docker compose up -d`
- Example recipes: Grafana, Jellyfin, Nextcloud, Vaultwarden, Gitea, Uptime Kuma
- Recipes are defined in code — add new ones by writing a recipe file, not via UI

**Monitoring**
- Per-container CPU + RAM graph (last 1h)
- Aggregate host stats: total CPU, RAM, disk usage
- Container event log: started, stopped, crashed, restarted

### Independence
- Requires only: Docker socket mounted at `/var/run/docker.sock` (read-write)
- Must run on the same host as Docker Engine
- If Caddy is down: Docker module works fully, URL assignment step skipped with warning
- If AdGuard is down: Docker module works fully
- No network calls outside the local host

### API Surface (internal, consumed by frontend)
```
GET  /api/docker/containers                list all containers + stats
POST /api/docker/containers/:id/start
POST /api/docker/containers/:id/stop
POST /api/docker/containers/:id/restart
DEL  /api/docker/containers/:id
GET  /api/docker/containers/:id/logs       stream logs (SSE)
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
Manage all reverse proxy routes. Assign a URL to any container instantly.
This module works entirely via Caddy's Admin API and has zero dependency on
AdGuard, WireGuard, or the Docker module.

### Features

**Route List**
- All active Caddy routes in a clean table
- Each row: subdomain → upstream (container:port), status, toggle, delete
- Enable / disable individual routes without deleting them
- Upstream health shown (Caddy reports this via `/reverse_proxy/upstreams`)

**Assign URL**
- Input: subdomain prefix (e.g. `grafana`)
- Domain suffix auto-filled from config (`myname.duckdns.org`)
- Upstream: any `host:port` reachable from LXC 101 — LAN IP + exposed port
  - Docker container: `192.168.10.100:3000`  (port must be exposed on the host)
  - LAN device:       `192.168.10.50:5000`
  - Proxmox:          `192.168.10.10:8006`
  - FlytDokk itself:  `192.168.10.100:8080`
- One click → Caddy route + AdGuard DNS rewrite created, HTTPS live immediately
- Optional: simultaneously write AdGuard rewrite (if AdGuard module is healthy)

**Certificate Status**
- Current wildcard cert expiry date
- Days remaining, with warning at 30 days
- Cert issuer info

**Raw Config View**
- Read-only view of the current Caddy JSON config
- Useful for debugging

### Independence
- Requires only: Caddy Admin API reachable at `CADDY_ADMIN_URL` (default: `http://192.168.10.101:2019`)
- If AdGuard is down: routes can still be created/deleted, DNS rewrite step is
  skipped with a warning shown to the user
- If Docker module is down: routing works fully, container name must be typed manually
- If WireGuard is down: no effect whatsoever

### How Routes Are Stored
Routes are written to Caddy's live config via the Admin API. Caddy persists them
in the `caddy_config` volume. FlytDokk does NOT maintain its own route database —
Caddy is the source of truth. On startup, the frontend fetches the current route
list directly from Caddy.

### API Surface (internal)
```
GET  /api/caddy/routes           list all routes
POST /api/caddy/routes           create route
DEL  /api/caddy/routes/:id       remove route
PUT  /api/caddy/routes/:id/toggle  enable/disable
GET  /api/caddy/health           caddy status + cert info
GET  /api/caddy/upstreams        upstream health from caddy
```

### Caddy Route JSON (what gets sent to Caddy Admin API)
```json
{
  "@id": "grafana",
  "match": [{ "host": ["grafana.myname.duckdns.org"] }],
  "handle": [{
    "handler": "subroute",
    "routes": [{
      "handle": [{
        "handler": "reverse_proxy",
        "upstreams": [{ "dial": "grafana:3000" }]
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
confirming the wildcard rewrite is in place, staying in sync with Caddy routes,
and linking out to AdGuard for everything else.

### Features

**Link out (most important)**
- Prominent button to open the full AdGuard UI in a new tab
- AdGuard's own UI handles query logs, stats, blocklists, upstream config, etc.

**Health & Wildcard Check**
- Is AdGuard reachable?
- Is the wildcard rewrite (`*.yourdomain.duckdns.org → 192.168.10.100`) in place?
  Shown prominently — warning if missing, since everything depends on it

**Rewrite List**
- List existing DNS rewrites so you can see what's in sync with Caddy routes
- Delete a rewrite if needed
- Rewrites are primarily created automatically via the Assign URL action —
  manual add is available but not the main flow

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
User: assign "grafana.myname.duckdns.org" → grafana:3000

Step 1 — Caddy route (REQUIRED)
  POST http://caddy:2019/config/apps/http/servers/srv0/routes
  → If this fails: abort, show error, do not proceed

Step 2 — AdGuard rewrite (BEST EFFORT)
  POST http://192.168.10.101:3000/control/rewrite/add
  → If this fails: route was still created in Caddy
  → Show warning: "Route created, DNS rewrite failed — add manually in AdGuard"
  → Because the wildcard *.myname.duckdns.org already covers all subdomains,
    this failure rarely matters in practice

Result shown to user:
  ✅ Caddy route created
  ✅ AdGuard rewrite created   (or ⚠️ AdGuard unreachable — wildcard covers this)
  🔗 https://grafana.myname.duckdns.org
```

---

## Tech Stack

### Backend — Node.js with Fastify
- Fast, low overhead, runs well in Alpine Docker image
- Excellent Docker socket libraries (dockerode)
- Easy to add WebSocket / SSE for live logs and stats
- Simple to structure as independent service modules

```
src/server/
├── index.js                 entry point, registers all routes
├── config.js                env var validation + defaults
├── modules/
│   ├── docker/
│   │   ├── client.js        dockerode wrapper
│   │   ├── routes.js        Fastify route handlers
│   │   ├── templates.js     app template library
│   │   └── stats.js         resource monitoring
│   ├── caddy/
│   │   ├── client.js        Caddy Admin API wrapper
│   │   └── routes.js
│   ├── adguard/
│   │   ├── client.js        AdGuard REST API wrapper
│   │   └── routes.js
│   └── wireguard/
│       ├── client.js        wg-easy/wg-dashboard API wrapper
│       └── routes.js
└── shared/
    ├── health.js            aggregate health checks
    └── assign.js            cross-module URL assignment logic
```

### Frontend — React + Vite
- Tailwind CSS for styling
- React Query for data fetching + caching
- Recharts for CPU/RAM graphs
- Lucide React for icons
- Module pages are fully independent routes — `/docker`, `/caddy`, `/adguard`, `/wireguard`

```
src/client/
├── main.jsx
├── App.jsx                  router setup
├── pages/
│   ├── Docker.jsx
│   ├── Caddy.jsx
│   ├── AdGuard.jsx
│   └── WireGuard.jsx
├── components/
│   ├── shared/
│   │   ├── StatusBadge.jsx
│   │   ├── ModuleStatus.jsx  shows degraded state per module
│   │   └── ConfirmDialog.jsx
│   ├── docker/
│   │   ├── ContainerList.jsx
│   │   ├── ContainerRow.jsx
│   │   ├── LogViewer.jsx
│   │   ├── InstallWizard.jsx
│   │   └── StackEditor.jsx
│   ├── caddy/
│   │   ├── RouteList.jsx
│   │   ├── AssignModal.jsx
│   │   └── CertStatus.jsx
│   ├── adguard/
│   │   ├── RewriteList.jsx
│   │   ├── QueryLog.jsx
│   │   └── StatsPanel.jsx
│   └── wireguard/
│       └── DnsCheck.jsx
└── lib/
    ├── api.js               fetch wrapper
    └── useHealth.js         module health polling hook
```

### Single Docker Image
The Vite build output is served as static files by Fastify.
One image, one container, one port.

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # builds frontend into /app/dist

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
EXPOSE 8080
CMD ["node", "src/server/index.js"]
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
      - ${STACKS_DIR}:/opt/stacks
    environment:
      # Caddy — LXC 101 over LAN (port 2019 firewalled to this host only)
      - CADDY_ADMIN_URL=http://192.168.10.101:2019

      # AdGuard — LXC 101 over LAN
      - ADGUARD_URL=http://192.168.10.101:3000
      - ADGUARD_USER=${ADGUARD_USER}
      - ADGUARD_PASSWORD=${ADGUARD_PASSWORD}

      # WireGuard dashboard — LXC 102 over LAN (optional, no auth required)
      - WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821

      # General
      - DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN}
      - PORT=8080
    restart: unless-stopped
```

---

## Caddy Setup (runs natively on LXC 101)

### Install
```bash
# Install Caddy with DuckDNS plugin via xcaddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-xcaddy-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-xcaddy.list
apt update && apt install xcaddy
xcaddy build --with github.com/caddy-dns/duckdns --output /usr/bin/caddy
```

### Caddyfile
```caddyfile
{
    admin 0.0.0.0:2019          # firewalled — only LXC 103 (192.168.10.100) can reach this
}

*.{$DUCKDNS_DOMAIN}.duckdns.org {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }

    @flytdokk host flytdokk.{$DUCKDNS_DOMAIN}.duckdns.org
    handle @flytdokk {
        reverse_proxy 192.168.10.100:8080
    }

    @adguard host adguard.{$DUCKDNS_DOMAIN}.duckdns.org
    handle @adguard {
        reverse_proxy 192.168.10.101:3000
    }

    # All other routes added dynamically via Admin API
}
```

---

## Alternative Setups

The preferred setup runs Caddy natively on LXC 101 alongside AdGuard. Two simpler
alternatives exist and will have their own install instructions:

- **Co-located** — Caddy runs as a Docker container on LXC 103 alongside FlytDokk
- **All-in-one** — AdGuard, Caddy, and FlytDokk all on the same LXC

---

## Environment Variables

```bash
# .env.example

DUCKDNS_TOKEN=your-duckdns-token
DUCKDNS_DOMAIN=myname               # just the name, not .duckdns.org

# Caddy Admin API — on LXC 101, firewalled to this host only
# Preferred (Caddy on LXC 101):      http://192.168.10.101:2019
# Alternative (Caddy co-located):    http://caddy:2019
CADDY_ADMIN_URL=http://192.168.10.101:2019

# AdGuard — LXC over LAN
ADGUARD_URL=http://192.168.10.101:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=changeme

# Optional — only if wg-easy or wg-dashboard is running
WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821
```

Different deployment setups are supported via different compose files
(e.g. `docker-compose.colocated.yml`, `docker-compose.remote.yml`).
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

### Phase 1 — Infrastructure
- [ ] Create LXC 101, install AdGuard natively, configure DNS rewrite + upstream
- [ ] Create LXC 102, install WireGuard + wg-easy (or reuse existing)
- [ ] Create LXC 103, install Docker Engine
- [ ] Update WireGuard peer DNS: `192.168.10.101, 1.1.1.1`
- [ ] Update router DHCP DNS: `192.168.10.101`
- [ ] Deploy Caddy with DuckDNS plugin, confirm wildcard cert issues successfully
- [ ] Verify `https://anything.myname.duckdns.org` resolves locally with valid cert

### Phase 2 — Backend Skeleton
- [ ] Fastify project setup + TypeScript or JSDoc types
- [ ] Config module — validate all env vars on startup, log which services are configured
- [ ] Health endpoint — `GET /api/health` returns status of all four modules
- [ ] Docker client module (dockerode) — list containers, basic actions
- [ ] Caddy client module — list routes, add route, delete route
- [ ] AdGuard client module — list rewrites, add, delete
- [ ] WireGuard client module — status from wg-easy API (degraded if not available)
- [ ] Shared assign logic — `POST /api/assign` (Caddy first, AdGuard best-effort)

### Phase 3 — Docker Module
- [ ] Container list with stats (CPU, RAM, uptime, status)
- [ ] Start / stop / restart / remove endpoints
- [ ] Log streaming via SSE
- [ ] Template library (10–15 common apps to start)
- [ ] Installation wizard endpoint — generates + runs Compose stack
- [ ] Stack manager — list, edit, recreate managed stacks

### Phase 4 — Caddy Module
- [ ] Route list from Caddy Admin API
- [ ] Add route (with optional AdGuard side effect)
- [ ] Delete route
- [ ] Toggle route enable/disable
- [ ] Cert expiry info
- [ ] Upstream health passthrough

### Phase 5 — AdGuard Module
- [ ] Rewrite list, add, delete
- [ ] Stats panel (queries, blocked, top domains)
- [ ] Query log viewer
- [ ] Blocklist manager

### Phase 6 — WireGuard Module
- [ ] Peer list + handshake times from wg-easy API
- [ ] DNS check — is WireGuard DNS pointing at AdGuard?
- [ ] Link out to full wg-dashboard
- [ ] Graceful static fallback if wg-easy not available

### Phase 7 — Frontend
- [ ] App shell — sidebar nav, module status indicators in header
- [ ] Docker page
- [ ] Caddy page
- [ ] AdGuard page
- [ ] WireGuard page
- [ ] Install wizard modal
- [ ] Assign URL modal (reachable from Docker and Caddy pages)
- [ ] Log viewer component (streaming)
- [ ] CPU/RAM graphs (Recharts)

### Phase 8 — Polish
- [ ] Basic auth on manager (Caddy `basicauth` directive — one line)
- [ ] Dark mode
- [ ] Startup reconciliation — warn if Caddy routes and AdGuard rewrites are out of sync
- [ ] Config export — dump all routes + rewrites as JSON backup
- [ ] Label-based auto-discovery:
      container label `homelab.subdomain=grafana` → auto-assign on container start

---

## Resilience Summary

| Failure | Impact | Mitigation |
|---|---|---|
| AdGuard LXC down | DNS stops resolving | `1.1.1.1` fallback in WireGuard; AdGuard module shows unreachable |
| Caddy container crashes | HTTPS stops | `restart: unless-stopped` |
| FlytDokk container crashes | Can't manage; all services keep running | `restart: unless-stopped`; Caddy + AdGuard are unaffected |
| Docker host reboots | Brief outage on LXC 103 | `restart: unless-stopped` on all containers |
| WireGuard LXC down | Remote access lost; LAN still works | Separate LXC isolates blast radius |

**Core property:** FlytDokk is never in the data path.
Caddy routes traffic. AdGuard resolves DNS. FlytDokk only configures them.
If FlytDokk is down, all services keep running exactly as before.

---

## Security Notes

- **Caddy Admin API** — never expose port 2019 outside Docker network.
  Manager talks to it container-to-container only.
- **Docker socket** — mounted read-only. Manager can read state and stream logs
  but cannot modify the Docker daemon configuration.
- **AdGuard API** — on the LAN. Consider a Proxmox firewall rule so only
  LXC 103's IP can reach LXC 101 port 3000.
- **Manager UI** — protected by Caddy `basicauth`. Only reachable via
  `flytdokk.myname.duckdns.org` over HTTPS, accessible only through WireGuard
  or locally.
- **Secrets** — all in `.env`, never committed. Passed as environment variables
  to containers.

---

## Future Ideas

- **App template store** — community-contributed templates pulled from a repo
- **Uptime monitoring** — ping each upstream and record response time history
- **Notification module** — alert on container crash, cert expiry, AdGuard outage
- **Multi-host** — lightweight read-only agent on a second Docker host,
  aggregated into the same dashboard
- **Tailscale module** — if WireGuard is ever replaced, swap in Tailscale
  MagicDNS management as Module 4
