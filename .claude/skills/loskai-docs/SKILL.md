---
name: loskai-docs
description: How Loskai's user pages (README.md, docs/guides/) are written, and how one is rewritten with /loskai-docs. Use when writing or changing a user page, including the doc update that goes with a change in behaviour.
---

# Docs (Loskai)

Loskai's docs serve two readers. **User pages** are for someone running Loskai: what to
do, what they will see, what to do when it goes wrong. **Agent docs** are for whoever
changes the code, often an agent: how it works, the contracts, and why. User pages are
*task-first* and short; agent docs stay as dense as they need to be.

| User pages | Agent docs |
|---|---|
| `README.md` | `CLAUDE.md` |
| `docs/guides/` — every page there | `docs/project/architecture.md` — how and why it is built |
| | `docs/reference/` — the contracts |
| | `docs/contributing/` — how to change and release it |
| | `docs/project/HISTORY.md` — each decision and its reason, dated |

`docs/README.md`'s Conventions still hold for every page (breadcrumb, `Read this when`,
one fact in one place), and `bash scripts/check-docs.sh` checks them.

## Writing a user page

Task-first means:

- **A section is a task, titled as one:** "Add a route", "Trust the certificate on a phone".
- **Steps are numbered, one action each, and end on what the reader sees**: "The Caddy row
  says **online**." That line is how they know the step worked.
- **What to do when it doesn't work** sits at the step it belongs to, in a sentence, or as
  a link to the right section of `troubleshooting.md`.
- **The app's own words, in bold, exactly as on screen**: **Add route**, Settings ›
  **Network**. Check each against `frontend/src` before writing it.
- **Name only what the reader sees, types or edits**: buttons, fields, commands, the files
  they write (`.env`, `compose.override.yml`). The code's names (functions, JSON fields,
  source paths) belong to the agent docs.
- **One reason at most, in a clause, when the reader needs it to act**: "free port 53 first,
  since AdGuard answers DNS there". The full why goes to the agent docs.
- **Short sentences, plain words.** A term the reader may not know is explained once, where
  it first appears, or links to where it is.
- **As long as the task needs and no longer.** A fact another page owns is a link to it.

## Rewriting a page

Run by hand, one page per pass. A whole-docs rewrite is not done in one go: facts drop out
silently, and the docs check cannot see a lost step or caveat.

**Plan first.** The first pass adds a TODO phase in the shape the others have (origin,
**Decisions** with Sunde's words, **Steps** with one checkbox per page) and commits it. Later
passes tick their page. Order: `install.md` (the page every new user follows), then
`using-loskai.md`, `troubleshooting.md`, `certificate-setup.md`, `tailscale.md`,
`migration.md`, `topologies.md`, `deployment.md`, `backend-certificates.md`.

For the page in hand:

1. **Inventory.** Number every fact, instruction, caveat, example and link on the page. Its
   completion criterion is that the list covers the whole page, top to bottom.
2. **Give each item a fate:**
   - **keep**: the reader needs it to do the task;
   - **move**: it is how or why. Name its target: `architecture.md`'s section on that
     component, a `HISTORY.md` entry (dated, newest first) for a decision and its reason,
     `docs/reference/` for a contract, `docs/contributing/` for maintainer how-to. When the
     target already says it, the move is a deletion, and the item names where it lives;
   - **drop**: it no longer matches the code. Say how you checked.
3. **Verify every kept item** against the code and the running app: labels in
   `frontend/src`, settings and env vars in `config.py` and `shared/settings.py`, defaults,
   commands, file names. Each item you cannot verify goes to Sunde as a question; it stays
   out of the page until answered.
4. **Write the page** task-first, and the moved items into their targets, in the same commit.
5. **Check:**
   - every inventory item has its fate, and every **move** is in its target;
   - `bash scripts/check-docs.sh` is **Docs OK**. It catches a link to a heading this page
     no longer has; fix the linking page, or keep the heading;
   - a page that is a procedure is followed for real: the install guide on a machine that
     has never had Loskai (`docs/contributing/releasing.md`, step 5), the others against
     `:8080` or a scratch backend. Every screen, button and message it names is there.
6. **Commit** the page alone, its fates in the body (`moved: … → architecture.md#…`,
   `dropped: … (the setting was removed)`). Tick its box in the phase.
7. **Show Sunde the page** and wait for the go-ahead before the next one.

## Finish

Report the page's length before and after, the moves and drops, the questions for Sunde,
the checks with their output, and the commits not yet pushed. Pushing is Sunde's call.
