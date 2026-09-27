# Loskai documentation

Loskai is the control plane for a homelab: one container, four independent modules
(Docker, Caddy, AdGuard, WireGuard) behind one web UI. These pages are grouped by the
question they answer.

- **[Guides](#guides)** — you want to run Loskai, or fix something that's misbehaving.
- **[Reference](#reference)** — you want the exact contract: an endpoint, a payload, a schema.
- **[Contributing](#contributing)** — you want to change the code.

Project direction, history and the live task list are **not** here — they live at the repo
root: [`PLAN.md`](../PLAN.md) (architecture and the *why*), [`TODO.md`](../TODO.md) (what's
being built now), [`HISTORY.md`](../HISTORY.md) (what landed, when, and what it walked back),
and [`todo-archive.md`](../todo-archive.md) (completed phases 1–13).

## Start here

| I want to… | Go to |
|---|---|
| **Install Loskai** for the first time | [Install guide](guides/install.md) |
| **Decide how to lay it out** across my machines | [Topologies](guides/topologies.md) |
| **Configure a running container** — env vars, volumes | [Deployment](guides/deployment.md) |
| **Fix a 502**, a redirect loop, a name that won't resolve | [Troubleshooting](guides/troubleshooting.md) |
| Stop my browser **warning about the certificate** | [Certificate onboarding](guides/certificate-setup.md) |
| Reach Proxmox or a NAS **directly** on its own port, without a warning | [Backend certificates](guides/backend-certificates.md) |
| **Adopt an existing compose project** into Loskai | [Migration](guides/migration.md) |
| **Run the code locally** and change it | [Dev & testing](contributing/dev-testing.md) |
| Know **what an endpoint returns** | [Loskai API](reference/api.md) |
| **Write a recipe** for the install wizard | [Recipe schema](reference/recipe-schema.md) |

## Guides

Operating Loskai. Read in roughly this order the first time.

| Page | When to read it |
|---|---|
| [install.md](guides/install.md) | Setting Loskai up from nothing. Walks the recommended Proxmox layout end to end — both LXCs, then the container — and carries a second walkthrough for split DNS, the recommendation without Proxmox. Start here. |
| [topologies.md](guides/topologies.md) | **Before** installing, if you're unsure where each piece should run. Compares the three layouts on port ownership, says which two are recommended, and records the arrangements that were considered and rejected. |
| [deployment.md](guides/deployment.md) | Running the container: every env var, the two volume couplings that bite if you get them wrong, and cold start. The reference you return to. |
| [certificate-setup.md](guides/certificate-setup.md) | The first confusing moment for most users — why LAN devices distrust the cert under the internal CA, and the onboarding page that fixes it once per device. |
| [backend-certificates.md](guides/backend-certificates.md) | Only if you open a backend on its own port — Proxmox `:8006`, a NAS UI. Runs Caddy as an ACME server for its own CA so the backend serves a certificate your devices already trust. Loskai is not involved; this is Caddy and the backend. |
| [migration.md](guides/migration.md) | Moving an existing Docker Compose project under Loskai's Stack Manager — and when not to bother. Also covers relocating Loskai itself. |
| [troubleshooting.md](guides/troubleshooting.md) | Something is broken. Symptom-indexed: 502s, redirect loops, DNS, certs, VPN, greyed-out module cards. |

## Reference

Exact contracts. Two kinds, and the difference matters:

**Loskai's own API** — what the frontend consumes, and what changes when you touch a router.

| Page | When to read it |
|---|---|
| [api.md](reference/api.md) | Adding or changing an endpoint, or wiring up frontend calls. Human-readable overview of all 36 routes; the live `/docs` (Swagger) is authoritative. |
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
| [lxc-script-authoring.md](contributing/lxc-script-authoring.md) | Adding a new `create-<service>-lxc.sh`. The safety invariants, the shared library to copy verbatim, and an authoring checklist. |

## Conventions

- **Guides describe Loskai's behaviour; reference pages describe contracts.** If a fact
  about an external API appears in a guide, the reference page is the source of truth.
- Every page states **when to read it** at the top, not just what it contains.
- **These conventions are enforced.** `bash scripts/check-docs.sh` (or `make check-docs`)
  fails on a broken link, a dead heading anchor, or a page here that this index doesn't
  reach. Adding a page means adding it above — an unlisted page is a failure, not an
  oversight.
- Layouts are named consistently across all pages — **A** split-LXC (three-way split),
  **B** split DNS (two-way split), **C** all-in-Docker (one box). All three ship;
  [topologies.md](guides/topologies.md) defines them and records the one merged-container
  arrangement that was considered and rejected. **The letters were reassigned 2026-09-04**
  (split DNS B↔C all-in-Docker), so an older `HISTORY.md`/`TODO.md` entry naming a letter
  means the pre-swap one.
