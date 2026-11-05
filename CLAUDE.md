# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Loskai is

A homelab control panel in one container. It gives any service an HTTPS name in one step —
a Caddy route plus an AdGuard DNS rewrite — manages Docker stacks, and installs apps from
recipe repos. Five modules (Docker, Caddy, AdGuard, WireGuard, SSH) — SSH, which manages the
machines, is being built (Phase 34); the project is preparing its first public release, and
runs day to day on a real homelab.

- **What is being worked on:** `docs/project/TODO.md` — its open items, and the backlog at
  the end. Check it before assuming something is missing; a finished phase's write-up
  there describes the repo *as it was then*.
- **Why anything is the way it is:** `docs/project/HISTORY.md`, newest first. Read it before
  reversing a decision — several current ones are walk-backs of earlier ones.
- **The architecture in depth:** `docs/project/architecture.md` — the three components
  (Routing, Docker, Machines), how each works and why. Finished phases 1–17:
  `docs/project/todo-archive.md`.
- **Everything else:** [`docs/README.md`](docs/README.md) indexes the docs by reader.
  `SECURITY.md`, `CONTRIBUTING.md` and `CHANGELOG.md` at the root are for visitors — a
  user-facing change goes in `CHANGELOG.md`, its *why* in `HISTORY.md`.

## Principles

- **Simple and functional.** Judge a change by what it makes simpler or what it fixes; "it's
  tidier" or "it's symmetrical" is not a reason. Each decision lives in one place — the
  worst bugs here were one decision made twice (two ways to compute an address).
- **Removal is an option.** When a feature is questioned, price deleting it — what goes,
  what is lost, which commits would restore it — beside fixing it. One mode beats a
  half-used second one: ACME support was deleted outright for that reason.
- **Assert the effect, not the response.** This project's worst defects **failed as
  successes**: an empty `200` where a proxied response was expected, a `.env` that
  truncated a password while `up` exited 0, a Save that reported success and dropped a
  folder. Check the bytes, the container, the file — not the status code.
- **UI:** minimal visible text, details in a short `title` tooltip; one layout, reusing the
  existing pattern rather than a variant; never show something that looks like an address
  but isn't (show the real address or the full FQDN); show a status only on the tab that owns it.

## Code map

Backend — Python, FastAPI, `uv` — in `backend/src/loskai/`:

- `main.py` (app, static files), `config.py` (the env layer of settings).
- `modules/<name>/` — `client.py` is I/O only; logic is pure (`service.py`, `logic.py`);
  `router.py` is the HTTP surface. WireGuard is only a reachability probe and a peer DNS hint.
- `modules/docker/` — `stacks.py` (a stack is a folder in `STACKS_DIR`; compose runs),
  `recipes.py` (sources, sync, validation, install, options, the recipe icon),
  `stackform.py` (the editor's form), `updates.py` (Check for updates),
  `check_recipes.py` (the validator as a CLI), `quick_commands.py` (terminal presets).
- `modules/ssh/` — Loskai's keys (`client.py`, owner-only files; the main one usable only
  while its user has unlocked it with their password, `unlock.py` — 15 minutes unless
  Settings › SSH says longer) and its SSH config and known_hosts,
  edited in place (`logic.py`); `connect.py` trusts a machine's host key, installs and tests
  the keys, opens a terminal, logs sessions, and reads what runs there; `machines.py` keeps a machine's entry in step with its
  rename, move and delete. **Tools** (`tool.py`, the files in `tools/`) are what a
  machine's dialog can run — data shipped in the image, like recipes, applying where the
  machine has the programs they require (nothing enabled or stored): an action's command
  comes from its file, never from the request, and a row's target reaches it only as `$1`
  — as does the new value of a tool's **setting**, a value on the machine its card reads and
  writes with the main key (Git's commit name and email) (`docs/reference/tool-schema.md`).
- `shared/` — `instances.py` (the one domain object), `assign.py` (route/machine creation —
  the one place modules coordinate), `follow.py` (the only background task), `auth.py`,
  `settings.py`, `store.py` (atomic JSON I/O, the store lock), `errors.py` (`LoskaiError`: a
  refusal and its HTTP status, decided where it is raised — routers catch nothing to translate),
  `icons.py`, `dashboard.py`, `health.py`, `export.py`.

Frontend — React, TS, Vite, TanStack Query — in `frontend/src/`: `pages/` (one per tab,
`settings/` its sub-pages), `components/{docker,routing,settings,shared}/`, `lib/` (`api.ts`,
hooks, `docs.ts` — the repo's address, for links to the docs).

Root: `compose.yml` (layout A), `compose.caddy-loskai.yml` (B), `compose.colocated.yml`
(C), `compose.dev.yml` (Caddy + AdGuard for a dev Loskai on the host), `compose.live.yml` (on top
of `compose.yml`: the working tree, live-reloading — `make live`), `caddy/` (the
Caddy image and Caddyfile), `scripts/` (`deploy.sh`, `check-docs.sh`,
`sync-recipe-schema.sh`, the LXC scripts, `container-entrypoint.sh`). `data/` and
`stacks/` are a running Loskai's state — tracked only as `.gitkeep`.

**The recipes live in a sibling repo, `../loskai-recipes`**, with its own `CLAUDE.md`. Its
commit messages are user-facing — Check for updates shows them as "What changed".

## Commands

- Backend (in `backend/`): `uv run uvicorn loskai.main:app --reload --port 8000`;
  tests `uv run pytest`, one test `uv run pytest tests/test_x.py::test_name`.
- Frontend (in `frontend/`): `npm run dev` (Vite on `:5173`, proxies `/api/*` → `:8000`);
  tests `npm test`; `npm run build`; lint `npx oxlint src`.
- Docs: `bash scripts/check-docs.sh` (or `make check-docs`).
- Recipes: `uv run python -m loskai.modules.docker.check_recipes <path>` (in `backend/`) —
  the wizard's own validator over a recipe folder or a whole recipes repo.
- A compose file: `docker compose -f <file> config` — renders it without a daemon.
- `make live` swaps the `loskai` container for the working tree, reloading on save, on the
  same `:8080` (`bash scripts/deploy.sh` swaps back).
- Production serves on `:8080`: one FastAPI process serves the API *and* the built React
  bundle. Dev is two servers; prod is one. Deploy is `bash scripts/deploy.sh` on the host
  (always `--build`: a plain `up -d` keeps the old image).

### Before you finish

There is **no CI**, deliberately (Forgejo Actions is in the backlog). Run all of these and
paste the real output:

```
cd backend && uv run pytest
cd frontend && npm test && npm run build && npx oxlint src
bash scripts/check-docs.sh
```

- **`npm run build` is not optional:** `tsc -b` typechecks the test files, which `npm test`
  doesn't, and the Docker image build runs it — a type error in a test fails the image.
- **`check-docs.sh` catches the most**, because **documentation drift is this project's
  recurring failure**, not broken code. Its checks: broken links; dead heading anchors;
  pages unreachable from `docs/README.md`; `docs/` paths cited from source that no longer
  resolve; `docs/` paths written out in the current-state docs; this file's enumerations
  against the code (modules, admin tabs, the HTTP route count, the public routes); and the
  recipes repo's copy of `recipe-schema.md`. When something it checks changes, fix the doc
  **in the same commit as the behaviour**.
- **The suite mocks Caddy, so it can't see a route placed wrong.** After changing route
  pushing, the Caddyfile, upstream detection or a compose file, run it live — the rig is
  in `todo-archive.md`, Phase 16's Verification block.
- **Tests never reach real state.** `tests/conftest.py` points `data_dir`/`stacks_dir` at a
  temp dir and stubs the Docker follower and container labels. A new code path that asks
  the daemon needs the same. A scratch backend outside the tests must be given every env
  var: `config.py` falls back to the repo-root `.env`, which may name real infrastructure,
  and the repo's `data/` is a running Loskai's live state.

## Architecture — the load-bearing ideas

**One image, four independent modules.** Each degrades gracefully and never blocks another;
a module going unreachable greys out only its own card.

**The `instance` is the single domain object.** `instances.json` — a flat file; **there is
no database**, only it and `settings.json` in `data/` — is the spine every module reads. A
Docker container and an external LAN service (NAS, Proxmox, any `IP:port`) are the same
struct with a different `type`. **A route is not stored separately: it is an instance with
a `subdomain`.** Runtime container state (status, CPU, RAM) is never persisted; it is read
live and joined at display time on the `container` field, so the store can't drift.

The links on a record:

- `container` (docker instance ↔ its container) and `origin` (external instance ↔ a
  built-in network service: `adguard`/`gateway`/`caddy`) are **idempotency keys** —
  routing either again edits the existing record (`get_by_container`/`get_by_origin`).
- **A route is on a machine by its address, never by a stored link.** A machine's only
  identity on the network is its IP, so a service whose upstream host is a machine's
  address is on that machine (`instances.on_address`, `machine.ts` `machineAt`) — worked out
  each time, like container state. Which records are machines is **declared** by
  `kind: "service" | "machine"` (set by the verb that created it), never re-derived at a call
  site. Moving a machine rewrites every route on its old address and re-pushes it in the
  same assign — except one following its container; deleting one leaves them as they are.
  Two machines can't share an address (`409`).
- `follow_container` makes a docker route **follow its container**: the upstream is derived
  from the live container (`logic.suggested_upstream`, the same function the route forms
  pre-fill from) and rewritten when it starts on a different port. The trigger is Docker's
  event stream in `shared/follow.py` — it never blocks startup, backs off while the daemon
  is gone, catches up at startup and on every reconnect, and writes compare-and-set so a
  hand edit made meanwhile wins. Defaults to `False`.

Routing lists services; Machines lists each machine with the routes on it beneath — one
store, two tabs.

**`client.py` (I/O) vs pure logic is a hard seam — keep it.** Clients only make the HTTP or
socket call; every decision (reconcile, the route and Caddyfile builders, the answer IP) is a
pure function. Unit tests mock nothing; contract tests mock the client.

**Creation is two endpoints over one action** (`shared/assign.py`): **`POST /api/routes`**
publishes a service, **`POST /api/machines`** names a LAN address (no port, no TLS, may be
dotted). Both run `assign()`: set the subdomain, push the Caddy route (**required** — abort
and roll back on failure), then write the AdGuard rewrite (**best-effort** — warn, never
fail). Anything after the Caddy push is best-effort too, such as a new container route
getting its recipe's icon. The Caddy and AdGuard modules never write on their own.

**Where routes are made in the UI:**

- The **Add route** picker (`AddRouteModal`) is the main surface — from the Routing tab, or a
  machine's row (preset to it). Three sources — Container, Network service, External — post
  `/api/routes` with `container`, `origin` or neither. The Routing tab's AdGuard pill posts
  exactly what the Network source would.
- The upstream is **host and port** (`RouteFields`, shared by both route forms). The host
  (`HostSelect`) takes any address, and lists the Docker host, the picked container's host
  and the named machines — picking one only types its address in. Opened from a machine's
  row, the picker starts on that machine's address.
- **Change URL** on a Routing row edits that route (by `instance_id`); on an unrouted row
  the same button reads **Assign a URL**.
- The **Docker tab creates a route in one place only**: the install wizard's last step.
- Every route form pre-fills a container through **`containerPrefill`** — a new one must
  too. Two forms once disagreed, which is how a container gets routed twice.

**Security is enforced on the API, never the frontend.** Accounts (`shared/users.py`): an
admin does everything; an operator only the tabs it is given. Passwords hashed, an `HttpOnly`
session cookie naming the account, kept while a page is open (its health poll renews it,
even in a background tab) and ended by its idle time after that, or its user's logout. Middleware
gates **every `/api/*`** except the set in `PUBLIC_ROUTES` (`shared/auth.py`), and then asks
`shared/access.py` — one line per route: any account, its tabs, or admin; a route with no
line is admin-only, and a test fails until it has one. A new route gets its line in the
same commit. The public set:

- `GET /api/dashboard` — the public launcher.
- `GET /api/auth/status`, `POST /api/login`, `POST /api/logout`, `POST /api/auth/setup` —
  you can't authenticate if login itself requires it.
- `GET /api/caddy/root-certificate` — Caddy's internal root CA, public material fetched by
  devices that can't yet trust the HTTPS route.
- And one pattern in `PUBLIC_PATTERNS`: `GET /api/instances/{id}/icon`, the launcher icons
  a card renders before anyone logs in. Uploads are sniffed by magic bytes and SVG is
  refused — user bytes served from Loskai's own origin.

**The two terminal WebSockets — a container's (`WS /api/docker/containers/{id}/exec`) and a
machine's (`WS /api/ssh/machines/{id}/terminal`) — sit outside the middleware**: WebSockets
never traverse it, so each checks the cookie and the `Origin` itself (`auth.same_origin`),
closes with 1008, and waits on `auth.session_ended` to close when the session does (a
logout or its tab taken away). Each
opens a shell — the machine's also needs the SSH key unlocked; never add a WS route without
repeating all three. **Every request that changes something is
Origin-checked** (`403`): apps on sibling subdomains are the same *site*, so `SameSite=Lax`
sends them the cookie, and only the `Origin` tells their requests from Loskai's own. The
React bundle is served unauthenticated; **never gate the static files or SPA routes** —
`RequireAuth` only decides what renders. The Dashboard and Certificate pages are public
(`certificate_tab` moves the Certificate link, never its access).
The admin tabs (Docker, Routing, Machines, Settings) sit behind login.
The frontend merges Caddy and AdGuard into one Routing view; the backends stay independent.

**Settings: env var > `settings.json` > unset**, each value tagged with its source, and
everything optional. Loskai stores no third-party secret except the AdGuard password; its
accounts' passwords only as hashes; and its **SSH private key** as an owner-only file
(`0600`, like a key in `~/.ssh`), limited on each machine by `from=` to the Docker host. Never return the key, log it, or put it in an export —
only its public half leaves `modules/ssh/client.py`. An action that uses it asks for the
user's password again (`auth.check_password`, which shares the login backoff), which unlocks
it for that user — 15 minutes, or what Settings › SSH says (`ssh_unlock_minutes`). The one key used without unlocking is the **status key**
(`data/ssh/status_ed25519`), and only because each machine restricts it to the forced
command in `logic.STATUS_COMMAND` — it only reads, and never gets any other use
(`docs/reference/ssh-status.md` is its contract: requests, output, versions). A machine's own password
(Install it for me) is used for one connection and stored nowhere. So is a `sudo` password
for an **automatic** action (`automatic: true` in its tool file): asked for in a dialog,
checked with `sudo -S -v`, held in memory under a one-time ticket for a minute
(`connect.prepare`), and read by the run as its first line, never in a command line or the
log (`tool.visible`). Updates without any password are a sudo rule on the machine
(`logic.SUDO_RULE`, allowing only System's update steps and its own removal), taken off
with the machine or its SSH connection.

## Invariants that are easy to violate

**Deployment and the host**

- **`STACKS_DIR` is bind-mounted at the *same path* in and out** (`${STACKS_DIR}:${STACKS_DIR}`)
  **and** passed in the env: the compose CLI hands bind paths to the host daemon. It is
  env/compose-only, never UI-editable, and defaults to `${PWD}/stacks` — compose must be run
  from the project directory (`deploy.sh` `cd`s there). Loskai's own state is `./data:/data`.
  Both folders are tracked with a `.gitkeep` so Docker can't create them root-owned.
- **The app runs as the owner of `./data`, not root** (`scripts/container-entrypoint.sh`
  drops to it, plus the socket's group). Anything written on the host must work owned by
  that user; anything holding a secret goes through `store.write_private` (`0600`). Never
  `chown` below a stack's own files — `stacks/<name>/data/` is the app's.
- **Loskai never handles an ACME/DNS token or registry credentials** — those live with Caddy
  and the Docker host. The internal CA is the only TLS mode Loskai's configs ship.

**Caddy and AdGuard**

- **Caddy routes are keyed by `@id` = the instance id; editing is delete-then-add, never
  `PATCH`.** Server names are discovered at startup — never hardcode `srv0` — both the
  `:443` one and the `:80` one. A route's `scheme` (`https` default / `both` / `http`)
  decides which it goes into; `both` is **two routes, `<id>` and `<id>-http`**, so sync needs
  both and teardown removes both. Routes go in at **index 0** of each server, ahead of the
  Caddyfile's catch-all sites and Caddy's own HTTP→HTTPS redirects, which would otherwise win.
- **AdGuard rewrites are deleted by the exact `(domain, answer)` pair, never by domain** —
  that protects hand-added ones. The one exception is `POST /api/adguard/rewrites/clear`
  (Settings › Network): destructive, confirmed in a dialog, never a side effect, and it puts
  Loskai's own back in the same call. **No wildcard DNS rewrite** — one per routed instance.
  (Caddy's wildcard TLS cert is unrelated.)

**Stacks and recipes**

- **A stack is a folder in `STACKS_DIR` with a compose file** (`compose.yml`, `compose.yaml`
  or `docker-compose.y(a)ml`). Compose names the project after the folder, lowercased and
  stripped — so read a container's folder from its `working_dir` label, never by turning the
  project name back into a path.
- **Delete keeps a stack's data unless asked** (`delete_data`): only the compose file, the
  override and `.env` go, because recipes keep data beside them. Don't turn it into a plain
  `rmtree`. A folder with data and no compose file is taken over by the next stack or
  install of that name (`claim_dir`) — that is how a reinstall, or someone bringing their
  own data, gets it picked up.
- **Recipes are declarative data, validated but never executed.** Sources: any number of
  public git repos (`recipes_repos`, rows of `{url, enabled}`, seeded with
  `config.DEFAULT_RECIPES_REPO`, each cached under its own slug) plus `data/recipes/`,
  scanned last and always on. The first source to define an id wins; the losers are flagged,
  not dropped. A stored **empty list** means "no git sources" and is never re-seeded. Sources
  have **no env var** — the only entry in `STORED_ONLY_KEYS`. A cache is a **mirror**:
  `clone --depth 1`, then `fetch --depth 1` + `reset --hard FETCH_HEAD`, so a rewritten
  source keeps syncing.
- **Every value in a generated `.env` is double-quoted and escaped** (`resolve_answers` +
  `render_env`). Written as `KEY=value`, Compose interpolates `$` and cuts at ` #`, and a
  password arrives altered while `up` exits 0. Don't simplify it back. A `type: path` answer
  is refused where Compose would mount it wrongly: `~` (compose runs as root in the
  container, so it means `/root`), a bare name (a named volume), a `:`.
- **An installed recipe's files each have one owner:** `compose.yml` is the recipe's (an
  update replaces it); `.env` holds the answers (an update only *adds* a line for a new
  question); `compose.override.yml` is the user's (an update never touches it, and is
  refused unless `docker compose config` loads the new file with it);
  `.loskai-recipe.json` records the install (recipe, source, commit, compose fingerprint) —
  how an update tells the recipe moving on from a hand edit. Don't fold user settings into
  `compose.yml`.
- **A recipe's `mounts` and `options` go in `compose.override.yml`** — mounts in long syntax
  with `create_host_path: false`. An option on adds exactly its lines and off removes
  exactly those; whether it is on is **read from the override, never stored**. An option may
  only add (`devices`, `group_add`, `environment`, `cap_add`, `ports`, and `deploy` for an
  NVIDIA reservation) — a value already set otherwise is refused, not overwritten — and is
  offered only for a service the stack has.
- **An installed recipe's instance links to the container name the daemon created**, read
  back from the compose project label — never the recipe id. No container identified → no
  instance, and the wizard says so. A reinstall keeps the earlier record and only
  re-points `container`; an id naming something else (an external route, a container that
  still exists) is refused, never overwritten.
- **A recipe's icon goes only where there is none** — at install, and on a *new* route
  record for the recipe's primary container. An icon removed or chosen by hand stays.

## Docs

- **`docs/reference/`** holds the contracts — `caddy-api.md`, `adguard-api.md` (the external
  API subsets Loskai calls), `api.md` (Loskai's own: 74 HTTP routes plus the two
  terminal WebSockets) and `recipe-schema.md`. Read the relevant one **before** touching that
  integration. If a guide and a reference page disagree, the reference wins.
- **`recipe-schema.md` is copied to the recipes repo's root.** Edit it here only, then run
  `bash scripts/sync-recipe-schema.sh`; the docs check fails while the copy differs.
- **`docs/guides/topologies.md` is the single source for deployment layouts**: A split-LXC,
  B split DNS, C all-in-Docker — A and B recommended, C supported, all three shipped. A
  merged single-container layout was considered and rejected; don't re-propose it. The
  letters were reassigned on 2026-09-04 (B↔C), so a letter in an older `HISTORY.md` or
  `TODO.md` entry may be the old one.
- **The app links to the docs** through `frontend/src/lib/docs.ts`, which holds the repo's
  forge address — cite a page there by its `docs/…` path so the docs check sees it.
