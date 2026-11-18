[Docs](../README.md) › [Project](../README.md#project)

# Loskai — Architecture

**Read this when** you want to know how Loskai is put together and why — what each part is
for, how it works, and what it deliberately doesn't do. Contracts are in
[`docs/reference/`](../reference/api.md), how to run it in [`docs/guides/`](../guides/install.md),
the reasons behind each decision in [`HISTORY.md`](HISTORY.md).

> **Loskai** — from Norwegian *los* (the harbour pilot who steers ships safely to berth) and
> *kai* (quay, where containers are loaded).

---

## What Loskai is

One container that is the control panel for a homelab. Its core idea is **naming any
service on your LAN**: one action gives `grafana.example.no` an HTTPS route in Caddy and a DNS
rewrite in AdGuard, whether the service is a container, a NAS or a Proxmox UI.

```
Browser ── https://grafana.example.no
   │
   ▼  AdGuard (DNS): grafana.example.no → Caddy's IP
   ▼  Caddy (reverse proxy): grafana.example.no → 192.168.10.100:3000, TLS from its internal CA
   ▼  the service, anywhere on the LAN
```

Around that it manages the Docker host the services run on — stacks, an install wizard fed
from recipe repos — and keeps a list of the machines on the network.

**Loskai is never in the data path.** Caddy routes traffic and AdGuard resolves names;
Loskai only configures them. If Loskai is down, every service keeps working exactly as it
was — you just can't change anything until it's back.

---

## The shape: three components

Loskai is used through three tabs, and they are its three components:

| Component | What it's for | Built on |
|---|---|---|
| **[Routing](#routing)** | Giving services HTTPS names | Caddy + AdGuard, through one action |
| **[Docker](#docker)** | Running the services: stacks, recipes, containers | The Docker socket |
| **[Machines](#machines)** | The computers on the network, by name | The same records and action as Routing |

Around them sit pieces that support the three rather than standing beside them:
the public [Dashboard and Certificate pages](#dashboard-and-certificate-page),
[Settings](#settings), [WireGuard](#wireguard) (a link and a DNS hint),
[health](#health-and-graceful-degradation) and [backup](#backup).

**Components are not the backend's modules.** The backend has five modules —
`docker`, `caddy`, `adguard`, `wireguard`, `ssh` — one per external system, each a `client.py` (I/O
only) and pure logic, each able to fail without taking another down. That is an
*integration* boundary. The components are *product* boundaries: Routing uses two modules
plus `shared/assign.py`; Machines uses `ssh`, the machines themselves being its external system. Both views are right for
their purpose — a fix to how Caddy is called belongs in a module, a change to how
routing works belongs to the component.

---

## Deployment in brief

Loskai runs on the Docker host. Caddy and AdGuard run wherever the chosen layout puts them:

```
Proxmox host (layout A)
├── LXC — AdGuard Home        :53 DNS, :3000 UI + API
├── LXC — Caddy               :80/:443, :2019 Admin API (firewalled to the Docker host)
├── LXC — WireGuard           (optional; wg-easy or similar)
└── LXC or VM — Docker host
    ├── loskai                :8080
    └── your app containers
```

Three layouts ship: **A** split LXCs (above), **B** split DNS (AdGuard on its own small box,
Caddy beside Loskai in Docker), **C** all-in-Docker. Each is recommended for its hardware:
A with Proxmox, B with a small always-on box, C on one machine. In A and B, AdGuard is kept
apart because Caddy is the thing Loskai constantly reconfigures, and restarting it there
never takes LAN DNS down with it; in C the two are still separate containers. A
fourth layout — all three merged into one container — was considered and rejected: it
fixes no port conflict and puts DNS, TLS and the Docker socket in one blast radius.
[`topologies.md`](../guides/topologies.md) is the single source for layouts; env vars and
volumes are in [`deployment.md`](../guides/deployment.md).

**One image, one process, one port.** FastAPI serves the API and the built React bundle on
`:8080`. In development they are two servers (Vite on `:5173` proxying `/api`).

---

## The instance — the shared record

Every component reads and writes one list, `data/instances.json`. There is **no database**:
Loskai's state is files in `data/` — that one, `settings.json`, the accounts (`users.json`)
and the cookie-signing `session_secret`, the launcher icons, `ssh/` (the keys, the SSH config,
`known_hosts`, `sessions.log`, who holds an unlock in `unlocks.json`), `logins.log`, local recipes in `recipes/` and the sources'
clones in `recipes-cache/`.

An **instance** is anything Loskai knows by name:

```jsonc
{
  "id":        "grafana",            // stable slug — also the Caddy @id
  "name":      "Grafana",
  "type":      "docker",             // "docker" (a container) | "external" (anything else)
  "kind":      "service",            // "service" (published at a URL) | "machine" (an address)
  "subdomain": "grafana",            // null = known but not routed
  "route_mode": "proxy",             // "proxy" (Caddy + AdGuard) | "dns_only" (AdGuard only) | "direct" (a link)
  "upstream":  "192.168.10.100:3000", // host:port for proxy; a bare IP for dns_only
  "upstream_tls": false,             // dial the upstream over HTTPS, unverified (Proxmox)
  "scheme":    "https",              // "https" | "both" | "http" — which Caddy server(s)
  "container": "grafana-grafana-1",  // links a docker instance to its live container
  "origin":    null,                 // "adguard" | "gateway" | "caddy" — a built-in service
  "follow_container": true,          // the upstream follows the container (docker only; false unless set)
  "dns_answer": "192.168.10.101",     // the answer last written to AdGuard
  "icon":      "grafana.png",        // launcher icon in data/icons
  "private":   false,                // hidden from the public dashboard
  "projects_folder": null            // a machine's projects folder; null = ~/projects
}
```

- **A route is not stored separately** — it is an instance with a `subdomain`. Removing the
  route clears the subdomain and keeps the record; deleting the record removes the route
  and its rewrite first. Deleting a docker record never touches the container.
- **Only intent is stored.** Container status, CPU and memory are read live from the socket
  and joined on `container` at display time, so the store can't drift from what runs.
- **Links.** `container` and `origin` are **idempotency keys**: routing the same container or
  built-in service again edits its record rather than making a second. `follow_container`
  makes a docker route's address *derived* from the live container rather than typed. A
  route's **machine is not stored**: it is the machine at its upstream's address (see
  [Machines](#machines)). Which records are machines is **declared** by `kind`, never
  guessed from an address's shape.
- **Writes go through one lock** (`store.update_json`): a read-modify-write of the whole file,
  so an assign on the event loop and an edit in the threadpool can't each write back a list
  missing the other's change. A slow step in between (asking Docker) writes compare-and-set,
  or only the field it owns.

---

## Routing

**For:** giving any service on the LAN an HTTPS name, in one step.

### How it works

**The assign action** (`shared/assign.py`) is the one place modules coordinate. A route is
created with `POST /api/routes` (and a machine named with `POST /api/machines` — see
[Machines](#machines)); both run `assign()`:

1. **Persist the intent** — the subdomain and upstream go on the instance.
2. **Caddy — required.** Push the route. On failure: roll the record back and fail.
3. **Anything best-effort that needs the route** — a new container route gets its recipe's
   icon. Never fails the assign.
4. **AdGuard — best-effort.** Write the rewrite. On failure: the route stands, with a warning
   that the name won't resolve until the rewrite is added (Sync retries it).

Clearing a route (`DELETE /api/assign/{id}`) is the mirror image. The Caddy and AdGuard
modules never write on their own — they are read + push only.

**A link** (`POST /api/links`, `assign.make_link`) is a name and an address the Dashboard
opens directly: `route_mode: "direct"` and no subdomain, so neither step runs and nothing
that reads routes — Caddy's push and sync, AdGuard's rewrites and checks — ever sees it. It is
what a Loskai without Caddy puts on the Dashboard, and works beside routes too. Its own verb,
not a mode of `assign()`: bending the Caddy-then-AdGuard orchestration around a record with
neither step would branch the one function where two paths drift. A link's address must open
in a browser, so a container's is the Docker host's published port (`published_upstream`),
which the follower also uses for a link that follows its container. **Assign a URL** turns a
link into a route (`assign()` re-points the record); a route is never turned into a link —
remove it first. Where any record opens — a route's name, a link's address — is decided once,
`instances.open_url`, for the Dashboard, the launcher and the rows.

**Caddy is a projection of the list.** Every proxied instance with a subdomain is a route,
keyed by `@id` = the instance id, as a flat sibling matching one host:

- **Inserted at index 0** of the server's routes. A Caddyfile site block compiles to a
  terminal route; one matching a routed name (the `*.BASE_DOMAIN` block the Caddyfile had
  until 2026-11-08, or a hand-added wildcard) would leave a route behind it dead, with Caddy
  answering an empty `200`. The bootstrap Caddyfile's only `:443` site is `localhost`: it
  gives Caddy the server, and Caddy needs no domain — each routed name gets its own internal
  cert as its route lands.
- **Editing is delete-then-add**, never `PATCH` — one path that always converges.
- **Both servers are discovered** on first use, and again by each health poll, by their
  `:443` and `:80` listeners — never a hardcoded `srv0`. `scheme` picks the server: `https` (default), `http` (kept out of `:443`
  so no certificate is ever issued for it), or `both` — two routes, `<id>` and `<id>-http`.
- **Caddy persists itself**: it autosaves after every change and runs with `--resume` — the
  LXC's unit and the Caddy image alike — so a restart or reboot needs nothing from Loskai.
  While that save exists the Caddyfile isn't read: a changed one takes effect once the save
  is removed ([deployment.md](../guides/deployment.md#caddys-saved-config)). **Sync** re-pushes every route from the list — the
  backstop for a fresh or wiped Caddy, and the cold start (reach Loskai by IP, press Sync).
- **Routes Loskai didn't make are left alone**: it only ever touches an `@id` that is one of
  its instances.

**AdGuard gets one explicit rewrite per name** — no `*.BASE_DOMAIN` wildcard, so an
unrouted name falls through to normal DNS. The answer is Caddy's LAN IP for a proxied
route, or the record's own IP for a DNS-only one. Rewrites have no id, so every write is
an add or a delete **by the exact `(domain, answer)` pair**, and no automatic path removes
a rewrite Loskai didn't write: a hand-added one for the same name is shown as a conflict.
`dns_answer` remembers what was written, so when Caddy's IP changes, Sync replaces
Loskai's own old entries and sweeps orphans — and nothing else. The one exception is
Settings › Network's **clear**: it wipes the whole list after a confirmation and puts
Loskai's own back in the same call.

**Where a route's address comes from.** The upstream is **host and port** on one row, shared
by both route forms (`RouteFields`). The host takes any address, and its list offers the
Docker host, the picked container's host and the named machines — picking one types its
address in, nothing more. For a
container the form pre-fills through `containerPrefill`: `<service>:<port>` when Caddy
shares a Docker network with the container (Compose isolates projects, so this is decided
per container), `<host_ip>:<published port>` otherwise, or just `<host>:` when the port is
ambiguous. A `loskai.port` label names a port Docker can't see or can't choose; without one,
the port is the container's single published or exposed one (`logic._dial_host_port`).
Caddy's container is found from `CADDY_ADMIN_URL`'s host by container name, compose
service label or network alias — the alias is how `caddy.loskai.internal` finds it — and
`network_mode: host` never counts as shared: it has no embedded DNS, though both sides
report the same "network". An IP `CADDY_ADMIN_URL`, or a name for another machine, is
"not reachable by name": the published port is used, which is layout A. A picked
machine fills only the host — the route is a service *on* it, so its name and port are
the route's own — and the list of machines is not filtered by whether one is routed: the
address is reused, not routed.

**Following a container** (`shared/follow.py`, Loskai's only background task). A container
route follows by default: its upstream is derived from the live container and rewritten
when the container starts on a different port. The trigger is Docker's event stream; it
never blocks startup, backs off while the daemon is away, catches up at startup and on
every reconnect, and writes compare-and-set so a hand edit made meanwhile wins. "Set by
hand" in the form turns it off for one route.

### In the UI

The Routing tab is **one row per service**, Caddy and AdGuard merged: the name, upstream,
route and DNS status, and actions. The two backends stay independent modules; only the view
is merged. Routes are created in one place — the **Add route** picker: pick from one of two lists, or
type any address into the fields (Clear drops a pick):

- **Container** — an unrouted container, pre-filled as above.
- **Machines** — a service or container on a machine with SSH set up, at the port it listens
  on (the status key's running list, v6: `docs/reference/ssh-status.md`). It posts the
  machine's address and the port, with no link — a route on a machine's address is on that
  machine. Left out: Proxmox guests, a port only on another of its addresses, and the Docker
  host's own containers (they are the Container source, which can follow). Shown only to an
  account with the Machines tab, which `GET /api/ssh/running` needs.
- **Typed by hand** — any `host:port`: a NAS, Proxmox (tick "backend speaks HTTPS"), a
  machine. Switching lists keeps what was typed, and drops a pick from the other list.

The AdGuard health pill routes AdGuard in one click, carrying `origin: "adguard"`, so routing
it again edits the same record. WireGuard's dashboard and Caddy's certificate page were once
picker items with origins of their own (`gateway`, `caddy`); since Phase 42 they are typed
by hand, and records made before keep working.

A routed container or service drops out of the picker — it is a row now — so routing it
again is an edit, never a duplicate; a second name for the same service is a separate
typed route. Loskai's own UI and AdGuard are ordinary instances with no reserved status.

**Change URL** on a row edits that route; on an unrouted row it reads **Assign a URL**. The
Docker tab creates a route in one place only — the install wizard's last step — through the
same request and the same pre-fill. A container linked to a route but since removed is an
**orphan**, offered for clean-up rather than shown as healthy.

### Decisions

- **Prefixes are single DNS labels** for proxied routes. The reason was the one
  `*.BASE_DOMAIN` wildcard certificate, which covers one label only; since Caddy gives each
  name its own certificate (2026-11-08) the rule could be relaxed, as it is for machines.
- **The internal CA is the only TLS mode Loskai's configs ship.** Public ACME support was
  built and then deleted: Loskai never needed its token, and a second mode was the source of
  every bug in it. A backend that wants a trusted certificate of its own can get one from
  Caddy's ACME server ([`backend-certificates.md`](../guides/backend-certificates.md)).
- **Synced status is a read-only comparison** — shown, never auto-corrected, so it can't
  become a reconcile loop. Sync is the explicit correction.
- **No route has an enable/disable state**: it exists or it doesn't.

### What it doesn't do

Edit Caddy or AdGuard beyond the routes and rewrites it owns (link out to their own UIs);
show certificate expiry (see [Future](#future)); route anything that isn't HTTP(S) — that is
a [machine's](#machines) DNS name.

**Code:** `shared/assign.py`, `shared/follow.py`, `modules/caddy/`, `modules/adguard/`
(`service.py` holds the reconcile — the trickiest code in the app); frontend
`components/routing/`, `pages/Routing.tsx`. **Contracts:**
[`caddy-api.md`](../reference/caddy-api.md), [`adguard-api.md`](../reference/adguard-api.md),
[`api.md`](../reference/api.md).

---

## Machines

**For:** the computers on the network — named once, so everything else can refer to them.

### How it works today

A machine is an instance with `kind: "machine"`: a name and a bare IPv4 address, created with
`POST /api/machines`. It gets a **DNS-only name** — `route_mode: "dns_only"`, an AdGuard
rewrite to its own IP and no Caddy route — so `nas.example.no` resolves for SSH, SMB or
anything else, not only HTTP:

- the IP **is** the DNS answer, so there is no port and no TLS;
- the name may have dots (`rack1.vm3`) — the single-label rule exists only for the
  certificate, and there is none;
- assigning it still tears down any Caddy route with its id, which is what makes switching a
  record from proxied to DNS-only clean.

**A route is on a machine by its address.** Nothing is stored: a machine's only identity on
the network is its IP, so a service whose upstream host is a machine's address is on that
machine, worked out each time (`instances.on_address`). Hence:

- moving a machine rewrites every route on its old address and re-pushes them in the same
  assign — except a route following its container, whose address is the container's;
- deleting a machine changes no route — they keep the address they have; a set-up one has
  Loskai's lines taken off it once its route is gone (`connect.uninstall`, the main key;
  locked → `423` before anything changes; unreachable → deleted, with a warning);
- two machines can't share an address (`409`), or a route's machine would be ambiguous.

The Machines tab lists each machine with the routes on its address beneath, and adds a route
on a machine through the same Add route picker, starting on its address. The Docker host is
listed before anyone names it — "not named", its address read from Settings' Docker host IP
each time and nothing stored (`machine.ts`) — offering only Name it and Add route. Named or
not, the machine at that address is the first row, tinted (a tag says **Host** once
it is named); Settings › General links to it from the Tailscale IP field, since Loskai
installs Tailscale there like on any machine. A named
machine's row has Add route and its settings cog — amber while it has an SSH user but isn't
set up — with Delete under ⋮; once SSH is set up, Terminal, Tools and Update too. The cog
opens the machine's dialog over the list (`/machines/<id>/<category>`,
`components/machines/MachineDialog.tsx`) — what belongs to that machine alone, its sections
in one scroll with a menu down the side that jumps to them and a search that narrows them,
like a settings window: General
(machine name, address, then the overview) and SSH (on or off, the login, setup, updates
without a password), each field saving on its own (`SettingRow`'s `InlineText`) and posting only its
change; then Tools, Running and Log. Turning SSH off takes Loskai's key and sudo rule off
the machine, then its config entry, and forgets its host key. Once SSH is set up, the
dialog's header opens a terminal. The `<category>` is where it opens. Naming a
machine lands on it. What is the same for every machine is in Settings › SSH. Machines never appear on the
Dashboard: an address has no port to link to — give its web UI a route under a second name.

**SSH — the key, the config and the setup.** Loskai's key is made by an admin and kept owner-only
(`data/ssh/id_ed25519`, `0600`; Phase 38); "New key" in Settings › SSH replaces it. The public key is read from
the private key file — the OpenSSH format keeps it in the clear — so there is one file, and
the shown key can't belong to another; Settings › SSH shows its fingerprint. A machine's form has an SSH user and port, written to
`data/ssh/config` as `Host <hostname>` with `HostName <address>`; Settings › SSH
downloads that file.

Saving a machine with an SSH user opens its **SSH setup** (`SshSetupModal`, again from its dialog):
the host key, asked for as ed25519 first so its fingerprint is the one `ssh-keygen -lf` shows
on the machine, is trusted into `data/ssh/known_hosts` under the machine's **id**; then
Install it for me logs in once with the machine's password and replaces Loskai's lines in
`authorized_keys` (`logic.INSTALL_SCRIPT`), or the lines are pasted by hand; either ends with
a test using both keys (`connect.py`). The main key is unlocked by each user's own
password, typed again (`unlock.py`) — for 15 minutes, or up to 24 hours as Settings › SSH says
(`ssh_unlock_minutes`) — and locked by logout. The page asks for it in one place,
`UnlockPrompt`, and only for what you did: a change refused `423` asks and is sent again
(`api.ts`); a read made as a card opens shows **Locked** instead, asking when clicked; a
terminal shows only the prompt until it is unlocked (a WebSocket's `4423` too). Each set-up machine's row shows how
much runs there — read with the **status key** through its forced command and parsed by
`status.parse_running` — and clicking lists it, with a button to route each port
(`machineServices.servicesOn`, the Add route picker's list) and to name each Proxmox guest
by its address (status line v7); the backend asks each machine at most every 30 s, only
while someone is looking. The machine's dialog adds its **overview** — system,
uptime, memory, disks, updates waiting, the programs tools require, tmux sessions, the
Tailscale address, the git projects in the home folder — from the same key's second
request (`facts`, `status.parse_facts`, at most every 60 s). One forced command answers both,
picking by `$SSH_ORIGINAL_COMMAND` without running it; its contract, and how to add a fact,
is [ssh-status.md](../reference/ssh-status.md).

**Updates without a password** are a sudo rule on the machine (`logic.SUDO_RULE`), never a
stored password: `tool.allow_script` writes it in the machine's terminal, as an automatic
run (below), naming the user and exactly System's update steps
(`tool.update_commands`, read from the tool file) plus the rule's own removal, checked by
`visudo` before it is moved into place. The overview says whether it is there (status line
v5). It comes off first whenever Loskai's things do — deleting the machine, removing its
SSH connection, or changing its SSH user (`logic.UNINSTALL_SCRIPT`, as the old user: the
rule is that user's, and the new one may not see it where `/etc/sudoers.d` is 0750) —
through the rule itself, so no password.

**An automatic run** (`automatic: true` in its tool file; adding a tool and the sudo rule
always) asks for sudo's password before its terminal opens, and only when sudo would.
`POST …/run` (`connect.prepare`) answers no for root, a command without `sudo`, what the
rule covers, or a user `sudo -n true` lets in. Given the password, it checks it with
`sudo -S -v` over a connection of its own and holds it in memory under a one-time ticket
for a minute, for that user and machine. The terminal takes the ticket as the socket's
first message — never in its URL, which the access log keeps: its pty opens with
echo off, the password is the first line, and `tool.terminal_command` reads it and hands it to
`sudo -S -v` in the run's own tty, so every `sudo` after it finds sudo's timestamp. A tmux
pane is another tty, so there it goes through a FIFO in a `mktemp -d` folder; a pane sent
nothing within 30 seconds (a connection cut off as it started) ends, so the next run of
that action starts fresh rather than attaching to it. The run ends by itself when it succeeds, and the dialog closes with it.

**Tools** are what a machine's dialog can *do* (Phase 34f): YAML files in
`modules/ssh/tools/`, shipped in the image. Each names the programs it requires (from the
overview's) and its actions: a label and the command, per package manager where they
differ, on the machine or on a row of the Running list (a service, container, LXC, VM).
**Nothing is enabled or stored**: a tool applies where the machine has its programs — the
standard ones (System, Services, Proxmox) wherever they fit — and one lacking only programs
Loskai can install (`tool.INSTALLERS`, the one place that says how to get each) is offered
to add, which installs them. The machine's dialog has a card for each tool that applies, under Tools; every
tool but the standard ones is also in the Tools menu on the machine's row, with how it stands
there — what it shows, `not added`, or what it needs — and opens in a dialog
(`MachineTools.tsx`). The cards and the menu come in one order on every machine, decided in
`tool.ORDER`: Git, Claude Code, Tailscale, tmux, then any other. The one thing stored is a machine's **projects folder**
(`projects_folder`, `~/projects` unless changed, set in the Git card's **Settings**), where the
Claude Code tool's projects are. A tool's **settings** are the machine's own values, never
stored: its card reads them with the main key (`connect.read_settings`, every `read` in one
command) and writes one as `$1` through its `write` (`connect.write_setting`), reading them
back after. Like a recipe,
a tool is data: the browser names a tool, an action and a row's target, and
`connect.plan` works the command out from the file and the machine's overview — the target
only ever `$1` — refusing before anything runs when it can't run there. The action runs in
the machine's terminal, inside a tmux session when the machine has tmux (so closing the tab
doesn't stop an update, and running it again attaches), and the log records its command.
The format is [tool-schema.md](../reference/tool-schema.md).

**A machine's own SSH keys** (Phase 56 — the why is in HISTORY, 2026-11-14) are two views of
one list, read by the status key: the public halves in `~/.ssh` of the user Loskai logs in
as, every remote of each project and submodule, and what `ssh -G` resolves for each host they
name ([ssh-status.md](../reference/ssh-status.md)). Loskai's own key is in neither view: it
logs in *to* the machine, and is SSH setup's.

- **The machine's dialog › SSH › Keys (n)** lists every key, with Copy and — where the
  machine has Git, whose tool file holds the actions — Label and Delete.
- **Git's card › Keys** is git's side: account keys and deploy keys, the remotes each is for,
  a host field and Test on each, Add to …, and under the list Test key, Try every key, New key
  for a host and, while there is no `id_*` key, New account key.
- **What a key is for is written on it.** Every key Loskai makes is ed25519 with no
  passphrase — pulls and pushes run unattended — and ends its comment `(loskai: account)`
  (`id_ed25519`), `(loskai: for <host>)` (`~/.ssh/<host>`) or `(loskai: deploy <project>)`
  (`deploy_<project>`). Label writes such a mark, or `(loskai: login)`, on any other key with
  `ssh-keygen -c`: only the comment changes, so the key goes on working where it was added.
  Without a mark a key is placed as far as its name, comment and remotes say (`ssh.ts`).
- **Where a key is used is read, never stored.** A remote uses its project's own key
  (`core.sshCommand`, set by Give it its own key), else what ssh offers that remote's host,
  `~/.ssh/config`'s aliases included — shown as "via <alias>"; several keys ssh offers one host
  are each "offered". A key used only by a script's `ssh -i` can't be seen. Over HTTP(S) no
  key is used, and a project's override says so.
- **A test is a connection per key, asked for by name.** It trusts a new host as first seen
  (`accept-new`) and prompts for nothing; a key with a passphrase is not tried. Try every key
  stops at 10 keys, or when the host stops answering: each refused key is a failed login a
  forge's fail2ban counts. A first connection refused is reported as a wrong port. The answer
  stays while Keys is open — a key that got in shows ✓ and the host, and loses its Add to … —
  and nothing is kept after, except the hosts tested on, in the browser (`recentHosts.ts`).
- **Delete** removes the file and puts a project that used it back on the machine's key. A
  key `~/.ssh/config` names is refused: Loskai never edits that file.

A set-up machine's row opens a **terminal** (`MachineTerminal`): a pty shell over SSH with
the main key, behind the session, `Origin` and unlocked-key checks; closing it hangs up the
pty, so nothing is left running. Both terminals are one component (`XtermSession`): Tab goes
to the remote shell, which completes; Ctrl+Shift+C copies (Ctrl+C too while text is
selected); Ctrl+V and Ctrl+Shift+V paste through the browser, so it works over plain HTTP
too; and what a program in it copies — tmux, Claude Code, through OSC 52 — reaches the
browser's clipboard. The **SSH log** (`data/ssh/sessions.log`, shown in Settings › Logs, and a machine's own in
its dialog — an admin's, as every log is) records sessions and
installs — never keystrokes, which can be a password typed at a `sudo` prompt.

### Direction — managing the machines over SSH

The Machines tab is meant to grow from a list of names into **where the machines are run
from**: connect to one in the browser, run prepared commands on it — update the system,
check disks and services — find the Docker containers and services running on it, and
administer it without opening a hypervisor's UI. A UI like Proxmox's does everything, but
everyday upkeep there is slow; prepared commands make the common jobs one click, the same
idea as the container terminal's quick commands. Built in Phase 34; the decisions below are
why it is shaped as it is.

Decided:

- **The SSH config is the record.** The hosts are a real SSH config file, edited in place —
  its formatting and comments kept — not a store of Loskai's own: the same rule as the
  stacks folder. It is **Loskai's**, in `data/`, so it survives a rebuild; **Settings
  exports it** for the SSH client on your own computer.
- **One list.** A connection belongs to a machine, not to a second list of hosts — the same
  lesson as routes being instances. How a config `Host` entry and a machine record are
  matched (by name, by address) is part of the design.
- **The keys live in Loskai**, and sessions and commands run from its container.

What that commits to — designed in from the start, not added after:

- **Loskai becomes the key to every machine it manages.** Today a compromised Loskai owns
  the Docker host, through the socket; with this, every machine. The protections it already
  has become load-bearing — LAN-only, remote access through WireGuard, the login,
  the gate on the API — and `SECURITY.md` and the "no third-party secret but AdGuard's"
  rule change in the same commit that adds the key.
- **Loskai's own key, never yours.** Loskai generates its own key pair; you add its public
  key to each machine (its two lines shown in the machine's SSH setup, ready to copy), or
  Loskai adds them with the machine's password. Its access can then be
  revoked on one machine without touching your own key, and no export ever carries a
  private key. The key is written owner-only, like every secret in `data/`.
- **Host keys are checked.** Loskai keeps its own `known_hosts` in `data/`: the first
  connection shows the fingerprint to accept, and a changed key is refused, not trusted.
- **The config names no key.** Loskai hands its key to each connection itself, so the
  exported file works as it is with your own `ssh` and your own keys (decided 2026-10-30;
  first planned as an `IdentityFile` rewritten on export to a path in a setting).
- **A machine's SSH details live only in the config.** `Host` is the machine's hostname and
  `HostName` its address; the machine's form edits its user and port, and renaming, moving
  or deleting the machine edits that entry in place. Entries naming no machine are left alone.
- **The browser terminal is a WebSocket like container exec** — outside the HTTP
  middleware, so it passes the same gate of its own (`shared/terminal.py`).
- **Prepared commands are data, shipped with the code** — like `quick_commands.py`, keyed by
  what the machine runs — and run visibly in the terminal, never behind your back.
- **Finding Docker on a machine over SSH** overlaps the backlog's multi-host idea: SSH may
  replace the agent it proposes, with nothing to install on the machine.

**Keeping the key safe** (decided 2026-10-28). The gate in front of it was hardened first —
the `Origin` check, logout ending the user's sessions, the login backoff, the `Secure` cookie (see
[Security and access](#security-and-access)). The design then assumes each layer can fail,
and limits what the next one loses:

- **The private key is an owner-only file** (`0600`), as a key in `~/.ssh` without a
  passphrase is (Phase 38). It never appears in an API response, a log, the backup download
  or the config export. A copy of `data/` does hold a usable key — the `from=` below is what
  limits it then. It was encrypted behind a slot per account sealed with its password
  (Phase 35) until that cost three faults in one review and could lose the key; see
  HISTORY, 2026-11-04.
- **SSH actions ask for your password again**, like `sudo`, and that is what unlocks the key
  — for you, not for anyone else: for 15 minutes unless Settings › SSH says longer — not at
  login. Your logout, a new password or losing the Machines tab locks it. A stolen session
  cookie then reaches the Docker tab, not the machines — not directly: the Docker tab can
  mount `data/`, so it is a speed bump for a session thief, not a wall. Who holds an unlock
  is kept in `data/ssh/unlocks.json` (names, times and session generations — no secret), so
  a restart of Loskai, every save under `make dev` included, doesn't lock it. An admin can
  switch the asking off (`ssh_ask_password: no`, `settings.ssh_asks_password`): then
  `unlock._holds` is only the Machines tab, and the key view says `asks_password: false`.
- **The key only works from the Docker host.** Each `authorized_keys` line a machine's SSH
  setup installs or offers to copy carries `from="<Docker host IP>"`, so a copied key is useless
  anywhere else — the strongest single limit, and enforced by the machine, not by Loskai.
  The Docker host's own line also names the subnets of Loskai's container networks: Docker
  doesn't translate a container's connection to its own host, so sshd there sees the
  container's address (found 2026-10-31, `docker_client.own_subnets`).
- **The login is the owner's choice.** Loskai logs in as the user it is given and creates
  none: a `loskai` user with `sudo` is suggested, and root works. How much `sudo` that user
  gets is the owner's to set on the machine; the one sudoers rule Loskai writes is the
  update rule (`logic.SUDO_RULE`, above), possible because the prepared commands are fixed.
- **Set up when a machine is named** (decided 2026-10-31). Saving a machine with an SSH user
  opens its setup: the host key is shown and trusted *before* any password is sent; then
  Loskai installs its lines with the machine's password, used once and never stored, or
  you add them yourself. Either way it ends by logging in with the key.
- **A status-only key**, the one used without unlocking: kept `0600` like the main key, so
  each machine's running list works without a password, and
  the machine limits it to one read-only command (`restrict`, `from=`, a forced `command=`)
  — a copy lists what runs and does nothing else.
- **Rotating is one button, then each machine.** New key in Settings › SSH replaces the
  pair; each machine is then set up again, which replaces Loskai's lines there.
- **Every session and command is logged** — when, from which address, on which machine —
  and readable in the app. It doesn't stop anything; it shows what happened.

Later, optional: a second login factor (TOTP), once Loskai holds keys.

Open: running one command on several machines at once.

**Code:** `shared/assign.py` (`POST /api/machines`), `shared/instances.py`
(`on_address`), `modules/ssh/` — `client.py`, `logic.py`, `status.py`, `connect.py`, `unlock.py`,
`machines.py`, `tool.py`, `tools/`; frontend `pages/Machines.tsx`, `pages/settings/Ssh.tsx`,
`components/machines/` — `MachineTable.tsx`, `AddMachineModal.tsx`, `MachineDialog.tsx`,
`MachineTools.tsx`, `ToolDialog.tsx`, `EnableSshModal.tsx`, `SshSetupModal.tsx`,
`MachineTerminal.tsx`,
`RunningPill.tsx`; `components/routing/machine.ts`.

---

## Docker

**For:** running the services — the containers on the host, the stacks that define them,
and installing new ones from recipes.

### How it works

**Everything goes through the Docker socket**, mounted read-write, and the real
`docker compose` CLI — Loskai invents no deployment method of its own. Recovery is always
plain SSH and `docker compose`.

**The view is one table of every container, by stack.** A container is nested under the
compose project that started it. Stacks Loskai manages come first, their header row
carrying status, route links and actions; below them, **Other containers** — compose
projects from elsewhere and `docker run` containers (a group of one) — listed, startable,
stoppable and removable, but not managed. Loskai's own container sits apart, logs only.
Each container has logs (streamed), a browser terminal (`docker exec` over a WebSocket,
with preset **quick commands** by image) and stats. **Volumes** are listed with their size
and users, and one nothing uses can be deleted.

**A stack is a folder in `STACKS_DIR` with a compose file.** The filesystem is the only
record: editing a file in the browser and over SSH touch the same file, and Loskai never
locks a stack. Compose names the project after the folder (lowercased, dots dropped), so
the name can't lead back to it: a container is matched to its stack by its `working_dir`
label — the folder compose ran in — never by project name. `STACKS_DIR` is bind-mounted **at
the same path** inside and out, because the compose CLI hands bind paths to the host
daemon; it defaults to `./stacks` beside Loskai's compose file, so compose must be run from
that directory (`deploy.sh` does). The default is `${PWD}/stacks` because Compose has no
variable for the project directory: run from elsewhere (`-f ~/loskai/compose.yml`, a systemd
unit with no `WorkingDirectory=`) it points at `<that directory>/stacks`, which Docker creates,
so the Docker tab shows no stacks rather than an error. An absolute `STACKS_DIR` in `.env`
pins it. A tidy `/stacks` inside instead would hand a stack's `./library` to the host daemon
as `/stacks/<name>/library`, at the host's root. `./data` has no such trap: Compose resolves
it against the project directory, and the app reads it at `/data`, which `LOSKAI_DATA_DIR`
names in the Dockerfile and in every compose file beside the mount — change the mount's
right side and that line together, or Loskai writes to an unmounted folder and loses it on
the next recreate. Each health poll checks the folder is really mounted, and
so does creating or installing a stack before it writes: if not, health says so and the
write is refused rather than made where the host can't see it — the container list still
works.

- **Actions:** up, down, restart, and update (`pull` + `up`).
- **Create** from a pasted compose file (the raw path), or **install** from a recipe.
- **Edit** as a form or as text. The form shows the `.env` as labelled settings, the
  override's bind mounts as folders, the recipe's options as checkboxes, and the app's
  image, ports and volumes read-only; anything else the override sets is kept and flagged.
  Text edits the files directly. Unsaved text carries over when switching to the form. A
  save writes the files, then `up`; when `up` fails, the dialog stays open on Compose's
  output with the form re-read from disk.
- **Delete keeps the data** unless asked: only the compose file, the override and `.env` go.
  A folder left with data and no compose file is **taken over** by the next stack or install
  of that name — how a reinstall, or someone bringing their own data, gets it picked up.
  Deleting the data too removes the folder; when the app wrote files as its own user, which
  Loskai's can't remove, a throwaway root container from Loskai's own image empties it
  (`client.clear_folder`).

### Recipes and the install wizard

**A recipe is declarative data — validated, never executed.** One folder each:
`recipe.yml` (the questions, options, folders it asks for, and its type — `pull`,
`git_build` or `registry_pull`), a real `compose.yml` using `${VAR}`, optional
`instructions.md` and `icon.png`. The schema is
[`recipe-schema.md`](../reference/recipe-schema.md); a bad recipe is skipped with its error,
never half-run. `check_recipes` runs the same validator for authors.

**Sources.** Any number of public git repos (Settings › General › Recipe sources, one seeded
default) plus `data/recipes/` for local ones, always scanned last. The first source to
define an id wins; a later copy is flagged, never hidden. Each source is cached as a
**mirror** — `clone --depth 1`, then `fetch --depth 1` + reset — so a source whose history
was rewritten keeps syncing. Sync is explicit; there is no polling.

**Install** writes the stack folder: the recipe's `compose.yml`, a generated `.env` (every
value double-quoted and escaped, because Compose interpolates `$` and cuts at ` #`), and a
`compose.override.yml` for folders added and options ticked. Then `up`, then a docker
instance linked to the **container name the daemon created** — read back from the compose
labels, never guessed from the recipe id; a multi-service recipe names its primary service.
No container identified, no record. The wizard's last step routes it — the one place the
Docker tab creates a route — and, for a recipe with a `log_link`, shows the newest link under
it from the container's logs (a login the app waits for).

**Each installed file has one owner**, and that is what makes updates safe:

| File | Owner | An update… |
|---|---|---|
| `compose.yml` | the recipe | replaces it |
| `.env` | the user's answers | only adds a line for a new question |
| `compose.override.yml` | the user | never touches it — and is refused unless the new compose file loads with it |
| `.loskai-recipe.json` | the install record | is rewritten: recipe, source, commit, compose fingerprint |

**Check for updates** syncs the sources first — opening it is the explicit sync — then
compares each stack's `compose.yml` with its recipe's, using the fingerprint to tell the
recipe moving on (**update available**) from a hand edit (also shown as update available,
with a warning that updating replaces the edit); a stack the record doesn't cover — installed
before records, or brought in by hand under a recipe's name — **differs from the recipe**,
and one whose recipe no enabled source has any more is **no longer in any source**. It shows
the image changes, the diff and the source's commit messages before anything is replaced.

**Options** are a recipe's optional features — Jellyfin's GPU transcoding — as checkboxes at
install and in the form. On adds exactly the option's lines to the override, off removes
exactly those, and whether one is on is read from the override, never stored. An option may
only add (`devices`, `group_add`, `environment`, `cap_add`, `ports`, an NVIDIA `deploy`
reservation) — never replace what the recipe or the user set — and its help says first
what happens without it.

**The recipe's icon** becomes the instance's launcher icon at install, and for a new route
to the recipe's primary container later — only where there is none, so one removed or chosen
by hand stays.

### Decisions

- **Everything is compose**, even a single container — no special cases.
- **Recipes live in repos, not the image**: adding an app is a push, not a Loskai release.
- **Registry credentials stay on the host** (`docker login`); Loskai never stores them.
- **User settings never go in the recipe's `compose.yml`** — that file is replaced on update.

### What it doesn't do

Manage containers on another host; manage images or networks; edit a container with no
compose file; see stacks outside `STACKS_DIR` (they are listed under Other containers,
and [`migration.md`](../guides/migration.md) brings them in); build images. Without the socket, nothing.

**Code:** `modules/docker/` — `stacks.py`, `recipes.py`, `manifest.py`, `install.py`, `dotenv.py`, `override.py`,
`stackform.py`, `updates.py`,
`logic.py` (pure), `client.py`, `quick_commands.py`, `check_recipes.py`; frontend
`components/docker/`, `pages/Docker.tsx`. **Contracts:** [`api.md`](../reference/api.md),
[`recipe-schema.md`](../reference/recipe-schema.md).

---

## Around the components

### Dashboard and Certificate page

The two public pages. The **Dashboard** is a launcher: a card per non-private routed service
or link, with its icon, served by `GET /api/dashboard`, which exposes nothing else. `GET /api/launcher`
is the same list including private services, behind the login, for a desktop launcher —
`private` means "not on the public wall", not "secret". The **Certificate** page hands out
Caddy's internal root CA so a device can trust every `*.BASE_DOMAIN` name; it is public
because the device that needs it can't yet log in over HTTPS
([`certificate-setup.md`](../guides/certificate-setup.md)). Its link in the sidebar is
`settings.certificate_tab`'s to decide: the setting, and hidden while Caddy isn't set up.

**Where the root comes from.** Caddy's Admin API (`GET /pki/ca/local`) through Loskai's
`GET /api/caddy/root-certificate`, so it works in every layout — in A, Caddy's data is on
another machine. Loskai serves the download itself rather than linking Caddy's `:80` file:
Chrome and Edge silently block a plain-HTTP download from an HTTPS page. Caddy with no
internal CA answers 404 there, and the page says there is nothing to install. Loskai holds
no key and is not in the issuance path; the root is public by definition.

**Caddy's `:80` onboarding site** is the fallback that works with Loskai stopped: a static
copy of the page (`caddy/setup/index.html` at `/srv/setup` — baked into the Caddy image,
fetched into the LXC by `create-caddy-lxc.sh`, mounted from `./caddy/setup` in the dev rig)
and the live root from `/data/caddy/pki/authorities/local/root.crt`, served by a plain-HTTP
site in the bootstrap Caddyfile, never through Loskai's API. Plain HTTP on purpose: it fixes
the untrusted-certificate warning, so it can't sit behind that certificate. It answers only
Caddy reached **by IP**: any other `Host` is redirected to HTTPS, matched on the host's shape
(`header_regexp Host`), since Caddy isn't given the domain and a bridged container can't
know its host's IP. A `scheme: "http"` route still wins, pushed at index 0 of this same
server ([`caddy-api.md`](../reference/caddy-api.md)); Sync never touches the site's own
routes, which carry no `@id`. Scoping the site to one address (`http://192.168.10.100 { … }`)
is possible and was never needed. The root file appears once Caddy has initialised its
`local` CA, on its first internal certificate.

**The two pages say the same thing** — the same three steps, per-OS tabs and wording — kept
in step by hand: a change to `frontend/src/pages/Certificate.tsx` is made in
`caddy/setup/index.html` too. Both carry per-distribution Linux commands
(`update-ca-certificates` is Debian's; Fedora uses `/etc/pki/ca-trust/source/anchors/` and
`update-ca-trust`) and Chrome's own NSS store on Linux, which a system-wide install alone
leaves out.

**No friendly name for it.** A `setup.<base>` rewrite added in AdGuard by hand is swept as
an orphan (it points at Caddy's IP and no instance owns it), and a Loskai route to
`<caddy-ip>:80` loops: Caddy passes the name on as the `Host`, and the `:80` site redirects
every name to HTTPS — `308` to itself (checked 2026-11-18). The page is reached by address.

### Settings

**Priority: env var > `settings.json` > unset**, each value shown with its source; an env
value is read-only in the UI. Everything is optional — Loskai starts with no `.env` and is
configured on first run. Two exceptions: `STACKS_DIR` is compose-only (it drives the bind
mount), and recipe sources have no env var at all (`STORED_ONLY_KEYS` — nothing about them
is needed before the UI is up, and a list is better edited there). The page is split into
**General** (app-wide, recipe sources, backup), **Network** (how Loskai reaches AdGuard,
Caddy and WireGuard — fields only; their status lives on Routing, next to what they gate)
**SSH** (what is the same for every machine: Loskai's key, how long an unlock lasts, the SSH
config to download — one machine's own SSH is behind the cog on its row), **Users** (the
accounts), **Security** (how long a session lasts once no page is open) and **Logs** (the
sign-in log and the SSH log). Settings is an admin's.

### WireGuard

Not a component: **a link and a hint.** Settings › Network holds the dashboard URL (wg-easy
or similar) with an Open link, plus a reminder of the DNS server peers should use
(AdGuard's IP, then `1.1.1.1`), the most common WireGuard mistake. `/api/health` probes the
dashboard — any HTTP answer counts, since a login page is still up — but no page shows it. WireGuard's dashboard can also be routed,
by typing its address into Add route. No API, no credentials, no peer management.

### Health and graceful degradation

`GET /api/health` reports Caddy, AdGuard, WireGuard and Docker each as `healthy`,
`degraded`, `unreachable` or `unconfigured`, polled every 30 seconds — SSH has no check of
its own — plus whether the stacks folder is mounted (`docker.stacks_dir_ok`) and a
`consistency` list of DNS drift. A module going down greys out only its own
banner: with AdGuard down, routes are still created (without DNS) and Docker is
unaffected; with the Docker socket gone, routes still work from their stored addresses.

### Backup

`GET /api/export` (an admin's) downloads the instances, the base domain and AdGuard's
rewrites as one JSON file — not the settings. Stacks are folders on the host and are backed
up as such.

---

## Security and access

Loskai is the highest-privilege service in the homelab — it holds the Docker socket
(root-equivalent on the host), Caddy's Admin API and AdGuard's credentials — so access is
designed in, not added on.

**Two tiers.** The Dashboard and Certificate page are public; everything else — the Docker,
Routing, Machines and Settings tabs and every action — is behind a login, and then behind
what the account's level allows: each level adds to the ones below. The
gate is inside Loskai, not a Caddy `basicauth`, which would also lock the public pages.

**The gate is the API, never the frontend.** Middleware rejects every `/api/*` request
without a session except the public set in `shared/auth.py` (the dashboard, the root
certificate, the launcher icons, and the login flow itself). The React bundle is served to
anyone — `RequireAuth` only decides what renders. The two terminal WebSockets — a root
shell into a container, and a machine's — sit outside the HTTP middleware, so both pass one
gate of their own (`shared/terminal.py`): the session, the `Origin` and the level.

**Only Loskai's own pages may act.** `SameSite=Lax` keeps the cookie from other *sites*, but
every app under the base domain is the same site — `jellyfin.example.no` gets it attached to
a request it sends Loskai. Reading the answer is still blocked by the browser; sending a
body-less `POST` or opening a WebSocket is not. So every request that changes something, and
the terminal WebSockets, must carry an `Origin` equal to the address it was sent to
(`auth.same_origin`), or none at all — a script, which needs the cookie anyway. That address
is `Host` (Caddy keeps it), or `X-Forwarded-Host` for a proxy that rewrites `Host`; a page
can't forge that header — checked live, the browser either drops it or never sends the request. Proved live on
2026-10-28: before the check, a page on a sibling name ran a command as root in a container.

**Accounts, and what each may do** (Phase 35, replacing "one password, no accounts").
`data/users.json` (`shared/users.py`) holds the accounts, each with a **level**, and each
level adds to the ones below: 1 Routing, 2 Docker, 3 Machines, 4 Settings — an **admin**,
who does everything (2026-11-06, replacing operators given any set of tabs). There is always
an admin. First-run setup creates it; `LOSKAI_PASSWORD`
(with `LOSKAI_USERNAME`) seeds it instead, and an install from before accounts keeps its
one password as the account `admin`. **Which account may call what is one table**,
`shared/access.py`: a line per route — any account, or the level it needs — read by the
middleware; a route with no line is admin-only, and a test fails until every route has one.
A record changed by id needs its own level (a machine Machines', a route Routing's), the
create endpoints, `DELETE /api/assign` and the icon included; the terminal WebSockets need
Docker or Machines. The frontend shows only what the account may use, but the API is the gate.

`POST /api/login` issues a signed `HttpOnly` cookie naming the account and its
*generation*, `Secure` when the login came over HTTPS — Caddy says so in
`X-Forwarded-Proto` — so a login on plain `:8080` still works there. **A session ends after
it has been idle** for `session_idle_minutes` (2 hours, like Proxmox's ticket; 30 minutes to
7 days) and is renewed — a fresh cookie — by a request more than a minute after the last.
**An open page keeps it**, as Proxmox's UI renews its ticket: the health poll, every 30 s,
goes on in a background tab (`useHealth`), so idle means no Loskai page open.
**Log out ends your sessions on every device**: it bumps your generation, so every cookie
naming the old one stops working, and no one else's; a new password or the account removed
does the same. An account starts at a generation of its creation time, so one made again
under a removed one's name doesn't take up its sessions. An open terminal re-checks every 5 s and closes when its session is over:
the account's generation moved on (a logout) or its level was lowered below the tab. Not the idle time: a
terminal lives in an open page, which keeps the session, while the terminal's own copy of
the cookie is never renewed.
**Wrong passwords cost time**: after 5, each one starts a wait (2 s, doubling to 60 s) during
which login answers `429`; 15 quiet minutes start the count again. A wrong username costs
the same as a wrong password, and the answer doesn't say which. The count is per account
and client (`auth.peer`: the client Caddy forwarded for, when Caddy is asking), so a
guesser's waits are their own — the account's owner signs in from another device — and
only one password is checked at a time, so many addresses don't guess faster than one. It
lives in memory, and a restart clears it (2026-11-13; per account only before, which let a
guesser keep the account's owner out). **Each login is logged** —
`data/logins.log`, shown in Settings › Logs: when, the username typed, from where (as in
the SSH log, `X-Forwarded-For` is believed only from Caddy's own addresses — `auth.peer`),
and whether it signed in, and each wrong password asked again for an action (the SSH unlock, a
new SSH key, a password change: `check_password` logs every miss) — never the password, and not a login turned away during a wait, nor
more than 5 wrong ones in 15 minutes for names that are no account's (made-up names never
wait, so a script could otherwise push the real entries out). It is the SSH log's format and trim (`store.append_log`). The AdGuard password is the only
third-party secret Loskai stores, because it must replay it, and only an admin reads it
back. Files holding secrets are written owner-only.

**The process runs as the owner of `./data`**, not root — the entrypoint drops to it and the
socket's group — so anything Loskai writes on the host is the user's. The socket's group is
read (`stat -c %g`), not set: it differs per host. On the way the entrypoint hands back what
an older, root-run Loskai left — all of `./data`, and in each stack the folder, its compose
files and `.env` — **never deeper**: `stacks/<name>/data/` belongs to the user the app inside
runs as (a database's files are often uid 999). **Delete with data** removes those through a
throwaway container from Loskai's own image, as root. A `./data` owned by root, or `user:` on
the service, runs as that (`scripts/container-entrypoint.sh`).

**Boundaries outside Loskai:** Caddy's `:2019` and AdGuard's `:3000` firewalled to the Docker
host; Loskai the only container with the socket; Loskai reachable only on the LAN, with
remote access through WireGuard.

**Known trade-off:** the public Dashboard shows which non-private services exist and links
to them; each keeps its own login. `private` hides a service from it.

Details: [`api.md`](../reference/api.md#public-no-auth), [`SECURITY.md`](../../SECURITY.md).

---

## Stack and frontend

The backend is FastAPI with httpx (Caddy, AdGuard), docker-py (the socket), asyncssh (the
machines), pydantic-settings (env vars), sse-starlette (log streaming), argon2-cffi (password
hashes) and itsdangerous (the signed session cookie), managed with `uv`. The frontend is React,
TypeScript, Vite, Tailwind and TanStack Query, with xterm.js for the terminal. A persistent
sidebar — Dashboard, Certificate, then the admin tabs — over a content area: cards where
things are launched, dense tables where live state must be scanned. On a phone the same
pages narrow: the sidebar is a drawer and each table row a card
([phone-layout.md](../contributing/phone-layout.md)) — one layout, not a mobile version.

- **Each decision lives once.** One helper pre-fills every route form (`containerPrefill`);
  one hook saves and re-ups both stack editor views (`useSaveAndUp`); one validation module
  holds the rules every route form checks. Each owner, and who uses it:
  [where-logic-lives.md](../contributing/where-logic-lives.md).
- **Configuration and status are split by kind**: Settings holds fields, and a status sits
  on the tab that owns it — AdGuard's and Caddy's on Routing.
- **The UI conventions** — minimal text, short tooltips, one layout, never a half-true
  address — are in `CLAUDE.md`.

---

## Testing

**Test the logic Loskai owns, mock the systems it talks to, and check the irreversible side
effects for real.**

- **Unit tests** cover the pure logic directly — the reconcile, the route builders, upstream
  derivation, recipe validation, the stack form, auth. This works because of the
  `client.py`-versus-logic seam, held everywhere.
- **Contract tests** mock the HTTP of Caddy and AdGuard with the shapes in
  `docs/reference/`, asserting the request Loskai builds and how it reads the answer.
- **Frontend tests** (Vitest, Testing Library) cover components with logic in them.
- **Live checks** for what a mock can't see: routing against a real Caddy holding a real
  Caddyfile, installs against a real daemon, and the UI in a real browser — at phone widths,
  `make check-phone` (`scripts/check-phone.sh`, [phone-layout.md](../contributing/phone-layout.md)).
  The suite mocks
  Caddy, so a correctly built route placed at the wrong index passes it — the first live run
  found exactly that, as an empty `200`. The rig is in `todo-archive.md`, Phase 16.

Not built, by choice: a disposable integration rig as a test tier, and CI (no runner yet —
Forgejo Actions is in the backlog). Every check runs by hand before a change is done.

---

## Resilience

| Failure | Effect | Why it's contained |
|---|---|---|
| Loskai down | Nothing can be changed; everything keeps running | Loskai is never in the data path |
| Caddy restarts | Routes come back by themselves | Autosave + `--resume`; Sync if the autosave is lost |
| AdGuard down | Names stop resolving; routes still created | Rewrites are best-effort; a fallback DNS in clients |
| Docker host reboots | Its containers restart; in layout A, DNS and HTTPS stay up | Caddy and AdGuard on their own boxes |
| Docker daemon away | The follower waits and catches up | Backoff, catch-up on reconnect |

---

## Future

In the backlog (`TODO.md`), not built:

- **One command on several machines at once**, and **a second login factor** (TOTP) —
  what is left of [managing the machines over SSH](#direction--managing-the-machines-over-ssh).
- **"There's a recipe for this"** — a hint on an unmanaged container whose image a recipe uses.
- **Certificate status** — expiry and issuer per name, as a TLS probe of the served
  certificate (it would cover any CA, not only the internal one).
- **Uptime monitoring** and **notifications** — a container crashed, AdGuard down.
- **Multi-host** — a second Docker host in the same Docker tab; perhaps over SSH from Machines
  rather than an agent.
- **A real domain with DNS-01** — publicly trusted certificates, no root to install.
