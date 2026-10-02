# Install-Wizard Recipe Schema

A **recipe** is the input to Loskai's Install Wizard: a declarative description of a
service to deploy. Loskai **validates and interprets** a recipe against the fixed schema
below — it never executes recipe-supplied code. A malformed recipe fails validation and is
skipped, so it can never push Loskai outside its known install paths.

Recipes are not baked into the image. They come from two kinds of source, scanned the same
way and merged into one list:

- **Git repos you own** — as many as you like, managed in **Settings › General › Recipe
  sources**: one row per repo, each independently enabled, each synced into its own cache
  in the state volume. Loskai ships with one **built-in default** source already in the
  list; it is an ordinary row, so it can be switched off or removed like any other.
- **A local directory** (`/data/recipes/`, in the state volume) — recipes you add by hand,
  for private or in-progress work. It is `data/recipes/` on the host with the shipped
  compose files, so dropping a folder in there needs no container access. It is always
  scanned and cannot be disabled — there is no URL to switch off.

**Priority is list order, and the local directory is always last.** The first source to
define a recipe id wins; a later copy of that id is **flagged** (`shadowed`, naming both
the copy that lost and the source that beat it), never silently dropped. To test a variant
of an existing recipe locally, give it a distinct name.

There is **no environment variable** for sources. The editor is the only place they are
set, so it is never read-only — recipe sources are never needed before the UI is reachable,
which is what the env layer exists for elsewhere.

A repo that fails to sync costs you that repo's recipes and nothing else: each source
reports separately and keeps whatever it last cloned.

This document is the contract. It is also what you hand to an AI coder (or write by hand)
to produce a valid recipe — no authoring UI exists or is needed.

---

## Folder layout

One folder per recipe. The folder name is the recipe's stable id.

```
grafana/
  recipe.yml       # the manifest — described below
  compose.yml      # a real, standalone compose file (native ${VAR} interpolation)
  instructions.md  # guided walk-through text, shown in the wizard (Markdown)
```

- **`compose.yml`** is a genuine compose file — directly `docker compose up`-testable and
  SSH-editable. It uses standard `${VAR}` interpolation; it is **not** embedded in the
  manifest (it is itself YAML — keeping it separate preserves tooling).
- **`instructions.md`** is displayed as-is. It is never executed.
- **There is no `.env` in the folder.** The `.env` is *generated* at install time from the
  user's wizard answers (see below), because it holds per-install values and secrets.

---

## `recipe.yml` — the manifest

```yaml
name: Grafana                    # required — display name
type: pull                       # required — pull | git_build | registry_pull
description: Dashboards and observability   # optional — one-line summary

# The questions the wizard asks. Each becomes a form field, and together they
# generate the .env at install time. Keys must match the ${VAR} names in compose.yml.
env:                             # optional (omit if the compose needs no variables)
  - key: PORT                    # required — the .env / ${VAR} name
    label: Host port             # required — human prompt shown in the wizard
    default: "3000"              # optional — pre-filled value
  - key: DATA_PATH
    label: Where should data be stored?
    default: /opt/appdata
  - key: GF_SECURITY_ADMIN_PASSWORD
    label: Admin password
    secret: true                 # optional — renders as a password field, never logged

suggested_subdomain: grafana     # optional — pre-fills the Assign-URL step
service: web                     # optional — which compose service is the published one

# Type-specific fields:
git_repo: https://github.com/you/app   # required for type: git_build only
```

### Fields

| Field | Required | Applies to | Meaning |
|---|---|---|---|
| `name` | ✅ | all | Display name in the wizard. |
| `type` | ✅ | all | Install pattern — see below. |
| `description` | — | all | One-line summary for the recipe list. |
| `env` | — | all | List of values the wizard asks for; each generates one `.env` line. Omit if the compose needs no variables. |
| `env[].key` | ✅ | — | The `.env` / `${VAR}` name. Must match a `${VAR}` in `compose.yml`. |
| `env[].label` | ✅ | — | The prompt shown to the user. |
| `env[].default` | — | — | Pre-filled value. |
| `env[].secret` | — | — | `true` → password field, value never logged. Defaults `false`. |
| `directories` | — | all | Host dirs to pre-create before `up`. **Usually omit** — Docker auto-creates bind-mount source directories on `up`. Only set this when you need a directory to exist ahead of the container (e.g. to drop a config file into it). May reference `${VAR}` from `env`. |
| `suggested_subdomain` | — | all | Pre-fills the optional Caddy/AdGuard assign step. |
| `service` | — | all | Which compose service is the published one, for a multi-service recipe (app + database). Only affects which container the new instance links to — see below. Omit for a single-service recipe. |
| `git_repo` | ✅ (git_build) | git_build | Repo to `git clone` before building. |

### `type` — the three install patterns

| `type` | What Loskai runs | Notes |
|---|---|---|
| `pull` | `docker compose up -d` | Pre-built public image. |
| `git_build` | `git clone <git_repo>` then `docker compose up -d --build` | Builds locally; needs `git_repo`. |
| `registry_pull` | `docker compose up -d` | Image lives in your private Gitea registry. **Registry auth is a host precondition** — run `docker login <gitea-registry>` once on the Docker host; Loskai stores no registry credential. |

---

## How `.env` is produced

The `.env` never lives in the repo. At install time Loskai:

1. Renders a form from `env`, with the user's answers (defaults pre-filled).
2. Writes those answers as `KEY=value` lines into a `.env` in the new stack directory.
3. Runs the `type`'s command. `docker compose` substitutes every `${VAR}` in `compose.yml`
   from that `.env` automatically — so there is **no templating engine**, and `compose.yml`
   stays a real compose file.

Because the `.env` holds secrets (any `secret: true` value), it exists only on disk in the
stack directory, never in version control.

---

## What the install links to

After the type's command succeeds, Loskai registers the new service as a `docker`
instance — and an instance links to its container **by container name**. Compose names
containers `<project>-<service>-1` unless the compose file pins `container_name`, so the
name is read back from the daemon rather than assumed from the recipe id.

For a multi-service recipe, the published service is chosen in this order:

1. the manifest's `service`, when it names a service that came up,
2. the only service, when there is one,
3. the service that **publishes ports** (a database usually publishes none),
4. alphabetically — a stable answer rather than whatever the daemon listed first.

If the command fails, or no container can be identified, **no instance is written**: a
guessed link would sit in the list as a second, dead record beside the one the Routing
tab's Add route picker creates correctly. The wizard says so, and the container (which
exists either way) is routable from that picker.

---

## Validation

Loskai rejects a recipe (skips it, surfaces why) when:

- `recipe.yml` is missing or not valid YAML.
- `name` or `type` is missing, or `type` is not one of the three values.
- `type: git_build` with no `git_repo`.
- an `env` entry is missing `key` or `label`.
- `service` is present but is not a string.
- `compose.yml` is missing.

Validation never runs recipe content — it only parses and checks fields. A rejected recipe
affects nothing else; the rest of the list still loads.

---

## Not the recipe path — the raw stack

If you already have a finished `compose.yml` and `.env` and just want to run them, you do
**not** need a recipe. The Stack Manager's manual "create a stack" takes a `compose.yml` +
`.env` directly and runs `up` — no manifest, no wizard prompts. Bind-mount source
directories are auto-created by Docker on `up`. Use a recipe when you want a *reusable,
parameterized* install; use the raw path for a one-off.
