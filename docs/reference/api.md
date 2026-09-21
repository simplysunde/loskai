# Loskai Internal API

The API the React frontend consumes. All paths are under `/api`. A live, interactive
version is always available at **`/docs`** (Swagger UI) and **`/openapi.json`** when the
app is running — this document is the human-readable overview.

## Conventions

- **Auth.** Every `/api/*` endpoint requires a valid session cookie **except** the ones
  marked _public_ below (the dashboard, the login flow, and the root-certificate
  download). The gate is server-side middleware — see [PLAN.md → Security & Access].
  Unauthenticated calls get `401`.
- **Session.** `POST /api/login` (or first-run `POST /api/auth/setup`) sets a signed
  `HttpOnly` cookie. The frontend redirects to `/login` on any `401`.
- **Errors.** Failures return `{"detail": "<message>"}` with a conventional status:
  `400` bad input, `401` no session, `404` not found, `409` conflict, `422` validation,
  `500` a store file exists but doesn't parse (the message names the path — see
  [Deployment → data volume](../guides/deployment.md)), `502` an upstream
  (Caddy/AdGuard/Docker) is unreachable.
- **Degradation.** A module being unreachable never fails an unrelated call; read
  endpoints return `null`/`unknown` fields rather than erroring.

---

## Public (no auth)

| Method & path | Purpose |
|---|---|
| `GET /api/dashboard` | Launcher cards for non-private routed services: `{ services: [{ name, url, icon }] }`. Exposes nothing else. |
| `GET /api/auth/status` | `{ authed, password_set }` — lets the SPA choose login vs first-run setup. |
| `POST /api/login` | Body `{ password }` → sets the session cookie. `401` on a bad password, `409` if no password is set yet. |
| `POST /api/logout` | Clears the session cookie. |
| `POST /api/auth/setup` | First-run only: body `{ password }` sets the initial admin password. `409` once one exists, `422` if too short. |
| `GET /api/caddy/root-certificate` | Caddy's internal root CA: `{ pem, common_name, filename }`. Public because the device that needs it has no admin password and can't yet trust the HTTPS route — see the Caddy section below. |

---

## Core (auth required)

### Health & settings

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Aggregate per-module status: `{ caddy, adguard, wireguard, docker }`, each `{ status, … }`. `docker` also carries `stacks_dir_ok`. Also `consistency: [{ id, domain, kind, detail }]` — cross-module DNS drift (routed but no rewrite, or a manual same-domain conflict); `[]` when clean or AdGuard is unreachable. Polled every 30s. |
| `GET /api/settings` | All configurable values, each `{ value, source: "env"\|"stored"\|"unset", secret }`. Never returns the admin password hash. |
| `PUT /api/settings` | Body of `{ key: value }` — persists stored settings (partial updates allowed). Env-sourced and unknown keys are ignored. `422` on an invalid value (`caddy_host_ip` must be a bare IP). Returns the refreshed view. |
| `GET /api/export` | Backup snapshot: `{ schema_version, generated_at, base_domain, instances, adguard_rewrites, warning }`. AdGuard rewrites are best-effort — `null` + a `warning` when AdGuard is unreachable. |

### Instances

| Method & path | Purpose |
|---|---|
| `PATCH /api/instances/{id}` | Body `{ private?, name? }` — update display fields. Subdomain/upstream change through the assign flow, never here. |
| `DELETE /api/instances/{id}` | Fully delete an instance: removes its route + rewrite (if any), then the record. Deleting a **machine** unlinks the routes hosted on it rather than refusing — they keep its last address and go on working, and the response lists them in `unlinked`. Works for **any** type — deleting a docker instance leaves the container untouched (it becomes an unrouted container, re-routable via Add route). |

### Creation (two verbs over one cross-module action)

`POST /api/machines` names a LAN address; `POST /api/routes` publishes a service through
Caddy. Separate request models, because the shapes differ — a machine has no port, no TLS and
may carry a dotted hostname; a route has all three and may link to a machine. Both converge on
one `assign()` internally, so the rollback, AdGuard's exact-pair cleanup and the machine
propagation exist once. `instance_id` on either edits that instance rather than creating one.

| Method & path | Purpose |
|---|---|
| `POST /api/machines` | Name a LAN machine. Body `{ hostname, address, name?, instance_id? }`. `hostname` may be dotted (`rack1.vm3`) — no wildcard cert has to cover it — and `address` is a bare IPv4, since DNS resolves names to addresses, not ports. Writes **only** the AdGuard rewrite, answering that address; pushes no Caddy route. It tears down one left by a previous `POST /api/routes` on the same instance — **required** in that case, since a surviving route would keep Caddy answering a name this instance no longer proxies, so it aborts with `502` if Caddy is unreachable. Otherwise Caddy is never contacted: naming a machine works with Caddy down or unconfigured. Returns `{ caddy: "skipped", adguard, url (no scheme), instance_id, relinked, warning }`. `422` on a bad hostname or an address carrying a port. Re-pointing a machine (`instance_id`) rewrites the upstream host of every route linked to it and re-pushes those routes — `relinked` lists them. |
| `POST /api/routes` | Publish a service through Caddy. Body `{ prefix, upstream, instance_id?, name?, container?, origin?, machine?, upstream_tls? }`. Validates a **single-label** prefix (every name must sit under the one `*.BASE_DOMAIN` cert) and a `host:port` upstream, pushes the Caddy route (**required** — aborts and rolls back on failure), then writes the AdGuard rewrite (**best-effort**, answer = the shared Caddy IP). Returns `{ caddy, adguard, url, instance_id, relinked, warning }`. `container` → targets that container's existing instance (idempotent) or a new linked `docker` instance; `origin` → the same idempotent link for a built-in network service (AdGuard/WireGuard/Caddy) as an `external` instance; otherwise a plain `external`. `upstream_tls: true` → dial the backend over HTTPS with cert verification off (e.g. Proxmox). `machine` → link this route's upstream **host** to a machine, so a move propagates: `404` if unknown, `422` if it names a service or the instance itself. |
| `DELETE /api/assign/{instance_id}` | The mirror: clears the subdomain, deletes the Caddy route (required), best-effort removes the rewrite. The instance survives. |

---

## Caddy — `/api/caddy` (read + push only; never assigns)

Module status lives in the aggregate `GET /api/health`, not a per-module route.

| Method & path | Purpose |
|---|---|
| `GET /routes` | **All** instances (routed or not) annotated with `kind` (`"service"`/`"machine"`), `route_mode`, `routed` + `synced` (in Caddy) + `upstream_healthy`, and their `container`/`origin`/`machine` links (so the UI can find a container's or Network service's route). Route fields are null when unrouted **or** `route_mode: "dns_only"` (no Caddy route exists for those — not "missing"). Display-only comparison — never auto-corrects. |
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

## Docker — `/api/docker`

### Containers

| Method & path | Purpose |
|---|---|
| `GET /containers` | Live list: `[{ id, name, image, status, uptime, ports, subdomain, upstream_mode, suggested_upstream, cpu, mem }]`. `subdomain` is joined from the instance. `upstream_mode` is `docker` when Caddy's container shares a Docker network with this one (so it can be dialled by name) or `lan` otherwise — decided per container, and `lan` whenever Caddy isn't a container this daemon can see. `suggested_upstream` is the pre-fill that follows from it: `<service>:<port>` for `docker`, `<host_ip>:<published_port>` for `lan`, `null` when neither can be determined. |
| `POST /containers/{id}/start` · `/stop` · `/restart` | Lifecycle control. |
| `DELETE /containers/{id}` | Force-remove the container. |
| `GET /orphans` | Docker instances whose linked container was removed: `[{ id, name, container, subdomain }]`. `[]` when the daemon is down (an unreachable socket must not make live instances look orphaned). |
| `DELETE /orphans/{instance_id}` | Clean up one orphan: re-checks the container is really gone (`409` if it still exists), then tears down the route + rewrite and drops the record. |
| `GET /containers/{id}/quick-commands` | Preset terminal commands for the image: `[{ label, command }]`. |
| `GET /containers/{id}/logs` | **SSE** stream of log lines (`?tail=N`). |
| `WS /containers/{id}/exec` | Interactive shell. **Authenticates itself** (WS bypasses the HTTP middleware). Client sends keystrokes as binary stdin and `{"type":"resize","rows","cols"}` as a text control frame; output arrives as bytes. |

### Stacks

| Method & path | Purpose |
|---|---|
| `GET /stacks` | Discovered stacks: `[{ name, services, status: up\|down\|partial\|unknown }]`. |
| `POST /stacks` | Body `{ name, compose, env? }` — the raw create path (write files + `up -d`). |
| `GET /stacks/{name}` | Stack detail incl. `compose` + `env` file contents. |
| `POST /stacks/{name}/action` | Body `{ action: up\|down\|restart\|pull }`. |
| `PUT /stacks/{name}/file` | Body `{ file: "compose.yml"\|".env", content }`. |
| `DELETE /stacks/{name}` | `down` then remove the stack directory. |

### Recipes & stats

| Method & path | Purpose |
|---|---|
| `GET /recipes` | Merged install recipes: `{ recipes, invalid, shadowed }` (repo wins; shadowed local flagged). |
| `POST /recipes/refresh` | Re-sync the recipes repo (`git clone`/`pull`). |
| `POST /recipes/{id}/install` | Body `{ answers }` — generate `.env`, run the type's command, register a `docker` instance. |
| `GET /stats` | Host resource summary (containers, CPUs, memory, disk). |

Recipe manifest format: [recipe-schema.md](recipe-schema.md).

[PLAN.md → Security & Access]: ../PLAN.md
