[Docs](../README.md) › [Project](../README.md#project)

# Loskai — History

**Read this when** you are about to reverse a decision — newest first, with the reasons.

## 2026-11-13 — A project's own commit name and email (Phase 50)

Sunde wanted to override the global commit identity per project. It is a cog on the
project's row on Git's card, opening its Name and Email in a dialog — `git config --local`,
empty for the global one. The fields first opened beneath the row and saved as each was
left; Sunde found that no way to enter a value, so they are a dialog with Save and Cancel —
not a dropdown, which closes on a scroll, as a phone's keyboard opening does. Rather than code for Git, a tool setting can now be a value of
each project (`target: project`), with the global setting it `overrides` and an `unset`;
Git's file holds the commands, as for every other action. Each project's values are read in
the same SSH command as the global ones: reading them in the status line would have made
every machine update its key for the sake of a teal cog. An identity for a whole folder
(git's `includeIf`) was left out as a third level that is hard to show.

## 2026-11-13 — Claude Code is its sessions, Git is the project's git (Phase 49)

Sunde found Claude Code's card cluttered by Pull and Push. Claude Code now opens and ends
Claude's sessions and starts a project; a project's git — Pull, Push, a shell, and the new
Clone and Pull all — is on the Git card, which lists the same projects. The overlap is
intended. A remote's own way of logging in is left to git in the terminal (the machine
user's own key over SSH, a login prompt over HTTPS), so nothing new is stored and Loskai's
key never reaches a forge. Clone's address is a new `ask` kind, `repo`, which takes only
the usual transports: git's `ext::` would run a command.

## 2026-11-13 — The open bugs, before a release (Phase 48)

Asked what stands between today and a first release, Sunde chose to fix what could be fixed
now. Five bugs from *Open, not in flight*:

- **A run's tmux pane waits 30 s for sudo's password, then ends.** Cut off between the
  session starting and the password arriving, it waited on its FIFO for good, and the next
  run of that action attached to it — a blank terminal.
- **The sudo ticket is the terminal socket's first message**, never in its URL: uvicorn's
  access log keeps URLs. Anything else first is refused.
- **A closed container terminal hangs up its shell.** Docker keeps an exec'd process after
  its socket closes, and Loskai can't signal it from its own container, so the shell
  carries a mark in its environment and closing runs a hangup for that mark in the
  container. A process made to ignore hangups (`nohup`) stays, as it would on a real
  terminal.
- **Wrong passwords count per account and client** (Sunde chose it over also keeping a
  looser account-wide limit). Per account only, a guesser kept the account's owner out.
  A guesser with many addresses gets 5 free tries per address; one check at a time, with
  argon2, still bounds the rate.
- **A new SSH user takes Loskai's things off the old one first** (Sunde chose it over
  warning whenever the folder can't be read, which would warn on every 0750 machine). The
  sudo rule is the old user's, and only another user could fail to see it. A locked key
  warns rather than stopping the change: a field saved as you type has no place to ask
  for the password.

Left open: a `secret` flag for tool settings, which no setting needs yet.

## 2026-11-13 — Big files split where a seam is (Phase 47)

Phase 46 left its three biggest files whole as "tidier, not simpler". Sunde: "splitting when
it serves no purpose or is detrimental to the overall functionality should be avoided, but
making too big files, should also be avoided when possible". So a file past about 500 lines
is looked at, and split where each part reads alone — a contract, a step, the pure part and
the I/O — never where the parts must agree, such as a format's writer and its reader. The
rule is in CLAUDE.md's principles and the sweep's estimate.

**Split:** `ssh/logic.py` (801) — the status key's contract to `status.py`, its command and
the parsers of what it answers together, since each section one writes the other reads;
`docker/recipes.py` (797) — the manifest's rules (pure) to `manifest.py`, an install, its
record and the recipe icon to `install.py`; `InstallWizard.tsx` (857) — its Configure and Done
steps to their own files; `MachineDialog.tsx` (613) — the side menu, which knows nothing of
machines, to `shared/SectionPane.tsx`, and Turn on SSH to `EnableSshModal.tsx`. Tests
followed where a test file was one module's. Nothing changed in behaviour: the same 914 and
372 tests pass, and a live run checked each split file against a real machine, Docker and
Caddy, and in Chromium.

**Left whole, each one subject:** `shared/assign.py` (787 — the record-making verbs beside
their HTTP surface, as in every shared module; the one cut, links, shares its checks),
`ssh/connect.py`, `ssh/tool.py` (one contract, `tool-schema.md`), `pages/Routing.tsx` (its
mutations write the page's own state), `StackGroups.tsx`.

## 2026-11-13 — The second sweep: decisions made twice again (Phase 46)

Sunde asked for a checkpoint (the tag `checkpoint-2026-11-13`) and a refactor of the whole
codebase. Three read-only reviews, as in Phase 40, found it still lean — 2–3% could go — so
the sweep aimed again at decisions made in two or more places: the 157 commits since Phase
40 had brought back about a dozen.

**Bugs, each with a test that failed before:** a new stack whose `up` failed closed as if it
had worked; Check for updates counted recipes it couldn't update; the SSH setup dialog
built its login from `HostName` alone (`user@undefined`), now the server's `targets`; the
Dashboard keyed cards by a name that can repeat; the overview read Tailscale's state its own
way; the wizard said nothing when a sync or an install failed; a typed name was lost on a
Cancel; the stack form let a `:` through that the server refuses. And one found in the live
check: **AdGuard keeps a second copy of an identical rewrite**, and every save of a route or
a machine added one — `adguard-api.md` had said re-adding was harmless.

**What became one:** AdGuard's expected rewrite and its hand-added rule (`expected`,
`foreign`); each status set where its error is raised (`ToolError`, `instances.require`,
`require_base`); the status line's version, a number instead of three lists; saving a
machine, out of its HTTP handler (`save_machine`); which recipe a stack came from; a stack
or a 404, and its `.env`; the route forms' preview and follow toggle; what a change to the
records refreshes; the recipe list and its type; the save banner; a file download; the
tests' signed-in admin. Settings in tests no longer read the environment.

**Old code dropped**, at Sunde's word: the unused `git_build` and `registry_pull` recipe
modes, the pre-accounts password, and the refusal of an encrypted key from before Phase 38
(the public key is asyncssh's now, byte-for-byte the same on the live key). **Kept:** reading
an account saved before levels — the live `users.json` still holds one.

**Not done, on purpose:** splitting `recipes.py`, `ssh/logic.py` or `InstallWizard.tsx`
(tidier, not simpler — superseded the same day by Phase 47, above); one key-unlock hook (five flows around one request, their shared
parts already one); moving the Assign form's pre-fill into the form (one caller); one git
runner (four calls, four ways to fail); the base domain's old rewrites (2026-09-20).

**The docs:** TODO.md was back to 1,017 lines; Phases 34–45 went to the archive, their open
live checks gathered under *Open, not in flight*. Four HISTORY entries overturned since now
say so. `check-docs` now checks where each phase lives and the instance schema — the two
drifts found by reading.

## 2026-11-12 — Status line v10: sudo only where it needs no password

A code review found v8's quiet sudo wrong for exactly the machines Loskai sets up: one with
Loskai's update rule (`NOPASSWD`, a few commands) beside Ubuntu's `%sudo ALL` with a
password. `sudo -n -l` answers without a password as soon as one rule needs none
(`listpw=any`), so `sudo -n -l sh` said yes, `sudo -n sh` then wanted the password — and
was refused, and logged, every 30 s; the listeners and Proxmox's guests read as empty
rather than unreadable. There is no quiet way to ask sudo "would this need a password", so
v10 reads the listing instead: sudo is used only when the last rule for `ALL`, as root, is
`NOPASSWD`. A narrower passwordless rule (for `docker` alone, say) is no longer used: the
list it would have read says `!denied` instead — honest, and never logged. The same version
asks `tailscale status` once for both the state and the approved networks.

## 2026-11-12 — "Enter closes this" closes the window; Escape closes an ended terminal

Sunde detached from a new tmux session and was left with a dialog saying `[done, exit 0]
Enter closes this.` — Enter ended the session, and the dialog stayed, with Escape going to
a terminal that had nothing left in it. Two changes. A tool's run closes its window when
its session ends after the prompt was printed: that end is the Enter. It isn't closed on any
end, because the server closes a session that the machine dropped (a reboot, the network)
exactly as one that finished, and a window vanishing then would hide why. And once any
terminal's session has ended, Escape is passed on to close its dialog, as everywhere else;
`[session closed] Esc closes this.` says so.

## 2026-11-12 — An automatic run drops down instead of opening a dialog

Sunde found the terminal that opened and closed by itself for Share this network
"quite distracting", and asked for a quake-style one for runs that do one thing and end,
with "a tiny timer" to glimpse what ran. An automatic run now drops down from the top of
the page (`QuickTerminal`), with no backdrop, so the page stays usable; done, it lingers
three seconds while a bar empties — the bar's CSS animation is the timer, so hovering
pauses both — and **Keep open** keeps it; failed, it stays with its exit code. The prompts
before it (the key's password, sudo's) stay dialogs, as they need an answer. A failure is
told by the `[failed, exit N]` line in the output, not the session's end: in tmux the
session ends the same either way. Shells and the runs that aren't automatic keep the dialog —
you work in those.

## 2026-11-12 — Subnet routing is the Tailscale tool's, not a setting

Sunde asked whether turning subnet routing on belongs in Settings, "since these are
technically Loskai settings", or in the Tailscale tool. The tool: Settings holds values
Loskai stores and uses itself, while sharing a network is something a machine's Tailscale
does — and any machine can be the router, not only the Docker host. So **Share this
network** and **Stop sharing** are Tailscale tool actions, and the card says whether the
tailnet has approved the network, read by the status line (v9) without root. Approving it
and split DNS stay in Tailscale's admin console, which the card links to: doing them from
Loskai would need a Tailscale API key, and Loskai keeps no third-party keys. Forwarding is
turned on for IPv4 only — IPv6 forwarding makes Linux stop taking its address from router
advertisements, and the shared network is IPv4.

**The card is two switches, not five buttons** (asked for an audit the same day). Connect,
Status, Share this network, Stop sharing and Disconnect all showed whatever the state, the
tailnet's device list came first, and "not connected" covered both off and logged out. Now
**Connected** and **Share this network** are switches — each running the tool's own action,
moving once the overview reads it back, as the sudo rule's does — the state is said (off,
logged out, waiting for the tailnet's approval), and the rest of the tailnet is folded under
them. Status is gone: it printed what the card lists. A warning for Tailscale SSH was
considered and left out: where it matters — a machine reached on its Tailscale address —
Loskai can't read the overview at all, so it could only ever show where it doesn't.

**Funnel and Serve are not in Loskai.** Sunde asked whether the tool should publish
services through them, with paths. No: Funnel puts a service on the public internet, which
the Tailscale setup is built to avoid, and needs a tailnet policy Loskai can't see without
an API key; Serve and Funnel are a second way to name services, beside the Routing tab — a
decision made twice; and paths break any app not told its base URL (Proxmox among them).
Both stay a terminal command on the machine. A route that should be public would be a
Routing option, decided there.

**The script `scripts/tailscale-subnet-router.sh` is gone** (Phase 44b, restored by
reverting its removal). It covered a box Loskai doesn't manage, but any box can be named on
the Machines tab and given the tool — and three ways to do one thing was one too many;
Sunde: "sticking with the tool is best". The recipe stays, as the optional way for a Docker
host that shouldn't run Tailscale itself. What the script did that the tool doesn't: fall
back to userspace networking in an LXC without a TUN device — the guide gives the LXC one
instead.

## 2026-11-11 — Status line v8: sudo asked so it logs nothing

_Its sudo check was wrong for a machine with Loskai's rule beside a password-protected
`%sudo ALL`; v10 replaced it the next day (above)._

A review found every poll ran `sudo -n true` to decide whether to read a machine's
listeners and guest addresses as root (v6, v7). Tried in a Debian container with sudo
logging to a file: that is logged as an incident for a user sudo refuses — every 30 s per
machine, and with sudo's defaults it may mail root — for a command whose contract is that
it only reads. `sudo -n -l` with no command is refused silently; `sudo -n -l <command>` is
answered silently to a user with any passwordless rule. v8 asks those first: no sudo, a
narrow rule or sudo with a password left nothing in the log; full passwordless sudo still
reads as root. Before v6, sudo was tried only after a plain command failed; asking first
keeps the root lists without the noise.

The same version lists a Proxmox host's guests once: `qm list` is slow, and v7 ran it (and
`pct list`) twice, once for the lists and again for the addresses. Without quotes or
backslashes, a list kept in a variable can't be printed line by line the usual way; IFS is
set to a newline made from `$(echo; echo x)`.

## 2026-11-11 — Links: a Dashboard entry without Caddy

Sunde asked to keep the Dashboard with Loskai running alone — an entry opening
`http://<ip>:<port>`, "an easy and accessible place for shortcuts", and for a desktop app
building shortcuts — and that both modes "simply just work", without "a dumb shortcut now".

- **A link is a record with no subdomain** (`route_mode: "direct"`), not a route with a fake
  one. Every Caddy and AdGuard path reads only records with a subdomain, so none of them
  needed a case for links — the alternative, a subdomain nothing serves, would have put one
  in each, and shown an address that isn't one.
- **Its own verb, `POST /api/links`**, beside `assign()` rather than inside it: `assign()` is
  the Caddy-then-AdGuard orchestration, and a link has neither step.
- **One place decides where a record opens**, `instances.open_url`. The Docker tab and the
  route tables each built a URL from the subdomain; now they show the server's, so a link
  needed no third copy.
- **A link's address is the browser's**: a container's is the Docker host's published port,
  `published_upstream` — Caddy's form can be a Docker service name a browser can't open.
  The follower writes only to a record still of the mode it derived for.
- **Link → route is Assign a URL; route → link is refused** until the route is removed,
  since tearing a route down is `unassign`'s required Caddy step.
- **A downgrade loses links**: an older Loskai can't read `route_mode: "direct"`, skips those
  records, and its next write drops them.

## 2026-11-11 — Machines on the tailnet: both host addresses in every `from=`

Sunde asked whether the Machines tab could manage a machine that is on the tailnet but not
the LAN — and from a PC without Tailscale. The network already allowed it (Loskai's
container reached two tailnet machines' SSH through the Docker host's Tailscale); `from=`
did not, naming only the host's LAN address while a tailnet machine sees its Tailscale one.
One optional setting, `host_tailscale_ip`, now goes into every machine's `from=` beside
`host_ip`.

- **Every machine gets both, not the one its address calls for.** Choosing per machine meant
  telling a tailnet address from a LAN one, two versions of the lines in Settings › SSH,
  and a reinstall when a machine moved between the two. Both addresses are the same host,
  so the lock is no looser.
- **Ignored without `host_ip`.** No `host_ip` means no `from=`; the Tailscale address alone
  would lock Loskai out of every LAN machine.
- **Typed in, not detected:** Loskai's container can't ask the host's Tailscale, and the
  status line reads it only from a machine already set up.
- Checked and unchanged: Routing and Docker; machines set up before keep their lines (Loskai
  never compares installed lines), and Caddy and AdGuard's install needs nothing new.

## 2026-11-11 — Tailscale as the way in, not a replacement

_Its "no Loskai code" was walked back the next day: sharing the network became the
Tailscale tool's ("Subnet routing is the Tailscale tool's", above), and the script retired._

Sunde asked how Tailscale could reach everything, "without complicating it too much for
setup". Tailscale runs as a **subnet router** beside Caddy and AdGuard — a recipe for the
Docker host, and a script for a VM, LXC or Raspberry Pi (Sunde's addition) — and split DNS
sends the base domain to AdGuard. No Loskai code.

- **Not instead of AdGuard:** MagicDNS names devices, not services, and takes no names of
  your own.
- **Not instead of Caddy:** `tailscale serve` is one name per device; a name per service
  needs a node per service and a Tailscale API key in Loskai, which keeps no third-party key.
- **Userspace networking in the recipe**, so installing it changes nothing on the Docker
  host; the script uses kernel mode where it can, being the box's whole job.

## 2026-11-11 — The running list routes and names

Sunde: add the route and name-a-machine functions to the Machines tab's running list, "so
we can quickly add machines and routes from there too". A port gets a button to route it, a
Proxmox guest one to name it.

- **The card opens on a click, not a hover.** It holds buttons now, which a hover card
  can't offer on a phone.
- **Guest addresses are read from Proxmox** (status line v7) — Sunde's choice over typing
  them, since without an address "already named" would be a guess by name. An LXC's come
  from `lxc-info`; a VM's only from its QEMU guest agent, so a VM without one is still
  typed in.
- **The Docker host's containers get no button**, as in the picker: they are routed from
  the Container source, where a route can follow its container.

## 2026-11-10 — Add route's Network source becomes Machines

Sunde: "the network selector should be changed to machines and allow selections based on the
recognized services running there (not proxmox items)". The Network source offered three
fixed things — AdGuard, WireGuard's dashboard, Caddy's certificate page — while a machine's
running list, read over SSH since Phase 34, already knew what runs on each machine, only
not on which port. So the status line went to v6 (each container's published ports, and
`ss -Htlnp` with each listener's systemd unit), and the source lists those ports.

- **The built-ins left the picker** (Sunde's choice over keeping them as a group). AdGuard
  keeps its one-click pill and `origin`; the other two are External routes. Lost: re-routing
  WireGuard or the certificate page from the picker edits the old record instead of adding
  a second — rarely done, and the old records keep their origin.
- **No new link on the record.** A route made from it is a plain external route on the
  machine's address, which is what puts it on the machine already.
- **Proxmox's guests are never offered; Proxmox's own UI is.** `pveproxy` is a base service,
  hidden from the running list, but :8006 is the commonest thing to route on such a host.
- **A port without a service is not offered.** Only root sees which process holds another
  user's socket, so a machine whose SSH user has no `sudo -n` says so instead of listing
  ports it can't name. `facts` still reads v5, so no machine's overview asks for a
  reinstall over this; only its ports wait for one.
- **The External tab went too** (Sunde: "drop the external … add a clear button … to wipe
  the selection"). Its form was the same fields every tab has, and a list of a different
  height on each tab moved the fields and buttons under the pointer. Now there are two
  lists, the fields take any address, and **Clear** drops a pick. A second dialog for
  picking was considered and rejected: a dialog on a dialog, and unclear what Esc closes.

## 2026-11-08 — Installs run published images

Sunde asked for setup to be simpler still. Until now every install cloned the repo and
built both images on the server (`deploy.sh`: "the easy deploy path, no registry, no CI").
**This reverses the no-registry part:** the compose files run `ghcr.io/simplysunde/loskai`
and `loskai-caddy`, so an install is a folder, one downloaded compose file and
`docker compose up -d`, an update `docker compose pull`, and a Raspberry Pi gets an `arm64`
image instead of building one. **No CI still holds:** `make release` builds both images for
both platforms on Sunde's machine and pushes them — the smallest step, and moving it into
GitHub Actions later changes nothing for an install. Building from the source stays for
working on Loskai and for running unreleased code: `compose.build.yml` on top of any layout
(`make live`, `deploy.sh`), tagging the build like the release.

What it asked for besides: `data/` and `stacks/` made before the first start, since no
clone makes them any more and a folder Docker creates is root's (Loskai would run as root);
a `.env` that is optional (`deploy.sh` no longer insists on one); a health check, so
`docker compose ps` says when the app answers. A layout other than A is downloaded as
`compose.yml`, so the plain commands and a `compose.override.yml` work the same for all.

## 2026-11-08 — Caddy behaves the same in the LXC and in Docker, and needs no domain

Sunde's rule: Caddy works the same whether it runs in its LXC or in Docker beside Loskai,
and stays simple to set up and run. Two differences had crept in, found by checking the
docs against a real Caddy (2.11.4):

- **A restart lost every route in Docker.** The LXC's unit runs `caddy run --resume`; the
  Caddy image kept the stock command, so a restarted container came up from the Caddyfile
  alone — no routes until someone pressed Sync — while the docs said routes come back by
  themselves. The image's command now has `--resume` too. Considered instead: Loskai
  re-pushing routes when it sees them missing (no Caddy flag, the Caddyfile always read) —
  rejected, since Caddy and AdGuard never being written on their own is a rule here, and a
  write nobody asked for would hide a Caddy that lost its config. The cost, the same as the
  LXC's always was: while the save exists the Caddyfile isn't read, so a changed one takes
  effect once the save is removed (deployment.md says how).
- **Only Docker gave Caddy the domain.** The compose files passed `BASE_DOMAIN` to Caddy for
  a `*.{$BASE_DOMAIN}` site — one wildcard cert, a "Nothing is routed" page, and the
  `http://` redirect keyed on it — while the LXC fed it a `localhost` placeholder, so there
  each name got its own cert. Making the LXC take the domain too was the first fix; Sunde
  asked why Caddy needs it when Loskai's settings hold it, and the answer was that it
  doesn't. **This reverses** the `*.{$BASE_DOMAIN}` site (and the 2026-09-24 "Nothing is
  routed" page it answered with): the Caddyfile's `:443` site is now `localhost`, there only
  so Caddy has the server Loskai adds routes to; every routed name gets its own cert as its
  route lands; the `:80` redirect sends any host that isn't an IP address to HTTPS. The
  domain lives in one place, a new one needs nothing from Caddy, and no Caddyfile site can
  shadow a route again. Lost: the friendly page for a name with no route — a browser now
  stops at the TLS handshake. Dev runs the same Caddyfile; `dev/Caddyfile` went.

Proxied prefixes stay one label for now, though the wildcard cert that was the reason is
gone (TODO's backlog). A Caddy LXC made before this keeps its old Caddyfile and save until
it is made again; it works as before.

## 2026-11-06 — The logs are an admin's, on one page

Settings › Logs holds the sign-in log and the SSH log, which were on Users and SSH. Sunde
asked for one place, since a log is an admin's record of what happened. **This reverses**
an operator reading its own SSH entries in a machine's dialog (2026-11-04's review, below):
`GET /api/ssh/log` is admin-only now, and the per-user filter went. A machine's dialog keeps
its Log section for an admin — where you look when working on that machine.

## 2026-11-06 — Levels instead of tabs

**This reverses Phase 35's operators** (2026-11-02, below), who were given any set of the
Docker, Routing and Machines tabs. Sunde asked for levels, each adding to the ones below:
1 Routing, 2 Docker, 3 Machines, 4 Settings — the admin. Loskai is mostly one person's tool,
with perhaps a few people running a small network; for them trust is a ladder, and the sets
the ladder can't express were never really usable: Docker without Routing couldn't finish an
install (the wizard's last step makes a route), and a shell on the Docker host reaches Docker
anyway. So "routes are Routing's, even from Docker" stopped being a special case, and the
pages' "without Routing" branches went.

An account stores one number. One saved with tabs gets its highest tab's level, so no one
loses access; some gain. Levels keep people out of the wrong place, not out of the house:
Docker can start a container with root on the host, which `SECURITY.md` now says.

## 2026-11-06 — A sign-in log

The login backoff slows a guesser but left no trace: a wrong password was counted in memory
and forgotten. Sunde asked for a log. It is a file beside the SSH log, `data/logins.log`, in
the same format and trim — the writing and reading moved to `store` so both logs share it —
not Loskai's container output, which every deploy recreates, and not the SSH log, which is
about machines and which operators read their own of. An admin reads it in Settings › Users.

It records sign-ins as well as failures, so a run of wrong passwords followed by a sign-in
shows. A login turned away during a wait is not logged: a script hammering the login would
otherwise fill it in minutes. Only the login is logged — a wrong password at the SSH key's
unlock shares the backoff but not this log.

## 2026-11-05 — The sweep: each decision in one place (Phase 40)

Sunde asked how much a sweep of the whole project could simplify while keeping every function
as it is. Three read-only reviews — backend, frontend, tests and docs — found the code already
lean: about 5–7% could go. So the sweep aimed at the dozen decisions made in two or more
places, the pattern behind this project's worst bugs, rather than at size. Four bugs came out
of the reviews and were fixed first, each with a test that failed before; a fifth turned up
during the sweep.

- **A stack is matched to its containers by folder.** Compose lowercases a folder's name and
  drops its dots to make the project name, so `My.App` showed as down. The `working_dir`
  label was already the rule for recipes (CLAUDE.md); the stack list now follows it too.
- **A write that follows an await sets only its own fields** (`instances.update_fields`),
  under the store lock. An icon upload, a rename and AdGuard's reconcile each wrote back the
  whole record they had read, undoing a follower's re-point made meanwhile.
- **A failed action says so.** Routing's row failures went to an error shown only inside a
  closed dialog; the Docker tab ignored a compose run answering `ok: false`. Both now show
  above the table (`ActionError`), and a confirm dialog shows its own failure.
- **Escape in a Settings field saved what was typed.** `blur()` fires `onBlur` before the
  restored draft renders; the machine dialog's fields knew this and used a ref. Both use one
  hook now (`useAutoSave`).

What became one: the error-to-status translation (`LoskaiError`, one handler — 27 try/except
blocks went, and deleting a stack stopped answering 404 to every refusal); the two terminal
WebSockets' gate and relay (`shared/terminal.py` — CLAUDE.md had said to repeat all three
checks by hand); running on a machine with the main key (`connect._run`, five copies); `.env`
and the override (`dotenv.py`, `override.py`); a route's name and link scheme; the frontend's
queries (one hook and one type each), dialogs (`Overlay`), the unlock check and password
field, and the SSH login check — one copy of which took `1e3` as port 1000.

**Not done, on purpose:** merging the two route forms outright (little saved, ~700 lines of
tests rewritten — they share their lower half instead); pydantic for the recipe and tool
validators (authors would get worse messages); merging the LXC scripts (each runs alone
through curl, and can't be tested off Proxmox); one component for the primary buttons (their
padding differs between a header and a form on purpose). Left for Sunde: the pre-accounts
password migration, `deploy.sh`'s move from `/opt`, the unused `git_build` and
`registry_pull` recipe modes, and the code that reads the old encrypted key.

The docs: TODO.md had grown to 1,986 lines, mostly finished phases, and went to the archive;
three pages said four modules; `SECURITY.md` still said there were no accounts. `check-docs`
now reads every module count in CLAUDE.md and both READMEs, and every route against its row in
`api.md` — the kind of drift that had only ever been caught by a person reading.

## 2026-11-04 — An open page keeps the session, as Proxmox's does

Sunde asked whether a session could stay alive while the page is open, as Proxmox's does.
Proxmox's ticket lasts 2 hours, and its UI renews the ticket while open. Loskai was nearly
there already: every signed-in page polls `/api/health` every 30 s, and a request renews the
session. But the poll paused in a hidden tab, TanStack Query's default, so a background tab
was signed out after 2 hours. It now polls in the background too. A session therefore ends
2 hours after the last page closes.

**This walks back the same day's typing rule for terminals**, from the review fixes below.
A terminal had closed when nothing was typed in it for the idle time. Under this model it
lives as long as its page, and ends on a logout or its tab taken away.

The cost is that an unlocked computer with Loskai open stays signed in. The SSH key's unlock
still runs out after 15 minutes, so the machines still ask for a password.

## 2026-11-04 — Loskai's SSH key, kept simply (Phase 38) — walks back Phase 35's key slots

After the review, Sunde asked whether login and security should be redesigned now that how
Loskai is used is clearer, and then said: "I want to keep everything as simple as possible".
Accounts, sessions, roles, the Origin check and the access table stayed. They are the
conventional part, and the review found only slips there.

**The key slots went.** The key had been encrypted with a random key, sealed once per
account with its password, as LUKS does. It cost three of the review's eight faults, and it
left one open: an admin resetting a password while no one had the key unlocked dropped
that account's slot, and the last slot dropped lost the key. The guarantee bought with it
was narrow: a copy of `data/` without a password couldn't use the key.

**Now the key is an owner-only file**, like the status key and like a key in `~/.ssh`
without a passphrase. **Unlock stayed, as a password check**, so a stolen cookie still
doesn't reach a machine. Every account with Machines unlocks for itself. What a copy of
`data/` now gives is the key. The `from=` on each machine's line still limits it to the
Docker host.

Encrypting it with a secret kept outside `data/` was the other way. It was turned down: one
more thing to deploy and keep, for a backup of `data/` on its own. **An old, encrypted key
isn't moved.** Loskai isn't released, and the only install with one is Sunde's, with one
machine. Unlock says to make a New key.

## 2026-11-04 — A review of accounts (Phase 35), and what it changed

_Superseded in part the same day: the typing rule for terminals by "An open page keeps the
session", and the two key-slot fixes by Phase 38, which removed the slots (both above)._

A code review found eight faults in accounts and the key slots. Each was fixed with a test
that failed before. The choices worth keeping:

- **What keeps a terminal open is typing in it.** A terminal re-checked the cookie it was
  opened with. That copy is never renewed (the browser's is, by its requests), so a terminal
  in use closed at the idle time. Now it follows the account: a logout, a new password, the
  account removed, or its tab taken away closes it. So does nothing typed for the idle time.
  Output alone doesn't count: a terminal left showing a log is idle.
- **The key-encryption key is read before a password changes.** An admin setting their own
  password in Users ended their own unlock first. The key then looked locked, and their slot
  was dropped. On a one-admin install that was the key's last slot. Dropping the *last* slot
  when an admin resets someone's password with the key locked is still possible; it is in
  TODO.
- **A key from before accounts moves to slots at login**, and at a password change, not
  only at its first unlock. Changing the password first had left it encrypted with a
  password no one types any more.
- **The create endpoints check the record's own tab**, however they found the record. The
  check is inside `assign` (its `acting`), where the record is found by id, container or
  `origin`.
- **An operator reads only its own entries in the SSH log.** It was not made admin-only,
  because operators read it in a machine's dialog.
- **A `LOSKAI_USERNAME` that can't be a username stops startup**, after lowercasing.
  Skipping it would open first-run setup to whoever gets there first.

Left as they were: the one login backoff for all accounts (already open in TODO), and the
middleware reading `users.json` and `settings.json` on every request (only a cost).

## 2026-11-03 — Git as a tool, and tools that have settings (Phase 37)

Sunde asked for Git as a tool, where each machine's projects folder and its global git user
and email are set. Name and email aren't actions; they are values on the machine. So the
tool schema gained **settings**: a value, a command reading it and one writing it, the new
value reaching the write only as `$1`, checked against a kind, as a target is. That kept the
rule a tool file holds to: the browser names what to change and gives the value, and the
command comes from the file.

**How they are read** was Sunde's choice: with Loskai's main key, when the card is open.
The other way was the overview, read with the status key, which would always show them.
It was turned down because a new fact means a new status line, and every machine
installing again. The cost of this way: the values show only while the key is unlocked, and
the card asks for the password then. A write is checked by reading back, not by its exit
code.

**The projects folder moved** from General to the Git card. It is still Loskai's, on the
machine's record, and Claude Code still lists its projects there. Git requires git, so it is
an added tool, offered under Add tool where git is missing. Tried on the Debian test
container: the card asked for the password, read nothing set, set both, and `git config
--global --list` on the machine showed them.

## 2026-11-03 — A machine's name is its hostname

Sunde asked whether Name and Hostname in a machine's dialog weren't the same, and chose
to merge them. A machine's hostname is usually what the machine calls itself, and Loskai
never connects by it anyway: SSH goes to the address, and the hostname is only the SSH
config entry's `Host`. So a machine's record takes `name` from its hostname on every save,
and `POST /api/machines` no longer takes a `name`. What went: a label that differs from the
DNS name. A machine already labelled differently keeps that label until its next save.
Services keep both, because their name is what a dashboard card shows.

The merge also removed a bug. The dialog's Name field showed its saved tick, but editing
an existing machine never applied the name it sent. `assign` only set `name` on a new
record, so the field "saved" and changed nothing.

## 2026-11-03 — sudo's password in a dialog, for the actions that run by themselves (Phase 36)

Sunde asked for a password needed to go on to be asked for in a dialog that says why, so a
run could start and end by itself, and only for automatic commands. This walks back a line
written the day before: "Loskai never sees it", about the sudo prompt in the terminal. That
was true only loosely. What is typed in the browser's terminal already passes through
Loskai's WebSocket on its way to the machine; Loskai relayed it without reading it. A
dialog changes what Loskai does with it, not where it travels. Loskai now handles it once,
as it does a machine's password in Install it for me. So the rules are the same: it is used
for one run, checked before anything runs, held in memory a minute at most, and never
stored, logged or put in a command line.

**Which actions.** `automatic: true` in the tool file, opted into: an action that runs to
the end with nothing to read or answer. Status, Pull and Push stay as they were, because
their output is the point. A shell, an attach, Claude and Tailscale's Connect stay too,
because you work in them (Connect shows a login link). Adding a tool and the sudo rule
always run this way.

**Asked only when sudo would.** `POST …/run` works the run out as the terminal will, then
asks nothing for root, a command without `sudo`, the Update the rule covers, or a user
`sudo -n true` lets in. A wrong password is said in the dialog: `sudo -S -v` checks it over a
connection of its own before the terminal opens.

**How it reaches sudo** was the part to prove. The pty is opened with echo off (an SSH
terminal mode), so the first line, the password, can't show even if it arrives before the
command reads it. The command reads it into a shell variable, turns echo back on, and
pipes it to `sudo -S -v` in the run's tty. Every `sudo` after it in the run then finds
sudo's timestamp, so Update's two steps ask once. A tmux pane is another tty, so the
password goes there through a FIFO in a `mktemp -d` folder. Then the outer shell attaches,
and the folder is removed once the pane has read it. A session already running is
attached to, and the password is not sent. On Debian 13 (sudo 1.9.16, tmux 3.5) it worked
with and without tmux. It never appeared in what the terminal sent back, and the terminal
closed by itself.

**Success closes it.** The job ends at once with exit 0. A failure prints `[failed, exit
N]` and waits for Enter, and the dialog closes when the session ends.

## 2026-11-03 — A machine's SSH section: two switches and one login row

Sunde wanted the SSH section shorter, closer to a desktop settings window. SSH on and off is
now a switch on the section's heading. On means the machine has an entry in the SSH config.
Either way it opens a dialog first: turning it on asks for the user and port and says what
the setup will do next; turning it off is the old Remove confirmation. User and port share
one row, the user wider. Updates without a password is a switch too. Allow and Take it off
were already one action at a time, run in the terminal, so the switch only starts that
action. It moves when the overview reads the rule back, never before. Where the machine
doesn't show its sudoers folder ("can't tell"), the switch shows off and only allows. Its
rule still comes off when SSH is turned off or the machine is deleted.

## 2026-11-03 — The Docker host is on the Machines tab before it is named

Sunde asked for the machine Loskai runs on to show up by itself, "kinda like what we do
with dockers": a fresh install is on Routing before it has a URL. So the Docker host is a
row read from `host_ip` each time, and stored nowhere. Its routes (those on its address) are
under it, and its one action is **Name it**, the usual Name a machine with the address
filled in. Creating the record by itself was turned down. Loskai would have had to choose a
name and write a DNS rewrite on its own, and a deleted one would come straight back. Until
it is named it has no SSH, tools or dialog, because each of those hangs off the name: the
SSH config's `Host`. With no `host_ip` set there is no row: a bridged Loskai can't find its
host's address by itself.

## 2026-11-02 — Accounts: an admin, and operators limited to tabs (Phase 35)

_Its key slots — the SSH key sealed per account — were walked back two days later by Phase
38, and its operators, given any set of tabs, became levels on 2026-11-06 ("Levels instead
of tabs") — both above; the accounts themselves stand._

**This reverses "one password, no accounts"** (2026-08, and architecture.md's access section
until now). That was right while one person ran Loskai: logout could end every session by
replacing the signing secret, and the SSH key could be encrypted with *the* password. After
comparing Loskai's security with Proxmox's, Sunde asked for separate users and a session that
ends when idle, with a first-run setup that creates the admin account, as most self-hosted
services do.

**Roles.** A viewer role was planned and dropped — "a viewer is in essence a public user": the
Dashboard is that. What is left: an **admin** for everything, and an **operator** given tabs,
able to do everything in those — "lock them to routing or docker or machines" — and nothing
else. Routes stay the Routing tab's, even from the installer or a machine's row, so one tab
owns every route change. The rule lives once, `shared/access.py`, a line per API route; the
default is admin, and a test lists every route so a new one can't be reachable by an
operator by accident.

**Sessions** now name an account and a *generation*. Logout, a new password, or the account
removed bumps it, ending that user's sessions on every device and no one else's — the
per-user form of what replacing the secret did. They end after 2 idle hours (a setting) and
renew while used, as Proxmox's ticket does; the old 7-day cookie outlived a lost laptop.

**The SSH key got key slots**, because "encrypted with the admin password" had no answer for
a second person with the Machines tab: give them the admin's password, or store the key in
the clear. Instead a random key encrypts it, sealed once per account with its own password
(scrypt, AES-GCM), LUKS-style — a `data/` copy is still useless without a password, each
user unlocks for themselves like `sudo`, and their logout locks only theirs. A slot can only
be made while the random key is at hand, which is why an account added while the key is
locked gets its slot later: the first time it unlocks while someone else has it unlocked.

**Upgrading**: the old hash in `settings.json` becomes the account `admin` and leaves
`settings.json`; the old key, encrypted with that password, moves to slots at its first
unlock. Checked live: an install with only the old hash logged in as `admin`, and in
Chromium a first-run admin added an operator with Docker, who then saw only Docker, was told
at `/routing` that the account lacks that tab, and got `403` with the reason from the API.

## 2026-11-02 — How long the SSH key stays unlocked is a setting

Fifteen minutes meant typing the admin password again and again through an evening's work,
and Sunde asked for at least three hours, or a setting. A setting (`ssh_unlock_minutes`,
Settings › SSH, and `SSH_UNLOCK_MINUTES`) with fixed choices — 15 minutes, 1, 3, 8, 24
hours — rather than a number: each is a deliberate step, and validation is a lookup. The
default stays 15: the unlock is what keeps a stolen session cookie from reaching the
machines, and each hour longer is an hour it would. Logout still locks it at once. A change
applies from the next unlock; the prompts name the chosen length rather than "15 minutes".

## 2026-11-02 — Updates without a password: a sudo rule, not a stored password

Sunde asked whether the password typed when setting SSH up could be kept, so System's
Update could run without anyone at the terminal. It can't — that password is used once and
kept nowhere, and storing a password that is root on every machine would make Loskai the
thing to steal. Three ways were weighed: a stored password (no), logging in as root (only
where it is already normal — Proxmox), and a **sudo rule on the machine** — chosen. The
machine enforces it, as `authorized_keys` does Loskai's key.

The rule (`/etc/sudoers.d/loskai`) names the user and exactly System's update steps for its
package manager, read from `system.yml` (`tool.update_commands`) so the rule and the button
can't disagree, plus `rm -f` of itself — which is what lets Loskai take it off later with no
password. It is written in the machine's terminal: the user types the password at sudo's
prompt, so Loskai never sees it; `visudo -cf` checks it beside the real one, under a name
with a dot that sudo skips, before `mv` puts it in place; then `sudo -k` and `sudo -n -l`
prove sudo reads it. Sunde chose **update only** — reboot and the rest still ask.

**It comes off with the machine or its SSH connection.** `UNINSTALL_SCRIPT` takes the rule
off first, while Loskai's key still gets in, then the key lines; a rule that won't go is a
warning. Removing a machine's SSH connection now does what deleting it does — key and rule
off, with the admin password when the key is locked — where before it left the key on the
machine. The overview reports the rule (status line v5), so each machine installs again once.

Live, against a Debian container whose sudo asks for a password, through the browser: the
rule written by typing the password in the terminal, then `apt-get update` and
`dist-upgrade` ran with no prompt while `apt-get install`, `reboot` and another `rm` still
asked; Remove took the rule and Loskai's two lines off and left the user's own.

**Tailscale's operator, tried and dropped.** The plan was for adding Tailscale to also run
`tailscale set --operator=<user>`, so Connect and Disconnect wouldn't need sudo. On
Tailscale 1.104 in the same container the operator could `tailscale set`, but `up` was
refused ("login access denied") and `down` too ("prefs write access denied"). That node had
never logged in, which may matter, but without a tailnet to log in to it couldn't be shown
to work — so Connect and Disconnect still use sudo.

## 2026-11-02 — A machine opens as a dialog, laid out like a settings window

Sunde asked for the cog on a machine's row to behave like Claude Desktop's settings: a
window with categories down the side, a search, and one row per setting — its name and a
line on what it does, its control on the right. The machine's page became that dialog,
over the Machines list at `/machines/<id>/<category>` so every link into it still lands
(naming a machine, a tool's Settings and Install again). Its categories: General and SSH,
then Overview, Tools and Running, then Log.

**Fields save themselves** (`InlineText`, on Enter or leaving it), replacing the Edit form,
and each posts only its own change. That also settles the bug fixed the same day (a save
deleting an SSH entry with no `User`): an address change never carries SSH. Removing the
SSH entry, which an emptied user field used to mean, is its own confirmed button — an
empty field now says to use it. Naming a machine keeps its form (`AddMachineModal`, now
naming only), since a new one needs both fields before anything can be saved.

**Then, the same day: one scroll, and Overview into General.** Sunde wanted to scroll
through every section rather than see one at a time, with the side menu for getting
around — so the sections stack in one pane, the menu scrolls to one, and its mark follows
the scroll (the last section whose top has passed, or the last at the end). Overview had
nothing to set and sat apart from what it describes, so it moved under General, beneath
the fields. The search now narrows the sections as well as the menu.

The machine's display name, fixed at its hostname when named, can now be changed — the
endpoint always took it. `ProjectsFolder` went: the folder is a General row.

## 2026-11-02 — A rename onto a name with its own SSH entry is refused

`rename_host` rewrote `Host nas` to `Host nas2` even when a hand-written `Host nas2` existed,
leaving two entries; ssh takes the first, so Loskai could connect with the wrong user, edit
the wrong block, and on delete remove only one. Merging would mean deleting one of the two,
and either could be the one written by hand — so `POST /api/machines` refuses with `409`
before anything is saved, and the user picks. A machine with no entry of its own still
takes over the one its new name has, as naming a machine does.

## 2026-11-02 — Editing a machine says nothing about SSH unless its fields were edited

A review found the machine form deleting SSH config entries. It compared the user field
with the entry, and an empty field beside an entry meant "remove it" — but an entry with no
`User` line (it inherits one from `Host *`) opens empty, so changing only the address
deleted the whole block, `IdentityFile` and `ProxyJump` with it; so did opening the form
before the config had loaded. Now the save carries `ssh` only once the SSH fields are
touched — set, or cleared to remove — and otherwise leaves the entry to the backend's keep
path, which only follows a rename or move. The fields show the entry until then, however
late it arrives.

## 2026-11-02 — A service target can't start with `-`

A review found the `service` kind was the one target allowed to begin with `-`, so a target
like `-Hroot@10.0.0.9` reached `sudo systemctl restart "$1"` as an option — acting on another
host — though quoting kept it from being code. Every kind now starts with a letter or digit
(a session also `_`); `tool.TARGETS` is the one place that says so.

## 2026-11-01 — The terminal takes what a program copies (OSC 52)

**Root cause: Loskai's terminal dropped OSC 52.** Sunde couldn't get Claude Code's `/login`
URL out of a codebox terminal: `c` said "copied to tmux buffer", Ctrl+Shift+C did nothing,
and a mouse drag went to the program. Programs copy by sending OSC 52 to the terminal — Claude
Code inside tmux runs `tmux load-buffer -w`, and tmux, on its defaults (`set-clipboard
external`, `terminal-features` `xterm*:clipboard`, and Loskai's pty is `xterm-256color`),
passes it on as OSC 52. A probe confirmed tmux sent it, the 474-character URL whole. xterm.js
implements no OSC 52 by itself, and nothing registered a handler, so it vanished. **No tmux
change was needed**; the fix is the terminal's: `decodeOsc52` and a handler in `XtermSession`.

**Why it works over plain HTTP too:** the keypress that copied is still a user gesture when
the sequence arrives, so `copyText`'s `execCommand` fallback is allowed — checked in a real
browser by IP. Where a browser refuses anyway, a **Copy N characters** button copies it on the
next click. Reading the clipboard (`?`) is never answered: a machine could otherwise read
what you copied elsewhere.

**Ctrl+Shift+C "did nothing"** because the highlight was Claude Code's, not xterm's selection
— and with nothing selected it copied an empty string over the clipboard. It now leaves the
clipboard alone. **Shift+drag** already selected past a program's mouse capture (xterm.js
does it); the keyboard hint now says so. A selection of a URL that wraps inside tmux can
still pick up line breaks — tmux draws each row separately — which is why the program's own
copy is the way for long URLs.

## 2026-11-01 — Deleting a machine takes Loskai's key off it

**Always, not a choice** (Sunde: "can't we delete the keys the first time around?"). Until
now a delete forgot the machine on Loskai's side only — its config entry and host key — and
left both `authorized_keys` lines on it: access nobody would expect to outlive the machine
in Loskai. Nothing is lost by taking them: there is one key for every machine, and adding
the machine again installs the same lines with its password. The removal is the install's
own filter (the lines ending ` loskai` and ` loskai-status`), so nothing else in the file is
touched.

**The key comes off last but one** — after Caddy's step, before the record. Found live: taking
it off first, then failing at Caddy (which is required and can fail), left a machine in
Loskai with no key on it. So the lock is checked before anything changes, the machine's
SSH target is read then too (the unassign clears the name its config entry is found by),
and the lines come off only once nothing can stop the delete.

**A locked key stops the delete; an unreachable machine doesn't.** Locked, the dialog asks for
the admin password and nothing is deleted until the lines can go; unreachable, there is
nothing more Loskai can do, so the delete goes ahead and the page says the lines are still
there. **Found on the way:** a failed delete on the Machines tab was shown nowhere — its error
went into a state only the naming and route dialogs display. It now shows in the dialog.

## 2026-11-01 — Status line v4: the tailnet, and commits not pushed

**Tailscale's card lists the tailnet** (Sunde, asked whether the dialog would show `tailscale
status` by itself: "sure"). It is read with the status key like the rest of the overview —
`tailscale status` needs no root and only reads — rather than run in a terminal on opening:
a terminal needs the main key unlocked, and the dialog shouldn't. **"N to push"**, left out
of 34h′ to spare a reinstall, rode along in the same version, so each machine installs its
line once for both. It counts against the upstream as of the last fetch: the status key
never fetches, so a commit made elsewhere isn't known until a Pull.

## 2026-11-01 — The Tools menu on the machine's row; Claude's sessions on their projects

**The Tools button is on the machine's row in the Machines tab** (Sunde: "tools should have
one button, and then a submenu or dropdown to access the interface of each tool"). It was
first put on the machine page, with the cards moved off it to a page per tool — a
misreading, reverted the same day ("I meant that the tool button should be here… I did like
the overview for each tool that was on the machine config page"). Then the tool pages went
too: the menu says how each tool stands and opens it **in a dialog** (Sunde: "a small
summary of each tool's status… instead of opening up a new view, a dialog which shows what
is needed for each tool"). The machine page keeps a card per tool. The menu reads the
machine's overview only while it is open: the Machines tab doesn't ask for it otherwise,
since it costs a package-manager simulation on the machine. Standard or added isn't a new
key: a tool requiring a program Loskai can install is an added one. The menu is `RowMenu`
with a labelled trigger, not a second dropdown.

**The projects folder is a machine setting**, on the machine page beside its connection,
not on Claude Code's card (Sunde: "setting projects location should be done in the machine
configs… we can add a shortcut to settings though") — the dialog says where the projects are,
and has a **Settings** button to the machine's page ("I would rather have a settings button
with the cog here"). **Needs** shows only where a tool isn't added yet: for one
that is, it said nothing new.

**A tmux session belongs to the tool that names it** (Sunde: "we need to separate regular
tmux sessions and usage and claude code usage"). `claude-site` is listed on Claude Code's
page as the project `site` running, and left off tmux's; the rule is the action's shared
`session`, so nothing is stored. Loskai's own `loskai-…` sessions stay on tmux's page: an
update left running is picked up there.

**A project's quick commands** — Pull (`--ff-only`, so a diverged branch stops and says so
rather than merging), Push, Terminal, End. "N to push" was considered and left out: it
needs another status-line version, and what changed elsewhere can't be known without a
fetch, which the read-only line doesn't do — Pull fetches.

## 2026-11-01 — Phase 34h: Claude Code in the machine's projects

**A project is a git repo in the machine's projects folder** (Sunde: "a clever way of using
git to keep track of projects made on the computer so I can restart a session or start a
new session"). Git already knows what a project is and what state it is in, so Loskai keeps
no list of its own: the status line reads branch, uncommitted changes and the last commit;
when Claude last worked there comes from Claude Code's own folder of conversations.

**The folder is a default, changeable per machine** (Sunde: "a default one, that can easily
be overwritten per machine") — `~/projects`, or `~` or one folder in it: as deep as the
status line looks. A deeper or outside folder was not offered, because the forced command
can't take it as input (it never runs what it is sent), so it would have to scan the whole
disk instead. Stored on the machine's record — the one thing tools store.

**One Claude per project, in tmux `claude-<project>`** — opening a project attaches when it
runs, else continues the last conversation, else starts one; always with Remote Control, so
it carries on from the app. Starting a second Claude in the same folder is what the
terminal is for. `--continue` is only used where Claude Code has conversations for the
folder, since it fails without one.

## 2026-11-01 — Phase 34g: tmux and Tailscale; status line v3

**One status-line version for 34g and 34h** — `tailscale` and `curl` detected, the
Tailscale address, and the projects that 34h lists — so a machine reinstalls its line once
for both. `parse_facts` reads only the current version: a page on v2 says "install again"
rather than showing an overview whose tools would be wrong (Tailscale offered to a machine
that has it).

**A typed name is a target** (`ask`). New session, and 34h's New project, act on something
that doesn't exist yet; the name is checked against the same pattern a row's target would
be and passed as `$1`, so typing can't change what runs. A free command line was the
alternative and was not taken: it is what the terminal is for.

**An action says which tmux session it runs in** (`session`): Loskai's own by default; a
shared name, so 34h's Claude actions on a project all land in `claude-<project>`; or none,
for attaching to a session — tmux inside tmux is never what was meant.

**The projects are read without the shell seeing their text.** The forced command can't
quote (no double quotes in `command="…"`), so paths with any unusual character are
skipped, and each row is printed by `git log --format` itself. A test commits a subject of
`* | $(touch pwned)` and checks it comes back verbatim and nothing was created.

## 2026-11-01 — Phase 34f′: plugins become tools, found from what the machine has

**Nothing is enabled any more.** Sunde, on System, Services and Proxmox: "these I would say
are standard features that are autodetected" — what was meant by plugins was workflow
tools (tmux, Claude Code sessions, projects in git, Tailscale), "we can simply keep the
tool terms". So the per-machine enabled list, its endpoint and the Enable buttons went: a
tool **applies** where the machine has every program it requires, as its overview found
them. That is the same answer an enable switch would have needed a second place to keep,
and it can't drift. **Adding** a tool is installing what it lacks — the switch is the
install.

**How to get a program is in one place** (`tool.INSTALLERS`), not in each file: tmux was
about to be installed by both the tmux tool and the Claude Code one. A tool lacking several
programs installs them in one go — the packages in one command, then each script.

**"Tools" for the files, "programs" for what a machine has** (`logic.PROGRAMS`, the
overview's `programs`; its section is still `#=tools`, since renaming a marker would mean
a status-line version for nothing).

## 2026-11-01 — Phase 34f: plugins are data, and run where they can be seen

_Its enabled plugins were walked back the same day: tools are found from what the machine
has, nothing enabled (Phase 34f′, above)._

**A plugin is a file, not code** (Sunde: plugins "we install and enable based on needs,
kinda like the recipes, although… tied to the image"). Code plugins would have run inside
Loskai with its keys; a file only says what to run on the machine. The browser names a
plugin, an action and a row's target — the command is worked out on the server from the
file, and the target is checked against its kind and passed as `$1`, so nothing typed into
a request becomes code. That also keeps the log exact: each run is a fixed command.

**Actions run in the machine's terminal, not in the background.** A `sudo` prompt is then
just answered there (Loskai never holds a machine password), the output is seen as it
happens, and a failure says its exit status. Inside tmux when the machine has it: an update
must not die because a tab was closed, and clicking it again attaches to the same session
instead of starting a second `apt` beside the first.

**`target:`, not `on:`** — YAML 1.1 reads `on` as `true`; the validator caught it on the
first run, as a key that wasn't a string.

**A missing tool is installed from the plugin's own file** (Sunde: "the ability to install
dependencies if missing, when enabling a plugin"): a package per package manager, or an
official installer's command, run in the terminal like any action. None of the first three
plugins needs one — tmux (34g) will be the first.

## 2026-11-01 — Phase 34e: the overview, a second request to the status key

**One forced command, two requests.** The overview (system, memory, disks, updates waiting,
tools, tmux sessions) is read with the status key, so it needs no password — but counting
updates runs the package manager's simulation (~0.5 s), too much for every machine every
30 s on the Machines tab. The forced command now reads `$SSH_ORIGINAL_COMMAND`, only to
pick between two fixed answers in a `case` — it never runs it — so the page asks for
`facts` and the tab for `running`. A second key per machine was the alternative; one line
to install is simpler.

**The status line has a version** (`#loskai-status 2`), and an older line keeps working for
what it can answer: v1 machines keep their running list, and only the overview asks for
the reinstall. Sunde asked for the docs to make iterating easy, so the command's contract —
requests, sections, rules, versions, and the steps to add a fact — is its own reference
page, `ssh-status.md`.

## 2026-11-01 — Machines: the SSH key row goes; a cog on each machine

**The key row on the Machines tab showed a line that could be wrong.** It was built before
SSH setup moved onto each machine, and showed the general `from=` line. The Docker host
needs its own (`from=` also names Loskai's network), so copying from the row would have
locked Loskai out of it. Each machine's setup already shows that machine's lines, so the
row's line and Copy button went rather than being fixed. Sunde had found the row unclear.

**What only it did moved to Settings › SSH**, a page of its own: the key by its fingerprint
and New key, the SSH config download (from General › Backup) and the log, shown on the
page. The rule for the split: Settings holds what is the same for every machine, the cog
what belongs to one. Considered and left out to keep it small: a second table of the
machines (the Machines tab is that), the status key (an internal detail), Lock now and
Test all.

**A machine's SSH settings are behind a cog on its row** (Sunde's suggestion). The terminal
button had doubled as the setup button until a machine was set up; now each button does one
thing. The cog is amber until the machine is set up, and the terminal button appears then.
The terminal's own "SSH setup" link went with it.

**Then the cog became the machine's page** (`/machines/<id>`), because one machine is
where updates, services and quick commands will go (Sunde: "tweak and configure per
machine… based on the machine and OS"), and a dialog would not hold them. It reuses what
exists rather than a second version: the same machine form (the row's pencil went — Edit is
on the page), the same SSH setup, the hover card's list, the log filtered to the machine.
Naming a machine opens its page, where its SSH setup starts. Sections are stacked, no tabs,
to stay simple.

## 2026-10-31 — Phase 34d: a terminal on each machine; sessions logged, not keystrokes

**The plan said "every session and command logged"; only sessions are.** A command typed
into a pty is a stream of keystrokes, and among them can be a password typed at a `sudo`
prompt — a keystroke log would be a password log. The log records each terminal opened,
closed or refused, and each install. Prepared commands (34e) are fixed strings, so they can
be logged as commands without that risk.

**The unlock gates opening a terminal, not keeping one.** A shell closing itself 15 minutes
after the password would make the terminal useless for anything long; logout still ends it,
like the container terminal, and closing it hangs up the pty, so nothing is left running.

**Copy and paste follow the common terminal convention** (Sunde asked for both, and Tab
completion): Ctrl+Shift+C copies, Ctrl+C copies only while text is selected and interrupts
otherwise, Ctrl+V and Ctrl+Shift+V paste. Paste goes through the browser's own paste event
rather than the Clipboard API, which exists only over HTTPS — Loskai is often reached over
plain HTTP. Tab needed nothing: it reaches the remote shell, which completes.

**Asking about Tab found an old bug.** The container terminal ran
`exec /bin/bash 2>/dev/null || exec /bin/sh`. Sending bash's stderr to `/dev/null` made it
non-interactive — bash is interactive only when stdin *and stderr* are terminals — so since
Phase 8 it showed no prompt, did no Tab completion, and printed no error message. The shell
is now chosen before `exec`, which also fixes images without bash.

## 2026-10-31 — SSH set up when a machine is named; a status-only key

Sunde wanted SSH set up as part of creating a machine, and every machine to show what runs
on it. **The machine's password is used once, never stored**: Install it for me logs in with
it to add Loskai's lines, then proves the key works. The host key is trusted first, so the
password only ever goes to the machine whose fingerprint was accepted. A copy-the-line path
stays for machines with password login off.

**The status needed a second key.** The main key is unlocked only for 15 minutes after the
admin password (2026-10-28), so a status kept current in the background would have had to
undo that — or show stale data after every restart. Instead a status-only key, unencrypted,
is limited **by the machine**: `restrict`, `from=` the Docker host, and a forced command that
only lists what runs. The main key's guarantees are unchanged; a stolen status key reveals
the running list. Rejected: refreshing only while unlocked (blank after every restart).

**"Running" hides the base system** — a plain Debian runs ~20 services nobody asked about —
and counts what it hid. Checked on request with a 30 s cache rather than in a loop, so there
is still one background task.

## 2026-10-31 — A route is on a machine by its address; the link is gone

With the Machines tab about to become a counterpart of the Docker tab, Sunde asked to drop
"the locking to a machine" and let a route see which machine it is on from its IP. That
**walks back 2026-10-08**, where a route on a machine's address was only *matched*, display
only, and kept its old address when the machine moved — chosen then so that a route typed
by hand would never quietly start moving with a machine. Under the new model that is the
point: a route on that IP *is* on that machine. The alternative Sunde first sketched — keep
the link, set it only for routes made from a machine's row — was turned down because two
routes on one address would then behave differently on a move depending on which tab made
them, invisibly: the defect Phase 30b's Machine/Address toggle was built to expose. A
container's link is different in kind — a container has a name apart from its address — so
`container` stays.

What went: the `machine` field (old records load and lose it on their next write — every
linked route's upstream already held its machine's address, so nothing is lost),
`list_by_machine`, `validate_machine`, the Machine/Address toggle in the route form, linking
and unlinking in Change URL, the chain and wand icons, `relinked` (now `moved`) and the
delete's `unlinked`. What came: moving a machine carries **every** route on its old address,
except one following its container (its address is the container's, and the follower would
only write it back); and **two machines can't share an address** (`409`), which nothing
stopped before and the IP must now decide. To restore the link, the code is in the commits
of 2026-10-05 to 2026-10-08 (Phases 21b–30d).

## 2026-10-30 — Phase 34a: the key and the config file

SSH became a fifth backend module, `modules/ssh/` — the machines are its external system, as
Caddy is Caddy's. **The public key is read from the private key file**, not kept beside it:
two files written one after the other could disagree after a failed write, showing a line
that no private key matches, and the OpenSSH format keeps the public half in the clear. **A
wrong password at the key endpoint is `403`, not `401`**: the frontend treats any `401` as
"signed out" and goes to `/login`. The check is the login's own (`auth.check_password`), so
the backoff counts guesses made there too — a stolen cookie can't guess through it. **A
machine's SSH details are a field of its save, not a second request**, so a rename or a move
reaches its entry in the same call; a save that leaves `ssh` out changes only what followed.

## 2026-10-30 — Phase 34: Machines over SSH, planned in five steps

Sunde took the recommendations: **asyncssh** rather than the `ssh` binary, and a machine's SSH
details kept **only in the config file**, edited from the machine's form. Two parts of the
earlier design got simpler in the planning. The export no longer rewrites `IdentityFile` to a
path in a new setting: Loskai's config names no key at all, because Loskai hands its key to
each connection itself, so the exported file works with the user's own keys as it is. And
the key is no longer unlocked at login: entering the password for an SSH action unlocks it
for 15 minutes, so the re-check and the unlock are one step, and a session cookie alone never
reaches a machine.

## 2026-10-28 — Closing the gaps before Loskai holds SSH keys

Asked how SSH keys in Loskai would be kept safe, the first answer was that the gate in front
of them had holes already, and those come first. **Sibling apps could act as the admin**:
`SameSite=Lax` stops other sites, but every app under the base domain is the same site, so
the browser attached Loskai's cookie to their requests, and nothing checked where a request
came from. A live test proved it — a page on `evil.smoke.test` opened the terminal on
`loskai.smoke.test` and created a file as root in a container. Every state-changing request
and the terminal WebSocket now need an `Origin` matching the address they were sent to;
none at all still passes, because only a browser page is the threat and browsers always send
one. The dev proxy keeps the page's `Host` (`changeOrigin: false`) so the two still match.

**Log out now ends the session, not just the browser's copy.** The cookie is signed, not
stored, so logging out used to leave a copied cookie valid for its full 7 days. Logout
replaces the signing secret instead, which ends every session on every device: revoking one
would mean storing sessions, and with one admin password all of them are the same person's.
Only a signed-in logout does it — `/api/logout` is public, and anyone could otherwise sign
the admin out. **The review that followed found this had opened a worse hole:** the secret was
rewritten in place, truncate then write, so a logout cut short (disk full, a crash) left it
empty — and itsdangerous signs with an empty key, so anyone could have made an admin cookie.
It is now replaced whole (temp file, fsync, rename), and an empty secret counts as none.
It also found that an open terminal outlived the logout — the cookie was checked only at
connect — so a terminal now re-checks it every 5 s. Making that close work showed the
terminal's reading thread never ended: a `recv` blocked in a thread survives `close()`, so
the socket is shut down first.

**Wrong passwords now cost time.** Argon2 made each guess slow, but nothing limited how many
a LAN client could make. After 5, each wrong password starts a wait that doubles from 2 s
to a minute. The counter is global, not per IP, because behind Caddy every request has
Caddy's address — so an attacker can delay the admin by up to a minute at a time, the price
of a guesser getting about one try a minute. (Wrong, the review found: a script guessing the
moment each wait ends keeps the admin out for as long as it runs. The docs now say so, and
counting per client is an open decision. The count also never expired, so a guesser who
stopped made the admin's next typo, days later, cost a minute; 15 quiet minutes now reset it.)

**The cookie is `Secure` when it was set over HTTPS.** It was never marked, by a comment's
"revisit when deployment lands" — so a browser would send it over plain HTTP, to a
`scheme: both` route's `:80` twin for one. Loskai can't see TLS (Caddy ends it), so it reads
Caddy's `X-Forwarded-Proto`, checked live to be `https`. The header can be forged, but a
forged one only gives the sender's own browser a cookie it won't send back over HTTP.

**Then the SSH design itself, assuming each layer can fail** (`architecture.md`, Machines):
the key encrypted with the admin password and unlocked only in memory at login; the
password asked again before SSH actions, so a stolen cookie doesn't reach the machines;
`from="<Docker host IP>"` on the key, so a copy is useless elsewhere; a dedicated `loskai`
user whose `sudo` the owner sets per machine; one-button rotation; and a log of every
session and command. That settles the earlier open question of which user Loskai logs in
as. A second login factor is left for later.

## 2026-10-23 — Machines will hold SSH keys

**Sunde chose to keep the SSH keys in Loskai**: it "would in practise allow us to manage the
machines and update them quickly, search for other docker or services running on those
machines and quickly administrate them" — the Proxmox UI "feels a bit restrictive or slow
compared to if we build something ourself with quick and prebuild commands". That is the
largest change to Loskai's security model since the Docker socket: a compromised Loskai
would hold the key to every machine it manages. So the safeguards are part of the decision,
recorded in `architecture.md` before any code: Loskai's **own** key pair (revocable per
machine, never the user's key, never in an export), its own `known_hosts` with host keys
checked, secrets owner-only, the terminal checking the session itself, and `SECURITY.md`
and CLAUDE.md's secrets rule changing in the commit that adds the key. Not built.

## 2026-10-23 — PLAN.md becomes architecture.md, around three components

PLAN.md (1,483 lines) had been written as the plan and amended phase by phase. Much of it
was copies — the compose file (with a `ghcr.io/youruser` image that never existed), the
Dockerfile, `.env.example`, the settings table, Caddy install steps — and some was plan
that was never built: per-container CPU graphs, a container event log, a raw Caddy config
view, a test-tier rig and CI. The xcaddy build instructions only served the deleted ACME
mode. It is now `docs/project/architecture.md` (556 lines): copies replaced by links, and
the plan by what runs.

**Sunde: Loskai "has mostly became a 3 part component system, with routing, docker and
machine"; WireGuard "is really just dedicated to a quick link in settings."** So the
document is organised by those three components — each with what it's for, how it works,
its decisions, what it doesn't do, and where its code is — with the Dashboard, Settings,
WireGuard, health and backup as supporting pieces. The backend's four modules stay as they
are: they are one per external system, an integration boundary, while the components are
product boundaries. Both are stated, so neither is mistaken for the other.

**The Machines tab's direction is recorded: "a sort of ssh connection manager"**, its hosts a
real SSH config file edited in place rather than a store of Loskai's own — the same rule as
the stacks folder. **Sunde: the config lives "inside the container, with a export option in
the settings"** — Loskai's own, in `data/`, exported for the SSH client on one's own
computer; a config Loskai could only reach by mounting it (the Docker host's) would serve
nobody's laptop. Open, to settle before any code: where private keys live — an in-browser session means Loskai holds a key to every machine, the largest change
to its security model since the Docker socket. PLAN's other future ideas moved to the TODO
backlog; the Tailscale one was dropped, WireGuard being only a link now.

## 2026-10-23 — CLAUDE.md describes Loskai as it is

CLAUDE.md had grown one phase at a time: a status section that was a phase log, "(was
`/opt/stacks`)"-style notes beside current facts, and test counts no check verified. Asked
whether it would be better based on the current state, it was rewritten that way — what
Loskai is, the principles, a code map (new), commands and checks, the architecture, the
invariants grouped by area. Every rule in the old file was checked present in the new one;
what was cut is history already recorded here or in `todo-archive.md`. The principles and
two routines (`npm run build` typechecks the tests; test isolation) came from Claude's
session memory, so every session — and any contributor's — reads them, not only Sunde's.
Test counts are no longer written down: they went stale with every commit.

## 2026-10-23 — The migration guide is for someone new to Loskai

**Sunde: the migration is "more about moving other containers into loskai, if someone
suddenly found the service and wants to use it."** The guide was written for tidying one's
own server — move a compose folder in — and told a `docker run` container to stay where it
was, which is the wrong answer for someone switching to Loskai. It now starts from what a
newcomer has, three ways in, the recipe first: copy the data to where the recipe keeps it in
`stacks/<id>/`, then install. That path needed no code — `claim_dir` already takes over a
folder with data and no compose file, and the install already takes over a route of its
name once the old container is removed (`_instance_slot`) — it just wasn't written down.
Keeping one's own compose file under a recipe's name is described with its catch: an update
replaces it, and a different data layout then starts the app with its data unmounted.

The guide also said to rename `docker-compose.yml` to `compose.yml`, which was never needed:
all four names are found. Two messages assumed the stack had been installed by Loskai
("left by an earlier install", "Installed before updates were tracked") and now don't. The
Docker tab's **Other containers** heading links the guide — the first link from the app to
its docs, so the repo's address now lives in one more place, listed for the publishing step.
A hint on a container a recipe exists for is in the backlog, not built.

## 2026-10-21 — A second review: the icon lookup, and the form's read-back

A review of the same work found more, mostly in the icon lookup added the day before. **It
read the compose project name as the stack's folder name**, but Compose makes the name by
lowercasing the folder and dropping dots: `stacks/Home.Assistant` runs as `homeassistant`
and was never found, while a project of the same name started from a folder elsewhere was.
It now reads the `working_dir` label compose writes, and wants it in `STACKS_DIR`. It also
gave the icon to whichever container was routed — a recipe's database included — where the
install only ever gives it to the primary one (`logic.primary_container`); now it asks the
same question.

The step ran after Caddy had the route, and caught only Docker's errors: anything else (a
recipe file that isn't UTF-8) turned a route that was already live into a `500` with no DNS
rewrite. It is best-effort in fact now, and it writes only the icon, under the store lock
(`instances.give_icon`) — writing back the whole record would undo the follower re-pointing
it during the lookup. The route tests had also started asking the developer's own Docker
daemon for labels; `conftest.py` stubs that now.

The form's read-back after a Save had a hole of its own: a read that failed set an error
the form only shows before it has loaded, so Save went grey again with nothing said — the
bug the read-back was there to fix. It is shown beside Save now, and the read happens only
when `up` failed and the dialog stays open. Smaller: an option replaced a service entry that
isn't a mapping (`app: []`) instead of refusing it, a sync after a rewritten history pulled
the new head's whole history into a depth-1 cache, and a Save scanned every recipe source
twice.

## 2026-10-21 — A review of the stack form and options

Asked whether anything had been overlooked, a read of Phases 31–33 found three bugs the
suite didn't. **The worst failed as a success** — the project's recurring shape: a folder
added for a service the override named with nothing under it (`jellyfin:`, which YAML loads
as None) was skipped by `build_override`, so Save said it worked and the folder never
existed. A stack matched to a recipe only by name was offered options for a service it
might not have. And the form never re-read the files after a Save, so when `up` failed —
a GPU the host doesn't have — undoing the change compared equal to the stale form and
couldn't be saved: the very recovery the troubleshooting page tells users to do. The form
now reloads after writing, and the text it carried over counts as saved.

Left as they are, deliberately: an update replaces `compose.yml` without a backup (the
dialog shows the diff and warns for a hand-edited or untracked file), and turning an option
off removes its lines even if the user had typed the same ones by hand — whether it is on is
read from the file, by design.

## 2026-10-20 — A route for a recipe's container gets the recipe's icon

**Sunde: a route added for a recipe's container didn't get its image.** The install was
the only place a recipe's icon reached a record. A route deleted on Routing removes its
record, icon included, and the next Add route made a new one without; so did a stack moved
in by hand, or an install that couldn't name its container. Now `assign()` gives a **new**
docker record the icon of the recipe its container's stack came from — the compose project
label → `stacks/<project>` → the install record, or the recipe of that name (the same lookup
as the form and Check for updates). Only a new record: an icon removed by hand stays removed
when the route is edited. Best-effort, like the install's — Docker or the recipes being
unreadable never stops a route.

## 2026-10-20 — An option's help starts with what happens without it

Jellyfin's GPU options opened with "Needs /dev/dri on the Docker host, or Jellyfin won't
start" — read on its own, that says Jellyfin needs a GPU. **Sunde: "its important that we
dont make the user think it wont run without a gpu when it will simply use the cpu."** Every
option's `help` now starts with what happens without it ("Without it, Jellyfin transcodes on
the CPU"), then what the host needs if ticked. The schema's `help` row and the recipes repo's
authoring rule say so, so a new option is written that way from the start.

## 2026-10-19 — Recipe sync follows a rewritten history

Sunde's global CLAUDE.md says commits carry no AI attribution lines, and most of both repos'
history did — so their history was rewritten and force-pushed. **A sync was `git pull
--ff-only`, which refuses a force-pushed source**: every Loskai with the recipes repo synced
would have stopped syncing it until someone deleted the cache by hand. The cache is a mirror
Loskai never commits to, so it now fetches and resets to the source instead. An install
record naming a commit the rewrite replaced only loses its "What changed" list; status reads
the compose fingerprint, not the commit.

## 2026-10-19 — Recipe options: optional features as checkboxes

Jellyfin's hardware transcoding was a snippet in its instructions, pasted into the override
with Edit as text — exactly the hand-written YAML the form had just removed. Asked whether to
add the line or not, **Sunde wanted "a default way to handle such cases"** rather than a
Jellyfin answer. Always adding it was out: a container whose device the host lacks doesn't
start, and Jellyfin doesn't find a GPU by itself anyway (the device must be passed in, then
picked in its dashboard).

So a recipe declares **`options`**: each a fragment of Compose for one service, a checkbox in
the wizard and the Edit form, **off by default**. On adds exactly those lines to the override;
off removes exactly those. **Whether one is on is read from the override, never stored** — so
it can't drift from the file, and a snippet pasted by hand before options existed shows
ticked. An option may only *add* (`devices`, `group_add`, `environment`, `cap_add`, `ports`):
an option that could set `image` or `volumes` would be a second, hidden compose file. Living
in the override, options are the user's under Phase 31's ownership, untouched by updates.
Jellyfin's first was Intel/AMD — the image runs as root, so `/dev/dri` alone, no `render`
group. **The same day Sunde asked for NVIDIA too**, which Docker hands over as a reservation
(`deploy.resources.reservations.devices`), not a device — a nested mapping, so options learnt
to merge mappings key by key, refusing rather than overwriting a value set otherwise. The
image already sets `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility` (checked on the 12.1
image), so NVENC needs no environment line.

## 2026-10-18 — The stack editor opens as a form

The tab-per-file editor (below) answered *where* a setting could be changed, not *which line*:
the recipes' `compose.yml` files were mostly comments, and Sunde found it hard to see the
values among them. **Sunde asked for the files read as fields** — the Folders form priced and
passed over the same morning, now for every stack rather than recipes alone.

**Edit opens a form**: Settings (the `.env`, one field per variable the stack reads, labelled
with the recipe's question), Folders (the override's bind mounts as rows) and the App —
`compose.yml` as its values, **read-only by Sunde's choice**: Phase 31 made it the recipe's,
so a field there would invite an edit the next update wipes. "Edit as text" keeps the files.
The parsing is on the server, which already has a YAML library, and the form changes only
what it shows — an unchanged `.env` line stays as written, an override keeps its other keys,
and rewriting one through YAML drops its comments, which the form says before saving.

**And the comments moved** (also Sunde's choice): only `compose.yml` is copied into a stack,
so the author notes went into `recipe.yml`, which stays in the repo, and each `compose.yml`
now carries a two-line header saying whose file it is. Doing so surfaced a Phase 31 leftover:
Jellyfin's hardware transcoding said to uncomment lines in `compose.yml`, which an update
would now silently undo — it is an override snippet in the instructions instead.

## 2026-10-18 — Recipe updates: the recipe owns compose.yml, you own the override

Once the override was editable, Sunde saw what it made possible: if everything a user sets
lives in `.env` and the override, `compose.yml` can stay exactly the recipe's — and then a
recipe's new version can simply replace it. Before, updating meant raising the image tag in
`compose.yml` by hand, after which the file no longer matched its recipe and nothing could
tell an update from an edit.

**Each file got one owner** — `compose.yml` the recipe's, `.env` the answers (an update only
adds), the override the user's (an update never touches it). An install now writes
`.loskai-recipe.json`: the recipe, its source and commit, and a fingerprint of the
`compose.yml` it wrote — the one thing that tells "the recipe moved on" apart from "you edited
it", which a plain comparison can't. A stack from before has no record and is found by its
name, shown as "differs from the recipe" rather than guessed at.

**Sunde chose one quiet button**, "Check for updates" beside New stack and Install recipe,
over a mark on every stack row: it syncs (explicitly, as every sync is), lists the installed
recipes, and a recipe opens to what changes. "What changes" is the recipe folder's own commit
messages since the install plus the `compose.yml` diff — the commit message costs an author
nothing extra and is already written for a reader, so recipe commits are now written for
someone *running* the app. An update is refused before anything is written unless `docker
compose config` loads the new file with the stack's own override and `.env`, and recipe
authors now promise to keep what those hang on — service names, the mount target, data
folders, `.env` keys — or change the recipe id.

## 2026-10-18 — The stack editor edits the override too

Moving a real Jellyfin into a stack showed that a recipe's folders, once installed, could only
be changed over SSH or by deleting and reinstalling: the editor showed
`compose.override.yml` read-only. Two ways were priced: make the file editable (small, every
stack gets it) or a Folders form that reads the override back into the wizard's rows (nicer,
but a feature for recipes alone). **Sunde chose the file.** The editor became a tab per file,
and since editing YAML in a text box is where the mistakes are, it got what YAML needs from
an editor — line numbers, Tab typing spaces, Enter keeping the indent — and the server checks
each YAML file before writing it, refusing with the line (a tab in the indentation said
plainly, because YAML's own words for it don't).

Two bugs went with it. **"Save + re-up" never re-upped** — it only saved, so an edit sat on
disk until something else ran `up`; it now runs `up` and stays open on Compose's output when
that fails. And **saving wrote `compose.yml` even beside a `docker-compose.yml`**, which a
migrated stack keeps — Compose would then read the new file and ignore the old one. A save now
goes to the file the stack already has. An emptied override is removed, as an install with no
folders does.

## 2026-10-10 — The docs get a shape for publishing

Ahead of publishing, Sunde asked what a good repo looks like. The answer taken: the README
is a landing page, not a report's introduction; one index (`docs/README.md`) instead of a
hand-written table of contents per page, since GitHub draws an outline for every file; a
breadcrumb back to that index and a `Read this when` line on every page, now checked; and a
table in the index's Conventions of which reader's question is answered where — including
that the app says *what* in a tooltip and the docs say *how* and *why*.

**The working files moved to `docs/project/`** — PLAN, HISTORY, TODO and the archive, 6,500
lines of maintainers' notes that sat beside the README and were the first thing a visitor
saw. `CLAUDE.md` stays at the root, where Claude Code reads it. `SECURITY.md`,
`CONTRIBUTING.md` and `CHANGELOG.md` were added, the files a visitor looks for; CHANGELOG
says *what* changed for someone running Loskai, this file still says *why*.

## 2026-10-09 — Loskai runs as the owner of `./data`, not root

The container ran as root, so everything it wrote on the host was `root:root`: state you
couldn't read, a wizard-created stack you couldn't edit over SSH without `sudo`, and a `.env`
of install passwords left `0644` for every user. Three ways out were weighed: a fixed
`user:` in compose (every user looks up their UID and their host's docker group number —
988 here, 999 elsewhere — and a wrong one shows as "Docker unreachable"); staying root and
`chown`ing after each write (seven places today, and every future one has to remember); or
an entrypoint that reads both numbers off the host. **Sunde chose the entrypoint**: zero
config, and the owner comes out right whoever cloned the repo.

It also hands back what a root-run Loskai left, but stops at a stack's own files —
`stacks/<name>/data/` is the app's, often a database's uid 999, and chowning it would break
that app. That same data is why Delete-with-data gained a fallback: what Loskai's user can't
remove, a throwaway container from Loskai's own image removes as root, so dropping root
loses nothing the UI could do before. `user:` set by hand, or a `./data` owned by root, runs
exactly as before.

## 2026-10-08 — A recipe can ship an icon, PNG only

A recipe folder may hold an `icon.png`: the wizard shows it in the catalog, and the install
gives it to the route it creates (only where there is no icon yet, so one chosen by hand
survives a reinstall). It is checked by the same rules as an uploaded icon, and a recipe
whose icon fails them is skipped with the reason — `check_recipes` says so before a push.

**SVG was considered and dropped.** Simple Icons, the obvious source, is SVG only, and SVG is
safe enough with an active-content check plus a `sandbox` CSP on the response; that was half
built. Sunde chose PNG only instead: it keeps the one rule icons already had (an SVG can carry
a script, and these are served publicly from Loskai's origin) with nothing new to get right.
Simple Icons' coloured CDN renders can be converted to PNG for a recipe.

## 2026-10-08 — A lone container is a group of one

The Docker tab had three layouts: a managed stack, a compose project from elsewhere, and
**Standalone** — one heading over every container no compose file started. That heading
stood for nothing (the containers under it are unrelated), so it could have no toggle, and
each container's row had grown the controls and the link a header would carry. Sunde asked
why standalone always looked different and chose uniform: each such container is now its own
group, with a project's header — status, link, start/stop, Remove — and the same container
row beneath. One extra row each; one layout and no special case in exchange.

## 2026-10-08 — A route on a machine's IP is matched, not linked

Sunde asked for routes on a machine's address to show as that machine's without having to
link each one. Both tabs now do: Routing names the machine under the address, and Machines
lists the route under it; a wand icon marks a match, a chain a link. It is a **match, worked
out on display** — the route's `machine` field is never set by it. So the two kinds behave
differently when a machine's address changes, and Sunde chose that on purpose: a linked
route is rewritten to the new address; a matched one keeps the old one and simply stops
matching. Setting the link automatically was the alternative, and it would break Phase 30's
rule that a matching IP never creates a link — a route someone typed by hand would quietly
start moving with a machine.

The same day, a linked row stopped reading `<machine>:<port>` (Phase 30's `nas:32400`): a
machine named `adguard.lxc` made it `adguard.lxc:3000`, which looks like an address and is
not one — the name resolves only with the base domain on. Every row now shows its real
address, and the machine (linked or matched, by icon) sits beneath it — by its **full**
name, `adguard.lxc.sunde.home`, for the same reason: the short one is not an address either.

## 2026-10-08 — The Routing table's Live column is gone

It read Caddy's `/reverse_proxy/upstreams` and showed `up` when an upstream had no
`fails`. But Caddy only counts failures on a route with health checks, and Loskai's routes
have none — so every loaded upstream read `up`, a dead one included (checked live:
`192.168.10.222:80` answered nothing and reported 0 fails). It said no more than Route did.
Sunde chose removal over making it real: Route is Caddy's column, DNS is AdGuard's, and a
reachability probe of Loskai's own would be a third thing to keep honest. Caddy's passive
checks were not an option either — they count failed *real* requests, so an idle service
would still read `up`. Field, client call and tests went with it; `caddy-api.md` §7 records
why the endpoint is unused.

## 2026-10-07 — The Docker tab: a stack's row is its controls; Loskai sits apart

Sunde found the stack table bloated — on a one-container stack, eleven buttons doing about
five jobs, because the stack header and its container row both carried start/stop/restart.
The header is now the stack's one row of state and control: a single status pill (`up`,
`1/2 up`, `down` — it replaces the badge *and* the "1 of 1 running" text), the stack's route
links, and its actions, with **Up and Down merged into one Start/Stop toggle** — Stop only
once every declared service is running, so a half-started stack still offers Start. The
other actions stay as buttons; Sunde wanted them visible, not in a menu. A container row
keeps only Logs and Terminal visible; Start/Stop/Restart/Remove moved to a `⋯` menu.

The table splits in two, each under its own heading — **Stacks**, and **Other
containers — not managed by Loskai** (other compose projects and plain `docker run`),
which is left out entirely when there are none — and **Loskai's own container leaves the table**
for a strip above it with Logs only — stopping or removing it from Loskai takes down the
page doing it. The backend marks it `self`, matched by Docker's default hostname (the
first 12 digits of the container id); a container given its own `hostname:` is never
matched and is listed like any other, which is the safe failure.

Considered and not done: borderless icon buttons (Sunde kept the bordered style), and
folding a one-container stack into a single row (a row would mean different things by
container count).

- Key files: `frontend/src/components/docker/StackGroups.tsx`, `groupByStack.ts`
  (`groupStatus`), `components/shared/RowMenu.tsx`, `backend/.../docker/logic.py` (`is_self`)

## 2026-10-05 — Caddy's `:80` page becomes a copy of the Certificate tab

The `:80` onboarding page predated Loskai's Certificate tab and had fallen behind it: no
"Place all certificates in the following store" step on Windows (the default store choice
leaves the warning in place), no iPhone/iPad trust switch, a vaguer Firefox note, and
detect-only platform display with no way to another OS's steps. Sunde asked for it to say
what the tab says; it now does, in Loskai's look, **English only** — the Norwegian toggle
and the hard-coded `home.lan` branding went with the old theme, since two languages are a
second thing to keep in step with a page that is already hand-mirrored.

Its copy buttons had never worked where the page is actually used: `navigator.clipboard`
needs a secure context, and the page is plain HTTP by IP by design. They now fall back to
selecting the command. **Loskai had the same bug** in both its copy buttons (the
Certificate tab's commands, Routing's cert-page link) whenever it is opened by IP — which is
how the Certificate tab is meant to be reached. They now go through `lib/clipboard.ts`
(`copyText`: the Clipboard API where it exists, `execCommand` where it doesn't), and show
the tick only when the copy worked.

- Key files: `caddy/setup/index.html`, `docs/guides/certificate-setup.md`

## 2026-10-05 — Machines get their own tab (Phase 30a)

**A walk-back of Phase 21's "a second button, not a second tab".** That decision kept one
table and leaned on views (All · Services · Machines · Grouped) and a `via` tag to make the
machine/service split readable. Sunde wanted the split to be *structural*: a machine and a
route are different verbs with different forms, and one table with a filter kept presenting
them as the same thing. The Machines tab lists each machine with the routes hosted on it
beneath — the Grouped view, promoted to the only reading — and Routing lists services only.

What did not change is the point the original decision protected: route creation is still one
surface (Routing's Add route), and the store is still one `instances.json` — both tabs read
`/api/caddy/routes` and split it on the declared `kind`. No backend change.

- Key files: `frontend/src/pages/Machines.tsx`, `components/routing/MachineTable.tsx`,
  `components/routing/machine.ts` (`isMachine`, moved out of the deleted `ViewFilter.tsx`)

## 2026-10-05 — Machine or Address; Docker by stack; the wizard routes (Phase 30b–d)

**The upstream host became a toggle** rather than one combobox that offered machines beside
addresses. Phase 29 had merged them on request, and the merge was fine to type into but hid
the one thing that mattered: whether the route was *linked*. A picked machine just looked
like its IP. Now Machine selects by name (and links), Address types or picks (and never
links), and switching to Machine never guesses a link from a matching IP — the same rule
21a's "no automatic migration" set. A linked row reads `nas:32400`.

**The Docker tab is organised by stack.** Containers and Stacks were two flat tabs, and a
container never said which stack ran it. One table now nests each container under its compose
project, stack actions on the header row; a **Volumes** tab lists named volumes with what
mounts them. Read-only: the useful act is *seeing* that nothing mounts a volume. The first
real run showed exactly that — three volumes, all unused, because every container on the dev
VM bind-mounts (the recipes' `./data` convention).

**The install wizard routes its install — a walk-back.** `PLAN.md` had "No assign step
here", so that Add route stayed the one surface creating routes. What that consolidation
protected against is a duplicate record and prefills that drift between forms; the last step
avoids both by posting `container` (the server's idempotency key) and pre-filling through
`containerPrefill`. It offers only the prefix, following the container; anything more is the
Routing tab's. Sunde asked for it outright, with the alternative (a pointer to the Routing
tab) being what was there.

- Key files: `components/routing/RouteFields.tsx`, `components/docker/StackGroups.tsx`,
  `groupByStack.ts`, `VolumeList.tsx`, `InstallWizard.tsx` (`Steps`, `RouteNow`);
  `modules/docker/logic.py` (`volume_rows`)

## 2026-10-04 — The recipe schema gets a copy in the recipes repo, and a checker

Sunde wanted to write recipes with Claude Code opened in `loskai-recipes`, without relying on
this repo's docs. The obvious move — put the schema there — was rejected for the opposite of
the obvious reason: the validator lives here, and the rule that a doc changes in the same
commit as its behaviour only works within one repo. So the contract stays here and the
recipes repo gets a **copy**, written only by `scripts/sync-recipe-schema.sh` and checked by
`check-docs.sh` whenever `../loskai-recipes` is beside this checkout (both always are, on
the working machine) — duplicated docs drift here, so drift has to be a failed check.

Docs say what is valid; `check_recipes` proves it, running the wizard's own `_load_folder`
over a recipe or a whole repo. It exists so an authoring session gets the exact reason a
recipe would be skipped before pushing, not after a sync.

- Key files: `scripts/sync-recipe-schema.sh`, `scripts/check-docs.sh`,
  `backend/src/loskai/modules/docker/check_recipes.py`; in loskai-recipes, `CLAUDE.md`
- 434 backend + 153 frontend tests pass

## 2026-10-04 — Folders a user adds at install: `mounts`

`type: path` asks for one folder. Asked about Jellyfin, the honest answer was "point it at a
parent folder" — and Sunde mounts music, movies and anime individually, which no recipe can
anticipate. A file browser was priced first and declined: Loskai can't see the host's disks,
so it would mean mounting the host root into Loskai or a throwaway container per click, for
a field filled in once — and its one real benefit, catching a typo, comes free from
`create_host_path: false`, verified against the daemon (a missing folder fails the deploy
rather than becoming an empty root-owned one).

So a recipe can declare a `mounts` group and the wizard adds rows, each landing at
`target/<name>`. They go into a generated `compose.override.yml` rather than the recipe's
`compose.yml`: Compose merges it unasked, and Loskai already runs compose from the stack
folder without `-f`. The cost is a stack whose definition is in two files — so the editor
shows the override, read-only, and Delete treats it as config.

The limits are written into the schema on purpose — one group, one service, one `read_only`
— because the risk was never this feature but its growing into a volume editor. The *arr
stack, needing matching paths in several containers, is where it stops.

- Key files: `backend/src/loskai/modules/docker/recipes.py`, `stacks.py`,
  `frontend/src/components/docker/InstallWizard.tsx`, `docs/reference/recipe-schema.md`
- 430 backend + 153 frontend tests pass

## 2026-10-04 — Mounted folders become something a recipe declares

Sunde asked what the best way is to assign host paths in a compose file, and then — "ideally
the install wizard is able to handle that, based on how we configure the instructions."

The answer was tested rather than recited, from inside the running Loskai, because that is
where a stack's compose actually runs. `./data` and `${X:-./data}` land in the stack folder; an
absolute path passes through to the host; **`~` became `/root`** — compose runs as root inside
Loskai's container. Two neighbouring traps come from Compose itself: a bare `data` is a named
volume, not a folder, and a `:` splits the volume spec. All three install without complaint
and mount the wrong thing — this project's recurring "fails as a success".

So a recipe's `env` entry can now be `type: path`. The wizard says where each answer lands —
in the stack's own folder (kept on Delete unless ticked) or on the Docker host (never Loskai's
to delete) — and refuses the three traps before Deploy; the server refuses them too. A path is
always required, since an empty source fails in Compose after the folder is made.

The convention it encodes: the service's own state is a relative path fixed in the compose
file; data it uses but doesn't own is a `path` question; caches are named volumes.

**`directories:` was deleted, not fixed.** It pre-created folders — inside Loskai's own
container, so for any path outside the stacks folder it made a directory nobody would ever
see, while Docker was creating the real one on the host anyway. No recipe used it. A manifest
that still has it is rejected with a pointer to `type: path`.

- Key files: `backend/src/loskai/modules/docker/recipes.py`, `frontend/src/lib/validation.ts`,
  `frontend/src/components/docker/InstallWizard.tsx`, `docs/reference/recipe-schema.md`
- 405 backend + 149 frontend tests pass

## 2026-10-04 — A service is one folder, so Delete stops deleting it

Asked where Bambuddy's data lived, Sunde found it in named volumes and preferred "the relative
directory of the service (where the compose file is located)" — `./data` beside the compose
file, which is also what upstream Immich does. One folder per service: compose file and data
together, visible and backed up over SSH.

That preference turned the stack **Delete** into a data-loss button, because it was a plain
`rmtree` of the folder. Of three options — keep the data unless ticked, move the folder to a
trash, or keep deleting and warn louder — Sunde chose the first. Delete now runs `down` and
removes only `compose.yml` and `.env`; the dialog names the folders it would take and makes
taking them a deliberate tick. The trash option was rejected partly on a detail: the container
still writes as root, so a trash would be root-owned and emptying it would need sudo.

Keeping the folder made reinstalling routine, which is exactly where the open Phase 28 bug
lived: a reinstall replaced the instance record wholesale and wiped its route. Both were fixed
together. A folder with no compose file is now taken over by the next stack or install of that
name; the record is kept and only re-pointed. Because a route's id is its prefix, the install
also refuses when the recipe's id already names something unrelated, rather than overwrite it.

Bambuddy's running install was moved from its volumes to `./data` live: stopped (it checkpoints
SQLite on the way down), copied, compose swapped, started — every lasting table identical
afterwards, the route still serving, the files owned by the host user since the image chowns
to `PUID`. The old volumes are kept until confirmed.

- Key files: `backend/src/loskai/modules/docker/{stacks,recipes,router}.py`,
  `frontend/src/components/docker/DeleteStackOptions.tsx`, `pages/Docker.tsx`
- 391 backend + 143 frontend tests pass

## 2026-10-03 — The upstream becomes host + port

Sunde asked for the upstream as two fields on one row: a host that is both a dropdown of
known machines and a plain text box with a search filter, and a port. It went into
`RouteFields`, so both route forms changed at once — the payoff of yesterday's decision to
leave the two forms separate but sharing.

The useful side effect was a deletion. Each form had carried its own machine picker — a pick
list under Add route's External source, a "Hosted on a machine" box in the row form — and
the host dropdown is both of them. One option builder replaced them, and it reads the
declared `kind`, where the External list had quietly been re-deriving "machine" from the
shape of the address: the drift CLAUDE.md warns about, removed in passing.

The one rule worth a test of its own: nothing is highlighted until an arrow key says so, so
Enter can never replace a typed `192.168.10.5` with the `192.168.10.50` it happens to prefix.

- Key files: `frontend/src/components/routing/{HostSelect.tsx,hostOptions.ts,RouteFields.tsx,
  useRouteFields.ts,AddRouteModal.tsx,AssignModal.tsx}`, `frontend/src/lib/validation.ts`
- 379 backend + 139 frontend tests pass; no backend change

## 2026-10-03 — A Docker route follows its container

Once the route forms pre-filled the host, Sunde pushed past it: "the port should be locked for
docker containers and self update if we change it in the docker." Underneath that is a real
defect, older than any of this: a Docker route *stores* its upstream, so a container whose
port changes leaves its route dialling the old one — a 502, with nothing in Loskai saying why.
The live run reproduced it exactly while Loskai was stopped.

**The model already had the answer, one link over.** A route linked to a *machine* is rewritten
when the machine moves. `follow_container` is the container counterpart: the upstream is
derived from the live container and re-derived when it starts on a different port. It is
**declared**, like `kind`, defaulting `False` — every record that predates it keeps its stored
upstream exactly, and no migration guesses which ones "should" follow.

**One derivation, three users.** The form's pre-fill, the server's answer when a route asks to
follow, and the follower's rewrite all call `logic.suggested_upstream`. The server is the
authority: a following route's upstream from the client is ignored, which the live run proved
by sending a bogus one. Following a container and a machine at once is refused, and the form
won't build that request.

**Sunde chose the event stream** over re-pushing only on Loskai's own restarts, so a port
changed over SSH is followed too. That makes `shared/follow.py` Loskai's first background
task, and the shape of it is the risk to get right: it never blocks startup; Docker gone means
back off and retry, not crash; it subscribes *before* catching up, so nothing slips between;
it catches up at startup and after every reconnect, because a change made while it wasn't
listening sends no event; and its write is compare-and-set, so a hand edit made while it was
asking Docker wins. Shutdown closes the stream — the only thing that releases a read blocked
in its thread, which a test pins.

**Host networking needed one more piece.** Docker reports no ports for it at all, so
`loskai.port` — a label naming the port as the container sees it — fills the gap, and resolves
to whatever Caddy dials. Because Compose interpolates labels, Bambuddy's recipe writes
`loskai.port: ${PORT}` and the label moves with the port; the live run showed the route
following a host-networked container through exactly that. It also picks one port out of
several published.

**A route creation now sometimes depends on the Docker socket**, which this codebase had a
rule against. Only for a following route, and deliberately: its address *is* Docker's answer,
so with Docker unreachable there is nothing honest to store (`503`). Every other route still
goes ahead without Docker.

Unrun: restarting the daemon itself mid-run, which needs root. The reconnect path has a unit
test and nothing more, and the TODO says so.

- Key files: `backend/src/loskai/shared/follow.py` (new), `shared/{assign,instances}.py`,
  `modules/docker/{logic,client}.py`, `main.py`, `frontend/src/components/routing/RouteFields.tsx`,
  `AddRouteModal.tsx`, `AssignModal.tsx`, `pages/Routing.tsx`
- 379 backend + 131 frontend tests pass

## 2026-10-03 — Two route forms, one pre-fill

Sunde routed the first recipe install by hand and found the address box empty: "if it's a docker
entry it will always have the host ip". Then the real diagnosis, also Sunde's: "add route and
add url are two different functions" — they look the same and are different code. The Add
route picker asked Docker; the Routing row's "Assign a URL" read only the stored record, and
a recipe install is linked but never routed, so it stores no upstream. Every fresh install
opened that form blank.

The fix is one helper, `containerPrefill`, used by both — named in CLAUDE.md so a third form
doesn't drift the same way. Underneath, the backend now reports the **host half** of an
upstream on its own (`suggested_host`), because it is known far more often than the port:
Bambuddy runs with host networking and Docker reports no ports at all, yet Caddy still dials
the Docker host, whose IP is configured. The form then pre-fills `192.168.10.220:` — the
trailing colon the machine picker already used. `suggested_upstream` is built from it, so
the two can't disagree. The prefix is the linked instance's id, i.e. the recipe's name,
instead of `bambuddy-bambuddy-1`.

**Rejected: guessing the port from the image's `EXPOSE`.** It looked like the general answer
for host networking until the Bambuddy image turned out to expose about 110 ports.

**Found on the way, not fixed:** the container runs as root, so the first state it wrote after
the redeploy made `data/instances.json` `root:root 0600`, and the wizard's `stacks/whoami` is
root-owned — not editable over SSH, against one of Loskai's founding rules. Recorded in
Phase 28; it needs a decision about the container's user.

- Key files: `backend/src/loskai/modules/docker/{logic,client}.py`,
  `frontend/src/components/routing/containerPrefill.ts`, `AddRouteModal.tsx`, `Routing.tsx`
- 353 backend + 122 frontend tests pass

## 2026-10-03 — The first install ever run, and the secrets it would have mangled

Sunde created `sunde/loskai-recipes` on Forgejo — the exact URL `DEFAULT_RECIPES_REPO` already
named — and `whoami` went in as its first recipe. Then the install ran for real, for the first
time since the wizard was built in July.

**The container-link fix held.** The registered instance named `whoami-whoami-1`, exactly what
`docker ps` showed, where the July code would have stored `whoami` and matched nothing. The
stronger proof was routing it the way the Add route picker does: the route *edited* the
recipe's instance instead of creating a second one, which is what the old link key would have
done. The multi-service rules held too, each tested in the case where the rules disagree.

**Then the run found the thing it was for.** `.env` generation wrote answers verbatim, and
Compose does not read a `.env` as a list of strings. Checked directly against
`docker compose config`: `pa$word1` arrived as `pa`, because `$word1` was interpolated;
`correct horse #battery` arrived as `correct horse`, because ` #` starts a comment; and a
newline started a second line, where `COMPOSE_PROJECT_NAME=hijacked` renamed the project.
**Every one of those succeeds** — `up` exits 0 and the app simply has a different password.
That is the third time on this project a defect has failed as a success (after the empty `200`
and the nested migration), and the second that unit tests were structurally unable to see:
they asserted the `.env` text Loskai wrote, which was exactly what Loskai meant to write.

It surfaced sideways. An API install with `{}` published `${PORT}` on a random host port,
because the wizard seeds defaults in the browser and the server never did. Following that up
is what led to testing what Compose does with the values themselves.

**The fix is an encoding, chosen by testing rather than reading:** every value double-quoted,
with `\`, `"`, `$`, newline and CR escaped. Single quotes would have handled `$` and `#` but
cannot contain a `'`, and doubling it is a Compose parse error — both tried. The server now
owns the value set (`resolve_answers`): every declared key in manifest order, answer else
default else empty, and an undeclared key refused with `400` before anything touches disk.
Manifest keys must be variable names. Proven with a live round trip — a password holding all
of the above reached a real container's environment byte-identical, with the project label
untouched.

**Two process notes.** The full split-DNS stack can't run beside the dev `loskai` container,
which holds the same `container_name` and `:8080` and points at real infrastructure, so the
rig was a host backend on `:8010` with scratch state plus Caddy alone as project
`loskai-smoke`. And restarting that backend with a `pgrep -f` loop killed the calling shell,
because the pattern matched its own command line. The memory note warned about exactly that;
kill by PID.

From this commit on, commits carry no AI attribution lines. Sunde's global instructions have
always said so, and harness guidance had been overriding them; the existing history is left
as it is.

- Key files: `backend/src/loskai/modules/docker/recipes.py`,
  `backend/tests/test_docker_recipes.py`, `docs/reference/{recipe-schema,api}.md`
- 348 backend + 115 frontend tests pass (was 327 + 115); `check-docs.sh` clean
- Still open: syncing `loskai-recipes` over git, which needs the push

## 2026-10-02 — `RECIPES_REPO_URL` deleted, four days after it was extended

Sunde, mid-change: "do we even need the env variable? Since we now have a option in the ui
for adding more on top of the default?" No. The question arrived while implementing a
*smaller* override semantics for it, and made the whole thing unnecessary rather than
smaller — the better outcome, and the second time on this project that pricing up a deletion
beat refining the thing.

**Why it was dead weight.** It was load-bearing when recipe sources were a single string that
had to be set before any UI for them existed. Once sources became a list of rows with add,
remove, toggle and per-row sync, the variable was a second way to say exactly what the editor
says. Worse, the precedence rule it brought with it — env wins, env-set values render
read-only — was the *only* reason the sources panel could ever lock, and it locked on Sunde's
own dev box, where a leftover `.env` line made the new editor unusable.

**The test it failed.** The env layer exists for values needed *before the UI is reachable*:
`CADDY_ADMIN_URL`, `ADGUARD_URL`, `BASE_DOMAIN`, `LOSKAI_PASSWORD`. Recipe sources are needed
only once you are logged in and looking at the wizard. So `recipes_repos` is now the first
entry in **`STORED_ONLY_KEYS`** — a named category beside `ENV_ONLY_KEYS`, which keeps the
three-places enumeration test meaningful: a key with no env var is now a declared choice
rather than one forgotten in `config.Settings`. A second test asserts such a key never
quietly acquires an env attribute later, since `_resolve` would silently start preferring it.

**What went with it:** the `Settings.recipes_repos` property, `ENV_SOURCE_ATTRS` (which only
existed because that property was unsettable, and which two test fixtures had to know about),
the stored-legacy-single-URL fallback, the read-only branch of the editor, the variable in
three compose files and `.env.example`. The legacy fallback is worth naming: it migrated a
stored `recipes_repo_url` from before the list, and **nothing had ever stored one** — the
install base is one box whose `settings.json` never carried the key. A migration with no
records to migrate is not caution, it is a branch nobody will ever execute.

**What is deliberately kept:** `DEFAULT_RECIPES_REPO` stays on the development Forgejo until
loskai is published, then becomes `https://github.com/simplysunde/loskai-recipes` — one line.
With no variable to override it, pointing an install elsewhere is two clicks in the editor,
and local recipe work is what `data/recipes/` has always been for (always scanned, never
disableable). Source rows stay restricted to `http(s)` URLs: a bare path would aim the wizard
at the container's own filesystem.

- Key files: `backend/src/loskai/{config,shared/settings}.py`,
  `frontend/src/components/settings/RecipeSources.tsx`, `compose*.yml`, `.env.example`,
  `docs/reference/recipe-schema.md`, `docs/guides/deployment.md`, `PLAN.md`, `CLAUDE.md`
- 327 backend + 115 frontend tests pass; `check-docs.sh` clean

## 2026-09-28 — The install wizard's first real look, and sources become a list

Sunde asked where to start building the install wizard. It was already built — `recipes.py`,
`InstallWizard.tsx`, the three routes, `git` and the compose plugin in the image, all of it
shipped with Module 1 in July. What was missing was **recipes**: `data/recipes/` held a
`.gitkeep` and nothing else, so the only thing anyone had ever seen of the wizard was its
empty state. Reading it against the plan turned up two defects and a stale doc, none of which
297 passing tests could have caught, because none of them could run an install.

**The instance an install registered pointed at nothing.** It set `container` to the *recipe
id*, but the recipe id is the compose **project** name — Compose names containers
`<project>-<service>-1` unless the file pins `container_name`, and every join in the Docker
module matches on the container name. So an installed service never linked to its own
container: no FQDN in the Docker tab, and a row that read as orphaned. Third time this shape
of bug has appeared here and the second time it would have "worked" in tests: the code was
self-consistent, and only a real daemon disagrees. The name now comes from the daemon, via
the compose project label, and `logic.primary_container` picks the published service of a
multi-service recipe (manifest `service:`, else the only one, else the one publishing ports,
else alphabetical — a stable answer, not whatever was listed first).

**When it can't identify a container, it now registers nothing.** The tempting fix was to
fall back to a guess. But a wrong `container` is worse than an absent instance: the Routing
tab's Container source lists the real container and creates the instance correctly, so a
guess would leave a second, permanently dead record beside it. Same for a failed `up` — which
used to register an instance regardless.

**`instructions.md` was being loaded, shipped, and dropped.** The backend put it in the
payload from day one; the frontend's `Recipe` interface never declared the field, so the one
place a recipe author can say "first login is admin / admin" reached the browser and was
discarded. It is now the wizard's first step, with what the install will create — PLAN.md's
step 1 existing at last. `shadowed` had been ignored in exactly the same way.

**Sources went from one URL to a list, which Sunde asked for and the design wanted anyway.**
`recipes_repos` is a list of `{url, enabled}` rows, each cloned into its own slug-named cache
(the slug carries a hash of the URL, because two repos ending in `/recipes.git` are routine
and sharing a cache would have one silently overwrite the other). Priority is list order,
local `data/recipes/` always last. A sync reports **per source**, so an unreachable repo costs
that repo's recipes and nothing else.

Three things about that shape are deliberate. It is the **only list-valued setting**, so it
gets its own editor rather than an `InlineSettingsFields` row, and the cast that reads it
lives in one place with the reason. A stored **empty list is a real value**: with a built-in
default seeded when nothing is stored, deleting every source has to persist rather than
re-seed itself — so `[]` can never be an unset marker here. And `RECIPES_REPO_URL` stays the
env layer (comma-separated, still wins, editor read-only) via a *property* on `Settings`, so
the priority chain resolves it generically instead of special-casing recipes; the settable
attribute behind it is named once in `ENV_SOURCE_ATTRS` rather than in each test fixture.

**The built-in default is one constant.** `config.DEFAULT_RECIPES_REPO` points at Forgejo
beside loskai while both are private, and moves to the public GitHub URL when loskai is
published — Sunde's call, and a one-line change when it comes. A dev `.env` that already sets
`RECIPES_REPO_URL` overrides it, which is also why the sources editor will be read-only on
this machine until that line is commented out.

Still no recipes. That is the next piece of work, and now there is somewhere for them to go.

- Key files: `backend/src/loskai/modules/docker/{recipes,logic,client,router}.py`,
  `backend/src/loskai/{config,shared/settings}.py`,
  `frontend/src/components/{docker/InstallWizard,settings/RecipeSources}.tsx`,
  `frontend/src/{lib/settings.ts,pages/settings/General.tsx}`,
  `docs/reference/{recipe-schema,api}.md`, `docs/guides/deployment.md`, `PLAN.md`, `CLAUDE.md`
- 329 backend + 115 frontend tests pass (was 297 + 100); `check-docs.sh` clean

## 2026-09-28 — Launcher icons, and the first binary state in the store

Two asks that turned out to be one: an image per route for the dashboard card, and a list
endpoint for a desktop launcher that builds kiosk-profile shortcuts. `GET /api/dashboard` was
already public and already returned `{name, url, icon}` — the icon had simply never been
filled in. So the endpoint half was nearly free, and the work was making icons real.

**This is the first binary state Loskai stores.** Everything else is two JSON files; icons are
images in the same volume, which keeps backup and relocation working the way they already do.
Three decisions carry it. Validation is by **magic bytes**, because the file is served back
from Loskai's own origin and a caller's `Content-Type` vouches for nothing. **SVG is refused**
for the same reason — it is a script container, and these render unauthenticated. And the
upload is a **raw body rather than multipart**: the bytes are sniffed either way, so a form
part would only carry a filename and type that are ignored, at the cost of a
`python-multipart` dependency.

**The security surface needed care, and the enforcement needed extending.** `PUBLIC_ROUTES` is
a set of exact `(method, path)` tuples, and an icon path carries the instance id, so it cannot
be one. Rather than loosening the matcher, there is now a `PUBLIC_PATTERNS` list holding a
single anchored regex — and `check-docs.sh` was extended to assert each pattern is named in
`CLAUDE.md`, exactly as it already did for the set. Otherwise a whole category of
unauthenticated surface could have been added without the enumeration check noticing, which is
the failure mode that script exists for. Verified by deleting the mention and watching it fail.

**On private routes**, Sunde's instinct was right that the existing password is enough:
`GET /api/launcher` is simply the same list, authenticated, with a `private` flag. A desktop
client logs in the way the web UI does. `private` means "not on the public wall", not
"secret" — so a client holding the admin password may list them, and the public dashboard
stays exactly as minimal as it was.

## 2026-09-27 — Phase 12 finally closes, on its last and smallest item

12c was always documentation: Caddy can run an `acme_server` against the internal CA it
already has, so a backend that insists on serving its own HTTPS — Proxmox on `:8006` — can
hold a leaf signed by the root every LAN device already trusts. Loskai is not involved at any
point, which is the first thing the new guide says.

**The value was in the numbers, and every one of them came from upstream rather than memory.**
`acme_server` issues **12h** certificates by default. Proxmox renews from a daily timer, and
only when a certificate expires within 30 days — so the default leaf is expired for most of
each day, and the failure looks like "certificates randomly stop working". Raising it runs
into the next constraint: a leaf cannot outlive its signing intermediate, whose lifetime
defaults to **7d**, and asking for more returns a `500` rather than an explanation. The guide
recommends `168h` with `intermediate_lifetime 30d` and says why both numbers exist.

**It also documents a trap this repo created for itself.** A name resolves to one address, so
a backend that is already a *proxied route* has its name pointing at Caddy — and an http-01
challenge for that name validates against Caddy instead of the backend. The fix turned out to
be something built four days ago: stop proxying it and make it a **machine**, `dns_only`,
resolving straight to the host. Phase 21 answered a question Phase 12 had not asked yet.

With this, Phase 12 is complete — 12a in Phase 19, 12b as Phase 22, 12c here — and it stayed
open, wrongly marked complete in the archive, for almost two months.

**And writing it down found a defect immediately.** Sunde's first question about the advice —
*"how do we show the entry on the dashboard when we stop proxying it?"* — had the answer "with
a broken link". `list_routed()` includes machines, so a machine produced a launcher card
pointing at `https://proxmox.<domain>` with no port: `:443`, where nothing listens. The source
comment claimed "the card just names the host" while the line under it built an `https://` URL.

**Machines are now excluded from the dashboard**, on Sunde's preference and for a reason worth
keeping: an address has no port to link to, and the port is not derivable — `:8006` for
Proxmox, `:5000` for a NAS, none at all for a box that only answers SSH. A per-machine link
port was considered and rejected: it would add a field to say what a *route* already says, and
a route linked to the machine follows it when the host moves. So the documented way to put a
backend's UI on the launcher is a second name, routed at its port — which is the same two-name
arrangement the ACME trap already forces.

## 2026-09-27 — ACME support removed, hours after being finished

Sunde, once the Docker switch was working: *"Did we just add a bunch of unnecessary logic and
complexity? instead of simply keeping it to internal root verification?"* The honest answer
was mostly yes, and the more useful admission is that **I never offered removal as an option**
— the framing had been fix-or-improve when it should have been keep-or-drop.

The evidence was already on the table. Two of the day's defects existed *only* because a
second TLS mode did: the provider hardcoding that made `TLS_MODE=acme` work for exactly one
provider, and the ACME branch of the LXC script that missed both Caddyfile fixes because it
wrote its own config. By the end the 404 and `:80` logic lived in three files that had to
agree — in a repo whose stated recurring failure is that kind of drift.

**What made it cheap to remove is what Sunde put his finger on:** Loskai has no ACME code.
Every write it makes to Caddy is `PUT …/routes/0` or `DELETE /id/<id>`; it never writes a
Caddyfile; `push_all` only touches ids matching instances. So "ACME support" was two example
configs and a build stage, and deleting them changed no application code and no tests. The
script came out 86 lines lighter with one Caddyfile path instead of two.

**The option is not gone, only the code.** The backlog idea stays, `certificate_tab: hidden`
stays, and Phase 24 keeps its write-up under a superseded banner — because the two commits it
names *are* the recipe: `git revert` restores the lot. Which is the argument for deleting
speculative surface generally. Version control already remembers it; the repo does not have to
carry it.

## 2026-09-27 — The ACME path was only ever wired for one provider

_Superseded hours later: ACME support was removed outright (the entry above)._

Weighing public certificates turned up a defect in a path that has shipped for weeks.
`CADDY_DNS_PLUGIN` looked configurable and drove `caddy add-package`, so the correct plugin
was installed — but the Caddyfile the script wrote said `dns duckdns {env.DUCKDNS_TOKEN}`
regardless, and the closing instructions admitted it: *"swap CADDY_DNS_PLUGIN + the tls
directive if your provider isn't DuckDNS."* A variable whose documented use requires a manual
edit afterwards is not a variable.

It is now derived: `CADDY_DNS_PROVIDER` comes from the module path, `CADDY_DNS_ARGS` carries
whatever follows it, and `TLS_MODE=acme` without a plugin **fails with the module list**
rather than defaulting to a provider the user does not use. The `ARGS` indirection exists for
one concrete reason rather than generality: providers do not share a credential shape, and
acme-dns — the likely answer for a registrar with no API — needs four fields where Cloudflare
needs one.

**The co-located Docker path was closed the same day**, and the interesting part was why it
had lagged: a DNS plugin is compiled into the binary, so an env var cannot add one the way
`caddy add-package` can on the LXC, and a Caddyfile has no conditionals, so one file cannot
serve both modes. Build targets plus a second Caddyfile solve both — `CADDY_BUILD` picks the
binary, `CADDY_CONFIG` picks the file, and both files ship in both images so only the binary
differs.

Writing the negative test is what made it correct. Checking that a *stock* image refuses an
ACME config, I found it accepted one — because `docker build` with no `--target` builds the
**last** stage, and `acme` was written last. The default build had been quietly producing a
Go-compiled binary with a plugin nobody asked for. Stage order is now load-bearing and says so.

**The question that prompted it was the more interesting one.** Sunde asked whether Loskai
needs anything at all for public certs, or "a simple env variable". The answer is that the env
variable already exists (`CERTIFICATE_TAB=hidden`) and Loskai needs no code: it pushes routes
and never touches cert material. But testing turned up a wrinkle — the 409 "nothing to
install" path cannot fire, because **Caddy materialises its `local` CA whether or not anything
signs with it**, so `/pki/ca/local` always returns a root. The setting is the mechanism, not a
fallback for auto-detection that quietly never happens.

## 2026-09-24 — "The setup page is redundant now" — half right, and the half that isn't matters

Sunde's observation was correct about the page: `/certificate` hands out the same root over a
connection that needs no trust, so the `:80` onboarding site is no longer the primary path.
The trap was what deleting it would take with it. Measured rather than assumed: a Caddy whose
Caddyfile has a real HTTPS site but **no `:80` block** comes up with only `srv0` on `:443` —
no port-80 listener at all. That block is what creates the server 12b's `http` and `both`
routes are pushed into, and without it those schemes have nowhere to land and a bare hostname
gets connection-refused rather than a redirect.

So the fix was to stop it **claiming every name**, not to remove it. The block now leads with
a matcher on `*.{$BASE_DOMAIN}` that redirects those to HTTPS; the page answers everything
else, which in practice means browsing to Caddy by IP.

**Keyed on the domain, not an IP, and that was the interesting decision.** Sunde asked whether
the supplied host IP could be used, or detected. Neither: `config.py`'s `host_ip` has recorded
since it was written that a bridged container cannot detect its own host IP, `HOST_IP` is
optional, and the Caddy container is handed only `BASE_DOMAIN`. Scoping to an IP would have
*added* a required setting to make a wart go away — where the domain Caddy already has does
the same job automatically.

The live run also confirmed the layering 12b depends on: an `http`-scheme route still proxies
on `:80`, because Loskai's routes sit at index 0, ahead of anything the Caddyfile compiles to.

**Both fixes had a twin that nearly missed them.** `create-caddy-lxc.sh` fetches
`caddy/Caddyfile` from the repo in internal mode — one config, no drift, which is why that
path inherited them automatically. Its `TLS_MODE=acme` branch writes an inline Caddyfile
instead, and that one had a handler-less wildcard block and **no `:80` server at all**: the
empty `200` for unrouted names, and nowhere for Phase 22's `http`/`both` routes to be pushed.
Caught by asking where else a Caddyfile is written, not by any check — `check-docs.sh` cannot
see into a heredoc in a shell script.

**The same block now answers unrouted names with a 404**, closing a backlog item open since
2026-09-05. The wildcard site was handler-less — cert-only — which compiled to a terminal
route returning an empty `200`, so a name with no route looked like a broken service rather
than an unassigned one. It now returns a small page naming the host. A 404 rather than a
redirect to the dashboard because that is what proxies do: redirecting changes the URL under
the visitor and hides the cause. There is no link home, for the third time in one day for the
same reason — Caddy does not know Loskai's address, and Loskai cannot detect its own.

## 2026-09-24 — Phase 12b, seven weeks late: the per-route scheme

The last unbuilt piece of Phase 12, approved 2026-08-03. An instance gains
`scheme: "https" | "both" | "http"` — one enum rather than two booleans, since two checkboxes
admit a both-off state that means nothing.

**The August specification had already worked out the rule that September proved.** It said
the `:80` route must be inserted at index 0, because that server's cert-setup site ends in a
catch-all and Caddy's automatic HTTP→HTTPS redirects live there. A month later the 2026-09-05
live smoke found the *same* rule was needed on `:443`, for a different first-route-wins
reason, and cost a day to diagnose. The knowledge was in the repo the whole time — which is
the same lesson that phase's write-up already records, arriving a second time.

**Three details carry the design.** The `:80` server gets its *own* selector rather than a
loosened one, because a reverse-proxy route pushed into the cert-setup site would be served
without TLS by accident. `both` means two Caddy routes with two ids, so "synced" had to become
"all expected ids present" and teardown had to remove both unconditionally — the stored scheme
may have changed since the push. And `http` works by **absence**: keeping the name out of the
`:443` server is what stops Caddy trying to issue a certificate for it, which the live run
confirmed the only way that counts — `curl -v` gets `tlsv1 alert internal error`, because no
certificate for that name exists.

**The backend was finished before the obvious flaw showed up.** Every link Loskai hands out —
the assign response's `url`, the public dashboard's cards, the Docker tab's routed-container
link — was a hardcoded `https://`. An http-only route linked that way cannot connect, and the
dashboard is the one surface a non-admin actually uses. Found by reading the UI after the
routing worked, not by any test, and fixed with the scheme carried through to the card and the
container row.

## 2026-09-23 — The three defects the smokes had left behind

Cleared the backlog items that came out of the September smokes, plus a claim of mine that was
simply untrue.

**A `container` naming nothing is now a `404`.** The link is by container *name*, and the
orphan sweep matches the same way, so a name matching nothing produced a working route that
the Routing tab then reported as orphaned while the same row read `synced`/`up` — failing as a
success. The interesting part was where to check it: putting it inside `assign()` broke two
unit tests within seconds, because that function takes its Caddy and AdGuard clients as
arguments precisely so fakes can drive it, and the Docker singleton would have been a hidden
dependency. It belongs in `post_route`, beside the other singleton lookups. **Docker being
unreachable means "unknown", not "invalid"** — creating a route must not start depending on
the Docker socket.

**The success banner reads the response instead of asserting.** `caddy: "skipped"` now says
"DNS rewrite created."; only a real route claims a route.

**Change URL can link a route to a machine — and unlink it**, with `machine: null` meaning
exactly that. This closes the gap left by 21a, and corrects something I had told Sunde: that
such routes could be relinked "by re-picking the machine in Change URL". That form had no
machine picker, so the instruction was impossible to follow. Now it is true, and proven the
only way worth trusting: a route created *without* a link was linked through that form, and
moving the machine afterwards reported `relinked: ["legacy"]` with the upstream following to
`.231:8099`.

## 2026-09-21 — The creation model split in two, after all

Sunde asked a third time: "I still want you to split up the dns-only (machine name model) and
add routes model." The measurement that argued against splitting the *flow* still holds — and
it is not what was being asked. The split is of the **models, endpoints and forms**; the
orchestration underneath stays one function, so the rollback, AdGuard's exact-pair cleanup and
the machine propagation still exist exactly once.

`POST /api/assign` is gone, replaced by `POST /api/machines` and `POST /api/routes`. Each
takes only the fields its verb means: a machine has a possibly-dotted hostname and a bare
address; a route has a single-label prefix, a `host:port` upstream, TLS and its links. The
practical gain is that impossible combinations stopped being *ignored* and started being
absent — `upstream_tls` on a machine was accepted and silently dropped before. The UI followed:
a dedicated `AddMachineModal`, a picker with no DNS-only toggle, and Change URL dispatching on
`kind` so a machine is edited as a machine.

**The cost showed up immediately, and it is the cost the measurement predicted.** The new
machine form did not lowercase a typed hostname, which `useRouteFields` had done since Phase
15 — one rule, now two places to implement it. Its own test caught it before anything shipped,
which is the argument for writing the tests with the split rather than after.

One thing the split made conspicuous rather than caused, **fixed the same day**: naming a
machine required Caddy to be reachable, because the dns_only path called `delete_route` to tear
down a route a previous proxy assign may have left. With Caddy down that was a `502` for an
operation with no route in it.

The teardown is now **required only when converting** — when the instance being renamed to a
machine actually had a proxy route. That case must still fail loudly: a surviving Caddy route
would go on answering a name the instance no longer proxies, which is worse than a refused
edit, so it aborts and rolls back. Every other path treats the delete as best-effort, because
there is nothing to delete. Both halves were checked against a stopped Caddy: naming a machine
returned `200` and the name resolved; converting a live route returned `502` and left the row
exactly as it was.

## 2026-09-21 — Three questions about machines: measured, then mostly answered "no"

Sunde asked whether to split the add flow and model into reverse-proxy and `dns_only`
versions, whether machines want their own schema, and whether the two should reference each
other. Measuring first changed the answers.

**The add flow stays one function.** `assign()` carries four behavioural branches on
`route_mode`; the other ~180 lines — dedup by `container`/`origin`, the uniqueness check,
Step 0/1/2 with its rollback, AdGuard's exact-pair cleanup, the machine propagation — are
shared, and they are exactly the parts where two drifting copies would do real damage. What
the split was *for* is call-site clarity, so `assign_route()` and `name_machine()` now wrap the
one orchestration. Ten lines, no duplication.

**Machines keep living in `instances.json`.** A separate schema would contradict the founding
decision that a container and a LAN service are the same struct with a different `type` — and a
machine fits that exactly: same struct, `upstream` holding an address instead of an address and
port. A second store would mean second CRUD, second endpoints, and a Routing table merging two
sources, to buy separation `route_mode` already provides.

**The reference they were reaching for already existed** — `machine`, from 21b — so the work
was making it *visible*: views over the one table (All · Services · Machines · Grouped, default
both, grouped nesting services under the machine that hosts them), and resolving the `via` tag
to the machine's current name rather than the id it was created under.

**The question that produced the most useful answer was Sunde's aside** — "I'm assuming the
machine will self update if we make a name change or even IP change?" An IP change propagates
(21b). A *name* change keeps every link, because the link is by instance id and an edit never
changes it; nothing propagates because dependents hold an IP that did not move. But the tag
rendered that id, so a renamed machine would have left its routes labelled with a name it no
longer answered to — found by writing the test to answer the question, not by using the app.

**Closed the same day:** `is_machine()` was an inference — "the upstream has no port" — read in
three places, two backend and one frontend. It is now a declared `kind` on the record, set from
the verb that assigned it. The interesting part is that it needed **no migration**: a
before-validator fills `kind` from the old rule only when the field is absent, so old records
read correctly on load, a stored value always wins, and the next write persists it. Checked
against a hand-written pre-`kind` store rather than assumed, including that a back-filled
machine still accepts links and propagates a move.

`kind` is close to a synonym for `route_mode` today, and that is worth saying plainly. What it
adds is that it describes what an instance *is* rather than how it is published — which is what
the `machine` link actually cares about — and it takes a string-shape guess out of three call
sites.

## 2026-09-20 — Machines as upstreams, and what that settles about the tab split

Out of the Devices-tab conversation came a better idea than the tab: let a named machine be
something a proxy route can *point at*, so External in the Add route picker becomes a list
like Container and Network rather than a free-text box. **The data model already supported
it** — an instance may exist without a subdomain, and `container`/`origin` are precedents for
a link field — so a "machine" is not a new concept, just an instance whose upstream is a bare
IP.

**It also resolves the split question in a way the tab never did.** If machines are things you
pick *from*, they need somewhere to be created, which is an argument for a second *button*,
not a second tab: route creation stays one surface, and "name a machine" is simply a different
verb. Decided in a Q&A: a real link rather than a copied address (change a machine's IP once
and every route to it follows — the `BASE_DOMAIN` lesson applied to upstreams), the second
button, and staging it so the pick list lands first without a schema change.

**21b followed the same day, and two decisions moved during implementation.** The plan said
the upstream would be *derived* from the machine at push time; it is instead **rewritten
eagerly** when the machine moves. Deriving would have meant a lookup in `build_route`, in the
routing table's display and in the health join, and `upstream` would no longer have been what
Caddy dials — a second source of truth for the sake of one write. Rewriting dependents inside
the machine's own assign keeps `upstream` literal, and a failed re-push is self-repairing
because the *store* already holds the new address and Sync pushes the store. And deleting a
machine **unlinks** its routes instead of refusing: they keep a working address, so blocking
would be gatekeeping for a case that isn't destructive — Phase 18's walk-back of the boot
guard is the precedent, and this followed it deliberately.

The live run made the propagation visible in a way tests cannot: after moving the machine to a
fictitious `192.168.10.231`, the route answered `502`. That failure *is* the evidence — Caddy
had genuinely been re-pushed and was dialing the new address — and re-pointing at the real one
served `200` again.

**21a shipped the same day and needed no backend at all** — `/api/caddy/routes` already
returns every instance with its upstream. Two details are load-bearing. The list is *not*
filtered by whether a machine is routed, unlike the other two sources, because you are
borrowing an address rather than routing the thing. And picking a machine fills the upstream
but deliberately leaves the prefix empty: prefilling `nas` would collide with the name the
machine already answers to, since the route is a service *on* it. Both are pinned by tests.

## 2026-09-20 — A Devices tab, measured and dropped

Considered splitting `dns_only` rewrites into their own tab, leaving Routing for reverse
proxy + TLS, with the tab populated from AdGuard's device discovery. **Not now — the
discovery half is blocked on a precondition that may well be met later.** This is a
deferral, not a dead end: if DHCP ever moves to AdGuard the measurements below change
completely, and the idea should be picked back up rather than treated as settled.

**AdGuard cannot enumerate the LAN.** It has no scanner: a device is known only once it
talks to AdGuard, and it is named only if one of four sources supplies one — hosts file,
rDNS, the ARP table *of the machine AdGuard runs on*, or AdGuard's own DHCP leases.
Measured read-only against the live AdGuard LXC (v0.107.78): 10 runtime clients, of which
five were `localhost`/ip6 noise; **five real hosts, four of them from ARP with no name at
all**, one named by rDNS. DHCP disabled, so no lease table. A Devices tab today would list
four IPs and miss every phone, TV and the NAS.

**The precondition that would revive it:** move DHCP from the router to AdGuard. Its
lease table (MAC, IP, hostname) is a real inventory and "name this device" on top of it
would be worth building. That makes AdGuard a single point of failure for the whole LAN
and reverses `adguard-api.md`'s out-of-scope note on DHCP — an infrastructure decision, not
a UI one. Loskai doing its own ARP/ping sweep was rejected outright (containerised, needs
host networking, intrusive), as was parsing a router's leases (vendor-specific).

**The tab split was judged separately and also dropped.** It needs no discovery, but it
reverses Phase 13's "one inventory of named things" and would add a second route-creation
surface — the exact thing the consolidated Add route picker exists to prevent — against a
Phase 14 precedent of *reducing* tabs. Sunde: "lets forget about this then, and just keep
dns and proxy on routes." A filter or two sections on the one Routing page remain available
if the mixed table ever grates.

**Noted in passing, unrelated to the tab:** the live query log's last 500 entries came from
a single client IP, so almost nothing on that LAN currently uses AdGuard as its resolver —
which is what any rewrite, in either mode, depends on.

## 2026-09-20 — A reset for AdGuard's rewrites, and what it does to an old decision

Changing `BASE_DOMAIN` mid-development exposed a gap nothing in Loskai could close. Rewrites
under the old domain are invisible to the orphan sweep, because `is_loskai_domain` scopes it
to the *current* base domain, and an unassign builds its delete pair from the current domain
too — so it deletes a name that doesn't exist and strands the real one. The scoping is
deliberate and stays: it is what keeps the sweep off hand-added entries.

**The decision it revisits is from 2026-07-10** — "per-entry API + exact-pair delete means
hand-added rewrites are never touched" — and Sunde's framing is that it predates `dns_only`.
That is right, and it changes the premise. When Loskai could only name HTTP services behind
Caddy, AdGuard obviously held entries Loskai had no business touching. With `dns_only`, Loskai
can name anything on the LAN, so being *the* manager of rewrites is a coherent position — and
a tool that wants to be the manager needs a way to adopt a box that already has some.

**So the rule is unchanged and a new action sits beside it.** `POST
/api/adguard/rewrites/clear` deletes every rewrite, hand-added ones included, then reconciles
Loskai's own back. Every delete still names its exact `(domain, answer)` pair, and no
automatic path — assign, teardown, reconcile, the sweep — touches a foreign entry. The
difference is that this one is asked for, in a dialog that says what is lost.

**The restore is in the same call, not a second button.** A separate resync already exists
(Sync, on Routing), and a clear that doesn't restore leaves the LAN without working names
until someone presses it. Reconciling against a list we just emptied is also what makes
duplicates impossible: every routed name is missing, so each is added exactly once. Confirmed
live — a second clear left the same two rewrites.

**The dialog shows the list, same day.** Sunde: "a little quality of life would be a spoiler
menu where we can see all the entries in AdGuard DNS rewrite that we are removing." A warning
that says "every rewrite" is only trustworthy if you can check it, so `GET
/api/adguard/rewrites` returns the list annotated with `managed`, and the dialog puts it behind
a collapsed disclosure that leads with the count of what will *not* come back. `managed` is
computed by reusing the `rewrite_domain`/`target_answer` pair the restore itself uses, not by
re-deriving the rule — otherwise the preview and the action could disagree, which would be
worse than no preview. It catches the case that isn't obvious: a hand-added answer on one of
Loskai's *own* names is marked not-restored, because reconcile writes its own answer back, not
that one.

**One follow-up from using it:** the list chained its scroll into the page behind the dialog
once it hit the end. `overscroll-contain` fixes it, and the fix was measured in a browser
before and after (`0 → 240` became `0 → 0`, with in-list scrolling intact) because jsdom has
no layout and the test suite cannot see this class of bug at all — the same blind spot the
2026-09-05 route-ordering defect exploited, in a much smaller way.

That fix stopped the list handing the gesture over; it did not stop the page moving when the
wheel was over the backdrop instead, so **`useScrollLock` now freezes the page for all four
overlays** — `ConfirmDialog`, `Modal`, `AddRouteModal`, `AssignModal`. Applying it to one
dialog would have left the others inconsistent for the same gesture. It is ref-counted
because a ConfirmDialog can open inside a Modal, and the inner one closing must not hand
scrolling back while the outer is still up; it restores whatever `overflow` was there before
rather than blanking it. This half *is* unit-testable — `body.style` needs no layout — so the
five cases are pinned in jsdom, and the browser only confirmed the gesture end to end.

**Preconditions moved ahead of the deletes.** `reconcile` used to check the base domain and
answer IP itself; that check is now `_check_reconcilable`, shared by both, and the clear runs
it before touching anything. Otherwise a `proxy` instance with no derivable answer IP would
wipe the list and then fail, leaving DNS empty — the failure mode that matters most here, and
it is now a `400` that deletes nothing.

## 2026-09-16 — The Phase 13 smoke: `dns_only` against a real AdGuard

The last archived smoke that had never run, done the same day as 10a. It needed a real
AdGuard, so the dev rig's AdGuard was taken through its first-run setup via
`/control/install/configure`, the call its wizard makes. **It passed, and nothing needed
fixing.** The full step-by-step result is in `todo-archive.md` Phase 13.

**Every step went through the UI and was checked outside Loskai.** The picker and Change URL
built each request, which kept 10a's lesson: a request written by hand can differ from what
the UI actually sends. The state was then read straight from Caddy's config, AdGuard's rewrite
list, and a real DNS lookup. The claim most likely to break was the flip, because a rewrite has
no ID: moving a name from its own IP to Caddy's is a delete of the exact old `(domain, answer)`
pair followed by an add. A wrong answer in the delete would leave two rewrites for one name,
and clients would resolve it to either one. The list held exactly one rewrite after each flip.

The smoke also flipped the route back to `dns_only`, which the checklist didn't ask for, to
confirm Stage A's teardown of the Caddy route on that switch. One cosmetic defect turned up and
is in the backlog: the success banner's text is fixed, so a `dns_only` assign claims it
created a route.

## 2026-09-16 — The Phase 10a smoke, and the Certificate page in a real browser

Both open items ran together on the dev VM, since one rig covers them: `compose.dev.yml`'s
Caddy for the `:80` onboarding site, and a backend on a spare port serving the built bundle.
**Both passed, and nothing needed fixing.** The results are ticked in `todo-archive.md`
Phase 10a and `TODO.md` Phase 19.

The strongest single check was a `curl --cacert` pointed at the root the `:80` page hands out,
with no `-k`, against a route pushed through the real Add route picker. It proves the root
validates the leaves Caddy actually issues, which is Phase 10a's claim. The browser half ran in
Chromium **and** Firefox, because `Certificate.tsx` revokes the blob URL immediately after
`a.click()`, a pattern known to race in Firefox. It didn't: the saved file was byte-identical.

**No browser could run on the VM without `sudo`** — Playwright's Chromium needs system
libraries (`libatk` and others) that aren't installed. Running the script inside
`mcr.microsoft.com/playwright` with `--network host` needed neither root nor a project
dependency. The script lived in a scratch directory and nothing was added to `frontend/`.

**One false alarm, recorded because it looked like a defect.** The Routing tab reported the
smoke's route as orphaned ("the container was removed") while the same row read `synced`/`up`.
The cause was the smoke itself: the first assign was posted by hand with the container's
short **ID**, and the link key is the container **name**. The orphan check was right. The real
gap is that `/api/assign` accepted a `container` that matches nothing and returned `200`; it is
now in the backlog. Redone through the picker, which sends the name, the banner didn't appear.

## 2026-09-14 — Three follow-ups to the `LOSKAI_DATA_DIR` default

A review of the 2026-09-10 commit found that repointing the default at the repo's own `data/`
had a consequence outside the code it touched: **the test suite's isolation had been leaning on
that path being unwritable.** `conftest.py` resets every setting to its no-`.env` value, so
`data_dir` now resolved to the developer's real `data/` — holding a live admin password hash and
instance list. Every test that touches the store sets its own `data_dir` fixture, so nothing
failed and nothing was written; but a test that forgot one used to die with `PermissionError`,
and would instead have read live state, with `POST /api/auth/setup` or `PUT /api/settings`
overwriting it. The conftest fixture now points both path settings at `tmp_path` (created, since
`stacks_dir_ok()` distinguishes a missing directory), and `test_isolation.py` — a file that
deliberately sets no paths of its own — asserts it.

Two smaller ones from the same review. The **Dockerfile** now sets `LOSKAI_DATA_DIR=/data`
itself: the 2026-09-10 entry's point was that production must not depend on `_REPO_ROOT`
landing on `/` by accident, but only the three compose files closed that gap, leaving a plain
`docker run` or a third-party stack on the coincidence. And `dev-testing.md` now warns against
running the dev backend beside a Loskai container on the same host — since the default moved,
they share `./data`, and `store.update_json`'s lock is per-process, so an interleaved
read-modify-write loses one side silently. That page's `PermissionError` row also gained its
second, now likelier cause: `data/` left root-owned by a compose run.

## 2026-09-10 — `LOSKAI_DATA_DIR` becomes explicit in compose, and defaults beside the repo

Phase 18 moved the state mount to `./data:/data` but left `config.py`'s `data_dir` default at
the bare in-container `/data`, so the two env-only paths ended up asymmetric: `stacks_dir` was
anchored to the repo root and needed no configuration to run the backend directly, while
`data_dir` still had to be set by hand or the process died on `PermissionError: '/data'` before
serving a request. Phase 18's own write-up records that as intended ("`LOSKAI_DATA_DIR` stays an
override, and dev sets it"), and `dev-testing.md` carried a troubleshooting row for it — the
same shape as the `/opt` row that phase had just deleted, which is what prompted revisiting it.
Sunde's read: defaulting it too "will simplify the process of setting it up with different
configuration if someone wants that."

**The default is now the repo's own `data/`, and all three compose files pass
`LOSKAI_DATA_DIR=/data` explicitly** — the pattern `stacks_dir` already used. Running the
backend under `uv` needs nothing set; the container is told its path next to the mount that
path has to agree with, a few lines apart, where a drift between them is visible in one screen.

**The tempting version of this change is wrong for a non-obvious reason.** Just repointing the
default at `_REPO_ROOT / "data"` and leaving compose alone appears to work in both contexts,
and that is the trap. `_REPO_ROOT` is `parents[3]` of `config.py`, the image installs the
source at `/app/src` (editable, via a `.pth`), so in the container `_REPO_ROOT` is **`/`** —
not `/app`, as a comment in `config.py` had claimed since Phase 18 — and `/` + `data` lands on
`/data` by pure accident of how deep the source sits. Move the source in the Dockerfile and
Loskai writes to an unmounted directory in the container's writable layer, losing state on the
next recreate, with nothing failing at the time. Another fails-as-a-success, of the same family
as the empty `200` and the nested `mv`. The explicit compose line is what makes the production
path not depend on that coincidence; the corrected comment names `/stacks` as the real
unmounted fallback, which still surfaces honestly as `stacks_dir_ok: false`.

Phase 18's entry above is left as written — it describes the repo as it was then.

- Key files: `backend/src/loskai/config.py`, `compose.yml`, `compose.colocated.yml`,
  `compose.caddy-loskai.yml`, `.env.example`, `docs/guides/deployment.md`,
  `docs/contributing/dev-testing.md`, `docs/guides/migration.md`, `scripts/deploy.sh`

## 2026-09-09 — Phase 19: the root CA comes out of Loskai, not just Caddy's `:80` site

Sunde asked for a download button on the Caddy pill in Routing. Working out where the bytes
would come from turned it into a page, and moved a line this project had drawn since Phase 10a.

**Loskai is now in the cert path — deliberately, and narrowly.** `certificate-setup.md` used to
open with "Loskai handles **zero** certificate material… Loskai is never in the path", and that
was a real invariant, not throwaway prose. It still holds for everything that matters: no key
material, no ACME token, no issuance. What changed is that Loskai now *serves* the internal
**root CA**, which is public by construction — its entire purpose is to be installed on every
device on the LAN. The invariant was about secrets; it had been written broadly enough to also
forbid something harmless.

**Why the obvious version doesn't work.** A button linking to `http://<caddy-ip>/caddy-root.crt`
is one line of JSX and fails in the case it exists for: Loskai is normally reached over HTTPS
through Caddy, and Chrome and Edge block a plain-HTTP download started from an HTTPS page —
silently, with no error the page can see. Same family as the empty-`200` defect from 2026-09-05:
it fails as a success. Serving the PEM from Loskai's own origin is what makes it work at all.

**Why the Admin API and not Caddy's disk.** `GET /pki/ca/local` returns the CA's public
description; the `:80` site instead reads `/data/caddy/pki/authorities/local/root.crt` off the
volume. The file is simpler and only exists where Caddy and Loskai share a host — in split-LXC
(A) Caddy's disk is on another machine, while Admin API reach is a precondition for Loskai
functioning at all. `caddy-api.md` had listed `/pki/...` under *Not used*, described as a
"confirmed dead end for our cert" — accurate, but about the deferred **expiry** feature, not
about handing out a root. Narrowed rather than deleted.

**The page is public, and that is the point.** The device that needs the root has no admin
password and cannot yet trust the HTTPS route it would log in over. `GET
/api/caddy/root-certificate` joins `PUBLIC_ROUTES`. Sunde asked for the tab's visibility to be
configurable, since an ACME deployment has nothing to install — so `certificate_tab`
(`public` / `admin` / `hidden`) moves the sidebar link. It was tempting to make `admin` a real
gate; it isn't one, and pretending otherwise would have meant a second route checking the
session itself — the pattern deliberately confined to the exec WebSocket — to protect a
certificate that is meant to be handed out. The tests pin that `/certificate` stays reachable
in `hidden` mode.

**Sunde's port question, answered:** none. Caddy publishes `80`/`443`, Loskai `8080` — different
containers, and Loskai never binds `:80`. The real edge is next door: `caddy/Caddyfile` uses a
bare `:80 { … }`, matching every hostname on that port and displacing Caddy's automatic
HTTP→HTTPS redirects. `certificate-setup.md` has recommended scoping it to the host IP since
Phase 10a and the shipped co-located Caddyfile never did. Flagged, not fixed. It also has to go
entirely on a move to public ACME, which needs `:80` for the HTTP-01 challenge — one more reason
the durable home for this is a Loskai page.

**Phase 12a, closed on the way past.** The trust-install page printed
`update-ca-certificates` — a Debian tool that does not exist on Fedora, which is what Sunde's
own desktop runs. Both pages now carry Debian, Fedora/RHEL and Arch/openSUSE commands. Chrome
and Chromium on Linux read their own NSS database rather than the system store, so the
system-wide install alone left the warning in place in the browser most people use; that step
is now there too.

## 2026-09-09 — Phases 14–17 archived; `CLAUDE.md` said Phase 16 was still open

Second archive move, same reasoning as the 2026-08-27 one (Phase 15, D1): `TODO.md` is read
at every session start, and at 966 lines it had stopped being a file anyone reads and become
one they skim. Phases 14–17 are all closed, so they went to `todo-archive.md` and it dropped
to 159. Only Phase 18 stays written out, as the most recent work.

Two things the sweep turned up, both the same failure this project keeps naming as its
recurring one.

**`CLAUDE.md`'s Project state still said Phase 16 was "the live one" with "the one thing left
is a live smoke only Sunde can run".** That smoke ran four days earlier, found a defect that
had broken every route in two of three layouts, and closed the phase. The file that is read as
ground truth at the start of every session was describing a state that no longer existed —
which is precisely what the 2026-09-02 audit found four instances of, and precisely what
`check-docs.sh` cannot catch, because prose about status is not a link or an enumeration.

**Phase 12 was archived as complete on 2026-08-27 and is not complete.** It has no completion
marker and every item under it is unchecked: 12a (the trust-install page prints Debian-only
Linux instructions that silently do nothing on Fedora/Nobara — a live defect on a page users
are told to follow), 12b (the per-route scheme toggle, *approved* 2026-08-03, unbuilt), 12c
(Caddy as ACME server, docs only). The archive header says "nothing here is live work"; that
was untrue the day it was written. `TODO.md` now carries an **Open, not in flight** section so
the unfinished work is visible without unpacking a phase back out of the archive.

**And 12b already knew the thing that broke every route.** Its notes say, verbatim and dated
2026-08-03:

> **Must insert at index 0** (`PUT /config/apps/http/servers/{s}/routes/0`), not append: the
> `:80` server's cert-setup site ends in a **catch-all** (an appended route would never match)

That is the 2026-09-05 defect, reasoned out correctly, a month early — for the `:80` server.
Nobody asked whether the `:443` server had the same shape, and it did: a handler-less terminal
wildcard sitting first. The knowledge was in the repo the entire time the bug was shipping. It
is a sharper lesson than "we never ran it": a constraint discovered for one instance of a
pattern needs to be checked against every other instance, and the natural place to have caught
this was `caddy-api.md`, which instead asserted the opposite in its *Not used* list.

**Two live smokes in the archive were never run**, both written when there was no daemon to
test against and both unblocked now: Phase 10a (the cert-onboarding page via `compose.dev.yml`)
and Phase 13 (`dns_only` mode against a real Caddy and AdGuard).

The archive header flags Phase 16 too, since a reader who never opens the archive still needs
to know that routes are inserted at the head and why. The current-state versions of that fact
live in `caddy-api.md` and `troubleshooting.md`; the archive is the story, not the contract.

`PLAN.md` needed almost nothing — the route-ordering, `/data` and `./stacks` facts had all been
corrected in the same commits as the behaviour, which is the rule this project has and mostly
keeps. It gained one paragraph: that `${PWD}/stacks` implies compose must be run from the
project directory, which is architecture rather than deployment detail.

- Key files: `TODO.md` (966 → 159 lines), `todo-archive.md` (480 → 1293), `CLAUDE.md`
  (Project state rewritten, archive pointer updated), `PLAN.md` (same-path callout)

## 2026-09-05 — Nothing lives in `/opt` any more

Running Loskai for the first time (above) had a second consequence beyond the route bug: it
showed how much friction the paths carried. `STACKS_DIR` defaulted to `/opt/stacks` and
`LOSKAI_DATA_DIR` to `/opt/loskai`, both of which need root to create, so the smoke could not
start until both were pointed somewhere else. That was not a discovery so much as an
admission — `dev-testing.md` already carried a troubleshooting row for
`PermissionError: '/opt/loskai'`, and `.env.example` shipped `STACKS_DIR=/opt/stacks` with no
`LOSKAI_DATA_DIR` line at all, so copying it and running `make backend` produced that error by
construction. The default was correct for exactly one of the three contexts it is used in, a
container running as root, and wrong for the two a person actually touches.

State is now `./data:/data` and stacks default to `./stacks` beside the compose file. Both
directories are tracked with a `.gitkeep`, which matters more than it looks: Docker creates a
missing bind source as `root:root`, so without them a fresh clone gets root-owned directories
and `data/recipes/` — the folder recipes are *hand-added* to — needs `sudo` for every write.
That was already true before this change; shipping the directories is what fixes it.

**The same-path rule stays, and the reasoning was put to Sunde plainly** because the obvious
improvement is to mount stacks at a tidy `/stacks` and it is the one thing that cannot work.
Loskai runs `docker compose` inside its container while the daemon is on the host, so a managed
stack's `./library:/uploads` is resolved against the container's view and then handed to the
host daemon. Mounted at `/stacks`, that becomes `/stacks/immich/library` — a path at the host's
filesystem root, which the daemon creates as root while the data goes somewhere nobody chose.
Demonstrated rather than asserted, and the answer was the right one: *"i dont care how the file
system inside the docker container looks as long as it works and makes it simple for the end
user — if that requires that the paths on host and docker container mirror each other then that
is what we will do."*

**An in-app startup guard was built, tested, and then deleted in the same session.** It refused
to boot when state was stranded at the old path. It worked; it had five tests, one of them
pinning that it ran *before* `auth.ensure_seeded()`, which writes `settings.json` and would
otherwise have masked the very state it was checking for. It also needed a `conftest.py` patch
so that a developer with a real `/opt/loskai` on disk didn't fail every test that starts the
app. 137 lines.

Sunde pushed back: a missing `settings.json` does mean a first run, and redoing the settings is
not the end of the world. That is right, and the measurements agreed. The destructive case — old
mount kept, `/data` unmounted, writes going to the container's writable layer — needs a
locally-modified compose file to survive `git pull --ff-only`. The case that will actually
happen is a fresh install with the old state sitting untouched on disk, which is recoverable and
is caught host-side by `deploy.sh` right after the pull that swaps the compose file. Refusing to
boot is the convention for *data stores*, where a wrong guess destroys something irreplaceable;
Loskai's state is re-enterable, and the routes themselves live in Caddy keyed by `@id`, so even
the instance list can be read back out of Caddy's config. Wrong category for that machinery. The
guard is gone and `deploy.sh` carries the migration.

**Two things only the live runs caught.** The migration command in the docs and in the guard's
own error message was wrong — `mv loskai-settings data` nests the state at
`data/loskai-settings/`, because `data/` now always exists. And the guard could not see the
common upgrade at all: the new compose file does not mount the old path, so from inside the
container there is nothing to find. Both were found by running it, neither by the tests.

The one sharp edge that remains is documented rather than fixed. The default is `${PWD}/stacks`
because Compose has no interpolation variable for the project directory — `COMPOSE_PROJECT_NAME`
resolves correctly even via `-f` from elsewhere, but no path variable exists. So compose must be
run from the project directory. Run it from elsewhere and stacks point at `<that
directory>/stacks`, which the Stack Manager shows as an empty list rather than an error, because
Docker created it. `./data` is immune, since Compose resolves relative binds against the project
directory; only the same-path variable is invocation-sensitive. Lifting that needs
`--project-directory` paired with `--env-file` — measured to work, and measured to ignore a
stack's `.env` **silently** if the two ever drift, which is the failure shape this session spent
its morning removing. Considered and not taken.

Relocation was tested rather than reasoned about, and is now written up in `migration.md`:
moving the whole install to a new path works untouched (relative binds follow the folder, named
volumes reattach because the project name is the stack directory's basename), while a move to a
new *machine* silently leaves named volumes behind, pins every stored upstream to the old host
IP, and doesn't carry `.env`.

- Key files: `backend/src/loskai/config.py`, the three compose files, `.gitignore`,
  `.dockerignore`, `scripts/deploy.sh`, `data/.gitkeep`, `data/recipes/.gitkeep`,
  `stacks/.gitkeep`, `docs/guides/deployment.md`, `docs/guides/migration.md`,
  `docs/guides/install.md`, `docs/contributing/dev-testing.md`,
  `docs/reference/recipe-schema.md`, `.env.example`, `PLAN.md`, `CLAUDE.md`
- Full checklist and the decisions behind it: `TODO.md` Phase 18

## 2026-09-05 — The first time Loskai was actually run, and it had never routed anything

Phases 15 and 16 both closed on live smokes today, on the dev VM, against a real Docker
daemon. Everything before this was unit tests and static validation: nothing in this project
had ever been *run*. That distinction turned out to be the whole story.

**The Phase 16 smoke passed on the first curl, and the pass was false.** The checklist asked
for "200, not 502". The first request returned `HTTP 200` — with `content-length: 0` and no
`Via` header. The backend served 166 bytes when dialled directly; through Caddy it served
nothing. The route was not proxying at all, and had never been proxying.

`caddy/Caddyfile` declares `*.{$BASE_DOMAIN} { tls internal }` purely so Caddy issues the
wildcard cert. A site block with no handlers adapts to a route with `"terminal": true`, and
the adapter puts it first in `srv0.routes`. It matches every name Loskai routes.
`push_route` used `POST …/routes`, which appends — so every route Loskai pushed landed
*behind* a terminal matcher and was dead on arrival. The fix is `PUT …/routes/0`.

Three things about this are worth keeping.

**It failed as a success.** Not a 502, not a timeout — a 200 with an empty body. Every
individual layer was correct: the route JSON, the upstream, `@id` addressing, `list_live_routes`
finding it. `/api/caddy/routes` reported `synced: true` **and** `upstream_healthy: true` the
entire time it was broken. The defect lived only in the *position* of a correct object inside
an array whose first element Loskai does not own — which no test that mocks the Caddy client
can see, and mocking the client is what all of them do. The `client.py`/pure-logic seam is
still the right architecture; this is simply the class of bug that sits outside it.

**The docs did not merely miss it — they argued for it.** Four places asserted append order
was safe, `docs/reference/caddy-api.md` twice (once in §2, once listing `PUT` under *Not
used*: "not needed; specific-host routes are order-independent, so append is always
sufficient"). The reasoning was half right: Loskai's own routes *are* disjoint from each
other. It never asked what else was in the array. A confidently-argued wrong invariant in a
reference page is worse than an absent one, because it is what a later session reads before
deciding not to check. This project's stated recurring failure is documentation drift; this
was documentation that was wrong on the day it was written.

**The checkbox would have been green.** "200, not 502" was the criterion, and a 200 came back.
Had the smoke been run to satisfy the checklist rather than to see what happened, the phase
would have closed with every route in every co-located deployment silently broken.

Split-LXC in `internal` mode escapes all of this, by accident: `create-caddy-lxc.sh` feeds the
unit `BASE_DOMAIN=localhost` as a placeholder, so its wildcard block is `*.localhost` and
matches nothing. `acme` mode has the real domain and the same defect.

**Measured later the same day, not left as a reading.** Sunde opened up a live split-LXC Caddy,
and it is the clearest possible demonstration: one server holding a terminal `*.localhost` at
index 0, eight Loskai-pushed routes appended behind it, all serving real bodies (`forgejo.sunde`
14264 bytes, `proxmox.sunde` 2657) — while `foo.localhost` on the very same Caddy returns the
empty `200`. The bug and the escape, side by side.

**That comparison is also the answer to "how did this last fourteen phases".** Every environment
Loskai had ever actually been run against carries the placeholder — split-LXC internal, and the
dev rig, whose `dev/Caddyfile` picks `*.localhost` for the same cert-on-demand reason and
explains the choice in a comment. The real `BASE_DOMAIN` only ever reaches that block in the two
configs nobody had brought up. It was not that the bug was subtle; it was that the only places
it could fire were the places nobody had run. The sharp edge is that a developer who sets
`BASE_DOMAIN=localhost` in the dev rig — which the old comment openly invited — reproduces it in
dev. `dev/Caddyfile` now says not to, and says why.

**Layout A got its first live run out of the same session.** `compose.yml` had never been
brought up either. Pointed at that Caddy with no `CADDY_HOST_IP` — which is how the file ships —
`select_server_name` discovered `srv0` from a real two-server config, every container fell to
`lan` with `<host_ip>:<published_port>` (Stage A's D1 decision, live), and the answer IP was
*derived* from the admin URL as `192.168.10.177`, correctly Caddy's address rather than the
Docker host's. The proxy worked across two machines. Most usefully, head-insertion was shown
harmless on a populated config: the new route took index 0, the nine existing entries shifted
down intact, all six reachable ones answered byte-for-byte what they had before, and unassigning
left the config identical to the baseline captured before the first write.

**What the smoke did confirm, and it confirmed a lot.** Stage A's per-container upstream
detection is right in both directions against a real daemon: a container in its own compose
project resolved to `lan` / `192.168.10.220:8081`, and the same container joined to
`loskai-edge` with no published port at all resolved to `docker` / `web:80` — via the compose
*service* label, since the container is `whoami-web-1` and `web` survives only as a network
alias, which is exactly the three-key match Stage A was revised for. Stage B's documented
consumer stanza worked verbatim. Stage C's guard derived a real LAN answer IP. AdGuard left
unset degraded exactly as designed — `caddy: ok, adguard: skipped` with a warning, assign
unaffected. All of that was correct before today and is now known to be, rather than believed.

Phase 15's F5 remainder ran the same afternoon: a truncated `settings.json` aborted startup
naming the path (`CorruptStoreError: /opt/loskai/settings.json is not valid JSON: …`, exit 3,
a visible crash loop rather than a half-running app), and an `instances.json` that was valid
JSON with one schema-invalid row dropped only that row and kept the public dashboard at 200.
The 2026-08-27 decision to split those two behaviours by file holds up under a real operator
mistake.

- Key files: `backend/src/loskai/modules/caddy/client.py` (`push_route`),
  `backend/tests/test_caddy_client.py` (+1, 209 → 210),
  `docs/reference/caddy-api.md` (§2 and *Not used* both rewritten), `PLAN.md`,
  `docs/guides/troubleshooting.md` (the empty-200 symptom, with the three-way signature),
  `dev/Caddyfile` (don't set `BASE_DOMAIN=localhost`)
- The unrouted-name empty `200` — same wildcard block, different symptom — is in the backlog,
  deliberately not fixed alongside

## 2026-09-04 — The layout letters now carry the recommendation; the all-in-one LXC is gone

**B and C swap: A split-LXC (three-way) · B split DNS (two-way) · C all-in-Docker (one box).**
The letters had been recording the order the layouts were *thought of*, not an order a reader
can use. Split DNS was added last, so it got `C` — and every page then had to say "A and C are
recommended, B is the supported alternative", a sentence you have to read twice to extract a
recommendation from. Ordered by how much each layout splits, the letters carry the
recommendation themselves and the degradation is monotonic: each step down merges one more
component onto the Docker host.

What separates C from B is also stated more honestly now. It was written up as a list of costs
alongside two wins, which undersold the one that actually bites: **C is the only layout that
needs the host reconfigured before it will start**, because AdGuard's `53` has to be taken from
`systemd-resolved` by hand. That is a different kind of cost from "DNS shares a fault domain",
and it belongs at the point of choice.

**The all-in-one LXC is deleted rather than kept as documented-but-unsupported.** It was never
an option: Loskai's Docker client dials the local socket, so on its own LXC it loses the Docker
tab, the Stack Manager and the install wizard unless you publish a root-equivalent Docker API
onto the LAN. Recording it under "Considered and not supported" put it one reading away from
looking like a choice, which is the opposite of what that section is for. The **merged single
container** stays recorded there — that one really does get proposed, and the 2026-09-02
reasoning is what stops it coming back.

Older entries in this file and in `todo-archive.md` keep the letters they were written with,
including Phase 16's own text — they record what was decided when, and renumbering them would
make the record agree with today at the price of being false about then. Three current-state
places say so explicitly (`docs/README.md`'s conventions line, `CLAUDE.md`'s topology summary,
the note under `TODO.md`'s **Now**): a letter written before today is the pre-swap one.

- Key files: `docs/guides/topologies.md` (sections reordered A → B → C, every table cell moved
  with its column, All-in-one LXC removed), `docs/guides/install.md` (`C1–C3` → `B1–B3`),
  `docs/guides/migration.md`, `docs/README.md`, `PLAN.md`, `CLAUDE.md`,
  `compose.caddy-loskai.yml`
- Anchors moved with their headings; `check-docs.sh` is what proves no link was left behind

## 2026-09-04 — Split DNS ships, and the edge network is the whole point of it

**Phase 16 Stage B.** Split DNS — AdGuard on its own small always-on box, Caddy and Loskai
together in Docker on the main host — has been the recommended layout for anyone without
Proxmox since 2026-08-30, and the only one that didn't exist. It ships as
`compose.caddy-loskai.yml`.

Most of that file is assembly, deliberately: the Caddy service and the required
`CADDY_HOST_IP` come from `compose.colocated.yml`, the optional `ADGUARD_*` env from
`compose.yml`. Split DNS **is** split-LXC's off-box AdGuard with all-in-Docker's
co-located Caddy, and writing it as
anything more inventive would have been a third dialect of the same two halves.

What is genuinely new is one network. **`loskai-edge` is the reason the layout is worth
having:** Caddy attaches to it alongside the project default, so any stack that joins it is
reachable by service name and a routed container never has to publish a host port — the one
capability no other layout has. Two details decide whether that works in practice. It is
declared with an explicit `name:`, because Compose otherwise prefixes the project and leaves
no stable name for another stack to attach to. And it is created *by* the Loskai stack rather
than by hand, so standing C up remains a single `docker compose up -d` with no
`network create` precondition — at the cost of an ordering rule (the Loskai stack first),
which is the cheaper of the two things to document.

**Stage A is what makes it pay off with no further code.** The per-container detection sees
the shared network and pre-fills `name:port` by itself; `matches_hostname` was already written
for this layout, matching a `<project>-caddy-1` container by its `caddy` alias. That is also
why the one *optional* item on the stage — a "joined to the edge network" badge in the Docker
tab — was not built. The Add route modal already states the fact where the user acts on it
("Caddy shares a Docker network with this container, so it can dial it by name"), so a badge
would be a second surface carrying no new information.

The docs cost more than the compose file. `install.md` gained a second walkthrough rather than
a fork at step 1: split DNS is three steps to split-LXC's four, since Caddy comes up inside
the stack, and only
the first-run step is shared — a fork would have carried two paths through four sections to
converge at the end. And `deployment.md` still opened with "Two compose files, same image",
with a `HOST_IP` row describing the variable as split-LXC-only — a claim **Stage A had already
outdated** and split DNS makes actively harmful, since such a user reads it, concludes the variable
isn't theirs, and gets a blank upstream for every container not on the edge network. The
env-var reference had to move in the same commit as the layout, which is the rule this project
keeps relearning.

The same sweep turned up a worse one. `PLAN.md`'s "Co-located vs External Mode" table still
said `http://caddy:2019` means *"Container names work: `grafana:3000`"* — unqualified, in the
architecture reference, which is the 502 stated as a fact. Stage A had replaced that claim in
the code and in `troubleshooting.md` but never swept `PLAN.md`; it took the stage that ships
the layout the sentence misdescribes to notice. It now says what the mode actually decides
(where Caddy runs, whether `2019` reaches the LAN) with the per-container derivation below it,
minus a second dead sentence promising that `config.py` logs the active mode — nothing does.

- Key files: `compose.caddy-loskai.yml` (new), `docs/guides/topologies.md` (the
  external-network stanzas), `docs/guides/migration.md` (dropping `ports:` after a migration),
  `docs/guides/install.md` (C1–C3), `docs/guides/deployment.md`, `README.md`, `.env.example`,
  `scripts/deploy.sh`
- `check-docs.sh` clean; `pytest` 209 and `npm test` 38 pass, unchanged from Stage A — the
  expected result, since the stage executed no statement (compose, shell and docs, plus one
  comment in `config.py`). Running them at all meant first installing `uv` and node into
  `~/.local` on the dev VM, which had neither
- Left open on purpose: `topologies.md` still calls C *planned* in its comparison table and
  section blockquote — a follow-up pass, since the file was being edited by hand at the time

## 2026-09-03 — CLAUDE.md pinned to the code; the docs checker grows to five checks

An audit of `CLAUDE.md` against the code found **four wrong facts**, each of which had been
read as ground truth at the start of every session: a `VPN` admin tab that Phase 14
dissolved, a security boundary that named only `GET /api/dashboard` when `PUBLIC_ROUTES`
also carries the four login-flow routes, a `docs/todo-archive.md` path Phase 17 moved, and a
phase status two phases behind. This is the failure Phase 15 rated highest-value as F13, back
again — the file that propagates hardest is also the one nothing checks.

Most prose cannot be verified mechanically, but **every one of those four was an enumeration
the code also enumerates**, and those can be pinned. `scripts/check-docs.sh` gained two
checks: `docs/` paths cited from source and config (Phase 17's move left 11 dead pointers in
compose files, `.env.example` and three module clients — invisible to a checker that only
read `.md`), and `CLAUDE.md`'s enumerations against the code (module names vs the package,
admin tabs vs `NAV`, the HTTP route count vs the decorators, public routes vs
`PUBLIC_ROUTES`). A missing anchor phrase is itself reported: a check that silently passes
once its wording changes is worse than none.

A later full audit added a fifth check and found six more stale paths, all sitting in a
link's *display text* while the target was already correct — check 1 validates where a link
points, never what it claims to point at, so they had survived every previous clean run.

- Key files: `scripts/check-docs.sh` (3 checks → 5), `CLAUDE.md`, `PLAN.md`
- Also fixed: `PLAN.md`'s backend tree omitted `service.py`, `logic.py`, `store.py` and
  `export.py` — it documented the I/O half of an architecture whose point is the I/O/logic split
- **No CI, by choice** (Forgejo Actions stays in the backlog), so `CLAUDE.md` now carries a
  "Before you finish" block naming the three commands and why the docs one matters most

## 2026-09-03 — Upstreams are detected per container, not per deployment

**Phase 16 Stage A.** `caddy_mode` asked "is `CADDY_ADMIN_URL`'s host an IP?" and applied that
one answer to every container — a per-deployment answer to a per-container question. The two
diverge precisely where it matters: Compose isolates every project on its own
`<project>_default`, so a co-located Caddy resolves names in its own project and nowhere else.
Every managed stack got a `name:port` pre-fill that could not resolve, and the route returned
502. This was the 2026-07-26 split-LXC trap running in the other direction.

The heuristic is replaced by the fact it stood in for: **do Caddy and the target share a
network Docker's embedded DNS serves?** Caddy's container is found from `CADDY_ADMIN_URL`'s
hostname, matched against the container name, the compose service label, **and network
aliases** — the third is load-bearing, because `compose.colocated.yml` pins
`container_name: caddy` and hides the general case, where a stack that omits it gets
`<project>-caddy-1` and `caddy` survives only as an alias. The lookup happens inside the
container list already fetched, so a request still costs one Docker API call.

Two decisions shaped it. `host` and `none` are subtracted before intersecting: two containers
on `network_mode: host` both report `{"host"}`, which a plain intersection would call "shared"
even though host networking has no embedded DNS — a bug the fix would have introduced rather
than one it inherited. And an unresolvable Caddy falls to the published-port form, never to
the name form: it means Caddy is not a container this daemon can see, and guessing a name
there is the exact failure being fixed.

The hint copy moved with it. It branched on the same deployment-wide value, so it explained
the pre-fill using a fact that was no longer true of the container in front of you; the picked
container now answers for itself. `caddy_mode` survives only as `/api/caddy/status`'s display
summary and as the fallback for route sources that have no container.

- Key files: `modules/docker/logic.py` (`upstream_mode`, `shares_docker_network`,
  `matches_hostname`), `modules/docker/client.py`, `modules/docker/router.py`,
  `components/routing/AddRouteModal.tsx`, `pages/Routing.tsx`
- 209 backend + 38 frontend tests; each new test confirmed to fail on its own defect
- Sets up Stage B: layout C's `loskai-edge` network is exactly the shared-network case the
  detection now rewards

## 2026-09-02 — Two silent boundary failures: corrupt store files and loopback answer IPs

**`CorruptStoreError` reached nobody.** It was raised in three places and caught in none, and
`main.py` had no exception handler — so a hand-edited store file returned a bare 500 from
every reader except `/api/health`, which survived only because Phase 15's F1 wraps its
checkers individually. That included `GET /api/dashboard`, the public launcher every user
lands on. The error's own docstring promised it "always names the path … the operator needs
to know *which* one to fix", and that path only ever reached the server log. Found by the
2026-08-31 smoke test; fixed with an app-wide handler returning `{"detail": str(exc)}` at
500, the shape `api.md` documents and the frontend already unwraps. It logs at error level
too — handling the exception is what stops uvicorn printing the traceback, and dropping the
server-side record would trade one blind spot for another.

**The DNS answer IP was never validated as reachable.** `derive_caddy_host_ip` returned
whatever it found, so `CADDY_ADMIN_URL=http://127.0.0.1:2019` derived `127.0.0.1` as the
answer for every AdGuard rewrite — and AdGuard hands that to every LAN client, so each one
resolved the routed service to *itself*. `0.0.0.0` and `::` fail the same way for a different
reason: a bind wildcard is something to listen on, not to connect to. Both now refused, from
the explicit `CADDY_HOST_IP` as well as the derived host, because an env value never passes
through `_validate` and the derivation is the only place it can still be caught.

The guard **drops to `None` rather than raising**: that is the same state an unset answer IP
already produces and every caller handles, whereas raising would fail a health poll and an
assign over what is a configuration problem. Both failures share a shape — they surface as a
refused connection, never as a DNS or server error, which is what made them expensive.

- Key files: `main.py`, `shared/settings.py` (`_usable_answer_ip`), `docs/reference/api.md`
- Phase 16 Stage C, re-justified after layout D was rejected: this was written up as
  "the defect that makes layout D unusable", but it is a settings-validation gap that any
  loopback-addressed Caddy hits

## 2026-09-02 — Topologies cut to three; the merged container is rejected

**Phase 16 was "support all four deployment topologies"; it is now "ship layout C, fix
upstream detection".** Layout D — AdGuard, Caddy and Loskai merged into one supervised
container — is rejected rather than deferred. The 2026-08-30 analysis had already established
the decisive fact and stopped short of acting on it: merging processes fixes no port conflict,
because the three components never contend with each other and the one genuinely contested
port (`53` against the host resolver) is host-vs-container and survives the merge. Set against
that non-benefit, D collapses DNS, TLS and the root-equivalent Docker socket into a single
blast radius, gives up independent restarts, and forces s6-overlay onto the single-process
image every other layout runs. B already answers "one box, nothing else set up".

**The recommendation is now three-tier instead of two-and-two:** A and C recommended, **B the
supported alternative** rather than a discouraged one. Calling B "not recommended" alongside
an unbuilt D was the wrong shape — B ships today, keeps `2019` off the wire, and is the honest
answer when a second box isn't available. Its caveats are stated at the point of choice
instead.

The rejection reasoning is kept, not deleted, in `topologies.md` under **Considered and not
supported**, beside the all-in-one LXC variant that got the same treatment on 2026-08-30. The
precedent is deliberate: an unbuilt layout with no recorded reason comes back as a proposal.

One finding outlived its layout. The missing loopback guard on `derive_caddy_host_ip` was
written up as "the defect that makes layout D unusable by default", but it is a settings
validation gap, not a D-specific one — any arrangement addressing Caddy over loopback derives
`127.0.0.1` as the DNS answer and points every client at itself. Phase 16 Stage C keeps it,
re-justified, and `topologies.md` now carries the warning topology-independently under "The
ports in play".

- Key files: `docs/guides/topologies.md` (four-way comparison → three), `TODO.md` (Phase 16
  rescoped, Stage D deleted), `PLAN.md`, `README.md`, `CLAUDE.md`
- Decided with Sunde; D removed from the comparison table, its reasoning retained

## 2026-08-30 — Documentation restructure + deployment-topology analysis

**Compared the deployment layouts on port ownership** rather than on where each component
sits, which is what made the question answerable. Contention exists only where two things
publish on the same host, or where a container wants a port the host already owns — so the
three components never contend with each other, and the only genuinely contested port is
AdGuard's `53` against the host resolver. New `docs/guides/topologies.md` carries the
four-way comparison (A split-LXC · B all-in-Docker · C split DNS · D single container).

**Only A and C are recommended.** A wherever Proxmox is available; C — AdGuard on a small
always-on box such as a Raspberry Pi, Caddy + Loskai together in Docker — everywhere else.
C is both the better architecture and the friendlier one to operate: the DNS box is set up
once and never touched, everything iterated on stays in one compose stack. That leaves B
with no reason to exist (it pays a `53` conflict and a shared DNS fault domain for nothing
C doesn't already give), and D is packaging convenience that fixes no port conflict at all.
Both stay supported and documented as not recommended. C and D are **not built** — Phase 16.

**The analysis surfaced two defects, recorded in Phase 16.** `caddy_mode` decides the route
upstream by asking whether `CADDY_ADMIN_URL`'s host is an IP, as a proxy for whether Caddy
can resolve a container's name — false whenever Caddy is a container beside managed stacks,
since Compose isolates each project on its own network and nothing creates a shared one. And
`derive_caddy_host_ip` has no loopback guard, so a loopback admin URL makes every DNS rewrite
answer `127.0.0.1`. A false claim in `troubleshooting.md` that followed from the first was
corrected immediately rather than waiting for the phase.

**Restructured the docs by audience** (Phase 17). Thirteen flat files with no index became
`guides/` (running it) · `reference/` (contracts) · `contributing/` (changing it), with
`docs/README.md` as a task-indexed front page. Driven by an audit of all 16 markdown files:
the docs were individually accurate but structurally unnavigable, and `CLAUDE.md` named only
4 of 13 — so a fresh session could not see most of them. Duplication was pruned to one owner
per fact: the port table had drifted across three files, and `PLAN.md` still named a fifth
layout no other doc knew about.

- Key files: `docs/README.md`, `docs/{guides,reference,contributing}/`, `CLAUDE.md`,
  `README.md`, `PLAN.md` (Alternative Setups, Resilience Summary), `todo-archive.md` (moved
  out of `docs/`), `TODO.md` (Phases 16 + 17)
- Verified: link + anchor checker 0 broken across 17 files; all 13 docs reachable from the
  index, no orphans; `git log --follow` resolves through every `git mv`
- `docs/reference/api.md` audited clean — all 36 backend routes covered

## 2026-08-27 — Phase 15: audit cleanup

Acted on a recursive audit of `backend/src` + `frontend/src` and the documentation
structure: 20 findings, no new features. Four stages, six commits, each leaving the repo
working. The audit itself came back mostly clean — no orphan files, one dead export, the
`client.py`/pure-logic seam intact — so what follows is the shape of the drift a
feature-complete app accumulates, not a rescue.

**The one real bug was in the degradation invariant.** `/api/health` awaited each module's
checker unguarded and in sequence, so a single module raising would 500 the endpoint and
grey out all four cards — the exact opposite of "a module going unreachable greys out only
its own card". It had never fired only because every checker happens to catch its own
errors; the invariant was being upheld by luck, one module away from breaking. Each probe
is now contained and the four run concurrently, with the concurrency pinned by a test that
deadlocks if the awaits ever go back to being sequential.

**Corrupt store files now fail differently on purpose.** A hand-edited `settings.json`
raised `JSONDecodeError` through `settings.value()` — which nearly every router calls — so
one bad character 500d every page without naming the file. The fix deliberately splits by
file rather than "returning the default": `settings.json` **aborts startup** naming the
path, because `password_set()` reads `admin_password_hash` from it and `POST
/api/auth/setup` is public and only refuses once a hash exists — a silent `{}` fallback
would turn a corrupt file into an unauthenticated admin takeover, and the next write would
clobber whatever else was in there. `instances.json` skips and logs the unreadable
*record*, since it carries display state only; but a whole-file parse error still raises,
because reading an unparseable file as `[]` would let the next upsert erase every route.
Forgejo's `app.ini` (hand-editable, refuses to boot when malformed) was the model.
The atomic write was also missing an `fsync` before its rename, so a power cut could
commit the rename with the data still in cache — the one way the app could produce a
zero-length file on its own rather than being handed one. And every writer rewrote the
whole file after a separate read, from *both* contexts FastAPI runs handlers in, so two
overlapping saves discarded one side's change; `store.update_json()` now serialises them
under a `threading.Lock` and is the only remaining write path. The costly case there was
never settings — it was a dropped instance record, which leaves a Caddy route and a DNS
rewrite live but with nothing left in the store to manage them from.

**The backend had no logging at all** — zero `logging` imports across the whole app. The
best-effort AdGuard half of assign and a bare `pass` on a failed stale-rewrite delete were
both defensible by design, but nothing was recorded anywhere, so an operator debugging a
leftover rewrite had only a transient UI warning. That is the failure `ff0f167` was written
to fix. Module loggers now record every swallowed exception; the two routine hot-path misses
(Docker stats, exec socket teardown) log at `debug`.

**Two components had drifted apart, and the drift had already caused a bug.** AssignModal
and AddRouteModal each kept their own copy of the same field derivation — including the long
split-LXC help string, character for character — and AddRouteModal's copy had quietly lost
the prefix lowercasing and every validation hint. Typing `Grafana` left "Add route" disabled
with nothing on screen to explain it, on the app's single route-creation surface, which had
no test. So: test first, then the fix, then `useRouteFields()` + `RouteFields` to make the
divergence impossible — in that order, so the tests covered the refactor. The same pattern
appeared in settings: Phase 14 moved General across verbatim without migrating it, leaving
two field components with different save models on one page. General is inline now and
`SettingsFields` is gone.

Also: a `path="*"` route (a mistyped URL rendered the chrome around a blank pane), six
route handlers deleted that nothing called — the rewrite ones worth removing on their own
merits, since they allowed a rewrite outside the assign flow that owns its ordering — and
`TODO.md` cut from 67KB to 17KB by archiving the thirteen completed phases, against
`CLAUDE.md`'s own warning that context fills fast.

**Left open:** the backend suite could not be run in this environment at all (the venv is
unreachable from the sandbox), so `test_health_registry.py`, `test_store_corruption.py` and
the extended `test_settings.py` have never executed. `TODO.md` carries that plus the live
smoke list.

- Key files: `backend/src/loskai/shared/` (`health.py`, `store.py`, `settings.py`,
  `instances.py`, `assign.py`), `backend/tests/test_health_registry.py` +
  `test_store_corruption.py` (new), `frontend/src/components/routing/useRouteFields.ts` +
  `RouteFields.tsx` (new), `frontend/src/lib/settings.ts` (new),
  `frontend/src/pages/NotFound.tsx` (new), `docs/todo-archive.md` (new), `Makefile` (now
  tracked)
- Deleted: `frontend/src/components/shared/SettingsFields.tsx`, `api.text()`, and the six
  uncalled route handlers (**handlers only** — every client method they wrapped still feeds
  assign, reconcile, export or the routes table)
- Out of scope by decision: F8 (both modals hand-roll chrome `Modal.tsx` provides) and F12
  (`settings.value()` re-reads `settings.json` per key)

## 2026-08-26 — Phase 14: the Network tab folded into a restructured Settings page

Dissolved the standalone Network tab (built in Phase 10b) and rebuilt Settings as a
Forgejo-style category page: a nested sidebar — `General · Network · Security` — over real
child routes, so `/settings/network` is deep-linkable rather than a scroll position. The
prompt was the Settings page having become thin while the Network tab carried three unrelated
concerns per service; Forgejo's application-settings layout was the reference for the shape.

The interesting decision was **not** moving the tab wholesale. Its contents were split by
*kind* instead: configuration went to Settings > Network (fields-only, still auto-saving on
blur, same `settings.json` keys), while the health + link-out for **AdGuard and Caddy** went to
the **Routing tab** — Routing is what actually pushes their state, so a status pill belongs
next to the thing it gates, not on a config page you visit twice a year. **WireGuard didn't
follow**, and that asymmetry is the point: Loskai never writes to it, so it has no state worth
monitoring in Routing and keeps a plain link-out beside its config field. Rejected alternatives:
a flat single-page Settings (no room for the categories to grow) and keeping a primary-nav
Network entry that deep-links into Settings (two doors into one page).

Caddy was **promoted** from a problem-only `ModuleStatus` banner to a persistent pill, so its
cert-onboarding link is always reachable instead of surfacing only when something breaks — that
link is how a new LAN device gets told to trust the internal CA, which is a routine action, not
an error path. `AdGuardStatus` generalised into `InfraStatusPill` to serve both; when a service
has no URL yet the pill's link becomes **"Configure"** into `/settings/network`, which is what
replaces the guidance the old unconfigured-state banner gave.

- Key files: `frontend/src/pages/settings/` (new: `SettingsLayout`, `General`, `Network`,
  `Security`), `frontend/src/components/routing/InfraStatusPill.tsx`,
  `frontend/src/pages/Routing.tsx`, `frontend/src/App.tsx` (nested routes, one `RequireAuth`
  around the shell), `frontend/src/components/shared/Layout.tsx`
- Removed: `pages/Network.tsx`, `pages/Settings.tsx`, `components/network/ServicePanel.tsx`,
  `components/routing/AdGuardStatus.tsx`. `PeerDnsReminder` moved to `components/settings/`
- **No backend changes** — same `/api/settings` keys and partial-PUT contract throughout
- Phase 11's invariant is untouched: route creation is still solely the Routing tab's
  Add route picker, and its "Network service" source (by `origin`) still works
- Found while writing the Security stub: `LOSKAI_PASSWORD` only *seeds* the password when no
  hash exists (`auth.py:97`), so setting it on an existing install does nothing. The stub says
  so, and points at removing `admin_password_hash` from `settings.json` instead
- Verified: `tsc -b`, `oxlint`, `vite build` clean; 29 Vitest pass (was 25 — `ServicePanel`'s 2
  removed, 6 added for `SettingsLayout` sub-nav and `InfraStatusPill`). Smoke-tested on device
  2026-08-27 — sub-nav highlighting, the `/settings/network` deep link, auto-save on blur, both
  Routing pills, and the unconfigured "Configure" fallback all behave against a live backend

## 2026-08-13 — Fixed a stale AdGuard rewrite left behind on mode switch

**Bug**: assigning a `proxy` route then switching it to `dns_only` (or back, or just
repointing a `dns_only` instance to a new IP) left the *old* AdGuard rewrite in place
instead of replacing it — the domain ended up with two answers in AdGuard, a real
conflict, until the next Sync cleaned it up. Reported by the user live: "a conflict
occurs if we set a route, and then change it to dns only. the first dns rewrite is not
deleted and another is created."

Root cause: `assign()`'s Step 2 only deleted the previous `(domain, answer)` pair when
the **domain** changed (a rename) — `if old_domain and old_domain != domain and
old_answer`. A mode switch (or an in-place `dns_only` IP change) keeps the domain the
same but changes the **answer**, so that condition never fired and the stale pair was
never cleaned up. This was a known gap from Phase 13's own design notes ("mode switch...
relies on reconcile to clean up the stale old-answer pair, not on assign() itself") that
turned out to be the wrong call — leaving a domain resolving to two answers right after
an explicit user action is a worse outcome than the Sync-backstop reasoning gave it
credit for.

Fixed by triggering the delete whenever *either* half of the pair is about to go stale:
`if old_domain and old_answer and (old_domain != domain or old_answer != answer)`. Two
existing Phase 13 tests (`test_mode_switch_proxy_to_dns_only_tears_down_caddy_route`,
`test_mode_switch_dns_only_to_proxy_creates_caddy_route`) had only ever asserted
`ag.added`, never `ag.deleted` — exactly the gap that let this ship. Added the missing
assertions to both, plus a new test for the in-place `dns_only` IP-change case (same bug
class, no mode switch involved).

- Key files: `backend/src/loskai/shared/assign.py`, `backend/tests/test_assign.py`,
  `docs/adguard-api.md` (its "Edit a rewrite" section previously assumed "answer is
  constant," no longer true for `dns_only`)
- Verified: 164 backend tests pass (was 163 — one new case added)

## 2026-08-12 — Phase 13: DNS-only routing mode + `.env` support for local dev

Added a second `route_mode` to the instance model — `"dns_only"` alongside the existing
(now-default) `"proxy"` — so a raw machine or VM can get a clean hostname (a plain AdGuard
A-record straight to its own IP) without going through Caddy at all. Motivation: Caddy's
`reverse_proxy` is HTTP(S)-shaped (one hostname → one backend port), while naming a machine
is protocol-agnostic (SSH, RDP, whatever) — not everyone wants HTTPS on their own LAN.
Considered and rejected: a dedicated new tab, and just pointing people at AdGuard's own UI —
both would have split "things Loskai named" across two inventories, undermining the
instance-model's whole point. This is a third mode on the same instance/Routing-table
instead.

Built twice: the first pass hit an unrelated dev-environment problem (the frontend's file
watcher stuck in a reload loop from an unreliable filesystem, not from this code — confirmed
by reverting to a clean baseline and observing the loop persisted with zero of these changes
in the tree; a machine reboot fixed it) and was rolled back to the last commit before
redoing it. The second pass went file-by-file with a fresh read before every edit and a test
run after each one, specifically to avoid a mistake from the first attempt: `Write`-ing over
`ServiceTable.test.tsx` without reading it first, silently dropping 4 pre-existing tests
(caught via `git diff --stat` and fixed before it shipped). This time every touched file was
read fresh immediately before editing and diffed after, so nothing pre-existing was at risk.

- **Backend**: `assign()` Step 1 now branches — `proxy` pushes a Caddy route as before,
  `dns_only` calls the already-404-safe `delete_route` instead (a no-op normally, and what
  tears down a stale route on a proxy→dns_only mode switch). Step 2's AdGuard answer comes
  from a new `target_answer()` helper: the shared Caddy IP for `proxy`, the instance's own
  `upstream` (now a bare IP, not `host:port`, for `dns_only`) otherwise. `unassign()` needed
  **zero changes** — both its steps were already mode-agnostic
- **AdGuard reconcile** (the trickiest part): `plan_reconcile`, `dns_status_rows`, and
  `reconcile` all moved from one global `current_ip` to per-instance `target_answer`.
  `is_loskai_domain` relaxed from single-label to any label(s) under `base_domain`, since
  `dns_only` names can be multi-label (`rack1.vm3` — no wildcard-cert constraint applies
  with no TLS involved). The orphan sweep widened to match either the shared Caddy IP or any
  currently-routed instance's own `dns_answer`, so `dns_only` leftovers get swept too — a
  deliberate, slightly wider blast radius, documented in `docs/adguard-api.md`.
  `reconcile()`'s `CADDY_HOST_IP` requirement is now conditional: only raised when a `proxy`
  instance is actually routed, so an all-`dns_only` LAN needs no Caddy IP configured at all
  (a visible behavior change from the old unconditional check)
- **Caddy module**: `push_all` skips `dns_only` instances outright (not an error — just N/A);
  `list_with_sync` reports `synced`/`upstream_healthy: null` for them (renders as a dash)
  while `routed`/`fqdn` stay populated (a `dns_only` instance does have a subdomain, just no
  Caddy projection)
- **Frontend**: a Proxied/DNS-only toggle in `AddRouteModal` (External source only — a
  container's own IP isn't a meaningful DNS target) and `AssignModal` (gated by a new
  `allowDnsOnly` prop, hidden for `docker`-type rows). `ServiceTable` gained a "dns-only" tag
  pill and dashes in place of Route/Live status for those rows. New `isValidDnsOnlyPrefix`
  (dotted labels) and `isValidDnsTarget` (bare IPv4 — IPv6 explicitly out of scope for v1)
- Key files: `shared/{assign,instances}.py`, `modules/adguard/service.py`,
  `modules/caddy/service.py`, `components/routing/{AddRouteModal,AssignModal,ServiceTable}.tsx`,
  `lib/validation.ts`
- **Tests**: 163 backend (was 145 — 3 existing `test_adguard_reconcile.py` tests updated for
  the relaxed `is_loskai_domain`/conditional-`current_ip` behavior, rest new), 25 frontend
  (was 19). `tsc -b`, `vite build`, `oxlint` all clean
- **Unverified in-sandbox** (no real Caddy/AdGuard here): the actual mode-switch route
  teardown/creation and the per-instance AdGuard answer, end to end. Smoke-test on device
  per the TODO.md Phase 13 checklist
- **Sandbox note, not app-related**: this session had neither `uv` nor `node` on `PATH` (the
  checked-out `.venv`/`node_modules` pointed at binaries from a different machine); installed
  both locally (`~/.local/bin`, `~/.local/node`) to actually run the test suites rather than
  claim they passed

**`.env` support for local `uv run` dev.** Separately, while trying to exercise the above
live, found `config.py` never told pydantic-settings to read a dotenv file at all
(`SettingsConfigDict` had no `env_file` key) — a `.env` sitting in the repo did nothing for
a bare `uv run uvicorn`, only real exported shell env vars were ever read. Production was
never affected (the Dockerfile never copies a `.env` into the image; `docker compose`
injects real env vars directly), but dev had no working `.env` path at all, only the
`export VAR=...` block `docs/dev-testing.md` walked through.

Added `env_file` to `Settings.model_config`, anchored to `config.py`'s own location
(`Path(__file__).resolve().parents[3] / ".env"`) rather than the process's working
directory, so it finds the repo-root `.env` regardless of which directory `uv run
uvicorn` is launched from.

Surfaced a real test-isolation gap in the process: `config.settings` is a module-level
singleton, so once it started reading a real `.env`, the whole backend test suite silently
depended on whatever happened to be in the developer's local file — caught live when a
real `LOSKAI_PASSWORD` broke the first-run-setup test (the app no longer believed it was a
fresh install). Added `backend/tests/conftest.py`: an autouse fixture that resets every
`Settings` field to its no-`.env` value before each test, so the suite stays hermetic no
matter what's on disk. Also updated `docs/dev-testing.md`'s step 3 to lead with the `.env`
file (matching how the production path already works) instead of only the `export` block;
export still works as an override/CI path since env vars still outrank `.env`.

- Key files: `backend/src/loskai/config.py`, `backend/tests/conftest.py` (new),
  `docs/dev-testing.md`
- Verified: 163 backend tests pass; live server boots via `uv run uvicorn` and
  `GET /api/auth/status` confirms `.env`'s `LOSKAI_PASSWORD` is actually picked up

## 2026-08-10 — Plan/TODO discrepancy pass + `.env.example` cleanup

**Doc drift review.** Compared PLAN.md/TODO.md against the actual repo (git wasn't available
mid-session, so this was done by reading HISTORY.md + the real file tree rather than `git log`)
and found three stale spots: CLAUDE.md still described the repo as planning-stage with no
`backend/`/`frontend/`, even though all four modules are built through Phase 11; PLAN.md's
settings table and `.env.example` block never got `HOST_IP` added alongside `CADDY_HOST_IP`
(missed in the 2026-07-26 entry above); and TODO.md referenced `render_caddyfile()` in three
places as if it still existed, though it was removed 2026-07-18. Fixed all three.

**Also surfaced:** the Phase 12 section (internal-CA trust-onboarding fixes) and the Backlog
list had been sitting in `TODO.md`'s working tree, uncommitted, since before this pass — split
into its own commit ahead of the doc fixes so the two unrelated changes don't share history.

**`.env.example` trimmed.** Its per-variable comments duplicated `docs/deployment.md`'s
existing environment-variables table (added 2026-07-18) — two places to keep in sync for the
same information. Cut each comment to one line and pointed the file header at the doc instead.
Confirmed no variable is actually required (`config.py` gives every field a default; the app
boots with nothing set and is configured in-app), so no required/optional split was added.
- Key files: `CLAUDE.md`, `PLAN.md`, `TODO.md`, `.env.example`
- Verified: doc-only + comment changes, no code touched; nothing to run

## 2026-07-26 — Topology-aware route upstreams + `HOST_IP` auto-fill

**Fixed the split-LXC 502 trap.** Picking a container in the Add-Route/Assign flow pre-filled
its upstream as a Docker `name:port`, which only resolves when Caddy shares the Docker network
(co-located mode). In the preferred split-LXC layout Caddy runs on its own box and can't
resolve container names, so every container route 502'd until the user manually swapped in a
LAN `IP:port`. `suggested_upstream` is now topology-aware (via `caddy_mode`): docker mode keeps
`name:port`; lan mode builds `<host_ip>:<published-host-port>`.

**Added the `HOST_IP` setting** (env `HOST_IP` + Settings → *Docker Host LAN IP*, mirroring
`caddy_host_ip`). A bridged Loskai container can't detect its own host's LAN IP, so it's set
once and used to auto-fill lan-mode container upstreams. A container published to a *concrete*
IP is detected automatically (no setting needed); otherwise the field stays blank with
mode-aware help text. Both route modals now explain the rule inline.
- Key files: `backend/src/loskai/modules/docker/{logic,client,router}.py`,
  `backend/src/loskai/shared/settings.py`, `config.py`,
  `frontend/src/components/routing/{AddRouteModal,AssignModal}.tsx`, `pages/Settings.tsx`
- New docs: `docs/troubleshooting.md` (502 / redirect-loop / DNS / cert / VPN triage);
  `docs/lxc-script-authoring.md` (reference for new `create-<service>-lxc.sh` scripts).

## 2026-07-20 — Internal CA as default; split AdGuard + Caddy into two LXCs

_Its `TLS_MODE=acme` was removed on 2026-09-27; the internal CA is the only mode now._

**Realigned the TLS/certificate story in the docs** so the internal CA (`local_certs` /
`tls internal`) is the default in **both dev and production**, and public ACME certs
(Let's Encrypt / ZeroSSL via DNS challenge) are framed as a possible future path, not the
production baseline. The previous docs presented ACME as the production default and internal
CA as a dev-only convenience — inverted relative to the actual direction. This is a
docs-only change: because Loskai is cert-agnostic (it holds zero certificate material and
only needs the `BASE_DOMAIN` string), the choice lives entirely in the Caddyfile, so no
application code moves. Also noted that Certificate Status (deferred) becomes easier under
the internal CA — its expiry is readable from Caddy's PKI endpoints — while the TLS-probe
approach stays as the method-independent implementation.

**Reconciled the bootstrap configs to match.** Both reference Caddyfiles (`Caddyfile` native
LXC, `caddy/Caddyfile` co-located) now default to `local_certs` + `tls internal` + the `:80`
onboarding block, with the ACME wildcard demoted to a commented alternative. `caddy/Dockerfile`
switched from the xcaddy plugin build to stock `caddy:2` and now bakes the onboarding page in
(`COPY setup/ /srv/setup/`); `compose.colocated.yml` comments out `DUCKDNS_TOKEN` (ACME-only)
and publishes `:80` for the onboarding page.

**Split the combined Network-Services LXC into two — AdGuard and Caddy on separate boxes.**
This walks back the earlier "LXC 101 = AdGuard + Caddy together" model (`PLAN.md` infra
diagram, firewall notes, compose examples all updated). Reason: AdGuard *is* the LAN's DNS
resolver, while Caddy is the component Loskai constantly reconfigures at runtime and that gets
rebuilt during dev — sharing a fault/restart domain means a Caddy misconfig or teardown takes
name resolution down LAN-wide. Separate LXCs isolate that. `scripts/create-lxc101.sh` was
replaced by `scripts/create-adguard-lxc.sh` + `scripts/create-caddy-lxc.sh`. Both auto-pick
the container ID (`pvesh get /cluster/nextid`) and come up on DHCP (static IPs assigned
afterwards), per the user's provisioning workflow, and enable `unattended-upgrades` for
OS security patching (Debian's default security-only origins, so app versions aren't
auto-bumped). The Caddy script installs Caddy from the
**official Cloudsmith apt repo**, runs it **as root** (dropping the `caddy` user /
`CAP_NET_BIND_SERVICE` ceremony — the unprivileged LXC is the security boundary), defaults to
`TLS_MODE=internal` (`local_certs` + `tls internal` + a minimal `:80` onboarding page, data
dir pinned via `XDG_DATA_HOME=/var/lib/caddy` so the `/caddy-root.crt` path is deterministic),
and adds the DNS plugin via `caddy add-package` when `TLS_MODE=acme`.

- Key files: `PLAN.md` (Caddy Setup section, infra diagram, firewall/resilience notes, both
  Certificate Status notes), `docs/certificate-setup.md`, `docs/dev-testing.md`,
  `docs/deployment.md`, `README.md`, `TODO.md`, `compose.yml`, `Caddyfile`, `caddy/Caddyfile`,
  `caddy/Dockerfile`, `compose.colocated.yml`, `scripts/create-adguard-lxc.sh`,
  `scripts/create-caddy-lxc.sh` (replacing `scripts/create-lxc101.sh`)
- The full 565-line auto-detecting onboarding page (`caddy/setup/index.html`) is used by the
  Docker builds; the native Caddy LXC script writes a minimal placeholder and points to the repo copy.

## 2026-07-18 — Deployment config cleanup: compose rename, deploy doc, opt-in .env

**Renamed the three deployment compose files** to Docker's current convention:
`docker-compose.yml` → `compose.yml`, `.colocated` and `.dev` likewise (via `git mv`, so
history follows). This also removes a "do as I say, not as I do" gap — Loskai's own stack
scanner already prefers `compose.yml` and `migration.md` tells users to rename their stacks
to it. Managed-stack references (`stacks.py`, `migration.md`) were left untouched — they're
about users' stacks, not our files.

**Extracted the compose comments into `docs/deployment.md`** — a "running the container"
reference: the env-var table (user-facing vs image-internal), the `STACKS_DIR` same-path
mount rationale, the settings-volume / `LOSKAI_DATA_DIR` coupling (change the host side
freely; change the container side only in lockstep or state is lost), the co-located port
notes, and cold start. The compose files now carry only a lean header pointing there.

**Fixed `RECIPES_REPO_URL` never reaching the container** — it lived in `.env.example` and
`config.py` but wasn't forwarded in either compose file's `loskai` environment, so the env
override silently did nothing. Now passed through in both (intended to become an image-baked
default later, with env/UI as the override).

**Made `.env.example` fully opt-in** — every value is optional, so they now ship commented:
copying to `.env` yields an all-unset config that boots and is configured in the UI, rather
than baking in example IPs/passwords. Reordered so `STACKS_DIR` leads and `CADDY_HOST_IP`
sits with `CADDY_ADMIN_URL`.
- Key files: `compose.yml`, `compose.colocated.yml`, `compose.dev.yml`, `docs/deployment.md`, `.env.example`
- Ref updates: `README.md`, `docs/dev-testing.md`, `scripts/create-lxc101.sh`, `PLAN.md`, `TODO.md`

## 2026-07-18 — Cleanup: drop the Caddyfile export

**Removed the Caddyfile export** (UI `CaddyfileExport`, `GET /api/caddy/caddyfile`, and the
`render_caddyfile` renderer + its 3 tests). It duplicated the JSON config export
(`GET /api/export`) and the Sync backstop, and the bootstrap Caddyfile already ships in the
repo (`./Caddyfile` for LXC, `./caddy/Caddyfile` co-located, `./dev/Caddyfile`) — those are
cert-only, routes are pushed at runtime, so a dynamic full-Caddyfile render earned nothing.
Tests: 141 backend (−3 render) + 19 Vitest. (Uniform instance deletion, same day-ish, is
noted under the Phase 11 entry below.)

## 2026-07-17 — Phase 11: one route-creation surface

Consolidated all route creation into the Routing tab, resolving the overlap where a service
running as a container could be routed from two competing "Assign" surfaces (Docker tab by
container, Network tab by service). The Docker and Network tabs now only *display* routed
state.

- **`origin` marker** on the instance — the network-service analogue of `container`: assign
  dedups on it (`get_by_origin`), so re-routing a built-in service edits the same instance.
  `AssignBody.origin`, and `origin`/`container` surfaced in the caddy `/routes` rows.
- **Routing "Add route" picker** (`AddRouteModal`) — a source selector `[ Container | Network
  | External ]`. Container/Network lists show only *unrouted* items (routed ones drop out,
  since they're managed as rows) and pre-fill prefix + upstream; External is the manual form.
- **Docker tab:** Assign action removed; a routed container's subdomain badge is now a link to
  `https://<sub>.<domain>`.
- **Network tab:** per-panel Assign removed; the link-out prefers `https://<sub>.<domain>` when
  the service is routed (matched by `origin`), with a "Routed at … · manage in Routing" hint.
  The **Caddy cert page keeps its by-IP HTTP link** (first-timers can't trust the cert yet).
- Why it's clean: one creation surface means no competing entry points; when infra runs as
  containers (dev rig) they may appear under both the Container and Network picker sources, but
  the subdomain-unique guard still prevents real duplicates.
- **Follow-up:** deletion is now uniform — the old "docker instances can't be deleted (409)"
  guard was dropped. Since containers no longer auto-create instances, deleting a docker
  instance just drops the route + record (the container is untouched, re-routable via Add
  route) and won't silently reappear. Backend guard + frontend disabled-state + the
  no-delete test all removed.
- Key files: `shared/{instances,assign}.py`, `modules/caddy/service.py`,
  `components/routing/AddRouteModal.tsx`, `pages/{Routing,Docker,Network}.tsx`,
  `components/docker/ContainerList.tsx`
- Tests: 144 backend (+1 origin idempotency) + 19 Vitest. **Unverified in-sandbox:** the
  rendered picker + routed-state links (no Docker/live services here).

## 2026-07-17 — Phase 10b: Network tab

Repurposed the thin VPN tab into a service-oriented **Network tab** (`/network`) covering the
infrastructure Loskai talks to — the WireGuard **Gateway**, **AdGuard** (DNS), and **Caddy**
(TLS + the cert-onboarding link). Each panel: health + link-out + editable config + a
Docker-style "Assign URL".

- **Restructure:** `/vpn` → `/network`; retired `pages/WireGuard.tsx` + `WireGuardCard`.
  Reusable `ServicePanel` (header/status/compact link-out) + `PeerDnsReminder`.
- **Settings migration:** service URLs/credentials moved out of the Settings page into the
  panels as **inline auto-saving fields** (`InlineSettingsFields` — commit on blur/Enter,
  partial PUT, same `settings.json` keys, single source of truth). Settings slimmed to base
  domain / recipes repo / stacks dir + backup.
- **Certificate link:** the Caddy panel derives the by-IP link `http://<caddy-ip>/` (:80,
  prod-shaped) from the bare `caddy_host_ip`. For a shareable HTTPS name you **assign a
  `setup.<domain>` instance** (Caddy panel's Assign, upstream `<caddy-ip>:80` — Caddy proxies
  to its own file server) rather than a config field. (An earlier `caddy_setup_url` override
  was added then removed in favour of this instance-based approach — one fewer field.)
- **Data-integrity fix:** `caddy_host_ip` is now validated as a bare IP (422 otherwise). A
  stray `http://127.0.0.1` had leaked in and was being written as the answer for *every*
  AdGuard rewrite (unresolvable). Frontend also strips scheme/port defensively.
- **Per-service Assign:** AdGuard, Gateway, and Caddy (the cert page) get a pre-filled Assign
  → `POST /api/assign` → external instance, reusing `AssignModal`. Lives as a link-icon button
  in each panel header next to the link-out.
- Key files: `pages/Network.tsx`, `pages/Settings.tsx`, `components/network/*`,
  `components/shared/{SettingsFields,InlineSettingsFields}.tsx`, `shared/settings.py`, `config.py`
- Tests: 143 backend (+3 net: `caddy_host_ip` validation) + 19 Vitest. **Unverified in-sandbox:**
  the rendered tab + assign reachability (upstream derived from a service URL may need editing
  for Caddy).

## 2026-07-17 — Phase 10a: certificate onboarding (internal-CA)

The homelab commits to Caddy's **internal CA** (not public ACME), so LAN devices must trust
Caddy's root once. Added a small onboarding site Caddy serves itself; Loskai stays entirely
out of the cert path (invariant). Ship-first, standalone half of the Phase 10 plan.

- **Page:** `setup.html` → `caddy/setup/index.html` (bilingual NO/EN, OS-detecting; hands out
  the root + install steps for Windows/macOS/Linux/Firefox).
- **Serving:** a plain-HTTP `:80` site in the bootstrap Caddyfile (`dev/Caddyfile`) —
  `/caddy-root.crt` streamed live from Caddy's PKI, everything else the page. HTTP + by-IP on
  purpose: the page can't sit behind the very cert it's there to get trusted. Mounted
  read-only via `docker-compose.dev.yml`. Not pushed through Loskai's API — it's static files
  Caddy owns.
- **Server-discovery hardened** (the load-bearing code change): the `:80` site is a *second*
  Caddy server, and Loskai discovered its routing server with a blind `next(iter(servers))` —
  which could now pick the static `:80` server and silently push routes into it. Replaced with
  `service.select_server_name`: prefer the `:443` listener, fall back to has-routes, then
  first. Pure + unit-tested (139 backend now, +5).
- Docs: `docs/certificate-setup.md`; `dev-testing.md` points at the page instead of the manual
  `docker exec … root.crt` extraction.
- Key files: `caddy/setup/index.html`, `dev/Caddyfile`, `docker-compose.dev.yml`,
  `modules/caddy/{service,client}.py`, `docs/certificate-setup.md`
- **Unverified in-sandbox:** the actual `:80` serving needs a real Caddy (no Docker here) — a
  user smoke test is the last open 10a item.

## 2026-07-16 — Phase 9 polish

Cleared the remaining Phase 9 items in one pass (upstream validation + HTTPS upstreams
were already done in earlier sessions). Five commits, each self-contained and tested.

- **Code-split the Docker page** (`React.lazy` + `Suspense` in `App.tsx`) — xterm now loads
  only when that tab is opened, splitting the ~670 kB single chunk into `index` (~308 kB)
  + `Docker` (~365 kB) and clearing the Vite size warning
- **Config export** — `GET /api/export` (new `shared/export.py`) returns a JSON snapshot of
  the instances + AdGuard rewrites (rewrites best-effort: `null` + warning when AdGuard is
  down). Download button on the Settings page
- **DNS consistency check** — pure `consistency_warnings` in `adguard/service.py`, surfaced
  as a `consistency[]` key on `/api/health` via a new self-degrading registry hook
  (`register_consistency`) so `health.py` still imports no module. Amber banner on Routing
  flags routed-but-no-rewrite and manual same-domain conflicts
- **Orphaned-route cleanup** — `logic.orphaned_instances` (pure) + `GET/DELETE
  /api/docker/orphans`; the delete re-verifies the container is really gone (409 otherwise)
  then reuses a new `assign.purge_instance` for cross-module teardown. Rose banner on Routing
  with per-item Delete. This is the one sanctioned path to delete a docker instance
- **Dark/light theme toggle** — the UI is authored dark against the slate scale; light mode
  inverts `--color-slate-*` under `html.light` in `index.css` (Tailwind v4 utilities read
  those vars), re-skinning all 27 components with zero markup changes. Toggle in the sidebar,
  applied pre-paint in `main.tsx`; choice stored in localStorage
- Key files: `frontend/src/App.tsx`, `lib/theme.ts`, `index.css`, `backend/.../shared/export.py`,
  `shared/health.py`, `modules/adguard/service.py`, `modules/docker/{logic,client,router}.py`,
  `shared/assign.py`
- Tests: 126 backend (was 118) + 18 Vitest, all green

Follow-up UX cleanup after review:
- The per-row **Rewrite** toggle in the routing table was redundant — "Push all" already
  reconciles every missing/stale AdGuard rewrite. Removed it and renamed the button to
  **Sync** (a `RefreshCw` hard-refresh that re-pushes routes + reconciles rewrites). The
  `POST /adguard/rewrites` add/delete endpoints stay for scripting; nothing in the UI calls
  them now. Vitest 18 → 17
- The delete icon now renders on **every** routing row; for container-backed (docker)
  instances it's shown gray + disabled with a tooltip ("Container-backed — remove its
  container to delete it") rather than hidden, so the affordance is discoverable
- **Orphan DNS sweep** added to reconcile (closes the one gap in the teardown story): a
  rewrite pointing at the Caddy IP, in the `<label>.<base>` namespace, owned by no routed
  instance is a Loskai leftover from a teardown whose best-effort DNS delete failed while
  AdGuard was down. Sync now deletes these. The `answer == currentIP` + base-shape guard
  keeps it off any hand-added rewrite. Reported as `swept` and shown in the Sync banner
  ("Removed N orphaned DNS rewrites"). Pure `is_loskai_domain` + `plan.sweeps`; +5 tests
  (134 backend total)

## 2026-07-16 — Semi-automatic container routing (via the Docker tab)

Prompted by a user deleting `instances.json` and asking how routes could come back from
the containers. Explored `loskai.subdomain` **label auto-discovery** (scan on startup,
create routes automatically) and built it — but the user didn't want compose labels or
automatic assignment, so it was **removed** in favor of a semi-automatic model.

- **Removed** `modules/docker/discovery.py`, the startup scan, `POST /api/docker/discover`,
  the "Discover" button, `client.running_with_label`, and the `logic.derive_upstream`
  helpers — no auto-assignment anywhere
- **Kept the useful part** as the intended flow: in the Docker Manager, "Assign URL" on a
  container is **pre-filled with a suggested subdomain** from the container name (or its
  current one — the button reads "Change URL" then)
- **No duplicates**: a container assign now targets that container's existing instance
  (change its URL) instead of creating a second docker instance — `assign()` looks it up
  via `instances.get_by_container`. A second route to one service is a separate `external`
  instance (the normal Routing-tab assign)
- **Design note**: a container never *needs* an instance to be visible (the Docker tab is
  live from the socket); an instance only exists to hold a route. So auto-creating one per
  container would just be noise — routing stays an explicit, per-container action
- **Edit in place from either tab**: the Routing table gained a "Change URL" action on
  routed rows (not just Remove) — opens the prefilled modal targeting the same instance
- **Reachable upstream autofill**: `logic.suggested_upstream` derives `<service>:<port>`
  from the socket (container-side of the single published binding — e.g. AdGuard exposes
  many ports but publishes only 3000) and pre-fills the assign form, so users no longer
  guess (and type `0.0.0.0:3000`). Uses the service name over a raw IP (survives restarts)
- 118 backend + 18 Vitest tests pass

## 2026-07-15 — Instance deletion + all-instances routing view

Fixed a model gap found in use: removing a route (unassign) kept the instance, but the
routing table only showed *routed* instances — so cleared instances became invisible
orphans with no way to delete them. Reworked to a type-aware model.

- Key files: `modules/caddy/service.py` (`list_with_sync`), `shared/assign.py`
  (`delete_instance` + `DELETE /api/instances/{id}`), `shared/instances.py`,
  `components/routing/ServiceTable.tsx`, `pages/Routing.tsx`
- **Routing view now lists every instance** (routed or not) with a `routed` flag; unrouted
  rows show "Assign", routed rows show route/DNS status + "Remove route"
- **Type-aware delete**: external instances are pure route definitions, so they can be
  deleted outright (route + rewrite + record); docker instances are container-backed, so
  `DELETE /api/instances/{id}` returns **409** — you remove their route instead, and the
  container lives on in the Docker tab
- `DELETE /api/instances/{id}` is a cross-module action (route/rewrite cleanup), so it
  lives in `assign.py`, not `instances.py` (which must not import the module clients)
- Verified: 113 backend + 16 Vitest pass; curl confirmed the all-instances listing,
  external delete, and the docker 409

## 2026-07-15 — HTTPS upstreams + upstream validation (post-testing gaps)

Closed the two gaps local testing surfaced. **Upstream validation**: the assign flow
stored the upstream verbatim into Caddy's `dial`, so a URL (e.g. `https://…:8006/`)
produced a malformed, non-connecting route — now rejected (422) on both API and form,
requiring a bare `host:port`. **HTTPS upstreams**: the route builder only emitted a plain
HTTP `dial`, so a TLS-only backend like **Proxmox** couldn't be proxied — now the instance
carries `upstream_tls`, and `build_route` / the Caddyfile export emit a
`transport http { tls tls_insecure_skip_verify }`, with a "Backend speaks HTTPS" checkbox
in the Assign form and an `https` tag in the routing table.

- Key files: `shared/assign.py`, `shared/instances.py` (`upstream_tls`),
  `modules/caddy/service.py`, `components/routing/AssignModal.tsx`, `lib/validation.ts`
- Both are additive + backward-compatible (`upstream_tls` defaults false; existing
  instances unaffected)
- Verified: 110 backend + 15 Vitest tests pass; clean build/lint

## 2026-07-15 — First live end-to-end validation (real Caddy + AdGuard)

Stood the whole thing up on a real machine — dev Loskai (uv + Vite on the host) against
Caddy + AdGuard **containers** — and drove the full cross-module assign flow that couldn't
be tested during the build (the dev sandbox had no Docker daemon). **It works end to end**:
Loskai pushes the Caddy route and the AdGuard rewrite, and a browser request flows
`DNS (lvh.me) → Caddy → reverse_proxy → AdGuard's login page`. The load-bearing
integration is confirmed.

- Key files: `docker-compose.dev.yml`, `dev/Caddyfile`, `docs/dev-testing.md`
- **New dev rig**: Caddy (`local_certs`, internal CA — no domain/ACME token) + AdGuard as
  throwaway containers for a host-run dev Loskai to point at
- **Confirmed live**: `POST /api/assign` → Caddy route lands in `srv0` (verified via the
  admin API) + the AdGuard rewrite lands (verified in AdGuard's UI); the proxied service
  actually loads through Caddy over HTTPS (internal cert, untrusted — expected in dev)
- **Learnings captured in `docs/dev-testing.md`** (troubleshooting section): dev needs
  `LOSKAI_DATA_DIR` (the `/opt/loskai` default isn't writable); the rig maps Caddy to
  `:8443`/`:8081`, so browse with the port; a `502` means Caddy reached the route but not
  the upstream; and the upstream must be reachable **from Caddy's container** — a sibling
  compose service by name (`adguard:3000`), a LAN target by IP — never `localhost`
- **Design confirmation**: an HTTP server must pre-exist in Caddy for Loskai to append to
  (it discovers, never creates). In prod the `*.BASE_DOMAIN` cert site provides it; the dev
  rig uses a fixed `*.localhost` placeholder, so `BASE_DOMAIN` stays a Loskai-only setting
  in dev (internal certs are issued per-name on demand)
- **Two gaps surfaced → Phase 9**: (1) upstream validation — Loskai stored a full URL
  verbatim into Caddy's `dial`, producing a malformed route; (2) HTTPS/TLS upstreams — the
  route builder only emits plain `dial: host:port`, so a TLS backend like Proxmox can't be
  proxied yet

## 2026-07-14 — Phase 8: Docker module (the big one)

The last and largest module — container management, directory-based stacks, and the
recipe install wizard — built last because it's the most complex. All four modules are
now feature-complete.

- Key files: `backend/src/loskai/modules/docker/{logic,client,stacks,recipes,quick_commands,router}.py`,
  four docker test files; `frontend/src/pages/Docker.tsx`, `components/docker/*`,
  `components/shared/Modal.tsx`, `lib/format.ts`
- **The seam paid off**: `logic.py` holds every computation (CPU%/memory math, RFC3339
  parsing, port formatting, the container↔instance join, stack up/down/partial, compose
  service parsing) as pure functions, so the whole module is unit-tested with **no daemon**;
  `client.py` is docker-py I/O. A down daemon surfaces as `DockerException` *or* a
  requests/OS error, so callers catch a `DOCKER_ERRORS` tuple and degrade instead of 500ing
- **Stacks**: `STACKS_DIR` is the only source of truth (no DB, no lock). Scan/read/write is
  filesystem; up/down/restart/pull/create/delete shell out to `docker compose`.
  `stacks_dir_ok` gates writes; stack names are validated against path traversal
- **Recipes**: declarative manifests validated against `docs/recipe-schema.md`, never
  executed. Two sources merged (repo wins, shadowed local flagged), git sync, install
  (generate `.env` from answers → run the type's command → register a docker instance)
- **Exec terminal**: xterm.js over a WebSocket. Critically, the WS **authenticates itself**
  — Starlette's `BaseHTTPMiddleware` doesn't cover WebSocket connections, and this is a root
  shell into a container. Keystrokes are binary stdin; resize is a JSON control frame
- **Assign extension**: `/api/assign` gained an optional `container` so a container gets a
  linked `docker` instance rather than an `external` one
- **Verified**: 103 backend + 12 Vitest tests pass; clean build/lint. Curl-confirmed
  graceful degradation with no daemon (stacks from the filesystem, recipes list, health
  `unreachable` + `stacks_dir_ok`, container ops → 502, unauthenticated exec WS rejected).
  **Live container control, log streaming, the exec terminal, and `docker compose` need a
  real daemon — untested here.** Bundle grew with xterm (~670 kB); code-split in Phase 9

## 2026-07-14 — Phase 7: deployment (single image + compose + LXC script)

Made the whole thing runnable as the single container the plan describes. No app-code
changes — packaging and infra only.

- Key files: `Dockerfile`, `.dockerignore`, `docker-compose.yml`,
  `docker-compose.colocated.yml`, `Caddyfile`, `caddy/{Dockerfile,Caddyfile}`,
  `scripts/create-lxc101.sh`, `README.md`
- **Dockerfile**: multi-stage single image. Frontend built in node:20-alpine; runtime is
  python:3.12-slim-bookworm (pinned so the Docker apt repo line matches the base OS) with
  a two-step `uv sync` (deps cached, then the project), git + Docker CLI + Compose v2, the
  bundle at `./static`, served on :8080. `CMD uv run --no-sync` so the locked env is never
  touched at runtime
- **Two compose files**: the preferred split (Loskai on the Docker host, Caddy/AdGuard on
  LXC 101) and the all-in-Docker co-located stack (with the port-conflict notes and
  required `CADDY_HOST_IP`)
- **LXC script**: provisions the Network Services box — AdGuard via its installer, Caddy
  via the **official custom-build download** (prebuilt binary with the DNS plugin, avoiding
  an xcaddy/Go toolchain in an untested script) + a systemd unit
- **Verified without a Docker daemon** (unavailable here): ran the exact production install
  `uv sync --frozen --no-dev` (confirmed dev deps removed, app still imports) and the exact
  container CMD serving the freshly-built bundle on :8080 — SPA + deep-route fallback +
  gated API + all four module statuses. Compose YAML and the LXC script parse. The real
  `docker build` / `docker compose up` still needs a Docker host

## 2026-07-14 — Phase 6: cross-module URL assignment (the keystone)

`shared/assign.py` — the one place modules coordinate, and the action that unblocks the
deferred write-path UI. The Caddy and AdGuard modules stay read + push only; this is the
sole cross-module writer.

- Key files: `backend/src/loskai/shared/assign.py`, `shared/instances.py` (PATCH),
  `frontend/src/pages/Routing.tsx`, `components/routing/ServiceTable.tsx`
- **`POST /api/assign`**: validate single-label prefix + subdomain uniqueness → Step 0
  persist intent → Step 1 Caddy route (REQUIRED; roll back — delete a new instance or
  restore an existing one — and 502 on failure) → Step 2 AdGuard rewrite with
  answer = derived Caddy IP (BEST EFFORT; warn, never fail). Handles a new external
  ("dummy") instance and an existing one; a rename removes the orphaned old-domain rewrite
- **`DELETE /api/assign/{id}`**: the mirror — clear subdomain + save, Caddy delete
  (required, rollback), best-effort AdGuard delete by exact pair; the instance survives
- **`PATCH /api/instances/{id}`**: persists the `private` flag / name (routing-table toggle)
- **Frontend**: Assign button → AssignModal → assign (result banner with URL + any AdGuard
  warning); ServiceTable delete (ConfirmDialog) + private toggle; `api.patch` added
- **assign/unassign take the clients as args** so they're driven by fakes in tests. Tier-1
  covers validation, uniqueness, happy path, Caddy-fail rollback (new + existing), AdGuard
  best-effort (error/skipped/no-IP), and the unassign mirror
- **Verified**: 65 backend + 12 Vitest tests pass; clean build/lint. Ran the whole flow end
  to end through the real HTTP clients against a throwaway Caddy+AdGuard stub — route +
  rewrite land, 422/409 guards fire, private toggle and the delete mirror both confirmed

## 2026-07-14 — Phase 5: WireGuard module (reachability card)

The simplest module — no auth, no API, no state. Loskai never manages peers; this is a
pure status card that links out to wg-dashboard.

- Key files: `backend/src/loskai/modules/wireguard/{client,router}.py`,
  `frontend/src/pages/WireGuard.tsx`, `components/wireguard/WireGuardCard.tsx`
- **Reachability**: a plain GET to `WIREGUARD_DASHBOARD_URL` with no `raise_for_status` —
  any HTTP response (incl. 401/403 from an auth-protected dashboard) counts as reachable;
  only a connection failure/timeout is unreachable
- **DNS reminder**: the router derives `dns_hint` from the host of `ADGUARD_URL` so the
  card can tell peers which DNS to use (AdGuard IP + 1.1.1.1); generic guidance when unset
- **Frontend**: the VPN tab replaces its placeholder and reads `wireguard` straight from
  the aggregate `useHealth` (the registered checker already returns url + dns_hint)
- **Verified**: 54 backend + 11 Vitest tests pass; clean build/lint. Curl-confirmed the
  reachable-on-401 rule (self-pinged the gated `/api/health`) and dns_hint derivation

## 2026-07-14 — Phase 4: AdGuard module (DNS rewrites + reconcile)

The second module — and the trickiest logic in the app, the `(domain, answer)`
reconcile. Backend follows `docs/adguard-api.md`; the DNS column and AdGuard status
fold into the existing Routing view (no separate page).

- Key files: `backend/src/loskai/modules/adguard/{client,service,router}.py`,
  `backend/tests/test_adguard_{reconcile,client}.py`;
  `frontend/src/components/routing/{AdGuardStatus,ServiceTable}.tsx`, `pages/Routing.tsx`
- **One explicit rewrite per routed instance, no wildcard.** `answer` is the shared Caddy
  LAN IP from `derive_caddy_host_ip()` (IP host of `CADDY_ADMIN_URL`, else `CADDY_HOST_IP`
  in docker mode). Delete is POST to `/rewrite/delete` with the whole `(domain, answer)` —
  the exact-pair delete is what protects hand-added rewrites
- **`plan_reconcile` is pure** (unit-tested directly): ensure `(domain, current_ip)`
  exists, migrate an orphan when the stored `dns_answer` differs (delete the stale pair),
  and report a same-domain foreign answer as a manual conflict without touching it. The
  executor applies it best-effort and persists `dns_answer` for every domain now resolving
  to `current_ip`. Only ever deletes answers Loskai itself wrote
- **Router**: health / rewrites (list+add+delete) per the contract, plus two small
  additions — `GET /status` (per-instance DNS comparison kept server-side + testable) and
  `POST /reconcile`. AdGuard unreachable → 502, never a bare 500
- **Frontend**: DNS column (rewrite set / missing / unknown + conflict) with a best-effort
  per-row add/remove; `AdGuardStatus` pill + link-out; "Push all" now runs the Caddy push
  and the AdGuard reconcile together with a combined summary
- **Fixed a Phase 3 regression**: the repo's Python `.gitignore` has `lib/`, which also
  matched `frontend/src/lib/` and silently kept it out of the Phase 3 commit — the UI built
  locally only because the ignored files still sat in the working tree; a fresh checkout
  would have failed. Added a `!frontend/src/lib/` negation and committed the missing files.
  Confirmed no other source is silently ignored
- **Verified**: 50 backend + 9 Vitest tests pass; `tsc`/`vite build`/`oxlint` clean. Curl
  confirmed answer-IP derivation, `/status` (present=null when AdGuard down), and the
  graceful 502 on reconcile when AdGuard is unreachable

## 2026-07-14 — Phase 3: Caddy module (backend) + frontend shell

First module and the whole UI skeleton. Backend Caddy module is read + push only
(never assigns — that's Phase 6); frontend is the Lutris-inspired shell plus the read
side of the routing view. Everything the write-path needs (assign, DNS column) is
deliberately deferred to Phases 4/6.

- Key files: `backend/src/loskai/modules/caddy/{client,service,router}.py`,
  `backend/tests/test_caddy_{logic,client}.py`; `frontend/src/{App,main}.tsx`,
  `components/{shared,routing}/*`, `pages/*`, `lib/*`
- **Backend, per `docs/caddy-api.md`**: `client.py` is thin I/O (server name discovered
  from `/config/apps/http/servers` and cached — never hardcodes `srv0`; push, delete
  ignoring 404, upstreams, a health probe). `service.py` holds all logic: FQDN + route
  JSON builders (keyed by `@id`), Caddyfile render, `list_with_sync` (display-only sync
  comparison, never auto-corrects), delete-then-add `upsert_route`, `push_all` recovery.
  Mode detection lives in `service`, not `client`, to keep the I/O/logic seam clean
  (TODO had it under client)
- **Health registry wired**: the caddy router registers its checker, so the aggregate
  `/api/health` now reports a real caddy status (+ `mode`) instead of `unconfigured`
- **Frontend shell**: persistent left sidebar (health dots + logout), `api.ts`
  (401→/login), `useHealth` **gated on auth** (so the public dashboard never 401s on the
  gated health endpoint), Dashboard, Login (doubles as first-run setup), Settings
  (env-read-only fields), and the Routing view (ServiceTable + Push all + Caddyfile
  export). Dark-first, Tailwind v4, maritime teal
- **Deferred (noted in TODO)**: AssignModal built + unit-tested but its `/api/assign`
  wiring is Phase 6 (the Assign button is a disabled signpost); the DNS-rewrite column is
  Phase 4; ServiceTable delete/private-toggle are Phase 6; the Settings change-password
  field awaits a change-password endpoint
- **Verified**: 30 backend tests + 7 Vitest tests pass; `tsc`/`vite build`/`oxlint` clean.
  Curl against the built `dist/` confirmed prod SPA serving (index, deep-route fallback,
  assets), API precedence over the catch-all, and unknown `/api` paths returning 404
  JSON (authed) / 401 (unauth) — never `index.html`

## 2026-07-13 — Phase 2: backend foundation (shared spine + auth boundary)

Built the backend skeleton every module hangs off: the flat-file stores, the settings
priority chain, the security gate, and the aggregate health/dashboard endpoints. No
external-service clients yet (those are Phases 3+) — this is the shared core.

- Key files: `backend/src/loskai/config.py`, `shared/{store,settings,instances,auth,health,dashboard}.py`,
  `main.py`, `tests/test_{settings,instances,auth}.py`
- **`config.py`**: pydantic-settings, every value optional. Added dev-only `LOSKAI_DATA_DIR`
  / `LOSKAI_STATIC_DIR` (aliased) so the data volume + built bundle are relocatable for
  tests and local runs
- **`shared/store.py`** (new, not in the PLAN tree): atomic JSON read/write (temp-file +
  rename) — the single file-I/O seam shared by settings + instances, so neither can be
  left half-written and both stay testable against `tmp_path`
- **`settings.py`**: the priority chain env > `settings.json` > unset, each value
  source-tagged; `PUT` ignores env-sourced keys; admin hash stored but never returned;
  answer-IP derivation (IP host of `CADDY_ADMIN_URL`, else explicit `CADDY_HOST_IP`)
- **`instances.py`**: the `Instance` model (all 7 fields) + CRUD + `list_routed()` (the
  route table = the subdomain subset)
- **`auth.py`**: argon2 hash/verify, itsdangerous signed `HttpOnly` session cookie
  (secret generated + persisted to the volume), middleware gating every `/api/*` except
  the public dashboard + login flow, first-run `/api/auth/setup`, and `LOSKAI_PASSWORD`
  seed-once-on-boot
- **Decision — `/api/health` is gated.** PLAN's security rule ("gate every `/api/*` except
  `GET /api/dashboard`") is absolute, so health sits behind auth; only the dashboard and
  the login flow are public. The Phase 2 verify line (which read as if health were public)
  was reconciled to this — health returns 401 unauthenticated, 200 with a session
- **Verified**: 16 Tier-1 tests pass; curl confirmed the full boundary (public dashboard,
  401→200 on health/settings, wrong/right login, and the complete first-run setup path
  incl. 409/422 guards). Cookie session round-trips
- **Watch out**: session cookie `secure=False` for dev HTTP — flip to True behind Caddy
  TLS at deployment (Phase 7). Health reports `unconfigured` for all four modules until
  their clients land

## 2026-07-13 — Phase 1 scaffolding: backend + frontend stood up

First code lands. Verified TODO against PLAN (fully aligned after the prior review
passes), confirmed the repo was still planning-stage, then scaffolded the two-project
layout with no app logic yet — the foundation Phases 2+ build on.

- Key files: `backend/` (uv package `loskai`, src layout, `pyproject.toml` + `uv.lock`),
  `frontend/` (Vite + React + TS), `.env.example`
- **Backend**: uv package, Python pinned to **3.12** to match the prod `python:3.12-slim`
  image (uv defaulted to 3.14). Runtime deps fastapi / uvicorn[standard] / httpx /
  pydantic-settings / sse-starlette / argon2-cffi / itsdangerous; dev pytest +
  pytest-asyncio + pytest-httpx. Dropped uv's console-script stub (app runs via uvicorn)
- **Frontend**: Vite 8 / React 19 / router 7 / Tailwind 4. Dev proxy `/api/*` → `:8000`
  with `ws: true` (for the Phase 8 container-exec socket); prod serves API + bundle on
  `:8080`. Tailwind via `@tailwindcss/vite`; Vitest + Testing Library (jsdom + jest-dom),
  a smoke test proving the harness
- **Deviation from TODO**: installed `@xterm/xterm` + `@xterm/addon-fit` instead of the
  listed `xterm` — npm deprecates the old `xterm` package and the new fit addon expects
  the new namespace. Unused until Phase 8
- **Verified**: backend `uv sync` + import smoke of all runtime libs + `pytest --version`;
  frontend `npm run build` (tsc + Vite + Tailwind, CSS emitted) + `npm test` (1 passed)

## 2026-07-13 — Renamed FlytDokk → Loskai

Renamed the project from *FlytDokk* (Norwegian *flyt* "flow" + *dokk* "dock") to **Loskai**,
chosen for searchability and adoption. From Norwegian *los* (the harbor pilot who steers ships
safely to berth) + *kai* (quay/dock). The metaphor sits inside Docker's own maritime language
(container, port, harbor) and supplies a built-in security narrative — a pilot guides you in
*safely* — which the old name lacked. Tagline: *"Safe passage for your Docker deployments."*

- Availability (checked 2026-07-13): PyPI, npm, and `.dev`/`.io`/`.app`/`.com` domains all free;
  only the empty `@Loskai` GitHub *username* is taken (use a GitHub **org**, not that handle).
  Rejected alternative *Losen* — npm `losen` is an active React **wizard** framework (direct clash).
- Mechanical: `FlytDokk`→`Loskai`, `flytdokk`→`loskai` (package/container), `FLYTDOKK_PASSWORD`→
  `LOSKAI_PASSWORD` across all `*.md` + `docs/*.md`. Prose rewrites: `PLAN.md` etymology, `README.md` header/tagline.
- **Not yet done**: repo directory is still `Flytdokk/`; GitHub org/repo, PyPI/npm names not yet claimed.

## 2026-07-13 — Testing strategy, co-located deployment, plan review

Settled the second pre-build cross-cutting concern — how Loskai gets verified given its
real side effects — then did a full plan review pass and fixed the discrepancies it surfaced.
With this, both pre-build items (security, testing) are closed and the plan is build-ready.

- Key files: `PLAN.md` (Testing & CI, Co-located port notes, compose/diagram fixes), `TODO.md` (Phases 1, 7, 8b)
- **Testing principle**: test the logic Loskai owns, mock the systems it talks to,
  rig/hand-verify the irreversible side effects — never test `httpx`/`docker-py`. Relies on
  the `client.py` (I/O) vs pure-logic seam the modules already keep
- **Three tiers**: unit tests (`pytest`) on pure logic incl. the AdGuard reconcile; client
  contract tests (`pytest-httpx`) guarding the `docs/*-api.md` contracts; a disposable
  `docker-compose.test.yml` rig of throwaway Caddy + AdGuard (`tls internal`, no ACME token,
  ephemeral). Vitest on key frontend components; no E2E. Tiers 1–2 written alongside each module
- **Co-located deployment**: `docker-compose.colocated.yml` now runs Caddy **+ AdGuard** as
  containers — a real all-in-Docker alternative to Proxmox/LXC, and the basis for the test rig.
  Documented its port gotchas (AdGuard `:53` vs `systemd-resolved`; keep AdGuard off `80`/`443`;
  services don't conflict with each other, only host-published ports do)
- **CI**: Forgejo Actions (`.forgejo/workflows/ci.yml`, GitHub-compatible) runs `pytest` +
  `vitest` on push; one-time `act_runner` registration
- **Plan review**: fixed a real gap (compose didn't pass `STACKS_DIR` into the container, so a
  custom path would mismatch the mount) plus nits — `LOSKAI_PASSWORD` missing from the compose
  env, two broken `caddy-api.md` links, the "co-located" term drifting between "Caddy only" and
  "Caddy + AdGuard", a dead `PORT` env, a redundant Vision paragraph, and two misaligned ASCII
  diagrams

## 2026-07-12 — Access model + frontend design: gated admin, Lutris-style shell

Pinned down two cross-cutting concerns before implementation: Loskai's own security
posture and the frontend layout. The security work replaced a single "add Caddy basicauth"
line with a real two-tier model; the design work settled the navigation and view structure
from four explicit choices.

- Key files: `PLAN.md` (new Security & Access section, Layout & design philosophy, instance model, frontend/backend trees, Settings), `TODO.md` (Phases 1–4, 9)
- **Two-tier access, in-app auth**: a **public Dashboard** (launcher grid of non-private
  routed services, served by the one unauthenticated endpoint `GET /api/dashboard`) and an
  **admin tier** behind a single-password login. A blanket Caddy `basicauth` can't coexist
  with a public dashboard, so auth moved *into* Loskai
- **The gate is server-side**: middleware (`shared/auth.py`) rejects every `/api/*` except the
  dashboard endpoint — load-bearing because the container-exec WebSocket is a root shell; the
  frontend `RequireAuth` is UX only. Single admin password, **no accounts**, hashed (argon2)
  from `LOSKAI_PASSWORD` or first-run, signed `HttpOnly` session cookie. First-run locks the
  admin until a password is set; the session secret is generated + persisted to the volume so
  sessions survive restarts
- **Instance model gains `private`** (dashboard hide toggle) alongside `dns_answer`
- **Frontend = Lutris-inspired shell**: a persistent left sidebar (`Dashboard · Docker ·
  Routing · VPN · Settings`) + a library-style main area with contextual per-item actions
- **Caddy + AdGuard merge into one Routing tab** (frontend only — backends stay independent):
  an assign spans both, so the view is **one row per service** with route-sync and DNS-rewrite
  status inline, instead of two tabs to cross-reference. If AdGuard is down the tab still shows
  routes; only the DNS column degrades
- **Hybrid aesthetic**: card grid for dashboard/launchers, dense tables for stat-heavy lists

## 2026-07-11 — Install-wizard recipes: repo-synced declarative manifests

Reworked the install wizard from "recipes defined in code, baked into the image" to
declarative recipes Loskai validates but never executes — so adding or fixing a service
is a file edit, not a Loskai rebuild. Landed the schema as a `docs/` contract rather than
building any authoring UI, keeping the module thin.

- Key files: `docs/recipe-schema.md` (new), `PLAN.md` (Module 1 wizard + Stack Manager, Settings), `TODO.md` (Phases 2, 8), `README.md`
- **Recipes are declarative data, never code**: Loskai validates each `recipe.yml` against
  a fixed schema and drives it with its own engine; a malformed recipe is skipped, never run.
  This is what makes syncing them from a repo safe
- **Two sources, merged**: a public git repo you own (`RECIPES_REPO_URL`, canonical, synced
  to a settings-volume cache, no auth) + a local `/opt/loskai/recipes/` dir (dev/testing
  scratchpad, same volume, no new mount). On a name clash the **repo wins**; the shadowed
  local copy is flagged. Sync is explicit ("Refresh recipes"), no background polling
- **Recipe folder** = `recipe.yml` (manifest) + a standalone `compose.yml` (native `${VAR}`,
  testable/SSH-editable, not embedded) + `instructions.md`. The **`.env` is generated** from
  wizard answers at install time and never committed (holds secrets); `docker compose`
  substitutes `${VAR}` from it, so no templating engine
- **Schema is the authoring tool**: `docs/recipe-schema.md` documents every field, validation
  rules, and the three `type` patterns (`pull` / `git_build` / `registry_pull`) — authored by
  hand or with an AI coder, so no manifest-authoring UI was built. Sample recipes live in the
  repo, not the codebase
- **Raw path made explicit**: the Stack Manager's manual create takes a finished
  `compose.yml` + `.env` and runs `up` (Docker auto-creates bind-mount dirs) — the one-off
  counterpart to the reusable recipe path

## 2026-07-11 — Docker module review: STACKS_DIR pinned, registry auth resolved

Reviewed the Docker module — the last of the four — and closed three loose ends, all
plan-level (no code yet). The module is now internally consistent: container overview +
stack manager, filesystem-as-source-of-truth, and the container→instance join all hold up.

- Key files: `PLAN.md` (Module 1, Settings table + `settings.json` shape), `TODO.md` (Phases 2, 8)
- **`STACKS_DIR` pinned to the compose mount**: it drives the same-path bind mount, so the
  container only sees the directory mounted at launch — presenting it as a UI-editable
  setting invited pointing Loskai at an unmounted host path (stacks vanish, writes land
  where the host can't see them). Now compose/env-only, shown read-only in the UI, dropped
  from `settings.json`
- **One `stacks_dir_ok()` existence check** guards the gap the empty-list signal missed —
  the write path. `create_stack` / the install wizard refuse (with a clear message) when the
  dir is absent instead of writing into the void; feeds `/api/health`. Distinguishes a broken
  mount from a genuinely empty stacks dir. No other validation logic — deliberately minimal
- **`registry_pull` auth resolved**: private-registry `docker login` is a host precondition,
  not Loskai's job — the daemon caches the credential, so the pull is identical to a public
  one and Loskai stores no registry token (same principle as the ACME token living with Caddy)
- Also listed the `WS .../exec` interactive-terminal endpoint in the Docker router task
- All four modules (Docker, Caddy, AdGuard, WireGuard) are now planning-complete

## 2026-07-10 — Caddy + AdGuard API contracts, wildcard drop, per-instance DNS tracking

Hardened the two integration modules by pinning each to its real API and writing a
`/docs` contract for the exact subset Loskai calls. Resolved the `srv0`/nested-Caddyfile
conflict, reworked the AdGuard module around explicit per-instance rewrites (no wildcard),
and made both modules read straight off `instances.json` — `@id` for Caddy, a new
`dns_answer` field for AdGuard — so "what Loskai created" lives on the instance itself.

- Key files: `docs/caddy-api.md` (new), `docs/adguard-api.md` (new), `PLAN.md` (Module 2/3, Assign, Settings), `TODO.md` (Phases 3–4, 6)
- **Caddy contract**: flat sibling routes in one server (name discovered, never hardcoded `srv0`); bootstrap Caddyfile is cert-only (wildcard TLS block, no routes); edit = delete-then-add (PATCH errors if absent); autosave + `--resume` is the restart path, "Push all" the backstop. Certificate Status **deferred** — Admin API doesn't expose the public cert; captured a TLS-probe approach for later
- **Assign consolidated** on `POST /api/assign` (Caddy required, AdGuard best-effort); Caddy module trimmed to read + push only
- **AdGuard contract**: `/control` REST API, Basic Auth, rewrite list/add/delete only; everything else (filtering, clients, DHCP, stats) stays in AdGuard's own UI
- **Dropped the wildcard DNS rewrite** — one explicit rewrite per routed instance instead, so an unassigned name falls through to public DNS and can't shadow a real public name. (Caddy's wildcard TLS *cert* is unrelated and stays)
- **DNS answer** = Caddy LAN IP (derived from `CADDY_ADMIN_URL`; new optional `CADDY_HOST_IP` fallback when that's a hostname), never the upstream, never `localhost`
- **Manual-safety**: per-entry API + exact-pair delete means hand-added rewrites are never touched; same-domain conflicts are flagged, not overwritten
- **Orphan cleanup on IP change**: each instance stores `dns_answer` (the answer last written); reconcile deletes its own stale pair and re-adds the current one — no separate state file. Instance shape gains `dns_answer`
- Known residual: an instance deleted while AdGuard is unreachable orphans its rewrite (rare, cosmetic, hand-fixable) — no pending-deletions queue for now

## 2026-07-08 — Instance data model + Caddy routing redesign + domain model

Reworked how routes are stored after mapping out the assignment workflow end to end.
Arrived at a single unifying domain object — the **instance** — that both the Docker
Manager and the Caddy routing view read from. (Iterated through a SQLite route store with
enable/disable + reconcile, then dropped it: routes are binary, and the intent already
lives in data we track anyway.)

- Key files: `PLAN.md` (new Core Data Model section, Module 2, AdGuard, Settings, Caddy Setup), `TODO.md` (Phases 1–9)
- **Instance model**: `{ id, name, type: "docker"|"external", subdomain, upstream, container }`,
  stored as one flat `instances.json` in the settings volume — **no database**. A Docker
  container and an external LAN service (Proxmox, NAS, any IP:port) are the same structure,
  different `type`. Created manually or auto (via a `loskai.subdomain` container label)
- **Routes are a projection**: the route table = instances that have a `subdomain`. No
  enable/disable — a route exists or it doesn't. `id` = Caddy `@id` (idempotent push/delete)
- Runtime container state (status/CPU/RAM) is never stored — read live from Docker and
  joined at display time, so the store can't drift from reality
- **Persistence**: Caddy runs `caddy run --resume` (its config survives restarts);
  "Push all to Caddy" rebuilds every route from `instances.json` as the backstop. No
  reconcile/drift loop
- Caddyfile export: rendered from the instance list (download / copy), also the manual backup
- Ownership rule: Loskai only manages routes whose `@id` matches an instance — the static
  bootstrap routes (Loskai, AdGuard) in the Caddyfile are never touched
- Domain model: one global `BASE_DOMAIN` (e.g. `example.no`) + per-service single-label
  prefix = FQDN. Decoupled from DuckDNS (cert method is an LXC 101 concern); renamed
  `DUCKDNS_DOMAIN` → `BASE_DOMAIN`. **No env var is required by Loskai** — this supersedes
  the earlier "`DUCKDNS_TOKEN` is the only required env var" note
- Flagged for verification: Caddy cert-expiry may not be reachable via the Admin API
  (CertStatus at risk); `registry_pull` recipes still need registry-credential handling

## 2026-06-23 — Project planning and architecture

Defined the full scope and architecture of Loskai in a planning session.
The core purpose is two-fold: a single UI for assigning clean HTTPS names to any
LAN service (Docker container, NAS, Proxmox, etc.) via Caddy + AdGuard, and a
personal install wizard for spinning up self-hosted services using curated,
opinionated recipes.

- Key files: `PLAN.md`, `TODO.md`
- Tech stack: Python + FastAPI + uv (backend), React + TypeScript + Vite + Tailwind (frontend)
- Four independent modules: Caddy, AdGuard, WireGuard, Docker — each degrades gracefully
- Build order: Caddy → AdGuard → WireGuard → Docker (Docker module is most complex, built last)
- Caddy runs natively on LXC 101 alongside AdGuard — network infrastructure separated from Docker host. Port 2019 firewalled to LXC 103 only
- Caddy mode detection: `CADDY_ADMIN_URL` encodes the mode — hostname = Docker network, IP = LAN. Frontend adjusts upstream input hint accordingly
- Docker module uses directory-based stack discovery (`STACKS_DIR`) — host directory is source of truth
- Install wizard is personal recipes defined in code, not a generic community template store
- AdGuard module trimmed to essentials: health, wildcard rewrite check, rewrite list, link out. Stats/query log/blocklist stay in AdGuard's own UI
- WireGuard module is a minimal status card: reachability ping, link out, static DNS reminder. No auth needed
- Settings system: all service URLs and credentials configurable via UI settings page or optional env vars, persisted to `settings.json` in a mounted volume. `DUCKDNS_TOKEN` is the only required env var
