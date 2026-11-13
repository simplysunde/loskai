[Docs](../README.md) › [Project](../README.md#project)

# Loskai — TODO

**Read this when** you want what is being built now, or the backlog.

**Now:** **Phase 47** (below) — the big files split where a seam is. **Phase 46**, the
second sweep, is done. Phases 34–45 —
machines over SSH, accounts, automatic runs, the key kept simply, the first sweep, the demo,
routes from what runs on a machine, Tailscale, links — are built and in
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
    opening at a section — to `SectionPane.tsx`; it knows nothing of machines.
- **Left whole, each one subject:** `shared/assign.py` (787 — the record-making verbs and
  their HTTP surface, which sits beside its logic as in every shared module; the one cut,
  links, shares the checks and the container's address), `ssh/connect.py` (582 — talking to
  a machine; every section uses `target` and `_run`), `ssh/tool.py` (545 — one contract,
  `tool-schema.md`), `pages/Routing.tsx` (542 — its mutations write the page's own state),
  `StackGroups.tsx` (537 — already in components).
- Tests follow their module where a test file is one module's (`test_ssh_logic.py`,
  `test_docker_recipes.py`).

**Steps**

- [x] 47a `ssh/status.py` from `ssh/logic.py`, its tests with it (logic 801 → 248, status 563)
- [ ] 47b `docker/manifest.py` and `docker/install.py` from `docker/recipes.py`, tests with them
- [ ] 47c `InstallConfigure.tsx` and `InstallDone.tsx` from `InstallWizard.tsx`
- [ ] 47d `SectionPane.tsx` from `MachineDialog.tsx`
- [ ] 47e Live: a scratch Loskai — a machine's install, overview and running list; a recipe
      synced, installed and routed; the wizard and the machine dialog in Chromium

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
  (tidier, simpler in no way — walked back the same day, Phase 47); one style for the tab strips and an `IconButton` with
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
- [x] 46g Backend: statuses decided where raised — `ToolError`, the base domain's refusal,
      one `instances.require`
- [x] 46h Backend: the status line's version is a number, not three lists
- [x] 46i Backend: saving a machine leaves the HTTP handler (`assign.save_machine`)
- [x] 46j Backend: which recipe a stack came from, once; the small duplicates and stale
      comments. Not done: one git runner — each of the four calls handles its failure its
      own way (raise, None, []), so a wrapper would only save the keyword arguments
- [x] 46k Backend: the old code — `git_build`/`registry_pull`, `admin_password_hash`, the
      pre-Phase-38 key's refusal
- [x] Backend live: a scratch Loskai on `:8010` with a real Caddy, AdGuard and a Debian
      machine. The public keys read the new way are byte-for-byte the old ones on the live
      keys. SSH: `targets` named `homelab@172.17.0.2`; scan, trust, install (two lines in
      `authorized_keys`), facts on v10 not `outdated`; a bad target 409, no setting 404, a
      bad value 422 — each from `tool.py`; removing SSH took both lines off and forgot the
      host key. A recipe installed (`.env`, the published port in `docker inspect`), routed,
      and served through Caddy (whoami's body); reconcile left both rewrites as they were,
      a hand-added answer was reported and kept, and the clear list marked it unmanaged.
      Found: every save re-added the rewrite, and AdGuard kept each copy — fixed (6245fca)
- [x] 46l Frontend: no URL built in the browser (AdGuard's pill, the wizard's "Already routed")
- [x] 46m Frontend: the route forms' preview and follow toggle, once (`opensAt`,
      `follow`, `OpensAt`) — Assign now says the scheme too. Not done: moving the Assign
      form's pre-fill from the Routing page into the form — it has one caller, so it is
      decided once already, and the move would rewrite eight of its tests
- [x] 46n Not done: one key-unlock hook. The five are five flows around one request —
      unlock, then a terminal, an install, a removal, a delete or a settings read — and
      what they share (`useUnlockFor`, `YourPassword`, `removalNeedsPassword`) is one
      already, since Phase 40; a hook would wrap only the `POST`
- [x] 46o Frontend: one route invalidation, one recipes query, `SaveBanner` on Routing
- [x] 46p Frontend: leftovers — `kind` required, `retry: false`, dead helpers, the Users
      remove dialog's pending state, Machines loaded lazily
- [x] Frontend live: Chromium (Playwright) against the same scratch Loskai — every tab and
      Settings page renders with no page errors; a route row opens at the server's `url`;
      Add route says `https://tv.smoke.test`, then `http://` once HTTP is picked, and saves
      under the shared banner; turning SSH on shows `homelab@172.17.0.2`, the server's
      target; Check for updates counts; a new stack with an empty `image:` stays open on
      Compose's refusal; Export config saves `loskai-config-<date>.json`
- [x] 46q Tests: the effect, not the response; tests that couldn't fail
- [x] 46r Tests: one signed-in admin client; settings untouched by the environment
- [x] 46s Docs: stale facts, superseded notes, browser/server pairs registered
- [x] 46t Docs: finished phases to the archive; `check-docs` checks where each phase lives
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
