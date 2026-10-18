# Changelog

What changed for someone running Loskai, newest first. The reasons behind each change are
in [`HISTORY.md`](docs/project/HISTORY.md).

## Unreleased — first public release

Everything so far:

- **Routing** — give any service an HTTPS name in one step: Caddy route and AdGuard DNS
  entry together. Sources: a container, a network service (AdGuard, router, Caddy) or any
  IP and port. Per route: HTTPS, HTTP or both, and whether the backend speaks HTTPS.
- **Machines** — name the computers on your network; a route linked to one follows it when
  its address changes. A Docker route can follow its container the same way.
- **Docker** — containers grouped by stack, with start/stop, update, logs, a terminal,
  stack editing — a form for settings and folders, or the files as text — and unused-volume
  cleanup.
- **Install wizard** — apps from recipe repos, with their own icons, routed on install.
  **Check for updates** shows which installed recipes have a newer version and what
  changes; Update replaces the recipe's `compose.yml` and keeps your settings and folders.
- **Dashboard** — every service as a launcher card, usable without logging in.
- **Certificate page** — installs Caddy's root certificate on each device, once.
- **Security** — one admin password; the app runs as the owner of its data folder, not root;
  secrets on disk are owner-only ([SECURITY.md](SECURITY.md)).
