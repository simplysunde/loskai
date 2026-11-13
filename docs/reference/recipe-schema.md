[Docs](../README.md) › [Reference](../README.md#reference)

# Install-Wizard Recipe Schema

**Read this when** you are writing a recipe for the install wizard.

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

One folder per recipe. The folder name is the recipe's stable id. **Every folder at the top
of a source is read as a recipe**, except one whose name starts with `.` (a synced repo's
`.git`) — so keep anything else in a recipes repo (a README, docs) as files at its root, or
it is listed as a skipped recipe.

```
grafana/
  recipe.yml       # the manifest — described below
  compose.yml      # a real, standalone compose file (native ${VAR} interpolation) — or compose.yaml
  instructions.md  # guided walk-through text, shown in the wizard (Markdown)
  icon.png         # optional — the recipe's icon (see below)
```

- **`compose.yml`** is a genuine compose file — directly `docker compose up`-testable and
  SSH-editable. It uses standard `${VAR}` interpolation; it is **not** embedded in the
  manifest (it is itself YAML — keeping it separate preserves tooling). It must **not**
  set a top-level `name:`: the recipe folder names the compose project, and the install
  finds its container by that name — a recipe that sets one is listed as skipped.
- **`instructions.md`** is displayed as-is. It is never executed.
- **`icon.png`** is optional. The wizard shows it beside the recipe, and the install gives
  it to the route it creates, so the dashboard card and the Routing row have it without an
  upload. A route added later for the stack's container — after its route was deleted, or
  for a stack moved in by hand under the recipe's name — gets it the same way. A reinstall
  adds it only to a route that has no icon — one chosen by hand is never replaced, and an
  edit never brings back one that was removed. It must be a real PNG (checked by its bytes, not its name) of at most 512 KB:
  the same rules as an uploaded icon, because it ends up served from Loskai's own origin.
  **SVG is not accepted** — an SVG can carry a script. Square, at least 128 px, on a
  transparent background reads best on both themes. A brand's logo is its owner's
  trademark; use it unaltered, to identify the software the recipe installs.
- **There is no `.env` in the folder.** The `.env` is *generated* at install time from the
  user's wizard answers (see below), because it holds per-install values and secrets.

---

## `recipe.yml` — the manifest

```yaml
name: Grafana                    # required — display name
type: pull                       # required — always pull
description: Dashboards and observability   # optional — one-line summary

# The questions the wizard asks. Each becomes a form field, and together they
# generate the .env at install time. Keys should match the ${VAR} names in compose.yml.
env:                             # optional (omit if the compose needs no variables)
  - key: PORT                    # required — the .env / ${VAR} name
    label: Host port             # required — human prompt shown in the wizard
    default: "3000"              # optional — pre-filled value
  - key: MEDIA_PATH
    label: Where is your media library?
    type: path                   # optional — a host folder to mount; see "Mounting host folders"
  - key: GF_SECURITY_ADMIN_PASSWORD
    label: Admin password
    secret: true                 # optional — renders as a password field, never logged

mounts:                          # optional — folders the user adds at install; see "Folders the user adds"
  label: Media folders
  target: /media
  read_only: true

suggested_subdomain: grafana     # optional — pre-fills the Assign-URL step
service: web                     # optional — which compose service is the published one
log_link: https://login.example.com/   # optional — a link the app logs after install, shown on the last step

# Type-specific fields:
```

### Fields

| Field | Required | Applies to | Meaning |
|---|---|---|---|
| `name` | ✅ | all | Display name in the wizard. Text — quote one YAML would read as a number (`name: "2048"`). |
| `type` | ✅ | all | Install pattern — see below. |
| `description` | — | all | One-line summary for the recipe list. |
| `env` | — | all | List of values the wizard asks for; each generates one `.env` line. Omit if the compose needs no variables. |
| `env[].key` | ✅ | — | The `.env` / `${VAR}` name. Must be a variable name: letters, digits and `_`, not starting with a digit. Should match a `${VAR}` in `compose.yml` and appear once — neither is checked. |
| `env[].label` | ✅ | — | The prompt shown to the user. |
| `env[].default` | — | — | Pre-filled value. |
| `env[].secret` | — | — | `true` → password field, value never logged. Defaults `false`. |
| `env[].type` | — | — | `text` (default) or `path` — a host folder mounted into the container. A `path` answer is **required** and checked (below); the wizard shows where it lands. |
| `mounts` | — | all | Folders the user adds at install, however many — see [Folders the user adds](#folders-the-user-adds--mounts). |
| `mounts.label` | ✅ | — | The heading over the folder rows. |
| `mounts.target` | ✅ | — | Absolute container path; each folder lands at `target/<its name>`. |
| `mounts.read_only` | — | — | Defaults `true`. One setting for every folder. |
| `options` | — | all | Features the user switches on — a GPU, a USB device, an extra port — see [Options](#options--features-the-user-switches-on). |
| `options[].id` | ✅ | — | Lowercase letters, digits, `-` and `_`; unique in the recipe. |
| `options[].label` | ✅ | — | The checkbox's text. |
| `options[].help` | — | — | One line under it: what happens without it, what the host needs, what to do after. |
| `options[].service` | — | — | The compose service it is for; defaults to the recipe's `service`, or its only one. |
| `options[].set` | ✅ | — | The lines it adds: `devices`, `group_add`, `environment`, `cap_add` or `ports`, each a list — or `deploy`, a mapping, for a GPU reservation. |
| `suggested_subdomain` | — | all | Pre-fills the optional Caddy/AdGuard assign step. |
| `service` | — | all | Which compose service is the published one, for a multi-service recipe (app + database). Only affects which container the new instance links to — see below. Omit for a single-service recipe. |
| `log_link` | — | all | Where a link the app writes to its log points — a login it waits for, like Tailscale's. The wizard's last step follows the installed container's logs and shows the newest link starting with it, so the user needn't open the logs. An `https://` address with a host and a path (`https://login.example.com/`): a link on any other site is never shown. Say what it is for in `instructions.md`. |

### `type` — the install pattern

`pull`, the only one: Loskai runs `docker compose up -d`, pulling a pre-built image. An
image from a private registry works too, once the Docker host has run `docker login` for
it — Loskai stores no registry credential. (`git_build` and `registry_pull` were dropped
on 2026-11-13, never having been used by a recipe.)

---

## How `.env` is produced

The `.env` never lives in the repo. At install time Loskai:

1. Renders a form from `env`, with the user's answers (defaults pre-filled).
2. Builds the value set **on the server**, from the manifest rather than from whatever the
   client sent: every declared key, in manifest order — the answer where one was given (an
   empty one too: clearing a pre-filled field is kept), else the `default`, else empty. A
   key the manifest does not declare is **refused** (`400`), before anything touches disk.
3. Writes each value **double-quoted, with `\`, `"`, `$`, newlines and carriage returns
   escaped**, into a `.env` in the new stack directory.
4. Runs the `type`'s command. `docker compose` substitutes every `${VAR}` in `compose.yml`
   from that `.env` automatically — so there is **no templating engine**, and `compose.yml`
   stays a real compose file.

Steps 2 and 3 exist because Compose reads a `.env` as more than a list of strings, and every
way it can go wrong **succeeds** — `up` exits 0 and the app simply has a different value:

| Written verbatim | What the container got |
|---|---|
| `pa$word1` | `pa` — `$word1` interpolated as an unset variable |
| `correct horse #battery` | `correct horse` — the rest read as a comment |
| a value containing a newline | a second `KEY=` line; `COMPOSE_PROJECT_NAME` there re-points the project |
| an omitted key (API caller) | a blank variable — `"${PORT}:80"` published on a random host port |

Single quotes would fix the first two but cannot hold a `'`; double quotes with those
escapes round-trip everything. Checked against a real container's environment on
2026-10-03.

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
3. the only service that **publishes ports** (a database usually publishes none),
4. alphabetically among those that publish — or among all, when none does — a stable
   answer rather than whatever the daemon listed first.

If the command fails, or no container can be identified, **no instance is written**: a
guessed link would sit in the list as a second, dead record beside the one the Routing
tab's Add route picker creates correctly. The wizard says so, and the container (which
exists either way) is routable from that picker.

**Installing again.** Keep data beside the compose file (`./data`) — a stack's Delete keeps
everything but `compose.yml`, its override, `.env` and `.loskai-recipe.json` unless told
otherwise, and installing the same recipe again reuses that folder, data and all (the wizard
says it did). The record is kept
too: a reinstall re-points the earlier install's instance at the new container and leaves
its route, icon and private flag alone. Because a route's id is its prefix, the recipe's id
can already belong to something else — an external route, or a route to another container
that's still running — and the install refuses rather than overwrite it.

---

## Mounting host folders — `type: path`

Three kinds of data, three ways to mount them:

| Data | How | Example |
|---|---|---|
| **The service's own state** — config, database | a relative path beside the compose file, fixed in `compose.yml` | `./data:/app/data` |
| **Data it uses but doesn't own** — media, photos on a big disk, a NAS share | a `type: path` question, mounted `:ro` when the app only reads | `${MEDIA_PATH}:/media:ro` |
| **…when the user has any number of them** — music, movies, anime | a `mounts` block (below) | `/media/anime`, `/media/music` |
| **Caches** that are safe to lose | a named volume | `model-cache:/cache` |

State lives in the stack's own folder, so a service is one folder you can see, back up and
move — and a stack's Delete keeps everything but `compose.yml`, its override, `.env` and
`.loskai-recipe.json` unless told otherwise. When a service's own state can be large (a
photo library), ask for it with a relative default — `${UPLOAD_LOCATION:-./library}` and
`default: ./library` — so it lands in the stack folder unless pointed at a bigger disk.

A `type: path` answer is trimmed, then refused when Compose would accept it and mount the
wrong thing:

- **`~`** — `docker compose` runs inside Loskai's container, as root, so `~` is `/root` there,
  not your home. Write the full path.
- **A bare name** (`data`) — to Compose that is a *named volume*, not a folder. A relative
  path starts with `./` or `../`.
- **A `:`** — it would split the `source:target` spec.

An absolute path is on the Docker host and Loskai never deletes it; if it doesn't exist,
Docker creates it, owned by root. There is no "create these folders first" field — the old
`directories:` made them inside Loskai's own container, invisible to the host, and a
manifest that still has it is rejected with a pointer here.

---

## Folders the user adds — `mounts`

A `path` question asks for exactly one folder. A media server, a book library or a backup
tool takes as many as the user happens to have — one per library — and no recipe can guess
how many, or what they are called. `mounts` lets the user add them in the wizard instead:

```yaml
mounts:
  label: Media folders     # the heading over the rows
  target: /media           # each folder lands at /media/<its name>
  read_only: true          # the default; one setting for every folder
```

The user adds rows — `/srv/media/anime`, `/srv/media/music` — and each shows where it lands
(`→ /media/anime`). Inside the app, they then pick those as libraries. Adding none is fine.

Loskai writes them into a **`compose.override.yml`** beside the recipe's `compose.yml`, which
Compose merges in by itself — the recipe's own file is never rewritten. The file starts with
a comment saying it is the user's, and a `$` in a path is written `$$`, since Compose
interpolates the override too:

```yaml
services:
  jellyfin:
    volumes:
      - type: bind
        source: /srv/media/anime
        target: /media/anime
        read_only: true
        bind:
          create_host_path: false
```

**A folder that doesn't exist fails the deploy** (`bind source path does not exist`), rather
than being created. The short form (`/srv/media/anime:/media/anime`) has Docker create a
mistyped folder — empty, root-owned — and the install succeeds with an empty library.

Each folder gets the `path` checks above, and two more: a folder must have a name of its own
(not `/`), and two folders whose last names match (`/disk1/anime`, `/disk2/anime`) are
refused, since both would land at one place — rename one, or mount their parent.

Where they go: the recipe's `service`, or its only service. A multi-service recipe with
`mounts` must name its `service`.

The override is configuration, not data: a stack's Delete removes it with `compose.yml`, and
installing again writes it from the new rows and options — or removes one left in the folder
when there are none. After install it is the user's: the stack editor
edits it (Folders on its form, or the file as text), and an
[update](#updating-an-installed-recipe) never touches it.

**Where this stops.** One group of folders per recipe, mounted into one service, all
read-only or all writable, each at `target/<name>`. A recipe that needs more — two groups,
or the same folder in several containers at matching paths (Sonarr and its downloader) —
asks with fixed `type: path` questions instead. Past these limits it is a volume editor.

---

## Options — features the user switches on

Some features need something only some hosts have: a GPU for transcoding, a USB stick for a
Zigbee bridge. Put in `compose.yml`, a device the host lacks stops the container from
starting; left to the user, it is YAML pasted into the override by hand. An **option** is the
recipe saying it once:

```yaml
options:
  - id: hwaccel
    label: Hardware transcoding (Intel/AMD)
    help: Without it, Jellyfin transcodes on the CPU. Tick it only if the Docker host has /dev/dri/renderD128, or Jellyfin won't start.
    set:
      devices:
        - /dev/dri:/dev/dri
```

Each is a checkbox — in the wizard, and in the stack's Edit form — **off by default**. On adds
exactly the lines under `set` to that service in `compose.override.yml`; off removes exactly
those, and nothing else in the file changes. **Whether it is on is read from the override**,
not stored: a stack where the user pasted the same lines by hand shows it ticked.

`set` takes only keys that *add* to a service — `devices`, `group_add`, `environment` (the
`- KEY=value` list form), `cap_add`, `ports` — each a list, and `deploy`, a mapping, for an
NVIDIA GPU, which Docker hands over as a reservation rather than a device:

```yaml
  - id: nvidia
    label: Hardware transcoding (NVIDIA)
    set:
      deploy:
        resources:
          reservations:
            devices:
              - driver: nvidia
                count: all
                capabilities: [gpu]
```

Lists gain the items they lack and lose exactly those; a mapping is merged key by key, so a
`deploy.resources.limits` the user set stays. A value already set to something else is
refused, never overwritten. Anything that would replace what the recipe set up (`image`,
`volumes`, `command`) is refused: an option extends the app, it doesn't swap it.

Since the lines live in the user's override, an [update](#updating-an-installed-recipe) never
touches them. Changing an option's `set` in a later version leaves installed stacks with the
old lines, now unticked — say so in the commit message, or add the change as a new id.

## Telling Loskai the port — `loskai.port`

Routing a container needs its port, and Docker can report one only when the container
publishes exactly one. Two common recipe shapes leave it guessing:

- **Host networking** (`network_mode: host`) publishes nothing at all — the app binds its port
  in the host's own namespace, and only its own config knows which.
- **Several published ports** — Docker can't choose which one is the web interface.

Label the service with the port it listens on, **as the container sees it**:

```yaml
services:
  app:
    labels:
      loskai.port: "${PORT:-8000}"
```

Loskai resolves it to whatever Caddy dials — the published host port for it, the port itself
under host networking, `service:port` on a shared network. Because Compose interpolates
labels, writing it from the same variable the app reads keeps the two in step: change `PORT`,
re-up, and the label moves with it. With the label, the route form fills the whole address,
and a route that follows its container (the default) is rewritten when the port changes. An
invalid value is ignored, not trusted.

---

## Updating an installed recipe

An install records where it came from in `.loskai-recipe.json` beside the compose file — the
recipe id, its source and commit, and a fingerprint of the `compose.yml` it wrote. **Check for
updates** on the Docker tab compares that with the recipe now, and **Update** replaces the
stack's `compose.yml` with the recipe's. Each file has one owner:

| File | Owner | An update |
|---|---|---|
| `compose.yml` | the recipe | replaces it |
| `.env` | the user's answers | keeps every line; adds one for a new question, with its default |
| `compose.override.yml` | the user | never touches it |

A `compose.yml` changed by hand is replaced too: Check for updates offers it all the same
(with a note that updating replaces it), as it does one installed before installs were
recorded. A change of your own belongs in the override.

**A new version is a commit to the recipe's folder** — raise the image tag. The dialog shows
the folder's commit messages since the install beside the diff, so write the message for
someone running the app: what changes for them, a migration that can't be undone, a backup to
take first. Trailers (`Co-Authored-By:`) are left out.

**Within one recipe id, keep what an installed stack hangs on:**

- the service names — an override names them;
- the `mounts` target and the data folders (`./config`) — the user's data is there;
- the `.env` keys — add a new one with a `default`. One without a default can't be added by
  an update; the dialog says to reinstall.

Changing one of these is a new recipe id, or a commit message that says what to change by
hand. Either way, an update is refused before anything is written unless `docker compose
config` loads the new `compose.yml` with the stack's own override and `.env`.

## Validation

Loskai rejects a recipe (skips it, surfaces why) when:

- `recipe.yml` is missing, not valid YAML, or not a mapping.
- `name` or `type` is missing, `name` isn't text, or `type` isn't `pull`.
- an `env` entry is missing `key` or `label`.
- `service` is present but is not a string.
- an `env` entry's `type` is not `text` or `path`, or a `path` default is one of the cases
  above.
- `directories` is present — it was removed; use a `type: path` entry.
- `mounts` is not a mapping, has no `label`, has a `target` that isn't an absolute container
  path (or is `/`, or holds a `:`), or a `read_only` that isn't `true`/`false`.
- `mounts` or `options` are present and the service they go into isn't one in
  `compose.yml`: an option's own `service`, else the recipe's `service`, else its only
  service — so a multi-service recipe must name one. Without `mounts` or `options`,
  `service` isn't checked against `compose.yml`.
- an `env` key is not a variable name (a space, `=` or newline would split or merge lines in
  the generated `.env`).
- `options` is not a list, or an entry isn't a mapping, has no valid `id` (or repeats one),
  no `label`, a `help` or `service` that isn't text, no `set` (or an empty one), a `set` key
  outside `devices`/`group_add`/`environment`/`cap_add`/`ports`/`deploy`, a list key whose
  value isn't a non-empty list of strings or numbers (so `environment` as a mapping is
  refused), or a `deploy` that isn't a non-empty mapping.
- there is no `compose.yml` (or `compose.yaml`).
- `compose.yml` sets a top-level `name:`.
- `icon.png` is present but is not a PNG, or is larger than 512 KB.

Validation never runs recipe content — it only parses and checks fields. A rejected recipe
affects nothing else; the rest of the list still loads.

**Check a recipe before pushing it** with the same validator, from a loskai checkout:

```
uv run --project <loskai>/backend python -m loskai.modules.docker.check_recipes [path ...]
```

A path holding a `recipe.yml` is one recipe; any other is scanned as a source, so run from
the recipes repo it checks every recipe in it; with no path it checks the current folder. It
prints the reason each one would be skipped, and exits 1 if any would be or it finds no
recipe at all, 2 when a path isn't a folder. It reads files only — no Docker, nothing
written.

---

## Not the recipe path — the raw stack

If you already have a finished `compose.yml` and `.env` and just want to run them, you do
**not** need a recipe. The Stack Manager's manual "create a stack" takes a `compose.yml` +
`.env` directly and runs `up` — no manifest, no wizard prompts. Bind-mount source
directories are auto-created by Docker on `up`. Use a recipe when you want a *reusable,
parameterized* install; use the raw path for a one-off.
