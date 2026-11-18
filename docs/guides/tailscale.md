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

## Where Tailscale runs

Not on everything. Routes keep using LAN addresses; Tailscale only adds the ways in.

| Device | Tailscale | How | Why |
|---|---|---|---|
| Your phone, your laptop | **Yes** | Tailscale's app, logged in to your tailnet | How you get in from outside |
| One box at home — the **subnet router** | **Yes** | Its Tailscale tool, or the recipe ([step 1](#1-run-the-subnet-router)) | Shares your LAN with the tailnet |
| A machine away from home — a VPS, a box elsewhere | **Yes** | Tailscale's own install | The only way to reach it |
| The Docker host Loskai runs on | Only to manage machines on the tailnet | Tailscale's own install — from Loskai, its Tailscale tool — then its address in Settings | Loskai's SSH connects from here — [below](#managing-a-machine-on-your-tailnet) |
| Caddy's box | Only to route to machines on the tailnet | Tailscale's own install | Caddy connects from here — [below](#routing-to-a-machine-on-your-tailnet) |
| Everything else — servers, the NAS, AdGuard, PCs at home | **No** | — | Reached on the LAN, and through the subnet router from outside |

One box can be several of these: a Docker host with Tailscale installed can be the subnet
router too — switch **Share this network** on, on its Tailscale card, rather than the recipe as well.

A device without Tailscale still uses all of Loskai — its page opens on the LAN, and Loskai
makes the connections from the Docker host. It can't open a tailnet address itself.

## 1. Run the subnet router

One is enough — pick the box:

| Where | How |
|---|---|
| **Any machine on the Machines tab** — the Docker host, a VM, an LXC, a Raspberry Pi | Its **Tailscale** tool ([below](#from-the-machines-tab)) |
| **The Docker host, without installing Tailscale on it** | The **Tailscale** recipe, from the Docker tab's install wizard ([below](#the-recipe)) |

### From the Machines tab

On a machine with SSH set up, its dialog's **Tools** → **Add tool** → **Tailscale** installs
it, with Tailscale's own installer. On its card, switch **Connected** on: the terminal shows
a link to log it in. It then shows the machine's Tailscale address — or **Waiting for your
tailnet to approve this device**, with a link to **Approve** it, where your tailnet approves
devices. Under the switches, **Tailnet** lists your other devices, each with its address and
whether it is online. Then switch **Share this network** on: it asks for sudo's password,
turns on IP forwarding and shares the network the machine is on — `192.168.10.0/24` for an
address in `192.168.10.x`. It says **waiting for approval** until step 2.1 is done (its
**Approve** link goes there), and links to **Split DNS** (step 2.2) after. Switching it off
stops sharing — every network the machine shares, also one added by hand — and removes the
setting that turned forwarding on at boot, but leaves forwarding on until the machine
restarts: Docker needs it too, and turning it off would cut the containers on a Docker host
off from the network.

**In a Proxmox LXC**, Tailscale needs a TUN device, which Proxmox gives a container only when
asked. On the Proxmox host, before adding the tool:

```bash
pct set <CTID> -dev0 /dev/net/tun
```

then restart the LXC.

### The recipe

Install **Tailscale** from the Docker tab like any recipe. It asks the network to share (your
LAN, `192.168.10.0/24`), the device's name on the tailnet, and an **auth key**, which is
optional and used once. With no auth key, the wizard's last step shows the login link once
Tailscale prints it — open it and log in. It waits an hour; after that the container starts
over with a new link, at the end of its logs on the Docker tab (the line after `To
authenticate, visit:`).

It runs in *userspace networking*: no TUN device, no extra rights, nothing changed on the
Docker host. Its login is kept in `state/` beside its compose file.

## 2. Two settings in Tailscale's admin console

At [login.tailscale.com/admin](https://login.tailscale.com/admin):

1. **Machines** → the router's **⋯** menu → **Edit route settings** → approve the network
   it shares. Until then, nothing goes through it. On the same menu, **Disable key expiry** —
   otherwise the router logs itself out after 180 days, and the way in closes unannounced.
2. **DNS** → **Nameservers** → **Add nameserver** → **Custom**: your AdGuard's address.
   Turn on **Restrict to domain** and give your base domain (`home.lan`). This is split DNS:
   only your Loskai names go to AdGuard, everything else as before.

## 3. Check it

On your phone, off your home Wi-Fi, with Tailscale on: open `https://loskai.<your domain>`.
It loads as it does at home. A device that warns about the certificate is one that hasn't
installed Loskai's root yet — [Certificate onboarding](certificate-setup.md), once, as on
the LAN.

A Linux laptop also needs `sudo tailscale set --accept-routes` once — Linux ignores a
subnet router until told to use one; phones, Windows and macOS don't.

## Managing a machine on your tailnet

A machine that is on your tailnet but not your LAN — a VPS, a box at a friend's — can be on
the Machines tab like any other: its terminal, its tools, what runs there.

1. **Tailscale on the Docker host** Loskai runs on, with Tailscale's own install (not the
   recipe, which leaves the host itself off the tailnet). Loskai can do it: name the Docker
   host on the Machines tab (its row is first), set up its SSH, then **Add tool** →
   **Tailscale** in its dialog, and switch **Connected** on. Its overview then shows the address — or
   `tailscale ip -4` there prints it. **Tailscale on the Docker host**, under the field in
   step 2, goes to that machine, as far as it has got.
2. **Settings › General › Docker Host Tailscale IP**: that address (or `HOST_TAILSCALE_IP`).
   **Docker Host LAN IP** must be set too.
3. **Add the machine** on the Machines tab by its Tailscale address (`100.x.y.z`), and set up
   SSH as for any machine.

Loskai's keys are allowed from the Docker host's LAN address and from its Tailscale address,
on every machine — a machine reached either way needs nothing else. A machine set up before
the field was filled keeps its old lines: run its SSH setup again only if you reach it over
Tailscale. The browser you use needn't run Tailscale; the Docker host makes the connection.

- **Add each machine once.** One with a LAN address is added by it; the same box added twice
  is two machines.
- **Leave Tailscale SSH off** (`tailscale up --ssh`) on a machine Loskai manages: it answers
  SSH on the Tailscale address itself and ignores `authorized_keys` — Loskai's limits
  included, such as the status key only reading.
- **Its name answers its Tailscale address** — it opens on devices running Tailscale only.
- A device keeps its Tailscale address unless it is removed from the tailnet. If the Docker
  host's changes, update the field and run SSH setup again on the tailnet machines.

## Routing to a machine on your tailnet

A service on such a machine gets a name like any other — `app.home.lan` for everyone at
home, no Tailscale needed — once **Caddy's box runs Tailscale** (Tailscale's own install).
Then route it with its Tailscale address and port as the upstream; Caddy connects over the
tailnet. Without Tailscale on Caddy's box the route is made, but every visit fails with
`502`.

## When it doesn't work

- **The name doesn't resolve** — split DNS isn't set, or is restricted to another domain.
  AdGuard's **Query Log** shows the lookups that reach it; one from the router's address
  means DNS works and the problem is the route.
- **It resolves but doesn't load** — the route isn't approved (step 2.1), or the box's
  network isn't the one the service is on. On a Linux laptop, also `sudo tailscale set
  --accept-routes`: Linux ignores a subnet router until told to use one.
- **The router shows in the admin console, then goes offline, and asks to log in again** —
  the login was finished after its window closed: the container started over as a new
  device, with a new link. A recipe installed before that was fixed waited only a minute;
  **Check for updates** gives it an hour. Delete the stale device in the console, then log in with
  the newest link at the end of the container's logs.
- **It worked for months, then stopped** — the router's key expired (180 days by default).
  Log it in again, and **Disable key expiry** on its ⋯ menu (step 2.1).
- **A link to a `100.x` address doesn't open** — that device isn't running Tailscale. A
  Tailscale address opens only on the tailnet; for everyone at home, link the LAN address,
  or route it ([Routing to a machine on your tailnet](#routing-to-a-machine-on-your-tailnet)).
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
