# Changelog

What changed for someone running Loskai, newest first. The reasons behind each change are
in [`HISTORY.md`](docs/project/HISTORY.md).

## Unreleased — first public release

Everything so far:

- **Routing** — give any service an HTTPS name in one step: Caddy route and AdGuard DNS
  entry together. Sources: a container, a service running on one of your machines (listed
  over SSH, by the port it listens on) or any IP and port; AdGuard in one click. Per route: HTTPS, HTTP or both, and whether the backend speaks HTTPS.
- **Machines** — name the computers on your network; every route on a machine's address is
  listed under it (its row opens like a stack's) and moves with it when the address changes.
  The machine Loskai runs on is listed before it is named, ready to name, and always first,
  tinted and tagged **Host**. A machine's name
  is its hostname. A Docker route can follow its
  container the same way. Loskai makes
  its own SSH key, used only after you type your password again, and keeps an SSH config of your
  machines — set a machine's SSH user and port in its form, download the file from
  Settings › SSH. Saving a machine with an SSH user sets SSH up: trust its host key, then type its
  password once and Loskai installs its key. Each machine then shows how much runs on it —
  containers, services, Proxmox guests — listed on a click, where a port adds a route and a
  guest is named as a machine (its address read from Proxmox) — and opens a terminal in the
  browser. Every terminal session is logged, in Settings › Logs. Loskai's key and the config
  download are in Settings › SSH; the cog on a machine's row opens its dialog, laid out like a
  settings window — one scroll, a side menu to jump around, a search — General (with its
  overview: system, memory, disks, updates waiting) and SSH, each field saving as you edit
  it, then its tools, what runs there, its log. **Tools** — found from what the machine has, nothing to
  enable: System (update, reboot, shut down — on General, by the overview; **Update all**,
  above the Machines tab's table, updates every machine one after another), Services (restart or stop a service or
  container), Proxmox (reboot or shut down a guest); a tool the machine lacks is offered to
  add, installing what it needs. Each runs in the machine's terminal, inside tmux when it
  has it. **tmux**: the machine's sessions — attach, end, start a new one. **Tailscale**:
  installed with its own installer; its card is two switches — **Connected** (the login
  link shows in the terminal; logged out and waiting for approval are said) and **Share
  this network**, which makes the machine a subnet router and says whether Tailscale has
  approved it yet — with the rest of the tailnet folded under them; the machine's Tailscale
  address in its overview. **Claude Code**: the
  git projects in the machine's projects folder (`~/projects`, changeable per machine in the
  Git card's Settings), each
  with its branch, commits not pushed, uncommitted changes, last commit and last Claude
  conversation; one Claude session per project, its buttons following it — **Start** (in
  the background, continuing the last conversation, in tmux with Remote Control, so it
  carries on in the Claude app; it says when Claude waits to be told to trust the folder),
  then **Attach** and **Stop**; **Update Claude** and **Stop all** on the card;
  **New project** makes the folder, `git init`, and starts Claude in it. **Projects**, above
  the Machines tab's table, shows every machine's projects in one place — each one's git and Claude
  session together, with their buttons, each machine's own tmux sessions under them, a strip of the machines to jump between, and New project and
  Clone on any of them. Tool cards come Git, Claude Code, Tailscale, tmux. The **Tools** button on a machine's row lists
  each added tool with how it stands there and opens it in a dialog — what it needs, and
  the tool itself; tmux's sessions are your own, Claude's are on their projects.
- **Deleting a machine**, or removing its SSH connection, takes Loskai's sudo rule and key
  off it first, with your password if the key is locked; one that can't be reached
  goes anyway, with a warning that they are still there. Changing a machine's SSH user
  takes them off the old user the same way.
- **How long the SSH key stays unlocked** is a setting in Settings › SSH: 15 minutes, 1, 3,
  8 or 24 hours (`SSH_UNLOCK_MINUTES` too) — and restarting Loskai doesn't lock it. It asks
  for your password in one dialog, only when you do something that needs it. An admin can
  switch the asking off (**Ask for your password**, `SSH_ASK_PASSWORD`), for one person on a
  LAN or tailnet.
- **Updates without a password** — a machine's SSH section can allow System's Update to run
  without sudo asking: a sudo rule for exactly its update commands, switched on (with the
  password once) and off in its SSH section, and taken off with the machine.
- **Git** — a tool for a machine's git: its commit name and email (`git config --global`),
  read and set in a dialog from **Settings** in its card's header — and, in a project's
  **Project overrides** (its cog), that project's own — and the projects folder Claude Code finds its projects in.
  Its projects have **Pull** (fast-forward only), **Push** and **Terminal**; **Pull all**
  pulls every project with a remote, **Push all** pushes every one with commits to push,
  and **Clone** takes a repository's address
  (`https://…`, `ssh://…` or `git@host:path`) into the projects folder. They run in the
  terminal as the machine's SSH user: over SSH with that user's own keys — **Keys** lists
  them, where each is used (every remote of every project and submodule, through
  `~/.ssh/config` aliases too) and their fingerprints, each with Copy (ready to paste) and Add it (where it goes), Test on a
  host you name (where it came from), Label (what it is for, written on the key) and Delete (never one `~/.ssh/config` names); Test key on a host tries the keys meant for it,
  each alone, and says which get in and as whom — Try every key tries them all, at most
  10 — and New key for a host makes one per platform, and makes an account key; a project can have its own deploy key in place
  of the machine's (**Own key**) — over HTTPS asking for a login there when the remote needs
  one.
- **Actions that run by themselves** — System's, Services, Proxmox, ending a tmux session,
  Tailscale's switches, adding a tool — ask for sudo's password in a dialog first, only
  when sudo would, check it on the machine, and run in a small terminal that drops down from
  the top of the page rather than a dialog: done, it stays three seconds (hover holds it,
  Keep open keeps it) and slides away; failed, it stays with its exit code.
- **Escape closes a dialog**, the top one only, as clicking outside it does. In a field being
  edited it first puts the value back; in a terminal it goes to the program there, until
  the session has ended. A tool's run closes its window on the Enter its prompt asks for.
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
  install or later under Edit. An app that logs a link to open after install — Tailscale's
  login — shows it on the wizard's last step. Without Caddy set up, the last step offers a
  link instead of a route — Loskai can run alone, for Docker and Machines (install guide,
  "Loskai alone").
- **The status line, version 10** — reading what runs on a machine no longer fills its auth
  log: sudo is used only where it needs no password, where every poll was logged as a
  refused sudo — for a user without sudo, and for one with Loskai's rule for updates, whose
  ports and Proxmox guests then read as none. On Proxmox it lists the guests once, not twice. It says
  Tailscale's state and which networks the machine shares, for the Tailscale card. A
  machine shows "install again" until its line is reinstalled.
- **Links** — a name and an address (`http://<ip>:<port>`) the Dashboard opens directly, with
  no Caddy or AdGuard: Add route offers Route or Link, and only Link while Caddy isn't set
  up. A container's link uses the port it's published on and follows it. A link becomes a
  route with Assign a URL. The desktop launcher list (`GET /api/launcher`) includes them.
- **Dashboard** — every service as a launcher card, usable without logging in.
- **Certificate page** — installs Caddy's root certificate on each device, once.
- **From outside, with Tailscale** — a subnet router shares your LAN with your tailnet, so
  your routed names work away from home: **Share this network** on any machine's Tailscale
  tool, or the Tailscale recipe on the Docker host. With the Docker host's
  Tailscale address in Settings › General (`HOST_TAILSCALE_IP`), the Machines tab manages
  machines on your tailnet too — from any browser, Tailscale or not. See the Tailscale guide.
- **The sidebar collapses** to its icons, and the browser remembers it.
- **Help you can tap** — a word underlined with dots has more to say: point at it, or tap it
  on a phone, for a small box. A button that can't be used says why the same way.
- **A look** — Loskai's own, or the Simply Sunde brand's palette, fonts, square corners and
  the bar its buttons fill with on hover: Settings › General, for every account and the
  Dashboard (`UI_LOOK`). Light or dark stays each browser's.
- **On a phone** — the sidebar is a drawer behind a Menu button, so each page gets the whole
  width; a page's buttons sit under its title, Settings' categories are a strip across the
  top, and the larger dialogs fill the screen. Tables become a list of cards — each row's
  name, then its status and buttons — instead of columns too narrow to read.
- **Accounts** — first run creates the admin account; Settings › Users adds more, each with
  a level that adds to the ones below: 1 Routing, 2 Docker, 3 Machines, 4 Settings (an
  admin). An open
  Loskai page keeps you signed in, even in a background tab, as Proxmox's does; you are
  signed out 2 hours after the last one closes (Settings › Security). Logging out ends your
  sessions on every device, and an open terminal with them, as lowering an account's level below a terminal's tab does. Your
  name in the sidebar opens a menu: your level, Change password and Log out. Each account unlocks Loskai's SSH key with its own password.
  An existing install's password becomes the account `admin`. An account saved with tabs,
  before levels, gets the level of its highest tab — and with it the lower tabs it may not
  have had (Docker, for one with Machines): check Settings › Users after upgrading.
- **Logs** — Settings › Logs, an admin's: each sign-in and wrong password (when, the
  username typed, from where — and which prompt, when it was asked again to unlock the SSH
  key or change a password), and the SSH log. A machine's dialog shows its own to an admin.
- **Installs from published images** — download one compose file and `docker compose up -d`;
  nothing is built on your server. `docker compose pull` updates, `LOSKAI_VERSION` pins a
  release. Images for `amd64` and `arm64` (a Raspberry Pi). A `.env` is optional.
- **Security** — accounts with levels, enforced by the API; only Loskai's own pages can act
  with its session, not your other apps under the same domain; the app runs as the owner of
  its data folder, not root; secrets on disk are owner-only ([SECURITY.md](SECURITY.md)).
