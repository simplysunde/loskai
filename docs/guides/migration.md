[Docs](../README.md) › [Guides](../README.md#guides)

# Bringing Your Existing Containers into Loskai

**Read this when** you already run containers on the Docker host and want Loskai to manage
them, or are moving Loskai itself.

Loskai sees every container on its Docker host from the start: the ones it doesn't manage
are listed on the **Docker** tab under **Other containers**. You can route any of them right
away (Routing › **Add route** › Container) without moving anything. Managing one — start,
stop, edit, update from the browser — needs it to be a **stack**: a folder in `STACKS_DIR`
(`stacks/` beside Loskai's compose file) holding a compose file. Loskai keeps no database
of stacks; the folder is the stack.

This guide gets what you already run into that folder. It also covers the other direction:
[moving Loskai itself](#moving-loskai-itself) to a new path or a new machine.

| What you have | Do this |
|---|---|
| An app the recipe catalog has (Docker › **Install recipe**) | [Install the recipe and bring your data](#an-app-the-catalog-has) — recommended |
| A compose project in its own folder | [Move the folder](#a-compose-project-in-its-own-folder) |
| A container started with `docker run`, or a Portainer stack | [Write it a compose file](#a-container-with-no-compose-folder) |

---

## Should you bring it in at all?

It's **optional**. Leaving a container where it is costs nothing but the start/stop/edit
buttons — it stays listed, and its route works the same.

**Leave it where it is if:**

- It's managed by something else you mean to keep (a git repo you `git pull`, Ansible,
  Portainer). Two tools fighting over one container is how you lose an evening.
- It isn't a container (a package or a systemd service) — route it as an external service
  instead (Add route › External).
- It runs on a different host than the Docker daemon Loskai talks to — Loskai is
  single-host.

---

## Before you start

These hold whichever way you come in:

- **Stop it first**, so the data is at rest. A database copied mid-write can come out
  corrupt.
- **Know where its data is.** Every way in below is about keeping it:

  ```bash
  docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}}{{.Source}} → {{.Destination}}{{"\n"}}{{end}}' <container>
  ```

  A `bind` is a folder on the host; a `volume` is a named volume, which lives in Docker's
  own storage and is tied to a project name. See
  [why absolute paths are the thing to watch](#why-absolute-paths-are-the-thing-to-watch).
- **Keep the paths inside the container the same.** Apps store them — Jellyfin's
  libraries, an *arr's root folders. Data mounted at a new container path comes up looking
  empty, although nothing is lost.

---

## An app the catalog has

Installing the recipe gives you everything a fresh install would: the form with labelled
settings, its options (a GPU, say), **Check for updates**, its icon, and a route from the
wizard's last step. The trick is putting your data where the recipe expects it *before*
installing — the install takes over a stack folder that has data but no compose file, and
says **"Picked up the data already in its folder"**.

Example — a Jellyfin you run from `~/jellyfin`, with its config in `~/jellyfin/config`:

**1. See where the recipe keeps its data.** Its `compose.yml` in the recipe source
(listed under Settings › General › Recipe sources) — the `./…` entries under `volumes:`. Jellyfin's is
`./config:/config`; Bambuddy's `./data` and `./logs`.

**2. Stop and remove the old container.** Removed, not only stopped: the new one uses the
same port, and a route already pointing at the old one moves over only once it's gone
(below).

```bash
cd ~/jellyfin && docker compose down     # or: docker rm -f jellyfin
```

**3. Make the stack's folder, named as the recipe is, and copy the data into place:**

```bash
mkdir -p ~/loskai/stacks/jellyfin
cp -a ~/jellyfin/config ~/loskai/stacks/jellyfin/config   # -a keeps the owners the app expects
```

Data in a **named volume** instead is copied out through a throwaway container:

```bash
docker run --rm -v jellyfin_config:/from -v ~/loskai/stacks/jellyfin/config:/to alpine cp -a /from/. /to/
```

**4. Install it** from Docker › **Install recipe**, answering as the old setup was (the same port, for
instance). Folders the recipe asks for — Jellyfin's media folders — are added in the
wizard; each lands at a path of the recipe's choosing (`/media/<name>`). If the old
container mounted them elsewhere, set each folder's container path back to the old one
afterwards (**Edit** on the stack › Folders), so the app's stored paths still match.

**The route.** If you had already routed the old container under the recipe's name
(`jellyfin.<your domain>`), the install takes that route over — address, icon, settings —
and points it at the new container. One under another name stays linked to the container
you removed: remove it on the Routing tab and route the new one from the wizard's last step.

Nothing above deletes the original: `~/jellyfin` is still there until you remove it, and a
named volume until you `docker volume rm` it. Keep both until the new install has run a
while.

### Keeping your own compose file instead

You can also bring in your own compose file ([as below](#a-compose-project-in-its-own-folder))
in a folder **named as the recipe is**. Loskai then treats it as the recipe's: the form
labels its settings and offers the recipe's options (for the services your file has).

**Check for updates** lists it as **Differs from the recipe**, and that needs care: an
update *replaces* your `compose.yml` with the recipe's. If your data is mounted
differently — `./jellyfin-config` where the recipe has `./config` — the app starts with its
data unmounted. Nothing is deleted, but it looks like a fresh install. Read the diff's
`volumes:` lines before you update, and move anything you want to keep into
`compose.override.yml` first (Edit on the stack).

---

## A compose project in its own folder

Example — a project at `/opt/immich`, into a `STACKS_DIR` of `~/loskai/stacks`.

**1. Stop it.**

```bash
docker compose -f /opt/immich/docker-compose.yml down
```

**2. Move or copy the whole folder** (compose file, `.env`, and any supporting files) into
`STACKS_DIR`, keeping the folder name:

```bash
# Option A — move: clean relocation, nothing left behind
mv /opt/immich ~/loskai/stacks/immich

# Option B — copy: leaves the original in place as a fallback (uses extra disk)
cp -r /opt/immich ~/loskai/stacks/immich
```

Keep the name (`immich`). Compose derives the project name from the folder name; keeping it
the same means the project reuses its existing named volumes rather than creating empty ones.

**3. Fix absolute paths, if any.** Open the compose file and `.env` and look at the volume /
bind-mount paths (for Immich, `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in `.env`):

- **Relative paths** (`./library:/data`) — nothing to do. They resolve next to the compose
  file, so the data moved/copied along with the folder.
- **Absolute paths** (`/opt/immich/library:/data`) — decide one of two things:
  - *Leave them* to keep using the original data in place (the data doesn't move; the
    folder is just the compose definition), or
  - *Update them* to point into the new location if you also moved/copied the data there.

That decision is the only real work here. Any of `compose.yml`, `compose.yaml`,
`docker-compose.yml` or `docker-compose.yaml` is found; there's no need to rename it.

**4. Start it from Loskai.** The stack now appears on the Docker tab — hit **Compose up**.

---

## A container with no compose folder

A container started with `docker run` has no compose file to move, and a Portainer stack
keeps its file in Portainer's own data. Either way you give Loskai one:

**1. Write the compose file.** For a `docker run` container, describe the same image, ports,
volumes and environment — `docker inspect <container>` shows them all. For a Portainer
stack, copy the file from Portainer's editor.

**2. Keep its named volumes.** Compose prefixes a volume's name with the project, so
`config` in a stack called `jellyfin` is `jellyfin_config` — a new, empty volume unless
that's what it was already called. To use the one you have under its existing name, say so:

```yaml
volumes:
  config:
    external: true
    name: my_jellyfin_config   # the name `docker volume ls` shows
```

A Portainer stack's volumes already carry its stack name as their prefix, so naming the
Loskai stack the same keeps them without this.

**3. Remove the old container** (`docker rm -f <name>`, or remove the stack in Portainer —
keeping its volumes), so the new one can take its port.

**4. Create the stack** — Docker › **New stack**, paste the file. Data you want kept beside
it can be copied into `stacks/<name>/` first: a new stack takes over a folder that has no
compose file yet, as an install does.

---

## Optional — stop publishing host ports (split DNS)

If you run [layout B](topologies.md#b--split-dns-adguard-separate-caddy--loskai-together),
Caddy is a container on this host, so a migrated stack can be routed **without publishing a
host port at all**: join it to the shared `loskai-edge` network and delete its `ports:`.
A migration is the natural moment — the stack is already down and you already have the
compose file open. The stanzas are in
[topologies.md](topologies.md#routing-a-container-without-publishing-a-port).

Two things to expect:

- **The service stops answering on `<host-ip>:<port>`.** Anything bookmarked there, or any
  other tool dialling it directly, breaks — after this it is reachable only through its
  HTTPS route (and from containers on the same network).
- **An existing route needs repointing.** A route created before the move holds
  `<host_ip>:<published-port>` as its upstream, which no longer resolves. Use **Change URL**
  on the Routing tab and set it to `<service>:<port>`.

---

## Why absolute paths are the thing to watch

Bind-mount paths are the only part of a compose project that cares *where the folder lives*:

- **Relative** binds and **named volumes** travel cleanly — relative binds move with the
  folder, and named volumes are keyed by project name (not location), so both survive a
  copy untouched.
- **Absolute** binds are pinned to a fixed host path and ignore the folder's new location.
  They keep working, but the data is now decoupled from the folder — which is fine as long
  as you *know* that's the case. That's why the one instruction that matters is: check for
  absolute paths and decide whether to repoint them.

---

## Moving Loskai itself

Different question from the one above: not adopting a project, but relocating the whole
install. All of Loskai's own state lives in two directories beside the compose file —
`data/` (settings, instances, accounts, logs, session secret, Loskai's SSH keys, recipes
and their cache) and `stacks/` (the managed stacks). There is no database and nothing in `/opt`.

### To a new path on the same machine — safe

Stop everything, move the directory, bring it back up:

```bash
docker compose down
mv ~/loskai /srv/loskai
cd /srv/loskai && docker compose up -d
```

Nothing needs editing. `STACKS_DIR` defaults to `./stacks` beside the compose file, so it
re-resolves at the new location and the same-path mount still holds. Verified end to end
on a stack carrying both a relative bind and a named volume:

| | before | after |
|---|---|---|
| relative bind | `<old>/stacks/demo/payload` | `<new>/stacks/demo/payload` |
| named volume | `demo_dbdata` | `demo_dbdata` |

Both kept their data. The bind follows because it resolves against the compose file; the
named volume reattaches because Compose derives the project name from the **stack
directory's basename**, which the move didn't change.

> **Don't rename a stack's directory.** That basename *is* the project name. Renaming
> `immich/` to `photos/` orphans the `immich_*` volumes and Compose creates empty
> `photos_*` ones — the stack comes up looking healthy with no data. Move the folder
> anywhere you like; leave its name alone.

### To a new machine — three things bite

**1. Named volumes do not travel.** They live in `/var/lib/docker/volumes/`, not in
`stacks/`, so `mv`-ing the folders carries the compose files and every *relative* bind
while silently leaving the databases behind. Most real stacks keep Postgres in a named
volume, so the stack comes up healthy and empty. Migrate them explicitly:

```bash
# on the old machine, per volume
docker run --rm -v immich_dbdata:/from -v "$PWD":/to alpine tar czf /to/immich_dbdata.tgz -C /from .
# on the new one, after `docker compose up -d` has created the empty volume
docker run --rm -v immich_dbdata:/to -v "$PWD":/from alpine tar xzf /from/immich_dbdata.tgz -C /to
```

Or convert those stacks to relative binds first, so the data lives inside `stacks/` and
moves with everything else.

**2. Stored upstreams pin the old host IP.** Each instance records its upstream verbatim
in `data/instances.json`, e.g. `192.168.10.220:8081`, and `host_ip` / `caddy_host_ip` sit
in `data/settings.json`. On a machine with a different LAN IP all of them are wrong and
every route returns a `502`. Fix `host_ip` (**Docker Host LAN IP**, Settings → General)
and `caddy_host_ip` (**LAN IP** under Caddy, Settings → Network) first, then repoint each
route with **Change URL** on the Routing tab — there is no bulk re-derive. Containers
reachable by name (split DNS, on `loskai-edge`) are unaffected; they were never pinned to an
address.

Machines accept Loskai's SSH keys only `from=` the old host's IP, so after fixing the Docker
Host LAN IP, run **SSH setup** again in each machine's dialog, under SSH.

**3. `.env` is in neither directory.** It sits beside the compose file, not inside `data/`
or `stacks/`. Settings made in the UI live in `settings.json` and travel with `data/`, but
the env-only ones — `STACKS_DIR`, `LOSKAI_USERNAME` and `LOSKAI_PASSWORD` — do not, nor does
any value set in `.env`: it is read from there, never written to `settings.json`. Copy
`.env` across too, or re-enter what you need. (`LOSKAI_DATA_DIR` needs no copying: it is set in the compose file
beside the mount it has to match, so it travels with that.)

---

## Verify

- The stack shows on the Docker tab among the managed stacks, **up**, with its containers
  running — no longer under Other containers.
- If the service had an assigned URL, confirm it still resolves (the route is tied to the
  container's upstream, not to the folder location).

**Rollback** — if you copied, the original is untouched: stop the new stack, delete it, and
start the original again. If you moved the folder, move it back and bring it up there.
Nothing else needs undoing — Loskai stores no stack state of its own, beyond the route.
