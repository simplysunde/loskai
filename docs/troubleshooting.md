# Troubleshooting

Common failures once Loskai is routing traffic, and how to tell them apart. The recurring
theme: **DNS, TLS, and the route can all be fine while the *upstream* (the backend Caddy
dials) is misconfigured** — most "site won't load" reports are upstream problems, not Loskai,
Caddy, or DNS.

Quickest triage — a name that's routed but failing almost always falls into one of these:

| Symptom | Layer | Jump to |
|---|---|---|
| **502 Bad Gateway** | upstream unreachable | [502](#502-bad-gateway) |
| **Redirect loop** ("redirecting in a way that will never complete") | upstream scheme | [Redirect loop](#redirect-loop-on-an-https-only-backend) |
| Name doesn't resolve at all | DNS | [Won't resolve](#a-name-doesnt-resolve) |
| Cert warning / "not secure" | TLS trust | [Cert warning](#certificate-warning) |
| VPN clients ignore AdGuard | routing | [VPN DNS](#vpn-clients-arent-using-adguard) |
| A dashboard card is greyed out | reachability | [Greyed card](#a-module-card-is-greyed-out) |

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

> In the **all-in-Docker** (co-located) layout it's the opposite — Caddy shares the Docker
> network, so a `name:port` like `grafana:3000` is correct. Loskai's Add-Route hint follows
> the detected mode (LAN IP vs Docker name); trust the hint for your topology.

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
  [VPN DNS](#vpn-clients-arent-using-adguard) or set the router's DHCP DNS to the AdGuard IP).
- **Cold start:** a brand-new Caddy/AdGuard has no routes or rewrites yet. Reach Loskai directly
  at `http://<docker-host>:8080` and click **"Push all"** to seed every route + DNS rewrite.
- **Rewrite missing:** the AdGuard rewrite is best-effort on assign. In Loskai's Routing view,
  the row should show the rewrite; re-push if it's absent.

---

## Certificate warning

Browser warns the cert isn't trusted on `https://<name>.<domain>`. Expected in the default
**internal-CA** mode — Caddy signs with its own root, which devices don't trust until you
install it **once**. Open `http://<caddy-ip>/` on the device and follow the onboarding page.
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

## A module card is greyed out

The dashboard greys out a card (Caddy / AdGuard / VPN) when Loskai can't reach that service's
API. Each module degrades independently — a greyed card never blocks the others.

- Re-check the service's URL in **Settings** (or the env var) and that the IP/port is right.
- The API must be reachable **from the Docker host** (where Loskai runs). If you firewalled the
  API to the Docker host, confirm that host is actually the source. AdGuard REST is `:3000`,
  Caddy admin is `:2019`.
- `curl` the API from the Docker host to confirm before blaming Loskai.
