[Docs](../README.md) › [Guides](../README.md#guides)

# Troubleshooting

**Read this when** something is broken: a name that shows a blank page, a 502 or a redirect
loop, a name that won't resolve, Caddy or AdGuard shown unreachable, a stack that won't
start, a machine over SSH, or a Dashboard link.

Find what you see, then follow its section. When a routed name fails, the name, its DNS and
its certificate are usually fine, and the trouble is the address Caddy sends it on to: the
*upstream*.

| You see | Go to |
|---|---|
| A blank page: `200` with nothing in it | [A blank page, or an empty 200](#a-blank-page-or-an-empty-200) |
| **502 Bad Gateway** | [502 Bad Gateway](#502-bad-gateway) |
| "The page isn't redirecting properly" | [Redirect loop](#redirect-loop-on-an-https-only-backend) |
| The name isn't found | [A name doesn't resolve](#a-name-doesnt-resolve) |
| A certificate warning | [Certificate warning](#certificate-warning) |
| Names work at home but not over WireGuard | [VPN clients aren't using AdGuard](#vpn-clients-arent-using-adguard) |
| **unreachable** on Routing or Docker, or **Sync didn't finish** | [A module shows unreachable](#a-module-shows-unreachable) |
| A stack fails after **Save** or an install | [A stack won't start after Save](#a-stack-wont-start-after-save) |
| A machine's SSH setup, terminal or tool fails | [A machine over SSH](#a-machine-over-ssh) |
| A Dashboard link doesn't open, or can't be added | [A link doesn't open](#a-link-doesnt-open-or-cant-be-made) |
| Names don't work away from home | [Tailscale: when it doesn't work](tailscale.md#when-it-doesnt-work) |

Some checks below ask Caddy itself. Where Caddy runs decides how:

| Caddy runs | Ask it with |
|---|---|
| In a Proxmox LXC | `pct exec <caddy-ctid> -- curl -s …` on the Proxmox host |
| As a container beside Loskai | `docker exec caddy wget -qO- …` on the Docker host |

---

## A blank page, or an empty 200

The name opens a blank page. `curl -skI https://<name>` shows `200`, `content-length: 0` and
no `Via` header: Caddy answered, but the route never ran. A site in your Caddyfile matches
the name ahead of it, most often a wildcard like `*.home.lan` added by hand.

1. List Caddy's routes on its `:443` server, in the order Caddy tries them:

   ```bash
   pct exec <caddy-ctid> -- curl -s localhost:2019/config/apps/http/servers/srv0/routes \
     | jq '[.[] | {id: ."@id", host: .match[0].host, terminal}]'        # Caddy in an LXC
   docker exec caddy wget -qO- localhost:2019/config/apps/http/servers/srv0/routes \
     | jq '[.[] | {id: ."@id", host: .match[0].host, terminal}]'        # Caddy beside Loskai
   ```

   If that answers nothing, the server has another name: the same command ending in
   `…/config/apps/http/servers | jq keys` lists them.
2. Find an entry with `"terminal": true` whose host matches the name, ahead of the route
   whose `id` is the service's. That entry is the site that answers.
3. Take that site out of the Caddyfile, or narrow it so it no longer matches your names.
   Caddy starts from its saved config, not the Caddyfile, so clear that save:
   [Caddy's saved config](deployment.md#caddys-saved-config). Then click **Sync** on
   **Routing** to put Loskai's routes back.

Two other answers tell other stories:

| `curl` answers | Means |
|---|---|
| `502`, empty | The route ran; Caddy can't reach the service: [502 Bad Gateway](#502-bad-gateway) |
| A TLS error (`curl` exit 35) | Caddy has no route for this name: check its row on **Routing**, and the spelling |

---

## 502 Bad Gateway

Caddy has the route but can't reach the service at its upstream: the address is wrong, or the
service is down.

**Test the address from Caddy's machine.** It tells a wrong address from one Caddy can't
reach:

```bash
pct exec <caddy-ctid> -- curl -sv http://<service-ip>:<port>/      # Caddy in an LXC
docker exec caddy wget -qSO- http://<service-ip>:<port>/            # Caddy beside Loskai
```

- **It answers:** the route's address is wrong. On **Routing**, click the pencil
  (**Change URL**) and fix **Host** and **Port**.
- **It fails:** Caddy can't reach the service. Check the service runs, its port is published,
  and no firewall is in the way. No route setting helps until this works.

**With Caddy in an LXC**, every upstream must be reachable from that LXC: the Docker host's
LAN address and the port the container publishes, like `192.168.10.20:8096`. None of these
work there:

- a container's name, like `jellyfin:8096`: it exists only on the Docker host;
- `localhost` or `127.0.0.1`: that is the LXC itself;
- a port the container doesn't publish (`ports: - "8096:8096"` in its compose file).

Set **Docker Host LAN IP** in **Settings** › **General** and **Add route** fills in the right
address for a container itself.

**With Caddy beside Loskai**, a container's name works only for containers on a network
Caddy is on. Loskai's form offers a name only where it does. Otherwise, use the Docker
host's address and the published port, or
[put the container on Caddy's network](topologies.md#routing-a-container-without-publishing-a-port).

**The container's port changed?** A route that follows its container changes with it. A route
set by hand keeps its address: click its pencil, then **Follow the container**. If the form
says **Docker can't name this container's port**, give the container a `loskai.port` label
([recipe-schema.md](../reference/recipe-schema.md#telling-loskai-the-port--loskaiport)), or
type the address.

---

## Redirect loop on an HTTPS-only backend

The browser says "The page isn't redirecting properly", or "redirected you too many times",
for a service that only speaks HTTPS: Proxmox on port 8006, some NAS pages. Caddy sends it
plain HTTP, and the service sends it back.

1. On **Routing**, click the route's pencil (**Change URL**).
2. Tick **Backend speaks HTTPS** and click **Assign**. Keep **Host** and **Port** as they are,
   like `192.168.10.10` and `8006`. Caddy then accepts the service's own self-signed
   certificate.
3. Open the name again. It shows the service's page.

To see that the service answers over HTTPS, from Caddy's machine:

```bash
pct exec <caddy-ctid> -- curl -skv https://<service-ip>:8006/
```

---

## A name doesn't resolve

The browser can't find `jellyfin.home.lan`, and `nslookup jellyfin.home.lan` finds nothing.

1. Ask AdGuard directly: `nslookup jellyfin.home.lan <adguard-ip>`.
   - **AdGuard answers:** your device asks another DNS server.
     [Point your devices at AdGuard](install.md#point-your-devices-at-adguard), or for
     WireGuard [VPN clients aren't using AdGuard](#vpn-clients-arent-using-adguard).
   - **AdGuard doesn't:** go on to step 2.
2. On **Routing**, look at the row's **DNS** column:
   - **missing:** AdGuard has no answer for the name. Click **Sync**.
   - **conflict:** AdGuard has another answer for the name too. Remove that one in AdGuard,
     under **Filters** › **DNS rewrites**. Loskai never removes a rewrite it didn't write.
   - **unknown:** Loskai can't reach AdGuard:
     [A module shows unreachable](#a-module-shows-unreachable).

**`nslookup` finds it, but the browser doesn't:** the browser asks a DNS service of its own.
Turn off "Secure DNS" or "DNS over HTTPS" in its settings for this network.

**Caddy or AdGuard was just installed again:** it has none of your names yet. Open Loskai by
its address, `http://<docker-host>:8080`, and click **Sync** on **Routing**. It adds every
route and name back.

---

## Certificate warning

The browser warns that `https://<name>` isn't secure. Each device has to trust Caddy's
certificate once.

1. On that device, open `http://<docker-host>:8080/certificate`.
2. Download `caddy-root.crt` and follow the steps the page shows for the device.

More, including phones and Firefox: [certificate-setup.md](certificate-setup.md).

---

## VPN clients aren't using AdGuard

Names work at home but not over WireGuard, or the other way round.

- **DNS:** set `DNS = <adguard-ip>` in the client's `[Interface]`, or as your WireGuard
  server's default DNS for its clients.
- **AllowedIPs must include AdGuard's address**, or the DNS question never enters the
  tunnel. A full tunnel, `0.0.0.0/0`, does. A split tunnel must list AdGuard's LAN subnet.
- **The WireGuard server must route to AdGuard's network**, and AdGuard must let the VPN's
  clients ask: **Settings** › **DNS settings** › **Access settings** in AdGuard. By default
  it lets everyone. A firewall rule on AdGuard's admin port, `3000`, doesn't touch DNS on
  `53`.
- **To tell which:** look in AdGuard's query log. A question from the client's tunnel
  address means DNS is fine. Nothing at all means **AllowedIPs** or routing.

---

## A module shows unreachable

The **Caddy** or **AdGuard** pill on **Routing** says **unreachable**, the **Docker** tab
shows a banner, or **Sync** says **Sync didn't finish** and **Caddy can't be reached** or
**AdGuard can't be reached**. The rest of Loskai goes on working.

1. **Is it running?** With Caddy or AdGuard beside Loskai, run `docker compose ps` in
   Loskai's folder: each should say `Up`. Start one that isn't with `docker compose up -d`.
2. **Is the address right?** Open **Settings** › **Network** and check Caddy's **Admin URL**
   and AdGuard's **URL**. One marked **env** comes from the compose file or `.env`: change it
   there, then `docker compose up -d`.
3. **Can Loskai reach it?** Ask from Loskai's own container, with the two addresses from
   step 2:

   ```bash
   docker exec loskai curl -s -o /dev/null -w '%{http_code}\n' <Admin URL>/config/
   docker exec loskai curl -s -o /dev/null -w '%{http_code}\n' <AdGuard URL>/
   ```

   Any number but `000` means it is there. `000` means Loskai can't reach it: a wrong
   address, or a firewall. If you closed Caddy's `2019` and AdGuard's `3000` to all but the
   Docker host, check the rule allows the Docker host's own address.

When the pill says **online** again, click **Sync** on **Routing**: it puts back what
couldn't be sent while it was away. **Sync didn't finish** lists the real error after the
words, and Loskai's log has it too: `docker logs loskai`.

---

## A stack won't start after Save

**Save**, or **Deploy** in the install wizard, writes the stack's files, then starts it. When
it doesn't start, the editor stays open with what Docker said, and the wizard says **Finished
with errors — check the output.** Your changes are saved either way. The cause is usually
on the Docker host:

- **`bind source path does not exist`:** a folder under **Folders** isn't on the Docker
  host, or is mistyped. Loskai never makes an empty one in its place. Make the folder, or fix
  the row.
- **`error gathering device information`:** an option needs a device the Docker host
  doesn't have. Jellyfin's **Hardware transcoding (Intel/AMD)** needs `/dev/dri/renderD128`:
  `ls /dev/dri` on the host shows whether it is there.
- **`could not select device driver "nvidia"`:** **Hardware transcoding (NVIDIA)** is
  ticked, but the host has no NVIDIA driver or Container Toolkit. `nvidia-smi` has to work
  on the host first.

Fix the folder, or untick the option, under the stack's pencil (**Edit**), and **Save**
again. No option is required: without one, Jellyfin transcodes on the CPU.

---

## A machine over SSH

- **SSH setup says `Can't reach <host>:22`:** the machine is off, its SSH server isn't
  running, or its port is another. Check the port beside the user, under **SSH** › **Login**
  in the machine's dialog.
- **`… refused the password`:** **Install it for me** needs the password of the user you
  gave Loskai, on that machine.
- **`… refused the key`:** Loskai's lines aren't in that user's `~/.ssh/authorized_keys` yet.
  Click **SSH setup** in the machine's dialog and install them again.
- **"This machine's host key has changed."** The machine was reinstalled, or something else
  answers at its address. Click **Trust the new key** only if you know which.
- **"Its status line is older than this Loskai"**, with **Install again**: click it, then
  **Install**. Loskai's own key replaces its lines, with no password — the machine's password
  only if the machine refuses that key.
- **"sudo didn't accept that password for …"**: an update or another run checks `sudo`'s
  password on the machine before it starts. Type it again. **may not use sudo there** means
  that user has no `sudo` at all.
- **"… may not list containers — give it the rights, or sudo."**: add the user to the
  `docker` group, log in as root, or give the user `sudo` without a password for everything.
  Loskai uses no narrower `sudo` rule for this.
- **Unlock Loskai's key** keeps asking: your password unlocks it for 15 minutes. **Settings** ›
  **SSH** › **Keep the key unlocked for** makes that longer.

**A machine with no password**, like an LXC made by Loskai's scripts: **Install it for me**
can't log in the first time, since root has no password and SSH refuses one for root anyway.
Add Loskai's keys from the machine's console instead. After that, **Install again** uses
Loskai's own key, so you only do this once:

1. In **SSH setup**, click **I'll add it myself**, then the copy button beside the two lines.
2. Open the machine's console. For an LXC: its **Console** in Proxmox, which opens as root.
3. Run:

   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   nano ~/.ssh/authorized_keys
   ```

   Delete any old lines ending in `loskai` or `loskai-status` (**Ctrl+K** cuts the line the
   cursor is on): ssh uses the first one, so a new line below an old one is never read.
   Paste the two lines at the end of the file (**Ctrl+Shift+V**, or right-click › **Paste**),
   then save and quit: **Ctrl+O**, **Enter**, **Ctrl+X**. Use an editor, not `cat` or
   `echo`: the second line is about 8,000 characters, and a terminal cuts a typed line off at
   4,095.
4. Run `chmod 600 ~/.ssh/authorized_keys`.
5. In Loskai, click **Test connection**.

**A machine on your tailnet**, added by its `100.x` address:

- **The keys install, then the test right after fails:** the machine sees Loskai come from the
  Docker host's Tailscale address, and Loskai's lines there allow only its LAN one. Set
  **Docker Host Tailscale IP** in **Settings** › **General**, beside **Docker Host LAN IP**,
  which it needs too. Then run the machine's **SSH setup** again.
- **It can't be reached at all:** the Docker host isn't on your tailnet (`tailscale status`
  on it), or your tailnet's access rules keep it from the machine's port 22. The Tailscale
  recipe doesn't put the host itself on the tailnet.
- **Loskai's limits don't seem to apply:** Tailscale SSH is on there (`tailscale up --ssh`).
  It answers SSH on the Tailscale address itself and ignores `authorized_keys`, Loskai's
  lines too. `tailscale set --ssh=false` on the machine turns it off.

More: [Managing a machine on your tailnet](tailscale.md#managing-a-machine-on-your-tailnet).

---

## A link doesn't open, or can't be made

Your browser opens a link straight at its address: Caddy, AdGuard and Loskai aren't in the
way. So open the address itself first, on the same device. If that fails, so does the card.

- **It opens on some devices only:** a `100.x` address opens only on devices running
  Tailscale, and a LAN address away from home only through a [subnet router](tailscale.md).
  Link the LAN address for the household.
- **A certificate warning, or an error page from the app:** **Opens over HTTPS** doesn't
  match the app. Ticked, the app must speak HTTPS; unticked, plain HTTP. Proxmox on `8006`
  speaks only HTTPS. Click the link's pencil (**Edit link**) and change it. An app with its
  own self-signed certificate warns once per device.
- **"Loskai doesn't know this host's LAN IP"**, at an install's last step: set **Docker Host
  LAN IP** in **Settings** › **General**.
- **"It has no single port a browser can reach"**, or **"… has no single published port on a
  known address"**: the container publishes no port, several, or one only on `127.0.0.1`.
  Publish one port, give the container a `loskai.port` label, or type the address.
- **"… is routed at … — remove its route first"**: it has an HTTPS name already. Remove the
  route with the broken link (**Remove route**) on its row, then click the chain
  (**Make a link**).
- **"… is the link … — use Give it an HTTPS name on its row"**: a link already has that
  name. Click **+** (**Give it an HTTPS name**) on the link's row instead: the link becomes
  the route.
- **Only Add link, no Add route and no Sync:** Caddy isn't set up, so Loskai makes links
  only. Fill in Caddy's **Admin URL** in **Settings** › **Network** to route:
  [Add names later](install.md#add-names-later).
