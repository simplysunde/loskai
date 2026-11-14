[Docs](../README.md) › [Project](../README.md#project)

# Loskai — TODO

**Read this when** you want what is being built now, or the backlog.

**Now:** **Phase 57** (below) — the rename pass: names only, in the worktree `../loskai-rename`, each step a commit. **Phase 56** (below) gave a machine's SSH keys a place — a plain list in its SSH settings, git's side in Git's Keys — written down after the fact; its check on Sunde's machines is left. **Phase 55** put every machine's projects in one dialog. **Phase 54** gave Claude Code's card Start, Attach and Stop, following each session — its check through the page on a real machine is left. **Phase 49** gave a project's git to the Git tool; Phase 48
fixed the open bugs before a release; Phase 47 split the big files where a seam is. Phases
34–46 — machines over SSH, accounts, automatic runs, the key kept simply, the two sweeps, the
demo, routes from what runs on a machine, Tailscale, links — are built and in
[`todo-archive.md`](todo-archive.md) with Phases 1–33 and 37; what is left in them is live
checks on Sunde's machines, under *Open, not in flight*. `HISTORY.md` carries why each thing
is the way it is — read it before reversing anything, since several current decisions are
walk-backs of earlier ones.

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
- **A tool setting's value is written to the SSH log** (`write_setting`) — fine for Git's name
  and email, the only settings today. A setting that holds a secret needs a `secret` flag in
  the tool schema that keeps its value out. From the 2026-11-05 review.
- **Live checks on Sunde's machines, from Phases 34–44** — each with its context in its
  phase in [`todo-archive.md`](todo-archive.md). First **Install again** on each machine
  (status line v10; the overview says which are behind). Then:
  - the Proxmox host and a Docker LXC: the overview, `BASE_SERVICES` tuned (34); name a
    guest from its row, route a service from one (43c)
  - codebox: the overview; Update and a row action, on the Proxmox host too; its dialog —
    change a field, check the banner and the SSH entry (34)
  - Tailscale: log a machine in, its address in the overview and its card (34); share the
    LAN from the tool on codebox and from the recipe, open a routed name from a phone (44c)
  - Claude Code on codebox: `/login` in a tmux session, the projects folder (`~/loskai`), a
    project opened from the phone app (34)
  - updates: Allow updates without a password where wanted (34); Update on a machine whose
    sudo asks for a password (36)
  - route a service from a machine's running list and open it, then `make demo` again (42d —
    docker and proxmox were reinstalled on 2026-11-11; routing one is left)
- **Phase 28's last check — Sunde's Bambuddy reinstall**, then clearing the migration's
  fallbacks; the steps are in Phase 28 in [`todo-archive.md`](todo-archive.md).
- **Phase 29's last check — the Docker daemon restarted mid-run**, the next time one happens
  anyway; what to look for is in Phase 29 in [`todo-archive.md`](todo-archive.md).

---

## Phase 57 — The rename pass: a name says what the thing is

Asked 2026-11-14 (Sunde: `/rename`, then "GO!" on the inventory). A **pure rename**: every
commit changes names and nothing else — no behaviour, no wording on the page, no API, no
stored format, nothing a machine has installed. The inventory (three read-only reviewers,
each finding checked against the definition and its uses) found about 130 names worth
changing — on the backend about 42 of roughly 820 top-level names — and the rest fine as they
are. How the pass is run is `.claude/skills/rename/SKILL.md`: a worktree
(`../loskai-rename`, branch `rename`), the five guards diffed against `main` after every
commit, the full checks, `where-used.py --write`.

**Decisions (2026-11-14, Sunde: "GO!" — taken to cover the inventory's recommendations)**

- **The glossary.** The frontend's type for an instance is `Instance` (was `RouteRow`: a
  machine and a link were "route rows"); "record" stays the docs' word. The address every
  rewrite answers with is `answer_ip`, the API's word (was `current_ip`). "target" keeps its
  API senses, and the code separates them: an SSH `Target` in a variable `target`, a row's
  name `target_name`, a kind of row `TargetKind`. Identifiers say **facts**, prose and the
  page say **overview** — kept. Loskai's key is `LoskaiKey`, a key on a machine
  `MachineKey`. "Caddy is set up" is `caddySetUp`. A machine's projects *folder* is
  `projects_folder`. `config.settings` is imported as `env`, `shared.settings` as
  `settings_store`, `shared.instances` as `instances_store`.
- **The convention.** The languages' own. Functions are verbs or say what they return;
  booleans read as a question; one-letter names only in a scope of a few lines;
  abbreviations only where universal. A helper that returns or raises is `require_…`. Data
  is never named `on…`. Kept: `…_of`/`…Of`, short names read with their module
  (`connect.scan`), `_path()`, handlers named after the resource, `inst`, a component file
  named after its main export.
- **Off-limits** (the skill's contracts; beside these renames): the fields `answer_ip`,
  `target`/`targets`, `lines`, `from`, the stack form's `base`, `prefix`/`subdomain`/
  `hostname`, `projects_folder`, `upstream_mode`, the `/facts` path; `$PROJECTS`,
  `STATUS_COMMAND` and its output, `modules/ssh/tools/`; every constant's value
  (`MACHINE_TOOL`'s `"system"`, `STATUS_LINE`'s number), the query keys, the
  `localStorage` values.
- **Sunde's calls, as recommended:** `RouteRow` → `Instance`; `tool.visible` →
  `terminal_command`; `STATUS_LINE` → `STATUS_LINE_VERSION` and `STATUS_VERSION` →
  `STATUS_HEAD` (values untouched); the Machines tab's components move to
  `components/machines/`, last; the four test names that no longer say what they assert,
  and `test_caddy_logic.py` → `test_caddy_service.py`, `test_ssh_keys.py` →
  `test_ssh_unlock.py`.
- **Left alone on purpose:** `connect.removal`, `tool.allow_script`, `MACHINE_TOOL`,
  `ProjectsOverview`, `MachineService`; `record` for an Instance in `install.py` (the docs'
  word); `missing` in `lib/tools.ts` (the backend's `tool.missing`); `machines.KEEP`,
  `tool.DIR`/`WHEN`/`OTHERWISE`/`PLACES`/`TARGETS` (they mirror schema keys); `Facts`,
  `Running`, `InfraStatusPill`, `networkServices.ts`. Test names are sentences in the app's
  words and stay, the four above apart.
- **Found on the way, not fixed** (not names): `backend/pyproject.toml` says conftest lowers
  the bcrypt rounds, which it doesn't; `lib/tools.ts` carries `rowSettingsOf`'s comment above
  `cardSettingsOf`; `lib/routes.ts` imports its types from component files; three test files
  repeat conftest's isolation fixture.

**Steps** — one commit each, `Rename: <area>`

- [x] 57a Backend, the SSH target: `connect.target` → `require_target`, `reach` →
      `target_of`, `t` → `target`; a `Tool` is `tool` (`found` in `connect.py`); a row's
      name is `target_name`
- [x] 57b Backend, return-or-raise helpers are `require_…`: `_trusted`, `_tool`,
      `_tool_here`, `_overview`, `assign.same_container`, `instances._owned`
- [x] 57c Backend, the answer IP: `current_ip` → `answer_ip`, `settings.caddy_host` →
      `caddy_admin_host`. `base` for the base domain stays: each lives two lines, beside the
      `value("base_domain")` that says what it is
- [x] 57d Backend, SSH's small ones: `connect.lines`, `from_ip`, `_host_key`, `_failed`,
      `_run_of`, `tool._place`, `tool.visible`, the status booleans, the projects folder,
      `STATUS_LINE`/`STATUS_VERSION`, `machines.follow_machine`
- [x] 57e Backend, Docker and AdGuard: `install.recipe_icon`, `logic.link_instances`,
      `_dial`, `recipes._load_folder`, `adguard.service.expected`/`foreign`, the locals
- [x] 57f Backend, one alias per module: `env`, `settings_store`, `instances_store`
- [x] 57g Frontend, `RouteRow` → `Instance`, `useRoutes` → `useInstances`, `useRouteRows` →
      `useInstanceRows`
- [x] 57h Frontend, the keys: `SshKey` → `LoskaiKey`, `SshKeyInfo` → `MachineKey`,
      `sshHost` → `remoteSshHost`, `SshKeys.tsx`'s locals
- [x] 57i Frontend, tools: `onCard` → `isOnCard`, `runQuery` → `runQueryString`,
      `ToolTarget` → `TargetKind`, the runner's `onEnded` → `onResult`
- [x] 57j Frontend, an export is named after its file or step: `FillStep`, `ResultStep`,
      `PickStep`, `Ask`, `SettingsDialog`/`SettingsButton`, `Shell`. `OptionList` stays:
      `RecipeOptions` would sit one letter from the type `RecipeOption` in the same file
- [x] 57k Frontend, `caddySetUp`, `upstreamMode`, what `ssh` and `host` hold, the recipes
      helpers
- [ ] 57l Frontend, long-lived short names and old terms: `m`, `c`, `t`, `h`, `f`,
      `GATEWAY_FIELDS`, `dockerHost`, `chosen`/`picked`, the result types
- [ ] 57m Tests, backend: helpers that mislead, the aliases, the fakes, the four test
      names, the two files
- [ ] 57n Tests, frontend: `setUp` → `sshSetUp`, `open` → `openCategory`, `c`/`s`
- [ ] 57o The Machines tab's components move to `components/machines/`
- [ ] 57p Live: every tab on a scratch backend, a machine's dialog and a tool run, a route;
      then `main` fast-forwarded on Sunde's word, `:8080` and its log checked; the HISTORY
      entry with the whole `old → new` table

---

## Phase 56 — SSH keys: what a machine has, what each is for, git's side in Git

Asked 2026-11-14 (Sunde), one request at a time, starting from "should we add an option for
creating the ssh key needed for github, or forgejo?" and ending with "keep a simple overview
over the keys and list them simply … and keep git configurations and test to the git tool".
Not planned as a phase — it grew in the day and is written down here after the fact;
`HISTORY.md` has the reasons in one entry. Loskai stores nothing about a key: what it is for
is written on it (its comment's `(loskai: …)`), where it is used is read from the machine,
whether a platform takes it is a test.

**Steps**

- [x] 56a The status line reads the keys (v11), every remote of each project and submodule
      and what `ssh -G` offers each SSH host (v12), and each key's public half (v13) —
      public material only, any `user:token@` taken out on the machine; not `ssh -G` where
      an ssh config has `Match exec`, which would run a command (v14)
- [x] 56b The machine's **Keys** row in its SSH settings: SSH setup, and Keys (n) — every key,
      one line each, what it is for, its fingerprint; Copy, Label, Delete (never one
      `~/.ssh/config` names)
- [x] 56c Git's **Keys**: account and deploy keys, the remotes each is for, Test on a host
      (one connection, that key alone), Add to …, New account key, New key for a host, Test
      key, Try every key (at most 10, stopping when a host stops answering)
- [x] 56d What a key is for, written on it: Loskai's mark on every key it makes, and Label for
      any other — `ssh-keygen -c`, the key and its fingerprint unchanged
- [x] 56e A project's own key — a deploy key — in its **Project overrides**: which key it uses
      in a line, and the one button that changes it
- [ ] 56f Live: on Sunde's machines, through the page — codebox's keys checked (its
      `simplysunde-site` gets in on GitHub; `id_ed25519`, made the same day and unused,
      deleted). Left: lab-dev and proxmox; Own key on a project with an SSH remote, and Add
      to repository from there
- [ ] 56g The key buttons are Git's tool's actions, so a machine without git lists its keys
      without them — a tool of their own when a machine needs it, not before

---

## Phase 55 — Every machine's projects in one place

Asked 2026-11-14 (Sunde): "an overview from the machine overview tab, that is a dialog that
displays all the machine tools for all the machines, like a card or row for each machine so
that i can keep track of multiple claude or git projects between multiple machines". Chosen
over every tool card per machine: each project once, its git and Claude together — what is
followed is projects, not tools. Asked with it, and done before it: the tools in one order
(Git, Claude Code, Tailscale, tmux), over sorting or pinning per machine, which would store
what nothing about a tool stores.

**Steps**

- [x] 55a **Projects** in the Machines tab's header (since 55c, above its table), once a
      machine has SSH set up: a card for each such machine — its address, Tailscale, its
      own tmux sessions — and each project with its git, its Claude session, and Git's and
      Claude Code's buttons, run in that machine's terminal; each machine's overview read
      while it is open, none holding up another (`ProjectsOverview`)
- [ ] 55b Live: on Sunde's machines, through the page — Projects and Update all. So far
      (2026-11-14): Update all on four apt machines, root's and the rule's; New project on
      codebox (folder, `git init`, Claude's conversation started). Left: Clone, and Projects'
      own buttons
- [x] 55c Asked after 55a (Sunde): Projects in a row above the table rather than beside Name a
      machine, with **Update all** — System's Update on every set-up machine, one after
      another (`UpdateAll`)
- [x] 55d Asked after 55c (Sunde): New project in Projects, a side menu to jump to a machine,
      and no machine without projects — New project and Clone at the top, on a machine
      picked from all that can, so one with none yet can still get its first (since, a
      dialog from New project in the header)
- [x] 55e Each listed machine's own tmux sessions under its projects, with tmux's buttons —
      not a machine with sessions and no projects

---

## Phase 54 — Claude Code's card manages sessions

Asked 2026-11-14 (Sunde): "since its about managing sessions we should make the button better
reflect that, with instead of claude button, we should have start and stop session, attach
terminal so we can see what is going on if needed etc. more commands to manage and
administer". One session per project stays (two Claudes in one working tree overwrite each
other; a worktree per extra session is in the backlog). A button that
doesn't fit the session's state is hidden, not greyed (Sunde agreed) — then, seen, Attach
greyed instead so every row has the same places (54d).

Found first, on this VM: Claude started in the background in a folder it was never told to
trust stops at its trust question, unseen. So Start looks for it and says to Attach.

**Steps**

- [x] 54a The schema: an action's `when: running | stopped`, shown only while its row's
      shared session is (or isn't) running — the page decides, from the overview's `live`
- [x] 54b Claude Code: **Start** (in the background, Remote Control on, continuing the last
      conversation), **Attach**, **Stop** on a project by its state; **Update Claude** and
      **Stop all** at the card's foot; **New project** as it was. No Restart: Stop then
      Start, so the launch is written once
- [x] 54c Live: on this VM's own tmux (a private socket) — Start in a trusted and an untrusted
      folder, Stop, Stop all leaving a tmux session of the user's named `claude-…` alone
      — live: real Claude 2.1.325 stopped at its trust question in a new folder, run detached;
      the shipped commands, through `tool.visible`, against a stand-in claude on a tmux
      server of their own: continued where a conversation was, the trust question and an
      exit at once each said, a second Start "already runs", Stop twice, Stop all 2 of 2 with
      `claude-notes` kept — and the same as a test (`test_claude_starts_in_the_background…`).
      Not yet: Remote Control and the buttons on a real machine through the page
- [x] 54d Seen on the page, rows of one button looked "empty and unfinished" (Sunde): the
      same places on every row — Attach, greyed while stopped (`otherwise: disabled`), then
      Start or Stop in one place

---

## Phase 53 — A review's findings, Phases 48–52

Asked 2026-11-13 (Sunde, "go ahead"): fix what a code review of Phases 48–52 found, one commit
each. Left out: counting wrong passwords across an account's devices as well (#4) — Sunde's
Phase 48 choice, to decide.

**Steps**

- [x] 53a `unlock.unlocked_until` read the file twice: an unlock ending in between was a `500`
- [x] 53b The unlock dialog answered before the reads it unlocked had come back
- [x] 53c The client's address was worked out (a DNS lookup behind Caddy) holding the
      one-password-check lock
- [x] 53d A project's settings dialog refused to save for an untouched empty field
- [x] 53e `tool.visible` built `$PROJECTS` itself, beside `_projects_env`
- [x] 53f The `repo` kind let an `ssh://` user start with `-`
- [x] 53g A new SSH user while the key is locked: asked for, not a warning
- [x] 53h A new SSH user whose old one never had the key: the warning said it was still there
- [x] 53i The SSH setup dialog's, the delete's and Turn off SSH's own password fields, beside
      the unlock dialog: gone — each asks through the server's `423` and `UnlockPrompt`

---

## Phase 52 — The SSH unlock asks less, and only when you act

Asked 2026-11-13 (Sunde): "really annoyed at the constant reminder for unlocking with the
ssh key, how bad would it be to remove the password?" — a review of what the unlock protects
(a session without its password: an unattended computer, a stolen cookie; and against a
determined thief with a level-2 session only a speed bump, since the Docker tab can mount
`data/`). Then: keep it, but stop it nagging; "make the password requirement pop up more
reactively depending on what action is taken"; "and the admin switch would be a nice option".

**Steps**

- [x] 52a An unlock outlasts a restart: who holds one is in `data/ssh/unlocks.json` (owner-only,
      no secret), not the process — `make live` restarts on every save, and locked it each time
- [x] 52b One password dialog for the whole app (`UnlockPrompt`, in the layout), opened by
      what you do: a change refused `423` asks, then is sent again (`api.ts`); a card that only
      reads shows **Locked**, asking when clicked; a project's cog asks first; a terminal or
      run shows only the prompt, then connects — cancelled, it closes. The Git card's inline
      unlock form and the terminal's own are gone
- [x] 52c An admin switch, Settings › SSH — **Ask for your password**, `ssh_ask_password`
      (`SSH_ASK_PASSWORD`): `yes` by default; `no`, the Machines tab is enough. Its tooltip,
      SECURITY.md and the deployment table say for whom
- [x] 52d Live: unlocked, the backend stopped and started again — still unlocked, a setting
      read `200`, `unlocks.json` `0600`; logged out, locked. In a browser at 1280 and 390 px:
      opening the Git card asked nothing and showed **Locked**; Terminal showed the prompt
      alone (no terminal window), Cancel closed it; clicking **Locked** asked, and unlocked
      the name read as set; a terminal then opened with no prompt; no page errors. The switch,
      with a second Machines-level account never unlocked: read `423` with asking on, `200`
      off (`asks_password: false`), `423` again on

---

## Phase 51 — Push all, and the card's all-buttons under the rows'

Asked 2026-11-13 (Sunde): "I would like the pull all button to be under the rest of the pull
buttons, and maybe add a push all too".

**Decisions**

- On a card that lists rows, the tool's own actions (no `target`, no `ask`) sit at the
  list's foot, in the rows' buttons' column — Pull all starts under Pull — and in their
  small style; what asks for a name (Clone) is on the left of the same line. The list is a
  two-column grid on a wider screen so the column lines up. On a phone, where the rows' buttons
  are under each name, the all-buttons come straight after the list and Clone below them.
  A layout rule, not a key in the tool file: only Git has a list and actions of its own.
- **Push all** pushes each project with a remote that has commits its upstream lacks, as
  of the last fetch — one already up to date isn't contacted, so a private HTTPS remote
  doesn't ask for a login for nothing. One without an upstream is tried, and fails saying
  so; it says "Nothing to push." when there was none. Not `automatic`: a remote may ask.

**Steps**

- [x] 51a Push all (tested on real repos: ahead, up to date, no remote, no upstream), its
      icon, the foot of the list
- [x] 51b Live: a Debian machine with a local remote — Push all through the terminal sent
      `site`'s new commit (the remote's log `two one`), left `copy` (up to date) and `local`
      (no remote) alone, and said "Nothing to push." run again; the card at 1280 and 390 px
      with Pull all at Pull's x (850 and 42), no page errors, no sideways scroll

---

## Phase 50 — A project's own commit name and email

Asked 2026-11-13 (Sunde): a way to override the global user name and email — "a cog icon on
the same row as the rest of the action buttons?"

**Decisions**

- A cog at the end of each project row on Git's card opens the project's own **Name** and
  **Email** in a dialog: `git config --local`, in the repo. Empty is the global one, shown
  greyed; emptying one takes it off. **Save** writes the fields changed, **Cancel** nothing.
  The cog is teal while either is set. (First built as fields that opened beneath the row
  and saved as you left each — Sunde: "please use a dialog or a dropdown with the fields so
  i can enter a value". A dialog, not a dropdown: a dropdown closes on a scroll, and on a
  phone the keyboard opening scrolls.)
- A setting gains `target: project`, `overrides` and `unset` in the tool file, so the
  commands stay in Git's file. Each project's are read in the same command as the global
  ones — one connection when the card opens, and no change to the status line (which would
  have asked every machine to update its key, for a teal cog).
- Not done: git's `includeIf` (an identity for a whole folder) — a third level, hard to show;
  and a name and email at Clone — clone, then the cog.

**Steps**

- [x] 50a The schema (`target`, `overrides`, `unset`), the read of every project's and the
      write with the project as `$1`, Git's `project-name` and `project-email`, the cog and
      its panel, the log line for a value taken off
- [x] 50b Live: a Debian machine — a commit in `site` was by its own name and email, one in
      `notes` by the global ones; the name taken off (twice: the second, with nothing there,
      no failure), the next commit was by the global name and still the project's email; a
      folder named `bad name` not read; no project or `../x` refused `409`; the card at 1280
      and 390 px with the cog teal and open, no page errors, no sideways scroll
- [x] 50c The fields in a dialog with Save and Cancel, not beneath the row

---

## Phase 49 — Claude Code is its sessions, Git is the project's git

Asked 2026-11-13 (Sunde): the push and pull buttons clutter Claude Code's card; it should be
about Claude's sessions, and the Git tool should get more — a clone, a pull to update a
project. "There will be some overlap … I think that will be fine; depending on ssh or http
remotes some things will of course behave differently."

**Decisions**

- Claude Code keeps **Claude**, **End** and **New project** (it makes a git repo, but it is
  how a Claude project starts). **Pull**, **Push** and **Terminal** move to Git; the projects
  are listed on both cards, each with its own buttons.
- Git gains **Clone** (`ask: repo`, a new kind: `https`/`http`/`ssh`/`git` URLs and scp-like
  `user@host:path`, never another transport — `ext::` runs a command) and **Pull all**
  (every project with a remote, fast-forward only; it fails if one did).
- SSH and HTTPS remotes are left to git in the terminal, as the machine's SSH user: its own
  key and a host-key prompt over SSH, a login prompt over HTTPS. Loskai's key is never
  offered to a forge. None of them is `automatic`, so a prompt can be answered.

**Steps**

- [x] 49a The tool files, the `repo` kind, the Clone field (its placeholder and width) and
      the icons (arrows for Pull and Push, not git's logo on a card that is git's)
- [x] 49b Live: a Debian machine — Clone of a public HTTPS repo into `~/projects`; a project
      reset one commit back brought up to date by Pull all; Pull "Already up to date";
      `ext::sh -c id` refused `4409` before anything ran; the project in the overview; Git's
      card at 1280 and 390 px with no page errors and no sideways scroll

---

## Phase 48 — The open bugs, before a release

Asked 2026-11-13: "let's do what we can now like the bugfixing", after a look at what stands
between today and a first release. The bugs are the ones under *Open, not in flight*.

**Steps**

- [x] 48a An automatic run cut off before its password arrives leaves its tmux session
      waiting, and the next run of that action attaches to it — a blank terminal (seen live
      2026-11-06). The pane now waits `tool.PASSWORD_WAIT` (30 s) for the password, then
      removes its folder and ends — tested with a pane sent nothing; live in tmux, the
      session ended by itself
- [x] 48b The sudo ticket out of the terminal's URL (uvicorn's access log has it): the URL
      says `sudo_password=true` and the ticket is the socket's first message; anything else
      first, or nothing in 10 s, is refused `4422`
- [x] 48c A closed container terminal ends its shell: the shell gets a mark in its
      environment, and closing the terminal hangs up what has it (`HANGUP_COMMAND`, run
      in the container) — live on Alpine (busybox) and Debian (bash): the shell and a job
      it started gone, the container's own process left
- [x] 48d Wrong passwords counted per account and client (Sunde: per account + client,
      over also keeping a looser account-wide limit): a guesser's waits are their own, the
      owner signs in from another device; one check at a time still bounds many addresses
- [x] 48e A sudo rule Loskai can't see is not left behind (Sunde: take it off on a user
      change). The rule is written for the SSH user of the time, and only a different user
      failed to see it (in a 0750 /etc/sudoers.d); so a new SSH user takes Loskai's things
      off the old one first, as removing the connection does, and keeps the host key. A
      locked key doesn't stop the change: it warns what stayed
- [x] 48f Live: a scratch Loskai, a Debian machine with tmux, and a second client
      — live: a guesser in another container waited (`429` after 6) while the owner signed
      in from the host; the sudo rule put on with sudo's password as the socket's first
      message, through tmux's FIFO — the rule on, no session or folder left, the ticket
      nowhere in the access log; a resize sent first refused `4422`; the SSH user changed
      from `homelab` — its two `loskai` lines and the rule gone, the host key still
      trusted; and (48c) a closed container terminal's shell and its job gone on Alpine
      and Debian

---

## Phase 47 — Big files split where a seam is

Asked 2026-11-13, after Phase 46 left its three biggest files whole as "tidier, simpler in
no way". Nine files are over 500 lines; four of them hold subjects that read alone.

**Decisions (2026-11-13, Sunde: "splitting when it serves no purpose or is detrimental to
the overall functionality should be avoided, but making too big files, should also be
avoided when possible")**

- A file past about 500 lines is looked at; it is split where each part reads alone — a
  contract, a step, the pure part and the I/O — never where the parts must agree (a
  format's writer and its reader stay together). The rule is in CLAUDE.md's principles and
  the sweep's estimate.
- **Split:**
  - `ssh/logic.py` (801): the status key's contract — its versions, the forced command and
    the parsers of what it answers, the subject of `ssh-status.md` — to `ssh/status.py`;
    `logic.py` keeps the SSH config, `authorized_keys`, `known_hosts` and the sudo rule.
  - `docker/recipes.py` (797): the pure manifest checks and answers (`recipe-schema.md`'s
    rules) to `manifest.py`, the install and its record to `install.py`; `recipes.py` keeps
    the sources, the scan and the sync.
  - `InstallWizard.tsx` (857): the Configure step to `InstallConfigure.tsx`, the Done step
    (its route or link) to `InstallDone.tsx`.
  - `MachineDialog.tsx` (613): the side menu — search, the mark that follows the scroll,
    opening at a section — to `shared/SectionPane.tsx`, which knows nothing of machines; and
    the Turn on SSH dialog to `EnableSshModal.tsx`, as every other dialog in `routing/` is.
- **Left whole, each one subject:** `shared/assign.py` (787 — the record-making verbs and
  their HTTP surface, which sits beside its logic as in every shared module; the one cut,
  links, shares the checks and the container's address), `ssh/connect.py` (582 — talking to
  a machine; every section uses `target` and `_run`), `ssh/tool.py` (545 — one contract,
  `tool-schema.md`), `pages/Routing.tsx` (542 — its mutations write the page's own state),
  `StackGroups.tsx` (537 — already in components).
- Tests follow their module where a test file is one module's (`test_ssh_logic.py`,
  `test_docker_recipes.py`).

**Steps**

- [x] 47a `ssh/status.py` from `ssh/logic.py`, its tests with it (logic 801 → 247, status 563)
- [x] 47b `docker/manifest.py` and `docker/install.py` from `docker/recipes.py`, tests with them
      (recipes 797 → 345, manifest 230, install 238; the tests 1125 → 270, 197, 662)
- [x] 47c `InstallConfigure.tsx` and `InstallDone.tsx` from `InstallWizard.tsx` (857 → 371, 171,
      315; the path helpers its Review and Configure steps share to `lib/recipes.ts`)
- [x] 47d `SectionPane.tsx` and `EnableSshModal.tsx` from `MachineDialog.tsx` (613 → 470, 134, 63)
- [x] 47e Live: a scratch Loskai — a machine's install, overview and running list; a recipe
      synced, installed and routed; the wizard and the machine dialog in Chromium
      — live: status line v10 on a Debian machine, its overview and running list read; a bad
      folder answer refused before any file; the wizard's path notes, Deploy, and Route it
      (the app's own body through Caddy, `.env` quoted, the install record written, Check for
      updates `current`); the dialog opening at a section, the mark following picks and the
      scroll, the search, Turn on SSH; no page errors on any tab

---

## Backlog / Future ideas
- **More than one Claude session on a project** (Sunde, 2026-11-14: for now one session's
  own parallel agents — `claude agents` — are the way) — safely, a git worktree per extra
  session: `claude --worktree <name>` makes one and starts in it. On the card, a **+ Session**
  on a project, each worktree's session under it with Attach and Stop, and Remove once
  merged. Blocker: the status line lists a project only where `.git` is a folder, and a
  worktree's is a file — so it needs a status line version, and Install again on each
  machine. Not several sessions in one folder: they overwrite each other's changes
- **A one-line install, `curl … | sh`** (Sunde, 2026-11-14: for when the build is public and
  the release is a pulled image) — what the README's *Run it* does in three lines now (make
  `data` and `stacks` as the user, fetch `compose.yml`, `docker compose up -d`), as one
  script. `deploy.sh` and `make dev` stay what they are: running a checkout's own code
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
  instance — neither moves the registrar. ACME support was removed outright on 2026-09-27 (the
  internal CA is the only TLS mode), so either means bringing it back, deliberately
- **Store read amplification** (twin of Phase 15's deferred F12, noted 2026-08-29): every
  `get_instance` / `get_by_container` / `get_by_origin` / `list_routed` re-reads and re-parses
  the whole `instances.json`, so one assign reads the file several times over. Same
  shape as F12's per-key `settings.json` reads. A request-scoped read is the fix; changing the *storage format* is not (JSON is the
  right choice while the app is the writer and the file stays a human-readable recovery record)
- Tier-3 integration rig + Forgejo CI (Phase 8b) — deferred by choice
- **Dotted names for routes** — a route's prefix is one label because every name once
  shared one `*.BASE_DOMAIN` wildcard cert. Caddy now gives each name its own (2026-11-08),
  so `rack1.grafana` could be a route as it can be a machine: relax `validate_prefix` and
  `isValidPrefix` together.
- Certificate status, expiry per name (Phase 3) — under the internal CA this is readable from
  Caddy's PKI endpoints; TLS probe stays the method-independent approach
