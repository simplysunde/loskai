# Install guide — AdGuard + Caddy + Loskai

Steps 1–4 walk the **preferred layout** (**A**): AdGuard Home and Caddy each in their own
Proxmox LXC, with Loskai in Docker driving both over the LAN. Splitting them means rebuilding
Caddy never takes LAN DNS down. You end up with clean `https://service.yourdomain` names,
assigned from Loskai's UI.

Do the steps in order — Loskai needs both LXCs reachable, so build them first.

> No Proxmox? Skip to [layout B — split DNS](#no-proxmox-install-layout-b--split-dns) at the
> bottom: AdGuard on any small always-on box, Caddy and Loskai together in one compose stack.
> It is the recommendation without a hypervisor, and it is a complete walkthrough of its own.

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

This creates an unprivileged Debian LXC, installs AdGuard, and prints its DHCP IP. The bridge,
storage, and Debian template are **autodetected** from the host (and echoed before creation);
override any guess by putting the env var on the **`bash` side** of the pipe — before `curl`
it would set the var for `curl`, not the script:

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

This installs Caddy with **internal-CA TLS** (its own CA — no public domain or ACME
token). It carries no routes; Loskai pushes them at runtime.

> **You don't set your domain here.** Caddy signs each name on demand with its own CA and
> never needs the domain — that's a Loskai setting (`BASE_DOMAIN`, Step 3).

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
#STACKS_DIR=/srv/stacks   # optional — defaults to ./stacks beside the compose file
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

To update later, `bash scripts/deploy.sh` pulls and rebuilds ([README](../../README.md#updating)).

---

## No Proxmox? Install layout B — split DNS

Steps 1–4 above are layout **A** (the three-way split), the recommendation *if you run
Proxmox*. Without it, the recommended layout is **B — split DNS**, the two-way split: AdGuard
on any small always-on box, with Caddy and Loskai together in Docker on your main host. It is
three steps instead of four — Caddy comes up inside the compose stack, so there is no separate
Caddy box to build.

You need one small always-on machine for DNS: a Raspberry Pi, an old mini-PC or thin client,
or a NAS that can run one container. It gets set up once and then left alone.

### B1 — AdGuard Home on the DNS box

Install AdGuard Home on that machine — either natively (its own installer script, per
[AdGuard's documentation](https://github.com/AdguardTeam/AdGuardHome#getting-started)) or as
a container:

```yaml
services:
  adguard:
    image: adguard/adguardhome:latest
    container_name: adguard
    network_mode: host # simplest way to own :53 on a box that does nothing else
    volumes:
      - ./work:/opt/adguardhome/work
      - ./conf:/opt/adguardhome/conf
    restart: unless-stopped
```

Then, exactly as in [Step 1](#step-1--adguard-home-lxc-lan-dns):

1. **Pin a static IP** — a DHCP reservation, so its address never changes.
2. **Finish setup** — open `http://<adguard-ip>:3000`, set the admin user/password, enable
   the DNS server on `:53`.
3. **Firewall the API** — allow `:3000` only from the Docker host.
4. **Point your LAN at it** — set your router/DHCP's DNS to the AdGuard IP.

Keep the IP, user and password — Loskai needs all three next.

### B2 — Caddy + Loskai on the Docker host

```bash
git clone http://<your-forge>/sunde/Loskai.git
cd Loskai
cp .env.example .env
```

Edit `.env`. There is **no `CADDY_ADMIN_URL`** here — the compose file pins it to
`http://caddy:2019`, which never leaves the Docker network:

```ini
BASE_DOMAIN=example.no
ADGUARD_URL=http://<adguard-ip>:3000
ADGUARD_USER=admin
ADGUARD_PASSWORD=<the-adguard-password>
CADDY_HOST_IP=<docker-host-lan-ip>
HOST_IP=<docker-host-lan-ip>
#STACKS_DIR=/srv/stacks   # optional — defaults to ./stacks beside the compose file
```

`CADDY_HOST_IP` is **required** in this layout: Caddy's admin URL is a hostname, so the
DNS-rewrite answer IP can't be derived from it — it is this host's LAN IP, where Caddy's
`:443` is published. `HOST_IP` is the same address, and fills in route upstreams for
containers Caddy can't reach by name. Then:

```bash
docker compose -f compose.caddy-loskai.yml up -d --build
```

**Trust the root cert** — on each device open `http://<docker-host>/` and follow the page
(Caddy publishes `:80` here, so it's the Docker host rather than a Caddy LXC). One-time per
device; see [certificate-setup.md](certificate-setup.md).

### B3 — First run

Identical to [Step 4](#step-4--first-run) — the dashboard cards, the "Push all" cold start,
and the first route all behave the same. To update later:

```bash
COMPOSE_FILE=compose.caddy-loskai.yml bash scripts/deploy.sh
```

One capability this layout adds: a container **joined to the shared `loskai-edge` network**
is routable without publishing a host port at all — see
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

### Or, with no second box at all

**C — all-in-Docker** (`compose.colocated.yml`) runs AdGuard, Caddy and Loskai as three
containers on the Docker host. Supported, and the honest answer when a second machine isn't an
option — but it is the only layout that needs the host reconfigured before it will start:
**clear `:53` first**, since most Linux hosts run `systemd-resolved` on it. Then use B2 above
with `compose.colocated.yml`, dropping `ADGUARD_URL` (that file points at the AdGuard
container). [topologies.md](topologies.md#which-one-should-i-run) compares all three on port
ownership and states C's costs at the point of choice.
