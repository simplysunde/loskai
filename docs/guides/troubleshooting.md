[Docs](../README.md) › [Guides](../README.md#guides)

# Troubleshooting

**Read this when** something is broken: a 502, a redirect loop, a name that won't resolve, a
module shown unreachable, a stack that won't start, a Dashboard link, SSH to a machine, or
reaching it all from outside with Tailscale.

Common failures once Loskai is routing traffic, and how to tell them apart. The recurring
theme: **DNS, TLS, and the route can all be fine while the *upstream* (the backend Caddy
dials) is misconfigured** — most "site won't load" reports are upstream problems, not Loskai,
Caddy, or DNS.

Quickest triage — a name that's routed but failing almost always falls into one of these:

| Symptom | Layer | Jump to |
|---|---|---|
| **Blank page, `200` with an empty body** | route shadowed | [Empty 200](#a-blank-page-or-an-empty-200) |
| **502 Bad Gateway** | upstream unreachable | [502](#502-bad-gateway) |
| **Redirect loop** ("redirecting in a way that will never complete") | upstream scheme | [Redirect loop](#redirect-loop-on-an-https-only-backend) |
| Name doesn't resolve at all | DNS | [Won't resolve](#a-name-doesnt-resolve) |
| Cert warning / "not secure" | TLS trust | [Cert warning](#certificate-warning) |
| VPN clients ignore AdGuard | routing | [VPN DNS](#vpn-clients-arent-using-adguard) |
| Caddy, AdGuard or Docker shows unreachable | reachability | [Unreachable](#a-module-shows-unreachable) |
| A stack fails after Save or install | the Docker host | [Stack won't start](#a-stack-wont-start-after-save) |
| A machine's SSH, terminal or tool fails | SSH | [Machines](#a-machine-over-ssh) |
| A Dashboard link doesn't open, or can't be added | the link's address | [Links](#a-link-doesnt-open-or-cant-be-made) |
| Names don't work away from home | Tailscale | [The Tailscale guide](tailscale.md#when-it-doesnt-work) |

---

## A blank page, or an empty 200

The name resolves, the cert is trusted, and Caddy answers **`200` with `content-length: 0`**
and no `Via` header. Nothing is broken downstream: **your route never ran.** Something ahead
of it in Caddy's `routes` array matched first and terminated.

The usual something is a site block in the Caddyfile that matches the name — a wildcard
like `*.home.example` added by hand, or the `*.{$BASE_DOMAIN}` block Loskai's own Caddyfile
had until 2026-11-08. A site block adapts to a **`"terminal": true` route**, which the
Caddyfile adapter places first; one with no handlers answers an empty `200`. Any route
sitting behind it that it also matches is dead. Loskai's Caddyfile now has no site that
matches a routed name — its `localhost` site only gives Caddy the `:443` server.

**Three responses from the same Caddy tell the three cases apart:**

| Response | Meaning |
|---|---|
| `200`, empty body, no `Via` | route shadowed — it never ran |
| `502`, empty body | route ran; Caddy couldn't reach the upstream ([502](#502-bad-gateway)) |
| TLS handshake failure (`curl` exit 35) | no route and no cert for that name at all |

**Check the order directly:**

```
curl -s http://<caddy>:2019/config/apps/http/servers/srv0/routes | jq '[.[] | {id: ."@id", host: .match[0].host, terminal}]'
```

The `:443` server may not be called `srv0` — Loskai finds it by its listener;
`curl -s http://<caddy>:2019/config/apps/http/servers | jq keys` lists the names. Every
route Loskai pushes must come **before** any `terminal` entry that matches its host.
Loskai has inserted at the head since 2026-09-05 (`PUT …/routes/0`); builds before that
appended, so **every route was shadowed** wherever Caddy ran with the real `BASE_DOMAIN` in
that block — the co-located and split-DNS layouts. Update, then re-push from
**Routing → Sync**.

A name you have *not* routed has no certificate, so the browser stops at the TLS handshake
(`curl` exit 35, the last row above) — check Routing, or the spelling.

---

## 502 Bad Gateway

Caddy matched the route and terminated TLS, but **couldn't reach the backend** it was told to
dial. The route, cert, and DNS are all fine — the `upstream` value is wrong or the target is
down.

**The rule (split-LXC / preferred layout):** Caddy runs in its **own LXC**, so every upstream
must be reachable *from that box* — a **LAN `IP:port`**. These do **not** work in this layout:

- a **Docker service name** (`jellyfin:8096`) — only resolves on the Docker network, which the
  separate Caddy LXC doesn't share;
- `localhost` / `127.0.0.1` — that's the Caddy LXC itself, not your service;
- a container's **internal** port that isn't **published** on the host.

Use the **Docker host's LAN IP + the container's published host port** (e.g.
`192.168.10.50:8096`), and make sure the container actually publishes it (`ports: - "8096:8096"`).

> **Tip:** set **`HOST_IP`** (Settings → *Docker Host LAN IP*, or the env var) once and Loskai
> auto-fills this `<host_ip>:<published-port>` when you route a container — no need to type it
> per service. (A container published to a *specific* IP is detected automatically.)

> **When Caddy itself runs as a container**, a `name:port` upstream resolves **only** for
> containers on a Docker network Caddy is actually attached to. Compose isolates every project
> on its own `<project>_default`, so Caddy reaches the containers in *its own* compose file and
> not the stacks Loskai manages — those are separate projects. For a managed stack, either use
> the Docker host's LAN IP + published port as above, or attach Caddy and the target to a
> shared network yourself.
>
> Loskai's Add-Route hint checks whether Caddy's container and the target actually share a
> Docker network, so it suggests `name:port` only where that resolves and the host's published
> port everywhere else. A 502 here therefore points at the plumbing rather than the hint —
> confirm with the test below. See
> [topologies.md](topologies.md#docker-service-names-are-not-automatically-resolvable).

> **A container's port changed since it was routed?** A route that **follows its container**
> (the default for one routed from the Container source — its address is greyed out in the
> form) is rewritten when the container starts on the new port, including after a re-up over
> SSH. A route **set by hand** keeps the address it was given: open it under Routing and choose
> *Follow the container*. If a following route still 502s, Docker can't name the port — the
> form says so — and a `loskai.port` label fixes that
> ([recipe-schema.md](../reference/recipe-schema.md#telling-loskai-the-port--loskaiport)).

**The decisive test** — run it *from inside the Caddy LXC*; it separates config from plumbing:

```bash
pct exec <caddy-ctid> -- curl -sv http://<target-ip>:<port>/
```

- **Succeeds** → the fix is the upstream value in the route (Routing tab → **Change URL**).
- **Fails** → it's reachability (unpublished port, firewall, wrong IP); no route setting helps
  until this `curl` works.

See exactly what Caddy is dialing for each route:

```bash
pct exec <caddy-ctid> -- curl -s localhost:2019/config/ | jq '.apps.http.servers'
```

---

## Redirect loop on an HTTPS-only backend

"The page isn't redirecting properly" / "redirecting in a way that will never complete" on a
backend that only speaks HTTPS (**Proxmox `:8006`**, some NAS UIs, etc.). Caddy defaults to
dialing the upstream over **plain HTTP**; an HTTPS-only backend then bounces the request.

**Fix:** on that route, tick **"Backend speaks HTTPS"** (sets `upstream_tls` → Caddy dials over
TLS with cert verification skipped, for the backend's self-signed cert). Upstream stays the LAN
`IP:port`, e.g. `192.168.10.10:8006`.

Verify from the Caddy LXC with the `-k` (insecure) + `https` form:

```bash
pct exec <caddy-ctid> -- curl -skv https://<target-ip>:8006/
```

---

## A name doesn't resolve

`nslookup grafana.example.no` returns nothing / NXDOMAIN.

- **Is the client using AdGuard?** `nslookup grafana.example.no <adguard-ip>` — if *that* works
  but the default resolver doesn't, your device isn't pointed at AdGuard (see
  [VPN DNS](#vpn-clients-arent-using-adguard) or
  [Point your devices at AdGuard](install.md#point-your-devices-at-adguard)).
- **Only the browser can't find it?** `nslookup` answers but the browser says the site can't be
  reached: the browser is asking a DNS service of its own ("Secure DNS", "DNS over HTTPS" in
  its settings). Turn that off for this network.
- **Cold start:** a brand-new Caddy/AdGuard has no routes or rewrites yet. Reach Loskai directly
  at `http://<docker-host>:8080` and click **Sync** on the Routing tab to seed every route +
  DNS rewrite.
- **Rewrite missing:** the AdGuard rewrite is best-effort on assign. On the Routing tab the
  row's DNS column then says **missing** (or **conflict**, when AdGuard has another answer for
  the name too); **Sync** adds it.

---

## Certificate warning

Browser warns the cert isn't trusted on `https://<name>.<domain>`. Expected in the default
**internal-CA** mode — Caddy signs with its own root, which devices don't trust until you
install it **once**. Open Loskai's Certificate page (`http://<docker-host>:8080/certificate`)
on the device and follow it — or `http://<caddy-ip>/`, which works with Loskai stopped.
Full walkthrough: [certificate-setup.md](certificate-setup.md).

---

## VPN clients aren't using AdGuard

Names resolve on the LAN but not over WireGuard (or vice-versa).

- Set `DNS = <adguard-ip>` in the client `[Interface]` (or your WG server's default-DNS).
- **`AllowedIPs` must cover the AdGuard IP** — otherwise the DNS query never enters the tunnel.
  Full tunnel (`0.0.0.0/0`) covers it; a split tunnel must include AdGuard's LAN subnet.
- The WG server must route to AdGuard's LAN, and AdGuard's **DNS access settings** must allow
  the VPN client range (default allows all; note this is `:53`, unaffected by the `:3000`
  REST-API firewall rule).
- Confirm via AdGuard's **Query Log** — the lookup should appear from the client's tunnel IP.
  Empty log = a routing (`AllowedIPs`) problem, not the `DNS =` line.

---

## A module shows unreachable

When Loskai can't reach a service's API, the Routing tab's **Caddy** or **AdGuard** row says
so, the Docker tab shows a banner for Docker, and the sidebar puts a dot by the tab. Each
module degrades independently — one down never blocks the others.

- Re-check the service's URL in **Settings** (or the env var) and that the IP/port is right.
- The API must be reachable **from the Docker host** (where Loskai runs). If you firewalled the
  API to the Docker host, confirm that host is actually the source. AdGuard REST is `:3000`,
  Caddy admin is `:2019`.
- `curl` the API from the Docker host to confirm before blaming Loskai.

---

## A stack won't start after Save

Save (or the install wizard) writes the files, then runs `docker compose up -d`; when that
fails, the editor shows Compose's output above **Cancel** and **Save**, and the files stay
saved. The
usual causes are on the Docker host, not in Loskai:

- **`bind source path does not exist`** — a folder under Folders isn't there, or is
  mistyped. Loskai mounts folders with `create_host_path: false` on purpose, so a typo fails
  instead of mounting an empty folder. Create it on the Docker host, or fix the row.
- **`error gathering device information`** — an option passes a device the host lacks
  (Jellyfin's Intel/AMD transcoding needs `/dev/dri/renderD128`; `ls /dev/dri` shows it).
- **`could not select device driver "nvidia"`** — the NVIDIA option is ticked but the host
  has no NVIDIA driver or Container Toolkit; `nvidia-smi` must work there first.

Either way, untick the option (or fix the folder) under Edit and Save again. An option is
never required: unticked, Jellyfin still runs and transcodes on the CPU.

---

## A machine over SSH

- **"Loskai's key is locked"** — your password unlocks it for you, for 15 minutes unless
  Settings › SSH says longer. A dialog asks for it when you do something that needs it; a
  **Locked** field asks when clicked. Cancelled, the action is not done.
- **"This machine's host key has changed."** — the machine was reinstalled, or something
  else answers at its address. **Trust the new key** only if you know why.
- **"Its status line is older than this Loskai — install again"** — press **Install again**
  beside it.
- **"sudo didn't accept that password for …"** — an automatic run checks sudo's password on
  the machine before it starts; type it again. "may not use sudo there" means the user has
  no sudo at all.
- **"… may not list containers — give it the rights, or sudo."** — add the user to the
  `docker` group, or give it `sudo` for `docker ps` (`pct list` and `qm list` on Proxmox).

**A machine on your tailnet** (added by its `100.x` address):

- **The keys install, then the test right after fails** — the machine sees Loskai's
  connection come from the Docker host's Tailscale address, and its keys only allow the LAN
  one. Set **Docker Host Tailscale IP** in Settings › General (beside **Docker Host LAN IP**,
  which it needs), then run its SSH setup again. A machine set up before the field was
  filled keeps its old lines until then.
- **It can't be reached at all** — the Docker host isn't on the tailnet (`tailscale status`
  there), or your tailnet's access rules don't let it reach the machine's port 22. Tailscale
  in the recipe doesn't count: it leaves the host itself off the tailnet.
- **Loskai's limits don't seem to apply** — Tailscale SSH is on there (`tailscale up
  --ssh`): it answers SSH on the Tailscale address itself and ignores `authorized_keys`,
  Loskai's lines included. `tailscale set --ssh=false` on the machine turns it off.

More in [Managing a machine on your tailnet](tailscale.md#managing-a-machine-on-your-tailnet).

---

## A link doesn't open, or can't be made

A link is opened by your browser, straight at its address — Caddy, AdGuard and Loskai are
not in the way. So first open the address itself, or `curl -sI http://<ip>:<port>` from the
same device: if that fails, so will the card.

- **It opens on some devices only** — a `100.x` (Tailscale) address opens only on devices
  running Tailscale; a LAN address from outside only through a
  [subnet router](tailscale.md). Link the LAN address for the household.
- **A certificate warning, or an error page from the app** — **Opens over HTTPS** may not
  match it: ticked for one that speaks plain HTTP, or unticked for one that only speaks
  HTTPS (Proxmox, `:8006`). Edit the link and flip it. A self-signed app warns once per device.
- **"Loskai doesn't know this host's LAN IP"** (the install's last step) — set **Docker Host
  LAN IP** in Settings › General, so Loskai can say where a browser reaches a container.
- **"It has no single port a browser can reach"**, or **"… has no single published port on a
  known address"** — the container publishes no port, or several, or only on `127.0.0.1`
  (which opens on each viewer's own device). Publish one port, give it a `loskai.port`
  label, or type the address.
- **"… is routed at … — remove its route first"** — it has an HTTPS name already. A route
  doesn't turn into a link: **Remove route** on its row, then add the link.
- **"… is the link … — give it this name with Assign a URL"** — a new route was given a
  link's name. Use **+** on the link's row instead: it becomes the route, the same entry.
- **Only Add link, no Add route, no Sync** — Caddy isn't set up, so Loskai makes only links
  ([Install Loskai](install.md#install-loskai)). Give it Caddy's
  address in Settings › Network to route.
