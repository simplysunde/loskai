# Migrating an Existing Project into a Loskai Stack

Loskai's Stack Manager watches a single directory, `STACKS_DIR`, and treats each
immediate subfolder that contains a compose file as a managed stack. The filesystem is
the source of truth — Loskai keeps no separate database — so "adopting" an existing
Docker Compose project is essentially just getting its folder into `STACKS_DIR`.

This guide covers how to do that, and — just as importantly — when to leave a project
exactly where it is.

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

Example — adopting a project at `/opt/immich` into a `STACKS_DIR` of `/opt/stacks`.

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
mv /opt/immich /opt/stacks/immich

# Option B — copy: leaves the original in place as a fallback (uses extra disk)
cp -r /opt/immich /opt/stacks/immich
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
mv /opt/stacks/immich/docker-compose.yml /opt/stacks/immich/compose.yml
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
