[Docs](../README.md) › [Reference](../README.md#reference)

# The status key's forced command

**Read this when** you are adding something Loskai reads from a machine without anyone's
password — a fact in the machine's overview, an entry in its running list — or changing how it is
read.

Loskai keeps a second SSH key, the **status key** (`data/ssh/status_ed25519`), used without
anyone unlocking it, so a machine's running list and overview work while the main key is
locked. That is safe only because **the machine** limits it: its `authorized_keys` line is

```
restrict,from="<Docker host>",command="<STATUS_COMMAND>" ssh-ed25519 AAAA… loskai-status
```

`restrict` takes away the shell, the pty and every kind of forwarding; `from=` the
addresses it works from — the Docker host's (`host_ip`), plus, on the Docker host itself,
the subnets of Loskai's container's networks, since Docker doesn't translate those
connections; left out when `host_ip` is unset; and `command=` makes sshd run Loskai's
command **whatever the client asks for**. The text is `logic.STATUS_COMMAND`, in
`backend/src/loskai/modules/ssh/logic.py`, and this page is its contract.

## Requests

The client's command doesn't run — it arrives as `$SSH_ORIGINAL_COMMAND`, and the forced
command only compares it in a `case` to pick one of two fixed answers:

| Request | Answer | Parsed by | Asked by |
|---|---|---|---|
| `running` (or anything else, or nothing) | What runs: containers, services, Proxmox guests, and the ports the containers and services take | `logic.parse_running` | `GET /api/ssh/running` — the Machines tab, every 30 s, for every set-up machine; `POST /api/ssh/machines/{id}/test` (and an install, which ends with it), for that one |
| `facts` | The overview: OS, kernel, uptime, memory, disks, updates waiting, programs, tmux sessions, the Tailscale address and tailnet, the projects | `logic.parse_facts` | `GET /api/ssh/machines/{id}/facts` — the machine's own page, every 60 s; and a tool's command, the sudo rule's and a tool's settings, which need its package manager and programs (`connect._overview`) |

Two requests rather than one answer, because the overview costs more (counting updates
runs the package manager's simulation, ~0.5 s) and only one page shows it.

Each is served as `{ ok: true, …parsed }`, or `{ ok: false, error }` when it can't be read
(with `old: true` for a status line older than this Loskai), stamped `checked` (seconds
since the epoch). A running list is reused for 30 s and an overview for 60 s (`RUNNING_TTL`,
`FACTS_TTL` in `connect.py`), so however many tabs ask, a machine is asked at most that often.

## The output

The first line is always the version, `#loskai-status <n>`. The rest are sections, each a
marker line followed by its rows.

**`running`** — markers `#docker`, `#systemd`, `#listen`, `#pct`, `#qm`, `#addr`:

| Section | Rows | Notes |
|---|---|---|
| `#docker` | `name\|image\|status\|ports` (`docker ps --format`) | only where `docker` exists; `ports` since v6 |
| `#systemd` | `systemctl list-units --type=service --state=running` | base services counted as `hidden` (`BASE_SERVICES`, `BASE_PREFIXES`), but `LISTEN_ALSO` (Proxmox's `pveproxy`), listed so its port can be routed |
| `#listen` | each `ss -Htlnp` line, then `@<pid> <unit>` for each process behind it (the unit from `/proc/<pid>/cgroup`, empty for none) | since v6; only where `ss` exists |
| `#pct`, `#qm` | `pct list`, `qm list` | only on Proxmox; running guests kept. As root (or through sudo for `sh`), one script prints both and `#addr` from the same lists — since v8, each list runs once |
| `#addr` | `<id> <address>…` per running guest: an LXC's from `lxc-info -iH`, a VM's from its QEMU guest agent (`qm guest cmd <id> network-get-interfaces`, at most 3 s each, side by side) | since v7; only on Proxmox, as root or through sudo, else absent; a VM without the agent gets no address |

A row of `!denied` means the SSH user may not read that list: `docker`, `pct` and `qm` each
try the plain command, then `sudo -n` (which never prompts) where sudo allows it, then say
`!denied`. `systemctl` runs once, with no fallback. `#listen` runs as root when the user is
root or sudo allows it `sh`; otherwise it says `!partial` and runs as the user, who sees only
its own processes' sockets — the others' ports come without a pid, so without a service.

**Sudo is asked so that it logs nothing** (since v8). `sudo -n true` — and any command sudo
refuses — is logged as an incident, and may mail root: on every poll, for a user without
sudo. So the line first asks `sudo -n -l` (no command), which sudo refuses without logging
to a user with no passwordless rule; only then, for each use, `sudo -n -l <command>`, which
it answers without logging to a user with one; and runs `sudo -n <command>` only when that
says yes. A user with no sudo, or a narrow rule (Loskai's own for updates), leaves nothing
in the machine's logs.

Parsed to `{ containers, services, hidden, guests, listening, denied }`:

- `containers` `{name, image, status, ports}` — `ports` the TCP ports published off
  loopback, a range as each of its ports unless wider than 16 (then its first) (`[]` from a
  line before v6);
- `services` the unit names without `.service` (with `LISTEN_ALSO`'s, though base); `hidden` how many base services were left out;
- `guests` the running ones, `{id, name, kind, addresses}` with `kind` `lxc` or `vm`, and
  `addresses` its IPv4 ones off loopback and link-local (`[]` where unknown);
- `listening` the ports services listen on, `{service, port, host}` — `host` "" when on
  every address (also when bound to an interface, `0.0.0.0%eth0`), else the one it is on.
  Left out: loopback, a process with no unit, the
  base services except `LISTEN_ALSO` (Proxmox's `pveproxy`), and a port a container
  publishes (Docker's proxy holds it; the container lists it). `null` from a line before v6;
- `denied` the sections that said `!denied`, `listen` for `!partial`, and `ss` for a v6 line
  with no `#listen` section — the machine has no `ss`, so its ports can't be listed.

The Add route picker's Machines source offers these ports
([architecture.md](../project/architecture.md)).

**`facts`** — markers start `#=`, because an `/etc/os-release` comment can start with `#`:

| Section | Rows | Becomes |
|---|---|---|
| `#=os` | `/etc/os-release` | `os` (PRETTY_NAME, else NAME), `os_id`, `os_like` |
| `#=kernel` | `uname -sr` | `kernel` |
| `#=uptime` | `/proc/uptime` | `uptime`, seconds |
| `#=memory` | `MemTotal`, `MemAvailable` from `/proc/meminfo` | `memory`, bytes |
| `#=disks` | `df -P -k` | `disks` — block devices and `/` only, each device once, no loop devices and no pseudo filesystem (`tmpfs`, `overlay`, … — `_PSEUDO_FS`) |
| `#=updates` | `<manager> <count>` | `updates` — from the machine's package lists as last refreshed; nothing is fetched |
| `#=tools` | one name per line, from `PROGRAMS` | `programs` — what tools require |
| `#=tmux` | `name\|created\|attached\|windows` (`tmux ls -F`) | `tmux` |
| `#=tailscale` | `tailscale ip -4`, only where `tailscale` is | `tailscale` — the address, or `null` when it isn't connected |
| `#=tailnet` | `tailscale status`, at most 100 lines, only where `tailscale` is | `tailnet` — `{ip, name, os, online, self, status}` per device, this machine first; other lines (`Logged out.`, health checks) skipped |
| `#=tsroutes` | `shared <cidr>…` (`tailscale get advertise-routes`; an older Tailscale without `get` shows none) and `approved <cidr>…` (its own `PrimaryRoutes`, from `tailscale status --json --peers=false`), only where `tailscale` is | `tailscale_routes` — `{shared, approved}`, without an exit node's `0.0.0.0/0` and `::/0`; `null` with no section (no Tailscale, or a line before v9) |
| `#=projects` | `path\|branch\|dirty\|claude\|ahead\|committed\|subject` | `projects` — see below |
| `#=sudo` | `on` or `off` — whether `/etc/sudoers.d/loskai` is there; nothing where the user can't search that folder | `sudo_rule` — `"on"`, `"off"` or `null` |

**Projects** are the git repos one and two folders into the home folder (`~/<x>/.git`,
`~/<x>/<y>/.git`), since a machine's projects folder is `~` or one folder in it; at most
200. A path with any character but letters, digits, `.`, `_`, `/` and `-` is skipped, so
the command never has to quote one. Each row is printed by `git log --format` itself — or
`echo` for a repo without a commit — so the subject, which can hold anything, never passes
through the shell, and is last so a `|` in it stays. `branch` is `-` when it isn't one
(detached, or an odd name); `dirty` is `1` when `git status --porcelain` lists anything;
`ahead` is how many commits aren't on its upstream yet — as of the last fetch, since the
command never fetches — or `-` without an upstream; `claude` is when the newest
conversation Claude Code keeps for the folder was written
(`~/.claude/projects/<the path, every other character a ->/*.jsonl`), `committed` the last
commit's time — both seconds, `0` for never. Each row becomes `{path, folder, name, branch,
dirty, claude, ahead, committed, subject}` — `folder` the path's parent (`""` for one
directly in the home folder), `branch` and `ahead` `null` where the row says `-`, `dirty` a
boolean.

For `facts`, `PATH` gets `$HOME/.local/bin` appended (`logic.USER_PATH`): a forced command
has sshd's `PATH`, not the login shell's, and per-user installs (Claude Code) live there.

## Rules for the command

- **It only reads.** Nothing in it changes the machine. A command that acts belongs to the
  main key, which a user unlocks with their own password.
- **No double quotes and no backslashes** — it sits inside `command="…"`. A test fails if
  either appears.
- **POSIX `sh`.** It runs under the user's login shell, which may be `dash`, `bash` or
  `ash`. The test suite runs it with `sh` for every request.
- **`sudo -n` only**, so it never waits for a password — and only once `sudo -n -l` says
  the command is allowed, so a refusal is never logged.
- **Nothing secret in the output** — it is cached and served to the logged-in admin.

## Versions

`STATUS_VERSION` is the first line. Changing what the command runs means each machine needs
the new line, so:

1. Bump `STATUS_VERSION`, and add the old one to `OLD_STATUS_VERSIONS`.
2. Keep every parser accepting the versions whose output it can still read.
   `parse_running` reads them all — from a line before v6, without ports; before v7,
   without guest addresses.
   `parse_facts` reads `FACTS_VERSIONS` (v5 to v9; before v9, without `tailscale_routes`) — a
   page on an older line says so.
3. A request an old line can't answer raises `logic.OldStatusLine`. The page then says
   "install again" and offers the button. One click in the machine's dialog reinstalls both lines.

| Version | What changed |
|---|---|
| 1 | The running list (Phase 34c) |
| 2 | The `facts` request — the machine page's overview (Phase 34e) |
| 3 | `facts` adds `tailscale` and `curl` to the programs, the Tailscale address, and the projects (Phase 34g) |
| 4 | `facts` adds the tailnet (`tailscale status`), and each project's commits not pushed |
| 5 | `facts` adds `sudo`: whether Loskai's sudo rule (updates without a password) is there |
| 6 | `running` adds each container's ports and `#listen`, the ports services listen on (Phase 42a) |
| 7 | `running` adds `#addr`, each running Proxmox guest's addresses (Phase 43a) |
| 8 | `running` asks sudo with `sudo -n -l` before using it, so sudo logs no refusal every poll; a Proxmox host's `pct list` and `qm list` run once, not twice |
| 9 | `facts` adds `#=tsroutes`: the networks a machine shares with its tailnet, and which are approved |

## Adding a fact

1. Add a section to `_FACTS` in `logic.py`: `echo '#=<name>'; <command>;`, following the
   rules above.
2. Parse it in `parse_facts` into a key, and add a row to the table above.
3. Bump the version (see above).
4. Add the key to `Facts` in `frontend/src/lib/ssh.ts`, and show it in `MachineOverview`.
5. Tests: a sample in `test_ssh_logic.py`. The test that runs the real command picks up the
   new section by itself.
