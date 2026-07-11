# FlytDokk — TODO

---

## Phase 1 — Project Scaffolding
- [ ] Create `backend/` directory, init uv project (`uv init`), add `pyproject.toml`
- [ ] Add backend dependencies: fastapi, uvicorn[standard], httpx, pydantic-settings, sse-starlette
- [ ] Create `frontend/` directory, scaffold with Vite + React + TypeScript (`npm create vite`)
- [ ] Add frontend dependencies: react-router-dom, @tanstack/react-query, recharts, lucide-react, tailwindcss, xterm, @xterm/addon-fit
- [ ] Configure Vite dev proxy: `/api/*` → `http://localhost:8000`
  - Note: backend runs on `:8000` in dev (Vite proxies to it); the production container serves on `:8080`
- [ ] Create `.env.example` — all vars optional; `BASE_DOMAIN` (e.g. `example.no`) is the domain. The ACME/DNS-challenge token belongs to Caddy on LXC 101, not FlytDokk
- [x] Create `HISTORY.md`

---

## Phase 2 — Backend Foundation
- [ ] `backend/src/flytdokk/shared/settings.py` — settings manager
  - Reads env vars on startup (highest priority)
  - Falls back to `settings.json` at `/opt/flytdokk/settings.json`
  - Returns each value with source: `"env"` | `"stored"` | `"unset"`
  - Manages: `caddy_admin_url`, `adguard_url`/`user`/`password`, `wireguard_dashboard_url`, `base_domain`, `caddy_host_ip` (optional — DNS-rewrite answer IP; derived from `caddy_admin_url` host when omitted), `recipes_repo_url` (optional — public git repo the install wizard syncs recipes from)
  - `stacks_dir` is **env-only** (drives the compose bind mount) — read from env, defaults to `/opt/stacks`, never written to `settings.json`; surfaced read-only on the settings page
- [ ] `backend/src/flytdokk/shared/instances.py` — instance list at `/opt/flytdokk/instances.json`
  - Flat JSON file (same pattern as `settings.json`), no database
  - Each instance: `{ id, name, type: "docker"|"external", subdomain, upstream, container, dns_answer }` (`dns_answer` = Caddy IP last written to AdGuard for this name; null if no rewrite pushed)
  - `id` doubles as the Caddy `@id`; `subdomain` null = tracked but no route
  - CRUD helpers (list / get / upsert / delete)
- [ ] `backend/src/flytdokk/config.py` — pydantic-settings class; **no env var required** at startup, all optional
- [ ] `backend/src/flytdokk/main.py` — FastAPI app, register all routers, mount static files last (for SPA fallback)
- [ ] `backend/src/flytdokk/shared/health.py` — `GET /api/health` — polls each module client and returns aggregate status: `{ caddy, adguard, wireguard, docker }`
  - Docker status also carries `stacks_dir_ok` (from `stacks.py`) so the UI can surface "stacks directory not found — check the compose mount" instead of a silently empty Stack Manager
- [ ] `GET /api/settings` — returns all settings with source field
- [ ] `PUT /api/settings` — updates `settings.json` (env-sourced values ignored)
- [ ] Verify: `curl http://localhost:8000/api/health` returns JSON with all module states (dev backend on `:8000`; prod container on `:8080`)

---

## Phase 3 — Caddy Module
**Backend**
- [ ] `modules/caddy/client.py` — async httpx wrapper for the Caddy Admin API (push side only)
  - `server_name()` — GET /config/apps/http/servers, cache the single key (e.g. `srv0`) at startup; never hardcode it
  - `list_live_routes()` — GET /config/apps/http/servers/{server}/routes (Caddy's current state)
  - `push_route(id, host, upstream)` — POST route JSON tagged with `@id` (append to the server's routes)
  - `delete_route(id)` — DELETE /id/{id} (ignore 404 — route may not be pushed yet)
  - `get_mode()` — `"docker"` if CADDY_ADMIN_URL host is a name, `"lan"` if an IP — frontend upstream hint
  - `health()` — returns `healthy` / `unreachable`
  - `upstreams()` — GET /reverse_proxy/upstreams (upstream liveness for the route list)
- [ ] `modules/caddy/service.py` — read + push only; owns the projection, not assignment
  - `list_with_sync()` — instances that have a subdomain, each annotated with synced (`@id` present in `list_live_routes()`) + live (`upstreams()`) status; read-only comparison, never auto-corrects
  - `push_all()` — push every instance that has a subdomain to Caddy (recovery / one-click resync). Only touches routes whose `@id` matches an instance — leaves any human-added route with a non-instance `@id` alone
  - `render_caddyfile()` — generate a complete, runnable Caddyfile from the instances that have a subdomain (TLS + admin block templated from `base_domain`)
  - Note: assigning / clearing a subdomain lives in `shared/assign.py` (Phase 6), not here — the Caddy module never writes a single route on its own
- [ ] `modules/caddy/router.py` — FastAPI APIRouter at `/api/caddy` (read + push only)
  - `GET /api/caddy/routes` — instances that have a subdomain, annotated with synced + live status
  - `POST /api/caddy/push` — `push_all()`
  - `GET /api/caddy/caddyfile` — export Caddyfile (text/plain)
  - `GET /api/caddy/health` — status + mode (`docker` | `lan`)
  - `GET /api/caddy/upstreams` — upstream liveness
- [ ] Persistence: Caddy runs with `caddy run --resume` (its own config survives restarts);
  `push_all()` is the backstop if that config is ever lost — no reconcile/drift loop needed

**Frontend**
- [ ] `App.tsx` — React Router setup, sidebar layout with nav links for each module + Settings
- [ ] `pages/Settings.tsx` — settings page: form for all service URLs and credentials
  - Env-var-set fields shown as read-only with "set via environment" label
  - Editable fields saved via `PUT /api/settings`
  - Modules with unset required URLs show a banner linking to this page
- [ ] `lib/api.ts` — fetch wrapper with base URL, JSON error handling
- [ ] `lib/useHealth.ts` — React Query hook polling `/api/health` every 30s, exposes per-module status
- [ ] `components/shared/StatusBadge.tsx` — coloured pill: healthy / degraded / unreachable
- [ ] `components/shared/ModuleStatus.tsx` — banner shown when a module is unreachable
- [ ] `components/shared/ConfirmDialog.tsx` — generic confirm modal
- [ ] `pages/Caddy.tsx` — Caddy page, shows module status banner if unreachable
- [ ] `components/caddy/RouteList.tsx` — table of instances that have a subdomain: assembled FQDN, upstream, synced + live status, delete (`DELETE /api/assign/{id}`); "Push all to Caddy" button (`POST /api/caddy/push`) for recovery
- [ ] `components/caddy/AssignModal.tsx` — form: prefix input (single DNS label, validated + uniqueness) showing assembled `prefix.base_domain` live, + upstream input (any `host:port` — Docker container, LAN IP, Proxmox, NAS, etc.). For a bare LAN target it creates an external ("dummy") instance; from the Docker page it assigns to the selected container's instance. Submit calls `/api/assign`
- [ ] `components/caddy/CaddyfileExport.tsx` — download + copy-to-clipboard of `GET /api/caddy/caddyfile`
- [ ] _(deferred)_ `components/caddy/CertStatus.tsx` — cert expiry + days remaining. Out of current scope; when revisited, implement via a TLS probe to a routed name (read the served cert's `notAfter`), not the Admin API — see PLAN.md Future Ideas

---

## Phase 4 — AdGuard Module
_Contract: [docs/adguard-api.md](docs/adguard-api.md). Explicit per-instance rewrites, no wildcard rewrite; answer = Caddy LAN IP (host of `CADDY_ADMIN_URL`, or `CADDY_HOST_IP` fallback)._
**Backend**
- [ ] `modules/adguard/client.py` — async httpx wrapper for AdGuard `/control` API (Basic Auth)
  - `health()` — `GET /control/status`, reachable + `running`
  - `list_rewrites()` — `GET /control/rewrite/list`
  - `add_rewrite(domain, answer)` — `POST /control/rewrite/add`
  - `delete_rewrite(domain, answer)` — `POST /control/rewrite/delete` (exact `{domain, answer}` pair — never match-by-domain, so manual rewrites are safe)
  - editing a rewrite is delete-then-add (no `PUT /rewrite/update`)
- [ ] `reconcile_rewrites()` — for each routed instance ensure `(domain, currentIP)` exists; if its stored `dns_answer` differs, delete the stale `(domain, dns_answer)` pair (orphan migration) and update `dns_answer`; leave + flag same-domain entries whose answer matches neither `currentIP` nor `dns_answer` (manual conflict). Runs on "Push all" and when an IP change is detected on startup
- [ ] Write each instance's `dns_answer` whenever a rewrite is added; clear it when the rewrite is removed (no separate state file — it lives on the instance)
- [ ] `modules/adguard/router.py` — FastAPI APIRouter at `/api/adguard`
  - `GET /api/adguard/health` — reachable
  - `GET /api/adguard/rewrites`, `POST`, `DELETE` (DELETE carries `{domain, answer}`)

**Frontend**
- [ ] `pages/AdGuard.tsx` — AdGuard page
- [ ] `components/adguard/AdGuardStatus.tsx` — health status + prominent link out to full AdGuard UI
- [ ] `components/adguard/RewriteList.tsx` — per-instance rewrites, read-only sync status vs instances, delete action

---

## Phase 5 — WireGuard Module
**Backend**
- [ ] `modules/wireguard/client.py` — simple reachability check, no authentication
  - `health()` — HTTP ping to `WIREGUARD_DASHBOARD_URL`, returns `{ reachable: bool }` (any HTTP response = reachable, incl. `401`/`403`; only connection failure/timeout = unreachable)
- [ ] `modules/wireguard/router.py` — FastAPI APIRouter at `/api/wireguard`
  - `GET /api/wireguard/status` — is dashboard reachable + its URL

**Frontend**
- [ ] `pages/WireGuard.tsx` — WireGuard page
- [ ] `components/wireguard/WireGuardCard.tsx` — reachability status, prominent link out to wg-dashboard, DNS reminder card (host of `ADGUARD_URL` + `1.1.1.1`; generic guidance if `ADGUARD_URL` unset)

---

## Phase 6 — Cross-Module URL Assignment
- [ ] `backend/src/flytdokk/shared/assign.py` — the one place assignment lives; orchestrates
      the Caddy client + AdGuard client + instance store (Caddy module never writes routes itself)
  - `POST /api/assign { instance_id, prefix, upstream }`
    - Handles both existing instances (a container) and new external ("dummy") instances
    - Step 0: validate single-label prefix + uniqueness; set subdomain/upstream on the instance + save `instances.json`
    - Step 1: push Caddy route via `client.push_route` (required — abort + roll back the subdomain if it fails)
    - Step 2: create AdGuard DNS rewrite `{domain, answer: caddy_host_ip}` (best-effort — warn but don't fail; the name won't resolve on the LAN until it lands)
    - Returns: `{ caddy: ok|error, adguard: ok|error|skipped, url: "https://prefix.base_domain" }`
  - `DELETE /api/assign/{instance_id}` — the mirror: clear the instance's subdomain + save,
    `client.delete_route` (required), then best-effort remove the AdGuard rewrite; instance survives
- [ ] Wire `AssignModal.tsx` to `POST /api/assign` and the route-list delete to `DELETE /api/assign/{id}`, show per-step result to user
- [ ] Make Assign URL modal accessible from both Caddy page and (later) Docker page

---

## Phase 7 — Deployment

**Infrastructure scripts**
- [ ] `scripts/create-lxc101.sh` — Proxmox host script (run from Proxmox shell via `bash create-lxc101.sh`)
  - Creates Debian LXC with sensible defaults (ID, memory, disk, network)
  - Starts the container and runs setup inside it via `pct exec`
  - Installs AdGuard Home (official installer script)
  - Installs xcaddy, builds Caddy with DuckDNS plugin, installs to `/usr/bin/caddy`
  - Drops a starter `Caddyfile` at `/etc/caddy/Caddyfile`
  - Enables `caddy` and `adguardhome` as systemd services
  - Prints next steps: set DuckDNS token in Caddyfile, open AdGuard UI to finish setup

**FlytDokk container**
- [ ] `Dockerfile` — multi-stage build:
  - Stage 1 (node:20-alpine): build frontend → `/app/dist`
  - Stage 2 (python:3.12-slim): install uv + backend deps + Docker CLI + compose plugin + `git` (needed to sync the recipes repo and for `git_build` recipes), copy dist to `./static`
- [ ] `docker-compose.yml` — preferred setup: FlytDokk on LXC 103, Caddy on LXC 101 by LAN IP, includes `flytdokk-settings` volume for `settings.json` + `instances.json`
  - Mount `STACKS_DIR` at the **same path** in and out (`${STACKS_DIR}:${STACKS_DIR}`) — the compose CLI hands bind paths to the host daemon, so paths must match or stack volumes land in the wrong place
- [ ] `docker-compose.colocated.yml` — alternative: Caddy as Docker container alongside FlytDokk
- [ ] `Caddyfile` — reference config for LXC 101 native Caddy: admin endpoint + wildcard cert only (no routes); every route pushed at runtime via the Admin API
- [ ] `caddy/Dockerfile` + `caddy/Caddyfile` — for co-located alternative only (Caddy as Docker container)
- [ ] Verify: `docker compose up` → open `http://localhost:8080`, all modules report health correctly

---

## Phase 8 — Docker Module
**Backend**
- [ ] `modules/docker/client.py` — docker-py wrapper
  - `list_containers()` — name, image, status, uptime, CPU%, RAM
  - `start/stop/restart/remove(id)`
  - `stream_logs(id)` — async generator for SSE
  - `get_host_stats()` — total CPU, RAM, disk
- [ ] Merge live containers with the instance list: join each container to its instance
  by `container` to surface the assigned subdomain inline; containers with no instance
  yet can be assigned one on the spot (creates a docker instance)
- [ ] `modules/docker/stacks.py` — directory-based stack manager
  - `stacks_dir_ok()` — `os.path.isdir(STACKS_DIR)` inside the container: the one check that the compose mount actually stuck. Feeds `/api/health`; write paths (`create_stack`, recipe install) refuse with a clear "stacks directory not found — check the compose mount" error rather than writing into an unmounted path (which the host can't see and whose bind-volumes would land wrong)
  - `list_stacks()` — scan `STACKS_DIR` for subdirs with `compose.yml`; returns empty (not an error) when the dir is present but has none — so a broken mount (`stacks_dir_ok()` false) is distinguishable from a genuinely empty one
  - `get_stack(name)` — read compose.yml + .env contents + container status
  - `stack_action(name, action)` — up/down/restart/pull via `docker compose` subprocess
  - `create_stack(name, compose_content, env_content)` — write files + run up -d
  - `update_stack_file(name, file, content)` — write compose.yml or .env
  - `delete_stack(name)` — `docker compose down` then remove the stack directory (with confirmation)
- [ ] `modules/docker/recipes.py` — recipe engine: recipes are **declarative data synced from a public repo**, never executable code. Schema contract: [docs/recipe-schema.md](docs/recipe-schema.md) (authored by hand/AI, no authoring UI)
  - **Two sources, one merged list**: the synced public repo (canonical) + a local dir `/opt/flytdokk/recipes/` in the settings volume (dev/testing scratchpad, no new mount). Both optional; both scanned identically
  - `sync_recipes()` — `git clone`/`pull` the public `recipes_repo_url` into a cache in the settings volume; no auth (public repo). Explicit only: called by the "Refresh recipes" action and optionally once on startup — no background polling. Falls back to the last-synced cache if the repo is unreachable
  - `list_recipes()` — scan both the repo cache and the local dir, read each folder's `recipe.yml`, validate against the manifest schema, skip + report malformed ones (never `exec` recipe content). On a name clash the **repo wins**; the shadowed local copy is flagged, not dropped silently. Empty when neither source has recipes
  - `install_recipe(name, answers)` — create the manifest's `directories` (substituting answers), write the folder's `compose.yml` + a **generated `.env`** (from the answers — holds secrets, never in the repo), run the `type`'s command, register a `docker` instance, optionally assign a subdomain
  - **Recipe folder** (in the repo, one per service): `recipe.yml` (manifest) + standalone `compose.yml` (native `${VAR}`) + `instructions.md` (displayed)
  - **Manifest (`recipe.yml`) schema**: `type` (`pull` | `git_build` | `registry_pull`), display name, `env:` (list of `key`/`label`/`default`/optional `secret`), `directories`, `suggested_subdomain`, plus type-specific fields (`git_repo` for `git_build`)
  - Recipe-type commands:
    - `pull` — pre-built public image, `docker compose up -d`
    - `git_build` — `git clone <git_repo>` then `docker compose up -d --build`
    - `registry_pull` — pull from private Gitea registry, `docker compose up -d`
      - Registry auth is a **host precondition, not FlytDokk's job**: you run `docker login <gitea-registry>` once on the Docker host; the daemon caches the credential, so this recipe's pull is mechanically identical to a public `pull`. FlytDokk stores no registry token — keeps it secret-free, mirroring how the ACME token lives with Caddy, not here
  - Sample recipes (Grafana, Jellyfin, Nextcloud, Vaultwarden, Gitea, Uptime Kuma) live **in the recipes repo, not in this codebase** — adding one is a repo push, no FlytDokk rebuild
- [ ] `modules/docker/router.py` — FastAPI APIRouter at `/api/docker`
  - `GET /api/docker/containers`
  - `POST /api/docker/containers/{id}/start|stop|restart`
  - `DELETE /api/docker/containers/{id}`
  - `GET /api/docker/containers/{id}/logs` (SSE)
  - `WS /api/docker/containers/{id}/exec` (interactive terminal — see the WebSocket exec task below)
  - `GET /api/docker/stacks`
  - `GET /api/docker/stacks/{name}`
  - `PUT /api/docker/stacks/{name}/file` (edit compose or .env)
  - `POST /api/docker/stacks/{name}/action` (up/down/restart/pull)
  - `DELETE /api/docker/stacks/{name}`
  - `GET /api/docker/recipes` (list available recipes from the synced repo)
  - `POST /api/docker/recipes/refresh` (re-sync recipes from the repo)
  - `POST /api/docker/recipes/{name}/install` (run recipe wizard)
  - `GET /api/docker/stats`

**Frontend**
- [ ] `pages/Docker.tsx` — Docker page, two tabs: Containers and Stacks
- [ ] `components/docker/ContainerList.tsx` — table with name, image, status, uptime, CPU%, RAM, assigned subdomain (from its instance), actions incl. "Assign URL"
- [ ] `components/docker/LogViewer.tsx` — SSE log stream, auto-scroll, copy button
- [ ] `components/docker/Terminal.tsx` — xterm.js browser terminal, WebSocket connection to `/api/docker/containers/{id}/exec`
- [ ] `components/docker/QuickCommands.tsx` — preset command buttons above the terminal; generic set + image-specific commands detected from container image name
- [ ] `modules/docker/quick_commands.py` — map of image name patterns to preset commands (e.g. `redis` → `redis-cli`, `postgres` → `psql -U postgres`)
- [ ] Backend: WebSocket exec endpoint — docker-py exec_create + exec_start, stream bidirectional I/O
- [ ] `components/docker/StackList.tsx` — list of discovered stacks with status + actions
- [ ] `components/docker/StackEditor.tsx` — side-by-side editor for compose.yml and .env; doubles as the manual "new stack" create path — the raw path: paste a finished compose + .env and `up`, no manifest/wizard. Docker auto-creates bind-mount source dirs, so no directory step
- [ ] `components/docker/InstallWizard.tsx` — multi-step modal: pick recipe → review what will be created → fill in required values (form rendered from the manifest `env:` schema) → optionally assign URL → deploy. Recipe list is the merged repo + local set (repo wins on name clash, shadowed local flagged); includes a "Refresh recipes" action and an empty state (prompt to set `recipes_repo_url` and/or drop a local recipe) when both sources are empty
- [ ] `components/docker/StatsBar.tsx` — host CPU, RAM, disk usage summary

---

## Phase 9 — Polish
- [ ] Dark mode (Tailwind `dark:` classes, toggle stored in localStorage)
- [ ] Basic auth — add `basicauth` to Caddyfile (no code change in FlytDokk)
- [ ] Consistency check — on `/api/health`, warn if an instance has a subdomain but no matching AdGuard rewrite (that name won't resolve on the LAN until the rewrite is added), or if a same-domain rewrite points somewhere other than the Caddy IP (manual conflict — never auto-overwrite)
- [ ] Config export — `GET /api/export` returns a JSON snapshot of the instance list + AdGuard rewrites
- [ ] Container label auto-discovery — detect `flytdokk.subdomain=X` label on start, auto-create/update the container's docker instance and push its route
- [ ] Orphaned-route cleanup — flag routes whose upstream container no longer exists and offer one-click delete
