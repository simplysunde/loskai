[Docs](../README.md) › [Guides](../README.md#guides)

# Choosing a layout

**Read this when** you are deciding where AdGuard, Caddy and Loskai should run, before
installing.

Loskai uses two programs for HTTPS names: **AdGuard**, your network's DNS server, and
**Caddy**, which serves each name over HTTPS. Loskai itself runs on your Docker host. Where
the other two run is the layout. Each comes with its own compose file, and
[install.md](install.md) installs all three. Env vars and volumes are in
[deployment.md](deployment.md).

## Which one should I run?

All three are recommended, each for the hardware you have:

- **Running Proxmox? [A — split LXC](#a--split-lxc-composeyml).** AdGuard and Caddy each
  get an LXC of their own: the most isolated, and every port is free.
- **A small always-on box beside your Docker host?
  [B — split DNS](#b--split-dns-adguard-separate-caddy--loskai-together).** AdGuard on the
  small box, a Raspberry Pi or a mini PC; Caddy beside Loskai in Docker. The DNS box does one
  job and is never touched again; everything else is one `docker compose` command away.
- **One machine? [C — all-in-Docker](#c--all-in-docker-composecolocatedyml).** All three in
  Docker on one host: nothing else to buy or set up. Your network's names go while that
  machine is down or restarting. A small box added later turns it into B.

## The comparison

| | A: split LXC | B: split DNS | C: all-in-Docker |
|---|---|---|---|
| Compose file | `compose.yml` | `compose.caddy-loskai.yml` | `compose.colocated.yml` |
| Machines | Proxmox: 2 LXCs and the Docker host | a small DNS box and the Docker host | 1 |
| DNS while the Docker host restarts | works | works | down |
| Caddy's admin port `2019` | on your network: [firewall it](#a--split-lxc-composeyml) | inside Docker | inside Docker |
| A routed container must publish a port | yes | [no, if it joins Caddy's network](#routing-a-container-without-publishing-a-port) | yes |
| Ports the Docker host gives up | `8080` | `8080`, `80`, `443` | `8080`, `80`, `443`, `3000`, and `53` on its LAN address |

Ports on the Docker host are the ones that clash with what already runs there. Port `53` in C
is taken only on the host's LAN address, so the resolver most Linux hosts run themselves, on
`127.0.0.53`, stays as it is.

## The layouts

### A — Split LXC (`compose.yml`)

AdGuard and Caddy each in an LXC of their own, made by Loskai's scripts; Loskai in Docker on
the Docker host. Walkthrough:
[With Proxmox](install.md#with-proxmox-adguard-and-caddy-in-lxcs).

- **Close Caddy's `2019` and AdGuard's `3000` to all but the Docker host.** They reach your
  whole network here, and anyone who can reach `2019` can change Caddy's routes.
- **Each routed container publishes a port**, which Caddy reaches at the Docker host's
  address: **Docker Host LAN IP** in **Settings** › **General** fills it in.
- Restarting or breaking Caddy never touches DNS: they are separate machines.

### B — Split DNS: AdGuard separate, Caddy + Loskai together

AdGuard on a small always-on box: a Raspberry Pi, a mini PC, a NAS that runs a container.
Caddy and Loskai in Docker on the Docker host. Walkthrough:
[With a small always-on machine](install.md#with-a-small-always-on-machine-caddy-beside-loskai).

- **Set `CADDY_HOST_IP`** in `.env`: the Docker host's LAN address, where your names point.
  The compose file asks for it.
- **A routed container needs no published port** if it joins Caddy's network:
  [below](#routing-a-container-without-publishing-a-port).
- Caddy restarts with the Docker host; DNS doesn't.

### C — All-in-Docker (`compose.colocated.yml`)

All three in Docker on one host. Walkthrough:
[One machine](install.md#one-machine-all-three-in-docker).

- **Set `CADDY_HOST_IP`** in `.env`: the host's LAN address. AdGuard answers DNS there, and
  your names point there.
- **Ports `80`, `443` and `3000` must be free** on the host, and `53` on its LAN address.
- **Each routed container publishes a port**: Caddy's network here isn't shared with your
  stacks.
- DNS goes down with the host.

## Considered and not supported

**All three in one container** comes up often. It was considered and rejected: it fixes no
port clash, since the only one, `53`, is the host's against AdGuard, and it puts DNS, HTTPS
and Loskai's access to Docker in one container that restarts as one. If you want one
machine, run C. The reasoning in full:
[HISTORY, 2026-09-02](../project/HISTORY.md#2026-09-02--topologies-cut-to-three-the-merged-container-is-rejected).

## Routing a container without publishing a port

In layout B, Caddy is on a Docker network called `loskai-edge`. A stack that joins it is
reached by its name on that network, like `grafana.loskai-edge:3000`, and needs no
published port. Without it, Caddy
can't see the stack: Compose gives every stack a network of its own.

1. Bring Loskai's stack up first: it makes `loskai-edge`.
2. Add these lines under the stack's pencil (**Edit**) › **Edit as text**: in
   `compose.override.yml` for an app installed from a recipe, whose `compose.yml` an update
   replaces; in `compose.yml` for a stack of your own.

   ```yaml
   services:
     grafana:
       image: grafana/grafana
       networks:
         - default # keep this, or the stack's own containers lose each other
         - loskai-edge
       # no `ports:` needed

   networks:
     loskai-edge:
       external: true # made by Loskai's stack, not by this one
   ```

3. Click **Save**. The stack starts on both networks.
4. On **Routing**, **Add route** › **Container**, and pick it. **Host** and **Port** fill in
   as `grafana.loskai-edge` and `3000`.

The port is the container's own: its `loskai.port` label if it has one, else the one port it
publishes or exposes. A container with several, and no label, leaves **Port** empty: type it.

The name carries the network so it can't reach the wrong machine. While the container is
down, plain `grafana` is asked of your network's DNS, and a machine there called `grafana`
would get the route's traffic; `grafana.loskai-edge` is found only inside Docker.

If the route gives `502`: [502 Bad Gateway](troubleshooting.md#502-bad-gateway).
