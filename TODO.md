# Loskai — TODO

**Now:** Phase 15 — audit cleanup (below).
**Next:** Phase 16 — ship layout C and make upstream detection topology-correct (below).
Phase 17 (documentation restructure) is **done** — landed 2026-08-30.
Phases 1–13 are complete and live in [`docs/todo-archive.md`](todo-archive.md);
`HISTORY.md` carries the narrative of what was built and why.

---

## Phase 14 — Fold the Network tab into Settings
_Decision (2026-08-26): the standalone Network tab is dissolved. Its per-service **config**
moves into a restructured Settings page with a Forgejo-style nested sub-sidebar; its
**operational status** moves to Routing. The split is not a straight relocation — it separates
*configuration* from *live status*: AdGuard and Caddy are core to what Routing does (it pushes
their state), while WireGuard is only a convenience link with no module health worth watching
there. This walks back Phase 10b's "Network tab" and adjusts Phase 11 Stage B accordingly —
route creation stays exactly where Phase 11 put it (the Routing tab's Add route picker)._

_Locked-in shape: sidebar becomes `Dashboard · Docker · Routing · Settings`; Settings gains
deep-linkable nested routes `/settings` (General) · `/settings/network` · `/settings/security`;
Settings > Network is **fields-only** (auto-save on blur, unchanged) with one acknowledged
exception — WireGuard keeps a small "Open" link since it has nowhere else to live. **No backend
changes**: same `/api/settings` keys, same partial-PUT contract._

**Stage A — nav + nested `/settings` routes**
- [x] `components/shared/Layout.tsx`: drop the `/network` entry from `NAV` and its `dotFor`
      line (`/routing`'s `worst(caddy, adguard)` dot is untouched)
- [x] `App.tsx`: remove the `Network` import/route; add nested `/settings` routes — a
      `SettingsLayout` wrapped **once** in `RequireAuth`, with `index` (General) + `network` +
      `security` children

**Stage B — `pages/settings/` split**
- [x] `pages/settings/SettingsLayout.tsx` — the narrow sub-sidebar (`NavLink`s, reusing
      `Layout.tsx`'s active/inactive treatment) + `<Outlet/>`; owns the "Settings" `<h1>`
- [x] `pages/settings/General.tsx` — today's `pages/Settings.tsx` verbatim (`base_domain`,
      `host_ip`, `recipes_repo_url`, `stacks_dir` + the Backup/export section), minus the `<h1>`
- [x] `pages/settings/Network.tsx` — three fields-only sections (AdGuard / WireGuard / Caddy)
      reusing the existing `InlineSettingsFields` + field defs. **No** `ServicePanel`, status
      badge, `RoutedHint`, or cert-page block. WireGuard section keeps its "Open" link-out +
      `PeerDnsReminder`
- [x] `pages/settings/Security.tsx` — stub reserving the slot; note that admin-password change
      is still unimplemented (no `POST /api/auth/change-password` — see Phase 3's deferred item)
- [x] Delete `pages/Settings.tsx` + `pages/Network.tsx`

**Stage C — `InfraStatusPill` + Routing status strip**
- [x] `components/routing/InfraStatusPill.tsx` — generalize `AdGuardStatus.tsx` (icon, name,
      `ModuleHealth`, url, link label, children for extra content); delete `AdGuardStatus.tsx`
- [x] Unconfigured services render an internal **"Configure →"** link to `/settings/network`
      instead of a dead external link — this is what replaces the guidance the Caddy
      `ModuleStatus` banner used to give
- [x] `pages/Routing.tsx`: replace the AdGuard pill + Caddy `ModuleStatus` banner with two
      `InfraStatusPill`s. **Caddy is promoted** from problem-only to always-visible. AdGuard
      keeps its "answers → `<ip>`" note; Caddy carries the by-IP cert link (derivation moved
      from `pages/Network.tsx`) + a compact copy-to-clipboard button
- [x] `components/shared/ModuleStatus.tsx` itself is unchanged — Docker still uses it

**Stage D — component moves, tests, docs**
- [x] `components/network/` → `components/settings/`: move `PeerDnsReminder.tsx` + its test
      unchanged; delete `ServicePanel.tsx` + its test (no longer used anywhere)
- [x] `tsc -b`, `vite build`, `oxlint`, `npm test` all clean
- [x] Update `PLAN.md` (sidebar list, the Network-tab paragraph, routes list, `frontend/src/`
      tree) + `HISTORY.md`
- [x] **Live smoke (user):** `/settings`, `/settings/network`, `/settings/security` render and
      the sub-nav highlights; `/network` gone from the sidebar; Routing shows both pills
      (healthy + unconfigured) and the cert-page copy button works

**Phase 14 complete.** _Smoke-tested on device 2026-08-27: all seven checks pass, including the
deep-link into `/settings/network`, auto-save on blur, and the unconfigured AdGuard pill falling
back to the internal "Configure" link against a real health payload rather than a mocked one._

---

## Phase 15 — Audit cleanup
_Origin (2026-08-26): a recursive audit traced every definition in `backend/src` +
`frontend/src` to its references and reviewed the documentation structure. 20 findings; IDs
below (F1…D4) match that report. **Nothing here is a new feature** — it is stale text, five
real defects, and consolidation of code that has already drifted once. Came back clean: no
dead exports beyond `api.text()`, no orphan files, `docs/api.md` accurate across all 45 routes,
the `client.py`/pure-logic seam intact._

_Decisions taken up front (2026-08-27), so a fresh session can start at Stage A without
re-litigating them: **F5** splits by file — `settings.json` fails loudly, `instances.json`
degrades (reasoning below); **F16** deletes the unused routes rather than documenting them;
**D1** archives completed TODO phases only — `HISTORY.md` and `PLAN.md` are left alone for now;
**D3** commits the Makefile. F8 and F12 are explicitly out of scope unless the rest lands early._

_**Branch (settled 2026-08-27): `phase-15-audit-cleanup`, off `main`.** Phase 14 passed its
smoke test and landed on `main` (`restructure-settings` points at the same commit), so there
was nothing left to branch around._

**Stage A — stale text (no behaviour change, no test churn)**
- [x] F13 `CLAUDE.md:60` — "Docker **and Network** tabs display routed state but never create
      routes" → Docker only. Phase 14 dissolved the Network tab. Highest value in the phase:
      this file is read as ground truth at the start of every session, so the wrong fact keeps
      propagating into new work (`PLAN.md` was corrected; this was missed)
- [x] F14 `AddRouteModal.tsx:190` — user-visible copy `"set its URL in the Network tab"` →
      Settings > Network, ideally a link to `/settings/network` (the destination
      `InfraStatusPill` already established for "not configured"). Same file `:63` — the header
      comment "the Docker/Network tabs no longer assign" is stale the same way
- [x] F15 — sweep comments narrating a finished build: `main.py:6` ("as each phase adds them"),
      `health.py:3` ("Phases 3–5, 8"), `SettingsFields.tsx:22` ("each Network panel"),
      `SettingsLayout.tsx:6` (claims `ModuleStatus` deep-links to `/settings/network` — it links
      to `/settings`, which is *correct*, since its unconfigured case is `stacks_dir` under
      General). `health.py:52`'s `"health check wired in a later phase"` string is gone, but the
      `else` branch itself was **kept** (now an accurate `"no health check registered"` + a note
      that it is defensive): deleting it would leave `result["docker"]["stacks_dir_ok"]` to
      `KeyError` on a partially-imported app — the opposite of what F1 is about. F1 revisits it
- [x] D2 — add `docs/certificate-setup.md` to the README Documentation list. The only doc
      missing from it, despite being linked from install/dev-testing/troubleshooting and
      covering the most confusing moment a new user hits (the untrusted-cert warning)

**Stage B — correctness**
- [x] F1 `health.py:47` — `result[name] = await checker()` is unguarded, so one raising module
      500s `/api/health` and greys out **all four** cards, breaking the core degradation
      invariant. It holds today only because each checker happens to catch its own errors.
      Wrap each in try/except → `{"status": "unreachable", "detail": describe_error(exc)}`, and
      run them through `asyncio.gather` (four sequential awaits mean one slow service delays
      every other module's status). **Test:** register a deliberately raising checker, assert
      the other three still report. Done, plus: the `consistency` hook is contained the same
      way (same failure mode, same function), and the concurrency is pinned by a test that
      deadlocks if the awaits ever go back to sequential
- [x] F2 `AddRouteModal.tsx:206` — missing `.toLowerCase()` (`AssignModal.tsx:110` has it) and
      no validation hints at all, while `isValidPrefix` rejects uppercase. Typing `Grafana`
      leaves "Add route" disabled with nothing on screen explaining why. Only bites manual
      typing — `suggestPrefix` lowercases the pre-fill. Lowercase on change + port the
      `!prefixOk` / `!upstreamOk` messages across from `AssignModal`
- [x] D4 — add the `AddRouteModal` validation test alongside F2. 305 lines, the single
      route-creation surface, currently untested — which is exactly how F2 survived
- [x] F5 `store.py:16` + `instances.py:39` — corrupt or hand-edited JSON propagates
      `JSONDecodeError` / `ValidationError` up through `settings.value()`, which nearly every
      router calls, so one bad character 500s every page without naming the file. **Split the
      handling — do not "return the default" for settings.json:** `password_set()` reads
      `admin_password_hash` from it (`auth.py:97`), an empty dict makes it `False`, and
      `POST /api/auth/setup` is in `PUBLIC_ROUTES` and only refuses *once one exists*
      (`auth.py:162`) — so a silent fallback converts a corrupt file into unauthenticated admin
      takeover, and `set_admin_password_hash` then writes a fresh dict, destroying the rest of
      the settings. So: **`settings.json` → refuse to boot, naming the path** (Forgejo's
      app.ini model: hand-editable, but a malformed file stops startup with a clear error
      rather than booting on defaults — and Loskai actively invites hand-editing, since
      Settings > Security tells the user to remove `admin_password_hash` manually).
      **`instances.json` → log and skip the unreadable record**; it carries display state only,
      and one bad row must not take the app down. Done as planned, with one refinement the plan
      didn't specify: a *file*-level parse error in `instances.json` raises too (naming the
      path). Only whole records degrade — reading an unparseable file as `[]` would let the
      next upsert write a fresh file over every route
- [x] F4 — no `logging` anywhere in the backend (zero imports). `assign.py:207` swallows a
      failed stale-rewrite delete with a bare `pass`, and the AdGuard half of assign is
      best-effort by design — both defensible, but nothing is recorded anywhere, so the
      operator debugging a leftover rewrite has only a transient UI warning. This is the exact
      failure mode `ff0f167` was written to fix. Add module loggers; `logger.warning` on every
      swallowed exception and best-effort miss. Docker's per-poll stats miss and the exec
      socket teardown log at `debug` instead — both are routine and sit in hot paths
- [x] F3 `App.tsx` — no `path="*"` route, so a mistyped URL renders the Layout chrome with a
      blank pane (the backend SPA catch-all correctly serves `index.html`). Add a `NotFound`
      inside the `<Layout />` element so the nav stays and the pane explains itself

**Stage C — consolidation**
- [x] F6 — two settings-field components with different save models now sit in one page:
      General uses `SettingsFields` (explicit Save button), Network uses `InlineSettingsFields`
      (auto-save on blur — the Phase 14 decision). General was moved across verbatim and never
      migrated. Move it onto `InlineSettingsFields` and delete `SettingsFields`; rehome its
      three exported types (`FieldDef` / `SettingField` / `SettingsView` — `AddRouteModal`
      imports them too). Note `saveLabel` is a prop no caller passes, and the `seeded` flag
      stops the General form ever reflecting a sibling category's save
- [x] F7 — `AssignModal.tsx:56–70` and `AddRouteModal.tsx:137–152` duplicate `isDnsOnly`,
      `prefixOk`, `upstreamOk`, `upstreamHint`, `upstreamHelp` and `fqdn` verbatim (~25 lines,
      including the long split-LXC help string character for character), plus near-identical
      field markup. This is the mechanism behind F2. Extract `useRouteFields()` for the
      derivation + a `RouteFields` component for the three inputs; each modal keeps its own
      chrome and submit payload. **Do this immediately after F2, while the divergence is fresh**
      — done in that order, with D4's tests already in place to catch a regression in the move.
      Split across two files (`useRouteFields.ts` + `RouteFields.tsx`): oxlint's fast-refresh
      rule wants a component file to export only components
- [x] F9 `Routing.tsx:32` — a local `interface SettingsView { base_domain?: { value } }`
      shadows the exported one, and both back the same `["settings"]` query key, so two
      different types describe one cache entry. Import the real type, drop the local.
      `Docker.tsx:37` had an inline type on the same query for the same reason — also fixed
- [x] F10 `lib/api.ts` — `api.text()` has zero call sites and its comment names a Caddyfile
      export endpoint that does not exist. Delete it (the only genuine orphan export in the
      frontend)
- [x] F11 — settings keys are enumerated in three places (`config.py`'s `Settings`,
      `settings.py`'s `CONFIGURABLE_KEYS`, the frontend `*_FIELDS` arrays). Forgetting the
      middle one silently makes a key env-only and unwritable from the UI, with no failing
      test and a symptom that looks like a frontend bug. Add a test asserting every
      `CONFIGURABLE_KEYS` entry is a real attribute of the `Settings` model — implemented as an
      equality against the model's fields minus an explicit `ENV_ONLY_KEYS` set, so the reverse
      drift (added to `Settings`, forgotten in `CONFIGURABLE_KEYS`) fails too
- [ ] ~~F8~~ (both route modals hand-roll chrome `Modal.tsx` provides — needs a size prop) and
      ~~F12~~ (`settings.value()`/`resolve()` re-read settings.json per key;
      `derive_caddy_host_ip()` reads it twice per assign and per health poll) — **out of scope**,
      revisit only if Stages A–C land early

**Stage D — housekeeping**
- [x] D3 — commit the `Makefile` (currently untracked, so it helps one checkout and drifts
      from the two files that *are* read) and point README's Develop section at
      `make backend` / `make test-backend`, so the commands have one source of truth
- [x] F16 — delete the six route handlers with no frontend caller: `GET /api/adguard/health`,
      `GET`/`POST`/`DELETE /api/adguard/rewrites`, `GET /api/caddy/health`,
      `GET /api/caddy/upstreams`, `GET /api/wireguard/status`, `GET /api/instances`.
      **⚠ Delete the HTTP route handlers ONLY — every underlying client method stays.**
      `client.upstreams()` feeds `upstream_healthy` in the routes table (`caddy/service.py:113`);
      `list_rewrites()` feeds reconcile (`adguard/service.py:210,236`) and export
      (`export.py:27`); `add_rewrite`/`delete_rewrite` feed assign (`assign.py:205,208,259`).
      Keep each module's `_health_payload` too — the aggregate `/api/health` registers it.
      No test references any of these routes, so the suite should be untouched. Remove their
      rows from `docs/api.md` in the same commit — and from `PLAN.md`'s per-module API
      inventories, which listed all six (one line also claimed the frontend reads Caddy's mode
      from `/api/caddy/health`; it has always read it from the aggregate health payload)
- [x] D1 — move completed Phases 1–13 out of `TODO.md` into `docs/todo-archive.md`, leaving
      Now/Next/Backlog plus any live phase. ~196KB across PLAN + HISTORY + TODO is read at every
      session start per CLAUDE.md, against that same file's "context fills fast" warning; this
      reclaims ~50KB, is fully reversible, and matches the tiered structure CLAUDE.md already
      describes. Leave a pointer line at the top of TODO.md. **`HISTORY.md` and `PLAN.md` are
      deliberately not touched** (decided 2026-08-27). Phase 14 stays alongside Phase 15 —
      it is what this phase cleans up after. `CLAUDE.md`'s project-state paragraph was updated
      in the same commit: it still claimed Phase 12 was in progress

**Follow-ups — durability of the flat store** (2026-08-28, not part of the original 20
findings; both surfaced from reviewing F5's blast radius)
- [x] `write_json` renamed its temp file over the target without an `fsync`, so a power cut
      could commit the rename with the data still in cache — a zero-length `settings.json`
      that then refuses to boot. This was the only way the app could produce a corrupt store
      file itself rather than being handed one by a hand-edit. The containing directory is
      deliberately **not** fsynced: that only decides whether the newest write survives a
      crash, and losing one settings change is fine where losing the file is not
- [x] Every writer rewrote the whole file after a separate read, and the writers span both
      execution contexts FastAPI uses — sync handlers in the threadpool (`PUT /api/settings`,
      `PATCH /api/instances`) and async ones on the event loop (assign, reconcile) — so two
      overlapping cycles silently discarded one side's change. A settings key reverting in the
      UI is annoying; a dropped **instance record** leaves its Caddy route + DNS rewrite live
      but unmanageable, since `instances.json` is the spine both are rebuilt from. Fixed with
      `store.update_json()` (read → mutate → write under one `threading.Lock`, which is what
      the two-context split rules an `asyncio.Lock` out of); `_save`/`_write_stored` are gone,
      so no unlocked write path is left to add a caller to. Reads stay lock-free — the atomic
      rename already gives a reader the whole old file or the whole new one. **Single-process
      only:** adding `--workers` to the image's `CMD` would need `flock` instead

**Verification (each stage a commit that leaves the repo working)**
- [x] Frontend: `tsc -b`, `oxlint`, `vite build`, `vitest run` — note the sandbox needs
      `export PATH="/home/sunde.guest/.local/node/bin:$PATH"` and direct entrypoints
      (`node ./node_modules/vitest/vitest.mjs run`), since the `.bin` shims are blocked
- [x] **Backend: `pytest` — 181 passed (2026-08-31).** Includes all 30 tests in the four
      files that had never executed (`test_health_registry.py`, `test_store_corruption.py`,
      `test_store_concurrency.py`, `test_settings.py`). `uv run pytest` still fails in the
      sandbox (`failed to canonicalize .../backend/.venv/bin/python3: Operation not
      permitted`) because uv resolves the venv's interpreter symlink; the venv's
      `site-packages` is readable, so invoking the uv-managed interpreter directly works:
      `PYTHONPATH=".venv/lib/python3.12/site-packages:src"
      ~/.local/share/uv/python/cpython-3.12.13-linux-x86_64-gnu/bin/python3.12 -m pytest`
- [x] **Live smoke (user) — five of six confirmed on real hardware 2026-08-31:** Add route
      rejects/normalises a typed capital (F2); a mistyped URL shows the NotFound pane (F3);
      Settings > General saves on blur with no Save button (F6); Routing still loads and Sync
      still works after F16 removed six handlers; the Add route > Network list shows the
      `Settings › Network` link when a service has no URL set (F14)
- [ ] **Live smoke, F5 remainder.** A corrupted **file** was tested and behaved correctly —
      `CorruptStoreError` raised and named the path, and `/api/health` stayed **200** with the
      failure contained to one checker (F1 working as designed). Two paths still unrun:
      (a) `settings.json` refusing startup with the path in the message; (b) the *record*-skip
      path, which needs **valid JSON containing one schema-invalid row** — a syntax error breaks
      the file and correctly raises instead, which is what the first attempt hit
- [x] **F5 follow-up — `CorruptStoreError` never reaches the operator** (found by the
      2026-08-31 smoke test). The error was raised in three places and **caught nowhere**;
      `main.py` had no exception handler. `/api/health` survived only because F1 wraps its
      checkers individually. Everything else 500'd with an empty body: `shared/dashboard.py:19`
      (**`GET /api/dashboard`** — the public, unauthenticated launcher), the Routing and Docker
      tabs, `shared/export.py:36`, and every path in `shared/assign.py`. The defect was that
      `CorruptStoreError`'s own docstring promises it "always names the path … the operator
      needs to know *which* one to fix" — and that path only ever reached the server log, so
      the operator whose file is broken saw a dead launcher and no reason why. **Fixed
      2026-08-31**: an `@app.exception_handler(CorruptStoreError)` in `main.py` returning
      `{"detail": str(exc)}` at `500`, the error shape `docs/reference/api.md` documents and
      the frontend already renders. It also `logger.error`s explicitly — handling the
      exception stops uvicorn printing the traceback, and losing the server-side record would
      have traded one blind spot for another. Raising behaviour is unchanged, and startup
      corruption still aborts the boot via `verify_readable`. Four tests in
      `test_corrupt_store_response.py` (public dashboard, an authed route, the log, and the
      untouched happy path); the three defect-specific ones were confirmed to fail with the
      handler commented out. **Does not cover making the UI *recover*** — the tabs still show
      an error state, they just now say which file to fix

**Stages A–D landed 2026-08-27** (six commits on `phase-15-audit-cleanup`). Frontend checks
pass — `tsc -b`, `oxlint`, `vite build`, 35 Vitest tests across 9 files (was 29/7). Backend:
185 pytest tests pass (2026-08-31 — first run at 181, plus 4 for the F5 follow-up). Five of
the six live-smoke checks were confirmed on real hardware 2026-08-31, and the surfacing
defect that smoke test exposed is fixed. The phase is **not** closed: the F5 live-smoke
remainder (above) still needs real hardware.

---

## Phase 16 — Ship layout C, fix upstream detection

_Origin (2026-08-30): a review of what Loskai can actually be deployed onto, prompted by the
question "would AdGuard separate + Caddy & Loskai in one Docker stack be better than the
current two options?". Comparing the layouts on **port ownership** produced
[`docs/topologies.md`](docs/guides/topologies.md) (landed with this phase write-up) and surfaced one
real defect. Two layouts ship today (A split-LXC, B all-in-Docker); **C** (split DNS) is the
one to build._

_**Rescoped 2026-09-02.** The phase was "support all four topologies". Layout D — all three
components merged into one container — is **rejected**, not deferred: it fixes no port
conflict (the only contested port is `53` against the host resolver, which is host-vs-container
and survives the merge), it puts DNS, TLS and the root-equivalent Docker socket in one blast
radius, and it would grow a supervisor onto the single-process image everyone else runs. B
already answers "one box, nothing else set up" without any of that. The reasoning is kept in
[`topologies.md` → Considered and not supported](docs/guides/topologies.md#considered-and-not-supported)
so it doesn't come back open. **The recommendation is now three-tier: A and C recommended, B
the supported alternative with its caveats stated, D rejected.** Stage D is deleted; Stages
A–C are unchanged in substance._

_Findings that drive the stages below:_
- _**The upstream prefill is wrong in layout B today.** `caddy_mode` (`modules/caddy/service.py:27`)
  decides topology by asking "is `CADDY_ADMIN_URL`'s host an IP?" as a proxy for "can Caddy
  resolve this container's name?". Those diverge whenever Caddy is a container next to managed
  stacks: Compose puts every project on its own `<project>_default`, so Caddy resolves only
  `adguard`/`loskai` (its own project) — never a managed stack. `grep network compose*.yml`
  returns nothing; no shared network is created anywhere. This is the 2026-07-26 split-LXC 502
  trap in the other direction, and it blocks C as well as breaking B._
- _**A loopback `CADDY_ADMIN_URL` silently derives a loopback answer IP.**
  `derive_caddy_host_ip` (`shared/settings.py:157`) has no loopback guard, so
  `CADDY_ADMIN_URL=http://127.0.0.1:2019` yields `127.0.0.1` as the DNS-rewrite answer and
  every LAN client resolves the service to itself. `localhost` instead flips `caddy_mode` to
  `docker` and derives nothing. Found while analysing the merged-container layout, but it is
  **not specific to it** — it is an unvalidated setting that misfires in any arrangement where
  Caddy is addressed over loopback, including the all-in-one LXC variant._
- _**Merging processes does not solve any port conflict.** The three components never contend
  with each other; the only contested port is AdGuard's `53` against the host resolver, which
  is host-vs-container and survives the merge. This is what turned the merged container from a
  planned layout into a rejected one._

_Decisions (2026-08-30, rescoped 2026-09-02): **A and C recommended, B the supported
alternative, D rejected.** **A is the pick wherever Proxmox is available** — widest fault
isolation, and an LXC costs nothing but disk. **C is the pick everywhere else, and is the
friendliest layout to operate**: AdGuard goes on any small always-on box (a Raspberry Pi is
the natural fit, as is a mini-PC or NAS), gets configured once and is never touched again,
while everything you iterate on stays behind one `docker compose` on the main host. **B stays
fully supported and is the honest answer when a second box isn't available** — it ships today
and keeps `2019` off the wire; its caveats (AdGuard's `53` vs `systemd-resolved`, DNS in the
Docker host's fault domain, `name:port` not resolving for managed stacks) are documented at
the point of choice rather than buried. C beats it on every axis except needing one more
device. Stage A is load-bearing for every other stage and lands first._

**Stage A — replace the topology heuristic with real network detection**
- [ ] Add a thin `client.py` call for a container's attached networks (I/O only — the
      `client.py`/pure-logic seam is a hard invariant). Loskai already holds the Docker socket,
      so no new setting or permission is needed
- [ ] New pure function: given Caddy's networks and the target container's networks, an
      upstream is `name:port` when they intersect, else `<host_ip>:<published_port>`. This is
      **per-container**, not per-deployment — which is the actual fix. Unit-test it directly
- [ ] Rewire `suggested_upstream` (`modules/docker/logic.py:144`) onto it; keep the current
      `mode` behaviour as the fallback for when Caddy's container can't be identified (external
      Caddy on an LXC — layout A, where the answer is always `<host_ip>:<published_port>`)
- [ ] `caddy_mode` currently also feeds `/api/caddy/status`'s `mode` and the two route modals'
      hint text (`AddRouteModal`/`AssignModal`). Decide whether it stays as a display-level
      summary or is replaced by a per-container hint, then update the frontend copy to match
- [x] Fix `docs/troubleshooting.md:42` — "In the all-in-Docker (co-located) layout ... Caddy
      shares the Docker network, so a `name:port` like `grafana:3000` is correct" is **false**
      for every managed stack; it is only true inside Caddy's own compose project. **Landed
      2026-08-30**, ahead of the rest of the phase — the claim was actively misleading and
      `docs/topologies.md` contradicted it. The replacement also drops "trust the hint for your
      topology", which is bad advice until Stage A lands
- [ ] Extend `tests/test_caddy_logic.py:22` (`test_caddy_mode`) — it pins only the IP and
      hostname cases; loopback is uncovered

**Stage B — layout C: shared edge network + its own compose file**
- [ ] `compose.caddy-loskai.yml` — Caddy + Loskai on the Docker host, AdGuard external.
      `CADDY_ADMIN_URL=http://caddy:2019` (never published), `ADGUARD_URL` a LAN IP,
      `CADDY_HOST_IP` required
- [ ] Declare a shared `loskai-edge` network Caddy attaches to, so a managed stack can join it
      and be routed **without publishing a host port** — the one capability no other layout has
- [ ] Document joining a stack to `loskai-edge` (external network stanza) in
      [`docs/topologies.md`](docs/guides/topologies.md) and [`docs/migration.md`](docs/guides/migration.md);
      consider surfacing "joined to the edge network" in the Docker tab
- [ ] Update `scripts/deploy.sh`'s `COMPOSE_FILE` note and the README run section for the third file
- [ ] [`docs/install.md`](docs/guides/install.md) currently walks through layout A only. Since C is
      the recommended path for anyone without Proxmox, it needs its own walkthrough —
      AdGuard on a Pi/mini-PC first, then the compose stack — or the guide splits at step 1

**Stage C — loopback guard on the answer IP**
_Kept after the D rescope, and re-justified: this was written up as "the defect that makes
layout D unusable", but it is a **settings-validation gap**, not a D-specific one. Any
arrangement where Caddy is addressed over loopback hits it — the all-in-one LXC variant by
construction, and a co-located B stack the moment someone sets `CADDY_ADMIN_URL=http://127.0.0.1:2019`
instead of `http://caddy:2019`. It fails silently and looks like a DNS problem, which is the
worst combination; the general warning now sits in `topologies.md` under "The ports in play"._
- [ ] `derive_caddy_host_ip` must not return a loopback address; when `CADDY_ADMIN_URL`'s host
      is loopback, require an explicit `CADDY_HOST_IP` and surface a clear settings error rather
      than writing rewrites that resolve to the client itself
- [ ] Mirror the check in `shared/settings.py`'s `caddy_host_ip` validation (it currently
      rejects a scheme/port but accepts `127.0.0.1`)
- [ ] Tests for both

**Verification**
- [ ] `pytest` + `npm test`
- [ ] `bash scripts/check-docs.sh`
- [ ] **Live smoke (user):** in layout B or C, routing a *managed stack* container pre-fills a
      reachable upstream (the Stage A fix) and the route returns 200, not 502

---

## Phase 17 — Documentation restructure

_Origin (2026-08-30): a full audit of all 16 markdown files (5,275 lines) against the current
code and project direction. The docs are individually accurate but structurally flat — 13 files
in one `docs/` namespace with no index, no audience segmentation, and the only map being an
unordered list in `README.md`. Findings below; `docs/api.md` came back **clean** (all 36 backend
routes covered — `api.md:103` documents start/stop/restart in one row, which is why a naive
count reads 34)._

_Findings:_
- _**No entry point.** No `docs/README.md`. A reader — or a fresh session — has to guess which
  of 13 files answers their question._
- _**No segmentation.** Operator guides, API contracts and contributor docs share one flat
  namespace with no naming or grouping convention._
- _**`CLAUDE.md`'s doc map names 4 of 13** (`caddy-api`, `adguard-api`, `recipe-schema`,
  `migration`). `topologies`, `deployment`, `troubleshooting`, `install`, `certificate-setup`,
  `api`, `dev-testing` and `lxc-script-authoring` are invisible to a session reading only
  `CLAUDE.md` — the single highest-value fix in this phase, for the same reason F13 was in
  Phase 15._
- _**Port-conflict content is in three places** — `PLAN.md:1054` ("Alternative Setups" + its own
  co-located port table), `docs/deployment.md` ("Co-located port notes"), and
  `docs/topologies.md`. PLAN's copy is now the least complete **and contradicts** the 2026-08-30
  A/C recommendation._
- _**`PLAN.md:1057` names a fifth topology** ("All-in-one — AdGuard, Caddy, and Loskai all on a
  single LXC") that appears in no other doc and is absent from the four-way comparison._
- _**Stale in `PLAN.md`:** the "Network tab" (dissolved by Phase 14) and "LXC 103" in the
  Resilience Summary (pre-split numbering; the two-LXC split landed 2026-07-20)._
- _**`docs/todo-archive.md` is 480 lines / 50KB of project tracking** sitting in `docs/` — the
  second-largest file there, and not documentation._
- _**Three pre-existing broken links:** `todo-archive.md:105` and `:199` link `docs/adguard-api.md`
  / `docs/recipe-schema.md` from *inside* `docs/`; `caddy-api.md:20` links `#server-name-discovery`
  but the heading is `### 1. Discover the server name`._

_Decisions taken up front (2026-08-30, all three confirmed by the user): **nested by audience**
(`guides/` · `reference/` · `contributing/`) over flat-plus-index — clearest segmentation, reads
best on GitHub, and the repo is small enough that the one-time link churn is cheap. **PLAN.md is
pruned of duplication only** — the port table and Alternative Setups become a pointer; the
architecture sections (data model, modules, assign) are not touched, per the global rule that
PLAN.md changes only when direction shifts. **`todo-archive.md` moves out of `docs/`** to the
repo root beside `TODO.md`/`HISTORY.md`. Every move uses `git mv` so history follows, as the
2026-07-18 compose rename did._

**Stage A — the move**
- [x] `git mv` into `docs/guides/` — `install`, `topologies`, `deployment`, `certificate-setup`,
      `migration`, `troubleshooting`
- [x] `git mv` into `docs/reference/` — `api`, `caddy-api`, `adguard-api`, `recipe-schema`
- [x] `git mv` into `docs/contributing/` — `dev-testing`, `lxc-script-authoring`
- [x] `git mv docs/todo-archive.md todo-archive.md`
- [x] Rewrite every cross-reference for the new depths (`../reference/x.md`, `../../PLAN.md`).
      ~40 links across 16 files, including `PLAN.md`, `TODO.md`, `HISTORY.md` and `README.md`
- [x] Fix the three pre-existing broken links found in the audit

**Stage B — `docs/README.md`, the index**
- [x] Task-oriented entry points ("I want to install it" / "…route a service" / "…change the
      code" / "…know what an endpoint returns") above the file listing — the wiki front page
- [x] One line per doc saying **when to read it**, not what it contains
- [x] Note which docs are contracts with external APIs (read before touching that integration)
      and which describe Loskai's own behaviour

**Stage C — prune duplication and staleness**
- [x] `PLAN.md` "Alternative Setups" + "Co-located port notes" (`:1054`–`:1085`) → a short
      pointer to `docs/guides/topologies.md`, which now carries the full four-way comparison
- [x] `PLAN.md:1057` — the fifth "all-in-one LXC" layout was a loose end referenced nowhere
      else. **Folded into `topologies.md` as a documented variant** (2026-08-30), not dropped:
      it is not a peer of A–D (D's shape, A's mechanism), and on ports it is the best-behaved
      arrangement of all — but `docker.from_env()` (`modules/docker/client.py:34`) defaults to
      the local socket, so Loskai on its own LXC strands the Docker module unless the Docker
      API is exposed over TCP. Documented, explicitly not supported
- [x] `PLAN.md` — "Network tab" → Settings > Network (Phase 14); "LXC 103" → the current split
- [x] `docs/guides/install.md` "Alternative: all-in-Docker" — predates the A/C recommendation and
      still frames all-in-Docker as *the* non-Proxmox answer
- [x] `docs/guides/deployment.md` "Co-located port notes" — keep the operational note, drop what
      `topologies.md` now says better

**Stage D — make the map usable by a fresh session**
- [x] `CLAUDE.md` — replace the 4-doc list with the new structure and point at `docs/README.md`
      as the entry point. This is what makes the restructure pay off for future sessions
- [x] `README.md` — the Documentation list becomes a short pointer to `docs/README.md` plus the
      three or four links a new user actually needs, not all 13

**Verification**
- [x] Link + anchor checker clean across every `.md` (the audit's script, extended for the
      nested depths)
- [x] `git log --follow` resolves through each move
- [x] Every doc reachable from `docs/README.md`; no orphans
- [x] **`scripts/check-docs.sh` + `make check-docs`** (added 2026-08-31) — the checks above were
      one-off scripts that vanished with the session, so "0 broken, no orphans" was a claim
      about a moment rather than a property of the repo. Now enforceable and CI-gateable
      (exits non-zero). Verified against all three failure modes plus the code-fence exemption

**Phase 17 landed 2026-08-30** (three commits). 13 docs moved into `guides/` · `reference/` ·
`contributing/` with `git mv`; 40 cross-references rewritten; `docs/README.md` added as the
index. Link + anchor checker reports **0 broken** across all 17 markdown files, all 13 docs are
reachable from the index with no orphans, and `git log --follow` resolves through every move
(`todo-archive.md` keeps 72 commits of history). Four broken links fixed along the way — the
three the audit found, plus one `#alternative-all-in-docker` self-link the checker caught after
`install.md`'s heading was renamed.

---

## Backlog / Future ideas
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
