# Loskai — TODO

---

## Phase 1 — Project Scaffolding
- [x] Create `backend/` directory, init uv project (`uv init`), add `pyproject.toml` — src layout, Python pinned to 3.12 to match the prod image
- [x] Add backend dependencies: fastapi, uvicorn[standard], httpx, pydantic-settings, sse-starlette, argon2-cffi (admin-password hashing), itsdangerous (signed session cookie)
- [x] Add backend **dev** deps + set up `pytest` early (`pytest`, `pytest-httpx`, `pytest-asyncio`) so each module ships its Tier-1/2 tests as it's built — see Phase 8b for the full strategy
- [x] Create `frontend/` directory, scaffold with Vite + React + TypeScript (`npm create vite`)
- [x] Add frontend dependencies: react-router-dom, @tanstack/react-query, recharts, lucide-react, tailwindcss, xterm, @xterm/addon-fit — installed the canonical `@xterm/xterm` + `@xterm/addon-fit` (old `xterm` is deprecated; new addon expects the new namespace)
- [x] Add frontend **dev** deps: `vitest` + `@testing-library/react` (with jsdom + jest-dom for the DOM env + matchers)
- [x] Configure Vite dev proxy: `/api/*` → `http://localhost:8000` (`ws: true` for the later container-exec socket)
  - Note: backend runs on `:8000` in dev (Vite proxies to it); the production container serves on `:8080`
- [x] Create `.env.example` — all vars optional; `BASE_DOMAIN` (e.g. `example.no`) is the domain; `LOSKAI_PASSWORD` guards the admin UI (or set at first run). The ACME/DNS-challenge token belongs to Caddy on LXC 101, not Loskai
- [x] Create `HISTORY.md`

---

## Phase 2 — Backend Foundation
- [x] `backend/src/loskai/shared/settings.py` — settings manager (+ `shared/store.py`: atomic JSON read/write, the flat-file I/O seam shared with instances)
  - Reads env vars on startup (highest priority)
  - Falls back to `settings.json` at `/opt/loskai/settings.json`
  - Returns each value with source: `"env"` | `"stored"` | `"unset"`
  - Manages: `caddy_admin_url`, `adguard_url`/`user`/`password`, `wireguard_dashboard_url`, `base_domain`, `caddy_host_ip` (optional — DNS-rewrite answer IP; derived from `caddy_admin_url` host when omitted), `recipes_repo_url` (optional — public git repo the install wizard syncs recipes from)
  - `stacks_dir` is **env-only** (drives the compose bind mount) — read from env, defaults to `/opt/stacks`, never written to `settings.json`; surfaced read-only on the settings page
  - `admin_password_hash` — set from `LOSKAI_PASSWORD` (env) or at first run, stored **hashed** (argon2/bcrypt); **never** returned by `GET /api/settings`
- [x] `backend/src/loskai/shared/instances.py` — instance list at `/opt/loskai/instances.json`
  - Flat JSON file (same pattern as `settings.json`), no database
  - Each instance: `{ id, name, type: "docker"|"external", subdomain, upstream, container, dns_answer, private }` (`dns_answer` = Caddy IP last written to AdGuard for this name, null if no rewrite; `private` = hide from the public dashboard, default false)
  - `id` doubles as the Caddy `@id`; `subdomain` null = tracked but no route
  - CRUD helpers (list / get / upsert / delete)
- [x] `backend/src/loskai/config.py` — pydantic-settings class; **no env var required** at startup, all optional
- [x] `backend/src/loskai/main.py` — FastAPI app, register all routers, mount static files last (for SPA fallback — conditional on the built bundle existing; catch-all serves `index.html`, never shadows `/api`)
- [x] `backend/src/loskai/shared/health.py` — `GET /api/health` — polls each module client and returns aggregate status: `{ caddy, adguard, wireguard, docker }`
  - Registry pattern: each module registers its checker as it's built; Phase 2 reports `unconfigured` until then. Docker carries `stacks_dir_ok` (computed from `STACKS_DIR` existence)
- [x] `GET /api/settings` — returns all settings with source field (**never** the admin password hash)
- [x] `PUT /api/settings` — updates `settings.json` (env-sourced values ignored)
- [x] `backend/src/loskai/shared/auth.py` — single-password auth, no accounts
  - Middleware: reject unauthenticated `/api/*` with 401 **except** `GET /api/dashboard` and the login flow (`/api/login`, `/api/logout`, `/api/auth/status`, `/api/auth/setup`) — the real security boundary, not the frontend. **Note:** `/api/health` is gated too (only the dashboard + login flow are public); verify below adjusted accordingly
  - `POST /api/login` — verify against `admin_password_hash`, issue a signed `HttpOnly` `SameSite` session cookie; `POST /api/logout` — clear it
  - `GET /api/auth/status` — `{ authed, password_set }` so the SPA can route to login vs first-run setup
  - First-run: when no `admin_password_hash` exists, admin tier is locked; `POST /api/auth/setup` sets the initial password (hashed). Session secret generated + persisted in the settings volume
- [x] `backend/src/loskai/shared/dashboard.py` — `GET /api/dashboard` (public): non-private routed instances as launcher cards `{ name, url, icon }` only — no container detail or module state
- [x] Verify: `GET /api/dashboard` returns the public list unauthenticated; every other `/api/*` (incl. `/api/health`, `/api/settings`) returns 401 without a session and 200 with one; login + first-run setup flows exercised by curl (dev backend on `:8000`; prod container on `:8080`)
  - Tier-1 tests written alongside (Phase 8b): `tests/test_settings.py` (priority chain + answer-IP derivation), `tests/test_instances.py` (CRUD + routed subset), `tests/test_auth.py` (hash/verify, session sign/verify, first-run seeding) — 16 passing

---

## Phase 3 — Caddy Module
**Backend**
- [x] `modules/caddy/client.py` — async httpx wrapper for the Caddy Admin API (push side only)
  - `server_name()` — GET /config/apps/http/servers, cache the single key (e.g. `srv0`) at startup; never hardcode it
  - `list_live_routes()` — GET /config/apps/http/servers/{server}/routes (Caddy's current state)
  - `push_route(route)` — POST route JSON tagged with `@id` (append to the server's routes); route built by `service.build_route`
  - `delete_route(id)` — DELETE /id/{id} (ignore 404 — route may not be pushed yet)
  - `get_mode()` — moved to `service.caddy_mode()` (pure logic, kept out of client.py per the I/O-vs-logic seam)
  - `health()` — returns `healthy` / `unreachable` / `degraded` / `unconfigured`; doubles as server-name refresh
  - `upstreams()` — GET /reverse_proxy/upstreams (upstream liveness for the route list)
- [x] `modules/caddy/service.py` — read + push only; owns the projection, not assignment
  - `list_with_sync()` — instances that have a subdomain, each annotated with synced (`@id` present in `list_live_routes()`) + live (`upstreams()`) status; read-only comparison, never auto-corrects
  - `push_all()` — push every instance that has a subdomain to Caddy (recovery / one-click resync). Only touches routes whose `@id` matches an instance — leaves any human-added route with a non-instance `@id` alone
  - `render_caddyfile()` — generate a complete, runnable Caddyfile from the instances that have a subdomain (TLS + admin block templated from `base_domain`)
  - Note: assigning / clearing a subdomain lives in `shared/assign.py` (Phase 6), not here — the Caddy module never writes a single route on its own
- [x] `modules/caddy/router.py` — FastAPI APIRouter at `/api/caddy` (read + push only); registers the caddy health checker with the aggregate poller
  - `GET /api/caddy/routes` — instances that have a subdomain, annotated with synced + live status
  - `POST /api/caddy/push` — `push_all()`
  - `GET /api/caddy/caddyfile` — export Caddyfile (text/plain)
  - `GET /api/caddy/health` — status + mode (`docker` | `lan`)
  - `GET /api/caddy/upstreams` — upstream liveness
- [x] Persistence: Caddy runs with `caddy run --resume` (its own config survives restarts);
  `push_all()` is the backstop if that config is ever lost — no reconcile/drift loop needed
- [x] Backend tests: Tier-1 logic (route JSON, mode, Caddyfile render) + Tier-2 client contract (pytest-httpx: server discovery, delete-ignores-404, unreachable). 30 backend tests pass

**Frontend** _(dark-first, Lutris-inspired; Tailwind v4, maritime teal accent)_
- [x] `App.tsx` + `components/shared/Layout.tsx` — React Router + the persistent left-sidebar shell: `Dashboard · Docker · Routing · VPN · Settings` (per-module health dots + logout). `/` (Dashboard) + `/login` public; admin tabs wrapped in `RequireAuth`. Docker (Phase 8) + VPN (Phase 5) render `Placeholder`
- [x] `pages/Dashboard.tsx` — public landing: grid of `ServiceCard`s from `GET /api/dashboard` (no auth)
- [x] `pages/Login.tsx` — the security screen: single-password form → `POST /api/login`; doubles as first-run "set admin password" (`POST /api/auth/setup`) when `GET /api/auth/status` reports `password_set: false`
- [x] `components/shared/RequireAuth.tsx` — checks `GET /api/auth/status`, redirects to `/login` when not authed (UX only — the API is the real gate)
- [x] `components/shared/ServiceCard.tsx` — one dashboard card: name, icon, link to `https://prefix.base_domain`
- [x] `pages/Settings.tsx` — form for all service URLs and credentials
  - Env-var-set fields shown as read-only with "set via environment" label
  - Editable fields saved via `PUT /api/settings`
  - ~~Admin password change field~~ — **deferred**: no change-password endpoint exists yet (Phase 2 auth has setup + login only); revisit when a `POST /api/auth/change-password` lands
  - Modules with unset required URLs surface via the `ModuleStatus` banner (links here)
- [x] `lib/api.ts` — fetch wrapper, JSON error handling; on a 401 redirect to `/login` (+ `useAuth`, `validation`)
- [x] `lib/useHealth.ts` — React Query hook polling `/api/health` every 30s; **`enabled` gated on auth** so the public dashboard never polls the gated health endpoint
- [x] `components/shared/StatusBadge.tsx` — coloured pill: healthy / degraded / unreachable / unconfigured / synced
- [x] `components/shared/ModuleStatus.tsx` — banner shown when a module is unreachable/degraded/unconfigured
- [x] `components/shared/ConfirmDialog.tsx` — generic confirm modal
- [x] `pages/Routing.tsx` — unified view; Caddy module status banner + Push all + Caddyfile export (AdGuard DNS folds in Phase 4)
- [x] `components/routing/ServiceTable.tsx` — one row per routed service: FQDN, upstream, Caddy route-sync + live status. **Deferred:** AdGuard DNS-rewrite column → Phase 4; the private toggle + delete (`DELETE /api/assign/{id}`) → Phase 6. "Push all" (`POST /api/caddy/push`) works now
- [x] `components/routing/AssignModal.tsx` — form: prefix (single DNS label, validated) with live `prefix.base_domain` + upstream input (mode-aware hint). Built + unit-tested. **Submit wiring to `/api/assign` → Phase 6**; the Routing "Assign URL" button is a disabled signpost until then
- [x] `components/routing/CaddyfileExport.tsx` — download + copy-to-clipboard of `GET /api/caddy/caddyfile`
- [x] Frontend tests: `validation` (prefix rules) + `AssignModal` (FQDN preview, enable/disable, mode hint). 7 Vitest tests pass; `tsc` + `vite build` + `oxlint` clean
- [ ] _(deferred)_ `components/routing/CertStatus.tsx` — cert expiry + days remaining. Out of current scope; when revisited, implement via a TLS probe to a routed name (read the served cert's `notAfter`), not the Admin API — see PLAN.md Future Ideas

---

## Phase 4 — AdGuard Module
_Contract: [docs/adguard-api.md](docs/adguard-api.md). Explicit per-instance rewrites, no wildcard rewrite; answer = Caddy LAN IP (host of `CADDY_ADMIN_URL`, or `CADDY_HOST_IP` fallback)._
**Backend**
- [x] `modules/adguard/client.py` — async httpx wrapper for AdGuard `/control` API (Basic Auth)
  - `health()` — `GET /control/status`, reachable + `running`
  - `list_rewrites()` — `GET /control/rewrite/list`
  - `add_rewrite(domain, answer)` — `POST /control/rewrite/add`
  - `delete_rewrite(domain, answer)` — `POST /control/rewrite/delete` (exact `{domain, answer}` pair — never match-by-domain, so manual rewrites are safe)
  - editing a rewrite is delete-then-add (no `PUT /rewrite/update`)
- [x] `plan_reconcile()` (pure) + `reconcile()` (executor) in `service.py` — ensure `(domain, currentIP)` exists; if stored `dns_answer` differs, delete the stale `(domain, dns_answer)` pair (orphan migration); leave + flag same-domain entries whose answer matches neither `currentIP` nor `dns_answer` (manual conflict). Runs on "Push all" (`POST /api/adguard/reconcile`)
- [x] Write each instance's `dns_answer` whenever a rewrite is added (executor persists it for every domain that now resolves to `currentIP`); clearing on removal is Phase 6 (assign clear)
- [x] `modules/adguard/router.py` — FastAPI APIRouter at `/api/adguard`
  - `GET /api/adguard/health` — reachable (+ `answer_ip`, `url` for the link-out)
  - `GET /api/adguard/rewrites`, `POST`, `DELETE` (DELETE carries `{domain, answer}`); AdGuard unreachable → 502
  - **Added beyond the surface**: `GET /api/adguard/status` (per-instance DNS comparison, server-side + testable) and `POST /api/adguard/reconcile`
- [x] Backend tests: Tier-1 reconcile (add / in-sync / orphan-migration / manual-conflict / stale-not-conflict) + executor via a fake client; Tier-2 client contract (exact-pair delete body, Basic Auth header). 50 backend tests pass

**Frontend** — folds into the unified `pages/Routing.tsx` (no separate AdGuard page)
- [x] Added the **DNS-rewrite status column** to `components/routing/ServiceTable.tsx`: per row, present / missing / unknown + the manual-conflict flag; best-effort row action to add/remove the rewrite
- [x] `components/routing/AdGuardStatus.tsx` — AdGuard health pill + answer-IP + prominent link out to the full AdGuard UI, in the Routing header
- [x] Reconcile action folded into "Push all": runs `POST /api/caddy/push` + `POST /api/adguard/reconcile` together, reports a combined per-side summary. 9 Vitest tests pass
- [x] Fixed a Phase 3 regression: the Python `.gitignore`'s `lib/` had silently excluded `frontend/src/lib/` from git (built locally, would fail a fresh checkout) — negation added, files committed

---

## Phase 5 — WireGuard Module
**Backend**
- [x] `modules/wireguard/client.py` — simple reachability check, no authentication
  - `health()` — HTTP ping to `WIREGUARD_DASHBOARD_URL`, returns `{ reachable: bool }` (any HTTP response = reachable, incl. `401`/`403`; only connection failure/timeout = unreachable — no `raise_for_status`)
- [x] `modules/wireguard/router.py` — FastAPI APIRouter at `/api/wireguard`
  - `GET /api/wireguard/status` — reachable + url + `dns_hint` (AdGuard IP from `ADGUARD_URL` host); registers the wireguard health checker

**Frontend**
- [x] `pages/WireGuard.tsx` — the **VPN** sidebar tab (replaces the placeholder); reads `wireguard` from `useHealth`
- [x] `components/wireguard/WireGuardCard.tsx` — reachability status, prominent link out to wg-dashboard, DNS reminder card (host of `ADGUARD_URL` + `1.1.1.1`; generic guidance if `ADGUARD_URL` unset)
- [x] Tests: Tier-2 client (`401`/`403` = reachable, conn-fail = unreachable) + card render. 54 backend + 11 Vitest pass; `tsc`/`vite build`/`oxlint` clean

---

## Phase 6 — Cross-Module URL Assignment
- [x] `backend/src/loskai/shared/assign.py` — the one place assignment lives; orchestrates
      the Caddy client + AdGuard client + instance store (Caddy module never writes routes itself)
  - `POST /api/assign { prefix, upstream, instance_id?, name? }`
    - Handles both existing instances (a container) and new external ("dummy") instances
    - Step 0: validate single-label prefix + uniqueness; set subdomain/upstream on the instance + save `instances.json`
    - Step 1: push Caddy route via `caddy_service.upsert_route` (required — abort + roll back if it fails: delete a new instance, restore an existing one)
    - Step 2: create AdGuard DNS rewrite `{domain, answer: caddy_host_ip}` (best-effort — warn but don't fail; on a rename the orphaned old-domain rewrite is removed)
    - Returns: `{ caddy, adguard: ok|error|skipped, url, instance_id, warning }`; validation→422, duplicate→409, not-found→404, Caddy-required failure→502
  - `DELETE /api/assign/{instance_id}` — the mirror: clear the instance's subdomain + save,
    `client.delete_route` (required, rollback on failure), then best-effort remove the AdGuard rewrite by exact pair; instance survives
- [x] `PATCH /api/instances/{id}` — persist the `private` flag / display name (backs the routing-table private toggle)
- [x] Wired `AssignModal.tsx` → `POST /api/assign` (result banner with URL + AdGuard warning); ServiceTable delete → `DELETE /api/assign/{id}` behind a ConfirmDialog; private toggle → `PATCH /api/instances/{id}`
- [x] Assign URL modal accessible from the Routing page and the Docker page (container assign, Phase 8)
- [x] Tests: Tier-1 validation/uniqueness + orchestration via fake clients (happy path, Caddy-fail rollback for new + existing, AdGuard best-effort error/skipped/no-IP, unassign mirror). 65 backend + 12 Vitest pass. **Verified end to end through the real HTTP clients against a throwaway Caddy+AdGuard stub** (route + rewrite land, 422/409 guards, private toggle, delete mirror)

---

## Phase 7 — Deployment

**Infrastructure scripts**
- [x] `scripts/create-lxc101.sh` — Proxmox host script (run from Proxmox shell via `bash create-lxc101.sh`)
  - Creates + starts a Debian LXC (configurable ID/memory/disk/network), provisions via `pct exec`
  - Installs AdGuard Home (official installer)
  - Installs Caddy via the **official custom-build download** (prebuilt binary with the DNS plugin — simpler/more reliable than xcaddy+Go for an untested script), drops the cert-only `Caddyfile`, adds a `caddy.service` unit (`run --resume`)
  - Prints next steps (set the DNS token, finish AdGuard setup, firewall :2019). Bash syntax-checked; can't be run outside Proxmox

**Loskai container**
- [x] `Dockerfile` — multi-stage build. Stage 1 (node:20-alpine) builds the frontend; stage 2 (**python:3.12-slim-bookworm**, pinned so the Docker apt repo matches) installs deps with `uv` in two steps (deps cached, then the project), adds `git` + Docker CLI + Compose v2 plugin, copies dist to `./static`, serves on :8080. `+ .dockerignore`
- [x] `docker-compose.yml` — preferred setup (Loskai on the Docker host, Caddy/AdGuard over the LAN); `loskai-settings` volume; same-path `${STACKS_DIR}:${STACKS_DIR}` mount + socket
- [x] `docker-compose.colocated.yml` — all-in-Docker alternative (Loskai + Caddy + AdGuard as containers); port-conflict notes + required `CADDY_HOST_IP`; named volumes for caddy/adguard state
- [x] `Caddyfile` — cert-only reference for native LXC 101 Caddy (admin + wildcard, no routes)
- [x] `caddy/Dockerfile` + `caddy/Caddyfile` — for the co-located alternative (Caddy container built with the DNS plugin)
- [x] README updated with build/run/deploy + develop instructions
- [x] Verify: **Docker daemon unavailable in this environment** — replicated the image contents instead: `uv sync --frozen --no-dev` (prod install, dev deps removed) + the exact container CMD serves the SPA + gated API on :8080 with all four modules reporting; compose YAML + LXC script parse. Actual `docker build`/`docker compose up` must run on a real host

---

## Phase 8 — Docker Module
**Backend**
- [x] `modules/docker/client.py` — docker-py wrapper
  - `list_containers()` — name, image, status, uptime, CPU%, RAM
  - `start/stop/restart/remove(id)`
  - `stream_logs(id)` — async generator for SSE
  - `get_host_stats()` — total CPU, RAM, disk
- [x] Merge live containers with the instance list: join each container to its instance
  by `container` to surface the assigned subdomain inline; containers with no instance
  yet can be assigned one on the spot (creates a docker instance)
- [x] `modules/docker/stacks.py` — directory-based stack manager
  - `stacks_dir_ok()` — `os.path.isdir(STACKS_DIR)` inside the container: the one check that the compose mount actually stuck. Feeds `/api/health`; write paths (`create_stack`, recipe install) refuse with a clear "stacks directory not found — check the compose mount" error rather than writing into an unmounted path (which the host can't see and whose bind-volumes would land wrong)
  - `list_stacks()` — scan `STACKS_DIR` for subdirs with `compose.yml`; returns empty (not an error) when the dir is present but has none — so a broken mount (`stacks_dir_ok()` false) is distinguishable from a genuinely empty one
  - `get_stack(name)` — read compose.yml + .env contents + container status
  - `stack_action(name, action)` — up/down/restart/pull via `docker compose` subprocess
  - `create_stack(name, compose_content, env_content)` — write files + run up -d
  - `update_stack_file(name, file, content)` — write compose.yml or .env
  - `delete_stack(name)` — `docker compose down` then remove the stack directory (with confirmation)
- [x] `modules/docker/recipes.py` — recipe engine: recipes are **declarative data synced from a public repo**, never executable code. Schema contract: [docs/recipe-schema.md](docs/recipe-schema.md) (authored by hand/AI, no authoring UI)
  - **Two sources, one merged list**: the synced public repo (canonical) + a local dir `/opt/loskai/recipes/` in the settings volume (dev/testing scratchpad, no new mount). Both optional; both scanned identically
  - `sync_recipes()` — `git clone`/`pull` the public `recipes_repo_url` into a cache in the settings volume; no auth (public repo). Explicit only: called by the "Refresh recipes" action and optionally once on startup — no background polling. Falls back to the last-synced cache if the repo is unreachable
  - `list_recipes()` — scan both the repo cache and the local dir, read each folder's `recipe.yml`, validate against the manifest schema, skip + report malformed ones (never `exec` recipe content). On a name clash the **repo wins**; the shadowed local copy is flagged, not dropped silently. Empty when neither source has recipes
  - `install_recipe(name, answers)` — create the manifest's `directories` (substituting answers), write the folder's `compose.yml` + a **generated `.env`** (from the answers — holds secrets, never in the repo), run the `type`'s command, register a `docker` instance, optionally assign a subdomain
  - **Recipe folder** (in the repo, one per service): `recipe.yml` (manifest) + standalone `compose.yml` (native `${VAR}`) + `instructions.md` (displayed)
  - **Manifest (`recipe.yml`) schema**: `type` (`pull` | `git_build` | `registry_pull`), display name, `env:` (list of `key`/`label`/`default`/optional `secret`), `directories`, `suggested_subdomain`, plus type-specific fields (`git_repo` for `git_build`)
  - Recipe-type commands:
    - `pull` — pre-built public image, `docker compose up -d`
    - `git_build` — `git clone <git_repo>` then `docker compose up -d --build`
    - `registry_pull` — pull from private Gitea registry, `docker compose up -d`
      - Registry auth is a **host precondition, not Loskai's job**: you run `docker login <gitea-registry>` once on the Docker host; the daemon caches the credential, so this recipe's pull is mechanically identical to a public `pull`. Loskai stores no registry token — keeps it secret-free, mirroring how the ACME token lives with Caddy, not here
  - Sample recipes (Grafana, Jellyfin, Nextcloud, Vaultwarden, Gitea, Uptime Kuma) live **in the recipes repo, not in this codebase** — adding one is a repo push, no Loskai rebuild
- [x] `modules/docker/router.py` — FastAPI APIRouter at `/api/docker`
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
- [x] `pages/Docker.tsx` — Docker page, two tabs: Containers and Stacks
- [x] `components/docker/ContainerList.tsx` — table with name, image, status, uptime, CPU%, RAM, assigned subdomain (from its instance), actions incl. "Assign URL"
- [x] `components/docker/LogViewer.tsx` — SSE log stream, auto-scroll, copy button
- [x] `components/docker/Terminal.tsx` — xterm.js browser terminal, WebSocket connection to `/api/docker/containers/{id}/exec`
- [x] `components/docker/QuickCommands.tsx` — preset command buttons above the terminal; generic set + image-specific commands detected from container image name
- [x] `modules/docker/quick_commands.py` — map of image name patterns to preset commands (e.g. `redis` → `redis-cli`, `postgres` → `psql -U postgres`)
- [x] Backend: WebSocket exec endpoint — docker-py exec_create + exec_start, stream bidirectional I/O
- [x] `components/docker/StackList.tsx` — list of discovered stacks with status + actions
- [x] `components/docker/StackEditor.tsx` — side-by-side editor for compose.yml and .env; doubles as the manual "new stack" create path — the raw path: paste a finished compose + .env and `up`, no manifest/wizard. Docker auto-creates bind-mount source dirs, so no directory step
- [x] `components/docker/InstallWizard.tsx` — multi-step modal: pick recipe → review what will be created → fill in required values (form rendered from the manifest `env:` schema) → optionally assign URL → deploy. Recipe list is the merged repo + local set (repo wins on name clash, shadowed local flagged); includes a "Refresh recipes" action and an empty state (prompt to set `recipes_repo_url` and/or drop a local recipe) when both sources are empty
- [x] `components/docker/StatsBar.tsx` — host CPU, RAM, disk usage summary
- [x] **Additions**: `modules/docker/logic.py` (pure — stats math, parsing, joins, stack status, compose service parse; the seam that makes everything testable without a daemon); `components/shared/Modal.tsx` (generic dialog shell); `lib/format.ts`. Added `docker` + `pyyaml` deps. Exec WS **authenticates itself** (BaseHTTPMiddleware doesn't cover WebSockets — it's a root shell). Removed the now-unused `Placeholder`
- [x] **Assign extension**: `/api/assign` gained an optional `container`, so assigning a URL to a container creates a linked `docker` instance (not `external`)
- [x] Tests: Tier-1 stats/parse/stack-status/quick-commands + recipe validation/merge + stack fs logic; docker-py mocked for the client. 103 backend + 12 Vitest pass; `tsc`/`vite build`/`oxlint` clean
- [x] Verify: **no Docker daemon in this environment** — curl-confirmed graceful degradation (stacks list from the filesystem, recipes list, health `unreachable` + `stacks_dir_ok`, container ops → 502, unauthenticated exec WS rejected). **Live container control, log streaming, the exec terminal, and `docker compose` run against a real daemon — untested here**

---

## Phase 8b — Testing & CI
_Principle: test the logic Loskai owns, mock the systems it talks to, manually/rig-verify the irreversible side effects. Never test `httpx`/`docker-py` themselves. Depends on the strict `client.py` (I/O) vs logic seam — keep decision logic in pure functions so it's testable without a network._
_Tiers 1 & 2 are written **alongside each module** as it's built (pytest is set up in Phase 1); this list is the consolidated checklist. Tier 3 (the rig) and CI are the net-new work here._

> **Status (2026-07-16): Setup + Tiers 1 & 2 are done** (134 backend + 17 Vitest passing).
> **Tier 3 (integration rig) and CI (Forgejo) are deferred by choice** — the core was
> validated live on-device, and the short manual smoke checklist covers the irreversible
> paths, so automated CI isn't needed right now. Left as backlog, not pending work.

**Setup**
- [x] Backend: add `pytest`, `pytest-httpx` (or `respx`), `pytest-asyncio` as dev deps; `uv run pytest`
- [x] Frontend: add `vitest` + `@testing-library/react`; `npm test`

**Tier 1 — unit tests on pure logic** (fast, no network, `tmp_path` for files)
- [x] `instances.py` CRUD + `settings.py` env→json priority chain & source tagging
- [x] FQDN assembly, Caddy route-JSON builder, Caddyfile render
- [x] **AdGuard reconcile** — `(domain, answer)` diffing, `dns_answer` orphan migration, manual-conflict detection (the trickiest logic — cover thoroughly)
- [x] answer-IP derivation (`CADDY_ADMIN_URL` host / `CADDY_HOST_IP` fallback)
- [x] recipe manifest validation (schema + malformed rejection), quick-commands image→cmd map
- [x] auth: password hash/verify, session sign/verify

**Tier 2 — client contract tests** (`pytest-httpx`, response shapes from `docs/*-api.md`)
- [x] Caddy client: request built (URL/method/body, `@id`), delete-ignores-404
- [x] AdGuard client: delete-by-exact-pair body, add/list parsing
- [x] WireGuard client: any HTTP response (incl. 401/403) = reachable

**Tier 3 — disposable integration rig** _(deferred by choice — manual smoke test suffices)_
- [ ] `docker-compose.test.yml` — throwaway Caddy + AdGuard containers (a slim variant of the co-located stack): Caddy `tls internal` (no ACME/DNS token), ephemeral volumes, seeded before each run, torn down after
- [ ] A handful of integration tests that push a route to the rig Caddy and a rewrite to the rig AdGuard, asserting they land — plus a documented manual smoke checklist for the Docker/`compose` side (too host-bound to rig)

**CI — Forgejo Actions** _(deferred by choice — not needed while validating manually)_
- [ ] `.forgejo/workflows/ci.yml` — on push: run `pytest` (Tiers 1–2, + Tier 3 if the rig is available) and `vitest`. GitHub-Actions-compatible YAML (portable). One-time: register an `act_runner` on the Forgejo instance

---

## Phase 9 — Polish
- [x] Dark/light theme toggle (stored in localStorage). The UI is authored dark against the slate scale; light mode inverts `--color-slate-*` under `html.light` in `index.css` (Tailwind v4 utilities read those vars), so it re-skins every component with no markup changes. Toggle lives in the sidebar; applied pre-paint in `main.tsx` to avoid a flash
- [ ] ~~Basic auth via Caddyfile~~ — superseded by in-app single-password auth (Phase 2 `auth.py`), since the public dashboard can't sit behind a blanket Caddy `basicauth`. See PLAN.md "Security & Access"
- [x] Consistency check — on `/api/health`, warn if an instance has a subdomain but no matching AdGuard rewrite (that name won't resolve on the LAN until the rewrite is added), or if a same-domain rewrite points somewhere other than the Caddy IP (manual conflict — never auto-overwrite). Pure `consistency_warnings` in `adguard/service.py`; surfaced as a `consistency[]` key on `/api/health` (self-degrading via a registry hook) + an amber banner on the Routing page
- [x] Config export — `GET /api/export` returns a JSON snapshot of the instance list + AdGuard rewrites (best-effort: rewrites `null` + warning when AdGuard is down). Download button on the Settings page
- [x] ~~Container label auto-discovery~~ — built then **removed** (auto-assigning routes from compose labels wasn't wanted). Replaced by the semi-automatic Docker-tab flow: "Assign URL" on a container is pre-filled with a suggested subdomain and is idempotent (one instance per container, no duplicates); a second route to one service is a separate external instance
- [x] Orphaned-route cleanup — flag routes whose upstream container no longer exists and offer one-click delete. `logic.orphaned_instances` (pure) + `GET/DELETE /api/docker/orphans`; the delete re-verifies the container is gone (409 otherwise) then reuses `assign.purge_instance` for cross-module teardown. Rose banner on the Routing page with per-item Delete
- [x] **Upstream validation** — reject an upstream that carries a scheme or path (e.g. `https://host:8006/`) and require a bare `host:port`; the assign flow stored it verbatim into Caddy's `dial`, so a URL produced a malformed, non-connecting route (found during local testing). Done: `validate_upstream` in `assign.py` (422 on scheme/path/missing-or-bad-port) + `isValidUpstream` in `AssignModal`
- [x] **HTTPS / TLS upstreams** — done: instance gains `upstream_tls`; `build_route` + `render_caddyfile` emit a `reverse_proxy` `transport http { tls tls_insecure_skip_verify }` when set; the Assign form has a "Backend speaks HTTPS" checkbox and the routing table shows an `https` tag. Proxmox (HTTPS-only, self-signed on :8006) can now be proxied
- [ ] **Code-split the Docker route / xterm** — the single JS chunk is ~670 kB (Vite warns) because xterm loads eagerly. `React.lazy` the Docker page so xterm only loads when that tab is opened
