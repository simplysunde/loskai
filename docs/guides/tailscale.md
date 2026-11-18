[Docs](../README.md) › [Guides](../README.md#guides)

# Reaching your homelab from outside, with Tailscale

**Read this when** you want your names — `https://jellyfin.home.lan`, Loskai itself — to work
on your phone or laptop away from home, without opening anything to the internet.

[Tailscale](https://tailscale.com) joins your devices into one private network, a
*tailnet*. One machine at home runs it as a **subnet router**: it shares your home network
with the tailnet. Tailscale's **split DNS** then sends your base domain's names to AdGuard.
Away from home, with Tailscale on, a device gets the same names, certificates and routes as
at home. Nothing in Loskai changes.

```
phone (Tailscale on) ──tailnet──▶ subnet router at home ──LAN──▶ Caddy ──▶ the service
        └── "jellyfin.home.lan?" ──split DNS──▶ AdGuard ──▶ Caddy's address
```

## Where Tailscale runs

Not on everything. Routes keep using home addresses; Tailscale only adds the way in.

| Device | Tailscale | How |
|---|---|---|
| Your phone, your laptop | **Yes** | Tailscale's app, logged in to your tailnet |
| One box at home, the **subnet router** | **Yes** | Its Tailscale tool, or the recipe: [step 1](#1-run-the-subnet-router) |
| A machine away from home: a VPS, a box elsewhere | **Yes** | Tailscale's own install |
| The Docker host Loskai runs on | Only to manage machines on the tailnet | Its Tailscale tool: [below](#managing-a-machine-on-your-tailnet) |
| Caddy's box | Only to route to machines on the tailnet | Tailscale's own install: [below](#routing-to-a-machine-on-your-tailnet) |
| Everything else at home: servers, the NAS, AdGuard, PCs | **No** | Reached at home, and through the subnet router from outside |

One box can be several of these. A Docker host with Tailscale on it can be the subnet router
too: switch **Share this network** on, on its Tailscale card, rather than installing the
recipe as well.

A device without Tailscale still uses all of Loskai at home. It can't open a tailnet address
itself.

## 1. Run the subnet router

One is enough. Pick the box:

| Where | How |
|---|---|
| **Any machine on the Machines tab**: the Docker host, a VM, an LXC, a Raspberry Pi | Its Tailscale tool: [From the Machines tab](#from-the-machines-tab) |
| **The Docker host, without installing Tailscale on it** | The Tailscale recipe: [The recipe](#the-recipe) |

### From the Machines tab

The machine needs [SSH set up](using-loskai.md#set-up-ssh). In a Proxmox LXC, first give it a
TUN device, on the Proxmox host, then restart the LXC:

```bash
pct set <CTID> -dev0 /dev/net/tun
```

1. Open the machine's dialog (the cog on its row). Under **Tools**, click **Add tool** ›
   **Tailscale**. It installs Tailscale with Tailscale's own installer, and a **Tailscale**
   card appears.
2. On the card, switch **Connected** on. A terminal shows a link: open it and log in. The card
   then shows the machine's Tailscale address. If it says **Waiting for your tailnet to
   approve this device**, click **Approve** and approve it there.
3. Switch **Share this network** on and type `sudo`'s password if asked. It shares the
   network the machine is on: `192.168.10.0/24` for an address in `192.168.10.x`. The card
   says **waiting for approval** until you approve it in [step 2](#2-two-settings-in-tailscales-admin-console).
   Its **Approve** link goes there.

Under the switches, **Tailnet** lists your other devices, each with its address and whether
it is online.

Switching **Share this network** off stops sharing every network the machine shares, also
one added by hand. IP forwarding stays on until the machine restarts, since Docker needs it
too.

### The recipe

It changes nothing on the Docker host: Tailscale runs in its container only.

1. On the **Docker** tab, click **Install recipe**, pick **Tailscale** and click **Continue**.
2. Answer its three questions:
   - **Network to share**: your home network, like `192.168.10.0/24`.
   - **Its name on your tailnet**.
   - **Auth key**: optional, and used once. Leave it empty to log in with a link.
3. Click **Deploy**. Without an auth key, the last step says **Waiting for its link…**, then
   shows **Open its link**: open it and log in.

The link works for an hour. After that the container starts over with a new one, at the end
of its **Logs**: the line after `To authenticate, visit:`.

The login is kept in the stack's `state/` folder. Deleting the stack with **Also delete its
data** logs it out.

## 2. Two settings in Tailscale's admin console

At [login.tailscale.com/admin](https://login.tailscale.com/admin):

1. **Machines** › the router's **⋯** menu › **Edit route settings**: approve the network it
   shares. Until then, nothing goes through it. On the same menu, click **Disable key
   expiry**, or the router logs itself out after 180 days and the way in closes without a
   word.
2. **DNS** › **Nameservers** › **Add nameserver** › **Custom**: your AdGuard's address. Turn
   on **Restrict to domain** and give your base domain, `home.lan`. Only your names go to
   AdGuard; everything else resolves as before.

On the router's Tailscale card, **Share this network** now shows the network and a link to
**Split DNS**.

## 3. Check it

On your phone, off your home Wi-Fi, with Tailscale on, open `https://loskai.<your domain>`.
It loads as it does at home. A certificate warning means the phone hasn't trusted Loskai's
certificate yet: [Trusting the certificate](certificate-setup.md), once, as at home.

A Linux laptop also needs `sudo tailscale set --accept-routes`, once: Linux ignores a subnet
router until told to use one. Phones, Windows and macOS don't.

## Managing a machine on your tailnet

A machine on your tailnet but not your home network, like a VPS or a box at a friend's, can
be on the Machines tab like any other: its terminal, its tools, what runs there. Loskai's
connection to it comes from the Docker host, so the Docker host needs Tailscale too.

1. **Put the Docker host on your tailnet.** On the Machines tab, name the Docker host (its
   row is first), [set up its SSH](using-loskai.md#set-up-ssh), then **Add tool** ›
   **Tailscale** in its dialog and switch **Connected** on. Its dialog's overview then shows
   its Tailscale address. The recipe won't do here: it leaves the host itself off the tailnet.
2. **Settings** › **General** › **Docker Host Tailscale IP**: that address. **Docker Host LAN
   IP** must be set too. **Tailscale on the Docker host**, under the field, goes to the Docker
   host's machine.
3. **Name the machine** on the Machines tab by its Tailscale address, `100.x.y.z`, and set up
   its SSH as for any machine.

Loskai's lines on each machine let it in from the Docker host's home address and from its
Tailscale address, so a machine reached either way needs nothing more. A machine set up
before step 2 keeps its old lines: run its **SSH setup** again if you reach it over
Tailscale. The browser you use needn't run Tailscale.

- **Name each machine once**, by one address. The same box named twice is two machines.
- **Leave Tailscale SSH off** (`tailscale up --ssh`) on a machine Loskai manages. It answers
  SSH on the Tailscale address itself and ignores Loskai's limits.
- **Its name answers its Tailscale address**, so it opens only on devices running Tailscale.
- A device keeps its Tailscale address unless it leaves the tailnet. If the Docker host's
  changes, update the field and run **SSH setup** again on the tailnet machines.

## Routing to a machine on your tailnet

A service on such a machine gets a name like any other, `app.home.lan`, for everyone at home
without Tailscale. Caddy's box needs Tailscale, with Tailscale's own install. Then
[add the route](using-loskai.md#add-a-route) with the machine's Tailscale address and the
service's port. Without Tailscale on Caddy's box the route is made, but every visit fails
with `502`.

## When it doesn't work

- **The name doesn't resolve:** split DNS isn't set, or is restricted to another domain. In
  AdGuard's query log, a lookup from the router's address means DNS works and the problem is
  the route.
- **It resolves but doesn't load:** the network isn't approved (step 2.1), or the router's
  network isn't the one the service is on. On a Linux laptop, also `sudo tailscale set
  --accept-routes`.
- **The router shows in the admin console, goes offline, and asks to log in again:** the
  login was finished after its hour was up, and the container started over as a new device.
  Delete the stale device in the console, then log in with the newest link at the end of the
  container's **Logs**. A Tailscale recipe installed before 2026-11-11 waited a minute only:
  **Check for updates** gives it the hour.
- **It worked for months, then stopped:** the router's key expired, after 180 days by default.
  Log it in again, and click **Disable key expiry** on its ⋯ menu (step 2.1).
- **A link to a `100.x` address doesn't open:** that device isn't running Tailscale. For
  everyone at home, link the home address, or
  [route it](#routing-to-a-machine-on-your-tailnet).
- **It works on mobile data but not on someone else's Wi-Fi:** their network uses the same
  range as yours (`192.168.1.x` is common), and their own devices win. Moving your home
  network to a less common range avoids it.
