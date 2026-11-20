[Docs](../README.md) › [Guides](../README.md#guides)

# Install guide

**Read this when** you are setting Loskai up from nothing, with HTTPS names for your
services or without.

Loskai runs in Docker. On its own it manages your Docker stacks and your machines. **HTTPS
names**, like `https://jellyfin.home.lan`, take two programs more:

- **AdGuard Home**, your network's DNS server. A name exists only there: Loskai adds it, and
  AdGuard answers every device that asks. It has to be on all the time, at an address that
  doesn't change.
- **Caddy**, which serves each name over HTTPS and passes it on to the service.

Where those two run is your setup. Every setup needs a machine with
[Docker](https://docs.docker.com/engine/install/) and Compose, `amd64` or `arm64`, at an
address that doesn't change: the Docker host.

## Choose your setup

| You have | Your setup | AdGuard | Caddy |
|---|---|---|---|
| Only the Docker host, and no need for names yet | [Loskai alone](#loskai-alone) | none | none |
| Proxmox | [With Proxmox](#with-proxmox) | an LXC | an LXC |
| A small always-on machine, like a Raspberry Pi, beside the Docker host | [With a small always-on machine](#with-a-small-always-on-machine) | on the small machine | beside Loskai |
| Only the Docker host, with names | [On one machine](#on-one-machine) | beside Loskai | beside Loskai |

Each setup installs once, from its own compose file. AdGuard on a machine of its own keeps
your network's DNS up while the Docker host restarts; one machine for everything is the
least to run. [topologies.md](topologies.md#which-one-should-i-run) compares them. Loskai
alone can get names later: [Add names later](#add-names-later).

## Loskai alone

1. On the Docker host, download Loskai's compose file and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai runs as you and not as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

2. Open `http://<docker-host>:8080`. You see **Welcome to Loskai**.
3. Fill in **Your account**. Under **Your network**, keep **Base Domain** as `home.lan` or
   type your own, and check that **Docker Host LAN IP** is this machine's address. Leave
   **I want secure HTTPS connections** unticked.
4. Click **Start using Loskai**. You land on **Routing**.

**Docker** and **Machines** work now, and **Add link** puts a service on the Dashboard by its
address. Until Loskai has an HTTPS name of its own, your password crosses your network
unencrypted. That is fine on a network you trust. Otherwise add names, or reach Loskai over
[Tailscale](tailscale.md).

## With Proxmox

AdGuard and Caddy each in a small LXC of their own; Loskai in Docker on the Docker host.

1. In the **Proxmox shell**, make the two LXCs. Each script makes a small Debian LXC,
   installs the program and prints the address it got. Read a script before piping it into
   a shell: [create-adguard-lxc.sh](../../scripts/create-adguard-lxc.sh),
   [create-caddy-lxc.sh](../../scripts/create-caddy-lxc.sh).

   ```bash
   BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
   curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
   curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash
   ```

   To choose a container's ID or bridge, set it on the `bash` side:
   `… | CTID=110 CT_BRIDGE=vmbr0 bash`. Each LXC has only `root`, and no password: its
   **Console** in Proxmox opens a root shell without asking.
2. In your router, give both LXCs a fixed address (a DHCP reservation).
3. Set AdGuard up: open `http://<adguard-ip>:3000`. Its setup offers port 80 for its web
   interface: type `3000`, the port this guide uses. Leave DNS on 53, and choose a username and password. You end on
   AdGuard's dashboard.
4. Close AdGuard's `3000` and Caddy's `2019` to everyone but the Docker host: they control
   your DNS and your routes.
5. On the Docker host, download Loskai's compose file and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai runs as you and not as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

6. Open `http://<docker-host>:8080`. On **Welcome to Loskai**, fill in **Your account**.
   Under **Your network**, keep **Base Domain** as `home.lan` or type your own — your names
   end in it — and check that **Docker Host LAN IP** is this machine's address.
7. Tick **I want secure HTTPS connections** and fill in **Caddy admin URL**
   `http://<caddy-ip>:2019`, **AdGuard URL** `http://<adguard-ip>:3000`, and AdGuard's
   username and password.
8. Click **Start using Loskai**. On **Routing**, the **Caddy** and **AdGuard** rows say
   **online**.

Then: [Point your devices at AdGuard](#point-your-devices-at-adguard).

## With a small always-on machine

AdGuard on the small machine — a Raspberry Pi, a mini PC, a NAS that runs containers; Caddy
and Loskai in Docker on the Docker host.

1. On the small machine, install AdGuard Home with
   [its own installer](https://github.com/AdguardTeam/AdGuardHome#getting-started) or as a
   container:

   ```yaml
   services:
     adguard:
       image: adguard/adguardhome:latest
       container_name: adguard
       network_mode: host # the simplest way to own port 53 on a machine that does nothing else
       volumes:
         - ./work:/opt/adguardhome/work
         - ./conf:/opt/adguardhome/conf
       restart: unless-stopped
   ```

2. In your router, give the small machine a fixed address (a DHCP reservation).
3. Set AdGuard up: open `http://<adguard-ip>:3000`. Its setup offers port 80 for its web
   interface: type `3000`, the port this guide uses. Leave DNS on 53, and choose a username and password. You end on
   AdGuard's dashboard.
4. Close AdGuard's `3000` to everyone but the Docker host: it controls your DNS.
5. On the Docker host, with ports 80 and 443 free, download Loskai's compose file — Caddy
   comes in it — say where names point, this machine's address, and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai runs as you and not as root
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml
   echo "CADDY_HOST_IP=<this-machine's-address>" >> .env
   docker compose up -d
   ```

   `docker compose ps` lists `loskai` and `caddy`.
6. Open `http://<docker-host>:8080`. On **Welcome to Loskai**, fill in **Your account**.
   Under **Your network**, keep **Base Domain** as `home.lan` or type your own — your names
   end in it — and check that **Docker Host LAN IP** is this machine's address.
7. Under **Secure HTTPS connections**, what the compose file set is marked **env**. Fill in
   **AdGuard URL** `http://<adguard-ip>:3000`, and AdGuard's username and password.
8. Click **Start using Loskai**. On **Routing**, the **Caddy** and **AdGuard** rows say
   **online**.

A container can then join Caddy's network and be routed without publishing a port:
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

Then: [Point your devices at AdGuard](#point-your-devices-at-adguard).

## On one machine

AdGuard, Caddy and Loskai in Docker on the Docker host. Nothing to install first; what you
trade for it: while that machine is down or restarting, so is your network's DNS.

1. Check that ports 80, 443 and 3000 are free on the Docker host. Port 53 only has to be
   free on its LAN address, where AdGuard's DNS goes: the resolver most Linux hosts run
   themselves is on another address and stays as it is.
2. Download Loskai's compose file — AdGuard and Caddy come in it — say where names point,
   this machine's address, and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai runs as you and not as root
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.colocated.yml -o compose.yml
   echo "CADDY_HOST_IP=<this-machine's-address>" >> .env
   docker compose up -d
   ```

   `docker compose ps` lists `loskai`, `adguard` and `caddy`.
3. Set AdGuard up: open `http://<docker-host>:3000`. Its setup offers port 80 for its web
   interface: type `3000`, the only port the compose file publishes. Leave DNS on 53, and
   choose a username and password. You end on AdGuard's dashboard.
4. Open `http://<docker-host>:8080`. On **Welcome to Loskai**, fill in **Your account**.
   Under **Your network**, keep **Base Domain** as `home.lan` or type your own — your names
   end in it — and check that **Docker Host LAN IP** is this machine's address.
5. Under **Secure HTTPS connections**, what the compose file set is marked **env**. Fill in
   AdGuard's username and password.
6. Click **Start using Loskai**. On **Routing**, the **Caddy** and **AdGuard** rows say
   **online**.

Then: [Point your devices at AdGuard](#point-your-devices-at-adguard).

## Point your devices at AdGuard

The last three steps are the same for every setup with names. If a row on **Routing** isn't
**online**: [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable).
Everything on the welcome page can be changed later, in **Settings** › **Network**.

A device finds `jellyfin.home.lan` only if AdGuard is its DNS server.

- **One device, to try it.** In the device's network settings, on its Wi-Fi or Ethernet
  connection, set the DNS server to AdGuard's address. It changes nothing for anyone else.
- **The whole network.** In your router's DHCP settings, set the DNS server to AdGuard's
  address, as the only one: with a second one listed, devices sometimes ask that instead.
  Each device picks it up the next time it connects.

Some routers, often an internet provider's, don't let you change this:
[AdGuard as your DHCP server](#adguard-as-your-dhcp-server) is the way round it.

## Trust the certificate

Caddy makes its own certificates, so there is no domain to buy. Each device has to trust it
once.

1. On the device, open `http://<docker-host>:8080/certificate`. Use the address: the
   device doesn't trust the names yet.
2. Under **Download the certificate**, click the `caddy-root.crt` button, then follow the
   steps the page shows for that device.

After that, every name opens without a warning, the ones you add later too. More in
[certificate-setup.md](certificate-setup.md).

## Give a service its name

1. On **Routing**, click **Add route**.
2. Pick a container, or type a service's address and port. Change the **Subdomain prefix**
   if you want another name.
3. Click **Add route**. The service's row says **synced** under Route and **set** under DNS.
4. Open `https://<prefix>.<your domain>` on a device that asks AdGuard and trusts the
   certificate.

Give Loskai itself a name the same way — pick the `loskai` container — and log in over
HTTPS from then on.

If the name doesn't open: [A name doesn't resolve](troubleshooting.md#a-name-doesnt-resolve),
[Certificate warning](troubleshooting.md#certificate-warning) or
[502 Bad Gateway](troubleshooting.md#502-bad-gateway).

## Update

In Loskai's folder: `docker compose pull && docker compose up -d`
([Images and releases](deployment.md#images-and-releases)).

## Advanced

### Add names later

For a Loskai that runs alone, the README's *Quick start* among them:

1. Choose a setup with names, and follow its steps up to downloading Loskai's compose file:
   [With Proxmox](#with-proxmox), [With a small always-on machine](#with-a-small-always-on-machine)
   or [On one machine](#on-one-machine).
2. In Loskai's folder, download that setup's compose file over `compose.yml`, add
   `CADDY_HOST_IP` if it needs it, and run `docker compose up -d`. With Proxmox,
   `compose.yml` stays. Your account and settings are as they were.
3. Set AdGuard up, as that setup's steps say, and fill in what isn't there in **Settings** ›
   **Network**: Caddy's and AdGuard's URLs, AdGuard's username and password.

### AdGuard as your DHCP server

For a router that won't hand out another DNS server. AdGuard Home can hand out the
addresses itself, and then every device uses it for DNS. Turn the router's DHCP off first:
two DHCP servers on one network give out conflicting addresses. AdGuard's own guide has the
steps: [DHCP](https://github.com/AdguardTeam/AdGuardHome/wiki/DHCP).

### Settings in a `.env` file

Everything the welcome page and **Settings** ask for can go in a file named `.env` beside
`compose.yml` instead, which sets a machine up again without a click. With Proxmox it
would be:

```ini
BASE_DOMAIN=home.lan
HOST_IP=<this-machine's-address>
CADDY_ADMIN_URL=http://<caddy-ip>:2019
ADGUARD_URL=http://<adguard-ip>:3000
ADGUARD_USER=<adguard-username>
ADGUARD_PASSWORD=<adguard-password>
```

Run `docker compose up -d` after changing it. A value set there wins: it shows locked in
**Settings**, marked **env**. With `LOSKAI_PASSWORD` in it the admin account is made for
you, as `admin` or `LOSKAI_USERNAME`, and you see the login page in place of the welcome
page.

[`.env.example`](../../.env.example) lists every variable, ready to copy. What each one
does: [deployment.md](deployment.md#environment-variables).

---

**Next:** [Using Loskai →](using-loskai.md) — what each tab is for, now that it runs.
