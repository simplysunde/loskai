[Docs](../README.md) › [Contributing](../README.md#contributing)

# The animations

**Read this when** the UI changed and the animations in the README and
[Using Loskai](../guides/using-loskai.md) no longer match it, or you want to add or change one.

They are never recorded by hand. `make demo` builds a made-up homelab, sets it up through
Loskai, records each flow, and writes the images to `docs/images/`:

| File | What it shows |
|---|---|
| `demo-routing.webp` | The dashboard, then Add route → a container → its HTTPS name, and its card on the dashboard |
| `demo-docker.webp` | A stack opened to its containers, then the install wizard: a recipe installed and named from its last step |
| `demo-machines.webp` | A machine's dialog over SSH — its overview, a service restarted in one click, Claude Code started in a project |
| `demo-phone.webp` | A phone: the dashboard, then Routing, Docker and Machines from the menu |

None of them opens an app behind a name: what Jellyfin looks like is Jellyfin's to show.

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
  run from `compose.caddy-loskai.yml`, as the Loskai + Caddy setup installs them, on images built from the
  checkout: the animations always show the code as it is.
- **Its own LAN**, `192.168.50.0/24` (`DEMO_SUBNET=192.168.77` for another, when this host
  already routes that one): AdGuard at `.2`, a machine with only a name at `.30`
  (`homeassistant`), and a Debian machine with SSH at `.50` (`nas`, from `demo/machine/`).
  It runs systemd, so what Loskai lists there are real services — a file share and a web
  page — and it has two git projects.
- **A stand-in for Claude Code** on that machine (`demo/machine/claude`): the real one needs
  an account, whose name would be in a public image. It keeps its tmux session open, which
  is all Loskai's card looks at, and the recording never attaches to it.
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
  await go(p, "/");
  start();                                   // the animation begins here, after the page loaded
  await caption(p, "Your homelab — every service, one click away");
  await click(p, tab(p, "Routing"));         // a tab, from the sidebar: the page never reloads
  await click(p, p.getByRole("button", { name: "Add route" }).first());
  …
});
```

- `click` glides the cursor to its target before clicking; `point` rests it there; `type`
  types at a person's speed; `caption` sets the line at the top (an empty string hides it).
  The glide is a hand's: slow off the mark and onto the target, on a slight arc, longer the
  further it goes, landing near the middle of what it aims at (`glide`).
  `tab` is a tab in the sidebar. A phone's flow passes `touch: true`: no cursor, and each tap
  a ring that spreads and fades where the finger lands.
- Find things by what a person reads — a button's name, a title — as the tests do; never by
  a CSS class.
- Keep a flow under about half a minute: an animation has no pause button, and git keeps
  every version of it, so its size counts — `convert.sh` prints each one's. A screen of
  small text is the costliest thing to show: a container's log, opened for two seconds,
  doubled the Docker animation. `QUALITY` (70) is what the size hangs on, far more than
  `FPS` (12): `QUALITY=60 make demo` for smaller still.
- A run that drops down from the top (an automatic action) stays while the cursor is on it:
  `point` at something else and wait for it to go before the next step.
- Something the flow needs set up first goes in `setup.mjs`, through the API.
- A new flow: add its row to the table above, and its image to the README and the guide
  where it belongs.

When a flow fails, the run stops with the step that failed, a screenshot of the page in
`.demo/out/<flow>-failed.png`, and the homelab left up to try the step by hand at
`http://192.168.50.20:8080` (the password is printed); `KEEP=0 make demo` clears it away.
