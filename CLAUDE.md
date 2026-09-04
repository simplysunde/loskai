# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

All four modules (Docker, Caddy, AdGuard, WireGuard) are built and feature-complete;
`backend/` and `frontend/` are real, working code. Phases 1–14 and 17 are done.

**Phase 16 — ship split DNS, fix upstream detection — is the live one, and all three stages
have landed** (Stage B: `compose.caddy-loskai.yml` + the shared `loskai-edge` network; Stage A:
per-container upstream detection; Stage C: the loopback guard on the DNS answer IP). Note the
phase text predates the 2026-09-04 relettering and calls split DNS *layout C*. All three checks
pass (209 + 38 + docs); **the one thing left is a live smoke only Sunde can run**. Phase 15
(audit cleanup) is
code-complete with one item left that needs real hardware, so it is waiting on Sunde rather
than on code. **Check `TODO.md` for the current unchecked items before assuming something is
missing** — and note that a completed phase's write-up describes the repo *as it was then*;
only the Now/Next tiers describe today. The authoritative sources are:

- **`PLAN.md`** — architecture reference (the "why" and the shape of every module).
- **`TODO.md`** — the live phase + backlog. Completed phases 1–13 moved to
  `todo-archive.md` at the repo root (2026-08-27); look there for how a finished thing was built.
- **`HISTORY.md`** — chronological record of decisions and *why* they were made. Read it
  before reversing anything; several current decisions are walk-backs of earlier ones.
- **`docs/`** — segmented by audience, indexed at **[`docs/README.md`](docs/README.md)**.
  Start there when you don't know which page you need.

### Which doc answers which question

- **`docs/reference/`** — contracts. Read the relevant one **before** touching that
  integration; each documents constraints that are not obvious from the code.
  `caddy-api.md` and `adguard-api.md` are the external API subsets Loskai calls;
  `api.md` is Loskai's own API surface — 36 HTTP routes plus the exec WebSocket;
  `recipe-schema.md` is the install-wizard manifest.
- **`docs/guides/`** — how Loskai is run. `topologies.md` is the single source of truth for
  deployment layout (A split-LXC · B split DNS · C all-in-Docker; **A and B recommended, C the
  supported alternative** — all three ship. **The letters were reassigned 2026-09-04**, split
  DNS B↔C all-in-Docker, so a letter in an older `HISTORY.md`/`TODO.md` entry is the pre-swap
  one. A merged single-container layout is recorded there as considered-and-rejected — don't
  re-propose it; the all-in-one *LXC* variant was deleted the same day, as it was never a real
  option). `deployment.md` is the
  env-var/volume reference, `install.md` the walkthrough, `certificate-setup.md` the
  internal-CA onboarding, `migration.md` stack adoption, `troubleshooting.md`
  symptom-indexed triage.
- **`docs/contributing/`** — `dev-testing.md` (local dev rig), `lxc-script-authoring.md`
  (adding a `create-<service>-lxc.sh`).

Facts about an external API belong in `docs/reference/`; if a guide and a reference page
disagree, the reference page wins. Topology facts belong in `guides/topologies.md` — that
duplication is what Phase 17 removed.

## Commands

Backend is Python + FastAPI + `uv` (in `backend/`); frontend is React + TS + Vite (in `frontend/`).

- Backend dev server: `uv run uvicorn loskai.main:app --reload --port 8000`
- Frontend dev server: `npm run dev` (Vite on `:5173`, proxies `/api/*` → `:8000`)
- Backend tests: `uv run pytest` — single test: `uv run pytest tests/test_x.py::test_name`
- Frontend tests: `npm test` (Vitest)
- Docs check: `bash scripts/check-docs.sh` (or `make check-docs`) — **five checks:** broken
  links; dead heading anchors; pages under `docs/` unreachable from `docs/README.md`;
  `docs/` paths cited from source and config that no longer resolve; `docs/` paths written
  out in the current-state docs (prose, backticks, or a link's *display text* — check 1
  validates where a link points, never what it claims to); and **this file's enumerations
  against the code** (module names, admin tabs, HTTP route count, public routes).
- **Production** serves on `:8080` — one FastAPI process serves the API *and* the built
  React bundle as static files (single container, single port). Dev is two servers; prod is one.

### Before you finish

There is **no CI** — deliberately (Forgejo Actions is in the backlog, `PLAN.md`). Nothing runs
these for you, so run all three before reporting work done, and paste the real output:

```
cd backend && uv run pytest        # or: make test-backend
cd frontend && npm test            # or: make test-frontend
bash scripts/check-docs.sh         # or: make check-docs
```

`check-docs.sh` is the one that is easy to skip and the one that catches the most, because
**documentation drift is this project's recurring failure**, not broken code. On 2026-09-02
an audit found four wrong facts in this very file — a dissolved nav tab, an incomplete list
of public routes, a moved archive path, a stale phase status — each of which had been
silently propagating into new work. Run it after moving/renaming any `.md`, after adding a
route or a nav tab, and after editing the enumerated lists here. When something it checks
changes, fix the doc **in the same commit as the behaviour**, not afterwards.

## Architecture — the load-bearing ideas

**One image, four independent modules** (Docker, Caddy, AdGuard, WireGuard). Each degrades
gracefully and never blocks another; a module going unreachable greys out only its own card.

**The `instance` is the single domain object.** `instances.json` (a flat file — *there is no
database*, only `settings.json` + `instances.json` in a mounted volume) is the shared spine
every module reads. A Docker container and an external LAN service (NAS, Proxmox, any
`IP:port`) are the same struct with a different `type`. **A route is not stored separately —
it is simply an instance that has a `subdomain`.** Runtime container state (status/CPU/RAM)
is never persisted; it is read live from the Docker socket and joined at display time via
the `container` field, so the store cannot drift from reality. Two link fields are the
idempotency keys: `container` (a docker instance ↔ its container) and `origin` (an external
instance ↔ a built-in Network service: `adguard`/`gateway`/`caddy`) — re-routing either edits
its existing instance rather than making a duplicate (`get_by_container`/`get_by_origin`).

**`client.py` (I/O) vs pure logic is a hard seam — keep it.** Thin `client.py` wrappers do
only HTTP/socket calls; all decision logic (reconcile, route/Caddyfile builders, answer-IP
derivation) lives in pure functions. This is what makes the logic testable without a network
(unit tests mock nothing, contract tests mock the client). Do not tangle I/O into logic.

**`POST /api/assign` is the only cross-module action** (in `shared/assign.py`): it sets the
instance's subdomain, pushes the Caddy route (**required** — aborts+rolls back on failure),
then writes the AdGuard rewrite (**best-effort** — warns, never fails the assign). The Caddy
and AdGuard modules never write on their own; they are read + push only.

**Route creation is consolidated in the Routing tab's "Add route" picker** (frontend
`AddRouteModal`) — the single surface, with three sources (Container / Network service /
External) that pre-fill and post to `/api/assign` with `container` / `origin` / neither. The
**Docker tab displays routed state but never creates routes** (a routed container links to
its FQDN; a Settings > Network panel's link-out prefers the HTTPS route). Per-row "Change URL"
on the Routing table edits an existing route (passes `instance_id`). This is what prevents a
co-located infra container from being double-routed from competing tabs.

**Security is enforced on the API, never the frontend.** Single admin password (no accounts),
hashed, `HttpOnly` session cookie. Middleware gates **every `/api/*` except `GET /api/dashboard`
and the login flow** — `GET /api/auth/status`, `POST /api/login`, `POST /api/logout`,
`POST /api/auth/setup` (you can't authenticate if login itself requires auth). That set is
`PUBLIC_ROUTES` in `shared/auth.py`. **One route sits outside the middleware entirely:** the
container-exec WebSocket (`WS /api/docker/containers/{id}/exec`) — WebSockets never traverse the
HTTP middleware, so it checks the session cookie itself and closes with 1008 if it fails. It
opens a root shell; never add a second WS route without repeating that check.
The entire React bundle is served *unauthenticated* — it's just static JS; `RequireAuth` only
decides what renders. **Never gate the static files or SPA routes** — the lock is 100% on the API.
The public Dashboard is a launcher; the admin tabs (Docker, Routing, Settings) sit behind
login. The frontend merges Caddy + AdGuard into one **Routing** view, but the *backends* stay
independent modules.

**Settings priority: env var > `settings.json` > unset**, each value tagged with its source.
Everything is optional (configurable via UI or env). Loskai stores no third-party secret it
must replay except the AdGuard password; its *own* admin password is stored only as a hash.

## Invariants that are easy to violate

- **`STACKS_DIR` must be bind-mounted at the *same path* in and out** (`${STACKS_DIR}:${STACKS_DIR}`)
  **and** passed into the container env — the compose CLI hands bind paths to the host daemon,
  so the in-container scan path must equal the mount. It is env/compose-only, never UI-editable.
- **AdGuard rewrites are deleted by the exact `(domain, answer)` pair, never by domain** — this
  is what protects hand-added rewrites. There is **no wildcard DNS rewrite**: one explicit
  rewrite per routed instance. (Caddy's wildcard *TLS cert* is a separate, unrelated concern.)
- **Caddy routes are keyed by `@id` = the instance `id`; editing a route is delete-then-add,
  never `PATCH`.** The server name is discovered at startup — never hardcode `srv0`.
- **Loskai never handles the ACME/DNS-challenge token or private-registry credentials** —
  those live with Caddy / the Docker host. Registry `docker login` is a host precondition.
- **Recipes are declarative data, validated but never executed** — synced from a public git
  repo (+ a local dev dir); the `.env` is generated at install, never committed.

## Module build order

Caddy → AdGuard → WireGuard → Docker (Docker is the most complex, built last). Tiers 1–2
tests are written *alongside* each module (see `todo-archive.md` Phase 8b for the full
test strategy).
