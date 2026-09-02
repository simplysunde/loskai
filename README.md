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

- **With Proxmox — recommended** (`compose.yml`): Loskai on the Docker host; Caddy and
  AdGuard run natively on two separate LXCs (split so rebuilding Caddy never takes LAN DNS
  down). Provision them with [`scripts/create-caddy-lxc.sh`](scripts/create-caddy-lxc.sh) and
  [`scripts/create-adguard-lxc.sh`](scripts/create-adguard-lxc.sh) (run from the Proxmox shell).
- **Without Proxmox — recommended** (*planned*): **split DNS** — AdGuard on any small
  always-on box (a Raspberry Pi is ideal), Caddy and Loskai together in Docker on your main
  host. The DNS box is set up once and left alone; everything else is one compose stack.
- **All-in-Docker** (`compose.colocated.yml`): Loskai + Caddy + AdGuard as containers on one
  host, with no second machine. Supported, but AdGuard's `:53` then fights `systemd-resolved`
  — see the port notes. Set `CADDY_HOST_IP` to the host's LAN IP.

The three supported layouts, and the port trade-offs behind these recommendations, are
compared in [topologies.md](docs/guides/topologies.md).

The Docker socket is mounted read-write (root-equivalent) — Loskai should be the only
container with it. `STACKS_DIR` is bind-mounted at the **same path** in and out. See
[deployment.md](docs/guides/deployment.md) for the full env-var and volume reference.

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

make check-docs         # doc links, anchors and orphans (see docs/README.md)
```

Dev is two servers (`:8000` API + `:5173` UI); production is one process on `:8080`
serving the API and the built bundle together. That bundle is
`cd frontend && npm run build` (→ `dist/`); the image builds it for you.

[uv]: https://docs.astral.sh/uv/

## Documentation

**[Full documentation index →](docs/README.md)** — grouped into guides, reference and
contributing, each page labelled with when to read it.

The four most people need:

- [Install guide](docs/guides/install.md) — start here. Step by step for the recommended
  Proxmox layout: AdGuard + Caddy LXCs, then Loskai in Docker.
- [Topologies](docs/guides/topologies.md) — read *before* installing if you're unsure where
  each piece should run. Compares the three layouts and recommends two.
- [Deploying the container](docs/guides/deployment.md) — env vars, volumes, cold start.
- [Troubleshooting](docs/guides/troubleshooting.md) — 502s, redirect loops, DNS, certs, VPN.

Architecture and direction live at the repo root: [`PLAN.md`](PLAN.md), [`TODO.md`](TODO.md),
[`HISTORY.md`](HISTORY.md).
