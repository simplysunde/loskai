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
command **whatever the client asks for**. The text is `status.STATUS_COMMAND`, in
`backend/src/loskai/modules/ssh/status.py`, and this page is its contract.

## Requests

The client's command doesn't run — it arrives as `$SSH_ORIGINAL_COMMAND`, and the forced
command only compares it in a `case` to pick one of two fixed answers:

| Request | Answer | Parsed by | Asked by |
|---|---|---|---|
| `running` (or anything else, or nothing) | What runs: containers, services, Proxmox guests, and the ports the containers and services take | `status.parse_running` | `GET /api/ssh/running` — the Machines tab, every 30 s, for every set-up machine; `POST /api/ssh/machines/{id}/test` (and an install, which ends with it), for that one |
| `facts` | The overview: OS, kernel, uptime, memory, disks, updates waiting, programs, tmux sessions, the Tailscale address and tailnet, the projects, the SSH keys | `status.parse_facts` | `GET /api/ssh/machines/{id}/facts` — the machine's own page, every 60 s; and a tool's command, the sudo rule's and a tool's settings, which need its package manager and programs (`connect._overview`) |

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

**Sudo is asked so that it logs nothing** (since v8, and right since v10). `sudo -n true` —
and any command sudo refuses — is logged as an incident, and may mail root: on every poll.
`sudo -n -l` lists the user's rules without logging — but it answers as soon as *one* rule
needs no password (sudo's default `listpw=any`), so it can't say whether a given command
does. Up to v9 the line took `sudo -n -l <command>` saying yes as permission; with Loskai's
own rule for updates beside a password-protected `ALL` (Ubuntu's `%sudo`), every check said
yes and every use was refused — the ports and Proxmox's guests read as none, and a refusal
logged each poll. Since v10 it uses sudo only when, in that listing, the last rule for every
command (`ALL`), run as root, has `NOPASSWD` — sudo goes by the last rule that matches —
and then still asks `sudo -n -l <command>` before each use. Anything narrower, Loskai's own
rule included, uses no sudo: the lists are read as the user, and say what they couldn't
read (`!partial`, `!denied`). Nothing is left in the machine's logs.

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
| `#=tsself` | `state <BackendState>` (from `tailscale status --json --peers=false`), `shared <cidr>…` (`tailscale get advertise-routes`; an older Tailscale without `get` shows none) and `approved <cidr>…` (its own `PrimaryRoutes`, from the same status), only where `tailscale` is | `tailscale_self` — `{state, shared, approved}`: `state` `on` (Running), `off` (Stopped), `login` (NeedsLogin), `approval` (NeedsMachineAuth) or `null`; the networks without an exit node's `0.0.0.0/0` and `::/0`. `null` with no section (no Tailscale, or a line before v9) |
| `#=projects` | `path\|branch\|dirty\|claude\|ahead\|key\|committed\|subject` (`key` since v11) | `projects` — see below |
| `#=keys` | `name\|<type data>\|<ssh-keygen -lf line>` for each `~/.ssh/*.pub`, at most 50 — the public halves only, never a private key; only where `ssh-keygen` is (`<type data>`, the key itself, since v13) | `ssh_keys` — `{name, bits, fingerprint, comment, type, public}`, `public` the key to paste (`null` before v13), `comment` `""` where ssh-keygen says "no comment", `type` a security key's too (`ED25519-SK`); `null` from a line before v11 |
| `#=remotes` | `path\|module\|<remote>.url or <remote>.pushurl\|address` for every remote of each project and of its submodules (`.git/modules/<name>/config`, three deep), at most 300 — a `user:token@` taken out of the address on the machine, before it is printed; the remote's name since v15 | `remotes` — `{path, module, remote, kind, url}`, `module` `""` for the project itself, `remote` `""` before v15; `null` before v12 |
| `#=sshhosts` | `host\|hostname\|identitiesonly\|file…` for each SSH host those remotes name (`git@host:…`, `ssh://…`), at most 30: what `ssh -G` resolves for it — aliases, `Host *`, `Include`, `Match`, as a connection would — without connecting. Since v14, only `!match-exec` where `~/.ssh/config` or the system's (`/etc/ssh/ssh_config`, `ssh_config.d/*.conf`) has a `Match exec`: ssh would run that command to answer, and the command only reads. Since v15 the files those two `Include` are looked in too, one level: one that includes again isn't followed, and isn't asked | `ssh_hosts` — `{host: {hostname, identities_only, keys}}`, `keys` the names of those files in `~/.ssh`; `null` before v12; `ssh_match_exec` true where it wasn't asked |
| `#=sshconfig` | the `IdentityFile`s `~/.ssh/config` names — nothing else of that file | `ssh_config_keys` — their names, of those in `~/.ssh`; `null` before v12 |
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
commit's time — both seconds, `0` for never; `key` (since v11) the SSH key git uses for
it, read from its `core.sshCommand`'s `-i` file by name — `-` for none (the machine's
keys), `+` for a command naming no file that way — so a key and the projects using it are
read together (Git's Keys). Each row becomes `{path, folder, name, branch, dirty, claude,
ahead, committed, subject, key}` — `folder` the path's parent (`""` for one directly in the
home folder), `branch` and `ahead` `null` where the row says `-`, `dirty` a boolean, `key`
`null` for `-` (and before v11), `""` for `+`.

**What the sessions are** is added after reading, not by the machine: `tool.claim_sessions`
gives each tmux session its `tool` — the one whose shared `session` it is (`claude-site` is
Claude Code's), else `null` — and the overview `live`, by tool and kind, the rows whose
shared session is running: `{"claude": {"project": ["site"]}}`. Sessions are named by
`tool.session_name` only, so the page reads these and never names one.

For `facts`, `PATH` gets `$HOME/.local/bin` appended (`status.USER_PATH`): a forced command
has sshd's `PATH`, not the login shell's, and per-user installs (Claude Code) live there.

## Rules for the command

- **It only reads.** Nothing in it changes the machine. A command that acts belongs to the
  main key, which a user unlocks with their own password. That includes what it asks of
  another program: `ssh -G` runs nothing — unless an ssh config's `Match exec` tells it to,
  so where one has that, it isn't asked (v14).
- **No double quotes and no backslashes** — it sits inside `command="…"`. A test fails if
  either appears.
- **POSIX `sh`.** It runs under the user's login shell, which may be `dash`, `bash` or
  `ash`. The test suite runs it with `sh` for every request.
- **`sudo -n` only**, so it never waits for a password — and only where the user's rules
  let every command run without one, so a refusal is never logged (above).
- **Nothing secret in the output** — it is cached and served to every account with the
  Machines tab. A key is read by its public half; a remote's address loses any
  `user:token@` on the machine; of `~/.ssh/config`, only the `IdentityFile`s are read.

## Versions

`STATUS_VERSION` is the first line, `#loskai-status <STATUS_LINE>`; `line_version` reads the
number back. Changing what the command runs means each machine needs the new line, so:

1. Bump `STATUS_LINE`. Every earlier number stays readable on its own.
2. Keep every parser accepting the versions whose output it can still read.
   `parse_running` reads them all — from a line before v6 (`LISTEN_SINCE`), without ports;
   before v7, without guest addresses.
   `parse_facts` reads every line from v5 (`FACTS_SINCE`; before v9, without
   `tailscale_self`; before v11, `KEYS_SINCE`, without keys; before v12, `REMOTES_SINCE`,
   without remotes; before v13, `PUBLIC_SINCE`, without a key's public half; before v15,
   `REMOTE_NAMES_SINCE`, without a remote's name), and says `outdated` for any but the current one — the overview offers the reinstall. A page on an older line says so. A number newer than this Loskai's is
   not read.
3. A request an old line can't answer raises `status.OldStatusLine`. The page then says
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
| 9 | `facts` adds `#=tsself`: whether the machine is connected to its tailnet, the networks it shares, and which are approved |
| 10 | sudo is used only where its last rule for every command needs no password: a check that a command was allowed said nothing of the password, so with Loskai's update rule every use was refused, and logged. `#=tsself` asks `tailscale status` once, not twice |
| 11 | `facts` adds `#=keys`, the SSH user's keys by their public halves, and each project's `key` — the one git uses for it (Git's Keys) |
| 12 | `facts` adds `#=remotes`, `#=sshhosts` and `#=sshconfig`: every remote of each project and submodule, the keys ssh offers each SSH host they name, and the keys `~/.ssh/config` names — so a key used through an alias is seen (Git's Keys, Test, Delete) |
| 13 | `#=keys` carries each key's public half, its type and data — public, to copy and paste into GitHub or Forgejo (Git's Keys) |
| 14 | `#=sshhosts` isn't asked where an ssh config has `Match exec` — `ssh -G` would run that command — and says `!match-exec` instead |
| 15 | `#=remotes` names each remote (`origin.url`), so a pushurl is its own remote's; `#=sshhosts` isn't asked where a file the ssh config `Include`s has `Match exec`, or includes again |

## Adding a fact

1. Add a section to `_FACTS` in `status.py`: `echo '#=<name>'; <command>;`, following the
   rules above.
2. Parse it in `parse_facts` into a key, and add a row to the table above.
3. Bump the version (see above).
4. Add the key to `Facts` in `frontend/src/lib/ssh.ts`, and show it in `MachineOverview`.
5. Tests: a sample in `test_ssh_status.py`. The test that runs the real command picks up the
   new section by itself.
