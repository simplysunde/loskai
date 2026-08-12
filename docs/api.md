# Loskai Internal API

The API the React frontend consumes. All paths are under `/api`. A live, interactive
version is always available at **`/docs`** (Swagger UI) and **`/openapi.json`** when the
app is running — this document is the human-readable overview.

## Conventions

- **Auth.** Every `/api/*` endpoint requires a valid session cookie **except** the ones
  marked _public_ below (the dashboard + the login flow). The gate is server-side
  middleware — see [PLAN.md → Security & Access]. Unauthenticated calls get `401`.
- **Session.** `POST /api/login` (or first-run `POST /api/auth/setup`) sets a signed
  `HttpOnly` cookie. The frontend redirects to `/login` on any `401`.
- **Errors.** Failures return `{"detail": "<message>"}` with a conventional status:
  `400` bad input, `401` no session, `404` not found, `409` conflict, `422` validation,
  `502` an upstream (Caddy/AdGuard/Docker) is unreachable.
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
| `GET /api/instances` | The full instance list (the shared spine). |
| `PATCH /api/instances/{id}` | Body `{ private?, name? }` — update display fields. Subdomain/upstream change through the assign flow, never here. |
| `DELETE /api/instances/{id}` | Fully delete an instance: removes its route + rewrite (if any), then the record. Works for **any** type — deleting a docker instance leaves the container untouched (it becomes an unrouted container, re-routable via Add route). |

### Assign (the one cross-module action)

| Method & path | Purpose |
|---|---|
| `POST /api/assign` | Body `{ prefix, upstream, instance_id?, name?, container?, origin?, upstream_tls?, route_mode? }`. `route_mode` (default `"proxy"`): `"proxy"` validates a single-label prefix + `host:port` upstream, pushes the Caddy route (**required**), and writes the AdGuard rewrite (**best-effort**, answer = the shared Caddy IP); `"dns_only"` validates a dot-allowed prefix + bare IPv4 upstream, pushes **no Caddy route** (any stale one from a prior `proxy` assign is torn down), and writes the AdGuard rewrite with the instance's own `upstream` as the answer. Returns `{ caddy: ok\|skipped, adguard: ok\|error\|skipped, url, instance_id, warning }` — `url` has no `https://` scheme for `dns_only`. `container` → targets that container's existing instance (idempotent) or a new linked `docker` instance; `origin` → same idempotent link for a built-in network service (AdGuard/Gateway/Caddy) as an `external` instance; otherwise plain `external`. `upstream_tls: true` → dial the backend over HTTPS with cert verification off (e.g. Proxmox); ignored for `dns_only`. |
| `DELETE /api/assign/{instance_id}` | The mirror: clears the subdomain, deletes the Caddy route (required), best-effort removes the rewrite. The instance survives. |

---

## Caddy — `/api/caddy` (read + push only; never assigns)

| Method & path | Purpose |
|---|---|
| `GET /routes` | **All** instances (routed or not) annotated with `route_mode`, `routed` + `synced` (in Caddy) + `upstream_healthy`, and their `container`/`origin` links (so the UI can find a container's or Network service's route). Route fields are null when unrouted **or** `route_mode: "dns_only"` (no Caddy route exists for those — not "missing"). Display-only comparison — never auto-corrects. |
| `POST /push` | Rebuild every route from the instance list (recovery backstop). Only touches instance `@id`s; skips `dns_only` instances (nothing to push). |
| `GET /health` | `{ status, server?, mode: "docker"\|"lan"\|null }`. |
| `GET /upstreams` | Upstream liveness from Caddy. |

External contract: [caddy-api.md](caddy-api.md).

---

## AdGuard — `/api/adguard`

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ status, running?, version?, answer_ip, url }`. |
| `GET /rewrites` | Raw DNS rewrite list from AdGuard. |
| `POST /rewrites` | Body `{ domain, answer }` — add a rewrite. |
| `DELETE /rewrites` | Body `{ domain, answer }` — delete by **exact pair** (protects hand-added rewrites). |
| `GET /status` | Per-instance DNS status: `{ answer_ip, instances: [{ id, domain, present, conflict }] }` — powers the routing table's DNS column. |
| `POST /reconcile` | Best-effort reconcile (the DNS half of the **Sync** button): ensure/migrate rewrites per instance (answer = the shared Caddy IP for `proxy`, the instance's own IP for `dns_only`), **sweep** orphaned rewrites in the `{base_domain}` namespace whose answer is one Loskai is known to have written (the shared Caddy IP, or any currently-routed instance's own `dns_answer` — reclaims leftovers from a failed offline teardown, `proxy` or `dns_only`), and report conflicts. Returns `{ added, deleted, swept, conflicts, errors }`. `400` if no answer IP **and** a `proxy` instance is routed (an all-`dns_only` LAN needs none), `502` if AdGuard is down. |

External contract: [adguard-api.md](adguard-api.md).

---

## WireGuard — `/api/wireguard`

| Method & path | Purpose |
|---|---|
| `GET /status` | `{ status, reachable, url, dns_hint }`. Any HTTP response counts as reachable; `dns_hint` is the AdGuard IP for peer DNS. |

---

## Docker — `/api/docker`

### Containers

| Method & path | Purpose |
|---|---|
| `GET /containers` | Live list: `[{ id, name, image, status, uptime, ports, subdomain, suggested_upstream, cpu, mem }]`. `subdomain` is joined from the instance; `suggested_upstream` is a reachable `<service>:<port>` derived from the socket to pre-fill the assign form. |
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
