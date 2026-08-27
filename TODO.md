# Loskai — TODO

**Now:** Phase 15 — audit cleanup (below).
Phases 1–13 are complete and live in [`docs/todo-archive.md`](docs/todo-archive.md);
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
- [ ] F1 `health.py:47` — `result[name] = await checker()` is unguarded, so one raising module
      500s `/api/health` and greys out **all four** cards, breaking the core degradation
      invariant. It holds today only because each checker happens to catch its own errors.
      Wrap each in try/except → `{"status": "unreachable", "detail": describe_error(exc)}`, and
      run them through `asyncio.gather` (four sequential awaits mean one slow service delays
      every other module's status). **Test:** register a deliberately raising checker, assert
      the other three still report
- [ ] F2 `AddRouteModal.tsx:206` — missing `.toLowerCase()` (`AssignModal.tsx:110` has it) and
      no validation hints at all, while `isValidPrefix` rejects uppercase. Typing `Grafana`
      leaves "Add route" disabled with nothing on screen explaining why. Only bites manual
      typing — `suggestPrefix` lowercases the pre-fill. Lowercase on change + port the
      `!prefixOk` / `!upstreamOk` messages across from `AssignModal`
- [ ] D4 — add the `AddRouteModal` validation test alongside F2. 305 lines, the single
      route-creation surface, currently untested — which is exactly how F2 survived
- [ ] F5 `store.py:16` + `instances.py:39` — corrupt or hand-edited JSON propagates
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
      and one bad row must not take the app down
- [ ] F4 — no `logging` anywhere in the backend (zero imports). `assign.py:207` swallows a
      failed stale-rewrite delete with a bare `pass`, and the AdGuard half of assign is
      best-effort by design — both defensible, but nothing is recorded anywhere, so the
      operator debugging a leftover rewrite has only a transient UI warning. This is the exact
      failure mode `ff0f167` was written to fix. Add module loggers; `logger.warning` on every
      swallowed exception and best-effort miss
- [ ] F3 `App.tsx` — no `path="*"` route, so a mistyped URL renders the Layout chrome with a
      blank pane (the backend SPA catch-all correctly serves `index.html`). Add a `NotFound`
      inside the `<Layout />` element so the nav stays and the pane explains itself

**Stage C — consolidation**
- [ ] F6 — two settings-field components with different save models now sit in one page:
      General uses `SettingsFields` (explicit Save button), Network uses `InlineSettingsFields`
      (auto-save on blur — the Phase 14 decision). General was moved across verbatim and never
      migrated. Move it onto `InlineSettingsFields` and delete `SettingsFields`; rehome its
      three exported types (`FieldDef` / `SettingField` / `SettingsView` — `AddRouteModal`
      imports them too). Note `saveLabel` is a prop no caller passes, and the `seeded` flag
      stops the General form ever reflecting a sibling category's save
- [ ] F7 — `AssignModal.tsx:56–70` and `AddRouteModal.tsx:137–152` duplicate `isDnsOnly`,
      `prefixOk`, `upstreamOk`, `upstreamHint`, `upstreamHelp` and `fqdn` verbatim (~25 lines,
      including the long split-LXC help string character for character), plus near-identical
      field markup. This is the mechanism behind F2. Extract `useRouteFields()` for the
      derivation + a `RouteFields` component for the three inputs; each modal keeps its own
      chrome and submit payload. **Do this immediately after F2, while the divergence is fresh**
- [ ] F9 `Routing.tsx:32` — a local `interface SettingsView { base_domain?: { value } }`
      shadows the exported one, and both back the same `["settings"]` query key, so two
      different types describe one cache entry. Import the real type, drop the local
- [ ] F10 `lib/api.ts` — `api.text()` has zero call sites and its comment names a Caddyfile
      export endpoint that does not exist. Delete it (the only genuine orphan export in the
      frontend)
- [ ] F11 — settings keys are enumerated in three places (`config.py`'s `Settings`,
      `settings.py`'s `CONFIGURABLE_KEYS`, the frontend `*_FIELDS` arrays). Forgetting the
      middle one silently makes a key env-only and unwritable from the UI, with no failing
      test and a symptom that looks like a frontend bug. Add a test asserting every
      `CONFIGURABLE_KEYS` entry is a real attribute of the `Settings` model
- [ ] ~~F8~~ (both route modals hand-roll chrome `Modal.tsx` provides — needs a size prop) and
      ~~F12~~ (`settings.value()`/`resolve()` re-read settings.json per key;
      `derive_caddy_host_ip()` reads it twice per assign and per health poll) — **out of scope**,
      revisit only if Stages A–C land early

**Stage D — housekeeping**
- [ ] D3 — commit the `Makefile` (currently untracked, so it helps one checkout and drifts
      from the two files that *are* read) and point README's Develop section at
      `make backend` / `make test-backend`, so the commands have one source of truth
- [ ] F16 — delete the six route handlers with no frontend caller: `GET /api/adguard/health`,
      `GET`/`POST`/`DELETE /api/adguard/rewrites`, `GET /api/caddy/health`,
      `GET /api/caddy/upstreams`, `GET /api/wireguard/status`, `GET /api/instances`.
      **⚠ Delete the HTTP route handlers ONLY — every underlying client method stays.**
      `client.upstreams()` feeds `upstream_healthy` in the routes table (`caddy/service.py:113`);
      `list_rewrites()` feeds reconcile (`adguard/service.py:210,236`) and export
      (`export.py:27`); `add_rewrite`/`delete_rewrite` feed assign (`assign.py:205,208,259`).
      Keep each module's `_health_payload` too — the aggregate `/api/health` registers it.
      No test references any of these routes, so the suite should be untouched. Remove their
      rows from `docs/api.md` in the same commit
- [ ] D1 — move completed Phases 1–13 out of `TODO.md` into `docs/todo-archive.md`, leaving
      Now/Next/Backlog plus any live phase. ~196KB across PLAN + HISTORY + TODO is read at every
      session start per CLAUDE.md, against that same file's "context fills fast" warning; this
      reclaims ~50KB, is fully reversible, and matches the tiered structure CLAUDE.md already
      describes. Leave a pointer line at the top of TODO.md. **`HISTORY.md` and `PLAN.md` are
      deliberately not touched** (decided 2026-08-27)

**Verification (each stage a commit that leaves the repo working)**
- [ ] Frontend: `tsc -b`, `oxlint`, `vite build`, `vitest run` — note the sandbox needs
      `export PATH="/home/sunde.guest/.local/node/bin:$PATH"` and direct entrypoints
      (`node ./node_modules/vitest/vitest.mjs run`), since the `.bin` shims are blocked
- [ ] Backend: `uv run pytest`. **The backend cannot be started in the sandbox**
      (`failed to canonicalize .../backend/.venv/bin/python3: Operation not permitted`), so
      anything needing a live API is a user smoke test, not a claim
- [ ] **Live smoke (user):** Add route rejects/normalises a typed capital (F2); a mistyped URL
      shows the NotFound pane (F3); Settings > General saves on blur with no Save button (F6);
      a deliberately corrupted `settings.json` refuses startup with the path in the message,
      and a corrupted `instances.json` boots with the bad row skipped (F5)

---

## Backlog / Future ideas
- **Real domain + DNS-01 wildcard** (e.g. `*.home.<owned-domain>`): publicly-trusted certs,
  zero cert install on any device, nothing exposed publicly (DNS-01 is outbound-only; the
  names resolve on the LAN via AdGuard rewrites). Dissolves Phase 12 entirely, including the
  whole onboarding page. **Not scheduled** — deliberate decision to keep the homelab off the
  owned domain for now. Precondition when revisited: DNS hosted somewhere with an API Caddy
  has a plugin for (one.com almost certainly isn't; a subdomain can be NS-delegated, or
  `_acme-challenge` CNAME'd to an acme-dns instance, without moving the registrar)
- Tier-3 integration rig + Forgejo CI (Phase 8b) — deferred by choice
- `CertStatus.tsx` cert expiry (Phase 3) — under the internal CA this is readable from
  Caddy's PKI endpoints; TLS probe stays the method-independent approach
