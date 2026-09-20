# Loskai — TODO

**Now:** nothing in flight. Phases 13–20 are closed; **Phase 12 is still not**, despite having
been archived as complete (below) — though Phase 19 closed out its 12a. Pick from there or from
the [backlog](#backlog--future-ideas) at the bottom of this file.

**Phases 15, 16 and 18 closed 2026-09-05** — 15 and 16 on live smokes against a real Docker
daemon, **the first time this project had ever been run** rather than unit-tested, and 18 is
the path restructure that came straight out of running it. **Phase 19 closed 2026-09-09** (the
public Certificate page). `pytest` (229) + `npm test` (54) + `check-docs.sh` all pass.

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

- **Phase 12 — internal-CA trust onboarding. Archived 2026-08-27 as complete; it is not.**
  No completion marker, every item unchecked.
  - ~~**12a** — the trust-install page prints Debian-only Linux instructions~~ **done in
    Phase 19** (below): both pages now carry Debian, Fedora/RHEL and Arch/openSUSE commands,
    plus the NSS step Chrome and Chromium need on Linux
  - **12b** — per-route scheme toggle (`https` / `both` / `http`), approved 2026-08-03,
    unbuilt. Exists only for clients that cannot hold a custom root CA. **Its notes already
    specify insert-at-index-0 for the `:80` server** — the same rule the 2026-09-05 defect
    turned out to need for `:443`, written a month earlier and never generalised
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
- [x] Tests: `test_adguard_clear.py` (5 — foreign entries cleared, one-per-name restore, the
      two refusals, a failed delete) + `ClearRewrites.test.tsx` (6 — the dialog gates the
      call, cancel is a no-op, the warning's wording, both result shapes, a 502)
- [x] Docs: `api.md`, `adguard-api.md` (Ownership gains its one exception), `PLAN.md`,
      `CLAUDE.md` (the invariant's caveat + the route count)

**Verification**
- [x] `pytest` (229) + `npm test` (54) + `check-docs.sh`
- [x] **Live, against a real AdGuard** (`compose.dev.yml`, v0.107.79), clicked in the browser:
      seeded two Loskai rewrites, one hand-added (`printer.smoke.test`) and one under a
      previous base domain (`oldnas.previous.lan`). **Sync first — `added/deleted/swept` all
      empty**, both foreign entries untouched, which is the behaviour being preserved. Then
      Clear: all four removed, exactly two restored, and `nslookup` against AdGuard's `:53`
      answered `.220` and `.50`. A second Clear left the same two — no duplicates. `health`
      reported `consistency: []` throughout

---

## Backlog / Future ideas
- **The Routing tab says "route + DNS rewrite created." after a `dns_only` assign** (found in
  the 2026-09-16 Phase 13 smoke). `Routing.tsx` prints that fixed string whenever there is no
  `warning`, ignoring the response's `caddy: "skipped"` — so the one mode that by definition
  creates no route reports that it did. Cosmetic; the row itself renders correctly
- **`POST /api/assign` accepts a `container` that matches nothing** (found in the 2026-09-16
  smoke). The link key is the container **name** — `AddRouteModal` sends `c.name` — but the
  endpoint takes any string: posting the short *ID* returned `200`, pushed a working route,
  and the Routing tab then listed it as an orphan whose container "was removed" while the
  same row read `synced`/`up`. The UI can't send it, so only a hand-written API call hits it;
  a `422` for a `container` with no match would close it
- **An unrouted name under `BASE_DOMAIN` answers an empty `200`** (found alongside the
  2026-09-05 route-ordering defect, deliberately **not** fixed with it — it is the same
  wildcard block but a different symptom, and the fix that mattered was the one that made real
  routes work). `curl https://nothing.<base-domain>/` returns `200` with `content-length: 0`
  from the Caddyfile's terminal `*.{$BASE_DOMAIN}` block. A typo'd or not-yet-assigned name
  looks like a blank page rather than an error, which is the same "fails as a success" shape
  that hid the route bug for so long. Fix is a catch-all `respond 404` **after** the wildcard
  block in `caddy/Caddyfile` (it must stay ahead of nothing and behind everything Loskai
  pushes, which head-insertion now guarantees). Worth a `troubleshooting.md` symptom entry
  either way — anyone on a build from before 2026-09-05 hits the empty 200 on a *real* route
- **Real domain + DNS-01 wildcard** (e.g. `*.home.<owned-domain>`): publicly-trusted certs,
  zero cert install on any device, nothing exposed publicly (DNS-01 is outbound-only; the
  names resolve on the LAN via AdGuard rewrites). Dissolves Phase 12 entirely, including the
  whole onboarding page. **Not scheduled** — deliberate decision to keep the homelab off the
  owned domain for now. Precondition when revisited: DNS hosted somewhere with an API Caddy
  has a plugin for (one.com almost certainly isn't; a subdomain can be NS-delegated, or
  `_acme-challenge` CNAME'd to an acme-dns instance, without moving the registrar)
- **Store read amplification** (twin of Phase 15's deferred F12, noted 2026-08-29): every
  `get_instance` / `get_by_container` / `get_by_origin` / `list_routed` re-reads and re-parses
  the whole `instances.json`, so one assign reads the file several times over — ten call sites
  app-wide, six inside `instances.py` itself. Same shape as F12's per-key `settings.json`
  reads. A request-scoped read is the fix; changing the *storage format* is not (JSON is the
  right choice while the app is the writer and the file stays a human-readable recovery record)
- Tier-3 integration rig + Forgejo CI (Phase 8b) — deferred by choice
- `CertStatus.tsx` cert expiry (Phase 3) — under the internal CA this is readable from
  Caddy's PKI endpoints; TLS probe stays the method-independent approach
