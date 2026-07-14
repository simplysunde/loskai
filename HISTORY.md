# Loskai — History

## 2026-07-14 — Phase 7: deployment (single image + compose + LXC script)

Made the whole thing runnable as the single container the plan describes. No app-code
changes — packaging and infra only.

- Key files: `Dockerfile`, `.dockerignore`, `docker-compose.yml`,
  `docker-compose.colocated.yml`, `Caddyfile`, `caddy/{Dockerfile,Caddyfile}`,
  `scripts/create-lxc101.sh`, `README.md`
- **Dockerfile**: multi-stage single image. Frontend built in node:20-alpine; runtime is
  python:3.12-slim-bookworm (pinned so the Docker apt repo line matches the base OS) with
  a two-step `uv sync` (deps cached, then the project), git + Docker CLI + Compose v2, the
  bundle at `./static`, served on :8080. `CMD uv run --no-sync` so the locked env is never
  touched at runtime
- **Two compose files**: the preferred split (Loskai on the Docker host, Caddy/AdGuard on
  LXC 101) and the all-in-Docker co-located stack (with the port-conflict notes and
  required `CADDY_HOST_IP`)
- **LXC script**: provisions the Network Services box — AdGuard via its installer, Caddy
  via the **official custom-build download** (prebuilt binary with the DNS plugin, avoiding
  an xcaddy/Go toolchain in an untested script) + a systemd unit
- **Verified without a Docker daemon** (unavailable here): ran the exact production install
  `uv sync --frozen --no-dev` (confirmed dev deps removed, app still imports) and the exact
  container CMD serving the freshly-built bundle on :8080 — SPA + deep-route fallback +
  gated API + all four module statuses. Compose YAML and the LXC script parse. The real
  `docker build` / `docker compose up` still needs a Docker host

## 2026-07-14 — Phase 6: cross-module URL assignment (the keystone)

`shared/assign.py` — the one place modules coordinate, and the action that unblocks the
deferred write-path UI. The Caddy and AdGuard modules stay read + push only; this is the
sole cross-module writer.

- Key files: `backend/src/loskai/shared/assign.py`, `shared/instances.py` (PATCH),
  `frontend/src/pages/Routing.tsx`, `components/routing/ServiceTable.tsx`
- **`POST /api/assign`**: validate single-label prefix + subdomain uniqueness → Step 0
  persist intent → Step 1 Caddy route (REQUIRED; roll back — delete a new instance or
  restore an existing one — and 502 on failure) → Step 2 AdGuard rewrite with
  answer = derived Caddy IP (BEST EFFORT; warn, never fail). Handles a new external
  ("dummy") instance and an existing one; a rename removes the orphaned old-domain rewrite
- **`DELETE /api/assign/{id}`**: the mirror — clear subdomain + save, Caddy delete
  (required, rollback), best-effort AdGuard delete by exact pair; the instance survives
- **`PATCH /api/instances/{id}`**: persists the `private` flag / name (routing-table toggle)
- **Frontend**: Assign button → AssignModal → assign (result banner with URL + any AdGuard
  warning); ServiceTable delete (ConfirmDialog) + private toggle; `api.patch` added
- **assign/unassign take the clients as args** so they're driven by fakes in tests. Tier-1
  covers validation, uniqueness, happy path, Caddy-fail rollback (new + existing), AdGuard
  best-effort (error/skipped/no-IP), and the unassign mirror
- **Verified**: 65 backend + 12 Vitest tests pass; clean build/lint. Ran the whole flow end
  to end through the real HTTP clients against a throwaway Caddy+AdGuard stub — route +
  rewrite land, 422/409 guards fire, private toggle and the delete mirror both confirmed

## 2026-07-14 — Phase 5: WireGuard module (reachability card)

The simplest module — no auth, no API, no state. Loskai never manages peers; this is a
pure status card that links out to wg-dashboard.

- Key files: `backend/src/loskai/modules/wireguard/{client,router}.py`,
  `frontend/src/pages/WireGuard.tsx`, `components/wireguard/WireGuardCard.tsx`
- **Reachability**: a plain GET to `WIREGUARD_DASHBOARD_URL` with no `raise_for_status` —
  any HTTP response (incl. 401/403 from an auth-protected dashboard) counts as reachable;
  only a connection failure/timeout is unreachable
- **DNS reminder**: the router derives `dns_hint` from the host of `ADGUARD_URL` so the
  card can tell peers which DNS to use (AdGuard IP + 1.1.1.1); generic guidance when unset
- **Frontend**: the VPN tab replaces its placeholder and reads `wireguard` straight from
  the aggregate `useHealth` (the registered checker already returns url + dns_hint)
- **Verified**: 54 backend + 11 Vitest tests pass; clean build/lint. Curl-confirmed the
  reachable-on-401 rule (self-pinged the gated `/api/health`) and dns_hint derivation

## 2026-07-14 — Phase 4: AdGuard module (DNS rewrites + reconcile)

The second module — and the trickiest logic in the app, the `(domain, answer)`
reconcile. Backend follows `docs/adguard-api.md`; the DNS column and AdGuard status
fold into the existing Routing view (no separate page).

- Key files: `backend/src/loskai/modules/adguard/{client,service,router}.py`,
  `backend/tests/test_adguard_{reconcile,client}.py`;
  `frontend/src/components/routing/{AdGuardStatus,ServiceTable}.tsx`, `pages/Routing.tsx`
- **One explicit rewrite per routed instance, no wildcard.** `answer` is the shared Caddy
  LAN IP from `derive_caddy_host_ip()` (IP host of `CADDY_ADMIN_URL`, else `CADDY_HOST_IP`
  in docker mode). Delete is POST to `/rewrite/delete` with the whole `(domain, answer)` —
  the exact-pair delete is what protects hand-added rewrites
- **`plan_reconcile` is pure** (unit-tested directly): ensure `(domain, current_ip)`
  exists, migrate an orphan when the stored `dns_answer` differs (delete the stale pair),
  and report a same-domain foreign answer as a manual conflict without touching it. The
  executor applies it best-effort and persists `dns_answer` for every domain now resolving
  to `current_ip`. Only ever deletes answers Loskai itself wrote
- **Router**: health / rewrites (list+add+delete) per the contract, plus two small
  additions — `GET /status` (per-instance DNS comparison kept server-side + testable) and
  `POST /reconcile`. AdGuard unreachable → 502, never a bare 500
- **Frontend**: DNS column (rewrite set / missing / unknown + conflict) with a best-effort
  per-row add/remove; `AdGuardStatus` pill + link-out; "Push all" now runs the Caddy push
  and the AdGuard reconcile together with a combined summary
- **Fixed a Phase 3 regression**: the repo's Python `.gitignore` has `lib/`, which also
  matched `frontend/src/lib/` and silently kept it out of the Phase 3 commit — the UI built
  locally only because the ignored files still sat in the working tree; a fresh checkout
  would have failed. Added a `!frontend/src/lib/` negation and committed the missing files.
  Confirmed no other source is silently ignored
- **Verified**: 50 backend + 9 Vitest tests pass; `tsc`/`vite build`/`oxlint` clean. Curl
  confirmed answer-IP derivation, `/status` (present=null when AdGuard down), and the
  graceful 502 on reconcile when AdGuard is unreachable

## 2026-07-14 — Phase 3: Caddy module (backend) + frontend shell

First module and the whole UI skeleton. Backend Caddy module is read + push only
(never assigns — that's Phase 6); frontend is the Lutris-inspired shell plus the read
side of the routing view. Everything the write-path needs (assign, DNS column) is
deliberately deferred to Phases 4/6.

- Key files: `backend/src/loskai/modules/caddy/{client,service,router}.py`,
  `backend/tests/test_caddy_{logic,client}.py`; `frontend/src/{App,main}.tsx`,
  `components/{shared,routing}/*`, `pages/*`, `lib/*`
- **Backend, per `docs/caddy-api.md`**: `client.py` is thin I/O (server name discovered
  from `/config/apps/http/servers` and cached — never hardcodes `srv0`; push, delete
  ignoring 404, upstreams, a health probe). `service.py` holds all logic: FQDN + route
  JSON builders (keyed by `@id`), Caddyfile render, `list_with_sync` (display-only sync
  comparison, never auto-corrects), delete-then-add `upsert_route`, `push_all` recovery.
  Mode detection lives in `service`, not `client`, to keep the I/O/logic seam clean
  (TODO had it under client)
- **Health registry wired**: the caddy router registers its checker, so the aggregate
  `/api/health` now reports a real caddy status (+ `mode`) instead of `unconfigured`
- **Frontend shell**: persistent left sidebar (health dots + logout), `api.ts`
  (401→/login), `useHealth` **gated on auth** (so the public dashboard never 401s on the
  gated health endpoint), Dashboard, Login (doubles as first-run setup), Settings
  (env-read-only fields), and the Routing view (ServiceTable + Push all + Caddyfile
  export). Dark-first, Tailwind v4, maritime teal
- **Deferred (noted in TODO)**: AssignModal built + unit-tested but its `/api/assign`
  wiring is Phase 6 (the Assign button is a disabled signpost); the DNS-rewrite column is
  Phase 4; ServiceTable delete/private-toggle are Phase 6; the Settings change-password
  field awaits a change-password endpoint
- **Verified**: 30 backend tests + 7 Vitest tests pass; `tsc`/`vite build`/`oxlint` clean.
  Curl against the built `dist/` confirmed prod SPA serving (index, deep-route fallback,
  assets), API precedence over the catch-all, and unknown `/api` paths returning 404
  JSON (authed) / 401 (unauth) — never `index.html`

## 2026-07-13 — Phase 2: backend foundation (shared spine + auth boundary)

Built the backend skeleton every module hangs off: the flat-file stores, the settings
priority chain, the security gate, and the aggregate health/dashboard endpoints. No
external-service clients yet (those are Phases 3+) — this is the shared core.

- Key files: `backend/src/loskai/config.py`, `shared/{store,settings,instances,auth,health,dashboard}.py`,
  `main.py`, `tests/test_{settings,instances,auth}.py`
- **`config.py`**: pydantic-settings, every value optional. Added dev-only `LOSKAI_DATA_DIR`
  / `LOSKAI_STATIC_DIR` (aliased) so the data volume + built bundle are relocatable for
  tests and local runs
- **`shared/store.py`** (new, not in the PLAN tree): atomic JSON read/write (temp-file +
  rename) — the single file-I/O seam shared by settings + instances, so neither can be
  left half-written and both stay testable against `tmp_path`
- **`settings.py`**: the priority chain env > `settings.json` > unset, each value
  source-tagged; `PUT` ignores env-sourced keys; admin hash stored but never returned;
  answer-IP derivation (IP host of `CADDY_ADMIN_URL`, else explicit `CADDY_HOST_IP`)
- **`instances.py`**: the `Instance` model (all 7 fields) + CRUD + `list_routed()` (the
  route table = the subdomain subset)
- **`auth.py`**: argon2 hash/verify, itsdangerous signed `HttpOnly` session cookie
  (secret generated + persisted to the volume), middleware gating every `/api/*` except
  the public dashboard + login flow, first-run `/api/auth/setup`, and `LOSKAI_PASSWORD`
  seed-once-on-boot
- **Decision — `/api/health` is gated.** PLAN's security rule ("gate every `/api/*` except
  `GET /api/dashboard`") is absolute, so health sits behind auth; only the dashboard and
  the login flow are public. The Phase 2 verify line (which read as if health were public)
  was reconciled to this — health returns 401 unauthenticated, 200 with a session
- **Verified**: 16 Tier-1 tests pass; curl confirmed the full boundary (public dashboard,
  401→200 on health/settings, wrong/right login, and the complete first-run setup path
  incl. 409/422 guards). Cookie session round-trips
- **Watch out**: session cookie `secure=False` for dev HTTP — flip to True behind Caddy
  TLS at deployment (Phase 7). Health reports `unconfigured` for all four modules until
  their clients land

## 2026-07-13 — Phase 1 scaffolding: backend + frontend stood up

First code lands. Verified TODO against PLAN (fully aligned after the prior review
passes), confirmed the repo was still planning-stage, then scaffolded the two-project
layout with no app logic yet — the foundation Phases 2+ build on.

- Key files: `backend/` (uv package `loskai`, src layout, `pyproject.toml` + `uv.lock`),
  `frontend/` (Vite + React + TS), `.env.example`
- **Backend**: uv package, Python pinned to **3.12** to match the prod `python:3.12-slim`
  image (uv defaulted to 3.14). Runtime deps fastapi / uvicorn[standard] / httpx /
  pydantic-settings / sse-starlette / argon2-cffi / itsdangerous; dev pytest +
  pytest-asyncio + pytest-httpx. Dropped uv's console-script stub (app runs via uvicorn)
- **Frontend**: Vite 8 / React 19 / router 7 / Tailwind 4. Dev proxy `/api/*` → `:8000`
  with `ws: true` (for the Phase 8 container-exec socket); prod serves API + bundle on
  `:8080`. Tailwind via `@tailwindcss/vite`; Vitest + Testing Library (jsdom + jest-dom),
  a smoke test proving the harness
- **Deviation from TODO**: installed `@xterm/xterm` + `@xterm/addon-fit` instead of the
  listed `xterm` — npm deprecates the old `xterm` package and the new fit addon expects
  the new namespace. Unused until Phase 8
- **Verified**: backend `uv sync` + import smoke of all runtime libs + `pytest --version`;
  frontend `npm run build` (tsc + Vite + Tailwind, CSS emitted) + `npm test` (1 passed)

## 2026-07-13 — Renamed FlytDokk → Loskai

Renamed the project from *FlytDokk* (Norwegian *flyt* "flow" + *dokk* "dock") to **Loskai**,
chosen for searchability and adoption. From Norwegian *los* (the harbor pilot who steers ships
safely to berth) + *kai* (quay/dock). The metaphor sits inside Docker's own maritime language
(container, port, harbor) and supplies a built-in security narrative — a pilot guides you in
*safely* — which the old name lacked. Tagline: *"Safe passage for your Docker deployments."*

- Availability (checked 2026-07-13): PyPI, npm, and `.dev`/`.io`/`.app`/`.com` domains all free;
  only the empty `@Loskai` GitHub *username* is taken (use a GitHub **org**, not that handle).
  Rejected alternative *Losen* — npm `losen` is an active React **wizard** framework (direct clash).
- Mechanical: `FlytDokk`→`Loskai`, `flytdokk`→`loskai` (package/container), `FLYTDOKK_PASSWORD`→
  `LOSKAI_PASSWORD` across all `*.md` + `docs/*.md`. Prose rewrites: `PLAN.md` etymology, `README.md` header/tagline.
- **Not yet done**: repo directory is still `Flytdokk/`; GitHub org/repo, PyPI/npm names not yet claimed.

## 2026-07-13 — Testing strategy, co-located deployment, plan review

Settled the second pre-build cross-cutting concern — how Loskai gets verified given its
real side effects — then did a full plan review pass and fixed the discrepancies it surfaced.
With this, both pre-build items (security, testing) are closed and the plan is build-ready.

- Key files: `PLAN.md` (Testing & CI, Co-located port notes, compose/diagram fixes), `TODO.md` (Phases 1, 7, 8b)
- **Testing principle**: test the logic Loskai owns, mock the systems it talks to,
  rig/hand-verify the irreversible side effects — never test `httpx`/`docker-py`. Relies on
  the `client.py` (I/O) vs pure-logic seam the modules already keep
- **Three tiers**: unit tests (`pytest`) on pure logic incl. the AdGuard reconcile; client
  contract tests (`pytest-httpx`) guarding the `docs/*-api.md` contracts; a disposable
  `docker-compose.test.yml` rig of throwaway Caddy + AdGuard (`tls internal`, no ACME token,
  ephemeral). Vitest on key frontend components; no E2E. Tiers 1–2 written alongside each module
- **Co-located deployment**: `docker-compose.colocated.yml` now runs Caddy **+ AdGuard** as
  containers — a real all-in-Docker alternative to Proxmox/LXC, and the basis for the test rig.
  Documented its port gotchas (AdGuard `:53` vs `systemd-resolved`; keep AdGuard off `80`/`443`;
  services don't conflict with each other, only host-published ports do)
- **CI**: Forgejo Actions (`.forgejo/workflows/ci.yml`, GitHub-compatible) runs `pytest` +
  `vitest` on push; one-time `act_runner` registration
- **Plan review**: fixed a real gap (compose didn't pass `STACKS_DIR` into the container, so a
  custom path would mismatch the mount) plus nits — `LOSKAI_PASSWORD` missing from the compose
  env, two broken `caddy-api.md` links, the "co-located" term drifting between "Caddy only" and
  "Caddy + AdGuard", a dead `PORT` env, a redundant Vision paragraph, and two misaligned ASCII
  diagrams

## 2026-07-12 — Access model + frontend design: gated admin, Lutris-style shell

Pinned down two cross-cutting concerns before implementation: Loskai's own security
posture and the frontend layout. The security work replaced a single "add Caddy basicauth"
line with a real two-tier model; the design work settled the navigation and view structure
from four explicit choices.

- Key files: `PLAN.md` (new Security & Access section, Layout & design philosophy, instance model, frontend/backend trees, Settings), `TODO.md` (Phases 1–4, 9)
- **Two-tier access, in-app auth**: a **public Dashboard** (launcher grid of non-private
  routed services, served by the one unauthenticated endpoint `GET /api/dashboard`) and an
  **admin tier** behind a single-password login. A blanket Caddy `basicauth` can't coexist
  with a public dashboard, so auth moved *into* Loskai
- **The gate is server-side**: middleware (`shared/auth.py`) rejects every `/api/*` except the
  dashboard endpoint — load-bearing because the container-exec WebSocket is a root shell; the
  frontend `RequireAuth` is UX only. Single admin password, **no accounts**, hashed (argon2)
  from `LOSKAI_PASSWORD` or first-run, signed `HttpOnly` session cookie. First-run locks the
  admin until a password is set; the session secret is generated + persisted to the volume so
  sessions survive restarts
- **Instance model gains `private`** (dashboard hide toggle) alongside `dns_answer`
- **Frontend = Lutris-inspired shell**: a persistent left sidebar (`Dashboard · Docker ·
  Routing · VPN · Settings`) + a library-style main area with contextual per-item actions
- **Caddy + AdGuard merge into one Routing tab** (frontend only — backends stay independent):
  an assign spans both, so the view is **one row per service** with route-sync and DNS-rewrite
  status inline, instead of two tabs to cross-reference. If AdGuard is down the tab still shows
  routes; only the DNS column degrades
- **Hybrid aesthetic**: card grid for dashboard/launchers, dense tables for stat-heavy lists

## 2026-07-11 — Install-wizard recipes: repo-synced declarative manifests

Reworked the install wizard from "recipes defined in code, baked into the image" to
declarative recipes Loskai validates but never executes — so adding or fixing a service
is a file edit, not a Loskai rebuild. Landed the schema as a `docs/` contract rather than
building any authoring UI, keeping the module thin.

- Key files: `docs/recipe-schema.md` (new), `PLAN.md` (Module 1 wizard + Stack Manager, Settings), `TODO.md` (Phases 2, 8), `README.md`
- **Recipes are declarative data, never code**: Loskai validates each `recipe.yml` against
  a fixed schema and drives it with its own engine; a malformed recipe is skipped, never run.
  This is what makes syncing them from a repo safe
- **Two sources, merged**: a public git repo you own (`RECIPES_REPO_URL`, canonical, synced
  to a settings-volume cache, no auth) + a local `/opt/loskai/recipes/` dir (dev/testing
  scratchpad, same volume, no new mount). On a name clash the **repo wins**; the shadowed
  local copy is flagged. Sync is explicit ("Refresh recipes"), no background polling
- **Recipe folder** = `recipe.yml` (manifest) + a standalone `compose.yml` (native `${VAR}`,
  testable/SSH-editable, not embedded) + `instructions.md`. The **`.env` is generated** from
  wizard answers at install time and never committed (holds secrets); `docker compose`
  substitutes `${VAR}` from it, so no templating engine
- **Schema is the authoring tool**: `docs/recipe-schema.md` documents every field, validation
  rules, and the three `type` patterns (`pull` / `git_build` / `registry_pull`) — authored by
  hand or with an AI coder, so no manifest-authoring UI was built. Sample recipes live in the
  repo, not the codebase
- **Raw path made explicit**: the Stack Manager's manual create takes a finished
  `compose.yml` + `.env` and runs `up` (Docker auto-creates bind-mount dirs) — the one-off
  counterpart to the reusable recipe path

## 2026-07-11 — Docker module review: STACKS_DIR pinned, registry auth resolved

Reviewed the Docker module — the last of the four — and closed three loose ends, all
plan-level (no code yet). The module is now internally consistent: container overview +
stack manager, filesystem-as-source-of-truth, and the container→instance join all hold up.

- Key files: `PLAN.md` (Module 1, Settings table + `settings.json` shape), `TODO.md` (Phases 2, 8)
- **`STACKS_DIR` pinned to the compose mount**: it drives the same-path bind mount, so the
  container only sees the directory mounted at launch — presenting it as a UI-editable
  setting invited pointing Loskai at an unmounted host path (stacks vanish, writes land
  where the host can't see them). Now compose/env-only, shown read-only in the UI, dropped
  from `settings.json`
- **One `stacks_dir_ok()` existence check** guards the gap the empty-list signal missed —
  the write path. `create_stack` / the install wizard refuse (with a clear message) when the
  dir is absent instead of writing into the void; feeds `/api/health`. Distinguishes a broken
  mount from a genuinely empty stacks dir. No other validation logic — deliberately minimal
- **`registry_pull` auth resolved**: private-registry `docker login` is a host precondition,
  not Loskai's job — the daemon caches the credential, so the pull is identical to a public
  one and Loskai stores no registry token (same principle as the ACME token living with Caddy)
- Also listed the `WS .../exec` interactive-terminal endpoint in the Docker router task
- All four modules (Docker, Caddy, AdGuard, WireGuard) are now planning-complete

## 2026-07-10 — Caddy + AdGuard API contracts, wildcard drop, per-instance DNS tracking

Hardened the two integration modules by pinning each to its real API and writing a
`/docs` contract for the exact subset Loskai calls. Resolved the `srv0`/nested-Caddyfile
conflict, reworked the AdGuard module around explicit per-instance rewrites (no wildcard),
and made both modules read straight off `instances.json` — `@id` for Caddy, a new
`dns_answer` field for AdGuard — so "what Loskai created" lives on the instance itself.

- Key files: `docs/caddy-api.md` (new), `docs/adguard-api.md` (new), `PLAN.md` (Module 2/3, Assign, Settings), `TODO.md` (Phases 3–4, 6)
- **Caddy contract**: flat sibling routes in one server (name discovered, never hardcoded `srv0`); bootstrap Caddyfile is cert-only (wildcard TLS block, no routes); edit = delete-then-add (PATCH errors if absent); autosave + `--resume` is the restart path, "Push all" the backstop. Certificate Status **deferred** — Admin API doesn't expose the public cert; captured a TLS-probe approach for later
- **Assign consolidated** on `POST /api/assign` (Caddy required, AdGuard best-effort); Caddy module trimmed to read + push only
- **AdGuard contract**: `/control` REST API, Basic Auth, rewrite list/add/delete only; everything else (filtering, clients, DHCP, stats) stays in AdGuard's own UI
- **Dropped the wildcard DNS rewrite** — one explicit rewrite per routed instance instead, so an unassigned name falls through to public DNS and can't shadow a real public name. (Caddy's wildcard TLS *cert* is unrelated and stays)
- **DNS answer** = Caddy LAN IP (derived from `CADDY_ADMIN_URL`; new optional `CADDY_HOST_IP` fallback when that's a hostname), never the upstream, never `localhost`
- **Manual-safety**: per-entry API + exact-pair delete means hand-added rewrites are never touched; same-domain conflicts are flagged, not overwritten
- **Orphan cleanup on IP change**: each instance stores `dns_answer` (the answer last written); reconcile deletes its own stale pair and re-adds the current one — no separate state file. Instance shape gains `dns_answer`
- Known residual: an instance deleted while AdGuard is unreachable orphans its rewrite (rare, cosmetic, hand-fixable) — no pending-deletions queue for now

## 2026-07-08 — Instance data model + Caddy routing redesign + domain model

Reworked how routes are stored after mapping out the assignment workflow end to end.
Arrived at a single unifying domain object — the **instance** — that both the Docker
Manager and the Caddy routing view read from. (Iterated through a SQLite route store with
enable/disable + reconcile, then dropped it: routes are binary, and the intent already
lives in data we track anyway.)

- Key files: `PLAN.md` (new Core Data Model section, Module 2, AdGuard, Settings, Caddy Setup), `TODO.md` (Phases 1–9)
- **Instance model**: `{ id, name, type: "docker"|"external", subdomain, upstream, container }`,
  stored as one flat `instances.json` in the settings volume — **no database**. A Docker
  container and an external LAN service (Proxmox, NAS, any IP:port) are the same structure,
  different `type`. Created manually or auto (via a `loskai.subdomain` container label)
- **Routes are a projection**: the route table = instances that have a `subdomain`. No
  enable/disable — a route exists or it doesn't. `id` = Caddy `@id` (idempotent push/delete)
- Runtime container state (status/CPU/RAM) is never stored — read live from Docker and
  joined at display time, so the store can't drift from reality
- **Persistence**: Caddy runs `caddy run --resume` (its config survives restarts);
  "Push all to Caddy" rebuilds every route from `instances.json` as the backstop. No
  reconcile/drift loop
- Caddyfile export: rendered from the instance list (download / copy), also the manual backup
- Ownership rule: Loskai only manages routes whose `@id` matches an instance — the static
  bootstrap routes (Loskai, AdGuard) in the Caddyfile are never touched
- Domain model: one global `BASE_DOMAIN` (e.g. `example.no`) + per-service single-label
  prefix = FQDN. Decoupled from DuckDNS (cert method is an LXC 101 concern); renamed
  `DUCKDNS_DOMAIN` → `BASE_DOMAIN`. **No env var is required by Loskai** — this supersedes
  the earlier "`DUCKDNS_TOKEN` is the only required env var" note
- Flagged for verification: Caddy cert-expiry may not be reachable via the Admin API
  (CertStatus at risk); `registry_pull` recipes still need registry-credential handling

## 2026-06-23 — Project planning and architecture

Defined the full scope and architecture of Loskai in a planning session.
The core purpose is two-fold: a single UI for assigning clean HTTPS names to any
LAN service (Docker container, NAS, Proxmox, etc.) via Caddy + AdGuard, and a
personal install wizard for spinning up self-hosted services using curated,
opinionated recipes.

- Key files: `PLAN.md`, `TODO.md`
- Tech stack: Python + FastAPI + uv (backend), React + TypeScript + Vite + Tailwind (frontend)
- Four independent modules: Caddy, AdGuard, WireGuard, Docker — each degrades gracefully
- Build order: Caddy → AdGuard → WireGuard → Docker (Docker module is most complex, built last)
- Caddy runs natively on LXC 101 alongside AdGuard — network infrastructure separated from Docker host. Port 2019 firewalled to LXC 103 only
- Caddy mode detection: `CADDY_ADMIN_URL` encodes the mode — hostname = Docker network, IP = LAN. Frontend adjusts upstream input hint accordingly
- Docker module uses directory-based stack discovery (`STACKS_DIR`) — host directory is source of truth
- Install wizard is personal recipes defined in code, not a generic community template store
- AdGuard module trimmed to essentials: health, wildcard rewrite check, rewrite list, link out. Stats/query log/blocklist stay in AdGuard's own UI
- WireGuard module is a minimal status card: reachability ping, link out, static DNS reminder. No auth needed
- Settings system: all service URLs and credentials configurable via UI settings page or optional env vars, persisted to `settings.json` in a mounted volume. `DUCKDNS_TOKEN` is the only required env var
