# FlytDokk — TODO

---

## Phase 1 — Project Scaffolding
- [ ] Create `backend/` directory, init uv project (`uv init`), add `pyproject.toml`
- [ ] Add backend dependencies: fastapi, uvicorn[standard], httpx, pydantic-settings, sse-starlette
- [ ] Create `frontend/` directory, scaffold with Vite + React + TypeScript (`npm create vite`)
- [ ] Add frontend dependencies: react-router-dom, @tanstack/react-query, recharts, lucide-react, tailwindcss
- [ ] Configure Vite dev proxy: `/api/*` → `http://localhost:8000`
- [ ] Create `.env.example` with all vars — `CADDY_ADMIN_URL` (co-located vs remote), `ADGUARD_USER/PASSWORD`, `WIREGUARD_DASHBOARD_URL`
- [ ] Create `HISTORY.md`

---

## Phase 2 — Backend Foundation
- [ ] `backend/src/flytdokk/config.py` — pydantic-settings class, validate all env vars on startup, exit with clear message if required vars are missing
- [ ] `backend/src/flytdokk/main.py` — FastAPI app, register all routers, mount static files last (for SPA fallback)
- [ ] `backend/src/flytdokk/shared/health.py` — `GET /api/health` — polls each module client and returns aggregate status: `{ caddy, adguard, wireguard, docker }`
- [ ] Verify: `curl http://localhost:8000/api/health` returns JSON with all module states

---

## Phase 3 — Caddy Module
**Backend**
- [ ] `modules/caddy/client.py` — async httpx wrapper for Caddy Admin API (`:2019`)
  - `list_routes()` — GET /config/apps/http/servers/srv0/routes
  - `add_route(subdomain, upstream)` — POST route JSON
  - `delete_route(id)` — DELETE by @id
  - `toggle_route(id, enabled)` — PUT to enable/disable
  - `get_cert_info()` — parse cert expiry from Caddy config
  - `health()` — returns `healthy` / `unreachable`
- [ ] `modules/caddy/router.py` — FastAPI APIRouter at `/api/caddy`
  - `GET /api/caddy/routes`
  - `POST /api/caddy/routes`
  - `DELETE /api/caddy/routes/{id}`
  - `PUT /api/caddy/routes/{id}/toggle`
  - `GET /api/caddy/health`

**Frontend**
- [ ] `App.tsx` — React Router setup, sidebar layout with nav links for each module
- [ ] `lib/api.ts` — fetch wrapper with base URL, JSON error handling
- [ ] `lib/useHealth.ts` — React Query hook polling `/api/health` every 30s, exposes per-module status
- [ ] `components/shared/StatusBadge.tsx` — coloured pill: healthy / degraded / unreachable
- [ ] `components/shared/ModuleStatus.tsx` — banner shown when a module is unreachable
- [ ] `components/shared/ConfirmDialog.tsx` — generic confirm modal
- [ ] `pages/Caddy.tsx` — Caddy page, shows module status banner if unreachable
- [ ] `components/caddy/RouteList.tsx` — table of routes with toggle + delete actions
- [ ] `components/caddy/AssignModal.tsx` — form: subdomain input + upstream input (any `host:port` — Docker container, LAN IP, Proxmox, NAS, etc.), submit calls `/api/assign`
- [ ] `components/caddy/CertStatus.tsx` — cert expiry date + days remaining, warning at 30 days

---

## Phase 4 — AdGuard Module
**Backend**
- [ ] `modules/adguard/client.py` — async httpx wrapper for AdGuard REST API (Basic Auth)
  - `health()` — is AdGuard reachable?
  - `check_wildcard()` — is `*.yourdomain.duckdns.org` rewrite present?
  - `list_rewrites()`, `add_rewrite(domain, answer)`, `delete_rewrite(domain, answer)`
- [ ] `modules/adguard/router.py` — FastAPI APIRouter at `/api/adguard`
  - `GET /api/adguard/health` — reachable + wildcard present
  - `GET /api/adguard/rewrites`, `POST`, `DELETE`

**Frontend**
- [ ] `pages/AdGuard.tsx` — AdGuard page
- [ ] `components/adguard/AdGuardStatus.tsx` — health status + prominent link out to full AdGuard UI
- [ ] `components/adguard/WildcardCheck.tsx` — wildcard rewrite status, warning if missing
- [ ] `components/adguard/RewriteList.tsx` — list rewrites in sync with Caddy routes, delete action

---

## Phase 5 — WireGuard Module
**Backend**
- [ ] `modules/wireguard/client.py` — simple reachability check, no authentication
  - `health()` — HTTP ping to `WIREGUARD_DASHBOARD_URL`, returns `{ reachable: bool }`
- [ ] `modules/wireguard/router.py` — FastAPI APIRouter at `/api/wireguard`
  - `GET /api/wireguard/status` — is dashboard reachable + its URL

**Frontend**
- [ ] `pages/WireGuard.tsx` — WireGuard page
- [ ] `components/wireguard/WireGuardCard.tsx` — reachability status, prominent link out to wg-dashboard, static DNS reminder card (`192.168.10.101` + `1.1.1.1`)

---

## Phase 6 — Cross-Module URL Assignment
- [ ] `backend/src/flytdokk/shared/assign.py` — `POST /api/assign { subdomain, upstream }`
  - Step 1: Create Caddy route (required — abort if fails)
  - Step 2: Create AdGuard DNS rewrite (best-effort — warn but don't fail)
  - Returns: `{ caddy: ok|error, adguard: ok|error|skipped, url: "https://..." }`
- [ ] Wire `AssignModal.tsx` to `POST /api/assign`, show per-step result to user
- [ ] Make Assign URL modal accessible from both Caddy page and (later) Docker page

---

## Phase 7 — Deployment
- [ ] `Dockerfile` — multi-stage build:
  - Stage 1 (node:20-alpine): build frontend → `/app/dist`
  - Stage 2 (python:3.12-slim): install uv + backend deps + Docker CLI, copy dist to `./static`
- [ ] `docker-compose.colocated.yml` — FlytDokk + Caddy on the same Docker host (default setup)
- [ ] `docker-compose.remote.yml` — FlytDokk on a separate host, Caddy accessed by LAN IP
- [ ] `caddy/Dockerfile` — xcaddy build with DuckDNS plugin
- [ ] `caddy/Caddyfile` — wildcard cert, static routes for flytdokk + adguard, dynamic routes via Admin API
- [ ] Verify: `docker compose up` → open `http://localhost:8080`, all modules report health correctly

---

## Phase 8 — Docker Module
**Backend**
- [ ] `modules/docker/client.py` — docker-py wrapper
  - `list_containers()` — name, image, status, uptime, CPU%, RAM
  - `start/stop/restart/remove(id)`
  - `stream_logs(id)` — async generator for SSE
  - `get_host_stats()` — total CPU, RAM, disk
- [ ] `modules/docker/stacks.py` — directory-based stack manager
  - `list_stacks()` — scan `STACKS_DIR` for subdirs with `compose.yml`
  - `get_stack(name)` — read compose.yml + .env contents + container status
  - `stack_action(name, action)` — up/down/restart/pull via `docker compose` subprocess
  - `create_stack(name, compose_content, env_content)` — write files + run up -d
  - `update_stack_file(name, file, content)` — write compose.yml or .env
- [ ] `modules/docker/recipes/` — personal install recipes defined in code, one file per service
  - Each recipe defines: directory name, `compose.yml` content, required `.env` vars with defaults
  - Initial recipes: Grafana, Jellyfin, Nextcloud, Vaultwarden, Gitea, Uptime Kuma
- [ ] `modules/docker/router.py` — FastAPI APIRouter at `/api/docker`
  - `GET /api/docker/containers`
  - `POST /api/docker/containers/{id}/start|stop|restart`
  - `DELETE /api/docker/containers/{id}`
  - `GET /api/docker/containers/{id}/logs` (SSE)
  - `GET /api/docker/stacks`
  - `GET /api/docker/stacks/{name}`
  - `PUT /api/docker/stacks/{name}/file` (edit compose or .env)
  - `POST /api/docker/stacks/{name}/action` (up/down/restart/pull)
  - `DELETE /api/docker/stacks/{name}`
  - `GET /api/docker/recipes` (list available recipes)
  - `POST /api/docker/recipes/{name}/install` (run recipe wizard)
  - `GET /api/docker/stats`

**Frontend**
- [ ] `pages/Docker.tsx` — Docker page, two tabs: Containers and Stacks
- [ ] `components/docker/ContainerList.tsx` — table with name, image, status, uptime, CPU%, RAM, actions
- [ ] `components/docker/LogViewer.tsx` — SSE log stream, auto-scroll, copy button
- [ ] `components/docker/StackList.tsx` — list of discovered stacks with status + actions
- [ ] `components/docker/StackEditor.tsx` — side-by-side editor for compose.yml and .env
- [ ] `components/docker/InstallWizard.tsx` — multi-step modal: pick recipe → review what will be created → fill in required values → optionally assign URL → deploy
- [ ] `components/docker/StatsBar.tsx` — host CPU, RAM, disk usage summary

---

## Phase 9 — Polish
- [ ] Dark mode (Tailwind `dark:` classes, toggle stored in localStorage)
- [ ] Basic auth — add `basicauth` to Caddyfile (no code change in FlytDokk)
- [ ] Startup reconciliation — on `/api/health`, warn if Caddy routes exist without matching AdGuard rewrites
- [ ] Config export — `GET /api/export` returns JSON snapshot of all routes + rewrites
- [ ] Container label auto-discovery — detect `homelab.subdomain=X` label on start, auto-assign URL
