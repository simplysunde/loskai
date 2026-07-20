# Install guide — AdGuard + Caddy LXCs + Docker Loskai

The **preferred layout**: AdGuard Home and Caddy each in their own Proxmox LXC, with Loskai
in Docker driving both over the LAN. Splitting them means rebuilding Caddy never takes LAN
DNS down. You end up with clean `https://service.yourdomain` names, assigned from Loskai's UI.

Do the steps in order — Loskai needs both LXCs reachable, so build them first.

> No Proxmox? Skip to [All-in-Docker](#alternative-all-in-docker) at the bottom.

---

## Before you start

- A **Proxmox** host (the two LXCs) and a **Docker** host (Loskai) — can be the same machine.
- A domain for internal names (e.g. `example.no`). It needn't be public: the default TLS mode
  is Caddy's own internal CA — no registrar or DNS token.
- LAN access to assign each LXC a static IP (DHCP reservation).

---

## Step 1 — AdGuard Home LXC (LAN DNS)

From the **Proxmox shell**. The scripts are self-contained, so piping one into `bash` is all
it takes. Set the repo's raw base URL **once** (reused below), then pipe:

```bash
BASE=http://<your-forge>/sunde/Loskai/raw/branch/main   # swap to the GitHub raw URL once published
curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
```

This creates an unprivileged Debian LXC, installs AdGuard, and prints its DHCP IP. To override
a default, put the env var on the **`bash` side** of the pipe (before `curl` it sets the var
for `curl`, not the script):

```bash
curl -fsSL $BASE/scripts/create-adguard-lxc.sh | CTID=110 CT_BRIDGE=vmbr0 bash
```

Then:

1. **Pin a static IP** — give it a DHCP reservation so its address never changes.
2. **Finish setup** — open `http://<adguard-ip>:3000`, set the admin user/password, enable
   the DNS server on `:53`.
3. **Firewall the API** — allow `:3000` only from the Docker host.
4. **Point your LAN at it** — set your router/DHCP's DNS to the AdGuard IP.

Keep the AdGuard IP, user, and password — Loskai needs all three in Step 3.

---

## Step 2 — Caddy LXC (TLS reverse proxy)

From the **Proxmox shell**, reusing `$BASE`. This script also **fetches** the shared
`caddy/Caddyfile` + onboarding page from the repo (so the LXC and the co-located container
never drift), so pass that base URL as `REPO_RAW_BASE` too:

```bash
curl -fsSL $BASE/scripts/create-caddy-lxc.sh | REPO_RAW_BASE=$BASE bash
```

> `REPO_RAW_BASE` defaults to the GitHub raw URL — **once the repo is public you drop it**
> (`curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash`). You only pass it now because that
> default doesn't exist yet while the repo lives on your forge.

This installs Caddy with **internal-CA TLS** by default (its own CA — no public domain or ACME
token). It carries no routes; Loskai pushes them at runtime.

> **You don't set your domain here.** In internal-CA mode Caddy signs each name on demand and
> never needs the domain — that's a Loskai setting (`BASE_DOMAIN`, Step 3). For public certs
> instead, run with `TLS_MODE=acme BASE_DOMAIN=example.no` + a `caddy-dns` plugin (only that
> mode needs the domain here); see the header of [`create-caddy-lxc.sh`](../scripts/create-caddy-lxc.sh).

Then:

1. **Pin a static IP** — as with AdGuard.
2. **Trust the root cert** — on each device open `http://<caddy-ip>/` and follow the page.
   One-time per device; then every name under your domain is trusted. See
   [certificate-setup.md](certificate-setup.md).
3. **Firewall the admin API** — allow `:2019` only from the Docker host.

Keep the Caddy IP — it becomes `CADDY_ADMIN_URL` next.

---

## Step 3 — Loskai (Docker)

On the **Docker host**:

```bash
git clone http://<your-forge>/sunde/Loskai.git
cd Loskai
cp .env.example .env
```

Edit `.env` with what you set up above (all values are also settable in the UI, but env vars
take priority). **This is where your domain is decided** — `BASE_DOMAIN` lives with Loskai,
which appends service prefixes and pushes the routes to Caddy:

```ini
BASE_DOMAIN=example.no
CADDY_ADMIN_URL=http://<caddy-ip>:2019
ADGUARD_URL=http://<adguard-ip>:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=<the-adguard-password>
STACKS_DIR=/opt/stacks
```

`CADDY_ADMIN_URL` is a LAN IP, so the DNS-rewrite answer IP derives from it — no `CADDY_HOST_IP`
needed here. Full reference: [deployment.md](deployment.md#environment-variables). Then:

```bash
docker compose up -d --build
```

---

## Step 4 — First run

1. Open `http://<docker-host>:8080` and **set the admin password** (unless `LOSKAI_PASSWORD`
   is in `.env`).
2. Check the dashboard — the **Caddy** and **AdGuard** cards should show connected. Greyed out
   = Loskai can't reach that service; re-check its IP and firewall rule.
3. **Cold start:** a brand-new Caddy has no routes, so `loskai.example.no` won't resolve yet —
   that's why you reached the UI by IP. Click **"Push all"** to seed routes and DNS rewrites.
4. **Routing** tab → **Add route** to assign your first `https://service.example.no`.

To update later, `bash scripts/deploy.sh` pulls and rebuilds ([README](../README.md#updating)).

---

## Alternative: all-in-Docker

No Proxmox? Run Loskai, Caddy, and AdGuard as three containers with `compose.colocated.yml`:

- Set `CADDY_HOST_IP` to the host's LAN IP (Caddy's admin URL is a hostname here, so the
  answer IP can't be derived).
- Mind the ports — free `:53` from `systemd-resolved`, keep AdGuard off `80`/`443`.

Full port notes: [deployment.md](deployment.md#layouts). Steps 3–4 are otherwise the same
(`COMPOSE_FILE=compose.colocated.yml bash scripts/deploy.sh` to update).
