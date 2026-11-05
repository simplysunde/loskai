[Docs](../README.md) › [Reference](../README.md#reference)

# Loskai Internal API

**Read this when** you are adding or changing an endpoint, or calling Loskai's API yourself.

The API the React frontend consumes. All paths are under `/api`. A live, interactive
version is always available at **`/docs`** (Swagger UI) and **`/openapi.json`** when the
app is running — this document is the human-readable overview.

## Conventions

- **Auth.** Every `/api/*` endpoint requires a valid session cookie **except** the ones
  marked _public_ below (the dashboard, the login flow, and the root-certificate
  download). The gate is server-side middleware — see [architecture.md → Security and access].
  Unauthenticated calls get `401`.
- **Origin.** A request that changes something — any method but `GET`, `HEAD`, `OPTIONS` —
  is refused with `403` when it carries an `Origin` other than the address it was sent to —
  `Host`, or `X-Forwarded-Host` behind a proxy that rewrites `Host` — public routes included. A browser always sends one; a script that sends none passes, and
  still needs the cookie.
- **Session.** `POST /api/login` (or first-run `POST /api/auth/setup`) sets a signed
  `HttpOnly` cookie, also `Secure` when the request came over HTTPS (Caddy's
  `X-Forwarded-Proto: https`). The frontend redirects to `/login` on any `401`.
- **Who may call what.** An admin account may call everything. An operator may call the
  routes of the tabs it was given (Docker, Routing, Machines) and the few every account
  needs (`GET /api/health`, `GET /api/settings` — secrets left out unless admin —
  `GET /api/launcher`, `POST /api/auth/password`); anything else is `403` with why, in
  words ("Your account doesn't have the Routing tab", "Only an admin can do that").
  `shared/access.py` holds one line per route, and a route with none is admin-only. Routes
  are Routing's — a route made from the install wizard or a machine's row needs that tab
  too — and a record changed is its own tab's, however it was found (by id, or by the
  container or `origin` `POST /api/routes` names), its icon included: a machine Machines', a
  route Routing's.
  The terminal WebSockets need the Docker or Machines tab, and close `1008` without it.
- **Errors.** Failures return `{"detail": "<message>"}` with a conventional status:
  `400` bad input, `401` no session, `403` another page's request or an account that may not, `404` not found, `409` conflict, `422` validation,
  `500` a store file exists but doesn't parse (the message names the path — see
  [Deployment → data volume](../guides/deployment.md)), `502` an upstream
  (Caddy/AdGuard/Docker) is unreachable.
- **Degradation.** A module being unreachable never fails an unrelated call; read
  endpoints return `null`/`unknown` fields rather than erroring.

---

## Public (no auth)

| Method & path | Purpose |
|---|---|
| `GET /api/launcher` | The same cards **including private ones**, each with a `private` flag — for a desktop launcher that builds shortcuts. **Authenticated**, which is the whole difference from `/api/dashboard`: `private` means "not on the public wall", not "secret". A desktop client logs in the way the web UI does (`POST /api/login`, then send the session cookie). Machines are excluded here too. |
| `GET /api/dashboard` | Launcher cards for non-private routed **services**: `{ services: [{ id, name, url, icon }] }`. `id` is stable across a rename, which `name` is not — a desktop launcher keys its shortcuts on it. `icon` is `/api/instances/<id>/icon` when one has been uploaded, else `null`. Exposes nothing else. **Machines are excluded** (`kind: "machine"`) — a machine is an address, and the port its UI lives on is not derivable from the record, so a card for one would link to a dead port. To put a machine's web UI on the dashboard, give it a *route* under a second name (Add route → External → pick the machine, add the port). |
| `GET /api/auth/status` | `{ authed, needs_setup, user }` — whether this browser is signed in, as whom (`{ username, role, tabs }`, or `null`), and whether first-run setup is due (no account yet). |
| `POST /api/login` | Body `{ username, password }` → sets the session cookie, and returns `{ authed, user }`. `401` on a wrong username or password, the same answer for both. A session lasts until it has been idle for `session_idle_minutes` (2 hours unless set); a request more than a minute after its cookie was issued gets a fresh one, so one in use never ends — and an open page is in use: its `GET /api/health` poll, every 30 s, goes on in a background tab. After 5 wrong passwords each one costs a wait — 2 s, doubling to 60 s, for every client at once — during which any attempt gets `429` with `Retry-After`. A right password, or 15 minutes without a wrong one, clears the count. One password is checked at a time: a login sent while another is being checked gets `429` with `Retry-After: 1`. |
| `POST /api/logout` | Clears the session cookie and, sent with a valid one, **ends that user's sessions on every device** — their generation moves on, so a copied cookie dies too; no one else's. Without one it only clears the cookie, so no one can sign a user out. |
| `POST /api/auth/setup` | First run only: body `{ username, password }` creates the admin account and signs in as it. `409` once any account exists, `422` for a username that isn't lowercase letters, digits and `_ . -` starting with a letter, or a password under 8 characters. |
| `POST /api/auth/password` | Body `{ current, new }`: change your own password. `403` when `current` is wrong (with the login backoff), `422` when `new` is too short. Your other sessions end; this one gets a fresh cookie. |
| `GET /api/caddy/root-certificate` | Caddy's internal root CA: `{ pem, common_name, filename }`. Public because the device that needs it has no admin password and can't yet trust the HTTPS route — see the Caddy section below. |


## Users — `/api/users` (admin only)

The accounts (`shared/users.py`, `data/users.json`, owner-only). An account is
`{ username, role, tabs, created }` — `role` `admin` or `operator`, `tabs` the ones an operator
was given (an admin's lists them all); its password hash never leaves the server.

| Method & path | Purpose |
|---|---|
| `GET /api/users` | Every account. |
| `POST /api/users` | Body `{ username, password, role, tabs }`. `422` for a username that isn't lowercase letters, digits and `_ . -` starting with a letter, a password under 8 characters, an unknown role or tab, or an operator with no tab; `409` when the name is taken. |
| `PATCH /api/users/{username}` | Body `{ role?, tabs?, password? }`. A new role or tabs applies on that user's next request (taking Machines away ends their unlock of the key); a new password ends their sessions and their unlock — your own session goes on, with a fresh cookie. The password is checked first: `422` changes nothing. `409` when it would leave Loskai without an admin. |
| `DELETE /api/users/{username}` | Removes the account, and with it its sessions. `409` for the last admin. |

---

## Core (auth required)

### Health & settings

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Aggregate per-module status: `{ caddy, adguard, wireguard, docker }`, each `{ status, … }`. `docker` also carries `stacks_dir_ok`. Also `consistency: [{ id, domain, kind, machine, detail }]` — cross-module DNS drift (routed but no rewrite, or a manual same-domain conflict); `[]` when clean or AdGuard is unreachable. `machine` is true for an instance of `kind: "machine"`, so the sidebar turns the Machines dot amber for a machine's and the Routing dot for a service's. Polled every 30s. |
| `GET /api/settings` | All configurable values, each `{ value, source: "env"\|"stored"\|"unset", secret }`. Never returns the admin password hash. |
| `PUT /api/settings` | Body of `{ key: value }` — persists stored settings (partial updates allowed). Env-sourced and unknown keys are ignored. `422` on an invalid value (`caddy_host_ip` must be a bare IP). Returns the refreshed view. |
| `GET /api/export` | Backup snapshot: `{ schema_version, generated_at, base_domain, instances, adguard_rewrites, warning }`. AdGuard rewrites are best-effort — `null` + a `warning` when AdGuard is unreachable. |

### Instances

| Method & path | Purpose |
|---|---|
| `PATCH /api/instances/{id}` | Body `{ private?, name? }` — update display fields. Subdomain/upstream change through the assign flow, never here. |
| `GET /api/instances/{id}/icon` | The launcher icon. **Public** — the Dashboard is unauthenticated, so a card renders its icon before anyone logs in. `404` when none is set. Served under the content type sniffed at upload. |
| `POST /api/instances/{id}/icon` | Set the launcher icon. The image is the **raw request body**, not a multipart form (the bytes are sniffed either way, so a form part would only carry a filename and type that are ignored — and would add a `python-multipart` dependency). PNG, JPEG or WebP, **detected by magic bytes**, max 512 KB. **SVG is refused**: these are served from Loskai's own origin, and an SVG is a script container. `413` if oversized, `422` if unsupported. One icon per instance — uploading replaces any previous one, including a different format. |
| `DELETE /api/instances/{id}/icon` | Remove it; the card falls back to its generic glyph. |
| `DELETE /api/instances/{id}` | Fully delete an instance: removes its route + rewrite (if any), then the record. Deleting a **machine** changes no route — those on its address keep it and go on working; a set-up one also has Loskai's two lines taken out of its `authorized_keys` with the main key, once its route is gone and before the record goes: `423` (nothing changed) while the key is locked, and a machine that can't be reached is deleted anyway, the reply's `warning` saying its lines are still there (`null` otherwise). Works for **any** type — deleting a docker instance leaves the container untouched (it becomes an unrouted container, re-routable via Add route). |

### Creation (two verbs over one cross-module action)

`POST /api/machines` names a LAN address; `POST /api/routes` publishes a service through
Caddy. Separate request models, because the shapes differ — a machine has no port, no TLS and
may carry a dotted hostname; a route has all three, and is on a machine when its upstream host
is that machine's address — nothing is sent or stored to say so. Both converge on one
`assign()` internally, so the rollback, AdGuard's exact-pair cleanup and moving a machine's
routes exist once. `instance_id` on either edits that instance rather than creating one.

| Method & path | Purpose |
|---|---|
| `POST /api/machines` | Name a LAN machine. Body `{ hostname, address, instance_id?, ssh? }`. `hostname` is its name too (the record's `name` follows it), and may be dotted (`rack1.vm3`) — no wildcard cert has to cover it — and `address` is a bare IPv4, since DNS resolves names to addresses, not ports. Writes **only** the AdGuard rewrite, answering that address; pushes no Caddy route. It tears down one left by a previous `POST /api/routes` on the same instance — **required** in that case, since a surviving route would keep Caddy answering a name this instance no longer proxies, so it aborts with `502` if Caddy is unreachable. Otherwise Caddy is never contacted: naming a machine works with Caddy down or unconfigured. Returns `{ caddy: "skipped", adguard, url (no scheme), instance_id, moved, warning }`. `422` on a bad hostname or an address carrying a port; `409` when another machine has that address, or when a rename's new name already has its own SSH config entry beside the machine's (which to keep is left to you — nothing is saved). Re-pointing a machine (`instance_id`) at a new address rewrites the upstream host of every route on the old one and re-pushes those routes — `moved` lists them — except a route with `follow_container`, whose address is its container's. `ssh` is the machine's SSH config entry: `{ user, port }` sets it (`Host <hostname>`, `HostName <address>`), `null` removes the connection, and left out the entry only follows a rename or a move; a file that can't be written is a `warning`, not a failure. Removing the connection of a set-up machine first takes Loskai's sudo rule and its `authorized_keys` lines off the machine, as deleting it does — **`423`** while the key is locked, nothing changed; a machine that can't be reached loses its connection anyway, with a `warning` — then forgets its host key. |
| `POST /api/routes` | Publish a service through Caddy. Body `{ prefix, upstream, instance_id?, name?, container?, origin?, upstream_tls?, scheme?, follow_container? }`. Validates a **single-label** prefix (every name must sit under the one `*.BASE_DOMAIN` cert) and a `host:port` upstream, pushes the Caddy route (**required** — aborts and rolls back on failure), then writes the AdGuard rewrite (**best-effort**, answer = the shared Caddy IP). Returns `{ caddy, adguard, url, instance_id, moved, warning }` (`moved` is always empty for a route). `container` → targets that container's existing instance (idempotent) or a new linked `docker` instance — a new one for a recipe's container gets the recipe's `icon.png`, as the install would have — the stack is the folder compose ran it from (its `working_dir` label), which must be in `STACKS_DIR`, and only the recipe's primary container gets it, never a database beside it (best-effort: a failed lookup never fails the route; an existing record keeps its icon, or none); `origin` → the same idempotent link for a built-in network service (AdGuard/WireGuard/Caddy) as an `external` instance; otherwise a plain `external`. `upstream_tls: true` → dial the backend over HTTPS with cert verification off (e.g. Proxmox). `scheme` (default `"https"`) → `"https"` serves it on `:443` only; `"http"` on `:80` only, and the name is kept **out** of the `:443` server so Caddy never issues a certificate for it; `"both"` pushes a route into each, which is **two Caddy routes for one instance** (`<id>` and `<id>-http`) — `synced` then requires both, and teardown removes both. `502` if a scheme needing `:80` is used against a Caddy with no `:80` server. The returned `url` follows the scheme. `follow_container: true` → the route **follows its container**: the server derives the upstream from the live container (the same derivation as `GET /api/docker/containers`' `suggested_upstream`) and **ignores** any `upstream` sent, then rewrites and re-pushes it whenever the container starts on a different port. The container comes from `container`, or from the record when editing by `instance_id`. `400` for a non-container route, and for a port Docker can't name; `503` when Docker can't be asked — the one case where creating a route depends on the Docker socket, since a following route's address is Docker's answer. |
| `DELETE /api/assign/{instance_id}` | The mirror: clears the subdomain, deletes the Caddy route (required), best-effort removes the rewrite. The instance survives. |

---

## Caddy — `/api/caddy` (read + push only; never assigns)

Module status lives in the aggregate `GET /api/health`, not a per-module route.

| Method & path | Purpose |
|---|---|
| `GET /routes` | **All** instances (routed or not) annotated with `kind` (`"service"`/`"machine"`), `route_mode`, `routed` + `synced` (in Caddy), and their `container`/`origin` links and `follow_container` (so the UI can find a container's or Network service's route, and knows whether its upstream is locked). Route fields are null when unrouted **or** `route_mode: "dns_only"` (no Caddy route exists for those — not "missing"). Display-only comparison — never auto-corrects. |
| `POST /push` | Rebuild every route from the instance list (recovery backstop). Only touches instance `@id`s; skips `dns_only` instances (nothing to push). |
| `GET /root-certificate` | **Public.** Caddy's internal root CA as `{ pem, common_name, filename }`, read live from its Admin API — the download behind the [Certificate page](../guides/certificate-setup.md). `409` when Caddy runs no internal CA (a public-ACME deployment has nothing to install); `502` when Caddy is unreachable or unconfigured. |

External contract: [caddy-api.md](caddy-api.md).

---

## AdGuard — `/api/adguard`

Module status lives in the aggregate `GET /api/health`. Rewrites are written by the
assign flow and reconcile only — there is no endpoint that adds or deletes one rewrite.
The single exception is the explicit reset below, which deletes the whole list.

| Method & path | Purpose |
|---|---|
| `GET /status` | Per-instance DNS status: `{ answer_ip, instances: [{ id, domain, present, conflict }] }` — powers the routing table's DNS column. |
| `POST /reconcile` | Best-effort reconcile (the DNS half of the **Sync** button): ensure/migrate rewrites per instance (answer = the shared Caddy IP for `proxy`, the instance's own IP for `dns_only`), **sweep** orphaned rewrites in the `{base_domain}` namespace whose answer is one Loskai is known to have written (the shared Caddy IP, or any currently-routed instance's own `dns_answer` — reclaims leftovers from a failed offline teardown, `proxy` or `dns_only`), and report conflicts. Returns `{ added, deleted, swept, conflicts, errors }`. `400` if no answer IP **and** a `proxy` instance is routed (an all-`dns_only` LAN needs none), `502` if AdGuard is down. |

| `GET /rewrites` | Every rewrite AdGuard holds, each annotated `managed` — true when its exact `(domain, answer)` pair is one a routed instance would have the reconcile write back, i.e. it survives a clear. Read-only; it backs the clear dialog's preview. `502` if AdGuard is down. |
| `POST /rewrites/clear` | **Destructive, user-initiated reset.** Deletes **every** rewrite AdGuard holds — hand-added entries and entries under a previous `BASE_DOMAIN` included — then runs the reconcile above so Loskai's own are written back. Returns `{ cleared, restored, conflicts, errors }` (`cleared`/`restored` are domain lists). Preconditions are checked **before** the first delete, so a run that could not restore refuses outright rather than emptying DNS: `400` if the base domain is unset, or if a `proxy` instance is routed with no derivable answer IP; `502` if AdGuard is down. Restoring is part of the same call — against an emptied list reconcile adds each routed name exactly once, which is what makes duplicates impossible. |

External contract: [adguard-api.md](adguard-api.md).

---

## WireGuard

No routes of its own — Loskai never writes to WireGuard. Its `{ status, reachable, url,
dns_hint }` payload arrives in the aggregate `GET /api/health` (`dns_hint` is the AdGuard
IP for peer DNS; any HTTP response counts as reachable).

---

## SSH — `/api/ssh`

Loskai's keys, the SSH config saying how each machine is reached, and setting a machine up
(Phase 34). No private key appears in any answer, and a machine's password is used for one
connection and kept nowhere. A machine is reached as its config entry says, and only with
the host key trusted for its **id** (`data/ssh/known_hosts`); a machine with no SSH user is
`409`.

| Method & path | Purpose |
|---|---|
| `GET /api/ssh` | `{ key, hosts, trusted, projects }`. `key` is `null` until one is made, else `{ public_key, fingerprint, lines, from, unlocked_until }` — `fingerprint` is the `SHA256:…` that `ssh-keygen -lf` prints; `lines` is both lines a machine gets, the main key's then the status key's, each starting `from="<Docker host IP>"` when `HOST_IP` is set (`from` is that IP or `null`) (`restrict`, `from=`, a forced read-only `command=`); `unlocked_until` is when the key locks again, or `null`. `hosts` maps each plain `Host` alias to `{ hostname?, user?, port }`; `trusted` maps machine ids with a trusted host key to `true`; `projects` maps every machine's id to its projects folder (`~/projects` unless changed, or `~`). |
| `POST /api/ssh/key` | Body `{ password, replace? }`. Admin only. Makes Loskai's ed25519 key and returns the `key` view. The key file is owner-only (`0600`). The password is checked with the login backoff: wrong → **`403`** (not `401`, which would send the page to `/login`), `429` while waiting. `409` if a key exists and `replace` isn't set. The new key starts unlocked. The status key is not replaced. |
| `POST /api/ssh/unlock` | Body `{ password }` — your own. Unlocks the key **for you** — like `sudo`, each account unlocks for itself — for `ssh_unlock_minutes` (15 unless set: 15, 60, 180, 480 or 1440), and returns the `key` view (its `unlocked_until` is yours); your logging out, a new password or losing the Machines tab locks it. Password errors as for `/key`. `409` with no key, or with a key from before Phase 38, which is encrypted: make a New key and set each machine up again. |
| `POST /api/ssh/machines/{id}/scan` | The machine's host key now: `{ fingerprint, type, state, lines }`, `state` being `new`, `trusted` or `changed`; `lines` are the two `authorized_keys` lines for *this* machine (`null` before there is a key) — the Docker host's `from=` also names the subnets of Loskai's container networks, since its connections to its own host arrive from there. Asks for ed25519 first, so the fingerprint is the one `ssh-keygen -lf` shows on the machine. `502` when it can't be reached. |
| `POST /api/ssh/machines/{id}/trust` | Body `{ fingerprint }`. Trusts the host key the machine answers with, replacing any trusted before — `409` if it isn't the one with that fingerprint. |
| `POST /api/ssh/machines/{id}/install` | Body `{ password }` — the machine's, for its SSH user. Logs in with it once, replaces any lines Loskai added to `~/.ssh/authorized_keys` with `lines`, then answers as `/test`. `409` without a trusted host key, **`423`** while the key is locked (both before the password is used), `502` with what went wrong (`refused the password`, `Can't reach`, a changed host key). |
| `POST /api/ssh/machines/{id}/test` | Logs in with the main key, then reads what runs with the status key: `{ key: true, running }` (`running` as in `/running`). `409`/`423`/`502` as for `/install`. |
| `GET /api/ssh/machines/{id}/facts` | The machine's overview, read with the status key (works while the main key is locked): `{ ok, checked, os, os_id, os_like, kernel, uptime, memory: { total, available }, disks: [{ mount, device, size, used }], updates: { manager, count } \| null, programs, tmux: [{ name, created, attached, windows }], tailscale, tailnet: [{ ip, name, os, online, self, status }], projects: [{ path, folder, name, branch, dirty, claude, ahead, committed, subject }] }` — sizes in bytes, `uptime`, `created`, `claude` and `committed` in seconds (`0`: never); `tailscale` the machine's Tailscale address, or `null`; `tailnet` the devices `tailscale status` lists, this machine first; `ahead` a project's commits not on its upstream (as of its last fetch), `null` without one. Or `{ ok: false, error, checked }`, with `old: true` when its status line is older than this Loskai (install again). Asked at most every 60 s. `409` without a trusted host key or SSH user. The fields and how each is read: [ssh-status.md](ssh-status.md). |
| `GET /api/ssh/tools` | Every tool in the image: `[{ id, name, description, requires, installable, actions: [{ id, label, description, target, ask, confirm, session, automatic, run }], settings: [{ id, label, description, value, read, write }] }]` — `requires` are programs as the overview names them, `installable` those Loskai can install; `run` is the command, or one per package manager; `target` is `null` (the machine) or the kind of row it is on (the Running list's, or a session or project on the tool's card); `ask` is the kind of name it asks for, or `null`; `session` the tmux session it runs in — `null` Loskai's own, a name (`<name>-<target>`), or `false` for none. A tool applies where the machine has every program it requires — nothing is stored. The format: [tool-schema.md](tool-schema.md). |
| `PUT /api/ssh/machines/{id}/projects` | Body `{ folder }` — the machine's projects folder: `~` or one folder in it (`~/code`); `null` or empty for the default, `~/projects`. Stored on its record, kept through edits — set on the Git tool's card; its tools' actions find it as `$PROJECTS`. Returns `{ folder }` as shown. `422` for a folder elsewhere, `404` for a record that isn't a machine. |
| `GET /api/ssh/log` | The SSH log, newest first (`?limit`, default 200, at most 1000) — all of it for an admin, an operator's own entries for them: `{ at, event, machine, from, user, … }` — `user` the account that did it, `event` being `open` (with `target`), `close` (with `seconds`), `refused` (with `error`), `install` (with `ok`, and `error` when it failed), `uninstall` (the same, when a machine is deleted or its SSH connection removed, and `sudo_rule_left` when Loskai's sudo rule stayed), `action` (with `tool`, `action`, `target`, `command`, `tmux` — the session, or `null`), `add-tool` (with `tool`, `programs`, `command`) `sudo-rule` (with `allow`, `command`), or `setting` (with `tool`, `setting`, `value`, `ok`); an action or rule run with sudo's password from the dialog has `sudo_password: true`, never the password. Sessions, not keystrokes — what is typed can be a password at a `sudo` prompt. `from` is the first `X-Forwarded-For` hop, else the socket's peer. |
| `GET /api/ssh/machines/{id}/tools/{tool}/settings` | A tool's settings as the machine has them now: `{ values }`, by setting id, `null` where unset — each setting's `read` from its tool file, in one command over SSH with the main key (so `423` while it is locked). `409` when the tool doesn't apply there (a program missing, no overview), `404` no such tool. |
| `PUT /api/ssh/machines/{id}/tools/{tool}/settings/{setting}` | Body `{ value }` — set one: the setting's `write`, the value only as `$1`, checked first against its kind (`422`). Then all of them are read back: `{ values }`. Logged as `setting`, with the value. `404` no such setting, `502` when the machine refuses, with what it said. |
| `POST /api/ssh/machines/{id}/run` | Body `{ tool, action, target?, install?, sudo?, password? }` — a run the terminal would open, named as its query does. Before an **automatic** one (`automatic: true` in its tool file; adding a tool, and the sudo rule, always are) opens: `{ automatic, needs_password, user?, ticket }` (`user`, the login sudo asks about, when it asks). `needs_password` is false for root, a command without `sudo`, what the sudo rule covers, or a user sudo lets in without one (`sudo -n true` on the machine). Given `password`, sudo checks it (`sudo -S -v`), and `ticket` is what the terminal takes as `&ticket=` — once, for this user and machine, within 60 s; the password is held in memory only, never logged. `422` sudo didn't take it, `409` the user may not use sudo there (or no SSH user, no trusted host key), `423` the key is locked, `502` the machine can't be reached. |
| `WS /api/ssh/machines/{id}/terminal` | A login shell on the machine (`?cols=&rows=` size its pty), with the main key — or a tool's action, given `&tool=&action=` (and `&target=` for a row's action, or the name an `ask` action was given), or adding a tool — installing the programs it lacks — given `&tool=&install=true`, or putting on or taking off the sudo rule that lets System's update run without a password, given `&sudo=allow` or `&sudo=remove` (refused `4409` before the overview names the package manager). The request only names them: the command comes from the tool file and the machine's overview (its package manager, its programs), it runs inside a tmux session when the machine has tmux, and it is refused `4409` (a program missing, nothing to install or it can't be installed, a bad target, no overview yet) or `4404` (no such tool or action) before anything runs. Checks the session and `Origin` itself like the container terminal (`1008`), then closes with **`4000 + status`** and the reason in words when it can't open: `4423` the key is locked, `4409` no trusted host key or SSH user, `4404` no such machine, `4502` the machine refused or can't be reached. The key must be unlocked to *open* it; an open one lasts until it is closed or the session ends — a logout or the Machines tab taken away — and closing it hangs up the pty, so the shell ends too. An automatic run ends by itself when it succeeds, and waits for Enter when it fails. With `&ticket=` from `POST …/run`, the pty opens with echo off and sudo's password is its first line, read by the command and handed to `sudo -S -v`; `4409` when that ticket is gone or someone else's, `4422` for a ticket without an action. Same frames as the container terminal. |
| `GET /api/ssh/running` | What runs on each set-up machine (an SSH user and a trusted host key), by id: `{ ok, checked, containers: [{ name, image, status }], services, hidden, guests: [{ id, name, kind }], denied }`, or `{ ok: false, error, checked }`. `services` are running systemd services outside the base system (`hidden` counts those); `guests` are a Proxmox host's running LXCs and VMs; `denied` names the lists the user may not read (`docker`, `pct`, `qm`). Uses the status key only, so it works while the main key is locked; each machine is asked at most every 30 s. |
| `GET /api/ssh/config` | The config file as plain text, as an attachment. It names no key, so the `ssh` on your own computer uses your own. |

---

## Docker — `/api/docker`

### Containers

| Method & path | Purpose |
|---|---|
| `GET /containers` | Live list: `[{ id, name, image, project, compose_dir, self, status, uptime, ports, subdomain, instance_id, upstream_mode, suggested_upstream, suggested_host }]` — one Docker call, no stats (those are `GET /containers/stats`). `project` is the `com.docker.compose.project` label, or `null` for a container compose didn't start — for a managed stack it is the stack's folder name, which is how the Docker tab nests containers under their stack. `compose_dir` is the folder compose was run from (`com.docker.compose.project.working_dir`, a host path), or `null` — the Docker tab shows it for a project started outside the stacks folder. `self` marks the container Loskai itself runs in — matched by Docker's default hostname, the first 12 digits of the id, so a container given its own `hostname:` is never marked (it is then listed like any other). `subdomain` and `instance_id` are joined from the instance linked by container name — `instance_id` even when unrouted, so a recipe install offers the recipe's name as the route prefix. `upstream_mode` is `docker` when Caddy's container shares a Docker network with this one (so it can be dialled by name) or `lan` otherwise — decided per container, and `lan` whenever Caddy isn't a container this daemon can see. `suggested_upstream` is the pre-fill that follows from it: `<service>:<port>` for `docker`, `<host_ip>:<published_port>` for `lan`, `null` when either half can't be determined. `suggested_host` is the host half alone, known far more often — a host-networked container publishes no ports, but Caddy still dials the Docker host — so the route forms pre-fill `<host>:` and leave only the port. Both honour a `loskai.port` container label, which names the port Docker can't see (host networking) or can't choose (several published) — as the container sees it, resolved to whatever Caddy dials. |
| `GET /containers/stats` | CPU and memory per **running** container, keyed by the list's short `id`: `{ "<id>": { cpu, mem } }`. Apart from the list because it is the slow half — Docker takes ~2s to answer one stats call (it samples CPU twice), so they are fetched in parallel and the whole answer takes about that long however many containers run. The Docker tab renders the list at once and fills these in; nothing else asks for them. |
| `POST /containers/{id}/start` · `/stop` · `/restart` | Lifecycle control. |
| `DELETE /containers/{id}` | Force-remove the container. |
| `GET /orphans` | Docker instances whose linked container was removed: `[{ id, name, container, subdomain }]`. `[]` when the daemon is down (an unreachable socket must not make live instances look orphaned). |
| `DELETE /orphans/{instance_id}` | Clean up one orphan: re-checks the container is really gone (`409` if it still exists), then tears down the route + rewrite and drops the record. |
| `GET /containers/{id}/quick-commands` | Preset terminal commands for the image: `[{ label, command }]`. |
| `GET /containers/{id}/logs` | **SSE** stream of log lines (`?tail=N`). |
| `WS /containers/{id}/exec` | Interactive shell — `bash` where the image has it, else `sh`. **Authenticates itself** — the session and the `Origin` (WS bypasses the HTTP middleware); closes with `1008` on either. An open one re-checks the session every 5 s and closes when it has ended — a logout or the Docker tab taken away. Client sends keystrokes as binary stdin and `{"type":"resize","rows","cols"}` as a text control frame; output arrives as bytes. |

### Stacks

| Method & path | Purpose |
|---|---|
| `GET /stacks` | Discovered stacks: `[{ name, services, status: up\|down\|partial\|unknown, project, data }]`. `project` is the compose project of the containers run from the stack's folder — matched by folder, since compose lowercases the name and drops dots — `null` when there are none or the daemon is down. `data` names what else the folder holds besides `compose.yml` and `.env` — by the recipes' convention, the service's data. Folders end in `/`. |
| `POST /stacks` | Body `{ name, compose, env? }` — the raw create path (write files + `up -d`). A folder left by a Delete that kept its data (no compose file) is taken over; one that still has a compose file is a live stack, refused. A `compose` that won't load as YAML → `400` with its line. |
| `GET /stacks/{name}` | Stack detail incl. `compose` + `env` file contents, and `override` + `override_file` — a `compose.override.yml` beside it, which Compose merges in (the install wizard's folders live there), or `null`. |
| `POST /stacks/{name}/action` | Body `{ action: up\|down\|restart\|pull }`. |
| `GET /stacks/{name}/form` | The stack's files as fields, for the editor's form: `settings` (one per variable — the recipe's questions, the `${VAR}`s `compose.yml` reads, the `.env`'s keys — with `label`, `value` and `default`), `folders` (`{ service, source, target, writable }`, the bind mounts in the override), `app` (per service: `image`, `network`, `ports`, `volumes`, interpolated — read-only), `services`, `recipe` (`{ id, name, icon }` of the recipe it came from, or `null`), `options` (the recipe's, each `{ id, label, help, on }` — `on` read from the override), `override_other` (the override sets something the form doesn't show — an option's own lines don't count) and `override_comments`. `400` when a file doesn't load. |
| `POST /stacks/{name}/form` | The same form, read from unsaved text instead of the files: body `{ env, override }` — the text view switching back to the form. `400` naming the line when the override doesn't load. |
| `PUT /stacks/{name}/form` | Body `{ settings?, folders?, options? }`: `settings` the changed values only (an empty one removes its line, so the default applies), `folders` the whole list, `options` the switches that changed (`{ id: true\|false }`). An unchanged `.env` line stays as written; the override keeps everything but its folders and the lines of the options switched, and goes when nothing is left. A folder row left blank is skipped. Folders get the install's path checks; a bad one → `400`, nothing written. `base: { env, override }` applies the changes to that unsaved text instead of the files, and saves it with them. `preview: true` writes nothing and returns `{ env, override }` as the save would leave them — how Edit as text opens with the form's unsaved changes. Does not re-up. |
| `POST /stacks/{name}/update-from-recipe` | Replace the stack's `compose.yml` with its recipe's current one — checked first with `docker compose config` against the stack's own override and `.env`, then written, then `pull` + `up -d`. The override is never touched; `.env` only gains a line for a question the new version added (its default). `400` when it is already current, the recipe builds from source, a new question has no default, or the files don't load together — and then nothing is written. |
| `PUT /stacks/{name}/file` | Body `{ file: "compose.yml"\|"compose.override.yml"\|".env", content }`. The two YAML names mean the stack's own files, whatever they are called on disk (`docker-compose.yml` included). YAML that won't load → `400` naming the file and line (`compose.override.yml line 4: indented with a tab — YAML needs spaces`), and nothing is written. An empty override is removed. Saving does not re-up — the editor calls `action: up` after. |
| `DELETE /stacks/{name}` | `down` (never `-v`), then remove `compose.yml`, any `compose.override.yml` and `.env` — **the rest of the folder stays** (it is the service's data) unless `?delete_data=true`, which removes the folder. A folder left empty is removed either way. Returns `{ ok, output, kept }`. |

### Recipes & stats

| Method & path | Purpose |
|---|---|
| `GET /recipes` | Merged install recipes: `{ recipes, invalid, shadowed, sources, local_count }`. Every enabled source in priority order, then `data/recipes`; first to define an id wins and the losers are listed in `shadowed`. Each recipe carries `icon: true` when its folder ships an `icon.png`. |
| `GET /recipes/{id}/icon` | The recipe's `icon.png`, for the wizard's thumbnail. Checked as a PNG of at most 512 KB when the recipe was loaded (a recipe whose icon fails is skipped, not served). `404` when the recipe has none. |
| `GET /recipes/updates` | Every stack installed from a recipe — by the `.loskai-recipe.json` its install wrote, or by its name for one from before — with `status`: `current`, `available`, `edited` (the recipe changed, and so did `compose.yml`, by hand), `untracked` (installed before records; differs) or `gone` (no source has it). Each changed one carries `images` (before → after per service), `diff`, `commits` (the recipe folder's commits since the install, git sources only), `new_env`, `updatable` and a `reason` when it isn't. Reads the caches as they are — sync first with `/recipes/refresh`. |
| `POST /recipes/refresh` | Re-sync every enabled source (`git clone --depth 1`, then `fetch --depth 1` + `reset --hard` — the cache follows a rewritten history and holds only the tip), or just one with body `{ url }`. Reports per source — one failure never stops the others. |
| `POST /recipes/{id}/install` | Body `{ answers, mounts, options }` — `options` is a list of the recipe's option ids to switch on, written into `compose.override.yml` (an unknown id → `400`); `mounts` is a list of host folders for a recipe that declares a `mounts` block, written to `compose.override.yml`, each at `target/<its name>`; for any other recipe a non-empty list → `400`, as does a folder failing the path checks, with no name of its own, or landing where another one does. Omitted answer keys take the manifest default; an undeclared key → `400`, and so does a `type: path` answer that is empty, starts with `~`, is a bare name, or contains `:`. Generates a quoted `.env`, runs the type's command, registers a `docker` instance linked to the container the daemon actually created. No container identified (or `up` failed) → no instance, and a `warning`. A folder Delete left with its data is reused (`reused_data: true`); a `git_build` recipe still needs an empty one. The recipe's `icon.png`, if it has one, becomes the instance's icon — only where it has none, so **a reinstall keeps the earlier record** — route, icon, private flag, following — and only re-points `container`. `400` if the recipe's id already names something else: an external route, or a route to another container that is still running. |
| `GET /volumes` | Named volumes, read-only: `[{ name, driver, size, project, anonymous, used_by }]`. From `docker system df`, so `size` is bytes (`null` where Docker hasn't computed it). `used_by` lists the containers — running or stopped — that mount it; empty means nothing does. `project` is the compose label, `anonymous` marks a volume Docker named itself. Bind mounts are folders, not volumes, and never appear. |
| `DELETE /volumes/{name}` | Delete a named volume and its data. Never forced: Docker refuses one any container still mounts, stopped ones included, and that comes back as **`409`** — the list the request was made from may be stale. `404` if it no longer exists. The Volumes tab offers it only on a volume shown as unused. |
| `GET /stats` | Host resource summary (containers, CPUs, memory, disk). |

Recipe manifest format: [recipe-schema.md](recipe-schema.md).

[architecture.md → Security and access]: ../project/architecture.md#security-and-access
