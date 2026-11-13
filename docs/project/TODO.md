[Docs](../README.md) › [Project](../README.md#project)

# Loskai — TODO

**Read this when** you want what is being built now, or the backlog.

**Now:** **Phase 48** (below) — the open bugs before a release. Phase 47 split the big
files where a seam is. Phases
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
