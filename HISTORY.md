# Loskai — History

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
- `check-docs.sh` clean. `pytest`/`npm test` **not run** — neither toolchain exists in the
  current sandbox (no `uv`, no venv, no npm). The stage executed no statement (compose, shell
  and docs, plus one comment in `config.py`), so no suite is implicated, but both are still
  unrun since Stage A
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
