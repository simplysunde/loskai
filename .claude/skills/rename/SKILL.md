---
name: rename
description: Loskai's whole-project naming audit, run by hand with /rename — a read-only inventory of the function, variable, constant and type names in the backend and frontend that don't say what they are, with a proposed convention and glossary; then, on the go-ahead, pure renames area by area as a TODO phase, in a separate worktree, each commit proven to change no behaviour, contract or stored format. It reads the whole codebase, so it is never started for one name.
disable-model-invocation: true
---

# Rename (Loskai)

The rename pass makes a name say what the thing is, so a reader of either side of the app
recognises it without opening the definition. It is a **pure rename**: every commit
changes names and nothing else — no behaviour, no wording on the page, no API, no stored
format, nothing a machine has installed. Sunde is happy with how the app works; the pass
succeeds only if it still works exactly that way.

CLAUDE.md is the yardstick: "it's tidier" is not a reason. A rename earns its place when
the old name misleads, is unreadable out of context (`t`, `m`, `_dial`, `offWhy`), or calls
one concept two things. A name that is already clear stays, even if you'd have picked
another — every rename costs a diff, `git blame`, and the HISTORY entries that cite the old
name. Say in the estimate how many names are fine as they are.

Read `.claude/skills/sweep/SKILL.md` too: its traps, checks and "Checking live" section
apply here unchanged, and are not repeated.

## What is never renamed — the contracts

These are names something outside the source depends on. Changing one breaks a stored
file, an installed machine, a bookmark or the other half of the app, while every test
still passes. Find each in Stage 1 and list it in the phase as off-limits.

- **The API.** Route paths, query parameters, and every JSON field a router returns or
  accepts — Pydantic model fields, the dict keys a router builds. In the frontend, **a
  snake_case name is an API field** (the frontend's own names never are); `lib/api.ts`'s
  types mirror the backend. The *variable* holding a value may be renamed; the field may not.
- **Stored state.** The fields of `instances.json`, `settings.json`, `users.json`,
  `data/ssh/unlocks.json`, a stack's `.loskai-recipe.json`; the settings keys and
  `config.py`'s attributes (`shared/settings.py` reads the env by attribute name, and each
  is an env var in `.env.example` and on real installs).
- **What machines hold.** `status.STATUS_COMMAND` (the forced command each machine has in
  `authorized_keys` — its text, shell variables, section names and output), the sudo rule
  (`logic.SUDO_RULE` and the file `tool.py` writes), every file in `modules/ssh/tools/`
  (ids, keys, action names, the shell in them), the `#loskai-…` markers and `(loskai: …)`
  key comments, and the entries Loskai edits in `~/.ssh/config` and `known_hosts`.
- **Recipes.** `recipe-schema.md` and what `manifest.py` reads — the recipes repo uses them.
- **The other services.** Caddy route `@id`s, AdGuard rewrites, Docker labels and compose
  project names.
- **The browser.** `localStorage` key *values* (`loskai-theme`, `loskai-sidebar`,
  `loskai-recent-hosts`) and the page's URL paths. A constant's name may change; its value
  may not.
- **Anything a person types or reads:** env vars, Makefile targets, script names, the UI's
  text and tooltips, log lines.

A Python function named exactly like a field (`suggested_upstream` is both) is the trap:
rename the function, never the string. `scripts/where-used.py` treats such a string as a
use, so check what it reports.

## Stage 1 — the inventory (read-only)

Change nothing, and make no worktree yet.

1. **Size it:** `wc -l` over `backend/src`, `frontend/src` (tests apart), the tests.
2. **The glossary first.** List the domain's concepts and the word each side uses: machine,
   instance, route, link, service, stack, recipe, source, the main key, the status key,
   tool, action, setting, unlock, facts, overview… Where one concept has two names, or one
   name two concepts, say so. The API field name wins where there is one, and the words
   CLAUDE.md and `architecture.md` use win over new ones: the docs teach those.
3. **The convention.** Propose a short one for both sides, beginning from the languages'
   own: Python snake_case, `_private`, UPPER constants; TypeScript camelCase, PascalCase
   components and types, `use…` hooks. Then the project's: functions are verbs or say what
   they return, booleans read as a question (`is`/`has`/`can`), one-letter names only in a
   scope of a few lines (a loop, a lambda, a comprehension), abbreviations only where
   universal (`id`, `url`, `ssh`). Note where the code has its own settled habit (`…Of`
   for "the … of a thing") and propose keeping or replacing it once, not name by name.
4. **Reviewers in parallel**, read-only, launched together: backend, frontend, tests. Use
   the prompt at the end. **Verify every proposal yourself** — open the definition and
   its uses; a name that looks cryptic is often explained by its comment, and a "better"
   name can be wrong about what the thing does.
5. **Report and stop:** the glossary; the convention; the renames grouped by area, each
   as `old → new`, why, the number of references, and risk; the contracts confirmed
   off-limits; the names that looked bad but stay, and why; Sunde's calls (any rename of a
   documented term, any test name). Nothing changed.

## Stage 2 — the renames (after Sunde's go-ahead)

**Plan it as a TODO phase first**, in the shape the others have — origin, **Decisions**
(date, Sunde: "…") with the glossary, the convention and the off-limits list, then
**Steps** as checkboxes, one per commit. Commit it on `main` before any code. The pass
outlives a context window; the phase is what a resumed session reads.

### Work in a worktree — never in the main checkout

`:8080` is Sunde's real homelab Loskai, running `make dev` from `/home/vm/loskai`: it
reloads on every save, so a half-done rename there takes the live page and backend down.

```
git worktree add ../loskai-rename -b rename
cd ../loskai-rename/backend && uv sync
cd ../frontend && npm ci
```

(`../loskai-recipes` is beside it there too, so the docs check still compares the schema.)
All edits, checks and commits happen in the worktree. When a group of steps is done and
Sunde says so, bring it to `main` with `git -C /home/vm/loskai merge --ff-only rename`,
check `:8080` renders and read the dev log (`sg docker -c "docker logs --since 5m
loskai"`, asyncssh's command lines filtered out). Never restart the container. Remove the
worktree at the end (`git worktree remove ../loskai-rename`, then `git branch -d rename`).

### One commit at a time

- **One area or one concept per commit**, renames only — a fix or tidy found on the way is
  noted in the phase, not mixed in. Message: `Rename: <area>` and the `old → new` list in
  the body. No AI attribution, never `--no-verify`, never push.
- **Find every reference before editing**, word-bounded (`grep -rnw`): definitions,
  imports and re-exports, `module.name`, lazy imports inside functions, strings that name
  it (`monkeypatch.setattr(obj, "name", …)`, `vi.mock` factories whose keys are export
  names), comments, and the docs. Assert the old text is there before a scripted replace;
  then grep again for the old name — zero hits outside history, or each one explained.
- **Collisions:** a new name must not shadow a module, an import or a local in any scope
  it reaches (sweep's traps: the SSH router's `terminal`, a local named like a module).
- **Python has no type checker here**, so after each Python batch run the one-off
  `uvx ruff check --select F401,F811,F821 backend/src backend/tests` (unused, redefined,
  undefined) — compare against `main`'s output; don't add ruff to the project.
  TypeScript's `npm run build` (`tsc -b`, tests included) finds the frontend's stragglers.
- **Traps met in Phase 57** (2026-11-14), each a rename that changed behaviour while the
  build passed:
  - **A prop passed through an untyped object.** Test helpers spread `overrides = {}` into
    a component (`renderModal({ mode: "docker" })`): neither `tsc` nor the language service
    sees the key. One test failed; three kept passing with the prop ignored. After renaming
    a prop, grep the tests for `<old>:`.
  - **A test helper named like the source function it wraps.** `test_assign.py`'s
    `name_machine` beside `assign.name_machine`: renaming the helper by token took the nine
    real calls with it. Rename the bare name only (`^old=new`), then look at every hit.
  - **A new name already in scope.** `s` → `stack` where `stack` was a parameter. The
    language service renames into a collision without a word; compare
    `npx oxlint -D no-shadow src` against `main` after a batch.
  - **A handler's docstring is in the OpenAPI document**, as is its name (the summary), so
    the API guard strips both along with the `operationId`.
  - **Rename identifiers, never text:** Python by token (`tokenize`), so no string can
    change; TypeScript by the language service's rename with
    `providePrefixAndSuffixTextForRename`, which keeps a shorthand property as `old: new`.
    Two more guards follow from that and caught the most: every backend string literal that
    isn't a docstring, and every frontend string, JSX text and property name, unchanged.

### The guards — every commit, against `main`

A pure rename leaves these identical. Save each on `main` once, before the first rename,
in the scratchpad, and diff after each commit; any difference stops the pass until it is
explained.

1. **The API:** `app.openapi()` dumped as sorted JSON with every `operationId` removed
   (FastAPI builds those from function names; nothing reads them) — run with every env
   var set to a scratch value, never the repo's `.env`.
2. **The frontend's API fields:** the sorted set of snake_case words in `frontend/src`.
3. **What machines hold:** `git diff main -- backend/src/loskai/modules/ssh/tools/` is
   empty, and the sha256 of `status.STATUS_COMMAND`, `status.STATUS_LINE_VERSION`, the sudo rule's
   text and the `#loskai-` marker strings is unchanged.
4. **Stored names:** each Pydantic model's field list (`model_fields`), `config.py`'s
   settings, `STORED_ONLY_KEYS`, and every `"loskai-…"` string.
5. **The tests:** the same number pass, backend and frontend, as on `main` — a rename
   that silently drops a test (a pytest name no longer starting `test_`) shows here.

### The checks (every commit)

```
cd backend && uv run pytest
cd frontend && npm test && npm run build && npx oxlint src
bash scripts/check-docs.sh
python3 scripts/where-used.py --write   # then commit its change with the rename
```

### Checking live

After each area, sweep's "Checking live": a scratch backend on `:8010` with every setting
given, every tab renders with no page errors in Playwright, and the flows the area's names
run through (a machine's dialog and a tool run for `modules/ssh`, an install for `docker`,
a route for `assign`). Never against the repo's `data/`.

### Docs

- **In the same commit as the rename:** CLAUDE.md (its code map and the functions it
  names), `docs/project/architecture.md`, `docs/contributing/where-logic-lives.md`,
  `docs/reference/`, the guides, and code comments that name the old one.
- **`HISTORY.md`, `TODO.md`'s finished phases and `todo-archive.md` are records:** leave
  their old names. The pass's HISTORY entry carries the whole `old → new` table, so an
  older entry's name can still be followed to today's code.
- `CHANGELOG.md` gets nothing — no user sees a rename.

### Finish

All checks and guards with their output, `:8080` checked and its log clean, the rigs and
the worktree removed. Report Changed / Verified / Watch out for: the renames by area, the
names left alone on purpose, Sunde's calls, and how many commits are unpushed.

## Reviewer prompt

```
READ-ONLY audit. Do not edit, create or commit any files in <repo>, and run nothing that
changes state.

Context: <repo> is Loskai, a homelab control panel. <AREA> is <path> (<N> lines). Read
<repo>/CLAUDE.md and <repo>/.claude/skills/rename/SKILL.md first — the second lists the
names that are contracts and must never be renamed, and the convention proposed so far:
<convention>. Glossary so far: <glossary>.

Question: which function, variable, constant, parameter and type names in the <AREA> don't
say what they are — unreadable out of context, misleading about what the thing does or
returns, or one concept named differently from the rest of the code or the API?

Read the definitions and their uses, not just the names. For each finding: file:line, the
old name, a proposed name, why (what it misleads about), the number of references, and
risk (low: local; med: exported within one side; high: across modules or near a contract).
Never propose renaming a contract. List separately the concepts with two names, and names
that look cryptic but are explained in place and should stay. Say so where an area is
already clear. Rank by value. Under ~900 words.
```
