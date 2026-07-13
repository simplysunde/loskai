# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**This repo is planning-stage — there is no code yet.** No `backend/` or `frontend/`
directories exist; Phase 1 in `TODO.md` scaffolds them. The authoritative sources are:

- **`PLAN.md`** — architecture reference (the "why" and the shape of every module).
- **`TODO.md`** — the authoritative build order (phased checklist). Build in phase order.
- **`HISTORY.md`** — chronological record of decisions and *why* they were made. Read it
  before reversing anything; several current decisions are walk-backs of earlier ones.
- **`docs/*.md`** — API contracts. Read the relevant one before touching that integration:
  `caddy-api.md`, `adguard-api.md` (external API subsets Loskai calls), `recipe-schema.md`
  (the install-wizard manifest format), `migration.md`.

## Intended commands (once Phase 1 scaffolds them)

Backend is Python + FastAPI + `uv` (in `backend/`); frontend is React + TS + Vite (in `frontend/`).

- Backend dev server: `uv run uvicorn loskai.main:app --reload --port 8000`
- Frontend dev server: `npm run dev` (Vite on `:5173`, proxies `/api/*` → `:8000`)
- Backend tests: `uv run pytest` — single test: `uv run pytest tests/test_x.py::test_name`
- Frontend tests: `npm test` (Vitest)
- **Production** serves on `:8080` — one FastAPI process serves the API *and* the built
  React bundle as static files (single container, single port). Dev is two servers; prod is one.

## Architecture — the load-bearing ideas

**One image, four independent modules** (Docker, Caddy, AdGuard, WireGuard). Each degrades
gracefully and never blocks another; a module going unreachable greys out only its own card.

**The `instance` is the single domain object.** `instances.json` (a flat file — *there is no
database*, only `settings.json` + `instances.json` in a mounted volume) is the shared spine
every module reads. A Docker container and an external LAN service (NAS, Proxmox, any
`IP:port`) are the same struct with a different `type`. **A route is not stored separately —
it is simply an instance that has a `subdomain`.** Runtime container state (status/CPU/RAM)
is never persisted; it is read live from the Docker socket and joined at display time via
the `container` field, so the store cannot drift from reality.

**`client.py` (I/O) vs pure logic is a hard seam — keep it.** Thin `client.py` wrappers do
only HTTP/socket calls; all decision logic (reconcile, route/Caddyfile builders, answer-IP
derivation) lives in pure functions. This is what makes the logic testable without a network
(unit tests mock nothing, contract tests mock the client). Do not tangle I/O into logic.

**`POST /api/assign` is the only cross-module action** (in `shared/assign.py`): it sets the
instance's subdomain, pushes the Caddy route (**required** — aborts+rolls back on failure),
then writes the AdGuard rewrite (**best-effort** — warns, never fails the assign). The Caddy
and AdGuard modules never write on their own; they are read + push only.

**Security is enforced on the API, never the frontend.** Single admin password (no accounts),
hashed, `HttpOnly` session cookie. Middleware gates **every `/api/*` except `GET /api/dashboard`**.
The entire React bundle is served *unauthenticated* — it's just static JS; `RequireAuth` only
decides what renders. **Never gate the static files or SPA routes** — the lock is 100% on the API.
The public Dashboard is a launcher; the admin tabs (Docker, Routing, VPN, Settings) sit behind
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
tests are written *alongside* each module (see `TODO.md` Phase 8b for the full test strategy).
