[Docs](../README.md) › [Project](../README.md#project)

# Loskai — TODO

**Read this when** you want what is being built now, or the backlog.

**Now:** **Phase 46** (below) — the second sweep. **Phase 41** — recipes for
Forgejo and Immich, `make demo` recording the README's animations, the README — is done. **Phase 40**, the sweep, is done. Since it: account
levels 1–4 replacing an admin and operators given tabs, a sign-in log, the logs on their own
page (Settings › Logs), and every page laid out for a phone, checked by `make check-phone` —
each in `HISTORY.md` or `CHANGELOG.md`. **Phases 34–38** — machines managed over SSH,
accounts, automatic runs, Git as a tool, the key kept simply — are built; what is left in
them is live checks on Sunde's machines. Phases 1–33 and 37 are in
[`todo-archive.md`](todo-archive.md); `HISTORY.md` carries why each thing is the way it is —
read it before reversing anything, since several current decisions are walk-backs of earlier
ones.

> **Layout letters were reassigned 2026-09-04** — **A** split-LXC (three-way) · **B** split DNS
> (two-way) · **C** all-in-Docker (one box). Archived phase text written before the swap calls
> split DNS *C* and all-in-Docker *B*; it is left as written, since it records work as it was
> done. Current-state docs use the new letters.

## Open, not in flight

_Found 2026-09-09 while archiving: the archive header claims "nothing here is live work" and
that has never been true. These are real, unfinished, and unblocked — listed here so they are
visible without unpacking a phase back out. The checklists stay in
[`todo-archive.md`](todo-archive.md)._

- Phase 8b's Tier-3 integration rig + Forgejo CI are unchecked **by choice** — see the backlog
- **Before publishing: push and release.** The code names <https://github.com/simplysunde>
  (`loskai`, `loskai-recipes`) everywhere — the seeded recipe source, the app's doc links,
  the install guide — so both repos must be pushed there before an install can work. Then
  the first `make release` (once per boot, QEMU for arm64: the script says how), and make
  both packages public on GitHub — the install guide's `docker compose pull` needs them.
- **Decide: count wrong passwords per client.** The login backoff counts per account but
  not per client (behind Caddy every request has Caddy's address), so a LAN script guessing
  the moment each wait ends keeps that account out until it stops or Loskai restarts. The proposed
  fix: key the count by client. `auth.peer` already tells the client, trusting
  `X-Forwarded-For` only on requests from Caddy's own address (2026-11-07). Found by the 2026-10-30 review; documented in `SECURITY.md` meanwhile.
- **A closed terminal leaves its shell running in the container.** Docker keeps an exec'd
  process alive after its connection closes (live, 2026-10-30: four closed terminals, four
  `bash` processes left). Needs a way to end it — `exec_inspect` gives its host PID, which
  Loskai's container can't signal.
- **A sudo rule Loskai can't see may be left behind.** Taking a machine off checks for the rule
  with `[ -e /etc/sudoers.d/loskai ]` when `sudo -n rm` fails. Where that folder is 0750 (it
  is 0755 on Debian), a user other than the one the rule was made for sees nothing, and the
  removal reports clean. Warning whenever the folder can't be read would warn on every such
  machine; the fix needs a way to ask sudo itself. From the 2026-11-05 review.
- **A tool setting's value is written to the SSH log** (`write_setting`) — fine for Git's name
  and email, the only settings today. A setting that holds a secret needs a `secret` flag in
  the tool schema that keeps its value out. From the 2026-11-05 review.
- **An automatic run cut off before its password arrives leaves its session waiting.** The
  run's first line reads the sudo password; when its connection ends before that, its tmux
  session (`loskai-<tool>-<action>`) stays on the machine, blocked on the read, and the next
  run of that action attaches to it — a blank terminal — instead of starting. Seen live
  2026-11-06, left by the dev build's double-opened socket (fixed); any connection dropped at
  that moment does the same. Needs a timeout on that read, or a run that starts fresh.
- **The sudo ticket rides in the terminal's URL**, so uvicorn's access log has it. It is
  one-time and lasts a minute, and the password itself is never there; sending it as the
  socket's first message would keep it out of the log. From the 2026-11-06 review.
- **Phase 28's last check — Sunde's Bambuddy reinstall**, then clearing the migration's
  fallbacks; the steps are in Phase 28 in [`todo-archive.md`](todo-archive.md).
- **Phase 29's last check — the Docker daemon restarted mid-run**, the next time one happens
  anyway; what to look for is in Phase 29 in [`todo-archive.md`](todo-archive.md).

---

## Phase 34 — Machines managed over SSH

_Origin (2026-10-23, Sunde): the Machines tab as "a sort of ssh connection manager", with the
keys in Loskai so it can "manage the machines and update them quickly, search for other
docker or services running on those machines and quickly administrate them". Design and
safeguards: [architecture.md → Machines](architecture.md#machines)._

**Decisions (2026-10-30, Sunde: "let go with your recommendation")**
- **asyncssh**, not the `ssh` binary: pure Python, async like the backend, and it reads an
  OpenSSH config file itself
- **A machine's SSH details live only in the config file**, edited from the machine's own
  form (user, port). `Host` is the machine's hostname and `HostName` its address; renaming
  or moving the machine edits that entry in place, deleting it removes the entry
- **The config names no key.** Loskai hands its key to each connection itself, so the
  exported file works as it is with your own `ssh` and your own keys — no `IdentityFile` to
  rewrite, and no setting for it
- **The key is unlocked only while the password is fresh**: entering it for an SSH action
  unlocks the key in memory for 15 minutes — not at login, so a session cookie alone never
  reaches the machines, and after a restart nothing can until someone types the password

Each step is usable on its own:

**34a — the key and the config file**
- [x] Loskai's ed25519 key pair, generated on request with the admin password (which
      encrypts it) and replaced the same way ("New key"); the `authorized_keys` line to copy,
      starting `from="<Docker host IP>"`
- [x] The config file `data/ssh/config`, edited in place, comments and formatting kept; the
      machine form's SSH user and port; rename, move and delete carried to it
- [x] Settings › General downloads it; `SECURITY.md` and CLAUDE.md's secrets rule change in
      this step, since it adds the key
- [x] +31 backend (599), +8 frontend (237); `pytest`, `npm test`, `npm run build`,
      `oxlint`, `check-docs.sh`
- [x] **Live** (scratch backend, Playwright, a Debian `sshd` container): a wrong password said
      "Invalid password" and stayed on the page; Create key gave
      `from="172.17.0.1" ssh-ed25519 … loskai`; a machine with SSH user `loskai` showed the
      SSH mark; Settings downloaded the file, identical to `data/ssh/config`, and `ssh -G`
      read it as user `loskai`, the container's IP, port 22. The key file was `600` and
      encrypted; decrypted with the password, the given line **logged in** from
      `172.17.0.1`, and the same key with `from="10.9.9.9"` got **Permission denied**

**Before 34b — a route is on a machine by its address (2026-10-31, Sunde: "go with your
recommendation")** — so what SSH finds on a machine and the routes on it meet on one key
- [x] The `machine` link removed (field, Machine/Address toggle, Change URL linking, the
      chain and wand icons); a route is on the machine at its upstream's address, worked
      out each time. Moving a machine carries every route on its old address except one
      following its container; two machines can't share an address (`409`)
- [x] −3 backend (596), −11 frontend (226) — the link's own tests went, the move's are new;
      `pytest`, `npm test`, `npm run build`, `oxlint`, `check-docs.sh`
- [x] **Live** (scratch backend, the smoke Caddy, Playwright): a route posted with no link
      at `10.99.0.50:32400`; moving the machine `nas` to `.60` returned `moved: ["plex"]` and
      **Caddy's dial became `10.99.0.60:32400`**, while a route on `.5` stayed; a second
      machine on `.50` got `409`; no stored record kept a `machine` key. In the browser,
      Routing named `nas.smoke.test` under plex, Machines listed `:32400` under nas, and
      its Add route opened on `10.99.0.60` with no Machine toggle

**Decisions (2026-10-31, Sunde: SSH is set up when a machine is made, and each machine shows
what runs on it — all three recommendations taken)**
- **Setting a machine up for SSH is part of naming it.** Saving a machine with an SSH user
  opens its SSH setup, also reachable from its row: the host key is shown to trust first,
  then **Install it for me** — the machine's password for that user, typed once, used to add
  Loskai's lines to `authorized_keys`, then forgotten — or **I'll add it myself** (the lines
  to copy, then Test connection). Either ends by logging in with the key to prove it works
- **The host key is trusted before any password is sent**, so a machine pretending to be
  yours never gets one. `known_hosts` is keyed by the machine's **id**, which a rename or a
  move never changes; a changed key is refused until trusted again, explicitly
- **A second, status-only key**, kept unencrypted (`0600`) so the status works in the
  background and after a restart. The machine limits it — `restrict` (no shell, pty or
  forwarding), `from=` the Docker host, and a forced read-only command — so a leaked copy
  reveals what runs where and nothing else. "New key" replaces the main key only
- **"Running" is containers, your services, and Proxmox guests**: `docker ps`, the running
  systemd services minus the base system's (counted, not listed), and running LXCs and VMs
  on a Proxmox host. Each falls back to `sudo -n`, and a list the user may not read says so
- **Checked when someone looks, not by a background loop:** the Machines tab asks every 30 s
  and Loskai answers from a 30 s cache, so `follow.py` stays the only background task

**34b — set up at creation**
- [x] Unlock the key for 15 minutes by the admin password (`unlock.py`); a new key starts
      unlocked; logout locks it (`auth.session_epoch`)
- [x] The status key and its line: `restrict`, `from=`, the forced `logic.STATUS_COMMAND`
- [x] Host key scan (ed25519 first) and trust, `known_hosts` by machine id; a changed key
      refused until trusted again
- [x] Install it for me (`logic.INSTALL_SCRIPT` replaces Loskai's earlier lines) and Test
      connection; `409` before trust, `423` while locked — both before a password is used
- [x] `SshSetupModal`, opened after saving a machine with an SSH user, and from its row
- [x] +24 backend (620), +13 frontend (239); `pytest`, `npm test`, `npm run build`,
      `oxlint`, `check-docs.sh`. Tests lower the key's bcrypt rounds (39 s → 13 s)
- [x] **Live**, a Debian `sshd` with stand-in `docker`/`systemctl`/`pct`: the scan's
      fingerprint equalled `ssh-keygen -lf` on the machine (it first showed the RSA key —
      fixed); install wrote both lines (`600`), a second install replaced them; a wrong
      password said `refused the password`; regenerated host keys were refused and the scan
      said `changed`; logout locked the key (`423`). The status key, used by OpenSSH with
      `cat /etc/shadow`, returned the status list; a pty was refused, and sshd logged
      `refused local port forward`. The machine password never reached the log. In the
      browser: Name a machine → host key → Trust → Create key → Install → "Loskai logs in
      with its key. 3 running."

- [x] **Found in use (2026-10-31), fixed:** in the container every scan failed with only
      "SSH to … failed". The app runs as the uid that owns `./data`, which has no entry in
      the image's `/etc/passwd`, and asyncssh refuses to connect without a local user name.
      The entrypoint now exports `USER`/`LOGNAME` beside `HOME`, and an unexpected error is
      logged with its cause. The live run had used a backend on the host, where `vm` has
      a name — the container is what has to be tested
- [x] **And then:** to the Docker host itself, sshd sees Loskai's *container* address
      (`172.18.0.2` — Docker doesn't translate a container's traffic to its own host), so
      `from="<HOST_IP>"` would refuse the key there. That machine's lines also name the
      subnets of Loskai's networks (`192.168.10.220,172.18.0.0/16`); every other machine's
      stay `from="<HOST_IP>"`. The scan returns each machine's own lines for "I'll add it
      myself"

**34c — what runs on each machine**
- [x] The forced command's output parsed (`logic.parse_running`): containers, non-base
      services (the base counted), running Proxmox guests, lists the user may not read
- [x] `GET /api/ssh/running`, a 30 s cache per machine, asked only while the Machines tab
      is open; works while the main key is locked
- [x] `RunningPill`: the count on each row, everything on hover (portalled, so the table's
      scroll can't clip it); `unreachable` with the reason in its tooltip
- [ ] Try it on the real Proxmox host and a Docker LXC, and tune `BASE_SERVICES`

**34d — the terminal**
- [x] `WS /api/ssh/machines/{id}/terminal`: a pty shell with the main key; session, `Origin`
      and unlocked-key checks; `4000 + status` closes with the reason; closing hangs up the
      pty. `auth.session_ended` now serves both terminals
- [x] The SSH log: terminals opened, closed, refused, and installs — **sessions, not
      commands**: a keystroke log would hold passwords typed at `sudo` prompts. Prepared
      commands (34e) are fixed, so those will be logged as commands
- [x] One terminal component (`XtermSession`): Tab to the remote shell; Ctrl+Shift+C copies,
      Ctrl+C copies while text is selected, Ctrl+V / Ctrl+Shift+V paste via the browser (so
      plain HTTP works); `MachineTerminal` asks to unlock first, and again on a `4423`
- [x] **Found on the way, fixed:** the container terminal ran
      `exec /bin/bash 2>/dev/null || exec /bin/sh` — bash's stderr went to `/dev/null`, so it
      wasn't interactive: no prompt, no Tab completion, no error messages, since Phase 8; and
      busybox's `sh` exits on a failed `exec`, so images without bash got no shell (the open
      item about it). Now the shell is chosen before `exec` (`SHELL_COMMAND`)
- [x] +6 backend (628, with the shell fix's 2), +8 frontend (247); `pytest`, `npm test`, `npm run build`, `oxlint`,
      `check-docs.sh`
- [x] **Live** (Playwright, a Debian `sshd`): `ech` + Tab completed to `echo`; Ctrl+C
      interrupted `sleep 30`; triple-click + Ctrl+Shift+C copied the line, and Ctrl+C with a
      selection copied instead of interrupting; Ctrl+Shift+V and Ctrl+V pasted, waiting for
      Enter; `stty size` was the browser's; after closing, no process of the user was left
      on the machine (a `sleep 600 &` included); the log had `open`/`close`, `0600`, no typed
      text. The container terminal, on the same Debian image: prompt, Tab and paste; on
      busybox: a prompt, and `ls` errors shown

**The machine page and Settings › SSH (2026-11-01)**
- [x] Machine rows open and close like stacks; the key row left the Machines tab (its line
      was wrong for the Docker host); Settings › SSH holds what is the same for every
      machine — the key by fingerprint, New key, the config download, the log
- [x] The cog opens the machine's page (`/machines/<id>`): Edit, SSH setup, what runs there,
      its log; naming a machine lands on it

_Plan for the rest (2026-11-01, Sunde: "I want both a and b", tmux sessions, sessions that
run "specific actions like… claude code start a remote session inside a project", and
"plugins that we install and enable based on needs, kinda like the recipes… tied to the
image"; then "yes to both recommendations" — per machine, plan first — "and the ability to
install dependencies if missing, when enabling a plugin")._

**Decisions**
- **A plugin is data, not code** — a file of actions shipped in the image: each action's
  name, what the machine must have, the inputs it asks for, and the command it runs there.
  Loskai validates inputs and quotes them into the command; it never runs plugin code
  itself, so every action is a fixed command, logged as one. New or changed plugins come
  with a new image, like any feature
- **Enabled per machine**, on its page. A plugin is offered where its tools are present;
  where one is missing, enabling it offers to install it — the file names the package per
  package manager (`apt`, `dnf`, `apk`, `pacman`), or an official installer for a tool
  that isn't a distro package (Claude Code). The install command is shown, then run
- **Actions run where they can be seen**: in the machine's terminal, inside a tmux session
  when the machine has tmux — so an update survives closing the tab — and plainly
  otherwise. A `sudo` prompt is answered in the terminal; Loskai holds no machine password
- **Read-only facts come with the status key** (no password): the forced command grows, so
  each machine installs the new line once (`STATUS_VERSION` bump, one click on its page)
- **Loskai holds no Claude credentials** — Claude Code is logged in on the machine already

**34e — the overview** (read-only, status key): OS and version, kernel, uptime, memory,
disks, updates waiting, which tools the machine has (`tmux`, `claude`, `docker`, `pct`…),
and its tmux sessions. On the machine page; an older status line says "reinstall".
- [x] Status line v2: one forced command, two requests picked by `$SSH_ORIGINAL_COMMAND`
      (`running`, `facts`) — the costlier overview only for the page that shows it; v1
      lines keep their running list. `logic.parse_facts`, `GET /api/ssh/machines/{id}/facts`
      (60 s cache), `MachineOverview`; the contract in
      [ssh-status.md](../reference/ssh-status.md)
- [x] +9 backend (641), +2 frontend (252); `pytest`, `npm test`, `npm run build`, `oxlint`,
      `check-docs.sh`
- [x] **Live:** in the container, codebox (still on v1) kept its running list (5 containers)
      and its overview said `old` — install again. A throwaway Debian `sshd` with the v2
      line, asked with the real status key: `facts` gave Debian 13, memory, `apt 1`, tmux
      and its session `work`; `running` parsed; `cat /etc/shadow; id` got the status answer;
      a pty was refused
- [ ] Codebox: look at the overview, once set up again (Phase 38)

**34f — plugins, and the first ones**
- [x] The plugin format (`plugin.py`, [tool-schema.md](../reference/tool-schema.md), then plugin-schema.md),
      its validator (every problem at once), built-ins in the image; enabled per machine
      (`plugins` on its record, `PUT /api/ssh/machines/{id}/plugins`); a Plugins section on
      the machine page — enable, disable, install what is missing
- [x] Actions run in the machine's terminal (`?plugin=&action=&target=`, `?install=`),
      worked out by `connect.plan` from the file and the overview, inside tmux when there;
      refused before anything runs when they can't (not enabled, a tool missing, a bad
      target); logged with their command
- [x] **System:** update (the machine's package manager), reboot, shut down (confirmed)
- [x] **Services:** restart, stop a service or container, from its row in the Running
      list; **Proxmox:** reboot, shut down a guest. *Start* isn't offered: the Running list
      shows only what runs
- [x] +29 backend (670), +5 frontend (257); `pytest`, `npm test`, `npm run build`,
      `oxlint`, `check-docs.sh`
- [x] **Live** (a scratch backend, a throwaway Debian `sshd` with tmux and sudo, through the
      real API and WebSocket): key made, host trusted, installed with the machine's
      password; the overview gave `apt` and `tmux, sudo`; System › Update started, the tab
      closed after 6 s — `loskai-system-update` kept running in tmux and finished; running
      it again attached to it, showing `[done, exit 0]`, and Enter ended it. A target
      `a;id` was refused `4409 Not a service` before anything ran; the log had the action,
      its tmux session, and the refusal
- [ ] On codebox and the Proxmox host: try Update and a row action (nothing to enable since
      34f′ — the tools are detected)

_Reworked (2026-11-01, Sunde): System, Services and Proxmox "are standard features that
are autodetected"; what was meant by plugins is "tools that help with my workflow, like
using tmux to start claude sessions (with remote…)", "a clever way of using git to keep
track of projects", "a quick install of tailscale" — "we can simply keep the tool terms".
The projects folder: "a default one, that can easily be overwritten per machine"._

**34f′ — standard actions and tools: nothing to enable**
- [x] One format, renamed **tools** (`tool.py`, `tools/`, `tool-schema.md`). A tool applies
      to a machine when it has every program the tool requires — detected, never stored:
      System everywhere, Services' row actions on every row, Proxmox where `pct` and `qm`
      are. The per-machine enabled list and its endpoint go
- [x] **How to get a program is in one place** (`tool.PROGRAMS`), not repeated per file. A
      tool whose missing programs can all be installed is offered in the Tools section's
      **Add** line; adding it installs them in one command (`?tool=&install=1`)
- [x] The machine page's Plugins section becomes **Tools**: a card per tool that applies,
      with its machine actions; the overview's tool chips go
- [x] 671 backend, 256 frontend (the enable tests replaced by adding and applying ones);
      `pytest`, `npm test`, `npm run build`, `oxlint`, `check-docs.sh` (65 routes)

**34g — tmux and Tailscale** (status line v3: `tailscale` detected, its address, and the
projects 34h lists — one reinstall for all three)
- [x] Action keys `ask` (a typed name, checked like a target, passed as `$1`) and `session`
      (the tmux session it runs in, or none for an action that is tmux itself); target
      kind `session`
- [x] **tmux**: the machine's sessions with Attach and Kill; New session (a name)
- [x] **Tailscale**: installed with its official script; Up (the login link shows in the
      terminal), Down (confirmed), Status; the machine's Tailscale address in the overview
- [x] The status line's v3 also lists the projects (34h shows them): a test runs it over a
      scratch home — a committed subject of `* | $(touch pwned)` comes back verbatim, a
      folder with a space is skipped, an empty repo has its branch and no commit
- [x] 687 backend, 258 frontend; `pytest`, `npm test`, `npm run build`, `oxlint`,
      `check-docs.sh`
- [x] **Live** (a scratch backend, a throwaway Debian 13 `sshd` with git and sudo, through
      the real API and WebSocket): installed with the machine's password; the v3 overview
      gave `git, sudo` and the project `projects/site` with its subject `First * commit`
      intact. Add tmux installed it with apt; New session `work` landed in tmux — Ctrl+B D
      printed `[detached (from session dbg)]`, `[done, exit 0]`, and Enter closed the
      terminal (`1000`); Attach showed the session's earlier output; a name `a;id` was
      refused `4409 Not a session` before anything ran; End ended it. Add Tailscale
      installed curl, then Tailscale with its own script; the overview then had both, and
      no address (not logged in). **Found:** the log's `add-tool` named only `tailscale`,
      not the curl installed before it — fixed (`tool.to_install`)
- [ ] Log a machine in to Tailscale (needs an account): Connect, then the address in the
      overview

**34h — Claude Code and projects**
- [x] **A projects folder per machine**, `~/projects` unless changed on its page (`~` or
      one folder in the home folder). The status line lists the git repos one and two
      levels into the home folder — branch, uncommitted changes, last commit, last Claude
      conversation — and the page shows those in the folder
- [x] **Claude Code** (needs `claude`, `tmux`, `git`): a project's **Claude** opens its
      running session, else continues its last conversation, else starts one — always with
      Remote Control, in tmux `claude-<project>`, so it carries on in the app or another
      computer after the tab closes; **Terminal** in the project; **New project** (a name:
      the folder, `git init`, Claude in it)
- [x] `PUT /api/ssh/machines/{id}/projects` (66 routes), `$PROJECTS` for every action;
      +17 backend (704), +2 frontend (260); `pytest`, `npm test`, `npm run build`,
      `oxlint`, `check-docs.sh`
- [x] **Live** (the same throwaway `sshd`, scratch backend): Add Claude Code ran Anthropic's
      installer — `2.1.316 (Claude Code)` in `~/.local/bin`, found by the overview. With a
      stand-in `claude` that prints its folder and arguments: New project `demo` made
      `~/projects/demo/.git` and ran `--remote-control "<host>: demo"` in tmux
      `claude-demo`; detaching closed the tab and left it running; Claude on `demo` again
      attached to it rather than starting a second; `site`, with a conversation on record,
      got `--continue`; the folder set to `~` put New project `top` in `~/top` and the
      listing followed (`top` in `~`, `demo` and `site` in `projects`)
**34h′ — the Tools menu** (Sunde, 2026-11-01: "tools should have one button, and then a
submenu or dropdown"; "separate regular tmux sessions… and claude code usage"; per project
"git push… git pull… open terminal")
- [x] The **Tools** menu on a machine's row (the wrench): each added tool with how it stands
      there (`4 projects, 1 running`, `not added` — the overview read only while it is
      open), opening it in a dialog — what it needs, which of that the machine has, then
      the tool's card or Add. The machine page keeps a card per tool. (First built as a
      menu on the machine page, then as a page per tool — both moved the same day)
- [x] The projects folder on the machine page (Connection); each tool's dialog has a
      Settings button there; Needs only where a tool isn't added; plain descriptions ("Manage your
      Claude sessions here, one per project.")
- [x] tmux's card leaves out the sessions another tool claims (`claude-<project>`); Claude
      Code's projects get Pull (`--ff-only`), Push, Terminal, End
- [x] `useToolRunner` — the terminal and the confirm step, shared by the machine page and the
      dialog; `RowMenu` takes a labelled trigger and says when it opens
- [x] 704 backend, 263 frontend; `pytest`, `npm test`, `npm run build`, `oxlint`,
      `check-docs.sh`
- [x] Status line v4: Tailscale's card lists the tailnet (`tailscale status`, read with the
      status key), and each project says how many commits aren't pushed (as of its last
      fetch); a test gives a project an upstream and a commit not on it. 704 backend, 264
      frontend; `pytest`, `npm test`, `npm run build`, `oxlint`, `check-docs.sh`
- [ ] Codebox: look at Tailscale's card once it is logged in
- [x] Deleting a set-up machine takes Loskai's two lines off it first (`logic.UNINSTALL_SCRIPT`,
      `connect.uninstall`); a locked key asks for the admin password in the dialog (`423`,
      nothing deleted); an unreachable machine is deleted with a warning. A failed delete
      now shows in its dialog (it showed nowhere). +5 backend (709), +2 frontend (267)
- [x] **Live** (a throwaway `sshd` with a key of its own, a throwaway Caddy, scratch
      backend): locked → `423`, nothing changed; unlocked → deleted, `authorized_keys` left
      with only `me@laptop`, still `600`; the machine paused → deleted with "Loskai's key is
      still on the machine: Can't reach 172.17.0.2:22", both lines still there. **Found:**
      with Caddy down the first version took the key off, then failed Caddy's required step —
      the machine stayed in Loskai without its key. Now the order is: lock check, Caddy and
      DNS, the key, the record; a test holds it
- [x] **The terminal takes OSC 52** — what tmux or Claude Code copies reaches the browser's
      clipboard (Sunde couldn't copy Claude's `/login` URL). Live in Chromium against a
      throwaway `sshd` in tmux with the mouse on: `tmux load-buffer -w` of a 470-character
      URL arrived whole, no newlines, over HTTPS-like `localhost` and over plain HTTP by IP
      (pasted back: 471 bytes with the Enter); Shift+drag + Ctrl+Shift+C copied the
      selection; Ctrl+Shift+C with nothing selected left the clipboard alone. +2 frontend
      (269)
- [ ] Sunde: Claude Code's `/login` in a codebox tmux session — `c`, then paste
- [x] **A machine opens as a dialog, like a settings window** — the cog's page became a dialog
      over the list (`/machines/<id>/<category>`): General, SSH | Overview, Tools, Running |
      Log, with a search; fields save themselves and post only their change; Remove from the
      SSH config is its own confirmed button. Looked at in Chromium (each category, the
      search, a phone width) against the test fixtures. 272 frontend
- [x] One scroll, the side menu jumps and follows it; Overview merged into General. Looked
      at in Chromium: a pick scrolls and marks, the wheel moves the mark back, the end
      marks Log, `/machines/<id>/ssh` opens at SSH
- [ ] Sunde: open codebox's dialog, change a field, check the banner and the SSH entry
- [x] **Updates without a password** — a sudo rule (`/etc/sudoers.d/loskai`) for exactly
      System's update steps and its own removal, put on in the machine's terminal (the
      password typed at sudo's prompt) and taken off there; it comes off with the machine
      or its SSH connection, which now takes Loskai's key off too. Status line v5 reports it.
      Live in Chromium against a password-sudo Debian container: rule written, update ran
      with no prompt (install/reboot still asked), Remove left only the user's own key line.
      Tailscale's operator tried, didn't let `up`/`down` run unprivileged — dropped
- [x] **How long the key stays unlocked is a setting** (Settings › SSH, `ssh_unlock_minutes`,
      `SSH_UNLOCK_MINUTES`): 15 min, 1, 3, 8, 24 h; default 15. Live: set to 3 hours in the
      page, a new key's unlock ran 3.00 h
- [ ] Sunde: on each machine, once set up again (Phase 38), Allow updates without a password
      where wanted
- [ ] For Sunde, on codebox: Add Claude Code if needed, set the projects
      folder (`~` there — `~/loskai`), and open a project from the phone app

---

## Phase 35 — Accounts: an admin, and operators limited to tabs

_Its key slots were walked back by Phase 38 (below), and its admin and operators limited to
tabs were replaced by levels 1–4, each adding to the ones below (2026-11-06,
`shared/users.py`, `shared/access.py`); what it says about them is history._

Replaces "one admin password, no accounts" (architecture.md › Access). Asked 2026-11-02, after
comparing Loskai's security with Proxmox's.

**Decisions (2026-11-02, Sunde)**

- **Two roles.** An **admin** does everything, Settings and users included. An **operator**
  is given tabs — any of Docker, Routing, Machines — and may do everything in those, nothing
  outside. No viewer: a logged-out visitor already sees the Dashboard, and that is all one
  needs. Routes are Routing's: the install wizard's route step and a machine's Add route need
  the Routing tab too.
- **Every API route names who may call it** (`shared/access.py`): any signed-in user, a tab,
  or admin. A route not in the table is admin-only, and a test fails until each route has an
  entry. The middleware enforces it; a few check their body (`DELETE /api/instances/{id}` is
  Machines for a machine, Routing for a route).
- **First-run setup creates the admin account** — a username and a password, like most
  self-hosted services. `LOSKAI_PASSWORD` still seeds it (`LOSKAI_USERNAME`, default `admin`).
  An existing install's password becomes the account `admin`.
- **Sessions are per user, end after 2 hours without activity** (Settings › Security,
  `session_idle_minutes`: 30 min to 7 days) and renew while used. Logging out ends *your*
  sessions on every device; a changed password or a deleted account ends that user's.
- **Loskai's SSH key gets key slots.** It is encrypted with a random key, and that key with
  each user's password, so anyone with the Machines tab unlocks it with their own password,
  and an unlock is theirs: it ends when they log out. An existing key moves to slots at the
  admin's next unlock. A user without a slot gets one the first time they unlock while
  someone else has it unlocked, or when an admin sets their password while it is unlocked.
- **Settings › Users** (admin): add, set role and tabs, reset a password, remove — never the
  last admin. **Settings › Security**: change your own password; the idle time (admin).
- **Who did it**: the SSH log records the user.

**Steps** — a commit each, every check run:

- [x] 35a Accounts and sessions: `shared/users.py` (`data/users.json`), username login,
      first-run setup, the migration, per-user idle sessions and logout, own password change
- [x] 35b Access by tab: `shared/access.py`, enforced in the middleware and both terminal
      WebSockets; the AdGuard password hidden from operators
- [x] 35c Key slots and a per-user unlock
- [x] 35d Frontend: setup and login with a username, the nav showing only granted tabs,
      Settings › Users and Security
- [x] 35e Docs: CLAUDE.md, SECURITY.md, architecture.md, api.md, the guides; HISTORY
- [x] Live: an install with only the old password logged in as `admin` (users.json 0600,
      the hash gone from settings.json); in Chromium, first-run setup made the admin, who
      added an operator with Docker; the operator saw only Docker, `/routing` said the tab is
      missing, the API answered 403 with the reason. 759 backend, 285 frontend

## Phase 36 — Automatic runs: sudo's password in a dialog, and they close themselves

Asked 2026-11-03: a password needed to go on should be asked for in a dialog that says why,
so a run can start and end by itself. **Only automatic actions**, the ones that run to the end
without you. The shell, tmux, Claude and Tailscale's Connect keep the terminal as it is.

**Decisions (2026-11-03, Sunde)**

- **An action is automatic when its tool file says `automatic: true`.**
  - Marked automatic: System's three actions, Services, Proxmox, tmux's End and Tailscale's Disconnect.
  - Also automatic: adding a tool, and turning updates without a password on or off.
  - Not automatic: anything whose output is the point (Status, Pull, Push) or that you work in.
- **Asked only when needed.** Before the terminal opens, `POST /api/ssh/machines/{id}/run`
  works the run out as the terminal would. No password is needed when any of these holds:
  - the user is root;
  - the command has no `sudo`;
  - the sudo rule covers it (System's Update);
  - `sudo -n true` works.
  Otherwise the dialog asks.
- **The password is checked there**, with `sudo -S -v` over its own connection, so a wrong
  one is said in the dialog. Accepted, it is held in memory for a minute under a one-time
  ticket, for this user and this machine. The terminal's WebSocket takes the ticket. It is
  never stored, logged or put in a command line.
- **On the machine** the terminal opens with echo off. Loskai sends the password as the
  first line; the command reads it, turns echo back on and hands it to
  `sudo -S -v` — in tmux, through a FIFO in a `mktemp -d` folder, since a tmux pane is
  another tty. Every `sudo` after it in the run finds the timestamp. Tried 2026-11-03 on
  Debian 13: the password never appeared on screen, and the session closed itself.
- **Success closes the terminal.** A failure stays open with its exit code until Enter.
- **The reversal is recorded:** "a sudo password never reaches Loskai" becomes "used for one
  run and kept nowhere", as with the machine password in Install it for me.

**Steps** — a commit each, every check run:

- [x] 36a Backend: `automatic` in the tool schema; `connect.prepare` and the ticket; the
      wrapper reads the password; `POST …/run`; the WebSocket's `ticket`; tests
- [x] 36b Frontend: MachineTerminal asks for the password when `run` says so, and closes
      an automatic run when it ends; tests
- [x] 36c Docs: CLAUDE.md, SECURITY.md, architecture.md, api.md (+1 route), tool-schema.md,
      using-loskai.md, HISTORY, CHANGELOG
- [x] Live, in Chromium against the Debian 13 container (sudo asks; tmux on it, so through
      the FIFO): Update asked, a wrong password was said in the dialog, the right one ran
      apt and the terminal closed itself after 4 s. Switching the rule on asked the same way
      and closed itself, and Update then asked nothing. The password never appeared in what
      the terminal received, nor in the SSH log or the backend's log, and `/tmp` on the
      machine held nothing after. Reboot wasn't run: a container can't
- [ ] Sunde: try Update on a machine whose sudo asks for a password — nothing needs
      installing again for this

## Phase 38 — Loskai's SSH key, kept simply

Asked 2026-11-04, after the review: "I want to keep everything as simple as possible". The
key behind a slot per account, sealed with that account's password, cost three of the
review's eight faults and left one open: the last slot dropped, and the key with it.

**Decisions (2026-11-04, Sunde)**

- **The key is a plain owner-only file** (`0600`) in `data/ssh/`, like the status key and
  like a key in `~/.ssh` without a passphrase. Never returned, logged or exported, as before.
  A secret elsewhere to encrypt it with was the other way, and was turned down: one more
  thing to deploy and lose, for a backup of `data/` on its own.
- **Unlock stays, as a password check.** Typing your password lets you use the key for
  15 minutes, or what Settings › SSH says. Logging out, a new password or losing the
  Machines tab ends it. A stolen cookie still doesn't reach a machine.
- **Every account with Machines unlocks for itself**, with nobody else needed first. Key
  slots, `keys.py`, moving an old key and "can't unlock the key yet" all go.
- **An old key isn't moved.** Loskai isn't released, and the only install with one is
  Sunde's, with one machine. Unlock says the key is from an older version, and to make a
  New key in Settings › SSH and set each machine up again.

**Steps** — a commit each, every check run:

- [x] 38a Backend: the plain key, the unlock as a window, no slots; tests
- [x] 38b Frontend: the Users page's words about slots; tests
- [x] 38c Docs: CLAUDE.md, SECURITY.md, architecture.md, api.md, using-loskai.md, HISTORY,
      CHANGELOG
- [x] Live, against the Debian container: New key wrote a plain `0600` file and no
      `keyslots.json`; set up, install and test passed. With the admin logged out, an
      operator with Machines got `423`, unlocked by itself, read Git's settings and ran a
      command in a terminal. Machines taken away and given back: the next terminal was
      refused `4423`, which first showed the unlock surviving and was fixed. An old
      encrypted key gave the 409 to make a New key. No private key in the backend's or
      the SSH log
- [ ] Sunde: New key in Settings › SSH, then set up each machine again — which installs the
      current status line (v5), so the earlier phases' "Install again" steps are this one

## Phase 40 — The sweep: each decision in one place

Asked 2026-11-05: how much could a sweep of the whole project simplify while keeping every
function as it is. Three read-only reviews (backend, frontend, tests and docs) found the code
already lean — about 5–7% could go — so the aim is not size but the dozen decisions made in
two or more places, which is how this project's worst bugs happened. Four bugs they found
are fixed first, each with a regression test.

**Decisions (2026-11-05, Sunde: "go ahead with your recommendation")**

- Bugs first, then the backend, the frontend, the tests and the docs — a commit each, every
  check run, each area checked live before the next.
- Not done: merging the two route forms outright (little saved, ~700 lines of tests
  rewritten); pydantic for the recipe and tool validators (worse messages for authors);
  merging the LXC scripts (each runs alone through curl, untestable off Proxmox).
- Left for Sunde: dropping the pre-accounts password migration, the `/opt` move in
  `deploy.sh`, and the unused `git_build`/`registry_pull` recipe modes; reading the old
  encrypted SSH key (`logic.public_key_of`) goes once the live key is a New one.

**Steps**

- [x] 40a A stack is matched to its containers by folder — `My.App` showed as down
- [x] 40b An icon upload, a rename and AdGuard's reconcile set only their own fields
      (`instances.update_fields`), so a change made meanwhile is kept
- [x] 40c Routing shows a failed row action; a confirm dialog shows its failure
- [x] 40d The Docker tab shows a failed action — a compose run answering `ok: false` too
- [x] 40e Backend: one handler turns each domain error into its HTTP status
- [x] 40f Backend: the two terminal WebSockets share one gate and one pump
- [x] 40g Backend: `connect.py` — one way to run with the main key, one status-key ladder
- [x] 40h Backend: the compare-and-set writes on `update_fields`; one "get it or 404, then
      its tab" helper
- [x] 40i Backend: `.env` and the override each in one module, shared names public
- [x] 40j Backend: small duplicates — the error descriptions, the FQDN, the loopback rule,
      the choice settings, the Caddy host; leftovers and stale comments
- [x] 40k Backend: the Caddy client fetches its servers once; the container join leaves
      `docker/client.py`
- [x] Backend live: both terminals through the shared relay (resize reaches the shell, a
      logout closes it); install, test, sudo's password, Git's settings, the 423 after a
      logout and the uninstall against the Debian container; a recipe installed and edited
      through the form (`.env` escaped, folders and option on and off, the override gone
      when empty); and each scheme against a real Caddy — the container's body from the
      right server, at its head
- [x] 40l Frontend: one hook and one type per query
- [x] 40m Frontend: shared buttons, error text, copy button and input class
- [x] 40n Frontend: one modal shell
- [x] 40o Frontend: the key unlock and the port, login and Caddy-host checks each in one place
- [x] 40p Frontend: the route forms share their lower half; one auto-saving field; tool
      context once; dead code and `recharts` — and found on the way: Escape in a Settings
      field saved what was typed (`useAutoSave` fixes it, with a test). The primary buttons
      stay as they are: their padding differs between a page's header and a form on purpose
- [x] Frontend live: every tab renders with its data; Escape closes the top dialog of a
      confirm over the machine dialog, and the earlier Escape cases still hold; a backdrop
      click closes and a click inside doesn't; the new-key form submits; Escape in a
      Settings field saves nothing; a locked terminal asks for your password, says a wrong
      one, and opens with the right one
- [x] 40q Tests: shared fixtures (backend) and render/fetch helpers (frontend)
- [x] 40r Docs: stale facts fixed; the docs check counts modules and checks `api.md`'s routes
- [x] 40s Docs: finished phases to the archive (TODO.md 1,986 → 627 lines); a superseded note
      on each HISTORY entry a later one overturned. Not done: folding CLAUDE.md's rules and
      architecture.md's narrative into one — each is written for its reader, and the
      enumerations that drift are what check-docs now pins

---

## Phase 41 — Showing what Loskai does: new recipes, `make demo`, the README

Asked 2026-11-08, before the first public release: the README's four screenshots are from
2026-10-09 — before SSH machines, accounts, tools and the phone layout — and Sunde wants
"gifs playing for each tab or main function to showcase what the app does".

**Decisions (2026-11-08, Sunde)**

- **Generated, never hand-recorded** — "automatic generation is definetly the best and most
  time efficient". `make demo` builds a made-up homelab, records each flow, and writes the
  images; when the UI changes, it is run again.
- **Every app in the demo comes from loskai-recipes**, installed through Loskai — "real apps
  needs to come from loskai recipes". So the catalogue grows first: **Forgejo and Immich**
  now; which others is open ("I dont know yet").
- **Nothing real in a public image.** The demo runs its own Docker daemon (Docker-in-Docker),
  so the host's containers never show; its LAN is made up (`192.168.50.0/24`, names under
  `home.lan`) — not this VM's `192.168.10.0/24`, which it would also collide with.
- **Memory:** Immich wants 4 GB or more, and this VM has 3. Sunde adds RAM before the
  recording; until then everything is built and checked short of the full run.
- The README's top becomes what Loskai is, the GIFs, and the three install commands; the
  layout comparison moves below or into the guides it already links to.

**Steps** — 41a–41b in loskai-recipes, the rest here; a commit each.

- [x] 41a Recipe: **Forgejo** — upstream's rootful image, pinned (17.x); `./data:/data`
      (its own state, SQLite — no database service); `USER_UID`/`USER_GID` so the files
      are the host user's; web on `${PORT:-3000}`, Git over SSH on `${SSH_PORT:-2222}` with
      a `loskai.port` label (two published ports); `FORGEJO__server__SSH_PORT` so the
      clone URLs it shows name that port. Run once through Loskai: install, open, route,
      first-run page, Delete.
- [x] 41b Recipe: **Immich** — upstream's release compose (v3), pinned image tags (the
      database and Valkey keep upstream's digests), with: no `container_name:`, no
      top-level `name:`, `unless-stopped`; explicit `environment:` instead of
      `env_file: .env` (the wizard's `.env` holds every answer, quoted); `service:
      immich-server`; `DB_PASSWORD` a secret with no default — letters and digits only,
      said in `instructions.md`; the photo library a `type: path` with `./library` as
      default; the database fixed at `./postgres`; the model cache a named volume;
      hardware transcoding as two options (`/dev/dri`; NVIDIA with `gpu, compute,
      video`), off. Run once through Loskai, all four containers healthy — idle it needs
      about 1.7 GB, so it fit before the RAM was added; installed, opened, Delete kept
      the library and the database.
- [x] 41c The demo homelab — a privileged `docker:dind` container at `192.168.50.20` on
      a Docker network of its own (the "Docker host"), its image cache in a named volume so
      only the first run downloads. Inside it: Loskai and its Caddy, built from the checkout,
      from `compose.caddy-loskai.yml` (layout B) unchanged. Beside it on the same network:
      AdGuard at `.2`, set up through its install API; a Debian machine with sshd, `nas` at
      `.50` (`demo/machine/`); `homeassistant` at `.30`, a name only. Refuses to start when
      the subnet overlaps a route on the host (`DEMO_SUBNET` changes it).
- [x] 41d Setting it up through Loskai's own API, off camera (`demo/setup.mjs`): the
      recipes installed (Immich, Jellyfin, Bambuddy — from the default source, or
      `DEMO_RECIPES=<folder>` for recipes not pushed yet), routes for all but Jellyfin,
      which the Routing GIF routes; AdGuard routed; the SSH key; `nas` named and set up.
- [x] 41e Recording (`demo/record.mjs`) — Playwright in its Docker image, as `check-phone`
      runs it; 1280×720, a drawn cursor (Playwright draws none) and a caption per step, the
      browser resolving `*.home.lan` to the demo's Caddy. Flows: **Routing** (Add route →
      a container → its name → the app over HTTPS), **Docker** (the install wizard, Forgejo,
      to its route), **Machines** (a machine's dialog: its overview, then a terminal),
      **Dashboard** (logged out, as anyone sees it — on a computer, then a phone). Stills
      of each tab for `using-loskai.md` from the same run.
- [x] 41f Converting (`demo/convert.sh`) — ffmpeg in its own image, so the host needs only
      Docker. **Animated WebP**, not GIF: compared on the first full run, the same frames
      were 1.2–1.8 MB as GIF and 160–260 KB as WebP, equally readable — and git keeps every
      version. Into `docs/images/`.
- [x] 41g Docs: how to run it, rerun it, and add or change a flow (a contributing page);
      the docs index; CLAUDE.md's commands and code map; `make help`.
- [x] 41h The README's top, as decided: a section per feature, each on its animation; the
      layouts cut to three lines each, the rest in the guides.
- [x] 41i Live, 2026-11-10 on 8 GB: `make demo` with Immich (`DEMO_RECIPES=../loskai-recipes`
      — GitHub's mirror wasn't synced yet), every flow recorded and looked over; the
      animations in the README and `using-loskai.md` (its four stills dropped — nothing
      else showed them, so `make demo` no longer takes them). The
      first run with Immich found the demo's Docker host had no `/etc/localtime`, which
      Immich and Forgejo mount — given it. Still to see: the WebPs playing on GitHub's
      README once pushed.

---

## Phase 42 — Add route from what runs on a machine

Asked 2026-11-10: "the network selector should be changed to machines and allow selections
based on the recognized services running there (not proxmox items)".

**Decisions (2026-11-10, Sunde)**

- The picker's **Network** source becomes **Machines**: a named machine's services, each
  with the port it listens on; picking one fills the host (the machine's address), the
  port, a prefix and a name. No new link on the record — a route on a machine's address is
  already on that machine.
- **AdGuard, WireGuard and the Certificate page leave the picker.** The AdGuard pill on the
  Routing tab keeps routing AdGuard (with `origin`); the other two are routed as External.
  The backend keeps accepting all three origins, so routes made earlier stay as they are.
- **Proxmox guests (VMs, LXCs) are never offered.** Proxmox's own web UI is: `pveproxy`
  (:8006) is offered though the running list counts it as base system.
- **A service with no port Loskai can read is not offered.** When the SSH user can't read
  other users' sockets (no root, no `sudo -n`), the source says so and how to give it.

**What is known before building**

- The running list has no ports today (`ssh-status.md`): containers are `name|image|status`,
  services are unit names. Ports need the status command's v6, and a machine on an older
  line reinstalls it from its dialog (the existing "install again").
- `GET /api/ssh/running` is level 3 (Machines); Routing is level 1. The source shows only
  to accounts that may read it; the others keep Container and External.
- Only TCP listeners on an address Caddy can reach count: not `127.0.0.1`/`::1`. Loskai
  can't tell HTTP from anything else (a database's port), so it offers what listens and
  the person picks.
- The Docker host's own containers are already the Container source (with following);
  under the Docker host the Machines source lists its services, not its containers again.

**Steps** — a commit each.

- [x] 42a Status command v6: `#docker` rows gain the published ports (`{{.Ports}}`); a new
      `#listen` section — `ss -Htlnp` (then `sudo -n`, then `!denied`), and each listening
      pid's systemd unit from `/proc/<pid>/cgroup`. `parse_running` adds `ports` to each
      container and `listening` (`{service, port}`, loopback left out, base services left
      out except `pveproxy`); older lines parse as before, with no ports. Tests: samples in
      `test_ssh_logic.py`; the real-command test picks up the section. `ssh-status.md`:
      the section, the version row. Built: `facts` still reads v5 (`FACTS_VERSIONS`), so a
      machine's overview keeps working until its line is reinstalled; only the ports wait.
      Run here as root (privileged container): units and pids as expected.
- [x] 42b The picker: the Machines source — grouped by machine, one row per service and
      port, those already routed on that address and port left out; opened from a
      machine's row, on that machine. Network source and `networkServices.ts` go, except
      what the AdGuard pill needs. Tests in `AddRouteModal.test.tsx`.
- [x] 42c Docs (with 42b — a doc changes with its behaviour): `architecture.md` and CLAUDE.md (where routes are made), `using-loskai.md`,
      `api.md` if the running response's row changes; HISTORY (why the built-ins left).
- [ ] 42d Live: on a real machine with SSH set up — reinstall the status line, see its
      services and ports, route one, open it. Then `make demo` again (the Routing flow).
      So far (2026-11-11): reinstalled on docker and proxmox; docker lists its containers
      by port, proxmox has nothing left (its :8006 is routed as pm). Routing one is left.

## Phase 43 — Route and name from a machine's running list

Asked 2026-11-11: on the Machines tab, the running list (containers, services, Proxmox
LXCs and VMs) should offer adding a route and naming a machine, "so we can quickly add
machines and routes from there too".

**Decisions (2026-11-11, Sunde)**

- **The running card opens on a click**, not a hover: it holds buttons now, which a hover
  card can't offer on a phone. Esc or a click outside closes it.
- **A container or service with a port: Route** — Add route on that machine with it picked
  (the Machines list's pick). Already routed: its name instead. No port: no button.
- **A Proxmox guest: Name** — Name a machine with its name and address filled in. Already
  named (a machine at one of its addresses): that name instead.
- **Guest addresses come from the status line (v7)** — Sunde chose this over typing them,
  which would make "already named" a guess by name. Proxmox's `pct list`/`qm list` have no
  addresses.

**What is known before building**

- An LXC's addresses: `lxc-info -n <id> -iH` (root) — the live ones, Docker bridges
  inside it too. A VM's: only through its QEMU guest agent (`qm guest cmd <id>
  network-get-interfaces`), which waits when the agent is configured but not answering —
  so each is capped (`timeout`) and they run side by side. A VM without the agent has no
  address: Name then leaves it to type.
- Several addresses: the one on the Proxmox host's network (its /24) is filled in, else
  the first; IPv4, off loopback and link-local.
- `facts` doesn't change: `FACTS_VERSIONS` gains v7. A v6 machine keeps its ports; only
  the addresses wait for a reinstall.

**Steps** — a commit each.

- [x] 43a Status command v7: `#addr` — `<id> <address>…` per running guest, as root or
      `sudo -n`, nothing otherwise. `parse_running` gives each guest `addresses`. Tests
      and `ssh-status.md`, `api.md` with it. Built: the loop is tested against fake
      `pct`/`qm`/`lxc-info`; a hanging agent costs 3 s once, not 3 s per VM.
- [x] 43b The card: opens on click; Route and Name per row, or the name already given.
      `AddRouteModal` takes a pick to start on; `AddMachineModal` a name. Tests;
      `using-loskai.md`, `architecture.md` with it. Built: one list of a machine's ports,
      routed or not (`servicesOn`), for both the picker and the card. The Docker host's
      containers get no button — they're the Container source, as in the picker.
- [ ] 43c Live: reinstall on proxmox; name a guest from its row, route a service from one.

## Phase 44 — Reaching the homelab from outside, with Tailscale

Asked 2026-11-11: Tailscale as a way in, "without complicating it too much for setup". Sunde
chose a recipe that runs a Tailscale **subnet router** as a container, and asked for a
standalone install script too, "which can be used for a VM, an LXC or a Raspberry Pi".

**Decisions (2026-11-11)**

- **Tailscale is the way in, not a replacement.** A subnet router shares the LAN with the
  tailnet, and Tailscale's split DNS sends the base domain to AdGuard — so the same names,
  certificates and routes work from anywhere. Replacing AdGuard can't work (MagicDNS names
  devices, not services); replacing Caddy (`tailscale serve`) gives a name per device, not
  per service, and would need a Tailscale API key in Loskai, which keeps no third-party key.
- **No Loskai code.** A recipe (in `loskai-recipes`), a script (`scripts/`), and a guide.
- **The auth key is optional** in both: without one, Tailscale prints a login link (the
  container's log, the script's output), and no key is stored.

**What is known before building**

- The official image's entrypoint (`containerboot`) takes `TS_AUTHKEY`, `TS_ROUTES`,
  `TS_HOSTNAME`, `TS_STATE_DIR`, and runs in userspace networking unless told otherwise —
  no `/dev/net/tun`, no capabilities, nothing changed on the host. Host networking gives it
  the best chance of a direct connection, rather than a relay.
- A standalone box: Tailscale's own install script covers Debian, Ubuntu, Raspberry Pi OS
  and more. An LXC has no `/dev/net/tun` unless given one (`pct set <id> -dev0
  /dev/net/tun`); without it, `tailscaled` can run in userspace networking instead.
- Approving the route and setting split DNS happen in Tailscale's admin console — the guide
  says where.

**Steps** — a commit each.

- [x] 44a The recipe `tailscale` in `loskai-recipes`: the auth key (optional, secret), the
      network to share, the device's name. State in `./state`. Built: run from a scratch
      copy, it advertised the route and logged the login link, in userspace networking
      with nothing changed on the host.
- [x] 44b `scripts/tailscale-subnet-router.sh`, run on the box: installs Tailscale, finds
      the LAN, shares it; userspace networking where there's no TUN device; safe to run
      again. With a guide, `docs/guides/tailscale.md`: both ways in, then the admin
      console's two settings. Built: run in a Debian 12 container with systemd — kernel
      mode with a TUN device, userspace without, and back again on the next run. A box
      already logged in (`tailscale set`) is 44c's to see. *Retired 2026-11-12* for 44d.
- [x] 44d The Tailscale tool shares a machine's network (**Share this network**, **Stop
      sharing**), and its card says whether the tailnet approved it (status line v9). Built:
      the commands run under `dash` with sudo faked, and the status line with Tailscale
      faked; a machine with nothing shared, live.
- [ ] 44c Live: a real tailnet — share the LAN from the tool (codebox) and the recipe, open
      a routed name from a phone.

## Phase 45 — Links: a Dashboard entry without Caddy

Asked 2026-11-11: with Loskai running alone (no Caddy, no AdGuard), keep the Dashboard — an
entry that opens `http://<ip>:<port>` — as "an easy and accessible place for shortcuts", and
for a desktop app that builds shortcuts from the routes. Sunde: both modes must "simply just
work", without "a dumb shortcut now" that costs later.

**Decisions (2026-11-11)**

- **A link is a record with `route_mode: "direct"` and no subdomain.** "A route is an
  instance with a subdomain" stays true, and every Caddy and AdGuard path — push, sync,
  rewrites, the DNS checks — reads only records with one, so none of them changes or needs a
  case for links. A link has a name, an icon, `private`, an upstream and `upstream_tls`
  (which opens it over https); `scheme` means nothing for it.
- **Where a person opens a record is decided once**, `instances.open_url`: a route at
  `<scheme>://<name>`, a link at `http(s)://<upstream>`, a machine nowhere. The Dashboard, the
  launcher, the route rows and the container rows all carry it; the frontend shows it and
  builds no URL of its own.
- **A third verb, `POST /api/links`, not a third mode of `assign()`.** `assign()` is the
  Caddy-then-AdGuard orchestration; a link has neither step, and bending it through would
  add branches to the one function where divergence hurts most.
- **Link → route is Assign a URL**, the existing path: `assign()` already re-points an
  existing record, by id or container. **Route → link is refused** (`409`, remove the route
  first): tearing a route down is `unassign`'s job, with its required Caddy step.
- **A link's address must open in a browser.** For a container that is the Docker host's
  address and the published port — a new `published_upstream` on each container row, which
  the follower uses for a link following its container. Caddy's own form (a Docker service
  name) is never a link's.
- **Both modes everywhere routes are made.** Add route offers Route or Link while Caddy is
  set up, and Link only while it isn't; the install wizard's last step offers a link without
  Caddy. Unrouted rows offer a link then too.

**Steps** — a commit each.

- [x] 45a The record and the verb: `route_mode: "direct"`, `instances.open_url`,
      `POST /api/links` (create and edit, by id or container), the follower for links, the
      Dashboard and launcher, `url` on route and container rows. Tests: Caddy and AdGuard
      never touched by a link; link → route; route → link refused; a machine's move takes
      its links along. Built: `tests/test_links.py` (22), and the follower's write also
      checks the record's mode, so a link turned route mid-lookup gets no browser address.
- [x] 45b The UI: Route or Link in Add route, a link row on Routing (edit, private, icon,
      make it a route, delete), links under a machine, the Docker tab's link, the wizard's
      last step without Caddy. Every place shows the server's `url`. Built: `RouteLink`
      takes only `url` now, so the Docker tab and Machines build no URL of their own;
      `LinkModal`; `useCaddySetUp`; `saveNew` picks the endpoint for Add route.
- [x] 45c Live: a scratch Loskai without Caddy — add links, the Dashboard and launcher list
      them; with Caddy (the smoke rig) — a link made a route is pushed, and Sync leaves
      links alone. Run 2026-11-11 on `:8010`, the same data both ways. Without Caddy: links
      by API and in Chromium (Add link, a container pre-filled with its published port);
      the Dashboard, logged out, opened `http://192.168.10.220:8081` and whoami answered; a
      throwaway container re-run on another port moved its link by Docker's events; a route
      attempt failed and left the link as it was. With a throwaway Caddy: Sync pushed
      nothing for links, Assign a URL made one a route Caddy served (`Via: Caddy`, whoami's
      body), Sync then pushed only it, route → link was refused, and a new link left Caddy's
      ids alone. Found: the picker said "No unrouted containers" while still loading —
      fixed.

## Phase 46 — The second sweep: decisions made twice again

Asked 2026-11-13: a checkpoint (tag `checkpoint-2026-11-13`), then a refactor of the whole
codebase. Three read-only reviews, as in Phase 40, found the code still lean — about 2–3%
could go — and that the 157 commits since Phase 40 (the running list, tools, Tailscale,
links, status lines up to v10) had brought back about a dozen decisions made in two or more
places. Four bugs they found, each checked in the code, go first.

**Decisions (2026-11-13, Sunde: "go ahead with the recommended changes, and drop the old code")**

- Bugs first, then the backend, the frontend, the tests and the docs — a commit each, every
  check run, each area checked live before the next.
- **Old code dropped:** the unused `git_build`/`registry_pull` recipe modes (no recipe in
  `loskai-recipes` uses them), the pre-accounts `admin_password_hash`, and the refusal of a
  key from before Phase 38 (the live key is unencrypted). **Kept:** reading an account saved
  before levels (`users._level`) — the live `users.json` still holds one, saved with
  `role`/`tabs`, and dropping it would lock that account out; it can go once the file has
  been saved since.
- **Not done, on purpose:** splitting `recipes.py`, `ssh/logic.py` or `InstallWizard.tsx`
  (tidier, simpler in no way); one style for the tab strips and an `IconButton` with
  `disabled` (visible changes for no fix); compacting tests where nothing is decided
  twice; the base domain's old rewrites left behind when it changes (decided 2026-09-20 —
  Settings › Network › Clear); the STACKS_DIR comment repeated in the three compose files
  (each is read alone, by someone installing from it).

**Steps**

- [x] 46a A new stack whose `up` fails stays open on what Compose said
- [x] 46b Check for updates counts only the recipes it can update
- [x] 46c Each machine's SSH target comes from the server — the setup dialog showed
      `user@undefined` for an entry without `HostName`
- [x] 46d The Dashboard's cards are keyed by id, not name
- [x] 46e The reviews' unchecked bugs — Tailscale's "approval" read two ways, a typed name
      lost on Cancel, the wizard's silent failures — each checked, fixed where real
- [x] 46f Backend: AdGuard's expected rewrite and its conflict rule, once
- [ ] 46g Backend: statuses decided where raised — `ToolError`, the base domain's refusal,
      one `instances.require`
- [ ] 46h Backend: the status line's version is a number, not three lists
- [ ] 46i Backend: saving a machine leaves the HTTP handler (`assign.save_machine`)
- [ ] 46j Backend: which recipe a stack came from, once; one git runner; the small
      duplicates and stale comments
- [ ] 46k Backend: the old code — `git_build`/`registry_pull`, `admin_password_hash`, the
      pre-Phase-38 key's refusal
- [ ] Backend live
- [ ] 46l Frontend: no URL built in the browser (AdGuard's pill, the wizard's "Already routed")
- [ ] 46m Frontend: the route forms' preview and follow toggle, once; the Assign form
      decides its own pre-fill, like `LinkModal`
- [ ] 46n Frontend: one key-unlock hook
- [ ] 46o Frontend: one route invalidation, one recipes query, `SaveBanner` on Routing
- [ ] 46p Frontend: leftovers — `kind` required, `retry: false`, dead helpers, the Users
      remove dialog's pending state, Machines loaded lazily
- [ ] Frontend live
- [ ] 46q Tests: the effect, not the response; tests that couldn't fail
- [ ] 46r Tests: one signed-in admin client; settings untouched by the environment
- [ ] 46s Docs: stale facts, superseded notes, browser/server pairs registered
- [ ] 46t Docs: finished phases to the archive; `check-docs` checks where each phase lives
      and the instance schema; the HISTORY entry

---

## Backlog / Future ideas
- **Machines over SSH, after Phase 34** — one command on several machines at once; a second
  login factor (TOTP) once Loskai holds keys.
  [`architecture.md`](architecture.md#direction--managing-the-machines-over-ssh)
- **Your devices' keys on every machine** (planned as Phase 39 on 2026-11-04, cancelled the
  same day as not needed now) — Loskai installing your own devices' public keys beside its
  own, so the SSH config download logs in from them. Its proposal and open questions are in
  commit `6c0f42a`
- **Uptime monitoring** — ping each upstream, keep response-time history
- **Notifications** — a container crashed, AdGuard down, a certificate near expiry
- **Multi-host** — a second Docker host in the same Docker tab — a read-only agent, or over
  SSH once Machines can reach it (Phase 34)
- **"There's a recipe for this"** (Sunde, 2026-10-23: "a good future feature") — an
  unmanaged container whose image a recipe also uses gets a hint on its row, opening the
  wizard on that recipe. The manual path it would shorten is `migration.md`'s *An app the
  catalog has*: copy the data into `stacks/<id>/` where the recipe keeps it, then install
- **Prune orphaned recipe caches** — removing a source leaves its clone in
  `data/recipes-cache/<slug>/`. Harmless (nothing scans it once the row is gone) and
  deliberately not auto-deleted: the alternative is Loskai removing directories on a settings
  save. A "clean up unused caches" action, or leave it to `rm -rf`
- **Real domain + DNS-01 wildcard** (e.g. `*.home.<owned-domain>`): publicly-trusted certs,
  zero cert install on any device, nothing exposed publicly (DNS-01 is outbound-only; the
  names resolve on the LAN via AdGuard rewrites). Dissolves Phase 12 entirely, including the
  whole onboarding page. **Not scheduled** — deliberate decision to keep the homelab off the
  owned domain for now. Precondition when revisited: DNS hosted somewhere with an API Caddy
  has a plugin for. **Confirmed 2026-09-27: one.com has no caddy-dns module**, so the two
  routes are NS-delegating a subdomain, or CNAME-ing `_acme-challenge` to an acme-dns
  instance — neither moves the registrar. Phase 24 made the LXC script provider-agnostic, so
  either is configuration rather than a patch
- **Store read amplification** (twin of Phase 15's deferred F12, noted 2026-08-29): every
  `get_instance` / `get_by_container` / `get_by_origin` / `list_routed` re-reads and re-parses
  the whole `instances.json`, so one assign reads the file several times over — 25 call sites
  app-wide (39 counting `list_instances` itself), seven of them inside `instances.py`. Same
  shape as F12's per-key `settings.json` reads. A request-scoped read is the fix; changing the *storage format* is not (JSON is the
  right choice while the app is the writer and the file stays a human-readable recovery record)
- Tier-3 integration rig + Forgejo CI (Phase 8b) — deferred by choice
- **Dotted names for routes** — a route's prefix is one label because every name once
  shared one `*.BASE_DOMAIN` wildcard cert. Caddy now gives each name its own (2026-11-08),
  so `rack1.grafana` could be a route as it can be a machine: relax `validate_prefix` and
  `isValidPrefix` together.
- Certificate status, expiry per name (Phase 3) — under the internal CA this is readable from
  Caddy's PKI endpoints; TLS probe stays the method-independent approach
