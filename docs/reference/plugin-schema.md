[Docs](../README.md) › [Reference](../README.md#reference)

# Plugin schema

**Read this when** you are adding a plugin, adding an action to one, or changing how a
machine's page runs them.

A **plugin** gives a machine's page things to do: buttons that run a command on the machine
over SSH. Each one is a YAML file in `backend/src/loskai/modules/ssh/plugins/`, shipped in
the image, so a new plugin or a change to one comes with a new version of Loskai. Plugins
are **enabled per machine**, on its page.

Like a recipe, a plugin is **data, validated and never executed by Loskai**. An action's
command comes from its file. The browser only names a plugin, an action and, for an action
on a row of the Running list, that row's **target**. The target is checked against its kind
and reaches the command as `$1`, an argument, so no value can change what runs. The loader
is `modules/ssh/plugin.py`.

## A file

The file name is the plugin's id (`system.yml` → `system`): lowercase letters, digits and
`-`.

```yaml
name: System                      # required
description: Update the system, reboot, shut down.   # required — one line, on its page
requires: [tmux]                  # optional — tools the machine must have
install:                          # optional — how to get a required tool that is missing
  tmux:
    packages: { apt: tmux, dnf: tmux, apk: tmux, pacman: tmux }
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
    run: sudo reboot
  restart-service:
    label: Restart
    description: Restart this service.
    target: service               # optional — a button on each service in the Running list
    run: sudo systemctl restart "$1"
```

Unknown keys are refused. The validator names every problem at once.

### `requires` and `install`

`requires` lists tools by name. A tool must be one the machine's overview detects:
`logic.FACT_TOOLS` (`tmux`, `claude`, `docker`, `pct`, `qm`, `git`, `sudo`). A plugin can be
enabled anywhere, but its actions run only where every required tool is present.

`install` says how to get a missing tool, so the plugin's section offers **Install** for it:

- `packages`, by package manager: Loskai runs that manager's install for the package (see
  `plugin.INSTALL`), with `sudo`.
- `script`: one command, for a tool that isn't a distro package, such as an official
  installer.

A required tool with no `install` entry can't be installed from Loskai. `pct` and `qm` come
only with Proxmox, so that plugin is simply useless elsewhere.

### `run`

A command for POSIX `sh`, run as the machine's SSH user:

- **One per package manager** (`apt`, `dnf`, `apk`, `pacman`) when it differs. The machine's
  manager is the one its overview found. An action without one for it can't run there,
  and says so.
- **`sudo`** for what needs root. The user answers its password prompt in the terminal, and
  Loskai holds no machine password. When the login *is* root, as on Proxmox, `sudo` becomes
  a plain call, so the same file works with or without sudo installed.
- **`$1`** is the target, for an action with `target`. Always quote it: `"$1"`.

### `target`

What a row action is on, and what its target must look like (`plugin.TARGETS`):

| `target` | A button on | `$1` |
|---|---|---|
| *(none)* | the plugin's section — the machine itself | — |
| `service` | each service in the Running list | the systemd unit, `nginx` |
| `container` | each container | its name |
| `lxc` | each running LXC (Proxmox) | its id, `101` |
| `vm` | each running VM (Proxmox) | its id, `200` |

The key is `target`, not `on`: YAML reads `on:` as `true`.

## How an action runs

`plugin.visible` builds what the terminal runs:

1. The command under `sh -c`, with the target as `$1`.
2. Then `[done, exit N] Enter closes this.`, waiting for Enter, so the output stays on
   screen.
3. **Inside tmux** when the machine has it: one session per action and target
   (`loskai-<plugin>-<action>[-<target>]`). Closing the browser tab leaves it running, and
   running the same action again attaches to it rather than starting a second.

It opens in the machine's terminal, so it needs Loskai's key unlocked like any terminal.
The SSH log records it as `action` (or `install-tool`) with the plugin, the action, the
target and the command.

## Adding a plugin

1. Add `plugins/<id>.yml`.
2. Run `uv run pytest tests/test_ssh_plugin.py`. Its first test loads every shipped plugin,
   so a mistake fails there with every problem named.
3. If it needs a tool the overview doesn't detect yet, add it to `logic.FACT_TOOLS` first.
   That changes the status command, so it follows [ssh-status.md](ssh-status.md)'s
   version steps.
4. A new kind of `target` needs a row in the Running list to put it on: `plugin.TARGETS`,
   `RunningList`, and this page.
5. Note it in `CHANGELOG.md`. It ships with the next image.
