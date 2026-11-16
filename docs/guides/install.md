[Docs](../README.md) › [Guides](../README.md#guides)

# Install guide

**Read this when** you are setting Loskai up from nothing: Loskai itself first, then HTTPS
names for your services.

Loskai installs in three commands and works at once for Docker and your machines. Names like
`https://jellyfin.home.lan` take two more programs and one network setting, in the sections
after it.

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
least to run. [topologies.md](topologies.md#which-one-should-i-run) compares them.

| | AdGuard | Caddy |
|---|---|---|
| [With Proxmox](#with-proxmox-adguard-and-caddy-in-lxcs) | An LXC | An LXC |
| [With a small always-on machine](#with-a-small-always-on-machine-caddy-beside-loskai) | That machine | In Docker, beside Loskai |
| [One machine](#one-machine-all-three-in-docker) | In Docker | In Docker |

## Install AdGuard and Caddy

Follow the one section that fits, then go on to [Set AdGuard up](#set-adguard-up).

### With Proxmox: AdGuard and Caddy in LXCs

In the **Proxmox shell**. Each script makes a small Debian LXC, installs the program and
prints the address it got. Read a script before piping it into a shell:
[create-adguard-lxc.sh](../../scripts/create-adguard-lxc.sh),
[create-caddy-lxc.sh](../../scripts/create-caddy-lxc.sh).

```bash
BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
curl -fsSL $BASE/scripts/create-adguard-lxc.sh | bash
curl -fsSL $BASE/scripts/create-caddy-lxc.sh | bash
```

To choose a container's ID or bridge, set it on the `bash` side:
`… | CTID=110 CT_BRIDGE=vmbr0 bash`.

### With a small always-on machine: Caddy beside Loskai

1. On the small machine — a Raspberry Pi, a mini PC, a NAS that runs containers — install
   AdGuard Home with
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

2. On the Docker host, where ports 80 and 443 must be free, replace `compose.yml` in
   Loskai's folder with the file that has Caddy too, and say where names should point —
   this machine, where Caddy will listen:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.caddy-loskai.yml -o compose.yml
   echo "CADDY_HOST_IP=<this-machine's-address>" >> .env
   docker compose up -d
   ```

   `docker compose ps` lists `caddy` and `loskai`. Your account and settings are as they were.

A container can then join Caddy's network and be routed without publishing a port:
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

### One machine: all three in Docker

Nothing else to buy or set up. What you trade for it: while that machine is down or
restarting, so is your network's DNS.

Ports 80, 443 and 3000 must be free on it. Port 53 only has to be free on its LAN address,
where AdGuard's DNS goes: the resolver most Linux hosts run themselves is on another address
and stays as it is.

In Loskai's folder, replace `compose.yml` with the file that has all three, and say this
machine's address:

```bash
curl -fsSL https://raw.githubusercontent.com/simplysunde/loskai/main/compose.colocated.yml -o compose.yml
echo "CADDY_HOST_IP=<this-machine's-address>" >> .env
docker compose up -d
```

`docker compose ps` lists `adguard`, `caddy` and `loskai`. Your account and settings are as
they were.

## Set AdGuard up

1. Give AdGuard's machine a fixed address in your router (a DHCP reservation), and Caddy's
   LXC too if it has one.
2. Open `http://<adguard-ip>:3000`; on one machine, that is the Docker host's address. Its
   setup asks which port its web interface should use and offers 80: type `3000`, the port
   this guide uses. On one machine it has to be 3000, the only one published. Elsewhere
   another works, as long as the URL you give Loskai names it.
3. Leave DNS on 53, and choose a username and password. You end on AdGuard's dashboard, at
   `http://<adguard-ip>:3000`.

## Tell Loskai where they are

In **Settings** › **Network**, fill in what isn't there already. A compose file with Caddy
or AdGuard in it has set theirs, marked **env**.

- Caddy's **Admin URL**: `http://<caddy-ip>:2019`
- AdGuard's **URL**: `http://<adguard-ip>:3000`, with its **Username** and **Password**

Each saves as you leave it. On **Routing**, the **Caddy** and **AdGuard** rows say
**online**; if one doesn't,
[A module shows unreachable](troubleshooting.md#a-module-shows-unreachable).

Where AdGuard or Caddy has a machine of its own, close its admin port to everyone else:
they control your DNS and your routes. Allow AdGuard's `3000` and Caddy's `2019` only from
the Docker host's address.

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
