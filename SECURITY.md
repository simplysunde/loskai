# Security

Loskai is a **LAN admin tool**: it controls Docker on its host and the DNS and routing for
your network. Read this before deciding where it runs and who can reach it.

## What it can do on your host

- **It holds the Docker socket**, which is root on the host in all but name: anything that
  controls the socket can start a privileged container. Loskai must be the only container
  with it mounted. The app itself runs as the owner of `./data`, not as root
  ([deployment.md](docs/guides/deployment.md#who-owns-the-files-loskai-writes)).
- **The Docker tab opens a shell in any container**, from the browser — as its image's user,
  usually root.
- **It writes your Caddy routes and AdGuard DNS rewrites.** It deletes only the rewrites it
  made, matched by name *and* answer — except Settings › Network's confirmed "clear all".
- **It holds an SSH key to the machines you give it** (once its public key is on them).
  The key is an owner-only file in `data/ssh/`, as a key in `~/.ssh` is, so protect
  `data/` and its backups. Loskai uses it only for a while after you type your password —
  your unlock, not anyone else's — 15 minutes unless Settings › SSH says longer (up to 24 hours,
  each hour longer that a stolen session reaches your machines too); logging out locks it
  sooner. It works only from the Docker host
  when its IP is set — the line Loskai gives you starts with `from=` (on the Docker host
  itself, also from Loskai's own Docker networks). Give Loskai's login
  user on each machine only the `sudo` you want it to have.
- **A second, status-only key** is used without unlocking, so each machine's running list
  and overview work without your password. The machine itself limits it to one command that
  only reads — what runs, and the system, memory, disks, updates waiting, tools, tmux
  session names, its Tailscale address and the tailnet's devices, the git projects in its
  home folder (name, branch, last commit and its message) and whether Loskai's sudo rule is
  there — with no shell, no forwarding, only from the Docker host. A copy reveals
  that and nothing else.
- **A program in a terminal can put text on your clipboard** (OSC 52 — how tmux and Claude
  Code copy), as in any terminal: up to 1 MiB, and never read it — a request to read the
  clipboard is ignored.
- **The Machines tab opens a shell on a machine**, from the browser, as Loskai's SSH user —
  only while the key is unlocked, and only from Loskai's own pages. Each terminal opened,
  closed or refused is logged (when, which machine, from where), not what is typed in it.
- **Loskai holds no Claude or Tailscale login** — each is logged in on the machine, in its
  terminal.
- **Tools run fixed commands** that ship in the image — the browser only names one, and
  a value from the page (a service's name) reaches the command as an argument, never as
  code. They run as the SSH user in a terminal you see; anything needing root asks for
  `sudo` there — or, for an automatic one, in a dialog first (below). Each run is logged
  with its command. A tool's setting (Git's name and email) is written on the machine
  without a terminal, and logged with its value.
- **Install it for me** sends a machine's password to that machine once, to add Loskai's
  keys, and keeps it nowhere. It is sent only after you have accepted the machine's host
  key, and a machine whose host key changes is refused.
- **Updates without a password, if you allow them.** A machine's SSH section can put a sudo
  rule on it, `/etc/sudoers.d/loskai`: Loskai's user may run exactly System's update
  commands (`apt-get update`, `apt-get -y dist-upgrade`, or the machine's package manager's
  one) and remove that file — nothing else — without a password. You give the password
  once, as for any automatic action (below). `visudo` checks
  the rule before it is put in place. Anyone who gets Loskai's user on that machine can
  then install pending updates, and only that.
- **sudo's password, for an action that runs by itself.** Update, Reboot, restarting a
  service and the like ask for it in a dialog before their terminal opens. Loskai checks it
  on the machine with `sudo -S -v` and keeps it in memory for at most a minute, for that
  run, your account and that machine. It reaches the run as the first line of its
  terminal, which opens with echo off, so it never shows. It is never stored, logged or put
  in a command line: in tmux it goes through a FIFO in a private folder, removed at once.
  Like everything typed in a terminal, it passes through Loskai on its way.
- **Deleting a machine, removing its SSH connection, or changing its SSH user takes Loskai's
  things off it** (off the old user, for a change) —
  the sudo rule first, then its two `authorized_keys` lines, and nothing else — before
  Loskai forgets it. A machine that can't be reached then goes anyway, and Loskai says what
  is still there to remove by hand.
- **A recipe runs the images it names.** Recipes are data, never executed themselves, but
  installing one starts its containers — trust a recipe source as you would its images.

## How access is controlled

- **Accounts.** First-run setup creates an **admin**, who can add more. Each account has a
  **level**, and each adds to the ones below: 1 Routing, 2 Docker, 3 Machines, 4 Settings —
  an admin, who can do everything, the accounts and the logs included. The API enforces it,
  one rule per route (`shared/access.py`), and a route without one is admin-only. Levels are
  for people you trust, not a wall: Docker (level 2) can start a container with root on the
  Docker host, and so reach Loskai's `data/` folder. Passwords are stored
  only as Argon2 hashes, in `data/users.json` (owner-only).
- **Sessions.** A login sets an `HttpOnly`, `SameSite=Lax` cookie naming the account. An open
  Loskai page keeps it, even in a background tab, as Proxmox's does; it ends 2 hours after
  the last page closes (Settings › Security: 30 minutes to 7 days). An unlocked computer
  with Loskai open stays signed in — the SSH key still asks for your password again after
  15 minutes, or what Settings › SSH says. **Log out ends your sessions on every device** — a copied cookie stops working too,
  and an open terminal closes within seconds; so does a changed password, or the account
  removed. After 5 wrong passwords, each one costs a wait that doubles up to a minute: a
  guesser gets about one try a minute. The wait is for that account from that device, so
  someone guessing doesn't keep you out. Each sign-in and wrong password — at login, or asked
  again to unlock the SSH key or change a password — is logged (when, the username typed,
  from where — never the password) in Settings › Logs, which only an admin reads.
- **The lock is on the API, never the page.** Every `/api/*` route needs the session except
  the dashboard, the login flow, the Caddy root certificate (public by design) and launcher
  icons. The two terminal WebSockets — a container's and a machine's — check the session
  themselves.
- **Only Loskai's own pages can act.** Your other apps share Loskai's domain, so a browser
  sends them its cookie; a request that changes something, or opens a terminal, is refused
  unless it comes from Loskai's own address.
- **Secrets on disk** — `settings.json` (the AdGuard password), the session secret and every
  stack `.env` — are readable by their owner only.
- **Uploaded icons** are checked by their bytes, and SVG is refused.

## Known limits

- **No HTTPS of its own.** Port `:8080` is plain HTTP. Reach Loskai through its routed name
  (`https://loskai.<your domain>`) — a login there gets a `Secure` cookie, never sent in
  the clear — and don't open `:8080` beyond the machines you manage it from.

## Reporting a vulnerability

Report it privately through the repository's **Security → Report a vulnerability** form,
not a public issue. Only the latest `main` is supported.
