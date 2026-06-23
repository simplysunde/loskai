# FlytDokk — History

## 2026-06-23 — Project planning and architecture

Defined the full scope and architecture of FlytDokk in a planning session.
The core purpose is two-fold: a single UI for assigning clean HTTPS names to any
LAN service (Docker container, NAS, Proxmox, etc.) via Caddy + AdGuard, and a
personal install wizard for spinning up self-hosted services using curated,
opinionated recipes.

- Key files: `PLAN.md`, `TODO.md`
- Tech stack decided: Python + FastAPI + uv (backend), React + TypeScript + Vite + Tailwind (frontend)
- Four independent modules: Caddy, AdGuard, WireGuard, Docker — each degrades gracefully
- Build order: Caddy → AdGuard → WireGuard → Docker (Docker module is most complex, Phase 2)
- Docker module uses directory-based stack discovery (`STACKS_DIR`) — host directory is source of truth
- Install wizard is personal recipes defined in code, not a generic community template store
- `CADDY_ADMIN_URL` is configurable — supports co-located and remote deployment via separate compose files
