[Docs](../README.md) › [Project](../README.md#project)

# Loskai — TODO archive

**Read this when** you want to know how a finished phase (1–33, 37) was built.

Completed phases, moved out of [`TODO.md`](TODO.md) to keep the file that is read at every
session start small — **phases 1–13 on 2026-08-27** (Phase 15, D1), **14–17 on
2026-09-09** and **18–33 and 37 on 2026-11-05** (Phase 40), once every one of them had closed
— 28 and 29 with one live check each still to run, listed in `TODO.md`. Nothing here is live work: it is the
checklist as it was ticked off, kept because several items record *why* a thing was built
the way it was. `HISTORY.md` remains the narrative record; this is the checklist.

Two entries here are worth knowing about even if you never read the rest:

- **Phase 16** carries the route-ordering defect — every route Loskai pushed was dead behind
  the Caddyfile's terminal wildcard block, and it failed as an empty `200` rather than a
  `502`. The current-state versions live in
  [`caddy-api.md`](../reference/caddy-api.md#2-add--assign-a-route) and
  [`troubleshooting.md`](../guides/troubleshooting.md#a-blank-page-or-an-empty-200).
- **Not everything in here is finished.** "Completed phases" was optimistic: **Phase 12** has
  no completion marker and every item unchecked. **Phases 10a and 13** each carried a live
  smoke that went unrun for weeks; both ran and passed on 2026-09-16. `TODO.md`'s *Open, not in flight* section is the index; this file
  keeps the checklists.

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
- [x] Create `.env.example` — all vars optional; `BASE_DOMAIN` (e.g. `example.no`) is the domain; `LOSKAI_PASSWORD` guards the admin UI (or set at first run). any ACME/DNS-challenge token belongs to Caddy on its LXC, not Loskai
- [x] Create `HISTORY.md`

---

## Phase 2 — Backend Foundation
- [x] `backend/src/loskai/shared/settings.py` — settings manager (+ `shared/store.py`: atomic JSON read/write, the flat-file I/O seam shared with instances)
  - Reads env vars on startup (highest priority)
  - Falls back to `settings.json` at `/opt/loskai/settings.json`
  - Returns each value with source: `"env"` | `"stored"` | `"unset"`
  - Manages: `caddy_admin_url`, `adguard_url`/`user`/`password`, `wireguard_dashboard_url`, `base_domain`, `caddy_host_ip` (optional — DNS-rewrite answer IP; derived from `caddy_admin_url` host when omitted), `host_ip` (optional — this Docker host's LAN IP, added 2026-07-26 for split-LXC container-route upstream autofill), `recipes_repo_url` (optional — public git repo the install wizard syncs recipes from)
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
  - ~~`render_caddyfile()`~~ — generated a complete, runnable Caddyfile from the instances that have a subdomain; **removed 2026-07-18** (duplicated the JSON config export + Sync backstop, see HISTORY.md)
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
_Contract: [docs/adguard-api.md](../reference/adguard-api.md). Explicit per-instance rewrites, no wildcard rewrite; answer = Caddy LAN IP (host of `CADDY_ADMIN_URL`, or `CADDY_HOST_IP` fallback)._
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
- [x] `scripts/create-adguard-lxc.sh` + `scripts/create-caddy-lxc.sh` — two Proxmox host scripts (run from the Proxmox shell). Split so rebuilding Caddy never takes LAN DNS down
  - Each creates + starts a Debian LXC and provisions via `pct exec`; container ID auto-picked (`pvesh get /cluster/nextid`), IP via DHCP (static assigned afterwards) — all env-overridable
  - AdGuard script: installs AdGuard Home (official installer)
  - Caddy script: installs Caddy from the **official Cloudsmith apt repo**, runs it **as root** (`--resume`), defaults to the **internal CA** (`local_certs` + `tls internal` + `:80` onboarding page); `TLS_MODE=acme` adds the DNS plugin via `caddy add-package` for the public-wildcard path
  - Each prints next steps (finish AdGuard setup / install the root cert, firewall :3000 / :2019). Bash syntax-checked; can't be run outside Proxmox

**Loskai container**
- [x] `Dockerfile` — multi-stage build. Stage 1 (node:20-alpine) builds the frontend; stage 2 (**python:3.12-slim-bookworm**, pinned so the Docker apt repo matches) installs deps with `uv` in two steps (deps cached, then the project), adds `git` + Docker CLI + Compose v2 plugin, copies dist to `./static`, serves on :8080. `+ .dockerignore`
- [x] `compose.yml` — preferred setup (Loskai on the Docker host, Caddy/AdGuard over the LAN); `loskai-settings` volume; same-path `${STACKS_DIR}:${STACKS_DIR}` mount + socket
- [x] `compose.colocated.yml` — all-in-Docker alternative (Loskai + Caddy + AdGuard as containers); port-conflict notes + required `CADDY_HOST_IP`; named volumes for caddy/adguard state
- [x] `caddy/Caddyfile` — the single cert-only bootstrap (admin + internal CA + onboarding, no routes), shared by the co-located image and fetched by the native Caddy LXC (root `Caddyfile` duplicate removed)
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
- [x] `modules/docker/recipes.py` — recipe engine: recipes are **declarative data synced from a public repo**, never executable code. Schema contract: [docs/recipe-schema.md](../reference/recipe-schema.md) (authored by hand/AI, no authoring UI)
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
- [ ] `compose.test.yml` — throwaway Caddy + AdGuard containers (a slim variant of the co-located stack): Caddy `tls internal` (no ACME/DNS token), ephemeral volumes, seeded before each run, torn down after
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
- [x] **HTTPS / TLS upstreams** — done: instance gains `upstream_tls`; `build_route` (and, at the time, `render_caddyfile` — since removed, see Phase 3) emits a `reverse_proxy` `transport http { tls tls_insecure_skip_verify }` when set; the Assign form has a "Backend speaks HTTPS" checkbox and the routing table shows an `https` tag. Proxmox (HTTPS-only, self-signed on :8006) can now be proxied
- [x] **Code-split the Docker route / xterm** — done: `React.lazy` + `Suspense` in `App.tsx` splits the ~670 kB single chunk into `index` (~310 kB) + `Docker` (~365 kB, xterm), so xterm only loads when that tab opens. Vite size warning gone

---

## Phase 10a — Certificate onboarding (internal-CA mode)
_Ship first — standalone, low-risk, doesn't touch the Loskai app. Caddy serves an internal-CA trust page so LAN devices trust `*.BASE_DOMAIN` once. Loskai handles zero cert material (invariant)._

- [x] Move `setup.html` → `caddy/setup/index.html` (bilingual NO/EN, OS-detecting)
- [x] Bootstrap Caddyfile (`dev/Caddyfile`): a **`:80` HTTP site** (reachable by IP — deliberately not HTTPS, to dodge the untrusted-cert chicken-and-egg): `handle /caddy-root.crt` → `file_server` from `/data/caddy/pki/authorities/local/root.crt` (+ `Content-Type`); default `handle` → `/srv/setup`
- [x] Mount `caddy/setup:/srv/setup:ro` in the Caddy service (`compose.dev.yml`; PKI path already in `/data`)
- [x] **Access is by-IP only** — `http://<caddy-ip>/` (dev: `http://localhost:8081/`). No `setup.<domain>` rewrite. Friendly name deferred (see 10b note)
- [x] **Hardened server-discovery** (was "verify") — the `:80` site is a 2nd Caddy server; `next(iter(servers))` could pick it and break route pushes. `service.select_server_name` now picks the routing server by its `:443` listener (fallback: has-routes, then first). +5 tests
- [x] `docs/certificate-setup.md` — the Caddyfile block, the mount, by-IP access (dev + prod), and how one internal root trusts all `*.BASE_DOMAIN` leaves
- [x] Noted the `home.lan` strings are the base domain (documented; leave / parameterize later)
- [x] **Live smoke (user — needs Docker):** `docker compose -f compose.dev.yml up -d`, then `http://localhost:8081/` serves the page and `/caddy-root.crt` downloads the root; confirm Loskai still pushes routes (Caddy card healthy, an assign lands). Not verifiable in-sandbox
  - _**Ran 2026-09-16, passed.** `:8081/` served the onboarding page (`200`, 21.5 kB) and `/caddy-root.crt` a `CA:TRUE, pathlen:1` root, sha256-identical to `/data/caddy/pki/authorities/local/root.crt`. Caddy held two servers — `srv0` on `:443`, `srv1` on `:80` — and Loskai's discovery picked `srv0`, the hardening above. A container routed through the real **Add route** picker landed at index 0 of `srv0` and proxied whoami's body with `Via: 1.1 Caddy`, fetched with `curl --cacert` pointed at the downloaded root and **no `-k`**: the root the page hands out validates the leaves Caddy issues, which is this phase's whole claim. The Routing tab showed Caddy `online` and the row `synced`/`up`._

_Invariants: no cert material in Loskai; the `:80` site has no `@id` so Sync never touches it; unrelated to the deferred Cert-Status (expiry) item._

## Phase 10b — Network tab (repurpose `/vpn`)
_Turn the thin VPN tab into a service-oriented Network tab: AdGuard, the WireGuard Gateway, and Caddy — status + link-out + URL config + a Docker-style "Assign URL" per service._

- [x] Rename `/vpn` route → `/network` (nav label + `Network` icon; retired `pages/WireGuard.tsx` + `WireGuardCard`)
- [x] Three service panels, each with health (from `/api/health`) + link-out (reusable `ServicePanel`):
  - **AdGuard (DNS)** — status + Open-AdGuard link + answer-IP note
  - **Gateway** (WireGuard) — remote-access gateway; carries the peer-DNS reminder (`PeerDnsReminder`)
  - **Caddy (TLS / reverse proxy)** — derived by-IP cert link `http://<caddy_host_ip>/` (:80) + copy-to-share
- [x] Per-panel **inline auto-saving fields** (commit on blur / Enter) — service config moved out of Settings into the panels (`InlineSettingsFields`, partial PUT, same `settings.json` keys, single source): Gateway `wireguard_dashboard_url`; AdGuard `adguard_url`/`adguard_user`/`adguard_password`; Caddy `caddy_admin_url`/`caddy_host_ip`
- [x] Settings slims to app/security: `base_domain`, `recipes_repo_url`, `stacks_dir` (env) + backup export
- [x] **Validated `caddy_host_ip`** must be a bare IP (a stray `http://…` corrupted every AdGuard answer) → 422. The bare LAN IP also derives the by-IP cert link `http://<IP>/` (:80, prod-shaped)
- [x] Per-service **pre-filled "Assign"** (header button, link icon) on AdGuard, Gateway **and Caddy** (cert page → `setup.<domain>`, upstream `<caddy-ip>:80` — Caddy proxies to its own file_server, sweep-safe) → `POST /api/assign` → external instance, reusing `AssignModal`. This is the friendly-name path (dropped the `caddy_setup_url` override in favour of it)
- [x] Update PLAN.md (Network restructure) and HISTORY.md

**Phase 10 complete.** _Unverified in-sandbox (no Docker): the rendered Network tab, the cert-page instance assign, and per-service assign upstream reachability. Smoke-test on device._

> **Superseded by Phase 14 (2026-08-26):** the Network tab this phase built no longer exists.
> Its config fields moved to `Settings > Network` and its status/cert-page link moved to the
> Routing tab. The per-service *assign* buttons were already removed in Phase 11.

---

## Phase 11 — Consolidate route creation into the Routing tab
_One creation surface: the Routing tab's **Add route** picker (Container / Network service / External). The Docker + Network tabs *display* routed state but no longer create routes — killing the competing-assign overlap when infra runs as containers. Routed sources drop out of the picker._

**Stage A — backend link + Routing "Add route" picker**
- [x] Instance gains an `origin` marker (network-service link, mirroring `container`): `get_by_origin`, `assign()` dedups by it + accepts it, `AssignBody.origin`. `origin` + `container` in the caddy `/routes` rows. +1 test
- [x] Routing **Add route** modal (`AddRouteModal`) — source selector `[ Container | Network | External ]`; Container/Network lists show only *unrouted* items (pre-fill subdomain + upstream); External is the manual form. Submit → `/api/assign` with `container` / `origin` / neither

**Stage B — strip Assign from Docker/Network + routed-state display**
- [x] Docker tab: Assign action removed; routed container subdomain badge → link to `https://<sub>.<domain>`
- [x] Network tab: per-panel Assign removed; link-out prefers `https://<sub>.<domain>` when routed (by `origin`) + "Routed at … · manage in Routing" hint. **Caddy cert page keeps the by-IP HTTP link** (exception)
- [x] Docs: PLAN (creation surface), HISTORY, api.md (`origin` on assign)

**Phase 11 complete.** _Unverified in-sandbox (no Docker/live services): the rendered Add-route picker, the routed-state links on Docker/Network tabs. Smoke-test on device._

> **Amended by Phase 14 (2026-08-26):** Stage B's Network-tab routed-state display is gone with
> the tab itself. The core result stands unchanged — route creation is still solely the Routing
> tab's Add route picker, and its "Network service" source (by `origin`) is untouched.

---

## Phase 12 — Internal-CA trust onboarding fixes
_Decision (2026-08-03): the internal CA on a made-up TLD (`*.sunde`) stays. Using a real
owned domain with a DNS-01 wildcard — which would make every device trust the certs with
zero install — is recorded as a **future path, deliberately not scheduled** (see Backlog).
Everything here exists because that choice is deferred._

**12a — Fix the trust-install page** (`caddy/setup/index.html`) — the live defect
- [ ] **Linux instructions are Debian-only and fail on Fedora/Nobara.** The page (`:441-453`)
      treats Linux as one platform and prints `/usr/local/share/ca-certificates/` +
      `update-ca-certificates`; neither exists on Fedora, so the copy-paste silently does
      nothing. Split into **Debian/Ubuntu · Fedora/RHEL · Arch** with a small distro selector
      (the user-agent can't reveal the distro — pick, don't guess)
  - Fedora/RHEL: `/etc/pki/ca-trust/source/anchors/` + `sudo update-ca-trust`
  - Arch: `/etc/ca-certificates/trust-source/anchors/` + `sudo update-ca-trust`
- [ ] **Add Chrome/Chromium on Linux** — reads its own NSS store, ignores the system store
      entirely (the second reason the cert appeared not to work):
      `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Caddy Local" -i caddy-root.crt`
- [ ] Firefox: offer `security.enterprise_roots.enabled` alongside the manual-import note
- [ ] Add a **verify step** so a failed install is visible immediately rather than at the
      next browser warning
- [ ] Keep bilingual NO/EN, static page, no new dependencies
- [ ] Verify on device: Nobara + Firefox + Chromium all trust a `*.sunde` route after
      following the page

**12b — Per-route scheme toggle (HTTPS / both / HTTP)** — _approved 2026-08-03,
**built 2026-09-24** (see `TODO.md` Phase 22 for the build record; the checklist below is
the original specification and every item of it shipped)_
_Exists **only** for clients that cannot hold a custom root CA: dumb devices (TVs,
Chromecast/DLNA, printers, IoT), other **containers** calling the service by name (the root
would have to be baked into someone else's image), and scripts/automation. **Not** a
performance feature — TLS overhead on a LAN is unmeasurable; any latency is the proxy hop,
paid either way. Every case here disappears under the Backlog's real-domain path._
- [ ] Instance gains `scheme: "https" | "both" | "http"`, default `https`. **One enum, not
      two booleans** — two checkboxes admit an invalid both-off state; three values can't
- [ ] `build_route` / `push_route`: `https`+`both` push to the `:443` server as today;
      `both`+`http` additionally push a host-matched route to the **`:80` server**
  - **Must insert at index 0** (`PUT /config/apps/http/servers/{s}/routes/0`), not append:
    the `:80` server's cert-setup site ends in a **catch-all** (an appended route would never
    match), and Caddy's automatic-HTTPS redirect routes live there too and would otherwise
    win over the plain-HTTP route
  - `select_server_name` currently *excludes* `:80` by design (`service.py:45-57`) — needs a
    second selector for the HTTP server rather than loosening the existing one
  - Never disturb the setup site's own catch-all (it has no `@id`; Sync must keep ignoring it)
- [ ] **`both` means two Caddy routes for one instance** → a second `@id` (`<id>-http`).
      Update `list_with_sync` (both must be present to read as synced), `push_all`, and
      delete/unassign (tear down both). Deleting by `/id/<id>` is server-agnostic, so
      teardown needs the extra id, not extra plumbing
- [ ] `http`-only must **not** land in the `:443` server at all — absence there is what stops
      Caddy attempting a cert for that name
- [ ] ~~`render_caddyfile`: emit `http://name`, `https://name`, or both, per scheme~~ — moot, `render_caddyfile` was removed 2026-07-18 (no Caddyfile export exists to update)
- [ ] Frontend: scheme select in `AddRouteModal` + `AssignModal`, scheme tag in
      `ServiceTable`, editable on an existing route. Label it as the CA-less-client escape
      hatch, not a speed option
- [ ] AdGuard is unaffected — same answer IP either way
- [ ] Tests: Tier-1 `build_route`/Caddyfile per scheme + two-id sync/teardown; Tier-2 the
      insert-at-0 request shape

**12c — Caddy as ACME server for HTTPS-native backends** _(config + docs, no Loskai code)_
**Done 2026-09-27** → [`docs/guides/backend-certificates.md`](../guides/backend-certificates.md)
- [x] Document running Caddy's `acme_server` backed by the existing internal CA, and pointing
      **Proxmox's built-in ACME client** at it. Proxmox then serves a leaf signed by the root
      LAN devices already trust — so `:8006` is trusted **directly**, not only through the
      proxy, and Caddy's backend leg verifies cleanly with no pinning
- [ ] Keep `tls_insecure_skip_verify` (the Phase 9 `upstream_tls` behaviour) as the default.
      **Decided against** building per-instance backend-CA pinning (`tls_trusted_ca_certs` +
      `tls_server_name`): it would add CA-upload and server-name-override config surface to
      buy little — an attacker able to MITM the Caddy→backend hop is already inside the LAN

---

## Phase 13 — DNS-only routing mode
_Decouples AdGuard from Caddy for raw host naming (VMs, NAS, any LAN machine) that doesn't
want or need an HTTP(S) reverse proxy — Caddy's `reverse_proxy` is HTTP(S)-shaped, host
naming is protocol-agnostic. Kept inside the existing instance/Routing-table model rather
than a new tab or AdGuard's own UI, so there is still one inventory of named things. See
PLAN.md "DNS-only routing" and `docs/adguard-api.md`._

**Stage A — `route_mode` field + `assign()`/`unassign()` branching**
- [x] `Instance` gains `route_mode: "proxy" | "dns_only" = "proxy"` (`shared/instances.py`)
- [x] `assign.py`: `validate_prefix`/`validate_upstream` take `route_mode` — `dns_only`
      allows dot-separated multi-label prefixes (no wildcard-cert constraint applies) and
      requires a bare IPv4 upstream (`ipaddress.ip_address`, mirrors `caddy_host_ip`/`host_ip`)
- [x] `assign()` Step 1 branches: `proxy` → `upsert_route` (unchanged); `dns_only` →
      `delete_route` (idempotent — tears down a stale route on a proxy→dns_only switch, a
      no-op otherwise). Step 2's answer is `target_answer(inst, current_ip)` — the instance's
      own upstream for `dns_only`, the shared IP for `proxy`. Fixed the `url` field to drop
      `https://` for `dns_only` (no TLS at all) and `caddy: "skipped"` in the response
- [x] `unassign()` needed **no changes** — both steps were already mode-agnostic (Caddy
      delete is 404-safe; AdGuard delete already used the instance's own `dns_answer`)
- [x] `AssignBody`/`post_assign` pass `route_mode` through; defaults to `"proxy"` (backward
      compatible — every existing instance/request without the field behaves unchanged)

**Stage B — per-instance answer IP in AdGuard reconcile**
- [x] `target_answer(instance, current_ip)` — the one helper every AdGuard function now
      routes through instead of the single global `current_ip`
- [x] `is_loskai_domain` relaxed from single-label to any non-empty label(s) under
      `base_domain`, so `dns_only` multi-label names are recognised for the orphan sweep
- [x] `plan_reconcile`: per-instance target (not one global IP); skips a `proxy` instance
      with no derivable `current_ip`; orphan sweep widened to match either the shared IP or
      any currently-routed instance's own `dns_answer` (covers `dns_only` leftovers)
- [x] `dns_status_rows`/`consistency_warnings`: per-instance target, so a `dns_only` row
      reports present/missing independent of whether `CADDY_HOST_IP` is configured at all
- [x] `reconcile()`: `current_ip` is only required when a `proxy` instance is actually
      routed — a LAN made entirely of `dns_only` instances needs no `CADDY_HOST_IP` at all
      (a visible behavior change from the old unconditional requirement — noted in HISTORY)

**Stage C — `push_all`/`list_with_sync` filtering (Caddy module)**
- [x] `push_all` skips non-`proxy` instances entirely (no error entry — just N/A)
- [x] `list_with_sync`: `synced`/`upstream_healthy` are `null` (renders as a dash, not
      "unknown"/"not pushed") for `dns_only` rows; `routed`/`fqdn` unaffected — a `dns_only`
      instance still has a subdomain, just no Caddy projection. Row gains `route_mode`

**Stage D — frontend toggle + `ServiceTable` rendering**
- [x] `frontend/src/lib/validation.ts`: `isValidDnsOnlyPrefix` (dotted labels) +
      `isValidDnsTarget` (bare IPv4, no port, IPv6 out of scope for v1)
- [x] `AddRouteModal`: Proxied/DNS-only toggle, External source only (Container/Network
      always imply proxy); swaps the upstream field's label/hint/validator and drops the
      `https://` prefix from the live preview when DNS-only
- [x] `AssignModal`: same toggle behind a new `allowDnsOnly` prop, wired in `Routing.tsx` as
      `assignTarget?.type !== "docker"` (v1 scope: the toggle is hidden for container-backed
      rows — a frontend-only restriction, not a backend one)
- [x] `ServiceTable`: `RouteRow` gains `route_mode`; a "dns-only" tag pill in the Upstream
      column (same visual precedent as the `https` tag); Route/Live columns render a dash
      for `dns_only` rows instead of "unknown"/"not pushed"
- [x] Tests: new dns_only coverage across `test_assign.py`, `test_caddy_logic.py`, and
      `test_adguard_reconcile.py` (3 existing reconcile tests also updated for the relaxed
      `is_loskai_domain` + conditional `current_ip` behavior) — 163 backend total (was 145).
      Frontend: new coverage in `validation.test.ts`, `AssignModal.test.tsx`,
      `ServiceTable.test.tsx` — 25 total (was 19). `tsc -b`, `vite build`, `oxlint` all clean
- [x] **Live smoke (user — needs a real Caddy/AdGuard):** assign a `dns_only` instance,
      confirm no Caddy route appears in `GET /config/...`, confirm the AdGuard rewrite
      resolves to the raw IP; flip it to `proxy` and confirm a Caddy route appears while the
      rewrite answer moves to the shared Caddy IP. Not verifiable in-sandbox (no daemon)
  - _**Ran 2026-09-16, passed**, against `compose.dev.yml`'s Caddy and AdGuard (v0.107.79).
    Every step was driven through the Routing tab in headless Chromium and checked directly
    in Caddy's config, AdGuard's rewrite list, and an `nslookup` against AdGuard's `:53`,
    not in Loskai's own view of them. **Create** (Add route → External → DNS-only,
    `nas` → `192.168.10.50`): no route in `srv0`, a single rewrite answering `.50`, and DNS
    returned `.50`; the row showed the `dns-only` pill and dashes in Route/Live. **Flip to
    `proxy`** (Change URL, upstream a whoami container): a route at index 0 of `srv0` that
    proxied whoami's body under `curl --cacert`, and the rewrite moved to `.220`. That was
    still a **single** rewrite: the `(domain, .50)` pair was deleted, not left stale. DNS
    followed. **Flip back** to `dns_only` removed the Caddy route (Stage A's
    teardown-on-switch), and **Delete** left no route and no rewrite. `consistency` was `[]`
    throughout. One cosmetic defect found, now in the backlog: the success banner claims a
    route was created on a `dns_only` assign._

---

## Phase 14 — Fold the Network tab into Settings
_Decision (2026-08-26): the standalone Network tab is dissolved. Its per-service **config**
moves into a restructured Settings page with a Forgejo-style nested sub-sidebar; its
**operational status** moves to Routing. The split is not a straight relocation — it separates
*configuration* from *live status*: AdGuard and Caddy are core to what Routing does (it pushes
their state), while WireGuard is only a convenience link with no module health worth watching
there. This walks back Phase 10b's "Network tab" and adjusts Phase 11 Stage B accordingly —
route creation stays exactly where Phase 11 put it (the Routing tab's Add route picker)._

_Locked-in shape: sidebar becomes `Dashboard · Docker · Routing · Settings`; Settings gains
deep-linkable nested routes `/settings` (General) · `/settings/network` · `/settings/security`;
Settings > Network is **fields-only** (auto-save on blur, unchanged) with one acknowledged
exception — WireGuard keeps a small "Open" link since it has nowhere else to live. **No backend
changes**: same `/api/settings` keys, same partial-PUT contract._

**Stage A — nav + nested `/settings` routes**
- [x] `components/shared/Layout.tsx`: drop the `/network` entry from `NAV` and its `dotFor`
      line (`/routing`'s `worst(caddy, adguard)` dot is untouched)
- [x] `App.tsx`: remove the `Network` import/route; add nested `/settings` routes — a
      `SettingsLayout` wrapped **once** in `RequireAuth`, with `index` (General) + `network` +
      `security` children

**Stage B — `pages/settings/` split**
- [x] `pages/settings/SettingsLayout.tsx` — the narrow sub-sidebar (`NavLink`s, reusing
      `Layout.tsx`'s active/inactive treatment) + `<Outlet/>`; owns the "Settings" `<h1>`
- [x] `pages/settings/General.tsx` — today's `pages/Settings.tsx` verbatim (`base_domain`,
      `host_ip`, `recipes_repo_url`, `stacks_dir` + the Backup/export section), minus the `<h1>`
- [x] `pages/settings/Network.tsx` — three fields-only sections (AdGuard / WireGuard / Caddy)
      reusing the existing `InlineSettingsFields` + field defs. **No** `ServicePanel`, status
      badge, `RoutedHint`, or cert-page block. WireGuard section keeps its "Open" link-out +
      `PeerDnsReminder`
- [x] `pages/settings/Security.tsx` — stub reserving the slot; note that admin-password change
      is still unimplemented (no `POST /api/auth/change-password` — see Phase 3's deferred item)
- [x] Delete `pages/Settings.tsx` + `pages/Network.tsx`

**Stage C — `InfraStatusPill` + Routing status strip**
- [x] `components/routing/InfraStatusPill.tsx` — generalize `AdGuardStatus.tsx` (icon, name,
      `ModuleHealth`, url, link label, children for extra content); delete `AdGuardStatus.tsx`
- [x] Unconfigured services render an internal **"Configure →"** link to `/settings/network`
      instead of a dead external link — this is what replaces the guidance the Caddy
      `ModuleStatus` banner used to give
- [x] `pages/Routing.tsx`: replace the AdGuard pill + Caddy `ModuleStatus` banner with two
      `InfraStatusPill`s. **Caddy is promoted** from problem-only to always-visible. AdGuard
      keeps its "answers → `<ip>`" note; Caddy carries the by-IP cert link (derivation moved
      from `pages/Network.tsx`) + a compact copy-to-clipboard button
- [x] `components/shared/ModuleStatus.tsx` itself is unchanged — Docker still uses it

**Stage D — component moves, tests, docs**
- [x] `components/network/` → `components/settings/`: move `PeerDnsReminder.tsx` + its test
      unchanged; delete `ServicePanel.tsx` + its test (no longer used anywhere)
- [x] `tsc -b`, `vite build`, `oxlint`, `npm test` all clean
- [x] Update `PLAN.md` (sidebar list, the Network-tab paragraph, routes list, `frontend/src/`
      tree) + `HISTORY.md`
- [x] **Live smoke (user):** `/settings`, `/settings/network`, `/settings/security` render and
      the sub-nav highlights; `/network` gone from the sidebar; Routing shows both pills
      (healthy + unconfigured) and the cert-page copy button works

**Phase 14 complete.** _Smoke-tested on device 2026-08-27: all seven checks pass, including the
deep-link into `/settings/network`, auto-save on blur, and the unconfigured AdGuard pill falling
back to the internal "Configure" link against a real health payload rather than a mocked one._

---

## Phase 15 — Audit cleanup
_Origin (2026-08-26): a recursive audit traced every definition in `backend/src` +
`frontend/src` to its references and reviewed the documentation structure. 20 findings; IDs
below (F1…D4) match that report. **Nothing here is a new feature** — it is stale text, five
real defects, and consolidation of code that has already drifted once. Came back clean: no
dead exports beyond `api.text()`, no orphan files, `docs/api.md` accurate across all 45 routes,
the `client.py`/pure-logic seam intact._

_Decisions taken up front (2026-08-27), so a fresh session can start at Stage A without
re-litigating them: **F5** splits by file — `settings.json` fails loudly, `instances.json`
degrades (reasoning below); **F16** deletes the unused routes rather than documenting them;
**D1** archives completed TODO phases only — `HISTORY.md` and `PLAN.md` are left alone for now;
**D3** commits the Makefile. F8 and F12 are explicitly out of scope unless the rest lands early._

_**Branch (settled 2026-08-27): `phase-15-audit-cleanup`, off `main`.** Phase 14 passed its
smoke test and landed on `main` (`restructure-settings` points at the same commit), so there
was nothing left to branch around._

**Stage A — stale text (no behaviour change, no test churn)**
- [x] F13 `CLAUDE.md:60` — "Docker **and Network** tabs display routed state but never create
      routes" → Docker only. Phase 14 dissolved the Network tab. Highest value in the phase:
      this file is read as ground truth at the start of every session, so the wrong fact keeps
      propagating into new work (`PLAN.md` was corrected; this was missed)
- [x] F14 `AddRouteModal.tsx:190` — user-visible copy `"set its URL in the Network tab"` →
      Settings > Network, ideally a link to `/settings/network` (the destination
      `InfraStatusPill` already established for "not configured"). Same file `:63` — the header
      comment "the Docker/Network tabs no longer assign" is stale the same way
- [x] F15 — sweep comments narrating a finished build: `main.py:6` ("as each phase adds them"),
      `health.py:3` ("Phases 3–5, 8"), `SettingsFields.tsx:22` ("each Network panel"),
      `SettingsLayout.tsx:6` (claims `ModuleStatus` deep-links to `/settings/network` — it links
      to `/settings`, which is *correct*, since its unconfigured case is `stacks_dir` under
      General). `health.py:52`'s `"health check wired in a later phase"` string is gone, but the
      `else` branch itself was **kept** (now an accurate `"no health check registered"` + a note
      that it is defensive): deleting it would leave `result["docker"]["stacks_dir_ok"]` to
      `KeyError` on a partially-imported app — the opposite of what F1 is about. F1 revisits it
- [x] D2 — add `docs/certificate-setup.md` to the README Documentation list. The only doc
      missing from it, despite being linked from install/dev-testing/troubleshooting and
      covering the most confusing moment a new user hits (the untrusted-cert warning)

**Stage B — correctness**
- [x] F1 `health.py:47` — `result[name] = await checker()` is unguarded, so one raising module
      500s `/api/health` and greys out **all four** cards, breaking the core degradation
      invariant. It holds today only because each checker happens to catch its own errors.
      Wrap each in try/except → `{"status": "unreachable", "detail": describe_error(exc)}`, and
      run them through `asyncio.gather` (four sequential awaits mean one slow service delays
      every other module's status). **Test:** register a deliberately raising checker, assert
      the other three still report. Done, plus: the `consistency` hook is contained the same
      way (same failure mode, same function), and the concurrency is pinned by a test that
      deadlocks if the awaits ever go back to sequential
- [x] F2 `AddRouteModal.tsx:206` — missing `.toLowerCase()` (`AssignModal.tsx:110` has it) and
      no validation hints at all, while `isValidPrefix` rejects uppercase. Typing `Grafana`
      leaves "Add route" disabled with nothing on screen explaining why. Only bites manual
      typing — `suggestPrefix` lowercases the pre-fill. Lowercase on change + port the
      `!prefixOk` / `!upstreamOk` messages across from `AssignModal`
- [x] D4 — add the `AddRouteModal` validation test alongside F2. 305 lines, the single
      route-creation surface, currently untested — which is exactly how F2 survived
- [x] F5 `store.py:16` + `instances.py:39` — corrupt or hand-edited JSON propagates
      `JSONDecodeError` / `ValidationError` up through `settings.value()`, which nearly every
      router calls, so one bad character 500s every page without naming the file. **Split the
      handling — do not "return the default" for settings.json:** `password_set()` reads
      `admin_password_hash` from it (`auth.py:97`), an empty dict makes it `False`, and
      `POST /api/auth/setup` is in `PUBLIC_ROUTES` and only refuses *once one exists*
      (`auth.py:162`) — so a silent fallback converts a corrupt file into unauthenticated admin
      takeover, and `set_admin_password_hash` then writes a fresh dict, destroying the rest of
      the settings. So: **`settings.json` → refuse to boot, naming the path** (Forgejo's
      app.ini model: hand-editable, but a malformed file stops startup with a clear error
      rather than booting on defaults — and Loskai actively invites hand-editing, since
      Settings > Security tells the user to remove `admin_password_hash` manually).
      **`instances.json` → log and skip the unreadable record**; it carries display state only,
      and one bad row must not take the app down. Done as planned, with one refinement the plan
      didn't specify: a *file*-level parse error in `instances.json` raises too (naming the
      path). Only whole records degrade — reading an unparseable file as `[]` would let the
      next upsert write a fresh file over every route
- [x] F4 — no `logging` anywhere in the backend (zero imports). `assign.py:207` swallows a
      failed stale-rewrite delete with a bare `pass`, and the AdGuard half of assign is
      best-effort by design — both defensible, but nothing is recorded anywhere, so the
      operator debugging a leftover rewrite has only a transient UI warning. This is the exact
      failure mode `ff0f167` was written to fix. Add module loggers; `logger.warning` on every
      swallowed exception and best-effort miss. Docker's per-poll stats miss and the exec
      socket teardown log at `debug` instead — both are routine and sit in hot paths
- [x] F3 `App.tsx` — no `path="*"` route, so a mistyped URL renders the Layout chrome with a
      blank pane (the backend SPA catch-all correctly serves `index.html`). Add a `NotFound`
      inside the `<Layout />` element so the nav stays and the pane explains itself

**Stage C — consolidation**
- [x] F6 — two settings-field components with different save models now sit in one page:
      General uses `SettingsFields` (explicit Save button), Network uses `InlineSettingsFields`
      (auto-save on blur — the Phase 14 decision). General was moved across verbatim and never
      migrated. Move it onto `InlineSettingsFields` and delete `SettingsFields`; rehome its
      three exported types (`FieldDef` / `SettingField` / `SettingsView` — `AddRouteModal`
      imports them too). Note `saveLabel` is a prop no caller passes, and the `seeded` flag
      stops the General form ever reflecting a sibling category's save
- [x] F7 — `AssignModal.tsx:56–70` and `AddRouteModal.tsx:137–152` duplicate `isDnsOnly`,
      `prefixOk`, `upstreamOk`, `upstreamHint`, `upstreamHelp` and `fqdn` verbatim (~25 lines,
      including the long split-LXC help string character for character), plus near-identical
      field markup. This is the mechanism behind F2. Extract `useRouteFields()` for the
      derivation + a `RouteFields` component for the three inputs; each modal keeps its own
      chrome and submit payload. **Do this immediately after F2, while the divergence is fresh**
      — done in that order, with D4's tests already in place to catch a regression in the move.
      Split across two files (`useRouteFields.ts` + `RouteFields.tsx`): oxlint's fast-refresh
      rule wants a component file to export only components
- [x] F9 `Routing.tsx:32` — a local `interface SettingsView { base_domain?: { value } }`
      shadows the exported one, and both back the same `["settings"]` query key, so two
      different types describe one cache entry. Import the real type, drop the local.
      `Docker.tsx:37` had an inline type on the same query for the same reason — also fixed
- [x] F10 `lib/api.ts` — `api.text()` has zero call sites and its comment names a Caddyfile
      export endpoint that does not exist. Delete it (the only genuine orphan export in the
      frontend)
- [x] F11 — settings keys are enumerated in three places (`config.py`'s `Settings`,
      `settings.py`'s `CONFIGURABLE_KEYS`, the frontend `*_FIELDS` arrays). Forgetting the
      middle one silently makes a key env-only and unwritable from the UI, with no failing
      test and a symptom that looks like a frontend bug. Add a test asserting every
      `CONFIGURABLE_KEYS` entry is a real attribute of the `Settings` model — implemented as an
      equality against the model's fields minus an explicit `ENV_ONLY_KEYS` set, so the reverse
      drift (added to `Settings`, forgotten in `CONFIGURABLE_KEYS`) fails too
- [ ] ~~F8~~ (both route modals hand-roll chrome `Modal.tsx` provides — needs a size prop) and
      ~~F12~~ (`settings.value()`/`resolve()` re-read settings.json per key;
      `derive_caddy_host_ip()` reads it twice per assign and per health poll) — **out of scope**,
      revisit only if Stages A–C land early

**Stage D — housekeeping**
- [x] D3 — commit the `Makefile` (currently untracked, so it helps one checkout and drifts
      from the two files that *are* read) and point README's Develop section at
      `make backend` / `make test-backend`, so the commands have one source of truth
- [x] F16 — delete the six route handlers with no frontend caller: `GET /api/adguard/health`,
      `GET`/`POST`/`DELETE /api/adguard/rewrites`, `GET /api/caddy/health`,
      `GET /api/caddy/upstreams`, `GET /api/wireguard/status`, `GET /api/instances`.
      **⚠ Delete the HTTP route handlers ONLY — every underlying client method stays.**
      `client.upstreams()` feeds `upstream_healthy` in the routes table (`caddy/service.py:113`);
      `list_rewrites()` feeds reconcile (`adguard/service.py:210,236`) and export
      (`export.py:27`); `add_rewrite`/`delete_rewrite` feed assign (`assign.py:205,208,259`).
      Keep each module's `_health_payload` too — the aggregate `/api/health` registers it.
      No test references any of these routes, so the suite should be untouched. Remove their
      rows from `docs/api.md` in the same commit — and from `PLAN.md`'s per-module API
      inventories, which listed all six (one line also claimed the frontend reads Caddy's mode
      from `/api/caddy/health`; it has always read it from the aggregate health payload)
- [x] D1 — move completed Phases 1–13 out of `TODO.md` into `docs/todo-archive.md`, leaving
      Now/Next/Backlog plus any live phase. ~196KB across PLAN + HISTORY + TODO is read at every
      session start per CLAUDE.md, against that same file's "context fills fast" warning; this
      reclaims ~50KB, is fully reversible, and matches the tiered structure CLAUDE.md already
      describes. Leave a pointer line at the top of TODO.md. **`HISTORY.md` and `PLAN.md` are
      deliberately not touched** (decided 2026-08-27). Phase 14 stays alongside Phase 15 —
      it is what this phase cleans up after. `CLAUDE.md`'s project-state paragraph was updated
      in the same commit: it still claimed Phase 12 was in progress

**Follow-ups — durability of the flat store** (2026-08-28, not part of the original 20
findings; both surfaced from reviewing F5's blast radius)
- [x] `write_json` renamed its temp file over the target without an `fsync`, so a power cut
      could commit the rename with the data still in cache — a zero-length `settings.json`
      that then refuses to boot. This was the only way the app could produce a corrupt store
      file itself rather than being handed one by a hand-edit. The containing directory is
      deliberately **not** fsynced: that only decides whether the newest write survives a
      crash, and losing one settings change is fine where losing the file is not
- [x] Every writer rewrote the whole file after a separate read, and the writers span both
      execution contexts FastAPI uses — sync handlers in the threadpool (`PUT /api/settings`,
      `PATCH /api/instances`) and async ones on the event loop (assign, reconcile) — so two
      overlapping cycles silently discarded one side's change. A settings key reverting in the
      UI is annoying; a dropped **instance record** leaves its Caddy route + DNS rewrite live
      but unmanageable, since `instances.json` is the spine both are rebuilt from. Fixed with
      `store.update_json()` (read → mutate → write under one `threading.Lock`, which is what
      the two-context split rules an `asyncio.Lock` out of); `_save`/`_write_stored` are gone,
      so no unlocked write path is left to add a caller to. Reads stay lock-free — the atomic
      rename already gives a reader the whole old file or the whole new one. **Single-process
      only:** adding `--workers` to the image's `CMD` would need `flock` instead

**Verification (each stage a commit that leaves the repo working)**
- [x] Frontend: `tsc -b`, `oxlint`, `vite build`, `vitest run` — note the sandbox needs
      `export PATH="/home/sunde.guest/.local/node/bin:$PATH"` and direct entrypoints
      (`node ./node_modules/vitest/vitest.mjs run`), since the `.bin` shims are blocked
- [x] **Backend: `pytest` — 181 passed (2026-08-31).** Includes all 30 tests in the four
      files that had never executed (`test_health_registry.py`, `test_store_corruption.py`,
      `test_store_concurrency.py`, `test_settings.py`). `uv run pytest` still fails in the
      sandbox (`failed to canonicalize .../backend/.venv/bin/python3: Operation not
      permitted`) because uv resolves the venv's interpreter symlink; the venv's
      `site-packages` is readable, so invoking the uv-managed interpreter directly works:
      `PYTHONPATH=".venv/lib/python3.12/site-packages:src"
      ~/.local/share/uv/python/cpython-3.12.13-linux-x86_64-gnu/bin/python3.12 -m pytest`
- [x] **Live smoke (user) — five of six confirmed on real hardware 2026-08-31:** Add route
      rejects/normalises a typed capital (F2); a mistyped URL shows the NotFound pane (F3);
      Settings > General saves on blur with no Save button (F6); Routing still loads and Sync
      still works after F16 removed six handlers; the Add route > Network list shows the
      `Settings › Network` link when a service has no URL set (F14)
- [x] **Live smoke, F5 remainder — both paths ran 2026-09-05** on the dev VM, against the
      real container (`/opt/loskai` bind-mounted, files hand-edited as root the way an operator
      would). A corrupted **file** had already been tested 2026-08-31. The two remaining paths:
      **(a) `settings.json` refuses startup, naming the path.** Truncated it mid-object; the
      container aborted with `CorruptStoreError: /opt/loskai/settings.json is not valid JSON:
      Expecting property name enclosed in double quotes: line 1 column 32 (char 31)` followed by
      `Application startup failed. Exiting.` — exit code 3, no listener on `:8080`, and
      `restart: unless-stopped` turned it into a visible crash loop (`RestartCount=8`) rather
      than a half-running app. Restoring the file brought it back on the next start with
      `RestartCount=0`, so the documented recovery is real.
      **(b) the record-skip path.** Appended `{"id":"bad-row","name":"Broken","type":"not-a-valid-type"}`
      to a *valid* `instances.json` — valid JSON, one schema-invalid row, which is the shape the
      first attempt failed to produce. Only that row was dropped: `GET /api/caddy/routes` and
      `GET /api/export` both returned the one good instance, `GET /api/dashboard` stayed **200**,
      the live route kept serving, and the log carried
      `WARNING loskai.shared.instances: skipping unreadable record in /opt/loskai/instances.json`
      naming the file and the record. The split settled 2026-08-27 — settings fails loud,
      instances degrades — behaves exactly as specified
- [x] **F5 follow-up — `CorruptStoreError` never reaches the operator** (found by the
      2026-08-31 smoke test). The error was raised in three places and **caught nowhere**;
      `main.py` had no exception handler. `/api/health` survived only because F1 wraps its
      checkers individually. Everything else 500'd with an empty body: `shared/dashboard.py:19`
      (**`GET /api/dashboard`** — the public, unauthenticated launcher), the Routing and Docker
      tabs, `shared/export.py:36`, and every path in `shared/assign.py`. The defect was that
      `CorruptStoreError`'s own docstring promises it "always names the path … the operator
      needs to know *which* one to fix" — and that path only ever reached the server log, so
      the operator whose file is broken saw a dead launcher and no reason why. **Fixed
      2026-08-31**: an `@app.exception_handler(CorruptStoreError)` in `main.py` returning
      `{"detail": str(exc)}` at `500`, the error shape `docs/reference/api.md` documents and
      the frontend already renders. It also `logger.error`s explicitly — handling the
      exception stops uvicorn printing the traceback, and losing the server-side record would
      have traded one blind spot for another. Raising behaviour is unchanged, and startup
      corruption still aborts the boot via `verify_readable`. Four tests in
      `test_corrupt_store_response.py` (public dashboard, an authed route, the log, and the
      untouched happy path); the three defect-specific ones were confirmed to fail with the
      handler commented out. **Does not cover making the UI *recover*** — the tabs still show
      an error state, they just now say which file to fix

**Stages A–D landed 2026-08-27** (six commits on `phase-15-audit-cleanup`). Frontend checks
pass — `tsc -b`, `oxlint`, `vite build`, 35 Vitest tests across 9 files (was 29/7). Backend:
185 pytest tests pass (2026-08-31 — first run at 181, plus 4 for the F5 follow-up). Five of
the six live-smoke checks were confirmed on real hardware 2026-08-31, and the surfacing
defect that smoke test exposed is fixed. **Phase 15 is closed 2026-09-05** — the F5 live-smoke
remainder ran on the dev VM once it had Docker, and both paths behaved as designed.

---

## Phase 16 — Ship layout C, fix upstream detection

_Origin (2026-08-30): a review of what Loskai can actually be deployed onto, prompted by the
question "would AdGuard separate + Caddy & Loskai in one Docker stack be better than the
current two options?". Comparing the layouts on **port ownership** produced
[`docs/topologies.md`](../guides/topologies.md) (landed with this phase write-up) and surfaced one
real defect. Two layouts ship today (A split-LXC, B all-in-Docker); **C** (split DNS) is the
one to build._

_**Rescoped 2026-09-02.** The phase was "support all four topologies". Layout D — all three
components merged into one container — is **rejected**, not deferred: it fixes no port
conflict (the only contested port is `53` against the host resolver, which is host-vs-container
and survives the merge), it puts DNS, TLS and the root-equivalent Docker socket in one blast
radius, and it would grow a supervisor onto the single-process image everyone else runs. B
already answers "one box, nothing else set up" without any of that. The reasoning is kept in
[`topologies.md` → Considered and not supported](../guides/topologies.md#considered-and-not-supported)
so it doesn't come back open. **The recommendation is now three-tier: A and C recommended, B
the supported alternative with its caveats stated, D rejected.** Stage D is deleted; Stages
A–C are unchanged in substance._

_Findings that drive the stages below:_
- _**The upstream prefill is wrong in layout B today.** `caddy_mode` (`modules/caddy/service.py:27`)
  decides topology by asking "is `CADDY_ADMIN_URL`'s host an IP?" as a proxy for "can Caddy
  resolve this container's name?". Those diverge whenever Caddy is a container next to managed
  stacks: Compose puts every project on its own `<project>_default`, so Caddy resolves only
  `adguard`/`loskai` (its own project) — never a managed stack. `grep network compose*.yml`
  returns nothing; no shared network is created anywhere. This is the 2026-07-26 split-LXC 502
  trap in the other direction, and it blocks C as well as breaking B._
- _**A loopback `CADDY_ADMIN_URL` silently derives a loopback answer IP.**
  `derive_caddy_host_ip` (`shared/settings.py:157`) has no loopback guard, so
  `CADDY_ADMIN_URL=http://127.0.0.1:2019` yields `127.0.0.1` as the DNS-rewrite answer and
  every LAN client resolves the service to itself. `localhost` instead flips `caddy_mode` to
  `docker` and derives nothing. Found while analysing the merged-container layout, but it is
  **not specific to it** — it is an unvalidated setting that misfires in any arrangement where
  Caddy is addressed over loopback, including the all-in-one LXC variant._
- _**Merging processes does not solve any port conflict.** The three components never contend
  with each other; the only contested port is AdGuard's `53` against the host resolver, which
  is host-vs-container and survives the merge. This is what turned the merged container from a
  planned layout into a rejected one._

_Decisions (2026-08-30, rescoped 2026-09-02): **A and C recommended, B the supported
alternative, D rejected.** **A is the pick wherever Proxmox is available** — widest fault
isolation, and an LXC costs nothing but disk. **C is the pick everywhere else, and is the
friendliest layout to operate**: AdGuard goes on any small always-on box (a Raspberry Pi is
the natural fit, as is a mini-PC or NAS), gets configured once and is never touched again,
while everything you iterate on stays behind one `docker compose` on the main host. **B stays
fully supported and is the honest answer when a second box isn't available** — it ships today
and keeps `2019` off the wire; its caveats (AdGuard's `53` vs `systemd-resolved`, DNS in the
Docker host's fault domain, `name:port` not resolving for managed stacks) are documented at
the point of choice rather than buried. C beats it on every axis except needing one more
device. Stage A is load-bearing for every other stage and lands first._

**Stage A — replace the topology heuristic with real network detection** — **done 2026-09-03**

_Plan written 2026-09-02. The defect: `caddy_mode` answers "is `CADDY_ADMIN_URL`'s host an
IP?" — a **per-deployment** answer to a **per-container** question. `suggested_upstream`
(`modules/docker/logic.py:144`) branches on it, so in layout B every container gets
`name:port`, which resolves only inside Caddy's own compose project. Routing a managed stack
pre-fills a name Caddy cannot resolve → 502._

_**The replacement:** does Caddy's container share a Docker network with the target
container? Intersect → `name:port`. No intersection → `<host_ip>:<published_port>`._

_**Identifying Caddy's container — no new setting.** `CADDY_ADMIN_URL`'s hostname is the key:
`http://caddy:2019` → `caddy`. That is how Loskai itself reaches Caddy, so it is by
construction a name Docker can resolve. An IP host (layout A) means Caddy is off-box, so there
is nothing to look up and the fallback applies._

_**Match on three keys, not just the container name** (revised 2026-09-03). `compose.colocated.yml:9`
pins `container_name: caddy`, so name-matching works for the shipped stack — but a
user-authored stack that omits `container_name` gets `<project>-caddy-1`, and `caddy` is then
only a **network alias**. Name-only matching would miss the exact case Stage B is about. All
three keys are already in the `attrs` `list_containers` reads, so this costs nothing:_
1. _the container name (`c.name`)_
2. _the `com.docker.compose.service` label — already read as `service` for the upstream form_
3. _`NetworkSettings.Networks[*].Aliases`, where Compose puts the service name_

_**Data is already in hand.** `NetworkSettings.Networks` keys sit in the `attrs` that
`list_containers` already reads per container, so the target side costs nothing. Only Caddy's
own networks need a lookup — **once per request, not per container**._

**Decisions to take before coding** (each changes the result, so settle them first):
- [x] **D1 — fallback when Caddy's container can't be identified but `mode == "docker"`**
      (hostname admin URL, no container matches it). Keep today's `name:port`, or prefer
      `<host_ip>:<published_port>`? _Recommend the latter:_ `name:port` only works in the
      narrow shared-network case and is precisely the guess that 502s, while the published-port
      form works from anywhere Caddy might be. **With three-key matching this is nearly
      unreachable** — it needs a Caddy that is a container Loskai can see but matches on
      neither its name, its compose service label, nor any network alias. The remaining real
      case is "Caddy is not a container on this host at all" (a DNS name pointing off-box),
      where `<host_ip>:<published_port>` is simply correct, not a guess
- [x] **D2 — `network_mode: host`.** _Settled: excluded (with `none`) before intersecting._ Such a container's `Networks` is `{"host"}`, so *two*
      host-network containers would "intersect" and wrongly get `name:port` — there is no
      Docker DNS on host networking. **`host` must be excluded from the intersection**, and
      when Caddy is on it the answer is `<host_ip>:<published_port>`. This is a bug the naive
      set-intersection introduces; it does not exist today
- [x] **D3 — what becomes of `caddy_mode`.** _Settled: option (b), per-container._ It still feeds `/api/caddy/status`'s `mode`
      (`caddy/router.py:15`) and the modals' hint copy via `useRouteFields.ts:61,66`
      ("e.g. grafana:3000" vs "e.g. 192.168.10.100:3000"). Either (a) keep `mode` as a coarse
      display summary and soften the copy so it stops asserting a per-container fact, or
      (b) return a per-container hint next to `suggested_upstream` and drop `mode` from the
      modals. _Recommend (a) for this stage_ — (b) touches the health payload and both modals
      for a hint the pre-fill already answers correctly

**The work, in order** (pure logic first — it needs no Docker socket, so it is fully testable
here; the I/O wiring lands after):
- [x] `modules/docker/logic.py` — new pure function taking Caddy's networks + the target's
      networks + `service`/`container_name`/`ports`/`host_ip`, returning the upstream. Honour
      D2's `host` exclusion. Unit-test directly: intersecting, disjoint, `host` on either side,
      Caddy unknown (`None`), no published port, ambiguous multi-port
- [x] `suggested_upstream` needed **no rewiring** — it already formats whichever mode it is
      handed, so the decision moved into `upstream_mode()` beside it and its existing tests
      still describe it unchanged. `mode` as a parameter is gone from the call path: an
      unresolvable Caddy resolves to `lan` directly, so there was nothing left for it to do
- [x] `modules/docker/client.py` — `_caddy_networks(containers, hostname)` (I/O only, returns `None`
      when nothing matches — the `client.py`/pure-logic seam is a hard invariant), resolving via
      the three keys above; read each container's own networks from the `attrs` already fetched
      in `list_containers`. **Unit-test the three-key match**, especially the alias case: it is
      the one the shipped compose file's pinned `container_name` hides
- [x] `modules/docker/router.py:62` — resolve Caddy's networks once per request from
      `CADDY_ADMIN_URL`'s hostname and pass them down beside the existing `mode`/`host_ip`
- [x] Frontend per D3 — the picked container answers for itself in `AddRouteModal`;
      `Routing.tsx` does the same for the edit modal by looking the row's container up in a
      query that shares `AddRouteModal`'s key. Non-container sources keep `caddy.mode`, which
      is its remaining honest use. The `lan` help text no longer blames "a separate Caddy LXC" —
      the reason is per-container now and often has nothing to do with an LXC
- [x] `tests/test_docker_logic.py` (6) + `tests/test_docker_client.py` (5, incl. the alias
      match and the one-API-call guard) + 3 Vitest tests for the hint. Each was confirmed to
      fail on its own defect
- [x] Fix `docs/troubleshooting.md:42` — "In the all-in-Docker (co-located) layout ... Caddy
      shares the Docker network, so a `name:port` like `grafana:3000` is correct" is **false**
      for every managed stack; it is only true inside Caddy's own compose project. **Landed
      2026-08-30**, ahead of the rest of the phase — the claim was actively misleading and
      `docs/topologies.md` contradicted it. The replacement also drops "trust the hint for your
      topology", which is bad advice until Stage A lands
- [x] Extend `tests/test_caddy_logic.py:22` (`test_caddy_mode`) — loopback and `localhost`
      now pinned. `caddy_mode` survives **only** as `/api/caddy/status`'s display summary and
      as the fallback for non-container route sources; it decides no upstream any more

**Stage B — layout C: shared edge network + its own compose file**
- [x] `compose.caddy-loskai.yml` — Caddy + Loskai on the Docker host, AdGuard external.
      `CADDY_ADMIN_URL=http://caddy:2019` (never published), `ADGUARD_URL` a LAN IP,
      `CADDY_HOST_IP` required. It is C's two halves taken from the files that already ship
      them: the Caddy service and `CADDY_HOST_IP:?` come from `compose.colocated.yml`, the
      optional `ADGUARD_*` env from `compose.yml`, since AdGuard is off-box in both A and C.
      `HOST_IP` is passed too — the *same* address as `CADDY_HOST_IP` in this layout, and what
      fills the upstream for a container that is **not** on the edge network. Left as two vars
      rather than defaulting one to the other: nested compose interpolation is unverifiable
      without a daemon (there is none in the dev sandbox), and the settings layer has no
      cross-key derivation to mirror
- [x] Declare a shared `loskai-edge` network Caddy attaches to, so a managed stack can join it
      and be routed **without publishing a host port** — the one capability no other layout has.
      Declared with an explicit `name: loskai-edge` (Compose would otherwise prefix the project,
      leaving nothing stable for another stack to name) and created *by this stack*, so
      `docker compose up -d` stays a single command with no `network create` precondition.
      Caddy gets `networks: [default, loskai-edge]` — `default` is what Loskai reaches
      `caddy:2019` over; Loskai itself stays off the edge network, which is for Caddy→backend
      traffic only
- [x] Document joining a stack to `loskai-edge` (external network stanza) in
      [`docs/topologies.md`](../guides/topologies.md) and [`docs/migration.md`](../guides/migration.md).
      topologies.md gets the stanzas + the four things that bite (keep `default` in the
      service's list or it loses its siblings; `external: true` means the Loskai stack comes up
      first; the port must still be discoverable; the mechanism is not C-exclusive).
      migration.md gets it as an optional post-migration step — the natural moment, since the
      stack is already down — with the two consequences of dropping `ports:` (nothing answers
      on `<host-ip>:<port>` any more, and an existing route needs **Change URL** to repoint)
- [x] ~~Consider surfacing "joined to the edge network" in the Docker tab~~ — **not built.**
      Stage A already surfaces the fact where it is actionable: the Add route modal pre-fills
      `name:port` and says *"Caddy shares a Docker network with this container, so it can dial
      it by name"* (`useRouteFields.ts:66`). A Docker-tab badge would be a second surface for a
      fact the user only acts on in the first, so it is a new UI element carrying no new
      information. Revisit only if the edge network turns out to need *managing* from Loskai
      (joining/leaving a stack), which is a different feature
- [x] Update `scripts/deploy.sh`'s `COMPOSE_FILE` note and the README run section for the third file
- [x] [`docs/install.md`](../guides/install.md) currently walks through layout A only. Since C is
      the recommended path for anyone without Proxmox, it needs its own walkthrough —
      AdGuard on a Pi/mini-PC first, then the compose stack — or the guide splits at step 1.
      **Own walkthrough, not a split at step 1:** C is three steps to A's four (Caddy comes up
      inside the stack, so there is no second box to build) and only the first-run step is
      shared, so a fork at step 1 would have carried two paths through four sections to
      converge at the end. The old "No Proxmox?" pointer section is replaced by C1/C2/C3, which
      reuse A's Step 1 post-setup list and Step 4 by link rather than restating them, and B
      keeps a short paragraph at the end as the no-second-box answer
- [x] **[`topologies.md`](../guides/topologies.md) described C as unbuilt** — the comparison
      table's `Status` row said `planned` and the section blockquote said "Planned — see
      `TODO.md` Phase 16". Done in the follow-up pass below, which also settled the
      half-finished lead-in above "Three things follow from that table"
- [x] **Not on the checklist, found while writing it:** `deployment.md` opened with "Two
      compose files, same image" and called split DNS *planned* — it is the env-var reference,
      so it had to gain C's row in the same commit. Its `HOST_IP` row also still described the
      variable as split-LXC-only, which **Stage A outdated** and layout C makes actively
      misleading (someone reading it in C concludes the variable is not for them, and gets
      blank upstreams for every unpublished container). Same fix in `.env.example`'s
      `HOST_IP`/`CADDY_ADMIN_URL`/`CADDY_HOST_IP` comments, `config.py:39`'s definition-site
      comment, and `docs/README.md`'s install.md row
- [x] **Worse, same sweep: `PLAN.md`'s "Co-located vs External Mode" table still asserted the
      claim Stage A deleted** — `http://caddy:2019` → *"Container names work: `grafana:3000`"*,
      unqualified, in the architecture reference. That is the 502 verbatim. Rewritten so the
      table says what the mode *does* mean (where Caddy runs, whether `2019` reaches the LAN)
      with the per-container derivation stated below it. Dropped a second false sentence
      alongside — "On startup, config.py logs which mode is active"; nothing logs it, and
      `config.py` isn't in `shared/` either. Stage A landed the behaviour and its own docs but
      never swept `PLAN.md`, which is why the pass that ships the layout it misdescribes is the
      one that caught it

**Stage B follow-up (2026-09-04) — the letters now match the recommendation**

_Decision (Sunde): **B and C swap**, and the all-in-one LXC is deleted outright. The letters had
become a record of the order the layouts were thought of rather than an ordering a reader can
use: split DNS was the second recommendation but the third letter, so every page had to say
"A and C are recommended, B is the alternative" — a sentence that has to be read twice. Ordering
them by how much they split (**A** three-way · **B** two-way · **C** one box) makes the letters
carry the recommendation, and the degradation is monotonic: each step down merges one more thing
onto the Docker host. The all-in-one LXC goes because it was never an option — it was recorded
as "documented but unsupported" when the real answer is that it strands the Docker module on the
wrong machine, so nobody should reach for it; keeping a section for it invited exactly the
re-litigation the section was meant to prevent. The **merged single container** stays recorded
as rejected, since that one does get proposed._
- [x] `topologies.md` — swapped in the two recommendation bullets, the comparison table (every
      row's cells reordered, not just the headers), the three "follows from that table"
      paragraphs, and both layout sections, which also swap *position* so the page reads A → B →
      C. C's `53` cost is now stated as **work required before the stack starts**, which is what
      actually separates it from B. Deleted the All-in-one LXC section entire; "Considered and
      not supported" is now one arrangement, not two
- [x] Same swap in `install.md` (heading, the intro pointer, `C1/C2/C3` → `B1/B2/B3`, and the
      no-second-box tail), `migration.md`, `docs/README.md`'s conventions line, `PLAN.md`'s
      Alternative Setups, `CLAUDE.md`, and `compose.caddy-loskai.yml`'s header. Every anchor
      moved with its heading — `check-docs.sh` is what proves none were missed
- [x] **The swap is recorded in three places a reader lands on**, because the letters are load
      bearing in prose that can't be mechanically checked: `docs/README.md`'s conventions line,
      `CLAUDE.md`'s topology summary, and the note under this file's **Now** header. Each says
      the same thing — a letter in an entry written before 2026-09-04 is the pre-swap one
- [x] **Not renumbered on purpose:** `HISTORY.md`'s older entries, `todo-archive.md`, and
      Phase 16's own text above. They record what was decided when, under the names used at the
      time; rewriting them would make the record agree with today at the cost of making it false
      about then, and the dense rationale in Stage A/C is exactly where a careless letter swap
      would introduce a wrong claim. The pointer note is the alternative. The **one** exception
      is the same-day "Split DNS ships" entry, which was written hours before the swap and now
      names the layouts instead of lettering them — leaving a dead letter in an entry about the
      very layout being relettered is confusion with no historical value

**Stage C — loopback guard on the answer IP**
_Kept after the D rescope, and re-justified: this was written up as "the defect that makes
layout D unusable", but it is a **settings-validation gap**, not a D-specific one. Any
arrangement where Caddy is addressed over loopback hits it — the all-in-one LXC variant by
construction, and a co-located B stack the moment someone sets `CADDY_ADMIN_URL=http://127.0.0.1:2019`
instead of `http://caddy:2019`. It fails silently and looks like a DNS problem, which is the
worst combination; the general warning now sits in `topologies.md` under "The ports in play"._
- [x] `derive_caddy_host_ip` must not return a loopback address; when `CADDY_ADMIN_URL`'s host
      is loopback, require an explicit `CADDY_HOST_IP` rather than writing rewrites that
      resolve to the client itself. Done via `_reject_loopback()`, applied to **both** sources
      — the explicit `CADDY_HOST_IP` as well as the derived admin-URL host, because env values
      never pass through `_validate` and that is the only place an env-set `127.0.0.1` is
      caught. It returns `None` and logs a warning rather than raising: `None` is the same
      state as an unset answer IP, which every caller already handles (rewrite skipped, UI
      shows it unconfigured), whereas raising would fail an `/api/health` poll and an assign
      over what is a configuration problem, not a runtime one
- [x] Mirror the check in `shared/settings.py`'s `caddy_host_ip` validation (it currently
      rejects a scheme/port but accepts `127.0.0.1`) — now raises `ValueError` → 422 with a
      message naming the fix, and `_validate` still runs before the store is touched, so a
      rejected value can't clobber a working one
- [x] Tests for both — 13 in `test_settings.py` (IPv4 + IPv6 loopback, `127.0.1.9`, `0.0.0.0`,
      `::`, the env path, the documented recovery, two over-rejection guards, and the
      no-clobber case). Each defect-specific one was confirmed to fail with its guard stubbed out
- [x] **Widened beyond the original scope (2026-09-02):** the unspecified address `0.0.0.0` /
      `::` fails identically — it parses as a bare IP, passes the existing check, and names no
      host, so a rewrite pointing at it resolves to nothing connectable. Same guard, a separate
      branch with its own message, since "loopback" does not describe `0.0.0.0`. The helper is
      now `_usable_answer_ip()` rather than `_reject_loopback()`
- [x] Docs: `deployment.md`'s `CADDY_HOST_IP` row states the constraint, and the
      `topologies.md` warning now says the value is *refused* rather than merely inadvisable.
      No frontend change needed — `answer_ip: null` was already handled (`?? ""` plus a
      conditional render), since hostname mode has always produced it

**Verification**
- [x] `pytest` + `npm test` — **209 backend + 38 frontend pass (2026-09-04)**, matching Stage A
      exactly, which is the expected result: the stage executed no statement (compose, shell and
      docs, plus one comment in `config.py`). Neither suite could run at first — the dev VM had
      no `uv` and no node — so both were installed under `~/.local` (uv 0.12.9; node 24.20.0
      symlinked into `~/.local/bin`, which `.profile` already puts on `PATH`), then
      `uv sync` + `npm install`. `uv run pytest` works here; the interpreter-symlink workaround
      recorded under Phase 15 was specific to the other sandbox
- [x] **`docker compose config` on all four compose files (2026-09-04)** — Docker went onto the
      dev VM after Stage B shipped, so `compose.caddy-loskai.yml` was written and committed
      without ever being parsed by a real Compose. It validates, and the two things that were
      guesses are confirmed: `networks: [default, loskai-edge]` resolves with `default`
      implicitly defined, and `name: loskai-edge` keeps the network **unprefixed**
      (`loskai_default` beside a bare `loskai-edge`) — which is the whole mechanism, since a
      prefixed name is not one another stack could attach to. The documented consumer stanza
      renders correctly too (external, unprefixed, the consumer's own `default` still
      project-scoped). Note this needs no daemon access — `config` interpolates locally
- [x] `bash scripts/check-docs.sh` — clean after Stage B: 21 markdown files, 13/13 docs
      reachable, 17 source/config citations and 12 written-out paths resolving, and both new
      anchors (`#routing-a-container-without-publishing-a-port`,
      `#no-proxmox-install-layout-c--split-dns`) valid
- [x] **Live smoke — ran 2026-09-05 on the dev VM**, split DNS (`compose.caddy-loskai.yml`,
      `BASE_DOMAIN=smoke.test`, `CADDY_HOST_IP`/`HOST_IP` the VM's `192.168.10.220`) with
      **`ADGUARD_URL` deliberately unset**, which sidesteps `:53` vs `systemd-resolved` entirely
      and doubles as a graceful-degradation check. The routed target was a throwaway
      `traefik/whoami` stack in its own compose project under `STACKS_DIR`, run both ways:
      - **Disjoint networks** (`whoami_default` only, published `8081:80`) → `upstream_mode: lan`,
        `suggested_upstream: 192.168.10.220:8081`. **This is the Stage A fix doing its job:** the
        old heuristic asked "is `CADDY_ADMIN_URL`'s host an IP?", and here it is `caddy`, so every
        container would have been pre-filled `web:80` — a name resolvable only inside Caddy's own
        project. That is the 502 the phase was written about
      - **Joined to `loskai-edge`, no published port at all** → `upstream_mode: docker`,
        `suggested_upstream: web:80`, and Caddy dialled it over the edge network (the proxied
        response's `RemoteAddr` was Caddy's edge-network address). The documented consumer stanza
        (`external: true`, `default` kept in the service's list) worked verbatim. This is the
        capability nothing else has, and it had no runtime verification before today
      `POST /api/assign` returned `caddy: ok, adguard: skipped` with the warning
      `"AdGuard is not configured — DNS rewrite skipped."` both times — best-effort AdGuard
      behaving as specified. `/api/health` reported Caddy `healthy` with `server: srv0`
      *discovered*, and `answer_ip: 192.168.10.220` (Stage C's guard passing a non-loopback value).
      `POST /api/caddy/push` twice in a row left exactly one route, still at the head, still
      serving — delete-then-add is idempotent under head-insertion too.
      **Both prefilled upstreams were correct, and both routes still returned an empty page.**
      See the defect below — it is why this checkbox took a full session rather than a curl

**The defect the smoke found — every pushed route was dead (fixed 2026-09-05)**

_This is the one a green checkbox would have buried. `curl` returned **`HTTP 200`** on the
first try, which is literally what this phase's checklist asked for — but with
`content-length: 0` and no `Via: Caddy` header. The backend served 166 bytes directly on
`:8081`; through Caddy it was 0. The route was not proxying; **the 200 came from something
else entirely.**_

_**Cause.** `caddy/Caddyfile` declares `*.{$BASE_DOMAIN} { tls internal }` so Caddy issues the
wildcard cert. A site block with no handlers compiles to `{"match":[{"host":["*.smoke.test"]}],
"terminal": true}`, and the Caddyfile adapter puts it **first** in `srv0.routes`. It matches
every name Loskai routes and terminates evaluation, returning an empty 200.
`client.push_route` used `POST …/routes`, which **appends** — so every route Loskai has ever
pushed in this layout landed behind it and never ran._

_**Proven, not inferred.** Same route object, same upstream, moved to index 0 by hand via the
admin API: 300 bytes of whoami output and `Via: 1.1 Caddy`. Appended: empty 200. Both ways,
twice, on both the `lan` and `docker` upstream forms._

_**Blast radius.** Anywhere Caddy runs `caddy/Caddyfile` with the real `BASE_DOMAIN`: split DNS
and all-in-Docker, always. Split-LXC in `acme` mode too — its inline Caddyfile has the same
handler-less `*.{$BASE_DOMAIN}` block (`create-caddy-lxc.sh:264`). **Split-LXC in `internal`
mode escapes by accident**, and only by accident: the script feeds the unit
`BASE_DOMAIN=localhost` as a placeholder (`UNIT_BASE_DOMAIN`, `create-caddy-lxc.sh:308`), so the
block is `*.localhost` and matches nothing Loskai routes._

_**The escape was measured, not just read (2026-09-05, later the same day).** Sunde's live
split-LXC Caddy was checked directly: `srv0` holds a terminal `*.localhost` at index 0 with
**eight** Loskai-pushed routes appended behind it, and they serve real bodies —
`forgejo.sunde` 14264 bytes, `proxmox.sunde` 2657. Same server, `foo.localhost` returns the
empty `200`. The bug and the escape side by side on one Caddy._

_**And that is why this survived fourteen phases.** Every environment Loskai had ever actually
been run against carries the placeholder: split-LXC internal via `UNIT_BASE_DOMAIN`, **and the
dev rig**, whose `dev/Caddyfile` uses `*.localhost` for the same cert-on-demand reason and
says so in a comment. The real domain only ever reaches that block in the two configs nobody
had run. **The trap that follows:** a developer who sets `BASE_DOMAIN=localhost` in the dev rig
— a natural choice the old comment invited — reproduces the defect in dev. `dev/Caddyfile` now
says not to._

_**Why no test caught it.** Every layer was individually right: the route JSON was correct, the
upstream was correct and reachable, `@id` addressing worked, `list_live_routes` found the route,
so `/api/caddy/routes` reported `synced: true` **and** `upstream_healthy: true`. The bug lives
only in the *position* of a correct object inside an array Loskai does not own the first element
of — invisible to any test that mocks the Caddy client, which is all of them. It needed a real
Caddy holding a real Caddyfile-adapted config._

- [x] `modules/caddy/client.py` — `push_route` now `PUT …/routes/0` (insert at head) instead of
      `POST …/routes` (append). Verified against the live admin API that `PUT` at index 0 is also
      a plain insert on an **empty** array, so there is no first-route special case. Ordering
      among Loskai's own routes stays irrelevant — they match single specific hosts and really
      are disjoint from each other; the only ordering that ever mattered is "ahead of the
      wildcard"
- [x] Two tests in `test_caddy_client.py` — the updated verb/path assertion and
      `test_push_route_inserts_at_head_not_appends`, which pins the `/routes/0` **path** rather
      than just the verb, since the verb alone would pass against `PUT …/routes`. Both confirmed
      to fail with `POST …/routes` restored (backend 209 → 210)
- [x] **The contract docs asserted the opposite, in four places**, and that is the real reason
      this shipped: `docs/reference/caddy-api.md` §2 ("append order does not matter — sibling
      routes with disjoint hosts are order-independent") and its *Not used* list ("`PUT
      /config/...` (insert-at-index) — not needed; ... append is always sufficient"), plus
      `PLAN.md`'s "Specific hosts are disjoint, so append order never matters" and its
      `POST …/routes` route-identity line. The reasoning was half right — Loskai's routes *are*
      disjoint from each other — and it never asked what else was in the array. All four now
      state the constraint and name the wildcard block as the reason; `POST …/routes` moved into
      *Not used* with a note that it is the obvious call and the wrong one
- [x] Re-smoked end to end **after** rebuilding the image, from a fresh `docker compose down -v`
      (so Caddy's autosaved config could not mask it) and through Loskai's own assign path rather
      than a hand-inserted route: `HTTP 200`, 300 bytes, `Via: 1.1 Caddy`, on both the `lan` and
      `docker` upstream forms
- [x] `docs/guides/troubleshooting.md` — new **"A blank page, or an empty 200"** section, first
      in the triage table because it is the one symptom that reads as success. Carries the
      three-way signature measured on a real Caddy (empty `200` = shadowed · `502` = route ran,
      upstream unreachable · TLS handshake failure = no route at all), the `jq` one-liner that
      shows the ordering, and the note that anyone on a pre-2026-09-05 build should update and
      re-push from **Routing → Sync**

**Layout A live smoke (2026-09-05) — the recommended layout, also never run before**

_Sunde offered a real split-LXC Caddy (`192.168.10.177`, native `:443`, nine routes already in
it), so `compose.yml` — the layout A compose file, itself never brought up — was pointed at it
with `CADDY_ADMIN_URL=http://192.168.10.177:2019` and **no `CADDY_HOST_IP`**, which is how that
file ships. Everything held:_
- _`server: srv0` **discovered** from a genuine two-server config (`srv0` `:443`, `srv1` `:80`
  onboarding) — `select_server_name` skipping the `:80` server had only ever been unit-tested_
- _`mode: lan` and **every** container pre-filled `<host_ip>:<published_port>`, which is Stage A's
  D1 decision executing live: an IP admin URL means Caddy is not a container this daemon can
  see, so the name form is never offered_
- _`answer_ip: 192.168.10.177` **derived from the admin URL host** — the other branch of Stage C,
  the one `compose.yml` depends on by not passing `CADDY_HOST_IP` at all. It correctly answers
  Caddy's IP, not the Docker host's_
- _End to end across two machines: their Caddy dialled back to this VM and returned `HTTP 200`,
  306 bytes, `Via: 1.1 Caddy`, `RemoteAddr: 192.168.10.177`_
- _**Head-insertion verified non-destructive against a populated config.** The route landed at
  index 0; the nine existing entries shifted down one, order and `@id`s intact, and all six
  reachable ones answered **byte-for-byte** what they had before the push. On unassign the
  whole config compared **identical to the baseline** taken before any write_

---

## Phase 17 — Documentation restructure

_Origin (2026-08-30): a full audit of all 16 markdown files (5,275 lines) against the current
code and project direction. The docs are individually accurate but structurally flat — 13 files
in one `docs/` namespace with no index, no audience segmentation, and the only map being an
unordered list in `README.md`. Findings below; `docs/api.md` came back **clean** (all 36 backend
routes covered — `api.md:103` documents start/stop/restart in one row, which is why a naive
count reads 34)._

_Findings:_
- _**No entry point.** No `docs/README.md`. A reader — or a fresh session — has to guess which
  of 13 files answers their question._
- _**No segmentation.** Operator guides, API contracts and contributor docs share one flat
  namespace with no naming or grouping convention._
- _**`CLAUDE.md`'s doc map names 4 of 13** (`caddy-api`, `adguard-api`, `recipe-schema`,
  `migration`). `topologies`, `deployment`, `troubleshooting`, `install`, `certificate-setup`,
  `api`, `dev-testing` and `lxc-script-authoring` are invisible to a session reading only
  `CLAUDE.md` — the single highest-value fix in this phase, for the same reason F13 was in
  Phase 15._
- _**Port-conflict content is in three places** — `PLAN.md:1054` ("Alternative Setups" + its own
  co-located port table), `docs/deployment.md` ("Co-located port notes"), and
  `docs/topologies.md`. PLAN's copy is now the least complete **and contradicts** the 2026-08-30
  A/C recommendation._
- _**`PLAN.md:1057` names a fifth topology** ("All-in-one — AdGuard, Caddy, and Loskai all on a
  single LXC") that appears in no other doc and is absent from the four-way comparison._
- _**Stale in `PLAN.md`:** the "Network tab" (dissolved by Phase 14) and "LXC 103" in the
  Resilience Summary (pre-split numbering; the two-LXC split landed 2026-07-20)._
- _**`docs/todo-archive.md` is 480 lines / 50KB of project tracking** sitting in `docs/` — the
  second-largest file there, and not documentation._
- _**Three pre-existing broken links:** `todo-archive.md:105` and `:199` link `docs/adguard-api.md`
  / `docs/recipe-schema.md` from *inside* `docs/`; `caddy-api.md:20` links `#server-name-discovery`
  but the heading is `### 1. Discover the server name`._

_Decisions taken up front (2026-08-30, all three confirmed by the user): **nested by audience**
(`guides/` · `reference/` · `contributing/`) over flat-plus-index — clearest segmentation, reads
best on GitHub, and the repo is small enough that the one-time link churn is cheap. **PLAN.md is
pruned of duplication only** — the port table and Alternative Setups become a pointer; the
architecture sections (data model, modules, assign) are not touched, per the global rule that
PLAN.md changes only when direction shifts. **`todo-archive.md` moves out of `docs/`** to the
repo root beside `TODO.md`/`HISTORY.md`. Every move uses `git mv` so history follows, as the
2026-07-18 compose rename did._

**Stage A — the move**
- [x] `git mv` into `docs/guides/` — `install`, `topologies`, `deployment`, `certificate-setup`,
      `migration`, `troubleshooting`
- [x] `git mv` into `docs/reference/` — `api`, `caddy-api`, `adguard-api`, `recipe-schema`
- [x] `git mv` into `docs/contributing/` — `dev-testing`, `lxc-script-authoring`
- [x] `git mv docs/todo-archive.md todo-archive.md`
- [x] Rewrite every cross-reference for the new depths (`../reference/x.md`, `../../PLAN.md`).
      ~40 links across 16 files, including `PLAN.md`, `TODO.md`, `HISTORY.md` and `README.md`
- [x] Fix the three pre-existing broken links found in the audit

**Stage B — `docs/README.md`, the index**
- [x] Task-oriented entry points ("I want to install it" / "…route a service" / "…change the
      code" / "…know what an endpoint returns") above the file listing — the wiki front page
- [x] One line per doc saying **when to read it**, not what it contains
- [x] Note which docs are contracts with external APIs (read before touching that integration)
      and which describe Loskai's own behaviour

**Stage C — prune duplication and staleness**
- [x] `PLAN.md` "Alternative Setups" + "Co-located port notes" (`:1054`–`:1085`) → a short
      pointer to `docs/guides/topologies.md`, which now carries the full four-way comparison
- [x] `PLAN.md:1057` — the fifth "all-in-one LXC" layout was a loose end referenced nowhere
      else. **Folded into `topologies.md` as a documented variant** (2026-08-30), not dropped:
      it is not a peer of A–D (D's shape, A's mechanism), and on ports it is the best-behaved
      arrangement of all — but `docker.from_env()` (`modules/docker/client.py:34`) defaults to
      the local socket, so Loskai on its own LXC strands the Docker module unless the Docker
      API is exposed over TCP. Documented, explicitly not supported
- [x] `PLAN.md` — "Network tab" → Settings > Network (Phase 14); "LXC 103" → the current split
- [x] `docs/guides/install.md` "Alternative: all-in-Docker" — predates the A/C recommendation and
      still frames all-in-Docker as *the* non-Proxmox answer
- [x] `docs/guides/deployment.md` "Co-located port notes" — keep the operational note, drop what
      `topologies.md` now says better

**Stage D — make the map usable by a fresh session**
- [x] `CLAUDE.md` — replace the 4-doc list with the new structure and point at `docs/README.md`
      as the entry point. This is what makes the restructure pay off for future sessions
- [x] `README.md` — the Documentation list becomes a short pointer to `docs/README.md` plus the
      three or four links a new user actually needs, not all 13

**Verification**
- [x] Link + anchor checker clean across every `.md` (the audit's script, extended for the
      nested depths)
- [x] `git log --follow` resolves through each move
- [x] Every doc reachable from `docs/README.md`; no orphans
- [x] **`scripts/check-docs.sh` + `make check-docs`** (added 2026-08-31) — the checks above were
      one-off scripts that vanished with the session, so "0 broken, no orphans" was a claim
      about a moment rather than a property of the repo. Now enforceable and CI-gateable
      (exits non-zero). Verified against all three failure modes plus the code-fence exemption

**Phase 17 landed 2026-08-30** (three commits). 13 docs moved into `guides/` · `reference/` ·
`contributing/` with `git mv`; 40 cross-references rewritten; `docs/README.md` added as the
index. Link + anchor checker reports **0 broken** across all 17 markdown files, all 13 docs are
reachable from the index with no orphans, and `git log --follow` resolves through every move
(`todo-archive.md` keeps 72 commits of history). Four broken links fixed along the way — the
three the audit found, plus one `#alternative-all-in-docker` self-link the checker caught after
`install.md`'s heading was renamed.

---

## Phase 18 — Get Loskai's paths out of `/opt`

_Origin (2026-09-05, immediately after the Phase 16 smoke): running the thing for real
surfaced the friction. `STACKS_DIR` defaulted to `/opt/stacks` and `LOSKAI_DATA_DIR` to
`/opt/loskai` — both need root to create, so the smoke had to point them elsewhere before it
could start. `dev-testing.md` carried a troubleshooting row for `PermissionError: '/opt/loskai'`,
and `.env.example` shipped `STACKS_DIR=/opt/stacks` with no `LOSKAI_DATA_DIR` line at all, so
copying it and running `make backend` hit that error by construction. The default was right for
exactly one of the three contexts it is used in — a container running as root — and wrong for
the two a person actually touches._

_**Decisions (Sunde, 2026-09-05).** Keep the same-path invariant rather than lifting it with
`--project-directory`; default both paths beside the compose file; env vars stay as pure
overrides. On the container's filesystem looking odd: "i dont care how the file system inside
the docker container looks as long as it works and makes it simple for the end user — if that
requires that the paths on host and docker container mirror each other then that is what we
will do."_

**What shipped**
- [x] **`./data:/data`** replaces `./loskai-settings:/opt/loskai` in all three compose files;
      `config.py`'s `data_dir` default follows. `LOSKAI_DATA_DIR` stays an override, and dev
      sets it (the in-container path isn't writable from the host) — `.env.example` now says so
- [x] **`STACKS_DIR` defaults to `${PWD}/stacks`**, was `/opt/stacks`. `config.py`'s own default
      is anchored to the repo the way `_REPO_ROOT_ENV` already was, so `make backend` works with
      nothing set. **`config.py:49` was deliberately left alone in the first pass** and only
      changed once every other `/opt/stacks` was gone — the code default fires only when nothing
      set it, so it is a last-resort value, not a deployment default
- [x] **`data/`, `data/recipes/` and `stacks/` are tracked** (a `.gitkeep` each), because Docker
      creates a missing bind source as `root:root 755` — measured, not assumed. Without them a
      fresh clone gets root-owned directories and `data/recipes/`, the folder recipes are
      *hand-added* to, needs `sudo` for every write. That was already true before this phase
- [x] `deploy.sh` checks for a stranded `loskai-settings/` right after the `git pull` that swaps
      the compose file, and stops with the command to run
- [x] Docs: `deployment.md` (env table, Volumes, the same-path section + a new *run compose from
      the project directory* subsection, and *Upgrading from `/opt/loskai`*), `migration.md`
      (a new **Moving Loskai itself** section), `install.md`, `dev-testing.md`,
      `recipe-schema.md`, `.env.example`, `PLAN.md`, `docs/README.md`, `CLAUDE.md`

**Walked back within the same session — an in-app startup guard**

_Built, tested, then deleted. `verify_data_dir()` refused to boot when state was stranded at
`/opt/loskai`. It worked, it had five tests (including one pinning that it ran **before**
`auth.ensure_seeded()`, which writes `settings.json` and would otherwise mask the stranding),
and it needed a `conftest.py` patch so a developer with a real `/opt/loskai` didn't fail every
test that starts the app. **137 lines.**_

_Sunde: "would a missing settings.json indicate a first run? So we would need to set the password
again and redo the settings, not the end of the world … I dont think we need to gate keep so
much, the important part are that it works and gives a massege if something is wrong."_

_Right, and the measurement backs it: the destructive case (old mount kept, `/data` unmounted,
writes going to the container layer) needs a locally-modified compose file to survive
`git pull --ff-only`. The case that will actually happen is a fresh install with the old state
untouched on disk — recoverable, and caught host-side by `deploy.sh`. **Refusing to boot is the
convention for data stores** (Postgres on a `PGDATA` version mismatch, Elasticsearch on an
incompatible data dir) where a wrong guess destroys something irreplaceable; Loskai's state is
re-enterable, and the routes themselves live in Caddy keyed by `@id`, so even the instance list
is readable back out of Caddy's config. Wrong category for that machinery._

**Verification** — the three checks, plus live runs, because this is exactly the class of thing
static checks miss:
- [x] `pytest` (210) + `npm test` (38) + `check-docs.sh`
- [x] **Fresh `git clone`, no `.env`, `docker compose up -d`** — boots, `/api/dashboard` 200, the
      UI serves, first-run setup works, state lands in the clone's own `data/`. A hand-written
      recipe dropped into `data/recipes/` as a normal user (no `sudo`, no container access, no
      restart) is picked up as `source: local`
- [x] **The same-path rule proven through Loskai**, not just in `compose config`: a managed stack
      with `./payload:/payload`, started via `POST /api/docker/stacks/demo/action`, produced
      `Source=<clone>/stacks/demo/payload` — the correct *host* path — and no stray `/stacks` at
      the host root
- [x] **A relocation, end to end.** `mv` the whole install to a new path and bring it up: the
      relative bind followed (`<old>/…/payload` → `<new>/…/payload`), the named volume reattached
      (`demo_dbdata`, since the project name is the stack directory's basename), both kept their
      data, and Loskai still knew its admin password and rediscovered the stack. Written up in
      `migration.md` along with the three things that *don't* survive a move to a new **machine**
- [x] The migration command in the docs was **wrong on the first pass** and the live run caught
      it: `mv loskai-settings data` nests the state at `data/loskai-settings/` because `data/`
      now always exists. It is `mv loskai-settings/* data/ && rmdir loskai-settings`

**Known sharp edge, accepted and documented**

_The default is `${PWD}/stacks` because **Compose has no interpolation variable for the project
directory** — verified: `COMPOSE_PROJECT_NAME` resolves correctly even via `-f` from elsewhere,
but no path variable exists. So compose must be run from the project directory; `deploy.sh`
`cd`s there first. Run it from somewhere else and stacks point at `<that directory>/stacks`,
which the Stack Manager shows as an empty list rather than an error, because Docker created the
directory. Setting `STACKS_DIR` to an absolute path pins it. This affects **only** `STACKS_DIR`:
`./data` is resolved by Compose against the project directory, so state is correct from
anywhere. That asymmetry is the price of same-path, and lifting it needs the
`--project-directory` + `--env-file` pair (measured to work, and to fail **silently** on a
stack's `.env` if the two ever drift) — considered and not taken._

---

## Phase 19 — The Certificate page

_Origin (2026-09-09, Sunde): "I want to instead have a little download button on the caddy pill
that is displayed on the routes page." The root was only reachable through Caddy's `:80`
onboarding site, so getting it meant leaving Loskai for a by-IP URL._

_**Decisions (Sunde, same session).** The pill button was dropped in favour of a dedicated page
— "we might not need the download button on the caddy pill in routes if we are making a
dedicated page." The page is **public like the Dashboard**, with its sidebar link controlled
from settings, because "if we have acme domain the browser would automatically trust it and we
no longer would need the internal root." The `:80` site stays._

**Why not just link the pill at Caddy's `:80` file**

_A plain-HTTP download initiated from an HTTPS page is blocked by Chrome and Edge, **without a
visible error** — and Loskai is normally reached over HTTPS through Caddy, so that is the case
that matters. Serving the PEM from Loskai's own origin is what makes the download work at all.
Reading it from Caddy's **Admin API** rather than its data volume is what makes it work in
split-LXC, where Caddy's disk is on another machine._

**What shipped**
- [x] **`GET /api/caddy/root-certificate`** — `client.local_ca()` (`GET /pki/ca/local`, the only
      cert-material call Loskai makes) + a pure `service.root_certificate()` that takes the root
      alone and rejects a PEM missing its markers. A truncated anchor installs fine and fails
      later, at the browser, after the user believes they fixed it
- [x] **Public**, in `PUBLIC_ROUTES` — the device that needs the root has no admin password and
      cannot yet trust the HTTPS route it would log in over. No key material is involved; a root
      CA is public by construction
- [x] **`/certificate`** — download plus per-OS trust steps, outside `RequireAuth`. Platform
      tabs rather than the `:80` page's detect-only display, which stranded a phone on desktop
      instructions
- [x] **`certificate_tab`** setting (`public` / `admin` / `hidden`, default `public`; env
      `CERTIFICATE_TAB`, Settings → Network). It moves a **link, not a lock** — `/certificate`
      and its download stay public in every mode, and the tests say so
- [x] Rides on `GET /api/dashboard`, the one payload a logged-out visitor can read, so the
      sidebar can decide before anyone logs in. New `useDashboard` hook so both consumers of
      the `["dashboard"]` key share one type
- [x] **12a fixed on both pages** — Debian, Fedora/RHEL and Arch/openSUSE trust stores, and the
      NSS database Chrome and Chromium read on Linux instead of the system store. A
      system-wide install alone leaves the warning in place in the browser most people use
- [x] `check-docs.sh` check 2 now reads a `public: true` marker on each `NAV` entry instead of
      excluding `Dashboard` by name — otherwise a second public tab reads as a missing admin tab
- [x] Docs: `certificate-setup.md` (rewritten around the two paths, with a table for which to
      use), `api.md`, `caddy-api.md` (`/pki/ca/local` moved out of *Not used* — the dead-end
      note there was about cert **expiry**, which it still is), `deployment.md`, `PLAN.md`,
      `CLAUDE.md`

**Verification**
- [x] `pytest` (222) + `npm test` (48) + `check-docs.sh`
- [x] **Live, against a real Caddy.** The PEM Loskai serves is **byte-identical** to
      `/data/caddy/pki/authorities/local/root.crt`, the file the `:80` site hands out, and
      `openssl x509` reads it as `CA:TRUE, pathlen:1`. Fetched with **no session cookie**;
      `GET /api/caddy/routes` on the same instance still answered `401`
- [x] Also exercised end to end against a **real homelab Caddy** (a dev backend already running
      on `:8000` with a live `CADDY_ADMIN_URL`) — same result, a valid CA root over a public GET
- [x] **The page in a browser** (2026-09-16, with the Phase 10a smoke). Headless Chromium 153
      and Firefox 155, logged out: the sidebar link leads to `/certificate`, all three platform
      tabs switch, and clicking the button saves `caddy-root.crt` **byte-identical** to Caddy's
      `root.crt`, no console errors. Firefox mattered: `download()` revokes the blob URL
      straight after `a.click()`, a known race there, and the file still arrived whole. All
      three `certificate_tab` modes checked the same way — `admin` shows the link only once
      logged in, `hidden` never, and `/certificate` plus its download stay reachable logged
      out in both

**Adjacent, flagged not fixed**

_`caddy/Caddyfile` uses a bare `:80 { … }`, which matches every hostname on that port and so
displaces Caddy's automatic HTTP→HTTPS redirects: typing `grafana.home.lan` with no scheme lands
on the onboarding page instead of redirecting. `certificate-setup.md` has recommended scoping it
to the host IP since Phase 10a; the shipped co-located Caddyfile never did. Now written down in
that guide as a known edge rather than left implicit._

---

## Phase 20 — Clear AdGuard rewrites

_Origin (2026-09-20, Sunde, after changing `BASE_DOMAIN` mid-development): rewrites under the
old base domain are stranded. `is_loskai_domain` scopes the orphan sweep to the **current**
base domain, so Sync cannot see them, and an unassign computes the delete pair from the
current domain too — it deletes a name that no longer exists and leaves the real one behind.
Nothing in Loskai could clean them up._

_**Decision (Sunde).** "Make it so that we don't touch the hand-added ones was a decision that
was made earlier in development before we had the dns_only rewrite option in Loskai." With
`dns_only`, Loskai can name anything on the LAN, so it is plausible as **the** way to manage
rewrites — and that needs a reset for an AdGuard that already carries some. A clear button
under AdGuard in Settings, behind a dialog with a warning, so adopting an existing AdGuard is
a choice rather than a hand-cleanup._

**Why the clear restores in the same call, rather than a second button**

_A separate resync already exists — the **Sync** button on Routing. A clear that doesn't
restore leaves the LAN with no working names until someone remembers to press it, and that
window is where duplicates come from. Clearing and reconciling in one call makes duplicates
impossible by construction: reconcile runs against an emptied list, so every routed name is
missing and is added exactly once. Sunde's own requirement ("need to make sure that duplicate
routes don't occur") is what settles it._

**What shipped**
- [x] **`POST /api/adguard/rewrites/clear`** — `service.clear_and_restore()`: delete every
      entry AdGuard holds by its exact `(domain, answer)` pair, then `reconcile()`. Returns
      `{ cleared, restored, conflicts, errors }`
- [x] **Preconditions are checked before the first delete** (`_check_reconcilable`, extracted
      from `reconcile` so both share one rule). A `proxy` instance routed with no derivable
      answer IP would make the restore raise *after* the wipe — leaving DNS empty. It now
      refuses with `400` and deletes nothing
- [x] A failed delete is reported per domain, not folded into the success line, and the
      restore still runs — reconcile re-lists from AdGuard, so a leftover shows up as a
      conflict rather than silently
- [x] **The exact-pair rule is untouched.** Each delete still names its pair; no automatic
      path (assign, teardown, reconcile, the orphan sweep) touches a foreign rewrite. This
      adds one explicit, confirmed action — it does not widen any existing blast radius
- [x] **Settings › Network › AdGuard** — `ClearRewrites` panel: a danger-styled button, a
      `ConfirmDialog` naming hand-added rewrites and a previous base domain as collateral and
      saying they cannot be recovered, and a result line ("Removed 4 rewrites, restored 2")
- [x] **`GET /api/adguard/rewrites`** + a disclosure in the dialog listing every entry that
      is about to go (added 2026-09-20, same day, on Sunde's "a spoiler menu where we can see
      all the entries"). Each row is marked **restored** or **not restored** by the pure
      `annotate_rewrites()`, which reuses the same `rewrite_domain`/`target_answer` pair the
      restore itself uses rather than re-deriving the rule — so the preview cannot promise
      something the clear won't do. The summary leads with the count that matters
      ("· 3 not restored"), and the list is collapsed by default so the warning stays the
      headline. Fetched only while the dialog is open, uncached — "what am I about to lose"
      must not be answered from a stale read
- [x] **`overscroll-contain` on the list** (Sunde, same day: "after reaching the end the page
      under start scrolling too, that doesn't feel correct"). Without it the wheel chains into
      the page behind the dialog the moment the list bottoms out. Measured both ways in a real
      browser rather than reasoned about: list parked at its end, two wheel ticks moved the
      page `0 → 240`; with the fix, `0 → 0`, and one tick from the top still scrolls the list
      by 120. **Not unit-tested** — jsdom has no layout, so scroll chaining cannot be
      reproduced there; the code carries a comment saying why the class is load-bearing
- [x] **`useScrollLock` on every overlay** (Sunde: "do the background scroll lock too" — the
      `overscroll-contain` above only stopped the hand-off *from the list*; a wheel over the
      backdrop still scrolled the page). A ref-counted hook freezing `body` while an overlay
      is up, applied to `ConfirmDialog`, `Modal`, `AddRouteModal` and `AssignModal` — all four
      overlays, so they behave alike rather than one dialog being the odd one out. Ref-counted
      because a ConfirmDialog can open *inside* a Modal (delete a stack from the stack editor)
      and the inner close must not unfreeze the page under the outer one. It restores the
      previous `overflow` rather than blanking it, and pads by the scrollbar's width so the
      page doesn't jump sideways as a dialog opens
- [x] Tests: `test_adguard_clear.py` (9 — foreign entries cleared, one-per-name restore, the
      two refusals, a failed delete, and four on the annotation, including a hand-added answer
      on one of *our own* names being marked not-restored) + `ClearRewrites.test.tsx` (10 —
      the dialog gates the call, cancel is a no-op, the warning's wording, the preview's rows
      and counts, empty and unreachable lists, both result shapes, a 502) + `useScrollLock`
      (5 — lock, release, toggle without unmount, the nested case, and restoring a body that
      already had an `overflow`). Unlike the overscroll fix this one *is* testable in jsdom,
      since `body.style` is observable without layout
- [x] Docs: `api.md`, `adguard-api.md` (Ownership gains its one exception), `PLAN.md`,
      `CLAUDE.md` (the invariant's caveat + the route count)

**Verification**
- [x] `pytest` (233) + `npm test` (63) + `check-docs.sh` + `tsc -b`
- [x] **Live, against a real AdGuard** (`compose.dev.yml`, v0.107.79), clicked in the browser:
      seeded two Loskai rewrites, one hand-added (`printer.smoke.test`) and one under a
      previous base domain (`oldnas.previous.lan`). **Sync first — `added/deleted/swept` all
      empty**, both foreign entries untouched, which is the behaviour being preserved. Then
      Clear: all four removed, exactly two restored, and `nslookup` against AdGuard's `:53`
      answered `.220` and `.50`. A second Clear left the same two — no duplicates. `health`
      reported `consistency: []` throughout
- [x] **The preview checked against the clear it previews**, live: seeded five rewrites
      including a *second* answer on one of Loskai's own names (`grafana.smoke.test →
      10.0.0.7`). The dialog marked exactly that one, the hand-added entry and the old-domain
      entry as **not restored**; the clear then removed all five and restored precisely the
      two it had promised
- [x] **The scroll behaviour measured in a browser**, with 18 rewrites in the list: `body`
      `overflow` `visible → hidden` on open and back on close, four wheel ticks over the
      **backdrop** left `scrollY` at `0`, the list still scrolled (`0 → 120`), the page
      scrolled again once closed (`0 → 273`), and the Add route modal locked the same way

---

## Phase 21 — Machines as upstreams

_Origin (2026-09-20, Sunde, out of the Devices-tab conversation): "dns rewrites show up as
named machines which can be used to replace ip adresses when setting proxy routes… we would
then be able to make external in add route have a list similar to containers and network."_

_**The model already had it.** An instance may exist without a subdomain (`PLAN.md`: tracked
but not exposed), and `container`/`origin` are existing precedents for a field linking an
instance to what it *is*. A "machine" needs no new concept — it is an instance whose upstream
is a bare IP._

**Decisions (Sunde, Q&A 2026-09-20)**
- **A real link, not a snapshot** — a proxy route should record *which machine* it points at,
  so changing that machine's IP once updates every route to it. Same shape as `container`
- **A second button, not a second tab** — "Name a machine" beside "Add route" on Routing, one
  table below. Route creation stays a single surface (the invariant the Add route picker
  exists to hold), while naming a machine is a different verb. The tab split from the Devices
  conversation stays dropped
- **Staged** — the pick list first, since it needs no schema change and proves whether the
  machine idea earns the link field

**21a — the pick list _(shipped 2026-09-20)_**
- [x] **Frontend only, no new endpoint** — `GET /api/caddy/routes` already returns every
      instance with `route_mode` and `upstream`, and the Routing page has it cached
- [x] External's source panel lists machines (`isValidDnsTarget(upstream)`, i.e. a bare IP)
      above the manual form, in `proxy` mode only — DNS-only is where machines are *made*
- [x] **Not filtered by routed**, unlike the Container and Network sources: you are borrowing
      an address, not routing the thing
- [x] **Fills the address, never the prefix.** `nas` would collide with the name the machine
      already answers to — the route is a service *on* it (`plex`), not the machine. The
      upstream is filled as `192.168.10.50:` so the port is all that is left to type
- [x] Tests: 5 new in `AddRouteModal.test.tsx` (machines listed and only machines, the
      prefill, the prefix left alone, no list in DNS-only, the empty state still takes a typed
      address). The harness gained `/api/caddy/routes` — an unmocked path returned `{}` and
      `.filter` crashed the modal
- [x] Live: named a machine, then created a route by picking it — assign `200`, the route
      proxied whoami over TLS, both rewrites correct

**21b — the link field _(shipped 2026-09-20)_**
- [x] **`machine` on the instance**, with `list_by_machine` + `is_machine` beside
      `get_by_container`/`get_by_origin`. Unlike those two it is **not an idempotency key but
      a dependency**, and one-to-*many*: a machine hosts any number of services
- [x] **Propagation is eager, not derived at push time** (the TODO above said push-time —
      changed on implementation). When a machine's assign moves its address, every dependent's
      upstream host is rewritten and its route re-pushed inside the same call, so `upstream`
      stays exactly what Caddy dials and nothing downstream needs a lookup. A no-op assign
      re-pushes nothing. A failed re-push warns and leaves the **stored** upstream correct —
      which is what makes Sync a repair rather than a second guess
- [x] **Rejects a bad link up front** (`validate_machine`): `404` unknown, `422` for a service
      (its upstream has a port) or for an instance naming itself
- [x] **Deleting a machine unlinks, never blocks.** Dependents keep its last address and go on
      working; the response lists them in `unlinked` and the dialog names them first. Refusing
      was the alternative — rejected on Phase 18's standing preference for doing the thing and
      saying what happened, since nothing here is unrecoverable
- [x] `"Name a machine"` beside `"Add route"`, opening the same picker preset to External +
      DNS-only (`initialSource`/`initialRouteMode`, remounted by `key`). A second verb, not a
      second creation surface
- [x] A `via <machine>` tag on linked rows — otherwise the link is invisible until the machine
      moves and the row quietly follows it
- [x] Tests: +10 backend (`relink_upstream`, linking, propagation across two routes, unlinked
      rows untouched, a no-op assign, the failed re-push, the three rejections, delete-unlinks)
      and +5 frontend (the link is sent, a typed address sends none, the presets, the tag)
- [x] Docs: `api.md` (assign body + the delete's `unlinked`), `PLAN.md`, `CLAUDE.md`

**Verification**
- [x] `pytest` (243) + `npm test` (73) + `check-docs.sh` + `tsc -b`
- [x] **Live.** Named a machine through the new button, routed a service onto it by picking it
      (`via nas` shown), then moved the machine to `192.168.10.231`: the response said
      `relinked: ["hello"]` and **Caddy's own dial changed to `192.168.10.231:8099`** — the
      route then answered `502`, which is the proof the change reached Caddy, since that
      address is fictitious. Re-pointing at the real one served `200` again. Deleting the
      machine returned `unlinked: ["hello"]`, and that route kept its address with
      `machine: null`

**21c — two verbs, and views over the one table _(shipped 2026-09-21)_**

_Sunde asked whether the add function and model should be split into a reverse-proxy one and
a `dns_only` one, whether machines deserve their own schema, and whether the two should
reference each other. Measured before answering: `assign()` is ~190 lines with **four**
behavioural branches on `route_mode` (prefix validation, upstream validation, the Caddy step,
the answer/URL shape) — everything else, including the rollback and AdGuard's exact-pair
cleanup, is shared. Splitting the flow would duplicate the parts where a divergence would hurt
most, and a separate machine schema would contradict the founding "same struct, different
`type`" decision. The reference already exists: `machine`, added in 21b._

- [x] **Thin wrappers, not a split flow** — `assign_route()` and `name_machine()` over the one
      orchestration, so call sites and tests read as two verbs with nothing duplicated
- [x] **Views on the Routing table** (Sunde: "different sorting logics… only services, only
      machines, both, groups, with the default being both"): All · Services · Machines ·
      Grouped, the last putting each machine directly above what runs on it, with anything
      unlinked kept at the end rather than dropped. Pure `applyView`, so "no view ever loses a
      row" is a test rather than a hope
- [x] **The `via` tag resolves to the machine's current name.** The link is stored by instance
      id — which an edit never changes, so a rename keeps it — but the id is the name the
      machine was *created* under, so the tag would otherwise read stale after a rename
- [x] Tests: +4 backend (the two wrappers, and that a rename keeps the link and propagates
      nothing, since dependents hold an IP that did not move) and +7 frontend (the four views,
      the no-row-lost invariant, the tag after a rename, its fallback)
- [x] Live: five rows across two machines, renamed one, and stepped through all four views —
      grouped read `Storage box · files · plex · vm1 · loose`, and the tags followed the rename

**Answered while implementing:** a machine's IP change propagates (21b, verified); a *name*
change keeps every link, because the link is by id; and the display `name` is owned by
`PATCH /api/instances/{id}` — an assign deliberately leaves it alone.

**21d — `kind`, declared instead of inferred _(shipped 2026-09-21)_**

_Until now "is this a machine?" was the string test `":" not in upstream`, read in three
places — `validate_machine`, the propagation guard, and the frontend's view filter. Correct
for everything the UI creates, and a guess for anything else._

- [x] **`kind: "service" | "machine"` on the instance**, set from the verb that assigned it
      (`name_machine` → machine, `assign_route` → service) and re-evaluated on every assign,
      so re-pointing a machine at a `host:port` makes it a service
- [x] **No migration step.** A `model_validator(mode="before")` back-fills `kind` from the old
      upstream-shape rule *only when the field is absent*, so a stored value always wins and
      the next write persists the answer. Verified against a hand-written pre-`kind`
      `instances.json`: `nas` read back as `machine`, `plex` as `service`, an upstream-less
      record as `service`, the file untouched until something wrote to it
- [x] `is_machine()` is now `kind == "machine"`; the frontend reads the field off the row and
      keeps the shape test only as a fallback for a row from an older build
- [x] Tests: +5 backend (back-fill for both shapes and for no upstream, a stored kind winning,
      the verb deciding, a machine re-pointed at a port becoming a service) and +2 frontend
- [x] Live, on the legacy store: the back-filled machine accepted a `machine` link and
      propagated a move (`relinked: ["files"]`, `.50` → `.70`), while a legacy record that was
      never linked stayed put

**21e — two models, two endpoints, two modals _(shipped 2026-09-21)_**

_Sunde, after the wrappers landed: "I still want you to split up the dns-only (machine name
model) and add routes model." Asked once about depth and answered **models + API + UI, one
stored record** — so `instances.json` and the Routing table are untouched._

- [x] **`MachineCreate` / `RouteCreate`**, each carrying only what its verb means. A machine
      has `hostname` (dotted allowed) + `address` (bare IP); a route has `prefix` + `upstream`
      + `upstream_tls` + the `machine`/`container`/`origin` links. `upstream_tls` on a machine
      used to be accepted and silently dropped; now it isn't a field
- [x] **`POST /api/machines` + `POST /api/routes` replace `POST /api/assign`** — one door per
      verb rather than one door with a `route_mode` flag. A test asserts the old path is gone
- [x] **`AddMachineModal`** — its own form: no source tabs, no port, no TLS, its own hint copy.
      `AddRouteModal` lost the Proxied/DNS-only toggle, `AssignModal` lost `allowDnsOnly`, and
      `useRouteFields`/`RouteFields` lost the `isDnsOnly` branching they carried for it
- [x] **Change URL dispatches on `kind`** — a machine row opens the machine form (Edit machine),
      a service row the route form
- [x] **A drift the split caused, caught by its own test:** the new machine form didn't
      lowercase a typed hostname, which `useRouteFields` had always done. Fixed in the
      component. This is the cost the measurement predicted — two forms, two places for a rule
- [x] Tests: +7 backend HTTP (`test_create_endpoints.py`: both endpoints need a session, the
      old one is gone, each rejects the other's shape, the models carry no dead fields) and
      +7 frontend (`AddMachineModal.test.tsx`), with the picker's DNS-only cases removed
- [x] Docs: `api.md` (two rows replace one, under a renamed section), `CLAUDE.md`, `PLAN.md`
- [x] Live: named a machine (`POST /api/machines` 200), routed a service onto it by picking it
      (`POST /api/routes` 200), then re-pointed the machine from its own form — `relinked:
      ["hello"]` and Caddy's dial moved to `192.168.10.231:8099`. Propagation survived the split

**21f — naming a machine no longer depends on Caddy _(shipped 2026-09-21)_**
- [x] `_tear_down_route()` makes the delete **required only when converting** an instance that
      had a proxy route — leaving that behind would keep Caddy answering a name the instance
      no longer proxies, so that case still aborts and rolls back. Otherwise the call is
      best-effort: a machine has no route, so Caddy being down or unconfigured is irrelevant
- [x] Tests: +3 (naming a machine with a failing Caddy succeeds; converting a live route with
      Caddy down raises `502` **and rolls back**; converting with Caddy up still deletes), plus
      the endpoint test flipped from pinning the old `502` to asserting the `200`
- [x] Live, both halves: with Caddy stopped, `POST /api/machines` returned `200` and
      `nas.smoke.test` resolved to `192.168.10.50`; converting an existing proxy route with
      Caddy stopped returned `502` and the row was still `service · proxy · 192.168.10.220:3000`

**21g — the three remaining defects _(shipped 2026-09-23)_**
- [x] **A `container` that names nothing is rejected** (`404`, from the 2026-09-16 smoke).
      Checked in `post_route`, not inside `assign()` — that function takes its clients as
      arguments so it can be driven by fakes, and reaching for the Docker singleton inside it
      would be a hidden dependency (it broke two unit tests within seconds of trying).
      **Docker unreachable means "unknown", not "invalid"**: creating a route must not start
      depending on the Docker socket, so an unreachable daemon skips the check with a warning
- [x] **The success banner follows the response.** `caddy: "skipped"` now reads "DNS rewrite
      created." instead of claiming a route (from the 2026-09-20 Phase 13 smoke)
- [x] **Change URL can link a route to a machine, and unlink it** — `machine: null` is
      meaningful. This closes the 21a gap *and* a claim that was wrong: the note below used to
      say "re-pick the machine in Change URL", which that form could not do
- [x] Live: a made-up container name `404`s while a real one still works; naming a machine
      banners "DNS rewrite created." while a route still says "route + DNS rewrite created.";
      and a route created **without** a link was linked through Change URL, after which moving
      the machine reported `relinked: ["legacy"]` and its upstream followed to `.231:8099`

**Known gaps**
- Routes created under **21a** hold a copied address with no link. They keep working, and can
  now be linked by picking the machine in Change URL (21g). There is no automatic migration,
  since inferring a link from a matching IP would guess

---

## Phase 22 — Per-route scheme (Phase 12's last unbuilt piece)

_12b, approved 2026-08-03 and specified in [`todo-archive.md`](todo-archive.md) Phase 12.
Exists **only** for clients that cannot hold a custom root CA — TVs, Chromecast/DLNA,
printers, other containers calling the service by name, scripts. Not a performance feature:
TLS on a LAN is unmeasurable next to the proxy hop, which is paid either way._

**What shipped**
- [x] **`scheme: "https" | "both" | "http"` on the instance**, default `https`. One enum, not
      two booleans — two checkboxes admit an invalid both-off state
- [x] **A second server selector.** `select_http_server_name` finds the `:80` server by its
      listener; `select_server_name` keeps *excluding* it, because a reverse-proxy route
      pushed into the cert-setup site would be served without TLS by accident. No `:80`
      server means `scheme: "http"` raises rather than falling back
- [x] **Index 0 in the `:80` server too**, for one more reason than on `:443`: that server's
      setup site ends in a catch-all `handle`, and Caddy's automatic HTTP→HTTPS redirects
      live there and would otherwise answer first. The spec called this in August; the
      2026-09-05 defect proved the same rule for `:443` a month later
- [x] **`both` is two routes with two ids** (`<id>`, `<id>-http`). `expected_route_ids()` is
      what `synced` compares against, so a half-pushed `both` reads `false`; teardown removes
      both ids unconditionally, since the stored scheme may have changed
- [x] **`http` never lands in the `:443` server** — `upsert_route` deletes the route it does
      not want on every push, so a scheme change converges with no migration. That absence is
      what stops Caddy issuing a certificate for the name
- [x] **Links follow the scheme.** The assign response's `url`, the public dashboard's cards
      and the Docker tab's routed-container link were all hardcoded `https://`; an http-only
      route linked that way cannot connect. Found by reading the UI after the backend worked
- [x] Frontend: `SchemeSelect` in both route modals (editable on an existing route), an
      amber tag in `ServiceTable` for anything that isn't the default, and a live preview
      that drops to `http://`
- [x] Tests: +14 backend (selector, twin id, per-scheme push/teardown, scheme change
      convergence, no-`:80`-server, sync for `both`/`http`, the two URL shapes, the dashboard
      card) and +4 frontend
- [x] Docs: `caddy-api.md` (new §2b + the two-id teardown), `api.md`, `CLAUDE.md`, `PLAN.md`

**Verification**
- [x] `pytest` (281) + `npm test` (95) + `check-docs.sh` + `tsc -b`
- [x] **Live, against the dev rig's two-server Caddy** (`srv0 :443`, `srv1 :80`), one route
      per scheme:

      | | `:443` holds | `:80` holds | `https://` | `http://` |
      |---|---|---|---|---|
      | `secure` (https) | `secure` | — | `200` whoami | `308` redirect |
      | `tv` (http) | — | `tv-http` | **TLS alert, no cert** | `200` whoami |
      | `printer` (both) | `printer` | `printer-http` | `200` whoami | `200` whoami |

      The `tv` handshake failing is the point: `curl -v` shows `tlsv1 alert internal error`,
      i.e. Caddy has no certificate for that name and never asked for one. Switching
      `printer` back to `https` removed `printer-http` and the name fell back to the `:80`
      redirect. The cert-setup catch-all still served its 21.5 kB page throughout

---

## Phase 23 — The `:80` site stops claiming every name

_Sunde, after 12b: "as it is the setup page is now redundant since we are able to download
what we need directly through loskai." True for the **page** — `/certificate` serves the root
over a connection that needs no trust. Not true for the **block**: measured, a Caddy whose
Caddyfile has a real HTTPS site but no `:80` block ends up with **only `srv0` on `:443`** — no
port-80 listener at all — and that server is where 12b's `http`/`both` routes go._

_"Will we be able to use the supplied host ip… or were we able to detect host ip
automatically?" Neither: `config.py`'s `host_ip` already records that a bridged container
cannot detect its own host IP, `HOST_IP` is optional, and the Caddy container is passed only
`BASE_DOMAIN`. Scoping the block to an IP would have **added** a required setting._

- [x] The `:80` block leads with `@internal host *.{$BASE_DOMAIN:example.invalid}` →
      `redir https://{host}{uri}`, in both `caddy/Caddyfile` and `dev/Caddyfile`. Keyed on the
      domain Caddy already has, so it is automatic with no new configuration; the
      `example.invalid` default makes the matcher inert when `BASE_DOMAIN` is unset
- [x] `compose.dev.yml` passes `BASE_DOMAIN` to its Caddy (the placeholder site stays
      `*.localhost` on purpose)
- [x] Docs: `certificate-setup.md`'s "it claims the whole of `:80`" warning rewritten
- [x] Live, all five cases: an `https` route typed as `http` → **`308` to https** (Caddy's own
      redirect, for names it holds a route for); an `http` route → **`200` proxied**, since
      index 0 beats the Caddyfile; an unrouted name → `302` to https instead of the onboarding
      page; browsing by IP → the page, unchanged; `/caddy-root.crt` → `200`

**The ACME variant of the LXC script got the same treatment** _(same day)_. Internal mode
fetches `caddy/Caddyfile` from the repo, so it inherited both fixes for free — but
`create-caddy-lxc.sh`'s `TLS_MODE=acme` branch writes its **own inline Caddyfile**, which had
neither: a handler-less wildcard block (the empty `200`) and **no `:80` server at all**, so
`scheme: "http"`/`"both"` had nowhere to be pushed. It now carries a 404 for unrouted names
and a minimal `:80` site. Verified by running the script's own heredoc and adapting the
result: `srv0 :443` + `srv1 :80`, where before there was only `srv0`.

**Not done, and why:** redirecting the page itself to Loskai's `/certificate` would need
Loskai's address, which has the same undetectable-host-IP problem and would mean a new
required env var. The page costs nothing where it now sits — by-IP only, which is exactly the
fallback `certificate-setup.md` documents.

**A 404 for names that aren't routed** _(same day, closing the 2026-09-05 backlog item)_
- [x] The `*.{$BASE_DOMAIN}` block gained a `respond … 404` with a small dark page naming the
      host. It was previously handler-less — cert-only — which compiled to a terminal route
      answering an **empty `200`**: a blank page that looked like a broken service rather than
      an unassigned name
- [x] **404, not a redirect to the dashboard.** That is what nginx, Traefik and the hosting
      platforms do; redirecting changes the URL under the visitor and hides the real cause.
      No "back to the dashboard" link, because Caddy does not know Loskai's address and
      Loskai cannot detect it — the same constraint as above. One line to add later if Loskai
      is ever routed at a fixed name
- [x] `dev/Caddyfile` deliberately **not** changed: its placeholder site is `*.localhost`,
      kept different from `BASE_DOMAIN` on purpose, so a 404 there would never see real names
- [x] Live, against the **production** Caddyfile in a container (`BASE_DOMAIN=smoke.test`)
      with a Loskai-shaped route pushed at index 0: the routed name proxied `200`, an
      unrouted one answered `404` with `Nothing is routed at typo.smoke.test`, plain HTTP
      redirected first, and the by-IP onboarding page was untouched. Rendered in a browser

---

## Phase 24 — The ACME path stops assuming DuckDNS _(superseded by Phase 25 — removed)_

> **Superseded the same day.** Everything below shipped and then came out again in Phase 25,
> which dropped ACME support entirely. Kept as the record of what was there and why, and as
> the recipe for putting it back: `git revert` the two commits it names.

_Sunde, while weighing public certs: "Ideally we create a caddy that simply works for
everyone… I say do the fixes, and remove most references to duckdns other than where it makes
sense."_

_**The bug:** `CADDY_DNS_PLUGIN` was a variable and drove `caddy add-package`, so the right
plugin was installed — but the Caddyfile the script wrote hardcoded `dns duckdns
{env.DUCKDNS_TOKEN}`, the unit hardcoded `DUCKDNS_TOKEN`, and the closing instructions told you
to swap the directive by hand. Any provider but DuckDNS produced a Caddy that would not start._

- [x] `CADDY_DNS_PROVIDER` — the directive name, **derived** from the module path
      (`caddy-dns/cloudflare` → `cloudflare`) with an override for the few where they differ
- [x] `CADDY_DNS_ARGS` — what follows the provider name, defaulting to
      `{env.CADDY_DNS_TOKEN}`. **Single-credential providers are the default case, not the
      only one:** acme-dns needs username/password/subdomain/server_url, and passes its whole
      block here. That matters because acme-dns is the likely path for a registrar with no API
- [x] `CADDY_DNS_PLUGIN` now has **no default** — `TLS_MODE=acme` without it exits with the
      link to the module list, rather than silently building a DuckDNS config
- [x] Provider-neutral `CADDY_DNS_TOKEN` in the systemd unit, the compose files and the docs
- [x] DuckDNS removed from `caddy/Caddyfile`, `caddy/Dockerfile`, both compose files and
      `PLAN.md`, kept only where it reads as one example among several. **`HISTORY.md` left
      untouched** — those entries record what was decided at the time
- [x] Verified by running the script's own variable logic and heredoc for both shapes: a
      single-token provider emits `dns cloudflare {env.CADDY_DNS_TOKEN}`, and acme-dns emits
      its four-field block. Both compose files still `config -q` clean

**The co-located Docker path is a switch too** _(same day)_. It was the one place still
needing two files hand-edited, for two real reasons: a DNS plugin is **compiled into** the
binary (the LXC can swap builds at runtime with `caddy add-package`; an image cannot), and a
Caddyfile has no conditionals, so one file cannot serve both modes.
- [x] `caddy/Dockerfile` gains build targets — `stock` (plain Caddy, no compile) and `acme`
      (rebuilt via `xcaddy` with `CADDY_DNS_PLUGIN`). Both carry both Caddyfiles, so only the
      *binary* differs
- [x] `caddy/Caddyfile.acme` — the DNS-01 wildcard, the same 404 for unrouted names, and a
      `:80` server kept for `scheme: "http"`/`"both"` routes and Caddy's own redirects. No
      onboarding page: publicly trusted certs leave nothing to install
- [x] Both compose files select with `CADDY_BUILD` (target) and `CADDY_CONFIG` (which file the
      container reads), defaulting to the internal CA
- [x] **A bug my own negative test caught:** `docker build` with no `--target` builds the
      **last** stage, so with `acme` written last a plain build silently produced a
      Go-compiled binary carrying a plugin nobody asked for. `stock` is now last, with a
      comment saying why the ordering is load-bearing
- [x] Verified by building both and inspecting the binaries, not the build log: the default
      image has **0** `dns.providers.*` modules and refuses the ACME config with `module not
      registered`; `--target acme` has `dns.providers.cloudflare`, adapts to an `acme` issuer
      with the DNS challenge and the token left as an `{env.…}` reference, and starts with
      `srv0 :443` + `srv1 :80`, reaching "obtaining certificate"
- [x] Docs: five new rows in `deployment.md`'s env table

**What this does *not* solve:** one.com hosts the domain in question and there is **no
`onecom` module** in the caddy-dns organisation (checked: the o-range holds `njalla`,
`neoserv`, `oraclecloud`). Public certs there still require delegating a subdomain or
CNAME-ing `_acme-challenge` to acme-dns — now at least configurable rather than a hand-edit.

---

## Phase 25 — ACME support removed; internal CA is the only mode

_Sunde, after the Docker switch landed: "Did we just add a bunch of unnecessary logic and
complexity? Instead of simply keeping it to internal root verification?" Then, given a
priced-up comparison: "lets go all the way for internal-CA-only."_

_**The question was fair and the answer was mostly yes.** Two of the day's bugs existed only
because a second TLS mode did — the provider hardcoding, and the ACME LXC branch missing both
Caddyfile fixes. Worse, the 404 + `:80` logic had ended up in **three** files that had to
agree, in a project whose documented recurring failure is exactly that kind of drift._

_**What made removal cheap** is what Sunde spotted: Loskai has no ACME code. Verified — every
write it makes to Caddy is `PUT …/routes/0` (insert one route) or `DELETE /id/<id>`; it never
writes a Caddyfile, and `push_all` only touches ids matching instances, so Caddyfile-derived
and hand-added routes are invisible to it. "ACME support" was never a Loskai feature, only a
pair of example configs and a build stage._

**Removed**
- [x] `caddy/Caddyfile.acme` (whole file) and the `stock`/`acme` build targets — `caddy/
      Dockerfile` is back to three lines of `FROM`/`COPY`
- [x] `TLS_MODE`, `CADDY_DNS_PLUGIN`/`PROVIDER`/`ARGS`, the `caddy add-package` step, the
      inline ACME Caddyfile and the token line from `create-caddy-lxc.sh` — **294 lines, down
      from 380**, with one Caddyfile path (fetched from the repo) instead of two
- [x] `CADDY_BUILD`, `CADDY_CONFIG`, `CADDY_DNS_*` and the `command:` override from both
      compose files; five rows from `deployment.md`'s env table
- [x] The commented ACME block in `caddy/Caddyfile`; the `TLS_MODE=acme` aside in `install.md`
- [x] `caddy/Dockerfile` and the script header now say where it went and why it costs nothing
      to re-add by hand: Loskai never writes the Caddyfile

**Kept deliberately**
- The **backlog idea** (real domain + DNS-01) — dropping the code is not dropping the option
- **`HISTORY.md` untouched**, and Phase 24 kept with a superseded banner. Between them they
  are the record *and* the recipe: `git revert` of `a6d4d78` + `52129af` restores it whole
- `certificate_tab: hidden`, which exists for a deployment whose certs are already trusted —
  cheap, already built, and useful to anyone hand-rolling ACME

**Verification**
- [x] `pytest` (281) + `npm test` (95) + `check-docs.sh` — **no application code changed**,
      because there was none to change
- [x] Both compose files `config -q` clean; `bash -n` on the script; the co-located image
      builds and adapts to `"issuers":[{"module":"internal"}]`

---

## Phase 26 — 12c: backend certificates, and Phase 12 closes

_The last item of Phase 12, approved 2026-08-03 and documentation-only:
[`docs/guides/backend-certificates.md`](../guides/backend-certificates.md). Caddy runs an
`acme_server` against its **existing internal CA**, and a backend's own ACME client gets a
leaf signed by the root every LAN device already trusts — so Proxmox's `:8006` is trusted
**directly**, not only through the proxy._

**Verified against upstream documentation, not memory** — the numbers are the whole story here
- [x] `acme_server` takes `ca` (default `local`), `lifetime` (**default 12h**), `challenges`,
      `allow`/`deny`; the directory is `https://<host>/acme/<ca-id>/directory`
- [x] Proxmox renews from `pve-daily-update.service`, and only when the cert **expires within
      30 days** — so a 12h leaf is expired for most of every day. The guide recommends `168h`
- [x] A leaf cannot outlive its intermediate, whose lifetime defaults to **7d**, so raising
      one means raising `intermediate_lifetime` (Caddyfile global `pki { ca local { … } }`).
      Violating it returns a `500`, not a useful error
- [x] Proxmox's own steps confirmed: **Datacenter → ACME** then **Node → Certificates**;
      `pvenode acme account register` (option "2) Custom"), `pvenode config set --acme
      domains=…`, `pvenode acme cert order`; http-01 and dns-01 both supported

**The trap the guide leads with** — a name resolves to one address, so a name that is already
a *proxied route* points at Caddy, and the challenge for it validates against Caddy instead of
the backend. The fix is to stop proxying that backend and make it a **machine** (`dns_only`)
instead, which is what Phase 21's machines are for.

- [x] Linked from `docs/README.md` (both tables), cross-linked from `certificate-setup.md`,
      and added to `CLAUDE.md`'s guide list
- [x] States plainly that **Loskai does nothing here**: no ACME code, and `Sync` cannot
      disturb an `acme_server` site because `push_all` only touches routes whose `@id` matches
      an instance

**Phase 12 is complete** — 12a in Phase 19, 12b as Phase 22, 12c here.

**A defect the guide surfaced, fixed the same hour.** Writing "make the backend a machine"
raised Sunde's question — *how does it then appear on the dashboard?* — and the answer turned
out to be "with a broken link". `list_routed()` includes machines, so a machine produced a
card pointing at `https://proxmox.{BASE_DOMAIN}` with **no port**: `:443`, where nothing
listens. The source comment even said "the card just names the host" while building an
`https://` URL anyway.
- [x] **Machines are excluded from the dashboard** (`kind: "machine"`). An address has no
      port to link to, and it is not derivable — `:8006` for Proxmox, `:5000` for a NAS, none
      at all for a box you only SSH to. A launcher card that lands on a dead port is worse
      than no card. Proxied services on odd ports are unaffected: Caddy fronts those at `:443`
- [x] The documented way to put such a UI on the dashboard is a **route under a second name**,
      built by picking the machine in Add route — which also links it, so it follows the
      machine. Both halves are pinned by tests, and the guide carries the two-name table
- [x] Considered and rejected: a per-machine link port. It would make the card work, but it
      adds a field to say what a route already says, and the route follows the machine for
      free

---

## Phase 27 — Launcher icons, and an endpoint for a desktop launcher

_Sunde: an image per route for the dashboard card, and "a get endpoint that allows us to read
out the created routes in a list, to be used with a desktop version of the launcher" — kiosk
Chromium profiles, one per service. Plus, on private routes: "a desktop launcher should have
the ability to access privates if we provide a password or token. Since loskai simply has a
password, that option might be enough."_

_**Half of it already existed.** `GET /api/dashboard` is public and already returned
`{name, url, icon}` — the icon field had simply never been filled in. So the two asks were one
piece of work._

**Icons**
- [x] `icon` on the instance; images in `<data_dir>/icons/<id>.<ext>` — **the only binary
      state Loskai keeps**, in the same volume as the JSON, so a backup carries it
- [x] **Validated by magic bytes**, not by filename or the caller's `Content-Type`: PNG, JPEG,
      WebP, 512 KB cap. **SVG refused** — these are served back from Loskai's own origin, and
      an SVG is a script container. A RIFF file that is not WebP is refused too
- [x] **Raw request body, not multipart.** The bytes are sniffed either way, so a form part
      would carry a filename and type that are ignored — and would add a `python-multipart`
      dependency. Read with a streamed cap, so an oversized upload is refused after a chunk
      rather than buffered whole (`413`)
- [x] `path_for` resolves and bounds-checks the stored filename: it comes from
      `instances.json`, which a human can hand-edit, and `../` would otherwise read anything
- [x] The thumbnail **is** the control — set and cleared from the Routing row rather than a
      dialog. Machines have no card, so they get no picker
- [x] `ServiceCard` renders the image with an `onError` fallback to the glyph, so a missing
      file never leaves a torn card

**The launcher endpoint**
- [x] `GET /api/launcher` — every routed service **including private**, each flagged.
      Authenticated, which is the entire difference from `/api/dashboard`. A desktop client
      logs in exactly as the web UI does: `POST /api/login`, then send the cookie back
- [x] Cards carry `id` now — a desktop launcher keys shortcuts on something that survives a
      rename, which `name` does not

**The public surface, kept enforced**
- [x] `PUBLIC_ROUTES` holds exact `(method, path)` tuples, so a parameterised icon path
      cannot live there. Added `PUBLIC_PATTERNS` — one anchored regex — **and extended
      `check-docs.sh` to assert it is named in `CLAUDE.md` too**, so this class of
      unauthenticated surface cannot be added unnoticed. Verified by removing the mention and
      watching the check fail

**Verification**
- [x] `pytest` (297) + `npm test` (100) + `check-docs.sh` + `tsc -b`
- [x] Live: a real 180-byte PNG uploaded through the UI, served **byte-identical with no
      session** as `image/png`, rendered on the logged-out dashboard. `/api/launcher` returned
      the private route with `private: true` while `/api/dashboard` omitted it, and answered
      `401` with no session

---

## Phase 28 — The install wizard, looked at for the first time

_Sunde: "I want to start building the installation wizard for docker containers now. where do
we start? and sould we make the repo for loskai-recipes besides loskai?" Then: "fix #1 and #2
first and maybe allow for multiple repos to be added, we have our standard one, and then we
have the abbilitty to disable it or add multiple other sources."_

_**It was already built** — engine, modal, routes, `git` + the compose plugin in the image, all
of it from Module 1 in July. What was missing was recipes: `data/recipes/` held a `.gitkeep`,
so the only part of the wizard anyone had ever seen was its empty state. Reading it against
`PLAN.md` found two defects and one stale plan step._

**#1 — the installed instance pointed at no container**
- [x] `install_recipe` set `container` to the **recipe id**, but that is the compose *project*
      name; Compose names containers `<project>-<service>-1` unless the file pins
      `container_name`, and every join in the module matches the container **name**. So a
      recipe-installed service never linked to its own container — no FQDN in the Docker tab,
      and a row that reads as orphaned
- [x] `client.containers_in_project` reads the real names back via the
      `com.docker.compose.project` label; `logic.primary_container` (pure) picks the published
      one: manifest `service:`, else the only service, else the one publishing ports, else
      alphabetical
- [x] Optional `service:` added to the manifest schema, for app-plus-database recipes
- [x] **A failed `up`, or a container that can't be identified, registers no instance** and
      says so. Previously a failed install registered one anyway. A guessed `container` is
      worse than none: the Routing tab's Container source creates the record correctly, so a
      guess leaves a second, dead row beside it

**#2 — `instructions.md` was shipped and dropped**
- [x] The backend has put it in the payload since July; the frontend's `Recipe` interface
      never declared the field, so the recipe author's walk-through was discarded in the
      browser. Now the wizard's **first step**, with what the install will create (stack dir,
      declared directories, the variables it asks for, the source it came from) — `PLAN.md`'s
      step 1, existing at last
- [x] `shadowed` was ignored the same way; it now names the copy that lost *and* the source
      that beat it. `invalid` now shows each reason, not just a count
- [x] Empty state distinguishes **no sources** / **never synced** / **synced and empty** —
      three states with three different fixes that had one message between them

**Multiple sources**
- [x] `recipes_repo_url` (one string) → `recipes_repos` (a list of `{url, enabled}` rows,
      managed in Settings › General: toggle, add, remove, per-row sync)
- [x] One cache per repo, `recipes-cache/<tail>-<hash of url>` — two repos ending in
      `/recipes.git` are routine, and a shared cache would have one overwrite the other
- [x] Priority is list order; local `data/recipes/` always last and never disableable
- [x] **A built-in default is seeded when nothing is stored** (`config.DEFAULT_RECIPES_REPO` —
      Forgejo beside loskai for now, the public GitHub URL when loskai is published), and it
      is an ordinary row: switch it off, or delete it
- [x] Which is why **a stored empty list is a real value**, never an unset marker — deleting
      every source has to survive a restart rather than re-seed the default
- [x] Sync reports **per source**: one unreachable repo costs that repo's recipes and nothing
      else, and `POST /recipes/refresh` takes an optional `{url}` for one row. No new route
- [x] **`RECIPES_REPO_URL` removed entirely** (2026-10-02, Sunde: "do we even need the env
      variable? Since we now have a option in the ui for adding more on top of the default?").
      It was load-bearing when sources were one string set before any UI existed; with an
      editor it was a second way to say the same thing, and the precedence rule it dragged in
      was the only reason the panel could go read-only. Recipe sources are never needed before
      the UI is reachable — which is the test for belonging in the env layer. `recipes_repos`
      is now the only entry in `STORED_ONLY_KEYS`; the `Settings` property, `ENV_SOURCE_ATTRS`,
      the stored-legacy-URL fallback (nothing had ever stored it), the read-only branch in the
      editor and the variable in three compose files all went with it

**Verification**
- [x] `pytest` (353) + `npm test` (122) + `check-docs.sh` + `tsc -b` + oxlint
- [x] **Live install — ran 2026-10-03 and passed**, on the first real recipe: `whoami` in
      `sunde/loskai-recipes` (`56b7cc6`). Rig: a host backend on `:8010` with a **scratch**
      data dir and every variable explicit, plus Caddy alone as compose project
      `loskai-smoke` — the full split-DNS stack can't run beside the dev `loskai` container
      (same `container_name`, same `:8080`), and that one points at real infrastructure
      - instance `container` = `whoami-whoami-1`, **exactly what `docker ps` shows** (the old
        code stored `whoami`, which matches nothing); orphans empty
      - **routing it by container name edited the recipe's instance** — still one record, now
        with a subdomain — where the old link key would have created a duplicate. The Docker
        tab's container row shows the route; Caddy returns a 300-byte body carrying
        `X-Forwarded-Host: whoami.smoke.test`, the line `instructions.md` promises
      - `pair` → `pair-web-1` (published beat alphabetical) and `pair-declared` →
        `pair-declared-app-1` (declared beat published): local test recipes built so the
        rules disagree. A port clash returned `ok: false`, the daemon's error, no instance
      - torn down through Loskai's own stack delete; host left exactly as found

**Found by the live run — `.env` generation corrupted secrets, silently**
- [x] **An omitted answer wrote no variable.** An API install with `{}` published `${PORT}` on
      a *random* host port: the wizard seeds defaults client-side, the server never did.
      `resolve_answers` now builds the set from the manifest — answer, else `default`, else
      empty; an explicit empty answer is kept
- [x] **Values were written verbatim, and Compose rewrites them.** Checked against
      `docker compose config`: `pa$word1` arrived as `pa` (interpolated), `correct horse
      #battery` as `correct horse` (comment), and a newline started a second line —
      `COMPOSE_PROJECT_NAME=hijacked` there **renamed the project**. Every one *succeeds*.
      Now every value is double-quoted with `\` `"` `$` `\n` `\r` escaped — single quotes
      cannot hold a `'`. **Live round trip: a password with all of it reached a real
      container's environment byte-identical**, and the project label stayed put
- [x] **Undeclared answer keys were written too** — the same `COMPOSE_*` route in. Refused
      with `400` before anything touches disk. Manifest `env` keys must be variable names
- [x] **Reinstalling a recipe wiped its instance's route fields** — found 2026-10-03, fixed
      2026-10-04 together with the Delete change below, since that is what made reinstalling
      routine. A reinstall now keeps the earlier record (route, icon, private, following) and
      re-points only `container`. The id is refused when it names something else: an external
      route, or a docker record linked to a different container that is still running
- [x] **A stack's Delete kept nothing** (2026-10-04, Sunde: data belongs "in the relative
      directory of the service"). Recipes now keep data in `./data` beside the compose file,
      which made `rmtree` a data-loss button. Delete now removes `compose.yml` and `.env` only
      unless "Also delete its data" is ticked; the dialog names the folders. Creating or
      installing the same name again takes the folder over (`claim_dir`), and the wizard says
      it picked the data up. Bambuddy's recipe moved to `./data`/`./logs`, and the running
      install was migrated live: every lasting table identical, route still serving
- [x] **Routing a recipe install opened an empty form** (Sunde, 2026-10-03: "if it's a docker
      entry it will always have the host ip"; then: "add route and add url are two different
      functions"). They were: the Add route picker pre-filled from Docker, the row's "Assign
      a URL" from the stored record only — which a fresh install doesn't have. One helper,
      `containerPrefill`, now serves both. The backend adds `suggested_host` (known whenever
      `HOST_IP` is, even with no port: host networking, several published ports) and the
      linked `instance_id`, so the prefix is the recipe's name, not `<project>-<svc>-1`.
      Checked against the live daemon: `whoami`'s row now fills `192.168.10.220:8081`, a
      host-networked container `192.168.10.220:` — the trailing colon is the machine picker's
      existing convention. Bambuddy's image EXPOSEs ~110 ports, so guessing the port from
      the image was ruled out rather than built
- [x] **Host folders as a recipe concept — `type: path`** (2026-10-04, Sunde: the wizard
      should handle mounted paths "based on how we configure the instructions"). Tested from
      inside the running Loskai first: `./data` and `${X:-./data}` land in the stack folder,
      an absolute path passes through, and **`~` becomes `/root`** — compose runs as root in
      Loskai's container. A `path` entry is required; the wizard says where it lands (stack
      folder, kept on Delete / Docker host, never deleted) and refuses `~`, a bare name (a
      named volume to Compose) and `:` — the server checks the same. **`directories:` removed**:
      it made folders inside Loskai's container, invisible to the host; a manifest with it is
      rejected with a pointer to `type: path`
- [x] **Any number of folders, added at install — `mounts`** (2026-10-04, Sunde mounts music,
      movies and anime separately: "I would assume that ability is quite relevant"). A recipe
      declares one group (`label`, `target`, `read_only`); the wizard adds rows, each landing
      at `target/<name>`; Loskai writes them into `compose.override.yml`, which Compose merges
      by itself, so the recipe's file stays untouched. Long syntax with `create_host_path:
      false` — checked against the daemon: a missing folder fails the deploy instead of
      mounting an empty one Docker made. Delete removes the override; the stack editor shows
      it read-only. Deliberately one group, one service, one `read_only`
- [x] **Recipes can be authored from the recipes repo alone** (2026-10-04, Sunde: "so we can
      use claude code inside that project whilst not being wholly dependent on the docs for
      loskai"). loskai-recipes gets a `CLAUDE.md` and a copy of `recipe-schema.md` at its root (a
      `docs/` folder would be scanned as a recipe — the checker caught it), written by
      `scripts/sync-recipe-schema.sh` — the contract stays here, beside the validator. The
      docs check fails while the copy differs. `check_recipes` runs the wizard's validator
      over a folder or a whole repo, so a recipe is proven valid before it is pushed
- [x] **A synced source reported its `.git` as a skipped recipe** (2026-10-04). Every folder
      in a source was scanned, and a clone has `.git`. Hidden folders are skipped now
- [ ] **Bambuddy reinstall, run by Sunde — then clear the migration's fallbacks.** Delete
      (data kept) and install again from the synced recipe; expect "Picked up the data already
      in its folder". Compare against the fingerprint taken 2026-10-04 before it: lasting
      tables `announcements=2 archive_fts_config=1 archive_fts_data=2 color_catalog=638
      groups=3 maintenance_types=9 notification_templates=38 settings=11
      sponsor_toast_state=1 spool_catalog=91`, `data/.jwt_secret` sha256 starting
      `01cd37ce877168ed`, mounts on `stacks/bambuddy/data`, its route record kept. Once it
      matches, remove the pre-migration volumes `bambuddy_bambuddy_data` and
      `bambuddy_bambuddy_logs` and `stacks/bambuddy/compose.yml.volumes-backup`
- [x] **The container runs as root, so everything it writes on the host is root-owned** (found
      2026-10-03, the first time the redeployed container wrote state). `data/instances.json`
      became `root:root 0600` — unreadable to the host user, which also breaks a dev backend
      run against the same `data/` — and a wizard-created stack is `root:root`, so it **can't
      be edited over SSH** without sudo, against the "SSH stays a first-class equal" rule. Its
      `.env` is `0644`, world-readable, which matters once a recipe asks for a password.
      Phase 18's `.gitkeep`s only covered the directories. Needs a decision on the container's
      user: it also needs the docker socket's group
      **Fixed 2026-10-09** — Sunde chose "match the folder's owner": an entrypoint drops to the
      owner of `./data` plus the socket's group, and hands back what root wrote (`data/`, each
      stack's folder, compose files and `.env`; never `stacks/<name>/data/`). `.env` and
      `session_secret` are `0600`. Delete-with-data falls back to a throwaway root container
      for files the app wrote as its own user. **Live on this VM:** the app runs as `vm`
      (1000, groups 988,1000); `instances.json`, `recipes-cache`, both stacks back to `vm`;
      `bambuddy/data` untouched; as that user — 7 containers listed, git sync, `whoami`
      restart, and Delete-with-data on a stack holding 999-owned `0700` files, all OK. The
      first run found source files `0600` in the working tree, unreadable once not root —
      the image now `chmod a+rX`es them
- [x] **The git sync path — worked, run by Sunde** (2026-10-03): pushed, synced from Settings,
      and `whoami` installed from it into `stacks/whoami`. The cache
      `data/recipes-cache/loskai-recipes-2bc51ad3` is at `5b94ac7`, matching `origin/main`,
      and the local `data/recipes/` holds only its `.gitkeep`, so the recipe came from git

---

## Phase 29 — A Docker route follows its container

_Sunde, 2026-10-03, after the route forms learned to pre-fill the host: "the port should be
locked for docker containers and self update if we change it in the docker". Chose, of two
options, **watching Docker's event stream** over re-pushing only on Loskai's own restarts —
so a port changed over SSH is followed too._

_Today a Docker route **stores** its upstream. Change the container's port and the route
keeps dialling the old one — a 502, with nothing in Loskai saying why. The model already has
the answer one link over: a route that follows its **machine** is rewritten when the machine
moves (`_propagate_to_dependents`). This is the same move with a different trigger._

**Model**
- [x] `follow_container: bool` on the instance — **declared, never re-derived**, like `kind`.
      Defaults `False`, so every existing record keeps exactly the upstream it has. New
      container routes follow by default when the address can be derived
- [x] The derivation is the pre-fill — `logic.suggested_upstream`, one function, so what the
      form shows and what the follower writes cannot disagree
- [x] **`loskai.port` label** for what Docker can't see: the port the service listens on, as
      the container sees it, resolved to whatever Caddy dials (`service:<port>` on a shared
      network, `<host_ip>:<published port for it>` in `lan`, `<host_ip>:<port>` under host
      networking). Compose interpolates it — `loskai.port: ${PORT}` — so it changes when the
      port does. Also picks one port out of several published

**Assign**
- [x] `RouteCreate.follow_container`. When set, **the server derives the upstream** from the
      live container and ignores the client's; not derivable → `400`, set it by hand
- [x] Following a container and following a machine are exclusive → `400`

**The follower** — `shared/follow.py`, Loskai's first background task
- [x] Docker `start` events → reconcile that container: if it is linked, routed, following,
      and its derived upstream changed → store it, re-push the Caddy route. Best-effort like
      machine propagation: the stored upstream is updated first, so Sync repairs a failed push
- [x] Reconcile **every** following route at startup and after each reconnect — changes made
      while Loskai or the daemon was down produce no event
- [x] Never blocks startup; Docker unreachable → back off and retry, nothing else greys out
- [x] Stopped on shutdown (close the event stream, so its blocking read returns)

**UI** — in `RouteFields`, so both forms get it from one place
- [x] Following: the upstream is read-only, with the derived value and "follows the
      container — updates itself when its port changes"; **Set by hand** unlocks it
      (`follow_container: false`)
- [x] A manual docker route whose address can be derived offers **Follow the container**

**Recipes**
- [x] Bambuddy's compose sets `loskai.port: ${PORT:-8000}` — host networking, so this is the
      only way its port is known; with it, its route is derivable and follows

**Verification**
- [x] Unit + contract tests: label resolution in every mode, the follower (13 — including an
      edit made mid-reconcile winning, and shutdown releasing a read blocked in its thread),
      the endpoint rules (7), the lock in both forms. `pytest` (379) + `npm test` (131)
- [x] **Live, Sunde's scenario exactly** (2026-10-03, scratch backend + Caddy as project
      `loskai-smoke`, beside the real dev stack and untouched by it): installed a whoami
      recipe as `followtest` — **not** `whoami`, whose Compose project is global per daemon
      and belongs to Sunde's running container — routed it following while *sending a bogus
      upstream*, which the server ignored for the derived `192.168.10.220:8091`. Then edited
      its `.env` to 8092 and ran `docker compose up -d` **outside Loskai**: the follower
      logged the move ~0.5s later, Caddy dialled `192.168.10.220:8092`, the route served the
      *recreated* container, and the old port refused connections. `synced` and
      `upstream_healthy` both true
- [x] Live: host networking — Docker reported `ports: []`, the picker still offered
      `192.168.10.220:8093` from the label; changing `PORT` outside Loskai moved the label
      to 8094 and the route with it
- [x] Live: **catch-up** — with Loskai stopped, the port changed to 8095; the route went
      stale (**502**, the original complaint). On restart it was re-pointed with no event
      and no click (**200**)
- [x] Live: a route set by hand stayed put through a port change (zero follower moves)
- [ ] Live: **restarting the Docker daemon** mid-run — needs root on the dev VM, so not run.
      The reconnect path is covered only by `test_the_daemon_going_away_is_retried_and_caught_up`
      (a dropped stream, a refused reconnect, then the catch-up). Run it the next time a
      daemon restart happens anyway: `journalctl` should show one "not following containers
      … retrying" line, and following routes should still move afterwards

**Follow-up, same day — the upstream as host + port** (Sunde: "split into two fields, one for
the ip address/machine … a dropdown menu … with a dual function of being able to simply type
in the ip address (and a search filter) and the port, both fields … in the same row")
- [x] `HostSelect`: type any address, or pick from a list filtered by name or address; ▾ shows
      all; arrow keys + Enter pick, and **Enter never swaps a typed address** for an option it
      prefixes (`192.168.10.5` vs `.50`). Picking a machine links the route; typing unlinks
- [x] In `RouteFields`, so both forms got it — and **both forms lost their own machine list**
      (Add route's External list, the row form's "Hosted on a machine" box). The options come
      from one builder, `hostOptions`, which reads the declared `kind` — the External list had
      been re-deriving "machine" from the address shape
- [x] Following locks both fields and hides the list. A pasted `host:port` splits itself;
      the port takes digits only. The docker-mode host hint is `jellyfin`, no longer the
      prefix's `grafana`
- [x] No backend change: the forms still post one `upstream`. `npm test` (139)

---

## Phase 30 — UI polish: Machines tab, the upstream link, Docker by stack, the recipe catalog

_Origin (2026-10-05, Sunde): "the docker view's structure with regards to containers and
volumes, the add/install recipes menus and navigation wizard, routing of services and
containers and the binding up against machines (I want to move machines to its own tab on the
side bar separating them from routes to make it more defined)"._

**Decisions (Sunde, Q&A 2026-10-05)**
- **Machines get their own sidebar tab** — a walk-back of Phase 21's "a second button, not a
  second tab". Machines and routes now read as two things, which the views and the `via` tag
  were working around. Each machine is listed with the routes hosted on it beneath
- **The upstream host is Machine *or* Address**, a toggle. Machine is a select by name and
  the link is the point; Address keeps Phase 29's combobox (Docker host, this container, or
  typed). A linked row shows `nas:32400` with the IP beneath, not the IP with a tag
- **Docker is organised by stack**: each stack expands to its containers, the rest under
  Standalone. A Volumes tab beside it, with size and which containers use each volume
- **The recipe flow, all four**: a roomier catalog with search, a step indicator, routing
  the install from its last step, and Install reachable from every Docker tab

**30a — the Machines tab**
- [x] `/machines` page + nav entry (admin), machines with their dependents beneath; Name a
      machine, edit, delete (the unlink warning moves with it)
- [x] Routing shows services only — the views and the Name a machine button go
- [x] Docs: `CLAUDE.md` admin tabs, `HISTORY.md` (the walk-back), `PLAN.md` if it names the tab

**30b — Machine or Address**
- [x] `RouteFields`: a toggle; Machine mode is a select of machines + the port; Address mode
      is `HostSelect` without the machines. Both route forms get it through the shared fields
- [x] Routing table: a linked upstream reads `<machine>:<port>`, the address beneath
- [x] **Added while building:** each machine's row on the Machines tab has "Add a route on
      this machine" — the same Add route picker, opened on External in Machine mode
- [x] **Machines no longer hide the Docker host.** `hostOptions` used to drop the Docker
      host when a machine shared its IP, so a pick linked the machine; the two modes are
      separate lists now, and Address never links
- [x] Tests: the combobox-picks-a-machine tests rewritten for the toggle (no guessing a link
      on switch, Address unlinks and keeps the IP, a row-opened picker starts linked)

**30c — Docker by stack, and volumes**
- [x] Backend: each container carries its compose `project`; `GET /api/docker/volumes` (name,
      size, project, which containers mount it). `api.md` + the route count
- [x] Frontend: Containers tab grouped by stack (stack actions on the group row), Standalone
      last; Volumes tab. A compose project from outside the stacks folder (Loskai's own) is
      its own group, listed but without stack actions; a stack with no containers keeps its
      group, so Up stays reachable
- [x] **Read-only volumes, deliberately.** No remove button: Docker refuses an in-use volume
      anyway, and the one worth removing is the one nothing mounts — which is exactly what
      the list now shows. `docker volume rm` stays on the host
- [x] Checked against the real daemon (dev VM): three volumes, all `used_by: []` — correct,
      since all three containers there bind-mount. They are the Bambuddy migration's
      leftovers (`bambuddy_bambuddy_data`/`_logs`) and an old `loskai_caddy-data`
- [x] Tests: +5 backend (`volume_rows` join/size/anonymous, `project`, `list_volumes`), +7
      frontend (`groupByStack` ×4, the grouped table ×2, volumes ×1)

**30d — the recipe flow**
- [x] Catalog: search, a grid, the source shown quietly
- [x] Step indicator: Choose → Review → Configure → Done
- [x] Done step routes the install: the suggested prefix + the container's upstream,
      following by default, posted to `/api/routes`
- [x] Install recipe in the Docker header, not only on the Stacks tab (landed with 30c)
- [x] **A walk-back, recorded:** `PLAN.md` had "No assign step here". The step posts
      `container` (the idempotency key) and pre-fills through `containerPrefill`, so it can
      neither duplicate a record nor drift from the other forms; it offers the prefix only.
      A reinstall that kept its route says so; a port Docker can't name links to Routing
- [x] The install output folds away on success (open on failure, where it is the point)
- [x] Tests: +6 (search, the steps and going back, the route posted, the kept route, the
      unnameable port, the failed install offering no route)

**Verification**
- [x] `pytest` (443) + `npm test` (169) + `npm run build` + `check-docs.sh`. The build
      caught a test-only type error `npm test` didn't — the fetch mock's signature
- [x] **Live**, the rig (smoke Caddy as `-p loskai-smoke`, a `:8010` backend on scratch
      state, Playwright driving the built UI): searched the catalog, installed a recipe, and
      routed it from the last step — **one** record (`echo`, linked to `echo-echo-1`,
      following), Caddy dialling `192.168.10.220:8091`, and the route answered with whoami's
      body `Via: Caddy`. Named a machine, added a route on it from its row (the picker opened
      linked to it), Routing read `box:8081`; moving the machine to `.231` reported
      `relinked: ["hello"]` and **Caddy's dial moved**; moving it back served whoami again

---

## Phase 31 — Recipe updates: the recipe owns compose.yml, you own the override

_Origin (2026-10-18, Sunde): "if we're using override to set custom settings, doesn't that
mean we can let the main compose file be static and updated through the recipes? … a simple
unintrusive button called check for updates up together with the new stack and install
recipe. it would simply list the installed recipes and give a notification or update symbol
if something can be updated … both the list and the instructions of what changes from
version to version"._

**Decisions (Sunde, 2026-10-18)**
- **Each file has one owner.** `compose.yml` is the recipe's — an update replaces it.
  `.env` is your answers — kept, and a question a new version adds gets its default.
  `compose.override.yml` is yours — an update never touches it
- **One button, "Check for updates", in the Docker header** beside New stack and Install
  recipe — nothing on the stack rows. It syncs the recipe sources (explicit, as sync always
  is), then lists the installed recipes in a dialog, marking those with an update
- **What changes** is shown per recipe: the recipe's commit messages since the install (git
  sources), and the difference in `compose.yml` (always)

**31a — remember what was installed**
- [x] Install writes `.loskai-recipe.json` beside the compose file: recipe id, source URL,
      the source's commit, and a fingerprint of the `compose.yml` it wrote. One of the
      stack's config files, so Delete removes it with them
- [x] A stack from before this, named like a recipe, has none: shown as "installed before
      updates were tracked", with the difference; updating it writes the record

**31b — the check and the update (backend)**
- [x] `GET /api/recipes/updates`: sync, then each installed recipe with a status —
      up to date · update available · `compose.yml` edited by hand · recipe no longer in
      any source — plus the changes (commits, the diff, new `.env` questions)
- [x] `POST /api/recipes/updates/{stack}`: refuse unless `docker compose config` loads the
      new `compose.yml` with the existing override and `.env`; then replace the file, add
      the new questions' defaults to `.env` (never rewrite an existing line), update the
      record, pull + up. A new question with no default → refused, reinstall to answer it
- [x] Edited by hand: the update is allowed, but the dialog says what is lost and suggests
      moving the edit into the override first. `git_build` recipes: not offered

**31c — the dialog (frontend)**
- [x] The button; a list with an update mark; a recipe opens its commits, its diff and an
      Update button; the output of `up` on failure, as the stack editor does

**31d — the recipe authors' promise**
- [x] `recipe-schema.md` and the recipes repo's checklist: within one recipe id, keep the
      service names, the mount target, the `.env` keys and the data folders — what an
      override and an `.env` hang on. A change to one is a new id or a note in the commit
- [x] Recipe instructions stop saying "raise the image tag in compose.yml"

**Verification**
- [x] Tests both sides: +17 backend (status matrix, diff, image headline, new questions,
      trailers, the record, every status, the update and its refusals, a real git log), +5
      frontend. `pytest` (487) + `npm test` (214) + `npm run build` + `check-docs.sh`
- [x] **Live** (scratch backend, a local git repo as the source's cache, Playwright): installed
      `hello` on whoami v1.10.0 and added an override mounting a folder; committed "Hello
      1.11" (v1.11.0 + a `TZ` question) to the source. The dialog read "1 of 1 installed
      recipes can be updated", the unreachable source's note, the commit's subject and body
      (trailer dropped), `TZ` as a new setting, and the diff. Update → "Up to date";
      `compose.yml` was the recipe's, the override byte-for-byte unchanged, `.env` gained
      `TZ="Europe/Oslo"` under the untouched `PORT` line (still `0600`), the container ran
      v1.11.0 with `/extra` still mounted, and the record held the new commit

---

## Phase 32 — The stack editor as a form

_Origin (2026-10-18, Sunde): "a parser so that we could read the compose, env and override
as input fields instead of the raw compose, since you keep putting so many comments into the
compose file that i dont really know where to look for the proper values"._

**Decisions (Sunde, 2026-10-18)**
- **`compose.yml` is shown, not edited**: it is the recipe's (Phase 31), so an edit there is
  lost to the next update. Settings and folders are where changes go
- **The recipes' comments move out of `compose.yml`** — into `recipe.yml`, which never
  reaches a stack

**32a — backend**
- [x] `stackform.py`, pure parse/build + I/O: `.env` values (as Compose reads them, written
      back line by line), the variables `compose.yml` reads (from the loaded YAML, so not
      from comments), the app's image/ports/folders interpolated, the override's bind mounts
      as rows and back. `GET`/`PUT /api/docker/stacks/{name}/form`
- [x] Folders get the install's path checks; everything is checked before anything is
      written. A cleared setting removes its line, so the default applies again
- [x] The override header no longer says "Reinstall to change them"; the old one isn't
      counted as the user's comment

**32b — frontend**
- [x] Edit opens the form; "Edit as text" (and back) once nothing is unsaved. The two
      views share one save-then-up and footer. New stack stays text — there is nothing to read
- [x] Layout pass (2026-10-19, Sunde: "tighten up the formatting and layout"): the app on
      top, settings in two columns with the label above (as the wizard), folders under one
      header row — two lines each at phone width — and the hints in tooltips
- [x] Second pass (Sunde: "more professional … a small image … host port and folders side
      by side"): a header with the recipe's icon and what it runs — each port and data
      mapping a chip, a folder told from a Docker volume — then Settings and Folders as two
      panels side by side (stacked on a phone). The form now returns `recipe` `{id, name,
      icon}` in place of `from_recipe`
- [x] Edit as text from a form with unsaved changes (Sunde: "edit as text stops working
      when we add a folder"): an empty folder row is no longer a change, and real changes
      carry over — `PUT /form` with `preview: true` returns the files the save would
      leave, opened as unsaved edits. Text → form still waits for a save: half-typed YAML
      may not read back as fields. Live: port + a folder + an empty row → the text view
      showed both files marked unsaved, the row dropped; Save + re-up put the container
      on the new port with the folder mounted
- [x] …and back (Sunde: "now i cant go back to edit as form"): `POST /form` reads the form
      from the text view's unsaved `.env` and override, and `PUT /form` takes them as
      `base` to save on top of. Only an unsaved `compose.yml` holds the switch — the form
      doesn't edit it. Live: port + folder in the form → an `environment:` line typed in
      the override → back to the form (port and both folders there, "other settings
      kept") → port again → Save: `.env` 8099, the override with the environment line and
      both folders, the container on `:8099` with `EXTRA=1`
- [x] The button (Sunde, 2026-10-19): "Save + re-up" greyed out with nothing to save read
      as something wrong. Tried Save-or-Restart in one button, then Save and Restart side by
      side; **settled on the usual edit-dialog pattern** — Cancel and **Save**, Save greyed
      out until something changed (with a tooltip), in both views. Restarting stays on the
      stack's row, where actions on the stack live

**32c — recipes**
- [x] Each `compose.yml` keeps a two-line header; the author notes are `recipe.yml` comments;
      Jellyfin's `/dev/dri` is an override snippet in its instructions; the authoring rules
      say so

**Verification**
- [x] +16 backend, +5 frontend. `pytest` (503) + `npm test` (219) + `npm run build` +
      `oxlint` + `check-docs.sh`; recipe validator 3 valid, each `compose.yml` passes
      `docker compose config`
- [x] **Live** (scratch backend + stack, Playwright): the form showed "Host port"/"Time zone"
      from the recipe, the folder from an override with the old header (no comment
      warning), and the app as `8091 → 80`. Port 8092, `TZ` UTC and a read-only folder
      added → `.env` `PORT="8092"` + `TZ="UTC"` (`0600`), the override in long syntax, and
      the container on `:8092` with `/media/films` `rw=false`, `/media/anime` `rw=true`,
      `TZ=UTC`. A missing folder failed `up` with "bind source path does not exist" (none
      created); an empty list removed the override; `~/x` was refused

---

## Phase 33 — Recipe options: optional features as checkboxes

_Origin (2026-10-19, Sunde): "what do we do about extra variable toggles like the graphic
card transcoding that jellyfin has? … it would be nice if we have a default way to handle
such cases"._

**Decisions (Sunde, 2026-10-19)**
- **A recipe declares `options`**, each a checkbox — off by default — in the wizard and the
  Edit form. Not always-on: a missing device stops the container
- **On adds exactly an option's lines to the override, off removes exactly those**; whether
  one is on is read from the override, never stored
- Jellyfin gets Intel/AMD hardware transcoding, and NVIDIA (Sunde: "lets make one for the
  nvidia option too then, so that is covered")

**33a — backend**
- [x] `options` validated: id, label, optional help and service, `set` limited to
      `devices`/`group_add`/`environment`/`cap_add`/`ports`, each a list
- [x] `option_on` / `set_options` (pure); install takes option ids; the form reports each
      option's state, saves switches, and doesn't count option lines as "other settings"

**33b — frontend**
- [x] `OptionList` (checkboxes with a help line) in the wizard's fill step and an Options
      panel under Settings in the form

**33c — recipes and docs**
- [x] Jellyfin's `hwaccel` option replaces its paste-this-snippet instructions; the authoring
      rules say optional hardware is an option; `recipe-schema.md` gets an Options section

**Verification**
- [x] +18 backend, +2 frontend. `pytest` (525) + `npm test` (224) + `npm run build` +
      `oxlint` + `check-docs.sh`; recipe validator 3 valid
- [x] **Live** (scratch backend, the real Jellyfin recipe as `gputest` on whoami, Playwright;
      this VM has `/dev/dri/card0`): installed with the option ticked → the form showed it
      ticked; unticked + Save → the override was removed and the container had no devices;
      on again → `devices: [{/dev/dri /dev/dri rwm}]`. An option for a missing device
      failed `up` with "error gathering device information … /dev/nope"; unticking it
      brought the stack back up
- [x] NVIDIA: options may add `deploy` (a mapping, merged key by key; a value set otherwise
      refused). +4 backend tests (529). Live, no NVIDIA here: both options ticked → `docker
      compose config` accepted the override; `up` failed with "could not select device
      driver "nvidia" with capabilities: [[gpu]]"; unticked → only its block went, the
      `/dev/dri` line stayed, and the stack came back up

**After it (2026-10-20)**
- [x] An option's help starts with what happens without it — Jellyfin's GPU boxes read as
      if Jellyfin needed a GPU, when off it transcodes on the CPU
- [x] Recipe sync fetches and resets to `FETCH_HEAD` instead of `pull --ff-only`, so a
      force-pushed source keeps syncing. Live, the real cache (no fetch refspec) moved from
      the pre-rewrite `6b07a13` to the forge's `a067db8`
- [x] A new route for a recipe stack's container gets the recipe's icon (Sunde: the image
      didn't follow a route added later). +7 backend tests (537). Live, in the rebuilt
      container: `jellyfin-jellyfin-1` → the Jellyfin icon; `whoami-whoami-1` → none (its
      recipe has none); `loskai` → none (not in the stacks folder)
- [x] Review of Phases 31–33 (Sunde: "any oversight we might have done?"), three fixes:
      a folder added for an empty service entry (`jellyfin:` with nothing under it) was
      dropped while Save reported success; a stack written by hand under a recipe's name
      got options for a service it doesn't have; and after a Save whose `up` failed, the
      form still read the old files, so unticking the option that broke it was "no change"
      and Save stayed grey. +3 backend (540), +1 frontend (225). Live (scratch backend, a
      `gputest` recipe adding `/dev/nope`, Playwright): ticked + Save → up failed and was
      shown; the box read ticked, Save grey; unticked → Save enabled → saved, the override
      removed, the container running with no devices
- [x] A second review (`/code-review`), nine fixes: the icon lookup read the compose project
      name as the folder (Compose lowercases it and drops dots) and gave a recipe's database
      the icon too — it reads the `working_dir` label now, for the primary container only;
      the icon step could turn a live route into a `500`, and wrote back the whole record
      over a follower change; route tests asked the real Docker daemon; a failed read-back
      in the form showed nothing; `app: []` was replaced, not refused; the sync fetch had
      no `--depth 1`; a Save scanned the recipes twice. +7 backend (547), +2 frontend (227).
      Live, in the rebuilt container: `jellyfin-jellyfin-1` and `bambuddy-bambuddy-1` → their
      icons; `whoami-whoami-1` → none (its recipe has none); `loskai` → none (its folder is
      not in the stacks folder)
- [x] A read of those fixes found one more in them: the read-back ran only when `up`
      *reported* a failure, not when the request itself errored (no docker CLI, a Compose
      timeout — a `400`) after the files were written, so Save went grey again. A save
      reports "kept" once the files are written, whatever `up` does. +1 frontend (228)

---

## Phase 37 — Git as a tool: who commits are by, and where the projects are

Asked 2026-11-03: a Git tool where each machine's projects folder and its global git user
and email are set.

**Decisions (2026-11-03, Sunde)**

- **A tool can have settings** (`settings:` in its file): a value on the machine, with
  a command that reads it and one that writes it, the new value reaching the write command
  only as `$1`, checked against a kind as a target is. The Git tool has Name
  (`user.name`) and Email (`user.email`), both `git config --global`.
- **Read and written with Loskai's key**, when the card is open
  (`GET`/`PUT /api/ssh/machines/{id}/tools/{tool}/settings`). Nothing to install again;
  the values show while the key is unlocked, and the card says to unlock otherwise.
  The overview (the status key) was the other way, and was turned down: it would have
  needed a new status line, and every machine installing again.
- **The projects folder moves to the Git card**, out of General. It stays Loskai's,
  on the machine's record, and Claude Code still finds its projects there.
- **Git needs git** on the machine, so it is an added tool, offered under Add tool where
  git is missing.

**Steps** — a commit each, every check run:

- [x] 37a Backend: `settings` in the tool schema, `git.yml`, the two routes, the log; tests
- [x] 37b Frontend: settings in a tool's card, the projects folder moved to Git's; tests
- [x] 37c Docs: tool-schema.md, api.md (+2 routes), using-loskai.md, architecture.md, CLAUDE.md, HISTORY, CHANGELOG
- [x] Live, in Chromium against the Debian container: the card asked for the password
      (key locked after a restart), read nothing set, set Name and Email, refused "not an
      address" with "Not a valid email", and `git config --global --list` on the machine
      showed both; the SSH log has each as `setting`
