# FlytDokk — History

## 2026-07-10 — Caddy + AdGuard API contracts, wildcard drop, per-instance DNS tracking

Hardened the two integration modules by pinning each to its real API and writing a
`/docs` contract for the exact subset FlytDokk calls. Resolved the `srv0`/nested-Caddyfile
conflict, reworked the AdGuard module around explicit per-instance rewrites (no wildcard),
and made both modules read straight off `instances.json` — `@id` for Caddy, a new
`dns_answer` field for AdGuard — so "what FlytDokk created" lives on the instance itself.

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
  different `type`. Created manually or auto (via a `flytdokk.subdomain` container label)
- **Routes are a projection**: the route table = instances that have a `subdomain`. No
  enable/disable — a route exists or it doesn't. `id` = Caddy `@id` (idempotent push/delete)
- Runtime container state (status/CPU/RAM) is never stored — read live from Docker and
  joined at display time, so the store can't drift from reality
- **Persistence**: Caddy runs `caddy run --resume` (its config survives restarts);
  "Push all to Caddy" rebuilds every route from `instances.json` as the backstop. No
  reconcile/drift loop
- Caddyfile export: rendered from the instance list (download / copy), also the manual backup
- Ownership rule: FlytDokk only manages routes whose `@id` matches an instance — the static
  bootstrap routes (FlytDokk, AdGuard) in the Caddyfile are never touched
- Domain model: one global `BASE_DOMAIN` (e.g. `example.no`) + per-service single-label
  prefix = FQDN. Decoupled from DuckDNS (cert method is an LXC 101 concern); renamed
  `DUCKDNS_DOMAIN` → `BASE_DOMAIN`. **No env var is required by FlytDokk** — this supersedes
  the earlier "`DUCKDNS_TOKEN` is the only required env var" note
- Flagged for verification: Caddy cert-expiry may not be reachable via the Admin API
  (CertStatus at risk); `registry_pull` recipes still need registry-credential handling

## 2026-06-23 — Project planning and architecture

Defined the full scope and architecture of FlytDokk in a planning session.
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
