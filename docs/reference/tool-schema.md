[Docs](../README.md) › [Reference](../README.md#reference)

# Tool schema

**Read this when** you are adding a tool, adding an action to one, or changing how a
machine's dialog runs them.

A **tool** gives a machine's dialog things to do: buttons that run a command on the machine
over SSH. Each one is a YAML file in `backend/src/loskai/modules/ssh/tools/`, shipped in
the image, so a new tool or a change to one comes with a new version of Loskai.

**Nothing is enabled or stored.** A tool **applies** to a machine that has every program
it `requires`, as the machine's overview found them:

- **Standard tools** need nothing Loskai installs. System applies everywhere, Services puts
  its buttons on every row of the Running list, and Proxmox applies where `pct` and `qm`
  are.
- **Added tools** need a program the machine may not have yet, such as tmux. One whose
  missing programs Loskai can all install is offered under **Add tool**, on the Tools
  heading of the machine's dialog. Adding it installs them, and from then on it applies.

**The Tools category of the machine's dialog has a card for each tool that applies**; the Running
list's rows get the row actions. Which is standard follows from the programs: a tool
requiring something in `INSTALLERS` is an added one. An added tool's card says in a few
words what is in it (`3 sessions`, `4 projects, 1 running`), and **the Tools button on the
machine's row in the Machines tab** lists each added tool with that summary — or `not
added` — and opens it in a dialog (`ToolDialog`): the card, or, for a tool not added yet,
what it needs, which of that the machine has, and **Add**. The row reads the machine's overview only while that menu
is open. When the overview can't be read, the dialog says why, with a button to
the fix: **Install again** (the machine's SSH setup) for an older status line, else the
machine's settings.

Like a recipe, a tool is **data, validated and never executed by Loskai**. An action's
command comes from its file. The browser only names a tool, an action and, for an action
on a row of the Running list, that row's **target**. The target is checked against its kind
and reaches the command as `$1`, an argument, so no value can change what runs. The loader
is `modules/ssh/tool.py`.

## A file

The file name is the tool's id (`system.yml` → `system`): lowercase letters, digits and
`-`.

```yaml
name: System                      # required
description: Update the system, reboot, shut down.   # required — one line, its tooltip
requires: [tmux]                  # optional — programs the machine must have
actions:                          # required — at least one
  update:                         # the action's id
    label: Update                 # required — the button
    description: Refresh the package lists, then install every update.   # required — its tooltip
    run:                          # required — one command, or one per package manager
      apt: sudo apt-get update && sudo apt-get -y dist-upgrade
      dnf: sudo dnf -y upgrade --refresh
  reboot:
    label: Reboot
    description: Restart the machine.
    confirm: Everything on it stops until it is back up.   # optional — asked first
    automatic: true               # optional — runs to the end by itself (below)
    run: sudo reboot
  restart-service:
    label: Restart
    description: Restart this service.
    target: service               # optional — a button on each service in the Running list
    run: sudo systemctl restart "$1"
  new:
    label: New session
    description: Start a session with this name.
    ask: session                  # optional — a name typed on the page, checked like a target
    session: false                # optional — no tmux session around it: it is tmux itself
    run: tmux new-session -A -s "$1"
```

Unknown keys are refused. The validator names every problem at once.

### `requires`, and getting a program

`requires` lists programs by name. A program must be one the overview detects:
`logic.PROGRAMS` (`tmux`, `claude`, `docker`, `pct`, `qm`, `git`, `sudo`, `tailscale`,
`curl`).

How to get a program is said once, for every tool, in `tool.INSTALLERS`:

- `packages`, by package manager: Loskai runs that manager's install for the package (see
  `tool.PACKAGE_INSTALL`), with `sudo`.
- `script`: one command, for a program that isn't a distro package, such as an official
  installer. Scripts are fetched with `curl`, so a machine without it gets it first.

Adding a tool installs everything it lacks in one go: the packages in one command, then
each script. A program that isn't in `INSTALLERS` can't be installed from Loskai. `pct` and
`qm` come only with Proxmox, so that tool simply never applies elsewhere, and isn't offered.

### `run`

A command for POSIX `sh`, run as the machine's SSH user:

- **One per package manager** (`apt`, `dnf`, `apk`, `pacman`) when it differs. The machine's
  manager is the one its overview found. An action without one for it can't run there,
  and says so.
- **`sudo`** for what needs root. The user answers its password prompt in the terminal, and
  Loskai holds no machine password. When the login *is* root, as on Proxmox, `sudo` becomes
  a plain call, so the same file works with or without sudo installed.
- **`$1`** is the target, for an action with `target` or `ask`. Always quote it: `"$1"`.
- `~/.local/bin` is on the `PATH`, as it is for the overview: per-user installs go there.
- **System's `update` must stay plain `sudo <program> <args>` steps joined by `&&`**: the
  sudo rule for updates without a password allows exactly those steps
  (`tool.update_commands`), so a change there needs the rule allowed again on each machine.
- **`$PROJECTS`** is the machine's projects folder — `~/projects` unless it was changed in
  the machine's dialog, under General (`~` or one folder in it), as an absolute path.

### `target` and `ask`

What a row action is on, and what its target must look like (`tool.TARGETS`):

| `target` | A button on | `$1` |
|---|---|---|
| *(none)* | the tool's card — the machine itself | — |
| `service` | each service in the Running list | the systemd unit, `nginx` |
| `container` | each container | its name |
| `lxc` | each running LXC (Proxmox) | its id, `101` |
| `vm` | each running VM (Proxmox) | its id, `200` |
| `session` | each tmux session, listed on the tool's card | its name, `work` |
| `project` | each project — a git repo in the projects folder — on the tool's card | its folder's name, `site`: the project is `$PROJECTS/$1` |

Every kind starts with a letter, a digit or (a session) `_`, never `-`, so `$1` can't reach a
command as one of its options.

The key is `target`, not `on`: YAML reads `on:` as `true`. The rows a tool's card lists
come from the overview (`rowsOf` in `lib/toolRows.ts`); the Running list's kinds stay on
its rows. A tmux session another tool claims — named after an action's shared `session`,
like `claude-site` — is listed on that tool's card, not tmux's.

`ask` takes the same kinds, for an action on something that doesn't exist yet: the card
shows a name field beside its button, and the name is checked against the kind and passed
as `$1`, exactly like a target. An action has one or the other.

### `session`

Which tmux session the action runs in, where the machine has tmux:

- *(left out)*: Loskai's own, one per action and target — `loskai-<tool>-<action>[-<target>]`.
- **a name**: shared by every action that gives it, one per target — `<name>-<target>`.
  Running any of them while it is there attaches to it instead of starting another, and a
  card's row says `running` while it is there.
- **`false`**: none — for an action that is tmux itself, such as attaching to a session.

### `automatic`

`true` for an action that runs to the end without anyone at it: System's update, a reboot,
restarting a service. Before its terminal opens, sudo's password is asked for in a dialog,
when sudo would ask, and checked on the machine. The terminal then closes itself when the
command succeeds; a failure stays open with its exit code. Leave it out for anything whose
output is the point (a status, a pull) or that you work in (a shell, an attach, Claude,
a login link): those answer sudo in the terminal. Adding a tool, and the sudo rule, always
run this way.

## How an action runs

`tool.visible` builds what the terminal runs:

1. The command under `sh -c`, with the target as `$1`.
2. Then `[done, exit N] Enter closes this.`, waiting for Enter, so the output stays on
   screen. An `automatic` one ends at once when it succeeds, and otherwise says
   `[failed, exit N]` and waits.
3. **Inside tmux** when the machine has it, in the session `session` says. Closing the
   browser tab leaves it running, and running the same action again attaches to it rather
   than starting a second.

Adding a tool runs the same way, but never inside tmux: tmux may be what it installs.

It opens in the machine's terminal, so it needs Loskai's key unlocked like any terminal.
With sudo's password from the dialog, the terminal's first line is that password, which
the command reads with echo off and hands to `sudo -S -v`; in tmux, through a FIFO.
The SSH log records it as `action` (with the tool, the action, the target, the command and
the tmux session) or `add-tool` (with the tool, the programs and the command).

## Adding a tool

1. Add `tools/<id>.yml`.
2. Run `uv run pytest tests/test_ssh_tool.py`. Its first test loads every shipped tool,
   so a mistake fails there with every problem named.
3. If it needs a program the overview doesn't detect yet, add it to `logic.PROGRAMS` first.
   That changes the status command, so it follows [ssh-status.md](ssh-status.md)'s
   version steps. If Loskai can install it, add it to `tool.INSTALLERS`.
4. A new kind of `target` needs a row in the Running list to put it on: `tool.TARGETS`,
   `RunningList`, and this page.
5. Optionally icons, in `frontend/src/components/routing/ToolIcon.tsx`: the tool's 24×24
   path in `PATHS`, by its id (without one it gets a wrench). An action's symbol, by
   `<tool>.<action>`, should say what its button does: a program's own logo in `ACTIONS`
   (Claude's mark on opening Claude, git's on Pull and Push), else a Lucide icon in
   `SYMBOLS` — a plug for Connect, a square for Stop or End, a power button for Shut down.
   Without either it gets a play button. Logos come from Simple Icons (simpleicons.org);
   check the license: one that asks for credit, like Git's (CC BY 3.0), gets a line in the
   README's Credits.
6. Note it in `CHANGELOG.md`. It ships with the next image.
