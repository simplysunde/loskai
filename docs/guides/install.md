[Docs](../README.md) › [Guides](../README.md#guides)

# Install guide — AdGuard + Caddy + Loskai

**Read this when** you are setting Loskai up from nothing. Step by step for the recommended
Proxmox layout, with a second walkthrough for split DNS.

Steps 1–4 walk the **preferred layout** (**A**): AdGuard Home and Caddy each in their own
Proxmox LXC, with Loskai in Docker driving both over the LAN. Splitting them means rebuilding
Caddy never takes LAN DNS down. You end up with clean `https://service.yourdomain` names,
assigned from Loskai's UI.

Do the steps in order — Loskai needs both LXCs reachable, so build them first.

> No Proxmox? Skip to [layout B — split DNS](#no-proxmox-install-layout-b--split-dns) at the
> bottom: AdGuard on any small always-on box, Caddy and Loskai together in one compose stack.
> It is the recommendation without a hypervisor, and it is a complete walkthrough of its own.
>
> Only want Docker stacks and machines over SSH, no names? [Loskai alone](#loskai-alone--docker-and-machines-no-routing)
> skips AdGuard and Caddy.

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
BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
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
`caddy/Caddyfile` + onboarding page from the repo, so the LXC and the Caddy container
never drift:

```bash
curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash
```

> Installing from a fork or a mirror? Pass its raw URL as `REPO_RAW_BASE` too
> (`… | REPO_RAW_BASE=$BASE bash`), or the script fetches the Caddyfile from GitHub.

This installs Caddy with **internal-CA TLS** (its own CA — no public domain or ACME
token). It carries no routes; Loskai pushes them at runtime.

> **You don't set your domain here.** Caddy never needs it: each name Loskai routes gets
> its own certificate as its route lands. The domain is a Loskai setting (`BASE_DOMAIN`,
> Step 3) — the same when Caddy runs in Docker beside Loskai.

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
mkdir loskai && cd loskai && mkdir data stacks   # yours, so Loskai runs as you, not root
curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
```

Put what you set up above in a `.env` beside it (all values are also settable in the UI, but
env vars take priority). **This is where your domain is decided** — `BASE_DOMAIN` lives with Loskai,
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
docker compose up -d
```

---

## Step 4 — First run

1. Open `http://<docker-host>:8080` and **create the admin account** — a username and a
   password (unless `LOSKAI_PASSWORD` is in `.env`, which makes it as `admin`, or
   `LOSKAI_USERNAME`). More accounts are added in Settings › Users.
2. Check the **Routing** tab — its **Caddy** and **AdGuard** rows should say online. Anything
   else = Loskai can't reach that service; re-check its IP and firewall rule.
3. **Cold start:** a brand-new Caddy has no routes, so `loskai.example.no` won't resolve yet —
   that's why you reached the UI by IP. Click **Sync** (Routing tab) to seed routes and DNS rewrites.
4. **Routing** tab → **Add route** to assign your first `https://service.example.no`.

To update later: `docker compose pull && docker compose up -d`
([Images and releases](deployment.md#images-and-releases)).

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
mkdir loskai && cd loskai && mkdir data stacks
curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml
```

Saved as `compose.yml`, so the plain `docker compose` commands use it. Put the settings in a
`.env` beside it. There is **no `CADDY_ADMIN_URL`** here — the compose file pins it to
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
docker compose up -d
```

**Trust the root cert** — on each device open `http://<docker-host>/` and follow the page
(Caddy publishes `:80` here, so it's the Docker host rather than a Caddy LXC). One-time per
device; see [certificate-setup.md](certificate-setup.md).

### B3 — First run

Identical to [Step 4](#step-4--first-run) — the Caddy and AdGuard rows, the **Sync** cold start,
and the first route all behave the same. To update later:

```bash
docker compose pull && docker compose up -d
```

One capability this layout adds: a container **joined to the shared `loskai-edge` network**
is routable without publishing a host port at all — see
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

### Or, with no second box at all

**C — all-in-Docker** (`compose.colocated.yml`) runs AdGuard, Caddy and Loskai as three
containers on the Docker host. Supported, and the honest answer when a second machine isn't an
option — but it is the only layout that needs the host reconfigured before it will start:
**clear `:53` first**, since most Linux hosts run `systemd-resolved` on it. Then use B2 above
with `compose.colocated.yml` saved as `compose.yml`, dropping `ADGUARD_URL` (that file points at the AdGuard
container). Once it is up, finish AdGuard's setup at `http://<docker-host>:3000` with the
user and password from `.env`. [topologies.md](topologies.md#which-one-should-i-run) compares all three on port
ownership and states C's costs at the point of choice.

---

## Loskai alone — Docker and Machines, no routing

To run stacks and manage machines over SSH without giving anything a name, skip AdGuard and
Caddy: only Step 3, with a shorter `.env`.

```bash
mkdir loskai && cd loskai && mkdir data stacks
curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
```

```ini
BASE_DOMAIN=home.lan        # still needed — a machine's name is <name>.<domain>, resolved or not
HOST_IP=<docker-host-lan-ip>   # locks Loskai's SSH keys on your machines to this host
```

Then `docker compose up -d`, open `http://<docker-host>:8080` and create the admin account.

- **What works:** the Docker tab — stacks, the install wizard, updates, logs, terminals — and
  the Machines tab — SSH setup, terminals, tools, the overview, what runs on each. Machines on
  your tailnet too ([Tailscale](tailscale.md#managing-a-machine-on-your-tailnet)).
- **The Dashboard, with links:** a link is a name and an address — `http://<ip>:<port>` —
  that the Dashboard opens directly. Add them from the Routing tab (**Add link**), or the
  install wizard's last step; see [Links](using-loskai.md#links). Naming a machine says its
  DNS rewrite was skipped.
- **What you give up:** names — services and machines are reached by address and port — and
  **HTTPS for Loskai itself**. Your password, the SSH unlock password and terminal sessions
  cross the LAN unencrypted. Fine on a network you trust; otherwise reach Loskai over
  [Tailscale](tailscale.md), which encrypts the connection, or behind a reverse proxy you
  already run.

**Adding routing later** reinstalls nothing: build AdGuard and Caddy (Steps 1–2), then give
Loskai their addresses in Settings › Network — or in `.env` as in Step 3, then
`docker compose up -d`. Each link can then be given an HTTPS name from its row.

---

**Next:** [Using Loskai →](using-loskai.md) — what each tab is for, now that it runs.
