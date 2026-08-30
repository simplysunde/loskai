# Running the Loskai container

Loskai ships as a single image: one FastAPI process serves the API **and** the built
React UI on **:8080**. This doc is the reference for deploying it — the environment
variables it reads, the volumes it needs, and the two supported layouts. For a local dev
setup (Loskai on the host via `uv` + Vite, throwaway Caddy/AdGuard containers), see
[dev-testing.md](../contributing/dev-testing.md) instead.

## Quick start

```bash
cp .env.example .env        # every value is optional — or configure in the UI on first run
docker compose build
docker compose up -d
```

Open `http://<docker-host>:8080`, set the admin password on first run, then use the
Routing tab to assign HTTPS names to your services.

## Layouts

Two compose files, same image:

- **`compose.yml` — recommended with Proxmox.** Loskai runs on the Docker host; Caddy and
  AdGuard run natively on two separate LXCs (split so rebuilding Caddy never takes LAN DNS
  down), reached over the LAN. Provision them with
  [`scripts/create-caddy-lxc.sh`](../../scripts/create-caddy-lxc.sh) and
  [`scripts/create-adguard-lxc.sh`](../../scripts/create-adguard-lxc.sh) (run from the Proxmox
  shell). `CADDY_ADMIN_URL` is a LAN IP, so the DNS-rewrite answer IP derives from it automatically.
- **`compose.colocated.yml` — all-in-Docker.** Loskai + Caddy + AdGuard as containers on
  one host, with no second machine at all. Supported, but see the recommendation below.
  Here `CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so you **must** set
  `CADDY_HOST_IP` to the host's LAN IP (where Caddy's published `:443` actually lives for
  LAN clients).

Two more are planned: **split DNS** (AdGuard on its own small box — a Raspberry Pi or
similar — with Caddy + Loskai together in Docker) and a **single all-in-one container**.

**Only two layouts are recommended.** Use `compose.yml` if you run Proxmox; use split DNS
otherwise — it is the friendlier setup for most people, since the DNS box is configured once
and everything you iterate on stays in one compose stack. All-in-Docker and the all-in-one
container are supported but carry costs that neither recommended layout has. The full
comparison — which ports each layout contests, which admin channels it leaves on the LAN, and
why — is in [topologies.md](topologies.md).

### Co-located port notes

Only host-published ports can conflict; container-to-container traffic stays internal.
See [topologies.md](topologies.md#the-comparison) for the same analysis across every layout.

- **AdGuard `:53` vs the host resolver** — most Linux hosts run `systemd-resolved` on `53`.
  Free it (disable/reconfigure `systemd-resolved`) or bind AdGuard's `53` to a host IP.
- **Keep AdGuard off `80`/`443`** — those belong to Caddy; let Caddy reverse-proxy its UI.

## Environment variables

Priority chain: **env var > `settings.json` (UI) > unset**. Every user-facing value is
optional — Loskai boots with nothing set and can be configured in-app on first run.
Anything set in the environment takes priority and is shown read-only in the UI.

### User-facing (set in `.env` or the UI)

| Variable | Purpose |
|---|---|
| `BASE_DOMAIN` | Your domain; service prefixes are appended (e.g. `grafana.example.no`). |
| `LOSKAI_PASSWORD` | Guards the admin UI. Seeds the hash at first run; only ever stored hashed. |
| `CADDY_ADMIN_URL` | Caddy Admin API. A LAN IP = external/preferred mode; a hostname (`http://caddy:2019`) = co-located mode. |
| `ADGUARD_URL` | AdGuard Home REST API endpoint. |
| `ADGUARD_USER` | AdGuard basic-auth user. |
| `ADGUARD_PASSWORD` | AdGuard basic-auth password. |
| `WIREGUARD_DASHBOARD_URL` | WireGuard dashboard (wg-easy / wg-dashboard). Optional, no auth. |
| `STACKS_DIR` | Host path for Docker compose stacks. Also drives a bind mount — see [Volumes](#volumes). |
| `RECIPES_REPO_URL` | Public git repo the install wizard syncs recipes from. Unset = empty state. |
| `CADDY_HOST_IP` | The IP DNS rewrites resolve to (where Caddy listens on `:443`). Only needed when `CADDY_ADMIN_URL` is a hostname; otherwise derived from it. |
| `HOST_IP` | This Docker host's LAN IP. In split-LXC mode, auto-fills container route upstreams as `<host_ip>:<published-port>` (Caddy can't resolve container names from its own LXC). Optional; the upstream is left blank without it. |

Two things Loskai deliberately **never** takes: the ACME/DNS-challenge token (that lives
with Caddy) and private-registry credentials (`docker login` is a host precondition).

### Internal (baked into the image — don't set these in `.env`)

These have defaults matching the image layout and the volume mounts. They exist for
unusual deployments only; setting them in isolation will break things (see below).

| Variable | Default | What it is |
|---|---|---|
| `LOSKAI_DATA_DIR` | `/opt/loskai` | In-container path for `settings.json`, `instances.json`, and the session secret. Backed by the settings volume. |
| `LOSKAI_STATIC_DIR` | `static` | Image path where the built React bundle is served from (populated by the Dockerfile `COPY`, not a volume). |

## Volumes

Three mounts on the `loskai` service:

```yaml
- /var/run/docker.sock:/var/run/docker.sock          # host Docker socket (root-equivalent)
- ${STACKS_DIR:-/opt/stacks}:${STACKS_DIR:-/opt/stacks}   # managed stacks — SAME path in and out
- ./loskai-settings:/opt/loskai                      # Loskai's own state
```

### Docker socket

Root-equivalent on the host. Loskai must be the **only** container with it mounted.

### `STACKS_DIR` — why the same path on both sides

The host and container paths are deliberately **identical**. Loskai runs
`docker compose` for the stacks it manages, and that CLI hands bind paths to the **host
daemon**, which resolves them against the **host** filesystem. If the scan path inside
Loskai differed from the host path, every relative bind mount in a managed stack would
resolve against the wrong root. Making them equal is what keeps managed stacks' volumes
correct — so `STACKS_DIR` is passed **both** as a mount (readable at that path) and as an
env var (the path the code scans), and the two must always match.

This is also why `STACKS_DIR` is the one path variable that belongs in `.env`/compose
yet must never be edited in the UI — it's structurally tied to the mount.

### Settings volume — the `LOSKAI_DATA_DIR` coupling

`./loskai-settings:/opt/loskai` persists Loskai's own state. The **right** side
(`/opt/loskai`) is the in-container path the app reads/writes, and it equals the
`LOSKAI_DATA_DIR` default — so the code and the mount agree.

- **To change where data lives on the host**, edit **only the left side**
  (e.g. `/mnt/tank/loskai:/opt/loskai`). Leave `LOSKAI_DATA_DIR` unset. This is the
  normal, supported customization.
- **To change the in-container path**, you must edit *both* the mount's right side **and**
  `LOSKAI_DATA_DIR` to the same value. Changing one without the other makes the app write
  to an **unmounted (ephemeral)** directory — state is silently lost on container recreate.

Unlike `STACKS_DIR`, this path is never handed to another daemon; it's private to Loskai,
so a normal (differing host/container) bind mount is correct and same-path is unnecessary.

## Cold start

On a brand-new Caddy no routes exist yet, so `loskai.<domain>` won't resolve. Reach
Loskai directly at `http://<docker-host>:8080` and click **"Push all"** to seed the
routes and DNS rewrites.
