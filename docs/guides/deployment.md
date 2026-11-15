[Docs](../README.md) › [Guides](../README.md#guides)

# Running the Loskai container

**Read this when** you are configuring the container: an env var, a volume, who owns its
files, or a cold start.

Loskai ships as a single image: one FastAPI process serves the API **and** the built
React UI on **:8080**. This doc is the reference for deploying it — the environment
variables it reads, the volumes it needs, and the three supported layouts. For a local dev
setup (Loskai on the host via `uv` + Vite, throwaway Caddy/AdGuard containers), see
[dev-testing.md](../contributing/dev-testing.md) instead.

## Quick start

```bash
mkdir loskai && cd loskai && mkdir data stacks   # yours, so Loskai runs as you, not root
curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
docker compose up -d
```

Open `http://<docker-host>:8080`, create the admin account on first run, then use the
Routing tab to assign HTTPS names to your services. A `.env` beside the compose file is
optional — every value can be set in the UI ([`.env.example`](../../.env.example) lists them).

## Images and releases

The compose files run published images: `ghcr.io/simplysunde/loskai`, and for the layouts
that run Caddy in Docker, `ghcr.io/simplysunde/loskai-caddy` (stock Caddy with Loskai's
Caddyfile). Both are built for `amd64` and `arm64`, tagged with the version and `latest`.

- **Update:** `docker compose pull && docker compose up -d`.
- **Pin a version:** `LOSKAI_VERSION=0.1.0` in `.env`; back to `latest` by removing it.
- **Keep your changes** in `compose.override.yml`, which Compose merges into `compose.yml`.
  For another layout, download its file *as* `compose.yml` (`curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml`)
  so the plain commands and the override work the same.
- **`data/` and `stacks/` before the first start.** Loskai runs as the owner of `./data`;
  a folder Docker creates for a missing mount is root's, and Loskai would then run as root.
- **From a checkout** — `main`, or your own changes — `bash scripts/deploy.sh` pulls the
  source and builds the images from it (`compose.build.yml`), tagged like the released ones;
  `docker compose pull` puts the released ones back. `make dev` builds the same way.
- **Releasing** is `make release VERSION=x.y.z` from a clean checkout: it builds both images
  for both platforms, pushes them to `LOSKAI_REGISTRY` (`ghcr.io/simplysunde` unless set —
  your forge's registry works too), and tags the commit `v<version>`. It needs
  `docker login` to the registry, and QEMU for the other platform — the script says how
  when it is missing. Every step: [releasing.md](../contributing/releasing.md).

## Layouts

Three compose files, same image:

- **`compose.yml` — recommended with Proxmox.** Loskai runs on the Docker host; Caddy and
  AdGuard run natively on two separate LXCs (split so rebuilding Caddy never takes LAN DNS
  down), reached over the LAN. Provision them with
  [`scripts/create-caddy-lxc.sh`](../../scripts/create-caddy-lxc.sh) and
  [`scripts/create-adguard-lxc.sh`](../../scripts/create-adguard-lxc.sh) (run from the Proxmox
  shell). `CADDY_ADMIN_URL` is a LAN IP, so the DNS-rewrite answer IP derives from it automatically.
- **`compose.caddy-loskai.yml` — recommended without Proxmox.** Split DNS: Caddy + Loskai as
  containers on the Docker host, AdGuard on its own small always-on box (a Raspberry Pi or
  similar) reached over the LAN. `CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so
  you **must** set `CADDY_HOST_IP` to this host's LAN IP. It declares the shared
  [`loskai-edge` network](topologies.md#routing-a-container-without-publishing-a-port), which
  lets a managed stack be routed without publishing a host port.
- **`compose.colocated.yml` — all-in-Docker.** Loskai + Caddy + AdGuard as containers on
  one host, with no second machine at all. Supported, but see the recommendation below.
  Here `CADDY_ADMIN_URL` is a hostname (`http://caddy:2019`), so you **must** set
  `CADDY_HOST_IP` to the host's LAN IP (where Caddy's published `:443` actually lives for
  LAN clients).

**Two layouts are recommended.** Use `compose.yml` if you run Proxmox; use
`compose.caddy-loskai.yml` otherwise — it is the friendlier setup for most people, since the
DNS box is configured once and everything you iterate on stays in one compose stack.
All-in-Docker remains fully supported and is the right answer when a second box isn't an
option; its costs are stated at the point of choice. The full comparison — which ports each
layout contests, which admin channels it leaves on the LAN, and why — is in
[topologies.md](topologies.md).

### Co-located port notes

Two host-port conflicts to clear before `up -d` in the all-in-Docker layout. For *why* these
are the only two, and which ports each layout contests, see
[topologies.md](topologies.md#the-comparison).

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
| `LOSKAI_PASSWORD` | The first admin account's password, at first run (otherwise the setup page asks); only ever stored hashed. More accounts are made in Settings › Users. |
| `LOSKAI_USERNAME` | That account's username — `admin` unless set. Lowercased; one that still isn't a username (letters, digits, `_ . -`, starting with a letter) stops Loskai starting, with a message saying so. |
| `SESSION_IDLE_MINUTES` | How long a session lasts once no Loskai page is open (an open one keeps it): `30`, `60`, `120` (default), `480`, `1440` or `10080` minutes. Also in Settings › Security. |
| `CADDY_ADMIN_URL` | Caddy Admin API. A LAN IP = external/preferred mode; a hostname (`http://caddy:2019`) = co-located mode. |
| `ADGUARD_URL` | AdGuard Home REST API endpoint. |
| `ADGUARD_USER` | AdGuard basic-auth user. |
| `ADGUARD_PASSWORD` | AdGuard basic-auth password. |
| `WIREGUARD_DASHBOARD_URL` | WireGuard dashboard (wg-easy / wg-dashboard). Optional, no auth. |
| `STACKS_DIR` | Host path for Docker compose stacks. Defaults to `./stacks` beside the compose file. Also drives a bind mount, at the **same path inside the container** — see [Volumes](#volumes). |
| `CERTIFICATE_TAB` | Where the [Certificate page](certificate-setup.md) is linked in the sidebar: `public` (default — everyone, including logged-out visitors), `admin` (only once logged in), `hidden`. Set it to `hidden` when Caddy serves publicly trusted certs and there is nothing to install. Visibility only: the page and its download stay public in every mode. |
| `UI_LOOK` | The look every page wears, the public Dashboard too: `simplysunde` (default — the Simply Sunde brand's palette, fonts and motion) or `legacy` (the original slate and teal). Light or dark stays each browser's. Also in Settings › General. |
| `SSH_UNLOCK_MINUTES` | How long typing your password unlocks Loskai's SSH key for you: `15` (default), `60`, `180`, `480` or `1440` minutes. Logging out locks it sooner. Also in Settings › SSH. |
| `SSH_ASK_PASSWORD` | Whether using Loskai's SSH key asks for your password: `yes` (default) or `no` — then anyone signed in with the Machines tab uses it as it is. `no` suits one person reaching Loskai over HTTPS on a LAN or tailnet, not Loskai reachable from the internet ([SECURITY.md](../../SECURITY.md)). Also in Settings › SSH. |
| `CADDY_HOST_IP` | The IP DNS rewrites resolve to (where Caddy listens on `:443`). Only needed when `CADDY_ADMIN_URL` is a hostname or loopback; otherwise derived from it. **Must be an address other machines can reach** — a loopback (`127.0.0.1`, `::1`) or unspecified (`0.0.0.0`, `::`) value is rejected from the UI and ignored from the environment, since AdGuard hands the answer to every client. |
| `HOST_IP` | This Docker host's LAN IP. Auto-fills a container's route upstream as `<host_ip>:<published-port>` whenever Caddy can't reach that container by name — always in split-LXC, and per container in the other two (see [topologies.md](topologies.md#docker-service-names-are-not-automatically-resolvable)). Optional; the upstream is left blank without it. In split DNS and all-in-Docker this is the same address as `CADDY_HOST_IP`. Also the `from=` that limits Loskai's SSH keys on each machine to this host. |
| `HOST_TAILSCALE_IP` | This Docker host's Tailscale address, when it runs Tailscale. Added to the keys' `from=` beside `HOST_IP`, so the Machines tab reaches machines over Tailscale too — see [Tailscale](tailscale.md#managing-a-machine-on-your-tailnet). Optional; ignored without `HOST_IP`. Also in Settings › General. |

Two things Loskai deliberately **never** takes: any TLS credential (certificates live
with Caddy) and private-registry credentials (`docker login` is a host precondition).

### For Compose (in `.env`, never seen by Loskai)

| Variable | Default | What it is |
|---|---|---|
| `LOSKAI_VERSION` | `latest` | The release the compose file runs — [Images and releases](#images-and-releases). |
| `LOSKAI_REGISTRY` | `ghcr.io/simplysunde` | Where the images come from, and where `make release` pushes them. |

### Internal (set in the compose file, not in `.env`)

These track the image layout and the volume mounts, so they belong next to the mount they
have to agree with rather than in your `.env`. They exist for unusual deployments only;
changing one in isolation will break things (see below).

| Variable | Default | What it is |
|---|---|---|
| `LOSKAI_DATA_DIR` | the repo's `data/` | Path for `settings.json`, `instances.json`, `users.json`, `logins.log`, the session secret, `ssh/` (Loskai's SSH private keys, its SSH config and known_hosts — treat a backup as secret), `recipes/`, `recipes-cache/`, and `icons/` (uploaded launcher images — the only binary state Loskai keeps, so a backup of this volume carries them). The Dockerfile and every compose file set `/data` explicitly to match the state mount, so the default only applies when you run the backend directly. Was `/opt/loskai` before 2026-09-05 — see [the coupling](#state-volume--the-loskai_data_dir-coupling). |
| `LOSKAI_STATIC_DIR` | `static` | Image path where the built React bundle is served from (populated by the Dockerfile `COPY`, not a volume). |

## Volumes

Three mounts on the `loskai` service:

```yaml
- /var/run/docker.sock:/var/run/docker.sock          # host Docker socket (root-equivalent)
- ${STACKS_DIR:-${PWD}/stacks}:${STACKS_DIR:-${PWD}/stacks}   # managed stacks — SAME path in and out
- ./data:/data                                       # Loskai's own state
```

### Docker socket

Root-equivalent on the host. Loskai must be the **only** container with it mounted.

### Who owns the files Loskai writes

The app runs as **whoever owns `./data`**, not as root, so the files it writes on the host
are yours: you can read its state and edit a stack's `compose.yml` over SSH without `sudo`.
Clone the repo as `vm` (uid 1000) and Loskai writes as uid 1000. Nothing to configure. The
container starts as root only for its entrypoint
([`scripts/container-entrypoint.sh`](../../scripts/container-entrypoint.sh)), which looks
that owner up and drops to it, adding the socket's group (`stat -c %g /var/run/docker.sock`
— 988 on one host, 999 on another, which is why it is read, not set).

On the way it hands back what an older, root-run Loskai left: everything in `./data`, and in
each stack the folder, its compose files and `.env`. **Never deeper** — `stacks/<name>/data/`
belongs to the user the app inside runs as (a database's files are often uid 999), and
changing it could stop that app starting. A stack's **Delete with data** still removes those
files: what Loskai's user can't, a throwaway container from Loskai's own image removes as
root.

- A stack's `.env` and Loskai's own state — settings, instances, accounts, logs, the session
  secret, the SSH keys — are written `0600`, readable by their owner only.
- `./data` owned by root (a clone made with `sudo`), or `user:` set on the service: Loskai
  runs as that, exactly as before.
- `STACKS_DIR` set to a folder the same user can't write (`/srv/stacks` owned by root):
  creating a stack fails. `chown` the folder to the owner of `./data`.

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

**The path inside the container therefore mirrors the host's.** With the compose file at
`~/loskai`, stacks live at `~/loskai/stacks` on the host *and* at `~/loskai/stacks` inside
the container. That looks odd and is correct: mounting them at a tidy `/stacks` instead is
exactly what breaks, because a managed stack's `./library:/uploads` would then be handed
to the host daemon as `/stacks/<name>/library` — a path at the host's filesystem root,
which the daemon creates as root while your data goes somewhere you didn't choose.

#### Run compose from the project directory

The default is `${PWD}/stacks`, and `${PWD}` is the **shell's** working directory, not the
compose file's. Compose has no interpolation variable for the project directory, so this
is the only way to express "beside this file".

Run from the project directory and it resolves as intended; `scripts/deploy.sh` `cd`s
there first, so the scripted path is safe. Invoke it from somewhere else —
`docker compose -f ~/loskai/compose.yml up -d` from your home directory, or a systemd unit
with no `WorkingDirectory=` — and stacks point at `<that directory>/stacks` instead. The
Docker tab then shows no **Stacks** rather than an error, because the directory does
exist; Docker created it.

Set `STACKS_DIR` to an absolute path in `.env` to pin it and stop caring where compose is
invoked from. Note this affects **only** `STACKS_DIR`: `./data` is resolved by Compose
against the project directory, so the state volume is correct no matter where you run it
from. The difference is the price of the same-path rule.

### State volume — the `LOSKAI_DATA_DIR` coupling

`./data:/data` persists Loskai's own state. The **right** side (`/data`) is the
in-container path the app reads/writes, and each compose file sets `LOSKAI_DATA_DIR=/data`
in the same service — so the code and the mount agree by declaration, sitting a few lines
apart where a drift between them is visible. (The code's own default is the repo's `data/`,
which is what lets `make backend` run with nothing configured; in the image that default
is never reached — the **Dockerfile** sets `LOSKAI_DATA_DIR=/data` as well, so starting the
image outside these compose files, e.g. `docker run -v ./data:/data`, is correct too.)

The **left** side is tracked in the repo (`data/.gitkeep`) on purpose. Docker creates a
missing bind source as `root:root`, and `data/recipes/` is a directory you are meant to
drop recipes into by hand — so the directory ships already owned by whoever cloned it.

- **To change where data lives on the host**, edit **only the left side**
  (e.g. `/mnt/tank/loskai:/data`). Leave the `LOSKAI_DATA_DIR` line alone. This is the
  normal, supported customization.
- **To change the in-container path**, you must edit *both* the mount's right side **and**
  the `LOSKAI_DATA_DIR` line to the same value. Changing one without the other would make
  the app write to an **unmounted (ephemeral)** directory — state lost on container
  recreate.

Unlike `STACKS_DIR`, this path is never handed to another daemon; it's private to Loskai,
so a normal (differing host/container) bind mount is correct and same-path is unnecessary.

#### Upgrading from `/opt/loskai`

The in-container path was `/opt/loskai` and the host side was `./loskai-settings` before
2026-09-05. Nothing reads the old directory any more, so an install that updates without
moving it comes up as a **fresh install** — first-run setup, no routes — with the old
state still sitting untouched in `loskai-settings/`.

`scripts/deploy.sh` checks for this right after the `git pull` that swaps the compose
file, and stops with the command to run. Migrating by hand, from the project directory:

```bash
mv loskai-settings/* data/ && rmdir loskai-settings && docker compose up -d
```

Move the **contents**, not the directory: `data/` ships in the repo, so it already exists
and `mv loskai-settings data` would nest it at `data/loskai-settings/` where the app still
can't see it. `rmdir` refusing to remove the old directory means something was left behind
(a dotfile) — check before deleting it by hand.

Or keep the old location by changing `LOSKAI_DATA_DIR` to `/opt/loskai` **and** restoring
the `./loskai-settings:/opt/loskai` mount. Both, or neither — the coupling above is the
whole point: the value and the mount's right side have to agree, and nothing checks that
for you. If they drift, Loskai writes to an unmounted path inside the container and that
state is discarded on the next recreate.

## Caddy's saved config

Caddy keeps every route Loskai pushes: it saves its config after each change and starts
from that save (`--resume`) — in the Caddy LXC and the Caddy container alike, where the save
is in the `caddy-config` volume. So a restart, a reboot or a rebuilt image needs nothing
from Loskai.

The flip side: while a save exists, Caddy doesn't read the Caddyfile. A changed Caddyfile
(an update to `caddy/`) takes effect once the save is removed, then **Sync** puts Loskai's
routes back. (A new `BASE_DOMAIN` needs none of this — Caddy isn't given the domain; Sync
pushes the routes under the new one.)

```bash
docker compose exec caddy rm /config/caddy/autosave.json && docker compose restart caddy   # Docker
rm /config/caddy/autosave.json && systemctl restart caddy                                    # Caddy LXC
```

## Cold start

On a brand-new Caddy no routes exist yet, so `loskai.<domain>` won't resolve. Reach
Loskai directly at `http://<docker-host>:8080` and click **Sync** on the Routing tab to seed
the routes and DNS rewrites.
