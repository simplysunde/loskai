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
  its buttons on every service and container in the Running list, and Proxmox, which
  applies where `pct` and `qm` are, on each running LXC and VM.
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

The file name is the tool's id (`system.yml` → `system`): a lowercase letter or digit, then
at most 40 more of those or `-` (`^[a-z0-9][a-z0-9-]{0,40}$`). An action's id, a setting's
id and a shared `session` name follow the same rule.

```yaml
name: System                      # required
description: Update the system, reboot, shut down.   # required — one line, its tooltip
requires: [tmux]                  # optional — programs the machine must have
actions:                          # required — at least one, unless it has `settings`
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
`status.PROGRAMS` (`tmux`, `claude`, `docker`, `pct`, `qm`, `git`, `sudo`, `tailscale`,
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
- **`sudo`** for what needs root. The user answers its password prompt in the terminal — or,
  for an `automatic` action, in a dialog first, and Loskai holds that password in memory
  under a one-time ticket for that run, for at most 60 s; it stores none. When the login
  *is* root, as on Proxmox, `sudo` becomes a plain call, so the same file works with or
  without sudo installed.
- **`$1`** is the target, for an action with `target` or `ask`. Always quote it: `"$1"`.
- `~/.local/bin` is on the `PATH`, as it is for the overview: per-user installs go there.
- **System's `update` must stay plain `sudo <program> <args>` steps joined by `&&`**: the
  sudo rule for updates without a password allows exactly those steps
  (`tool.update_commands`), so a change there needs the rule allowed again on each machine.
- **`$PROJECTS`** is the machine's projects folder — `~/projects` unless it was changed on
  the Git tool's card (`~` or one folder in it), as an absolute path.

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
| `repo` | only with `ask` (Git's Clone): a field for a repository's address | `https://…`, `http://…`, `ssh://…`, `git://…` (a user and a host that each start with a letter or digit), or `user@host:path` — never another transport (`ext::` runs a command) |

Every target kind starts with a letter, a digit or (a session) `_`, never `-`, so `$1` can't
reach a command as one of its options. A setting's kinds (`git-name`, `email`, below) are
not held to that: their value can start with `-`.

The key is `target`, not `on`: YAML reads `on:` as `true`. The rows a tool's card lists
come from the overview (`rowsOf` in `lib/toolRows.ts`); the Running list's kinds stay on
its rows. A tmux session another tool claims — named after an action's shared `session`,
like `claude-site` — is listed on that tool's card, not tmux's.

An action with neither is the machine's. On a card that lists rows, those sit at the
list's foot, under the rows' buttons (Git's **Pull all** and **Push all**), and what asks
for a name to its left.

`ask` takes the same kinds, for an action on something that doesn't exist yet: the card
shows a name field beside its button, and the name is checked against the kind and passed
as `$1`, exactly like a target. An action has one or the other.

### `settings`

A tool can also have **settings**: values on the machine its card shows and sets, such as
Git's commit name and email. A tool needs at least one action or one setting; one with only
settings leaves `actions` out (`actions: {}` is refused).

```yaml
settings:
  email:
    label: Email                                   # required
    description: On every commit made here.        # required
    value: email                                   # required — a kind, as for `target`
    read: git config --global user.email           # required — prints the value
    write: git config --global user.email "$1"     # required — sets it to $1
```

The card reads them all when it opens, in one command over SSH with Loskai's main key, so
they show while the key is unlocked; a `read` that prints nothing, or fails, is "not set".
Editing one runs its `write` with the new value as `$1`, checked against its kind first
(`git-name` and `email`, beside the target kinds), then reads them all back. Each change is
in the SSH log as `setting`, with the value — so a setting is never a secret. Both `read` and
`write` run under `sh -c` with `~/.local/bin` on the `PATH` (`status.USER_PATH`).

A setting may also have:

```yaml
  project-email:
    label: Email
    description: The address on this project's commits — empty, the global email.
    target: project            # optional — a value of each project, not of the machine
    overrides: email           # optional, with `target` — the machine's setting it replaces
    value: email
    read: git -C "$PROJECTS/$1" config --local user.email
    write: git -C "$PROJECTS/$1" config --local user.email "$2"
    unset: git -C "$PROJECTS/$1" config --local --unset user.email   # optional
```

- **`unset`** takes the setting off: it runs when the value is set to nothing. A setting
  without one needs a value.
- **`target`** makes it a value of each row of that kind: only `project` (`tool.SETTING_TARGETS`),
  the rows a settings read can list on the machine itself. Its commands get the project
  as `$1` and the value as `$2`, with `$PROJECTS` set as for an action. The same read lists
  every git repo in the projects folder and reads each one's after the machine's, so the
  card still makes one connection. The card shows a cog on each project's row, teal while
  any of its settings is set, that opens them in a dialog; Save writes the fields changed.
- **`overrides`** names the machine's setting this one replaces where it is set, of the
  same kind: its value is what an empty field shows, greyed. Only shown — what applies is
  the program's own rule (git's `--local` over `--global`).

Refused: `404` no such tool or setting, `409` the tool doesn't apply on the machine (or its
overview can't be read), or a project missing or given where it doesn't belong, `422` a
value its kind refuses, `423` while the key is locked, and `502` when the `write` fails,
with the first line the machine said.

### `session`

Which tmux session the action runs in, where the machine has tmux:

- *(left out)*: Loskai's own, one per action and target — `loskai-<tool>-<action>[-<target>]`.
- **a name**: shared by every action that gives it, one per target — `<name>-<target>`.
  Running any of them while it is there attaches to it instead of starting another, and a
  card's row says `running` while it is there. Which session is whose, and which rows are
  running, the server works out with the overview (`tool.claim_sessions`): the page never
  names a session.
- **`false`**: none — for an action that is tmux itself, such as attaching to a session.

Any character but letters, digits, `_` and `-` in the name (a target's `.` or `@`) becomes
`_`.

### `automatic`

`true` for an action that runs to the end without anyone at it: System's update, a reboot,
restarting a service. Before its terminal opens, sudo's password is asked for in a dialog,
when sudo would ask, and checked on the machine. Its terminal is not a dialog: it drops down
from the top of the page (`QuickTerminal`), which stays usable under it. When the command
succeeds it stays three seconds — hovering holds it, **Keep open** keeps it — and slides
away; a failure stays, saying its exit code, until closed or Enter is pressed in it. The
page tells a failure by the `[failed, exit N]` line `tool.visible` prints: inside tmux, the
exit code never reaches the end of the session. Leave it out for anything whose
output is the point (a status, a pull) or that you work in (a shell, an attach, Claude,
a login link): those answer sudo in the terminal. Adding a tool, and the sudo rule, always
run this way.

## How an action runs

`tool.visible` builds what the terminal runs:

1. The command under `sh -c`, with the target as `$1`.
2. Then `[done, exit N] Enter closes this.`, waiting for Enter, so the output stays on
   screen; Enter ends the session and closes its window. An `automatic` one ends at once
   when it succeeds, and otherwise says `[failed, exit N]` and waits. The page tells Enter
   from a dropped connection — both close the session the same way — by the prompt having
   been printed: a window whose session ended without it stays, saying why.
3. **Inside tmux** when the machine has it, in the session `session` says. Closing the
   browser tab leaves it running, and running the same action again attaches to it rather
   than starting a second.

Adding a tool runs the same way, but never inside tmux: tmux may be what it installs.

It opens in the machine's terminal, so it needs Loskai's key unlocked like any terminal.
With sudo's password from the dialog, the terminal's first line is that password, which
the command reads with echo off and hands to `sudo -S -v`; in tmux, through a FIFO, and a
pane sent nothing within 30 seconds ends.
The SSH log records it as `action` (with the tool, the action, the target, the command and
the tmux session), `add-tool` (with the tool, the programs and the command) or `sudo-rule`
(`allow` — put on or taken off — and the command), each with `sudo_password: true` when the
dialog's password came with it — never the password.

## Adding a tool

1. Add `tools/<id>.yml`.
2. Run `uv run pytest tests/test_ssh_tool.py`. Its first test loads every shipped tool,
   so a mistake fails there with every problem named.
3. If it needs a program the overview doesn't detect yet, add it to `status.PROGRAMS` first.
   That changes the status command, so it follows [ssh-status.md](ssh-status.md)'s
   version steps. If Loskai can install it, add it to `tool.INSTALLERS`.
4. A new kind of `target` needs a row in the Running list to put it on: `tool.TARGETS`,
   `RunningList`, and this page.
5. Optionally icons, in `frontend/src/components/routing/ToolIcon.tsx`: the tool's 24×24
   path in `PATHS`, by its id (without one it gets a wrench). An action's symbol, by
   `<tool>.<action>`, should say what its button does: a program's own logo in `ACTIONS`
   (Claude's mark on opening Claude), else a Lucide icon in
   `SYMBOLS` — a plug for Connect, a square for Stop or End, a power button for Shut down.
   Without either it gets a play button. Logos come from Simple Icons (simpleicons.org);
   check the license: one that asks for credit, like Git's (CC BY 3.0), gets a line in the
   README's Credits.
6. Note it in `CHANGELOG.md`. It ships with the next image.
