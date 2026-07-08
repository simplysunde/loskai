# Migrating an Existing Project into a FlytDokk Stack

FlytDokk's Stack Manager watches a single directory, `STACKS_DIR`, and treats each
immediate subfolder that contains a compose file as a managed stack. The filesystem is
the source of truth — FlytDokk keeps no separate database — so "adopting" an existing
Docker Compose project is simply a matter of getting its folder into `STACKS_DIR`.

This guide covers how to do that safely, and — just as importantly — when you should
leave a project exactly where it is.

---

## Should you migrate a project at all?

Moving a project into `STACKS_DIR` is **optional**. FlytDokk still *sees* every running
container in the Container Overview regardless of where its compose file lives; migrating
only changes whether the **Stack Manager** can start/stop/update/edit it as a unit.

### Reasons to migrate

- You want to manage the stack (up / down / restart / pull-update, edit `compose.yml` and
  `.env`) from the browser instead of SSH.
- You want all your stacks discoverable in one place.
- The project is a normal, self-contained compose project you actively maintain.

### Reasons to leave it where it is

- **It isn't really a compose project.** Anything installed via a package manager, a
  systemd service, or a one-off `docker run` has no compose file to manage — moving it
  accomplishes nothing. (It still appears in the Container Overview.)
- **Its data lives on absolute paths you don't want to touch.** If the project's volumes
  point at fixed host paths (e.g. a media library on `/mnt/tank`), the compose folder and
  the data are already decoupled — moving the folder gains you little and risks confusion.
- **It's managed by something else** — a git repo you `git pull`, an Ansible role, a
  Portainer stack. Two tools fighting over the same directory is how you lose an evening.
- **It's on a different host** than the Docker daemon FlytDokk talks to. FlytDokk is
  single-host; a stack on another machine can't be adopted.

> Rule of thumb: migrate projects you *edit and restart by hand today*. Leave alone
> anything that's automated, package-managed, or whose data you'd rather not disturb.

---

## Before you start

- **Know your `STACKS_DIR`.** It can be any single directory on the Docker host —
  `/opt/stacks`, `/mnt/tank/apps`, `/srv/compose`, etc. It does **not** have to be under
  `/opt`. All the stacks you want FlytDokk to manage must live as subfolders of this one
  directory.
- **Confirm the same-path mount.** `STACKS_DIR` must be bind-mounted into the FlytDokk
  container at the *same path* it has on the host (`${STACKS_DIR}:${STACKS_DIR}`).
  FlytDokk runs `docker compose` inside its container and hands bind paths to the host
  daemon, so the in-container path must equal the host path or volumes end up in the wrong
  place.
- **Have a backup** of the project's data before moving anything.

---

## Migrating a project — step by step

The example below adopts an Immich install currently at `/opt/immich` into a
`STACKS_DIR` of `/opt/stacks`.

**1. Stop the stack cleanly** (from its current location):

```bash
docker compose -f /opt/immich/docker-compose.yml down
```

Do this *before* moving the folder — never pull the directory out from under running
containers.

**2. Move the folder into `STACKS_DIR`, keeping the folder name:**

```bash
mv /opt/immich /opt/stacks/immich
```

Keep the name (`immich`). Compose derives the **project name** from the folder name; if it
stays the same, the existing containers and named volumes are still recognised. Rename the
folder and compose treats it as a brand-new project, orphaning the old containers.

**3. Make sure the compose file is discoverable.** FlytDokk discovers stacks by looking
for a file named **`compose.yml`**. Many upstream projects (Immich included) ship
`docker-compose.yml`. If so, rename it:

```bash
mv /opt/stacks/immich/docker-compose.yml /opt/stacks/immich/compose.yml
```

Bring the `.env` file along too — it moves with the folder, but double-check it's there.

**4. Handle the data paths** (see caveats below) — usually nothing to do, but confirm.

**5. Bring it back up.** In FlytDokk the stack now appears in the Stack Manager. Hit
**up**, or from the shell:

```bash
docker compose -f /opt/stacks/immich/compose.yml up -d
```

---

## Caveats and gotchas

- **Compose filename.** Only `compose.yml` is discovered. Rename `docker-compose.yml` →
  `compose.yml` (step 3).
- **Folder name = project name.** Keep it identical to preserve the link to existing
  containers and volumes.
- **Bind-mount paths — the thing most likely to surprise you:**
  - **Relative** binds (`./library:/data`) resolve next to the compose file, so the data
    lives *inside* the project folder and moves with it — make sure you actually moved the
    data subfolders too (a `mv` of the whole directory does this; a `cp` of just the
    compose file does not).
  - **Absolute** binds (`/opt/immich/library:/data`, or an `.env` `UPLOAD_LOCATION` set to
    an absolute path) stay pointed at the original location. The stack keeps working, but
    its data is now decoupled from the folder. Update the path only if you also move the
    data — and if you do, `down` first.
- **Named volumes** (e.g. `immich_pgdata`) are stored by Docker independently of the folder
  and are unaffected by the move, as long as the project name is unchanged.
- **`.env` secrets.** The `.env` travels with the folder. FlytDokk can display and edit it
  in the browser (behind the app's own access control) — be aware it contains secrets.

---

## Verify

- The stack shows in the Stack Manager with status **up**.
- Container Overview lists its containers as running.
- If the service had an assigned URL, confirm the route still resolves (the route is tied
  to the container's upstream, not to the stack's folder location).

---

## Rollback

If anything looks wrong, the move is reversible because nothing was rewritten — only
relocated:

```bash
docker compose -f /opt/stacks/immich/compose.yml down
mv /opt/stacks/immich /opt/immich
# rename compose.yml back to docker-compose.yml if you changed it
docker compose -f /opt/immich/docker-compose.yml up -d
```

Because the filesystem is the source of truth and FlytDokk stores no stack state of its
own, there is nothing else to undo.
