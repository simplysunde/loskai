---
name: sweep
description: Loskai's whole-project simplification sweep, run by hand with /sweep — an honest read-only estimate of how much the backend, frontend, tests and docs could be simplified while keeping every function, then, on the go-ahead, bugs first and the restructuring area by area as a TODO phase, each step committed, tested and checked live. It reviews the entire codebase, so it is never started for a question about one part.
disable-model-invocation: true
---

# Sweep (Loskai)

A sweep answers "how much could Loskai be simplified while keeping everything it does?"
and then, if asked, does it. The first one (Phase 40, 2026-11-05) found the code already
lean — about 5–7% could go — and that the value was elsewhere: the dozen **decisions made in
two or more places**, which is CLAUDE.md's "each decision lives in one place" and the
pattern behind this project's worst bugs. Aim at those, not at the line count, and say so
in the estimate. Its write-up — what became one, what was left alone and why — is Phase 40
in `docs/project/todo-archive.md` and its entry in `docs/project/HISTORY.md`; the second
(Phase 46, 2026-11-13) is beside it. Read both before another, so it doesn't redo or undo them.

There are two stages, and the first changes nothing.

## Stage 1 — the estimate (read-only)

1. **Size it:** `wc -l` over `backend/src`, `backend/tests`, `frontend/src` (tests apart),
   `docs/`.
2. **Three reviewers in parallel**, read-only, launched together: backend
   (`backend/src/loskai/`), frontend (`frontend/src/`), and tests + docs + tooling
   (`backend/tests/`, the frontend tests, `docs/`, `CLAUDE.md`, `SECURITY.md`, `README.md`,
   `CHANGELOG.md`, `CONTRIBUTING.md`, `.env.example`, `scripts/check-docs.sh`, the compose
   files). Use the prompt at the end. Each reads
   CLAUDE.md first and skims HISTORY.md's headings.
3. **Verify every headline claim yourself** — a grep or a read — and mark which you
   checked. Reviewers overstate: in Phase 40 the "duplicate tests" each asserted something
   different, and were kept.
4. **Report and stop:** the answer in a paragraph; a table (area, lines now, could go,
   what it is); the changes worth making, each naming the decision it puts in one place;
   bugs found (marked checked); smaller things and Sunde's calls (migrations, `deploy.sh`'s
   old paths, schema options no recipe uses — changing `recipe-schema.md` touches the
   recipes repo too); what you advise against; the order; that nothing changed.

## Stage 2 — the sweep (after Sunde's go-ahead)

**Plan it as a TODO phase first**, in the shape the others have: `## Phase N — title`, a
short origin, **Decisions (date, Sunde: "…")** including what is left alone on purpose and
what is Sunde's call, then **Steps** as checkboxes, one per commit. Commit it before any
code. A sweep outlives a context window; the phase is what a resumed session reads.

**Bugs first**, one commit each with a regression test. Prove the test fails on the old
code: `git stash push <the src files>`, run it, `git stash pop`. A bug in route pushing,
compose runs or SSH is checked live before moving on.

**Then backend, frontend, tests, docs.** One logical change per commit; the full checks
before each commit (below); each area checked live before the next; the phase's boxes
ticked as steps land, with a "live:" line saying what was checked.

### How to restructure safely

- **One decision, one place:** add the shared piece, move every copy onto it, delete the
  copies; the commit says how many went. Keep CLAUDE.md's seams — `client.py` is I/O only,
  logic is pure, `assign.py` is where modules coordinate.
- **Read both copies before merging them.** Where they differ, one is usually wrong; write
  the test for the difference first. (Phase 40: the Settings fields' Escape saved the typed
  text, because `blur()` fires `onBlur` before the restored draft renders; the machine
  dialog's copy used a ref. One hook now.)
- **Don't unify what differs on purpose** — say why in the phase instead (the primary
  buttons' padding differs between a page header and a form).
- **Keep behaviour, and say when you didn't** (a wrong status code fixed by the merge).
- **Scripted edits**: assert the old text exists before replacing; then `npx tsc -b`,
  `npx oxlint src` and the tests find stragglers. Traps met in Phase 40: a module shadowed
  by a function of the same name (the SSH router's `terminal`), a local variable named like
  the new module (`override`), an import inserted after a *lazy* import inside a function,
  a `^`-anchored regex used with a start position, a pattern that also hit the next line.
- `uvx ruff check --select F401` is a one-off check for unused imports — the project
  doesn't use ruff, so don't add it.
- Removals: grep every use; npm for frontend dependencies; anything a deployed install
  still needs (migrations, old formats) only with Sunde's say-so.
- **Docs in the same commit as the behaviour** — CLAUDE.md's code map, `api.md`, the
  architecture page. `check-docs.sh` catches most of it.

### The checks (every commit)

```
cd backend && uv run pytest
cd frontend && npm test && npm run build && npx oxlint src
bash scripts/check-docs.sh
```

### Checking live

The suite mocks Caddy, Docker and SSH, so each area is checked against the real thing,
asserting the effect, not the response. Never against the repo's `data/` (live state).

- **A scratch backend** on `:8010`: build the frontend first, then run uvicorn with every
  setting given — `LOSKAI_DATA_DIR` and `STACKS_DIR` in the scratchpad, `LOSKAI_PASSWORD`,
  `BASE_DOMAIN`, `HOST_IP`, `CADDY_ADMIN_URL`, `ADGUARD_URL`,
  `LOSKAI_STATIC_DIR=<repo>/frontend/dist` — because `config.py` falls back to the repo's
  `.env`, which names real infrastructure. Stop it by the PID `ss -ltnp` shows.
- **Docker:** a scratch stack or recipe in the scratch stacks folder with a name no real
  stack has — a recipe named like a running project would take over its containers.
  Check `docker inspect` (env, mounts, ports), then `docker compose down`.
- **A machine over SSH:** a throwaway Debian container with sshd as the machine; set it up
  through the API (login, `POST /api/ssh/key`, `POST /api/machines` with `ssh`, scan,
  trust, install), then drive install, test, facts, a run's sudo password, a tool setting
  and the uninstall, and look on the machine (`authorized_keys`, `/etc/sudoers.d/`). An
  unlock lasts 15 minutes; a terminal that suddenly asks for a password is usually that.
- **Caddy:** the rig in `todo-archive.md` (Phase 16's Verification block) — Caddy alone as
  `-p loskai-smoke` from `compose.caddy-loskai.yml`, its admin API at its container
  address, `curl --resolve <name>:443:127.0.0.1` and the response **body**. Each scheme
  (`https`, `both`, `http`) and a delete. `down -v` afterwards.
- **The browser:** Playwright in the `mcr.microsoft.com/playwright` image with
  `--network host`. Every tab renders with no page errors; then the flows the area touched
  — dialogs and Escape, forms that submit, a failing action that says why. `make
  check-phone` covers every page and the main dialogs at phone widths
  (`docs/contributing/phone-layout.md`).
- **Sunde's `:8080`** runs `make live` from the working tree, so it reloads with every
  change: check it still renders at the end. A white page there is Vite holding an empty
  module after a rewrite — touch the file.

### Docs last

- Stale facts, each verified against the code.
- Finished phases from `TODO.md` to `todo-archive.md` (one with only an open live check
  left goes too, the check as a line under "Open, not in flight"), and CLAUDE.md's pointer
  to the archive updated.
- A "superseded by" line on each HISTORY entry a later one overturned without saying so.
- What no check can see (Phase 46): TODO.md's "Now:" line, counts written into the backlog,
  and a phase's own decisions walked back later.
- Live, look at what the suite fakes: Phase 46 found AdGuard keeps a duplicate rewrite, which
  every fake client had hidden.
- Teach `check-docs.sh` the class of drift found, and prove it by breaking it once.
- The HISTORY entry: why the sweep aimed where it did, what became one, what was
  deliberately not done, what is Sunde's call.

### Finish

All checks with their output, `:8080` checked, the rigs torn down. Report: bugs fixed, what
became one, checked live, not done on purpose, Sunde's calls, anything visible or in the
API that changed, and how many commits are unpushed. Don't push without being asked.

## Reviewer prompt

```
READ-ONLY audit. Do not edit, create or commit any files in <repo>, and run nothing that
changes state.

Context: <repo> is Loskai, a homelab control panel. <AREA> is <path> (<N> lines). Read
<repo>/CLAUDE.md first — its principles are the yardstick: simple and functional; each
decision lives in one place; removal is an option; client.py is I/O only, logic is pure.
Skim docs/project/HISTORY.md's headings so you don't propose reversing a walk-back.

Question: if we did a complete sweep of the <AREA>, how much could be simplified and
restructured to make better design decisions while keeping all functionality exactly as is?

Read it thoroughly, the biggest files especially: <list>. Look for one decision made in two
or more places, dead code and leftovers of removed features, needless indirection or
god-files, inconsistent patterns between modules, breaks of the seams above, and places
where a better design clearly exists. <For docs: stale statements — verify each against the
code — and the same fact written in several places.>

For each finding: file:line, what, the proposed change, estimated lines saved (or
"restructure, ~0 net"), risk (low/med/high). Rank by value. Say so where it is already lean.
List bugs found along the way separately. Finish with an overall estimate and the 3–5
changes that matter most. Under ~900 words.
```
