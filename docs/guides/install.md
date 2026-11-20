[Docs](../README.md) › [Guides](../README.md#guides)

# Install guide

**Read this when** you are setting Loskai up from nothing.

Loskai runs in Docker and manages your stacks and machines. HTTPS names, like
`https://jellyfin.home.lan`, also need **AdGuard Home** for DNS and **Caddy** for HTTPS.
Where those two run is your setup.

You need a Docker host: a machine with [Docker](https://docs.docker.com/engine/install/) and
Compose, `amd64` or `arm64`, at a fixed address.

## Choose your setup

| You have | Setup |
|---|---|
| A Docker host, no names yet | [Loskai alone](#loskai-alone) |
| Proxmox | [With Proxmox](#with-proxmox): AdGuard and Caddy in LXCs |
| A small always-on machine too, like a Raspberry Pi | [With a small always-on machine](#with-a-small-always-on-machine): AdGuard on it, Caddy beside Loskai |
| Only a Docker host, with names | [On one machine](#on-one-machine): all three in Docker; DNS goes down with it |

Compared in [topologies.md](topologies.md#which-one-should-i-run).

## Loskai alone

1. On the Docker host:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

2. Open `http://<docker-host>:8080` and fill in **Welcome to Loskai**. **Base Domain** is what
   your names will end in. Leave **I want secure HTTPS connections** unticked.
3. Click **Start using Loskai**. You land on **Routing**.

**Docker** and **Machines** work now. Without a name, your password crosses the network
unencrypted: fine on a network you trust, otherwise use [Tailscale](tailscale.md) or
[add names later](#add-names-later).

## With Proxmox

1. In the Proxmox shell, make the two LXCs
   ([create-adguard-lxc.sh](../../scripts/create-adguard-lxc.sh),
   [create-caddy-lxc.sh](../../scripts/create-caddy-lxc.sh)):

   ```bash
   BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
   curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
   curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash
   ```

   Each prints its address. To pick the ID or bridge: `… | CTID=110 CT_BRIDGE=vmbr0 bash`.
   An LXC's **Console** is a root shell, with no password.
2. Give both LXCs a fixed address in your router.
3. Open `http://<adguard-ip>:3000`. Set the web interface to port `3000`, keep DNS on 53, and
   choose a username and password.
4. Firewall AdGuard's `3000` and Caddy's `2019`: allow only the Docker host.
5. On the Docker host:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

6. Open `http://<docker-host>:8080` and fill in **Welcome to Loskai**. **Base Domain** is what
   your names will end in. Tick **I want secure HTTPS connections** and fill in:
   - **Caddy admin URL**: `http://<caddy-ip>:2019`
   - **AdGuard URL**: `http://<adguard-ip>:3000`
   - AdGuard's username and password
7. Click **Start using Loskai**. On **Routing**, **Caddy** and **AdGuard** say **online**
   (if not: [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable)).

Then [point your devices at AdGuard](#point-your-devices-at-adguard).

## With a small always-on machine

1. On the small machine, install AdGuard Home with
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

2. Give the small machine a fixed address in your router.
3. Open `http://<adguard-ip>:3000`. Set the web interface to port `3000`, keep DNS on 53, and
   choose a username and password.
4. Firewall AdGuard's `3000`: allow only the Docker host.
5. On the Docker host, with ports 80 and 443 free:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml
   echo "CADDY_HOST_IP=<docker-host-ip>" >> .env
   docker compose up -d
   ```

6. Open `http://<docker-host>:8080` and fill in **Welcome to Loskai**. **Base Domain** is what
   your names will end in. Under **Secure HTTPS connections**, fill in:
   - **AdGuard URL**: `http://<adguard-ip>:3000`
   - AdGuard's username and password
7. Click **Start using Loskai**. On **Routing**, **Caddy** and **AdGuard** say **online**
   (if not: [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable)).

A container can join Caddy's network instead of publishing a port:
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

Then [point your devices at AdGuard](#point-your-devices-at-adguard).

## On one machine

1. Free ports 80, 443 and 3000 on the Docker host, and 53 on its LAN address. The resolver
   on `127.0.0.53` that most Linux hosts run can stay.
2. On the Docker host:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai doesn't run as root
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.colocated.yml -o compose.yml
   echo "CADDY_HOST_IP=<docker-host-ip>" >> .env
   docker compose up -d
   ```

3. Open `http://<docker-host>:3000`. Set the web interface to port `3000` (it must be), keep
   DNS on 53, and choose a username and password.
4. Open `http://<docker-host>:8080` and fill in **Welcome to Loskai**. **Base Domain** is what
   your names will end in. Under **Secure HTTPS connections**, fill in AdGuard's username and
   password.
5. Click **Start using Loskai**. On **Routing**, **Caddy** and **AdGuard** say **online**
   (if not: [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable)).

Then [point your devices at AdGuard](#point-your-devices-at-adguard).

## Point your devices at AdGuard

Set AdGuard's address as the only DNS server:

- **One device, to try it:** in its Wi-Fi or Ethernet settings.
- **Every device:** in your router's DHCP settings. Devices pick it up when they reconnect.

Router won't let you? [Use AdGuard as your DHCP server](#adguard-as-your-dhcp-server).

## Trust the certificate

Once on each device:

1. Open `http://<docker-host>:8080/certificate`, by address: the device doesn't trust the
   names yet.
2. Click **caddy-root.crt** and follow the steps shown for the device.

Phones and Firefox: [certificate-setup.md](certificate-setup.md).

## Give a service its name

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

1. Follow your new setup up to its Docker host step.
2. In Loskai's folder, download that setup's compose file over `compose.yml` (with Proxmox,
   keep it), add `CADDY_HOST_IP` if it has it, and run `docker compose up -d`. Your account
   and settings stay.
3. Set AdGuard up as that setup says, then fill in **Settings** › **Network**.

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
