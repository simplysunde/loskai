[Docs](../README.md) › [Reference](../README.md#reference)

# The status key's forced command

**Read this when** you are adding something Loskai reads from a machine without the admin
password — a fact on the machine page, an entry in its running list — or changing how it is
read.

Loskai keeps a second SSH key, the **status key**, unencrypted (`data/ssh/status_ed25519`),
so a machine's running list and overview work while the main key is locked. It is safe to
keep in the clear only because **the machine** limits it: its `authorized_keys` line is

```
restrict,from="<Docker host>",command="<STATUS_COMMAND>" ssh-ed25519 AAAA… loskai-status
```

`restrict` takes away the shell, the pty and every kind of forwarding; `from=` the
addresses it works from; and `command=` makes sshd run Loskai's command **whatever the
client asks for**. The text is `logic.STATUS_COMMAND`, in
`backend/src/loskai/modules/ssh/logic.py`, and this page is its contract.

## Requests

The client's command doesn't run — it arrives as `$SSH_ORIGINAL_COMMAND`, and the forced
command only compares it in a `case` to pick one of two fixed answers:

| Request | Answer | Parsed by | Asked by |
|---|---|---|---|
| `running` (or anything else, or nothing) | What runs: containers, services, Proxmox guests | `logic.parse_running` | `GET /api/ssh/running` — the Machines tab, every 30 s, for every set-up machine |
| `facts` | The overview: OS, kernel, uptime, memory, disks, updates waiting, tools, tmux sessions | `logic.parse_facts` | `GET /api/ssh/machines/{id}/facts` — the machine's own page, every 60 s |

Two requests rather than one answer, because the overview costs more (counting updates
runs the package manager's simulation, ~0.5 s) and only one page shows it.

## The output

The first line is always the version, `#loskai-status <n>`. The rest are sections, each a
marker line followed by its rows.

**`running`** — markers `#docker`, `#systemd`, `#pct`, `#qm`:

| Section | Rows | Notes |
|---|---|---|
| `#docker` | `name\|image\|status` (`docker ps --format`) | only where `docker` exists |
| `#systemd` | `systemctl list-units --type=service --state=running` | base services counted as `hidden` (`BASE_SERVICES`, `BASE_PREFIXES`) |
| `#pct`, `#qm` | `pct list`, `qm list` | only on Proxmox; running guests kept |

A row of `!denied` means the SSH user may not read that list: each tries the plain command,
then `sudo -n` (which never prompts), then says `!denied`.

**`facts`** — markers start `#=`, because an `/etc/os-release` comment can start with `#`:

| Section | Rows | Becomes |
|---|---|---|
| `#=os` | `/etc/os-release` | `os` (PRETTY_NAME), `os_id`, `os_like` |
| `#=kernel` | `uname -sr` | `kernel` |
| `#=uptime` | `/proc/uptime` | `uptime`, seconds |
| `#=memory` | `MemTotal`, `MemAvailable` from `/proc/meminfo` | `memory`, bytes |
| `#=disks` | `df -P -k` | `disks` — block devices and `/` only, each device once, no loop devices |
| `#=updates` | `<manager> <count>` | `updates` — from the machine's package lists as last refreshed; nothing is fetched |
| `#=tools` | one name per line, from `PROGRAMS` | `programs` — what tools require |
| `#=tmux` | `name\|created\|attached\|windows` (`tmux ls -F`) | `tmux` |

`PATH` gets `$HOME/.local/bin` first: a forced command has sshd's `PATH`, not the login
shell's, and per-user installs (Claude Code) live there.

## Rules for the command

- **It only reads.** Nothing in it changes the machine. A command that acts belongs to the
  main key, which needs the admin password.
- **No double quotes and no backslashes** — it sits inside `command="…"`. A test fails if
  either appears.
- **POSIX `sh`.** It runs under the user's login shell, which may be `dash`, `bash` or
  `ash`. The test suite runs it with `sh` for every request.
- **`sudo -n` only**, so it never waits for a password.
- **Nothing secret in the output** — it is cached and served to the logged-in admin.

## Versions

`STATUS_VERSION` is the first line. Changing what the command runs means each machine needs
the new line, so:

1. Bump `STATUS_VERSION`, and add the old one to `OLD_STATUS_VERSIONS`.
2. Keep every parser accepting the versions whose output it can still read.
   `parse_running` reads both: the running part didn't change in v2.
3. A request an old line can't answer raises `logic.OldStatusLine`. The page then says
   "install again" and offers the button. One click on the machine's page reinstalls both lines.

| Version | What changed |
|---|---|
| 1 | The running list (Phase 34c) |
| 2 | The `facts` request — the machine page's overview (Phase 34e) |

## Adding a fact

1. Add a section to `_FACTS` in `logic.py`: `echo '#=<name>'; <command>;`, following the
   rules above.
2. Parse it in `parse_facts` into a key, and add a row to the table above.
3. Bump the version (see above).
4. Add the key to `Facts` in `frontend/src/lib/ssh.ts`, and show it in `MachineOverview`.
5. Tests: a sample in `test_ssh_logic.py`. The test that runs the real command picks up the
   new section by itself.
