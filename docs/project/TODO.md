[Docs](../README.md) › [Project](../README.md#project)

# Loskai — TODO

**Read this when** you want what is being built now, or the backlog.

**Now:** **Phase 35** (below) — accounts: an admin, and operators limited to tabs; built.
**Phase 34** — Machines managed over SSH; 34a–h built
(the overview, plugins, tmux, Claude Code). **Phase 33** (below) — recipe options: optional features (Jellyfin's hardware
transcoding) as checkboxes, written to the override. **Phase 32** — the stack editor opens as
a form: settings, folders, and the app read-only; the files stay a click away. **Phase 31** — recipe updates: Check for updates
lists installed recipes, shows what changed, and replaces the recipe's `compose.yml` while
your override stays.
**Phase 30** (UI polish across machines, routing, Docker and the recipe wizard) is built
and verified live (2026-10-05). **Phase 29** is built and verified live — a Docker route follows its
container, so a port changed even over SSH re-points the route by itself. Only the
daemon-restart check is unrun (it needs root). **Phase 28** also has **run live and passed**
(2026-10-03): the first real recipe
installed, linked to the right container, routed without a duplicate — and the run found and
fixed `.env` generation silently corrupting secrets; the git sync path works too. Reinstall
now keeps the route record, and a stack's Delete keeps its data unless asked. Its last bug —
root-owned files on the host — is fixed (2026-10-09): the app runs as the owner of `./data`.

Phases 13–27 are closed and **Phase 12 is complete** — 12a in Phase 19, 12b as Phase 22, 12c
as Phase 26 (2026-09-27). Phase 25 removed ACME support the same day: the internal CA is the
only TLS mode the shipped configs know. Otherwise pick from the
[backlog](#backlog--future-ideas) at the bottom of this file.

**Phases 15, 16 and 18 closed 2026-09-05** — 15 and 16 on live smokes against a real Docker
daemon, **the first time this project had ever been run** rather than unit-tested, and 18 is
the path restructure that came straight out of running it. **Phase 19 closed 2026-09-09** (the
public Certificate page). `pytest` (379) + `npm test` (131) + `check-docs.sh` all pass.

**Two things a fresh session should know before touching anything:**

- **Routes are pushed at the *head* of Caddy's array** (`PUT …/routes/0`), never appended.
  The bootstrap Caddyfile's `*.{$BASE_DOMAIN}` block — which exists only so Caddy issues the
  wildcard cert — compiles to a handler-less `"terminal": true` route placed first, matching
  every name Loskai routes. Appending put every pushed route behind it, where it never ran and
  Caddy answered an **empty `200`** instead of proxying. It failed as a *success*, which is why
  209 unit and contract tests never saw it and `/api/caddy/routes` reported `synced: true` and
  `upstream_healthy: true` the whole time. Full write-up in
  [`todo-archive.md`](todo-archive.md) Phase 16; the operator-facing version is
  [`troubleshooting.md`](../guides/troubleshooting.md#a-blank-page-or-an-empty-200).
- **Nothing lives in `/opt` any more** (Phase 18, below). State is `./data:/data`, stacks
  default to `./stacks` beside the compose file, both directories are tracked with a
  `.gitkeep`, and a fresh `git clone` + `docker compose up -d` works with no `.env` and no
  `sudo` — but compose must be run **from the project directory**.

> **Layout letters were reassigned 2026-09-04** — **A** split-LXC (three-way) · **B** split DNS
> (two-way) · **C** all-in-Docker (one box). Archived phase text written before the swap calls
> split DNS *C* and all-in-Docker *B*; it is left as written, since it records work as it was
> done. Current-state docs use the new letters.

## Open, not in flight

_Found 2026-09-09 while archiving: the archive header claims "nothing here is live work" and
that has never been true. These are real, unfinished, and unblocked — listed here so they are
visible without unpacking a phase back out. The checklists stay in
[`todo-archive.md`](todo-archive.md)._

- **Phase 12 — internal-CA trust onboarding. Archived 2026-08-27 before it was complete.**
  Finished 2026-09-24 across two later phases; only 12c (documentation) remains.
  - ~~**12a** — the trust-install page prints Debian-only Linux instructions~~ **done in
    Phase 19** (below): both pages now carry Debian, Fedora/RHEL and Arch/openSUSE commands,
    plus the NSS step Chrome and Chromium need on Linux
  - ~~**12b** — per-route scheme toggle (`https` / `both` / `http`), approved 2026-08-03~~
    **built 2026-09-24 as Phase 22** (below). Its notes had specified insert-at-index-0 for
    the `:80` server since August — the same rule the 2026-09-05 defect turned out to need
    for `:443`, a month later and at the cost of a day
  - ~~**12c** — Caddy as ACME server for HTTPS-native backends~~ **done 2026-09-27** —
    [`backend-certificates.md`](../guides/backend-certificates.md). **Phase 12 is complete.**
- ~~**Two live smokes that were never run** — Phases 10a and 13~~ **both ran 2026-09-16 and
  passed**, 10a together with Phase 19's browser check (below). Results are in each phase's
  checklist in [`todo-archive.md`](todo-archive.md)
- Phase 8b's Tier-3 integration rig + Forgejo CI are unchecked **by choice** — see the backlog
- **Before publishing: the forge addresses.** Two places name this repo's LAN Forgejo and
  must follow it to wherever it is published: `config.DEFAULT_RECIPES_REPO` (the seeded
  recipe source) and `REPO_URL` in `frontend/src/lib/docs.ts` (the Docker tab's link to
  `migration.md`)
- **Decide: count wrong passwords per client.** The login backoff has one counter for
  everyone (behind Caddy every request has Caddy's address), so a LAN script guessing the
  moment each wait ends keeps the admin out until it stops or Loskai restarts. The proposed
  fix: key the count by client, trusting Caddy's `X-Forwarded-For` only on requests from
  Caddy's own address. Found by the 2026-10-30 review; documented in `SECURITY.md` meanwhile.
- **A closed terminal leaves its shell running in the container.** Docker keeps an exec'd
  process alive after its connection closes (live, 2026-10-30: four closed terminals, four
  `bash` processes left). Needs a way to end it — `exec_inspect` gives its host PID, which
  Loskai's container can't signal.

---

**Phases 1–17 live in [`todo-archive.md`](todo-archive.md)** (1–13 moved 2026-08-27, 14–17 on
2026-09-09). Phases 18 and 19 are kept below, as the most recent work. `HISTORY.md` carries the
narrative of what was built and *why* — read it before reversing anything, since several
current decisions are walk-backs of earlier ones.

---

## Phase 18 — Get Loskai's paths out of `/opt`

_Origin (2026-09-05, immediately after the Phase 16 smoke): running the thing for real
surfaced the friction. `STACKS_DIR` defaulted to `/opt/stacks` and `LOSKAI_DATA_DIR` to
`/opt/loskai` — both need root to create, so the smoke had to point them elsewhere before it
could start. `dev-testing.md` carried a troubleshooting row for `PermissionError: '/opt/loskai'`,
and `.env.example` shipped `STACKS_DIR=/opt/stacks` with no `LOSKAI_DATA_DIR` line at all, so
copying it and running `make backend` hit that error by construction. The default was right for
exactly one of the three contexts it is used in — a container running as root — and wrong for
the two a person actually touches._

_**Decisions (Sunde, 2026-09-05).** Keep the same-path invariant rather than lifting it with
`--project-directory`; default both paths beside the compose file; env vars stay as pure
overrides. On the container's filesystem looking odd: "i dont care how the file system inside
the docker container looks as long as it works and makes it simple for the end user — if that
requires that the paths on host and docker container mirror each other then that is what we
will do."_

**What shipped**
- [x] **`./data:/data`** replaces `./loskai-settings:/opt/loskai` in all three compose files;
      `config.py`'s `data_dir` default follows. `LOSKAI_DATA_DIR` stays an override, and dev
      sets it (the in-container path isn't writable from the host) — `.env.example` now says so
- [x] **`STACKS_DIR` defaults to `${PWD}/stacks`**, was `/opt/stacks`. `config.py`'s own default
      is anchored to the repo the way `_REPO_ROOT_ENV` already was, so `make backend` works with
      nothing set. **`config.py:49` was deliberately left alone in the first pass** and only
      changed once every other `/opt/stacks` was gone — the code default fires only when nothing
      set it, so it is a last-resort value, not a deployment default
- [x] **`data/`, `data/recipes/` and `stacks/` are tracked** (a `.gitkeep` each), because Docker
      creates a missing bind source as `root:root 755` — measured, not assumed. Without them a
      fresh clone gets root-owned directories and `data/recipes/`, the folder recipes are
      *hand-added* to, needs `sudo` for every write. That was already true before this phase
- [x] `deploy.sh` checks for a stranded `loskai-settings/` right after the `git pull` that swaps
      the compose file, and stops with the command to run
- [x] Docs: `deployment.md` (env table, Volumes, the same-path section + a new *run compose from
      the project directory* subsection, and *Upgrading from `/opt/loskai`*), `migration.md`
      (a new **Moving Loskai itself** section), `install.md`, `dev-testing.md`,
      `recipe-schema.md`, `.env.example`, `PLAN.md`, `docs/README.md`, `CLAUDE.md`

**Walked back within the same session — an in-app startup guard**

_Built, tested, then deleted. `verify_data_dir()` refused to boot when state was stranded at
`/opt/loskai`. It worked, it had five tests (including one pinning that it ran **before**
`auth.ensure_seeded()`, which writes `settings.json` and would otherwise mask the stranding),
and it needed a `conftest.py` patch so a developer with a real `/opt/loskai` didn't fail every
test that starts the app. **137 lines.**_

_Sunde: "would a missing settings.json indicate a first run? So we would need to set the password
again and redo the settings, not the end of the world … I dont think we need to gate keep so
much, the important part are that it works and gives a massege if something is wrong."_

_Right, and the measurement backs it: the destructive case (old mount kept, `/data` unmounted,
writes going to the container layer) needs a locally-modified compose file to survive
`git pull --ff-only`. The case that will actually happen is a fresh install with the old state
untouched on disk — recoverable, and caught host-side by `deploy.sh`. **Refusing to boot is the
convention for data stores** (Postgres on a `PGDATA` version mismatch, Elasticsearch on an
incompatible data dir) where a wrong guess destroys something irreplaceable; Loskai's state is
re-enterable, and the routes themselves live in Caddy keyed by `@id`, so even the instance list
is readable back out of Caddy's config. Wrong category for that machinery._

**Verification** — the three checks, plus live runs, because this is exactly the class of thing
static checks miss:
- [x] `pytest` (210) + `npm test` (38) + `check-docs.sh`
- [x] **Fresh `git clone`, no `.env`, `docker compose up -d`** — boots, `/api/dashboard` 200, the
      UI serves, first-run setup works, state lands in the clone's own `data/`. A hand-written
      recipe dropped into `data/recipes/` as a normal user (no `sudo`, no container access, no
      restart) is picked up as `source: local`
- [x] **The same-path rule proven through Loskai**, not just in `compose config`: a managed stack
      with `./payload:/payload`, started via `POST /api/docker/stacks/demo/action`, produced
      `Source=<clone>/stacks/demo/payload` — the correct *host* path — and no stray `/stacks` at
      the host root
- [x] **A relocation, end to end.** `mv` the whole install to a new path and bring it up: the
      relative bind followed (`<old>/…/payload` → `<new>/…/payload`), the named volume reattached
      (`demo_dbdata`, since the project name is the stack directory's basename), both kept their
      data, and Loskai still knew its admin password and rediscovered the stack. Written up in
      `migration.md` along with the three things that *don't* survive a move to a new **machine**
- [x] The migration command in the docs was **wrong on the first pass** and the live run caught
      it: `mv loskai-settings data` nests the state at `data/loskai-settings/` because `data/`
      now always exists. It is `mv loskai-settings/* data/ && rmdir loskai-settings`

**Known sharp edge, accepted and documented**

_The default is `${PWD}/stacks` because **Compose has no interpolation variable for the project
directory** — verified: `COMPOSE_PROJECT_NAME` resolves correctly even via `-f` from elsewhere,
but no path variable exists. So compose must be run from the project directory; `deploy.sh`
`cd`s there first. Run it from somewhere else and stacks point at `<that directory>/stacks`,
which the Stack Manager shows as an empty list rather than an error, because Docker created the
directory. Setting `STACKS_DIR` to an absolute path pins it. This affects **only** `STACKS_DIR`:
`./data` is resolved by Compose against the project directory, so state is correct from
anywhere. That asymmetry is the price of same-path, and lifting it needs the
`--project-directory` + `--env-file` pair (measured to work, and to fail **silently** on a
stack's `.env` if the two ever drift) — considered and not taken._

---

## Phase 19 — The Certificate page

_Origin (2026-09-09, Sunde): "I want to instead have a little download button on the caddy pill
that is displayed on the routes page." The root was only reachable through Caddy's `:80`
onboarding site, so getting it meant leaving Loskai for a by-IP URL._

_**Decisions (Sunde, same session).** The pill button was dropped in favour of a dedicated page
— "we might not need the download button on the caddy pill in routes if we are making a
dedicated page." The page is **public like the Dashboard**, with its sidebar link controlled
from settings, because "if we have acme domain the browser would automatically trust it and we
no longer would need the internal root." The `:80` site stays._

**Why not just link the pill at Caddy's `:80` file**

_A plain-HTTP download initiated from an HTTPS page is blocked by Chrome and Edge, **without a
visible error** — and Loskai is normally reached over HTTPS through Caddy, so that is the case
that matters. Serving the PEM from Loskai's own origin is what makes the download work at all.
Reading it from Caddy's **Admin API** rather than its data volume is what makes it work in
split-LXC, where Caddy's disk is on another machine._

**What shipped**
- [x] **`GET /api/caddy/root-certificate`** — `client.local_ca()` (`GET /pki/ca/local`, the only
      cert-material call Loskai makes) + a pure `service.root_certificate()` that takes the root
      alone and rejects a PEM missing its markers. A truncated anchor installs fine and fails
      later, at the browser, after the user believes they fixed it
- [x] **Public**, in `PUBLIC_ROUTES` — the device that needs the root has no admin password and
      cannot yet trust the HTTPS route it would log in over. No key material is involved; a root
      CA is public by construction
- [x] **`/certificate`** — download plus per-OS trust steps, outside `RequireAuth`. Platform
      tabs rather than the `:80` page's detect-only display, which stranded a phone on desktop
      instructions
- [x] **`certificate_tab`** setting (`public` / `admin` / `hidden`, default `public`; env
      `CERTIFICATE_TAB`, Settings → Network). It moves a **link, not a lock** — `/certificate`
      and its download stay public in every mode, and the tests say so
- [x] Rides on `GET /api/dashboard`, the one payload a logged-out visitor can read, so the
      sidebar can decide before anyone logs in. New `useDashboard` hook so both consumers of
      the `["dashboard"]` key share one type
- [x] **12a fixed on both pages** — Debian, Fedora/RHEL and Arch/openSUSE trust stores, and the
      NSS database Chrome and Chromium read on Linux instead of the system store. A
      system-wide install alone leaves the warning in place in the browser most people use
- [x] `check-docs.sh` check 2 now reads a `public: true` marker on each `NAV` entry instead of
      excluding `Dashboard` by name — otherwise a second public tab reads as a missing admin tab
- [x] Docs: `certificate-setup.md` (rewritten around the two paths, with a table for which to
      use), `api.md`, `caddy-api.md` (`/pki/ca/local` moved out of *Not used* — the dead-end
      note there was about cert **expiry**, which it still is), `deployment.md`, `PLAN.md`,
      `CLAUDE.md`

**Verification**
- [x] `pytest` (222) + `npm test` (48) + `check-docs.sh`
- [x] **Live, against a real Caddy.** The PEM Loskai serves is **byte-identical** to
      `/data/caddy/pki/authorities/local/root.crt`, the file the `:80` site hands out, and
      `openssl x509` reads it as `CA:TRUE, pathlen:1`. Fetched with **no session cookie**;
      `GET /api/caddy/routes` on the same instance still answered `401`
- [x] Also exercised end to end against a **real homelab Caddy** (a dev backend already running
      on `:8000` with a live `CADDY_ADMIN_URL`) — same result, a valid CA root over a public GET
- [x] **The page in a browser** (2026-09-16, with the Phase 10a smoke). Headless Chromium 153
      and Firefox 155, logged out: the sidebar link leads to `/certificate`, all three platform
      tabs switch, and clicking the button saves `caddy-root.crt` **byte-identical** to Caddy's
      `root.crt`, no console errors. Firefox mattered: `download()` revokes the blob URL
      straight after `a.click()`, a known race there, and the file still arrived whole. All
      three `certificate_tab` modes checked the same way — `admin` shows the link only once
      logged in, `hidden` never, and `/certificate` plus its download stay reachable logged
      out in both

**Adjacent, flagged not fixed**

_`caddy/Caddyfile` uses a bare `:80 { … }`, which matches every hostname on that port and so
displaces Caddy's automatic HTTP→HTTPS redirects: typing `grafana.home.lan` with no scheme lands
on the onboarding page instead of redirecting. `certificate-setup.md` has recommended scoping it
to the host IP since Phase 10a; the shipped co-located Caddyfile never did. Now written down in
that guide as a known edge rather than left implicit._

---

## Phase 20 — Clear AdGuard rewrites

_Origin (2026-09-20, Sunde, after changing `BASE_DOMAIN` mid-development): rewrites under the
old base domain are stranded. `is_loskai_domain` scopes the orphan sweep to the **current**
base domain, so Sync cannot see them, and an unassign computes the delete pair from the
current domain too — it deletes a name that no longer exists and leaves the real one behind.
Nothing in Loskai could clean them up._

_**Decision (Sunde).** "Make it so that we don't touch the hand-added ones was a decision that
was made earlier in development before we had the dns_only rewrite option in Loskai." With
`dns_only`, Loskai can name anything on the LAN, so it is plausible as **the** way to manage
rewrites — and that needs a reset for an AdGuard that already carries some. A clear button
under AdGuard in Settings, behind a dialog with a warning, so adopting an existing AdGuard is
a choice rather than a hand-cleanup._

**Why the clear restores in the same call, rather than a second button**

_A separate resync already exists — the **Sync** button on Routing. A clear that doesn't
restore leaves the LAN with no working names until someone remembers to press it, and that
window is where duplicates come from. Clearing and reconciling in one call makes duplicates
impossible by construction: reconcile runs against an emptied list, so every routed name is
missing and is added exactly once. Sunde's own requirement ("need to make sure that duplicate
routes don't occur") is what settles it._

**What shipped**
- [x] **`POST /api/adguard/rewrites/clear`** — `service.clear_and_restore()`: delete every
      entry AdGuard holds by its exact `(domain, answer)` pair, then `reconcile()`. Returns
      `{ cleared, restored, conflicts, errors }`
- [x] **Preconditions are checked before the first delete** (`_check_reconcilable`, extracted
      from `reconcile` so both share one rule). A `proxy` instance routed with no derivable
      answer IP would make the restore raise *after* the wipe — leaving DNS empty. It now
      refuses with `400` and deletes nothing
- [x] A failed delete is reported per domain, not folded into the success line, and the
      restore still runs — reconcile re-lists from AdGuard, so a leftover shows up as a
      conflict rather than silently
- [x] **The exact-pair rule is untouched.** Each delete still names its pair; no automatic
      path (assign, teardown, reconcile, the orphan sweep) touches a foreign rewrite. This
      adds one explicit, confirmed action — it does not widen any existing blast radius
- [x] **Settings › Network › AdGuard** — `ClearRewrites` panel: a danger-styled button, a
      `ConfirmDialog` naming hand-added rewrites and a previous base domain as collateral and
      saying they cannot be recovered, and a result line ("Removed 4 rewrites, restored 2")
- [x] **`GET /api/adguard/rewrites`** + a disclosure in the dialog listing every entry that
      is about to go (added 2026-09-20, same day, on Sunde's "a spoiler menu where we can see
      all the entries"). Each row is marked **restored** or **not restored** by the pure
      `annotate_rewrites()`, which reuses the same `rewrite_domain`/`target_answer` pair the
      restore itself uses rather than re-deriving the rule — so the preview cannot promise
      something the clear won't do. The summary leads with the count that matters
      ("· 3 not restored"), and the list is collapsed by default so the warning stays the
      headline. Fetched only while the dialog is open, uncached — "what am I about to lose"
      must not be answered from a stale read
- [x] **`overscroll-contain` on the list** (Sunde, same day: "after reaching the end the page
      under start scrolling too, that doesn't feel correct"). Without it the wheel chains into
      the page behind the dialog the moment the list bottoms out. Measured both ways in a real
      browser rather than reasoned about: list parked at its end, two wheel ticks moved the
      page `0 → 240`; with the fix, `0 → 0`, and one tick from the top still scrolls the list
      by 120. **Not unit-tested** — jsdom has no layout, so scroll chaining cannot be
      reproduced there; the code carries a comment saying why the class is load-bearing
- [x] **`useScrollLock` on every overlay** (Sunde: "do the background scroll lock too" — the
      `overscroll-contain` above only stopped the hand-off *from the list*; a wheel over the
      backdrop still scrolled the page). A ref-counted hook freezing `body` while an overlay
      is up, applied to `ConfirmDialog`, `Modal`, `AddRouteModal` and `AssignModal` — all four
      overlays, so they behave alike rather than one dialog being the odd one out. Ref-counted
      because a ConfirmDialog can open *inside* a Modal (delete a stack from the stack editor)
      and the inner close must not unfreeze the page under the outer one. It restores the
      previous `overflow` rather than blanking it, and pads by the scrollbar's width so the
      page doesn't jump sideways as a dialog opens
- [x] Tests: `test_adguard_clear.py` (9 — foreign entries cleared, one-per-name restore, the
      two refusals, a failed delete, and four on the annotation, including a hand-added answer
      on one of *our own* names being marked not-restored) + `ClearRewrites.test.tsx` (10 —
      the dialog gates the call, cancel is a no-op, the warning's wording, the preview's rows
      and counts, empty and unreachable lists, both result shapes, a 502) + `useScrollLock`
      (5 — lock, release, toggle without unmount, the nested case, and restoring a body that
      already had an `overflow`). Unlike the overscroll fix this one *is* testable in jsdom,
      since `body.style` is observable without layout
- [x] Docs: `api.md`, `adguard-api.md` (Ownership gains its one exception), `PLAN.md`,
      `CLAUDE.md` (the invariant's caveat + the route count)

**Verification**
- [x] `pytest` (233) + `npm test` (63) + `check-docs.sh` + `tsc -b`
- [x] **Live, against a real AdGuard** (`compose.dev.yml`, v0.107.79), clicked in the browser:
      seeded two Loskai rewrites, one hand-added (`printer.smoke.test`) and one under a
      previous base domain (`oldnas.previous.lan`). **Sync first — `added/deleted/swept` all
      empty**, both foreign entries untouched, which is the behaviour being preserved. Then
      Clear: all four removed, exactly two restored, and `nslookup` against AdGuard's `:53`
      answered `.220` and `.50`. A second Clear left the same two — no duplicates. `health`
      reported `consistency: []` throughout
- [x] **The preview checked against the clear it previews**, live: seeded five rewrites
      including a *second* answer on one of Loskai's own names (`grafana.smoke.test →
      10.0.0.7`). The dialog marked exactly that one, the hand-added entry and the old-domain
      entry as **not restored**; the clear then removed all five and restored precisely the
      two it had promised
- [x] **The scroll behaviour measured in a browser**, with 18 rewrites in the list: `body`
      `overflow` `visible → hidden` on open and back on close, four wheel ticks over the
      **backdrop** left `scrollY` at `0`, the list still scrolled (`0 → 120`), the page
      scrolled again once closed (`0 → 273`), and the Add route modal locked the same way

---

## Phase 21 — Machines as upstreams

_Origin (2026-09-20, Sunde, out of the Devices-tab conversation): "dns rewrites show up as
named machines which can be used to replace ip adresses when setting proxy routes… we would
then be able to make external in add route have a list similar to containers and network."_

_**The model already had it.** An instance may exist without a subdomain (`PLAN.md`: tracked
but not exposed), and `container`/`origin` are existing precedents for a field linking an
instance to what it *is*. A "machine" needs no new concept — it is an instance whose upstream
is a bare IP._

**Decisions (Sunde, Q&A 2026-09-20)**
- **A real link, not a snapshot** — a proxy route should record *which machine* it points at,
  so changing that machine's IP once updates every route to it. Same shape as `container`
- **A second button, not a second tab** — "Name a machine" beside "Add route" on Routing, one
  table below. Route creation stays a single surface (the invariant the Add route picker
  exists to hold), while naming a machine is a different verb. The tab split from the Devices
  conversation stays dropped
- **Staged** — the pick list first, since it needs no schema change and proves whether the
  machine idea earns the link field

**21a — the pick list _(shipped 2026-09-20)_**
- [x] **Frontend only, no new endpoint** — `GET /api/caddy/routes` already returns every
      instance with `route_mode` and `upstream`, and the Routing page has it cached
- [x] External's source panel lists machines (`isValidDnsTarget(upstream)`, i.e. a bare IP)
      above the manual form, in `proxy` mode only — DNS-only is where machines are *made*
- [x] **Not filtered by routed**, unlike the Container and Network sources: you are borrowing
      an address, not routing the thing
- [x] **Fills the address, never the prefix.** `nas` would collide with the name the machine
      already answers to — the route is a service *on* it (`plex`), not the machine. The
      upstream is filled as `192.168.10.50:` so the port is all that is left to type
- [x] Tests: 5 new in `AddRouteModal.test.tsx` (machines listed and only machines, the
      prefill, the prefix left alone, no list in DNS-only, the empty state still takes a typed
      address). The harness gained `/api/caddy/routes` — an unmocked path returned `{}` and
      `.filter` crashed the modal
- [x] Live: named a machine, then created a route by picking it — assign `200`, the route
      proxied whoami over TLS, both rewrites correct

**21b — the link field _(shipped 2026-09-20)_**
- [x] **`machine` on the instance**, with `list_by_machine` + `is_machine` beside
      `get_by_container`/`get_by_origin`. Unlike those two it is **not an idempotency key but
      a dependency**, and one-to-*many*: a machine hosts any number of services
- [x] **Propagation is eager, not derived at push time** (the TODO above said push-time —
      changed on implementation). When a machine's assign moves its address, every dependent's
      upstream host is rewritten and its route re-pushed inside the same call, so `upstream`
      stays exactly what Caddy dials and nothing downstream needs a lookup. A no-op assign
      re-pushes nothing. A failed re-push warns and leaves the **stored** upstream correct —
      which is what makes Sync a repair rather than a second guess
- [x] **Rejects a bad link up front** (`validate_machine`): `404` unknown, `422` for a service
      (its upstream has a port) or for an instance naming itself
- [x] **Deleting a machine unlinks, never blocks.** Dependents keep its last address and go on
      working; the response lists them in `unlinked` and the dialog names them first. Refusing
      was the alternative — rejected on Phase 18's standing preference for doing the thing and
      saying what happened, since nothing here is unrecoverable
- [x] `"Name a machine"` beside `"Add route"`, opening the same picker preset to External +
      DNS-only (`initialSource`/`initialRouteMode`, remounted by `key`). A second verb, not a
      second creation surface
- [x] A `via <machine>` tag on linked rows — otherwise the link is invisible until the machine
      moves and the row quietly follows it
- [x] Tests: +10 backend (`relink_upstream`, linking, propagation across two routes, unlinked
      rows untouched, a no-op assign, the failed re-push, the three rejections, delete-unlinks)
      and +5 frontend (the link is sent, a typed address sends none, the presets, the tag)
- [x] Docs: `api.md` (assign body + the delete's `unlinked`), `PLAN.md`, `CLAUDE.md`

**Verification**
- [x] `pytest` (243) + `npm test` (73) + `check-docs.sh` + `tsc -b`
- [x] **Live.** Named a machine through the new button, routed a service onto it by picking it
      (`via nas` shown), then moved the machine to `192.168.10.231`: the response said
      `relinked: ["hello"]` and **Caddy's own dial changed to `192.168.10.231:8099`** — the
      route then answered `502`, which is the proof the change reached Caddy, since that
      address is fictitious. Re-pointing at the real one served `200` again. Deleting the
      machine returned `unlinked: ["hello"]`, and that route kept its address with
      `machine: null`

**21c — two verbs, and views over the one table _(shipped 2026-09-21)_**

_Sunde asked whether the add function and model should be split into a reverse-proxy one and
a `dns_only` one, whether machines deserve their own schema, and whether the two should
reference each other. Measured before answering: `assign()` is ~190 lines with **four**
behavioural branches on `route_mode` (prefix validation, upstream validation, the Caddy step,
the answer/URL shape) — everything else, including the rollback and AdGuard's exact-pair
cleanup, is shared. Splitting the flow would duplicate the parts where a divergence would hurt
most, and a separate machine schema would contradict the founding "same struct, different
`type`" decision. The reference already exists: `machine`, added in 21b._

- [x] **Thin wrappers, not a split flow** — `assign_route()` and `name_machine()` over the one
      orchestration, so call sites and tests read as two verbs with nothing duplicated
- [x] **Views on the Routing table** (Sunde: "different sorting logics… only services, only
      machines, both, groups, with the default being both"): All · Services · Machines ·
      Grouped, the last putting each machine directly above what runs on it, with anything
      unlinked kept at the end rather than dropped. Pure `applyView`, so "no view ever loses a
      row" is a test rather than a hope
- [x] **The `via` tag resolves to the machine's current name.** The link is stored by instance
      id — which an edit never changes, so a rename keeps it — but the id is the name the
      machine was *created* under, so the tag would otherwise read stale after a rename
- [x] Tests: +4 backend (the two wrappers, and that a rename keeps the link and propagates
      nothing, since dependents hold an IP that did not move) and +7 frontend (the four views,
      the no-row-lost invariant, the tag after a rename, its fallback)
- [x] Live: five rows across two machines, renamed one, and stepped through all four views —
      grouped read `Storage box · files · plex · vm1 · loose`, and the tags followed the rename

**Answered while implementing:** a machine's IP change propagates (21b, verified); a *name*
change keeps every link, because the link is by id; and the display `name` is owned by
`PATCH /api/instances/{id}` — an assign deliberately leaves it alone.

**21d — `kind`, declared instead of inferred _(shipped 2026-09-21)_**

_Until now "is this a machine?" was the string test `":" not in upstream`, read in three
places — `validate_machine`, the propagation guard, and the frontend's view filter. Correct
for everything the UI creates, and a guess for anything else._

- [x] **`kind: "service" | "machine"` on the instance**, set from the verb that assigned it
      (`name_machine` → machine, `assign_route` → service) and re-evaluated on every assign,
      so re-pointing a machine at a `host:port` makes it a service
- [x] **No migration step.** A `model_validator(mode="before")` back-fills `kind` from the old
      upstream-shape rule *only when the field is absent*, so a stored value always wins and
      the next write persists the answer. Verified against a hand-written pre-`kind`
      `instances.json`: `nas` read back as `machine`, `plex` as `service`, an upstream-less
      record as `service`, the file untouched until something wrote to it
- [x] `is_machine()` is now `kind == "machine"`; the frontend reads the field off the row and
      keeps the shape test only as a fallback for a row from an older build
- [x] Tests: +5 backend (back-fill for both shapes and for no upstream, a stored kind winning,
      the verb deciding, a machine re-pointed at a port becoming a service) and +2 frontend
- [x] Live, on the legacy store: the back-filled machine accepted a `machine` link and
      propagated a move (`relinked: ["files"]`, `.50` → `.70`), while a legacy record that was
      never linked stayed put

**21e — two models, two endpoints, two modals _(shipped 2026-09-21)_**

_Sunde, after the wrappers landed: "I still want you to split up the dns-only (machine name
model) and add routes model." Asked once about depth and answered **models + API + UI, one
stored record** — so `instances.json` and the Routing table are untouched._

- [x] **`MachineCreate` / `RouteCreate`**, each carrying only what its verb means. A machine
      has `hostname` (dotted allowed) + `address` (bare IP); a route has `prefix` + `upstream`
      + `upstream_tls` + the `machine`/`container`/`origin` links. `upstream_tls` on a machine
      used to be accepted and silently dropped; now it isn't a field
- [x] **`POST /api/machines` + `POST /api/routes` replace `POST /api/assign`** — one door per
      verb rather than one door with a `route_mode` flag. A test asserts the old path is gone
- [x] **`AddMachineModal`** — its own form: no source tabs, no port, no TLS, its own hint copy.
      `AddRouteModal` lost the Proxied/DNS-only toggle, `AssignModal` lost `allowDnsOnly`, and
      `useRouteFields`/`RouteFields` lost the `isDnsOnly` branching they carried for it
- [x] **Change URL dispatches on `kind`** — a machine row opens the machine form (Edit machine),
      a service row the route form
- [x] **A drift the split caused, caught by its own test:** the new machine form didn't
      lowercase a typed hostname, which `useRouteFields` had always done. Fixed in the
      component. This is the cost the measurement predicted — two forms, two places for a rule
- [x] Tests: +7 backend HTTP (`test_create_endpoints.py`: both endpoints need a session, the
      old one is gone, each rejects the other's shape, the models carry no dead fields) and
      +7 frontend (`AddMachineModal.test.tsx`), with the picker's DNS-only cases removed
- [x] Docs: `api.md` (two rows replace one, under a renamed section), `CLAUDE.md`, `PLAN.md`
- [x] Live: named a machine (`POST /api/machines` 200), routed a service onto it by picking it
      (`POST /api/routes` 200), then re-pointed the machine from its own form — `relinked:
      ["hello"]` and Caddy's dial moved to `192.168.10.231:8099`. Propagation survived the split

**21f — naming a machine no longer depends on Caddy _(shipped 2026-09-21)_**
- [x] `_tear_down_route()` makes the delete **required only when converting** an instance that
      had a proxy route — leaving that behind would keep Caddy answering a name the instance
      no longer proxies, so that case still aborts and rolls back. Otherwise the call is
      best-effort: a machine has no route, so Caddy being down or unconfigured is irrelevant
- [x] Tests: +3 (naming a machine with a failing Caddy succeeds; converting a live route with
      Caddy down raises `502` **and rolls back**; converting with Caddy up still deletes), plus
      the endpoint test flipped from pinning the old `502` to asserting the `200`
- [x] Live, both halves: with Caddy stopped, `POST /api/machines` returned `200` and
      `nas.smoke.test` resolved to `192.168.10.50`; converting an existing proxy route with
      Caddy stopped returned `502` and the row was still `service · proxy · 192.168.10.220:3000`

**21g — the three remaining defects _(shipped 2026-09-23)_**
- [x] **A `container` that names nothing is rejected** (`404`, from the 2026-09-16 smoke).
      Checked in `post_route`, not inside `assign()` — that function takes its clients as
      arguments so it can be driven by fakes, and reaching for the Docker singleton inside it
      would be a hidden dependency (it broke two unit tests within seconds of trying).
      **Docker unreachable means "unknown", not "invalid"**: creating a route must not start
      depending on the Docker socket, so an unreachable daemon skips the check with a warning
- [x] **The success banner follows the response.** `caddy: "skipped"` now reads "DNS rewrite
      created." instead of claiming a route (from the 2026-09-20 Phase 13 smoke)
- [x] **Change URL can link a route to a machine, and unlink it** — `machine: null` is
      meaningful. This closes the 21a gap *and* a claim that was wrong: the note below used to
      say "re-pick the machine in Change URL", which that form could not do
- [x] Live: a made-up container name `404`s while a real one still works; naming a machine
      banners "DNS rewrite created." while a route still says "route + DNS rewrite created.";
      and a route created **without** a link was linked through Change URL, after which moving
      the machine reported `relinked: ["legacy"]` and its upstream followed to `.231:8099`

**Known gaps**
- Routes created under **21a** hold a copied address with no link. They keep working, and can
  now be linked by picking the machine in Change URL (21g). There is no automatic migration,
  since inferring a link from a matching IP would guess

---

## Phase 22 — Per-route scheme (Phase 12's last unbuilt piece)

_12b, approved 2026-08-03 and specified in [`todo-archive.md`](todo-archive.md) Phase 12.
Exists **only** for clients that cannot hold a custom root CA — TVs, Chromecast/DLNA,
printers, other containers calling the service by name, scripts. Not a performance feature:
TLS on a LAN is unmeasurable next to the proxy hop, which is paid either way._

**What shipped**
- [x] **`scheme: "https" | "both" | "http"` on the instance**, default `https`. One enum, not
      two booleans — two checkboxes admit an invalid both-off state
- [x] **A second server selector.** `select_http_server_name` finds the `:80` server by its
      listener; `select_server_name` keeps *excluding* it, because a reverse-proxy route
      pushed into the cert-setup site would be served without TLS by accident. No `:80`
      server means `scheme: "http"` raises rather than falling back
- [x] **Index 0 in the `:80` server too**, for one more reason than on `:443`: that server's
      setup site ends in a catch-all `handle`, and Caddy's automatic HTTP→HTTPS redirects
      live there and would otherwise answer first. The spec called this in August; the
      2026-09-05 defect proved the same rule for `:443` a month later
- [x] **`both` is two routes with two ids** (`<id>`, `<id>-http`). `expected_route_ids()` is
      what `synced` compares against, so a half-pushed `both` reads `false`; teardown removes
      both ids unconditionally, since the stored scheme may have changed
- [x] **`http` never lands in the `:443` server** — `upsert_route` deletes the route it does
      not want on every push, so a scheme change converges with no migration. That absence is
      what stops Caddy issuing a certificate for the name
- [x] **Links follow the scheme.** The assign response's `url`, the public dashboard's cards
      and the Docker tab's routed-container link were all hardcoded `https://`; an http-only
      route linked that way cannot connect. Found by reading the UI after the backend worked
- [x] Frontend: `SchemeSelect` in both route modals (editable on an existing route), an
      amber tag in `ServiceTable` for anything that isn't the default, and a live preview
      that drops to `http://`
- [x] Tests: +14 backend (selector, twin id, per-scheme push/teardown, scheme change
      convergence, no-`:80`-server, sync for `both`/`http`, the two URL shapes, the dashboard
      card) and +4 frontend
- [x] Docs: `caddy-api.md` (new §2b + the two-id teardown), `api.md`, `CLAUDE.md`, `PLAN.md`

**Verification**
- [x] `pytest` (281) + `npm test` (95) + `check-docs.sh` + `tsc -b`
- [x] **Live, against the dev rig's two-server Caddy** (`srv0 :443`, `srv1 :80`), one route
      per scheme:

      | | `:443` holds | `:80` holds | `https://` | `http://` |
      |---|---|---|---|---|
      | `secure` (https) | `secure` | — | `200` whoami | `308` redirect |
      | `tv` (http) | — | `tv-http` | **TLS alert, no cert** | `200` whoami |
      | `printer` (both) | `printer` | `printer-http` | `200` whoami | `200` whoami |

      The `tv` handshake failing is the point: `curl -v` shows `tlsv1 alert internal error`,
      i.e. Caddy has no certificate for that name and never asked for one. Switching
      `printer` back to `https` removed `printer-http` and the name fell back to the `:80`
      redirect. The cert-setup catch-all still served its 21.5 kB page throughout

---

## Phase 23 — The `:80` site stops claiming every name

_Sunde, after 12b: "as it is the setup page is now redundant since we are able to download
what we need directly through loskai." True for the **page** — `/certificate` serves the root
over a connection that needs no trust. Not true for the **block**: measured, a Caddy whose
Caddyfile has a real HTTPS site but no `:80` block ends up with **only `srv0` on `:443`** — no
port-80 listener at all — and that server is where 12b's `http`/`both` routes go._

_"Will we be able to use the supplied host ip… or were we able to detect host ip
automatically?" Neither: `config.py`'s `host_ip` already records that a bridged container
cannot detect its own host IP, `HOST_IP` is optional, and the Caddy container is passed only
`BASE_DOMAIN`. Scoping the block to an IP would have **added** a required setting._

- [x] The `:80` block leads with `@internal host *.{$BASE_DOMAIN:example.invalid}` →
      `redir https://{host}{uri}`, in both `caddy/Caddyfile` and `dev/Caddyfile`. Keyed on the
      domain Caddy already has, so it is automatic with no new configuration; the
      `example.invalid` default makes the matcher inert when `BASE_DOMAIN` is unset
- [x] `compose.dev.yml` passes `BASE_DOMAIN` to its Caddy (the placeholder site stays
      `*.localhost` on purpose)
- [x] Docs: `certificate-setup.md`'s "it claims the whole of `:80`" warning rewritten
- [x] Live, all five cases: an `https` route typed as `http` → **`308` to https** (Caddy's own
      redirect, for names it holds a route for); an `http` route → **`200` proxied**, since
      index 0 beats the Caddyfile; an unrouted name → `302` to https instead of the onboarding
      page; browsing by IP → the page, unchanged; `/caddy-root.crt` → `200`

**The ACME variant of the LXC script got the same treatment** _(same day)_. Internal mode
fetches `caddy/Caddyfile` from the repo, so it inherited both fixes for free — but
`create-caddy-lxc.sh`'s `TLS_MODE=acme` branch writes its **own inline Caddyfile**, which had
neither: a handler-less wildcard block (the empty `200`) and **no `:80` server at all**, so
`scheme: "http"`/`"both"` had nowhere to be pushed. It now carries a 404 for unrouted names
and a minimal `:80` site. Verified by running the script's own heredoc and adapting the
result: `srv0 :443` + `srv1 :80`, where before there was only `srv0`.

**Not done, and why:** redirecting the page itself to Loskai's `/certificate` would need
Loskai's address, which has the same undetectable-host-IP problem and would mean a new
required env var. The page costs nothing where it now sits — by-IP only, which is exactly the
fallback `certificate-setup.md` documents.

**A 404 for names that aren't routed** _(same day, closing the 2026-09-05 backlog item)_
- [x] The `*.{$BASE_DOMAIN}` block gained a `respond … 404` with a small dark page naming the
      host. It was previously handler-less — cert-only — which compiled to a terminal route
      answering an **empty `200`**: a blank page that looked like a broken service rather than
      an unassigned name
- [x] **404, not a redirect to the dashboard.** That is what nginx, Traefik and the hosting
      platforms do; redirecting changes the URL under the visitor and hides the real cause.
      No "back to the dashboard" link, because Caddy does not know Loskai's address and
      Loskai cannot detect it — the same constraint as above. One line to add later if Loskai
      is ever routed at a fixed name
- [x] `dev/Caddyfile` deliberately **not** changed: its placeholder site is `*.localhost`,
      kept different from `BASE_DOMAIN` on purpose, so a 404 there would never see real names
- [x] Live, against the **production** Caddyfile in a container (`BASE_DOMAIN=smoke.test`)
      with a Loskai-shaped route pushed at index 0: the routed name proxied `200`, an
      unrouted one answered `404` with `Nothing is routed at typo.smoke.test`, plain HTTP
      redirected first, and the by-IP onboarding page was untouched. Rendered in a browser

---

## Phase 24 — The ACME path stops assuming DuckDNS _(superseded by Phase 25 — removed)_

> **Superseded the same day.** Everything below shipped and then came out again in Phase 25,
> which dropped ACME support entirely. Kept as the record of what was there and why, and as
> the recipe for putting it back: `git revert` the two commits it names.

_Sunde, while weighing public certs: "Ideally we create a caddy that simply works for
everyone… I say do the fixes, and remove most references to duckdns other than where it makes
sense."_

_**The bug:** `CADDY_DNS_PLUGIN` was a variable and drove `caddy add-package`, so the right
plugin was installed — but the Caddyfile the script wrote hardcoded `dns duckdns
{env.DUCKDNS_TOKEN}`, the unit hardcoded `DUCKDNS_TOKEN`, and the closing instructions told you
to swap the directive by hand. Any provider but DuckDNS produced a Caddy that would not start._

- [x] `CADDY_DNS_PROVIDER` — the directive name, **derived** from the module path
      (`caddy-dns/cloudflare` → `cloudflare`) with an override for the few where they differ
- [x] `CADDY_DNS_ARGS` — what follows the provider name, defaulting to
      `{env.CADDY_DNS_TOKEN}`. **Single-credential providers are the default case, not the
      only one:** acme-dns needs username/password/subdomain/server_url, and passes its whole
      block here. That matters because acme-dns is the likely path for a registrar with no API
- [x] `CADDY_DNS_PLUGIN` now has **no default** — `TLS_MODE=acme` without it exits with the
      link to the module list, rather than silently building a DuckDNS config
- [x] Provider-neutral `CADDY_DNS_TOKEN` in the systemd unit, the compose files and the docs
- [x] DuckDNS removed from `caddy/Caddyfile`, `caddy/Dockerfile`, both compose files and
      `PLAN.md`, kept only where it reads as one example among several. **`HISTORY.md` left
      untouched** — those entries record what was decided at the time
- [x] Verified by running the script's own variable logic and heredoc for both shapes: a
      single-token provider emits `dns cloudflare {env.CADDY_DNS_TOKEN}`, and acme-dns emits
      its four-field block. Both compose files still `config -q` clean

**The co-located Docker path is a switch too** _(same day)_. It was the one place still
needing two files hand-edited, for two real reasons: a DNS plugin is **compiled into** the
binary (the LXC can swap builds at runtime with `caddy add-package`; an image cannot), and a
Caddyfile has no conditionals, so one file cannot serve both modes.
- [x] `caddy/Dockerfile` gains build targets — `stock` (plain Caddy, no compile) and `acme`
      (rebuilt via `xcaddy` with `CADDY_DNS_PLUGIN`). Both carry both Caddyfiles, so only the
      *binary* differs
- [x] `caddy/Caddyfile.acme` — the DNS-01 wildcard, the same 404 for unrouted names, and a
      `:80` server kept for `scheme: "http"`/`"both"` routes and Caddy's own redirects. No
      onboarding page: publicly trusted certs leave nothing to install
- [x] Both compose files select with `CADDY_BUILD` (target) and `CADDY_CONFIG` (which file the
      container reads), defaulting to the internal CA
- [x] **A bug my own negative test caught:** `docker build` with no `--target` builds the
      **last** stage, so with `acme` written last a plain build silently produced a
      Go-compiled binary carrying a plugin nobody asked for. `stock` is now last, with a
      comment saying why the ordering is load-bearing
- [x] Verified by building both and inspecting the binaries, not the build log: the default
      image has **0** `dns.providers.*` modules and refuses the ACME config with `module not
      registered`; `--target acme` has `dns.providers.cloudflare`, adapts to an `acme` issuer
      with the DNS challenge and the token left as an `{env.…}` reference, and starts with
      `srv0 :443` + `srv1 :80`, reaching "obtaining certificate"
- [x] Docs: five new rows in `deployment.md`'s env table

**What this does *not* solve:** one.com hosts the domain in question and there is **no
`onecom` module** in the caddy-dns organisation (checked: the o-range holds `njalla`,
`neoserv`, `oraclecloud`). Public certs there still require delegating a subdomain or
CNAME-ing `_acme-challenge` to acme-dns — now at least configurable rather than a hand-edit.

---

## Phase 25 — ACME support removed; internal CA is the only mode

_Sunde, after the Docker switch landed: "Did we just add a bunch of unnecessary logic and
complexity? Instead of simply keeping it to internal root verification?" Then, given a
priced-up comparison: "lets go all the way for internal-CA-only."_

_**The question was fair and the answer was mostly yes.** Two of the day's bugs existed only
because a second TLS mode did — the provider hardcoding, and the ACME LXC branch missing both
Caddyfile fixes. Worse, the 404 + `:80` logic had ended up in **three** files that had to
agree, in a project whose documented recurring failure is exactly that kind of drift._

_**What made removal cheap** is what Sunde spotted: Loskai has no ACME code. Verified — every
write it makes to Caddy is `PUT …/routes/0` (insert one route) or `DELETE /id/<id>`; it never
writes a Caddyfile, and `push_all` only touches ids matching instances, so Caddyfile-derived
and hand-added routes are invisible to it. "ACME support" was never a Loskai feature, only a
pair of example configs and a build stage._

**Removed**
- [x] `caddy/Caddyfile.acme` (whole file) and the `stock`/`acme` build targets — `caddy/
      Dockerfile` is back to three lines of `FROM`/`COPY`
- [x] `TLS_MODE`, `CADDY_DNS_PLUGIN`/`PROVIDER`/`ARGS`, the `caddy add-package` step, the
      inline ACME Caddyfile and the token line from `create-caddy-lxc.sh` — **294 lines, down
      from 380**, with one Caddyfile path (fetched from the repo) instead of two
- [x] `CADDY_BUILD`, `CADDY_CONFIG`, `CADDY_DNS_*` and the `command:` override from both
      compose files; five rows from `deployment.md`'s env table
- [x] The commented ACME block in `caddy/Caddyfile`; the `TLS_MODE=acme` aside in `install.md`
- [x] `caddy/Dockerfile` and the script header now say where it went and why it costs nothing
      to re-add by hand: Loskai never writes the Caddyfile

**Kept deliberately**
- The **backlog idea** (real domain + DNS-01) — dropping the code is not dropping the option
- **`HISTORY.md` untouched**, and Phase 24 kept with a superseded banner. Between them they
  are the record *and* the recipe: `git revert` of `a6d4d78` + `52129af` restores it whole
- `certificate_tab: hidden`, which exists for a deployment whose certs are already trusted —
  cheap, already built, and useful to anyone hand-rolling ACME

**Verification**
- [x] `pytest` (281) + `npm test` (95) + `check-docs.sh` — **no application code changed**,
      because there was none to change
- [x] Both compose files `config -q` clean; `bash -n` on the script; the co-located image
      builds and adapts to `"issuers":[{"module":"internal"}]`

---

## Phase 26 — 12c: backend certificates, and Phase 12 closes

_The last item of Phase 12, approved 2026-08-03 and documentation-only:
[`docs/guides/backend-certificates.md`](../guides/backend-certificates.md). Caddy runs an
`acme_server` against its **existing internal CA**, and a backend's own ACME client gets a
leaf signed by the root every LAN device already trusts — so Proxmox's `:8006` is trusted
**directly**, not only through the proxy._

**Verified against upstream documentation, not memory** — the numbers are the whole story here
- [x] `acme_server` takes `ca` (default `local`), `lifetime` (**default 12h**), `challenges`,
      `allow`/`deny`; the directory is `https://<host>/acme/<ca-id>/directory`
- [x] Proxmox renews from `pve-daily-update.service`, and only when the cert **expires within
      30 days** — so a 12h leaf is expired for most of every day. The guide recommends `168h`
- [x] A leaf cannot outlive its intermediate, whose lifetime defaults to **7d**, so raising
      one means raising `intermediate_lifetime` (Caddyfile global `pki { ca local { … } }`).
      Violating it returns a `500`, not a useful error
- [x] Proxmox's own steps confirmed: **Datacenter → ACME** then **Node → Certificates**;
      `pvenode acme account register` (option "2) Custom"), `pvenode config set --acme
      domains=…`, `pvenode acme cert order`; http-01 and dns-01 both supported

**The trap the guide leads with** — a name resolves to one address, so a name that is already
a *proxied route* points at Caddy, and the challenge for it validates against Caddy instead of
the backend. The fix is to stop proxying that backend and make it a **machine** (`dns_only`)
instead, which is what Phase 21's machines are for.

- [x] Linked from `docs/README.md` (both tables), cross-linked from `certificate-setup.md`,
      and added to `CLAUDE.md`'s guide list
- [x] States plainly that **Loskai does nothing here**: no ACME code, and `Sync` cannot
      disturb an `acme_server` site because `push_all` only touches routes whose `@id` matches
      an instance

**Phase 12 is complete** — 12a in Phase 19, 12b as Phase 22, 12c here.

**A defect the guide surfaced, fixed the same hour.** Writing "make the backend a machine"
raised Sunde's question — *how does it then appear on the dashboard?* — and the answer turned
out to be "with a broken link". `list_routed()` includes machines, so a machine produced a
card pointing at `https://proxmox.{BASE_DOMAIN}` with **no port**: `:443`, where nothing
listens. The source comment even said "the card just names the host" while building an
`https://` URL anyway.
- [x] **Machines are excluded from the dashboard** (`kind: "machine"`). An address has no
      port to link to, and it is not derivable — `:8006` for Proxmox, `:5000` for a NAS, none
      at all for a box you only SSH to. A launcher card that lands on a dead port is worse
      than no card. Proxied services on odd ports are unaffected: Caddy fronts those at `:443`
- [x] The documented way to put such a UI on the dashboard is a **route under a second name**,
      built by picking the machine in Add route — which also links it, so it follows the
      machine. Both halves are pinned by tests, and the guide carries the two-name table
- [x] Considered and rejected: a per-machine link port. It would make the card work, but it
      adds a field to say what a route already says, and the route follows the machine for
      free

---

## Phase 27 — Launcher icons, and an endpoint for a desktop launcher

_Sunde: an image per route for the dashboard card, and "a get endpoint that allows us to read
out the created routes in a list, to be used with a desktop version of the launcher" — kiosk
Chromium profiles, one per service. Plus, on private routes: "a desktop launcher should have
the ability to access privates if we provide a password or token. Since loskai simply has a
password, that option might be enough."_

_**Half of it already existed.** `GET /api/dashboard` is public and already returned
`{name, url, icon}` — the icon field had simply never been filled in. So the two asks were one
piece of work._

**Icons**
- [x] `icon` on the instance; images in `<data_dir>/icons/<id>.<ext>` — **the only binary
      state Loskai keeps**, in the same volume as the JSON, so a backup carries it
- [x] **Validated by magic bytes**, not by filename or the caller's `Content-Type`: PNG, JPEG,
      WebP, 512 KB cap. **SVG refused** — these are served back from Loskai's own origin, and
      an SVG is a script container. A RIFF file that is not WebP is refused too
- [x] **Raw request body, not multipart.** The bytes are sniffed either way, so a form part
      would carry a filename and type that are ignored — and would add a `python-multipart`
      dependency. Read with a streamed cap, so an oversized upload is refused after a chunk
      rather than buffered whole (`413`)
- [x] `path_for` resolves and bounds-checks the stored filename: it comes from
      `instances.json`, which a human can hand-edit, and `../` would otherwise read anything
- [x] The thumbnail **is** the control — set and cleared from the Routing row rather than a
      dialog. Machines have no card, so they get no picker
- [x] `ServiceCard` renders the image with an `onError` fallback to the glyph, so a missing
      file never leaves a torn card

**The launcher endpoint**
- [x] `GET /api/launcher` — every routed service **including private**, each flagged.
      Authenticated, which is the entire difference from `/api/dashboard`. A desktop client
      logs in exactly as the web UI does: `POST /api/login`, then send the cookie back
- [x] Cards carry `id` now — a desktop launcher keys shortcuts on something that survives a
      rename, which `name` does not

**The public surface, kept enforced**
- [x] `PUBLIC_ROUTES` holds exact `(method, path)` tuples, so a parameterised icon path
      cannot live there. Added `PUBLIC_PATTERNS` — one anchored regex — **and extended
      `check-docs.sh` to assert it is named in `CLAUDE.md` too**, so this class of
      unauthenticated surface cannot be added unnoticed. Verified by removing the mention and
      watching the check fail

**Verification**
- [x] `pytest` (297) + `npm test` (100) + `check-docs.sh` + `tsc -b`
- [x] Live: a real 180-byte PNG uploaded through the UI, served **byte-identical with no
      session** as `image/png`, rendered on the logged-out dashboard. `/api/launcher` returned
      the private route with `private: true` while `/api/dashboard` omitted it, and answered
      `401` with no session

---

## Phase 28 — The install wizard, looked at for the first time

_Sunde: "I want to start building the installation wizard for docker containers now. where do
we start? and sould we make the repo for loskai-recipes besides loskai?" Then: "fix #1 and #2
first and maybe allow for multiple repos to be added, we have our standard one, and then we
have the abbilitty to disable it or add multiple other sources."_

_**It was already built** — engine, modal, routes, `git` + the compose plugin in the image, all
of it from Module 1 in July. What was missing was recipes: `data/recipes/` held a `.gitkeep`,
so the only part of the wizard anyone had ever seen was its empty state. Reading it against
`PLAN.md` found two defects and one stale plan step._

**#1 — the installed instance pointed at no container**
- [x] `install_recipe` set `container` to the **recipe id**, but that is the compose *project*
      name; Compose names containers `<project>-<service>-1` unless the file pins
      `container_name`, and every join in the module matches the container **name**. So a
      recipe-installed service never linked to its own container — no FQDN in the Docker tab,
      and a row that reads as orphaned
- [x] `client.containers_in_project` reads the real names back via the
      `com.docker.compose.project` label; `logic.primary_container` (pure) picks the published
      one: manifest `service:`, else the only service, else the one publishing ports, else
      alphabetical
- [x] Optional `service:` added to the manifest schema, for app-plus-database recipes
- [x] **A failed `up`, or a container that can't be identified, registers no instance** and
      says so. Previously a failed install registered one anyway. A guessed `container` is
      worse than none: the Routing tab's Container source creates the record correctly, so a
      guess leaves a second, dead row beside it

**#2 — `instructions.md` was shipped and dropped**
- [x] The backend has put it in the payload since July; the frontend's `Recipe` interface
      never declared the field, so the recipe author's walk-through was discarded in the
      browser. Now the wizard's **first step**, with what the install will create (stack dir,
      declared directories, the variables it asks for, the source it came from) — `PLAN.md`'s
      step 1, existing at last
- [x] `shadowed` was ignored the same way; it now names the copy that lost *and* the source
      that beat it. `invalid` now shows each reason, not just a count
- [x] Empty state distinguishes **no sources** / **never synced** / **synced and empty** —
      three states with three different fixes that had one message between them

**Multiple sources**
- [x] `recipes_repo_url` (one string) → `recipes_repos` (a list of `{url, enabled}` rows,
      managed in Settings › General: toggle, add, remove, per-row sync)
- [x] One cache per repo, `recipes-cache/<tail>-<hash of url>` — two repos ending in
      `/recipes.git` are routine, and a shared cache would have one overwrite the other
- [x] Priority is list order; local `data/recipes/` always last and never disableable
- [x] **A built-in default is seeded when nothing is stored** (`config.DEFAULT_RECIPES_REPO` —
      Forgejo beside loskai for now, the public GitHub URL when loskai is published), and it
      is an ordinary row: switch it off, or delete it
- [x] Which is why **a stored empty list is a real value**, never an unset marker — deleting
      every source has to survive a restart rather than re-seed the default
- [x] Sync reports **per source**: one unreachable repo costs that repo's recipes and nothing
      else, and `POST /recipes/refresh` takes an optional `{url}` for one row. No new route
- [x] **`RECIPES_REPO_URL` removed entirely** (2026-10-02, Sunde: "do we even need the env
      variable? Since we now have a option in the ui for adding more on top of the default?").
      It was load-bearing when sources were one string set before any UI existed; with an
      editor it was a second way to say the same thing, and the precedence rule it dragged in
      was the only reason the panel could go read-only. Recipe sources are never needed before
      the UI is reachable — which is the test for belonging in the env layer. `recipes_repos`
      is now the only entry in `STORED_ONLY_KEYS`; the `Settings` property, `ENV_SOURCE_ATTRS`,
      the stored-legacy-URL fallback (nothing had ever stored it), the read-only branch in the
      editor and the variable in three compose files all went with it

**Verification**
- [x] `pytest` (353) + `npm test` (122) + `check-docs.sh` + `tsc -b` + oxlint
- [x] **Live install — ran 2026-10-03 and passed**, on the first real recipe: `whoami` in
      `sunde/loskai-recipes` (`56b7cc6`). Rig: a host backend on `:8010` with a **scratch**
      data dir and every variable explicit, plus Caddy alone as compose project
      `loskai-smoke` — the full split-DNS stack can't run beside the dev `loskai` container
      (same `container_name`, same `:8080`), and that one points at real infrastructure
      - instance `container` = `whoami-whoami-1`, **exactly what `docker ps` shows** (the old
        code stored `whoami`, which matches nothing); orphans empty
      - **routing it by container name edited the recipe's instance** — still one record, now
        with a subdomain — where the old link key would have created a duplicate. The Docker
        tab's container row shows the route; Caddy returns a 300-byte body carrying
        `X-Forwarded-Host: whoami.smoke.test`, the line `instructions.md` promises
      - `pair` → `pair-web-1` (published beat alphabetical) and `pair-declared` →
        `pair-declared-app-1` (declared beat published): local test recipes built so the
        rules disagree. A port clash returned `ok: false`, the daemon's error, no instance
      - torn down through Loskai's own stack delete; host left exactly as found

**Found by the live run — `.env` generation corrupted secrets, silently**
- [x] **An omitted answer wrote no variable.** An API install with `{}` published `${PORT}` on
      a *random* host port: the wizard seeds defaults client-side, the server never did.
      `resolve_answers` now builds the set from the manifest — answer, else `default`, else
      empty; an explicit empty answer is kept
- [x] **Values were written verbatim, and Compose rewrites them.** Checked against
      `docker compose config`: `pa$word1` arrived as `pa` (interpolated), `correct horse
      #battery` as `correct horse` (comment), and a newline started a second line —
      `COMPOSE_PROJECT_NAME=hijacked` there **renamed the project**. Every one *succeeds*.
      Now every value is double-quoted with `\` `"` `$` `\n` `\r` escaped — single quotes
      cannot hold a `'`. **Live round trip: a password with all of it reached a real
      container's environment byte-identical**, and the project label stayed put
- [x] **Undeclared answer keys were written too** — the same `COMPOSE_*` route in. Refused
      with `400` before anything touches disk. Manifest `env` keys must be variable names
- [x] **Reinstalling a recipe wiped its instance's route fields** — found 2026-10-03, fixed
      2026-10-04 together with the Delete change below, since that is what made reinstalling
      routine. A reinstall now keeps the earlier record (route, icon, private, following) and
      re-points only `container`. The id is refused when it names something else: an external
      route, or a docker record linked to a different container that is still running
- [x] **A stack's Delete kept nothing** (2026-10-04, Sunde: data belongs "in the relative
      directory of the service"). Recipes now keep data in `./data` beside the compose file,
      which made `rmtree` a data-loss button. Delete now removes `compose.yml` and `.env` only
      unless "Also delete its data" is ticked; the dialog names the folders. Creating or
      installing the same name again takes the folder over (`claim_dir`), and the wizard says
      it picked the data up. Bambuddy's recipe moved to `./data`/`./logs`, and the running
      install was migrated live: every lasting table identical, route still serving
- [x] **Routing a recipe install opened an empty form** (Sunde, 2026-10-03: "if it's a docker
      entry it will always have the host ip"; then: "add route and add url are two different
      functions"). They were: the Add route picker pre-filled from Docker, the row's "Assign
      a URL" from the stored record only — which a fresh install doesn't have. One helper,
      `containerPrefill`, now serves both. The backend adds `suggested_host` (known whenever
      `HOST_IP` is, even with no port: host networking, several published ports) and the
      linked `instance_id`, so the prefix is the recipe's name, not `<project>-<svc>-1`.
      Checked against the live daemon: `whoami`'s row now fills `192.168.10.220:8081`, a
      host-networked container `192.168.10.220:` — the trailing colon is the machine picker's
      existing convention. Bambuddy's image EXPOSEs ~110 ports, so guessing the port from
      the image was ruled out rather than built
- [x] **Host folders as a recipe concept — `type: path`** (2026-10-04, Sunde: the wizard
      should handle mounted paths "based on how we configure the instructions"). Tested from
      inside the running Loskai first: `./data` and `${X:-./data}` land in the stack folder,
      an absolute path passes through, and **`~` becomes `/root`** — compose runs as root in
      Loskai's container. A `path` entry is required; the wizard says where it lands (stack
      folder, kept on Delete / Docker host, never deleted) and refuses `~`, a bare name (a
      named volume to Compose) and `:` — the server checks the same. **`directories:` removed**:
      it made folders inside Loskai's container, invisible to the host; a manifest with it is
      rejected with a pointer to `type: path`
- [x] **Any number of folders, added at install — `mounts`** (2026-10-04, Sunde mounts music,
      movies and anime separately: "I would assume that ability is quite relevant"). A recipe
      declares one group (`label`, `target`, `read_only`); the wizard adds rows, each landing
      at `target/<name>`; Loskai writes them into `compose.override.yml`, which Compose merges
      by itself, so the recipe's file stays untouched. Long syntax with `create_host_path:
      false` — checked against the daemon: a missing folder fails the deploy instead of
      mounting an empty one Docker made. Delete removes the override; the stack editor shows
      it read-only. Deliberately one group, one service, one `read_only`
- [x] **Recipes can be authored from the recipes repo alone** (2026-10-04, Sunde: "so we can
      use claude code inside that project whilst not being wholly dependent on the docs for
      loskai"). loskai-recipes gets a `CLAUDE.md` and a copy of `recipe-schema.md` at its root (a
      `docs/` folder would be scanned as a recipe — the checker caught it), written by
      `scripts/sync-recipe-schema.sh` — the contract stays here, beside the validator. The
      docs check fails while the copy differs. `check_recipes` runs the wizard's validator
      over a folder or a whole repo, so a recipe is proven valid before it is pushed
- [x] **A synced source reported its `.git` as a skipped recipe** (2026-10-04). Every folder
      in a source was scanned, and a clone has `.git`. Hidden folders are skipped now
- [ ] **Bambuddy reinstall, run by Sunde — then clear the migration's fallbacks.** Delete
      (data kept) and install again from the synced recipe; expect "Picked up the data already
      in its folder". Compare against the fingerprint taken 2026-10-04 before it: lasting
      tables `announcements=2 archive_fts_config=1 archive_fts_data=2 color_catalog=638
      groups=3 maintenance_types=9 notification_templates=38 settings=11
      sponsor_toast_state=1 spool_catalog=91`, `data/.jwt_secret` sha256 starting
      `01cd37ce877168ed`, mounts on `stacks/bambuddy/data`, its route record kept. Once it
      matches, remove the pre-migration volumes `bambuddy_bambuddy_data` and
      `bambuddy_bambuddy_logs` and `stacks/bambuddy/compose.yml.volumes-backup`
- [x] **The container runs as root, so everything it writes on the host is root-owned** (found
      2026-10-03, the first time the redeployed container wrote state). `data/instances.json`
      became `root:root 0600` — unreadable to the host user, which also breaks a dev backend
      run against the same `data/` — and a wizard-created stack is `root:root`, so it **can't
      be edited over SSH** without sudo, against the "SSH stays a first-class equal" rule. Its
      `.env` is `0644`, world-readable, which matters once a recipe asks for a password.
      Phase 18's `.gitkeep`s only covered the directories. Needs a decision on the container's
      user: it also needs the docker socket's group
      **Fixed 2026-10-09** — Sunde chose "match the folder's owner": an entrypoint drops to the
      owner of `./data` plus the socket's group, and hands back what root wrote (`data/`, each
      stack's folder, compose files and `.env`; never `stacks/<name>/data/`). `.env` and
      `session_secret` are `0600`. Delete-with-data falls back to a throwaway root container
      for files the app wrote as its own user. **Live on this VM:** the app runs as `vm`
      (1000, groups 988,1000); `instances.json`, `recipes-cache`, both stacks back to `vm`;
      `bambuddy/data` untouched; as that user — 7 containers listed, git sync, `whoami`
      restart, and Delete-with-data on a stack holding 999-owned `0700` files, all OK. The
      first run found source files `0600` in the working tree, unreadable once not root —
      the image now `chmod a+rX`es them
- [x] **The git sync path — worked, run by Sunde** (2026-10-03): pushed, synced from Settings,
      and `whoami` installed from it into `stacks/whoami`. The cache
      `data/recipes-cache/loskai-recipes-2bc51ad3` is at `5b94ac7`, matching `origin/main`,
      and the local `data/recipes/` holds only its `.gitkeep`, so the recipe came from git

---

## Phase 29 — A Docker route follows its container

_Sunde, 2026-10-03, after the route forms learned to pre-fill the host: "the port should be
locked for docker containers and self update if we change it in the docker". Chose, of two
options, **watching Docker's event stream** over re-pushing only on Loskai's own restarts —
so a port changed over SSH is followed too._

_Today a Docker route **stores** its upstream. Change the container's port and the route
keeps dialling the old one — a 502, with nothing in Loskai saying why. The model already has
the answer one link over: a route that follows its **machine** is rewritten when the machine
moves (`_propagate_to_dependents`). This is the same move with a different trigger._

**Model**
- [x] `follow_container: bool` on the instance — **declared, never re-derived**, like `kind`.
      Defaults `False`, so every existing record keeps exactly the upstream it has. New
      container routes follow by default when the address can be derived
- [x] The derivation is the pre-fill — `logic.suggested_upstream`, one function, so what the
      form shows and what the follower writes cannot disagree
- [x] **`loskai.port` label** for what Docker can't see: the port the service listens on, as
      the container sees it, resolved to whatever Caddy dials (`service:<port>` on a shared
      network, `<host_ip>:<published port for it>` in `lan`, `<host_ip>:<port>` under host
      networking). Compose interpolates it — `loskai.port: ${PORT}` — so it changes when the
      port does. Also picks one port out of several published

**Assign**
- [x] `RouteCreate.follow_container`. When set, **the server derives the upstream** from the
      live container and ignores the client's; not derivable → `400`, set it by hand
- [x] Following a container and following a machine are exclusive → `400`

**The follower** — `shared/follow.py`, Loskai's first background task
- [x] Docker `start` events → reconcile that container: if it is linked, routed, following,
      and its derived upstream changed → store it, re-push the Caddy route. Best-effort like
      machine propagation: the stored upstream is updated first, so Sync repairs a failed push
- [x] Reconcile **every** following route at startup and after each reconnect — changes made
      while Loskai or the daemon was down produce no event
- [x] Never blocks startup; Docker unreachable → back off and retry, nothing else greys out
- [x] Stopped on shutdown (close the event stream, so its blocking read returns)

**UI** — in `RouteFields`, so both forms get it from one place
- [x] Following: the upstream is read-only, with the derived value and "follows the
      container — updates itself when its port changes"; **Set by hand** unlocks it
      (`follow_container: false`)
- [x] A manual docker route whose address can be derived offers **Follow the container**

**Recipes**
- [x] Bambuddy's compose sets `loskai.port: ${PORT:-8000}` — host networking, so this is the
      only way its port is known; with it, its route is derivable and follows

**Verification**
- [x] Unit + contract tests: label resolution in every mode, the follower (13 — including an
      edit made mid-reconcile winning, and shutdown releasing a read blocked in its thread),
      the endpoint rules (7), the lock in both forms. `pytest` (379) + `npm test` (131)
- [x] **Live, Sunde's scenario exactly** (2026-10-03, scratch backend + Caddy as project
      `loskai-smoke`, beside the real dev stack and untouched by it): installed a whoami
      recipe as `followtest` — **not** `whoami`, whose Compose project is global per daemon
      and belongs to Sunde's running container — routed it following while *sending a bogus
      upstream*, which the server ignored for the derived `192.168.10.220:8091`. Then edited
      its `.env` to 8092 and ran `docker compose up -d` **outside Loskai**: the follower
      logged the move ~0.5s later, Caddy dialled `192.168.10.220:8092`, the route served the
      *recreated* container, and the old port refused connections. `synced` and
      `upstream_healthy` both true
- [x] Live: host networking — Docker reported `ports: []`, the picker still offered
      `192.168.10.220:8093` from the label; changing `PORT` outside Loskai moved the label
      to 8094 and the route with it
- [x] Live: **catch-up** — with Loskai stopped, the port changed to 8095; the route went
      stale (**502**, the original complaint). On restart it was re-pointed with no event
      and no click (**200**)
- [x] Live: a route set by hand stayed put through a port change (zero follower moves)
- [ ] Live: **restarting the Docker daemon** mid-run — needs root on the dev VM, so not run.
      The reconnect path is covered only by `test_the_daemon_going_away_is_retried_and_caught_up`
      (a dropped stream, a refused reconnect, then the catch-up). Run it the next time a
      daemon restart happens anyway: `journalctl` should show one "not following containers
      … retrying" line, and following routes should still move afterwards

**Follow-up, same day — the upstream as host + port** (Sunde: "split into two fields, one for
the ip address/machine … a dropdown menu … with a dual function of being able to simply type
in the ip address (and a search filter) and the port, both fields … in the same row")
- [x] `HostSelect`: type any address, or pick from a list filtered by name or address; ▾ shows
      all; arrow keys + Enter pick, and **Enter never swaps a typed address** for an option it
      prefixes (`192.168.10.5` vs `.50`). Picking a machine links the route; typing unlinks
- [x] In `RouteFields`, so both forms got it — and **both forms lost their own machine list**
      (Add route's External list, the row form's "Hosted on a machine" box). The options come
      from one builder, `hostOptions`, which reads the declared `kind` — the External list had
      been re-deriving "machine" from the address shape
- [x] Following locks both fields and hides the list. A pasted `host:port` splits itself;
      the port takes digits only. The docker-mode host hint is `jellyfin`, no longer the
      prefix's `grafana`
- [x] No backend change: the forms still post one `upstream`. `npm test` (139)

---

## Phase 30 — UI polish: Machines tab, the upstream link, Docker by stack, the recipe catalog

_Origin (2026-10-05, Sunde): "the docker view's structure with regards to containers and
volumes, the add/install recipes menus and navigation wizard, routing of services and
containers and the binding up against machines (I want to move machines to its own tab on the
side bar separating them from routes to make it more defined)"._

**Decisions (Sunde, Q&A 2026-10-05)**
- **Machines get their own sidebar tab** — a walk-back of Phase 21's "a second button, not a
  second tab". Machines and routes now read as two things, which the views and the `via` tag
  were working around. Each machine is listed with the routes hosted on it beneath
- **The upstream host is Machine *or* Address**, a toggle. Machine is a select by name and
  the link is the point; Address keeps Phase 29's combobox (Docker host, this container, or
  typed). A linked row shows `nas:32400` with the IP beneath, not the IP with a tag
- **Docker is organised by stack**: each stack expands to its containers, the rest under
  Standalone. A Volumes tab beside it, with size and which containers use each volume
- **The recipe flow, all four**: a roomier catalog with search, a step indicator, routing
  the install from its last step, and Install reachable from every Docker tab

**30a — the Machines tab**
- [x] `/machines` page + nav entry (admin), machines with their dependents beneath; Name a
      machine, edit, delete (the unlink warning moves with it)
- [x] Routing shows services only — the views and the Name a machine button go
- [x] Docs: `CLAUDE.md` admin tabs, `HISTORY.md` (the walk-back), `PLAN.md` if it names the tab

**30b — Machine or Address**
- [x] `RouteFields`: a toggle; Machine mode is a select of machines + the port; Address mode
      is `HostSelect` without the machines. Both route forms get it through the shared fields
- [x] Routing table: a linked upstream reads `<machine>:<port>`, the address beneath
- [x] **Added while building:** each machine's row on the Machines tab has "Add a route on
      this machine" — the same Add route picker, opened on External in Machine mode
- [x] **Machines no longer hide the Docker host.** `hostOptions` used to drop the Docker
      host when a machine shared its IP, so a pick linked the machine; the two modes are
      separate lists now, and Address never links
- [x] Tests: the combobox-picks-a-machine tests rewritten for the toggle (no guessing a link
      on switch, Address unlinks and keeps the IP, a row-opened picker starts linked)

**30c — Docker by stack, and volumes**
- [x] Backend: each container carries its compose `project`; `GET /api/docker/volumes` (name,
      size, project, which containers mount it). `api.md` + the route count
- [x] Frontend: Containers tab grouped by stack (stack actions on the group row), Standalone
      last; Volumes tab. A compose project from outside the stacks folder (Loskai's own) is
      its own group, listed but without stack actions; a stack with no containers keeps its
      group, so Up stays reachable
- [x] **Read-only volumes, deliberately.** No remove button: Docker refuses an in-use volume
      anyway, and the one worth removing is the one nothing mounts — which is exactly what
      the list now shows. `docker volume rm` stays on the host
- [x] Checked against the real daemon (dev VM): three volumes, all `used_by: []` — correct,
      since all three containers there bind-mount. They are the Bambuddy migration's
      leftovers (`bambuddy_bambuddy_data`/`_logs`) and an old `loskai_caddy-data`
- [x] Tests: +5 backend (`volume_rows` join/size/anonymous, `project`, `list_volumes`), +7
      frontend (`groupByStack` ×4, the grouped table ×2, volumes ×1)

**30d — the recipe flow**
- [x] Catalog: search, a grid, the source shown quietly
- [x] Step indicator: Choose → Review → Configure → Done
- [x] Done step routes the install: the suggested prefix + the container's upstream,
      following by default, posted to `/api/routes`
- [x] Install recipe in the Docker header, not only on the Stacks tab (landed with 30c)
- [x] **A walk-back, recorded:** `PLAN.md` had "No assign step here". The step posts
      `container` (the idempotency key) and pre-fills through `containerPrefill`, so it can
      neither duplicate a record nor drift from the other forms; it offers the prefix only.
      A reinstall that kept its route says so; a port Docker can't name links to Routing
- [x] The install output folds away on success (open on failure, where it is the point)
- [x] Tests: +6 (search, the steps and going back, the route posted, the kept route, the
      unnameable port, the failed install offering no route)

**Verification**
- [x] `pytest` (443) + `npm test` (169) + `npm run build` + `check-docs.sh`. The build
      caught a test-only type error `npm test` didn't — the fetch mock's signature
- [x] **Live**, the rig (smoke Caddy as `-p loskai-smoke`, a `:8010` backend on scratch
      state, Playwright driving the built UI): searched the catalog, installed a recipe, and
      routed it from the last step — **one** record (`echo`, linked to `echo-echo-1`,
      following), Caddy dialling `192.168.10.220:8091`, and the route answered with whoami's
      body `Via: Caddy`. Named a machine, added a route on it from its row (the picker opened
      linked to it), Routing read `box:8081`; moving the machine to `.231` reported
      `relinked: ["hello"]` and **Caddy's dial moved**; moving it back served whoami again

## Phase 31 — Recipe updates: the recipe owns compose.yml, you own the override

_Origin (2026-10-18, Sunde): "if we're using override to set custom settings, doesn't that
mean we can let the main compose file be static and updated through the recipes? … a simple
unintrusive button called check for updates up together with the new stack and install
recipe. it would simply list the installed recipes and give a notification or update symbol
if something can be updated … both the list and the instructions of what changes from
version to version"._

**Decisions (Sunde, 2026-10-18)**
- **Each file has one owner.** `compose.yml` is the recipe's — an update replaces it.
  `.env` is your answers — kept, and a question a new version adds gets its default.
  `compose.override.yml` is yours — an update never touches it
- **One button, "Check for updates", in the Docker header** beside New stack and Install
  recipe — nothing on the stack rows. It syncs the recipe sources (explicit, as sync always
  is), then lists the installed recipes in a dialog, marking those with an update
- **What changes** is shown per recipe: the recipe's commit messages since the install (git
  sources), and the difference in `compose.yml` (always)

**31a — remember what was installed**
- [x] Install writes `.loskai-recipe.json` beside the compose file: recipe id, source URL,
      the source's commit, and a fingerprint of the `compose.yml` it wrote. One of the
      stack's config files, so Delete removes it with them
- [x] A stack from before this, named like a recipe, has none: shown as "installed before
      updates were tracked", with the difference; updating it writes the record

**31b — the check and the update (backend)**
- [x] `GET /api/recipes/updates`: sync, then each installed recipe with a status —
      up to date · update available · `compose.yml` edited by hand · recipe no longer in
      any source — plus the changes (commits, the diff, new `.env` questions)
- [x] `POST /api/recipes/updates/{stack}`: refuse unless `docker compose config` loads the
      new `compose.yml` with the existing override and `.env`; then replace the file, add
      the new questions' defaults to `.env` (never rewrite an existing line), update the
      record, pull + up. A new question with no default → refused, reinstall to answer it
- [x] Edited by hand: the update is allowed, but the dialog says what is lost and suggests
      moving the edit into the override first. `git_build` recipes: not offered

**31c — the dialog (frontend)**
- [x] The button; a list with an update mark; a recipe opens its commits, its diff and an
      Update button; the output of `up` on failure, as the stack editor does

**31d — the recipe authors' promise**
- [x] `recipe-schema.md` and the recipes repo's checklist: within one recipe id, keep the
      service names, the mount target, the `.env` keys and the data folders — what an
      override and an `.env` hang on. A change to one is a new id or a note in the commit
- [x] Recipe instructions stop saying "raise the image tag in compose.yml"

**Verification**
- [x] Tests both sides: +17 backend (status matrix, diff, image headline, new questions,
      trailers, the record, every status, the update and its refusals, a real git log), +5
      frontend. `pytest` (487) + `npm test` (214) + `npm run build` + `check-docs.sh`
- [x] **Live** (scratch backend, a local git repo as the source's cache, Playwright): installed
      `hello` on whoami v1.10.0 and added an override mounting a folder; committed "Hello
      1.11" (v1.11.0 + a `TZ` question) to the source. The dialog read "1 of 1 installed
      recipes can be updated", the unreachable source's note, the commit's subject and body
      (trailer dropped), `TZ` as a new setting, and the diff. Update → "Up to date";
      `compose.yml` was the recipe's, the override byte-for-byte unchanged, `.env` gained
      `TZ="Europe/Oslo"` under the untouched `PORT` line (still `0600`), the container ran
      v1.11.0 with `/extra` still mounted, and the record held the new commit

---

## Phase 32 — The stack editor as a form

_Origin (2026-10-18, Sunde): "a parser so that we could read the compose, env and override
as input fields instead of the raw compose, since you keep putting so many comments into the
compose file that i dont really know where to look for the proper values"._

**Decisions (Sunde, 2026-10-18)**
- **`compose.yml` is shown, not edited**: it is the recipe's (Phase 31), so an edit there is
  lost to the next update. Settings and folders are where changes go
- **The recipes' comments move out of `compose.yml`** — into `recipe.yml`, which never
  reaches a stack

**32a — backend**
- [x] `stackform.py`, pure parse/build + I/O: `.env` values (as Compose reads them, written
      back line by line), the variables `compose.yml` reads (from the loaded YAML, so not
      from comments), the app's image/ports/folders interpolated, the override's bind mounts
      as rows and back. `GET`/`PUT /api/docker/stacks/{name}/form`
- [x] Folders get the install's path checks; everything is checked before anything is
      written. A cleared setting removes its line, so the default applies again
- [x] The override header no longer says "Reinstall to change them"; the old one isn't
      counted as the user's comment

**32b — frontend**
- [x] Edit opens the form; "Edit as text" (and back) once nothing is unsaved. The two
      views share one save-then-up and footer. New stack stays text — there is nothing to read
- [x] Layout pass (2026-10-19, Sunde: "tighten up the formatting and layout"): the app on
      top, settings in two columns with the label above (as the wizard), folders under one
      header row — two lines each at phone width — and the hints in tooltips
- [x] Second pass (Sunde: "more professional … a small image … host port and folders side
      by side"): a header with the recipe's icon and what it runs — each port and data
      mapping a chip, a folder told from a Docker volume — then Settings and Folders as two
      panels side by side (stacked on a phone). The form now returns `recipe` `{id, name,
      icon}` in place of `from_recipe`
- [x] Edit as text from a form with unsaved changes (Sunde: "edit as text stops working
      when we add a folder"): an empty folder row is no longer a change, and real changes
      carry over — `PUT /form` with `preview: true` returns the files the save would
      leave, opened as unsaved edits. Text → form still waits for a save: half-typed YAML
      may not read back as fields. Live: port + a folder + an empty row → the text view
      showed both files marked unsaved, the row dropped; Save + re-up put the container
      on the new port with the folder mounted
- [x] …and back (Sunde: "now i cant go back to edit as form"): `POST /form` reads the form
      from the text view's unsaved `.env` and override, and `PUT /form` takes them as
      `base` to save on top of. Only an unsaved `compose.yml` holds the switch — the form
      doesn't edit it. Live: port + folder in the form → an `environment:` line typed in
      the override → back to the form (port and both folders there, "other settings
      kept") → port again → Save: `.env` 8099, the override with the environment line and
      both folders, the container on `:8099` with `EXTRA=1`
- [x] The button (Sunde, 2026-10-19): "Save + re-up" greyed out with nothing to save read
      as something wrong. Tried Save-or-Restart in one button, then Save and Restart side by
      side; **settled on the usual edit-dialog pattern** — Cancel and **Save**, Save greyed
      out until something changed (with a tooltip), in both views. Restarting stays on the
      stack's row, where actions on the stack live

**32c — recipes**
- [x] Each `compose.yml` keeps a two-line header; the author notes are `recipe.yml` comments;
      Jellyfin's `/dev/dri` is an override snippet in its instructions; the authoring rules
      say so

**Verification**
- [x] +16 backend, +5 frontend. `pytest` (503) + `npm test` (219) + `npm run build` +
      `oxlint` + `check-docs.sh`; recipe validator 3 valid, each `compose.yml` passes
      `docker compose config`
- [x] **Live** (scratch backend + stack, Playwright): the form showed "Host port"/"Time zone"
      from the recipe, the folder from an override with the old header (no comment
      warning), and the app as `8091 → 80`. Port 8092, `TZ` UTC and a read-only folder
      added → `.env` `PORT="8092"` + `TZ="UTC"` (`0600`), the override in long syntax, and
      the container on `:8092` with `/media/films` `rw=false`, `/media/anime` `rw=true`,
      `TZ=UTC`. A missing folder failed `up` with "bind source path does not exist" (none
      created); an empty list removed the override; `~/x` was refused

---

## Phase 33 — Recipe options: optional features as checkboxes

_Origin (2026-10-19, Sunde): "what do we do about extra variable toggles like the graphic
card transcoding that jellyfin has? … it would be nice if we have a default way to handle
such cases"._

**Decisions (Sunde, 2026-10-19)**
- **A recipe declares `options`**, each a checkbox — off by default — in the wizard and the
  Edit form. Not always-on: a missing device stops the container
- **On adds exactly an option's lines to the override, off removes exactly those**; whether
  one is on is read from the override, never stored
- Jellyfin gets Intel/AMD hardware transcoding, and NVIDIA (Sunde: "lets make one for the
  nvidia option too then, so that is covered")

**33a — backend**
- [x] `options` validated: id, label, optional help and service, `set` limited to
      `devices`/`group_add`/`environment`/`cap_add`/`ports`, each a list
- [x] `option_on` / `set_options` (pure); install takes option ids; the form reports each
      option's state, saves switches, and doesn't count option lines as "other settings"

**33b — frontend**
- [x] `OptionList` (checkboxes with a help line) in the wizard's fill step and an Options
      panel under Settings in the form

**33c — recipes and docs**
- [x] Jellyfin's `hwaccel` option replaces its paste-this-snippet instructions; the authoring
      rules say optional hardware is an option; `recipe-schema.md` gets an Options section

**Verification**
- [x] +18 backend, +2 frontend. `pytest` (525) + `npm test` (224) + `npm run build` +
      `oxlint` + `check-docs.sh`; recipe validator 3 valid
- [x] **Live** (scratch backend, the real Jellyfin recipe as `gputest` on whoami, Playwright;
      this VM has `/dev/dri/card0`): installed with the option ticked → the form showed it
      ticked; unticked + Save → the override was removed and the container had no devices;
      on again → `devices: [{/dev/dri /dev/dri rwm}]`. An option for a missing device
      failed `up` with "error gathering device information … /dev/nope"; unticking it
      brought the stack back up
- [x] NVIDIA: options may add `deploy` (a mapping, merged key by key; a value set otherwise
      refused). +4 backend tests (529). Live, no NVIDIA here: both options ticked → `docker
      compose config` accepted the override; `up` failed with "could not select device
      driver "nvidia" with capabilities: [[gpu]]"; unticked → only its block went, the
      `/dev/dri` line stayed, and the stack came back up

**After it (2026-10-20)**
- [x] An option's help starts with what happens without it — Jellyfin's GPU boxes read as
      if Jellyfin needed a GPU, when off it transcodes on the CPU
- [x] Recipe sync fetches and resets to `FETCH_HEAD` instead of `pull --ff-only`, so a
      force-pushed source keeps syncing. Live, the real cache (no fetch refspec) moved from
      the pre-rewrite `6b07a13` to the forge's `a067db8`
- [x] A new route for a recipe stack's container gets the recipe's icon (Sunde: the image
      didn't follow a route added later). +7 backend tests (537). Live, in the rebuilt
      container: `jellyfin-jellyfin-1` → the Jellyfin icon; `whoami-whoami-1` → none (its
      recipe has none); `loskai` → none (not in the stacks folder)
- [x] Review of Phases 31–33 (Sunde: "any oversight we might have done?"), three fixes:
      a folder added for an empty service entry (`jellyfin:` with nothing under it) was
      dropped while Save reported success; a stack written by hand under a recipe's name
      got options for a service it doesn't have; and after a Save whose `up` failed, the
      form still read the old files, so unticking the option that broke it was "no change"
      and Save stayed grey. +3 backend (540), +1 frontend (225). Live (scratch backend, a
      `gputest` recipe adding `/dev/nope`, Playwright): ticked + Save → up failed and was
      shown; the box read ticked, Save grey; unticked → Save enabled → saved, the override
      removed, the container running with no devices
- [x] A second review (`/code-review`), nine fixes: the icon lookup read the compose project
      name as the folder (Compose lowercases it and drops dots) and gave a recipe's database
      the icon too — it reads the `working_dir` label now, for the primary container only;
      the icon step could turn a live route into a `500`, and wrote back the whole record
      over a follower change; route tests asked the real Docker daemon; a failed read-back
      in the form showed nothing; `app: []` was replaced, not refused; the sync fetch had
      no `--depth 1`; a Save scanned the recipes twice. +7 backend (547), +2 frontend (227).
      Live, in the rebuilt container: `jellyfin-jellyfin-1` and `bambuddy-bambuddy-1` → their
      icons; `whoami-whoami-1` → none (its recipe has none); `loskai` → none (its folder is
      not in the stacks folder)
- [x] A read of those fixes found one more in them: the read-back ran only when `up`
      *reported* a failure, not when the request itself errored (no docker CLI, a Compose
      timeout — a `400`) after the files were written, so Save went grey again. A save
      reports "kept" once the files are written, whatever `up` does. +1 frontend (228)

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
- [ ] Codebox: Install again from its page, then look at the overview

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
- [ ] On codebox and the Proxmox host: install again, enable, try Update and a row action

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
- [ ] Codebox: Install again (v4), then look at Tailscale's card once it is logged in
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
- [ ] Sunde: on each machine, Install again (status line v5), then Allow updates without a
      password where wanted
- [ ] For Sunde, on codebox: Install again (v3), Add Claude Code if needed, set the projects
      folder (`~` there — `~/loskai`), and open a project from the phone app

---

## Phase 35 — Accounts: an admin, and operators limited to tabs

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
- [ ] Sunde: after deploying, log in as `admin` with the old password (rename it in
      Settings › Users if wanted — by adding a new admin and removing `admin`); unlock the SSH
      key once, which moves it to key slots

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

## Phase 37 — Git as a tool: who commits are by, and where the projects are

Asked 2026-11-03: a Git tool where each machine's projects folder and its global git user
and email are set.

**Decisions (2026-11-03, Sunde)**

- **A tool can have settings** (`settings:` in its file): a value on the machine, with
  a command that reads it and one that writes it, the new value reaching the write command
  only as `$1`, checked against a kind as a target is. The Git tool has Name
  (`user.name`) and Email (`user.email`), both `git config --global`.
- **Read and written with Loskai's key**, when the card is open
  (`GET`/`PUT /api/ssh/machines/{id}/tools/{tool}/settings`). Nothing to install again;
  the values show while the key is unlocked, and the card says to unlock otherwise.
  The overview (the status key) was the other way, and was turned down: it would have
  needed a new status line, and every machine installing again.
- **The projects folder moves to the Git card**, out of General. It stays Loskai's,
  on the machine's record, and Claude Code still finds its projects there.
- **Git needs git** on the machine, so it is an added tool, offered under Add tool where
  git is missing.

**Steps** — a commit each, every check run:

- [x] 37a Backend: `settings` in the tool schema, `git.yml`, the two routes, the log; tests
- [x] 37b Frontend: settings in a tool's card, the projects folder moved to Git's; tests
- [x] 37c Docs: tool-schema.md, api.md (+2 routes), using-loskai.md, architecture.md, CLAUDE.md, HISTORY, CHANGELOG
- [x] Live, in Chromium against the Debian container: the card asked for the password
      (key locked after a restart), read nothing set, set Name and Email, refused "not an
      address" with "Not a valid email", and `git config --global --list` on the machine
      showed both; the SSH log has each as `setting`

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
- [ ] Sunde: New key in Settings › SSH, then set up each machine again

---

## Backlog / Future ideas
- **Machines over SSH, after Phase 34** — one command on several machines at once; a second
  login factor (TOTP) once Loskai holds keys.
  [`architecture.md`](architecture.md#direction--managing-the-machines-over-ssh)
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
  the whole `instances.json`, so one assign reads the file several times over — ten call sites
  app-wide, six inside `instances.py` itself. Same shape as F12's per-key `settings.json`
  reads. A request-scoped read is the fix; changing the *storage format* is not (JSON is the
  right choice while the app is the writer and the file stays a human-readable recovery record)
- Tier-3 integration rig + Forgejo CI (Phase 8b) — deferred by choice
- `CertStatus.tsx` cert expiry (Phase 3) — under the internal CA this is readable from
  Caddy's PKI endpoints; TLS probe stays the method-independent approach
