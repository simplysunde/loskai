[Docs](../README.md) › [Guides](../README.md#guides)

# Reaching your homelab from outside, with Tailscale

**Read this when** you want your routed names — `https://jellyfin.home.lan`, Loskai itself —
to work on your phone or laptop away from home, without opening anything to the internet.

[Tailscale](https://tailscale.com) joins your devices into one private network, a
*tailnet*. One machine at home runs it as a **subnet router**: it shares your LAN with the
tailnet. Tailscale's **split DNS** then sends your base domain's names to AdGuard. Away from
home, with Tailscale on, a device asks AdGuard for a name, gets Caddy's address, and reaches
it through the router — the same names, the same certificates, the same routes as at home.
Loskai changes nothing for this; it keeps working on the LAN as before.

```
phone (Tailscale on) ──tailnet──▶ subnet router at home ──LAN──▶ Caddy ──▶ the service
        └── "jellyfin.home.lan?" ──split DNS──▶ AdGuard ──▶ Caddy's address
```

## 1. Run the subnet router

One is enough — pick the box:

| Where | How |
|---|---|
| **The Docker host** | The **Tailscale** recipe, from the Docker tab's install wizard |
| **Any other box** — a VM, an LXC, a Raspberry Pi | `scripts/tailscale-subnet-router.sh`, run on it |

Either asks the same three things: the network to share (your LAN, `192.168.10.0/24`), the
device's name on the tailnet, and an **auth key**, which is optional. Without one, Tailscale
prints a login link — open it and log in to your tailnet. Either way the key is used once;
the device stays logged in after.

### The recipe

Install **Tailscale** from the Docker tab like any recipe. With no auth key, open the
container's logs on its row: the link is on the line after `To authenticate, visit:`.
It waits an hour; after that the container starts over, with a new link at the end of
its logs.

It runs in *userspace networking*: no TUN device, no extra rights, nothing changed on the
Docker host. Its login is kept in `state/` beside its compose file.

### The script

On the box, as root — the same `BASE` as the [install guide](install.md):

```bash
BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
curl -fsSL $BASE/scripts/tailscale-subnet-router.sh | bash
```

It installs Tailscale (with Tailscale's own install script), shares the network the box's
default route is on, and names the device after the box. To choose instead, put the values
on the `bash` side of the pipe:

```bash
curl -fsSL $BASE/scripts/tailscale-subnet-router.sh | TS_ROUTES=192.168.10.0/24 TS_HOSTNAME=home-lan bash
```

It needs systemd (Debian, Ubuntu, Raspberry Pi OS and the like) and is safe to run again.

**In a Proxmox LXC** there is no TUN device unless Proxmox gives it one, so the script falls
back to userspace networking — it works, more slowly. For kernel mode, on the Proxmox host:

```bash
pct set <CTID> -dev0 /dev/net/tun
```

then restart the LXC and run the script again; it switches back by itself.

## 2. Two settings in Tailscale's admin console

At [login.tailscale.com/admin](https://login.tailscale.com/admin):

1. **Machines** → the router's **⋯** menu → **Edit route settings** → approve the network
   it shares. Until then, nothing goes through it.
2. **DNS** → **Nameservers** → **Add nameserver** → **Custom**: your AdGuard's address.
   Turn on **Restrict to domain** and give your base domain (`home.lan`). This is split DNS:
   only your Loskai names go to AdGuard, everything else as before.

## 3. Check it

On your phone, off your home Wi-Fi, with Tailscale on: open `https://loskai.<your domain>`.
It loads as it does at home. A device that warns about the certificate is one that hasn't
installed Loskai's root yet — [Certificate onboarding](certificate-setup.md), once, as on
the LAN.

## When it doesn't work

- **The name doesn't resolve** — split DNS isn't set, or is restricted to another domain.
  AdGuard's **Query Log** shows the lookups that reach it; one from the router's address
  means DNS works and the problem is the route.
- **It resolves but doesn't load** — the route isn't approved (step 2.1), or the box's
  network isn't the one the service is on.
- **It works on mobile data but not on someone else's Wi-Fi** — their network uses the
  same range as yours (`192.168.10.x` is common), and their own devices win. Moving your
  home network to a less common range avoids it.

## Why a subnet router, and not Tailscale instead of AdGuard or Caddy

- **Instead of AdGuard:** Tailscale's MagicDNS names *devices* (`docker.your-tailnet.ts.net`),
  not services, and takes no names of your own — split DNS sends them to AdGuard anyway.
- **Instead of Caddy:** `tailscale serve` gives a device a trusted certificate, but one
  name per device — services become ports or paths, not `jellyfin.home.lan`. A name per
  service means a Tailscale node per service, and Loskai holding a Tailscale API key; it
  keeps no third-party keys.

The subnet router keeps what Loskai already gives, and only adds the way in.
