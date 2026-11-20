[Docs](../README.md) › [Guides](../README.md#guides)

# Running the Loskai container

**Read this when** you are looking after a running Loskai: updating it, a setting in `.env`,
where its files live and who owns them, or Caddy after a change.

Installing it: [install.md](install.md). Choosing a setup:
[topologies.md](topologies.md). Running the code yourself:
[dev-testing.md](../contributing/dev-testing.md).

## Images and releases

Each compose file runs published images: `ghcr.io/simplysunde/loskai`, and where Caddy runs
in Docker, `ghcr.io/simplysunde/loskai-caddy`. Both are built for `amd64` and `arm64`.

- **Update:** in Loskai's folder, `docker compose pull && docker compose up -d`.
- **Stay on one version:** `LOSKAI_VERSION=0.1.0` in `.env`. Remove the line to follow
  `latest` again.
- **Keep your own changes** in `compose.override.yml` beside `compose.yml`: Compose merges
  the two, and an update replaces only `compose.yml`.
- **Another setup's file is still `compose.yml`:** download it under that name, like
  `curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml`,
  so the commands and your override work the same.
- **From a checkout of the code:** `bash scripts/deploy.sh` pulls the latest code, builds
  the images from it and starts them. `docker compose pull` puts the released ones back.

Publishing a release: [releasing.md](../contributing/releasing.md).

## Environment variables

Every setting is optional, and most are also in **Settings**. One set in `.env` wins: it shows
locked in **Settings**, marked **env**. Run `docker compose up -d` after changing `.env`.
[`.env.example`](../../.env.example) lists them all, ready to copy.

| Variable | What it sets | In Settings |
|---|---|---|
| `BASE_DOMAIN` | What your names end in: `jellyfin.home.lan` for `home.lan` | **General** › **Base Domain** |
| `HOST_IP` | The Docker host's LAN address. Fills in a container's address in **Add route**, and is where Loskai's SSH keys work from | **General** › **Docker Host LAN IP** |
| `HOST_TAILSCALE_IP` | The Docker host's Tailscale address, a second one the keys work from: [Tailscale](tailscale.md#managing-a-machine-on-your-tailnet). Needs `HOST_IP` | **General** › **Docker Host Tailscale IP** |
| `UI_LOOK` | `simplysunde` (default) or `legacy`, for every page | **General** › **Look** |
| `CADDY_ADMIN_URL` | Caddy's admin address, like `http://192.168.10.30:2019` | **Network** › Caddy › **Admin URL** |
| `CADDY_HOST_IP` | The address your names point at, where Caddy answers. Needed when `CADDY_ADMIN_URL` isn't an address on your network: the compose files beside Caddy ask for it. Never `127.0.0.1` or `0.0.0.0` | **Network** › Caddy › **LAN IP** |
| `ADGUARD_URL`, `ADGUARD_USER`, `ADGUARD_PASSWORD` | AdGuard's address and login | **Network** › AdGuard |
| `WIREGUARD_DASHBOARD_URL` | Your WireGuard dashboard, for its link | **Network** › WireGuard |
| `CERTIFICATE_TAB` | Who sees the Certificate tab: `public` (default), `admin` or `hidden` | **Network** › **Certificate page in the sidebar** |
| `SSH_ASK_PASSWORD` | `yes` (default) or `no`: whether using Loskai's SSH key asks for your password | **SSH** › **Ask for your password** |
| `SSH_UNLOCK_MINUTES` | How long your password unlocks the key: `15` (default), `60`, `180`, `480` or `1440` | **SSH** › **Keep the key unlocked for** |
| `SESSION_IDLE_MINUTES` | How long you stay signed in once no page is open: `30`, `60`, `120` (default), `480`, `1440` or `10080` | **Security** |
| `LOSKAI_PASSWORD` | Makes the first admin account at first start, in place of the welcome page | **Users**, later |
| `LOSKAI_USERNAME` | That account's name: `admin` unless set | |
| `STACKS_DIR` | Where stacks live: `stacks/` beside the compose file unless set. See [Where stacks live](#where-stacks-live) | shown, not changed |
| `LOSKAI_VERSION` | The release the compose file runs: `latest` unless set | |
| `LOSKAI_REGISTRY` | Where the images come from: `ghcr.io/simplysunde` unless set | |

Loskai never takes a TLS certificate or key, or a registry login: those stay with Caddy and
the Docker host.

## Where Loskai keeps its files

Two folders beside the compose file, and `.env` if you made one:

- **`data/`**: everything Loskai stores, its SSH keys among them. Treat a copy as secret.
- **`stacks/`**: the stacks it manages, a folder each.

To keep `data/` somewhere else, change only the left side of its line in the compose file
(or `compose.override.yml`), like `/mnt/tank/loskai:/data`. Leave `/data` as it is.

### Where stacks live

`stacks/` is mounted at the same path inside Loskai as on the host. Keep it that way: Docker
reads a stack's own folders on the host, at the path Loskai gives it.

**Run `docker compose` from Loskai's folder.** The default `stacks/` is beside the folder you
run it from, so `docker compose -f ~/loskai/compose.yml up -d` run from elsewhere, or a
systemd unit with no `WorkingDirectory=`, looks for stacks in the wrong place: the Docker tab
then shows none. To stop caring, set `STACKS_DIR` in `.env` to an absolute path, like
`STACKS_DIR=/home/you/loskai/stacks`.

### Who owns the files Loskai writes

Loskai runs as **whoever owns `data/`**, not as root, so what it writes on the host is yours:
you can read it, and edit a stack's files over SSH, without `sudo`.

- **Make `data/` and `stacks/` yourself before the first start**, as the install does. A
  folder Docker makes for you is root's, and Loskai then runs as root.
- **Files with secrets** — a stack's `.env`, Loskai's settings, accounts and keys — are
  readable by their owner only.
- **A `STACKS_DIR` its owner can't write**, like `/srv/stacks` owned by root, makes creating a
  stack fail. Give it to the owner of `data/`: `sudo chown you: /srv/stacks`.
- **A stack's own data**, in `stacks/<name>/`, belongs to whatever user the app inside runs
  as, often another one. Loskai leaves it as it is.

The Docker socket gives Loskai control of the host's Docker. Give it to no other container:
[SECURITY.md](../../SECURITY.md).

## Caddy's saved config

Caddy saves its config after every change and starts from that save, so a restart, a reboot
or a new image keeps every route.

While the save exists, Caddy doesn't read its Caddyfile. After changing the Caddyfile, remove
the save and restart Caddy, then click **Sync** on **Routing** to put Loskai's routes back:

```bash
docker compose exec caddy rm /config/caddy/autosave.json && docker compose restart caddy   # Caddy in Docker
rm /config/caddy/autosave.json && systemctl restart caddy                                    # Caddy LXC
```

A new **Base Domain** needs none of this: **Sync** sends the routes under the new one.

## Cold start

A new or reinstalled Caddy has none of your routes, so `loskai.<your domain>` doesn't open.
Open Loskai by its address, `http://<docker-host>:8080`, and click **Sync** on **Routing**.
Every route and DNS name comes back.
