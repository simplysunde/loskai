[Docs](../README.md) › [Guides](../README.md#guides)

# Install guide

**Read this when** you are setting Loskai up from nothing: Loskai itself first, then HTTPS
names for your services.

Loskai installs in three commands and works at once for Docker and your machines. Names like
`https://jellyfin.home.lan` take two more programs and one network setting, in the sections
after it.

| You want | Do |
|---|---|
| Loskai running | [Install Loskai](#install-loskai) |
| HTTPS names, and you run Proxmox | then [With Proxmox](#with-proxmox-adguard-and-caddy-in-lxcs) |
| HTTPS names, with a small always-on machine for DNS | then [With a small always-on machine](#with-a-small-always-on-machine-caddy-beside-loskai) |
| HTTPS names, on this one machine | then [One machine](#one-machine-all-three-in-docker) |
| Settings in a file, not the UI | [Settings in a `.env` file](#settings-in-a-env-file) |

## Install Loskai

You need a machine with [Docker](https://docs.docker.com/engine/install/) and Compose,
`amd64` or `arm64`, at an address on your network that doesn't change.

1. Make Loskai's folder and start it:

   ```bash
   mkdir loskai && cd loskai
   mkdir data stacks    # made by you, so Loskai runs as you and not as root
   curl -fsSLO https://raw.githubusercontent.com/simplysunde/loskai/main/compose.yml
   docker compose up -d
   ```

2. Open `http://<this-machine>:8080`. You see **Welcome to Loskai**.
3. Fill in **Your account**. Under **Your network**, keep **Base Domain** as `home.lan` or
   type your own — it is what your names will end in — and check that **Docker Host LAN IP**
   is this machine's address. Leave **I want secure HTTPS connections** unticked.
4. Click **Start using Loskai**. You land on **Routing**.

**Docker** and **Machines** work now, and **Add link** puts a service on the Dashboard by
its address.

Rather keep your settings in a file than type them in? See
[Settings in a `.env` file](#settings-in-a-env-file).

Until Loskai has an HTTPS name of its own, your password crosses your network unencrypted.
That is fine on a network you trust. Otherwise go on to names, or reach Loskai over
[Tailscale](tailscale.md).

## What HTTPS names need

Three things, each set up once:

- **AdGuard Home**, as your network's DNS server. A name like `jellyfin.home.lan` exists
  only there: Loskai adds it, and AdGuard answers every device that asks. It has to be on
  all the time, at an address that doesn't change.
- **Caddy**, which serves each name over HTTPS and passes it on to the service.
- **Your devices asking AdGuard.** Until a device does, the names don't exist for it:
  [Point your devices at AdGuard](#point-your-devices-at-adguard).

Where the two programs run depends on what you have. A machine of its own for AdGuard keeps
your network's DNS up while the Docker host restarts; one machine for everything is the
least to run.

| | AdGuard | Caddy |
|---|---|---|
| [With Proxmox](#with-proxmox-adguard-and-caddy-in-lxcs) | An LXC | An LXC |
| [With a small always-on machine](#with-a-small-always-on-machine-caddy-beside-loskai) | That machine | In Docker, beside Loskai |
| [One machine](#one-machine-all-three-in-docker) | In Docker | In Docker |

## With Proxmox: AdGuard and Caddy in LXCs

Both scripts run in the **Proxmox shell**. Each makes a small Debian LXC, installs the
program and prints the address it got. Read a script before piping it into a shell:
[create-adguard-lxc.sh](../../scripts/create-adguard-lxc.sh),
[create-caddy-lxc.sh](../../scripts/create-caddy-lxc.sh).

1. Make the two LXCs:

   ```bash
   BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
   curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
   curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash
   ```

   To choose a container's ID or bridge, set it on the `bash` side:
   `… | CTID=110 CT_BRIDGE=vmbr0 bash`.

2. Give both a fixed address in your router (a DHCP reservation).
3. Set AdGuard up: open `http://<adguard-ip>:3000`. Its setup asks which port its web
   interface should use and offers 80: type `3000`. Leave DNS on 53, and choose a username
   and password. You end on AdGuard's dashboard, at `http://<adguard-ip>:3000`.
4. Tell Loskai where they are. In **Settings** › **Network**, fill in Caddy's **Admin URL**
   (`http://<caddy-ip>:2019`) and AdGuard's **URL** (`http://<adguard-ip>:3000`),
   **Username** and **Password**. Each saves as you leave it. On **Routing**, the **Caddy**
   and **AdGuard** rows say **online**; if one doesn't,
   [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable).
5. Close the two admin ports to everyone else: they control your routes and your DNS. With a
   firewall rule on each LXC, allow Caddy's `2019` and AdGuard's `3000` only from the Docker
   host's address.

Then [point your devices at AdGuard](#point-your-devices-at-adguard).

## With a small always-on machine: Caddy beside Loskai

AdGuard goes on a small machine that is always on — a Raspberry Pi, a mini PC, a NAS that
runs containers. Caddy runs in Docker next to Loskai, so ports 80 and 443 on the Docker host
must be free.

1. Install AdGuard Home on the small machine, with
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

2. Give that machine a fixed address in your router (a DHCP reservation).
3. Set AdGuard up: open `http://<adguard-ip>:3000`. Its setup asks which port its web
   interface should use and offers 80: type `3000`. Leave DNS on 53, and choose a username
   and password. You end on AdGuard's dashboard, at `http://<adguard-ip>:3000`.
4. Add Caddy. In Loskai's folder on the Docker host, replace `compose.yml` with the file that
   has both, and say where names should point — this machine, where Caddy will listen:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml
   echo "CADDY_HOST_IP=<this-machine's-address>" >> .env
   docker compose up -d
   ```

   `docker compose ps` lists `caddy` and `loskai`. Your account and settings are as they were.

5. Tell Loskai about AdGuard. In **Settings** › **Network**, fill in AdGuard's **URL**
   (`http://<adguard-ip>:3000`), **Username** and **Password**. Caddy's **Admin URL** is
   already there, marked **env**. On **Routing**, the **Caddy** and **AdGuard** rows say
   **online**; if one doesn't,
   [A module shows unreachable](troubleshooting.md#a-module-shows-unreachable).
6. Close AdGuard's web port to everyone else, since it controls your DNS: allow `3000` only
   from the Docker host's address.

A container can also join Caddy's network and be routed without publishing a port:
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

Then [point your devices at AdGuard](#point-your-devices-at-adguard).

## One machine: all three in Docker

AdGuard, Caddy and Loskai as three containers on the Docker host: nothing else to buy or set
up. What you trade for it: while that machine is down or restarting, so is your network's
DNS.

Ports 80, 443 and 3000 must be free on it. Port 53 only has to be free on its LAN address,
where AdGuard's DNS goes: the resolver most Linux hosts run themselves is on another address
and stays as it is.

1. In Loskai's folder, replace `compose.yml` with the file that has all three, and say this
   machine's address:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.colocated.yml -o compose.yml
   echo "CADDY_HOST_IP=<this-machine's-address>" >> .env
   docker compose up -d
   ```

   `docker compose ps` lists `adguard`, `caddy` and `loskai`. Your account and settings are
   as they were.

2. Set AdGuard up: open `http://<this-machine>:3000`. Its setup asks which port its web
   interface should use and offers 80: type `3000`, the only one Loskai and you can reach it
   on here. Leave DNS on 53, and choose a username and password.
3. Give Loskai that login. In **Settings** › **Network**, fill in AdGuard's **Username** and
   **Password**; its **URL** and Caddy's **Admin URL** are already there, marked **env**. On
   **Routing**, the **Caddy** and **AdGuard** rows say **online**.

Then [point your devices at AdGuard](#point-your-devices-at-adguard): its address is this
machine's. How the three layouts compare:
[topologies.md](topologies.md#which-one-should-i-run).

## Point your devices at AdGuard

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
