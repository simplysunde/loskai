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
| `PUT /api/settings` | Body of `{ key: value }` — persists stored settings. Env-sourced and unknown keys are ignored. Returns the refreshed view. |
| `GET /api/export` | Backup snapshot: `{ schema_version, generated_at, base_domain, instances, adguard_rewrites, warning }`. AdGuard rewrites are best-effort — `null` + a `warning` when AdGuard is unreachable. |

### Instances

| Method & path | Purpose |
|---|---|
| `GET /api/instances` | The full instance list (the shared spine). |
| `PATCH /api/instances/{id}` | Body `{ private?, name? }` — update display fields. Subdomain/upstream change through the assign flow, never here. |
| `DELETE /api/instances/{id}` | Fully delete an instance: removes its route + rewrite (if any), then the record. **External only** — a docker (container-backed) instance returns `409` (remove its route via `DELETE /api/assign/{id}` instead). |

### Assign (the one cross-module action)

| Method & path | Purpose |
|---|---|
| `POST /api/assign` | Body `{ prefix, upstream, instance_id?, name?, container?, upstream_tls? }`. Validates the single-label prefix + `host:port` upstream + uniqueness, sets the subdomain, pushes the Caddy route (**required**), and writes the AdGuard rewrite (**best-effort**). Returns `{ caddy, adguard: ok\|error\|skipped, url, instance_id, warning }`. `container` present → targets that container's existing instance (idempotent — no duplicate) or a new linked `docker` instance; otherwise `external`. `upstream_tls: true` → dial the backend over HTTPS with cert verification off (e.g. Proxmox). |
| `DELETE /api/assign/{instance_id}` | The mirror: clears the subdomain, deletes the Caddy route (required), best-effort removes the rewrite. The instance survives. |

---

## Caddy — `/api/caddy` (read + push only; never assigns)

| Method & path | Purpose |
|---|---|
| `GET /routes` | **All** instances (routed or not) annotated with `routed` + `synced` (in Caddy) + `upstream_healthy`. Route fields are null when unrouted. Display-only comparison — never auto-corrects. |
| `POST /push` | Rebuild every route from the instance list (recovery backstop). Only touches instance `@id`s. |
| `GET /caddyfile` | A complete, runnable Caddyfile rendered from the instance list (`text/plain`). `400` if `base_domain` is unset. |
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
| `POST /reconcile` | Best-effort reconcile (the DNS half of "Push all"): ensure/migrate rewrites, report conflicts. `400` if no answer IP, `502` if AdGuard is down. |

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
