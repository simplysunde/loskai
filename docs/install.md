# Install guide — AdGuard + Caddy LXCs + Docker Loskai

A step-by-step walkthrough of the **preferred layout**: AdGuard Home and Caddy each in
their own Proxmox LXC, with Loskai in Docker on your Docker host driving both over the LAN.
This is the split-services setup — rebuilding Caddy never takes LAN DNS down with it.

> No Proxmox? Use the all-in-Docker layout instead — skip to
> [All-in-Docker](#alternative-all-in-docker) at the bottom. Everything else here assumes LXCs.

**What you'll end up with:** clean `https://service.yourdomain` names for your homelab,
resolved by AdGuard and terminated by Caddy, all assigned from Loskai's web UI.

Do the steps in order — Loskai needs to reach both LXCs, so build them first.

---

## Before you start

- A **Proxmox** host (for the two LXCs) and a **Docker** host (for Loskai). They can be the
  same physical machine; the Docker host just needs Docker + the compose plugin.
- A domain you'll use for internal names (e.g. `example.no`). It does **not** need to be
  public — the default TLS mode is Caddy's own internal CA, no registrar or DNS token needed.
- LAN access to assign static IPs (via DHCP reservation) to the two LXCs.

---

## Step 1 — AdGuard Home LXC (LAN DNS)

From the **Proxmox shell**. The scripts are self-contained (each writes every file it needs
*inside* the container), so piping one into `bash` is all it takes. Set the repo's raw base
URL **once** — reused for every command below — then pipe:

```bash
BASE=http://<your-forge>/sunde/Loskai/raw/branch/main   # swap to the GitHub raw URL once published
curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
```

It creates an unprivileged Debian LXC, installs AdGuard Home, and prints the container's
DHCP IP. To override a default, put the env var on the **`bash` side** of the pipe (before
`curl` it would set the var for `curl`, not the script):

```bash
curl -fsSL $BASE/scripts/create-adguard-lxc.sh | CTID=110 CT_BRIDGE=vmbr0 bash
```

(Or clone the repo on the Proxmox host and run `bash scripts/create-adguard-lxc.sh` if you'd
rather read it first — it's the same script.)

Then:

1. **Pin a static IP** — give the container a DHCP reservation (or set a static lease) so its
   address never changes. Everything below points at it.
2. **Finish first-time setup** — open `http://<adguard-ip>:3000`, set the admin user/password,
   and enable the DNS server on `:53`.
3. **Firewall the API** — allow `:3000` only from the Docker host (where Loskai runs).
4. **Point your LAN at it** — set your router/DHCP's DNS server to the AdGuard IP so devices
   resolve through it. This is what makes your `*.yourdomain` names work network-wide.

Keep the AdGuard IP, user, and password handy — Loskai needs all three in Step 3.

---

## Step 2 — Caddy LXC (TLS reverse proxy)

From the **Proxmox shell**, reusing the same `$BASE` from Step 1. The Caddy script also
**fetches** the shared `caddy/Caddyfile` + onboarding page from the repo (so this LXC and the
co-located container never drift), so it needs to know that base URL too — pass it as
`REPO_RAW_BASE` on the `bash` side:

```bash
curl -fsSL $BASE/scripts/create-caddy-lxc.sh | REPO_RAW_BASE=$BASE bash
```

`REPO_RAW_BASE` defaults to the public GitHub raw URL, so **once the repo is on GitHub you
drop it entirely** — `curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash`. You only pass it
now because the default GitHub URL doesn't exist yet while the repo lives on your forge.

This creates a second LXC, installs Caddy, and boots it with **internal-CA TLS** by default
(Caddy is its own certificate authority — no public domain or ACME token required). It carries
no routes; Loskai pushes every route at runtime.

> **You don't set your domain here.** In internal-CA mode (the default) Caddy signs a cert
> for each name on demand and never needs to know your domain — that's a **Loskai** setting
> (`BASE_DOMAIN`, in Step 3). Only the ACME path below needs Caddy to know the domain.

> Want public certificates instead? Run with `TLS_MODE=acme BASE_DOMAIN=example.no` and a
> `caddy-dns` plugin for your provider — see the header comment in
> [`create-caddy-lxc.sh`](../scripts/create-caddy-lxc.sh). Only in this mode is `BASE_DOMAIN`
> passed to the script, because the DNS-challenge wildcard cert needs it.

Then:

1. **Pin a static IP** — same as AdGuard, give it a reservation so its address is stable.
2. **Install the local root certificate on your devices** — open `http://<caddy-ip>/` on each
   device and follow the page to trust the root. One-time, per device; after that every
   name under your domain is trusted in the browser. Full walkthrough:
   [certificate-setup.md](certificate-setup.md).
3. **Firewall the admin API** — allow `:2019` only from the Docker host.

Keep the Caddy IP handy — it becomes `CADDY_ADMIN_URL` in the next step.

---

## Step 3 — Loskai (Docker)

On the **Docker host**, clone the repo and configure the environment:

```bash
git clone http://<your-forge>/sunde/Loskai.git
cd Loskai
cp .env.example .env
```

Edit `.env` and fill in what you set up above (every value is also settable in the UI, but
env vars take priority and show read-only there). **This is where your domain is decided** —
`BASE_DOMAIN` lives with Loskai, which appends service prefixes to it and pushes the routes
to Caddy:

```ini
BASE_DOMAIN=example.no
CADDY_ADMIN_URL=http://<caddy-ip>:2019
ADGUARD_URL=http://<adguard-ip>:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=<the-adguard-password>
STACKS_DIR=/opt/stacks
```

`CADDY_ADMIN_URL` is a LAN IP here, so the DNS-rewrite answer IP is derived from it
automatically — no `CADDY_HOST_IP` needed in this layout. Full variable reference:
[deployment.md](deployment.md#environment-variables).

Build and start:

```bash
docker compose up -d --build
```

---

## Step 4 — First run

1. Open `http://<docker-host>:8080` and **set the admin password** on first run (unless you
   set `LOSKAI_PASSWORD` in `.env`).
2. Check the dashboard — the **Caddy** and **AdGuard** cards should show connected. A greyed-out
   card means Loskai can't reach that service; re-check its IP and the firewall rule.
3. **Cold start:** on a brand-new Caddy no routes exist yet, so `loskai.example.no` won't
   resolve. That's expected — you reached the UI directly by IP. Click **"Push all"** to seed
   the initial routes and DNS rewrites.
4. Go to the **Routing** tab → **Add route** to assign your first `https://service.example.no`
   name.

You're done. To update Loskai later, `bash scripts/deploy.sh` pulls and rebuilds in one step
(see [the README](../README.md#updating)).

---

## Alternative: all-in-Docker

No Proxmox? Run Loskai, Caddy, and AdGuard as three containers on one host with
`compose.colocated.yml`. The moving parts differ:

- Set `CADDY_HOST_IP` to the host's LAN IP (Caddy's admin URL is a hostname here, so the
  rewrite answer IP can't be derived).
- Mind the port conflicts — free `:53` from `systemd-resolved`, and keep AdGuard off `80`/`443`.

Details and the full port notes are in [deployment.md](deployment.md#layouts). Steps 3–4 above
are otherwise the same (use `COMPOSE_FILE=compose.colocated.yml bash scripts/deploy.sh` to update).
