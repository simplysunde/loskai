[Docs](../README.md) › [Guides](../README.md#guides)

# Install guide

**Read this when** you are setting Loskai up from nothing.

Loskai runs in Docker and manages your stacks and machines. HTTPS names/custom domain, like
`https://jellyfin.home.lan`, also need **AdGuard Home** for DNS and **Caddy** for HTTPS.
Depending on your setup, they are hosted in different ways.

You need a Docker host: a machine with [Docker](https://docs.docker.com/engine/install/) and
Compose, `amd64` or `arm64`, at a fixed address.

## Choose your setup

| Setup | What runs where |
|---|---|
| [Loskai standalone](#loskai-standalone) | Loskai on your Docker host. No HTTPS names. |
| [Proxmox](#proxmox) | AdGuard and Caddy in an LXC each, Loskai on your Docker host. |
| [Loskai + Caddy](#loskai--caddy) | Loskai and Caddy on your Docker host, AdGuard on a small always-on machine like a Raspberry Pi. |
| [All-in-one](#all-in-one) | Loskai, Caddy and AdGuard on your Docker host. DNS goes down when it does. |

Compared in [topologies.md](topologies.md#which-one-should-i-run).

## Loskai standalone

Loskai on your Docker host. No HTTPS names.

1. **On the Docker host**, download Loskai and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

2. **In Loskai**, at `http://<docker-host>:8080`, fill in **Welcome to Loskai**. **Base
   Domain** is what your names will end in. Leave **I want secure HTTPS connections**
   unticked, and click **Start using Loskai**. You land on **Routing**.

**Docker** and **Machines** work now. Without a name, your password crosses the network
unencrypted: fine on a network you trust, otherwise use [Tailscale](tailscale.md) or setup 
[adguard & caddy](#add-names-later) later.

## Proxmox

AdGuard and Caddy in an LXC each, Loskai on your Docker host.

1. **On Proxmox**, in its shell, make the two LXCs
   ([create-adguard-lxc.sh](../../scripts/create-adguard-lxc.sh),
   [create-caddy-lxc.sh](../../scripts/create-caddy-lxc.sh)):

   ```bash
   BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
   curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
   curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash
   ```

   Each prints its address. To pick the ID or bridge: `… | CTID=110 CT_BRIDGE=vmbr0 bash`.
   An LXC's **Console** is a root shell, with no password.
2. **In your router**, give both LXCs a fixed address.
3. **In AdGuard**, at `http://<adguard-ip>:3000`: set the web interface to port `3000`, keep
   DNS on 53, and choose a username and password.
4. **In your firewall**, allow AdGuard's `3000` and Caddy's `2019` only from the Docker host.
5. **On the Docker host**, download Loskai and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

6. **In Loskai**, at `http://<docker-host>:8080`, fill in **Welcome to Loskai**. **Base
   Domain** is what your names will end in. Tick **I want secure HTTPS connections** and
   fill in:
   - **Caddy admin URL**: `http://<caddy-ip>:2019`
   - **AdGuard URL**: `http://<adguard-ip>:3000`
   - AdGuard's username and password

   Click **Start using Loskai**. On **Routing**, **Caddy** and **AdGuard** say **online**.

Then [after setup](#after-setup).

## Loskai + Caddy

Loskai and Caddy on your Docker host, AdGuard on a small always-on machine like a Raspberry
Pi.

1. **On the small machine**, install AdGuard Home with
   [its installer](https://github.com/AdguardTeam/AdGuardHome#getting-started), or in Docker:

   ```yaml
   services:
     adguard:
       image: adguard/adguardhome:latest
       container_name: adguard
       network_mode: host
       volumes:
         - ./work:/opt/adguardhome/work
         - ./conf:/opt/adguardhome/conf
       restart: unless-stopped
   ```

2. **In your router**, give the small machine a fixed address.
3. **In AdGuard**, at `http://<adguard-ip>:3000`: set the web interface to port `3000`, keep
   DNS on 53, and choose a username and password.
4. **In your firewall**, allow AdGuard's `3000` only from the Docker host.
5. **On the Docker host**, with ports 80 and 443 free, download Loskai and Caddy and start
   them:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml
   echo "CADDY_HOST_IP=<docker-host-ip>" >> .env
   docker compose up -d
   ```

6. **In Loskai**, at `http://<docker-host>:8080`, fill in **Welcome to Loskai**. **Base
   Domain** is what your names will end in. Under **Secure HTTPS connections**, fill in:
   - **AdGuard URL**: `http://<adguard-ip>:3000`
   - AdGuard's username and password

   Click **Start using Loskai**. On **Routing**, **Caddy** and **AdGuard** say **online**.

A container can join Caddy's network instead of publishing a port:
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

Then [after setup](#after-setup).

## All-in-one

Loskai, Caddy and AdGuard on your Docker host. DNS goes down when it does.

1. **On the Docker host**, free ports 80, 443 and 3000, and 53 on its LAN address. The
   resolver on `127.0.0.53` that most Linux hosts run can stay. Then download all three and
   start them:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.colocated.yml -o compose.yml
   echo "CADDY_HOST_IP=<docker-host-ip>" >> .env
   docker compose up -d
   ```

2. **In AdGuard**, at `http://<docker-host>:3000`: set the web interface to port `3000` (it
   must be), keep DNS on 53, and choose a username and password.
3. **In Loskai**, at `http://<docker-host>:8080`, fill in **Welcome to Loskai**. **Base
   Domain** is what your names will end in. Under **Secure HTTPS connections**, fill in
   AdGuard's username and password.

   Click **Start using Loskai**. On **Routing**, **Caddy** and **AdGuard** say **online**.

Then [after setup](#after-setup).

## After setup

The same for every setup with names. If **Caddy** or **AdGuard** isn't **online** on
**Routing**: [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable).

### Point your devices at AdGuard

**In your router's DHCP settings**, set AdGuard's address as the only DNS server. Devices
pick it up when they reconnect. To try it on one device first, set it **in that device's
Wi-Fi or Ethernet settings** instead.

Router won't let you? [Use AdGuard as your DHCP server](#adguard-as-your-dhcp-server).

### Trust the certificate

**On each device**, once:

1. Open `http://<docker-host>:8080/certificate`, by address: the device doesn't trust the
   names yet.
2. Click **caddy-root.crt** and follow the steps shown for the device.

Phones and Firefox: [certificate-setup.md](certificate-setup.md).

### Give a service its name

**In Loskai:**

1. On **Routing**, click **Add route**.
2. Pick a container, or type an address and port.
3. Click **Add route**. The row says **synced** and **set**.
4. Open `https://<prefix>.<your domain>`.

Name Loskai itself the same way (the `loskai` container) and log in over HTTPS from then on.

Not opening? [A name doesn't resolve](troubleshooting.md#a-name-doesnt-resolve),
[Certificate warning](troubleshooting.md#certificate-warning),
[502 Bad Gateway](troubleshooting.md#502-bad-gateway).

## Update

In Loskai's folder: `docker compose pull && docker compose up -d`.

## Advanced

### Add names later

1. Follow your new setup — [Proxmox](#proxmox), [Loskai + Caddy](#loskai--caddy) or
   [All-in-one](#all-in-one) — up to its **On the Docker host** step.
2. **On the Docker host**, in Loskai's folder, download that setup's compose file over
   `compose.yml` (with Proxmox, keep it), add `CADDY_HOST_IP` if it has it, and run
   `docker compose up -d`. Your account and settings stay.
3. **In AdGuard**, set it up as that setup says. **In Loskai**, fill in **Settings** ›
   **Network**.

### AdGuard as your DHCP server

Turn your router's DHCP off, then follow AdGuard's
[DHCP guide](https://github.com/AdguardTeam/AdGuardHome/wiki/DHCP). Every device then uses
AdGuard for DNS.

### Settings in a `.env` file

Anything the welcome page and **Settings** ask can go in `.env` beside `compose.yml`, for
example:

```ini
BASE_DOMAIN=home.lan
HOST_IP=<docker-host-ip>
CADDY_ADMIN_URL=http://<caddy-ip>:2019
ADGUARD_URL=http://<adguard-ip>:3000
ADGUARD_USER=<adguard-username>
ADGUARD_PASSWORD=<adguard-password>
```

Run `docker compose up -d` after a change. A value there wins and shows locked in
**Settings**. With `LOSKAI_PASSWORD` set, the admin account is made for you and you get the
login page instead of the welcome page. Every variable:
[`.env.example`](../../.env.example), [deployment.md](deployment.md#environment-variables).

---

**Next:** [Using Loskai →](using-loskai.md)
