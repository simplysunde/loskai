[Docs](../README.md) › [Contributing](../README.md#contributing)

# The animations

**Read this when** the UI changed and the animations in the README and
[Using Loskai](../guides/using-loskai.md) no longer match it, or you want to add or change one.

They are never recorded by hand. `make demo` builds a made-up homelab, sets it up through
Loskai, records each flow, and writes the images to `docs/images/`:

| File | What it shows |
|---|---|
| `demo-routing.webp` | The dashboard, then Add route → a container → its HTTPS name, and its card on the dashboard |
| `demo-docker.webp` | The install wizard: a recipe installed and routed from its last step |
| `demo-machines.webp` | A machine's dialog — its overview over SSH — and a terminal on it |
| `demo-dashboard.webp`, `demo-dashboard-phone.webp` | The public dashboard on a computer and a phone |

Rerun it after a change to what any of them shows, and commit the images with that change
or right after it.

## Running it

```bash
make demo                        # everything
ONLY=routing make demo           # one flow (a regex over the flow names)
KEEP=1 make demo                 # leave the homelab up afterwards, to look around
KEEP=0 make demo                 # …and clear it away
DEMO_RECIPES=../loskai-recipes make demo   # recipes not pushed yet, from a folder
```

It needs Docker and nothing else: Playwright and ffmpeg run in their own images. It needs
memory — about 6 GB free, mostly Immich's; `DEMO_APPS="jellyfin bambuddy"` leaves Immich out
to try a change on a smaller machine (the Docker tab then shows less). The first run
downloads every image into a Docker volume, `loskai-demo-docker`, and takes a while; later
runs reuse it. `docker volume rm loskai-demo-docker` frees the space.

## What it builds

Nothing in it is real, so nothing real can end up in a public image:

- **Its own Docker daemon** — a privileged `docker:dind` container at `.20`, the "Docker
  host" — so this machine's containers never show in it. Inside it, Loskai and its Caddy
  run from `compose.caddy-loskai.yml`, as layout B installs them, on images built from the
  checkout: the animations always show the code as it is.
- **Its own LAN**, `192.168.50.0/24` (`DEMO_SUBNET=192.168.77` for another, when this host
  already routes that one): AdGuard at `.2`, a machine with only a name at `.30`
  (`homeassistant`), and a Debian machine with SSH at `.50` (`nas`, from `demo/machine/`).
- **Every app from the recipes**, installed through Loskai's own wizard endpoint — from
  the default recipe source, or `DEMO_RECIPES`. The Docker tab shows only what someone
  could install.
- Passwords are random on each run, and printed only with `KEEP=1`.

## The pieces

| File | Does |
|---|---|
| `scripts/record-demo.sh` | Builds the images, starts the LAN, installs Loskai, runs the two scripts below, converts, clears it all away |
| `demo/setup.mjs` | The setup, through Loskai's API, as a user would: the apps installed, routes for all but Jellyfin (routed on camera), the NAS named and its SSH set up, Home Assistant named |
| `demo/record.mjs` | One function per flow, a step at a time; the drawn cursor and the caption |
| `demo/convert.sh` | Each recording cut to where its flow starts, scaled to 960 px wide, written as an animated WebP — a sixth of a GIF's size, and it plays wherever a GIF does |

## Changing a flow, or adding one

A flow in `record.mjs` is what a person does, step by step:

```js
await record("routing", async (p, start) => {
  await go(p, "/routing");
  start();                                   // the animation begins here, after the page loaded
  await caption(p, "Routing — every service with a name of its own");
  await click(p, p.getByRole("button", { name: "Add route" }).first());
  …
});
```

- `click` glides the cursor to its target before clicking; `type` types at a person's
  speed; `caption` sets the line at the top (an empty string hides it).
- Find things by what a person reads — a button's name, a title — as the tests do; never by
  a CSS class.
- Keep a flow under about 20 seconds: an animation has no pause button, and git keeps every
  version of it, so its size counts — `convert.sh` prints each one's.
- Something the flow needs set up first goes in `setup.mjs`, through the API.
- A new flow: add its row to the table above, and its image to the README and the guide
  where it belongs.

When a flow fails, the run stops with the step that failed, a screenshot of the page in
`.demo/out/<flow>-failed.png`, and the homelab left up to try the step by hand at
`http://192.168.50.20:8080` (the password is printed); `KEEP=0 make demo` clears it away.
