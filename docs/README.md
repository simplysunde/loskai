# Loskai documentation

Loskai is the control plane for a homelab: one container, five independent modules
(Docker, Caddy, AdGuard, WireGuard, SSH) behind one web UI. These pages are grouped by the
question they answer.

- **[Guides](#guides)** — you want to run Loskai, or fix something that's misbehaving.
- **[Reference](#reference)** — you want the exact contract: an endpoint, a payload, a schema.
- **[Contributing](#contributing)** — you want to change the code.
- **[Project](#project)** — you want to know why it was built the way it was.

## Start here

| I want to… | Go to |
|---|---|
| **Install Loskai** for the first time | [Install guide](guides/install.md) |
| Get **HTTPS names** working — AdGuard, Caddy, my devices' DNS | [Install guide](guides/install.md#choose-your-setup) |
| Know **what each tab does** once it's running | [Using Loskai](guides/using-loskai.md) |
| **Decide how to lay it out** across my machines | [Topologies](guides/topologies.md) |
| **Configure a running container** — env vars, volumes | [Deployment](guides/deployment.md) |
| **Fix a 502**, a redirect loop, a name that won't resolve | [Troubleshooting](guides/troubleshooting.md) |
| Stop my browser **warning about the certificate** | [Trusting the certificate](guides/certificate-setup.md) |
| Reach Proxmox or a NAS **directly** on its own port, without a warning (optional, outside Loskai) | [Backend certificates](guides/backend-certificates.md) |
| **Bring the containers you already run** into Loskai | [Migration](guides/migration.md) |
| **Reach it from outside**, on a phone or laptop away from home | [Tailscale](guides/tailscale.md) |
| **Run the code locally** and change it | [Dev & testing](contributing/dev-testing.md) |
| Know **what an endpoint returns** | [Loskai API](reference/api.md) |
| **Write a recipe** for the install wizard | [Recipe schema](reference/recipe-schema.md) |

## Guides

Operating Loskai. Read in roughly this order the first time.

| Page | When to read it |
|---|---|
| [install.md](guides/install.md) | Setting Loskai up from nothing. Choose your setup — Loskai standalone, Proxmox, Loskai + Caddy or All-in-one — and follow it step by step; then point your devices at AdGuard, trust the certificate and give a service its name. Start here. |
| [using-loskai.md](guides/using-loskai.md) | Right after installing, and whenever you want to do something in it. One section per tab, a task at a time: install an app, add a route or a link, name a machine and manage it over SSH. |
| [topologies.md](guides/topologies.md) | **Before** installing, if you're unsure where each piece should run. Which of the three setups with names suits the hardware you have, one table comparing them, what each asks of you, and routing a container without publishing a port. |
| [deployment.md](guides/deployment.md) | Looking after a running Loskai: updating it, every env var and where it is in Settings, where its files live and who owns them, Caddy's saved config, and a cold start. The reference you return to. |
| [certificate-setup.md](guides/certificate-setup.md) | A browser warns about one of your names, or a new device joins. Trusting Caddy's certificate once per device — phones and Firefox too — and who sees the Certificate tab. |
| [backend-certificates.md](guides/backend-certificates.md) | Optional, and not part of Loskai: only if you open a service on its own port — Proxmox `:8006`, a NAS page — and want no warning there. Caddy hands the service a certificate your devices already trust. Tried once on a test setup; Loskai doesn't use or support it. |
| [migration.md](guides/migration.md) | Bringing containers you already run into Loskai — installing the recipe over your data, moving a compose folder, or writing a `docker run` container a compose file — and when not to bother. Also covers relocating Loskai itself. |
| [tailscale.md](guides/tailscale.md) | Reaching your routed names away from home. A Tailscale subnet router — **Share this network** on a machine's Tailscale tool, or the recipe on the Docker host — and the two settings in Tailscale's admin console. |
| [troubleshooting.md](guides/troubleshooting.md) | Something is broken. Find what you see: a blank page, a 502, a redirect loop, a name that won't resolve, a certificate warning, VPN DNS, Caddy or AdGuard unreachable, a stack that won't start, a machine over SSH, a link. |

## Reference

Exact contracts. Two kinds, and the difference matters:

**Loskai's own API** — what the frontend consumes, and what changes when you touch a router.

| Page | When to read it |
|---|---|
| [api.md](reference/api.md) | Adding or changing an endpoint, or wiring up frontend calls. Human-readable overview of all 76 routes; the live `/docs` (Swagger) is authoritative. |
| [ssh-status.md](reference/ssh-status.md) | Reading something new from a machine without anyone unlocking the SSH key — the status key's forced command, its requests, output and versions. |
| [tool-schema.md](reference/tool-schema.md) | Adding a tool or an action to one — what a machine's dialog can run over SSH. Tools are data, validated, ship in the image, and apply where the machine has what they need. |
| [recipe-schema.md](reference/recipe-schema.md) | Authoring a `recipe.yml`, or changing the install wizard's validation. Recipes are declarative data — validated, never executed. |

**External APIs Loskai calls** — the subset it depends on, and *why* each call is made.
Read the relevant one **before** touching that integration; they document constraints that
are not obvious from the code.

| Page | When to read it |
|---|---|
| [caddy-api.md](reference/caddy-api.md) | Touching the routing module. Covers server-name discovery, why editing a route is delete-then-add rather than `PATCH`, and how routes survive a restart. |
| [adguard-api.md](reference/adguard-api.md) | Touching the DNS module. Covers the rewrite model and why deletes match the exact `(domain, answer)` pair rather than the domain alone. |

## Contributing

| Page | When to read it |
|---|---|
| [dev-testing.md](contributing/dev-testing.md) | Running Loskai locally — backend on `:8000`, Vite on `:5173`, throwaway Caddy + AdGuard containers. Includes a dev-rig-specific troubleshooting table. |
| [where-logic-lives.md](contributing/where-logic-lives.md) | Before writing a function that decides something. Each decision's one owner, and the files that use it; the decisions the browser makes again, and what keeps them in step. |
| [phone-layout.md](contributing/phone-layout.md) | Adding or changing a page, a table or a dialog. The one layout's phone variants — the drawer, tables as cards, full-screen dialogs — and the traps in them. |
| [demo.md](contributing/demo.md) | The animations in the README and Using Loskai no longer match the UI, or you want a new one. `make demo` records them in a made-up homelab; how to change a flow. |
| [releasing.md](contributing/releasing.md) | Publishing a version. The registry token, QEMU for `arm64`, `make release`, making the packages public, and checking them as a stranger would. |
| [lxc-script-authoring.md](contributing/lxc-script-authoring.md) | Adding a new `create-<service>-lxc.sh`. The safety invariants, the shared library to copy verbatim, and an authoring checklist. |

## Project

The maintainers' working files — long, chronological, and written for whoever builds
Loskai next. Nobody needs them to run it.

| Page | When to read it |
|---|---|
| [architecture.md](project/architecture.md) | You want how Loskai is put together — its three components (Routing, Docker, Machines), what each does and doesn't, and why. |
| [HISTORY.md](project/HISTORY.md) | Before reversing a decision: what landed, when, and what it walked back. |
| [TODO.md](project/TODO.md) | What is being built now, and the backlog. |
| [todo-archive.md](project/todo-archive.md) | How a finished phase (1–38, 40–46) was built. |

## Conventions

### Where information goes

Each reader arrives with one question. Answer it in one place, and link there from
everywhere else.

| Reader | Their question | Where |
|---|---|---|
| Visitor | What is it, is it for me? | the repo [README](../README.md) — a screenshot and four lines |
| Installer | How do I get it running? | [install.md](guides/install.md), [topologies.md](guides/topologies.md) if unsure |
| User | What does this tab or button do? | a short tooltip in the app; [using-loskai.md](guides/using-loskai.md) for more |
| Stuck user | Why is this broken? | [troubleshooting.md](guides/troubleshooting.md) |
| Upgrader | What changed? | [CHANGELOG.md](../CHANGELOG.md) |
| Security-minded | What can it touch on my host? | [SECURITY.md](../SECURITY.md) |
| Contributor | How do I change it? | [CONTRIBUTING.md](../CONTRIBUTING.md), then [Contributing](#contributing) |
| Maintainer | Why is it built this way? | [Project](#project): plan, history, task list |

**The app says *what* something is; the guides say *how*; the agent docs say *why*.** UI
text stays a label or a one-line tooltip — never a paragraph.

### Rules

- **One fact, one place.** Other pages link to it rather than repeat it. If a fact about
  an external API appears in a guide, the reference page is the source of truth.
- **Every page opens the same way:** a breadcrumb back to this index, the title, then one
  `**Read this when**` line. Pages read in order end with `**Next:**`.
- **No hand-written tables of contents** except this index — GitHub shows an outline for
  every file.
- **The repo README stays short** (about 100 lines). Anything longer belongs in a guide.
- **Guides describe Loskai's behaviour; reference pages describe contracts.** The README
  and the guides are written for someone running Loskai: a section per task, steps that end
  on what you see, the app's words as on screen. How it works and why are the agent docs —
  `CLAUDE.md`, [architecture.md](project/architecture.md), Reference, Contributing and
  [HISTORY.md](project/HISTORY.md). The style in full: the `loskai-docs` skill, in `.claude/skills/`.
- **These rules are checked.** `bash scripts/check-docs.sh` (or `make check-docs`) fails on
  a broken link or image, a dead heading anchor, a page this index doesn't reach, or a page
  missing its breadcrumb or `Read this when` line. Adding a page means adding it above.
- Setups are named the same on every page — **Loskai standalone**, **Proxmox**, **Loskai +
  Caddy**, **All-in-one** — as the install guide's table has them.
  [topologies.md](guides/topologies.md) compares the three with names and records the one
  merged-container arrangement that was considered and rejected. Older `HISTORY.md` and
  `TODO.md` entries name them by letter: **A** Proxmox (split LXC), **B** Loskai + Caddy
  (split DNS), **C** All-in-one (all-in-Docker); before 2026-09-04, B and C were swapped.
