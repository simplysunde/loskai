# Changelog

What changed for someone running Loskai, newest first. The reasons behind each change are
in [`HISTORY.md`](docs/project/HISTORY.md).

## Unreleased — first public release

Everything so far:

- **Routing** — give any service an HTTPS name in one step: Caddy route and AdGuard DNS
  entry together. Sources: a container, a network service (AdGuard, router, Caddy) or any
  IP and port. Per route: HTTPS, HTTP or both, and whether the backend speaks HTTPS.
- **Machines** — name the computers on your network; every route on a machine's address is
  listed under it (its row opens like a stack's) and moves with it when the address changes.
  The machine Loskai runs on is listed before it is named, ready to name. A machine's name
  is its hostname. A Docker route can follow its
  container the same way. Loskai makes
  its own SSH key, used only after you type your password again, and keeps an SSH config of your
  machines — set a machine's SSH user and port in its form, download the file from
  Settings › SSH. Saving a machine with an SSH user sets SSH up: trust its host key, then type its
  password once and Loskai installs its key. Each machine then shows how much runs on it —
  containers, services, Proxmox guests — listed on hover — and opens a terminal in the
  browser. Every terminal session is logged. Loskai's key, the config download and the log
  are in Settings › SSH; the cog on a machine's row opens its dialog, laid out like a
  settings window — one scroll, a side menu to jump around, a search — General (with its
  overview: system, memory, disks, updates waiting) and SSH, each field saving as you edit
  it, then its tools, what runs there, its log. **Tools** — found from what the machine has, nothing to
  enable: System (update, reboot, shut down), Services (restart or stop a service or
  container), Proxmox (reboot or shut down a guest); a tool the machine lacks is offered to
  add, installing what it needs. Each runs in the machine's terminal, inside tmux when it
  has it. **tmux**: the machine's sessions — attach, end, start a new one. **Tailscale**:
  installed with its own installer; connect (the login link shows in the terminal),
  status, disconnect; the machine's Tailscale address in its overview, and the tailnet —
  each device, online or not — on its card. **Claude Code**: the
  git projects in the machine's projects folder (`~/projects`, changeable per machine on the
  Git card), each
  with its branch, commits not pushed, uncommitted changes, last commit and last Claude
  conversation; **Claude**
  opens its running session, else continues the last conversation, else starts one — in
  tmux, with Remote Control, so it carries on in the Claude app; **Terminal**, **Pull**
  (fast-forward only), **Push** and **End** on each project; **New project** makes the
  folder, `git init`, and starts Claude in it. The **Tools** button on a machine's row lists
  each added tool with how it stands there and opens it in a dialog — what it needs, and
  the tool itself; tmux's sessions are your own, Claude's are on their projects.
- **Deleting a machine**, or removing its SSH connection, takes Loskai's sudo rule and key
  off it first, with your password if the key is locked; one that can't be reached
  goes anyway, with a warning that they are still there.
- **How long the SSH key stays unlocked** is a setting in Settings › SSH: 15 minutes, 1, 3,
  8 or 24 hours (`SSH_UNLOCK_MINUTES` too).
- **Updates without a password** — a machine's SSH section can allow System's Update to run
  without sudo asking: a sudo rule for exactly its update commands, switched on (with the
  password once) and off in its SSH section, and taken off with the machine.
- **Git** — a tool for a machine's git: its commit name and email (`git config --global`),
  read and set from its card, and the projects folder Claude Code finds its projects in.
- **Actions that run by themselves** — System's, Services, Proxmox, ending a tmux session,
  Tailscale's Disconnect, adding a tool — ask for sudo's password in a dialog first, only
  when sudo would, check it on the machine, and close their terminal when they are done.
- **Terminals** — Tab completes, Ctrl+Shift+C copies, Ctrl+V pastes. What a program in the
  terminal copies — tmux, Claude Code's `c`, an editor — reaches your clipboard (OSC 52);
  Shift+drag selects even where a program uses the mouse. The container terminal
  now shows bash's prompt and error messages (it hid them before), and opens a shell in
  images without bash.
- **Docker** — containers grouped by stack, with start/stop, update, logs, a terminal,
  stack editing — a form for settings and folders, or the files as text — and unused-volume
  cleanup. Containers you already run are listed from the start, with a guide to bringing
  them in — installing the recipe over your existing data, where there is one.
- **Install wizard** — apps from recipe repos, with their own icons, routed on install.
  **Check for updates** shows which installed recipes have a newer version and what
  changes; Update replaces the recipe's `compose.yml` and keeps your settings and folders.
  Optional features a recipe offers — Jellyfin's hardware transcoding — are checkboxes, at
  install or later under Edit.
- **Dashboard** — every service as a launcher card, usable without logging in.
- **Certificate page** — installs Caddy's root certificate on each device, once.
- **Accounts** — first run creates the admin account; Settings › Users adds more: admins,
  and operators limited to the tabs they're given (Docker, Routing, Machines). An open
  Loskai page keeps you signed in, even in a background tab, as Proxmox's does; you are
  signed out 2 hours after the last one closes (Settings › Security). Logging out ends your
  sessions on every device, and an open terminal with them, as taking away its tab does. Your
  name in the sidebar opens a menu: your role and tabs, Change password and Log out. An operator's SSH log, in a machine's dialog, shows only what
  they did. Each account unlocks Loskai's SSH key with its own password.
  An existing install's password becomes the account `admin`.
- **Security** — accounts with roles, enforced by the API; only Loskai's own pages can act
  with its session, not your other apps under the same domain; the app runs as the owner of
  its data folder, not root; secrets on disk are owner-only ([SECURITY.md](SECURITY.md)).
