# Loskai

**Safe passage for your Docker deployments.**

A single Docker container that acts as the control plane for your entire homelab —
four independent modules (Docker, Caddy, AdGuard, WireGuard) behind one web UI. Each
degrades gracefully; nothing depends on another module being healthy.

## Run it (Docker)

```bash
cp .env.example .env        # all values optional — or configure in the UI on first run
docker compose build
docker compose up -d
```

Open `http://<docker-host>:8080`, set the admin password on first run, then use the
Routing tab to assign clean HTTPS names to your services. One image serves the API and
the built UI on **:8080**.

- **Preferred setup** (`docker-compose.yml`): Loskai on the Docker host; Caddy + AdGuard
  run natively on a separate box (LXC 101). Provision that box with
  [`scripts/create-lxc101.sh`](scripts/create-lxc101.sh) (run from the Proxmox shell).
- **All-in-Docker** (`docker-compose.colocated.yml`): Loskai + Caddy + AdGuard as
  containers on one host — for setups without Proxmox. Set `CADDY_HOST_IP` to the host's
  LAN IP. Mind the port notes at the top of that file (AdGuard `:53` vs `systemd-resolved`).

The Docker socket is mounted read-write (root-equivalent) — Loskai should be the only
container with it. `STACKS_DIR` is bind-mounted at the **same path** in and out.

## Develop

Backend (Python + FastAPI + [uv], in `backend/`):

```bash
cd backend
uv run uvicorn loskai.main:app --reload --port 8000   # dev API on :8000
uv run pytest                                          # tests
```

Frontend (React + TS + Vite, in `frontend/`):

```bash
cd frontend
npm install
npm run dev     # Vite on :5173, proxies /api/* -> :8000
npm test        # Vitest
npm run build   # -> dist/ (served by the backend in production)
```

Dev is two servers (`:8000` API + `:5173` UI); production is one process on `:8080`.

[uv]: https://docs.astral.sh/uv/

## Documentation

- [Migrating an existing project into a Loskai stack](docs/migration.md) — how (and when) to adopt an existing Docker Compose project into the Stack Manager.
- [Caddy Admin API endpoints Loskai uses](docs/caddy-api.md) — the exact subset of the Caddy API the routing module calls, and why.
- [AdGuard Home REST API endpoints Loskai uses](docs/adguard-api.md) — the DNS-rewrite subset of the AdGuard API the DNS module calls, and why.
- [Install-wizard recipe schema](docs/recipe-schema.md) — the `recipe.yml` manifest format the Docker module validates, the recipe folder layout, and the raw-stack alternative.