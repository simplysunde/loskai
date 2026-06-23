# FlytDokk — History

## 2026-06-23 — Project planning and architecture

Defined the full scope and architecture of FlytDokk in a planning session.
The core purpose is two-fold: a single UI for assigning clean HTTPS names to any
LAN service (Docker container, NAS, Proxmox, etc.) via Caddy + AdGuard, and a
personal install wizard for spinning up self-hosted services using curated,
opinionated recipes.

- Key files: `PLAN.md`, `TODO.md`
- Tech stack: Python + FastAPI + uv (backend), React + TypeScript + Vite + Tailwind (frontend)
- Four independent modules: Caddy, AdGuard, WireGuard, Docker — each degrades gracefully
- Build order: Caddy → AdGuard → WireGuard → Docker (Docker module is most complex, Phase 2)
- Caddy runs natively on LXC 101 alongside AdGuard — network infrastructure separated from Docker host. Port 2019 firewalled to LXC 103 only
- Caddy mode detection: `CADDY_ADMIN_URL` encodes the mode — hostname = Docker network, IP = LAN. Frontend adjusts upstream input hint accordingly
- Docker module uses directory-based stack discovery (`STACKS_DIR`) — host directory is source of truth
- Install wizard is personal recipes defined in code, not a generic community template store
- AdGuard module trimmed to essentials: health, wildcard rewrite check, rewrite list, link out. Stats/query log/blocklist stay in AdGuard's own UI
- WireGuard module is a minimal status card: reachability ping, link out, static DNS reminder. No auth needed
- Settings system: all service URLs and credentials configurable via UI settings page or optional env vars, persisted to `settings.json` in a mounted volume. `DUCKDNS_TOKEN` is the only required env var
