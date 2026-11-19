[Docs](../README.md) › [Guides](../README.md#guides)

# Bringing Your Existing Containers into Loskai

**Read this when** you already run containers on the Docker host and want Loskai to manage
them, or are moving Loskai itself.

Loskai sees every container on its Docker host from the start. The ones it doesn't manage are
on the **Docker** tab under **Other containers**, and you can route any of them right away
(**Add route** › **Container**) without moving anything. To start, stop, edit and update one
from Loskai, it has to be a **stack**: a folder in `stacks/`, beside Loskai's compose file,
with a compose file in it.

| What you have | Do this |
|---|---|
| An app the recipe catalog has (Docker › **Install recipe**) | [Install the recipe and bring your data](#an-app-the-catalog-has), recommended |
| A compose project in its own folder | [Move the folder](#a-compose-project-in-its-own-folder) |
| A container started with `docker run`, or a Portainer stack | [Write it a compose file](#a-container-with-no-compose-folder) |
| Loskai itself, to another folder or machine | [Moving Loskai itself](#moving-loskai-itself) |

---

## Should you bring it in at all?

It's optional. A container left where it is keeps its route and stays listed; it only lacks
Loskai's start, stop and edit buttons.

**Leave it where it is if:**

- something else manages it that you mean to keep: a git repository you `git pull`, Ansible,
  Portainer. Two tools managing one container fight;
- it isn't a container, like a package or a systemd service: route it by its address instead
  ([Add a route](using-loskai.md#add-a-route));
- it runs on another Docker host: Loskai manages the one it runs on.

---

## Before you start

- **Stop it first**, so its data is at rest. A database copied while it writes can come out
  corrupt.
- **Know where its data is.** This lists what the container mounts:

  ```bash
  docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}}{{.Source}} → {{.Destination}}{{"\n"}}{{end}}' <container>
  ```

  A `bind` is a folder on the host. A `volume` is a Docker volume: it lives in Docker's own
  storage, under a name that starts with its project's.
- **Keep the paths inside the container the same.** Apps store them: Jellyfin's libraries,
  an *arr's root folders. Data mounted at a new path inside the container looks empty to the
  app, although nothing is lost.

---

## An app the catalog has

Installing the recipe gives you what a fresh install has: **Edit** with labelled settings, the
recipe's options, **Check for updates**, its icon, and a route from the wizard's last step.
The trick is putting your data where the recipe expects it *before* installing.

The example moves a Jellyfin run from `~/jellyfin`, with its config in `~/jellyfin/config`,
into a Loskai in `~/loskai`.

1. **See where the recipe keeps its data:** the `./…` lines under `volumes:` in its
   `compose.yml`, in the [recipes repository](https://github.com/simplysunde/loskai-recipes).
   Jellyfin's is `./config`; Bambuddy's are `./data` and `./logs`.
2. **Stop and remove the old container.** It has to be gone, not only stopped: the new one
   takes its port, and its route.

   ```bash
   cd ~/jellyfin && docker compose down     # or: docker rm -f jellyfin
   ```

3. **Make the stack's folder, named as the recipe is, and copy the data in:**

   ```bash
   mkdir -p ~/loskai/stacks/jellyfin
   cp -a ~/jellyfin/config ~/loskai/stacks/jellyfin/config   # -a keeps the owners the app expects
   ```

   Data in a Docker volume is copied out through a throwaway container:

   ```bash
   docker run --rm -v jellyfin_config:/from -v ~/loskai/stacks/jellyfin/config:/to alpine cp -a /from/. /to/
   ```

4. **Install it:** Docker › **Install recipe** › **Jellyfin**, answering as the old setup was,
   like the same port. Add your media folders under **Media folders**. Click **Deploy**. The
   last step says **Picked up the data already in its folder.**
5. **Put each folder where the old container had it.** The wizard mounts a folder at a path
   of the recipe's choosing, `/media/<name>`. If the old container used another, change it
   under the stack's pencil (**Edit**) › **Folders**, and **Save**.

**The route.** A route under the recipe's name, `jellyfin`, that pointed at the old container
moves to the new one, with its icon and settings. If the old container still exists, the
install refuses, with **is already the name of the route to container**: remove the old
container first. A route under another name stays with the removed container: delete it on
**Routing** and add the route from the wizard's last step.

Nothing above deletes the original. `~/jellyfin` stays until you remove it, and a Docker
volume until `docker volume rm`. Keep both until the new install has run for a while.

### Keeping your own compose file instead

You can bring in your own compose file, [as below](#a-compose-project-in-its-own-folder), in
a folder named as the recipe is. Loskai then treats it as the recipe's: **Edit** labels its
settings and offers the recipe's options, for the services your file has.

**Check for updates** lists it as **Differs from the recipe**, and an update *replaces* your
`compose.yml` with the recipe's. If your data is mounted elsewhere, like `./jellyfin-config`
where the recipe has `./config`, the app then starts without it. Nothing is deleted, but it
looks like a fresh install. Read the update's `volumes:` lines first, and move what you want
to keep into `compose.override.yml` under **Edit** › **Edit as text**.

---

## A compose project in its own folder

The example moves a project at `/opt/immich` into `~/loskai/stacks`.

1. **Stop it:**

   ```bash
   docker compose -f /opt/immich/docker-compose.yml down
   ```

2. **Move or copy the whole folder** into `stacks/`, its compose file, `.env` and anything
   else with it, **keeping its name**:

   ```bash
   mv /opt/immich ~/loskai/stacks/immich      # move: nothing left behind
   cp -a /opt/immich ~/loskai/stacks/immich   # or copy: the original stays as a fallback
   ```

   The name matters: Compose names the project after the folder, and the project's Docker
   volumes after the project. Another name starts with empty volumes.
3. **Check its paths.** In the compose file and `.env`, look at what it mounts. For Immich,
   `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in `.env`:
   - **A relative path**, like `./library`, moved with the folder. Nothing to do.
   - **An absolute path**, like `/opt/immich/library`, still points where it did. Leave it to
     keep using the data there, or change it if you moved the data too.

   Any of `compose.yml`, `compose.yaml`, `docker-compose.yml` or `docker-compose.yaml` is
   found: there is no need to rename it.
4. **Start it from Loskai.** On the **Docker** tab the stack is under **Stacks**. Click its
   play button (**Compose up**). Its pill says **up**.

---

## A container with no compose folder

A container started with `docker run` has no compose file to move, and a Portainer stack keeps
its file in Portainer's data. Either way, you give Loskai one.

1. **Write the compose file.** For a `docker run` container, the same image, ports, mounts and
   environment: `docker inspect <container>` shows them all. For a Portainer stack, copy the
   file from Portainer's editor.
2. **Keep its Docker volumes.** Compose names a volume after the stack, so `config` in a stack
   called `jellyfin` is `jellyfin_config`: a new, empty one unless that's already its name. To
   use the one you have, name it:

   ```yaml
   volumes:
     config:
       external: true
       name: my_jellyfin_config   # the name `docker volume ls` shows
   ```

   A Portainer stack's volumes already start with its name, so naming the Loskai stack the
   same keeps them without this.
3. **Remove the old container**, with `docker rm -f <name>` or by removing the stack in
   Portainer, keeping its volumes, so the new one can take its port.
4. **Create the stack:** Docker › **New stack**, type the name, paste the file, click **Create
   + up**. To keep data beside it, copy it into `stacks/<name>/` first: a new stack takes over
   a folder that has no compose file yet.

---

## Optional: stop publishing its ports

With Caddy beside Loskai and AdGuard on its own box
([layout B](topologies.md#b--split-dns-adguard-separate-caddy--loskai-together)), a moved
stack can be routed without publishing a port at all: join it to Caddy's network,
`loskai-edge`, and delete its `ports:`. The lines are in
[Routing a container without publishing a port](topologies.md#routing-a-container-without-publishing-a-port).

- **It stops answering at `<docker-host>:<port>`.** A bookmark or another tool using that
  address breaks: it is reached only through its route, and from containers on the same
  network.
- **A route set by hand needs its address changed:** on **Routing**, its pencil (**Change
  URL**), to the container's name on that network and its port, like
  `immich-server.loskai-edge:2283`. A route that follows
  its container changes by itself when the stack starts.

---

## Moving Loskai itself

All of Loskai's state is in two folders beside its compose file: `data/`, everything Loskai
stores, and `stacks/`, the stacks. Plus the `.env` file, if you made one.

### To another folder on the same machine

```bash
docker compose down
mv ~/loskai /srv/loskai
cd /srv/loskai && docker compose up -d
```

Nothing needs changing: `stacks/` is found beside the compose file wherever it is, and each
stack keeps its data. **Don't rename a stack's folder**, though: its name is the project's, and
`immich/` renamed to `photos/` starts with empty volumes, looking healthy.

### To another machine

Copy the folder, with `data/`, `stacks/` and `.env`, and start it. Then three things:

1. **Docker volumes don't come along.** They live in Docker's own storage, not in `stacks/`,
   so a stack whose database is in a volume starts healthy and empty. Copy each across:

   ```bash
   # on the old machine, per volume
   docker run --rm -v immich_dbdata:/from -v "$PWD":/to alpine tar czf /to/immich_dbdata.tgz -C /from .
   # on the new one, after `docker compose up -d` has made the empty volume
   docker run --rm -v immich_dbdata:/to -v "$PWD":/from alpine tar xzf /from/immich_dbdata.tgz -C /to
   ```

   Or change those stacks to relative folders first, so their data is in `stacks/` and moves
   with it.
2. **Routes point at the old machine's address**, and give `502`. Set **Docker Host LAN IP**
   in **Settings** › **General**, and Caddy's **LAN IP** in **Settings** › **Network**, to the
   new address. One set in `.env` (`HOST_IP`, `CADDY_HOST_IP`) is changed there. Then restart
   Loskai, `docker compose restart loskai`: routes that follow their container are rewritten
   as it starts. Change the others with their pencil (**Change URL**) on **Routing**.
3. **Your machines let Loskai in only from the old address.** Run **SSH setup** again in each
   machine's dialog, under **SSH**.

---

## Check it

- The stack is on the **Docker** tab under **Stacks**, its pill **up**, and no longer under
  **Other containers**.
- Its name opens as before.

**To go back:** if you copied, the original is untouched. Delete the new stack, without its
data, and start the original again. If you moved it, move it back and start it there.
