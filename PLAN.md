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
├── LXC 101 — AdGuard Home                     192.168.10.101
│   Runs: AdGuard natively
│   Ports: :53 (DNS), :3000 (Admin UI + API)
│
├── LXC 102 — WireGuard                        192.168.10.102
│   Runs: WireGuard + wg-easy or wg-dashboard
│   Ports: :51820/udp (WireGuard), :51821 (dashboard)
│
└── LXC 103 (or VM) — Docker Host              192.168.10.100
    Runs: Docker Engine
    └── flytdokk      ← the thing we are building
    └── caddy                ← reverse proxy
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
Manage all containers running on the Docker host. Install new apps from templates.
Monitor resource usage. This module works entirely via the Docker socket and has
zero dependency on Caddy, AdGuard, or WireGuard.

### Features

**Container Overview**
- Live list of all containers — name, image, status, uptime, CPU%, RAM usage
- Start / stop / restart per container
- Remove container (with confirmation)
- View live logs (streaming, last N lines)
- View container environment variables (read-only)
- Assigned URL shown inline if one exists (pulled from Caddy module)

**Installation Wizard**
- Template library of common self-hosted apps
  (Grafana, Nextcloud, Vaultwarden, Jellyfin, Gitea, Uptime Kuma, etc.)
- Each template defines: image, default ports, required env vars, volumes
- Wizard steps:
  1. Pick app from library (or enter custom image)
  2. Fill in required config (env vars, data path)
  3. Optionally assign a subdomain immediately (calls Caddy + AdGuard modules)
  4. Confirm → generates and runs a Compose stack
- Stacks stored as named Compose files in a managed directory
- Custom image support — enter any Docker Hub / GHCR image directly

**Stack Manager**
- View all managed Compose stacks
- Edit raw compose YAML in-browser (with validation)
- Pull latest image versions
- Stack-level start / stop / recreate

**Monitoring**
- Per-container CPU + RAM graph (last 1h)
- Aggregate host stats: total CPU, RAM, disk usage
- Container event log: started, stopped, crashed, restarted

### Independence
- Requires only: Docker socket mounted at `/var/run/docker.sock`
- If Caddy is down: Docker module works fully, assigned URLs just not shown
- If AdGuard is down: Docker module works fully
- No network calls outside the local host

### API Surface (internal, consumed by frontend)
```
GET  /api/docker/containers          list all containers + stats
GET  /api/docker/containers/:id      single container detail
POST /api/docker/containers/:id/start
POST /api/docker/containers/:id/stop
POST /api/docker/containers/:id/restart
DEL  /api/docker/containers/:id      remove container
GET  /api/docker/containers/:id/logs  stream logs (SSE)
GET  /api/docker/stacks              list managed compose stacks
POST /api/docker/stacks              create stack from template
PUT  /api/docker/stacks/:name        update stack yaml
DEL  /api/docker/stacks/:name        remove stack
GET  /api/docker/templates           list app templates
GET  /api/docker/stats               host-level resource summary
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
- Upstream: any `host:port` — Docker container name, LAN IP, or any reachable address
  - Docker container: `grafana:3000`
  - LAN device:       `192.168.10.50:5000`
  - Proxmox:          `192.168.10.10:8006`
  - Other LXC:        `192.168.10.101:3000`
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
- Requires only: Caddy Admin API reachable at `http://caddy:2019`
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
View and manage DNS rewrites on the AdGuard instance running on LXC 101.
This module works entirely via the AdGuard REST API over the LAN and has zero
dependency on Caddy, Docker, or WireGuard.

### Features

**DNS Rewrite Manager**
- List all current DNS rewrites
- Add rewrite: domain → IP or CNAME
- Delete rewrite
- Wildcard rewrite shown prominently at top
  (`*.myname.duckdns.org → 192.168.10.100` — the one that makes everything work)

**Query Log**
- Live view of recent DNS queries (last 100)
- Filterable by client IP, domain, status (allowed/blocked)
- Useful for debugging "why isn't my domain resolving"

**Stats Overview**
- Queries today, blocked today, block percentage
- Top queried domains
- Top blocked domains
- Top clients by query count

**Blocklist Manager**
- View enabled/disabled blocklists
- Enable / disable individual lists
- Add custom blocklist URL
- Trigger list update

**Status**
- AdGuard version
- Upstream DNS servers configured
- Protection enabled/disabled toggle

### Independence
- Requires only: AdGuard API reachable at `http://192.168.10.101:3000`
- If AdGuard LXC is down: module shows "AdGuard unreachable" banner,
  all other modules unaffected
- If Caddy is down: no effect
- If Docker module is down: no effect
- When assigning URLs via Caddy module: AdGuard module is called as a side effect,
  but Caddy route is still created even if this call fails

### API Surface (internal)
```
GET  /api/adguard/status         health + version
GET  /api/adguard/rewrites       list DNS rewrites
POST /api/adguard/rewrites       add rewrite
DEL  /api/adguard/rewrites       delete rewrite
GET  /api/adguard/stats          query stats
GET  /api/adguard/querylog       recent query log
GET  /api/adguard/filtering      blocklist status
POST /api/adguard/filtering      add/update blocklist
```

---

## Module 4 — WireGuard (Lightweight)

### Purpose
Lightweight companion — not a full WireGuard manager. The goal is only to surface
relevant info and provide quick actions that relate to the homelab context.
Full peer management stays in wg-easy or wg-dashboard.

### Features

**DNS Status Check**
- Calls the WireGuard dashboard API (if wg-easy or wg-dashboard is running on LXC 102)
- Shows the current DNS setting configured for WireGuard peers
- Warning if DNS is not pointing to AdGuard (`192.168.10.101`)
- One-click button to open wg-dashboard in a new tab

**Quick Info**
- Number of active peers (from wg-easy API if available)
- Last handshake times
- Link to full wg-dashboard

**DNS Reminder**
- Prominent notice if WireGuard DNS is not set to AdGuard
- Shows the correct value to set: `192.168.10.101, 1.1.1.1`
- This is especially useful after AdGuard's IP changes

### What It Does NOT Do
- No peer creation / deletion (use wg-dashboard for that)
- No key management
- No WireGuard config file editing

### Independence
- Requires: wg-easy or wg-dashboard API on LXC 102 (optional — module degrades gracefully)
- If WireGuard dashboard is not running: module shows static info + link, no live data
- If all other modules are down: WireGuard module still shows its last-known state

### API Surface (internal)
```
GET  /api/wireguard/status       peer count, last handshakes, DNS setting
GET  /api/wireguard/dns-check    is WireGuard DNS pointing at AdGuard?
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

```yaml
services:

  caddy:
    build: ./caddy             # custom build with DuckDNS plugin
    container_name: caddy
    ports:
      - "80:80"
      - "443:443/tcp"
      - "443:443/udp"
      - "2019:2019"            # Admin API — Docker network only
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data       # certs — must persist
      - caddy_config:/config
    environment:
      - DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
      - DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN}
    restart: unless-stopped
    networks:
      - homelab

  manager:
    image: ghcr.io/youruser/flytdokk:latest
    # build: ./manager        # use this during development
    container_name: flytdokk
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./stacks:/opt/stacks   # managed compose stacks stored here
    environment:
      # Caddy — container to container
      - CADDY_ADMIN_URL=http://caddy:2019

      # AdGuard — LXC 101 over LAN
      - ADGUARD_URL=http://192.168.10.101:3000
      - ADGUARD_USER=${ADGUARD_USER}
      - ADGUARD_PASSWORD=${ADGUARD_PASSWORD}

      # WireGuard dashboard — LXC 102 over LAN (optional)
      - WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821

      # General
      - DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN}
      - SERVER_LAN_IP=192.168.10.100
      - PORT=8080
    restart: unless-stopped
    networks:
      - homelab

networks:
  homelab:
    name: homelab
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
```

---

## Caddy Setup

### Dockerfile
```dockerfile
FROM caddy:builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/duckdns

FROM caddy:latest
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

### Caddyfile
```caddyfile
{
    admin 0.0.0.0:2019
}

*.{$DUCKDNS_DOMAIN}.duckdns.org {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }

    @flytdokk host flytdokk.{$DUCKDNS_DOMAIN}.duckdns.org
    handle @flytdokk {
        reverse_proxy flytdokk:8080
    }

    @adguard host adguard.{$DUCKDNS_DOMAIN}.duckdns.org
    handle @adguard {
        reverse_proxy 192.168.10.101:3000
    }

    # All other routes added dynamically via Admin API
}
```

---

## Environment Variables

```bash
# .env.example

DUCKDNS_TOKEN=your-duckdns-token
DUCKDNS_DOMAIN=myname               # just the name, not .duckdns.org

ADGUARD_USER=admin
ADGUARD_PASSWORD=changeme

# Optional — only if wg-easy or wg-dashboard is running
WIREGUARD_DASHBOARD_URL=http://192.168.10.102:51821
```

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
