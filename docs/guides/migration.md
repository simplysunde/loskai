# Migrating an Existing Project into a Loskai Stack

Loskai's Stack Manager watches a single directory, `STACKS_DIR`, and treats each
immediate subfolder that contains a compose file as a managed stack. The filesystem is
the source of truth — Loskai keeps no separate database — so "adopting" an existing
Docker Compose project is essentially just getting its folder into `STACKS_DIR`.

This guide covers how to do that, and — just as importantly — when to leave a project
exactly where it is. It also covers the reverse direction:
[moving Loskai itself](#moving-loskai-itself) to a new path or a new machine.

---

## Should you migrate a project at all?

Migrating is **optional**. Loskai still *sees* every running container in the Container
Overview regardless of where its compose file lives; migrating only changes whether the
**Stack Manager** can start/stop/update/edit it as a unit.

**Good candidates** — normal, self-contained compose projects you currently edit and
restart by hand, and want to manage from the browser instead.

**Leave it where it is if:**

- It isn't really a compose project (installed via a package manager, systemd, or a one-off
  `docker run` — there's no compose file to manage).
- It's already managed by something else (a git repo you `git pull`, Ansible, Portainer).
  Two tools fighting over one directory is how you lose an evening.
- It's on a different host than the Docker daemon Loskai talks to — Loskai is
  single-host.

> Rule of thumb: migrate what you edit-and-restart by hand. Leave alone anything that's
> automated, package-managed, or elsewhere.

---

## Migrating a project

Example — adopting a project at `/opt/immich` into a `STACKS_DIR` of `~/loskai/stacks`
(the default: `stacks/` beside the compose file).

**1. Stop the stack first.** Always bring it down before moving or copying anything, so
the data is at rest and you capture a consistent copy — a database copied mid-write can
come out corrupt.

```bash
docker compose -f /opt/immich/docker-compose.yml down
```

**2. Move or copy the whole folder** (compose file, `.env`, and any supporting files) into
`STACKS_DIR`, keeping the folder name. Pick whichever fits you:

```bash
# Option A — move: clean relocation, nothing left behind
mv /opt/immich ~/loskai/stacks/immich

# Option B — copy: leaves the original in place as a fallback (uses extra disk)
cp -r /opt/immich ~/loskai/stacks/immich
```

Keep the name (`immich`). Compose derives the project name from the folder name; keeping it
the same means the relocated project reuses the existing named volumes and containers
rather than creating duplicates.

**3. Fix absolute paths, if any.** Open `compose.yml` and `.env` and look at the volume /
bind-mount paths (for Immich, `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in `.env`):

- **Relative paths** (`./library:/data`) — nothing to do. They resolve next to the compose
  file, so the data moved/copied along with the folder.
- **Absolute paths** (`/opt/immich/library:/data`) — decide one of two things:
  - *Leave them* to keep using the original data in place (the data doesn't move; the
    folder is just the compose definition), or
  - *Update them* to point into the new location if you also moved/copied the data there.

That decision is the only real work in a migration.

**4. Make the compose file discoverable.** Loskai discovers stacks by the filename
**`compose.yml`**. If the project ships `docker-compose.yml`, rename it:

```bash
mv ~/loskai/stacks/immich/docker-compose.yml ~/loskai/stacks/immich/compose.yml
```

**5. Start it from Loskai.** The stack now appears in the Stack Manager — hit **up**.

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
`data/` (settings, instances, session secret, hand-added recipes) and `stacks/` (the
managed stacks). There is no database and nothing in `/opt`.

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
every route returns a `502`. Fix `host_ip` and `caddy_host_ip` in **Settings → Network**
first, then repoint each route with **Change URL** on the Routing tab — there is no bulk
re-derive. Containers reachable by name (split DNS, on `loskai-edge`) are unaffected;
they were never pinned to an address.

**3. `.env` is in neither directory.** It sits beside the compose file, not inside `data/`
or `stacks/`. Most settings live in `settings.json` and travel with `data/`, but the
env-only ones — `STACKS_DIR` and `LOSKAI_PASSWORD` — do not. Copy `.env` across too, or
re-enter what you need. (`LOSKAI_DATA_DIR` needs no copying: it is set in the compose file
beside the mount it has to match, so it travels with that.)

---

## Verify

- The stack shows in the Stack Manager as **up**, and its containers show running in the
  Container Overview.
- If the service had an assigned URL, confirm it still resolves (the route is tied to the
  container's upstream, not to the folder location).

**Rollback** — if you used `cp` (Option B), the original folder is untouched: stop the
copy, delete it, and start the original again. If you used `mv` (Option A), move the folder
back to where it came from (renaming `compose.yml` to `docker-compose.yml` if you changed
it) and bring it up. Nothing else needs undoing — Loskai stores no stack state of its
own.
