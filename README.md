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

### Updating

Pull the latest source and rebuild in one step:

```bash
bash scripts/deploy.sh        # git pull --ff-only && docker compose up -d --build
```

`docker compose up -d` on its own reuses the existing `loskai:latest` image and would
skip your new code — always `--build` after a pull. The script does that for you (and
honours `COMPOSE_FILE=compose.colocated.yml` for the co-located layout).

- **Preferred setup** (`compose.yml`): Loskai on the Docker host; Caddy and AdGuard
  run natively on two separate LXCs (split so rebuilding Caddy never takes LAN DNS down).
  Provision them with [`scripts/create-caddy-lxc.sh`](scripts/create-caddy-lxc.sh) and
  [`scripts/create-adguard-lxc.sh`](scripts/create-adguard-lxc.sh) (run from the Proxmox shell).
- **All-in-Docker** (`compose.colocated.yml`): Loskai + Caddy + AdGuard as
  containers on one host — for setups without Proxmox. Set `CADDY_HOST_IP` to the host's
  LAN IP. Mind the port notes (AdGuard `:53` vs `systemd-resolved`).

The Docker socket is mounted read-write (root-equivalent) — Loskai should be the only
container with it. `STACKS_DIR` is bind-mounted at the **same path** in and out. See
[deployment.md](docs/deployment.md) for the full env-var and volume reference.

## Develop

Backend is Python + FastAPI + [uv] (in `backend/`); frontend is React + TS + Vite (in
`frontend/`). Both are driven from the repo root by the [Makefile](Makefile) — `make help`
lists every target:

```bash
make install-backend    # uv sync
make install-frontend   # npm install

make backend            # dev API on :8000 (uvicorn --reload)
make frontend           # Vite on :5173, proxies /api/* -> :8000

make test-backend       # pytest      (one test: cd backend && uv run pytest tests/test_x.py::test_name)
make test-frontend      # vitest
```

Dev is two servers (`:8000` API + `:5173` UI); production is one process on `:8080`
serving the API and the built bundle together. That bundle is
`cd frontend && npm run build` (→ `dist/`); the image builds it for you.

[uv]: https://docs.astral.sh/uv/

## Documentation

- [Install guide (start here)](docs/install.md) — step-by-step for the preferred layout: AdGuard + Caddy LXCs on Proxmox, then Loskai in Docker.
- [Certificate onboarding](docs/certificate-setup.md) — why LAN devices see an untrusted-cert warning under the internal CA, and the onboarding page that hands out the root.
- [Authoring an LXC provisioning script](docs/lxc-script-authoring.md) — the pattern, safety invariants, and a copy-paste skeleton for adding new `create-<service>-lxc.sh` scripts.
- [Troubleshooting](docs/troubleshooting.md) — 502s, redirect loops, DNS/cert/VPN issues; the split-LXC upstream rule (use a LAN IP:port, not a container name).
- [Deploying the container](docs/deployment.md) — env-var reference, volumes and the same-path/`LOSKAI_DATA_DIR` coupling, the two layouts, and cold start.
- [Running locally against Caddy + AdGuard containers](docs/dev-testing.md) — dev walkthrough.
- [Loskai internal API](docs/api.md) — the endpoints the frontend consumes (a human-readable overview of the live `/docs`).
- [Migrating an existing project into a Loskai stack](docs/migration.md) — how (and when) to adopt an existing Docker Compose project into the Stack Manager.
- [Caddy Admin API endpoints Loskai uses](docs/caddy-api.md) — the exact subset of the Caddy API the routing module calls, and why.
- [AdGuard Home REST API endpoints Loskai uses](docs/adguard-api.md) — the DNS-rewrite subset of the AdGuard API the DNS module calls, and why.
- [Install-wizard recipe schema](docs/recipe-schema.md) — the `recipe.yml` manifest format the Docker module validates, the recipe folder layout, and the raw-stack alternative.