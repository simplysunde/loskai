# Loskai — TODO

**Now:** nothing in flight. Phases 13–22 are closed, and **Phase 12 is finally done** — 12a
in Phase 19, 12b as Phase 22 (2026-09-24); only 12c remains, and it is documentation with no
Loskai code. Pick from there or from
the [backlog](#backlog--future-ideas) at the bottom of this file.

**Phases 15, 16 and 18 closed 2026-09-05** — 15 and 16 on live smokes against a real Docker
daemon, **the first time this project had ever been run** rather than unit-tested, and 18 is
the path restructure that came straight out of running it. **Phase 19 closed 2026-09-09** (the
public Certificate page). `pytest` (281) + `npm test` (95) + `check-docs.sh` all pass.

**Two things a fresh session should know before touching anything:**

- **Routes are pushed at the *head* of Caddy's array** (`PUT …/routes/0`), never appended.
  The bootstrap Caddyfile's `*.{$BASE_DOMAIN}` block — which exists only so Caddy issues the
  wildcard cert — compiles to a handler-less `"terminal": true` route placed first, matching
  every name Loskai routes. Appending put every pushed route behind it, where it never ran and
  Caddy answered an **empty `200`** instead of proxying. It failed as a *success*, which is why
  209 unit and contract tests never saw it and `/api/caddy/routes` reported `synced: true` and
  `upstream_healthy: true` the whole time. Full write-up in
  [`todo-archive.md`](todo-archive.md) Phase 16; the operator-facing version is
  [`troubleshooting.md`](docs/guides/troubleshooting.md#a-blank-page-or-an-empty-200).
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
  - **12c** — Caddy as ACME server for HTTPS-native backends (docs only, no Loskai code)
- ~~**Two live smokes that were never run** — Phases 10a and 13~~ **both ran 2026-09-16 and
  passed**, 10a together with Phase 19's browser check (below). Results are in each phase's
  checklist in [`todo-archive.md`](todo-archive.md)
- Phase 8b's Tier-3 integration rig + Forgejo CI are unchecked **by choice** — see the backlog

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

## Phase 24 — The ACME path stops assuming DuckDNS

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

**Not done (and not needed for the above):** the co-located Docker path is still a hand-edit
of two files rather than a switch. `caddy/Dockerfile`'s comment now shows the `ARG` shape it
would take.

**What this does *not* solve:** one.com hosts the domain in question and there is **no
`onecom` module** in the caddy-dns organisation (checked: the o-range holds `njalla`,
`neoserv`, `oraclecloud`). Public certs there still require delegating a subdomain or
CNAME-ing `_acme-challenge` to acme-dns — now at least configurable rather than a hand-edit.

---

## Backlog / Future ideas
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
