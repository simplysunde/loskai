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
  4. Confirm → creates directory, writes `compose.yml` + `.env`, runs the install steps
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

### Independence
- Requires only: Docker socket mounted at `/var/run/docker.sock` (read-write)
- Must run on the same host as Docker Engine
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
Manage all reverse proxy routes. Assign a URL to any container instantly.
This module works entirely via Caddy's Admin API and has zero dependency on
AdGuard, WireGuard, or the Docker module.

### Features

**Route List**
- All active Caddy routes in a clean table
- Each row: subdomain → upstream (host:port), status, toggle, delete
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
- If Docker module is down: routing works fully, LAN IP:port must be entered manually
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

### How Routes Are Stored
Routes are written to Caddy's live config via the Admin API. Caddy persists them
in its config storage. FlytDokk does NOT maintain its own route database —
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
User: assign "grafana.myname.duckdns.org" → 192.168.10.100:3000

Step 1 — Caddy route (REQUIRED)
  POST http://192.168.10.101:2019/config/apps/http/servers/srv0/routes
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

### Backend — Python + FastAPI + uv
- Async, fast, excellent for API services
- httpx for async HTTP calls to Caddy and AdGuard
- docker-py for Docker socket management
- pydantic-settings for env var validation
- sse-starlette for SSE log streaming

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
│   └── docker/              Phase 2
│       ├── client.py        docker-py wrapper
│       ├── stacks.py        directory-based stack manager
│       ├── recipes/         personal install recipes (one file per service)
│       └── router.py
└── shared/
    ├── health.py            GET /api/health — polls all module clients
    ├── assign.py            POST /api/assign — Caddy required, AdGuard best-effort
    └── settings.py          read/write settings.json, merge with env vars, priority chain
```

### Frontend — React + TypeScript + Vite
- Tailwind CSS for styling
- React Query for data fetching + caching
- Recharts for CPU/RAM graphs (Docker module, Phase 2)
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
│   └── Docker.tsx           Phase 2
├── components/
│   ├── shared/
│   │   ├── StatusBadge.tsx
│   │   ├── ModuleStatus.tsx  degraded/unreachable banner per module
│   │   └── ConfirmDialog.tsx
│   ├── caddy/
│   │   ├── RouteList.tsx
│   │   ├── AssignModal.tsx
│   │   └── CertStatus.tsx
│   ├── adguard/
│   │   ├── AdGuardStatus.tsx
│   │   ├── WildcardCheck.tsx
│   │   └── RewriteList.tsx
│   ├── wireguard/
│   │   └── WireGuardCard.tsx
│   └── docker/              Phase 2
│       ├── ContainerList.tsx
│       ├── LogViewer.tsx
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
RUN apt-get update && apt-get install -y docker.io docker-compose-plugin && rm -rf /var/lib/apt/lists/*
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
      - ${STACKS_DIR:-/opt/stacks}:/opt/stacks
      - ./flytdokk-settings:/opt/flytdokk   # persists settings.json
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
      - DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN}
      - PORT=8080
      # Note: DUCKDNS_TOKEN is set on LXC 101 (Caddy's environment) — not needed here
    restart: unless-stopped
```

---

## Caddy Setup (runs natively on LXC 101)

### DuckDNS and HTTPS — out of scope for now

This is a LAN-only solution. DuckDNS wildcard certs require Caddy to be built with
the DuckDNS plugin (xcaddy), which is a one-time infrastructure step handled when
setting up LXC 101. It has no impact on FlytDokk's application code — Caddy's Admin
API works identically with or without the DuckDNS plugin.

The LXC helper script (`scripts/create-lxc101.sh`) in Phase 7 will handle the
xcaddy build and DuckDNS Caddyfile configuration. During development, a plain
HTTP Caddyfile is sufficient.

### Install (for reference — handled by the Phase 7 LXC script)
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
| Domain | `DUCKDNS_DOMAIN` | Your DuckDNS name (without `.duckdns.org`) |

`DUCKDNS_TOKEN` is used by Caddy directly on LXC 101 — FlytDokk never needs it.
In the co-located alternative (Caddy as Docker container), it would be passed to
the Caddy container, not to FlytDokk. No env var is strictly required by FlytDokk
itself — everything can be configured via the settings page on first run.

### Settings persistence

Settings are stored in `/opt/flytdokk/settings.json` inside the container,
backed by a mounted volume. Env-var-set values are shown as read-only in the UI
with a "set via environment" indicator — they cannot be overridden from the UI.

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
  "domain": "myname"
}
```

### Backend API
```
GET  /api/settings        returns all settings with source: "env" | "stored" | "unset"
PUT  /api/settings        update stored settings (env-sourced values ignored)
```

### .env.example (all optional — configure here or in the UI settings page)
```bash
# DUCKDNS_TOKEN is set on LXC 101 (Caddy's environment), not here

DUCKDNS_DOMAIN=myname
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
| Caddy crashes | HTTPS stops | Caddy runs as a systemd service on LXC 101 — auto-restarts |
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
  `flytdokk.yourdomain.duckdns.org` over HTTPS, accessible only through WireGuard
  or locally.
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
