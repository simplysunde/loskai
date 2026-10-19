# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

All four modules (Docker, Caddy, AdGuard, WireGuard) are built and feature-complete;
`backend/` and `frontend/` are real, working code. Phases 13–27 are closed; **Phase 28 (the
install wizard) has run live and passed** (2026-10-03), git sync included; its last bug (root-owned files on the host) was fixed
2026-10-09 — the app now runs as the owner of `./data`. **Phase 29** (a Docker route
follows its container) is built and verified live, bar a daemon-restart check that needs
root. **Phase 30** (UI polish — a Machines tab, Machine/Address upstreams, Docker by stack +
volumes, the recipe catalog that routes its install) is built and verified live. **Phase 12 is finally complete** (2026-09-27): 12a in Phase 19, 12b as Phase 22, 12c
as `docs/guides/backend-certificates.md`. The two archived live
smokes (Phases 10a and 13) both ran and passed on 2026-09-16. **ACME support was removed
2026-09-27** (Phase 25) — the internal CA is the only TLS mode Loskai's configs ship.
All three checks pass (507 + 223 + docs).

**Loskai has now actually been run** (2026-09-05), which it never had been before: everything
up to that point was unit tests and static validation. Two of the three defects that surfaced
were invisible to 209 passing tests, and **both failed as successes** — an empty `200` where a
proxied response was expected, and a documented migration command that quietly nested state one
directory too deep. When you change route pushing, the Caddyfile, upstream detection or a
compose file, re-run the live rig rather than trusting the suite; the recipe is in
`todo-archive.md` Phase 16's Verification block.

**Check `TODO.md` for the current unchecked items before assuming something is missing** — and
note that a completed phase's write-up describes the repo *as it was then*; only the Now tier
describes today. The authoritative sources are — the first four in **`docs/project/`**
(moved from the repo root 2026-10-10, so an older entry naming a root path means there):

- **`PLAN.md`** — architecture reference (the "why" and the shape of every module).
- **`TODO.md`** — the live phase + backlog. Completed phases **1–17** live in
  `todo-archive.md` beside it (1–13 moved 2026-08-27, 14–17 on 2026-09-09); look there
  for how a finished thing was built. **Phases 18–29 are still written out in `TODO.md`** —
  twelve of them, so it is the longer file now; archive the older ones when it gets unwieldy.
- **`HISTORY.md`** — chronological record of decisions and *why* they were made. Read it
  before reversing anything; several current decisions are walk-backs of earlier ones.
- **`docs/`** — segmented by audience, indexed at **[`docs/README.md`](docs/README.md)**.
  Start there when you don't know which page you need. Its Conventions say which reader's
  question is answered where, and every page opens with a breadcrumb and `Read this when`.
- **`SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`** at the root — for visitors. Add a
  user-facing change to `CHANGELOG.md`; the *why* still goes in `HISTORY.md`.

### Which doc answers which question

- **`docs/reference/`** — contracts. Read the relevant one **before** touching that
  integration; each documents constraints that are not obvious from the code.
  `caddy-api.md` and `adguard-api.md` are the external API subsets Loskai calls;
  `api.md` is Loskai's own API surface — 53 HTTP routes plus the exec WebSocket;
  `recipe-schema.md` is the install-wizard manifest — **copied into the loskai-recipes repo**
  (at its root) so a session authoring recipes has it; edit it here only, then run
  `bash scripts/sync-recipe-schema.sh`. The docs check fails while the copy differs.
- **`docs/guides/`** — how Loskai is run. `topologies.md` is the single source of truth for
  deployment layout (A split-LXC · B split DNS · C all-in-Docker; **A and B recommended, C the
  supported alternative** — all three ship. **The letters were reassigned 2026-09-04**, split
  DNS B↔C all-in-Docker, so a letter in an older `HISTORY.md`/`TODO.md` entry is the pre-swap
  one. A merged single-container layout is recorded there as considered-and-rejected — don't
  re-propose it; the all-in-one *LXC* variant was deleted the same day, as it was never a real
  option). `deployment.md` is the env-var/volume reference, `install.md` the walkthrough,
  `certificate-setup.md` the internal-CA onboarding (**two** paths: Loskai's public
  `/certificate` page, and Caddy's own `:80` site), `backend-certificates.md` the mirror image
  — Caddy as an ACME server so a backend (Proxmox `:8006`) serves a cert devices already
  trust, with **no Loskai involvement at all**, `migration.md` stack adoption *and*
  relocating Loskai itself, `troubleshooting.md` symptom-indexed triage.
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
- Docs check: `bash scripts/check-docs.sh` (or `make check-docs`) — **six checks:** broken
  links; dead heading anchors; pages under `docs/` unreachable from `docs/README.md`;
  `docs/` paths cited from source and config that no longer resolve; `docs/` paths written
  out in the current-state docs (prose, backticks, or a link's *display text* — check 1
  validates where a link points, never what it claims to); **this file's enumerations
  against the code** (module names, admin tabs, HTTP route count, public routes); and the
  recipes repo's copy of `recipe-schema.md`, when `../loskai-recipes` is checked out.
- Recipe check: `uv run python -m loskai.modules.docker.check_recipes <path>` (in `backend/`)
  — the wizard's own validator over a recipe folder or a whole recipes repo.
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
Services and machines are one store read by two tabs: **Routing** lists services, and
**Machines** lists each machine with the routes hosted on it beneath (Phase 30 — before it,
one table with views).
A third link, **`machine`**, is not an idempotency key but a dependency: it names the instance
that owns this upstream's *host* half — and what may be linked to is **declared** by
`kind: "service" | "machine"` on the record (set from the verb that assigned it, back-filled
from the upstream's shape for older records), never re-derived at a call site. Moving that machine rewrites every dependent's upstream
and re-pushes its route in the same assign (`list_by_machine`); deleting it **unlinks** rather
than blocks — the routes keep the address they have and simply stop following it.
**`follow_container` is the container counterpart** (Phase 29): a docker route that follows its
container has its upstream *derived* from the live container (`logic.suggested_upstream` — the
same function the route forms pre-fill from) and rewritten when the container starts on a
different port. The trigger is Docker's event stream, in `shared/follow.py` — **Loskai's only
background task**: it never blocks startup, backs off when the daemon is gone, catches up at
startup and on every reconnect, and writes compare-and-set so a hand edit made meanwhile wins.
Declared, defaulting `False` — a record that predates it keeps its stored upstream exactly.

**`client.py` (I/O) vs pure logic is a hard seam — keep it.** Thin `client.py` wrappers do
only HTTP/socket calls; all decision logic (reconcile, route/Caddyfile builders, answer-IP
derivation) lives in pure functions. This is what makes the logic testable without a network
(unit tests mock nothing, contract tests mock the client). Do not tangle I/O into logic.

**Creation is two endpoints over one cross-module action** (in `shared/assign.py`):
**`POST /api/routes`** publishes a service and **`POST /api/machines`** names a LAN address,
each with its own request model — a machine has no port, no TLS and may be dotted; a route
has all three and may link to a machine. They converge on one `assign()`, which sets the
instance's subdomain, pushes the Caddy route (**required** — aborts+rolls back on failure),
then writes the AdGuard rewrite (**best-effort** — warns, never fails the assign). The Caddy
and AdGuard modules never write on their own; they are read + push only.

**Route creation is consolidated in the "Add route" picker** (frontend `AddRouteModal`) —
the main surface, opened from the Routing tab or from a machine's row on the Machines tab
(preset to that machine), with three sources (Container / Network service / External) that
pre-fill and post to `/api/routes` with `container` / `origin` / neither. One shortcut: the
Routing tab's AdGuard pill routes AdGuard in one click, posting exactly what the Network
source would, so it carries the same `origin`. Naming a machine
is the sibling verb, `/api/machines`, from the Machines tab.
**The upstream is two fields on one row — host and port** — in both route forms (they share
`RouteFields`). The host is **Machine or Address**, a toggle (Phase 30): Machine picks one
of the machines you have named (by declared `kind`) and **links the route to it**; Address is
a combobox (`HostSelect`) — type anything, or pick the Docker host or a picked container's
own host — and **never links**. Switching to Machine never guesses a link from a matching
IP. A linked row shows its address with the machine's full name beneath (never `<machine>:<port>` — a
dotted machine name like `adguard.lxc` would read as a hostname that does not resolve); an
unlinked row whose host is a machine's address is **matched** — Routing names the machine
beneath it and Machines lists it under the machine (a chain icon marks a link, a wand a
match). A match is display only, never a link: it keeps its address when the machine moves,
and simply stops matching. The
**Docker tab displays routed state, and creates a route in exactly one place** — the install
wizard's last step (Phase 30), which posts the same `/api/routes` with `container` (the
idempotency key, so it edits the install's own record) and pre-fills through
`containerPrefill`; anything beyond a prefix is left to the Routing tab. (A routed container
links to its FQDN; the AdGuard pill's link-out opens its route once it has one.) Per-row "Change URL"
on the Routing table edits an existing route (passes `instance_id`); on an *unrouted* row the
same button reads "Assign a URL". **Both forms pre-fill a container through one helper,
`containerPrefill`** — they used to disagree (the row read only the stored record, so a fresh
recipe install opened empty); a third route form must use it too. This is what prevents a
co-located infra container from being double-routed from competing tabs.

**Security is enforced on the API, never the frontend.** Single admin password (no accounts),
hashed, `HttpOnly` session cookie. Middleware gates **every `/api/*` except `GET /api/dashboard`
and the login flow** — `GET /api/auth/status`, `POST /api/login`, `POST /api/logout`,
`POST /api/auth/setup` (you can't authenticate if login itself requires auth) — plus
`GET /api/caddy/root-certificate`, which hands out Caddy's internal **root CA**: public
material every LAN device is meant to install, fetched by devices that have no admin
password and can't yet trust the HTTPS route. That set is `PUBLIC_ROUTES` in `shared/auth.py`, plus one *pattern* in `PUBLIC_PATTERNS`
beside it — **`GET /api/instances/{id}/icon`**, the launcher icons, which cannot be an exact
tuple because the path carries the instance id. A card has to render its icon before anyone
logs in. Uploads are sniffed by magic bytes and SVG is refused, because these are
user-supplied bytes served back from Loskai's own origin.
**One route sits outside the middleware entirely:** the
container-exec WebSocket (`WS /api/docker/containers/{id}/exec`) — WebSockets never traverse the
HTTP middleware, so it checks the session cookie itself and closes with 1008 if it fails. It
opens a root shell; never add a second WS route without repeating that check.
The entire React bundle is served *unauthenticated* — it's just static JS; `RequireAuth` only
decides what renders. **Never gate the static files or SPA routes** — the lock is 100% on the API.
The public Dashboard is a launcher and the public **Certificate** page hands out Caddy's
internal root CA (`certificate_tab` in settings moves its sidebar link, never its access);
the admin tabs (Docker, Routing, Machines, Settings) sit behind login. The frontend merges Caddy + AdGuard into one **Routing** view, but the *backends* stay
independent modules.

**Settings priority: env var > `settings.json` > unset**, each value tagged with its source.
Everything is optional (configurable via UI or env). Loskai stores no third-party secret it
must replay except the AdGuard password; its *own* admin password is stored only as a hash.

## Invariants that are easy to violate

- **`STACKS_DIR` must be bind-mounted at the *same path* in and out** (`${STACKS_DIR}:${STACKS_DIR}`)
  **and** passed into the container env — the compose CLI hands bind paths to the host daemon,
  so the in-container scan path must equal the mount. It is env/compose-only, never UI-editable.
  Since 2026-09-05 it defaults to **`${PWD}/stacks`** (was `/opt/stacks`), so compose must be
  run from the project directory; `deploy.sh` `cd`s there. Loskai's own state is `./data:/data`
  (was `./loskai-settings:/opt/loskai`) — **nothing lives in `/opt` any more**, and both
  directories are tracked with a `.gitkeep` so Docker can't create them root-owned.
- **AdGuard rewrites are deleted by the exact `(domain, answer)` pair, never by domain** — this
  is what protects hand-added rewrites. **One deliberate exception:** `POST
  /api/adguard/rewrites/clear` (Settings › Network) wipes the entire list, foreign entries
  included, then reconciles Loskai's own back in the same call. It is destructive, confirmed
  in a dialog, and never a side effect — every automatic path still leaves foreign rewrites
  alone. There is **no wildcard DNS rewrite**: one explicit
  rewrite per routed instance. (Caddy's wildcard *TLS cert* is a separate, unrelated concern.)
- **Caddy routes are keyed by `@id` = the instance `id`; editing a route is delete-then-add,
  never `PATCH`.** The server name is discovered at startup — never hardcode `srv0`.
  **Both servers are discovered**: the routing one by its `:443` listener and, since 12b, the
  plain-HTTP one by `:80`. An instance's `scheme` (`https` default / `both` / `http`) decides
  which it is pushed into; `both` means **two routes, two ids** (`<id>` and `<id>-http`), so
  sync needs both present and teardown removes both. Routes go in at **index 0 of each** —
  `:80` for the same reason as `:443`, plus its catch-all setup site and Caddy's own
  HTTP→HTTPS redirects, which would otherwise win.
- **The app runs as the owner of `./data`, not root** (`scripts/container-entrypoint.sh`
  drops to it, plus the socket's group). Anything Loskai writes on the host must work owned
  by that user, and anything holding a secret goes through `store.write_private` (`0600`).
  Never `chown` below a stack's own files — `stacks/<name>/data/` is the app's.
- **Loskai never handles the ACME/DNS-challenge token or private-registry credentials** —
  those live with Caddy / the Docker host. Registry `docker login` is a host precondition.
- **Recipes are declarative data, validated but never executed** — synced from any number
  of public git repos (`recipes_repos`: a list of `{url, enabled}` rows, seeded with
  `config.DEFAULT_RECIPES_REPO`, each cached under its own slug) plus the local
  `data/recipes/` dir, which is always scanned last and cannot be disabled. First source to
  define a recipe id wins; the losers are flagged, never dropped. A stored **empty list**
  means "no git sources" and is never re-seeded. **Sources have no env var** — the only
  entry in `STORED_ONLY_KEYS`, so the editor is never read-only; nothing about them is
  needed before the UI is up. The `.env` is generated at install, never committed — and
  **every value in it is double-quoted and escaped** (`resolve_answers` + `render_env`).
  Written verbatim, Compose interpolates `$` and cuts at ` #`, so a password arrives altered
  while `up` still exits 0. Don't "simplify" it back to `KEY=value`. A `type: path` answer
  is checked the same way, for the cases Compose accepts and mounts wrongly: `~` (compose
  runs as root inside Loskai's container, so it means `/root`), a bare name (a named volume,
  not a folder), a `:`. A recipe's `mounts` (folders the user adds) go into a generated
  `compose.override.yml`, long syntax with `create_host_path: false` — never into the
  recipe's own `compose.yml`.
- **An installed recipe's files each have one owner** (Phase 31): `compose.yml` is the
  recipe's — an update replaces it; `.env` is the answers — an update only *adds* a line for
  a new question; `compose.override.yml` is the user's — an update never touches it, and is
  refused unless `docker compose config` loads the new file with it. `.loskai-recipe.json`
  records the install (recipe, source, commit, compose fingerprint) — it is how an update
  tells the recipe moving on from a hand edit. Don't fold user settings into `compose.yml`.
- **An installed recipe's instance links to the container name the daemon created**, read
  back from the compose project label — never the recipe id, which is only the project
  name. No container identified → no instance, and the wizard says so. A reinstall keeps
  the earlier record and only re-points `container`; an id that names something else is
  refused, never overwritten.
- **A stack's Delete keeps its data unless asked** (`delete_data`): only `compose.yml`, an override and
  `.env` go, because recipes keep data beside them (`./data`). Don't turn it back into a
  plain `rmtree`. A kept folder (no compose file) is taken over by the next stack of that
  name (`claim_dir`).

## Module build order

Caddy → AdGuard → WireGuard → Docker (Docker is the most complex, built last). Tiers 1–2
tests are written *alongside* each module (see `todo-archive.md` Phase 8b for the full
test strategy).
